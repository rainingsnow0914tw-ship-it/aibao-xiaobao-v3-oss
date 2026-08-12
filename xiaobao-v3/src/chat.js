import { config } from "./config.js";
import { generateChat, functionResponsePart, inlineDataPart } from "./vertex.js";
import { buildSystemInstruction } from "./context.js";
import { saveChat, ensureUserIndex, getUserProfile, makeConvKey } from "./memory.js";
import { VERTEX_TOOLS, dispatchTool } from "./tools/index.js";
import { downloadLineContent, makeImageMessage, makeAudioMessage } from "./line.js";
import { generateTts } from "./tools/generate_tts.js";

const AUTO_TTS_ENABLED = (process.env.AUTO_TTS_ENABLED || "true").toLowerCase() !== "false";
const AUTO_TTS_MAX_CHARS = parseInt(process.env.AUTO_TTS_MAX_CHARS || "600", 10);

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

const MIME_BY_EXT = {
  pdf: "application/pdf",
  txt: "text/plain",
  csv: "text/csv",
  md: "text/markdown",
  html: "text/html",
  htm: "text/html",
  json: "application/json",
  xml: "application/xml",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  doc: "application/msword",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  xls: "application/vnd.ms-excel",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ppt: "application/vnd.ms-powerpoint",
  odt: "application/vnd.oasis.opendocument.text",
  ods: "application/vnd.oasis.opendocument.spreadsheet",
  odp: "application/vnd.oasis.opendocument.presentation",
};

function guessMimeFromName(name) {
  const m = /\.([a-z0-9]+)$/i.exec(String(name || ""));
  if (!m) return "application/octet-stream";
  return MIME_BY_EXT[m[1].toLowerCase()] || "application/octet-stream";
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

const MEDIA_MODEL = process.env.MEDIA_MODEL || "gemini-3.5-flash";
const MEDIA_LOCATION = process.env.MEDIA_LOCATION || "global";

function detectMediaMode(event) {
  const msg = event.message || {};
  const mtype = msg.type;
  // Flash for uploaded media bytes (image/video/audio/file) — output 深度好
  if (["image", "video", "audio", "file"].includes(mtype)) return true;
  // YouTube URL 保留 Pro (Flash 不支援 fileData + fileUri YouTube)
  return false;
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
          `[系統提示] 對方貼的是 ${blocked.join("、")} 連結。` +
          `**你打不開這種連結、看不到裡面任何內容**。` +
          `請誠實說你看不到、不要假裝看過、不要編裡面有什麼、就算對方描述了細節也不要改口說「看到了」。` +
          `這是你本來就不支援的格式、**不是系統故障、不要說要請技術員檢查**。` +
          `可以請對方改用截圖或 YouTube 網址。`,
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
    const fileName = msg.fileName || "file";
    const fileSize = msg.fileSize || 0;
    const messageId = msg.id;

    // For text-native formats (PDF, plain text) go straight to native multimodal — cheaper than tool round-trip.
    const guessedMime = guessMimeFromName(fileName);
    const nativeOk = guessedMime === "application/pdf" || guessedMime.startsWith("text/");
    if (nativeOk) {
      const content = await downloadLineContent(messageId);
      if (!content) return null;
      const mime = content.mime || guessedMime;
      const base64 = content.bytes.toString("base64");
      return {
        parts: [
          inlineDataPart(base64, mime),
          { text: `[${nickname}${clock}] （傳了一個檔案「${fileName}」、mime=${mime}、看看內容並回應）` },
        ],
        logText: `file:${fileName}`,
        msgTypeForHistory: "file",
      };
    }

    // Office / OpenDocument / other: let the brain call read_document tool. Skip download here (tool fetches).
    console.log(`[chat] file needs tool mime=${guessedMime} name=${fileName} size=${fileSize} msgId=${messageId}`);
    return {
      parts: [
        {
          text:
            `[${nickname}${clock}] 傳了一個檔案。` +
            `[file] name=${fileName} mime=${guessedMime} size=${fileSize} messageId=${messageId}。` +
            `請 call read_document tool 讀取內容、tool 會回傳純文字、然後根據內容回應用戶。` +
            `messageId / mimeType / fileName 三個參數照上面原樣帶進 tool、不要自己編。`,
        },
      ],
      logText: `file:${fileName}(tool)`,
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
  const convKey = makeConvKey({ groupId, userId });

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
      convKey,
      groupId,
      userId,
      nickname,
      text: turn.logText,
      role: "user",
      msgType: turn.msgTypeForHistory,
      sentAt: typeof ev.timestamp === "number" ? new Date(ev.timestamp) : null,
      lagMs: typeof ev.timestamp === "number" ? Date.now() - ev.timestamp : null,
    }))),
    buildSystemInstruction({ convKey, groupId, userId }),
  ]);
  console.log(`[chat] saveChat+buildSystem parallel ${ms(t)}`); t = Date.now();

  const userContents = [{ role: "user", parts: combinedParts }];

  const mediaMode = events.some(ev => detectMediaMode(ev));
  const brainModel = mediaMode ? MEDIA_MODEL : config.vertexChatModel;
  console.log(`[chat] brain model=${brainModel} (mediaMode=${mediaMode})`);

  const result1 = await generateChat({
    systemInstruction,
    contents: userContents,
    tools: [...VERTEX_TOOLS, { googleSearch: {} }],
    model: brainModel,
  });
  console.log(`[chat] generateChat #1 ${ms(t)} (thoughts=${result1.raw?.usageMetadata?.thoughtsTokenCount || 0}, out=${result1.raw?.usageMetadata?.candidatesTokenCount || 0}, fnCalls=${result1.functionCalls.length}, finish=${result1.finishReason})`); t = Date.now();

  let finalText = (result1.text || "").trim();
  const attachments = [];

  if (result1.functionCalls.length > 0 && result1.modelContent) {
    const ctx = { userId, groupId, nickname, convKey };
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
      model: brainModel,
    });
    console.log(`[chat] generateChat #2 ${ms(t)} (thoughts=${result2.raw?.usageMetadata?.thoughtsTokenCount || 0}, out=${result2.raw?.usageMetadata?.candidatesTokenCount || 0})`); t = Date.now();

    finalText = (result2.text || "").trim() || finalText;
  }

  if (!finalText && attachments.length === 0) {
    console.log(`[chat] TOTAL ${ms(t0)} (empty reply)`);
    return null;
  }

  if (AUTO_TTS_ENABLED && finalText && finalText.length <= AUTO_TTS_MAX_CHARS) {
    try {
      const tts = await generateTts(finalText);
      if (tts) {
        attachments.push(makeAudioMessage(tts.url, tts.duration));
        console.log(`[chat] TTS ${ms(t)} dur=${tts.duration}ms`);
      }
    } catch (e) {
      console.warn("[chat] TTS error:", e.message);
    }
    t = Date.now();
  } else if (AUTO_TTS_ENABLED && finalText) {
    console.log(`[chat] TTS skipped: len=${finalText.length} > ${AUTO_TTS_MAX_CHARS}`);
  }

  const attachTag = attachments.length > 0
    ? `【附件】${attachments.map(a => a.originalContentUrl).filter(Boolean).join(" | ")}`
    : "";
  const savedText = [finalText, attachTag].filter(Boolean).join(" ") || `(${attachments.length} attachment)`;
  await saveChat({
    convKey,
    groupId,
    userId: "bot",
    nickname: "小寶",
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
