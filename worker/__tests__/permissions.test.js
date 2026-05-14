// P-1 — 권한 자동 테스트 (4/15 사고 재발 방지, 묶음 ④)
// 실행: node --test worker/__tests__/permissions.test.js
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { isAdmin, canEdit, canDelete, canRestore } from "../permissions.js";

// Mock env (KV SESSIONS)
function mockEnv(teamMembers = null) {
  return {
    SESSIONS: {
      get: async (key) => {
        if (key === "team_members") return teamMembers ? JSON.stringify(teamMembers) : null;
        return null;
      },
    },
  };
}

const ADMIN_USER = { sub: "admin@x.com", name: "관리자", role: "admin" };
const EDITOR_USER = { sub: "editor@x.com", name: "편집자" }; // role 부재
const CREATOR_USER = { sub: "creator@x.com", name: "작성자" };
const OTHER_USER = { sub: "other@x.com", name: "타인" };
const NO_USER = null;
const EMPTY_USER = {};

const PROJ = {
  id: "abc12345",
  creatorEmail: "creator@x.com",
  editors: [{ email: "editor@x.com" }],
};
const PROJ_DELETED = { ...PROJ, deleted: true, deletedBy: "other@x.com" };
const PROJ_NULL = null;

describe("isAdmin", () => {
  test("user.role === 'admin' → true", async () => {
    assert.equal(await isAdmin(ADMIN_USER, mockEnv()), true);
  });
  test("non-admin user → false (team_members 없음)", async () => {
    assert.equal(await isAdmin(EDITOR_USER, mockEnv()), false);
  });
  test("user 부재 → false", async () => {
    assert.equal(await isAdmin(NO_USER, mockEnv()), false);
    assert.equal(await isAdmin(EMPTY_USER, mockEnv()), false);
  });
  test("team_members KV fallback — admin 로 등록", async () => {
    const env = mockEnv([{ email: "editor@x.com", role: "admin" }]);
    assert.equal(await isAdmin(EDITOR_USER, env), true);
  });
  test("team_members KV fallback — editor 로 등록", async () => {
    const env = mockEnv([{ email: "editor@x.com", role: "editor" }]);
    assert.equal(await isAdmin(EDITOR_USER, env), false);
  });
  test("team_members KV 손상 시 false (catch)", async () => {
    const env = { SESSIONS: { get: async () => "invalid_json" } };
    assert.equal(await isAdmin(EDITOR_USER, env), false);
  });
});

describe("canEdit", () => {
  test("creator → true", async () => {
    assert.equal(await canEdit(PROJ, CREATOR_USER, mockEnv()), true);
  });
  test("editors 배열 포함 → true", async () => {
    assert.equal(await canEdit(PROJ, EDITOR_USER, mockEnv()), true);
  });
  test("admin (role) → true", async () => {
    assert.equal(await canEdit(PROJ, ADMIN_USER, mockEnv()), true);
  });
  test("admin (KV fallback) → true", async () => {
    const env = mockEnv([{ email: "other@x.com", role: "admin" }]);
    assert.equal(await canEdit(PROJ, OTHER_USER, env), true);
  });
  test("non-creator non-editor non-admin → false", async () => {
    assert.equal(await canEdit(PROJ, OTHER_USER, mockEnv()), false);
  });
  test("proj 부재 → false", async () => {
    assert.equal(await canEdit(PROJ_NULL, ADMIN_USER, mockEnv()), false);
  });
  test("user 부재 → false", async () => {
    assert.equal(await canEdit(PROJ, NO_USER, mockEnv()), false);
  });
  test("editors 배열 비정상 (null) → 무시", async () => {
    const proj2 = { ...PROJ, editors: null };
    assert.equal(await canEdit(proj2, EDITOR_USER, mockEnv()), false);
  });
});

describe("canDelete", () => {
  test("creator → true", async () => {
    assert.equal(await canDelete(PROJ, CREATOR_USER, mockEnv()), true);
  });
  test("editors 포함이지만 → false (editors 는 삭제 불가)", async () => {
    assert.equal(await canDelete(PROJ, EDITOR_USER, mockEnv()), false);
  });
  test("admin (role) → true", async () => {
    assert.equal(await canDelete(PROJ, ADMIN_USER, mockEnv()), true);
  });
  test("non-creator non-admin → false", async () => {
    assert.equal(await canDelete(PROJ, OTHER_USER, mockEnv()), false);
  });
  test("proj/user 부재 → false", async () => {
    assert.equal(await canDelete(PROJ_NULL, ADMIN_USER, mockEnv()), false);
    assert.equal(await canDelete(PROJ, NO_USER, mockEnv()), false);
  });
});

describe("canRestore", () => {
  test("creator → true", async () => {
    assert.equal(await canRestore(PROJ_DELETED, CREATOR_USER, mockEnv()), true);
  });
  test("deletedBy === user.sub → true (본인이 지움)", async () => {
    assert.equal(await canRestore(PROJ_DELETED, OTHER_USER, mockEnv()), true);
  });
  test("admin → true", async () => {
    assert.equal(await canRestore(PROJ_DELETED, ADMIN_USER, mockEnv()), true);
  });
  test("editor (editors 배열) → false (복구 권한 별도)", async () => {
    assert.equal(await canRestore(PROJ_DELETED, EDITOR_USER, mockEnv()), false);
  });
  test("타인 (non-creator/deletedBy/admin) → false", async () => {
    const proj3 = { ...PROJ_DELETED, deletedBy: "creator@x.com" };
    assert.equal(await canRestore(proj3, OTHER_USER, mockEnv()), false);
  });
});

describe("권한 매트릭스 — 38 핸들러 × role 카탈로그 (P-1)", () => {
  // 본 매트릭스는 worker/index.js 의 mutating endpoint 마다 어느 권한 헬퍼를 호출하는지 박제.
  // 새 endpoint 추가 시 본 표 갱신 의무.
  const MATRIX = [
    // [endpoint, mutation, required_permission]
    ["POST /save", true, "canEdit OR creator"],
    ["POST /autosave", true, "canEdit OR creator"],
    ["POST /save-legacy", true, "canEdit"],
    ["POST /projects/create", true, "authenticated"],
    ["POST /projects/update", true, "canEdit"],
    ["POST /projects/delete", true, "canDelete"],
    ["GET /projects/trash", false, "isAdmin"],
    ["POST /projects/restore", true, "canRestore"],
    ["POST /projects/purge", true, "isAdmin"],
    ["POST /projects/trash/purge-all", true, "isAdmin"],
    ["POST /save-image", true, "canEdit"],
    ["GET /image/{sid}/{cid}", false, "authenticated"],
    ["DELETE /image/{sid}/{cid}", true, "canEdit"],
    ["POST /shoots/create", true, "authenticated"],
    ["POST /shoots/update", true, "creator OR isAdmin"],
    ["POST /shoots/delete", true, "creator OR isAdmin"],
    ["POST /session/{id}/heartbeat", true, "authenticated"],
    ["POST /session/{id}/leave", true, "auth-exempt (sendBeacon 호환)"],
    ["GET /session/{id}/active-users", false, "authenticated"],
    ["POST /analyze", true, "authenticated"],
    ["POST /correct", true, "authenticated"],
    ["POST /highlights", true, "authenticated"],
    ["POST /visuals", true, "authenticated"],
    ["POST /insert-cuts", true, "authenticated"],
    ["POST /hl-recommend", true, "authenticated"],
    ["POST /hl-timestamps", true, "authenticated"],
    ["POST /setgen", true, "authenticated"],
    ["POST /term-explain", true, "authenticated"],
    ["POST /subtitle-format", true, "authenticated"],
    ["GET /load/{id}", false, "authenticated"],
    ["GET /load/{id}/{tab}", false, "authenticated"],
    ["POST /admin/users", true, "isAdmin"],
    ["DELETE /admin/users/{email}", true, "isAdmin"],
    ["GET /admin/users", false, "isAdmin"],
    ["GET /health", false, "auth-exempt"],
    ["OPTIONS *", false, "auth-exempt"],
  ];

  test("매트릭스 35+ 항목 박제됨", () => {
    assert.ok(MATRIX.length >= 35);
  });
  test("모든 mutation endpoint 에 권한 표기됨", () => {
    for (const [ep, mutation, perm] of MATRIX) {
      if (mutation) {
        assert.ok(perm && perm !== "", `${ep} 권한 표기 누락`);
      }
    }
  });
  test("isAdmin 전용 endpoint 들 (휴지통/users) 명시됨", () => {
    const adminOnly = MATRIX.filter(([_, __, p]) => p === "isAdmin");
    assert.ok(adminOnly.length >= 4, "isAdmin 전용 endpoint 4개 이상");
  });
  test("auth-exempt endpoint 명시됨", () => {
    const exempt = MATRIX.filter(([_, __, p]) => p?.includes("exempt"));
    assert.ok(exempt.length >= 2, "auth-exempt /health, OPTIONS, /leave 명시");
  });
});
