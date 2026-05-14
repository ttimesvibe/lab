// CMS v2 — 클라이언트 머지 (B3 옵션 "양쪽 합치기" / M11)
// worker/merge.js 와 동일 로직. sibling _mergeImpl.js 에 사본 (Vite 빌드 호환).
// 변경 시 양쪽 동기화 의무 (worker/merge.js → docs/src/utils/_mergeImpl.js cp).
// 단위 테스트 (worker/__tests__/mergeTabData.test.js) 가 양쪽 일치 보증.

export {
  PROTO_KEYS,
  MAX_DEPTH,
  MERGE_STRATEGIES,
  sanitizePayload,
  deepMerge,
  arrayIdUnion,
  mergeObjectWithArrayUnion,
  mergeTabData,
  validateMergeResult,
  detectConflict,
} from "./_mergeImpl.js";
