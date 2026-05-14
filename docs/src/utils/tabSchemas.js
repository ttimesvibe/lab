// ═══════════════════════════════════════════════════════════════════════════
// tabSchemas.js — 11 탭 데이터 schema 박제 (헌장 v1.1 §5/§6 정식 충족)
// ═══════════════════════════════════════════════════════════════════════════
//
// 본 모듈의 책임:
//   - 11 탭의 데이터 schema 를 단일 진실로 박제
//   - 헌장 §5 (11 탭 동등) 의 살아있는 명세
//   - 헌장 §6 (부모/자식 카테고리 거부) 의 영구 보장
//
// 사용처:
//   - App.jsx 의 tabData store (R1 의 derived state)
//   - 자동저장 흐름 (saveDirtyTabsToKV 의 dispatch)
//   - 탭 진입 fetch (M3 정식)
//   - ConflictModal "서버 받기" (M4 정식)
//   - dispatcher 의 read/write
//
// 변경 시 의무:
//   - 헌장 v1.1 §5/§6 영향 영역 — 사용자 명시 승인 필수
//   - 새 탭 추가 / schema 변경 시 단위 테스트 같이 갱신
//   - localStorage 백업의 payload schema 와 호환 보존 (utils/backup.js 의 schemaVersion "2.0")
//
// ───────────────────────────────────────────────────────────────────────────

export const TAB_IDS = Object.freeze([
  "review",
  "correction",
  "script",
  "guide",
  "highlight",
  "setgen",
  "visual",
  "modify",
  "metadata",
  "manuscript",
  "subtitle",
]);

// UI label (한국어). active-users 표시 / 토스트 / 모달 등에서 사용.
export const TAB_LABELS = Object.freeze({
  review:     "0차 검토",
  correction: "1차 교정",
  script:     "스크립트 편집",
  guide:      "편집 가이드",
  highlight:  "하이라이트",
  setgen:     "세트 생성",
  visual:     "자료-그래픽",
  modify:     "영상 수정",
  metadata:   "메타데이터",
  manuscript: "원고",
  subtitle:   "자막",
});

// ─────────────────────────────────────────────────────────────────────────
// TAB_SCHEMAS — 단일 진실
// ─────────────────────────────────────────────────────────────────────────
//
// 각 탭이 보유하는 데이터 fields 를 명시.
// 부모/자식 카테고리 자체 X — 모든 탭이 동일한 schema 형식.
//
// 본 schema 는:
//   - tabData[tabId] 의 객체 형태
//   - apiSaveTab 의 data 영역
//   - apiLoadTab 의 응답 data 영역
//   - localStorage 백업의 payload 영역
// 모두 일관되게 사용됨.
//
// ───────────────────────────────────────────────────────────────────────────

export const TAB_SCHEMAS = Object.freeze({
  review: {
    fields: ["reviewData"],
    description: "0차 검토 — 원고 분량 / 삭제선 / 예상 영상 길이",
  },
  correction: {
    fields: ["blocks", "anal", "diffs", "scriptEdits", "blockDeletions"],
    description: "1차 교정 — 블록 / 분석 / 변경 / 수동 편집 / 삭제선",
  },
  script: {
    fields: ["blocks", "scriptEdits"],
    description: "스크립트 편집 — 1.5단계 수동 편집",
  },
  guide: {
    fields: ["hl", "hlStats", "hlVerdicts", "hlEdits", "hlMarkers"],
    description: "편집 가이드 — 하이라이트 / 통계 / 평가 / 편집 / 마커",
  },
  highlight: {
    // R3.c — 실제 HighlightTab onSave data 와 일치 (이전: ["hl",...,"clips"] = 추측 / 미사용 영역)
    fields: ["clips", "recs"],
    description: "하이라이트 — 클립 / 추천",
  },
  setgen: {
    // R3.c — 실제 SetgenTab onSave data 와 일치 (이전: ["sets"] = 추측)
    fields: ["result", "trendData", "trendingNow", "keywords", "selections", "edits", "focusKeyword", "timestamps"],
    description: "세트 생성 — 결과 / 트렌드 / 키워드 / 선택 / 편집",
  },
  visual: {
    // R3.c — 실제 VisualTab onSave data 와 일치 (이전: ["guides","items"] = 추측)
    fields: ["visualGuides", "insertCuts", "verdicts", "manualResources", "visualMarkers"],
    description: "자료-그래픽 — 시각화 가이드 / 인서트 컷 / 평가 / 자료 / 마커",
  },
  modify: {
    // R3.c — 실제 ModifyTab onSave data 와 일치 (이전: ["modifications"] = 추측)
    fields: ["videoUrl", "videoId", "title", "cards"],
    description: "영상 수정 — 영상 URL / 제목 / 수정 카드",
  },
  metadata: {
    fields: ["meta"],
    description: "메타데이터 — 영상 제목 / 토픽 / 키워드 / 화자 / 장르",
  },
  manuscript: {
    fields: ["text", "fileName", "paragraphs", "hasTrackChanges", "fullText"],
    description: "원고 — 원본 텍스트 / 파일명 / 단락 / 변경 추적",
  },
  subtitle: {
    fields: ["subtitles", "format"],
    description: "자막 — 자막 데이터 / 포맷",
  },
});

// ─────────────────────────────────────────────────────────────────────────
// 유틸리티
// ─────────────────────────────────────────────────────────────────────────

export function isValidTab(id) {
  return TAB_IDS.includes(id);
}

export function labelOf(id) {
  return TAB_LABELS[id] || id;
}

export function fieldsOf(tabId) {
  if (!isValidTab(tabId)) throw new Error(`Unknown tab: ${tabId}`);
  return TAB_SCHEMAS[tabId].fields;
}

// 객체에서 schema 의 fields 만 추출 (쓸데없는 필드 제거).
// 자동저장 PUT body 빌드 / 데이터 검증 시 사용.
export function pickFields(tabId, source) {
  if (!isValidTab(tabId)) throw new Error(`Unknown tab: ${tabId}`);
  if (!source || typeof source !== "object") return {};
  const fields = TAB_SCHEMAS[tabId].fields;
  const out = {};
  for (const f of fields) {
    if (source[f] !== undefined) out[f] = source[f];
  }
  return out;
}
