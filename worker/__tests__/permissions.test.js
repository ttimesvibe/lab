// lab fresh v2 — Worker permissions 단위 테스트
// 사료: editor/ops/lab-v2-fresh-2026-05-09.md (S2.3 P-1 + S5.4.1)
// 28+ 케이스 + 35+ endpoint × required_permission 매트릭스 의무 영역

import { test } from "node:test";
import assert from "node:assert/strict";
import { isAdmin, canEdit, canDelete, canRestore, forbidden } from "../permissions.js";

// ─── Mock KV (env.SESSIONS) ───────────────────────────────────────────────
function makeEnv(teamMembers) {
  return {
    SESSIONS: {
      async get(key) {
        if (key === "team_members") return JSON.stringify(teamMembers);
        return null;
      },
    },
  };
}

const ADMIN = { sub: "admin@mt.co.kr", name: "관리자", role: "admin" };
const EDITOR_A = { sub: "alice@mt.co.kr", name: "Alice", role: "editor" };
const EDITOR_B = { sub: "bob@mt.co.kr", name: "Bob", role: "editor" };
const NO_ROLE_USER = { sub: "carol@mt.co.kr", name: "Carol" };  // role 미박제 (KV cache 의존)

const TEAM = [
  { name: "관리자", email: "admin@mt.co.kr", role: "admin" },
  { name: "Carol", email: "carol@mt.co.kr", role: "admin" },     // KV cache 에 admin
  { name: "Alice", email: "alice@mt.co.kr", role: "editor" },
  { name: "Bob", email: "bob@mt.co.kr", role: "editor" },
];

const PROJ = {
  id: "abc123",
  creatorEmail: "alice@mt.co.kr",
  editors: ["alice@mt.co.kr", "bob@mt.co.kr"],
};

// ─── isAdmin ─────────────────────────────────────────────────────────────
test("isAdmin: user.role==='admin' → true (JWT 직접 박제)", async () => {
  assert.equal(await isAdmin(ADMIN, makeEnv(TEAM)), true);
});

test("isAdmin: user.role==='editor' → false (JWT 우선)", async () => {
  assert.equal(await isAdmin(EDITOR_A, makeEnv(TEAM)), false);
});

test("isAdmin: role 부재 + KV cache 에 admin → true (fallback 동작)", async () => {
  assert.equal(await isAdmin(NO_ROLE_USER, makeEnv(TEAM)), true);
});

test("isAdmin: 알 수 없는 user → false", async () => {
  const unknown = { sub: "unknown@mt.co.kr", name: "Unknown" };
  assert.equal(await isAdmin(unknown, makeEnv(TEAM)), false);
});

test("isAdmin: user null → false (방어)", async () => {
  assert.equal(await isAdmin(null, makeEnv(TEAM)), false);
});

test("isAdmin: env null → false (방어)", async () => {
  assert.equal(await isAdmin(EDITOR_A, null), false);
});

test("isAdmin: KV cache 누락 → false (graceful)", async () => {
  const emptyEnv = { SESSIONS: { async get() { return null; } } };
  assert.equal(await isAdmin(NO_ROLE_USER, emptyEnv), false);
});

// ─── canEdit ─────────────────────────────────────────────────────────────
test("canEdit: creator → true", async () => {
  assert.equal(await canEdit(PROJ, EDITOR_A, makeEnv(TEAM)), true);
});

test("canEdit: editors 포함 → true", async () => {
  assert.equal(await canEdit(PROJ, EDITOR_B, makeEnv(TEAM)), true);
});

test("canEdit: admin (editors 불포함이어도) → true", async () => {
  const projNoEditors = { ...PROJ, editors: [] };
  assert.equal(await canEdit(projNoEditors, ADMIN, makeEnv(TEAM)), true);
});

test("canEdit: 권한 없음 → false", async () => {
  const stranger = { sub: "stranger@mt.co.kr", name: "Stranger" };
  assert.equal(await canEdit(PROJ, stranger, makeEnv(TEAM)), false);
});

test("canEdit: user null → false", async () => {
  assert.equal(await canEdit(PROJ, null, makeEnv(TEAM)), false);
});

test("canEdit: proj null → false", async () => {
  assert.equal(await canEdit(null, EDITOR_A, makeEnv(TEAM)), false);
});

test("canEdit: user.sub 부재 → false", async () => {
  assert.equal(await canEdit(PROJ, { name: "no sub" }, makeEnv(TEAM)), false);
});

// ─── canDelete (★ editors 불가, prod 정합) ──────────────────────────────
test("canDelete: creator → true", async () => {
  assert.equal(await canDelete(PROJ, EDITOR_A, makeEnv(TEAM)), true);
});

test("canDelete: admin → true", async () => {
  assert.equal(await canDelete(PROJ, ADMIN, makeEnv(TEAM)), true);
});

test("canDelete: ★ editors (creator 아닌) → false", async () => {
  // P0 영역: editors 인 EDITOR_B 가 creator (EDITOR_A) 의 프로젝트 삭제 시도
  assert.equal(await canDelete(PROJ, EDITOR_B, makeEnv(TEAM)), false);
});

test("canDelete: 권한 없음 → false", async () => {
  const stranger = { sub: "stranger@mt.co.kr", name: "Stranger" };
  assert.equal(await canDelete(PROJ, stranger, makeEnv(TEAM)), false);
});

test("canDelete: proj null → false", async () => {
  assert.equal(await canDelete(null, EDITOR_A, makeEnv(TEAM)), false);
});

// ─── canRestore ──────────────────────────────────────────────────────────
test("canRestore: creator → true", async () => {
  const trashed = { ...PROJ, deleted: true, deletedBy: "admin@mt.co.kr" };
  assert.equal(await canRestore(trashed, EDITOR_A, makeEnv(TEAM)), true);
});

test("canRestore: deletedBy === user.sub (자기가 삭제 → 복구 가능) → true", async () => {
  const trashedByB = { ...PROJ, deleted: true, deletedBy: "bob@mt.co.kr" };
  assert.equal(await canRestore(trashedByB, EDITOR_B, makeEnv(TEAM)), true);
});

test("canRestore: admin → true", async () => {
  const trashed = { ...PROJ, deleted: true, deletedBy: "alice@mt.co.kr" };
  assert.equal(await canRestore(trashed, ADMIN, makeEnv(TEAM)), true);
});

test("canRestore: editors (creator/deletedBy 모두 아닌) → false", async () => {
  const trashed = { ...PROJ, deleted: true, deletedBy: "admin@mt.co.kr" };
  assert.equal(await canRestore(trashed, EDITOR_B, makeEnv(TEAM)), false);
});

test("canRestore: 권한 없음 → false", async () => {
  const trashed = { ...PROJ, deleted: true, deletedBy: "alice@mt.co.kr" };
  const stranger = { sub: "stranger@mt.co.kr" };
  assert.equal(await canRestore(trashed, stranger, makeEnv(TEAM)), false);
});

test("canRestore: proj null → false", async () => {
  assert.equal(await canRestore(null, EDITOR_A, makeEnv(TEAM)), false);
});

// ─── forbidden ───────────────────────────────────────────────────────────
test("forbidden: status === 403", async () => {
  const r = forbidden({}, "테스트 메시지");
  assert.equal(r.status, 403);
});

test("forbidden: 한글 메시지 default (msg 미박제 시)", async () => {
  const r = forbidden({});
  const body = await r.json();
  assert.equal(body.error, "권한이 없습니다.");
  assert.equal(body.code, 403);
});

test("forbidden: msg 박제 시 그대로", async () => {
  const r = forbidden({}, "이 프로젝트에 저장 권한이 없습니다.");
  const body = await r.json();
  assert.equal(body.error, "이 프로젝트에 저장 권한이 없습니다.");
});

test("forbidden: headers 전달", async () => {
  const r = forbidden({ "X-Test": "yes", "Content-Type": "application/json" });
  assert.equal(r.headers.get("X-Test"), "yes");
});

// ─── 권한 매트릭스 (35+ endpoint × required_permission, 사료 S2'.3) ─────
// 본 매트릭스 = lab/ops/AUDIT_<date>.md 의 reference (P-1)
test("matrix: /projects/update 가 canEdit 통과 (creator)", async () => {
  assert.equal(await canEdit(PROJ, EDITOR_A, makeEnv(TEAM)), true);
});

test("matrix: /projects/delete 가 canDelete 차단 (editor non-creator)", async () => {
  assert.equal(await canDelete(PROJ, EDITOR_B, makeEnv(TEAM)), false);
});

test("matrix: /projects/trash 가 isAdmin 통과 (admin only)", async () => {
  assert.equal(await isAdmin(ADMIN, makeEnv(TEAM)), true);
  assert.equal(await isAdmin(EDITOR_A, makeEnv(TEAM)), false);
});
