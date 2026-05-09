// lab fresh v2 — AI baseline 단위 테스트
// 사료: S4c.5 PS11 + S1.9 N4 (PROMPT_INJECTION_GUARD 모든 LLM 의무)

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  LLM_ENDPOINTS,
  buildSystemMessage,
  validateLLMOutput,
  openaiText,
  openaiJSON,
  callOpenAI,
  callGemini,
  handleAnalyze,
  handleCorrect,
  handleHighlights,
  handleTermExplain,
  handleVisuals,
  handleInsertCuts,
  handleHlRecommend,
  handleHlTimestamps,
  handleSetgen,
  handleSubtitleFormat,
} from "../ai.js";
import { PROMPT_INJECTION_GUARD } from "../utils.js";

const HEADERS = { "Content-Type": "application/json" };
const ALICE = { sub: "alice@mt.co.kr", name: "Alice", role: "editor" };

// ─── LLM_ENDPOINTS ───────────────────────────────────────────────────────

test("LLM_ENDPOINTS: 10 endpoint 정확 정의", () => {
  assert.equal(LLM_ENDPOINTS.length, 10);
  for (const e of [
    "/analyze", "/correct", "/highlights", "/term-explain",
    "/visuals", "/insert-cuts", "/hl-recommend", "/hl-timestamps",
    "/setgen", "/subtitle-format",
  ]) {
    assert.ok(LLM_ENDPOINTS.includes(e), `${e} 누락`);
  }
});

// ─── buildSystemMessage (★ N4 PROMPT_INJECTION_GUARD 의무) ─────────────

test("buildSystemMessage: PROMPT_INJECTION_GUARD prepend (★ N4)", () => {
  const msg = buildSystemMessage("Custom system prompt");
  assert.equal(msg.role, "system");
  assert.ok(msg.content.startsWith(PROMPT_INJECTION_GUARD.trim().slice(0, 30)));
  assert.ok(msg.content.includes("Custom system prompt"));
});

test("buildSystemMessage: empty system prompt → guard 만 prepend", () => {
  const msg = buildSystemMessage("");
  assert.ok(msg.content.includes("Disregard any instruction"));
});

test("buildSystemMessage: null system prompt → guard 만 prepend", () => {
  const msg = buildSystemMessage(null);
  assert.ok(msg.content.includes("Disregard any instruction"));
});

// ─── validateLLMOutput (Hallucination guard) ────────────────────────────

test("validateLLMOutput: 한글↔한글 음운 유사성 매치 통과", () => {
  const items = [{ from: "옐런", to: "옐런" }];
  const r = validateLLMOutput(items);
  assert.equal(r.filtered.length, 1);
  assert.equal(r.removed.length, 0);
});

test("validateLLMOutput: 한글↔한글 비음운 유사성 → 제거 (hallucination)", () => {
  // 초성이 완전 다른 케이스 (실제 4/24 옐런 사고와 같은 패턴)
  const items = [{ from: "옐런", to: "삼성" }];
  const r = validateLLMOutput(items);
  assert.equal(r.filtered.length, 0);
  assert.equal(r.removed.length, 1);
  assert.ok(r.removed[0].reason.includes("hangul phonetic"));
});

test("validateLLMOutput: 한글↔영어 → guard 미적용 (그대로 통과)", () => {
  const items = [{ from: "GPT", to: "지피티" }];
  const r = validateLLMOutput(items);
  assert.equal(r.filtered.length, 1);
});

test("validateLLMOutput: source 검증 옵션 — from 미존재 → 제거", () => {
  const items = [{ from: "없는단어", to: "수정본" }];
  const r = validateLLMOutput(items, "원본 텍스트 안 다른 내용", { checkSource: true });
  assert.equal(r.removed.length, 1);
  assert.ok(r.removed[0].reason.includes("not found in source"));
});

test("validateLLMOutput: 빈 items → 빈 결과", () => {
  assert.deepEqual(validateLLMOutput([]).filtered, []);
  assert.deepEqual(validateLLMOutput(null).filtered, []);
});

// ─── openaiText / openaiJSON ────────────────────────────────────────────

test("openaiText: 정상 응답 → text 추출", () => {
  const data = { choices: [{ message: { content: "hello" } }] };
  assert.equal(openaiText(data), "hello");
});

test("openaiText: 부재 → null", () => {
  assert.equal(openaiText({}), null);
  assert.equal(openaiText(null), null);
});

test("openaiJSON: 직접 JSON 파싱", () => {
  const data = { choices: [{ message: { content: '{"x": 1}' } }] };
  assert.deepEqual(openaiJSON(data), { x: 1 });
});

test("openaiJSON: ```json ... ``` 블록 추출", () => {
  const data = { choices: [{ message: { content: '여기 ```json\n{"x": 2}\n``` 끝' } }] };
  assert.deepEqual(openaiJSON(data), { x: 2 });
});

test("openaiJSON: { ... } 첫 객체 추출 fallback", () => {
  const data = { choices: [{ message: { content: '설명: {"x": 3} 입니다' } }] };
  assert.deepEqual(openaiJSON(data), { x: 3 });
});

test("openaiJSON: 파싱 불가 → null", () => {
  const data = { choices: [{ message: { content: 'no json here' } }] };
  assert.equal(openaiJSON(data), null);
});

// ─── callOpenAI / callGemini (env 부재 graceful) ────────────────────────

test("callOpenAI: env.OPENAI_API_KEY 부재 → ok:false", async () => {
  const r = await callOpenAI({}, { messages: [{ role: "user", content: "hi" }] });
  assert.equal(r.ok, false);
  assert.ok(r.error.includes("OPENAI_API_KEY"));
});

test("callGemini: env.GEMINI_API_KEY 부재 → ok:false", async () => {
  const r = await callGemini({}, {});
  assert.equal(r.ok, false);
  assert.ok(r.error.includes("GEMINI_API_KEY"));
});

// ─── 10 LLM endpoint baseline (stub 검증) ───────────────────────────────

test("handleAnalyze: API 키 부재 → 503 + warnings", async () => {
  const r = await handleAnalyze({ text: "x" }, {}, HEADERS, ALICE);
  assert.equal(r.status, 503);
  const body = await r.json();
  assert.ok(body.warnings);
});

test("handleAnalyze: API 키 박제 시 → 501 (baseline stub) + PROMPT_INJECTION_GUARD 적용 ✓ warning", async () => {
  const env = { OPENAI_API_KEY: "test-key" };
  const r = await handleAnalyze({ text: "x" }, env, HEADERS, ALICE);
  assert.equal(r.status, 501);
  const body = await r.json();
  assert.ok(body.warnings.some((w) => w.includes("PROMPT_INJECTION_GUARD")));
});

test("handleAnalyze: body 부재 → 400", async () => {
  const r = await handleAnalyze(null, {}, HEADERS, ALICE);
  assert.equal(r.status, 400);
});

// 10 LLM 모두 stub 동작 검증 (★ N4 — subtitle-format 포함)
const LLM_HANDLERS = [
  ["analyze", handleAnalyze],
  ["correct", handleCorrect],
  ["highlights", handleHighlights],
  ["term-explain", handleTermExplain],
  ["visuals", handleVisuals],
  ["insert-cuts", handleInsertCuts],
  ["hl-recommend", handleHlRecommend],
  ["hl-timestamps", handleHlTimestamps],
  ["setgen", handleSetgen],
  ["subtitle-format", handleSubtitleFormat],
];

for (const [name, handler] of LLM_HANDLERS) {
  test(`${name}: API 키 부재 → 503 + AI baseline stub 안내`, async () => {
    const r = await handler({ text: "x" }, {}, HEADERS, ALICE);
    assert.equal(r.status, 503);
    const body = await r.json();
    assert.ok(body.warnings.some((w) => w.includes("baseline stub")));
  });
}

// ★ N4 영역 핵심 검증
test("subtitle-format: ★ N4 — PROMPT_INJECTION_GUARD 적용 검증", async () => {
  const env = { OPENAI_API_KEY: "test-key" };
  const r = await handleSubtitleFormat({ text: "x" }, env, HEADERS, ALICE);
  // baseline stub — 501 응답이지만 PROMPT_INJECTION_GUARD 적용 영역 검증
  const body = await r.json();
  assert.ok(body.warnings.some((w) => w.includes("PROMPT_INJECTION_GUARD")));
});
