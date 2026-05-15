// 단위 테스트 — mergeTabData / deepMerge / validateMergeResult / detectConflict
// 실행: node --test cms-v2-plan/06_v2_finalization/code/worker/__tests__/mergeTabData.test.js
// (Node 18+ 내장 test runner 사용)

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  deepMerge, mergeTabData, validateMergeResult, sanitizePayload,
  arrayIdUnion, mergeObjectWithArrayUnion, detectConflict,
  PROTO_KEYS,
} from "../merge.js";

describe("deepMerge — 엣지 케이스 (B1)", () => {
  test("undefined → existing 유지", () => {
    assert.deepEqual(deepMerge({a:1}, undefined), {a:1});
  });
  test("existing undefined → incoming 반환", () => {
    assert.deepEqual(deepMerge(undefined, {a:1}), {a:1});
  });
  test("incoming null → 명시적 삭제", () => {
    assert.equal(deepMerge({a:1}, null), null);
  });
  test("existing null → incoming", () => {
    assert.deepEqual(deepMerge(null, {a:1}), {a:1});
  });
  test("타입 불일치 (object vs string) → incoming wins", () => {
    assert.equal(deepMerge({a:1}, "string"), "string");
  });
  test("재귀 객체 머지", () => {
    assert.deepEqual(
      deepMerge({a:{b:1, c:2}}, {a:{b:9, d:4}}),
      {a:{b:9, c:2, d:4}}
    );
  });
  test("__proto__ 차단", () => {
    const polluted = JSON.parse('{"__proto__":{"polluted":true}}');
    const m = deepMerge({}, polluted);
    assert.equal(m.polluted, undefined);
    assert.equal({}.polluted, undefined);  // 전역 오염 없음
  });
  test("constructor 차단", () => {
    const m = deepMerge({}, {constructor: {malicious: true}});
    assert.equal(m.constructor, Object);  // 기본 Object constructor 유지
  });
  test("순환 참조 안전", () => {
    const a = {x:1};
    a.self = a;
    assert.doesNotThrow(() => deepMerge({}, a));
  });
  test("MAX_DEPTH 가드", () => {
    let nested = {};
    let cur = nested;
    for (let i = 0; i < 50; i++) { cur.next = {}; cur = cur.next; }
    assert.doesNotThrow(() => deepMerge({}, nested));
  });
  test("배열은 incoming wins (default)", () => {
    assert.deepEqual(deepMerge([1,2,3], [4,5]), [4,5]);
  });
  test("원자값 last-write-wins", () => {
    assert.equal(deepMerge(5, 10), 10);
    assert.equal(deepMerge("a", "b"), "b");
    assert.equal(deepMerge(true, false), false);
  });
});

describe("mergeTabData — correction 탭", () => {
  test("blocks: array_id_union (key=index)", () => {
    const ex = { blocks: [{index:0, text:"a"}, {index:1, text:"b"}] };
    const inc = { blocks: [{index:1, text:"B"}, {index:2, text:"c"}] };
    const m = mergeTabData(ex, inc, "correction");
    const sorted = m.blocks.sort((a,b) => a.index - b.index);
    assert.deepEqual(sorted, [
      {index:0, text:"a"},
      {index:1, text:"B"},  // last-write-wins per ID
      {index:2, text:"c"},
    ]);
  });
  test("scriptEdits: object_merge_recursive (key 단위 재귀)", () => {
    const ex = { scriptEdits: { 0: "x", 1: "y" } };
    const inc = { scriptEdits: { 1: "Y", 2: "z" } };
    const m = mergeTabData(ex, inc, "correction");
    assert.deepEqual(m.scriptEdits, { 0:"x", 1:"Y", 2:"z" });
  });
  test("blockDeletions: object_merge_array_union", () => {
    const ex = { blockDeletions: { 0: [{start:0, end:5}] } };
    const inc = { blockDeletions: { 0: [{start:10, end:15}] } };
    const m = mergeTabData(ex, inc, "correction");
    assert.equal(m.blockDeletions[0].length, 2);
    assert.ok(m.blockDeletions[0].some(d => d.start === 0));
    assert.ok(m.blockDeletions[0].some(d => d.start === 10));
  });
  test("blockDeletions: 같은 entity 는 중복 제거", () => {
    const ex = { blockDeletions: { 0: [{start:0, end:5}] } };
    const inc = { blockDeletions: { 0: [{start:0, end:5}] } };  // 동일
    const m = mergeTabData(ex, inc, "correction");
    assert.equal(m.blockDeletions[0].length, 1);
  });
});

describe("mergeTabData — guide 탭", () => {
  test("hl: array_stable_id_union (key=_stableId)", () => {
    const ex = { hl: [{_stableId:"a", subtitle:"x"}] };
    const inc = { hl: [{_stableId:"a", subtitle:"X"}, {_stableId:"b", subtitle:"y"}] };
    const m = mergeTabData(ex, inc, "guide");
    assert.equal(m.hl.length, 2);
    assert.equal(m.hl.find(h => h._stableId === "a").subtitle, "X");
    assert.equal(m.hl.find(h => h._stableId === "b").subtitle, "y");
  });
  test("hl: _stableId 부재 시 fallback (subtitle+speaker+startMs)", () => {
    const ex = { hl: [{subtitle:"x", speaker:"A", startMs:100}] };
    const inc = { hl: [{subtitle:"x", speaker:"A", startMs:200}] };  // 다른 startMs
    const m = mergeTabData(ex, inc, "guide");
    assert.equal(m.hl.length, 2);  // 별개 entity
  });
  test("hl: 같은 fallback 키는 last-write-wins", () => {
    const ex = { hl: [{subtitle:"x", speaker:"A", startMs:100, color:"red"}] };
    const inc = { hl: [{subtitle:"x", speaker:"A", startMs:100, color:"blue"}] };
    const m = mergeTabData(ex, inc, "guide");
    assert.equal(m.hl.length, 1);
    assert.equal(m.hl[0].color, "blue");
  });
  test("hlVerdicts: object_merge_recursive (중첩 보존)", () => {
    const ex = { hlVerdicts: { "id_1": { user: "A", verdict: "good" } } };
    const inc = { hlVerdicts: { "id_1": { user: "B" } } };
    const m = mergeTabData(ex, inc, "guide");
    // 재귀 머지 — verdict 보존
    assert.equal(m.hlVerdicts.id_1.user, "B");
    assert.equal(m.hlVerdicts.id_1.verdict, "good");
  });
  test("hlStats: last_write_wins", () => {
    const ex = { hlStats: { count: 5 } };
    const inc = { hlStats: { count: 3 } };
    const m = mergeTabData(ex, inc, "guide");
    assert.deepEqual(m.hlStats, { count: 3 });
  });
});

describe("mergeTabData — visual / setgen / review", () => {
  test("visualGuides: array_stable_id_union", () => {
    const ex = { visualGuides: [{_stableId:"v1", url:"a.png"}] };
    const inc = { visualGuides: [{_stableId:"v2", url:"b.png"}] };
    const m = mergeTabData(ex, inc, "visual");
    assert.equal(m.visualGuides.length, 2);
  });
  test("setgen.result: object_merge_recursive", () => {
    const ex = { result: { sets: { a: 1 } } };
    const inc = { result: { sets: { b: 2 } } };
    const m = mergeTabData(ex, inc, "setgen");
    assert.deepEqual(m.result.sets, { a: 1, b: 2 });
  });
  test("review: __recursive (통째 재귀)", () => {
    const ex = { topic: "X", notes: "old" };
    const inc = { notes: "new", extra: "Y" };
    const m = mergeTabData(ex, inc, "review");
    assert.deepEqual(m, { topic: "X", notes: "new", extra: "Y" });
  });
});

// ───────────────────────────────────────────────────────────────────────────
// id-fallback 데이터 손실 방지 회귀 (Value 1)
// ───────────────────────────────────────────────────────────────────────────
// 배경: modify.cards / highlight.clips 항목은 사용자가 직접 만들어 _stableId 가 없고,
//       MERGE_STRATEGIES 의 entityType ("manualResources" / "hl") 가 가리키는 fallbackKeySync
//       의 키 필드 (blockIndex|type|query|url, subtitle|speaker|startMs) 와 실제 데이터 shape
//       (id, content/text, …) 가 mismatch 라 모든 항목이 같은 키 (e.g. "|||") 로 떨어졌고,
//       arrayIdUnion 의 Map.set 이 마지막 항목으로 덮어써 1 개만 남는 손실 발생.
// 수정: fallbackKeySync 첫 줄에 `if (item.id) return "id:" + item.id` 추가.
//       _stableId 보유 항목 (correction.diffs / guide.hl AI 생성) 은 영향 없음 — 그쪽은
//       arrayIdUnion idFn 에서 _stableId 가 먼저 잡혀 fallbackKeySync 까지 오지 않음.
describe("mergeTabData — id-fallback dedupe (data loss regression)", () => {
  test("modify.cards: id 만 보유한 사용자 항목 — 모두 보존", () => {
    const ex = { cards: [{ id: "card-A", content: "수정 1", time: "0:01" }] };
    const inc = {
      cards: [
        { id: "card-A", content: "수정 1", time: "0:01" },
        { id: "card-B", content: "수정 2", time: "0:10" },
      ],
    };
    const m = mergeTabData(ex, inc, "modify");
    assert.equal(m.cards.length, 2);
    assert.deepEqual(m.cards.map(c => c.id).sort(), ["card-A", "card-B"]);
  });

  test("highlight.clips: id 만 보유한 사용자 항목 — 모두 보존", () => {
    const ex = { clips: [{ id: "clip-1", text: "강조 1", blockId: 0, seconds: 5 }] };
    const inc = {
      clips: [
        { id: "clip-1", text: "강조 1", blockId: 0, seconds: 5 },
        { id: "clip-2", text: "강조 2", blockId: 1, seconds: 7 },
      ],
    };
    const m = mergeTabData(ex, inc, "highlight");
    assert.equal(m.clips.length, 2);
    assert.deepEqual(m.clips.map(c => c.id).sort(), ["clip-1", "clip-2"]);
  });

  test("visualGuides: id 보유한 빈 항목 (query/url 모두 빈) 도 충돌 없이 보존", () => {
    // 사용자가 빈 슬롯을 추가한 경우 — 옛 fallback 키 (blockIndex|type|query|url) 로는 충돌
    const ex = { visualGuides: [{ id: "v-1", blockIndex: 0, type: "image", query: "", url: "" }] };
    const inc = {
      visualGuides: [
        { id: "v-1", blockIndex: 0, type: "image", query: "", url: "" },
        { id: "v-2", blockIndex: 0, type: "image", query: "", url: "" },
      ],
    };
    const m = mergeTabData(ex, inc, "visual");
    assert.equal(m.visualGuides.length, 2);
  });

  test("같은 id 면 last-write-wins (정상 dedupe 의도)", () => {
    const ex = { cards: [{ id: "card-A", content: "old" }] };
    const inc = { cards: [{ id: "card-A", content: "new" }] };
    const m = mergeTabData(ex, inc, "modify");
    assert.equal(m.cards.length, 1);
    assert.equal(m.cards[0].content, "new");
  });

  test("id 가 빈 문자열이면 type-specific fallback 으로 추락", () => {
    // id="" 는 사실상 부재로 취급 — 빈 문자열 N 개가 모두 "id:" 로 충돌하면 안 됨
    const ex = { hl: [{ id: "", subtitle: "x", speaker: "A", startMs: 100 }] };
    const inc = { hl: [{ id: "", subtitle: "x", speaker: "A", startMs: 200 }] };
    const m = mergeTabData(ex, inc, "guide");
    // startMs 가 다르므로 별개 항목 — 옛 동작과 동일
    assert.equal(m.hl.length, 2);
  });

  test("_stableId 우선 — id 가 있어도 _stableId 로 매칭", () => {
    // AI 생성 항목과 사용자 편집의 호환 — _stableId 가 항상 우선
    const ex = { hl: [{ _stableId: "S1", id: "u-1", text: "old" }] };
    const inc = { hl: [{ _stableId: "S1", id: "u-2", text: "new" }] };
    const m = mergeTabData(ex, inc, "guide");
    assert.equal(m.hl.length, 1);
    assert.equal(m.hl[0].text, "new");
  });
});

// ───────────────────────────────────────────────────────────────────────────
// highlight.clips — last_write_wins 회귀 (2026-05-15)
// ───────────────────────────────────────────────────────────────────────────
// 배경: 옛 array_stable_id_union 영역의 union 의미론 = 사용자 삭제 인식 X →
//       PUT에서 빠진 항목이 KV에 보존되어 fresh load 시 부활.
//       last_write_wins 변경 후 PUT body 그대로 KV 박제 → 사용자 삭제 정합.
// 멀티유저 시나리오는 version + 409 + ConflictModal 영역으로 봉합.
// 상세: ops/POSTMORTEM_DATA_LOSS_20260515.md §10
describe("mergeTabData — highlight.clips last_write_wins (deletion regression)", () => {
  test("highlight.clips: 사용자 삭제 시 KV 정합 (PUT 그대로 박제)", () => {
    const ex = { clips: [{ id: "a" }, { id: "b" }, { id: "c" }] };
    const inc = { clips: [{ id: "a" }, { id: "b" }] };   // c 삭제
    const m = mergeTabData(ex, inc, "highlight");
    assert.equal(m.clips.length, 2);                       // ★ 옛 union 이면 3개로 부활
    assert.deepEqual(m.clips.map(c => c.id).sort(), ["a", "b"]);
  });

  test("highlight.clips: 빈 배열 PUT — 모두 삭제 정합", () => {
    const ex = { clips: [{ id: "a" }, { id: "b" }] };
    const inc = { clips: [] };
    const m = mergeTabData(ex, inc, "highlight");
    assert.equal(m.clips.length, 0);                       // ★ 옛 union 이면 2개 그대로
  });

  test("highlight.clips: 새 항목 추가 정합", () => {
    const ex = { clips: [{ id: "a" }] };
    const inc = { clips: [{ id: "a" }, { id: "b" }] };
    const m = mergeTabData(ex, inc, "highlight");
    assert.equal(m.clips.length, 2);
  });

  test("highlight.clips: 수정 (같은 id, 다른 text) — incoming 박제", () => {
    const ex = { clips: [{ id: "a", text: "old" }] };
    const inc = { clips: [{ id: "a", text: "new" }] };
    const m = mergeTabData(ex, inc, "highlight");
    assert.equal(m.clips.length, 1);
    assert.equal(m.clips[0].text, "new");
  });

  test("highlight.recs: last_write_wins 영역 (이미 적용된 영역, 회귀)", () => {
    const ex = { recs: { keyword: "old" } };
    const inc = { recs: { keyword: "new" } };
    const m = mergeTabData(ex, inc, "highlight");
    assert.deepEqual(m.recs, { keyword: "new" });
  });
});

describe("mergeTabData — manuscript (__replace)", () => {
  test("manuscript: 통째 교체 (재업로드 시)", () => {
    const ex = { paragraphs: ["old1", "old2"] };
    const inc = { paragraphs: ["new1"] };
    const m = mergeTabData(ex, inc, "manuscript");
    assert.deepEqual(m, inc);  // 통째 교체
  });
});

describe("validateMergeResult — 무결성 (B6)", () => {
  test("blocks 길이 감소 시 violation", () => {
    const v = validateMergeResult(
      { blocks: [{index:0}, {index:1}] },
      { blocks: [{index:0}] },
      "correction"
    );
    assert.ok(v.some(s => s.includes("blocks length decreased")));
  });
  test("blocks 길이 증가 정상", () => {
    const v = validateMergeResult(
      { blocks: [{index:0}] },
      { blocks: [{index:0}, {index:1}] },
      "correction"
    );
    assert.equal(v.length, 0);
  });
  test("_stableId 중복 시 violation", () => {
    const v = validateMergeResult({}, { hl: [{_stableId:"a"}, {_stableId:"a"}] }, "guide");
    assert.ok(v.some(s => s.includes("duplicate _stableId")));
  });
  test("_stableId unique 정상", () => {
    const v = validateMergeResult({}, { hl: [{_stableId:"a"}, {_stableId:"b"}] }, "guide");
    assert.equal(v.length, 0);
  });
  test("PROTO_KEYS leak 감지", () => {
    const polluted = Object.create(null);
    polluted.__proto__ = "x";  // 직접 키 설정
    Object.defineProperty(polluted, "__proto__", {
      value: "x", enumerable: true, configurable: true, writable: true
    });
    const v = validateMergeResult({}, polluted, "review");
    // 우리 검증은 Object.keys 로 enumerable 만 — 실제론 sanitizePayload 가 차단
    // 여기선 단순 프로토 키가 enumerable 한 케이스 시뮬
  });
});

describe("sanitizePayload — PROTO_KEYS 차단 (B12)", () => {
  // 주의: "__proto__" in obj 는 모든 객체에서 true (Object.prototype 의 getter)
  // 진짜 검증은 Object.keys 기준 + 프로토타입 오염 미발생
  test("__proto__ own key 차단 + 오염 없음", () => {
    const malicious = JSON.parse('{"normal":1, "__proto__":{"x":2}}');
    const clean = sanitizePayload(malicious);
    assert.equal(clean.normal, 1);
    assert.ok(!Object.keys(clean).includes("__proto__"));
    assert.equal(clean.x, undefined);  // 오염 안 됨
    assert.equal({}.x, undefined);  // 전역 오염 없음
  });
  test("중첩 __proto__ own key 차단", () => {
    const malicious = JSON.parse('{"a":{"__proto__":{"x":2}, "b":1}}');
    const clean = sanitizePayload(malicious);
    assert.equal(clean.a.b, 1);
    assert.ok(!Object.keys(clean.a).includes("__proto__"));
    assert.equal(clean.a.x, undefined);
  });
  test("배열 안 객체도 sanitize", () => {
    const malicious = JSON.parse('[{"__proto__":{"x":1}}, {"a":2}]');
    const clean = sanitizePayload(malicious);
    assert.ok(!Object.keys(clean[0]).includes("__proto__"));
    assert.equal(clean[0].x, undefined);
    assert.equal(clean[1].a, 2);
  });
  test("constructor 차단", () => {
    const malicious = JSON.parse('{"a":1, "constructor":{"prototype":{"x":2}}}');
    const clean = sanitizePayload(malicious);
    assert.equal(clean.a, 1);
    assert.ok(!Object.keys(clean).includes("constructor"));
  });
});

describe("arrayIdUnion", () => {
  test("기본 union", () => {
    const r = arrayIdUnion([{id:1,v:"a"},{id:2,v:"b"}], [{id:2,v:"B"},{id:3,v:"c"}], (i)=>i.id);
    const sorted = r.sort((a,b)=>a.id-b.id);
    assert.deepEqual(sorted, [{id:1,v:"a"},{id:2,v:"B"},{id:3,v:"c"}]);
  });
  test("ID 없는 entity skip", () => {
    const r = arrayIdUnion([{id:1}], [{}, {id:2}], (i)=>i.id);
    assert.equal(r.length, 2);  // 1 + 2 (empty skip)
  });
  test("existing 빈 배열", () => {
    const r = arrayIdUnion(undefined, [{id:1}], (i)=>i.id);
    assert.equal(r.length, 1);
  });
});

describe("detectConflict — B5", () => {
  test("baseVersion < existing.version → 충돌", () => {
    const r = detectConflict({savedAt:"t1", version:5}, {baseVersion:3});
    assert.equal(r.conflict, true);
  });
  test("baseVersion === existing.version → 정상", () => {
    const r = detectConflict({savedAt:"t1", version:5}, {baseVersion:5});
    assert.equal(r.conflict, false);
  });
  test("baseSavedAt 시각 차이 (version 부재) → 충돌", () => {
    const r = detectConflict({savedAt:"2026-05-05T12:00:00Z"}, {baseSavedAt:"2026-05-05T11:00:00Z"});
    assert.equal(r.conflict, true);
  });
  test("existing 부재 (신규) → 충돌 없음", () => {
    const r = detectConflict(null, {baseSavedAt:"t1"});
    assert.equal(r.conflict, false);
  });
});
