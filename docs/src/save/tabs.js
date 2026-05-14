// lab fresh v2 — TAB_MAP 단일 진실 (G1, ★ S2 §12.1)
// 사료: editor/ops/lab-v2-fresh-2026-05-09.md
//   - 묶음 ⑤ G1: TAB_MAP 단일 소스 (UI ↔ Worker ↔ STEP_MAP)
//   - 헌장 §5: 11 탭 동등
//   - S2.2.b PROJECT_TAB_KEYS (worker)
//   - S2.4.2: script (UI) ↔ correction.scriptEdits 동봉 / subtitle (worker) = /subtitle-format 결과
//
// 책임:
//   - TAB_KEYS: 11 worker keys (PROJECT_TAB_KEYS 정합)
//   - TAB_MAP: 각 탭의 metadata (ui / step / dirtyKey)
//   - UI_TABS / STEP_TO_TAB: UI 매핑

// ─── TAB_KEYS (worker PROJECT_TAB_KEYS 정확 일치, S2.2.b) ──────────────

export const TAB_KEYS = Object.freeze([
  "meta", "manuscript", "review", "correction", "subtitle",
  "guide", "visual", "modify", "highlight", "setgen", "metadata",
]);

// ─── TAB_MAP (단일 진실) ────────────────────────────────────────────────

export const TAB_MAP = Object.freeze({
  meta:       { worker: "meta",       ui: null,         step: null, dirtyKey: null,         persist: true,  internal: true },
  manuscript: { worker: "manuscript", ui: "manuscript", step: null, dirtyKey: "manuscript", persist: true,  internal: false },
  review:     { worker: "review",     ui: "review",     step: 0,    dirtyKey: "review",     persist: true,  internal: false },
  correction: { worker: "correction", ui: "correction", step: 1,    dirtyKey: "correction", persist: true,  internal: false },
  // ★ PRD §12.1 정합:
  //   - worker "subtitle" 키 (s:<id>:subtitle) = /subtitle-format LLM 결과 (internal)
  //   - UI "script" 탭 = 1차 교정 텍스트 추출 + 사용자 편집 (correction.scriptEdits 동봉)
  //   - dirtyKey: "correction" — UI script 의 사용자 액션은 correction 을 dirty 마크 (별도 KV 키 X)
  subtitle:   { worker: "subtitle",   ui: "script",     step: 2,    dirtyKey: "correction", persist: true,  internal: true },
  guide:      { worker: "guide",      ui: "guide",      step: 3,    dirtyKey: "guide",      persist: true,  internal: false },
  visual:     { worker: "visual",     ui: "visual",     step: 4,    dirtyKey: "visual",     persist: true,  internal: false },
  modify:     { worker: "modify",     ui: "modify",     step: 5,    dirtyKey: "modify",     persist: true,  internal: false },
  highlight:  { worker: "highlight",  ui: "highlight",  step: 6,    dirtyKey: "highlight",  persist: true,  internal: false },
  setgen:     { worker: "setgen",     ui: "setgen",     step: 7,    dirtyKey: "setgen",     persist: true,  internal: false },
  metadata:   { worker: "metadata",   ui: null,         step: null, dirtyKey: "metadata",   persist: true,  internal: true },
});

// ─── UI 매핑 ────────────────────────────────────────────────────────────

// 9 user-facing tabs (★ 실 UI Phase 1: manuscript 노출, 원고 업로드 진입점)
//   manuscript 는 step null — 0차 검토 (review) 이전 단계
export const UI_TABS = Object.freeze([
  "manuscript",
  "review", "correction", "script", "guide",
  "visual", "modify", "highlight", "setgen",
]);

// step (0~7) → worker tab key (PRD §12.1 정합)
//   step 2 (UI "script") → worker "subtitle"
export const STEP_TO_TAB = Object.freeze([
  "review",     // 0
  "correction", // 1
  "subtitle",   // 2 (UI: script)
  "guide",      // 3
  "visual",     // 4
  "modify",     // 5
  "highlight",  // 6
  "setgen",     // 7
]);

// ─── 헬퍼 ────────────────────────────────────────────────────────────────

/**
 * Get the worker tab key for a UI tab.
 *   "script" → "subtitle"
 *   "review" → "review"
 */
export function uiToWorker(uiTab) {
  for (const [worker, meta] of Object.entries(TAB_MAP)) {
    if (meta.ui === uiTab) return worker;
  }
  return null;
}

/**
 * Get the UI tab for a worker tab key.
 *   "subtitle" → "script"
 *   "review" → "review"
 */
export function workerToUi(workerTab) {
  return TAB_MAP[workerTab]?.ui || null;
}

/**
 * Check if a tab is a valid worker key (E4 화이트리스트).
 */
export function isValidTab(tab) {
  return TAB_KEYS.includes(tab);
}

/**
 * Iterate all persistable tabs (탭 별 저장 대상).
 */
export function persistableTabs() {
  return TAB_KEYS.filter((t) => TAB_MAP[t]?.persist === true);
}
