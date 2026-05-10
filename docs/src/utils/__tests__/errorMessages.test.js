// lab fresh v2 — errorMessages 단위 테스트
// 사료: S3.2 D2 + S4c.4 E9

import { test } from "node:test";
import assert from "node:assert/strict";
import { translateError, tabLabelKo, TAB_LABEL_KO } from "../errorMessages.js";

// ─── translateError ──────────────────────────────────────────────────────

test("translateError: exact match 'Failed to fetch'", () => {
  assert.equal(translateError("Failed to fetch"), "인터넷 연결이 끊어졌을 수 있습니다.");
});

test("translateError: status code 401", () => {
  assert.ok(translateError("401").includes("로그인"));
});

test("translateError: status code 403", () => {
  assert.ok(translateError("403").includes("권한"));
});

test("translateError: status code 404", () => {
  assert.ok(translateError("404").includes("프로젝트를 찾을"));
});

test("translateError: status code 409", () => {
  assert.ok(translateError("409").includes("다른 편집자"));
});

test("translateError: status code 500/502/503", () => {
  assert.ok(translateError("500").includes("서버"));
  assert.ok(translateError("502").includes("서버"));
  assert.ok(translateError("503").includes("점검"));
});

test("translateError: 'KV not configured' → 한글 매핑", () => {
  assert.ok(translateError("KV not configured").includes("저장소 설정"));
});

test("translateError: substring match", () => {
  assert.ok(translateError("error: Failed to fetch from worker").includes("인터넷"));
});

test("translateError: Error 객체", () => {
  const err = new Error("Failed to fetch");
  assert.ok(translateError(err).includes("인터넷"));
});

test("translateError: null/undefined → default", () => {
  const r1 = translateError(null);
  const r2 = translateError(undefined);
  assert.ok(r1.includes("백업 파일") || r1.includes("알 수 없는"));
  assert.ok(r2.includes("백업 파일") || r2.includes("알 수 없는"));
});

test("translateError: 알 수 없는 에러 → default", () => {
  const r = translateError("totally unknown weird thing");
  assert.ok(r.includes("백업 파일") || r.includes("알 수 없는"));
});

// ─── tabLabelKo ──────────────────────────────────────────────────────────

test("tabLabelKo: 11 탭 모두 한글 label", () => {
  for (const t of Object.keys(TAB_LABEL_KO)) {
    assert.ok(tabLabelKo(t), `${t} label 누락`);
    assert.notEqual(tabLabelKo(t), t);  // label 이 영문이 아니라 한글
  }
});

test("tabLabelKo: 'visual' → '자료·그래픽'", () => {
  assert.equal(tabLabelKo("visual"), "자료·그래픽");
});

test("tabLabelKo: 알 수 없는 탭 → 그대로 또는 fallback", () => {
  const r = tabLabelKo("unknown");
  assert.equal(r, "unknown");
});

test("tabLabelKo: null/undefined → fallback", () => {
  assert.equal(tabLabelKo(null), "(알 수 없음)");
  assert.equal(tabLabelKo(undefined), "(알 수 없음)");
});

test("TAB_LABEL_KO: 11 탭 정확 (S2.2.b 정합)", () => {
  const REQUIRED = ["meta", "manuscript", "review", "correction", "script",
    "guide", "highlight", "visual", "setgen", "modify", "metadata", "subtitle"];
  for (const t of REQUIRED) {
    assert.ok(TAB_LABEL_KO[t], `${t} 누락`);
  }
});
