import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  TAB_MAP, PROJECT_TAB_KEYS, STEP_MAP, DIRTY_TABS,
  uiToWorker, isValidTabKey, isValidSessionId,
} from "../../docs/src/utils/tabs.js";

describe("TAB_MAP — 단일 소스 (G1, N1)", () => {
  test("11 worker 키 보유", () => {
    assert.equal(PROJECT_TAB_KEYS.length, 11);
    assert.ok(PROJECT_TAB_KEYS.includes("correction"));
    assert.ok(PROJECT_TAB_KEYS.includes("subtitle"));
  });
  test("UI step 8개", () => {
    assert.equal(Object.keys(STEP_MAP).length, 8);
    assert.equal(STEP_MAP.review, 0);
    assert.equal(STEP_MAP.script, 2);
    assert.equal(STEP_MAP.setgen, 7);
  });
  test("DIRTY_TABS — subtitle 동봉 처리", () => {
    // subtitle 의 dirtyKey = correction → 중복 제거
    assert.ok(!DIRTY_TABS.includes("subtitle"));
    assert.ok(DIRTY_TABS.includes("correction"));
  });
  test("uiToWorker — script → subtitle", () => {
    assert.equal(uiToWorker("script"), "subtitle");
    assert.equal(uiToWorker("review"), "review");
  });
  test("isValidTabKey — 화이트리스트 (E4)", () => {
    assert.equal(isValidTabKey("correction"), true);
    assert.equal(isValidTabKey("evil_key"), false);
    assert.equal(isValidTabKey("__proto__"), false);
  });
  test("isValidSessionId — 정규식 (E5)", () => {
    assert.equal(isValidSessionId("abc12345"), true);
    assert.equal(isValidSessionId("ABC12345"), false);  // 대문자
    assert.equal(isValidSessionId("abc1234"), false);   // 7자
    assert.equal(isValidSessionId("../../etc"), false); // path traversal
    assert.equal(isValidSessionId(""), false);
    assert.equal(isValidSessionId(null), false);
  });
});
