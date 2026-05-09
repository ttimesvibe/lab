// lab fresh v2 — Worker shared dictionary handlers
// 사료: editor/ops/lab-v2-fresh-2026-05-09.md (S2.5 + S2'.3 /dict GET/POST)
//
// GET  /dict          → 팀 공유 단어장 반환
// POST /dict          → 단어장 갱신 (모든 인증 사용자)

import { logPrefix, jsonResponse, badRequest, serverError } from "./utils.js";
import { sanitizePayload } from "./merge.js";

const DICT_KEY = "shared_dict";

/**
 * GET /dict
 */
export async function handleDictGet(env, headers, user) {
  if (!env || !env.SESSIONS) return serverError(headers, "KV not configured");
  let dict = [];
  try {
    const raw = await env.SESSIONS.get(DICT_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) dict = parsed;
    }
  } catch (e) {
    console.error(logPrefix("save-flow", "dict read failed", e?.message));
  }
  return jsonResponse({ success: true, dict }, { status: 200 }, headers);
}

/**
 * POST /dict  body: { dict: [...] }
 *
 * 모든 인증 사용자 (admin 전용 X — 사료 정합).
 * 향후 viewer 도입 시 권한 매트릭스 갱신.
 */
export async function handleDictPost(body, env, headers, user) {
  if (!env || !env.SESSIONS) return serverError(headers, "KV not configured");
  if (!user || !user.sub) return badRequest(headers, "인증 필요");
  if (!body || !Array.isArray(body.dict)) {
    return badRequest(headers, "dict (배열) 필수");
  }

  const cleanDict = sanitizePayload(body.dict);
  try {
    await env.SESSIONS.put(DICT_KEY, JSON.stringify(cleanDict));
  } catch (e) {
    console.error(logPrefix("save-flow", "dict write failed", e?.message));
    return serverError(headers, "KV write failed");
  }
  return jsonResponse({ success: true, count: cleanDict.length }, { status: 200 }, headers);
}
