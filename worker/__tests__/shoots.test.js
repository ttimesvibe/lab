// lab fresh v2 — shoots 단위 테스트
// 사료: S2.4.5 + S1.10.2.c CAL-1 + S1.9 N7

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CALENDAR_EMAIL_MAP,
  callAppsScript,
  extractEventId,
  handleShootList,
  handleShootCreate,
  handleShootUpdate,
  handleShootDelete,
  handleShootMoveStage,
} from "../shoots.js";

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

function makeEnv(shootIndex = []) {
  const SESSIONS = makeKV({
    shoot_index: JSON.stringify(shootIndex),
    project_index: JSON.stringify([]),
  });
  return { SESSIONS };
}

// ─── 상수 검증 ────────────────────────────────────────────────────────────

test("CALENDAR_EMAIL_MAP: 회사 → 개인 매핑", () => {
  assert.equal(CALENDAR_EMAIL_MAP["hjae@mt.co.kr"], "repfootball@gmail.com");
  assert.equal(CALENDAR_EMAIL_MAP["24min@mt.co.kr"], "sammylee9393@gmail.com");
});

// ─── extractEventId (★ CAL-1 fallback chain) ────────────────────────────

test("extractEventId: eventId 우선", () => {
  assert.equal(extractEventId({ eventId: "abc", id: "ignore" }), "abc");
});

test("extractEventId: id fallback", () => {
  assert.equal(extractEventId({ id: "fallback-id" }), "fallback-id");
});

test("extractEventId: googleEventId fallback", () => {
  assert.equal(extractEventId({ googleEventId: "ge1" }), "ge1");
});

test("extractEventId: event.id 중첩 fallback", () => {
  assert.equal(extractEventId({ event: { id: "nested" } }), "nested");
});

test("extractEventId: 모두 부재 → null (★ CAL-1 트리거)", () => {
  assert.equal(extractEventId({}), null);
  assert.equal(extractEventId(null), null);
  assert.equal(extractEventId({ otherKey: "x" }), null);
});

// ─── callAppsScript ──────────────────────────────────────────────────────

test("callAppsScript: URL 부재 → ok:false", async () => {
  const r = await callAppsScript(null, {});
  assert.equal(r.ok, false);
  assert.ok(r.error.includes("not configured"));
});

// ─── handleShootList ─────────────────────────────────────────────────────

test("handleShootList: shoot_index 반환", async () => {
  const env = makeEnv([
    { id: "shoot001", guest: "김철수", dateTime: "2026-05-15T10:00:00Z" },
  ]);
  const r = await handleShootList(env, HEADERS, ALICE);
  const body = await r.json();
  assert.equal(body.shoots.length, 1);
});

// ─── handleShootCreate ───────────────────────────────────────────────────

test("handleShootCreate: 정상 생성 (Apps Script 미구성 시 warnings 영역만)", async () => {
  const env = makeEnv([]);
  const r = await handleShootCreate(
    { guest: "김철수", topic: "주제", dateTime: "2026-05-15T10:00:00Z" },
    env, HEADERS, ALICE
  );
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.ok(body.shoot.id);
  assert.equal(body.shoot.guest, "김철수");
  assert.equal(body.shoot.stage, "pre-production");
  // calendar/email URL 미구성 → calendarEventId null
  assert.equal(body.shoot.calendarEventId, null);
});

test("handleShootCreate: guest 부재 → 400", async () => {
  const env = makeEnv([]);
  const r = await handleShootCreate({}, env, HEADERS, ALICE);
  assert.equal(r.status, 400);
});

test("handleShootCreate: 인증 X → 400", async () => {
  const env = makeEnv([]);
  const r = await handleShootCreate({ guest: "x" }, env, HEADERS, null);
  assert.equal(r.status, 400);
});

// ─── handleShootUpdate ───────────────────────────────────────────────────

test("handleShootUpdate: 정상 갱신 + Apps Script 미구성 (calendarEventId 있는 케이스)", async () => {
  const env = makeEnv([{
    id: "shoot001",
    guest: "김철수",
    topic: "옛 주제",
    dateTime: "2026-05-15T10:00:00Z",
    calendarEventId: "cal-event-1",
    roles: { filming: [], progress: [], scriptEdit: [], videoEdit: [] },
  }]);
  const r = await handleShootUpdate(
    { id: "shoot001", topic: "새 주제" },
    env, HEADERS, ALICE
  );
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.equal(body.shoot.topic, "새 주제");
});

test("handleShootUpdate: ★ CAL-1 — calendarEventId 결손 시 warnings 응답 노출", async () => {
  const env = makeEnv([{
    id: "shoot001",
    guest: "김철수",
    dateTime: "2026-05-15T10:00:00Z",
    calendarEventId: null,  // ★ 결손
    roles: { filming: [], progress: [], scriptEdit: [], videoEdit: [] },
  }]);
  // Apps Script URL 박제 (calendar 동기화 시도 trigger)
  env.APPS_SCRIPT_CALENDAR_URL = "https://example.com/calendar";
  const r = await handleShootUpdate(
    { id: "shoot001", dateTime: "2026-05-16T10:00:00Z" },  // dateChanged
    env, HEADERS, ALICE
  );
  const body = await r.json();
  assert.ok(body.warnings, "warnings 영역 존재");
  assert.ok(body.warnings.some((w) => w.includes("calendarEventId 결손")));
});

test("handleShootUpdate: 미존재 → 404", async () => {
  const env = makeEnv([]);
  const r = await handleShootUpdate({ id: "noexist1" }, env, HEADERS, ALICE);
  assert.equal(r.status, 404);
});

// ─── handleShootDelete ───────────────────────────────────────────────────

test("handleShootDelete: shoot_index 에서 entry 제거 + childProjects parentShootId 끊기", async () => {
  const env = makeEnv([{
    id: "shoot001",
    guest: "김철수",
    childProjectIds: ["proj0001"],
  }]);
  // project_index 에 child project 박제
  env.SESSIONS._set("project_index", JSON.stringify([
    { id: "proj0001", parentShootId: "shoot001" },
  ]));

  const r = await handleShootDelete({ id: "shoot001" }, env, HEADERS, ALICE);
  assert.equal(r.status, 200);

  // shoot_index 에서 제거됨
  const shoots = JSON.parse(env.SESSIONS._map.get("shoot_index"));
  assert.equal(shoots.length, 0);

  // child project 의 parentShootId null
  const projects = JSON.parse(env.SESSIONS._map.get("project_index"));
  assert.equal(projects[0].parentShootId, null);
});

test("handleShootDelete: ★ N7 — calendarEventId 결손 시 warnings", async () => {
  const env = makeEnv([{ id: "shoot001", guest: "x", calendarEventId: null }]);
  const r = await handleShootDelete({ id: "shoot001" }, env, HEADERS, ALICE);
  const body = await r.json();
  assert.ok(body.warnings.some((w) => w.includes("calendarEventId 결손")));
});

// ─── handleShootMoveStage ────────────────────────────────────────────────

test("handleShootMoveStage: 정상 stage 변경", async () => {
  const env = makeEnv([{ id: "shoot001", guest: "x", stage: "pre-production" }]);
  const r = await handleShootMoveStage(
    { id: "shoot001", stage: "editing" },
    env, HEADERS, ALICE
  );
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.equal(body.shoot.stage, "editing");
});

test("handleShootMoveStage: invalid stage → 400", async () => {
  const env = makeEnv([{ id: "shoot001", stage: "pre-production" }]);
  const r = await handleShootMoveStage(
    { id: "shoot001", stage: "invalid_stage" },
    env, HEADERS, ALICE
  );
  assert.equal(r.status, 400);
});

test("handleShootMoveStage: 4 valid stage 모두 통과", async () => {
  for (const stage of ["pre-production", "editing", "post-production", "done"]) {
    const env = makeEnv([{ id: "shoot001", stage: "pre-production" }]);
    const r = await handleShootMoveStage(
      { id: "shoot001", stage },
      env, HEADERS, ALICE
    );
    assert.equal(r.status, 200, `stage=${stage}`);
  }
});
