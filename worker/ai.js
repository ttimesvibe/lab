// lab fresh v2 — Worker AI handlers baseline (10 LLM endpoint)
// 사료: editor/ops/lab-v2-fresh-2026-05-09.md
//   - S2.4.2 1차 교정 + S2.4.4~5 11 탭 LLM
//   - S4c.5 PS11 prompt injection guard (★ N4 영역 — SUBTITLE_FORMAT_PROMPT_V3 포함)
//   - S2'.3 35+ endpoint 의 AI 10 LLM
//   - S5.1 A11.5 응답 표준
//
// 본 baseline (M1.4.d.3):
//   - 10 endpoint 라우팅 + 입력 검증 + PROMPT_INJECTION_GUARD prepend
//   - OpenAI / Gemini 호출 추상 (callOpenAI / callGemini)
//   - hallucination guard 추상 (validateLLMOutput)
//   - 실 prompt 본체 (ANALYZE_PROMPT / BASE_CORRECT_PROMPT 등) 는 별 마일스톤 (M2)

import {
  PROMPT_INJECTION_GUARD,
  logPrefix,
  jsonResponse,
  badRequest,
  serverError,
} from "./utils.js";

// ─── 상수 ────────────────────────────────────────────────────────────────

const OPENAI_BASE = "https://api.openai.com/v1";
const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta";

// 10 LLM endpoint 카탈로그 (사료 S2'.3, 매 endpoint 에 PROMPT_INJECTION_GUARD 의무)
export const LLM_ENDPOINTS = Object.freeze([
  "/analyze",          // 0차 분석 (term_corrections, speakers, genre)
  "/correct",          // 1차 교정 (필러+용어+맞춤법+구어체)
  "/highlights",       // 강조자막 2-Pass (Draft + Editor)
  "/term-explain",     // 용어 설명
  "/visuals",          // 자료·그래픽 추천
  "/insert-cuts",      // 인서트
  "/hl-recommend",     // 하이라이트 추천
  "/hl-timestamps",    // 하이라이트 타임스탬프
  "/setgen",           // 세트 생성
  "/subtitle-format",  // 자막 포맷팅 V2.2 (★ N4 — PROMPT_INJECTION_GUARD 의무)
]);

// ─── OpenAI / Gemini 호출 추상 ──────────────────────────────────────────

/**
 * Call OpenAI Chat Completions API.
 *
 * @param {object} env - { OPENAI_API_KEY }
 * @param {object} opts - { model, messages, response_format?, temperature? }
 * @returns {Promise<{ok, status, data?, error?}>}
 */
export async function callOpenAI(env, opts) {
  if (!env || !env.OPENAI_API_KEY) {
    return { ok: false, status: 0, error: "OPENAI_API_KEY not configured" };
  }
  if (!opts || !Array.isArray(opts.messages)) {
    return { ok: false, status: 400, error: "messages required" };
  }
  try {
    const r = await fetch(`${OPENAI_BASE}/chat/completions`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: opts.model || "gpt-4o-mini",
        messages: opts.messages,
        response_format: opts.response_format,
        temperature: typeof opts.temperature === "number" ? opts.temperature : 0,
        max_tokens: opts.max_tokens || 4096,
      }),
    });
    if (!r.ok) {
      let errText = `HTTP ${r.status}`;
      try { const e = await r.text(); errText += `: ${e.slice(0, 200)}`; } catch {}
      return { ok: false, status: r.status, error: errText };
    }
    const data = await r.json();
    return { ok: true, status: r.status, data };
  } catch (e) {
    return { ok: false, status: 0, error: e?.message || String(e) };
  }
}

/**
 * Extract text content from OpenAI response.
 */
export function openaiText(data) {
  if (!data || !data.choices || !data.choices[0]) return null;
  return data.choices[0].message?.content || null;
}

/**
 * Parse JSON content from OpenAI response (with fallback to extract JSON block).
 */
export function openaiJSON(data) {
  const text = openaiText(data);
  if (!text) return null;
  // 직접 JSON 시도
  try { return JSON.parse(text); } catch {}
  // ```json ... ``` 블록 추출
  const m = /```(?:json)?\s*([\s\S]+?)\s*```/.exec(text);
  if (m) {
    try { return JSON.parse(m[1]); } catch {}
  }
  // { ... } 첫 객체 추출
  const m2 = /\{[\s\S]+\}/.exec(text);
  if (m2) {
    try { return JSON.parse(m2[0]); } catch {}
  }
  return null;
}

/**
 * Call Gemini API (보조 — 일부 LLM endpoint).
 */
export async function callGemini(env, opts) {
  if (!env || !env.GEMINI_API_KEY) {
    return { ok: false, status: 0, error: "GEMINI_API_KEY not configured" };
  }
  const model = opts?.model || "gemini-1.5-flash";
  try {
    const r = await fetch(`${GEMINI_BASE}/models/${model}:generateContent?key=${env.GEMINI_API_KEY}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(opts?.body || {}),
    });
    if (!r.ok) {
      let errText = `HTTP ${r.status}`;
      try { errText += `: ${(await r.text()).slice(0, 200)}`; } catch {}
      return { ok: false, status: r.status, error: errText };
    }
    const data = await r.json();
    return { ok: true, status: r.status, data };
  } catch (e) {
    return { ok: false, status: 0, error: e?.message || String(e) };
  }
}

// ─── PROMPT_INJECTION_GUARD prepend ─────────────────────────────────────

/**
 * Build a system message with PROMPT_INJECTION_GUARD prepended.
 * ★ N4 영역: 모든 LLM endpoint (subtitle-format 포함) 적용 의무.
 */
export function buildSystemMessage(systemPrompt) {
  return {
    role: "system",
    content: PROMPT_INJECTION_GUARD + (systemPrompt || ""),
  };
}

// ─── Hallucination guard 추상 ───────────────────────────────────────────

/**
 * Validate LLM output for hallucination patterns.
 *
 * 사료 4/24 33ed891 (한글↔한글 음운 유사성):
 *   - term_corrections 의 (from, to) 모두 한글
 *   - 비음성학적 차이 (자모 거의 모두 다름) → 제거 (hallucination 차단)
 *
 * 향후 확장 (PS11):
 *   - 입력 텍스트에 없는 새 entity 감지
 *   - JSON schema mismatch 감지
 *
 * @returns {{filtered, removed: array<{item, reason}>}}
 */
export function validateLLMOutput(items, sourceText, options = {}) {
  if (!Array.isArray(items)) return { filtered: [], removed: [] };
  const removed = [];
  const filtered = [];

  for (const item of items) {
    let reason = null;

    // 1. 한글↔한글 음운 유사성 (term_corrections 의 from/to)
    if (item && typeof item.from === "string" && typeof item.to === "string") {
      if (isHangulOnly(item.from) && isHangulOnly(item.to)) {
        if (!areHangulPhoneticallySimilar(item.from, item.to)) {
          reason = "hangul phonetic mismatch (hallucination 추정)";
        }
      }
    }

    // 2. 입력 텍스트에 없는 entity 감지 (선택)
    if (!reason && options.checkSource && sourceText && item && typeof item.from === "string") {
      if (!sourceText.includes(item.from)) {
        reason = "from text not found in source (hallucination)";
      }
    }

    if (reason) removed.push({ item, reason });
    else filtered.push(item);
  }

  return { filtered, removed };
}

function isHangulOnly(s) {
  if (typeof s !== "string" || s.length === 0) return false;
  return /^[가-힯\s]+$/.test(s);
}

/**
 * Check if two Hangul strings share phonetic similarity (자모 첫 단위 비교).
 * 단순 휴리스틱 — 글자 수 같고 첫 글자 자모 일부 일치 시 true.
 */
function areHangulPhoneticallySimilar(a, b) {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  // 첫 음절 코드 비교 (단순)
  const ca = a.charCodeAt(0);
  const cb = b.charCodeAt(0);
  if (Math.abs(ca - cb) < 1000) return true;  // 같은 자모군 휴리스틱
  // 모음 유사성 (한글 음절 = 초성 19 × 중성 21 × 종성 28 = 11172)
  const baseA = ca - 0xAC00;
  const baseB = cb - 0xAC00;
  if (baseA < 0 || baseB < 0) return false;
  const initA = Math.floor(baseA / 588);
  const initB = Math.floor(baseB / 588);
  return initA === initB;  // 초성 같으면 유사로 간주
}

// ─── 10 LLM endpoint baseline (stub) ────────────────────────────────────

/**
 * 본 baseline 은 라우팅 + 입력 검증 + PROMPT_INJECTION_GUARD 의무 영역만 박제.
 * 실 prompt 본체 (ANALYZE_PROMPT 등) 는 M2 마일스톤에서 추가.
 *
 * 모든 핸들러:
 *   - body 검증
 *   - PROMPT_INJECTION_GUARD prepend
 *   - callOpenAI 호출 (OPENAI_API_KEY 부재 시 graceful 503)
 *   - hallucination guard (옵션)
 *   - 응답 표준 {success, data, warnings?}
 */

function makeStubHandler(name, defaultPrompt) {
  return async function handle(body, env, headers, user) {
    if (!body || typeof body !== "object") return badRequest(headers, "body 필수");
    if (!env?.OPENAI_API_KEY) {
      // Stub baseline: API 키 부재 시 503 + warnings (실 라이브 키 박제 후 동작)
      return jsonResponse(
        {
          success: false,
          error: "OPENAI_API_KEY not configured",
          warnings: ["AI baseline stub — 실 prompt 본체는 M2 마일스톤"],
          code: 503,
        },
        { status: 503 },
        headers
      );
    }

    // 향후 M2 에서: 본 endpoint 의 prompt 본체 + 실 호출 + validateLLMOutput
    // 현 baseline: PROMPT_INJECTION_GUARD 적용 검증만
    const systemMsg = buildSystemMessage(defaultPrompt);
    if (!systemMsg.content.includes(PROMPT_INJECTION_GUARD.trim())) {
      return serverError(headers, `${name}: PROMPT_INJECTION_GUARD 미적용`);
    }

    return jsonResponse(
      {
        success: false,
        error: `${name}: baseline stub — M2 마일스톤에서 본체 추가 예정`,
        warnings: ["PROMPT_INJECTION_GUARD 적용 ✓", "본체 미구현"],
        code: 501,
      },
      { status: 501 },
      headers
    );
  };
}

// 10 LLM endpoint baseline (default prompt 는 M2 에서 정밀)
export const handleAnalyze = makeStubHandler("/analyze", "0차 분석 (term_corrections, speakers, genre)");
export const handleCorrect = makeStubHandler("/correct", "1차 교정 (필러+용어+맞춤법+구어체)");
export const handleHighlights = makeStubHandler("/highlights", "강조자막 2-Pass (Draft + Editor)");
export const handleTermExplain = makeStubHandler("/term-explain", "용어 설명");
export const handleVisuals = makeStubHandler("/visuals", "자료·그래픽 추천");
export const handleInsertCuts = makeStubHandler("/insert-cuts", "인서트 추천");
export const handleHlRecommend = makeStubHandler("/hl-recommend", "하이라이트 추천");
export const handleHlTimestamps = makeStubHandler("/hl-timestamps", "하이라이트 타임스탬프");
export const handleSetgen = makeStubHandler("/setgen", "세트 생성");
export const handleSubtitleFormat = makeStubHandler("/subtitle-format", "자막 포맷팅 V2.2 (★ N4)");
