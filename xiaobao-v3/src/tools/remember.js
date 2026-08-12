import { addMemoryItem, MEMORY_CATEGORIES } from "../memory.js";

export async function executeRemember(args, ctx) {
  const text = String(args?.text || "").trim();
  if (!text) return { status: "error", error: "missing text" };

  const category = MEMORY_CATEGORIES.includes(args?.category) ? args.category : "其他";
  const about = String(args?.about || ctx?.nickname || "").trim();

  const id = await addMemoryItem({
    convKey: ctx?.convKey || "",
    groupId: ctx?.groupId || "",
    text,
    category,
    about,
    createdBy: ctx?.userId || "",
    createdByNickname: ctx?.nickname || "",
  });

  if (!id) return { status: "error", error: "write failed" };

  console.log(`[remember] ${id} (${category}) about=${about}: ${text.slice(0, 60)}`);
  return { status: "success", memory_id: id, category, about, text };
}
