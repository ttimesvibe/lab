// CMS v2 — 권한 헬퍼 (P-1: 자동 테스트 가능 모듈)
// 4/15 권한 동반 제거 사고 (commit 680a100) 재발 방지를 위해 별도 모듈로 추출.
// worker/index.js 와 worker/__tests__/permissions.test.js 양쪽에서 import.

// admin 식별: 1차 JWT role, 2차 team_members KV fallback.
// team_members 는 auth Worker 가 /admin/users 로 동기화해 editor KV에 캐시하는 배열.
export async function isAdmin(user, env) {
  if (!user?.sub) return false;
  if (user.role === "admin") return true;
  try {
    const raw = await env.SESSIONS.get("team_members");
    if (!raw) return false;
    const members = JSON.parse(raw);
    const me = members.find((m) => m.email === user.sub);
    return me?.role === "admin";
  } catch {
    return false;
  }
}

// 프로젝트 수정 가능 여부: creator OR editors 배열 포함 OR admin
export async function canEdit(proj, user, env) {
  if (!proj || !user?.sub) return false;
  if (proj.creatorEmail === user.sub) return true;
  if ((proj.editors || []).some((e) => e?.email === user.sub)) return true;
  return await isAdmin(user, env);
}

// 프로젝트 삭제 가능 여부: creator OR admin (editors 는 삭제 불가 — PRD §3 정책)
export async function canDelete(proj, user, env) {
  if (!proj || !user?.sub) return false;
  if (proj.creatorEmail === user.sub) return true;
  return await isAdmin(user, env);
}

// 프로젝트 복구 가능 여부: creator OR deletedBy(본인이 지운 경우) OR admin
export async function canRestore(proj, user, env) {
  if (!proj || !user?.sub) return false;
  if (proj.creatorEmail === user.sub) return true;
  if (proj.deletedBy === user.sub) return true;
  return await isAdmin(user, env);
}

export function forbidden(headers, msg) {
  return new Response(JSON.stringify({ error: msg || "권한이 없습니다" }), { status: 403, headers });
}
