// lab fresh v2 — clientMerge / _mergeImpl 단위 테스트 (M11 drift 차단)
// 사료: 묶음 ⑫ M11 — 클라 머지 = 서버 머지 동일 모듈 의무

import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";

import {
  clientMergeTabData,
  deepMerge,
  arrayIdUnion,
  arrayStableIdUnion,
  objectMergeArrayUnion,
  sanitizePayload,
  PROTO_KEYS,
  MAX_DEPTH,
  MERGE_STRATEGIES,
} from "../clientMerge.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Windows-safe ESM dynamic import — pathToFileURL 변환 의무
const WORKER_MERGE_URL = pathToFileURL(resolve(__dirname, "../../../../worker/merge.js")).href;

// ─── re-export 검증 ─────────────────────────────────────────────────────

test("clientMerge: re-export 모두 정상", () => {
  assert.equal(typeof clientMergeTabData, "function");
  assert.equal(typeof deepMerge, "function");
  assert.equal(typeof arrayIdUnion, "function");
  assert.equal(typeof arrayStableIdUnion, "function");
  assert.equal(typeof objectMergeArrayUnion, "function");
  assert.equal(typeof sanitizePayload, "function");
  assert.ok(PROTO_KEYS instanceof Set);
  assert.equal(typeof MAX_DEPTH, "number");
  assert.ok(MERGE_STRATEGIES);
});

test("clientMergeTabData: 정상 머지 (correction blocks)", async () => {
  const r = await clientMergeTabData(
    { blocks: [{ index: 1, text: "a" }] },
    { blocks: [{ index: 2, text: "b" }] },
    "correction"
  );
  assert.equal(r.blocks.length, 2);
});

// ─── ★ M11 drift 차단 — _mergeImpl.js ↔ worker/merge.js 동기 검증 ───────

test("★ M11 drift: PROTO_KEYS 동일 (worker/merge.js 와 lab/docs/src/utils/_mergeImpl.js)", async () => {
  // worker 측 import
  const workerMerge = await import(WORKER_MERGE_URL);
  assert.deepEqual([...workerMerge.PROTO_KEYS], [...PROTO_KEYS]);
  assert.equal(workerMerge.MAX_DEPTH, MAX_DEPTH);
});

test("★ M11 drift: MERGE_STRATEGIES 동일 (11 탭 + 같은 strategy)", async () => {
  const workerMerge = await import(WORKER_MERGE_URL);
  const workerKeys = Object.keys(workerMerge.MERGE_STRATEGIES).sort();
  const labKeys = Object.keys(MERGE_STRATEGIES).sort();
  assert.deepEqual(workerKeys, labKeys);

  for (const tab of workerKeys) {
    assert.deepEqual(
      Object.entries(workerMerge.MERGE_STRATEGIES[tab]).sort(),
      Object.entries(MERGE_STRATEGIES[tab]).sort(),
      `${tab} strategy mismatch`
    );
  }
});

test("★ M11 drift: deepMerge 동일 동작 (same input → same output)", async () => {
  const workerMerge = await import(WORKER_MERGE_URL);
  const a = { x: 1, y: { z: 2 } };
  const b = { y: { w: 3 }, q: 4 };
  const fromWorker = workerMerge.deepMerge(a, b);
  const fromLab = deepMerge(a, b);
  assert.deepEqual(fromLab, fromWorker);
});

test("★ M11 drift: mergeTabData 동일 동작", async () => {
  const workerMerge = await import(WORKER_MERGE_URL);
  const existing = { hl: [{ _stableId: "u1", text: "old" }] };
  const incoming = { hl: [{ _stableId: "u1", text: "NEW" }, { _stableId: "u2", text: "v2" }] };
  const fromWorker = await workerMerge.mergeTabData(existing, incoming, "guide");
  const fromLab = await clientMergeTabData(existing, incoming, "guide");
  assert.deepEqual(fromLab, fromWorker);
});

// ─── 핵심 사양 sanity (worker tests 와 중복 일부, 이중 검증) ────────────

test("deepMerge: 명시적 null = 삭제", () => {
  assert.equal(deepMerge({ a: 1 }, null), null);
});

test("deepMerge: PROTO_KEYS 차단", () => {
  const evil = JSON.parse('{"__proto__": {"polluted": true}, "x": 1}');
  const r = deepMerge({}, evil);
  assert.equal(r.x, 1);
  assert.equal(({}).polluted, undefined);
});

test("arrayStableIdUnion: _stableId 우선 + fallback chain", () => {
  const r = arrayStableIdUnion(
    [{ _stableId: "u1", v: "a" }, { subtitle: "안녕", v: "b" }],
    [{ _stableId: "u1", v: "A" }, { text: "다른", v: "c" }]
  );
  assert.equal(r.length, 3);  // u1 (merged) + 안녕 + 다른
  assert.equal(r.find((x) => x._stableId === "u1").v, "A");
});

test("sanitizePayload: 중첩 PROTO_KEYS 모두 제거", () => {
  const evil = JSON.parse('{"a": {"__proto__": "x", "b": 1}}');
  const r = sanitizePayload(evil);
  assert.equal(r.a.b, 1);
  assert.equal(Object.prototype.hasOwnProperty.call(r.a, "__proto__"), false);
});
