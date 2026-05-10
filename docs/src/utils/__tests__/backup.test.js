// lab fresh v2 — backup 단위 테스트 (D2 4중 백업 + W-2)
// 사료: S3.2 D2 + W-1~4

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

// localStorage mock (node 환경)
class LocalStorageMock {
  constructor() { this._map = new Map(); }
  get length() { return this._map.size; }
  key(i) { return [...this._map.keys()][i] ?? null; }
  getItem(k) { return this._map.has(k) ? this._map.get(k) : null; }
  setItem(k, v) { this._map.set(k, String(v)); }
  removeItem(k) { this._map.delete(k); }
  clear() { this._map.clear(); }
}

globalThis.localStorage = new LocalStorageMock();

// 모듈 import (after localStorage mock)
const {
  createEmergencyBackup,
  listBackups,
  restoreFromBackup,
  deleteBackup,
  deleteBackupsForSession,
  getLatestBackup,
  autoRetry,
} = await import("../backup.js");

beforeEach(() => {
  localStorage.clear();
});

// ─── createEmergencyBackup ────────────────────────────────────────────────

test("createEmergencyBackup: localStorage 박제", () => {
  const key = createEmergencyBackup({ blocks: [{ index: 1 }] }, {
    type: "save_failure",
    sessionId: "abc12345",
  });
  assert.ok(key);
  assert.ok(key.startsWith("te_backup_save_failure_abc12345_"));
  assert.ok(localStorage.getItem(key));
});

test("createEmergencyBackup: payload + metadata 보존", () => {
  const key = createEmergencyBackup(
    { x: "data" },
    { type: "conflict", sessionId: "abc12345", reason: "다른 사용자 충돌" }
  );
  const stored = JSON.parse(localStorage.getItem(key));
  assert.equal(stored.type, "conflict");
  assert.equal(stored.sessionId, "abc12345");
  assert.equal(stored.reason, "다른 사용자 충돌");
  assert.equal(stored.payload.x, "data");
  assert.equal(stored.schemaVersion, "2.0");
  assert.ok(stored.backupAt);
});

// ─── W-2 manuscript_replace 5 cap (D2 무제한 분리) ──────────────────────

test("W-2: manuscript_replace 만 5 cap (FIFO)", async () => {
  // 7 개 박제 (cap 5 초과)
  const sessionId = "abc12345";
  for (let i = 0; i < 7; i++) {
    createEmergencyBackup({ v: i }, { type: "manuscript_replace", sessionId });
    await new Promise((r) => setTimeout(r, 5));  // ts 분리
  }
  const backups = listBackups().filter((b) => b.type === "manuscript_replace" && b.sessionId === sessionId);
  assert.equal(backups.length, 5);  // 최신 5 개만 남음
  // 가장 오래된 (i=0,1) 삭제됨, 최신 (i=6) 보존
  const payloads = backups.map((b) => restoreFromBackup(b.key)?.payload?.v).sort((a, b) => a - b);
  assert.deepEqual(payloads, [2, 3, 4, 5, 6]);
});

test("W-2: save_failure type 은 cap 적용 X (D2 무제한)", () => {
  for (let i = 0; i < 10; i++) {
    createEmergencyBackup({ v: i }, { type: "save_failure", sessionId: "abc12345" });
  }
  const backups = listBackups().filter((b) => b.type === "save_failure");
  assert.equal(backups.length, 10);  // 무제한
});

// ─── listBackups ─────────────────────────────────────────────────────────

test("listBackups: 모든 백업 반환 + 최신 순 정렬", async () => {
  createEmergencyBackup({ v: 1 }, { type: "save_failure", sessionId: "proj0001" });
  await new Promise((r) => setTimeout(r, 10));
  createEmergencyBackup({ v: 2 }, { type: "save_failure", sessionId: "proj0002" });
  await new Promise((r) => setTimeout(r, 10));
  createEmergencyBackup({ v: 3 }, { type: "conflict", sessionId: "proj0001" });

  const all = listBackups();
  assert.equal(all.length, 3);
  // 최신 우선
  assert.ok(all[0].ts >= all[1].ts);
  assert.ok(all[1].ts >= all[2].ts);
});

test("listBackups: 비-backup 키 무시", () => {
  localStorage.setItem("te_cfg", "{}");
  localStorage.setItem("ttimes_token", "x");
  createEmergencyBackup({ v: 1 }, { type: "save_failure", sessionId: "proj0001" });
  assert.equal(listBackups().length, 1);
});

// ─── restoreFromBackup ───────────────────────────────────────────────────

test("restoreFromBackup: payload 정확 복원", () => {
  const original = { blocks: [{ index: 1, text: "안녕" }], hl: [] };
  const key = createEmergencyBackup(original, { type: "save_failure", sessionId: "proj0001" });
  const restored = restoreFromBackup(key);
  assert.deepEqual(restored.payload, original);
});

test("restoreFromBackup: 미존재 → null", () => {
  assert.equal(restoreFromBackup("te_backup_nonexistent"), null);
});

// ─── getLatestBackup ─────────────────────────────────────────────────────

test("getLatestBackup: 가장 최신", async () => {
  createEmergencyBackup({ v: 1 }, { type: "save_failure", sessionId: "proj0001" });
  await new Promise((r) => setTimeout(r, 10));
  createEmergencyBackup({ v: 2 }, { type: "save_failure", sessionId: "proj0001" });
  const latest = getLatestBackup();
  assert.equal(latest.payload.v, 2);
});

// ─── deleteBackup / deleteBackupsForSession ─────────────────────────────

test("deleteBackup: 명시 삭제", () => {
  const key = createEmergencyBackup({ v: 1 }, { type: "save_failure", sessionId: "proj0001" });
  assert.ok(deleteBackup(key));
  assert.equal(restoreFromBackup(key), null);
});

test("deleteBackupsForSession: W-3 영구 삭제 정리", () => {
  createEmergencyBackup({ v: 1 }, { type: "save_failure", sessionId: "proj0001" });
  createEmergencyBackup({ v: 2 }, { type: "conflict", sessionId: "proj0001" });
  createEmergencyBackup({ v: 3 }, { type: "save_failure", sessionId: "proj0002" });

  const count = deleteBackupsForSession("proj0001");
  assert.equal(count, 2);
  assert.equal(listBackups().length, 1);
  assert.equal(listBackups()[0].sessionId, "proj0002");
});

// ─── autoRetry (4차 백업) ────────────────────────────────────────────────

test("autoRetry: 첫 시도 성공", async () => {
  const r = await autoRetry(async () => "ok");
  assert.equal(r.ok, true);
  assert.equal(r.value, "ok");
  assert.equal(r.attempts, 1);
});

test("autoRetry: 2회 실패 + 3회 성공 → 4차 backoff", async () => {
  let count = 0;
  const r = await autoRetry(async () => {
    count++;
    if (count < 3) throw new Error("transient");
    return "ok";
  }, { delays: [10, 20, 30] });
  assert.equal(r.ok, true);
  assert.equal(r.attempts, 3);
});

test("autoRetry: 4xx 에러 (사용자 입력) → 즉시 종료 (retry X)", async () => {
  let count = 0;
  const r = await autoRetry(async () => {
    count++;
    const e = new Error("invalid id");
    e.status = 400;
    throw e;
  }, { delays: [10] });
  assert.equal(r.ok, false);
  assert.equal(count, 1);  // retry 안 함
});

test("autoRetry: 5xx 에러 → maxAttempts 까지 retry", async () => {
  let count = 0;
  const r = await autoRetry(async () => {
    count++;
    const e = new Error("server");
    e.status = 500;
    throw e;
  }, { delays: [10, 10, 10] });
  assert.equal(r.ok, false);
  assert.equal(r.attempts, 4);  // 1 + 3 retries
});

test("autoRetry: 모두 실패 → ok:false + lastError", async () => {
  const r = await autoRetry(async () => { throw new Error("always fail"); }, { delays: [10, 10] });
  assert.equal(r.ok, false);
  assert.ok(r.error);
});
