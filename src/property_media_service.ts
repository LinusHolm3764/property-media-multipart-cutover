import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { ZodError, type ZodType } from "zod";
import { InfraiError, infrai } from "./infrai_storage.js";
import {
  abortUploadSchema,
  completeUploadSchema,
  initiateUploadSchema,
  planPropertyUpload,
} from "./property_media.js";

const BUCKET = process.env.PROPERTY_MEDIA_BUCKET ?? "property-private-media";
const PORT = Number(process.env.PORT ?? 3000);

async function readJson<T>(request: IncomingMessage, schema: ZodType<T>): Promise<T> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > 64 * 1024) throw new RequestError(413, "request body is too large");
    chunks.push(buffer);
  }
  try {
    return schema.parse(JSON.parse(Buffer.concat(chunks).toString("utf8")));
  } catch (error) {
    if (error instanceof ZodError || error instanceof SyntaxError) {
      throw new RequestError(400, "request body is invalid");
    }
    throw error;
  }
}

class RequestError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function json(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(value));
}

async function ensureBucket(): Promise<void> {
  try {
    await infrai.storage.bucket.create(BUCKET);
  } catch (error) {
    if (!(error instanceof InfraiError && error.status === 409)) throw error;
  }
}

async function route(request: IncomingMessage, response: ServerResponse): Promise<void> {
  if (request.method === "POST" && request.url === "/media-uploads/initiate") {
    const input = await readJson(request, initiateUploadSchema);
    const plan = planPropertyUpload(input);
    const created = await infrai.storage.multipart.create(BUCKET, plan.objectKey, input.content_type);
    const partCount = Math.ceil(input.size_bytes / Math.max(plan.partSizeBytes, created.part_size_min));
    if (partCount > created.part_count_max) throw new RequestError(422, "file requires too many parts");
    const parts = await Promise.all(Array.from({ length: partCount }, async (_, index) => {
      const partNumber = index + 1;
      const signed = await infrai.storage.multipart.presign_part(created.upload_id, partNumber);
      return { part_number: partNumber, url: signed.url, method: signed.method };
    }));
    json(response, 201, {
      upload_id: created.upload_id,
      object_key: plan.objectKey,
      part_size_bytes: Math.max(plan.partSizeBytes, created.part_size_min),
      parts,
    });
    return;
  }

  if (request.method === "POST" && request.url === "/media-uploads/complete") {
    const input = await readJson(request, completeUploadSchema);
    const object = await infrai.storage.multipart.complete(input.upload_id, input.parts);
    json(response, 200, { state: "stored", object_key: object.key, size_bytes: object.size_bytes });
    return;
  }

  if (request.method === "POST" && request.url === "/media-uploads/abort") {
    const input = await readJson(request, abortUploadSchema);
    await infrai.storage.multipart.abort(input.upload_id);
    json(response, 200, { state: "aborted", upload_id: input.upload_id });
    return;
  }

  json(response, 404, { error: "route not found" });
}

function clientStatus(error: unknown): number {
  if (error instanceof RequestError) return error.status;
  if (error instanceof InfraiError && error.status >= 400 && error.status < 500) return error.status;
  return 500;
}

export async function startPropertyMediaService(): Promise<void> {
  await ensureBucket();
  const server = createServer((request, response) => {
    route(request, response).catch((error: unknown) => {
      const status = clientStatus(error);
      json(response, status, { error: error instanceof Error ? error.message : "request failed" });
    });
  });
  server.listen(PORT, () => console.log(`property media service listening on http://localhost:${PORT}`));
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  startPropertyMediaService().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
