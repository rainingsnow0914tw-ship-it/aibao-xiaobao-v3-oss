import { config } from "../config.js";
import { generateChat } from "../vertex.js";
import {
  listUserProfiles,
  getRecentChatByUser,
  getRecentChatAll,
  getGroupSummary,
  updateAiNotes,
  upsertGroupSummary,
} from "../memory.js";

const MAX_AI_NOTES_CHARS = parseInt(process.env.MAX_AI_NOTES_CHARS || "2000", 10);
const MAX_GROUP_SUMMARY_CHARS = parseInt(process.env.MAX_GROUP_SUMMARY_CHARS || "600", 10);

function formatChat(history, nickname) {
  return history.map(h => {
    const who = h.role === "bot" ? "阿寶" : (h.nickname || nickname || "家人");
    return `${who}: ${(h.text || "").replace(/\n/g, " ")}`;
  }).join("\n");
}

async function refineOneUser(profile, groupId) {
  const userId = profile.userId;
  const nickname = profile.nickname || "家人";
  const chat = await getRecentChatByUser(groupId, userId);
  if (chat.length === 0) {
    return { user: nickname, skipped: true, reason: "no recent chat" };
  }

  const chatText = formatChat(chat, nickname);
  const prompt = `更新對「${nickname}」的長期印象。

現有 manual_notes（人手填、你當背景參考、不改動）：
${profile.manual_notes || "（無）"}

現有 ai_notes（AI 累積的印象、你要更新這個）：
${profile.ai_notes || "（尚未累積）"}

最近 24 小時 ${nickname} 在群組裡的發言：
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
    if (!newNotes) return { user: nickname, ok: false, reason: "empty refine output" };
    const ok = await updateAiNotes(userId, newNotes);
    return { user: nickname, ok, chars: newNotes.length };
  } catch (e) {
    return { user: nickname, ok: false, error: e.message };
  }
}

async function refineGroupSummary(groupId) {
  const chat = await getRecentChatAll(groupId);
  if (chat.length === 0) {
    return { skipped: true, reason: "no recent chat" };
  }

  const chatText = formatChat(chat);
  const oldSummary = await getGroupSummary(groupId);
  const prompt = `更新這個 LINE 群「家人群」的最近綜合印象。

現有印象：
${oldSummary || "（尚未累積）"}

近 24 小時群裡的發言：
${chatText}

寫一份新綜合印象、上限 ${MAX_GROUP_SUMMARY_CHARS} 字、要求：
- 家人間互動狀態（融洽 / 誰缺席 / 誰主動）
- 討論話題重心
- 未解決問題或約定
- 家人心情氛圍
- 不記個人敏感資訊
- 只輸出印象文字本身、不加標題、不加禮貌用語、不加 emoji`;

  try {
    const result = await generateChat({
      systemInstruction: "你是群組印象整理助手、精簡不冗長、不加禮貌用語。",
      userParts: prompt,
      thinkingBudget: 128,
      maxOutputTokens: Math.ceil(MAX_GROUP_SUMMARY_CHARS * 2),
    });
    const newSummary = (result.text || "").trim().slice(0, MAX_GROUP_SUMMARY_CHARS);
    if (!newSummary) return { ok: false, reason: "empty output" };
    const ok = await upsertGroupSummary(groupId, newSummary);
    return { ok, chars: newSummary.length };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

export async function runProfileCleanupTick() {
  const t0 = Date.now();
  const groupId = config.lineGroupId;
  if (!groupId) {
    return { ok: false, error: "LINE_GROUP_ID not set", took_ms: Date.now() - t0 };
  }

  const profiles = await listUserProfiles(groupId);
  const userResults = [];
  for (const p of profiles) {
    const r = await refineOneUser(p, groupId);
    userResults.push(r);
  }

  const groupResult = await refineGroupSummary(groupId);

  return {
    ok: true,
    users: userResults,
    group_summary: groupResult,
    took_ms: Date.now() - t0,
  };
}
