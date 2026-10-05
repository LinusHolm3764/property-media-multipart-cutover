import assert from "node:assert/strict";
import test from "node:test";
import { initiateUploadSchema, planPropertyUpload } from "../src/property_media.js";

test("inspection media is private, record-scoped, and split into bounded parts", () => {
  const input = initiateUploadSchema.parse({
    request_id: "84ef7087-f027-49df-9c5c-a62280da3d89",
    property_id: "cedar-court",
    record_id: "inspection-2026-10",
    record_type: "inspection_reminder",
    file_name: "North Stairwell.MP4",
    content_type: "video/mp4",
    size_bytes: 48_000_000,
  });

  assert.deepEqual(planPropertyUpload(input), {
    objectKey: "cedar-court/inspections/inspection-2026-10/84ef7087-f027-49df-9c5c-a62280da3d89.mp4",
    partCount: 6,
    partSizeBytes: 8 * 1024 ** 2,
    privacy: "private",
  });
});

test("a tenant document cannot carry an unbounded property identifier", () => {
  const result = initiateUploadSchema.safeParse({
    request_id: "84ef7087-f027-49df-9c5c-a62280da3d89",
    property_id: "cedar court/private",
    record_id: "lease-42",
    record_type: "tenant_document",
    file_name: "lease.pdf",
    content_type: "application/pdf",
    size_bytes: 9_000_000,
  });
  assert.equal(result.success, false);
});
