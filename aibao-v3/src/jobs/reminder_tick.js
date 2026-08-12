import { db } from "../firestore.js";
import { fireReminder } from "./reminder_fire.js";

const BATCH_LIMIT = parseInt(process.env.REMINDER_TICK_LIMIT || "50", 10);

// ⚠️ 這已經不是主要路徑了（2026-07-31 起）。
// 主路徑：set_reminder 當下就排一個 Cloud Task、時間到精準打 /reminder-fire。
// 這個 tick 降成每小時一次的 safety net，補那些 task 沒排成功或沒 fire 的漏網之魚。
// 兩邊都走 fireReminder 的 transaction 搶鎖，同一則不可能發兩次。
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
    const r = await fireReminder(doc.id, "tick-safety-net");
    if (r.ok && r.fired) {
      fired++;
      // 會走到這裡 = Cloud Task 那條路沒把它發出去，值得注意
      console.warn(`[reminder_tick] SAFETY NET 補發 ${doc.id} —— Cloud Task 沒發到、要檢查`);
    } else if (r.skipped) {
      skipped++;
    } else {
      errors.push({ id: doc.id, error: r.error });
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
