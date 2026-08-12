import { db, FieldValue } from "../firestore.js";
import { scheduleReminderTask } from "../cloudtasks.js";

export async function executeSetReminder(args, ctx) {
  const fireTimeIso = args?.fire_time_iso || "";
  const content = args?.content || "";

  if (!fireTimeIso || !content) {
    return { status: "error", error: "missing fire_time_iso or content" };
  }

  const fireDt = new Date(fireTimeIso);
  if (isNaN(fireDt.getTime())) {
    return { status: "error", error: `invalid fire_time_iso: ${fireTimeIso}` };
  }

  const now = new Date();
  if (fireDt.getTime() < now.getTime() - 60_000) {
    return { status: "error", error: "fire_time already in the past" };
  }

  try {
    const ref = await db().collection("reminders").add({
      userId: ctx.userId || "",
      groupId: ctx.groupId || "",
      nickname: ctx.nickname || "",
      content,
      fireAt: fireDt,
      fireTimeIso,
      status: "pending",
      createdAt: FieldValue.serverTimestamp(),
    });
    // 排一個精準的 Cloud Task。失敗也不擋——每小時的 safety-net tick 會補發
    const taskName = await scheduleReminderTask({ reminderId: ref.id, fireAt: fireDt });
    if (taskName) {
      try {
        await ref.update({ taskName });
      } catch (e) {
        console.warn("[tool.set_reminder] save taskName failed:", e.message);
      }
    }

    return {
      status: "success",
      reminder_id: ref.id,
      fire_time_iso: fireTimeIso,
      content,
      scheduled: Boolean(taskName),
    };
  } catch (e) {
    console.error("[tool.set_reminder] error:", e.message);
    return { status: "error", error: e.message };
  }
}
