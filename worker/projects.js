// lab fresh v2 — Worker Part 2: 프로젝트 핸들러 (9 endpoint)
// 사료: editor/ops/lab-v2-fresh-2026-05-09.md
//   - S2.4.4 프로젝트 관리 (생성/수정/삭제/복원/휴지통)
//   - S2'.3 35+ endpoint 카탈로그
//   - S2.10 K-3 휴지통 30일 TTL
//   - S1.9 N3 (purgeEligibleAt 응답) + N8 (handleProjectTrashPurge active 키 정리)
//   - S3.8 P-2 (creator 정의), W-3 / W-4 (영구 삭제 백업 정리, 복원 강제 재계산)
//
// 9 endpoint:
//   GET  /projects                → handleProjectList (filter "mine")
//   POST /projects/create         → handleProjectCreate (모든 인증)
//   POST /projects/update         → handleProjectUpdate (canEdit)
//   POST /projects/delete         → handleProjectDelete (canDelete, soft-delete)
//   POST /projects/restore        → handleProjectRestore (canRestore + stage 재계산)
//   GET  /projects/trash          → handleProjectTrash (isAdmin + purgeEligibleAt 응답)
//   POST /projects/trash/purge    → handleProjectTrashPurge (isAdmin + active 키 정리)
//   POST /projects/update-step    → handleProjectUpdateStep (canEdit)
//   POST /projects/rebuild-index  → handleProjectRebuildIndex (안전망)

import {
  VALID_TAB_KEYS,
  isValidId,
  logPrefix,
  jsonResponse,
  badRequest,
  notFound,
  serverError,
} from "./utils.js";
import { sanitizePayload } from "./merge.js";
import { isAdmin, canEdit, canDelete, canRestore, forbidden } from "./permissions.js";

// ─── 상수 ────────────────────────────────────────────────────────────────

const PROJECT_INDEX_KEY = "project_index";
const SESSION_INDEX_KEY = "session_index";
const ACTIVE_KEY_PREFIX = "active:";

// K-3 휴지통 30일 TTL
const TRASH_TTL_S = 30 * 24 * 60 * 60;
const RESTORE_TTL_S = 365 * 24 * 60 * 60;

const SCHEMA_VERSION = "2.0";

const STEP_ORDER = Object.freeze([
  "review", "correction", "script", "guide",
  "visual", "modify", "highlight", "setgen",
]);

// ─── KV 키 빌더 ──────────────────────────────────────────────────────────

const SESSION_KEY = (id, tab) => `s:${id}:${tab}`;
const ACTIVE_KEY = (id) => `${ACTIVE_KEY_PREFIX}${id}`;

// ─── 헬퍼 ────────────────────────────────────────────────────────────────

/**
 * Generate a random session id (lowercase alphanumeric, default 8 chars).
 * VALID_ID_RE: /^[a-z0-9]{4,24}$/
 */
export function generateId(length = 8) {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  for (let i = 0; i < length; i++) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}

/**
 * Read project_index as array.
 */
async function readProjectIndex(env) {
  if (!env || !env.SESSIONS) return [];
  try {
    const raw = await env.SESSIONS.get(PROJECT_INDEX_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch (e) {
    console.error(logPrefix("kv-index", "project_index read failed", e?.message));
    return [];
  }
}

/**
 * Write project_index (with 1MB warning).
 */
async function writeProjectIndex(env, arr, warnings) {
  const serialized = JSON.stringify(arr);
  if (serialized.length > 900_000) {
    warnings?.push("project_index near 1MB limit");
    console.warn(logPrefix("kv-index", "project_index near 1MB", `size=${serialized.length}`));
  }
  await env.SESSIONS.put(PROJECT_INDEX_KEY, serialized);
}

/**
 * Recalculate currentStep from stages (W-4).
 * 가장 마지막 단계로 진입했던 step 을 currentStep 로.
 */
export function recalculateCurrentStep(stages) {
  if (!stages || typeof stages !== "object") return null;
  let currentStep = null;
  for (const step of STEP_ORDER) {
    if (stages[step] && stages[step].updatedAt) currentStep = step;
  }
  return currentStep;
}

/**
 * Calculate days in trash (휴지통 잔여 영역 표시용).
 */
function daysInTrash(deletedAt) {
  if (!deletedAt) return 0;
  const ms = Date.now() - new Date(deletedAt).getTime();
  return Math.max(0, Math.floor(ms / (24 * 60 * 60 * 1000)));
}

// ─── handleProjectList — GET /projects ───────────────────────────────────

/**
 * GET /projects?filter=mine
 *
 * - filter "mine" 만 user 매칭 (creator OR editors 포함)
 * - default: 모든 진행 (deleted=false) 프로젝트
 */
export async function handleProjectList(query, env, headers, user) {
  if (!env || !env.SESSIONS) return serverError(headers, "KV not configured");
  const all = await readProjectIndex(env);
  const filter = query?.filter || "all";
  let projects = all.filter((p) => p && p.deleted !== true);

  if (filter === "mine" && user && user.sub) {
    projects = projects.filter((p) =>
      p.creatorEmail === user.sub ||
      (Array.isArray(p.editors) && p.editors.includes(user.sub))
    );
  }

  return jsonResponse({ success: true, projects }, { status: 200 }, headers);
}

// ─── handleProjectCreate — POST /projects/create ─────────────────────────

/**
 * POST /projects/create  body: { fn, memo?, parentShootId?, editors? }
 *
 * - 모든 인증 사용자 가능
 * - id 자동 생성 (8자, VALID_ID_RE)
 * - creator = user.sub, editors 에 자동 추가
 * - project_index 에 unshift, s:{id}:meta 생성
 */
export async function handleProjectCreate(body, env, headers, user) {
  if (!env || !env.SESSIONS) return serverError(headers, "KV not configured");
  if (!user || !user.sub) return forbidden(headers, "인증이 필요합니다.");
  if (!body || typeof body.fn !== "string" || body.fn.trim() === "") {
    return badRequest(headers, "fn (파일명) 필수");
  }

  const cleanBody = sanitizePayload(body);
  const id = generateId(8);
  const now = new Date().toISOString();

  // editors 에 creator 자동 추가
  const editors = Array.isArray(cleanBody.editors) ? [...cleanBody.editors] : [];
  if (!editors.includes(user.sub)) editors.unshift(user.sub);

  const projectEntry = {
    id,
    fn: cleanBody.fn,
    memo: cleanBody.memo || "",
    parentShootId: cleanBody.parentShootId || null,
    creator: user.name || user.sub,
    creatorEmail: user.sub,
    editors,
    createdAt: now,
    updatedAt: now,
    status: "active",
    stage: "editing",
    currentStep: null,
    stepProgress: {},
    deleted: false,
  };

  // project_index 갱신 (unshift)
  const arr = await readProjectIndex(env);
  arr.unshift(projectEntry);
  const warnings = [];
  await writeProjectIndex(env, arr, warnings);

  // meta 생성 (P-2 creator 박제, ★ N1 영역과 정합)
  const meta = {
    sessionId: id,
    fn: cleanBody.fn,
    createdAt: now,
    updatedAt: now,
    schemaVersion: SCHEMA_VERSION,
    stages: {},
    creator: { sub: user.sub, name: user.name || user.sub, at: now },
  };
  try {
    await env.SESSIONS.put(SESSION_KEY(id, "meta"), JSON.stringify(meta));
  } catch (e) {
    console.error(logPrefix("save-flow", "create meta put failed", e?.message));
    warnings.push("meta create failed");
  }

  const resp = { success: true, id, project: projectEntry };
  if (warnings.length > 0) resp.warnings = warnings;
  return jsonResponse(resp, { status: 200 }, headers);
}

// ─── handleProjectUpdate — POST /projects/update ─────────────────────────

/**
 * POST /projects/update  body: { id, fn?, memo?, editors?, ... }
 *
 * canEdit 가드 (B7).
 */
export async function handleProjectUpdate(body, env, headers, user) {
  if (!env || !env.SESSIONS) return serverError(headers, "KV not configured");
  if (!body || !isValidId(body.id)) return badRequest(headers, "invalid id");

  const arr = await readProjectIndex(env);
  const idx = arr.findIndex((p) => p && p.id === body.id);
  if (idx < 0) return notFound(headers, "프로젝트를 찾을 수 없습니다.");

  const proj = arr[idx];
  const allowed = await canEdit(proj, user, env);
  if (!allowed) return forbidden(headers, "이 프로젝트에 수정 권한이 없습니다.");

  const cleanBody = sanitizePayload(body);
  const now = new Date().toISOString();

  // 업데이트 가능 필드 (fn / memo / editors / status / stage / currentStep / stepProgress / parentShootId)
  if (cleanBody.fn !== undefined) proj.fn = cleanBody.fn;
  if (cleanBody.memo !== undefined) proj.memo = cleanBody.memo;
  if (Array.isArray(cleanBody.editors)) proj.editors = cleanBody.editors;
  if (cleanBody.status !== undefined) proj.status = cleanBody.status;
  if (cleanBody.stage !== undefined) proj.stage = cleanBody.stage;
  if (cleanBody.currentStep !== undefined) proj.currentStep = cleanBody.currentStep;
  if (cleanBody.stepProgress !== undefined) proj.stepProgress = cleanBody.stepProgress;
  if (cleanBody.parentShootId !== undefined) proj.parentShootId = cleanBody.parentShootId;

  proj.updatedAt = now;
  arr[idx] = proj;

  const warnings = [];
  await writeProjectIndex(env, arr, warnings);

  const resp = { success: true, project: proj };
  if (warnings.length > 0) resp.warnings = warnings;
  return jsonResponse(resp, { status: 200 }, headers);
}

// ─── handleProjectDelete — POST /projects/delete (soft-delete + K-3 30일 TTL) ─

/**
 * POST /projects/delete  body: { id }
 *
 * canDelete (creator OR admin) 가드.
 * Soft-delete: project_index entry 에 deleted=true, deletedAt, deletedBy, purgeEligibleAt 박제.
 * (★ K-3) entity 키들 TTL 30일 단축 (W-4 영역).
 */
export async function handleProjectDelete(body, env, headers, user) {
  if (!env || !env.SESSIONS) return serverError(headers, "KV not configured");
  if (!body || !isValidId(body.id)) return badRequest(headers, "invalid id");

  const arr = await readProjectIndex(env);
  const idx = arr.findIndex((p) => p && p.id === body.id);
  if (idx < 0) return notFound(headers, "프로젝트를 찾을 수 없습니다.");

  const proj = arr[idx];
  const allowed = await canDelete(proj, user, env);
  if (!allowed) return forbidden(headers, "삭제 권한이 없습니다.");

  const now = new Date().toISOString();
  const purgeAt = new Date(Date.now() + TRASH_TTL_S * 1000).toISOString();

  proj.deleted = true;
  proj.deletedAt = now;
  proj.deletedBy = user.sub;
  proj.purgeEligibleAt = purgeAt;        // ★ N3 응답 노출
  proj._preDoneStage = proj.stage;        // 4.1.c 완료보존 reference
  arr[idx] = proj;

  const warnings = [];
  await writeProjectIndex(env, arr, warnings);

  // entity 키들 TTL 30일 단축 (★ K-3, W-4)
  for (const tab of VALID_TAB_KEYS) {
    try {
      const k = SESSION_KEY(body.id, tab);
      const raw = await env.SESSIONS.get(k);
      if (raw) {
        // TTL 단축 — KV 의 expirationTtl 옵션
        await env.SESSIONS.put(k, raw, { expirationTtl: TRASH_TTL_S });
      }
    } catch (e) {
      warnings.push(`tab ${tab} TTL 단축 실패`);
    }
  }

  return jsonResponse(
    { success: true, softDeleted: true, deletedAt: now, purgeEligibleAt: purgeAt, warnings: warnings.length ? warnings : undefined },
    { status: 200 },
    headers
  );
}

// ─── handleProjectRestore — POST /projects/restore ───────────────────────

/**
 * POST /projects/restore  body: { id }
 *
 * canRestore (creator OR deletedBy === user.sub OR admin).
 * deleted 플래그 제거, purgeEligibleAt 제거, ★ stage 재계산 (W-4), entity TTL 1년 복원.
 */
export async function handleProjectRestore(body, env, headers, user) {
  if (!env || !env.SESSIONS) return serverError(headers, "KV not configured");
  if (!body || !isValidId(body.id)) return badRequest(headers, "invalid id");

  const arr = await readProjectIndex(env);
  const idx = arr.findIndex((p) => p && p.id === body.id);
  if (idx < 0) return notFound(headers, "프로젝트를 찾을 수 없습니다.");

  const proj = arr[idx];
  const allowed = await canRestore(proj, user, env);
  if (!allowed) return forbidden(headers, "복원 권한이 없습니다.");

  const now = new Date().toISOString();

  // ★ stage 재계산 (W-4): meta.stages 기반 currentStep
  let stages = {};
  try {
    const metaRaw = await env.SESSIONS.get(SESSION_KEY(body.id, "meta"));
    if (metaRaw) {
      const meta = JSON.parse(metaRaw);
      stages = meta.stages || {};
    }
  } catch {}
  const recalculatedStep = recalculateCurrentStep(stages);

  delete proj.deleted;
  delete proj.deletedAt;
  delete proj.deletedBy;
  delete proj.purgeEligibleAt;
  proj.stage = proj._preDoneStage || proj.stage || "editing";
  delete proj._preDoneStage;
  if (recalculatedStep) proj.currentStep = recalculatedStep;
  proj.updatedAt = now;
  arr[idx] = proj;

  const warnings = [];
  await writeProjectIndex(env, arr, warnings);

  // entity 키들 TTL 1년 복원
  for (const tab of VALID_TAB_KEYS) {
    try {
      const k = SESSION_KEY(body.id, tab);
      const raw = await env.SESSIONS.get(k);
      if (raw) {
        await env.SESSIONS.put(k, raw, { expirationTtl: RESTORE_TTL_S });
      }
    } catch (e) {
      warnings.push(`tab ${tab} TTL 복원 실패`);
    }
  }

  return jsonResponse(
    { success: true, project: proj, warnings: warnings.length ? warnings : undefined },
    { status: 200 },
    headers
  );
}

// ─── handleProjectTrash — GET /projects/trash (isAdmin) ──────────────────

/**
 * GET /projects/trash  (isAdmin only)
 *
 * deleted=true entries + daysInTrash + ★ purgeEligibleAt (N3 영역).
 */
export async function handleProjectTrash(env, headers, user) {
  if (!env || !env.SESSIONS) return serverError(headers, "KV not configured");
  if (!(await isAdmin(user, env))) return forbidden(headers, "관리자만 접근할 수 있습니다.");

  const all = await readProjectIndex(env);
  const trashed = all
    .filter((p) => p && p.deleted === true)
    .map((p) => ({
      ...p,
      daysInTrash: daysInTrash(p.deletedAt),
      purgeEligibleAt: p.purgeEligibleAt,  // ★ N3 — 클라 휴지통 UI "30일 후 자동 삭제 (D-N일)"
    }));

  return jsonResponse({ success: true, trashed }, { status: 200 }, headers);
}

// ─── handleProjectTrashPurge — POST /projects/trash/purge (isAdmin) ─────

/**
 * POST /projects/trash/purge  body: { ids: [...] }  (isAdmin only)
 *
 * 영구 삭제:
 *   - 모든 탭 키 (s:{id}:*) 삭제
 *   - active 키 (active:{id}) 삭제 (★ N8 영역 — handleSessionDelete 와 일관성)
 *   - project_index entry 제거
 *   - localStorage te_backup_* 정리 (W-3) — 클라 측 책임 (서버 단지 경고 응답)
 */
export async function handleProjectTrashPurge(body, env, headers, user) {
  if (!env || !env.SESSIONS) return serverError(headers, "KV not configured");
  if (!(await isAdmin(user, env))) return forbidden(headers, "관리자만 접근할 수 있습니다.");
  if (!body || !Array.isArray(body.ids) || body.ids.length === 0) {
    return badRequest(headers, "ids 배열 필수");
  }

  const ids = body.ids.filter((x) => isValidId(x));
  if (ids.length === 0) return badRequest(headers, "유효한 id 없음");

  const arr = await readProjectIndex(env);
  const purged = [];
  const warnings = [];

  for (const id of ids) {
    const idx = arr.findIndex((p) => p && p.id === id);
    if (idx < 0) {
      warnings.push(`id ${id} not in project_index`);
      continue;
    }
    const proj = arr[idx];
    if (!proj.deleted) {
      warnings.push(`id ${id} 가 deleted 상태가 아님 — purge 거부`);
      continue;
    }

    // 모든 탭 키 삭제
    for (const tab of VALID_TAB_KEYS) {
      try {
        await env.SESSIONS.delete(SESSION_KEY(id, tab));
      } catch (e) {
        warnings.push(`s:${id}:${tab} delete failed`);
      }
    }

    // ★ N8 영역: active 키 정리 (handleSessionDelete 와 일관)
    try {
      await env.SESSIONS.delete(ACTIVE_KEY(id));
    } catch (e) {
      warnings.push(`active:${id} delete failed`);
    }

    // session_index entry 제거
    try {
      const sIdxRaw = await env.SESSIONS.get(SESSION_INDEX_KEY);
      if (sIdxRaw) {
        let sArr = JSON.parse(sIdxRaw);
        if (Array.isArray(sArr)) {
          sArr = sArr.filter((e) => e && e.id !== id);
          await env.SESSIONS.put(SESSION_INDEX_KEY, JSON.stringify(sArr));
        }
      }
    } catch (e) {
      warnings.push(`session_index update for ${id} failed`);
    }

    purged.push(id);
  }

  // project_index 에서 purged ids 제거
  const remaining = arr.filter((p) => p && !purged.includes(p.id));
  await writeProjectIndex(env, remaining, warnings);

  return jsonResponse(
    { success: true, purged, warnings: warnings.length ? warnings : undefined },
    { status: 200 },
    headers
  );
}

// ─── handleProjectUpdateStep — POST /projects/update-step ───────────────

/**
 * POST /projects/update-step  body: { id, currentStep, stepProgress? }
 *
 * canEdit. currentStep + stepProgress 갱신. (4.1.c stage↔status 동기 영역).
 */
export async function handleProjectUpdateStep(body, env, headers, user) {
  if (!env || !env.SESSIONS) return serverError(headers, "KV not configured");
  if (!body || !isValidId(body.id)) return badRequest(headers, "invalid id");

  const arr = await readProjectIndex(env);
  const idx = arr.findIndex((p) => p && p.id === body.id);
  if (idx < 0) return notFound(headers, "프로젝트를 찾을 수 없습니다.");

  const proj = arr[idx];
  const allowed = await canEdit(proj, user, env);
  if (!allowed) return forbidden(headers, "수정 권한이 없습니다.");

  const cleanBody = sanitizePayload(body);
  const now = new Date().toISOString();

  if (cleanBody.currentStep !== undefined) proj.currentStep = cleanBody.currentStep;
  if (cleanBody.stepProgress !== undefined) {
    proj.stepProgress = { ...(proj.stepProgress || {}), ...cleanBody.stepProgress };
  }
  proj.updatedAt = now;
  arr[idx] = proj;

  const warnings = [];
  await writeProjectIndex(env, arr, warnings);

  return jsonResponse(
    { success: true, project: proj, warnings: warnings.length ? warnings : undefined },
    { status: 200 },
    headers
  );
}

// ─── handleProjectRebuildIndex — POST /projects/rebuild-index ──────────

/**
 * POST /projects/rebuild-index  (모든 인증, 안전망)
 *
 * KV 의 s:*:meta 키 전수 스캔 → project_index 누락 entry 추가 (기본값으로).
 * 기존 entry 는 보존 (덮어쓰기 X).
 *
 * (사료 4/24 96d1fa8 안전망)
 */
export async function handleProjectRebuildIndex(env, headers, user) {
  if (!env || !env.SESSIONS) return serverError(headers, "KV not configured");
  if (!user || !user.sub) return forbidden(headers, "인증이 필요합니다.");

  const arr = await readProjectIndex(env);
  const knownIds = new Set(arr.map((p) => p && p.id).filter(Boolean));
  const added = [];

  // KV list — Cloudflare KV API
  // (test 환경에서는 mock 의 list 가 없을 수 있음 — graceful)
  if (typeof env.SESSIONS.list !== "function") {
    return jsonResponse(
      { success: true, added: [], warnings: ["KV.list not available — skipped"] },
      { status: 200 },
      headers
    );
  }

  let cursor;
  let scanned = 0;
  do {
    const res = await env.SESSIONS.list({ prefix: "s:", cursor, limit: 1000 });
    cursor = res.cursor;
    for (const k of res.keys || []) {
      // 패턴: s:{id}:meta
      const m = /^s:([a-z0-9]{4,24}):meta$/.exec(k.name);
      if (!m) continue;
      const id = m[1];
      scanned++;
      if (knownIds.has(id)) continue;

      // meta 로드
      let meta;
      try {
        const raw = await env.SESSIONS.get(k.name);
        meta = raw ? JSON.parse(raw) : null;
      } catch {
        meta = null;
      }
      if (!meta) continue;

      const entry = {
        id,
        fn: meta.fn || "(rebuilt)",
        creator: meta.creator?.name || "(unknown)",
        creatorEmail: meta.creator?.sub || "(unknown)",
        editors: meta.creator?.sub ? [meta.creator.sub] : [],
        createdAt: meta.createdAt || meta.updatedAt || new Date().toISOString(),
        updatedAt: meta.updatedAt || new Date().toISOString(),
        status: "active",
        stage: "editing",
        currentStep: recalculateCurrentStep(meta.stages || {}),
        stepProgress: {},
      };
      arr.push(entry);
      added.push(id);
      knownIds.add(id);
    }
    if (!res.list_complete && cursor) continue;
    break;
  } while (cursor);

  if (added.length > 0) {
    const warnings = [];
    await writeProjectIndex(env, arr, warnings);
    return jsonResponse(
      { success: true, added, scanned, warnings: warnings.length ? warnings : undefined },
      { status: 200 },
      headers
    );
  }

  return jsonResponse({ success: true, added: [], scanned }, { status: 200 }, headers);
}
