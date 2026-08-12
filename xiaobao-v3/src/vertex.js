import { getAccessToken } from "./gcp-auth.js";
import { config } from "./config.js";

const CHAT_LOCATION = "global";
const DEFAULT_THINKING_BUDGET = parseInt(process.env.THINKING_BUDGET || "128", 10);

function endpoint(model, location = CHAT_LOCATION) {
  const host = location === "global"
    ? "aiplatform.googleapis.com"
    : `${location}-aiplatform.googleapis.com`;
  return `https://${host}/v1/projects/${config.vertexProject}/locations/${location}/publishers/google/models/${model}:generateContent`;
}

function buildContentsFromShortcut(userParts) {
  return [{
    role: "user",
    parts: Array.isArray(userParts) ? userParts : [{ text: String(userParts || "") }],
  }];
}

const RETRY_STATUSES = new Set([429, 500, 502, 503, 504]);
const MAX_RETRIES = 3;

async function fetchVertexWithRetry(url, bodyJson, token, timeoutMs) {
  let lastErr;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
        },
        body: bodyJson,
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (RETRY_STATUSES.has(response.status) && attempt < MAX_RETRIES) {
        const delay = Math.pow(2, attempt) * 1000;
        console.warn(`[vertex] status ${response.status} attempt ${attempt + 1}/${MAX_RETRIES + 1}, retry in ${delay}ms`);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      return response;
    } catch (e) {
      clearTimeout(timer);
      lastErr = e;
      if (attempt >= MAX_RETRIES || e.name === "AbortError") throw e;
      const delay = Math.pow(2, attempt) * 1000;
      console.warn(`[vertex] fetch error ${e.message} attempt ${attempt + 1}/${MAX_RETRIES + 1}, retry in ${delay}ms`);
      await new Promise(r => setTimeout(r, delay));
    }
  }
  throw lastErr || new Error("vertex retry exhausted");
}

export async function generateChat({
  systemInstruction,
  contents,
  userParts,
  tools,
  model,
  temperature = 1.0,
  maxOutputTokens = 8192,
  thinkingBudget = DEFAULT_THINKING_BUDGET,
  timeoutMs = parseInt(process.env.VERTEX_TIMEOUT_MS || "120000", 10),
}) {
  const token = await getAccessToken();
  if (!token) throw new Error("Vertex ADC token unavailable");

  const finalContents = contents || buildContentsFromShortcut(userParts);
  const body = {
    contents: finalContents,
    generationConfig: {
      temperature,
      maxOutputTokens,
      thinkingConfig: { thinkingBudget },
    },
  };
  if (systemInstruction) {
    body.systemInstruction = { parts: [{ text: systemInstruction }] };
  }
  if (tools && tools.length > 0) {
    body.tools = tools;
  }
  const bodyJson = JSON.stringify(body);

  const response = await fetchVertexWithRetry(
    endpoint(model || config.vertexChatModel),
    bodyJson,
    token,
    timeoutMs,
  );

  if (!response.ok) {
    const errText = (await response.text()).slice(0, 400);
    throw new Error(`Vertex ${response.status}: ${errText}`);
  }

  const data = await response.json();
  const candidate = data?.candidates?.[0];
  const modelContent = candidate?.content || null;
  const parts = modelContent?.parts || [];
  const textPart = parts.find(p => p.text);
  const functionCalls = parts.filter(p => p.functionCall).map(p => p.functionCall);
  return {
    text: textPart?.text || "",
    functionCalls,
    modelContent,
    finishReason: candidate?.finishReason || "",
    raw: data,
  };
}

export function textPart(text) {
  return { text: String(text || "") };
}

export function inlineDataPart(base64Data, mimeType) {
  return { inline_data: { mime_type: mimeType, data: base64Data } };
}

export function functionResponsePart(name, response) {
  return { functionResponse: { name, response } };
}
