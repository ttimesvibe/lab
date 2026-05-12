// lab fresh v2 — TAB_SCHEMAS (R1 보강, ★ 11 탭 데이터 schema 단일 진실)
// 사료: editor/ops/lab-v2-fresh-2026-05-09.md
//   - R1 보강: TAB_SCHEMAS 명문 박제 (헌장 §5 살아있는 명세)
//   - S2.2.b 세션 키 schema
//   - 헌장 §5: 11 탭 동등
//
// 책임:
//   - TAB_SCHEMAS: 11 탭의 fields 명세
//   - validateTabData: schema 정합 검증 (옵션, 호출자 책임)
//
// ★ 본 파일 변경 시 worker/merge.js 의 MERGE_STRATEGIES 와 동시 검증 의무
// (drift guard — charter.test.js 가 자동 검증).

import { TAB_KEYS } from "./tabs.js";

// ─── TAB_SCHEMAS ─────────────────────────────────────────────────────────

export const TAB_SCHEMAS = Object.freeze({
  meta: {
    fields: ["sessionId", "fn", "createdAt", "updatedAt", "schemaVersion", "stages", "creator"],
    required: ["sessionId", "schemaVersion"],
  },
  manuscript: {
    fields: ["text", "fileName", "paragraphs", "hasTrackChanges", "fullText"],
    required: [],
  },
  review: {
    fields: ["reviewBlocks", "paragraphs", "blockStrikeRanges", "deletedBlockIndices", "duration", "cleanText", "hasTrackChanges", "_analyzed", "_analysisSummary"],
    required: [],
  },
  correction: {
    fields: ["blocks", "anal", "diffs", "scriptEdits", "blockDeletions"],
    required: [],
  },
  subtitle: {
    fields: ["subtitles", "format", "_generatedAt", "_debug"],
    required: [],
  },
  guide: {
    fields: ["hl", "hlStats", "hlVerdicts", "hlEdits", "hlMarkers"],
    required: [],
  },
  visual: {
    fields: ["visualGuides", "insertCuts", "manualResources", "verdicts", "visualMarkers"],
    required: [],
  },
  modify: {
    fields: ["cards", "videoUrl", "videoId", "title"],
    required: [],
  },
  highlight: {
    fields: ["hl", "hlStats", "hlVerdicts", "hlEdits", "hlMarkers", "clips"],
    required: [],
  },
  setgen: {
    fields: ["sets", "result", "sel", "edits"],
    required: [],
  },
  metadata: {
    fields: ["interviewee", "topic", "keywords", "speakers", "genre"],
    required: [],
  },
});

// ─── KV value schema (모든 PUT) ─────────────────────────────────────────

/**
 * Common KV value envelope (★ S2.2.c).
 * 모든 s:{id}:{tab} value 가 본 envelope 따라 박제:
 *   { ...content fields..., savedAt, version, updatedBy, schemaVersion }
 */
export const KV_VALUE_SCHEMA_VERSION = "2.0";

export const KV_VALUE_ENVELOPE_FIELDS = Object.freeze([
  "savedAt", "version", "updatedBy", "schemaVersion",
]);

// ─── 헬퍼 ────────────────────────────────────────────────────────────────

/**
 * Validate tab data against schema (optional, 호출자 책임).
 *   - tab: TAB_KEYS 의 worker key
 *   - data: object
 * Returns { valid, missing: string[] }.
 */
export function validateTabData(tab, data) {
  const schema = TAB_SCHEMAS[tab];
  if (!schema) return { valid: false, missing: [], reason: `unknown tab: ${tab}` };
  if (!data || typeof data !== "object") {
    return { valid: false, missing: [...schema.required], reason: "data not an object" };
  }
  const missing = schema.required.filter((f) => data[f] === undefined);
  return { valid: missing.length === 0, missing };
}

/**
 * Check if all 11 tabs have schema defined (charter §5 sanity).
 */
export function isComplete() {
  for (const t of TAB_KEYS) {
    if (!TAB_SCHEMAS[t]) return false;
  }
  return true;
}
