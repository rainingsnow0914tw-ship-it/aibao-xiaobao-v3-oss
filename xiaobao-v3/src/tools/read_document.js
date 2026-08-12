import { parseOfficeAsync } from "officeparser";
import { downloadLineContent } from "../line.js";

const MAX_BYTES = 10 * 1024 * 1024;
const MAX_TEXT_LEN = 20000;

export async function executeReadDocument(args) {
  const messageId = String(args?.messageId || "").trim();
  const mimeType = String(args?.mimeType || "").trim();
  const fileName = String(args?.fileName || "file").trim();
  if (!messageId) {
    return { status: "error", error: "missing messageId" };
  }

  let content;
  try {
    content = await downloadLineContent(messageId);
  } catch (e) {
    return { status: "error", error: `line download: ${e.message}` };
  }
  if (!content || !content.bytes) {
    return { status: "error", error: "empty download" };
  }
  if (content.bytes.length > MAX_BYTES) {
    return {
      status: "error",
      error: `file too large: ${content.bytes.length} bytes (max ${MAX_BYTES})`,
    };
  }

  let text;
  try {
    text = await parseOfficeAsync(content.bytes);
  } catch (e) {
    return {
      status: "error",
      error: `parse failed: ${e.message}`,
      fileName,
      mime: content.mime || mimeType,
    };
  }
  text = String(text || "").trim();
  if (!text) {
    return {
      status: "error",
      error: "empty content after parse (檔案可能全圖、加密、或空表)",
      fileName,
      mime: content.mime || mimeType,
    };
  }

  const truncated = text.length > MAX_TEXT_LEN;
  const finalText = truncated ? text.slice(0, MAX_TEXT_LEN) : text;

  return {
    status: "success",
    fileName,
    mime: content.mime || mimeType,
    text: finalText,
    text_len: finalText.length,
    truncated,
    original_len: text.length,
  };
}
