// lab fresh v2 — 마이그레이션 스크립트 단위 테스트
// 사료: B2 _stableId / S2.2.c envelope / S4.6 H4 anomaly false positive 회피

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ACCOUNT_ID, SOURCE_KV_ID, TARGET_KV_ID,
  categorize, transformValue, generateStableId, simpleHash,
} from "../migrate_from_old_test.mjs";

// ─── 환경 상수 검증 ─────────────────────────────────────────────────────

test("환경: ACCOUNT_ID = ttimesvibe (사료 정합)", () => {
  assert.equal(ACCOUNT_ID, "fb0a10864393158e940b149b3ead37f6");
});

test("환경: SOURCE_KV_ID = editor-sessions (옛 test)", () => {
  assert.equal(SOURCE_KV_ID, "9e4f5bb9cd294b86868e4b9d502adbcc");
});

test("환경: TARGET_KV_ID = lab-sessions (★ lab 신설)", () => {
  assert.equal(TARGET_KV_ID, "fbb8da8adcae4ee0a555abff66f798ac");
});

// ─── categorize ──────────────────────────────────────────────────────────

test("categorize: 11 탭 키 패턴 매칭", () => {
  const keys = [
    "s:abc12345:meta",
    "s:abc12345:correction",
    "s:abc12345:guide",
    "s:xyz12345:visual",
  ];
  const { cat } = categorize(keys);
  assert.equal(cat.sessionTab, 4);
  assert.equal(cat.legacy, 0);
});

test("categorize: legacy save_/auto_/shared_dict", () => {
  const keys = ["save_abc12345", "auto_xyz12345", "shared_dict"];
  const { cat } = categorize(keys);
  assert.equal(cat.legacy, 3);
});

test("categorize: 인덱스 키", () => {
  const keys = ["project_index", "session_index", "shoot_index", "team_members"];
  const { cat } = categorize(keys);
  assert.equal(cat.index, 4);
});

test("categorize: image 키 (s:{id}:img:*)", () => {
  const keys = ["s:abc12345:img:card1", "s:abc12345:img:card2"];
  const { cat } = categorize(keys);
  assert.equal(cat.sessionImg, 2);
});

test("categorize: active 키", () => {
  const keys = ["active:abc12345"];
  const { cat } = categorize(keys);
  assert.equal(cat.active, 1);
});

// ─── transformValue (★ envelope 보강 + _stableId) ──────────────────────

test("transformValue: s:{id}:correction → schemaVersion 박제", () => {
  const raw = JSON.stringify({ blocks: [{ index: 1 }], anal: { x: 1 } });
  const r = transformValue(raw, "s:abc12345:correction");
  assert.equal(r.changed, true);
  const parsed = JSON.parse(r.transformed);
  assert.equal(parsed.schemaVersion, "2.0");
  assert.equal(parsed.version, 1);
  assert.ok(parsed.savedAt);
});

test("transformValue: 이미 envelope 있는 값 → 변경 X", () => {
  const raw = JSON.stringify({
    blocks: [{ index: 1 }],
    schemaVersion: "2.0",
    version: 5,
    savedAt: "2026-05-10T00:00:00Z",
  });
  const r = transformValue(raw, "s:abc12345:correction");
  assert.equal(r.changed, false);
});

test("transformValue: ★ _stableId 부여 (hl array)", () => {
  const raw = JSON.stringify({
    hl: [{ subtitle: "안녕", speaker: "A", startMs: 1000 }],
  });
  const r = transformValue(raw, "s:abc12345:guide");
  const parsed = JSON.parse(r.transformed);
  assert.ok(parsed.hl[0]._stableId);
  assert.ok(parsed.hl[0]._stableId.startsWith("m_hl_"));
});

test("transformValue: ★ _stableId 부여 — 5 entity (B2)", () => {
  const raw = JSON.stringify({
    hl: [{ subtitle: "x" }],
    diffs: [{ blockIndex: 1, posStart: 0 }],
    visualGuides: [{ title: "v1" }],
    insertCuts: [{ title: "ic1" }],
    manualResources: [{ name: "r1" }],
  });
  const r = transformValue(raw, "s:abc12345:visual");
  const parsed = JSON.parse(r.transformed);
  assert.ok(parsed.hl[0]._stableId);
  assert.ok(parsed.diffs[0]._stableId);
  assert.ok(parsed.visualGuides[0]._stableId);
  assert.ok(parsed.insertCuts[0]._stableId);
  assert.ok(parsed.manualResources[0]._stableId);
});

test("transformValue: 이미 _stableId 있는 entity → 보존 (idempotent)", () => {
  const raw = JSON.stringify({
    hl: [
      { _stableId: "existing-id-1", subtitle: "x" },
      { subtitle: "new" },  // 이건 새로 부여
    ],
  });
  const r = transformValue(raw, "s:abc12345:guide");
  const parsed = JSON.parse(r.transformed);
  assert.equal(parsed.hl[0]._stableId, "existing-id-1");  // 보존
  assert.ok(parsed.hl[1]._stableId);  // 신규
  assert.notEqual(parsed.hl[1]._stableId, "existing-id-1");
});

test("transformValue: image 키 (s:{id}:img:*) → 변경 X", () => {
  const raw = "base64-image-data-here";
  const r = transformValue(raw, "s:abc12345:img:card1");
  assert.equal(r.changed, false);
  assert.equal(r.transformed, raw);
});

test("transformValue: legacy 키 (save_*) → 변경 X", () => {
  const raw = JSON.stringify({ blocks: [] });
  const r = transformValue(raw, "save_abc12345");
  assert.equal(r.changed, false);  // s:{id}:tab 패턴 아니므로 envelope 안 추가
});

test("transformValue: 인덱스 키 (project_index) → 변경 X", () => {
  const raw = JSON.stringify([{ id: "abc12345", fn: "x" }]);
  const r = transformValue(raw, "project_index");
  assert.equal(r.changed, false);
});

test("transformValue: 비-JSON 값 → graceful (변경 X)", () => {
  const r = transformValue("not-json-data", "s:abc12345:img:x");
  assert.equal(r.changed, false);
  assert.equal(r.anomaly, null);  // image 같은 binary 는 anomaly 아님
});

test("transformValue: 빈 값 → anomaly empty", () => {
  const r = transformValue("", "s:abc12345:correction");
  assert.equal(r.anomaly, "empty");
});

test("transformValue: updatedBy string → 객체화 (R11)", () => {
  const raw = JSON.stringify({
    blocks: [],
    updatedBy: "alice@mt.co.kr",
    savedAt: "T1",
  });
  const r = transformValue(raw, "s:abc12345:correction");
  const parsed = JSON.parse(r.transformed);
  assert.equal(typeof parsed.updatedBy, "object");
  assert.equal(parsed.updatedBy.sub, "alice@mt.co.kr");
});

// ─── generateStableId ────────────────────────────────────────────────────

test("generateStableId: deterministic (같은 input → 같은 id)", () => {
  const item = { subtitle: "안녕", speaker: "A", startMs: 1000 };
  const id1 = generateStableId(item, "hl", 0, "s:abc:guide");
  const id2 = generateStableId(item, "hl", 0, "s:abc:guide");
  assert.equal(id1, id2);
});

test("generateStableId: 다른 input → 다른 id (collision rare)", () => {
  const item1 = { subtitle: "안녕" };
  const item2 = { subtitle: "다른" };
  const id1 = generateStableId(item1, "hl", 0, "s:abc:guide");
  const id2 = generateStableId(item2, "hl", 0, "s:abc:guide");
  assert.notEqual(id1, id2);
});

test("generateStableId: prefix 'm_<field>_'", () => {
  const id = generateStableId({ subtitle: "x" }, "hl", 0, "s:abc:guide");
  assert.ok(id.startsWith("m_hl_"));
});

// ─── simpleHash ──────────────────────────────────────────────────────────

test("simpleHash: 12 char alphanumeric", () => {
  const h = simpleHash("test-input");
  assert.equal(h.length, 12);
  assert.ok(/^[a-z0-9]{12}$/.test(h));
});

test("simpleHash: deterministic", () => {
  const h1 = simpleHash("same-input");
  const h2 = simpleHash("same-input");
  assert.equal(h1, h2);
});

test("simpleHash: different input → different hash", () => {
  const h1 = simpleHash("input-1");
  const h2 = simpleHash("input-2");
  assert.notEqual(h1, h2);
});
