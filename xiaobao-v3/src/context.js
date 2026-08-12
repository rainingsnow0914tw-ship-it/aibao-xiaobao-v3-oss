import { PERSONA } from "./persona.js";
import { getGroupSummary, getRecentChat, listUserProfiles, getUserProfile, listMemoryItems } from "./memory.js";

const ZH_WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];

function nowTaipeiString() {
  const now = new Date();
  const tp = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  const yr = tp.getUTCFullYear();
  const mo = String(tp.getUTCMonth() + 1).padStart(2, "0");
  const dy = String(tp.getUTCDate()).padStart(2, "0");
  const hr = String(tp.getUTCHours()).padStart(2, "0");
  const mn = String(tp.getUTCMinutes()).padStart(2, "0");
  const zhWeek = ZH_WEEKDAYS[tp.getUTCDay()];
  const iso = tp.toISOString().replace("Z", "+08:00");
  return `${yr}-${mo}-${dy} ${hr}:${mn} 星期${zhWeek} Asia/Taipei\nISO 8601: ${iso}`;
}

function formatProfile(profile) {
  const nickname = profile.nickname || "家人";
  const parts = [];
  if (profile.manual_notes) parts.push(profile.manual_notes);
  if (profile.ai_notes) parts.push(profile.ai_notes);
  const body = parts.join("\n\n") || "（尚無個人化資料）";
  return `【關於 ${nickname} 的長期印象】\n${body}`;
}

function formatRecentChat(history) {
  if (!history || history.length === 0) return "";
  const lines = history.map(h => {
    const who = h.role === "bot" ? "小寶" : (h.nickname || "家人");
    const text = (h.text || "").replace(/\n/g, " ");
    return `${who}: ${text}`;
  });
  return `【最近對話】\n${lines.join("\n")}`;
}

function memoryStamp(ts) {
  const ms = ts?.toMillis?.() || (ts?._seconds ? ts._seconds * 1000 : 0);
  if (!ms) return "";
  const tp = new Date(ms + 8 * 60 * 60 * 1000);
  const mo = String(tp.getUTCMonth() + 1).padStart(2, "0");
  const dy = String(tp.getUTCDate()).padStart(2, "0");
  const hr = String(tp.getUTCHours()).padStart(2, "0");
  const mn = String(tp.getUTCMinutes()).padStart(2, "0");
  return `${tp.getUTCFullYear()}-${mo}-${dy} ${hr}:${mn}`;
}

function formatMemoryNotes(items) {
  if (!items || items.length === 0) return "";
  const byAbout = new Map();
  for (const it of items) {
    const who = it.about || "未指定";
    if (!byAbout.has(who)) byAbout.set(who, []);
    byAbout.get(who).push(it);
  }
  const lines = [];
  for (const [who, list] of byAbout) {
    lines.push(`◆ ${who}`);
    for (const it of list) {
      const when = memoryStamp(it.createdAt);
      const by = (it.createdByNickname && it.createdByNickname !== it.about)
        ? ` — ${it.createdByNickname} 說的`
        : "";
      lines.push(`  [${it.id}]（${it.category || "其他"}${when ? "・記於 " + when : ""}）${it.text}${by}`);
    }
  }
  return `【小本本 · 用戶明確要我記住的事】\n${lines.join("\n")}\n` +
    `（永久記憶、優先度高於一般聊天印象。「記於」是寫進小本本的時間、日後有人翻舊帳時可以拿來作證。要刪掉某條時用 forget tool 帶上中括號裡的 id。）`;
}

async function timed(label, p) {
  const s = Date.now();
  try {
    return await p;
  } finally {
    console.log(`[ctx] ${label} ${Date.now() - s}ms`);
  }
}

export async function buildSystemInstruction({ convKey, groupId, userId }) {
  const [groupSummary, profiles, singleProfile, recent, memoryItems] = await Promise.all([
    groupId ? timed("groupSummary", getGroupSummary(groupId)) : Promise.resolve(""),
    groupId ? timed("profiles", listUserProfiles(groupId)) : Promise.resolve([]),
    !groupId && userId ? timed("singleProfile", getUserProfile(userId)) : Promise.resolve(null),
    timed("recentChat", getRecentChat(convKey, 20)),
    timed("memoryItems", listMemoryItems(convKey)),
  ]);

  const parts = [PERSONA, `【現在時間】\n${nowTaipeiString()}`];

  if (groupSummary) {
    parts.push(`【關於這個群最近的綜合印象】\n${groupSummary}`);
  }

  const finalProfiles = profiles.length > 0 ? profiles : (singleProfile ? [singleProfile] : []);
  for (const profile of finalProfiles) {
    parts.push(formatProfile(profile));
  }

  const memoryBlock = formatMemoryNotes(memoryItems);
  if (memoryBlock) parts.push(memoryBlock);

  const chatBlock = formatRecentChat(recent);
  if (chatBlock) parts.push(chatBlock);

  return parts.join("\n\n");
}
