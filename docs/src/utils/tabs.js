// CMS v2 — 탭/단계 정의 단일 소스 (G1, N1, 2026-05-09 통합)
// 묶음 ⑤ 가드레일 정합화의 핵심.
// UI ↔ Worker ↔ STEP_MAP ↔ STATUS_MAP ↔ STEP_LABELS ↔ STEP_COLORS 전부 한 곳.
//
// 2026-05-09 통합 이전엔 정의가 4-5곳 산재 (Dashboard.jsx STATUS_MAP/STEP_LABELS/STEP_KEYS,
// KanbanView.jsx STEP_KEYS/STEP_LABELS/STEP_COLORS, App.jsx STEP_MAP, 편집 탭 인라인 배열).
// 같은 정보가 여러 형태로 박혀 라벨/색 변경 시 다 잊지 말고 손봐야 했음 (visual mismatch 버그
// 가 정확히 그 결과물). 이제 TAB_MAP 한 곳 수정 → 전 영역 자동 반영.

export const TAB_MAP = {
  meta:       { worker: "meta",       ui: null,         step: null, dirtyKey: null,         label: null,        statusLabel: null,        color: null },
  manuscript: { worker: "manuscript", ui: null,         step: null, dirtyKey: null,         label: null,        statusLabel: null,        color: null },
  review:     { worker: "review",     ui: "review",     step: 0,    dirtyKey: "review",     label: "0차 검토",   statusLabel: "진행중",     color: "#22C55E" },
  correction: { worker: "correction", ui: "correction", step: 1,    dirtyKey: "correction", label: "1차 교정",   statusLabel: "진행중",     color: "#22C55E" },
  // UI 의 "script" 탭은 데이터를 correction 안에 동봉 저장 (App.jsx:487 검증됨)
  // 별도 worker 키 = subtitle (자막 결과 캐시)
  subtitle:   { worker: "subtitle",   ui: "script",     step: 2,    dirtyKey: "correction", label: "스크립트",   statusLabel: "진행중",     color: "#22C55E" },
  guide:      { worker: "guide",      ui: "guide",      step: 3,    dirtyKey: "guide",      label: "편집가이드", statusLabel: "편집가이드", color: "#3B82F6" },
  visual:     { worker: "visual",     ui: "visual",     step: 4,    dirtyKey: "visual",     label: "자료·그래픽", statusLabel: "자료·그래픽", color: "#A855F7" },
  modify:     { worker: "modify",     ui: "modify",     step: 5,    dirtyKey: "modify",     label: "수정사항",   statusLabel: "수정사항",   color: "#F59E0B" },
  highlight:  { worker: "highlight",  ui: "highlight",  step: 6,    dirtyKey: "highlight",  label: "하이라이트", statusLabel: "하이라이트", color: "#22C55E" },
  setgen:     { worker: "setgen",     ui: "setgen",     step: 7,    dirtyKey: "setgen",     label: "세트",       statusLabel: "세트",       color: "#22C55E" },
  metadata:   { worker: "metadata",   ui: null,         step: null, dirtyKey: "metadata",   label: null,        statusLabel: null,        color: null },
};

// done 은 단계가 아니라 별 상태 (status 만 의미)
export const DONE_STATE = { label: "완료", statusLabel: "완료", color: "#5E6380" };

// Worker 측에서 인정하는 탭 키 (E4 입력 검증)
export const PROJECT_TAB_KEYS = Object.values(TAB_MAP).map(t => t.worker);

// ── UI 단계 derived (step 가진 ui 탭만, step 순) ────────────────────────────
const UI_STEPS = Object.values(TAB_MAP)
  .filter(t => t.ui && t.step != null)
  .sort((a, b) => a.step - b.step);

// UI step 키 순서 (구 STEP_KEYS, 진행바/탭 순회용)
export const STEP_KEYS = UI_STEPS.map(t => t.ui);

// step → UI 탭 라벨 (구 STEP_LABELS, "현재 단계" 컬럼 / 편집 탭 / 칸반 카드 라벨용)
export const STEP_LABELS = {
  ...Object.fromEntries(UI_STEPS.map(t => [t.ui, t.label])),
  done: DONE_STATE.label,
};

// step → 카드 색 (구 STEP_COLORS, 칸반 카드 진행바/badge 색용)
export const STEP_COLORS = {
  ...Object.fromEntries(UI_STEPS.map(t => [t.ui, t.color])),
  done: DONE_STATE.color,
};

// step → 게시판 배지 정보 (구 STATUS_MAP, label + color)
//   review/correction/script 는 group label "진행중" 으로 묶음 (디자인 의도).
//   guide/visual/modify/highlight/setgen 은 statusLabel = label 동일 (2026-05-09 통일).
export const STATUS_MAP = {
  ...Object.fromEntries(UI_STEPS.map(t => [t.ui, { label: t.statusLabel, color: t.color }])),
  done: { label: DONE_STATE.statusLabel, color: DONE_STATE.color },
};

// step → UI 인덱스 (구 STEP_MAP, apiProjectUpdateStep 의 stepIndex 용)
export const STEP_MAP = Object.fromEntries(UI_STEPS.map(t => [t.ui, t.step]));

// dirty 추적 가능한 탭 (saveDirtyTabsToKV 의 dispatch table 키)
export const DIRTY_TABS = [...new Set(
  Object.values(TAB_MAP).filter(t => t.dirtyKey).map(t => t.dirtyKey)
)];

// ── 변환 유틸 ───────────────────────────────────────────────────────────────

// UI ID → Worker key 변환
export function uiToWorker(uiId) {
  for (const [key, v] of Object.entries(TAB_MAP)) {
    if (v.ui === uiId) return v.worker;
  }
  return uiId;  // fallback
}

// dirtyKey → 어느 worker 키에 저장할지 (subtitle 의 데이터는 correction 동봉)
export function dirtyKeyToWorker(dirtyKey) {
  return dirtyKey;  // 현재는 1:1 (subtitle 만 correction 으로 동봉)
}

// body.tab 입력 검증 (E4)
export function isValidTabKey(tab) {
  return PROJECT_TAB_KEYS.includes(tab);
}

// body.id 입력 검증 (E5)
export function isValidSessionId(id) {
  return typeof id === "string" && /^[a-z0-9]{8}$/.test(id);
}
