// lab fresh v2 — frontend API client
// 사료: editor/ops/lab-v2-fresh-2026-05-09.md
//   - S2'.3 35+ endpoint 카탈로그
//   - P0-06 retry 4 (모든 저장 함수)
//   - P0-08 404/500 구분 (apiLoadTab 영역)
//   - P0-05 handle401 — reload 전 keepalive flush 또는 토스트 (App.jsx 책임)
//   - 묶음 ⑫ Phase 1+2+3 (apiSaveTab opts + heartbeat + leave + active-users)
//   - D6-8 meta.updatedBy — apiSaveTab + apiSaveSession 모두 user 전송 (★ N5 영역)
//
// 책임:
//   - apiCall (retry 4 + status code 분기 + Korean error mapping)
//   - 38 endpoint helpers (handleSave/Heartbeat/Leave 등)
//
// 사용법:
//   const r = await apiSaveTab(sessionId, "correction", data, cfg, fn, { baseSavedAt, baseVersion, force, user });

import { translateError } from "./errorMessages.js";

const DEFAULT_TIMEOUT_MS = 30_000;
const RETRY_DELAYS = [1000, 2000, 3000];  // 1+2+3초 (4 attempt total)

// ─── Custom error class ─────────────────────────────────────────────────

export class ApiError extends Error {
  constructor(message, status, body) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

// ─── 토큰 박제 (App.jsx 가 setToken 호출) ────────────────────────────────

let _token = null;

export function setToken(token) {
  _token = token || null;
}

export function getToken() {
  return _token;
}

// ─── apiCall — 핵심 fetch wrapper ────────────────────────────────────────

/**
 * Generic API call with retry, timeout, and consistent error shape.
 *
 * @param {object} opts
 *   - url (string, required)
 *   - method ("GET"|"POST"|... default GET)
 *   - body (object|null) → JSON.stringify
 *   - retry (boolean, default true) — 5xx/network 재시도
 *   - timeoutMs (number)
 *   - keepalive (boolean) — sendBeacon 패턴
 * @returns {Promise<object>} parsed body
 * @throws {ApiError}
 */
export async function apiCall(opts) {
  const {
    url,
    method = "GET",
    body = null,
    retry = true,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    keepalive = false,
    headers: extraHeaders = {},
  } = opts;

  if (!url) throw new ApiError("url required", 0);

  const headers = { ...extraHeaders };
  if (body !== null) headers["Content-Type"] = "application/json";
  if (_token) headers["Authorization"] = `Bearer ${_token}`;

  const fetchOpts = {
    method,
    headers,
    body: body !== null ? JSON.stringify(body) : undefined,
    keepalive,
  };

  let lastError;
  const maxAttempts = retry ? RETRY_DELAYS.length + 1 : 1;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      // timeout via AbortController
      const ac = new AbortController();
      const t = setTimeout(() => ac.abort(), timeoutMs);
      let r;
      try {
        r = await fetch(url, { ...fetchOpts, signal: ac.signal });
      } finally {
        clearTimeout(t);
      }

      // 4xx — 재시도 X (429 만 예외)
      if (!r.ok) {
        let parsedBody = null;
        try {
          parsedBody = await r.json();
        } catch {
          parsedBody = null;
        }
        const errMsg = parsedBody?.error || `HTTP ${r.status}`;
        const apiErr = new ApiError(errMsg, r.status, parsedBody);
        if (r.status >= 400 && r.status < 500 && r.status !== 429) {
          throw apiErr;
        }
        // 5xx / 429 — retry
        lastError = apiErr;
        if (attempt < maxAttempts - 1) {
          await sleep(RETRY_DELAYS[attempt] || 3000);
          continue;
        }
        throw apiErr;
      }

      // 정상 응답
      try {
        return await r.json();
      } catch {
        return {};
      }
    } catch (e) {
      // network error / abort / DNS 등 → retry
      if (e instanceof ApiError) throw e;  // 4xx 는 위에서 throw
      lastError = e;
      if (attempt < maxAttempts - 1) {
        await sleep(RETRY_DELAYS[attempt] || 3000);
        continue;
      }
    }
  }

  // 모두 실패
  if (lastError instanceof ApiError) throw lastError;
  throw new ApiError(lastError?.message || "Failed to fetch", 0, null);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ─── Endpoint helpers ───────────────────────────────────────────────────

/**
 * Build full URL from base + path.
 */
function buildUrl(cfg, path, query) {
  let url = `${cfg.workerUrl}${path}`;
  if (query && typeof query === "object") {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null) qs.set(k, String(v));
    }
    const s = qs.toString();
    if (s) url += `?${s}`;
  }
  return url;
}

// ─── 1. Health ──────────────────────────────────────────────────────────

export async function apiHealth(cfg) {
  return await apiCall({ url: buildUrl(cfg, "/health"), retry: false });
}

// ─── 2. Save (handleSave 12 단계 진입) ──────────────────────────────────

/**
 * POST /save
 *
 * @param {string} sessionId
 * @param {string} tab
 * @param {object} data
 * @param {object} cfg - { workerUrl }
 * @param {string} fn - 파일명 (메타 보강)
 * @param {object} opts - { baseSavedAt, baseVersion, force, user, manual }
 *   - user: D6-8 meta.updatedBy {sub, name, at}
 */
export async function apiSaveTab(sessionId, tab, data, cfg, fn, opts = {}) {
  return await apiCall({
    url: buildUrl(cfg, "/save"),
    method: "POST",
    body: {
      id: sessionId,
      tab,
      data,
      fn,
      baseSavedAt: opts.baseSavedAt,
      baseVersion: opts.baseVersion,
      force: opts.force,
      user: opts.user,
    },
    retry: !opts.manual,  // 수동 저장은 즉시 모달 (retry X)
  });
}

/**
 * POST /autosave
 */
export async function apiAutoSave(sessionId, tab, data, cfg, fn, opts = {}) {
  return await apiCall({
    url: buildUrl(cfg, "/autosave"),
    method: "POST",
    body: {
      id: sessionId,
      tab,
      data,
      fn,
      baseSavedAt: opts.baseSavedAt,
      baseVersion: opts.baseVersion,
      user: opts.user,
    },
  });
}

/**
 * POST /save-legacy (★ N5 — user 전송 의무)
 */
export async function apiSaveSession(sessionId, data, cfg, fn, opts = {}) {
  return await apiCall({
    url: buildUrl(cfg, "/save-legacy"),
    method: "POST",
    body: { id: sessionId, data, fn, user: opts.user },
  });
}

// ─── 3. Load ────────────────────────────────────────────────────────────

/**
 * GET /load/:id (meta + active list 동봉)
 */
export async function apiLoadMeta(sessionId, cfg) {
  return await apiCall({
    url: buildUrl(cfg, `/load/${sessionId}`),
  });
}

/**
 * GET /load/:id/:tab (★ P0-08 — 404 vs 5xx 구분)
 *
 * Returns:
 *   - 200 → { success, data }
 *   - 404 → null (정상 — 데이터 없음, 신규 케이스)
 *   - 5xx → throw ApiError (호출자가 retry 또는 stale 표시)
 */
export async function apiLoadTab(sessionId, tab, cfg) {
  try {
    return await apiCall({
      url: buildUrl(cfg, `/load/${sessionId}/${tab}`),
    });
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) {
      return null;  // 데이터 없음 — 정상
    }
    throw e;  // 5xx 등은 throw
  }
}

// ─── 4. Sessions ────────────────────────────────────────────────────────

export async function apiSessionList(cfg) {
  return await apiCall({ url: buildUrl(cfg, "/sessions") });
}

export async function apiSessionDelete(sessionId, cfg) {
  return await apiCall({
    url: buildUrl(cfg, "/sessions/delete"),
    method: "POST",
    body: { id: sessionId },
  });
}

// ─── 5. Phase 3 sync ────────────────────────────────────────────────────

/**
 * POST /session/:id/heartbeat — 30초 주기, 인증 게이트
 */
export async function apiHeartbeat(sessionId, cfg, user, tab) {
  return await apiCall({
    url: buildUrl(cfg, `/session/${sessionId}/heartbeat`),
    method: "POST",
    body: { tab, user },
    retry: false,  // heartbeat 는 다음 회차로 회복
  });
}

/**
 * POST /session/:id/leave — ★ 인증 면제 (sendBeacon 호환)
 *   sendBeacon 패턴: Blob type=text/plain (CORS preflight 회피)
 */
export function apiLeave(sessionId, cfg, user) {
  if (!user || !user.sub) return false;
  if (typeof navigator === "undefined" || !navigator.sendBeacon) {
    // fallback: keepalive fetch
    try {
      fetch(buildUrl(cfg, `/session/${sessionId}/leave`), {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({ sub: user.sub }),
        keepalive: true,
      });
    } catch {}
    return true;
  }
  const body = new Blob([JSON.stringify({ sub: user.sub })], { type: "text/plain" });
  return navigator.sendBeacon(buildUrl(cfg, `/session/${sessionId}/leave`), body);
}

/**
 * GET /session/:id/active-users
 */
export async function apiActiveUsers(sessionId, cfg) {
  return await apiCall({
    url: buildUrl(cfg, `/session/${sessionId}/active-users`),
    retry: false,
  });
}

// ─── 6. Projects ────────────────────────────────────────────────────────

export async function apiProjectList(cfg, query = {}) {
  return await apiCall({ url: buildUrl(cfg, "/projects", query) });
}

export async function apiProjectCreate(body, cfg) {
  return await apiCall({ url: buildUrl(cfg, "/projects/create"), method: "POST", body });
}

export async function apiProjectUpdate(body, cfg) {
  return await apiCall({ url: buildUrl(cfg, "/projects/update"), method: "POST", body });
}

export async function apiProjectDelete(sessionId, cfg) {
  return await apiCall({ url: buildUrl(cfg, "/projects/delete"), method: "POST", body: { id: sessionId } });
}

export async function apiProjectRestore(sessionId, cfg) {
  return await apiCall({ url: buildUrl(cfg, "/projects/restore"), method: "POST", body: { id: sessionId } });
}

export async function apiProjectTrash(cfg) {
  return await apiCall({ url: buildUrl(cfg, "/projects/trash") });
}

export async function apiProjectTrashPurge(ids, cfg) {
  return await apiCall({ url: buildUrl(cfg, "/projects/trash/purge"), method: "POST", body: { ids } });
}

export async function apiProjectUpdateStep(body, cfg) {
  return await apiCall({ url: buildUrl(cfg, "/projects/update-step"), method: "POST", body });
}

export async function apiProjectRebuildIndex(cfg) {
  return await apiCall({ url: buildUrl(cfg, "/projects/rebuild-index"), method: "POST", body: {} });
}

// ─── 7. Shoots ──────────────────────────────────────────────────────────

export async function apiShootList(cfg) {
  return await apiCall({ url: buildUrl(cfg, "/shoots") });
}

export async function apiShootCreate(body, cfg) {
  return await apiCall({ url: buildUrl(cfg, "/shoots/create"), method: "POST", body });
}

export async function apiShootUpdate(body, cfg) {
  return await apiCall({ url: buildUrl(cfg, "/shoots/update"), method: "POST", body });
}

export async function apiShootDelete(id, cfg) {
  return await apiCall({ url: buildUrl(cfg, "/shoots/delete"), method: "POST", body: { id } });
}

export async function apiShootMoveStage(id, stage, cfg) {
  return await apiCall({ url: buildUrl(cfg, "/shoots/move-stage"), method: "POST", body: { id, stage } });
}

// ─── 8. Team / Dict ────────────────────────────────────────────────────

export async function apiTeamMembers(cfg) {
  return await apiCall({ url: buildUrl(cfg, "/team/members") });
}

export async function apiDictGet(cfg) {
  return await apiCall({ url: buildUrl(cfg, "/dict") });
}

export async function apiDictPost(dict, cfg) {
  return await apiCall({ url: buildUrl(cfg, "/dict"), method: "POST", body: { dict } });
}

// ─── 9. AI 10 LLM ───────────────────────────────────────────────────────

export async function apiAnalyze(body, cfg) {
  return await apiCall({ url: buildUrl(cfg, "/analyze"), method: "POST", body });
}

export async function apiCorrect(body, cfg) {
  return await apiCall({ url: buildUrl(cfg, "/correct"), method: "POST", body });
}

export async function apiHighlights(body, cfg) {
  return await apiCall({ url: buildUrl(cfg, "/highlights"), method: "POST", body });
}

export async function apiTermExplain(body, cfg) {
  return await apiCall({ url: buildUrl(cfg, "/term-explain"), method: "POST", body });
}

export async function apiVisuals(body, cfg) {
  return await apiCall({ url: buildUrl(cfg, "/visuals"), method: "POST", body });
}

export async function apiInsertCuts(body, cfg) {
  return await apiCall({ url: buildUrl(cfg, "/insert-cuts"), method: "POST", body });
}

export async function apiHlRecommend(body, cfg) {
  return await apiCall({ url: buildUrl(cfg, "/hl-recommend"), method: "POST", body });
}

export async function apiHlTimestamps(body, cfg) {
  return await apiCall({ url: buildUrl(cfg, "/hl-timestamps"), method: "POST", body });
}

export async function apiSetgen(body, cfg) {
  return await apiCall({ url: buildUrl(cfg, "/setgen"), method: "POST", body });
}

export async function apiSubtitleFormat(body, cfg) {
  return await apiCall({ url: buildUrl(cfg, "/subtitle-format"), method: "POST", body });
}

// ─── User-friendly error helper ─────────────────────────────────────────

/**
 * Convert ApiError to Korean user-facing message.
 */
export function apiErrorMessage(err) {
  if (err instanceof ApiError) {
    if (err.body?.error) return translateError(err.body.error);
    return translateError(String(err.status || err.message));
  }
  return translateError(err);
}
