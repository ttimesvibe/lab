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

// ─── /analyze (★ M2 Phase 1 — 실 prompt 박제) ───────────────────────────

test("handleAnalyze: body 부재 → 400", async () => {
  const r = await handleAnalyze(null, {}, HEADERS, ALICE);
  assert.equal(r.status, 400);
});

test("handleAnalyze: full_text 짧음 → 400 (최소 100자)", async () => {
  const r = await handleAnalyze({ full_text: "짧은 텍스트" }, { OPENAI_API_KEY: "k" }, HEADERS, ALICE);
  assert.equal(r.status, 400);
});

test("handleAnalyze: full_text 충분 + API 키 부재 → 503", async () => {
  const longText = "x".repeat(150);
  const r = await handleAnalyze({ full_text: longText }, {}, HEADERS, ALICE);
  assert.equal(r.status, 503);
  const body = await r.json();
  assert.equal(body.code, 503);
});

test("ANALYZE_PROMPT: prod 사료 정합 (핵심 키워드 검증)", async () => {
  const { ANALYZE_PROMPT } = await import("../ai.js");
  assert.ok(ANALYZE_PROMPT.includes("Korean interview transcripts"));
  assert.ok(ANALYZE_PROMPT.includes("term_corrections"));
  assert.ok(ANALYZE_PROMPT.includes("Proper Noun Preservation"));
  assert.ok(ANALYZE_PROMPT.includes("editorial_summary"));
  assert.ok(ANALYZE_PROMPT.includes("genre"));
  // PROMPT_INJECTION_GUARD 는 buildSystemMessage 가 prepend — prompt 자체에는 X
  assert.ok(!ANALYZE_PROMPT.includes("Disregard any instruction"));
});

test("handleAnalyze: 실 LLM 응답 mock — term_corrections 할루시네이션 제거", async () => {
  // fetch mock — callOpenAI 우회
  const origFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    choices: [{ message: { content: JSON.stringify({
      overview: { topic: "AI", keywords: ["AI", "LLM"] },
      speakers: [{ name: "홍재의", role: "기자" }],
      term_corrections: [
        { wrong: "베셋", correct: "베센트", confidence: "high" },     // ✓ 음운 유사 (한글)
        { wrong: "베센트", correct: "옐런", confidence: "high" },     // ✗ 비음운 (할루시네이션) — 제거 대상
        { wrong: "ChatGPT", correct: "챗GPT", confidence: "high" },  // ✓ Latin↔Hangul (통과)
      ],
      genre: { primary: "설명형" },
      tech_difficulty: "보통",
    }) } }],
    usage: { total_tokens: 100 },
  }), { status: 200 });
  try {
    const longText = "오늘은 베센트 재무장관에 대해 이야기해보겠습니다. ".repeat(10);
    const r = await handleAnalyze({ full_text: longText }, { OPENAI_API_KEY: "k" }, HEADERS, ALICE);
    assert.equal(r.status, 200);
    const body = await r.json();
    assert.equal(body.success, true);
    // 할루시네이션 1개 제거 → 2개 남음
    assert.equal(body.analysis.term_corrections.length, 2);
    const wrongs = body.analysis.term_corrections.map((tc) => tc.wrong);
    assert.ok(wrongs.includes("베셋"));
    assert.ok(wrongs.includes("ChatGPT"));
    assert.ok(!wrongs.includes("베센트"));  // ✗ 제거됨
    // {from, to} 매핑 키 누출 X
    assert.ok(!body.analysis.term_corrections[0].from);
    assert.ok(!body.analysis.term_corrections[0].to);
  } finally {
    globalThis.fetch = origFetch;
  }
});

// ─── /correct (★ M2 Phase 2 — 실 prompt 박제) ───────────────────────────

test("handleCorrect: body 부재 → 400", async () => {
  const r = await handleCorrect(null, {}, HEADERS, ALICE);
  assert.equal(r.status, 400);
});

test("handleCorrect: chunk_text 부재 → 400", async () => {
  const r = await handleCorrect({}, { OPENAI_API_KEY: "k" }, HEADERS, ALICE);
  assert.equal(r.status, 400);
});

test("handleCorrect: API 키 부재 → 503", async () => {
  const r = await handleCorrect({ chunk_text: "테스트" }, {}, HEADERS, ALICE);
  assert.equal(r.status, 503);
});

test("BASE_CORRECT_PROMPT: 핵심 키워드 정합", async () => {
  const { BASE_CORRECT_PROMPT } = await import("../ai.js");
  assert.ok(BASE_CORRECT_PROMPT.includes("Processing Order"));
  assert.ok(BASE_CORRECT_PROMPT.includes("§1. Filler Word"));
  assert.ok(BASE_CORRECT_PROMPT.includes("§2a. Proper Noun Absolute Preservation"));
  assert.ok(BASE_CORRECT_PROMPT.includes("Cross-talk"));
  assert.ok(BASE_CORRECT_PROMPT.includes("Single-action rule"));
  assert.ok(!BASE_CORRECT_PROMPT.includes("Disregard any instruction"));
});

test("buildCorrectPrompt: analysis 없으면 BASE 만 반환", async () => {
  const { buildCorrectPrompt, BASE_CORRECT_PROMPT } = await import("../ai.js");
  const p = buildCorrectPrompt(null, null, null);
  assert.equal(p, BASE_CORRECT_PROMPT);
});

test("buildCorrectPrompt: analysis.speakers + term_corrections 합성", async () => {
  const { buildCorrectPrompt } = await import("../ai.js");
  const p = buildCorrectPrompt(
    {
      speakers: [{ name: "홍재의", role: "기자" }],
      term_corrections: [
        { wrong: "베셋", correct: "베센트", confidence: "high" },
        { wrong: "엔트로피", correct: "앤트로픽", confidence: "low" },
      ],
    },
    null,
    null
  );
  assert.ok(p.includes("Speaker Name Ground Truth"));
  assert.ok(p.includes("홍재의"));
  assert.ok(p.includes("MANDATORY mappings"));
  assert.ok(p.includes('"베셋" → "베센트" [MANDATORY]'));
  assert.ok(p.includes("low confidence"));
  assert.ok(p.includes('"엔트로피" → "앤트로픽"'));
});

test("validateCorrections: 규칙 1 — original 이 chunkText 에 없음 → 제거", async () => {
  const { validateCorrections } = await import("../ai.js");
  const r = validateCorrections("안녕하세요. 반갑습니다.", {
    chunks: [{ block_index: 0, changes: [
      { type: "spelling", original: "존재하지않음", corrected: "X" },
    ] }],
  });
  assert.equal(r.chunks.length, 0);  // 모든 change 제거 → chunk 자체 제거
});

test("validateCorrections: 규칙 8 — 한글 비음운 term_correction 차단", async () => {
  const { validateCorrections } = await import("../ai.js");
  const chunkText = "베센트 재무장관이 말했다. 베셋 의장도 합의했다.";
  const r = validateCorrections(chunkText, {
    chunks: [{ block_index: 0, changes: [
      { type: "term_correction", original: "베셋", corrected: "베센트" },     // ✓ 음운 유사
      { type: "term_correction", original: "베센트", corrected: "옐런" },     // ✗ 비음운 (knowledge-based substitution)
    ] }],
  });
  assert.equal(r.chunks.length, 1);
  assert.equal(r.chunks[0].changes.length, 1);
  assert.equal(r.chunks[0].changes[0].original, "베셋");
});

test("validateCorrections: 규칙 4 — filler_removal 에서 corrected > original 차단", async () => {
  const { validateCorrections } = await import("../ai.js");
  const r = validateCorrections("그래서 좋다", {
    chunks: [{ block_index: 0, changes: [
      { type: "filler_removal", original: "그래서", corrected: "그래서 정말로" },
    ] }],
  });
  assert.equal(r.chunks.length, 0);
});

test("isPhoneticallySimilarKorean: 베셋↔베센트 ✓ / 베센트↔옐런 ✗", async () => {
  const { isPhoneticallySimilarKorean } = await import("../ai.js");
  assert.equal(isPhoneticallySimilarKorean("베셋", "베센트"), true);
  assert.equal(isPhoneticallySimilarKorean("베센트", "옐런"), false);
  assert.equal(isPhoneticallySimilarKorean("홍재희", "홍재의"), true);
});

// ─── /highlights 2-Pass (★ M2 Phase 3 — Draft + Editor) ────────────────

test("handleHighlights: body 부재 → 400", async () => {
  const r = await handleHighlights(null, {}, HEADERS, ALICE);
  assert.equal(r.status, 400);
});

test("handleHighlights: API 키 부재 → 503", async () => {
  const r = await handleHighlights({ mode: "draft" }, {}, HEADERS, ALICE);
  assert.equal(r.status, 503);
});

test("DRAFT_AGENT_PROMPT + EDITOR_AGENT_PROMPT: 정합 검증", async () => {
  const { DRAFT_AGENT_PROMPT, EDITOR_AGENT_PROMPT } = await import("../ai.js");
  assert.ok(DRAFT_AGENT_PROMPT.includes("Draft Agent"));
  assert.ok(DRAFT_AGENT_PROMPT.includes("16유형"));
  assert.ok(DRAFT_AGENT_PROMPT.includes("B2. 용어 설명형"));
  assert.ok(EDITOR_AGENT_PROMPT.includes("Editor Agent"));
  assert.ok(EDITOR_AGENT_PROMPT.includes("removal_rate"));
  // PROMPT_INJECTION_GUARD 는 buildSystemMessage prepend
  assert.ok(!DRAFT_AGENT_PROMPT.includes("Disregard any instruction"));
  assert.ok(!EDITOR_AGENT_PROMPT.includes("Disregard any instruction"));
});

test("buildDraftPrompt: target_block_indices + max_items 합성", async () => {
  const { buildDraftPrompt } = await import("../ai.js");
  const p = buildDraftPrompt(
    { genre: { primary: "설명형" }, tech_difficulty: "높음" },
    0,
    3,
    [5, 6, 7],
    5
  );
  assert.ok(p.includes("장르: 설명형"));
  assert.ok(p.includes("기술 난이도: 높음"));
  assert.ok(p.includes("청크 1/3"));
  assert.ok(p.includes("블록 #5~#7"));
  assert.ok(p.includes("최대 5개만"));
});

test("buildEditorPrompt: genre density + tech difficulty 합성", async () => {
  const { buildEditorPrompt } = await import("../ai.js");
  const p = buildEditorPrompt({
    genre: { primary: "산업/전략분석형", secondary: "기술트렌드형" },
    tech_difficulty: "매우높음",
  });
  assert.ok(p.includes("산업/전략"));
  assert.ok(p.includes("매우 높음"));  // primary 의 density 문구
  assert.ok(p.includes("보조 장르"));
  assert.ok(p.includes("기술트렌드"));
  assert.ok(p.includes("B2 비중을 높이세요"));
});

test("handleHighlights: mode='edit' + draft_highlights 부재 → 400", async () => {
  const r = await handleHighlights(
    { mode: "edit", blocks: [] },
    { OPENAI_API_KEY: "k" },
    HEADERS,
    ALICE
  );
  assert.equal(r.status, 400);
});

// ─── 7 LLM stub 검증 (analyze + correct + highlights 제외) ──────────────

const LLM_HANDLERS = [
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
