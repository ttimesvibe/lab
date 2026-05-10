// lab fresh v2 — frontend merge impl (worker/merge.js 사본)
// 사료: editor/ops/lab-v2-fresh-2026-05-09.md
//   - 묶음 ⑫ M11: 클라 머지 = 서버 머지 동일 모듈 (★ 영구 의무)
//   - S3.3 B1 deepMerge 8 엣지
//
// ★ 본 파일 = worker/merge.js 의 사본 (브라우저 환경).
// ★ 사양 변경 시 worker/merge.js 와 같은 commit 에서 동시 수정 의무 (drift 차단).

export const PROTO_KEYS = new Set(["__proto__", "constructor", "prototype"]);
export const MAX_DEPTH = 32;

export const MERGE_STRATEGIES = Object.freeze({
  correction: {
    blocks: "array_id_union",
    diffs: "array_stable_id_union",
    anal: "object_merge_recursive",
    scriptEdits: "object_merge_recursive",
    blockDeletions: "object_merge_array_union",
  },
  review: {
    reviewBlocks: "array_id_union",
    paragraphs: "last_write_wins",
    blockStrikeRanges: "object_merge_recursive",
    deletedBlockIndices: "array_id_union",
    duration: "last_write_wins",
    cleanText: "last_write_wins",
    hasTrackChanges: "last_write_wins",
  },
  guide: {
    hl: "array_stable_id_union",
    hlStats: "object_merge_recursive",
    hlVerdicts: "object_merge_recursive",
    hlEdits: "object_merge_recursive",
    hlMarkers: "object_merge_recursive",
  },
  highlight: {
    hl: "array_stable_id_union",
    hlStats: "object_merge_recursive",
    hlVerdicts: "object_merge_recursive",
    hlEdits: "object_merge_recursive",
    hlMarkers: "object_merge_recursive",
    clips: "array_stable_id_union",
  },
  visual: {
    visualGuides: "array_stable_id_union",
    insertCuts: "array_stable_id_union",
    manualResources: "array_stable_id_union",
    verdicts: "object_merge_recursive",
    visualMarkers: "object_merge_recursive",
  },
  setgen: {
    sets: "array_stable_id_union",
    result: "object_merge_recursive",
    sel: "object_merge_recursive",
    edits: "object_merge_recursive",
  },
  modify: {
    cards: "array_stable_id_union",
    videoUrl: "last_write_wins",
    videoId: "last_write_wins",
    title: "last_write_wins",
  },
  metadata: {
    interviewee: "last_write_wins",
    topic: "last_write_wins",
    keywords: "object_merge_recursive",
    speakers: "array_stable_id_union",
    genre: "object_merge_recursive",
  },
  manuscript: {
    text: "last_write_wins",
    fileName: "last_write_wins",
    paragraphs: "last_write_wins",
    hasTrackChanges: "last_write_wins",
    fullText: "last_write_wins",
  },
  subtitle: {
    subtitles: "last_write_wins",
    format: "last_write_wins",
  },
  meta: {
    stages: "object_merge_recursive",
    schemaVersion: "last_write_wins",
    fn: "last_write_wins",
  },
  script: {
    scriptEdits: "object_merge_recursive",
    blocks: "array_id_union",
  },
});

export function deepMerge(existing, incoming, depth = 0, seen = new WeakSet()) {
  if (depth > MAX_DEPTH) return incoming;
  if (incoming === undefined) return existing;
  if (existing === undefined) return incoming;
  if (incoming === null) return null;
  if (existing === null) return incoming;

  const eType = Array.isArray(existing) ? "array" : typeof existing;
  const iType = Array.isArray(incoming) ? "array" : typeof incoming;
  if (eType !== iType) return incoming;
  if (iType !== "object" && iType !== "array") return incoming;

  if (seen.has(existing) || seen.has(incoming)) return incoming;
  seen.add(existing);
  seen.add(incoming);

  if (iType === "array") return incoming;

  const merged = {};
  for (const key of Object.keys(existing)) {
    if (PROTO_KEYS.has(key)) continue;
    merged[key] = existing[key];
  }
  for (const key of Object.keys(incoming)) {
    if (PROTO_KEYS.has(key)) continue;
    merged[key] = deepMerge(existing[key], incoming[key], depth + 1, seen);
  }
  return merged;
}

export function arrayIdUnion(existingArr, incomingArr, idFn) {
  const ea = Array.isArray(existingArr) ? existingArr : [];
  const ia = Array.isArray(incomingArr) ? incomingArr : [];
  const map = new Map();
  for (const item of ea) {
    if (item == null) continue;
    const k = idFn(item);
    if (k == null) continue;
    map.set(k, item);
  }
  for (const item of ia) {
    if (item == null) continue;
    const k = idFn(item);
    if (k == null) continue;
    const prev = map.get(k);
    if (prev && typeof prev === "object" && typeof item === "object" && !Array.isArray(prev) && !Array.isArray(item)) {
      map.set(k, deepMerge(prev, item));
    } else {
      map.set(k, item);
    }
  }
  return [...map.values()];
}

export function arrayStableIdUnion(existingArr, incomingArr) {
  return arrayIdUnion(existingArr, incomingArr, (item) => {
    if (!item) return null;
    if (item._stableId != null) return String(item._stableId);
    if (item.id != null) return `id:${item.id}`;
    if (item.subtitle != null) return `subtitle:${item.subtitle}`;
    if (item.text != null) return `text:${item.text}`;
    return null;
  });
}

export function objectMergeArrayUnion(ev, iv) {
  const merged = {};
  if (ev && typeof ev === "object" && !Array.isArray(ev)) {
    for (const k of Object.keys(ev)) {
      if (PROTO_KEYS.has(k)) continue;
      merged[k] = ev[k];
    }
  }
  if (iv && typeof iv === "object" && !Array.isArray(iv)) {
    for (const k of Object.keys(iv)) {
      if (PROTO_KEYS.has(k)) continue;
      const existingVal = merged[k];
      const incomingVal = iv[k];
      if (Array.isArray(existingVal) && Array.isArray(incomingVal)) {
        const seen = new Set(existingVal.map((a) => JSON.stringify(a)));
        const out = [...existingVal];
        for (const item of incomingVal) {
          const key = JSON.stringify(item);
          if (!seen.has(key)) {
            out.push(item);
            seen.add(key);
          }
        }
        merged[k] = out;
      } else {
        merged[k] = incomingVal;
      }
    }
  }
  return merged;
}

export async function mergeTabData(existing, incoming, tab) {
  const strategy = MERGE_STRATEGIES[tab];
  if (!strategy) return incoming;
  if (typeof incoming !== "object" || incoming === null) return incoming;

  const merged = {};
  if (existing && typeof existing === "object" && !Array.isArray(existing)) {
    for (const k of Object.keys(existing)) {
      if (PROTO_KEYS.has(k)) continue;
      merged[k] = existing[k];
    }
  }

  for (const key of Object.keys(incoming)) {
    if (PROTO_KEYS.has(key)) continue;
    const ev = existing?.[key];
    const iv = incoming[key];
    const mode = strategy[key];
    if (iv === undefined) continue;

    switch (mode) {
      case "array_id_union":
        merged[key] = arrayIdUnion(ev, iv, (item) => {
          if (!item) return null;
          if (item.index != null) return `idx:${item.index}`;
          if (item.id != null) return `id:${item.id}`;
          return null;
        });
        break;
      case "array_stable_id_union":
        merged[key] = arrayStableIdUnion(ev, iv);
        break;
      case "object_merge_recursive":
        merged[key] = deepMerge(ev, iv);
        break;
      case "object_merge_array_union":
        merged[key] = objectMergeArrayUnion(ev, iv);
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

export function sanitizePayload(payload, depth = 0, seen = new WeakSet()) {
  if (depth > MAX_DEPTH) return payload;
  if (payload === null || payload === undefined) return payload;
  if (typeof payload !== "object") return payload;
  if (seen.has(payload)) return payload;
  seen.add(payload);

  if (Array.isArray(payload)) {
    return payload.map((x) => sanitizePayload(x, depth + 1, seen));
  }
  const out = {};
  for (const key of Object.keys(payload)) {
    if (PROTO_KEYS.has(key)) continue;
    out[key] = sanitizePayload(payload[key], depth + 1, seen);
  }
  return out;
}
