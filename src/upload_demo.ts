const input = {
  request_id: "84ef7087-f027-49df-9c5c-a62280da3d89",
  property_id: "cedar-court",
  record_id: "inspection-2026-10",
  record_type: "inspection_reminder",
  file_name: "north-stairwell.mp4",
  content_type: "video/mp4",
  size_bytes: 48_000_000,
};

const response = await fetch("http://localhost:3000/media-uploads/initiate", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(input),
});
const result = await response.json();
console.log(JSON.stringify(result, null, 2));
