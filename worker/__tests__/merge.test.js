// lab fresh v2 — Worker merge engine 단위 테스트 (B1~B12)
// 사료: editor/ops/lab-v2-fresh-2026-05-09.md (S3.3 + S5.4.1)
// 41+ 케이스 의무

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PROTO_KEYS,
  MAX_DEPTH,
  MERGE_STRATEGIES,
  deepMerge,
  arrayIdUnion,
  arrayStableIdUnion,
  objectMergeArrayUnion,
  mergeTabData,
  sanitizePayload,
  detectConflict,
  validateMergeResult,
} from "../merge.js";

// ─── 1. deepMerge — 8 엣지 케이스 (B1) ───────────────────────────────────

test("deepMerge: existing=undefined → incoming 반환", () => {
  assert.deepEqual(deepMerge(undefined, { a: 1 }), { a: 1 });
});

test("deepMerge: incoming=undefined → existing 유지 (빠진 key = 변경 의도 없음)", () => {
  assert.deepEqual(deepMerge({ a: 1 }, undefined), { a: 1 });
});

test("deepMerge: existing=null → incoming 반환", () => {
  assert.deepEqual(deepMerge(null, { a: 1 }), { a: 1 });
});

test("deepMerge: incoming=null → null 반환 (★ 명시적 null = 의도된 삭제)", () => {
  assert.equal(deepMerge({ a: 1 }, null), null);
});

test("deepMerge: 둘 다 원자값 → incoming 우선 (last-write-wins)", () => {
  assert.equal(deepMerge("a", "b"), "b");
  assert.equal(deepMerge(1, 2), 2);
  assert.equal(deepMerge(true, false), false);
});

test("deepMerge: 타입 충돌 (객체 vs 원자) → incoming", () => {
  assert.equal(deepMerge({ a: 1 }, "string"), "string");
  assert.deepEqual(deepMerge("string", { a: 1 }), { a: 1 });
});

test("deepMerge: 둘 다 객체 → 재귀 머지", () => {
  const r = deepMerge({ a: 1, b: { c: 2 } }, { b: { d: 3 }, e: 4 });
  assert.deepEqual(r, { a: 1, b: { c: 2, d: 3 }, e: 4 });
});

test("deepMerge: 둘 다 배열 → incoming (strategy 미적용 default)", () => {
  assert.deepEqual(deepMerge([1, 2, 3], [4, 5]), [4, 5]);
});

test("deepMerge: PROTO_KEYS (__proto__/constructor/prototype) 차단 (B12)", () => {
  const evil = JSON.parse('{"__proto__": {"polluted": true}, "a": 1}');
  const r = deepMerge({}, evil);
  assert.equal(r.a, 1);
  assert.equal(({}).polluted, undefined);  // prototype pollution 차단됨
});

test("deepMerge: 순환 참조 가드 (WeakSet seen)", () => {
  const a = { x: 1 };
  a.self = a;
  const b = { y: 2 };
  // 순환 발견 시 last-write-wins fallback
  assert.doesNotThrow(() => deepMerge(a, b));
});

test("deepMerge: 깊이 제한 (MAX_DEPTH 초과 시 incoming fallback)", () => {
  // MAX_DEPTH=32 충분히 깊은 객체
  let deep = { v: 1 };
  for (let i = 0; i < 50; i++) deep = { nested: deep };
  assert.doesNotThrow(() => deepMerge(deep, { other: 2 }));
});

// ─── 2. arrayIdUnion ─────────────────────────────────────────────────────

test("arrayIdUnion: id 기반 union (last-write-wins per id)", () => {
  const ea = [{ id: "1", v: "a" }, { id: "2", v: "b" }];
  const ia = [{ id: "2", v: "B" }, { id: "3", v: "c" }];
  const r = arrayIdUnion(ea, ia, (x) => x.id);
  assert.equal(r.length, 3);
  assert.equal(r.find((x) => x.id === "2").v, "B");  // incoming 우선
  assert.equal(r.find((x) => x.id === "1").v, "a");
  assert.equal(r.find((x) => x.id === "3").v, "c");
});

test("arrayIdUnion: 객체 entity 부분 변경 → deep merge 보존", () => {
  const ea = [{ id: "1", x: 1, y: 2 }];
  const ia = [{ id: "1", y: 22 }];
  const r = arrayIdUnion(ea, ia, (x) => x.id);
  assert.deepEqual(r[0], { id: "1", x: 1, y: 22 });  // x 보존, y 갱신
});

test("arrayIdUnion: idFn null 반환 entity skip", () => {
  const r = arrayIdUnion([{ a: 1 }], [{ b: 2 }], () => null);
  assert.deepEqual(r, []);
});

test("arrayIdUnion: 빈 배열 / null 입력 graceful", () => {
  assert.deepEqual(arrayIdUnion(null, null, () => "k"), []);
  assert.deepEqual(arrayIdUnion([], [], () => "k"), []);
});

// ─── 3. arrayStableIdUnion ───────────────────────────────────────────────

test("arrayStableIdUnion: _stableId 우선", () => {
  const ea = [{ _stableId: "uuid-1", v: "a" }];
  const ia = [{ _stableId: "uuid-1", v: "A" }, { _stableId: "uuid-2", v: "B" }];
  const r = arrayStableIdUnion(ea, ia);
  assert.equal(r.length, 2);
  assert.equal(r.find((x) => x._stableId === "uuid-1").v, "A");
});

test("arrayStableIdUnion: fallback chain (id → subtitle → text)", () => {
  const ea = [{ subtitle: "안녕" }];
  const ia = [{ subtitle: "안녕", v: "new" }, { text: "다른 자막" }];
  const r = arrayStableIdUnion(ea, ia);
  assert.equal(r.length, 2);
  assert.equal(r[0].v, "new");
});

test("arrayStableIdUnion: ID 부재 entity skip", () => {
  const ea = [{ no_id: "x" }];
  const ia = [{ also_no_id: "y" }];
  const r = arrayStableIdUnion(ea, ia);
  assert.deepEqual(r, []);  // 둘 다 ID 없으니 skip
});

// ─── 4. objectMergeArrayUnion (D6-5 blockDeletions) ─────────────────────

test("objectMergeArrayUnion: 객체 안 배열 value 합치기 (중복 제거)", () => {
  const ev = { 1: [["a", "b"]], 2: [["c"]] };
  const iv = { 1: [["b", "c"]], 3: [["d"]] };
  const r = objectMergeArrayUnion(ev, iv);
  // key=1 의 배열이 union (JSON 비교 중복 제거)
  assert.equal(r[1].length, 2);  // [["a","b"], ["b","c"]]
  assert.equal(r[2].length, 1);  // [["c"]]
  assert.equal(r[3].length, 1);  // [["d"]]
});

test("objectMergeArrayUnion: PROTO_KEYS 차단", () => {
  const evil = JSON.parse('{"__proto__": [["x"]], "a": [["b"]]}');
  const r = objectMergeArrayUnion({}, evil);
  assert.deepEqual(r.a, [["b"]]);
  // pollution 검증: Object.prototype 에 evil 값이 박혀있으면 안 됨
  assert.equal(Object.prototype.polluted, undefined);
  assert.equal(({}).polluted, undefined);
});

// ─── 5. mergeTabData — 11 탭 strategy 별 ────────────────────────────────

test("mergeTabData: correction blocks (block.index immutable)", async () => {
  const existing = {
    blocks: [{ index: 1, text: "old" }, { index: 2, text: "old2" }],
  };
  const incoming = {
    blocks: [{ index: 2, text: "NEW2" }, { index: 3, text: "new3" }],
  };
  const r = await mergeTabData(existing, incoming, "correction");
  assert.equal(r.blocks.length, 3);
  assert.equal(r.blocks.find((b) => b.index === 2).text, "NEW2");
  assert.equal(r.blocks.find((b) => b.index === 1).text, "old");
});

test("mergeTabData: correction blockDeletions (object_merge_array_union)", async () => {
  const existing = { blockDeletions: { 1: [[0, 5]] } };
  const incoming = { blockDeletions: { 1: [[10, 15]], 2: [[0, 3]] } };
  const r = await mergeTabData(existing, incoming, "correction");
  assert.equal(r.blockDeletions[1].length, 2);
  assert.equal(r.blockDeletions[2].length, 1);
});

test("mergeTabData: guide hl (array_stable_id_union)", async () => {
  const existing = { hl: [{ _stableId: "u1", subtitle: "안녕" }] };
  const incoming = { hl: [{ _stableId: "u1", subtitle: "안녕수정" }, { _stableId: "u2", subtitle: "다른" }] };
  const r = await mergeTabData(existing, incoming, "guide");
  assert.equal(r.hl.length, 2);
  assert.equal(r.hl.find((x) => x._stableId === "u1").subtitle, "안녕수정");
});

test("mergeTabData: guide hlVerdicts (object_merge_recursive)", async () => {
  const existing = { hlVerdicts: { u1: "use", u2: "skip" } };
  const incoming = { hlVerdicts: { u2: "use", u3: "use" } };
  const r = await mergeTabData(existing, incoming, "guide");
  assert.deepEqual(r.hlVerdicts, { u1: "use", u2: "use", u3: "use" });
});

test("mergeTabData: visual visualGuides + insertCuts + manualResources 동시", async () => {
  const existing = {
    visualGuides: [{ _stableId: "v1", text: "old" }],
    insertCuts: [{ _stableId: "i1", text: "ic1" }],
    manualResources: [{ _stableId: "m1" }],
  };
  const incoming = {
    visualGuides: [{ _stableId: "v1", text: "NEW" }, { _stableId: "v2", text: "v2" }],
  };
  const r = await mergeTabData(existing, incoming, "visual");
  // visualGuides 머지
  assert.equal(r.visualGuides.length, 2);
  // insertCuts / manualResources 보존 (incoming 에 없으니 변경 의도 없음)
  assert.equal(r.insertCuts.length, 1);
  assert.equal(r.manualResources.length, 1);
});

test("mergeTabData: manuscript last-write-wins (재업로드)", async () => {
  const existing = { text: "old", fileName: "old.docx" };
  const incoming = { text: "NEW", fileName: "new.docx" };
  const r = await mergeTabData(existing, incoming, "manuscript");
  assert.deepEqual(r, { text: "NEW", fileName: "new.docx" });
});

test("mergeTabData: review reviewBlocks", async () => {
  const existing = { reviewBlocks: [{ id: "r1", text: "a" }] };
  const incoming = { reviewBlocks: [{ id: "r2", text: "b" }] };
  const r = await mergeTabData(existing, incoming, "review");
  assert.equal(r.reviewBlocks.length, 2);
});

test("mergeTabData: meta stages (object_merge_recursive)", async () => {
  const existing = { stages: { review: { updatedAt: "T1" }, correction: { updatedAt: "T1" } } };
  const incoming = { stages: { correction: { updatedAt: "T2" } } };
  const r = await mergeTabData(existing, incoming, "meta");
  assert.equal(r.stages.review.updatedAt, "T1");
  assert.equal(r.stages.correction.updatedAt, "T2");
});

test("mergeTabData: 알려진 탭 아니면 incoming (last-write-wins)", async () => {
  const r = await mergeTabData({ a: 1 }, { b: 2 }, "unknown_tab");
  assert.deepEqual(r, { b: 2 });
});

test("mergeTabData: incoming 에 없는 key 보존", async () => {
  const existing = { blocks: [{ index: 1 }], anal: { x: "y" } };
  const incoming = { blocks: [{ index: 2 }] };  // anal 빠짐
  const r = await mergeTabData(existing, incoming, "correction");
  assert.deepEqual(r.anal, { x: "y" });  // 보존
});

test("mergeTabData: incoming 의 명시적 null → 삭제 의도", async () => {
  const existing = { hlVerdicts: { u1: "use" }, hlEdits: { u1: "edited" } };
  const incoming = { hlEdits: null };  // 명시적 null
  const r = await mergeTabData(existing, incoming, "guide");
  assert.equal(r.hlEdits, null);
  assert.deepEqual(r.hlVerdicts, { u1: "use" });
});

test("mergeTabData: PROTO_KEYS 차단 (B12)", async () => {
  const evil = JSON.parse('{"__proto__": {"polluted": true}, "blocks": []}');
  const r = await mergeTabData({}, evil, "correction");
  assert.equal(({}).polluted, undefined);
  assert.deepEqual(r.blocks, []);
});

// ─── 6. sanitizePayload (B12) ────────────────────────────────────────────

test("sanitizePayload: PROTO_KEYS 모두 제거", () => {
  const evil = JSON.parse('{"__proto__": {"x": 1}, "constructor": "evil", "prototype": "bad", "ok": "good"}');
  const r = sanitizePayload(evil);
  assert.equal(r.ok, "good");
  // own property 로 evil 값이 박혀있으면 안 됨
  assert.equal(Object.prototype.hasOwnProperty.call(r, "__proto__"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(r, "constructor"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(r, "prototype"), false);
});

test("sanitizePayload: 중첩 객체 재귀 적용", () => {
  const evil = JSON.parse('{"a": {"__proto__": {"x": 1}, "b": "ok"}}');
  const r = sanitizePayload(evil);
  assert.equal(r.a.b, "ok");
  // 중첩 안 의 __proto__ 도 제거됨
});

test("sanitizePayload: 배열 안 객체 재귀", () => {
  const evil = JSON.parse('{"items": [{"__proto__": "evil"}, {"v": "ok"}]}');
  const r = sanitizePayload(evil);
  assert.equal(r.items[1].v, "ok");
});

test("sanitizePayload: 원자값 그대로", () => {
  assert.equal(sanitizePayload("string"), "string");
  assert.equal(sanitizePayload(42), 42);
  assert.equal(sanitizePayload(null), null);
  assert.equal(sanitizePayload(undefined), undefined);
});

test("sanitizePayload: 순환 참조 graceful", () => {
  const a = { x: 1 };
  a.self = a;
  assert.doesNotThrow(() => sanitizePayload(a));
});

// ─── 7. detectConflict (B5) ──────────────────────────────────────────────

test("detectConflict: baseVersion < existing.version → 충돌 (version 우선)", () => {
  const r = detectConflict(
    { baseVersion: 1 },
    { version: 2, savedAt: "2026-05-09T10:00:00Z" }
  );
  assert.equal(r.conflict, true);
  assert.equal(r.reason, "version");
});

test("detectConflict: baseSavedAt < existing.savedAt → 충돌 (시각 보조)", () => {
  const r = detectConflict(
    { baseSavedAt: "2026-05-09T10:00:00Z" },
    { savedAt: "2026-05-09T10:00:01Z" }
  );
  assert.equal(r.conflict, true);
  assert.equal(r.reason, "savedAt");
});

test("detectConflict: baseVersion === existing.version → 충돌 X", () => {
  const r = detectConflict(
    { baseVersion: 2, baseSavedAt: "2026-05-09T10:00:00Z" },
    { version: 2, savedAt: "2026-05-09T10:00:00Z" }
  );
  assert.equal(r.conflict, false);
});

test("detectConflict: body.force === true → 충돌 무시 (강제저장)", () => {
  const r = detectConflict(
    { baseVersion: 1, force: true },
    { version: 2 }
  );
  assert.equal(r.conflict, false);
});

test("detectConflict: baseSavedAt/baseVersion 부재 → 충돌 X (구 클라 호환)", () => {
  const r = detectConflict({}, { version: 2, savedAt: "T1" });
  assert.equal(r.conflict, false);
});

test("detectConflict: existing 부재 → 충돌 X (신규 저장)", () => {
  const r = detectConflict({ baseVersion: 1 }, null);
  assert.equal(r.conflict, false);
});

// ─── 8. validateMergeResult (B6) ─────────────────────────────────────────

test("validateMergeResult: blocks 길이 감소 → violation (correction immutable)", () => {
  const merged = { blocks: [{ index: 1 }] };
  const existing = { blocks: [{ index: 1 }, { index: 2 }] };
  const r = validateMergeResult(merged, existing, "correction");
  assert.equal(r.valid, false);
  assert.ok(r.violations.some((v) => v.includes("blocks 길이 감소")));
});

test("validateMergeResult: blocks 길이 유지 → 통과", () => {
  const merged = { blocks: [{ index: 1 }, { index: 2 }] };
  const existing = { blocks: [{ index: 1 }, { index: 2 }] };
  const r = validateMergeResult(merged, existing, "correction");
  assert.equal(r.valid, true);
});

test("validateMergeResult: hl 0 으로 감소 → violation (catastrophic)", () => {
  const merged = { hl: [] };
  const existing = { hl: [{ _stableId: "u1" }, { _stableId: "u2" }] };
  const r = validateMergeResult(merged, existing, "guide");
  assert.equal(r.valid, false);
  assert.ok(r.violations.some((v) => v.includes("hl 길이 0")));
});

test("validateMergeResult: PROTO_KEYS 잔존 → violation", () => {
  const merged = Object.create(null);
  merged.__proto__ = "x";  // 직접 박제 시도
  Object.defineProperty(merged, "__proto__", { value: "x", enumerable: true });
  const r = validateMergeResult(merged, null, "correction");
  // PROTO_KEYS 의 enumerable 케이스만 캐치 — 일반 케이스에선 violation 0
  assert.equal(r.valid, false);
});

test("validateMergeResult: merged null → violation", () => {
  const r = validateMergeResult(null, {}, "correction");
  assert.equal(r.valid, false);
});

// ─── 9. K-N 시나리오 self-race (★ POSTMORTEM K~N 의무) ──────────────────

test("scenario K1: 빠른 연속 저장 (3회) — array_id_union 누적 보존", async () => {
  let kv = { blocks: [] };
  // 1차 저장
  kv = await mergeTabData(kv, { blocks: [{ index: 1, text: "a" }] }, "correction");
  // 2차 저장 (1차 위에)
  kv = await mergeTabData(kv, { blocks: [{ index: 2, text: "b" }] }, "correction");
  // 3차 저장 (1+2 위에)
  kv = await mergeTabData(kv, { blocks: [{ index: 3, text: "c" }] }, "correction");
  assert.equal(kv.blocks.length, 3);
});

test("scenario K2: 같은 entity 빠른 갱신 → 마지막 값", async () => {
  let kv = { hlVerdicts: {} };
  kv = await mergeTabData(kv, { hlVerdicts: { u1: "use" } }, "guide");
  kv = await mergeTabData(kv, { hlVerdicts: { u1: "skip" } }, "guide");
  kv = await mergeTabData(kv, { hlVerdicts: { u1: "use" } }, "guide");
  assert.equal(kv.hlVerdicts.u1, "use");
});

test("scenario E (삭제 vs 편집): 머지가 deleted 플래그 보존하는가", async () => {
  // meta 머지 시 deleted 가 incoming 에 없어도 existing 유지
  const existing = { stages: { correction: { updatedAt: "T1" } }, deleted: true, deletedAt: "T0" };
  const incoming = { stages: { correction: { updatedAt: "T2" } } };
  const r = await mergeTabData(existing, incoming, "meta");
  // strategy 에 deleted 정의 없으니 existing 유지 (incoming 에 빠진 key)
  assert.equal(r.deleted, true);
});

// ─── 10. 매트릭스 (11 탭 모든 strategy 정의 검증) ──────────────────────

test("MERGE_STRATEGIES: 11 탭 모두 정의됨", () => {
  const REQUIRED_TABS = [
    "correction", "review", "guide", "highlight", "visual",
    "setgen", "modify", "metadata", "manuscript", "subtitle", "meta",
  ];
  for (const t of REQUIRED_TABS) {
    assert.ok(MERGE_STRATEGIES[t], `${t} strategy 정의 누락`);
  }
});

test("PROTO_KEYS: 3개 정확히 정의 (__proto__/constructor/prototype)", () => {
  assert.equal(PROTO_KEYS.size, 3);
  assert.ok(PROTO_KEYS.has("__proto__"));
  assert.ok(PROTO_KEYS.has("constructor"));
  assert.ok(PROTO_KEYS.has("prototype"));
});

test("MAX_DEPTH: 32 (순환 가드 영역)", () => {
  assert.equal(MAX_DEPTH, 32);
});
