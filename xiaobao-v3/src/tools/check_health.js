import { getRecentChat } from "../memory.js";

const SAMPLE_LIMIT = parseInt(process.env.HEALTH_SAMPLE_LIMIT || "50", 10);

function taipeiStamp(d) {
  const ms = d?.toMillis?.() || (d instanceof Date ? d.getTime() : 0);
  if (!ms) return "";
  const tp = new Date(ms + 8 * 60 * 60 * 1000);
  const mo = String(tp.getUTCMonth() + 1).padStart(2, "0");
  const dy = String(tp.getUTCDate()).padStart(2, "0");
  const hh = String(tp.getUTCHours()).padStart(2, "0");
  const mm = String(tp.getUTCMinutes()).padStart(2, "0");
  const ss = String(tp.getUTCSeconds()).padStart(2, "0");
  return `${tp.getUTCFullYear()}-${mo}-${dy} ${hh}:${mm}:${ss}`;
}

export async function executeCheckHealth(_args, ctx) {
  const key = ctx?.convKey || ctx?.groupId || "";
  if (!key) return { status: "error", error: "no conversation key in context" };

  let rows;
  try {
    rows = await getRecentChat(key, SAMPLE_LIMIT);
  } catch (e) {
    return { status: "error", error: `read chat_history: ${e.message}` };
  }
  if (!rows || rows.length === 0) {
    return { status: "success", sample_size: 0, note: "這個對話還沒有留下任何訊息紀錄" };
  }

  const withLag = rows.filter(r => r.role === "user" && typeof r.lagMs === "number" && r.lagMs >= 0);
  const lags = withLag.map(r => r.lagMs);

  const last = rows[rows.length - 1];
  const lastMs = last?.createdAt?.toMillis?.() || 0;
  const quietMin = lastMs ? Math.round((Date.now() - lastMs) / 60000) : null;

  const result = {
    status: "success",
    sample_size: rows.length,
    lag_sample_size: lags.length,
    last_message_at: taipeiStamp(last?.createdAt),
    minutes_since_last_message: quietMin,
  };

  if (lags.length > 0) {
    const sum = lags.reduce((a, b) => a + b, 0);
    result.lag_avg_ms = Math.round(sum / lags.length);
    result.lag_max_ms = Math.max(...lags);
    result.lag_min_ms = Math.min(...lags);
    const recent = withLag.slice(-5).map(r => ({
      at: taipeiStamp(r.sentAt || r.createdAt),
      lag_ms: r.lagMs,
    }));
    result.recent_lags = recent;
  } else {
    result.note = "取樣範圍內沒有帶延遲資料的訊息（可能都是這個功能上線前存的舊紀錄）";
  }

  console.log(`[check_health] sample=${rows.length} lagN=${lags.length} avg=${result.lag_avg_ms || "-"}ms quiet=${quietMin}min`);
  return result;
}
