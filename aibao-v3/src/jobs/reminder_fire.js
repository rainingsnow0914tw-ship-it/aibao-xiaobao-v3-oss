import { db, FieldValue } from "../firestore.js";
import { linePush } from "../line.js";
import { saveChat } from "../memory.js";

// 同一收件人、前後 5 分鐘內的提醒併成一則（沿用 catch-loop v0.6 Task 16 的 5 分鐘 window）
const MERGE_WINDOW_MS = parseInt(process.env.REMINDER_MERGE_WINDOW_MS || "300000", 10);
const MERGE_MAX = 20;

export function formatReminderText(data) {
  const nickname = data.nickname || "家人";
  const content = data.content || "";
  return `阿寶提醒：${nickname}、時間到囉、記得「${content}」喔。`;
}

function formatMergedText(items, nickname) {
  const lines = items.map(it => `・${it.content || ""}`).join("\n");
  return `阿寶提醒：${nickname}、時間到囉、有 ${items.length} 件事：\n${lines}`;
}

// 搶鎖：status pending → fired。搶到回 doc 資料、搶不到回 null。
// Cloud Task 和 safety-net tick 同時進來也只有一個搶得到。
async function claimReminder(ref, source) {
  return await db().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return null;
    const d = snap.data();
    if (d.status !== "pending") return null;
    tx.update(ref, {
      status: "fired",
      firedAt: FieldValue.serverTimestamp(),
      firedBy: source,
    });
    return { id: ref.id, ...d };
  });
}

async function revertClaim(id) {
  try {
    await db().collection("reminders").doc(id).update({
      status: "pending",
      firedAt: null,
      firedBy: null,
    });
  } catch (e) {
    console.error(`[reminder_fire] revert failed ${id}:`, e.message);
  }
}

export async function fireReminder(reminderId, source = "cloudtask") {
  if (!reminderId) return { ok: false, error: "missing reminderId" };
  const ref = db().collection("reminders").doc(reminderId);

  let main;
  try {
    main = await claimReminder(ref, source);
  } catch (e) {
    console.error(`[reminder_fire] tx error ${reminderId}:`, e.message);
    return { ok: false, error: e.message };
  }

  // 不存在、或已被另一條路徑發掉了 —— 都不算錯
  if (!main) return { ok: true, skipped: true, reminder_id: reminderId };

  const target = main.groupId || main.userId;
  if (!target) {
    console.warn(`[reminder_fire] ${reminderId} has no target`);
    return { ok: false, error: "no target" };
  }
  const nickname = main.nickname || "家人";

  // 把同一收件人、±5 分鐘內的其他提醒一起收攏，合併成一則
  const claimed = [main];
  try {
    const fireAtMs = main.fireAt?.toMillis?.() || Date.now();
    const snap = await db().collection("reminders")
      .where("status", "==", "pending")
      .where("fireAt", ">=", new Date(fireAtMs - MERGE_WINDOW_MS))
      .where("fireAt", "<=", new Date(fireAtMs + MERGE_WINDOW_MS))
      .limit(MERGE_MAX)
      .get();
    for (const doc of snap.docs) {
      if (doc.id === reminderId) continue;
      const d = doc.data();
      if ((d.groupId || d.userId) !== target) continue;
      const got = await claimReminder(doc.ref, `${source}-merged`);
      if (got) claimed.push(got);
    }
  } catch (e) {
    // 合併掃描失敗不該拖累主提醒，照樣把主的發出去
    console.warn(`[reminder_fire] merge scan failed ${reminderId}:`, e.message);
  }

  const text = claimed.length === 1
    ? formatReminderText(main)
    : formatMergedText(claimed, nickname);

  try {
    await linePush(target, text);
  } catch (e) {
    console.error(`[reminder_fire] push failed ${reminderId}, revert ${claimed.length}:`, e.message);
    for (const it of claimed) await revertClaim(it.id);
    return { ok: false, error: e.message };
  }

  try {
    await saveChat({
      groupId: main.groupId || "",
      userId: "bot",
      nickname: "阿寶",
      text: `【提醒】${text}`,
      role: "bot",
      msgType: "reminder",
    });
  } catch (e) {
    console.warn(`[reminder_fire] saveChat error ${reminderId}:`, e.message);
  }

  if (claimed.length > 1) {
    console.log(`[reminder_fire] fired ${claimed.length} merged via ${source}: ${claimed.map(x => x.content).join(" / ")}`);
  } else {
    console.log(`[reminder_fire] fired ${reminderId} via ${source}: ${main.content}`);
  }
  return {
    ok: true,
    fired: true,
    reminder_id: reminderId,
    merged_count: claimed.length,
    merged_ids: claimed.map(x => x.id),
  };
}
