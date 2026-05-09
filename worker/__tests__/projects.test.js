// lab fresh v2 — Worker Part 2 단위 테스트 (프로젝트 핸들러 9 개)
// 사료: S2.4.4 + S2.10 K-3 + S1.9 N3/N8 + S3.8 W-3/W-4

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  generateId,
  recalculateCurrentStep,
  handleProjectList,
  handleProjectCreate,
  handleProjectUpdate,
  handleProjectDelete,
  handleProjectRestore,
  handleProjectTrash,
  handleProjectTrashPurge,
  handleProjectUpdateStep,
  handleProjectRebuildIndex,
} from "../projects.js";

// ─── Mock KV ─────────────────────────────────────────────────────────────

function makeKV(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    async get(key) { return map.has(key) ? map.get(key) : null; },
    async put(key, value, opts) { map.set(key, value); return; },
    async delete(key) { map.delete(key); },
    async list({ prefix, cursor, limit } = {}) {
      const keys = [];
      for (const k of map.keys()) {
        if (!prefix || k.startsWith(prefix)) keys.push({ name: k });
      }
      return { keys, list_complete: true, cursor: null };
    },
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

function makeEnv(projectIndex = []) {
  const SESSIONS = makeKV({
    project_index: JSON.stringify(projectIndex),
    team_members: JSON.stringify(TEAM),
  });
  return { SESSIONS };
}

// ─── 헬퍼 검증 ────────────────────────────────────────────────────────────

test("generateId: 8자 default + lowercase alphanumeric (VALID_ID_RE)", () => {
  const id = generateId();
  assert.equal(id.length, 8);
  assert.ok(/^[a-z0-9]{8}$/.test(id));
});

test("generateId: 가변 길이 (4~24)", () => {
  assert.equal(generateId(4).length, 4);
  assert.equal(generateId(24).length, 24);
  assert.ok(/^[a-z0-9]{4}$/.test(generateId(4)));
});

test("recalculateCurrentStep: 가장 마지막 step (W-4)", () => {
  const stages = {
    review: { updatedAt: "T1" },
    correction: { updatedAt: "T2" },
    guide: { updatedAt: "T3" },
  };
  // STEP_ORDER 순서로 가장 마지막 step
  assert.equal(recalculateCurrentStep(stages), "guide");
});

test("recalculateCurrentStep: stages 부재 → null", () => {
  assert.equal(recalculateCurrentStep({}), null);
  assert.equal(recalculateCurrentStep(null), null);
});

// ─── handleProjectList ───────────────────────────────────────────────────

test("handleProjectList: deleted X entries 만 (default)", async () => {
  const env = makeEnv([
    { id: "proj0001", fn: "A", creatorEmail: "alice@mt.co.kr" },
    { id: "proj0002", fn: "B", creatorEmail: "bob@mt.co.kr", deleted: true, deletedAt: "T0" },
  ]);
  const r = await handleProjectList({}, env, HEADERS, ALICE);
  const body = await r.json();
  assert.equal(body.projects.length, 1);
  assert.equal(body.projects[0].id, "proj0001");
});

test("handleProjectList: filter=mine 만 user 매칭", async () => {
  const env = makeEnv([
    { id: "proj0001", fn: "A", creatorEmail: "alice@mt.co.kr", editors: ["alice@mt.co.kr"] },
    { id: "proj0002", fn: "B", creatorEmail: "bob@mt.co.kr", editors: ["bob@mt.co.kr"] },
    { id: "proj0003", fn: "C", creatorEmail: "bob@mt.co.kr", editors: ["alice@mt.co.kr"] },  // 공동 편집
  ]);
  const r = await handleProjectList({ filter: "mine" }, env, HEADERS, ALICE);
  const body = await r.json();
  assert.equal(body.projects.length, 2);  // proj0001 (creator) + proj0003 (editor)
});

// ─── handleProjectCreate ─────────────────────────────────────────────────

test("handleProjectCreate: 정상 생성 (id 자동 + creator 박제)", async () => {
  const env = makeEnv([]);
  const r = await handleProjectCreate(
    { fn: "test_project", memo: "메모" },
    env, HEADERS, ALICE
  );
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.ok(body.id);
  assert.ok(/^[a-z0-9]{8}$/.test(body.id));
  assert.equal(body.project.fn, "test_project");
  assert.equal(body.project.creatorEmail, "alice@mt.co.kr");
  assert.ok(body.project.editors.includes("alice@mt.co.kr"));

  // project_index 갱신 검증
  const arr = JSON.parse(env.SESSIONS._map.get("project_index"));
  assert.equal(arr.length, 1);
  // meta 생성 검증
  const meta = JSON.parse(env.SESSIONS._map.get(`s:${body.id}:meta`));
  assert.equal(meta.creator.sub, "alice@mt.co.kr");
});

test("handleProjectCreate: fn 부재 → 400", async () => {
  const env = makeEnv([]);
  const r = await handleProjectCreate({}, env, HEADERS, ALICE);
  assert.equal(r.status, 400);
});

test("handleProjectCreate: 인증 X → 403", async () => {
  const env = makeEnv([]);
  const r = await handleProjectCreate({ fn: "x" }, env, HEADERS, null);
  assert.equal(r.status, 403);
});

// ─── handleProjectUpdate ─────────────────────────────────────────────────

test("handleProjectUpdate: canEdit (creator) → 갱신 OK", async () => {
  const env = makeEnv([{
    id: "proj0001",
    fn: "old_fn",
    creatorEmail: "alice@mt.co.kr",
    editors: ["alice@mt.co.kr"],
  }]);
  const r = await handleProjectUpdate(
    { id: "proj0001", fn: "new_fn", memo: "갱신" },
    env, HEADERS, ALICE
  );
  assert.equal(r.status, 200);
  const arr = JSON.parse(env.SESSIONS._map.get("project_index"));
  assert.equal(arr[0].fn, "new_fn");
  assert.equal(arr[0].memo, "갱신");
});

test("handleProjectUpdate: canEdit X (stranger) → 403", async () => {
  const env = makeEnv([{
    id: "proj0001",
    creatorEmail: "alice@mt.co.kr",
    editors: ["alice@mt.co.kr"],
  }]);
  const r = await handleProjectUpdate(
    { id: "proj0001", fn: "evil" },
    env, HEADERS, { sub: "stranger@mt.co.kr" }
  );
  assert.equal(r.status, 403);
});

test("handleProjectUpdate: 미존재 → 404", async () => {
  const env = makeEnv([]);
  const r = await handleProjectUpdate(
    { id: "noexist1", fn: "x" },
    env, HEADERS, ALICE
  );
  assert.equal(r.status, 404);
});

// ─── handleProjectDelete (★ K-3 + W-4) ──────────────────────────────────

test("handleProjectDelete: canDelete (creator) → soft-delete + purgeEligibleAt", async () => {
  const env = makeEnv([{
    id: "proj0001",
    creatorEmail: "alice@mt.co.kr",
    editors: ["alice@mt.co.kr"],
    stage: "editing",
  }]);
  const r = await handleProjectDelete({ id: "proj0001" }, env, HEADERS, ALICE);
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.equal(body.softDeleted, true);
  assert.ok(body.purgeEligibleAt);  // ★ N3 영역 — 응답에 노출

  const arr = JSON.parse(env.SESSIONS._map.get("project_index"));
  assert.equal(arr[0].deleted, true);
  assert.ok(arr[0].purgeEligibleAt);  // ★ K-3
  assert.equal(arr[0].deletedBy, "alice@mt.co.kr");
});

test("handleProjectDelete: ★ editors (creator 아닌) → 403 (canDelete X)", async () => {
  const env = makeEnv([{
    id: "proj0001",
    creatorEmail: "alice@mt.co.kr",
    editors: ["alice@mt.co.kr", "bob@mt.co.kr"],
  }]);
  const r = await handleProjectDelete({ id: "proj0001" }, env, HEADERS, BOB);
  assert.equal(r.status, 403);
});

test("handleProjectDelete: admin → 403 우회 (canDelete OK)", async () => {
  const env = makeEnv([{
    id: "proj0001",
    creatorEmail: "alice@mt.co.kr",
    editors: ["alice@mt.co.kr"],
  }]);
  const r = await handleProjectDelete({ id: "proj0001" }, env, HEADERS, ADMIN);
  assert.equal(r.status, 200);
});

// ─── handleProjectRestore (★ W-4) ───────────────────────────────────────

test("handleProjectRestore: canRestore + ★ stage 재계산 (W-4)", async () => {
  const env = makeEnv([{
    id: "proj0001",
    creatorEmail: "alice@mt.co.kr",
    editors: ["alice@mt.co.kr"],
    deleted: true,
    deletedAt: "T0",
    deletedBy: "alice@mt.co.kr",
    purgeEligibleAt: "T+30",
    _preDoneStage: "editing",
    stage: "done",
  }]);
  // meta 박제 (stage 재계산 reference)
  env.SESSIONS._set("s:proj0001:meta", JSON.stringify({
    sessionId: "proj0001",
    stages: {
      review: { updatedAt: "T1" },
      correction: { updatedAt: "T2" },
      guide: { updatedAt: "T3" },
    },
  }));

  const r = await handleProjectRestore({ id: "proj0001" }, env, HEADERS, ALICE);
  assert.equal(r.status, 200);
  const arr = JSON.parse(env.SESSIONS._map.get("project_index"));
  // deleted 플래그 제거
  assert.equal(arr[0].deleted, undefined);
  assert.equal(arr[0].purgeEligibleAt, undefined);
  // ★ stage 재계산 (W-4)
  assert.equal(arr[0].currentStep, "guide");
  // _preDoneStage 복원
  assert.equal(arr[0].stage, "editing");
});

test("handleProjectRestore: canRestore X (stranger) → 403", async () => {
  const env = makeEnv([{
    id: "proj0001",
    creatorEmail: "alice@mt.co.kr",
    deleted: true,
    deletedBy: "alice@mt.co.kr",
  }]);
  const r = await handleProjectRestore(
    { id: "proj0001" }, env, HEADERS, { sub: "stranger@mt.co.kr" }
  );
  assert.equal(r.status, 403);
});

// ─── handleProjectTrash (★ N3 — purgeEligibleAt 응답) ──────────────────

test("handleProjectTrash: isAdmin only", async () => {
  const env = makeEnv([{
    id: "proj0001",
    deleted: true,
    deletedAt: "T0",
    purgeEligibleAt: "T+30",
  }]);
  const r1 = await handleProjectTrash(env, HEADERS, ADMIN);
  assert.equal(r1.status, 200);
  const r2 = await handleProjectTrash(env, HEADERS, ALICE);
  assert.equal(r2.status, 403);
});

test("handleProjectTrash: ★ N3 — purgeEligibleAt 응답 노출", async () => {
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const env = makeEnv([
    { id: "proj0001", deleted: true, deletedAt: yesterday, purgeEligibleAt: "T+30" },
    { id: "proj0002", deleted: false },
  ]);
  const r = await handleProjectTrash(env, HEADERS, ADMIN);
  const body = await r.json();
  assert.equal(body.trashed.length, 1);
  assert.equal(body.trashed[0].id, "proj0001");
  assert.equal(body.trashed[0].purgeEligibleAt, "T+30");  // ★ N3
  assert.ok(typeof body.trashed[0].daysInTrash === "number");
  assert.ok(body.trashed[0].daysInTrash >= 0);
});

// ─── handleProjectTrashPurge (★ N8 active 키 정리) ─────────────────────

test("handleProjectTrashPurge: isAdmin only + 모든 탭/active/index 삭제 (★ N8)", async () => {
  const env = makeEnv([
    { id: "proj0001", deleted: true, deletedAt: "T0" },
  ]);
  // 사전 박제
  env.SESSIONS._set("s:proj0001:correction", JSON.stringify({ x: 1 }));
  env.SESSIONS._set("s:proj0001:meta", JSON.stringify({ sessionId: "proj0001" }));
  env.SESSIONS._set("active:proj0001", JSON.stringify({ "alice@mt.co.kr": { lastBeat: Date.now() } }));
  env.SESSIONS._set("session_index", JSON.stringify([{ id: "proj0001" }]));

  // editor 시도 → 403
  const r1 = await handleProjectTrashPurge(
    { ids: ["proj0001"] }, env, HEADERS, ALICE
  );
  assert.equal(r1.status, 403);

  // admin → 200
  const r2 = await handleProjectTrashPurge(
    { ids: ["proj0001"] }, env, HEADERS, ADMIN
  );
  assert.equal(r2.status, 200);
  const body = await r2.json();
  assert.deepEqual(body.purged, ["proj0001"]);

  // 검증: 탭 키 / active 키 / project_index entry 모두 삭제
  assert.equal(env.SESSIONS._has("s:proj0001:correction"), false);
  assert.equal(env.SESSIONS._has("s:proj0001:meta"), false);
  assert.equal(env.SESSIONS._has("active:proj0001"), false);  // ★ N8
  const arr = JSON.parse(env.SESSIONS._map.get("project_index"));
  assert.equal(arr.length, 0);
});

test("handleProjectTrashPurge: deleted 안 된 프로젝트 → purge 거부 (warning)", async () => {
  const env = makeEnv([{ id: "proj0001", deleted: false }]);
  const r = await handleProjectTrashPurge(
    { ids: ["proj0001"] }, env, HEADERS, ADMIN
  );
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.equal(body.purged.length, 0);
  assert.ok(body.warnings.some((w) => w.includes("deleted 상태가 아님")));
});

test("handleProjectTrashPurge: ids 배열 부재 → 400", async () => {
  const env = makeEnv([]);
  const r = await handleProjectTrashPurge({}, env, HEADERS, ADMIN);
  assert.equal(r.status, 400);
});

// ─── handleProjectUpdateStep ─────────────────────────────────────────────

test("handleProjectUpdateStep: canEdit + currentStep 갱신", async () => {
  const env = makeEnv([{
    id: "proj0001",
    creatorEmail: "alice@mt.co.kr",
    editors: ["alice@mt.co.kr"],
    currentStep: "review",
    stepProgress: {},
  }]);
  const r = await handleProjectUpdateStep(
    { id: "proj0001", currentStep: "guide", stepProgress: { guide: 50 } },
    env, HEADERS, ALICE
  );
  assert.equal(r.status, 200);
  const arr = JSON.parse(env.SESSIONS._map.get("project_index"));
  assert.equal(arr[0].currentStep, "guide");
  assert.equal(arr[0].stepProgress.guide, 50);
});

test("handleProjectUpdateStep: canEdit X → 403", async () => {
  const env = makeEnv([{ id: "proj0001", creatorEmail: "alice@mt.co.kr", editors: [] }]);
  const r = await handleProjectUpdateStep(
    { id: "proj0001", currentStep: "evil" },
    env, HEADERS, { sub: "stranger@mt.co.kr" }
  );
  assert.equal(r.status, 403);
});

// ─── handleProjectRebuildIndex ───────────────────────────────────────────

test("handleProjectRebuildIndex: 누락 entry 자동 추가 (안전망)", async () => {
  const env = makeEnv([]);
  // KV 에 meta 만 있고 project_index 에 없는 케이스
  env.SESSIONS._set("s:abc12345:meta", JSON.stringify({
    sessionId: "abc12345",
    fn: "Recovered",
    createdAt: "T0",
    updatedAt: "T1",
    stages: { review: { updatedAt: "T1" } },
    creator: { sub: "alice@mt.co.kr", name: "Alice" },
  }));
  const r = await handleProjectRebuildIndex(env, HEADERS, ALICE);
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.deepEqual(body.added, ["abc12345"]);

  const arr = JSON.parse(env.SESSIONS._map.get("project_index"));
  assert.equal(arr.length, 1);
  assert.equal(arr[0].fn, "Recovered");
  assert.equal(arr[0].currentStep, "review");
});

test("handleProjectRebuildIndex: 기존 entry 보존 (덮어쓰기 X)", async () => {
  const env = makeEnv([{ id: "abc12345", fn: "Original", creatorEmail: "x" }]);
  env.SESSIONS._set("s:abc12345:meta", JSON.stringify({ fn: "Different" }));
  const r = await handleProjectRebuildIndex(env, HEADERS, ALICE);
  const body = await r.json();
  assert.equal(body.added.length, 0);  // 이미 있어서 추가 안 됨

  const arr = JSON.parse(env.SESSIONS._map.get("project_index"));
  assert.equal(arr[0].fn, "Original");  // 기존 보존
});

test("handleProjectRebuildIndex: 인증 X → 403", async () => {
  const env = makeEnv([]);
  const r = await handleProjectRebuildIndex(env, HEADERS, null);
  assert.equal(r.status, 403);
});
