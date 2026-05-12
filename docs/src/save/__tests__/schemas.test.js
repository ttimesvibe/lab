// lab fresh v2 — tabs/schemas/dispatchers 단위 테스트
// 사료: 헌장 §5 11 탭 동등 + S5.1 A5 + R1 보강 + R4 §5 단위 테스트

import { test } from "node:test";
import assert from "node:assert/strict";

import { TAB_KEYS, TAB_MAP, UI_TABS, STEP_TO_TAB, uiToWorker, workerToUi, isValidTab, persistableTabs } from "../tabs.js";
import { TAB_SCHEMAS, KV_VALUE_SCHEMA_VERSION, KV_VALUE_ENVELOPE_FIELDS, validateTabData, isComplete as schemasComplete } from "../schemas.js";
import {
  SAVE_DISPATCH,
  APPLY_SERVER_DISPATCH,
  FETCH_DISPATCH,
  LAST_LOADED_DISPATCH,
  DIRTY_SNAPSHOT_DISPATCH,
  readTabData,
  writeTabData,
  patchTabData,
  buildFullSnapshot,
  verifyDispatchCompleteness,
} from "../dispatchers.js";

// ─── tabs.js ─────────────────────────────────────────────────────────────

test("TAB_KEYS: 11 탭 정확 (worker PROJECT_TAB_KEYS 정합)", () => {
  assert.equal(TAB_KEYS.length, 11);
  for (const t of [
    "meta", "manuscript", "review", "correction", "subtitle",
    "guide", "visual", "modify", "highlight", "setgen", "metadata",
  ]) {
    assert.ok(TAB_KEYS.includes(t), `${t} 누락`);
  }
});

test("TAB_MAP: 11 탭 모두 metadata 정의", () => {
  for (const t of TAB_KEYS) {
    assert.ok(TAB_MAP[t], `${t} TAB_MAP 누락`);
    assert.equal(typeof TAB_MAP[t].persist, "boolean");
  }
});

test("UI_TABS: 9 user-facing (★ 실 UI Phase 1 — manuscript 노출)", () => {
  assert.equal(UI_TABS.length, 9);
  for (const u of ["manuscript", "review", "correction", "script", "guide", "visual", "modify", "highlight", "setgen"]) {
    assert.ok(UI_TABS.includes(u));
  }
  // manuscript 가 첫 번째 (원고 업로드 진입점)
  assert.equal(UI_TABS[0], "manuscript");
});

test("STEP_TO_TAB: step 2 (UI script) → worker subtitle (★ PRD §12.1)", () => {
  assert.equal(STEP_TO_TAB[2], "subtitle");
  assert.equal(STEP_TO_TAB[0], "review");
  assert.equal(STEP_TO_TAB[7], "setgen");
});

test("uiToWorker: script → subtitle / review → review", () => {
  assert.equal(uiToWorker("script"), "subtitle");
  assert.equal(uiToWorker("review"), "review");
  assert.equal(uiToWorker("unknown"), null);
});

test("workerToUi: subtitle → script / review → review", () => {
  assert.equal(workerToUi("subtitle"), "script");
  assert.equal(workerToUi("review"), "review");
  assert.equal(workerToUi("meta"), null);
});

test("isValidTab: 11 탭 모두 통과 + 임의 차단", () => {
  for (const t of TAB_KEYS) assert.ok(isValidTab(t));
  assert.equal(isValidTab("evil_tab"), false);
  assert.equal(isValidTab(null), false);
});

test("persistableTabs: 11 탭 모두 persist=true", () => {
  const ps = persistableTabs();
  assert.equal(ps.length, 11);
});

// ─── schemas.js ──────────────────────────────────────────────────────────

test("TAB_SCHEMAS: 11 탭 모두 fields 정의 (R1 보강)", () => {
  for (const t of TAB_KEYS) {
    assert.ok(TAB_SCHEMAS[t], `${t} schema 누락`);
    assert.ok(Array.isArray(TAB_SCHEMAS[t].fields));
    assert.ok(Array.isArray(TAB_SCHEMAS[t].required));
  }
});

test("TAB_SCHEMAS: correction fields 정확 (S2.2.b 정합)", () => {
  assert.deepEqual(
    TAB_SCHEMAS.correction.fields.sort(),
    ["anal", "blockDeletions", "blocks", "diffs", "scriptEdits"].sort()
  );
});

test("TAB_SCHEMAS: visual fields 정확", () => {
  const expected = ["visualGuides", "insertCuts", "manualResources", "verdicts", "visualMarkers"];
  for (const f of expected) {
    assert.ok(TAB_SCHEMAS.visual.fields.includes(f));
  }
});

test("KV_VALUE_SCHEMA_VERSION: '2.0'", () => {
  assert.equal(KV_VALUE_SCHEMA_VERSION, "2.0");
});

test("KV_VALUE_ENVELOPE_FIELDS: savedAt + version + updatedBy + schemaVersion", () => {
  for (const f of ["savedAt", "version", "updatedBy", "schemaVersion"]) {
    assert.ok(KV_VALUE_ENVELOPE_FIELDS.includes(f));
  }
});

test("validateTabData: meta required (sessionId + schemaVersion) 통과", () => {
  const r = validateTabData("meta", { sessionId: "abc", schemaVersion: "2.0", stages: {} });
  assert.equal(r.valid, true);
});

test("validateTabData: meta required 누락 → invalid", () => {
  const r = validateTabData("meta", { stages: {} });
  assert.equal(r.valid, false);
  assert.ok(r.missing.includes("sessionId"));
  assert.ok(r.missing.includes("schemaVersion"));
});

test("validateTabData: 알 수 없는 탭 → invalid", () => {
  const r = validateTabData("evil_tab", {});
  assert.equal(r.valid, false);
});

test("schemas.isComplete: 11 탭 모두 정의됨", () => {
  assert.equal(schemasComplete(), true);
});

// ─── dispatchers.js (★ 헌장 §5 단위 테스트) ────────────────────────────

test("§5-1: 모든 11 탭이 동일 read 패턴 (state.tabData[tab])", () => {
  const state = { tabData: { correction: { blocks: [{ index: 1 }] }, visual: { x: 1 } } };
  for (const tab of TAB_KEYS) {
    const r = readTabData(state, tab);
    if (state.tabData[tab]) {
      assert.deepEqual(r, state.tabData[tab]);
    } else {
      assert.equal(r, null);
    }
  }
});

test("§5-2: 모든 11 탭이 동일 write 패턴 (writeTabData)", () => {
  let state = {};
  for (const tab of TAB_KEYS) {
    state = writeTabData(state, tab, { x: tab });
  }
  for (const tab of TAB_KEYS) {
    assert.deepEqual(state.tabData[tab], { x: tab });
  }
});

test("§5-3: TAB_SCHEMAS fields 가 dispatcher read 결과와 일치 (sanity)", () => {
  // 모든 탭이 schema 와 dispatch 모두 정의
  for (const tab of TAB_KEYS) {
    assert.ok(TAB_SCHEMAS[tab], `${tab} schema 누락`);
    assert.equal(typeof SAVE_DISPATCH[tab], "function", `${tab} SAVE_DISPATCH 누락`);
  }
});

test("§5-4: 5 dispatch table 모두 11 탭 cover (verifyDispatchCompleteness)", () => {
  const r = verifyDispatchCompleteness();
  assert.equal(r.complete, true, `incomplete: ${JSON.stringify(r.missing)}`);
});

// ─── readTabData / writeTabData / patchTabData ─────────────────────────

test("readTabData: state.tabData[tab] 반환", () => {
  const state = { tabData: { correction: { blocks: [{ index: 1 }] } } };
  assert.deepEqual(readTabData(state, "correction"), { blocks: [{ index: 1 }] });
});

test("readTabData: 미존재 → null", () => {
  assert.equal(readTabData({}, "correction"), null);
  assert.equal(readTabData(null, "correction"), null);
});

test("readTabData: invalid tab → null", () => {
  assert.equal(readTabData({ tabData: {} }, "evil"), null);
});

test("writeTabData: immutable update", () => {
  const state = { tabData: { correction: { x: 1 } } };
  const next = writeTabData(state, "guide", { hl: [] });
  // 원본 보존 (immutable)
  assert.equal(state.tabData.guide, undefined);
  // 신규 박제
  assert.deepEqual(next.tabData.guide, { hl: [] });
  assert.deepEqual(next.tabData.correction, { x: 1 });
});

test("patchTabData: 기존 fields 보존 + incoming patch", () => {
  const state = { tabData: { guide: { hl: [{ id: 1 }], hlVerdicts: { u1: "use" } } } };
  const next = patchTabData(state, "guide", { hlVerdicts: { u1: "skip" }, hlEdits: { u1: "edited" } });
  assert.deepEqual(next.tabData.guide.hl, [{ id: 1 }]);
  assert.equal(next.tabData.guide.hlVerdicts.u1, "skip");
  assert.equal(next.tabData.guide.hlEdits.u1, "edited");
});

// ─── 5 dispatch tables ──────────────────────────────────────────────────

test("SAVE_DISPATCH: 11 탭 모두 동일 패턴 (★ N3 차단)", () => {
  const state = { tabData: { correction: { blocks: [] }, visual: { items: [] } } };
  for (const tab of TAB_KEYS) {
    const r = SAVE_DISPATCH[tab](state);
    if (state.tabData[tab]) {
      assert.deepEqual(r, state.tabData[tab]);
    } else {
      assert.equal(r, null);
    }
  }
});

test("APPLY_SERVER_DISPATCH: 11 탭 모두 동일 패턴 (★ N1 차단)", () => {
  let state = {};
  for (const tab of TAB_KEYS) {
    state = APPLY_SERVER_DISPATCH[tab](state, { serverField: tab });
  }
  for (const tab of TAB_KEYS) {
    assert.deepEqual(state.tabData[tab], { serverField: tab });
  }
});

test("FETCH_DISPATCH: 11 탭 모두 동일 패턴 (apiLoadTab inject)", async () => {
  const mockApiLoadTab = async (sessionId, tab, cfg) => ({ success: true, data: { x: tab } });
  for (const tab of TAB_KEYS) {
    const r = await FETCH_DISPATCH[tab]("abc12345", { workerUrl: "x" }, mockApiLoadTab);
    assert.deepEqual(r, { x: tab });
  }
});

test("FETCH_DISPATCH: apiLoadTab 부재 → throw", async () => {
  await assert.rejects(
    () => FETCH_DISPATCH.correction("abc12345", {}),
    /apiLoadTab inject required/
  );
});

test("LAST_LOADED_DISPATCH: 11 탭 모두 동등 ref 갱신 (★ N2 차단)", () => {
  let refs = {};
  for (const tab of TAB_KEYS) {
    refs = LAST_LOADED_DISPATCH[tab](refs, "T1", 1);
  }
  for (const tab of TAB_KEYS) {
    assert.deepEqual(refs[tab], { savedAt: "T1", version: 1 });
  }
});

test("DIRTY_SNAPSHOT_DISPATCH: 11 탭 동등 (★ N3 영역 — exportCache 누락 0)", () => {
  const state = { tabData: { correction: { x: 1 }, visual: null } };
  for (const tab of TAB_KEYS) {
    const snap = DIRTY_SNAPSHOT_DISPATCH[tab](state);
    assert.equal(typeof snap, "string");
  }
});

test("buildFullSnapshot: 모든 11 탭 통합 snapshot", () => {
  const state = { tabData: { correction: { x: 1 } } };
  const snap = buildFullSnapshot(state);
  const parsed = JSON.parse(snap);
  // 11 탭 모두 key 박힘
  assert.equal(Object.keys(parsed).length, 11);
});
