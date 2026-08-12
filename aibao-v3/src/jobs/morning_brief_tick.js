import { generateMorningBrief } from "../tools/morning_brief.js";
import { generateMorningImage } from "../tools/morning_image.js";
import { linePush, makeImageMessage } from "../line.js";
import { saveChat } from "../memory.js";
import { config } from "../config.js";

export async function runMorningBriefTick() {
  const t0 = Date.now();
  const target = config.lineGroupId;
  if (!target) {
    return { ok: false, error: "LINE_GROUP_ID not set", took_ms: Date.now() - t0 };
  }

  const brief = await generateMorningBrief({ force: true });
  if (brief.status !== "success") {
    return { ok: false, error: brief.error || "gen failed", took_ms: Date.now() - t0 };
  }

  let image = null;
  try {
    image = await generateMorningImage();
  } catch (e) {
    console.warn("[morning_brief_tick] image gen error:", e.message);
  }

  try {
    const messages = [{ type: "text", text: brief.text }];
    if (image?.url) messages.push(makeImageMessage(image.url));
    await linePush(target, messages);

    try {
      const chatText = `【早報】${brief.text}${image?.url ? ` 【早安圖】${image.url}` : ""}`;
      await saveChat({
        groupId: target,
        userId: "bot",
        nickname: "阿寶",
        text: chatText,
        role: "bot",
        msgType: "morning_brief",
      });
    } catch (e) {
      console.warn("[morning_brief_tick] saveChat error:", e.message);
    }

    return {
      ok: true,
      target,
      topic: brief.topic,
      style: brief.style,
      chars: brief.text.length,
      image_ok: Boolean(image?.url),
      took_ms: Date.now() - t0,
    };
  } catch (e) {
    console.error("[morning_brief_tick] push error:", e.message);
    return { ok: false, error: e.message, took_ms: Date.now() - t0 };
  }
}
