// lab fresh v2 — clientMerge re-export
// 사료: 묶음 ⑫ M11 — 클라 머지 = 서버 머지 동일 모듈
//
// _mergeImpl.js 의 mergeTabData 를 그대로 re-export.
// 호출자 (App.jsx, ConflictModal "동기화" 옵션) 는 본 모듈만 import.

export {
  mergeTabData as clientMergeTabData,
  deepMerge,
  arrayIdUnion,
  arrayStableIdUnion,
  objectMergeArrayUnion,
  sanitizePayload,
  PROTO_KEYS,
  MAX_DEPTH,
  MERGE_STRATEGIES,
} from "./_mergeImpl.js";
