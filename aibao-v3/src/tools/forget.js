import { deleteMemoryItem } from "../memory.js";

export async function executeForget(args, ctx) {
  const id = String(args?.memory_id || "").trim();
  if (!id) return { status: "error", error: "missing memory_id" };

  const result = await deleteMemoryItem(id, ctx?.groupId || "");
  if (!result.ok) {
    console.log(`[forget] ${id} failed: ${result.error}`);
    return { status: "error", error: result.error };
  }

  console.log(`[forget] ${id} removed: ${(result.text || "").slice(0, 60)}`);
  return { status: "success", memory_id: id, removed_text: result.text };
}
