// lab fresh v2 — Worker Part 1 단위 테스트 (handleSave/Load/Heartbeat/Leave/ActiveUsers)
// 사료: S5.1 A11 + S3.3 B1 + S3.4 Phase 1+2+3 + S4c.4 silent failure

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  handleSave,
  handleAutoSave,
  handleSaveLegacy,
  handleLoadMeta,
  handleLoadTab,
  handleSessionList,
  handleSessionDelete,
  handleSessionHeartbeat,
  handleSessionLeave,
  handleSessionActiveUsers,
  handleHealth,
} from "../index.js";

// ─── Mock KV ─────────────────────────────────────────────────────────────

function makeKV(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    async get(key) { return map.has(key) ? map.get(key) : null; },
    async put(key, value, opts) { map.set(key, value); },
    async delete(key) { map.delete(key); },
    _map: map,
    _has(k) { return map.has(k); },
    _set(k, v) { map.set(k, v); },
  };
}

const HEADERS = { "Content-Type": "application/json" };
const ALICE = { sub: "alice@mt.co.kr", name: "Alice", role: "editor" };
const BOB = { sub: "bob@mt.co.kr", name: "Bob", role: "editor" };
const ADMIN = { sub: "admin@mt.co.kr", name: "Admin", role: "admin" };

const TEAM = [
  { name: "Admin", email: "admin@mt.co.kr", role: "admin" },
  { name: "Alice", email: "alice@mt.co.kr", role: "editor" },
  { name: "Bob", email: "bob@mt.co.kr", role: "editor" },
];

const PROJ_INDEX = [
  {
    id: "abc12345",
    fn: "test_project",
    creatorEmail: "alice@mt.co.kr",
    editors: ["alice@mt.co.kr", "bob@mt.co.kr"],
  },
];

function makeEnv(overrides = {}) {
  const SESSIONS = overrides.SESSIONS || makeKV({
    project_index: JSON.stringify(PROJ_INDEX),
    team_members: JSON.stringify(TEAM),
  });
  return { SESSIONS, ...overrides };
}

// ─── handleSave — 12 단계 진입 순서 ──────────────────────────────────────

test("handleSave: 정상 저장 (신규 entity, version=1)", async () => {
  const env = makeEnv();
  const r = await handleSave(
    { id: "abc12345", tab: "correction", data: { blocks: [{ index: 1, text: "a" }] }, fn: "test" },
    env, HEADERS, ALICE
  );
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.equal(body.success, true);
  assert.equal(body.version, 1);
  assert.ok(body.savedAt);

  // KV 박제 검증
  const stored = JSON.parse(env.SESSIONS._map.get("s:abc12345:correction"));
  assert.equal(stored.version, 1);
  assert.equal(stored.updatedBy.sub, "alice@mt.co.kr");
  assert.equal(stored.schemaVersion, "2.0");
});

test("handleSave: 2번째 저장 → version 2 + merge", async () => {
  const env = makeEnv();
  await handleSave(
    { id: "abc12345", tab: "correction", data: { blocks: [{ index: 1, text: "a" }] } },
    env, HEADERS, ALICE
  );
  // 같은 user 의 두 번째 저장 — baseSavedAt + version 동봉
  const stored1 = JSON.parse(env.SESSIONS._map.get("s:abc12345:correction"));
  const r2 = await handleSave(
    {
      id: "abc12345",
      tab: "correction",
      data: { blocks: [{ index: 2, text: "b" }] },
      baseSavedAt: stored1.savedAt,
      baseVersion: stored1.version,
    },
    env, HEADERS, ALICE
  );
  const body2 = await r2.json();
  assert.equal(body2.version, 2);
  const stored2 = JSON.parse(env.SESSIONS._map.get("s:abc12345:correction"));
  // array_id_union — index 1 + 2 모두 보존
  assert.equal(stored2.blocks.length, 2);
});

test("handleSave: invalid id format → 400 (E5 + H1)", async () => {
  const env = makeEnv();
  const r = await handleSave(
    { id: "abc", tab: "correction", data: {} },  // 3자 — too short
    env, HEADERS, ALICE
  );
  assert.equal(r.status, 400);
});

test("handleSave: invalid tab → 400 (E4)", async () => {
  const env = makeEnv();
  const r = await handleSave(
    { id: "abc12345", tab: "evil_tab", data: {} },
    env, HEADERS, ALICE
  );
  assert.equal(r.status, 400);
});

test("handleSave: canEdit X (stranger) → 403 (B7)", async () => {
  const env = makeEnv();
  const stranger = { sub: "stranger@mt.co.kr", name: "X", role: "editor" };
  const r = await handleSave(
    { id: "abc12345", tab: "correction", data: { blocks: [] } },
    env, HEADERS, stranger
  );
  assert.equal(r.status, 403);
});

test("handleSave: deleted project → 409 (B11)", async () => {
  const env = makeEnv();
  // project 를 deleted 로 마킹
  const deletedIndex = [{ ...PROJ_INDEX[0], deleted: true, deletedAt: "T0" }];
  env.SESSIONS._set("project_index", JSON.stringify(deletedIndex));
  const r = await handleSave(
    { id: "abc12345", tab: "correction", data: { blocks: [] } },
    env, HEADERS, ALICE
  );
  assert.equal(r.status, 409);
});

test("handleSave: PROTO_KEYS sanitize (B12)", async () => {
  const env = makeEnv();
  const evil = JSON.parse('{"blocks": [{"index": 1, "__proto__": {"polluted": true}}]}');
  await handleSave(
    { id: "abc12345", tab: "correction", data: evil },
    env, HEADERS, ALICE
  );
  // pollution 안 됨 검증
  assert.equal(({}).polluted, undefined);
});

test("handleSave: 다른 sub 충돌 → ★ B10 merged/mergedBy 응답 (N6)", async () => {
  const env = makeEnv();
  // Alice 가 먼저 저장
  await handleSave(
    { id: "abc12345", tab: "correction", data: { blocks: [{ index: 1 }] } },
    env, HEADERS, ALICE
  );
  // Bob 이 baseSavedAt/Version 없이 force=true (강제저장) — 또는 force 없이 conflict 안 일어나는 케이스
  // 실제 N6 테스트: !body.force && existing && existing.updatedBy && body.user && existing.updatedBy.sub !== body.user.sub
  const r = await handleSave(
    {
      id: "abc12345",
      tab: "correction",
      data: { blocks: [{ index: 2 }] },
      // baseVersion 부재 → 충돌 X (구 클라 호환)
    },
    env, HEADERS, BOB
  );
  const body = await r.json();
  assert.equal(body.success, true);
  assert.equal(body.merged, true);
  assert.equal(body.mergedBy.sub, "alice@mt.co.kr");
});

test("handleSave: baseVersion 충돌 → 409 (B5)", async () => {
  const env = makeEnv();
  await handleSave(
    { id: "abc12345", tab: "correction", data: { blocks: [{ index: 1 }] } },
    env, HEADERS, ALICE
  );
  // baseVersion 0 (이전 버전) → 충돌
  const r = await handleSave(
    {
      id: "abc12345",
      tab: "correction",
      data: { blocks: [{ index: 2 }] },
      baseVersion: 0,
    },
    env, HEADERS, BOB
  );
  assert.equal(r.status, 409);
  const body = await r.json();
  assert.equal(body.error, "conflict");
  assert.ok(body.serverData);
  assert.equal(body.serverVersion, 1);
});

test("handleSave: force=true → 충돌 무시 (강제저장)", async () => {
  const env = makeEnv();
  await handleSave(
    { id: "abc12345", tab: "correction", data: { blocks: [{ index: 1 }] } },
    env, HEADERS, ALICE
  );
  const r = await handleSave(
    {
      id: "abc12345",
      tab: "correction",
      data: { blocks: [{ index: 2 }] },
      baseVersion: 0,  // 이전 버전이지만
      force: true,
    },
    env, HEADERS, ADMIN
  );
  assert.equal(r.status, 200);
});

test("handleSave: meta.creator 박제 (P-2)", async () => {
  const env = makeEnv();
  await handleSave(
    { id: "abc12345", tab: "correction", data: { blocks: [{ index: 1 }] } },
    env, HEADERS, ALICE
  );
  const meta = JSON.parse(env.SESSIONS._map.get("s:abc12345:meta"));
  assert.equal(meta.creator.sub, "alice@mt.co.kr");
});

test("handleSave: meta.stages[tab] 갱신", async () => {
  const env = makeEnv();
  await handleSave(
    { id: "abc12345", tab: "guide", data: { hl: [] } },
    env, HEADERS, ALICE
  );
  const meta = JSON.parse(env.SESSIONS._map.get("s:abc12345:meta"));
  assert.ok(meta.stages.guide);
  assert.ok(meta.stages.guide.updatedAt);
  assert.equal(meta.stages.guide.updatedBy.sub, "alice@mt.co.kr");
});

test("handleSave: session_index array_id_union (D6-7)", async () => {
  const env = makeEnv();
  await handleSave(
    { id: "abc12345", tab: "correction", data: { blocks: [] }, fn: "First" },
    env, HEADERS, ALICE
  );
  await handleSave(
    { id: "abc12345", tab: "guide", data: { hl: [] } },
    env, HEADERS, ALICE
  );
  const idx = JSON.parse(env.SESSIONS._map.get("session_index"));
  assert.equal(idx.length, 1);  // 같은 id 라 union
  assert.equal(idx[0].fn, "First");
});

test("handleSave: KV not configured → 500", async () => {
  const r = await handleSave({}, {}, HEADERS, ALICE);
  assert.equal(r.status, 500);
});

// ─── handleAutoSave (N1 — creator 박제 의무) ──────────────────────────

test("handleAutoSave: creator 박제 (★ N1 — handleSave 와 동일 패턴)", async () => {
  const env = makeEnv();
  await handleAutoSave(
    { id: "abc12345", tab: "correction", data: { blocks: [] } },
    env, HEADERS, ALICE
  );
  const meta = JSON.parse(env.SESSIONS._map.get("s:abc12345:meta"));
  assert.equal(meta.creator.sub, "alice@mt.co.kr");
});

// ─── handleSaveLegacy ────────────────────────────────────────────────────

test("handleSaveLegacy: 단일 키 저장", async () => {
  const env = makeEnv();
  const r = await handleSaveLegacy(
    { id: "legacy01", data: { x: 1 }, fn: "Legacy" },
    env, HEADERS, ALICE
  );
  assert.equal(r.status, 200);
  const stored = JSON.parse(env.SESSIONS._map.get("legacy01"));
  assert.equal(stored.x, 1);
  assert.ok(stored.savedAt);
});

// ─── handleLoadMeta ──────────────────────────────────────────────────────

test("handleLoadMeta: meta 조회 + active list 동봉 (M11)", async () => {
  const env = makeEnv();
  // meta 저장
  env.SESSIONS._set("s:abc12345:meta", JSON.stringify({
    sessionId: "abc12345",
    fn: "test",
    stages: { correction: { updatedAt: "T1" } },
  }));
  // active 박제
  const now = Date.now();
  env.SESSIONS._set("active:abc12345", JSON.stringify({
    "alice@mt.co.kr": { name: "Alice", lastBeat: now, tabs: ["correction"] },
  }));

  const r = await handleLoadMeta("abc12345", env, HEADERS, ALICE);
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.equal(body.success, true);
  assert.equal(body.meta.sessionId, "abc12345");
  assert.equal(body.active.length, 1);
  assert.equal(body.active[0].sub, "alice@mt.co.kr");
});

test("handleLoadMeta: 미존재 → 404", async () => {
  const env = makeEnv();
  const r = await handleLoadMeta("xxxxxxxx", env, HEADERS, ALICE);
  assert.equal(r.status, 404);
});

// ─── handleLoadTab ───────────────────────────────────────────────────────

test("handleLoadTab: 정상 조회", async () => {
  const env = makeEnv();
  env.SESSIONS._set("s:abc12345:correction", JSON.stringify({
    blocks: [{ index: 1, text: "a" }],
    version: 1,
  }));
  const r = await handleLoadTab("abc12345", "correction", env, HEADERS, ALICE);
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.equal(body.data.blocks.length, 1);
});

test("handleLoadTab: 미존재 → 404 (★ P0-08, 5xx 와 구분)", async () => {
  const env = makeEnv();
  const r = await handleLoadTab("abc12345", "correction", env, HEADERS, ALICE);
  assert.equal(r.status, 404);
});

test("handleLoadTab: invalid tab → 400", async () => {
  const env = makeEnv();
  const r = await handleLoadTab("abc12345", "evil_tab", env, HEADERS, ALICE);
  assert.equal(r.status, 400);
});

// ─── handleSessionList ───────────────────────────────────────────────────

test("handleSessionList: session_index 반환", async () => {
  const env = makeEnv();
  env.SESSIONS._set("session_index", JSON.stringify([
    { id: "abc12345", fn: "Test", updatedAt: "T1" },
  ]));
  const r = await handleSessionList(env, HEADERS, ALICE);
  const body = await r.json();
  assert.equal(body.sessions.length, 1);
});

// ─── handleSessionDelete (탭 + active + session_index 모두 정리) ────────

test("handleSessionDelete: 모든 탭 키 + active 키 + session_index entry 삭제", async () => {
  const env = makeEnv();
  // 사전 박제
  env.SESSIONS._set("s:abc12345:correction", JSON.stringify({ x: 1 }));
  env.SESSIONS._set("s:abc12345:meta", JSON.stringify({ sessionId: "abc12345" }));
  env.SESSIONS._set("active:abc12345", JSON.stringify({ "alice@mt.co.kr": { lastBeat: Date.now() } }));
  env.SESSIONS._set("session_index", JSON.stringify([{ id: "abc12345", fn: "x" }]));

  const r = await handleSessionDelete({ id: "abc12345" }, env, HEADERS, ALICE);
  assert.equal(r.status, 200);

  // 탭 키 모두 삭제됨
  assert.equal(env.SESSIONS._has("s:abc12345:correction"), false);
  assert.equal(env.SESSIONS._has("s:abc12345:meta"), false);
  // active 키 삭제 (★ N8 영역)
  assert.equal(env.SESSIONS._has("active:abc12345"), false);
  // session_index entry 제거
  const idx = JSON.parse(env.SESSIONS._map.get("session_index"));
  assert.equal(idx.length, 0);
});

// ─── handleSessionHeartbeat ──────────────────────────────────────────────

test("handleSessionHeartbeat: 본인 박제 (tabs = [현재 탭 1개], N5 해소)", async () => {
  const env = makeEnv();
  const r = await handleSessionHeartbeat(
    "abc12345",
    { tab: "correction" },
    env, HEADERS, ALICE
  );
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.equal(body.active.length, 1);
  assert.equal(body.active[0].sub, "alice@mt.co.kr");
  assert.deepEqual(body.active[0].tabs, ["correction"]);
});

test("handleSessionHeartbeat: 다음 탭 이동 → tabs 교체 (★ N5 누적 X)", async () => {
  const env = makeEnv();
  await handleSessionHeartbeat("abc12345", { tab: "correction" }, env, HEADERS, ALICE);
  const r = await handleSessionHeartbeat("abc12345", { tab: "guide" }, env, HEADERS, ALICE);
  const body = await r.json();
  // tabs = [guide] 만 (correction 누적 X)
  assert.deepEqual(body.active[0].tabs, ["guide"]);
});

test("handleSessionHeartbeat: stale 사용자 자동 정리 (>90s)", async () => {
  const env = makeEnv();
  const now = Date.now();
  env.SESSIONS._set("active:abc12345", JSON.stringify({
    "stale@mt.co.kr": { name: "Stale", lastBeat: now - 200_000, tabs: ["x"] },
  }));
  const r = await handleSessionHeartbeat("abc12345", { tab: "guide" }, env, HEADERS, ALICE);
  const body = await r.json();
  // stale 정리되고 alice 만 남음
  assert.equal(body.active.length, 1);
  assert.equal(body.active[0].sub, "alice@mt.co.kr");
});

test("handleSessionHeartbeat: user 부재 → 401", async () => {
  const env = makeEnv();
  const r = await handleSessionHeartbeat("abc12345", {}, env, HEADERS, null);
  assert.equal(r.status, 401);
});

// ─── handleSessionLeave (★ 인증 면제) ───────────────────────────────────

test("handleSessionLeave: 본인 entry 제거 (인증 면제, sendBeacon 호환)", async () => {
  const env = makeEnv();
  const now = Date.now();
  env.SESSIONS._set("active:abc12345", JSON.stringify({
    "alice@mt.co.kr": { lastBeat: now, tabs: ["correction"] },
    "bob@mt.co.kr": { lastBeat: now, tabs: ["guide"] },
  }));
  const r = await handleSessionLeave("abc12345", { sub: "alice@mt.co.kr" }, env, HEADERS);
  assert.equal(r.status, 200);
  const stored = JSON.parse(env.SESSIONS._map.get("active:abc12345"));
  assert.equal(stored["alice@mt.co.kr"], undefined);
  assert.ok(stored["bob@mt.co.kr"]);
});

test("handleSessionLeave: 마지막 사용자 → active 키 자체 삭제", async () => {
  const env = makeEnv();
  const now = Date.now();
  env.SESSIONS._set("active:abc12345", JSON.stringify({
    "alice@mt.co.kr": { lastBeat: now, tabs: ["correction"] },
  }));
  await handleSessionLeave("abc12345", { sub: "alice@mt.co.kr" }, env, HEADERS);
  assert.equal(env.SESSIONS._has("active:abc12345"), false);
});

test("handleSessionLeave: sub 부재 → 400", async () => {
  const env = makeEnv();
  const r = await handleSessionLeave("abc12345", {}, env, HEADERS);
  assert.equal(r.status, 400);
});

// ─── handleSessionActiveUsers ────────────────────────────────────────────

test("handleSessionActiveUsers: stale 정리 + fresh list 반환", async () => {
  const env = makeEnv();
  const now = Date.now();
  env.SESSIONS._set("active:abc12345", JSON.stringify({
    "alice@mt.co.kr": { lastBeat: now, tabs: ["correction"] },
    "stale@mt.co.kr": { lastBeat: now - 200_000, tabs: ["x"] },
  }));
  const r = await handleSessionActiveUsers("abc12345", env, HEADERS);
  const body = await r.json();
  assert.equal(body.active.length, 1);
  assert.equal(body.active[0].sub, "alice@mt.co.kr");
});

// ─── /health ─────────────────────────────────────────────────────────────

test("handleHealth: KV read/write 정상 → 200", async () => {
  const env = makeEnv();
  const r = await handleHealth(env, HEADERS);
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.equal(body.ok, true);
  assert.equal(body.kvRead, true);
  assert.equal(body.kvWrite, true);
});

test("handleHealth: KV not configured → 503", async () => {
  const r = await handleHealth({}, HEADERS);
  assert.equal(r.status, 503);
});
