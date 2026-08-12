import { createHmac, timingSafeEqual } from "node:crypto";
import { config } from "./config.js";

export function verifyLineSignature(rawBody, signature, secret) {
  if (!secret || !signature) return false;
  const hmac = createHmac("sha256", secret);
  hmac.update(rawBody);
  const expected = hmac.digest("base64");
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function normalizeMessages(messagesOrText) {
  if (Array.isArray(messagesOrText)) return messagesOrText;
  if (typeof messagesOrText === "string") return [{ type: "text", text: messagesOrText }];
  if (messagesOrText && typeof messagesOrText === "object") return [messagesOrText];
  return [];
}

export async function lineReply(replyToken, messagesOrText) {
  const messages = normalizeMessages(messagesOrText).slice(0, 5);
  if (messages.length === 0) return;
  const response = await fetch("https://api.line.me/v2/bot/message/reply", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "authorization": `Bearer ${config.lineToken}`,
    },
    body: JSON.stringify({ replyToken, messages }),
  });
  if (!response.ok) {
    throw new Error(`LINE reply ${response.status}: ${(await response.text()).slice(0, 200)}`);
  }
}

export async function linePush(to, messagesOrText) {
  const messages = normalizeMessages(messagesOrText).slice(0, 5);
  if (messages.length === 0) return;
  const response = await fetch("https://api.line.me/v2/bot/message/push", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "authorization": `Bearer ${config.lineToken}`,
    },
    body: JSON.stringify({ to, messages }),
  });
  if (!response.ok) {
    throw new Error(`LINE push ${response.status}: ${(await response.text()).slice(0, 200)}`);
  }
}

export async function downloadLineContent(messageId) {
  if (!messageId) return null;
  const response = await fetch(`https://api-data.line.me/v2/bot/message/${messageId}/content`, {
    headers: { authorization: `Bearer ${config.lineToken}` },
  });
  if (!response.ok) {
    throw new Error(`LINE content ${response.status}`);
  }
  const mime = response.headers.get("content-type") || "application/octet-stream";
  const buf = await response.arrayBuffer();
  return { bytes: Buffer.from(buf), mime: mime.split(";")[0].trim() };
}

export function makeImageMessage(originalContentUrl, previewImageUrl) {
  return {
    type: "image",
    originalContentUrl,
    previewImageUrl: previewImageUrl || originalContentUrl,
  };
}
