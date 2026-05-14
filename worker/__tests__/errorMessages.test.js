import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { translateError, ERROR_MESSAGES, DEFAULT_MESSAGE, tabLabel } from "../../docs/src/utils/errorMessages.js";

describe("translateError — 한글 매핑 (D2)", () => {
  test("Failed to fetch → 인터넷 끊김", () => {
    assert.equal(translateError(new Error("Failed to fetch")), "인터넷 연결이 끊어졌을 수 있습니다.");
  });
  test("status 401 → 로그인 만료", () => {
    const err = new Error("unauthorized"); err.status = 401;
    assert.equal(translateError(err), "로그인이 만료되었습니다. 다시 로그인해주세요.");
  });
  test("status 500 → 서버 일시 문제", () => {
    assert.equal(translateError(500), "서버에 일시적인 문제가 있습니다. 잠시 후 다시 시도해주세요.");
  });
  test("KV not configured → 관리자 안내", () => {
    assert.equal(translateError(new Error("KV not configured")), "서버 저장소 설정에 문제가 있습니다. 관리자에게 알려주세요.");
  });
  test("부분 매칭", () => {
    assert.equal(translateError(new Error("TypeError: Failed to fetch resource")), "인터넷 연결이 끊어졌을 수 있습니다.");
  });
  test("매칭 실패 → default", () => {
    assert.equal(translateError(new Error("totally unknown")), DEFAULT_MESSAGE);
  });
  test("null/undefined → default", () => {
    assert.equal(translateError(null), DEFAULT_MESSAGE);
    assert.equal(translateError(undefined), DEFAULT_MESSAGE);
  });
});

describe("tabLabel — 한글 라벨", () => {
  test("11 탭 모두 한글", () => {
    assert.equal(tabLabel("correction"), "1차 교정");
    assert.equal(tabLabel("guide"), "편집 가이드");
    assert.equal(tabLabel("review"), "0차 검토");
    assert.equal(tabLabel("highlight"), "하이라이트");
  });
  test("미등록 키 → 그대로 반환", () => {
    assert.equal(tabLabel("unknown"), "unknown");
  });
});
