import { db, FieldValue } from "./firestore.js";

const HISTORY_LIMIT = parseInt(process.env.HISTORY_LIMIT || "20", 10);
const CHAT_TTL_MS = 3 * 24 * 60 * 60 * 1000;

export async function saveChat({ groupId, userId, nickname, text, role, msgType = "text", sentAt = null, lagMs = null }) {
  try {
    await db().collection("chat_history").add({
      groupId: groupId || "",
      userId: userId || "",
      nickname: nickname || "",
      text: text || "",
      role: role || "user",
      msgType,
      sentAt: sentAt || null,
      lagMs: typeof lagMs === "number" ? lagMs : null,
      createdAt: FieldValue.serverTimestamp(),
      expiresAt: new Date(Date.now() + CHAT_TTL_MS),
    });
  } catch (e) {
    console.error("[memory.saveChat] error:", e.message);
  }
}

export async function getRecentChat(groupId, limit = HISTORY_LIMIT) {
  if (!groupId) return [];
  try {
    const snap = await db().collection("chat_history")
      .where("groupId", "==", groupId)
      .orderBy("createdAt", "desc")
      .limit(limit)
      .get();
    return snap.docs.map(d => d.data()).reverse();
  } catch (e) {
    console.error("[memory.getRecentChat] error:", e.message);
    return [];
  }
}

export async function getUserProfile(userId) {
  if (!userId) return null;
  try {
    const snap = await db().collection("user_index").doc(userId).get();
    return snap.exists ? snap.data() : null;
  } catch (e) {
    console.error("[memory.getUserProfile] error:", e.message);
    return null;
  }
}

export async function listUserProfiles(groupId) {
  if (!groupId) return [];
  try {
    const snap = await db().collection("user_index").where("groupId", "==", groupId).get();
    return snap.docs.map(d => d.data());
  } catch (e) {
    console.error("[memory.listUserProfiles] error:", e.message);
    return [];
  }
}

export async function ensureUserIndex({ userId, groupId, displayName }) {
  if (!userId) return null;
  const ref = db().collection("user_index").doc(userId);
  try {
    const snap = await ref.get();
    if (snap.exists) return snap.data();
    const initial = {
      userId,
      groupId: groupId || "",
      nickname: displayName || "家人",
      manual_notes: "",
      ai_notes: "",
      ai_notes_updated_at: null,
      createdAt: FieldValue.serverTimestamp(),
    };
    await ref.set(initial);
    return initial;
  } catch (e) {
    console.error("[memory.ensureUserIndex] error:", e.message);
    return null;
  }
}

export async function getRecentChatByUser(groupId, userId, hoursBack = 24) {
  if (!groupId || !userId) return [];
  const since = new Date(Date.now() - hoursBack * 3600 * 1000);
  try {
    const snap = await db().collection("chat_history")
      .where("groupId", "==", groupId)
      .where("userId", "==", userId)
      .where("createdAt", ">=", since)
      .orderBy("createdAt", "asc")
      .get();
    return snap.docs.map(d => d.data());
  } catch (e) {
    console.error("[memory.getRecentChatByUser] error:", e.message);
    return [];
  }
}

export async function getRecentChatAll(groupId, hoursBack = 24) {
  if (!groupId) return [];
  const since = new Date(Date.now() - hoursBack * 3600 * 1000);
  try {
    const snap = await db().collection("chat_history")
      .where("groupId", "==", groupId)
      .where("createdAt", ">=", since)
      .orderBy("createdAt", "asc")
      .get();
    return snap.docs.map(d => d.data());
  } catch (e) {
    console.error("[memory.getRecentChatAll] error:", e.message);
    return [];
  }
}

export async function updateAiNotes(userId, aiNotes) {
  try {
    await db().collection("user_index").doc(userId).update({
      ai_notes: aiNotes,
      ai_notes_updated_at: FieldValue.serverTimestamp(),
    });
    return true;
  } catch (e) {
    console.error("[memory.updateAiNotes] error:", e.message);
    return false;
  }
}

export async function upsertUserProfile(userId, fields) {
  if (!userId) return false;
  const ref = db().collection("user_index").doc(userId);
  try {
    const snap = await ref.get();
    if (!snap.exists) {
      await ref.set({
        userId,
        groupId: fields.groupId || "",
        nickname: fields.nickname || "家人",
        manual_notes: fields.manual_notes || "",
        ai_notes: fields.ai_notes || "",
        ai_notes_updated_at: fields.ai_notes ? FieldValue.serverTimestamp() : null,
        createdAt: FieldValue.serverTimestamp(),
      });
      return true;
    }
    const update = {};
    if (fields.nickname !== undefined) update.nickname = fields.nickname;
    if (fields.manual_notes !== undefined) update.manual_notes = fields.manual_notes;
    if (fields.ai_notes !== undefined) {
      update.ai_notes = fields.ai_notes;
      update.ai_notes_updated_at = FieldValue.serverTimestamp();
    }
    if (fields.groupId !== undefined) update.groupId = fields.groupId;
    if (Object.keys(update).length > 0) await ref.update(update);
    return true;
  } catch (e) {
    console.error("[memory.upsertUserProfile] error:", e.message);
    return false;
  }
}

export const MEMORY_CATEGORIES = ["健康", "偏好", "家人", "工作", "約定", "其他"];
const MAX_MEMORY_ITEMS = parseInt(process.env.MAX_MEMORY_ITEMS || "120", 10);

function shortMemoryId() {
  return `m_${Math.random().toString(36).slice(2, 8)}`;
}

export async function addMemoryItem({ groupId, text, category, about, createdBy, createdByNickname }) {
  if (!groupId || !text) return null;
  const id = shortMemoryId();
  try {
    await db().collection("memory_items").doc(id).set({
      id,
      groupId,
      text: String(text).slice(0, 300),
      category: MEMORY_CATEGORIES.includes(category) ? category : "其他",
      about: about || "",
      createdBy: createdBy || "",
      createdByNickname: createdByNickname || "",
      createdAt: FieldValue.serverTimestamp(),
    });
    return id;
  } catch (e) {
    console.error("[memory.addMemoryItem] error:", e.message);
    return null;
  }
}

export async function listMemoryItems(groupId) {
  if (!groupId) return [];
  try {
    const snap = await db().collection("memory_items")
      .where("groupId", "==", groupId)
      .limit(MAX_MEMORY_ITEMS)
      .get();
    const items = snap.docs.map(d => d.data());
    items.sort((a, b) => {
      const ta = a.createdAt?.toMillis?.() || 0;
      const tb = b.createdAt?.toMillis?.() || 0;
      return ta - tb;
    });
    return items;
  } catch (e) {
    console.error("[memory.listMemoryItems] error:", e.message);
    return [];
  }
}

export async function deleteMemoryItem(id, groupId) {
  if (!id) return { ok: false, error: "missing id" };
  const ref = db().collection("memory_items").doc(id);
  try {
    const snap = await ref.get();
    if (!snap.exists) return { ok: false, error: "not found" };
    if (groupId && snap.data().groupId !== groupId) {
      return { ok: false, error: "not yours" };
    }
    const text = snap.data().text || "";
    await ref.delete();
    return { ok: true, text };
  } catch (e) {
    console.error("[memory.deleteMemoryItem] error:", e.message);
    return { ok: false, error: e.message };
  }
}

export async function upsertGroupSummary(groupId, summary) {
  try {
    await db().collection("group_summary").doc(groupId).set({
      groupId,
      summary,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    return true;
  } catch (e) {
    console.error("[memory.upsertGroupSummary] error:", e.message);
    return false;
  }
}

export async function getGroupSummary(groupId) {
  if (!groupId) return "";
  try {
    const snap = await db().collection("group_summary").doc(groupId).get();
    return snap.exists ? (snap.data().summary || "") : "";
  } catch (e) {
    console.error("[memory.getGroupSummary] error:", e.message);
    return "";
  }
}
