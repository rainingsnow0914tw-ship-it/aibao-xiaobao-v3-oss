import { config } from "../config.js";
import { generateChat } from "../vertex.js";
import {
  listUserProfiles,
  getUserProfile,
  getRecentChatByConv,
  updateAiNotes,
  makeConvKey,
} from "../memory.js";

const MAX_AI_NOTES_CHARS = parseInt(process.env.MAX_AI_NOTES_CHARS || "2000", 10);

function formatChat(history, nickname) {
  return history.map(h => {
    const who = h.role === "bot" ? "小寶" : (h.nickname || nickname || "家人");
    return `${who}: ${(h.text || "").replace(/\n/g, " ")}`;
  }).join("\n");
}

async function refineOneUser(profile) {
  const userId = profile.userId;
  const nickname = profile.nickname || "家人";
  // ⚠️ 2026-08-06 第二層坑：xiaobao 是 1-on-1、convKey 一律 user_<userId>。
  // 舊 doc 的 group_id 是 v1.5 家族群殘留（C743ee87... / Ce6383a3...），
  // 若拿它算 convKey 會去查一個根本不存在的對話串、撈到空、然後靜默 skip。
  const convKey = makeConvKey({ userId });
  console.log(`[profile_cleanup] refine ${nickname} userId=${(userId || "").slice(0, 10)} convKey=${convKey.slice(0, 16)}`);

  const chat = await getRecentChatByConv(convKey, userId);
  if (chat.length === 0) {
    console.log(`[profile_cleanup] ${nickname} skip: no recent chat (24h)`);
    return { user: nickname, skipped: true, reason: "no recent chat" };
  }

  const chatText = formatChat(chat, nickname);
  const prompt = `更新對「${nickname}」的長期印象。

現有 manual_notes（人手填、你當背景參考、不改動）：
${profile.manual_notes || "（無）"}

現有 ai_notes（AI 累積的印象、你要更新這個）：
${profile.ai_notes || "（尚未累積）"}

最近 24 小時 ${nickname} 跟小寶的對話發言：
${chatText}

寫一份新 ai_notes、上限 ${MAX_AI_NOTES_CHARS} 字、要求：
- 整合舊 ai_notes + 新資訊、不重複、不冗長
- 涵蓋：個性、口氣、興趣、關心的話題、家庭背景（若透露）、已知偏好、忌諱、健康狀況（若透露）
- 隱私邊界：不記敏感財務數字、政治立場、性向、感情細節
- 用第三人稱敘事、不加標題、不加禮貌用語、不加 emoji
- 只輸出印象文字本身`;

  try {
    const result = await generateChat({
      systemInstruction: "你是印象整理助手、精簡準確、不冗長、不加禮貌用語。",
      userParts: prompt,
      thinkingBudget: 128,
      maxOutputTokens: Math.ceil(MAX_AI_NOTES_CHARS * 1.5),
    });
    const newNotes = (result.text || "").trim().slice(0, MAX_AI_NOTES_CHARS);
    if (!newNotes) {
      console.warn(`[profile_cleanup] ${nickname} empty refine output`);
      return { user: nickname, ok: false, reason: "empty refine output" };
    }
    const ok = await updateAiNotes(userId, newNotes);
    console.log(`[profile_cleanup] ${nickname} ${ok ? "OK" : "WRITE FAILED"} ${newNotes.length} chars (from ${chat.length} msgs)`);
    return { user: nickname, ok, chars: newNotes.length };
  } catch (e) {
    console.error(`[profile_cleanup] ${nickname} error:`, e.message);
    return { user: nickname, ok: false, error: e.message };
  }
}

export async function runProfileCleanupTick() {
  const t0 = Date.now();
  const groupId = config.lineGroupId;

  // xiaobao 1-on-1 主要：iterate 所有 user_index doc、每個 refine
  // aibao 群組模式：只 iterate 該群組的 doc
  let profiles;
  if (groupId) {
    profiles = await listUserProfiles(groupId);
  } else {
    profiles = await listAllUserProfiles();
  }

  console.log(`[profile_cleanup] start: ${profiles.length} profiles (groupId=${groupId || "none, 1-on-1 mode"})`);
  if (profiles.length === 0) {
    // 正常情況不該是 0 —— 若出現代表讀 user_index 有問題（例如欄位命名不合）
    console.warn("[profile_cleanup] ⚠️ 0 profiles、什麼都不會做、檢查 user_index 讀取邏輯");
  }

  const userResults = [];
  for (const p of profiles) {
    const r = await refineOneUser(p);
    userResults.push(r);
  }

  const refined = userResults.filter(r => r.ok).length;
  const skipped = userResults.filter(r => r.skipped).length;
  const failed = userResults.filter(r => r.ok === false).length;
  console.log(`[profile_cleanup] done: refined=${refined} skipped=${skipped} failed=${failed} ${Date.now() - t0}ms`);

  return {
    ok: true,
    profiles_found: profiles.length,
    refined,
    skipped,
    failed,
    users: userResults,
    took_ms: Date.now() - t0,
  };
}

// 🔴 2026-08-06 抓到的坑：舊 Python 版（v1.5）migrate 過來的 doc 用 snake_case
// （group_id / user_id / created_at），v3 是 Node.js 用 camelCase。
// 原本 `.filter(p => p.userId)` 把 14 筆全濾光 → profiles=[] → 每天 04:00 空轉、
// 回 HTTP 200 卻什麼都沒做，ai_notes 停在 5/14 快三個月沒人發現。
// 讀取一律走這個 normalize，兩種命名都吃。
function normalizeProfile(doc) {
  const d = doc.data() || {};
  const rawId = doc.id;
  // userId 優先序：camelCase 欄位 → snake_case 欄位 → doc id（去掉 v1.5 的 user_ 前綴）
  const userId =
    d.userId ||
    d.user_id ||
    (rawId.startsWith("user_") ? rawId.slice(5) : rawId);
  return {
    ...d,
    userId,
    groupId: d.groupId || d.group_id || "",
  };
}

async function listAllUserProfiles() {
  const { db } = await import("../firestore.js");
  try {
    const snap = await db().collection("user_index").limit(500).get();
    const seen = new Set();
    const out = [];
    for (const doc of snap.docs) {
      const p = normalizeProfile(doc);
      if (!p.userId || p.userId === "bot") continue;
      // v1.5 遺留的 user_XXX duplicate doc 會跟本尊撞同一個 userId、只 refine 一次
      if (seen.has(p.userId)) continue;
      seen.add(p.userId);
      out.push(p);
    }
    return out;
  } catch (e) {
    console.error("[profile_cleanup] listAll error:", e.message);
    return [];
  }
}
