import { getAccessToken } from "../gcp-auth.js";
import { config } from "../config.js";

const YOUTUBE_URL_REGEX = /^https?:\/\/(www\.|m\.)?(youtube\.com\/(watch\?v=|shorts\/|live\/)|youtu\.be\/)/i;

function endpoint(model, location = "global") {
  const host = location === "global"
    ? "aiplatform.googleapis.com"
    : `${location}-aiplatform.googleapis.com`;
  return `https://${host}/v1/projects/${config.vertexProject}/locations/${location}/publishers/google/models/${model}:generateContent`;
}

export async function executeAnalyzeYoutube(args, ctx) {
  const url = (args?.url || "").trim();
  const question = (args?.question || "").trim() || "請摘要這個影片的重點、100-200 字。若有字幕請一併參考。";

  if (!YOUTUBE_URL_REGEX.test(url)) {
    return { status: "error", error: "not a valid YouTube URL" };
  }

  const token = await getAccessToken();
  if (!token) return { status: "error", error: "no access token" };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120_000);

  try {
    const body = {
      contents: [{
        role: "user",
        parts: [
          { file_data: { file_uri: url } },
          { text: question },
        ],
      }],
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 2500,
        thinkingConfig: { thinkingBudget: 128 },
      },
    };

    const response = await fetch(endpoint(config.vertexChatModel), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errText = (await response.text()).slice(0, 400);
      return { status: "error", error: `vertex ${response.status}: ${errText}` };
    }

    const data = await response.json();
    const parts = data?.candidates?.[0]?.content?.parts || [];
    const text = parts.find(p => p.text)?.text || "";
    if (!text) return { status: "error", error: "empty summary" };

    return { status: "success", url, summary: text.trim() };
  } catch (e) {
    return { status: "error", error: e.message };
  } finally {
    clearTimeout(timer);
  }
}
