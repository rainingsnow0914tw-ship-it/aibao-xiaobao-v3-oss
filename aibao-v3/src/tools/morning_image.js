import { executeGenerateImage } from "./generate_image.js";
import { db } from "../firestore.js";

const THEMES = [
  "一朵盛開的粉玫瑰、帶著晨露",
  "一朵盛開的紫玫瑰、花瓣層次分明",
  "一朵盛開的白色蓮花、水面倒影",
  "一朵盛開的向日葵、金黃燦爛",
  "一大片薰衣草田、紫色花海",
  "一枝盛開的櫻花、粉白花瓣飄落",
  "一朵鮮豔的紫藤花垂掛、串串成簇",
  "幾朵嬌嫩的鬱金香、紅粉相間",
  "一枝優雅的白色山茶、綠葉襯托",
  "一叢粉嫩的繡球花、圓潤飽滿",
  "海邊清晨日出、金色天光鋪滿海面",
  "山中晨霧繚繞、松林隱約可見",
  "湖邊木屋清晨、湖面平靜倒影",
  "櫻花大道、粉色花瓣拱門",
  "金黃色油菜花田、遠山襯托",
  "秋天的楓葉林、紅葉滿地",
  "陽台盆栽晨光、幾盆綠意",
  "木桌上的一杯熱茶、旁邊幾片綠葉",
  "窗邊插著鮮花的花瓶、晨光灑進",
  "溫暖的早餐桌、麵包咖啡水果",
  "書桌上翻開的書、旁邊一杯咖啡",
  "一隻可愛的白色小貓、蜷曲午睡姿態",
  "一隻可愛的白兔、坐在草地上",
  "一對小鳥停在櫻花枝上、粉花襯托",
  "幾隻彩色蝴蝶飛舞、繞著鮮花",
];

const STYLES = [
  "水彩畫、筆觸柔和",
  "油畫、色彩飽滿",
  "粉彩畫、朦朧夢幻",
  "中國水墨畫、意境深遠",
  "日式和風插畫、細膩柔美",
  "溫馨手繪風、線條簡潔",
  "寫實攝影風格、光影細膩",
  "印象派、光影變化",
];

const BLESSINGS = [
  "早安",
  "早安 平安喜樂",
  "早安 新的一天",
  "早安 願您好心情",
  "早安 願今天充滿溫暖",
  "早安 願您平安順心",
  "晨光美好 早安",
  "喜樂平安 早安",
  "早安 今天也要好好的",
  "早安 願您有美好一天",
  "早安 新的一天新希望",
  "早安 願您健康快樂",
];

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function taipeiTodayKey() {
  const tp = new Date(Date.now() + 8 * 60 * 60 * 1000);
  const yr = tp.getUTCFullYear();
  const mo = String(tp.getUTCMonth() + 1).padStart(2, "0");
  const dy = String(tp.getUTCDate()).padStart(2, "0");
  return `${yr}${mo}${dy}`;
}

async function readImageOverride(key) {
  try {
    const snap = await db().collection("morning_topic_override").doc(key).get();
    return snap.exists ? (snap.data().image_prompt || "") : "";
  } catch (e) {
    console.warn("[morning_image] override read error:", e.message);
    return "";
  }
}

export async function generateMorningImage() {
  const key = taipeiTodayKey();
  const override = await readImageOverride(key);

  let prompt;
  if (override) {
    prompt = override;
    console.log(`[morning_image] using override prompt="${prompt.slice(0, 80)}"`);
  } else {
    const theme = pick(THEMES);
    const style = pick(STYLES);
    const blessing = pick(BLESSINGS);
    prompt = `一張傳統華人長輩喜歡的 LINE 早安祝福圖：畫面主體是「${theme}」、風格「${style}」、柔和的晨光、溫馨明亮、色彩優雅乾淨。` +
      `畫面上方或下方要有一行清晰、優雅、易讀的繁體中文祝福文字：「${blessing}」。` +
      `字體要溫馨手寫或書法感、字色與背景對比清楚、位置不擋住主體。` +
      `不要加 logo、不要加日期、不要加任何其他中英文字或符號、只要祝福那一句話。`;
    console.log(`[morning_image] theme="${theme}" style="${style}" blessing="${blessing}"`);
  }

  const result = await executeGenerateImage({ prompt });
  if (result.status !== "success" || !result.image_url) {
    console.warn(`[morning_image] gen failed: ${result.error || "no image"}`);
    return null;
  }
  console.log(`[morning_image] OK model=${result.model_used} url=${result.image_url}`);
  return { url: result.image_url, prompt };
}
