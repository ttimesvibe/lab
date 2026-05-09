// lab fresh v2 — Worker merge engine (B1~B12)
// 사료: editor/ops/lab-v2-fresh-2026-05-09.md
//   - S1.9 묶음 ⑥ (Worker PATCH 머지 + _stableId)
//   - S3.3 B1 deepMerge 8 엣지 + arrayIdUnion 정밀 사양
//   - S4b.4 architectural_changes 머지 전략 4 모드
//   - S5.1 A11.2 worker/merge.js 책임
//
// 책임:
//   - deepMerge(existing, incoming) — 8 엣지 케이스
//   - mergeTabData(existing, incoming, tab) — MERGE_STRATEGIES 11 탭 dispatch
//   - validateMergeResult(merged, existing, tab) — B6 invariant + 자동 롤백
//   - sanitizePayload(payload) — B12 PROTO_KEYS 차단
//   - detectConflict(body, existing) — B5 baseSavedAt + version
//
// 영구 박제 (사료 정합):
//   - 가치 1≫3 — 무손실 우선, 충돌 막으려 저장 자체 막는 설계 X
//   - 같은 sub 자동 통합 — server 측 force=true 재시도
//   - 다른 sub — 409 + ConflictModal 2 옵션 (헌장 v1.1)
//   - 명시적 null = 의도된 삭제 / 빠진 key = 변경 의도 없음
//   - PROTO_KEYS 차단 — __proto__ / constructor / prototype
//   - 순환 가드 — WeakSet seen + MAX_DEPTH

// ─── 상수 ────────────────────────────────────────────────────────────────

export const PROTO_KEYS = new Set(["__proto__", "constructor", "prototype"]);
export const MAX_DEPTH = 32;

// ─── MERGE_STRATEGIES — 11 탭 entity 별 머지 전략 (D6-1~5 박제) ──────────

export const MERGE_STRATEGIES = Object.freeze({
  // correction — blocks (block.index immutable, D6-1) + diffs/scriptEdits/blockDeletions
  correction: {
    blocks: "array_id_union",                  // key=index (D6-1 immutable)
    diffs: "array_stable_id_union",            // key=_stableId (D6-2 fallback SHA-256)
    anal: "object_merge_recursive",            // 분석 결과 deep merge (D6-3)
    scriptEdits: "object_merge_recursive",     // key=block.index, value=text
    blockDeletions: "object_merge_array_union",// key=block.index, value=array (D6-5 array_union)
  },
  // review
  review: {
    reviewBlocks: "array_id_union",
    paragraphs: "last_write_wins",             // 옛 데이터 통째 교체 OK (재업로드)
    blockStrikeRanges: "object_merge_recursive",
    deletedBlockIndices: "array_id_union",     // key=값 자체
    duration: "last_write_wins",
    cleanText: "last_write_wins",
    hasTrackChanges: "last_write_wins",
  },
  // guide / highlight (★ hl _stableId 의무, R1 보강)
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
  // visual (★ visualGuides + insertCuts + manualResources 모두 _stableId 기반)
  visual: {
    visualGuides: "array_stable_id_union",
    insertCuts: "array_stable_id_union",
    manualResources: "array_stable_id_union",
    verdicts: "object_merge_recursive",
    visualMarkers: "object_merge_recursive",
  },
  // setgen
  setgen: {
    sets: "array_stable_id_union",
    result: "object_merge_recursive",
    sel: "object_merge_recursive",
    edits: "object_merge_recursive",
  },
  // modify
  modify: {
    cards: "array_stable_id_union",
    videoUrl: "last_write_wins",
    videoId: "last_write_wins",
    title: "last_write_wins",
  },
  // metadata
  metadata: {
    interviewee: "last_write_wins",
    topic: "last_write_wins",
    keywords: "object_merge_recursive",
    speakers: "array_stable_id_union",
    genre: "object_merge_recursive",
  },
  // manuscript — 재업로드 = 통째 교체 (W-2 5 cap 별도)
  manuscript: {
    text: "last_write_wins",
    fileName: "last_write_wins",
    paragraphs: "last_write_wins",
    hasTrackChanges: "last_write_wins",
    fullText: "last_write_wins",
  },
  // subtitle — 자막 포맷팅 결과 통째 교체
  subtitle: {
    subtitles: "last_write_wins",
    format: "last_write_wins",
  },
  // meta — 시스템 메타 (stages 등)
  meta: {
    stages: "object_merge_recursive",
    schemaVersion: "last_write_wins",
    fn: "last_write_wins",
  },
  // script — 별도 KV 키 X (correction 안 동봉)
  script: {
    scriptEdits: "object_merge_recursive",
    blocks: "array_id_union",
  },
});

// ─── deepMerge — 8 엣지 케이스 (B1, S3.3) ───────────────────────────────

export function deepMerge(existing, incoming, depth = 0, seen = new WeakSet()) {
  // 깊이 제한 (순환 가드)
  if (depth > MAX_DEPTH) return incoming;

  // 1-4. undefined / null 케이스
  if (incoming === undefined) return existing;     // 빠진 key = 변경 의도 없음
  if (existing === undefined) return incoming;
  if (incoming === null) return null;              // 명시적 null = 의도된 삭제
  if (existing === null) return incoming;          // null = 빈 값

  // 5. 타입 불일치 → last-write-wins
  const eType = Array.isArray(existing) ? "array" : typeof existing;
  const iType = Array.isArray(incoming) ? "array" : typeof incoming;
  if (eType !== iType) return incoming;

  // 6. 원자값 (string / number / boolean) → last-write-wins
  if (iType !== "object" && iType !== "array") return incoming;

  // 7. 순환 참조 가드
  if (seen.has(existing) || seen.has(incoming)) return incoming;
  seen.add(existing);
  seen.add(incoming);

  // 8. 배열 — 여기 도달 시 strategy 미적용 = last-write-wins
  if (iType === "array") return incoming;

  // 9. 객체 재귀 머지 + PROTO_KEYS 차단 (B12)
  const merged = {};
  for (const key of Object.keys(existing)) {
    if (PROTO_KEYS.has(key)) continue;
    merged[key] = existing[key];
  }
  for (const key of Object.keys(incoming)) {
    if (PROTO_KEYS.has(key)) continue;            // B12 prototype pollution 차단
    merged[key] = deepMerge(existing[key], incoming[key], depth + 1, seen);
  }
  return merged;
}

// ─── arrayIdUnion / arrayStableIdUnion ──────────────────────────────────

/**
 * Array union by ID function. last-write-wins per ID.
 * idFn(item) 가 null/undefined 반환 시 그 item skip + 로그.
 */
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
    // last-write-wins per ID, 단 객체면 deep merge (entity 안 부분 변경 보존)
    const prev = map.get(k);
    if (prev && typeof prev === "object" && typeof item === "object" && !Array.isArray(prev) && !Array.isArray(item)) {
      map.set(k, deepMerge(prev, item));
    } else {
      map.set(k, item);
    }
  }
  return [...map.values()];
}

/**
 * Array union by _stableId (with fallback to subtitle/text/value).
 * D6-2 — _stableId fallback = SHA-256(subtitle+speaker+startMs) 12자.
 * (Worker 환경에서 SHA-256 은 globalThis.crypto.subtle 사용 — 별도 구현 시.
 *  여기서는 fallback key 만 박제, sha256 fallback 은 호출자 책임.)
 */
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

/**
 * Object merge with array_union for inner array values.
 * Used by blockDeletions (D6-5): { blockIndex: [deletedRanges...] }
 */
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
        // 중복 제거 (JSON 비교)
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

// ─── mergeTabData — strategy 별 dispatch ────────────────────────────────

export async function mergeTabData(existing, incoming, tab) {
  const strategy = MERGE_STRATEGIES[tab];
  if (!strategy) return incoming;                        // 알려진 탭 아니면 last-write-wins
  if (typeof incoming !== "object" || incoming === null) return incoming;

  const merged = {};
  // existing 의 모든 키 시작 (incoming 에 없는 key 도 보존)
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

    if (iv === undefined) continue;                       // 빠진 key 보존

    switch (mode) {
      case "array_id_union":
        // block.index / item.id 기반
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
        // strategy 미정의 키 — 재귀 머지 (안전 default)
        merged[key] = deepMerge(ev, iv);
    }
  }
  return merged;
}

// ─── sanitizePayload — B12 PROTO_KEYS 차단 ──────────────────────────────

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

// ─── detectConflict — B5 baseSavedAt + version ──────────────────────────

/**
 * Detect optimistic-concurrency conflict.
 * Returns { conflict: boolean, reason?: string }.
 *
 * 규칙:
 *   - body.baseVersion < existing.version → 충돌 (version 우선)
 *   - body.baseSavedAt < existing.savedAt → 충돌 (시각 보조, 같은 ms false negative 가능)
 *   - body.force === true 면 충돌 무시 (강제저장 옵션)
 *   - body.baseSavedAt / baseVersion 부재 → 충돌 X (구 클라이언트 호환)
 */
export function detectConflict(body, existing) {
  if (!body || !existing) return { conflict: false };
  if (body.force === true) return { conflict: false };

  // version 우선 (정밀)
  if (body.baseVersion !== undefined && existing.version !== undefined) {
    if (Number(body.baseVersion) < Number(existing.version)) {
      return { conflict: true, reason: "version" };
    }
  }

  // 시각 보조
  if (body.baseSavedAt && existing.savedAt) {
    if (String(body.baseSavedAt) < String(existing.savedAt)) {
      return { conflict: true, reason: "savedAt" };
    }
  }

  return { conflict: false };
}

// ─── validateMergeResult — B6 invariant + 자동 롤백 ─────────────────────

/**
 * B6 invariant: 머지 결과가 사양 위반인지 검증.
 *   - blocks 길이가 줄어들면 안 됨 (immutable 정책)
 *   - hl 길이가 줄어들면 안 됨 (사용자 수동 삭제 외)
 *   - PROTO_KEYS 잔존 X
 *
 * Returns { valid: boolean, violations: string[] }.
 * violations.length > 0 이면 호출자가 500 응답 + 자동 롤백.
 */
export function validateMergeResult(merged, existing, tab) {
  const violations = [];

  if (!merged || typeof merged !== "object") {
    violations.push("merged is not an object");
    return { valid: false, violations };
  }

  // PROTO_KEYS 잔존 차단
  for (const key of Object.keys(merged)) {
    if (PROTO_KEYS.has(key)) {
      violations.push(`PROTO_KEY 잔존: ${key}`);
    }
  }

  // blocks 길이 invariant (correction / script)
  if ((tab === "correction" || tab === "script") && existing) {
    const eLen = Array.isArray(existing.blocks) ? existing.blocks.length : 0;
    const mLen = Array.isArray(merged.blocks) ? merged.blocks.length : 0;
    if (mLen < eLen) {
      violations.push(`blocks 길이 감소 (existing ${eLen} → merged ${mLen})`);
    }
  }

  // hl 길이 invariant (guide / highlight) — 사용자 수동 삭제 의도가 explicit 일 때만 줄어듦
  // 본 검증은 warn 수준 (서버 forced merge 시 의도된 감소 가능). 그러나 hl 길이가
  // 0 으로 줄어들면 violation (catastrophic 손실 차단).
  if ((tab === "guide" || tab === "highlight") && existing) {
    const eLen = Array.isArray(existing.hl) ? existing.hl.length : 0;
    const mLen = Array.isArray(merged.hl) ? merged.hl.length : 0;
    if (eLen > 0 && mLen === 0) {
      violations.push(`hl 길이 0 으로 감소 (catastrophic, existing ${eLen})`);
    }
  }

  return { valid: violations.length === 0, violations };
}
