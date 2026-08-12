import { Firestore, FieldValue } from "@google-cloud/firestore";
import { config } from "./config.js";

const DATABASE_ID = process.env.FIRESTORE_DATABASE_ID || "(default)";
const PREFER_REST = (process.env.FIRESTORE_PREFER_REST || "false").toLowerCase() === "true";

let _db = null;

export function db() {
  if (!_db) {
    const opts = {
      projectId: config.vertexProject,
      databaseId: DATABASE_ID,
    };
    if (PREFER_REST) opts.preferRest = true;
    _db = new Firestore(opts);
  }
  return _db;
}

export { FieldValue };
