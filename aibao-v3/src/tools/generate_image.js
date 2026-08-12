import { getAccessToken } from "../gcp-auth.js";
import { config } from "../config.js";
import { uploadBytes } from "../gcs.js";

const PRIMARY_MODEL = process.env.IMAGE_GEN_MODEL || "gemini-3-pro-image";
const PRIMARY_LOCATION = process.env.IMAGE_GEN_LOCATION || "global";
const FALLBACK_MODEL = process.env.IMAGE_GEN_FALLBACK_MODEL || "gemini-2.5-flash-image";
const FALLBACK_LOCATION = process.env.IMAGE_GEN_FALLBACK_LOCATION || "global";

function endpoint(model, location) {
  const host = location === "global"
    ? "aiplatform.googleapis.com"
    : `${location}-aiplatform.googleapis.com`;
  return `https://${host}/v1/projects/${config.vertexProject}/locations/${location}/publishers/google/models/${model}:generateContent`;
}

function randomKey() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function callImageModel(model, location, prompt, token, timeoutMs = 150_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const body = { contents: [{ role: "user", parts: [{ text: prompt }] }] };
    const response = await fetch(endpoint(model, location), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!response.ok) {
      return { model, error: `${response.status}: ${(await response.text()).slice(0, 200)}` };
    }
    const data = await response.json();
    const parts = data?.candidates?.[0]?.content?.parts || [];
    const imgParts = parts.filter(p => (p.inlineData || p.inline_data)?.data && !p.thought);
    const textPart = parts.find(p => p.text && !p.thought)?.text || "";
    return { model, imgParts, textPart, finish: data?.candidates?.[0]?.finishReason };
  } catch (e) {
    return { model, error: e.message };
  } finally {
    clearTimeout(timer);
  }
}

export async function executeGenerateImage(args, ctx) {
  const prompt = (args?.prompt || "").trim();
  console.log(`[generate_image] prompt="${prompt.slice(0, 120)}"`);
  if (!prompt) return { status: "error", error: "missing prompt" };

  const token = await getAccessToken();
  if (!token) return { status: "error", error: "no access token" };

  let result = await callImageModel(PRIMARY_MODEL, PRIMARY_LOCATION, prompt, token);
  console.log(`[generate_image] primary ${result.model} -> imgs=${result.imgParts?.length || 0} err=${result.error || "-"} finish=${result.finish || "-"}`);

  if (!result.imgParts || result.imgParts.length === 0) {
    console.log(`[generate_image] fallback to ${FALLBACK_MODEL}`);
    result = await callImageModel(FALLBACK_MODEL, FALLBACK_LOCATION, prompt, token);
    console.log(`[generate_image] fallback ${result.model} -> imgs=${result.imgParts?.length || 0} err=${result.error || "-"}`);
  }

  if (result.error) return { status: "error", error: `${result.model}: ${result.error}` };
  if (!result.imgParts || result.imgParts.length === 0) {
    return { status: "error", error: "both models returned no image" };
  }

  const uploaded = [];
  for (const p of result.imgParts) {
    const inline = p.inlineData || p.inline_data;
    const mime = inline.mimeType || inline.mime_type || "image/png";
    const ext = mime.split("/")[1] || "png";
    const buf = Buffer.from(inline.data, "base64");
    const filename = `image/${randomKey()}.${ext}`;
    try {
      const url = await uploadBytes({
        name: filename,
        bytes: buf,
        mimeType: mime,
      });
      uploaded.push(url);
    } catch (e) {
      console.error("[generate_image] GCS upload error:", e.message);
    }
  }

  if (uploaded.length === 0) return { status: "error", error: "GCS upload failed" };

  return {
    status: "success",
    prompt,
    text: result.textPart || "",
    model_used: result.model,
    image_urls: uploaded,
    image_url: uploaded[0],
  };
}
