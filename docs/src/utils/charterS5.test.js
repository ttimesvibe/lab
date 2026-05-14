// ═══════════════════════════════════════════════════════════════════════════
// charterS5.test.js — 헌장 §5 (11 탭 동등) + §6 (부모/자식 X) 정합 검증
// 실행: node --test docs/src/utils/charterS5.test.js
// ═══════════════════════════════════════════════════════════════════════════
//
// R4 영역의 §5 단위 테스트.
// R3.d.2 마이그레이션 영역 정식 완성 후 회귀 방지 영역.
//
// 검증 영역:
//   1. TAB_IDS / TAB_SCHEMAS / TAB_LABELS — 11 탭 동등 박제 정합
//   2. isValidTab / labelOf / fieldsOf — 11 탭 동등 helper
//   3. pickFields — schema 외 키 filter (savedAt 등 메타 영역)
//   4. inferTab — RestoreModal 옛 형식 fallback 영역 (R3.e)
//   5. te_session schema 3.0 detection (R3.d.2.f)
//   6. patchTab update pattern (pure 영역)
//
// ───────────────────────────────────────────────────────────────────────────

import test from "node:test";
import assert from "node:assert/strict";
import {
  TAB_IDS,
  TAB_LABELS,
  TAB_SCHEMAS,
  isValidTab,
  labelOf,
  fieldsOf,
  pickFields,
} from "./tabSchemas.js";

// ═══════════════════════════════════════════════════════════════════════════
// §5 — 11 탭 동등 박제 정합
// ═══════════════════════════════════════════════════════════════════════════

test("§5.1 TAB_IDS — 정확히 11 탭 박제", () => {
  assert.equal(TAB_IDS.length, 11);
  // 헌장 v1.1 명시 11 탭
  const expected = ["review", "correction", "script", "guide",
                    "highlight", "setgen", "visual", "modify",
                    "metadata", "manuscript", "subtitle"];
  for (const t of expected) assert.ok(TAB_IDS.includes(t), `TAB_IDS missing: ${t}`);
});

test("§5.2 TAB_SCHEMAS — 모든 11 탭 schema 박제 (영역 누락 X)", () => {
  for (const t of TAB_IDS) {
    assert.ok(TAB_SCHEMAS[t], `TAB_SCHEMAS missing: ${t}`);
    assert.ok(Array.isArray(TAB_SCHEMAS[t].fields), `${t} fields not array`);
    assert.ok(TAB_SCHEMAS[t].fields.length > 0, `${t} fields empty`);
    assert.ok(typeof TAB_SCHEMAS[t].description === "string", `${t} description missing`);
  }
});

test("§5.3 TAB_LABELS — 모든 11 탭 label 박제", () => {
  for (const t of TAB_IDS) {
    assert.ok(TAB_LABELS[t], `TAB_LABELS missing: ${t}`);
    assert.ok(typeof TAB_LABELS[t] === "string");
  }
});

test("§5.4 TAB_SCHEMAS Object.freeze — 변조 영역 차단", () => {
  assert.ok(Object.isFrozen(TAB_SCHEMAS));
  assert.ok(Object.isFrozen(TAB_IDS));
  assert.ok(Object.isFrozen(TAB_LABELS));
});

// ═══════════════════════════════════════════════════════════════════════════
// §5 — helper 영역의 11 탭 동등 정합
// ═══════════════════════════════════════════════════════════════════════════

test("§5.5 isValidTab — 11 탭 동등 + 외부 영역 거부", () => {
  for (const t of TAB_IDS) assert.equal(isValidTab(t), true);
  assert.equal(isValidTab("unknown"), false);
  assert.equal(isValidTab(""), false);
  assert.equal(isValidTab(null), false);
  assert.equal(isValidTab(undefined), false);
});

test("§5.6 labelOf — 11 탭 label / fallback 영역", () => {
  for (const t of TAB_IDS) {
    assert.equal(labelOf(t), TAB_LABELS[t]);
  }
  // 모르는 영역 → id 그대로 (fallback)
  assert.equal(labelOf("unknown"), "unknown");
});

test("§5.7 fieldsOf — 11 탭 fields / 외부 영역 throw", () => {
  for (const t of TAB_IDS) {
    const fields = fieldsOf(t);
    assert.deepEqual(fields, TAB_SCHEMAS[t].fields);
  }
  assert.throws(() => fieldsOf("unknown"), /Unknown tab/);
});

// ═══════════════════════════════════════════════════════════════════════════
// §5 — pickFields 영역 (schema 외 키 filter)
// ═══════════════════════════════════════════════════════════════════════════

test("§5.8 pickFields — schema 영역 만 추출 (modify 영역)", () => {
  const source = {
    videoUrl: "https://...",
    videoId: "abc",
    title: "Test",
    cards: [{ s: 0, e: 10 }],
    savedAt: "2026-05-08",         // schema 외 메타 영역
    version: 5,                      // schema 외 메타 영역
    extraField: "should-be-filtered",
  };
  const picked = pickFields("modify", source);
  // schema fields = ["videoUrl", "videoId", "title", "cards"] (R3.c 정정 영역)
  assert.deepEqual(Object.keys(picked).sort(),
                   ["cards", "title", "videoId", "videoUrl"]);
  assert.equal(picked.savedAt, undefined);
  assert.equal(picked.version, undefined);
  assert.equal(picked.extraField, undefined);
});

test("§5.9 pickFields — visual 영역 자식 탭 filter", () => {
  const source = {
    visualGuides: [{ id: 1 }],
    insertCuts: [],
    verdicts: {},
    manualResources: [],
    visualMarkers: {},
    savedAt: "2026-05-08",
  };
  const picked = pickFields("visual", source);
  assert.equal(picked.savedAt, undefined);
  assert.deepEqual(Object.keys(picked).sort(),
                   ["insertCuts", "manualResources", "verdicts", "visualGuides", "visualMarkers"]);
});

test("§5.10 pickFields — 빈 source 영역 처리", () => {
  assert.deepEqual(pickFields("modify", {}), {});
  assert.deepEqual(pickFields("modify", null), {});
  assert.deepEqual(pickFields("modify", undefined), {});
});

test("§5.11 pickFields — 부분 영역 (일부 fields 만)", () => {
  const source = { cards: [1, 2, 3] };
  const picked = pickFields("modify", source);
  assert.deepEqual(picked, { cards: [1, 2, 3] });
});

test("§5.12 pickFields — 미지 tab 영역 throw", () => {
  assert.throws(() => pickFields("unknown", {}), /Unknown tab/);
});

// ═══════════════════════════════════════════════════════════════════════════
// §5 — inferTab 영역 (RestoreModal 옛 형식 fallback, R3.e)
// ═══════════════════════════════════════════════════════════════════════════

// App.jsx 의 inferTab 영역 동등 영역 박제 (호환 영역 영구 검증)
function inferTab(d) {
  if (!d) return null;
  if (d.cards !== undefined || d.videoUrl !== undefined) return "modify";
  if (d.visualGuides !== undefined || d.insertCuts !== undefined) return "visual";
  if (d.result !== undefined || d.trendData !== undefined) return "setgen";
  if (d.clips !== undefined || d.recs !== undefined) return "highlight";
  if (d.blocks !== undefined && (d.diffs !== undefined || d.anal !== undefined)) return "correction";
  if (d.hl !== undefined || d.hlStats !== undefined) return "guide";
  if (d.reviewData !== undefined) return "review";
  return null;
}

test("§5.13 inferTab — modify 영역 (cards/videoUrl)", () => {
  assert.equal(inferTab({ cards: [] }), "modify");
  assert.equal(inferTab({ videoUrl: "..." }), "modify");
  assert.equal(inferTab({ videoUrl: "...", cards: [] }), "modify");
});

test("§5.14 inferTab — visual 영역 (visualGuides/insertCuts)", () => {
  assert.equal(inferTab({ visualGuides: [] }), "visual");
  assert.equal(inferTab({ insertCuts: [] }), "visual");
});

test("§5.15 inferTab — setgen 영역 (result/trendData)", () => {
  assert.equal(inferTab({ result: "..." }), "setgen");
  assert.equal(inferTab({ trendData: {} }), "setgen");
});

test("§5.16 inferTab — highlight 영역 (clips/recs)", () => {
  assert.equal(inferTab({ clips: [] }), "highlight");
  assert.equal(inferTab({ recs: [] }), "highlight");
});

test("§5.17 inferTab — correction 영역 (blocks + diffs/anal)", () => {
  assert.equal(inferTab({ blocks: [], diffs: [] }), "correction");
  assert.equal(inferTab({ blocks: [], anal: {} }), "correction");
  // blocks 만 있으면 (script vs correction 영역 모호) → null 반환 영역 X
  // 실제: blocks 만 → correction 분기 안 들어감 (false), guide 분기 (hl) X → null
  assert.equal(inferTab({ blocks: [] }), null);
});

test("§5.18 inferTab — guide 영역 (hl/hlStats)", () => {
  assert.equal(inferTab({ hl: [] }), "guide");
  assert.equal(inferTab({ hlStats: {} }), "guide");
});

test("§5.19 inferTab — review 영역 (reviewData)", () => {
  assert.equal(inferTab({ reviewData: {} }), "review");
});

test("§5.20 inferTab — null/empty 영역", () => {
  assert.equal(inferTab(null), null);
  assert.equal(inferTab(undefined), null);
  assert.equal(inferTab({}), null);
  assert.equal(inferTab({ unknownField: "x" }), null);
});

// ═══════════════════════════════════════════════════════════════════════════
// §5 — patchTab update pattern (pure 영역)
// ═══════════════════════════════════════════════════════════════════════════

// App.jsx 의 patchTab 영역의 update pattern 동등 영역 박제
function patchTabUpdate(prev, tabId, partial) {
  if (!isValidTab(tabId)) return prev;
  if (!partial || typeof partial !== "object") return prev;
  return {
    ...prev,
    [tabId]: { ...(prev[tabId] || {}), ...partial },
  };
}

test("§5.21 patchTab pattern — 부모 탭 (correction) 부분 영역 갱신", () => {
  const prev = {
    review: { reviewData: null },
    correction: { blocks: [1, 2], anal: null, diffs: [], scriptEdits: {}, blockDeletions: {} },
  };
  const next = patchTabUpdate(prev, "correction", { blocks: [1, 2, 3] });
  assert.deepEqual(next.correction.blocks, [1, 2, 3]);
  assert.equal(next.correction.anal, null);             // 보존 영역
  assert.deepEqual(next.correction.diffs, []);           // 보존 영역
  assert.deepEqual(next.correction.scriptEdits, {});    // 보존 영역
  assert.equal(next.review, prev.review);               // 다른 탭 영역 보존
});

test("§5.22 patchTab pattern — 자식 탭 (modify) 부분 영역 갱신", () => {
  const prev = {
    modify: { videoUrl: "x", videoId: "y", title: "T", cards: [] },
  };
  const next = patchTabUpdate(prev, "modify", { cards: [{ s: 0, e: 5 }] });
  assert.equal(next.modify.videoUrl, "x");                // 보존
  assert.equal(next.modify.videoId, "y");                 // 보존
  assert.deepEqual(next.modify.cards, [{ s: 0, e: 5 }]);  // 갱신
});

test("§5.23 patchTab pattern — 미지 tabId 영역 거부", () => {
  const prev = { review: {} };
  const next = patchTabUpdate(prev, "unknown", { x: 1 });
  assert.equal(next, prev);  // 변경 X
});

test("§5.24 patchTab pattern — null/잘못된 partial 영역 거부", () => {
  const prev = { review: {} };
  assert.equal(patchTabUpdate(prev, "review", null), prev);
  assert.equal(patchTabUpdate(prev, "review", undefined), prev);
  assert.equal(patchTabUpdate(prev, "review", "string"), prev);
});

// ═══════════════════════════════════════════════════════════════════════════
// §5 — te_session schema 3.0 detection (R3.d.2.f 호환 보존)
// ═══════════════════════════════════════════════════════════════════════════

// App.jsx 의 load 영역 detection 패턴 동등 박제
function detectTeSessionSchema(s) {
  if (!s) return "none";
  if (s.schemaVersion === "3.0" && s.tabDataState) return "v3";
  if (s.blocks?.length > 0) return "legacy";
  return "invalid";
}

test("§5.25 te_session — schema 3.0 detection", () => {
  const v3 = {
    schemaVersion: "3.0",
    tabDataState: { review: {}, correction: { blocks: [1] } },
    fn: "test", tab: "correction",
  };
  assert.equal(detectTeSessionSchema(v3), "v3");
});

test("§5.26 te_session — 옛 형식 fallback detection", () => {
  const legacy = {
    blocks: [1, 2, 3],
    anal: null,
    exportCache: {},
    fn: "test",
  };
  assert.equal(detectTeSessionSchema(legacy), "legacy");
});

test("§5.27 te_session — 빈 영역 / 손상 영역", () => {
  assert.equal(detectTeSessionSchema(null), "none");
  assert.equal(detectTeSessionSchema(undefined), "none");
  assert.equal(detectTeSessionSchema({}), "invalid");
  assert.equal(detectTeSessionSchema({ schemaVersion: "3.0" }), "invalid"); // tabDataState 없음
  assert.equal(detectTeSessionSchema({ blocks: [] }), "invalid");           // 빈 blocks
});

// ═══════════════════════════════════════════════════════════════════════════
// §6 — 부모/자식 카테고리 거부 (외부 영역에서 구분 X)
// ═══════════════════════════════════════════════════════════════════════════

test("§6.1 모든 탭 동일 schema 형식 (fields + description)", () => {
  // 부모/자식 영역의 형식 차이 X — 모두 { fields, description }
  for (const t of TAB_IDS) {
    const schema = TAB_SCHEMAS[t];
    assert.equal(Object.keys(schema).sort().join(","), "description,fields");
  }
});

test("§6.2 isValidTab — 부모/자식 영역의 비대칭 X", () => {
  // 부모 / 자식 영역의 동등 처리
  const parent = ["review", "correction", "script", "guide"];
  const child = ["highlight", "setgen", "visual", "modify", "metadata", "manuscript", "subtitle"];
  for (const t of [...parent, ...child]) {
    assert.equal(isValidTab(t), true, `${t} should be valid`);
  }
});
