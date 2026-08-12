import { getAccessToken } from "./gcp-auth.js";
import { config } from "./config.js";

// Cloud Tasks 排程上限是 30 天；超過的提醒交給每小時的 safety-net tick 補
const MAX_SCHEDULE_DAYS = 30;
const TIMEOUT_MS = 10_000;

function queuePath() {
  return `projects/${config.vertexProject}/locations/${config.tasksLocation}/queues/${config.tasksQueue}`;
}

export function canSchedule(fireAt) {
  if (!config.serviceUrl) return { ok: false, reason: "SERVICE_URL not set" };
  const ms = new Date(fireAt).getTime() - Date.now();
  if (!Number.isFinite(ms)) return { ok: false, reason: "invalid fireAt" };
  if (ms > MAX_SCHEDULE_DAYS * 24 * 3600 * 1000) {
    return { ok: false, reason: `more than ${MAX_SCHEDULE_DAYS} days ahead` };
  }
  return { ok: true };
}

// 排一個「時間到就打 /reminder-fire」的 task。
// 回 taskName（可用來取消）或 null（失敗時不 throw：Firestore doc 已寫進去、
// 每小時的 safety-net tick 還是會補發，不該讓整個 set_reminder 失敗）
export async function scheduleReminderTask({ reminderId, fireAt }) {
  const gate = canSchedule(fireAt);
  if (!gate.ok) {
    console.warn(`[cloudtasks] skip schedule ${reminderId}: ${gate.reason}`);
    return null;
  }

  let token;
  try {
    token = await getAccessToken();
  } catch (e) {
    console.warn(`[cloudtasks] no token: ${e.message}`);
    return null;
  }
  if (!token) return null;

  const payload = Buffer.from(JSON.stringify({ reminderId })).toString("base64");
  const body = {
    task: {
      scheduleTime: new Date(fireAt).toISOString(),
      httpRequest: {
        httpMethod: "POST",
        url: `${config.serviceUrl}/reminder-fire`,
        headers: {
          "content-type": "application/json",
          "x-scheduler-secret": config.schedulerSecret,
        },
        body: payload,
      },
    },
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(
      `https://cloudtasks.googleapis.com/v2/${queuePath()}/tasks`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      },
    );
    if (!response.ok) {
      const errText = (await response.text()).slice(0, 300);
      console.warn(`[cloudtasks] create ${response.status}: ${errText}`);
      return null;
    }
    const data = await response.json();
    console.log(`[cloudtasks] scheduled ${reminderId} at ${new Date(fireAt).toISOString()} -> ${data.name?.split("/").pop()}`);
    return data.name || null;
  } catch (e) {
    console.warn(`[cloudtasks] create error: ${e.message}`);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// 取消已排的 task（提醒被刪改時用）。失敗不 throw——
// 就算 task 還在，/reminder-fire 也會因為 status 不是 pending 而 skip
export async function cancelReminderTask(taskName) {
  if (!taskName) return false;
  let token;
  try {
    token = await getAccessToken();
  } catch {
    return false;
  }
  if (!token) return false;

  try {
    const response = await fetch(`https://cloudtasks.googleapis.com/v2/${taskName}`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${token}` },
    });
    if (!response.ok && response.status !== 404) {
      console.warn(`[cloudtasks] delete ${response.status}`);
      return false;
    }
    return true;
  } catch (e) {
    console.warn(`[cloudtasks] delete error: ${e.message}`);
    return false;
  }
}
