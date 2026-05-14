// CMS v2 — Worker 측 머지 모듈 (묶음 ⑥)
// 출처: cms-v2-plan/06_v2_finalization/reviews/bundle_06_perfection.md (B1, B6, B12)
// 동일 모듈을 docs/src/utils/clientMerge.js 가 import (M11)
// 변경 시 단위 테스트 (worker/__tests__/mergeTabData.test.js) 동시 갱신 필수.

export const PROTO_KEYS = new Set(["__proto__", "constructor", "prototype"]);
export const MAX_DEPTH = 32;

// SHA-256 12자 fallback ID (B2 / B4)
// Cloudflare Worker + Node 양쪽 호환: globalThis.crypto.subtle 사용 (Node 19+ / Worker 표준).
// Node test runner (22.x) 도 globalThis.crypto 제공.
async function sha256_12(str) {
  const buf = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
  return [...new Uint8Array(buf)].slice(0, 6).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// fallback ID 동기 버전 (단순 hash, 충돌 가능성 더 높지만 빠름)
//
// ★ 데이터 손실 방지 (Value 1) — 항목에 클라이언트가 박은 안정 식별자 `id` 가 있으면 그것을 최우선 사용.
//   modify.cards / highlight.clips 같이 사용자가 직접 만든 항목은 `_stableId` 가 없고
//   기존 entityType 기반 fallback (blockIndex|type|query|url, subtitle|speaker|startMs) 와
//   실제 필드 shape 가 mismatch → 모든 항목이 같은 키로 떨어져 arrayIdUnion 의 Map 이
//   마지막 항목으로 덮어씌워 → 1 개만 남는 손실 발생. (worker/__tests__/mergeTabData.test.js id-fallback 회귀 참고)
function fallbackKeySync(item, type) {
  // 0. 클라이언트 안정 id 우선 (cards/clips/manualResources 등 사용자 생성 항목)
  if (item && item.id != null && item.id !== "") return `id:${item.id}`;
  if (type === "hl") {
    return `${item.subtitle ?? ""}|${item.speaker ?? ""}|${item.startMs ?? ""}`;
  }
  if (type === "diffs") {
    return `${item.blockIndex ?? ""}|${item.posStart ?? ""}|${item.posEnd ?? ""}|${item.kind ?? ""}`;
  }
  if (type === "visualGuides" || type === "insertCuts" || type === "manualResources") {
    return `${item.blockIndex ?? ""}|${item.type ?? ""}|${item.query ?? ""}|${item.url ?? ""}`;
  }
  // 기본: JSON 직렬화 (완전 fallback)
  return JSON.stringify(item);
}

export const MERGE_STRATEGIES = {
  correction: {
    blocks: { kind: "array_id_union", idFn: (b) => b.index },
    diffs: { kind: "array_stable_id_union", entityType: "diffs" },
    scriptEdits: { kind: "object_merge_recursive" },
    blockDeletions: { kind: "object_merge_array_union" },
    anal: { kind: "object_merge_recursive" },
  },
  guide: {
    hl: { kind: "array_stable_id_union", entityType: "hl" },
    hlStats: { kind: "last_write_wins" },
    hlVerdicts: { kind: "object_merge_recursive" },
    hlEdits: { kind: "object_merge_recursive" },
    hlMarkers: { kind: "object_merge_recursive" },
  },
  visual: {
    visualGuides: { kind: "array_stable_id_union", entityType: "visualGuides" },
    insertCuts: { kind: "array_stable_id_union", entityType: "insertCuts" },
    manualResources: { kind: "array_stable_id_union", entityType: "manualResources" },
    verdicts: { kind: "object_merge_recursive" },
    visualMarkers: { kind: "object_merge_recursive" },
  },
  highlight: { clips: { kind: "array_stable_id_union", entityType: "hl" }, recs: { kind: "last_write_wins" } },
  setgen: { result: { kind: "object_merge_recursive" }, sel: { kind: "object_merge_recursive" }, edits: { kind: "object_merge_recursive" } },
  review: { __recursive: true },  // 단순 객체 — 통째 재귀 deep merge
  metadata: { __recursive: true },
  manuscript: { __replace: true }, // 재업로드 = 통째 교체 (W1, 사용자 confirm 후)
  modify: { cards: { kind: "array_stable_id_union", entityType: "manualResources" }, videoUrl: { kind: "last_write_wins" } },
  meta: { __recursive: true },  // 메타는 RMW + 재귀 머지
};

// PROTO_KEYS 차단 sanitizer (B12)
export function sanitizePayload(obj, depth = 0) {
  if (depth > MAX_DEPTH) return obj;
  if (typeof obj !== "object" || obj === null) return obj;
  if (Array.isArray(obj)) return obj.map((x) => sanitizePayload(x, depth + 1));
  const out = {};
  for (const k of Object.keys(obj)) {
    if (PROTO_KEYS.has(k)) continue;
    out[k] = sanitizePayload(obj[k], depth + 1);
  }
  return out;
}

// 재귀 deep merge (B1)
export function deepMerge(existing, incoming, depth = 0, seen = new WeakSet()) {
  if (depth > MAX_DEPTH) return incoming;
  if (incoming === undefined) return existing;
  if (existing === undefined) return incoming;
  if (incoming === null) return null;  // 명시적 삭제
  if (existing === null) return incoming;

  const eType = Array.isArray(existing) ? "array" : typeof existing;
  const iType = Array.isArray(incoming) ? "array" : typeof incoming;
  if (eType !== iType) return incoming;
  if (iType !== "object" && iType !== "array") return incoming;

  if (typeof existing === "object" && (seen.has(existing) || seen.has(incoming))) return incoming;
  if (typeof existing === "object") { seen.add(existing); seen.add(incoming); }

  if (iType === "array") return incoming;

  const merged = { ...existing };
  for (const key of Object.keys(incoming)) {
    if (PROTO_KEYS.has(key)) continue;
    merged[key] = deepMerge(existing[key], incoming[key], depth + 1, seen);
  }
  return merged;
}

// 배열 ID union (B1)
export function arrayIdUnion(existingArr, incomingArr, idFn) {
  const ea = Array.isArray(existingArr) ? existingArr : [];
  const ia = Array.isArray(incomingArr) ? incomingArr : [];
  const map = new Map();
  for (const item of ea) {
    const k = idFn(item);
    if (k != null) map.set(k, item);
  }
  for (const item of ia) {
    const k = idFn(item);
    if (k == null) continue;
    map.set(k, item);
  }
  return [...map.values()];
}

export function mergeObjectWithArrayUnion(ev, iv) {
  const result = { ...(ev || {}) };
  for (const k of Object.keys(iv || {})) {
    if (PROTO_KEYS.has(k)) continue;
    const exA = Array.isArray(ev?.[k]) ? ev[k] : [];
    const inA = Array.isArray(iv[k]) ? iv[k] : [];
    const seen = new Set(exA.map((a) => JSON.stringify(a)));
    const out = [...exA];
    for (const item of inA) {
      const key = JSON.stringify(item);
      if (!seen.has(key)) { out.push(item); seen.add(key); }
    }
    result[k] = out;
  }
  return result;
}

// 메인 머지 함수 (B1)
export function mergeTabData(existing, incoming, tab) {
  const strategy = MERGE_STRATEGIES[tab];
  if (!strategy) return incoming;

  if (typeof incoming !== "object" || incoming === null) return incoming;

  // __replace = 통째 교체 (manuscript)
  if (strategy.__replace) return incoming;
  // __recursive = 통째 재귀 deep merge
  if (strategy.__recursive) return deepMerge(existing, incoming);

  const merged = { ...(existing || {}) };
  const allKeys = new Set([...Object.keys(existing || {}), ...Object.keys(incoming || {})]);
  for (const key of allKeys) {
    if (PROTO_KEYS.has(key)) continue;
    const ev = existing?.[key];
    const iv = incoming?.[key];
    const spec = strategy[key];

    if (iv === undefined) { merged[key] = ev; continue; }

    if (!spec) {
      // strategy 미정의 키 → 재귀 머지 (안전 default)
      merged[key] = deepMerge(ev, iv);
      continue;
    }

    switch (spec.kind) {
      case "array_id_union":
        merged[key] = arrayIdUnion(ev, iv, spec.idFn);
        break;
      case "array_stable_id_union": {
        const idFn = (item) => item._stableId ?? fallbackKeySync(item, spec.entityType);
        merged[key] = arrayIdUnion(ev, iv, idFn);
        break;
      }
      case "object_merge":
        merged[key] = { ...(ev || {}), ...(iv || {}) };
        break;
      case "object_merge_recursive":
        merged[key] = deepMerge(ev, iv);
        break;
      case "object_merge_array_union":
        merged[key] = mergeObjectWithArrayUnion(ev, iv);
        break;
      case "last_write_wins":
        merged[key] = iv;
        break;
      default:
        merged[key] = deepMerge(ev, iv);
    }
  }
  return merged;
}

// 무결성 검증 (B6)
export function validateMergeResult(existing, merged, tab) {
  const violations = [];
  // 1. blocks 길이 감소 금지
  if (Array.isArray(existing?.blocks) && Array.isArray(merged?.blocks)) {
    if (merged.blocks.length < existing.blocks.length) {
      violations.push(`blocks length decreased: ${existing.blocks.length} → ${merged.blocks.length}`);
    }
  }
  // 2. _stableId unique
  for (const entityType of ["hl", "visualGuides", "insertCuts", "manualResources", "diffs"]) {
    const arr = merged?.[entityType];
    if (!Array.isArray(arr)) continue;
    const ids = arr.map((i) => i?._stableId).filter(Boolean);
    if (new Set(ids).size !== ids.length) {
      violations.push(`${entityType}: duplicate _stableId`);
    }
  }
  // 3. PROTO_KEYS leak
  function checkProto(obj, path = "") {
    if (typeof obj !== "object" || obj === null) return;
    for (const k of Object.keys(obj)) {
      if (PROTO_KEYS.has(k)) violations.push(`prototype key leak: ${path}.${k}`);
    }
  }
  checkProto(merged);
  return violations;
}

// 충돌 감지 (B5 — savedAt + version)
export function detectConflict(existing, body) {
  if (!existing) return { conflict: false };
  // version 우선 (정확)
  if (body.baseVersion !== undefined && existing.version !== undefined) {
    if (body.baseVersion < existing.version) {
      return {
        conflict: true,
        serverSavedAt: existing.savedAt,
        serverVersion: existing.version,
        serverUpdatedBy: existing.updatedBy,
        serverData: existing,
      };
    }
  }
  // 시각 보조
  if (body.baseSavedAt && existing.savedAt && body.baseSavedAt < existing.savedAt) {
    return {
      conflict: true,
      serverSavedAt: existing.savedAt,
      serverVersion: existing.version,
      serverUpdatedBy: existing.updatedBy,
      serverData: existing,
    };
  }
  return { conflict: false };
}
