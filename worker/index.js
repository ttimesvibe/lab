// lab fresh v2 — Cloudflare Worker (Part 1: 라우팅 + 인증/헬스체크 + 세션 핸들러)
// 사료: editor/ops/lab-v2-fresh-2026-05-09.md
//   - S5.1 A11 worker baseline
//   - S2.3 권한 진입 순서 (B7)
//   - S3.3 B1 mergeTabData + S3.4 Phase 1+2+3
//   - S2'.3 35+ endpoint 카탈로그
//   - S4c.4 silent failure 5 영역 + 응답 표준
//
// Part 1 책임 (M1.4.b):
//   - 라우팅 (fetch + URL pattern)
//   - /health (인증 X)
//   - /save / /save-legacy / /autosave (handleSave 12 단계 진입)
//   - /load/:id / /load/:id/:tab
//   - /sessions / /sessions/delete
//   - /session/:id/heartbeat (인증 게이트)
//   - /session/:id/leave (★ 인증 면제, sendBeacon)
//   - /session/:id/active-users
//
// Part 2/3 (M1.4.c/d): 프로젝트/촬영/팀/사전/AI 핸들러 (별 마일스톤)

import {
  VALID_TAB_KEYS,
  PROMPT_INJECTION_GUARD,
  corsHeaders,
  verifyAuth,
  isValidTab,
  isValidId,
  logPrefix,
  jsonResponse,
  badRequest,
  unauthorized,
  notFound,
  conflictResponse,
  serverError,
} from "./utils.js";
import {
  mergeTabData,
  sanitizePayload,
  detectConflict,
  validateMergeResult,
  PROTO_KEYS,
} from "./merge.js";
import { canEdit, forbidden } from "./permissions.js";
import {
  handleProjectList,
  handleProjectCreate,
  handleProjectUpdate,
  handleProjectDelete,
  handleProjectRestore,
  handleProjectTrash,
  handleProjectTrashPurge,
  handleProjectUpdateStep,
  handleProjectRebuildIndex,
} from "./projects.js";
import {
  handleShootList,
  handleShootCreate,
  handleShootUpdate,
  handleShootDelete,
  handleShootMoveStage,
} from "./shoots.js";
import { handleTeamMembers } from "./team.js";
import { handleDictGet, handleDictPost } from "./dict.js";
import {
  handleAnalyze,
  handleCorrect,
  handleHighlights,
  handleTermExplain,
  handleVisuals,
  handleInsertCuts,
  handleHlRecommend,
  handleHlTimestamps,
  handleSetgen,
  handleSubtitleFormat,
} from "./ai.js";

// ─── 상수 ────────────────────────────────────────────────────────────────

const SESSION_TAB_PREFIX = "s:";          // s:{id}:{tab}
const PROJECT_INDEX_KEY = "project_index";
const SESSION_INDEX_KEY = "session_index";
const ACTIVE_KEY_PREFIX = "active:";       // active:{projectId}
const ACTIVE_TTL_MS = 90 * 1000;           // 헌장: TTL 90초 / heartbeat 30초
const ACTIVE_KV_TTL_S = 120;               // KV expirationTtl (90 + 30 buffer)
const HC_READ_KEY = "__healthcheck_read__";
const HC_WRITE_KEY = "__healthcheck_write__";

const SCHEMA_VERSION = "2.0";

// ─── KV 키 빌더 ──────────────────────────────────────────────────────────

const SESSION_KEY = (id, tab) => `${SESSION_TAB_PREFIX}${id}:${tab}`;
const ACTIVE_KEY = (id) => `${ACTIVE_KEY_PREFIX}${id}`;

// ─── B11 — checkDeletedAndForbidden ──────────────────────────────────────

/**
 * Check whether project is deleted (project_index lookup).
 * Returns { deleted: boolean, project }.
 */
async function readProjectMeta(env, sessionId) {
  if (!env || !env.SESSIONS || !sessionId) return null;
  try {
    const raw = await env.SESSIONS.get(SESSION_KEY(sessionId, "meta"));
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (e) {
    console.error(logPrefix("kv-index", "meta read failed", e?.message));
    return null;
  }
}

async function readProjectIndexEntry(env, sessionId) {
  if (!env || !env.SESSIONS || !sessionId) return null;
  try {
    const raw = await env.SESSIONS.get(PROJECT_INDEX_KEY);
    if (!raw) return null;
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return null;
    return arr.find((p) => p && p.id === sessionId) || null;
  } catch (e) {
    console.error(logPrefix("kv-index", "project_index read failed", e?.message));
    return null;
  }
}

async function isProjectDeleted(env, sessionId) {
  const entry = await readProjectIndexEntry(env, sessionId);
  if (!entry) return false;  // 인덱스에 없으면 false (신규 프로젝트 케이스)
  return entry.deleted === true;
}

// ─── handleSave (★ 12 단계 진입 순서, B7 + B11 + B12 + B5 + B1 + B6) ────

/**
 * POST /save  body: { id, tab, data, fn?, user, baseSavedAt?, baseVersion?, force? }
 *
 * 진입 순서:
 *   1. body 검증 (id / tab)
 *   2. 인증 (호출 전 verifyAuth 통과)
 *   3. existing meta + project_index 조회
 *   4. canEdit (★ 머지 전, B7)
 *   5. deleted head check (B11) → 삭제된 프로젝트 → 409
 *   6. sanitizePayload (B12)
 *   7. existing 로드 (s:{id}:{tab})
 *   8. detectConflict (B5) → 충돌 시 409 + serverData
 *   9. mergeTabData (B1)
 *   10. validateMergeResult (B6) → 위반 시 500
 *   11. version + updatedBy 부여
 *   12. KV.put (data + meta stages + project_index 갱신)
 *
 * 응답: { success, id, savedAt, version, merged?, mergedBy?, warnings? }
 */
export async function handleSave(body, env, headers, user) {
  if (!env || !env.SESSIONS) {
    return serverError(headers, "KV not configured");
  }

  // 1. body 검증 (E4 / E5)
  if (!body || !isValidId(body.id)) {
    return badRequest(headers, "invalid session id format");
  }
  if (!isValidTab(body.tab)) {
    return badRequest(headers, "invalid tab key");
  }

  const id = body.id;
  const tab = body.tab;
  const warnings = [];

  // 3. project_index 조회 (deleted check 위해)
  const projEntry = await readProjectIndexEntry(env, id);

  // 4. canEdit (B7) — 머지 전
  // (모든 mutating endpoint 에 적용 의무, S2.3 P-1)
  if (projEntry) {
    const allowed = await canEdit(projEntry, user, env);
    if (!allowed) return forbidden(headers, "이 프로젝트에 저장 권한이 없습니다.");
  }
  // (projEntry null 시 = 신규 프로젝트 첫 저장 — canEdit skip, creator 박제 의무)

  // 5. deleted head check (B11)
  if (projEntry && projEntry.deleted === true) {
    return conflictResponse(headers, {
      serverData: null,
      // (deleted 영역은 별도 reason)
    });
  }

  // 6. sanitizePayload (B12)
  const cleanData = sanitizePayload(body.data || {});

  // 7. existing 로드
  const existingRaw = await env.SESSIONS.get(SESSION_KEY(id, tab));
  let existing = null;
  if (existingRaw) {
    try {
      existing = JSON.parse(existingRaw);
    } catch (e) {
      console.error(logPrefix("save-flow", `existing parse failed (${tab})`, e?.message));
      warnings.push("existing parse error");
    }
  }

  // 8. detectConflict (B5)
  const conflict = detectConflict(body, existing);
  if (conflict.conflict) {
    return conflictResponse(headers, {
      serverSavedAt: existing?.savedAt,
      serverVersion: existing?.version,
      serverUpdatedBy: existing?.updatedBy,
      serverData: existing,
    });
  }

  // 9. mergeTabData (B1)
  let merged;
  try {
    merged = await mergeTabData(existing, cleanData, tab);
  } catch (e) {
    console.error(logPrefix("merge-invariant", `mergeTabData threw (${tab})`, e?.message));
    return serverError(headers, "merge failed");
  }

  // 10. validateMergeResult (B6)
  const validation = validateMergeResult(merged, existing, tab);
  if (!validation.valid) {
    console.error(logPrefix("merge-invariant", `validation failed (${tab})`, validation.violations.join("; ")));
    return serverError(headers, "merge invariant violation");
  }

  // 11. version + updatedBy 부여 (R11 객체)
  const savedAt = new Date().toISOString();
  const newVersion = (existing?.version ?? 0) + 1;
  const updatedBy = user
    ? { sub: user.sub, name: user.name || user.sub, at: savedAt }
    : null;

  const payload = {
    ...merged,
    savedAt,
    version: newVersion,
    updatedBy,
    schemaVersion: SCHEMA_VERSION,
  };

  // 12. KV.put (entity)
  try {
    await env.SESSIONS.put(SESSION_KEY(id, tab), JSON.stringify(payload));
  } catch (e) {
    console.error(logPrefix("save-flow", `KV put failed (${tab})`, e?.message));
    return serverError(headers, "KV write failed");
  }

  // 12a. meta.stages 갱신 (각 탭 entity 저장 시 meta.stages[tab].updatedAt 갱신)
  try {
    const metaRaw = await env.SESSIONS.get(SESSION_KEY(id, "meta"));
    let meta = {};
    if (metaRaw) {
      try { meta = JSON.parse(metaRaw); } catch { meta = {}; }
    }
    meta.stages = meta.stages || {};
    meta.stages[tab] = { updatedAt: savedAt, updatedBy };
    meta.updatedAt = savedAt;
    if (!meta.creator && user) {
      // P-2 — 신규 프로젝트 첫 저장 시 creator 박제 (handleSave + handleAutoSave 모두, N1 영역)
      meta.creator = { sub: user.sub, name: user.name || user.sub, at: savedAt };
    }
    if (!meta.sessionId) meta.sessionId = id;
    if (!meta.fn && body.fn) meta.fn = body.fn;
    if (!meta.createdAt) meta.createdAt = savedAt;
    meta.schemaVersion = SCHEMA_VERSION;
    await env.SESSIONS.put(SESSION_KEY(id, "meta"), JSON.stringify(meta));
  } catch (e) {
    console.error(logPrefix("kv-index", "meta stages update failed", e?.message));
    warnings.push("meta stages update failed");
  }

  // 12b. session_index 갱신 (D6-7 array_id_union read-after-write)
  await updateSessionIndex(env, id, body.fn, savedAt, warnings);

  // 응답: B10 머지 결과 가시성 (★ N6 핵심)
  // wasMerged 5조건:
  //   !body.force && existing && existing.updatedBy && body.user && existing.updatedBy.sub !== body.user.sub
  const wasMerged =
    !body.force &&
    existing &&
    existing.updatedBy &&
    user &&
    existing.updatedBy.sub !== user.sub;

  const resp = { success: true, id, savedAt, version: newVersion };
  if (wasMerged) {
    resp.merged = true;
    resp.mergedBy = existing.updatedBy;
  }
  if (warnings.length > 0) resp.warnings = warnings;
  return jsonResponse(resp, { status: 200 }, headers);
}

// ─── session_index 갱신 (D6-7 array_id_union) ───────────────────────────

async function updateSessionIndex(env, id, fn, savedAt, warnings) {
  try {
    const raw = await env.SESSIONS.get(SESSION_INDEX_KEY);
    let arr = [];
    if (raw) {
      try { arr = JSON.parse(raw); } catch { arr = []; }
    }
    if (!Array.isArray(arr)) arr = [];
    // array_id_union — id 기반 중복 제거 + last-write-wins per id
    const map = new Map();
    for (const e of arr) {
      if (e && e.id) map.set(e.id, e);
    }
    const prev = map.get(id) || {};
    map.set(id, { ...prev, id, fn: fn || prev.fn, updatedAt: savedAt });
    const next = [...map.values()];

    // 1MB 임박 경고 (PS3)
    const serialized = JSON.stringify(next);
    if (serialized.length > 900_000) {
      warnings.push("session_index near 1MB limit");
      console.warn(logPrefix("kv-index", "session_index near 1MB", `size=${serialized.length}`));
    }

    await env.SESSIONS.put(SESSION_INDEX_KEY, serialized);
  } catch (e) {
    console.error(logPrefix("kv-index", "session_index update failed", e?.message));
    warnings.push("session_index update failed");
  }
}

// ─── handleAutoSave ──────────────────────────────────────────────────────

/**
 * POST /autosave — handleSave 와 거의 동일, 단:
 *   - silent (응답 표준만)
 *   - expirationTtl 7일 (자동저장 백업 키, save_ / auto_ 패턴)
 *   - creator 박제도 동일 (N1)
 *
 * 본 marker 는 별도 핸들러 — 사료 정합 위해 분리.
 * 현재는 handleSave 를 그대로 재사용 (force 자동 머지 영역은 차후 구체화).
 */
export async function handleAutoSave(body, env, headers, user) {
  // 자동저장도 머지 통합 (R8) — handleSave 와 동일 흐름
  return await handleSave(body, env, headers, user);
}

// ─── handleSaveLegacy (구 단일 키 저장, /save-legacy) ───────────────────

/**
 * POST /save-legacy  body: { id, data, fn? }
 *
 * 옛 v1 단일 키 패턴. tab 분리 없음.
 * 보강: id 검증 + sanitize + session_index 갱신.
 */
export async function handleSaveLegacy(body, env, headers, user) {
  if (!env || !env.SESSIONS) return serverError(headers, "KV not configured");
  if (!body || !isValidId(body.id)) return badRequest(headers, "invalid session id format");

  const id = body.id;
  const cleanData = sanitizePayload(body.data || {});
  const savedAt = new Date().toISOString();
  const warnings = [];

  try {
    await env.SESSIONS.put(id, JSON.stringify({ ...cleanData, savedAt }));
  } catch (e) {
    console.error(logPrefix("save-flow", "legacy KV put failed", e?.message));
    return serverError(headers, "KV write failed");
  }

  await updateSessionIndex(env, id, body.fn, savedAt, warnings);

  const resp = { success: true, id, savedAt };
  if (warnings.length > 0) resp.warnings = warnings;
  return jsonResponse(resp, { status: 200 }, headers);
}

// ─── handleLoadMeta — GET /load/:id ──────────────────────────────────────

export async function handleLoadMeta(id, env, headers, user) {
  if (!env || !env.SESSIONS) return serverError(headers, "KV not configured");
  if (!isValidId(id)) return badRequest(headers, "invalid session id");

  // (Note: PRD 3.5 — /load 권한 가드는 lab 에서 의무 적용 — Part 2 에서 구체화)

  // 1. meta 우선 로드 (v2 패턴)
  const metaRaw = await env.SESSIONS.get(SESSION_KEY(id, "meta"));
  if (metaRaw) {
    let meta;
    try { meta = JSON.parse(metaRaw); } catch { meta = null; }
    if (meta) {
      // active list 동봉 (M11 — 폴링과 통합, 추가 read 0)
      const active = await readActiveUsers(env, id);
      return jsonResponse({ success: true, meta, active }, { status: 200 }, headers);
    }
  }

  // 2. 레거시 fallback (s:{id}:meta 없으면 단일 키)
  const legacyRaw = await env.SESSIONS.get(id);
  if (legacyRaw) {
    let legacy;
    try { legacy = JSON.parse(legacyRaw); } catch { legacy = null; }
    if (legacy) {
      return jsonResponse({ success: true, meta: legacy, legacy: true }, { status: 200 }, headers);
    }
  }

  return notFound(headers, "세션을 찾을 수 없습니다.");
}

// ─── handleLoadTab — GET /load/:id/:tab ──────────────────────────────────

export async function handleLoadTab(id, tab, env, headers, user) {
  if (!env || !env.SESSIONS) return serverError(headers, "KV not configured");
  if (!isValidId(id)) return badRequest(headers, "invalid session id");
  if (!isValidTab(tab)) return badRequest(headers, "invalid tab key");

  const raw = await env.SESSIONS.get(SESSION_KEY(id, tab));
  if (!raw) {
    // 404 — 데이터 없음. 클라이언트가 5xx 와 구분해야 (P0-08, S4c.4)
    return notFound(headers, `탭 데이터 없음: ${tab}`);
  }
  let data;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    console.error(logPrefix("save-flow", `load parse failed (${tab})`, e?.message));
    return serverError(headers, "data parse error");
  }
  return jsonResponse({ success: true, data }, { status: 200 }, headers);
}

// ─── handleSessionList — GET /sessions ──────────────────────────────────

export async function handleSessionList(env, headers, user) {
  if (!env || !env.SESSIONS) return serverError(headers, "KV not configured");
  const raw = await env.SESSIONS.get(SESSION_INDEX_KEY);
  let sessions = [];
  if (raw) {
    try {
      sessions = JSON.parse(raw);
    } catch {
      sessions = [];
    }
  }
  if (!Array.isArray(sessions)) sessions = [];
  return jsonResponse({ success: true, sessions }, { status: 200 }, headers);
}

// ─── handleSessionDelete — POST /sessions/delete ────────────────────────

/**
 * POST /sessions/delete  body: { id }
 *
 * 세션 (탭 키 + active 키) 모두 삭제. (project_index 의 entry 는 별 endpoint /projects/delete)
 *
 * (Note: 권한 체크는 Part 2 의 /projects/delete 에서. 여기는 sessionId 단위 cleanup.)
 */
export async function handleSessionDelete(body, env, headers, user) {
  if (!env || !env.SESSIONS) return serverError(headers, "KV not configured");
  if (!body || !isValidId(body.id)) return badRequest(headers, "invalid session id format");

  const id = body.id;
  const warnings = [];

  // 모든 탭 키 삭제
  for (const tab of VALID_TAB_KEYS) {
    try {
      await env.SESSIONS.delete(SESSION_KEY(id, tab));
    } catch (e) {
      warnings.push(`delete s:${id}:${tab} failed`);
    }
  }

  // active 키 정리 (★ N8 영역)
  try {
    await env.SESSIONS.delete(ACTIVE_KEY(id));
  } catch (e) {
    warnings.push("delete active key failed");
  }

  // session_index 에서 entry 제거
  try {
    const raw = await env.SESSIONS.get(SESSION_INDEX_KEY);
    if (raw) {
      let arr = JSON.parse(raw);
      if (Array.isArray(arr)) {
        arr = arr.filter((e) => e && e.id !== id);
        await env.SESSIONS.put(SESSION_INDEX_KEY, JSON.stringify(arr));
      }
    }
  } catch (e) {
    warnings.push("session_index update failed");
  }

  const resp = { success: true, id };
  if (warnings.length > 0) resp.warnings = warnings;
  return jsonResponse(resp, { status: 200 }, headers);
}

// ─── handleSessionHeartbeat — POST /session/:id/heartbeat ───────────────

/**
 * POST /session/:id/heartbeat  body: { tab? }
 * 인증 게이트 (★ verifyAuth 통과 후 호출).
 *
 * 동작 (M6 / D12-3 N5 해소):
 *   - active KV 키: { user.sub: { name, lastBeat, tabs: [현재 탭 1개] } }
 *   - tabs 누적 X, **현재 탭 1개로 교체** (★ N5 해소)
 *   - TTL 90초 (D12-2)
 *   - stale (>90s) 자동 정리
 *   - 응답: { success, active: [...] }
 */
export async function handleSessionHeartbeat(id, body, env, headers, user) {
  if (!env || !env.SESSIONS) return serverError(headers, "KV not configured");
  if (!isValidId(id)) return badRequest(headers, "invalid session id");
  if (!user || !user.sub) return unauthorized(headers);

  const now = Date.now();
  const tab = (body && typeof body.tab === "string") ? body.tab : null;

  // 기존 active 로드
  const raw = await env.SESSIONS.get(ACTIVE_KEY(id));
  let active = {};
  if (raw) {
    try { active = JSON.parse(raw); } catch { active = {}; }
  }

  // stale 정리 (lastBeat > 90s)
  const fresh = {};
  for (const [k, v] of Object.entries(active)) {
    if (k === user.sub) continue;  // 본인은 새로 박제
    if (v && typeof v.lastBeat === "number" && now - v.lastBeat <= ACTIVE_TTL_MS) {
      fresh[k] = v;
    }
  }

  // 본인 박제 — tabs = [현재 탭 1개] (N5 해소)
  fresh[user.sub] = {
    name: user.name || user.sub,
    lastBeat: now,
    tabs: tab ? [tab] : [],
  };

  try {
    await env.SESSIONS.put(ACTIVE_KEY(id), JSON.stringify(fresh), {
      expirationTtl: ACTIVE_KV_TTL_S,
    });
  } catch (e) {
    console.error(logPrefix("multiuser", "heartbeat KV put failed", e?.message));
    return serverError(headers, "heartbeat write failed");
  }

  return jsonResponse(
    { success: true, active: serializeActive(fresh) },
    { status: 200 },
    headers
  );
}

// ─── handleSessionLeave — POST /session/:id/leave ───────────────────────

/**
 * POST /session/:id/leave
 *
 * ★ 인증 면제 (sendBeacon 호환, D12-6).
 * Blob type=text/plain (CORS preflight 회피).
 *
 * 본 endpoint 는 user.sub 단위 active 정리. 인증 면제 위험:
 *   - 다른 사용자 sub 로 leave 시도 가능
 *   - 단, 다음 heartbeat 에 복구 (영향 작음)
 *
 * body: { sub } (또는 query ?sub=...)
 */
export async function handleSessionLeave(id, body, env, headers) {
  if (!env || !env.SESSIONS) return serverError(headers, "KV not configured");
  if (!isValidId(id)) return badRequest(headers, "invalid session id");

  const sub = body && body.sub ? body.sub : null;
  if (!sub) return badRequest(headers, "sub required");

  const raw = await env.SESSIONS.get(ACTIVE_KEY(id));
  let active = {};
  if (raw) {
    try { active = JSON.parse(raw); } catch { active = {}; }
  }

  // 본인 entry 제거
  delete active[sub];

  try {
    if (Object.keys(active).length === 0) {
      await env.SESSIONS.delete(ACTIVE_KEY(id));
    } else {
      await env.SESSIONS.put(ACTIVE_KEY(id), JSON.stringify(active), {
        expirationTtl: ACTIVE_KV_TTL_S,
      });
    }
  } catch (e) {
    console.error(logPrefix("multiuser", "leave KV write failed", e?.message));
    // sendBeacon 은 응답 무시 — silent OK
  }

  return jsonResponse({ success: true }, { status: 200 }, headers);
}

// ─── handleSessionActiveUsers — GET /session/:id/active-users ──────────

/**
 * GET /session/:id/active-users
 *
 * 동시 편집자 list (Phase 3 / 단계 A).
 * stale 자동 정리.
 */
export async function handleSessionActiveUsers(id, env, headers) {
  if (!env || !env.SESSIONS) return serverError(headers, "KV not configured");
  if (!isValidId(id)) return badRequest(headers, "invalid session id");

  const active = await readActiveUsers(env, id);
  return jsonResponse({ success: true, active }, { status: 200 }, headers);
}

/**
 * Read active users (with stale cleanup).
 * Internal helper — used by handleLoadMeta + handleSessionActiveUsers.
 */
async function readActiveUsers(env, id) {
  if (!env || !env.SESSIONS) return [];
  const raw = await env.SESSIONS.get(ACTIVE_KEY(id));
  if (!raw) return [];
  let active;
  try { active = JSON.parse(raw); } catch { return []; }
  const now = Date.now();
  const fresh = {};
  for (const [k, v] of Object.entries(active)) {
    if (v && typeof v.lastBeat === "number" && now - v.lastBeat <= ACTIVE_TTL_MS) {
      fresh[k] = v;
    }
  }
  return serializeActive(fresh);
}

function serializeActive(map) {
  const out = [];
  for (const [sub, v] of Object.entries(map)) {
    out.push({
      sub,
      name: v.name || sub,
      lastBeat: v.lastBeat,
      tabs: Array.isArray(v.tabs) ? v.tabs : [],
    });
  }
  return out;
}

// ─── /health (인증 X) ────────────────────────────────────────────────────

export async function handleHealth(env, headers) {
  const result = {
    ok: true,
    ts: new Date().toISOString(),
    kvRead: false,
    kvWrite: false,
    externalHttps: false,
  };

  if (!env || !env.SESSIONS) {
    return jsonResponse({ ...result, ok: false, error: "KV not configured" }, { status: 503 }, headers);
  }

  // KV read
  try {
    await env.SESSIONS.get(HC_READ_KEY);
    result.kvRead = true;
  } catch (e) {
    result.ok = false;
    result.kvReadError = e?.message;
  }

  // KV write (TTL 60s)
  try {
    await env.SESSIONS.put(HC_WRITE_KEY, String(Date.now()), { expirationTtl: 60 });
    result.kvWrite = true;
  } catch (e) {
    result.ok = false;
    result.kvWriteError = e?.message;
  }

  // External HTTPS (OpenAI /v1/models reachability — optional, env.OPENAI_API_KEY 있을 때만)
  if (env.OPENAI_API_KEY) {
    try {
      const r = await fetch("https://api.openai.com/v1/models", {
        method: "GET",
        headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}` },
      });
      result.externalHttps = r.ok;
      if (!r.ok) result.ok = false;
    } catch (e) {
      result.ok = false;
      result.externalHttpsError = e?.message;
    }
  } else {
    result.externalHttps = "skipped (no OPENAI_API_KEY)";
  }

  const status = result.ok ? 200 : 503;
  return jsonResponse(result, { status }, headers);
}

// ─── 라우팅 (fetch handler) ──────────────────────────────────────────────

/**
 * Match URL path to handler.
 * Returns { handler, params } or null.
 */
function matchRoute(method, pathname) {
  // Health
  if (method === "GET" && pathname === "/health") {
    return { name: "health", auth: false };
  }

  // Session endpoints
  if (method === "POST" && pathname === "/save") return { name: "save", auth: true };
  if (method === "POST" && pathname === "/save-legacy") return { name: "save-legacy", auth: true };
  if (method === "POST" && pathname === "/autosave") return { name: "autosave", auth: true };
  if (method === "GET" && pathname === "/sessions") return { name: "sessions", auth: true };
  if (method === "POST" && pathname === "/sessions/delete") return { name: "sessions-delete", auth: true };

  // /load/:id  /load/:id/:tab
  let m = /^\/load\/([a-z0-9]{4,24})$/.exec(pathname);
  if (m && method === "GET") return { name: "load-meta", auth: true, params: { id: m[1] } };
  m = /^\/load\/([a-z0-9]{4,24})\/([a-z]+)$/.exec(pathname);
  if (m && method === "GET") return { name: "load-tab", auth: true, params: { id: m[1], tab: m[2] } };

  // Project endpoints (Part 2)
  if (method === "GET" && pathname === "/projects") return { name: "projects-list", auth: true };
  if (method === "POST" && pathname === "/projects/create") return { name: "projects-create", auth: true };
  if (method === "POST" && pathname === "/projects/update") return { name: "projects-update", auth: true };
  if (method === "POST" && pathname === "/projects/delete") return { name: "projects-delete", auth: true };
  if (method === "POST" && pathname === "/projects/restore") return { name: "projects-restore", auth: true };
  if (method === "GET" && pathname === "/projects/trash") return { name: "projects-trash", auth: true };
  if (method === "POST" && pathname === "/projects/trash/purge") return { name: "projects-trash-purge", auth: true };
  if (method === "POST" && pathname === "/projects/update-step") return { name: "projects-update-step", auth: true };
  if (method === "POST" && pathname === "/projects/rebuild-index") return { name: "projects-rebuild-index", auth: true };

  // Shoot endpoints (Part 3.1)
  if (method === "GET" && pathname === "/shoots") return { name: "shoots-list", auth: true };
  if (method === "POST" && pathname === "/shoots/create") return { name: "shoots-create", auth: true };
  if (method === "POST" && pathname === "/shoots/update") return { name: "shoots-update", auth: true };
  if (method === "POST" && pathname === "/shoots/delete") return { name: "shoots-delete", auth: true };
  if (method === "POST" && pathname === "/shoots/move-stage") return { name: "shoots-move-stage", auth: true };

  // Team / Dict (Part 3.2)
  if (method === "GET" && pathname === "/team/members") return { name: "team-members", auth: true };
  if (method === "GET" && pathname === "/dict") return { name: "dict-get", auth: true };
  if (method === "POST" && pathname === "/dict") return { name: "dict-post", auth: true };

  // AI 10 LLM endpoint (Part 3.3 baseline)
  if (method === "POST" && pathname === "/analyze") return { name: "ai-analyze", auth: true };
  if (method === "POST" && pathname === "/correct") return { name: "ai-correct", auth: true };
  if (method === "POST" && pathname === "/highlights") return { name: "ai-highlights", auth: true };
  if (method === "POST" && pathname === "/term-explain") return { name: "ai-term-explain", auth: true };
  if (method === "POST" && pathname === "/visuals") return { name: "ai-visuals", auth: true };
  if (method === "POST" && pathname === "/insert-cuts") return { name: "ai-insert-cuts", auth: true };
  if (method === "POST" && pathname === "/hl-recommend") return { name: "ai-hl-recommend", auth: true };
  if (method === "POST" && pathname === "/hl-timestamps") return { name: "ai-hl-timestamps", auth: true };
  if (method === "POST" && pathname === "/setgen") return { name: "ai-setgen", auth: true };
  if (method === "POST" && pathname === "/subtitle-format") return { name: "ai-subtitle-format", auth: true };

  // Session active endpoints
  m = /^\/session\/([a-z0-9]{4,24})\/heartbeat$/.exec(pathname);
  if (m && method === "POST") return { name: "heartbeat", auth: true, params: { id: m[1] } };
  // /leave — ★ 인증 면제
  m = /^\/session\/([a-z0-9]{4,24})\/leave$/.exec(pathname);
  if (m && method === "POST") return { name: "leave", auth: false, params: { id: m[1] } };
  m = /^\/session\/([a-z0-9]{4,24})\/active-users$/.exec(pathname);
  if (m && method === "GET") return { name: "active-users", auth: true, params: { id: m[1] } };

  return null;
}

/**
 * Parse request body as JSON (graceful — 빈 body / parse error 시 null).
 */
async function parseJSON(request) {
  try {
    const text = await request.text();
    if (!text) return {};
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * Main fetch handler.
 */
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const method = request.method.toUpperCase();
    const origin = request.headers.get("Origin") || "";
    const headers = corsHeaders(origin);

    // CORS preflight
    if (method === "OPTIONS") {
      return new Response(null, { status: 204, headers });
    }

    // 라우팅 매칭
    const route = matchRoute(method, url.pathname);
    if (!route) {
      // Part 2 / 3 의 핸들러는 추가 라우팅에서 처리. 본 baseline 미매칭 시 404.
      return notFound(headers, "Not Found");
    }

    // Health (인증 X)
    if (route.name === "health") {
      return await handleHealth(env, headers);
    }

    // 인증 처리
    let user = null;
    if (route.auth) {
      user = await verifyAuth(request, env);
      if (!user) return unauthorized(headers);
    }

    // body 파싱 (POST/PUT 만)
    let body = null;
    if (method === "POST" || method === "PUT") {
      body = await parseJSON(request);
      if (body === null) return badRequest(headers, "invalid JSON body");
    }

    // Dispatch
    try {
      switch (route.name) {
        case "save":
          return await handleSave(body, env, headers, user);
        case "save-legacy":
          return await handleSaveLegacy(body, env, headers, user);
        case "autosave":
          return await handleAutoSave(body, env, headers, user);
        case "load-meta":
          return await handleLoadMeta(route.params.id, env, headers, user);
        case "load-tab":
          return await handleLoadTab(route.params.id, route.params.tab, env, headers, user);
        case "sessions":
          return await handleSessionList(env, headers, user);
        case "sessions-delete":
          return await handleSessionDelete(body, env, headers, user);
        case "heartbeat":
          return await handleSessionHeartbeat(route.params.id, body, env, headers, user);
        case "leave":
          return await handleSessionLeave(route.params.id, body, env, headers);
        case "active-users":
          return await handleSessionActiveUsers(route.params.id, env, headers);
        // Project endpoints (Part 2)
        case "projects-list": {
          const query = Object.fromEntries(url.searchParams.entries());
          return await handleProjectList(query, env, headers, user);
        }
        case "projects-create":
          return await handleProjectCreate(body, env, headers, user);
        case "projects-update":
          return await handleProjectUpdate(body, env, headers, user);
        case "projects-delete":
          return await handleProjectDelete(body, env, headers, user);
        case "projects-restore":
          return await handleProjectRestore(body, env, headers, user);
        case "projects-trash":
          return await handleProjectTrash(env, headers, user);
        case "projects-trash-purge":
          return await handleProjectTrashPurge(body, env, headers, user);
        case "projects-update-step":
          return await handleProjectUpdateStep(body, env, headers, user);
        case "projects-rebuild-index":
          return await handleProjectRebuildIndex(env, headers, user);
        // Shoot endpoints
        case "shoots-list":
          return await handleShootList(env, headers, user);
        case "shoots-create":
          return await handleShootCreate(body, env, headers, user);
        case "shoots-update":
          return await handleShootUpdate(body, env, headers, user);
        case "shoots-delete":
          return await handleShootDelete(body, env, headers, user);
        case "shoots-move-stage":
          return await handleShootMoveStage(body, env, headers, user);
        // Team / Dict
        case "team-members":
          return await handleTeamMembers(env, headers, user);
        case "dict-get":
          return await handleDictGet(env, headers, user);
        case "dict-post":
          return await handleDictPost(body, env, headers, user);
        // AI 10 LLM (baseline stub)
        case "ai-analyze":
          return await handleAnalyze(body, env, headers, user);
        case "ai-correct":
          return await handleCorrect(body, env, headers, user);
        case "ai-highlights":
          return await handleHighlights(body, env, headers, user);
        case "ai-term-explain":
          return await handleTermExplain(body, env, headers, user);
        case "ai-visuals":
          return await handleVisuals(body, env, headers, user);
        case "ai-insert-cuts":
          return await handleInsertCuts(body, env, headers, user);
        case "ai-hl-recommend":
          return await handleHlRecommend(body, env, headers, user);
        case "ai-hl-timestamps":
          return await handleHlTimestamps(body, env, headers, user);
        case "ai-setgen":
          return await handleSetgen(body, env, headers, user);
        case "ai-subtitle-format":
          return await handleSubtitleFormat(body, env, headers, user);
        default:
          return notFound(headers, "Not Found");
      }
    } catch (e) {
      console.error(logPrefix("save-flow", `unhandled (${route.name})`, e?.message));
      return serverError(headers, e?.message || "internal error");
    }
  },
};
