// lab fresh v2 — TAB_ACCESSORS (★ 헌장 §5 11 탭 동등 dispatch)
// 사료: editor/ops/lab-v2-fresh-2026-05-09.md
//   - 묶음 ⑤ G7: dispatch table (5조 11 탭 동등)
//   - 헌장 §5: 11 탭 동등 + §6 부모/자식 카테고리 거부
//   - S1.10.2.a 부모/자식 비대칭 = 코드 위치 차이의 잔재 (★ 본 baseline 에서 폐기)
//   - S5.1 A5: Tab Dispatch (5+α 비대칭 평탄화)
//
// 책임 — 5 dispatch 영역 (S5.1 A5):
//   1. SAVE       — saveDirtyTabsToKV 시 read tab data
//   2. APPLY_SERVER — ConflictModal "동기화" 시 서버 데이터로 React state 갱신 (★ N1 영역)
//   3. FETCH      — 탭 진입 시 fetch (★ 약속 X)
//   4. LAST_LOADED— 탭 fetch 후 ref 갱신 (★ N2 영역)
//   5. DIRTY_SNAPSHOT — currentSnapshot 11 탭 (★ N3 영역)
//
// ★ 핵심 원칙: 모든 11 탭이 동일 read/write 패턴.
//   "부모 직접 state" vs "자식 exportCache" 분리 X (사료 S1.10.2.a — 코드 위치 차이의 잔재).
//   단일 store: state.tabData[tabKey] = data.
//
// 본 모듈 변경 시 charter.test.js 의 §5 단위 테스트 4 가 자동 검증.

import { TAB_KEYS, TAB_MAP, isValidTab } from "./tabs.js";

// ─── 단일 read/write 패턴 (★ 11 탭 동등) ───────────────────────────────

/**
 * Read tab data from state.
 *   state.tabData[tab] (단일 store).
 */
export function readTabData(state, tab) {
  if (!state || typeof state !== "object") return null;
  if (!isValidTab(tab)) return null;
  return state.tabData?.[tab] ?? null;
}

/**
 * Write tab data into state (immutable update).
 *   { ...state, tabData: { ...state.tabData, [tab]: data } }
 */
export function writeTabData(state, tab, data) {
  if (!isValidTab(tab)) return state;
  return {
    ...(state || {}),
    tabData: {
      ...(state?.tabData || {}),
      [tab]: data,
    },
  };
}

/**
 * Patch tab data (deep merge fields).
 *   기존 fields 보존 + incoming fields 적용.
 */
export function patchTabData(state, tab, patch) {
  if (!isValidTab(tab)) return state;
  const current = readTabData(state, tab) || {};
  return writeTabData(state, tab, { ...current, ...patch });
}

// ─── 5 dispatch tables (S5.1 A5) ───────────────────────────────────────

/**
 * 1. SAVE_DISPATCH — 11 탭 모두 동일 패턴.
 *
 *   const data = SAVE_DISPATCH[tab](state);
 *
 * (헌장 §5 11 탭 동등 — switch case X, 단일 함수.)
 */
export const SAVE_DISPATCH = Object.freeze(
  Object.fromEntries(TAB_KEYS.map((tab) => [tab, (state) => readTabData(state, tab)]))
);

/**
 * 2. APPLY_SERVER_DISPATCH — ConflictModal "동기화" 시 서버 데이터 적용.
 *   ★ N1 영역: 11 탭 모두 동등 (자식 7 탭 누락 차단).
 *
 *   const newState = APPLY_SERVER_DISPATCH[tab](state, serverData);
 */
export const APPLY_SERVER_DISPATCH = Object.freeze(
  Object.fromEntries(TAB_KEYS.map((tab) => [tab, (state, data) => writeTabData(state, tab, data)]))
);

/**
 * 3. FETCH_DISPATCH — 탭 진입 시 fetch (★ 약속 X freshness).
 *
 *   const data = await FETCH_DISPATCH[tab](sessionId, cfg, apiLoadTab);
 *
 * 호출자가 apiLoadTab 을 inject (testability + module 분리).
 */
export const FETCH_DISPATCH = Object.freeze(
  Object.fromEntries(TAB_KEYS.map((tab) => [tab, async (sessionId, cfg, apiLoadTab) => {
    if (!apiLoadTab) throw new Error("apiLoadTab inject required");
    const r = await apiLoadTab(sessionId, tab, cfg);
    return r?.data ?? null;
  }]))
);

/**
 * 4. LAST_LOADED_DISPATCH — fetch 후 lastLoadedAt + lastLoadedVersion 박제.
 *   ★ N2 영역: 11 탭 모두 동등 (자식 자체 fetch X — engine 단일 책임).
 *
 *   const newRefs = LAST_LOADED_DISPATCH[tab](refs, savedAt, version);
 */
export const LAST_LOADED_DISPATCH = Object.freeze(
  Object.fromEntries(TAB_KEYS.map((tab) => [tab, (refs, savedAt, version) => ({
    ...refs,
    [tab]: { savedAt, version },
  })]))
);

/**
 * 5. DIRTY_SNAPSHOT_DISPATCH — currentSnapshot 11 탭.
 *   ★ N3 영역: 11 탭 모두 동등 (자식 7 탭 누락 차단).
 *
 *   const snapshot = DIRTY_SNAPSHOT_DISPATCH[tab](state);
 *
 * Snapshot = JSON.stringify(state.tabData) — 탭 별 또는 통합.
 */
export const DIRTY_SNAPSHOT_DISPATCH = Object.freeze(
  Object.fromEntries(TAB_KEYS.map((tab) => [tab, (state) => {
    const d = readTabData(state, tab);
    return d == null ? "null" : JSON.stringify(d);
  }]))
);

/**
 * Build full dirty snapshot across all 11 tabs.
 * (★ S1.11 N3 영역: exportCache 통째 포함 — 자식 탭 누락 0)
 */
export function buildFullSnapshot(state) {
  const snap = {};
  for (const tab of TAB_KEYS) {
    snap[tab] = DIRTY_SNAPSHOT_DISPATCH[tab](state);
  }
  return JSON.stringify(snap);
}

// ─── 11 탭 dispatch 정합 검증 (charter §5 살아있는 명세) ───────────────

/**
 * Verify that all 5 dispatch tables cover all 11 TAB_KEYS.
 * Returns { complete: boolean, missing: { dispatch: [tabs] } }.
 */
export function verifyDispatchCompleteness() {
  const dispatchers = {
    SAVE_DISPATCH,
    APPLY_SERVER_DISPATCH,
    FETCH_DISPATCH,
    LAST_LOADED_DISPATCH,
    DIRTY_SNAPSHOT_DISPATCH,
  };
  const missing = {};
  let complete = true;

  for (const [name, dispatch] of Object.entries(dispatchers)) {
    const missingTabs = TAB_KEYS.filter((t) => typeof dispatch[t] !== "function");
    if (missingTabs.length > 0) {
      complete = false;
      missing[name] = missingTabs;
    }
  }

  return { complete, missing };
}
