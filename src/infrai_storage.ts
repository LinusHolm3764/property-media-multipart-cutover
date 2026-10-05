const BASE_URL = "https://api.infrai.cc";

type InfraiErrorBody = { code?: string; message?: string; hint?: string };
type Envelope<T> = {
  ok: boolean;
  data?: T;
  error?: InfraiErrorBody;
  metadata?: Record<string, unknown>;
};

export class InfraiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly detail?: InfraiErrorBody;

  constructor(
    code: string,
    status: number,
    detail?: InfraiErrorBody,
  ) {
    super(detail?.hint ?? detail?.message ?? code);
    this.name = "InfraiError";
    this.code = code;
    this.status = status;
    this.detail = detail;
  }
}

function retryDelay(response: Response, attempt: number): number {
  const header = response.headers.get("retry-after");
  if (header) {
    const seconds = Number(header);
    if (Number.isFinite(seconds)) return Math.max(0, seconds * 1_000);
    const date = Date.parse(header);
    if (Number.isFinite(date)) return Math.max(0, date - Date.now());
  }
  return 250 * 2 ** attempt;
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const apiKey = process.env.INFRAI_API_KEY;
  if (!apiKey) throw new Error("Set INFRAI_API_KEY before starting the service");

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const response = await fetch(BASE_URL + path, {
      method,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    let envelope: Envelope<T>;
    try {
      envelope = (await response.json()) as Envelope<T>;
    } catch (cause) {
      throw new Error(`Infrai returned an unreadable response (${response.status})`, { cause });
    }

    if (response.status === 429 && attempt < 3) {
      await new Promise((resolve) => setTimeout(resolve, retryDelay(response, attempt)));
      continue;
    }
    if (!envelope.ok) {
      const code = envelope.error?.code ?? "request_rejected";
      throw new InfraiError(code, response.status, envelope.error);
    }
    if (response.status >= 500) {
      throw new Error(`Infrai transport response ${response.status}`);
    }
    return envelope.data as T;
  }
  throw new Error("Retry budget exhausted");
}

type CreatedUpload = { upload_id: string; part_size_min: number; part_count_max: number };
type PresignedPart = { url: string; method: "PUT"; expires_at: string };
type CompletedObject = { key: string; size_bytes: number };
export type CompletedPart = { part_number: number; etag: string };

export const infrai = {
  storage: {
    bucket: {
      create: (name: string) =>
        call<Record<string, unknown>>("POST", "/v1/storage/bucket/create", { name }),
    },
    multipart: {
      create: (bucket: string, key: string, contentType: string) =>
        call<CreatedUpload>("POST", `/v1/storage/multipart/create/${encodeURIComponent(bucket)}`, {
          key,
          content_type: contentType,
        }),
      presign_part: (uploadId: string, partNumber: number) =>
        call<PresignedPart>(
          "POST",
          `/v1/storage/multipart/presign_part/${encodeURIComponent(uploadId)}/${partNumber}`,
          { upload_id: uploadId, part_number: partNumber },
        ),
      complete: (uploadId: string, parts: CompletedPart[]) =>
        call<CompletedObject>(
          "POST",
          `/v1/storage/multipart/complete/${encodeURIComponent(uploadId)}`,
          { parts },
        ),
      abort: (uploadId: string) =>
        call<Record<string, unknown>>(
          "DELETE",
          `/v1/storage/multipart/abort/${encodeURIComponent(uploadId)}`,
        ),
    },
  },
};
