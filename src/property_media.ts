import { z } from "zod";

const mediaBase = z.object({
  request_id: z.string().uuid(),
  property_id: z.string().regex(/^[a-zA-Z0-9_-]{2,64}$/),
  record_id: z.string().regex(/^[a-zA-Z0-9_-]{2,64}$/),
  file_name: z.string().min(1).max(180),
  content_type: z.string().regex(/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/i),
  size_bytes: z.number().int().positive().max(5 * 1024 ** 3),
});

export const initiateUploadSchema = z.discriminatedUnion("record_type", [
  mediaBase.extend({ record_type: z.literal("maintenance_request") }),
  mediaBase.extend({ record_type: z.literal("tenant_document") }),
  mediaBase.extend({ record_type: z.literal("inspection_reminder") }),
]);

export const completeUploadSchema = z.object({
  upload_id: z.string().min(1),
  parts: z.array(z.object({
    part_number: z.number().int().positive(),
    etag: z.string().min(1),
  })).min(1).superRefine((parts, context) => {
    for (let index = 0; index < parts.length; index += 1) {
      if (parts[index]?.part_number !== index + 1) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "parts must be ordered and contiguous from 1",
        });
        return;
      }
    }
  }),
});

export const abortUploadSchema = z.object({ upload_id: z.string().min(1) });
export type InitiateUpload = z.infer<typeof initiateUploadSchema>;

const folderByRecord = {
  maintenance_request: "maintenance",
  tenant_document: "tenant-documents",
  inspection_reminder: "inspections",
} as const;

export type UploadPlan = {
  objectKey: string;
  partCount: number;
  partSizeBytes: number;
  privacy: "private";
};

export function planPropertyUpload(input: InitiateUpload, minimumPartBytes = 8 * 1024 ** 2): UploadPlan {
  const extension = input.file_name.match(/\.[a-z0-9]{1,10}$/i)?.[0]?.toLowerCase() ?? ".bin";
  const partSizeBytes = Math.max(minimumPartBytes, Math.ceil(input.size_bytes / 1_000));
  return {
    objectKey: `${input.property_id}/${folderByRecord[input.record_type]}/${input.record_id}/${input.request_id}${extension}`,
    partCount: Math.ceil(input.size_bytes / partSizeBytes),
    partSizeBytes,
    privacy: "private",
  };
}
