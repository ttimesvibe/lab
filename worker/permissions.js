// lab fresh v2 — Worker permissions
// 사료: editor/ops/lab-v2-fresh-2026-05-09.md (S2.3 + S2'.4 + S5.1 A11.3)
//
// 책임:
//   - isAdmin    : user.role==="admin" OR team_members KV 의 admin 매칭
//   - canEdit    : creatorEmail OR project.editors 포함 OR admin
//   - canDelete  : creatorEmail OR admin (editors 불가)
//   - canRestore : creator OR deletedBy === user.sub OR admin
//   - forbidden  : 403 응답 헬퍼
//
// 진입 순서 (B7, S5.1 A11.4):
//   1. body 검증 → 2. 인증 (JWT) → 3. KV.get(s:{id}:meta) → 4. canEdit (★ 머지 전)
//   → 5. checkDeletedAndForbidden (B11) → 6. sanitizePayload → 7. mergeTabData
//
// 사용자 결정 (S3.8 P-1, P-2):
//   - 28+ 단위 테스트 + 35+ endpoint × required_permission 매트릭스 의무
//   - meta.creator = handleSave + handleAutoSave 모두 박제 (★ N1 0 부터 차단)

const TEAM_MEMBERS_KEY = "team_members";

/**
 * Read team_members KV cache.
 * Returns array of { name, email, role } or [] if absent / parse error.
 */
async function readTeamMembers(env) {
  if (!env || !env.SESSIONS) return [];
  try {
    const raw = await env.SESSIONS.get(TEAM_MEMBERS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Check if user has admin role.
 * - First check: user.role === "admin" (JWT 측 박제)
 * - Fallback: team_members KV 에서 email → role 조회
 */
export async function isAdmin(user, env) {
  if (!user) return false;
  if (user.role === "admin") return true;
  if (!user.sub) return false;
  const members = await readTeamMembers(env);
  const m = members.find((x) => x && x.email === user.sub);
  return !!(m && m.role === "admin");
}

/**
 * Can the user edit the project?
 *   - creator (proj.creatorEmail === user.sub) OR
 *   - editors 포함 (proj.editors 가 user.sub 포함) OR
 *   - admin
 */
export async function canEdit(proj, user, env) {
  if (!user || !user.sub) return false;
  if (!proj) return false;
  if (proj.creatorEmail && proj.creatorEmail === user.sub) return true;
  if (Array.isArray(proj.editors) && proj.editors.includes(user.sub)) return true;
  return await isAdmin(user, env);
}

/**
 * Can the user delete the project?
 *   - creator OR admin (★ editors 불가, prod 정합)
 */
export async function canDelete(proj, user, env) {
  if (!user || !user.sub) return false;
  if (!proj) return false;
  if (proj.creatorEmail && proj.creatorEmail === user.sub) return true;
  return await isAdmin(user, env);
}

/**
 * Can the user restore the project from trash?
 *   - creator OR deletedBy === user.sub OR admin
 */
export async function canRestore(proj, user, env) {
  if (!user || !user.sub) return false;
  if (!proj) return false;
  if (proj.creatorEmail && proj.creatorEmail === user.sub) return true;
  if (proj.deletedBy && proj.deletedBy === user.sub) return true;
  return await isAdmin(user, env);
}

/**
 * Build a 403 Forbidden response.
 *   - 한글 메시지 default (S4c.4 E9 정합)
 *   - JSON body { error, code: 403 }
 */
export function forbidden(headers, msg) {
  const message = msg || "권한이 없습니다.";
  return new Response(
    JSON.stringify({ error: message, code: 403 }),
    { status: 403, headers: headers || { "Content-Type": "application/json" } }
  );
}
