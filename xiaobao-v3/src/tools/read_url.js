import { generateChat } from "../vertex.js";

const URL_REGEX = /^https?:\/\/[^\s]+$/i;
const MAX_CONTENT_LEN = 4000;
const FETCH_TIMEOUT_MS = 15_000;

function stripHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

export async function executeReadUrl(args, ctx) {
  const url = (args?.url || "").trim();
  if (!URL_REGEX.test(url)) {
    return { status: "error", error: "invalid url format" };
  }

  let html;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    const response = await fetch(url, {
      headers: {
        "user-agent": "Mozilla/5.0 (compatible; aibao-v3-bot/1.0)",
        "accept": "text/html,application/xhtml+xml",
      },
      signal: controller.signal,
      redirect: "follow",
    });
    clearTimeout(timer);
    if (!response.ok) {
      return { status: "error", error: `fetch ${response.status}` };
    }
    html = await response.text();
  } catch (e) {
    return { status: "error", error: `fetch: ${e.message}` };
  }

  const content = stripHtml(html).slice(0, MAX_CONTENT_LEN);
  if (!content || content.length < 30) {
    return { status: "error", error: "content too short after strip" };
  }

  let summary = "";
  let risk = "unknown";
  try {
    const result = await generateChat({
      systemInstruction:
        "你是網頁摘要助手。給用戶：一、100-180 字白話摘要重點。二、詐騙/廣告/假新聞可疑度：low / medium / high、附一句原因。" +
        "格式：先摘要、空一行、然後【可疑度】low/medium/high — 原因。",
      userParts: `URL: ${url}\n\n網頁純文字內容：\n${content}`,
      thinkingBudget: 0,
      maxOutputTokens: 800,
    });
    summary = (result.text || "").trim();
    const m = summary.match(/【可疑度】\s*(low|medium|high)/i);
    if (m) risk = m[1].toLowerCase();
  } catch (e) {
    return { status: "error", error: `vertex: ${e.message}` };
  }

  if (!summary) {
    return { status: "error", error: "empty summary" };
  }

  return {
    status: "success",
    url,
    summary,
    risk,
    content_len: content.length,
  };
}
