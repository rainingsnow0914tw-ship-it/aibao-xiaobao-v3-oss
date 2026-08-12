import { Firestore, FieldValue } from "@google-cloud/firestore";
import { config } from "./config.js";

// preferRest=true 實測沒問題：2026-07-27 CPU throttling 修好後、REST cold 1300ms
// ≈ xiaobao gRPC 1280ms。之前 55.8 秒的元兇是 cpu-throttling 沒關、不是這裡、別亂改。
let _db = null;

export function db() {
  if (!_db) {
    _db = new Firestore({
      projectId: config.vertexProject,
      preferRest: true,
    });
  }
  return _db;
}

export { FieldValue };
