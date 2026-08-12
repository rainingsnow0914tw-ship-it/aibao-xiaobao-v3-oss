import { config } from "./config.js";

export function shouldReply(event) {
  const source = event.source || {};
  const groupId = source.groupId || "";

  if (config.lineGroupId && groupId !== config.lineGroupId) return false;

  if (event.type !== "message") return false;
  const msg = event.message || {};
  const mtype = msg.type;

  if (!["text", "image", "video", "audio", "file"].includes(mtype)) return false;

  if (mtype !== "text") return true;

  const text = msg.text || "";
  if (text.includes(config.triggerKeyword)) return true;

  return false;
}
