// lab fresh v2 — A1 Storage Engine factory (★ 단일 책임 통합)
// 사료: editor/ops/lab-v2-fresh-2026-05-09.md
//   - 헌장 §W (Walls of Durability) — engine 단일 책임
//   - 헌장 §1 cascading throttle / §3 dirty 금지 / §5 11 탭 동등
//   - 약속 X freshness / 약속 Y dirty 차단
//   - S5.1 A1: Storage Engine 통합 (호출자에게 결과만 노출, wiring 분산 X)
//   - S1.6 §11 cutover 폐기 교훈: engine 통째 활용 X — App.jsx 직접 호출도 OK
//     (본 engine 은 단순 factory + composer. App.jsx 가 자유롭게 사용 가능.)
//
// 책임:
//   - createSaveEngine(deps) — 모든 모듈 (A2~A8) 을 단일 객체로 묶음
//   - 호출자 노출 API:
//       bootstrap(defaultTab) — Lazy 마운트
//       markDirty(tab) — 사용자 입력 시
//       enterTab(tab) — 탭 진입 시
//       saveNow({ manual, force }) — 수동 저장 / 강제 저장
//       applyServer(tab, data) — ConflictModal "동기화"
//       startPolling() / stopPolling() / leave() / onVisibilityChange()
//       getDirtyTabs() / isDirty(tab) / getRefs() — 상태 inspection
//       dispose() — cleanup
//
// ★ 사고 D 회피: 호출자 측 wiring 분산 X.
//   - dirty / throttle / save / conflict / enterTab / polling 모두 engine 안.
//   - 호출자는 markDirty / enterTab / saveNow / applyServer 만 호출.

import { createDirtyTracker } from "./dirty.js";
import { createCascadingThrottle } from "./throttle.js";
import { saveDirtyTabsToKV, updateRefs } from "./savePath.js";
import { buildConflictHandler, applyServerToState } from "./conflict.js";
import { buildEnterTabHandler } from "./enterTab.js";
import { createPolling } from "./polling.js";
import { isValidTab } from "./tabs.js";

const DEFAULT_THROTTLE_DELAY_MS = 30 * 1000;

/**
 * Create a save engine.
 *
 * @param {object} deps
 *   상태 source/sink:
 *   - sessionId (string)
 *   - cfg (object) — { workerUrl }
 *   - getUser (function) — () => user | null
 *   - getState (function) — () => state ({ tabData })
 *   - applyState (function) — (tab, data) => void  (React setState 등)
 *   - getCurrentTab (function|null) — () => string (UI 현재 탭)
 *
 *   API:
 *   - apiSaveTab (function) — inject
 *   - apiLoadTab (function)
 *   - apiHeartbeat (function)
 *   - apiLeave (function)
 *   - apiLoadMeta (function|null)
 *
 *   UX callbacks:
 *   - showConflictModal (function|null) — (tab, modalData) => void
 *   - onActiveUsers (function|null) — (users) => void
 *   - onOtherUserToast (function|null) — (info) => void
 *   - on401 (function|null) — () => void
 *   - onMerged (function|null) — (tab, mergedBy) => void  (★ N6 B10 토스트)
 *   - onSaveResult (function|null) — (result) => void  (자동 저장 결과 보고)
 *   - onError (function|null) — (err, ctx) => void
 *
 *   옵션:
 *   - throttleDelayMs (number, default 30000)
 *
 * Returns engine API.
 */
export function createSaveEngine(deps = {}) {
  const {
    sessionId, cfg, getUser, getState, applyState, getCurrentTab,
    apiSaveTab, apiLoadTab, apiHeartbeat, apiLeave, apiLoadMeta,
    showConflictModal, onActiveUsers, onOtherUserToast, on401, onMerged, onSaveResult, onError,
    throttleDelayMs = DEFAULT_THROTTLE_DELAY_MS,
  } = deps;

  // 필수 검증
  if (!sessionId) throw new Error("createSaveEngine: sessionId required");
  if (typeof apiSaveTab !== "function") throw new Error("createSaveEngine: apiSaveTab required");
  if (typeof apiLoadTab !== "function") throw new Error("createSaveEngine: apiLoadTab required");
  if (typeof getState !== "function") throw new Error("createSaveEngine: getState required");

  // ─── 내부 상태 ────────────────────────────────────────────────────────

  const dirty = createDirtyTracker();
  let refs = {};                     // { [tab]: { savedAt, version } }
  let disposed = false;

  // ─── A4 saveNow (자동/수동 통일) ──────────────────────────────────────

  async function performSave({ manual = false, force = false } = {}) {
    if (disposed) return null;
    const tabs = dirty.getDirtyTabs();
    if (tabs.size === 0) {
      return { success: [], failed: [], conflicts: [], merged: [] };
    }

    const result = await saveDirtyTabsToKV(tabs, {
      state: getState(),
      sessionId,
      cfg,
      fn: getState()?.tabData?.meta?.fn,
      user: typeof getUser === "function" ? getUser() : null,
      refs,
      apiSaveTab,
      manual,
      force,
      onMerged,
    });

    // PUT 성공 탭은 dirty clean + refs 갱신
    for (const s of result.success) {
      if (s.status === "success") {
        dirty.markClean(s.tab);
        if (s.savedAt && s.version != null) {
          refs = updateRefs(refs, s.tab, s.savedAt, s.version);
        }
      } else if (s.status === "skip") {
        // skip 은 dirty 그대로 (no data)
      }
    }

    // 충돌 → conflict handler
    for (const c of result.conflicts) {
      try {
        await conflictHandler(c.tab, c.error, {
          user: typeof getUser === "function" ? getUser() : null,
          sessionId,
          cfg,
          fn: getState()?.tabData?.meta?.fn,
          getState,
          getRefs: () => refs,
        });
      } catch (e) {
        if (typeof onError === "function") onError(e, { tab: c.tab, phase: "conflict-handler" });
      }
    }

    // 실패 → onError
    for (const f of result.failed) {
      if (typeof onError === "function") onError(f.error, { tab: f.tab, phase: "save" });
    }

    // 통합 callback
    if (typeof onSaveResult === "function") onSaveResult(result);

    return result;
  }

  // ─── A3 throttle ──────────────────────────────────────────────────────

  const throttle = createCascadingThrottle({
    delayMs: throttleDelayMs,
    onFire: async () => {
      const result = await performSave({ manual: false });
      // ★ 헌장 §1 cascading: PUT 후 dirty 잔존 → 새 cycle
      if (!disposed && dirty.dirtyCount() > 0) {
        throttle.schedule();
      }
    },
  });

  // ─── A6 conflict handler ──────────────────────────────────────────────

  const conflictHandler = buildConflictHandler({
    apiSaveTab,
    applyServerToState: (tab, serverData) => {
      // ★ 약속 Y — server data 적용 동안 dirty 차단
      dirty.setBlockFlag("isApplyingServer", true);
      try {
        if (typeof applyState === "function") applyState(tab, serverData);
        // PUT 성공 탭은 dirty clean
        dirty.markClean(tab);
      } finally {
        dirty.setBlockFlag("isApplyingServer", false);
      }
    },
    showConflictModal,
  });

  // ─── A7 enterTab ──────────────────────────────────────────────────────

  const enterTabHandler = buildEnterTabHandler({
    dirty,
    apiLoadTab,
    applyState: (tab, data) => {
      if (typeof applyState === "function") applyState(tab, data);
    },
    setRefs: (tab, savedAt, version) => {
      refs = updateRefs(refs, tab, savedAt, version);
    },
  });

  // ─── A8 polling ───────────────────────────────────────────────────────

  let polling = null;
  if (typeof apiHeartbeat === "function") {
    polling = createPolling({
      sessionId,
      cfg,
      getUser,
      getCurrentTab,
      getRefs: () => refs,
      apiHeartbeat,
      apiLeave,
      apiLoadMeta,
      onActiveUsers,
      onOtherUserToast,
      on401,
    });
  }

  // ─── 공개 API ─────────────────────────────────────────────────────────

  /**
   * Bootstrap (★ Lazy 마운트 — default 탭만 fetch).
   */
  async function bootstrap(defaultTab) {
    if (disposed) return null;

    // 헌장 약속 Y — initial load 동안 dirty 차단
    return await dirty.withBlock("isInitialLoad", async () => {
      // 1. meta 로드
      try {
        if (typeof apiLoadMeta === "function") {
          const r = await apiLoadMeta(sessionId, cfg);
          if (r?.meta) {
            if (typeof applyState === "function") applyState("meta", r.meta);
          }
        }
      } catch (e) {
        if (typeof onError === "function") onError(e, { phase: "bootstrap-meta" });
      }
      // 2. default 탭 fetch
      if (defaultTab && isValidTab(defaultTab)) {
        return await enterTabHandler(defaultTab, { sessionId, cfg });
      }
      return { skipped: true };
    });
  }

  /**
   * Mark a tab dirty (★ 사용자 입력 시). Auto-schedule throttle.
   */
  function markDirty(tab) {
    if (disposed) return false;
    const ok = dirty.markDirty(tab);
    if (ok) {
      throttle.schedule();
    }
    return ok;
  }

  /**
   * Enter a tab (★ 헌장 약속 X — fresh fetch if not dirty).
   */
  async function enterTab(tab) {
    if (disposed) return null;
    return await enterTabHandler(tab, { sessionId, cfg });
  }

  /**
   * Save now (★ 수동 저장 버튼).
   */
  async function saveNow(opts = {}) {
    if (disposed) return null;
    return await performSave({ manual: true, ...opts });
  }

  /**
   * Apply server data (★ ConflictModal "동기화" 옵션).
   */
  function applyServer(tab, data) {
    if (disposed) return false;
    if (!isValidTab(tab)) return false;
    dirty.setBlockFlag("isApplyingServer", true);
    try {
      if (typeof applyState === "function") applyState(tab, data);
      dirty.markClean(tab);
    } finally {
      dirty.setBlockFlag("isApplyingServer", false);
    }
    return true;
  }

  /**
   * Force save a tab (ConflictModal "강제저장" — server 측 force=true 재시도).
   */
  async function forceSave(tab) {
    if (disposed || !isValidTab(tab)) return null;
    const result = await saveDirtyTabsToKV([tab], {
      state: getState(),
      sessionId,
      cfg,
      fn: getState()?.tabData?.meta?.fn,
      user: typeof getUser === "function" ? getUser() : null,
      refs,
      apiSaveTab,
      manual: true,
      force: true,
    });
    for (const s of result.success) {
      if (s.status === "success") {
        dirty.markClean(s.tab);
        if (s.savedAt && s.version != null) {
          refs = updateRefs(refs, s.tab, s.savedAt, s.version);
        }
      }
    }
    return result;
  }

  /**
   * Polling control (★ A8).
   */
  function startPolling() {
    if (polling && !disposed) return polling.start();
    return false;
  }

  function stopPolling() {
    if (polling) polling.stop();
  }

  /**
   * Leave (★ pagehide sendBeacon, 인증 면제).
   */
  function leave() {
    if (polling) return polling.leave();
    return false;
  }

  /**
   * Visibility change handler.
   */
  function onVisibilityChange() {
    if (polling) polling.onVisibilityChange();
  }

  /**
   * Inspection helpers.
   */
  function getDirtyTabs() { return dirty.getDirtyTabs(); }
  function isDirty(tab) { return dirty.isDirty(tab); }
  function getRefs() { return { ...refs }; }
  function isThrottleScheduled() { return throttle.isScheduled(); }

  /**
   * Dispose — cleanup all timers + polling.
   */
  function dispose() {
    if (disposed) return;
    disposed = true;
    throttle.dispose();
    if (polling) polling.stop();
  }

  return {
    // 공개 API
    bootstrap,
    markDirty,
    enterTab,
    saveNow,
    applyServer,
    forceSave,
    startPolling,
    stopPolling,
    leave,
    onVisibilityChange,
    dispose,
    // Inspection
    getDirtyTabs,
    isDirty,
    getRefs,
    isThrottleScheduled,
    // 내부 노출 (테스트용)
    _internal: { dirty, throttle, polling },
  };
}
