// lab fresh v2 — Worker team_members handler
// 사료: editor/ops/lab-v2-fresh-2026-05-09.md (S2.5 auth Worker /admin/users 캐시)
//
// GET /team/members  → team_members KV 캐시 반환 (auth Worker 동기 trigger)

import { logPrefix, jsonResponse, serverError } from "./utils.js";

const TEAM_MEMBERS_KEY = "team_members";

/**
 * GET /team/members
 *
 * - team_members KV 캐시 반환
 * - 캐시 미존재 시 (또는 만료 — 향후) auth Worker /admin/users 호출
 *   현 baseline: KV 캐시 read 만 (auth Worker 호출은 별 마일스톤)
 */
export async function handleTeamMembers(env, headers, user) {
  if (!env || !env.SESSIONS) return serverError(headers, "KV not configured");

  // KV 캐시 read
  let members = [];
  try {
    const raw = await env.SESSIONS.get(TEAM_MEMBERS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) members = parsed;
    }
  } catch (e) {
    console.error(logPrefix("auth", "team_members read failed", e?.message));
  }

  // 향후: 캐시 만료 (TTL) 검사 + auth Worker /admin/users fetch + KV write-through
  // (env.AUTH_WORKER_URL + JWT 동봉 — 별 마일스톤)

  return jsonResponse({ success: true, members }, { status: 200 }, headers);
}
