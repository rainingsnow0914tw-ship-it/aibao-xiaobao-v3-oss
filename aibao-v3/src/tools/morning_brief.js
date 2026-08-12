import { generateChat } from "../vertex.js";
import { db, FieldValue } from "../firestore.js";
import { listUserProfiles } from "../memory.js";
import { PERSONA } from "../persona.js";
import { config } from "../config.js";

// 2026-07-29 一度改成航運股（阿姨要求）、2026-07-31 改回科技產業教育向（阿姨不喜歡航運）
const TOPIC_POOL = [
  "半導體代工與封測",
  "資料中心與雲端服務",
  "AI 硬體與晶片設計",
  "軟體與 SaaS",
  "消費電子與硬體終端",
  "電動車與自駕",
  "生醫科技與醫療器材",
  "太空與衛星",
  "資訊安全",
  "金融科技與支付",
];

const ZH_WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];

function taipeiNow() {
  return new Date(Date.now() + 8 * 60 * 60 * 1000);
}

function todayKeyTaipei() {
  const tp = taipeiNow();
  const yr = tp.getUTCFullYear();
  const mo = String(tp.getUTCMonth() + 1).padStart(2, "0");
  const dy = String(tp.getUTCDate()).padStart(2, "0");
  return `${yr}${mo}${dy}`;
}

function todayDescTaipei() {
  const tp = taipeiNow();
  const yr = tp.getUTCFullYear();
  const mo = tp.getUTCMonth() + 1;
  const dy = tp.getUTCDate();
  const zhWeek = ZH_WEEKDAYS[tp.getUTCDay()];
  return `${yr}年${mo}月${dy}日星期${zhWeek}`;
}

function weekdayTaipei() {
  return taipeiNow().getUTCDay();
}

function styleByWeekday(day) {
  return (day === 1 || day === 3 || day === 5) ? "B" : "A";
}

async function readOverride(key) {
  try {
    const snap = await db().collection("morning_topic_override").doc(key).get();
    return snap.exists ? snap.data() : null;
  } catch (e) {
    console.warn("[morning_brief] override read error:", e.message);
    return null;
  }
}

async function readCache(key) {
  try {
    const snap = await db().collection("morning_brief_cache").doc(key).get();
    return snap.exists ? (snap.data().text || "") : "";
  } catch (e) {
    console.warn("[morning_brief] cache read error:", e.message);
    return "";
  }
}

async function writeCache(key, text, meta) {
  try {
    await db().collection("morning_brief_cache").doc(key).set({
      text,
      ...meta,
      createdAt: FieldValue.serverTimestamp(),
    });
  } catch (e) {
    console.warn("[morning_brief] cache write error:", e.message);
  }
}

function buildPromptA(topic, dateDesc, nicknameList) {
  return `產出今日早報、push 到「家人群」三人 LINE 群。三位家人的 nickname 是：${nicknameList}。
今天是 ${dateDesc}。今日科技主題：${topic}。

輸出格式（長度 220-320 字）：

開場（1 句）：用三人 nickname 打招呼（例：「阿哲、Chloe、阿姨早安 🌞」）、**不要**用「大家早安」「各位家人」

一、天氣（1-3 句）
**用 Google Search 查詢今天 ${config.weatherRegion} 地區的實際天氣預報**（以家人所在地區為主），包含：
- 溫度範圍
- 降雨機率
- 空氣品質（AQI 或 PM2.5）
用白話組合、例：「今天白天最高 34 度、下午雷陣雨機率高、AQI 105 對敏感族群不太好、出門記得帶把傘跟口罩」
**不知道就講不知道、不要編數字**

二、今日科技小知識（不點名特定公司、只講「${topic}」這個領域的概念）
- 一個概念白話定義
- 一個生活比喻讓阿姨感受得到
- 為什麼跟一般人有關

三、近期科技動態（1 則、可提公司名 + 股票代號當參考、多元不集中同一批公司）
例：「這禮拜有一家 XX 公司（股票代號 YYYY）在做 ...、對 aa 用途有幫助」。
只提「一家」公司、下次早報換不同的、輪替。

結尾（1-2 句）：分別關心三人、用他們的 nickname（例：「阿哲路上小心、Chloe 上班順利、阿姨今天愉快」）、**不加「大哥/大姐/先生/小姐」**

守則：
- 適量用 emoji 加溫度（🌞 ☕ 🌸 🌿 之類、每段 1-2 個、不放句首、不 hype）
- 不要用「爆漲」「必買」「錯過就沒了」「All in」這類 hype 語
- 不要每天緊咬台積電/黃仁勳這種特定人物或公司敘事、要多元
- 近期動態可以用 Google Search 查證後再寫。**查不到就講你確定的產業知識、不要編新聞也不要編數字**`;
}

function buildPromptB(topic, dateDesc, nicknameList) {
  return `產出今日早報、push 到「家人群」三人 LINE 群。三位家人的 nickname 是：${nicknameList}。
今天是 ${dateDesc}。今日科技主題：${topic}（深度日格式）。

輸出格式（長度 280-380 字）：

開場（1 句）：用三人 nickname 打招呼、**不要**用「大家早安」「各位家人」

一、天氣（1-3 句）
**用 Google Search 查詢今天 ${config.weatherRegion} 地區的實際天氣預報**（以家人所在地區為主）、含溫度範圍、降雨機率、空氣品質（AQI/PM2.5）。
用白話組合、給生活建議（出門帶傘、戴口罩、開清淨機）。**不知道就講不知道、不要編數字**

二、今日主題深度：${topic}
- 帶入 2-3 家不同國家或不同角色的公司（例：一家美國、一家台灣、一家日本、或大公司對比新創）+ 股票代號當參考
- 說明各自在這個產業扮演什麼角色（不是「誰厲害誰不厲害」的排名、是分工的角度）
- 舉一個生活層面的例子讓阿姨感受得到

結尾（1-2 句）：分別關心三人、用他們的 nickname（**不加「大哥/大姐/先生/小姐」**）

守則：
- 適量用 emoji 加溫度（🌞 ☕ 🌸 🌿 之類、每段 1-2 個、不放句首、不 hype）
- 不要用 hype 語（「爆漲」「必買」「錯過」「All in」）
- 不要每天緊咬同一批公司、產業要多元
- 產業動態可以用 Google Search 查證後再寫。**查不到就講你確定的產業知識、不要編實時事件也不要編數字**`;
}

export async function generateMorningBrief({ force = false, topic: forcedTopic, style: forcedStyle } = {}) {
  const key = todayKeyTaipei();

  if (!force) {
    const cached = await readCache(key);
    if (cached) return { status: "success", text: cached, cache_hit: true };
  }

  const override = await readOverride(key);
  const topic = forcedTopic || override?.topic || TOPIC_POOL[Math.floor(Math.random() * TOPIC_POOL.length)];
  const style = forcedStyle || override?.style || styleByWeekday(weekdayTaipei());
  const dateDesc = todayDescTaipei();

  const profiles = await listUserProfiles(config.lineGroupId);
  const nicknameList = profiles.map(p => p.nickname).filter(n => n && n !== "家人").join("、") || "阿哲、Chloe、阿姨";

  const prompt = style === "B" ? buildPromptB(topic, dateDesc, nicknameList) : buildPromptA(topic, dateDesc, nicknameList);

  let text = "";
  let debugInfo = "";
  try {
    const result = await generateChat({
      systemInstruction: PERSONA +
        "\n\n【本次任務】現在你要產出的是每日早報、push 到三人群、不是回覆特定家人、直接輸出早報內容本身、不加「以下是早報」這種說明。" +
        "\n【資訊紀律】你有 Google Search 可以用、天氣和近期產業動態都可以查證後再寫。" +
        "查到什麼寫什麼、查不到就講你確定的產業知識、**絕對不可以憑印象編造數字、股價、營收或新聞事件**。",
      userParts: prompt,
      tools: [{ googleSearch: {} }],
      thinkingBudget: 128,
      maxOutputTokens: 2500,
      timeoutMs: 120_000,
    });
    text = (result.text || "").trim();
    debugInfo = `finish=${result.finishReason} thoughts=${result.raw?.usageMetadata?.thoughtsTokenCount || 0} out=${result.raw?.usageMetadata?.candidatesTokenCount || 0}`;
    console.log(`[morning_brief] topic=${topic} style=${style} ${debugInfo} textLen=${text.length}`);
  } catch (e) {
    console.error("[morning_brief] vertex error:", e.message);
    return { status: "error", error: e.message };
  }

  if (!text) {
    return { status: "error", error: `empty brief (${debugInfo})` };
  }

  await writeCache(key, text, { topic, style, dateDesc });
  return { status: "success", text, cache_hit: false, topic, style };
}

export async function executeGetMorningBrief(_args, _ctx) {
  return await generateMorningBrief({ force: false });
}
