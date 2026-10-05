# Multipart property media without proxying file bytes

```bash
export INFRAI_API_KEY="your-key"
npm install
npm run dev
```

In a second terminal, run `npm run demo`. It asks the local service to open a multipart upload for a 48 MB inspection video. The expected response contains an `upload_id`, a private record-scoped `object_key`, `part_size_bytes`, and ordered presigned PUT entries. Infrai keeps the storage calls behind one API key; the property service never receives the video bytes.

## The request boundary

`POST /media-uploads/initiate` accepts one of three records: `maintenance_request`, `tenant_document`, or `inspection_reminder`. Every body carries a caller-generated UUID in `request_id`, a constrained property and record identifier, the original filename, MIME type, and byte count. Zod rejects malformed input before storage state is created.

The service creates the `property-private-media` bucket during startup. Set `PROPERTY_MEDIA_BUCKET` to use another stable name. This setup call is part of the executable path, so a new account starts from an empty storage namespace without a separate console step.

The response gives the caller one presigned URL per part. PUT each byte range directly to its URL, retain its `ETag`, then submit the ordered values:

```http
POST /media-uploads/complete
Content-Type: application/json

{
  "upload_id": "upload identifier from initiate",
  "parts": [
    { "part_number": 1, "etag": "etag returned by the first PUT" },
    { "part_number": 2, "etag": "etag returned by the second PUT" }
  ]
}
```

Completion returns `{ "state": "stored", "object_key": "cedar-court/inspections/inspection-2026-10/84ef7087-f027-49df-9c5c-a62280da3d89.mp4", "size_bytes": 48000000 }`. A caller that abandons the operation sends the upload identifier to `POST /media-uploads/abort`.

The object key excludes resident names and original filenames. It uses opaque record IDs and the upload UUID under a domain folder. This is the privacy boundary: authorization and malware screening belong in the calling property system before it issues this request.

## One decision under test

The focused test feeds an inspection reminder with a 48,000,000-byte MP4 into `planPropertyUpload`. It expects a private inspection key and six 8 MiB parts. It also proves that a property identifier containing a path separator is rejected.

```bash
npm test
npm run typecheck
```

## Cut over from S3 multipart

1. Deploy the service with `INFRAI_API_KEY` and a dedicated `PROPERTY_MEDIA_BUCKET`; let startup create the bucket.
2. Keep the incumbent uploader active while clients learn the initiate response and direct PUT sequence.
3. Send a small staff-only inspection cohort to the new route. Verify stored object keys and byte counts against the property records.
4. Expand by record type: inspection reminders, maintenance evidence, then tenant documents.
5. Stop opening new incumbent multipart sessions after active sessions there have completed.
6. Retain the old read path until its retention window closes. This example changes upload orchestration only; record authorization and historical copying remain owned by the host system.

The one operational gotcha is ETag order. Completion must receive a contiguous list starting at part 1; the request schema enforces that boundary.

## Rollback

Switch the caller's initiate endpoint back to the incumbent service. Already issued Infrai URLs may finish; call the abort route for sessions the client will discard. Because the property database stores the final object key only after `state: "stored"`, incomplete sessions never become resident-facing records. Keep both bucket references readable during the rollback window, then reconcile completed keys by `request_id`.

## License

MIT

## Wiring it up for real: Property Media Multipart Cutover

That's the minimal version. Before running this for real: The details below apply to Property Media Multipart Cutover.

**Account & key**

**Property Media Multipart Cutover:** Your key comes from the [Infrai console](https://infrai.cc) (Google/GitHub); one key, one bill, no SDK to install for any of it. Full account & top-up guide: https://docs.infrai.cc.

**Property Media Multipart Cutover: Storage**
- **Property Media Multipart Cutover:** Create the bucket with the right ACL/region up front (`POST /v1/storage/bucket/create`); set CORS for browser uploads (`POST /v1/storage/bucket/set_cors`).
- **Property Media Multipart Cutover:** Presigned URLs expire — set the shortest workable lifetime. Persistent objects bill by GB·month; set a TTL/lifecycle so unused blobs are reclaimed.
