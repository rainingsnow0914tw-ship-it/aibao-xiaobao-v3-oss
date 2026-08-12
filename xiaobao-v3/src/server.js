import { createServer } from "node:http";
import { config } from "./config.js";
import { verifyLineSignature, lineReply, linePush } from "./line.js";
import { shouldReply } from "./trigger.js";
import { handleChat } from "./chat.js";
import { enqueueEvent } from "./batcher.js";
import { upsertUserProfile } from "./memory.js";
import { runReminderTick } from "./jobs/reminder_tick.js";
import { runProfileCleanupTick } from "./jobs/profile_cleanup_tick.js";

function checkSchedulerAuth(req) {
  const auth = (req.headers["x-scheduler-secret"] || "").trim();
  return Boolean(config.schedulerSecret) && auth === config.schedulerSecret;
}

const REPLY_TOKEN_BUDGET_MS = 25_000;

const server = createServer(async (req, res) => {
  const url = req.url || "/";

  if (req.method === "GET" && url === "/") {
    res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
    res.end("aibao-v3 alive");
    return;
  }

  if (req.method === "POST" && url === "/profile-cleanup-tick") {
    if (!checkSchedulerAuth(req)) {
      res.writeHead(401, { "content-type": "text/plain" });
      res.end("unauthorized");
      return;
    }
    try {
      const result = await runProfileCleanupTick();
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(result));
    } catch (e) {
      console.error("[profile-cleanup-tick] uncaught:", e.message);
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: e.message }));
    }
    return;
  }

  if (req.method === "POST" && url === "/reminder-tick") {
    if (!checkSchedulerAuth(req)) {
      res.writeHead(401, { "content-type": "text/plain" });
      res.end("unauthorized");
      return;
    }
    try {
      const result = await runReminderTick();
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(result));
    } catch (e) {
      console.error("[reminder-tick] uncaught:", e.message);
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: e.message }));
    }
    return;
  }

  if (req.method === "POST" && url === "/debug/set-profile") {
    if (!checkSchedulerAuth(req)) {
      res.writeHead(401, { "content-type": "text/plain" });
      res.end("unauthorized");
      return;
    }
    let body;
    try { body = await readBody(req); } catch (e) {
      res.writeHead(400); res.end("bad body"); return;
    }
    let parsed;
    try { parsed = JSON.parse(body); } catch (e) {
      res.writeHead(400); res.end("bad json"); return;
    }
    const userId = parsed.userId;
    if (!userId) { res.writeHead(400); res.end("missing userId"); return; }
    try {
      const ok = await upsertUserProfile(userId, parsed);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok, userId }));
    } catch (e) {
      console.error("[debug/set-profile] error:", e.message);
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: e.message }));
    }
    return;
  }

  if (req.method === "POST" && url === "/debug/chat") {
    if (!checkSchedulerAuth(req)) {
      res.writeHead(401, { "content-type": "text/plain" });
      res.end("unauthorized");
      return;
    }
    let body;
    try {
      body = await readBody(req);
    } catch (e) {
      res.writeHead(400, { "content-type": "text/plain" });
      res.end("bad body");
      return;
    }
    let parsed;
    try {
      parsed = JSON.parse(body);
    } catch (e) {
      res.writeHead(400, { "content-type": "text/plain" });
      res.end("bad json");
      return;
    }
    const fakeEvent = {
      type: "message",
      replyToken: "",
      source: {
        type: "group",
        groupId: parsed.groupId || "debug-group",
        userId: parsed.userId || "debug-user",
      },
      message: { type: "text", id: "debug", text: parsed.text || "" },
    };
    const startedAt = Date.now();
    try {
      const reply = await handleChat(fakeEvent);
      const elapsedMs = Date.now() - startedAt;
      res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ reply: reply || "", elapsed_ms: elapsedMs }));
    } catch (e) {
      console.error("[debug] error:", e.message);
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  if (req.method === "POST" && url === "/webhook") {
    let body;
    try {
      body = await readBody(req);
    } catch (e) {
      res.writeHead(400, { "content-type": "text/plain" });
      res.end("bad body");
      return;
    }

    const signature = req.headers["x-line-signature"] || "";
    if (!verifyLineSignature(body, signature, config.lineSecret)) {
      console.warn("[webhook] bad signature");
      res.writeHead(401, { "content-type": "text/plain" });
      res.end("bad signature");
      return;
    }

    res.writeHead(200, { "content-type": "application/json" });
    res.end("{}");

    let parsed;
    try {
      parsed = JSON.parse(body);
    } catch (e) {
      console.error("[webhook] parse error:", e.message);
      return;
    }

    for (const event of (parsed.events || [])) {
      handleEvent(event).catch((e) => {
        console.error("[handleEvent] uncaught:", e.message);
      });
    }
    return;
  }

  res.writeHead(404, { "content-type": "text/plain" });
  res.end("not found");
});

async function handleEvent(event) {
  const src = event.source || {};
  const lagMs = typeof event.timestamp === "number" ? Date.now() - event.timestamp : null;
  console.log(`[event] type=${event.type} groupId=${src.groupId || "-"} userId=${(src.userId || "-").slice(0, 12)} lag=${lagMs === null ? "n/a" : lagMs + "ms"}`);

  if (!shouldReply(event)) {
    return;
  }

  enqueueEvent(event, flushBatch);
}

async function flushBatch(events, firstReplyToken) {
  const primary = events[0];
  const src = primary.source || {};
  const target = src.groupId || src.userId;
  const startedAt = Date.now();

  try {
    const reply = await handleChat(events);
    if (!reply) {
      console.log("[reply] empty (skip)");
      return;
    }
    const elapsed = Date.now() - startedAt;
    if (elapsed > REPLY_TOKEN_BUDGET_MS) {
      console.warn(`[reply] slow ${elapsed}ms events=${events.length} -> push instead`);
      await linePush(target, reply);
    } else {
      await lineReply(firstReplyToken, reply);
    }
    console.log(`[reply] ok ${Date.now() - startedAt}ms events=${events.length}`);
  } catch (e) {
    console.error("[chat] error:", e.message);
    try {
      const fallbackText = "小寶剛剛出了點狀況、等一下再試試？";
      const elapsed = Date.now() - startedAt;
      if (elapsed > REPLY_TOKEN_BUDGET_MS) {
        await linePush(target, fallbackText);
      } else {
        await lineReply(firstReplyToken, fallbackText);
      }
    } catch (e2) {
      console.error("[fallback reply] error:", e2.message);
    }
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => { data += chunk; });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

async function warmUp() {
  const t0 = Date.now();
  try {
    const { db } = await import("./firestore.js");
    await db().collection("_warmup").doc("ping").get();
    console.log(`[warmup] firestore ${Date.now() - t0}ms`);
  } catch (e) {
    console.warn(`[warmup] firestore ${Date.now() - t0}ms err:`, e.message);
  }
  const t1 = Date.now();
  try {
    await fetch("https://api.line.me/v2/bot/info", {
      headers: { authorization: `Bearer ${config.lineToken}` },
    });
    console.log(`[warmup] line ${Date.now() - t1}ms`);
  } catch (e) {
    console.warn(`[warmup] line ${Date.now() - t1}ms err:`, e.message);
  }
}

server.listen(config.port, () => {
  console.log(`xiaobao-v3 listening on ${config.port}`);
  warmUp();
});
