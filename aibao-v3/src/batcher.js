const BATCH_MS = parseInt(process.env.BATCH_DEBOUNCE_MS || "3000", 10);
const MAX_BATCH_EVENTS = parseInt(process.env.MAX_BATCH_EVENTS || "10", 10);

const batches = new Map();

function targetKey(event) {
  const src = event.source || {};
  return (src.groupId || src.userId || "").trim();
}

export function enqueueEvent(event, flushFn) {
  const target = targetKey(event);
  if (!target) {
    console.warn("[batcher] event without target, process solo");
    flushFn([event], event.replyToken).catch(e => console.error("[batcher] solo flush error:", e.message));
    return;
  }

  const existing = batches.get(target);
  if (existing && !existing.flushInProgress) {
    if (existing.events.length >= MAX_BATCH_EVENTS) {
      console.warn(`[batcher] target=${target.slice(0, 10)} at cap ${MAX_BATCH_EVENTS}, drop extra event`);
      return;
    }
    existing.events.push(event);
    console.log(`[batcher] +1 to ${target.slice(0, 10)} (now ${existing.events.length})`);
    return;
  }

  const batch = {
    events: [event],
    firstReplyToken: event.replyToken,
    target,
    timer: null,
    flushInProgress: false,
  };
  batch.timer = setTimeout(() => {
    batch.flushInProgress = true;
    batches.delete(target);
    console.log(`[batcher] flush ${target.slice(0, 10)} events=${batch.events.length} took=${BATCH_MS}ms wait`);
    flushFn(batch.events, batch.firstReplyToken).catch(e => console.error("[batcher] flush error:", e.message));
  }, BATCH_MS);
  batches.set(target, batch);
  console.log(`[batcher] new batch ${target.slice(0, 10)} debounce=${BATCH_MS}ms`);
}
