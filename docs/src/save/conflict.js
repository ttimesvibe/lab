// lab fresh v2 — A6 Conflict Handler
// 사료: editor/ops/lab-v2-fresh-2026-05-09.md
//   - 헌장 §b 비겹침: baseSavedAt mismatch
//       - 같은 sub: 자동 통합 (UX 비노출, force=true 재시도)
//       - 다른 sub: 409 + ConflictModal 2 옵션 (헌장 v1.1)
//   - S5.1 A6: Conflict Handler
//   - 묶음 ⑫ M11: clientMergeTabData = 서버 머지와 동일 모듈 (UX 비노출, 코드 보존)
//   - S1.6 §11 cutover 폐기: engine 통째 활용 X — 본 모듈은 단순 함수 dispatch
//
// 책임:
//   - 같은 sub 자동 통합 (자기 다중 디바이스 등 — UX 비노출)
//   - 다른 sub → ConflictModal 2 옵션 trigger
//     - 옵션 1 "강제저장" (force=true)
//     - 옵션 2 "동기화" (applyServerToState)
//   - clientMergeTabData 코드 유지 (사료 정합, UX 비노출)

import { SAVE_DISPATCH, APPLY_SERVER_DISPATCH } from "./dispatchers.js";
import { ApiError } from "../utils/api.js";

/**
 * Build a conflict handler with injected dependencies.
 *
 * @param {object} deps
 *   - apiSaveTab (function) — force=true 재시도용
 *   - applyServerToState (function|null) — 옵션 2 "동기화" 시 호출
 *     기본 동작: state 갱신 (호출자가 React state 박제)
 *   - showConflictModal (function|null) — 옵션 2 옵션 모달 trigger
 *     callback signature: (tabId, modalData) => void
 *
 * Returns:
 *   handleConflict(tab, error, ctx) — async
 *     ctx: { user, sessionId, cfg, fn, getState, getRefs }
 */
export function buildConflictHandler(deps = {}) {
  const { apiSaveTab, applyServerToState, showConflictModal } = deps;

  if (typeof apiSaveTab !== "function") {
    throw new Error("buildConflictHandler: apiSaveTab inject required");
  }

  return async function handleConflict(tab, error, ctx = {}) {
    const { user, sessionId, cfg, fn, getState, getRefs } = ctx;

    // error 의 body 에서 server info 추출 (S2.7 conflictResponse 형식)
    const body = error instanceof ApiError ? (error.body || {}) : (error || {});
    const serverData = body.serverData;
    const serverSavedAt = body.serverSavedAt;
    const serverVersion = body.serverVersion;
    const serverUpdatedBy = body.serverUpdatedBy;

    // 1. 같은 sub 자동 통합 (★ 헌장 §b — UX 비노출)
    if (serverUpdatedBy?.sub && user?.sub && serverUpdatedBy.sub === user.sub) {
      // 자기 다중 디바이스 또는 자기 자신 race — force=true 재시도
      try {
        const state = typeof getState === "function" ? getState() : null;
        const data = SAVE_DISPATCH[tab](state);
        if (data === null || data === undefined) {
          return { resolved: "skip", reason: "no data after self-merge" };
        }
        const refs = typeof getRefs === "function" ? getRefs() : {};
        const r = await apiSaveTab(sessionId, tab, data, cfg, fn, {
          force: true,
          user,
          // ★ baseSavedAt/version 갱신 (서버 측 최신)
          baseSavedAt: serverSavedAt,
          baseVersion: serverVersion,
        });
        return { resolved: "auto-merged", response: r };
      } catch (e) {
        // 자동 통합도 실패 → modal escalate
        return await escalateToModal(tab, body, { user, sessionId, cfg, fn, getState }, deps);
      }
    }

    // 2. 다른 sub — ConflictModal 2 옵션 trigger
    return await escalateToModal(tab, body, { user, sessionId, cfg, fn, getState }, deps);
  };
}

/**
 * Escalate conflict to modal (다른 sub 또는 자동 통합 실패 후).
 */
async function escalateToModal(tab, body, ctx, deps) {
  const { user, sessionId, cfg, fn, getState } = ctx;
  const { apiSaveTab, applyServerToState, showConflictModal } = deps;

  if (typeof showConflictModal !== "function") {
    return { resolved: "no-modal", reason: "showConflictModal not provided" };
  }

  const modalData = {
    tab,
    serverData: body.serverData,
    serverSavedAt: body.serverSavedAt,
    serverVersion: body.serverVersion,
    serverUpdatedBy: body.serverUpdatedBy,

    // 옵션 1: 강제저장 (force=true)
    forceSaveTab: async () => {
      const state = typeof getState === "function" ? getState() : null;
      const data = SAVE_DISPATCH[tab](state);
      if (data === null || data === undefined) {
        throw new Error("강제저장 실패: 데이터 없음");
      }
      return await apiSaveTab(sessionId, tab, data, cfg, fn, {
        force: true,
        user,
        baseSavedAt: body.serverSavedAt,
        baseVersion: body.serverVersion,
      });
    },

    // 옵션 2: 동기화 (applyServerToState)
    receiveServer: () => {
      if (typeof applyServerToState === "function") {
        applyServerToState(tab, body.serverData);
      }
      return { applied: true };
    },
  };

  showConflictModal(tab, modalData);
  return { resolved: "modal-shown", modalData };
}

/**
 * Convenience: apply server data to state (★ N1 영역 — 11 탭 동등 dispatch).
 * 본 함수는 stateless writer — 호출자가 React setState 또는 useReducer 등으로 박제.
 *
 * @param {object} state - current state
 * @param {string} tab - worker tab key
 * @param {object} serverData - data from conflict response
 * @returns {object} new state
 */
export function applyServerToState(state, tab, serverData) {
  return APPLY_SERVER_DISPATCH[tab](state, serverData);
}
