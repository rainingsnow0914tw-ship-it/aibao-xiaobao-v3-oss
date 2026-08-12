export function shouldReply(event) {
  if (event.type !== "message") return false;
  const msg = event.message || {};
  const mtype = msg.type;

  if (!["text", "image", "video", "audio", "file"].includes(mtype)) return false;

  const source = event.source || {};
  // 1-on-1 only for xiaobao. Skip group / room messages to avoid spam.
  if (source.groupId || source.roomId) return false;

  return true;
}
