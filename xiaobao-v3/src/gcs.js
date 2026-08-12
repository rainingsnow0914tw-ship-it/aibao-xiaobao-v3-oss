import { getAccessToken } from "./gcp-auth.js";

const DEFAULT_BUCKET = process.env.GCS_IMAGE_BUCKET || "your-image-bucket";

export async function uploadBytes({ bucket = DEFAULT_BUCKET, name, bytes, mimeType = "application/octet-stream", cacheControl = "public, max-age=86400" }) {
  const token = await getAccessToken();
  if (!token) throw new Error("no access token for GCS upload");
  const url = `https://storage.googleapis.com/upload/storage/v1/b/${bucket}/o?uploadType=media&name=${encodeURIComponent(name)}`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": mimeType,
      "cache-control": cacheControl,
    },
    body: bytes,
  });
  if (!response.ok) {
    throw new Error(`GCS upload ${response.status}: ${(await response.text()).slice(0, 200)}`);
  }
  return `https://storage.googleapis.com/${bucket}/${name}`;
}
