import { db, FieldValue } from "../firestore.js";
import { linePush } from "../line.js";
import { saveChat, makeConvKey } from "../memory.js";

const BATCH_LIMIT = parseInt(process.env.REMINDER_TICK_LIMIT || "50", 10);

function formatReminderText(data) {
  const nickname = data.nickname || "家人";
  const content = data.content || "";
  return `小寶提醒：${nickname}、時間到囉、記得「${content}」喔。`;
}

export async function runReminderTick() {
  const t0 = Date.now();
  const now = new Date();

  let snap;
  try {
    snap = await db().collection("reminders")
      .where("status", "==", "pending")
      .where("fireAt", "<=", now)
      .orderBy("fireAt")
      .limit(BATCH_LIMIT)
      .get();
  } catch (e) {
    console.error("[reminder_tick] query error:", e.message);
    return { ok: false, error: e.message, took_ms: Date.now() - t0 };
  }

  if (snap.empty) {
    return { ok: true, fired: 0, took_ms: Date.now() - t0 };
  }

  let fired = 0;
  let skipped = 0;
  const errors = [];

  for (const doc of snap.docs) {
    const data = doc.data();
    const target = data.groupId || data.userId;
    if (!target) {
      console.warn(`[reminder_tick] skip ${doc.id}: no target`);
      skipped++;
      continue;
    }

    const text = formatReminderText(data);
    try {
      await linePush(target, text);
      await doc.ref.update({
        status: "fired",
        firedAt: FieldValue.serverTimestamp(),
      });
      fired++;
      console.log(`[reminder_tick] fired ${doc.id}: ${data.content}`);
      try {
        const convKey = makeConvKey({ groupId: data.groupId, userId: data.userId });
        await saveChat({
          convKey,
          groupId: data.groupId || "",
          userId: "bot",
          nickname: "小寶",
          text: `【提醒】${text}`,
          role: "bot",
          msgType: "reminder",
        });
      } catch (e) {
        console.warn(`[reminder_tick] saveChat error ${doc.id}:`, e.message);
      }
    } catch (e) {
      console.error(`[reminder_tick] push error ${doc.id}:`, e.message);
      errors.push({ id: doc.id, error: e.message });
    }
  }

  return {
    ok: true,
    fired,
    skipped,
    errors: errors.length ? errors : undefined,
    took_ms: Date.now() - t0,
  };
}
