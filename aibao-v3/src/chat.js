import { config } from "./config.js";
import { generateChat, functionResponsePart, inlineDataPart } from "./vertex.js";
import { buildSystemInstruction } from "./context.js";
import { saveChat, ensureUserIndex, getUserProfile } from "./memory.js";
import { VERTEX_TOOLS, dispatchTool } from "./tools/index.js";
import { downloadLineContent, makeImageMessage } from "./line.js";

async function tryGetDisplayName(userId, groupId) {
  if (!userId || !groupId || !config.lineToken) return "";
  try {
    const response = await fetch(
      `https://api.line.me/v2/bot/group/${groupId}/member/${userId}`,
      { headers: { authorization: `Bearer ${config.lineToken}` } },
    );
    if (!response.ok) return "";
    const data = await response.json();
    return data.displayName || "";
  } catch (e) {
    console.warn("[chat.tryGetDisplayName] error:", e.message);
    return "";
  }
}

function ms(t0) { return `${Date.now() - t0}ms`; }

// LINE event.timestamp（毫秒 epoch）→ 台北 HH:MM:SS，給大腦看「這句是幾點傳的」
function taipeiClock(epochMs) {
  if (typeof epochMs !== "number" || !epochMs) return "";
  const tp = new Date(epochMs + 8 * 60 * 60 * 1000);
  const hh = String(tp.getUTCHours()).padStart(2, "0");
  const mm = String(tp.getUTCMinutes()).padStart(2, "0");
  const ss = String(tp.getUTCSeconds()).padStart(2, "0");
  return ` · ${hh}:${mm}:${ss}`;
}

const YOUTUBE_URL_REGEX = /https?:\/\/(?:www\.|m\.)?(?:youtube\.com\/(?:watch\?v=[\w-]+|shorts\/[\w-]+|live\/[\w-]+)|youtu\.be\/[\w-]+)[^\s]*/gi;

function extractYoutubeUrls(text) {
  const matches = String(text || "").match(YOUTUBE_URL_REGEX);
  return matches ? [...new Set(matches)] : [];
}

// 大腦看不到內容的連結。偵測到就注入硬提示，防止它假裝看過、或把「不支援」講成「故障」
const UNSUPPORTED_URL_PATTERNS = [
  [/(?:vt\.|vm\.)?tiktok\.com/i, "TikTok"],
  [/instagram\.com/i, "Instagram"],
  [/(?:facebook\.com|fb\.watch)/i, "Facebook"],
  [/drive\.google\.com/i, "Google 雲端硬碟"],
  [/share\.google/i, "Google 分享短網址"],
  [/(?:^|\/\/|\.)x\.com|twitter\.com/i, "X（Twitter）"],
];

function detectUnsupportedUrls(text) {
  const s = String(text || "");
  const hits = [];
  for (const [re, name] of UNSUPPORTED_URL_PATTERNS) {
    if (re.test(s)) hits.push(name);
  }
  return [...new Set(hits)];
}

async function buildUserParts(event, nickname, clock = "") {
  const msg = event.message || {};
  const mtype = msg.type;

  if (mtype === "text") {
    const text = msg.text || "";
    const parts = [];
    const ytUrls = extractYoutubeUrls(text);
    for (const url of ytUrls) {
      parts.push({ file_data: { file_uri: url, mime_type: "video/mp4" } });
    }
    parts.push({ text: `[${nickname}${clock}] ${text}` });

    const blocked = detectUnsupportedUrls(text);
    if (blocked.length > 0 && ytUrls.length === 0) {
      console.log(`[chat] unsupported link detected: ${blocked.join("/")}`);
      parts.push({
        text:
          `[系統提示] 家人貼的是 ${blocked.join("、")} 連結。` +
          `**你打不開這種連結、看不到裡面任何內容**。` +
          `請誠實說你看不到、不要假裝看過、不要編裡面有什麼、就算家人描述了細節也不要改口說「看到了」。` +
          `這是你本來就不支援的格式、**不是系統故障、不要叫技術員去檢查線路**。` +
          `可以請家人改用截圖或 YouTube 網址。`,
      });
    }

    return {
      parts,
      logText: text,
      msgTypeForHistory: "text",
    };
  }

  if (["image", "video", "audio"].includes(mtype)) {
    const content = await downloadLineContent(msg.id);
    if (!content) {
      return null;
    }
    const base64 = content.bytes.toString("base64");
    const label = mtype === "image" ? "圖片" : mtype === "video" ? "影片" : "語音";
    return {
      parts: [
        inlineDataPart(base64, content.mime),
        { text: `[${nickname}${clock}] （傳了一個${label}、看看內容並回應）` },
      ],
      logText: `${mtype}:${msg.id}`,
      msgTypeForHistory: mtype,
    };
  }

  if (mtype === "file") {
    const content = await downloadLineContent(msg.id);
    if (!content) return null;
    const fileName = msg.fileName || "file";
    const mime = content.mime || "application/octet-stream";
    const base64 = content.bytes.toString("base64");
    return {
      parts: [
        inlineDataPart(base64, mime),
        { text: `[${nickname}${clock}] （傳了一個檔案「${fileName}」、mime=${mime}、看看內容並回應。若你看不懂這種檔案格式、請誠實跟家人說「這個格式我還沒法看、可以請你轉成 PDF 或截圖給我嗎」）` },
      ],
      logText: `file:${fileName}`,
      msgTypeForHistory: "file",
    };
  }

  return null;
}

export async function handleChat(eventsInput) {
  const events = Array.isArray(eventsInput) ? eventsInput : [eventsInput];
  if (events.length === 0) return null;

  const primary = events[0];
  const source = primary.source || {};
  const groupId = source.groupId || "";
  const userId = source.userId || "";

  const t0 = Date.now();
  let t = t0;

  let profile = await getUserProfile(userId);
  console.log(`[chat] getUserProfile ${ms(t)}`); t = Date.now();

  if (!profile) {
    const displayName = await tryGetDisplayName(userId, groupId);
    console.log(`[chat] tryGetDisplayName ${ms(t)}`); t = Date.now();
    profile = await ensureUserIndex({ userId, groupId, displayName });
    console.log(`[chat] ensureUserIndex(bootstrap) ${ms(t)}`); t = Date.now();
  }

  const nickname = (profile && profile.nickname) || "家人";

  const perEventTurns = [];
  const combinedParts = [];
  for (const ev of events) {
    try {
      const turn = await buildUserParts(ev, nickname, taipeiClock(ev.timestamp));
      if (turn) {
        combinedParts.push(...turn.parts);
        perEventTurns.push({ turn, ev });
      }
    } catch (e) {
      console.error(`[chat] buildUserParts skip 1 event: ${e.message}`);
    }
  }
  if (combinedParts.length === 0) return null;

  const combinedLogText = perEventTurns.map(x => x.turn.logText).join(" | ");
  console.log(`[chat] received batch=${events.length}/${perEventTurns.length} parts=${combinedParts.length}: ${JSON.stringify(combinedLogText).slice(0, 200)}`);

  const [_saved, systemInstruction] = await Promise.all([
    Promise.all(perEventTurns.map(({ turn, ev }) => saveChat({
      groupId,
      userId,
      nickname,
      text: turn.logText,
      role: "user",
      msgType: turn.msgTypeForHistory,
      sentAt: typeof ev.timestamp === "number" ? new Date(ev.timestamp) : null,
      lagMs: typeof ev.timestamp === "number" ? Date.now() - ev.timestamp : null,
    }))),
    buildSystemInstruction({ groupId }),
  ]);
  console.log(`[chat] saveChat+buildSystem parallel ${ms(t)}`); t = Date.now();

  const userContents = [{ role: "user", parts: combinedParts }];

  const result1 = await generateChat({
    systemInstruction,
    contents: userContents,
    tools: [...VERTEX_TOOLS, { googleSearch: {} }],
    model: config.vertexChatModel,
  });
  console.log(`[chat] generateChat #1 ${ms(t)} (thoughts=${result1.raw?.usageMetadata?.thoughtsTokenCount || 0}, out=${result1.raw?.usageMetadata?.candidatesTokenCount || 0}, fnCalls=${result1.functionCalls.length}, finish=${result1.finishReason})`); t = Date.now();

  let finalText = (result1.text || "").trim();
  const attachments = [];

  if (result1.functionCalls.length > 0 && result1.modelContent) {
    const ctx = { userId, groupId, nickname };
    const responseParts = [];

    for (const fc of result1.functionCalls) {
      const toolResult = await dispatchTool(fc.name, fc.args || {}, ctx);
      console.log(`[chat] tool ${fc.name} -> ${toolResult.status}${toolResult.error ? " err=" + toolResult.error.slice(0, 200) : ""}`);

      if (toolResult.image_urls && Array.isArray(toolResult.image_urls)) {
        for (const u of toolResult.image_urls) {
          attachments.push(makeImageMessage(u));
        }
      } else if (toolResult.image_url) {
        attachments.push(makeImageMessage(toolResult.image_url));
      }

      responseParts.push(functionResponsePart(fc.name, toolResult));
    }

    const followupContents = [
      ...userContents,
      result1.modelContent,
      { role: "user", parts: responseParts },
    ];

    const result2 = await generateChat({
      systemInstruction,
      contents: followupContents,
      tools: [...VERTEX_TOOLS, { googleSearch: {} }],
      model: config.vertexChatModel,
    });
    console.log(`[chat] generateChat #2 ${ms(t)} (thoughts=${result2.raw?.usageMetadata?.thoughtsTokenCount || 0}, out=${result2.raw?.usageMetadata?.candidatesTokenCount || 0})`); t = Date.now();

    finalText = (result2.text || "").trim() || finalText;
  }

  if (!finalText && attachments.length === 0) {
    console.log(`[chat] TOTAL ${ms(t0)} (empty reply)`);
    return null;
  }

  const attachTag = attachments.length > 0
    ? `【附件】${attachments.map(a => a.originalContentUrl).filter(Boolean).join(" | ")}`
    : "";
  const savedText = [finalText, attachTag].filter(Boolean).join(" ") || `(${attachments.length} attachment)`;
  await saveChat({
    groupId,
    userId: "bot",
    nickname: "阿寶",
    text: savedText,
    role: "bot",
  });
  console.log(`[chat] TOTAL ${ms(t0)} (text=${finalText.length}chars, attachments=${attachments.length})`);

  if (attachments.length > 0) {
    const messages = [];
    if (finalText) messages.push({ type: "text", text: finalText });
    messages.push(...attachments);
    return messages.slice(0, 5);
  }
  return finalText;
}
