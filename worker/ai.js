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
    // ★ 모델별 token 파라미터 분기 (사용자 보고 fix):
    //   gpt-5* / o1* / o3* (reasoning 계열) → max_completion_tokens
    //   gpt-4* / gpt-3.5* → max_tokens
    const model = opts.model || "gpt-4o-mini";
    const useCompletionTokens = /^(gpt-5|o1|o3)/i.test(model);
    const tokenLimit = opts.max_tokens || 4096;
    const body = {
      model,
      messages: opts.messages,
      response_format: opts.response_format,
      temperature: typeof opts.temperature === "number" ? opts.temperature : 0,
    };
    if (useCompletionTokens) body.max_completion_tokens = tokenLimit;
    else body.max_tokens = tokenLimit;

    const r = await fetch(`${OPENAI_BASE}/chat/completions`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
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
 * (validateLLMOutput 의 가벼운 첫-pass — 정밀 검증은 isPhoneticallySimilarKorean 사용)
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

// ─── Hangul cho/jung/jong 분해 + 정밀 음운 유사성 (★ /correct Step 1-V) ──
// 사료: editor/worker/index.js:2393-2426 (prod isPhoneticallySimilar)

/**
 * Decompose a Hangul string into per-syllable {cho, jung, jong, raw}.
 */
export function hangulSyllables(s) {
  const arr = [];
  for (const ch of s) {
    const code = ch.charCodeAt(0);
    if (code >= 0xAC00 && code <= 0xD7A3) {
      const idx = code - 0xAC00;
      arr.push({ cho: Math.floor(idx / 588), jung: Math.floor((idx % 588) / 28), jong: idx % 28, raw: ch });
    } else {
      arr.push({ raw: ch });
    }
  }
  return arr;
}

/**
 * Korean phonetic similarity — chosung + jungsung 비교 기반.
 *   match 2.0: 완전 일치
 *   match 1.5: 초성 + 중성 일치 (받침 다름)
 *   match 0.5: 초성만 일치
 *   match 0.3: 중성만 일치
 * 평균 ≥ 1.0 이면 유사.
 */
export function isPhoneticallySimilarKorean(a, b) {
  if (!a || !b) return false;
  const sa = hangulSyllables(a), sb = hangulSyllables(b);
  if (Math.abs(sa.length - sb.length) > 1) return false;
  const len = Math.min(sa.length, sb.length);
  if (len === 0) return false;
  let matchScore = 0;
  for (let i = 0; i < len; i++) {
    const x = sa[i], y = sb[i];
    if (x.raw === y.raw) { matchScore += 2; continue; }
    if (x.cho !== undefined && y.cho !== undefined) {
      if (x.cho === y.cho && x.jung === y.jung) matchScore += 1.5;
      else if (x.cho === y.cho) matchScore += 0.5;
      else if (x.jung === y.jung) matchScore += 0.3;
    }
  }
  return matchScore / len >= 1.0;
}

function hangulRatio(s) {
  if (typeof s !== "string" || s.length === 0) return 0;
  const h = [...s].filter((c) => c.charCodeAt(0) >= 0xAC00 && c.charCodeAt(0) <= 0xD7A3).length;
  return h / s.length;
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

// ─── ANALYZE_PROMPT (★ M2 Phase 1 — 실 prompt 박제) ─────────────────────
// 사료: editor/worker/index.js:1964-2046 (prod ANALYZE_PROMPT)
// 변경점:
//   - PROMPT_INJECTION_GUARD interpolation 제거 → buildSystemMessage 가 prepend
//     (★ N4: 모든 LLM endpoint 동일 처리 의무)

export const ANALYZE_PROMPT = `You are a pre-analysis specialist for Korean interview transcripts produced by STT (Speech-to-Text).
Read the entire interview transcript below and extract the preliminary information needed for subsequent chunk-by-chunk correction.

## Information to Extract

### 1. Interview Overview
- Topic (1 line, in Korean)
- Core keywords (5–15, in Korean)

### 1-1. Editorial Summary
Provide a quick-reference summary so the editor can grasp the interview content during correction wait time.
- **One-liner**: What this interview is about, 1–2 sentences (~30 Korean chars)
- **Key points** (3–5): Major topics/arguments covered, in short sentences, listed in chronological order of the interview flow. Write in Korean.
- **Notable quotes** (2–3): Memorable verbatim quotes that could become subtitle highlights. Include the speaker name. Write in Korean.
- **Editor notes**: Technical-term-dense segments, controversial/sensitive remarks, unusual structure (demos, screen switches, etc.). 1–3 lines. Write in Korean.

### 2. Speaker Information (★ Highest Priority)
- Speaker-name lines (e.g., "홍재의 00:00", "강정수 박사님 00:25") are **manually typed by humans** and serve as the ground truth for correct names.
- Extract the name and title/affiliation separately from each speaker-name line.
  Example: "강정수 박사님 00:25" → name: "강정수", role: "박사님"
  Example: "홍재의 00:00" → name: "홍재의", role: "기자" (infer role from body text)
- Confirm the spelling from speaker-name lines as canonical. Any different spelling found in the body text is an STT misrecognition — add it to term_corrections.
  Example: Speaker line says "홍재의" but body contains "홍재희", "홍재이" → { "wrong": "홍재희", "correct": "홍재의", "confidence": "high" }

### 3. STT Misrecognition Dictionary
- Find repeatedly occurring suspected misrecognized words and build a correction mapping table.
- Include all variant forms of the same word.
- Use confidence: "low" when uncertain.
- Focus on proper nouns, IT/AI technical terms, and brand names.
- **Speaker-name misrecognitions must be included.** Use the canonical names from Section 2 and map all body-text variants.

**★ ABSOLUTE RULE — Proper Noun Preservation (overrides everything else in Section 3):**
A term_corrections entry for a person name, title holder, organization, or place is
allowed ONLY when the "correct" form is **phonetically similar** to the "wrong" form
(same syllable count ±1, majority of syllables share initial consonant or vowel).

**FORBIDDEN — do NOT add these to term_corrections under any circumstance:**
- Substituting a different person for the one the speaker mentioned
  (e.g., "베센트 재무장관" → "옐런 재무장관" ❌ — different person, not phonetic)
- "Correcting" a title/role assignment based on your world knowledge of current holders
- Replacing any name with what you believe is the "currently correct" holder of that role
- Any term_corrections where wrong and corrected share <50% of syllables by initial/vowel

Your training data has a knowledge cutoff. The speaker has current information you do not.
If the speaker says person X holds role Y, preserve X exactly — **even if you believe X no
longer holds Y**. This applies to: cabinet members, CEOs, political leaders, athletes,
and any role where the current holder may have changed after your training cutoff.

Allowed example: "베셋" → "베센트" ✅ (phonetic STT fix, same person)
Forbidden example: "베센트" → "옐런" ❌ (different person, knowledge-based substitution)

### 4. Domain Terminology List
- Confirm correct Korean spelling with English in parentheses.

### 5. Content Genre Classification
Choose 1–2 from 7 types: 서사형, 설명형, 데모/도구활용형, 비교형, 산업/전략분석형, 역사+인물형, 기술트렌드형
Include per-segment genre transition detection.

### 6. Technical Difficulty
One of: 낮음 / 보통 / 높음 / 매우높음

## Output Format (JSON only — no other text)

{
  "overview": { "topic": "...", "keywords": ["..."] },
  "editorial_summary": {
    "one_liner": "이 인터뷰의 한 줄 요약",
    "key_points": ["핵심 논점 1", "핵심 논점 2", "핵심 논점 3"],
    "notable_quotes": [
      { "speaker": "화자명", "quote": "인상적인 발언 원문" }
    ],
    "editor_notes": "편집 시 참고사항"
  },
  "speakers": [{ "name": "화자명", "role": "역할" }],
  "term_corrections": [{ "wrong": "오인식", "correct": "올바른 표기", "confidence": "high" }],
  "domain_terms": [{ "term": "전문용어", "english": "English" }],
  "genre": {
    "primary": "설명형", "secondary": null,
    "transitions": [{ "block_range": [0, 25], "genre": "설명형" }]
  },
  "tech_difficulty": "높음",
  "audience_level": "관심 있는 비전문가"
}`;

/**
 * /analyze handler — 0차 분석 (term_corrections, speakers, genre, editorial_summary)
 *
 * 사료: editor/worker/index.js:2048-2096 (prod handleAnalyze)
 *
 * @param body  { full_text: string (>=100), dictionary_words?: string[] }
 * @returns { success: true, analysis, usage } | error
 */
export async function handleAnalyze(body, env, headers, user) {
  if (!body || typeof body !== "object") return badRequest(headers, "body 필수");

  const { full_text, dictionary_words } = body;
  if (typeof full_text !== "string" || full_text.length < 100) {
    return badRequest(headers, "full_text가 너무 짧습니다 (최소 100자)");
  }

  if (!env?.OPENAI_API_KEY) {
    return jsonResponse(
      { success: false, error: "OPENAI_API_KEY not configured", code: 503 },
      { status: 503 },
      headers
    );
  }

  // 단어장 prepend — AI 가 중복 후보 생성하지 않도록 (사료 prod 2055-2066)
  let systemPrompt = ANALYZE_PROMPT;
  if (Array.isArray(dictionary_words) && dictionary_words.length > 0) {
    systemPrompt += `\n\n### ★ Team Dictionary (Confirmed Correct Spellings) — MUST EXCLUDE from term_corrections ★\n`;
    systemPrompt += `The words below have already been confirmed as correct by the team.\n`;
    systemPrompt += `Do NOT include these words or their case/transliteration variants in term_corrections.\n`;
    systemPrompt += `Example: If "챗GPT" is in the dictionary, exclude "ChatGPT", "챗gpt", "챗지피티" from misrecognition candidates.\n`;
    systemPrompt += `However, phonetically unrelated STT errors (e.g., "채우지" → "챗GPT") MAY still be included.\n\n`;
    systemPrompt += `Confirmed words:\n`;
    for (const word of dictionary_words) {
      systemPrompt += `- "${word}"\n`;
    }
  }

  const userMsg = `Below is the full interview transcript. Perform the pre-analysis.\n\n---\n\n${full_text}`;

  const result = await callOpenAI(env, {
    model: "gpt-4o-mini",
    messages: [
      buildSystemMessage(systemPrompt),  // ★ N4: PROMPT_INJECTION_GUARD 자동 prepend
      { role: "user", content: userMsg },
    ],
    temperature: 0.1,
    max_tokens: 8000,
    response_format: { type: "json_object" },
  });

  if (!result.ok) {
    console.error(logPrefix("/analyze"), "callOpenAI failed:", result.error);
    return jsonResponse(
      { success: false, error: result.error || "LLM call failed" },
      { status: result.status >= 400 ? result.status : 502 },
      headers
    );
  }

  const analysis = openaiJSON(result.data);
  if (!analysis || typeof analysis !== "object") {
    return serverError(headers, "/analyze: JSON parse failed");
  }

  // Guardrail: term_corrections 한글↔한글 비음운 제거 (사료 prod 2076-2093)
  //   - validateLLMOutput 는 {from, to} 스키마 → analyze 의 {wrong, correct} 매핑 후 검증
  if (Array.isArray(analysis.term_corrections) && analysis.term_corrections.length > 0) {
    const before = analysis.term_corrections.length;
    const mapped = analysis.term_corrections.map((tc) => ({
      ...tc,
      from: tc?.wrong || "",
      to: tc?.correct || "",
    }));
    const { filtered } = validateLLMOutput(mapped, full_text);
    analysis.term_corrections = filtered.map(({ from, to, ...rest }) => rest);
    const removed = before - analysis.term_corrections.length;
    if (removed > 0) {
      console.log(logPrefix("/analyze"), `term_corrections ${removed}개 제거 (할루시네이션 차단)`);
    }
  }

  return jsonResponse(
    { success: true, analysis, usage: result.data?.usage },
    { status: 200 },
    headers
  );
}

// 10 LLM endpoint baseline (default prompt 는 M2 에서 정밀)
// ★ handleAnalyze 는 위에 실 구현 — stub 제거
// ─── BASE_CORRECT_PROMPT (★ M2 Phase 2 — 실 prompt 박제) ────────────────
// 사료: editor/worker/index.js:2102-2329 (prod BASE_CORRECT_PROMPT)
// 변경점: PROMPT_INJECTION_GUARD interpolation 제거 → buildSystemMessage prepend (N4)

export const BASE_CORRECT_PROMPT = `You are a professional editor specializing in correcting Korean interview transcripts produced by STT (Speech-to-Text).
You follow the Korean National Institute of Korean Language (국립국어원) standard spelling and spacing rules.
You correct word-level errors while preserving the original conversation's content, tone, and nuance as much as possible.
Preserve the original form of technical terms and proper nouns — only fix typos.

## ★ Processing Order (follow this exact sequence)
For each block, evaluate corrections in this order:
1. STT misrecognition (§2) — fix wrong words first
2. Number notation (§3) — fix numbers
3. Spelling & spacing (§5) — fix orthography
4. Colloquial polishing (§6) — polish spoken language
5. Filler removal (§1) — remove fillers LAST, on the corrected sentence

Why this order matters: by the time you evaluate fillers, the sentence is already properly corrected.
Example: "근데 이걸 해가지고" → first §6 converts "해가지고"→"해서" and "근데"→"그런데",
then §1 checks if "그런데" is filler or meaningful connector. Since "그런데" is not in the filler list → keep it.
Result: "그런데 이걸 해서" ✅

## Scope of Work

### §1. Filler Word & Interjection Removal (processed LAST)
You MUST find and remove unnecessary interjections and habitual filler words embedded within sentences.

**Interjection removal targets:** "자", "음", "어", "아니", "이제", "인제", "또", "좀", "뭐", "그냥", "약간", "진짜", "되게", "막", "이렇게", "저렇게", "사실"

**Short-response removal targets:** "네", "그렇죠", "맞아요", "아니요" etc. when used as standalone back-channel responses.
- Exception: Keep "네"/"아니요" when it is a substantive answer to a question.
- NEVER delete standalone reaction utterances (where a speaker's entire turn is just a back-channel response).

**Additional patterns to find:**
- Speaker-specific verbal habits: Any meaningless word/phrase a specific speaker uses repeatedly, even if not in the list above.
  Examples: "뭐라 그러냐", "어떻게 보면", "이런 거", "그니까"
- Compound fillers: Multiple filler words in sequence — remove the entire compound.
  Example: "그러니까 이제 뭐" → remove all. "사실 좀 그냥" → remove all.
- Repetition: Same word or similar expression repeated unnecessarily.
  Example: "그래서 그래서", "이게 이게"

**Core criterion for filler detection:**
- If removing the word/phrase leaves the sentence meaning unchanged → filler → remove.
- If the word carries temporal, logical, or contrastive meaning → keep.
- Example: "이제는 많이 바뀌었죠" → keep "이제" (temporal transition)
- Example: "이제 그러니까 이제 이걸 보면" → remove both "이제" + "그러니까"

**If you found zero fillers, double-check.** In spoken-style interview transcripts, finding zero fillers is highly likely a miss.

**Cross-talk "네" removal (★ Important):**
When STT captures overlapping audio from two speakers, it often inserts Speaker B's back-channel "네" into the middle of Speaker A's sentence. These must be detected and removed.

Detection pattern: "네" appearing right after a clause boundary (~한데, ~니까, ~고, ~서, ~지만, ~거든요, ~잖아요, etc.) where the sentence clearly continues as the same speaker's thought.

Examples:
- "회자가 되고 있긴 한데 네 실제 그렇게" → remove "네" → "회자가 되고 있긴 한데 실제 그렇게"
- "많이 생기는 거니까 네 그래서" → remove "네" → "많이 생기는 거니까 그래서"
- "하고 있었는데 네 그래서 저희가" → remove "네" → "하고 있었는데 그래서 저희가"

How to distinguish from a real answer:
- Cross-talk "네": Appears mid-sentence, the sentence flows naturally without it, same speaker continues.
- Real answer "네": Speaker B's turn starts with "네" as a standalone response or "네, [new sentence]".

### §2. STT Misrecognition Correction
- Words mapped in the terminology dictionary below → MUST be corrected. This is mandatory, not optional.
- Speaker name misrecognitions must also be corrected.
- Words not in the dictionary → use context judgment. If uncertain, keep the original.

### §2a. Proper Noun Absolute Preservation (★ HIGHEST PRIORITY, overrides §2)

For ALL proper nouns (person names, titles, organizations, places, product names),
the ONLY acceptable reasons to change them are:
  (1) Exact match in the provided terminology dictionary (§2 mandatory mapping), OR
  (2) Phonetic STT misrecognition where the corrected form is phonetically similar
      to the original (e.g., "홍재희"→"홍재의": same syllable count, near-homophone).

**ABSOLUTELY FORBIDDEN:**
- Changing a name based on your world knowledge of "who currently holds this position."
- Replacing a mentioned person with a different person you believe is more likely.
- "Correcting" a title/role assignment based on what you know about current events.
- Substituting any person name that is NOT phonetically close to the original AND NOT in the dictionary.

Your training data has a knowledge cutoff. The speaker in the interview has current
information that you do not. If the speaker says person X holds role Y, you MUST
preserve X exactly as written, **even if you believe X no longer holds Y**.
This applies to: cabinet members, CEOs, political leaders, sports figures, and any
other role where the current holder may have changed after your training cutoff.

**Test before emitting any person-name change:**
  - Is the change in the dictionary? → OK
  - Are original and corrected phonetically similar (same syllable count ±1,
    majority of syllables share initial consonant/vowel)? → OK
  - Otherwise → DO NOT emit the change. Leave the original intact.

Example (FORBIDDEN — world-knowledge substitution):
  original: "미국 재무장관 베센트" → corrected: "미국 재무장관 옐런"  ❌
  (different person, not phonetic, not in dictionary → MUST NOT change)

Example (ALLOWED — phonetic STT fix):
  original: "미국 재무장관 베셋" → corrected: "미국 재무장관 베센트"  ✅
  (same person, phonetically similar, STT word-boundary error)

### §3. Number & Quantity Notation Rules (★ Highest Priority)
Accurately interpret numbers spoken in Korean and convert to Arabic numerals.

**Korean number words → Arabic numerals:**
- "천억" → "1000억", "사천만 명" → "4000만 명"
- Keep large units (억, 만) but convert the preceding number: "삼백억" → "300억"

**Range expressions — determine digit scale from context:**
- "이삼십 명" / "2~30명" → contextually "20~30명" (same-digit-scale range)
- "한 명에서 이십 명" → "1~20명" (different-digit-scale range)
- "일이십 년" → "10~20년"
- "삼사만 원" / "3~4만원" → "3만~4만 원" (repeat the unit)

**Note:** STT may convert "이삼십" to "2~30" but the actual meaning is often "20~30". Use context to judge.

### §4. User-Specified Notation Rules (★ Highest Priority)
These rules override the terminology dictionary:
- "챗gpt", "챗지피티" → "챗GPT"
- "에이전트 AI" → "AI 에이전트"
- "AI 에이전틱" → "에이전틱 AI"
- "아웃소싱" → "외주"

**Well-known foreign companies → Korean form (한글 표기 우선):**
For globally known companies whose Korean phonetic spelling is widely established,
always use the Korean form (한글 표기), not the English form.
- "NVIDIA" / "엔비디아" → "엔비디아"
- "Apple" / "애플" → "애플"
- "Amazon" / "아마존" → "아마존"
- "Google" / "구글" → "구글"
- "Microsoft" / "마이크로소프트" → "마이크로소프트"
- "Meta" / "메타" → "메타"
- "Tesla" / "테슬라" → "테슬라"
- "Samsung" / "삼성" → "삼성"
- "OpenAI" / "오픈AI" → "오픈AI"
- "Anthropic" / "앤트로픽" → "앤트로픽"

Never convert these Korean forms back to English (e.g., "엔비디아" → "NVIDIA" is WRONG).
Only the English → Korean direction is valid.

### §5. Spelling & Spacing
Fix remaining spelling, spacing, and punctuation errors.

**5-1. Spacing (highest frequency):**
- Dependent nouns: "할 수있다" → "할 수 있다"
- Negation spacing: "안되" → "안 되", "못하" → "못 하"

**5-2. Orthography:**
- Common targets: 됬→됐, 웬지→왠지, 몇일→며칠, 어떻게/어떡해, 안돼/안되, 데/대, 로서/로써, 되/돼

**5-3. Particle correction:**
- Fix incorrect particles based on preceding syllable's final consonant: 을/를, 이/가, 은/는, 과/와, 으로/로

**5-4. Punctuation:**
- Fix missing periods, misplaced commas.

### §6. Colloquial Expression Polishing
This transcript is for broadcast subtitles. Polish overly casual spoken language while preserving the speaker's natural tone.

**§6-1. Mandatory mappings (always apply):**
- "근데" → "그런데"
- "이거를" / "이거" → "이것을" / "이것"
- "그거를" / "그거" → "그것을" / "그것"
- "~하는 거는" → "~하는 것은"
- "~하는 거고" → "~하는 것이고"
- "~하는 거를" → "~하는 것을"
- "~하는 거가" → "~하는 것이"
- "~하면은" → "~하면"
- "~인데요은" → "~인데요"
- "~잖아" → "~잖아요" (casual → polite, interview context)
- "그래가지고" → "그래서"
- "되가지고" → "돼서"
- "해가지고" → "해서"

**§6-2. Active detection (★ proactively find and fix):**
- Spoken connectives → written forms: "해 갖고" → "해서", "그래갖고" → "그래서"
- Informal endings in polite-speech context: "~거든" → "~거든요", "~잖아" → "~잖아요"
- Redundant particles: "~하면을" → "~하면", "~에다가" → "~에"
- Unnecessary repetition: "진짜 진짜 좋은" → "정말 좋은"
- Verb ending cleanup: "하는거에요" → "하는 거예요", "하는거죠" → "하는 거죠"

**§6-3. Preserve these (do NOT correct):**
- "~거든요", "~잖아요", "~인 거죠", "~인 거예요" — speaker's conversational style
- "~인 건데", "~한 건데" — natural contractions
- "뭔가" — acceptable in spoken interview context (do NOT change to "무언가")
- "어쨌든" — standard form, no correction needed
- "갖다", "갖고" — standard Korean (do NOT change to "가져다", "가지고")

**§6-4. Single-action rule:**
Each word gets ONE action only. If a word could be both removed (§1 filler) and converted (§6 colloquial), apply §6 conversion only (since §6 runs before §1). NEVER report both a filler_removal and a spelling change for the same word.

## Output Rules
Report only changes as JSON. Omit blocks with no changes.
The "original" field must be an **exact copy** from the source text.

{
  "chunks": [{
    "block_index": 3,
    "changes": [{
      "type": "filler_removal",
      "original": "요새 이제 오늘 이제 주제로 삼을",
      "corrected": "요새 오늘 주제로 삼을",
      "removed_fillers": ["이제", "이제"]
    }, {
      "type": "term_correction",
      "original": "엔트로피 클로드",
      "corrected": "앤트로픽 클로드",
      "reason": "Anthropic의 한국어 표기"
    }, {
      "type": "spelling",
      "subtype": "colloquial",
      "original": "해가지고",
      "corrected": "해서",
      "reason": "spoken connective → written form"
    }]
  }]
}

## Absolute Rules
1. NEVER modify document structure (speaker names, timestamps, paragraphs).
2. NEVER delete standalone reaction utterances (a speaker's entire turn being just a back-channel).
3. NEVER misidentify meaningful words as fillers.
4. NEVER make uncertain corrections.
5. NEVER rearrange or summarize sentences.
6. NEVER insert words that do not exist in the original.
7. Process ALL blocks without skipping any.
8. Output JSON ONLY — no other text.
9. **Terminology dictionary mappings are MANDATORY. Do not ignore them.**
10. **Number notation rules and user-specified notation rules take HIGHEST priority.**
11. **Each word gets ONE action only: either remove OR convert, never both.**
12. **NEVER change a proper noun based on your world knowledge. Only dictionary matches or phonetic STT fixes are allowed (§2a). When in doubt about any person/organization/title, preserve the original exactly.**`;

/**
 * Compose /correct system prompt with analysis + user-specified rules.
 * 사료: editor/worker/index.js:2331-2387 (prod buildCorrectPrompt)
 */
export function buildCorrectPrompt(analysis, customFillers, customTerms) {
  let prompt = BASE_CORRECT_PROMPT;

  if (analysis) {
    prompt += `\n\n## Pre-Analysis Results\n`;
    if (analysis.overview?.topic) prompt += `\n### Interview Topic\n${analysis.overview.topic}\n`;

    if (analysis.speakers?.length > 0) {
      prompt += `\n### Speaker Name Ground Truth (confirmed from speaker-name lines)\n`;
      prompt += `The names below are the confirmed correct speaker names for this interview. Any different spelling found in the body text is an STT misrecognition — correct it.\n`;
      for (const sp of analysis.speakers) {
        prompt += `- "${sp.name}"${sp.role ? ` (${sp.role})` : ""}\n`;
      }
    }

    if (analysis.term_corrections?.length > 0) {
      prompt += `\n### ★★★ STT Misrecognition Dictionary — MANDATORY mappings below ★★★\n`;
      prompt += `If any "wrong" word below appears in the text, you MUST replace it with the "correct" form.\n\n`;
      for (const tc of analysis.term_corrections) {
        if (tc.confidence !== "low") prompt += `- "${tc.wrong}" → "${tc.correct}" [MANDATORY]\n`;
      }
      const lowConf = analysis.term_corrections.filter((tc) => tc.confidence === "low");
      if (lowConf.length > 0) {
        prompt += `\n### Reference (low confidence — use context judgment)\n`;
        for (const tc of lowConf) prompt += `- "${tc.wrong}" → "${tc.correct}"\n`;
      }
    }

    if (analysis.domain_terms?.length > 0) {
      prompt += `\n### Domain Terminology\n`;
      for (const dt of analysis.domain_terms) prompt += `- ${dt.term} (${dt.english})\n`;
    }

    if (analysis.dictionary_words?.length > 0) {
      prompt += `\n### ★★★ Team Dictionary (Correct Spelling List) — Phonetic & Contextual Auto-Correction ★★★\n`;
      prompt += `Below is the list of confirmed correct spellings. Find misrecognized words in the text via two paths:\n`;
      prompt += `1. **Phonetic misrecognition** — STT converted to similar-sounding but wrong characters (e.g., "오픈에이" → "오픈AI")\n`;
      prompt += `2. **Contextual misrecognition** — STT substituted a known word that doesn't fit (e.g., "엔트로피" → "앤트로픽")\n\n`;
      prompt += `Correct spelling list:\n`;
      for (const word of analysis.dictionary_words) {
        prompt += `- "${word}"\n`;
      }
      prompt += `\nFind and correct any word that is phonetically similar to or contextually a misrecognition of the above terms.\n`;
    }
  }

  if (customFillers?.length > 0) {
    prompt += `\n### Additional Filler Words (user-specified)\n` + customFillers.map((f) => `- "${f}"`).join("\n") + "\n";
  }
  if (customTerms && Object.keys(customTerms).length > 0) {
    prompt += `\n### Additional Term Mappings (user-specified)\n`;
    for (const [correct, wrongs] of Object.entries(customTerms)) {
      prompt += `- ${wrongs.map((w) => `"${w}"`).join(", ")} → "${correct}"\n`;
    }
  }

  return prompt;
}

/**
 * Step 1-V — /correct LLM 응답 검증 (8 rule 휴리스틱).
 *
 * 사료: editor/worker/index.js:2428-2519 (prod validateCorrections)
 *
 * 규칙 1: original 이 chunkText 에 존재해야 함
 * 규칙 2: original === corrected (무의미)
 * 규칙 3: 30% 미만 축약 (과도)
 * 규칙 4: filler_removal 에서 corrected > original (환각 삽입)
 * 규칙 5: 새 단어 3개 이상 (term_correction 제외)
 * 규칙 6: removed_fillers 가 original 안에 있어야 함
 * 규칙 7: 중복 change → 마지막 것만 유지
 * 규칙 8: 고유명사 할루시네이션 (한글↔한글 비음운, dict X)
 */
export function validateCorrections(chunkText, result, termDict = []) {
  if (!result?.chunks) return result;

  const dictMap = new Map();
  for (const t of termDict) { if (t?.wrong && t?.correct) dictMap.set(t.wrong, t.correct); }

  for (const chunk of result.chunks) {
    if (!chunk.changes) continue;

    chunk.changes = chunk.changes.filter((change) => {
      const { original, corrected, type } = change;

      // 규칙 1
      if (!original || chunkText.indexOf(original) === -1) return false;
      // 규칙 2
      if (original.trim() === (corrected || "").trim()) return false;
      // 규칙 3 (filler_removal/spelling 제외)
      if (type !== "filler_removal" && type !== "spelling" && corrected !== undefined) {
        const ratio = corrected.length / original.length;
        if (ratio < 0.3 && original.length > 10) return false;
      }
      // 규칙 4
      if (type === "filler_removal" && corrected && corrected.length > original.length) return false;
      // 규칙 5
      if (corrected && type !== "term_correction") {
        const origWords = new Set(original.split(/\s+/));
        const newWords = corrected.split(/\s+/).filter((w) => !origWords.has(w) && w.length > 1);
        if (newWords.length >= 3) return false;
      }
      // 규칙 6
      if (type === "filler_removal" && change.removed_fillers) {
        change.removed_fillers = change.removed_fillers.filter((f) => original.includes(f));
        if (change.removed_fillers.length === 0) return false;
      }
      // 규칙 8 — 고유명사 할루시네이션
      if (type === "term_correction" && original && corrected) {
        const bothHangul = hangulRatio(original) >= 0.7 && hangulRatio(corrected) >= 0.7;
        if (bothHangul) {
          const dictAllowed = dictMap.get(original) === corrected;
          const phoneticOk = isPhoneticallySimilarKorean(original, corrected);
          if (!dictAllowed && !phoneticOk) return false;
        }
      }
      return true;
    });

    // 규칙 7: 중복 → 마지막 것만
    const seen = new Map();
    chunk.changes.forEach((ch, idx) => { if (ch.original) seen.set(ch.original, idx); });
    chunk.changes = chunk.changes.filter((ch, idx) => !ch.original || seen.get(ch.original) === idx);
  }

  result.chunks = result.chunks.filter((c) => c.changes?.length > 0);
  return result;
}

/**
 * /correct handler — v4 통합 교정 (필러+용어+맞춤법+구어체 단일 호출).
 *
 * 사료: editor/worker/index.js:2521-2539 (prod handleCorrect)
 *
 * @param body { chunk_text, chunk_index?, total_chunks?, context_blocks?, analysis?, custom_fillers?, custom_terms? }
 * @returns { success, result, chunk_index?, usage } | error
 */
export async function handleCorrect(body, env, headers, user) {
  if (!body || typeof body !== "object") return badRequest(headers, "body 필수");

  const { chunk_text, chunk_index, total_chunks, context_blocks, analysis, custom_fillers, custom_terms } = body;
  if (typeof chunk_text !== "string" || chunk_text.length === 0) {
    return badRequest(headers, "chunk_text is required");
  }

  if (!env?.OPENAI_API_KEY) {
    return jsonResponse(
      { success: false, error: "OPENAI_API_KEY not configured", code: 503 },
      { status: 503 },
      headers
    );
  }

  const systemPrompt = buildCorrectPrompt(analysis, custom_fillers, custom_terms);

  let userMsg = "";
  if (context_blocks) userMsg += `[Context reference — do NOT modify]\n${context_blocks}\n\n`;
  userMsg += `[Correction target — chunk ${(chunk_index || 0) + 1}/${total_chunks || 1}]\n${chunk_text}`;

  // 3회 재시도 (429 rate limit 대응)
  for (let attempt = 0; attempt < 3; attempt++) {
    const result = await callOpenAI(env, {
      model: "gpt-4o-mini",
      messages: [
        buildSystemMessage(systemPrompt),  // ★ N4: PROMPT_INJECTION_GUARD prepend
        { role: "user", content: userMsg },
      ],
      temperature: 0,
      max_tokens: 16000,  // ★ gpt-4o-mini 한계 16384 — prod 의 32000 (다른 모델) 부적용
      response_format: { type: "json_object" },
    });

    if (!result.ok && result.status === 429) {
      await new Promise((r) => setTimeout(r, (attempt + 1) * 3000));
      continue;
    }
    if (!result.ok) {
      console.error(logPrefix("/correct"), "callOpenAI failed:", result.error);
      return jsonResponse(
        { success: false, error: result.error || "LLM call failed" },
        { status: result.status >= 400 ? result.status : 502 },
        headers
      );
    }

    const parsed = openaiJSON(result.data);
    if (!parsed) return serverError(headers, "/correct: JSON parse failed");

    // ★ Step 1-V: 8 rule guardrail
    const validated = validateCorrections(chunk_text, parsed, analysis?.term_corrections || []);

    return jsonResponse(
      { success: true, result: validated, chunk_index, usage: result.data?.usage },
      { status: 200 },
      headers
    );
  }
  return jsonResponse(
    { success: false, error: "All retries failed (429 rate limit)" },
    { status: 500 },
    headers
  );
}
// ─── DRAFT_AGENT_PROMPT + EDITOR_AGENT_PROMPT (★ M2 Phase 3 — 2-Pass) ───
// 사료: editor/worker/index.js:2545-2741 (prod DRAFT/EDITOR + handleHighlights)
// 변경점: PROMPT_INJECTION_GUARD interpolation 제거 → buildSystemMessage prepend (N4)

export const DRAFT_AGENT_PROMPT = `당신은 인터뷰 영상의 강조자막 Draft Agent입니다.
강조자막 후보를 넉넉하게 생성하는 것이 목표입니다. 놓치지 않는 것이 최우선입니다.

## §1 핵심 원칙
자막은 녹취가 아니라 번역이다. 긴 구어체를 시청자가 바로 이해할 수 있는 단위로 번역하는 장치다.
단, 화자의 발언 자체가 핵심 콘텐츠인 경우 인용형으로 보존한다.
낯선 개념은 자막이 먼저 책임진다.
한 대목에는 한 가지 시청자 과제만 준다.
화면이 이미 충분하면 자막을 줄인다.
자막 밀도는 시간이 아니라 내용이 결정한다.

## §4 자막 유형 체계 (16유형)
### A. 핵심 전달 (~40%)
- A1. 핵심 논지 압축 (10~30자)
- A2. 핵심 메시지 인용 (따옴표, 15~80자)
- A3. 비유형 압축 (15~30자)
### B. 정의·설명 (~15%)
- B1. 등호 정의형 A = B (10~30자)
- B2. 용어 설명형 A : 설명 (40~150자, 40자 규칙 예외)
  트리거: 전문 용어 첫 등장, 모르면 이해 불가, 영문 약어
- B3. 인물 소개형 (30~100자)
### C. 구조화 (~15%)
- C1. 질문 프레이밍형
- C2. 목차/프레임워크형
- C3. 서사 프레이밍
- C4. 단계 분해형 ①②③
- C5. 프로세스 연쇄형 (인과 사슬)
### D. 평가·반응 (~10%)
- D1. 비교 평가형
- D2. 리액션형
- D3. 말풍선형
### E. 기능·실무 (~10%)
- E1. 기능 헤드라인
- E2. 실무 팁/행동 지침

## §5 문체 규칙
짧게, 단정적으로, 구어체 제거, 결론만. 명사·동사 중심.
대부분 40자 이내. B2(40~150자), B3(30~100자), A2(~80자) 예외.
시각 기호: →, ↑, ↓, ×, · / 두 줄 시 / 로 구분.

## §6 결정 트리
1. 시청자 메시지 있는가? → 없으면 스킵
2. 화면이 이미 전달? → 스킵
3. 어떤 유형? → 메시지 성격으로 선택
4. 직전 자막과 유형 중복? → 3연속 시 재조정

## 출력 지시
- 필요량의 1.5~2배 넉넉히 생성
- 놓칠 바에는 포함. Editor Agent가 걸러냄
- 낯선 용어 첫 등장 → 반드시 B2 후보 생성

반드시 JSON만 출력:
{
  "highlights": [{
    "block_index": 16, "speaker": "화자명",
    "source_text": "원문 일부 (50자 이내)",
    "subtitle": "코드 = 정형 언어 vs 프롬프트 = 비정형 언어",
    "type": "B1", "type_name": "등호 정의형",
    "reason": "설명", "placement_hint": null, "sequence_id": null
  }]
}

## 절대 규칙
1. 교정된 용어 사용  2. 구어체 금지  3. block_index 정확히  4. JSON만 출력`;

export const EDITOR_AGENT_PROMPT = `당신은 인터뷰 영상의 강조자막 Editor Agent입니다.
Draft Agent가 생성한 후보를 검증·선별·다듬는 것이 목표입니다.

## §1 핵심 원칙
자막은 녹취가 아니라 번역이다. 한 대목에는 한 가지 과제만.
화면이 충분하면 줄인다. 밀도는 내용이 결정한다.

## §5 문체 규칙
짧게, 단정적, 구어체 제거. 40자 이내 (B2/B3/A2 예외).

## §7 스킵 조건
배경 설명/인사/도입, 농담, 단독 리액션, 반복, 전환 멘트, 잡담, 시연 화면 충분 구간

## §8 배치 지시
크기:(<<작게), 위치:(○○ 옆에), 톤:(부드러운), 이어붙이기:(위에꺼 이어서)

## §9 검증 체크리스트
번역인가? 구어체 남았는가? 1~2초 내 이해? 유일한 과제? 장르 적합? 유형 중복? 용어 설명 누락? 억지?

## 편집 작업
1. 스킵 조건 해당 → 제거
2. 유형 3연속 중복 → 재조정
3. 문체 다듬기
4. 장르별 밀도 조절
5. 놓친 B2 추가

## 출력 (JSON만)
{
  "highlights": [...],
  "removed": [{ "block_index": 5, "reason": "도입부 인사" }],
  "stats": { "draft_count": 45, "final_count": 28, "removal_rate": "38%" }
}

## 절대 규칙
1. 교정된 용어  2. 구어체 금지  3. block_index 정확  4. JSON만  5. removed에 사유 기록`;

export const GENRE_DENSITY_STRATEGIES = Object.freeze({
  "서사형":        `## 장르: 서사형\n밀도: 낮음. 인용형, 태도 강조 위주.`,
  "설명형":        `## 장르: 설명형\n밀도: 높음. 개념마다 검토. 낯선 용어 반드시 B2.`,
  "데모/도구활용형": `## 장르: 데모형\n밀도: 가변. 시연 중 축소, 토킹헤드 복귀 시 복구.`,
  "비교형":        `## 장르: 비교형\n밀도: 보통. 비교 근거 명확한 자막 위주.`,
  "산업/전략분석형": `## 장르: 산업/전략\n밀도: 매우 높음. 논점 전환마다 자막.`,
  "역사+인물형":    `## 장르: 역사+인물\n밀도: 보통~높음.`,
  "기술트렌드형":    `## 장르: 기술트렌드\n밀도: 높음.`,
});

/**
 * Compose Editor Agent prompt with genre density strategy + tech difficulty.
 * 사료: editor/worker/index.js:2658-2673 (prod buildEditorPrompt)
 */
export function buildEditorPrompt(analysis) {
  let prompt = EDITOR_AGENT_PROMPT;
  if (analysis?.genre?.primary) {
    const s = GENRE_DENSITY_STRATEGIES[analysis.genre.primary];
    if (s) prompt += `\n\n${s}`;
  }
  if (analysis?.genre?.secondary) {
    const s2 = GENRE_DENSITY_STRATEGIES[analysis.genre.secondary];
    if (s2) prompt += `\n\n### 보조 장르\n${s2}`;
  }
  if (analysis?.tech_difficulty) {
    prompt += `\n\n## 기술 난이도: ${analysis.tech_difficulty}`;
    if (["높음", "매우높음"].includes(analysis.tech_difficulty)) {
      prompt += `\nB2 비중을 높이세요.`;
    }
  }
  return prompt;
}

/**
 * Compose Draft Agent prompt with analysis + chunk info + target blocks.
 * 사료: editor/worker/index.js:2682-2711 (prod handleDraft 의 prompt 구성)
 */
export function buildDraftPrompt(analysis, chunk_index, total_chunks, target_block_indices, max_items) {
  let systemPrompt = DRAFT_AGENT_PROMPT;

  if (analysis?.genre) {
    systemPrompt += `\n\n## Step 0 분석 결과\n장르: ${analysis.genre.primary}${analysis.genre.secondary ? ` + ${analysis.genre.secondary}` : ""}`;
    if (analysis.genre.transitions?.length > 0) {
      systemPrompt += `\n장르 전환:`;
      for (const t of analysis.genre.transitions) {
        systemPrompt += `\n- 블록 ${t.block_range[0]}~${t.block_range[1]}: ${t.genre}`;
      }
    }
  }
  if (analysis?.tech_difficulty) systemPrompt += `\n기술 난이도: ${analysis.tech_difficulty}`;
  if (analysis?.domain_terms?.length > 0) {
    systemPrompt += `\n\n## 도메인 전문용어`;
    for (const dt of analysis.domain_terms) {
      systemPrompt += `\n- ${dt.term} (${dt.english})`;
    }
  }
  if (chunk_index !== undefined && total_chunks !== undefined) {
    systemPrompt += `\n\n## 청크 정보\n청크 ${chunk_index + 1}/${total_chunks}.`;
    if (chunk_index > 0) systemPrompt += ` 앞 청크에서 이미 자막 생성됨. 이 청크 내용에 집중.`;
  }
  if (Array.isArray(target_block_indices) && target_block_indices.length > 0) {
    const rangeLabel = target_block_indices.length === 1
      ? `블록 #${target_block_indices[0]}`
      : `블록 #${target_block_indices[0]}~#${target_block_indices[target_block_indices.length - 1]}`;
    systemPrompt += `\n\n## 부분 생성 모드\n사용자가 ${rangeLabel}을 선택했습니다. 이 블록들의 내용을 종합적으로 분석하여 강조자막을 생성하세요.\n- 선택된 블록들의 전체 맥락을 하나로 이해한 뒤 자막을 만드세요.\n- 주변 블록은 맥락 참조용으로만 사용하고, 자막은 반드시 선택 블록(${target_block_indices.join(", ")})에만 배치하세요.`;
    if (max_items) {
      systemPrompt += `\n- 최대 ${max_items}개만 생성하세요. 가장 임팩트 있는 것만 엄선하세요.`;
    }
  }

  return systemPrompt;
}

async function handleDraft(body, env, headers) {
  const { blocks, corrected_text, analysis, chunk_index, total_chunks, target_block_indices, max_items } = body;
  const systemPrompt = buildDraftPrompt(analysis, chunk_index, total_chunks, target_block_indices, max_items);

  let userMsg = target_block_indices
    ? "아래는 선택 구간과 주변 맥락입니다. 선택 블록에 대해서만 강조자막을 생성하세요.\n\n"
    : "아래는 1차 교정이 완료된 인터뷰 원고입니다. 강조자막 후보를 넉넉히 생성하세요.\n\n";
  if (Array.isArray(blocks)) {
    const targetSet = target_block_indices ? new Set(target_block_indices) : null;
    for (const b of blocks) {
      const marker = targetSet && targetSet.has(b.index) ? "★" : "";
      userMsg += `[블록 ${b.index}]${marker} ${b.speaker || ""} ${b.timestamp || ""}\n${b.text || ""}\n\n`;
    }
  } else {
    userMsg += corrected_text || "";
  }

  const result = await callOpenAI(env, {
    model: "gpt-4o-mini",
    messages: [
      buildSystemMessage(systemPrompt),
      { role: "user", content: userMsg },
    ],
    temperature: 0.3,
    max_tokens: 16000,
    response_format: { type: "json_object" },
  });
  if (!result.ok) {
    return jsonResponse(
      { success: false, error: result.error || "LLM call failed" },
      { status: result.status >= 400 ? result.status : 502 },
      headers
    );
  }
  const parsed = openaiJSON(result.data);
  return jsonResponse(
    { success: true, result: parsed, usage: result.data?.usage },
    { status: 200 },
    headers
  );
}

async function handleEdit(body, env, headers) {
  const { blocks, corrected_text, analysis, draft_highlights, chunk_index, total_chunks } = body;
  if (!Array.isArray(draft_highlights)) {
    return badRequest(headers, "draft_highlights array 필수 (mode=edit)");
  }
  const systemPrompt = buildEditorPrompt(analysis);

  let userMsg = `Draft Agent가 생성한 강조자막 후보입니다. 검증·선별·다듬기를 수행하세요.\n\n`;
  userMsg += `## Draft 후보 (${draft_highlights.length}건)\n\n${JSON.stringify(draft_highlights, null, 2)}`;
  userMsg += `\n\n## 원문 참조\n\n`;
  if (Array.isArray(blocks)) {
    for (const b of blocks) {
      userMsg += `[블록 ${b.index}] ${b.speaker || ""} ${b.timestamp || ""}\n${b.text || ""}\n\n`;
    }
  } else {
    userMsg += corrected_text || "";
  }
  if (chunk_index !== undefined && total_chunks !== undefined) {
    userMsg += `\n(청크 ${chunk_index + 1}/${total_chunks})`;
  }

  const result = await callOpenAI(env, {
    model: "gpt-4o-mini",
    messages: [
      buildSystemMessage(systemPrompt),
      { role: "user", content: userMsg },
    ],
    temperature: 0.2,
    max_tokens: 16000,
    response_format: { type: "json_object" },
  });
  if (!result.ok) {
    return jsonResponse(
      { success: false, error: result.error || "LLM call failed" },
      { status: result.status >= 400 ? result.status : 502 },
      headers
    );
  }
  const parsed = openaiJSON(result.data);
  return jsonResponse(
    { success: true, result: parsed, usage: result.data?.usage },
    { status: 200 },
    headers
  );
}

/**
 * /highlights handler — 2-Pass dispatch (mode: "draft" | "edit").
 *
 * 사료: editor/worker/index.js:2675-2680 (prod handleHighlights)
 *
 * @param body { mode: "draft"|"edit", blocks?, corrected_text?, analysis?, draft_highlights?, chunk_index?, total_chunks?, target_block_indices?, max_items? }
 */
export async function handleHighlights(body, env, headers, user) {
  if (!body || typeof body !== "object") return badRequest(headers, "body 필수");

  if (!env?.OPENAI_API_KEY) {
    return jsonResponse(
      { success: false, error: "OPENAI_API_KEY not configured", code: 503 },
      { status: 503 },
      headers
    );
  }

  const mode = body.mode || "draft";
  if (mode === "edit") return handleEdit(body, env, headers);
  return handleDraft(body, env, headers);
}
// ─── /term-explain (★ M2 Phase 6a — 용어 설명, Gemini→OpenAI 폴백) ─────
// 사료: editor/worker/index.js:3573-3650

export const TERM_EXPLAIN_PROMPT = `당신은 영상 강조자막용 용어 설명 작성 전문가입니다.
주어진 용어에 대해 시청자가 바로 이해할 수 있는 1~2줄 짜리 설명을 생성하세요.

## 형식
용어(영문 원어) : 일상 언어로 풀어쓴 정의

## 규칙
- 40~150자 사이
- 전문 용어를 일상 언어로 번역
- 일상 비유를 포함하면 이해도가 올라감
- 구어체 금지, 간결체로 작성
- 반드시 JSON만 출력: { "explanation": "생성된 설명" }`;

export async function handleTermExplain(body, env, headers, user) {
  if (!body || typeof body !== "object") return badRequest(headers, "body 필수");
  const { term, context } = body;
  if (typeof term !== "string" || term.length === 0) return badRequest(headers, "term is required");

  const systemPrompt = TERM_EXPLAIN_PROMPT;
  const userMessage = `용어: ${term}${context ? `\n\n참고 맥락:\n${context}` : ""}`;
  // ★ N4: PROMPT_INJECTION_GUARD prepend (system + user 결합 시 system prefix 에 박힘)
  const sysWithGuard = buildSystemMessage(systemPrompt);

  // 1차: Gemini 2.0-flash → 2.5-flash 순차
  if (env?.GEMINI_API_KEY) {
    for (const model of ["gemini-2.0-flash", "gemini-2.5-flash"]) {
      const r = await callGemini(env, {
        model,
        body: {
          contents: [{ parts: [{ text: sysWithGuard.content + "\n\n" + userMessage }] }],
          generationConfig: { temperature: 0.3, maxOutputTokens: 2000 },
        },
      });
      if (r.ok) {
        const text = r.data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
        if (text) {
          let jsonStr = text.trim();
          const fenceMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
          if (fenceMatch) jsonStr = fenceMatch[1].trim();
          const braceStart = jsonStr.indexOf("{");
          const braceEnd = jsonStr.lastIndexOf("}");
          if (braceStart !== -1 && braceEnd !== -1) jsonStr = jsonStr.substring(braceStart, braceEnd + 1);
          try {
            const parsed = JSON.parse(jsonStr);
            return jsonResponse({ success: true, result: parsed }, { status: 200 }, headers);
          } catch {
            return jsonResponse({ success: true, result: { explanation: text.trim() } }, { status: 200 }, headers);
          }
        }
      }
      console.warn(logPrefix("/term-explain"), `gemini ${model} failed: ${r.status}`);
    }
  }

  // 2차: OpenAI 폴백 (region US 일 때)
  if (!env?.OPENAI_API_KEY) {
    return jsonResponse(
      { success: false, error: "All AI providers failed (Gemini unavailable, OpenAI key missing)" },
      { status: 502 },
      headers
    );
  }
  const result = await callOpenAI(env, {
    model: "gpt-4.1-mini",
    messages: [sysWithGuard, { role: "user", content: userMessage }],
    temperature: 0.3,
    max_tokens: 2000,
    response_format: { type: "json_object" },
  });
  if (!result.ok) {
    return jsonResponse(
      { success: false, error: `All providers failed. Last: ${result.error}` },
      { status: result.status >= 400 ? result.status : 502 },
      headers
    );
  }
  const parsed = openaiJSON(result.data);
  return jsonResponse({ success: true, result: parsed }, { status: 200 }, headers);
}
// ─── /visuals (★ M2 Phase 5a — 시각자료 추천) ──────────────────────────
// 사료: editor/worker/index.js:3656-3756 (prod VISUALS + VISUAL_TYPES_SPEC)

export const VISUAL_TYPES_SPEC = `## 지원하는 21가지 시각화 타입 & chart_data 구조

1. bar — 세로 막대: { labels:["A","B"], datasets:[{label:"시리즈1",data:[10,20]}], unit:"%" }
2. bar_horizontal — 가로 막대: 동일 구조
3. bar_stacked — 누적 막대: 동일 구조, datasets 2개 이상
4. line — 라인 차트: { labels:["1월","2월"], datasets:[{label:"매출",data:[100,200]}], unit:"억원" }
5. area — 영역 차트: line과 동일 구조
6. donut — 도넛: { labels:["A","B"], datasets:[{data:[60,40],colors:["#3B82F6","#EF4444"]}], unit:"%" }
7. comparison — 비교: { columns:[{label:"찬성",tone:"positive",items:["항목1"]},{label:"반대",tone:"negative",items:["항목1"]}], footer:"요약" }
8. table — 표: { headers:["항목","값"], rows:[["A","100"],["B","200"]], highlight_rows:[0] }
9. process — 프로세스: { steps:[{label:"1단계",description:"설명"}] }
10. structure — 구조도: { items:[{label:"항목",description:"설명",color:"blue",num:1}] }
11. timeline — 세로 타임라인: { events:[{period:"2020",label:"출시",description:"설명"}] }
12. timeline_horizontal — 가로 타임라인: 동일 구조
13. kpi — KPI 카드: { metrics:[{label:"매출",value:"100억",trend:"up"}] } (trend: up/down/neutral)
14. ranking — 랭킹: { items:[{rank:1,label:"1위 항목",value:"100점",description:"설명"}] }
15. matrix — 2x2 매트릭스: { quadrants:[{position:"top-left",label:"높은X·높은Y",items:["항목"]}], x_axis:"X축명", y_axis:"Y축명" }
16. stack — 스택/레이어: { layers:[{label:"레이어1",description:"설명",color:"blue"}] }
17. cycle — 순환: { steps:[{label:"단계1",description:"설명"}] }
18. checklist — 체크리스트: { headers:["항목","조건1","조건2"], rows:[["A","O","X"]] }
19. hierarchy — 계층도: { root:{label:"루트",children:[{label:"자식1",children:[]}]} }
20. radar — 레이더: { labels:["축1","축2","축3"], datasets:[{label:"항목",data:[80,60,90]}] }
21. venn — 벤 다이어그램: { sets:[{label:"A"},{label:"B"}], intersection:{label:"공통"} }
22. network — 네트워크: { nodes:[{id:"a",label:"노드A"}], edges:[{from:"a",to:"b",label:"관계"}] }
23. progress — 진행률: { steps:[{label:"완료",status:"done"},{label:"진행중"},{label:"미완"}], current:1 }`;

export const VISUALS_SYSTEM_PROMPT = `당신은 유튜브 인터뷰 채널 'ttimes'의 시각 자료 편집 전문가입니다.
인터뷰 대본을 읽고, 영상에 삽입할 시각 자료(차트/도표/그래픽)를 추천합니다.

## 목표
시청자가 인터뷰 내용을 더 잘 이해할 수 있도록, 발언 내용 중 수치·비교·과정·구조 등을 시각화할 구간을 선별하고 차트 데이터를 생성합니다.

${VISUAL_TYPES_SPEC}

## 규칙
1. 인터뷰 원문에서 언급된 수치나 정보를 기반으로 chart_data를 구성하세요. 없는 수치를 만들지 마세요.
2. 각 시각 자료에 block_range를 지정하세요 — 시각 자료가 화면에 표시될 구간(블록 인덱스 범위)입니다.
3. type은 내용에 가장 적합한 것을 선택하세요.
4. 청크당 2~5개 생성. 모든 블록에 만들 필요 없음 — 시각화가 효과적인 구간만 선별.
5. priority: "high"(반드시 필요), "medium"(있으면 좋음), "low"(선택)
6. duration_seconds: 해당 시각 자료가 화면에 표시될 예상 시간(초) — 보통 5~15초

## 출력 (JSON만, 코드블록 없이)
{
  "visual_guides": [
    {
      "type": "bar|line|donut|...",
      "title": "차트 제목",
      "chart_data": { ... },
      "block_range": [시작블록, 끝블록],
      "reason": "이 구간에 시각 자료가 필요한 이유",
      "source_text": "관련 원문 발췌 (50자 이내)",
      "priority": "high|medium|low",
      "duration_seconds": 10
    }
  ]
}`;

export async function handleVisuals(body, env, headers, user) {
  if (!body || typeof body !== "object") return badRequest(headers, "body 필수");
  const blocks = body.blocks || [];
  if (!Array.isArray(blocks) || blocks.length === 0) {
    return badRequest(headers, "blocks가 비어있습니다.");
  }
  if (!env?.OPENAI_API_KEY) {
    return jsonResponse({ success: false, error: "OPENAI_API_KEY not configured", code: 503 }, { status: 503 }, headers);
  }

  const chunkIndex = body.chunk_index ?? 0;
  const totalChunks = body.total_chunks ?? 1;
  const existingCount = body.existing_count ?? 0;
  const preferredType = body.preferred_type || null;
  const selectedText = body.analysis?.selected_text || null;

  let userMsg = `## 인터뷰 대본 (청크 ${chunkIndex + 1}/${totalChunks})\n\n`;
  for (const b of blocks) {
    userMsg += `[블록 ${b.index}] ${b.speaker || ""} ${b.timestamp || ""}\n${b.text || ""}\n\n`;
  }
  if (selectedText) userMsg += `\n## 편집자 선택 텍스트 (이 부분을 중점적으로 시각화)\n"${selectedText}"\n`;
  if (preferredType) userMsg += `\n## 재생성 지시: 반드시 "${preferredType}" 타입으로 생성하세요.\n`;
  if (existingCount > 0) userMsg += `\n참고: 이미 ${existingCount}개의 시각 자료가 생성되어 있습니다. 중복되지 않는 새로운 구간을 찾아주세요.\n`;

  const result = await callOpenAI(env, {
    model: "gpt-4.1",
    messages: [buildSystemMessage(VISUALS_SYSTEM_PROMPT), { role: "user", content: userMsg }],
    temperature: 0.3,
    max_tokens: 8000,
    response_format: { type: "json_object" },
  });
  if (!result.ok) return jsonResponse({ success: false, error: result.error || "LLM call failed" }, { status: result.status >= 400 ? result.status : 502 }, headers);
  const parsed = openaiJSON(result.data) || {};
  return jsonResponse({ success: true, result: { visual_guides: parsed.visual_guides || [] }, usage: result.data?.usage }, { status: 200 }, headers);
}

// ─── /insert-cuts (★ M2 Phase 5b — 인서트 컷 추천) ─────────────────────
// 사료: editor/worker/index.js:3762-3839

export const INSERT_CUTS_SYSTEM_PROMPT = `당신은 유튜브 인터뷰 채널 'ttimes'의 인서트 컷 편집 전문가입니다.
인터뷰 대본을 읽고, 영상에 삽입할 인서트 컷(보조 영상/이미지)을 추천합니다.

## 인서트 컷이란?
인터뷰 진행 중 화자의 얼굴 대신 보여줄 보조 이미지/영상입니다. 시청자의 이해를 돕고 시각적 단조로움을 깨는 역할을 합니다.

## 3가지 유형
- **Type A (회상 일러스트)**: AI 이미지 생성(미드저니 등)으로 제작할 일러스트. 추상적 개념, 역사적 장면, 상상 속 시나리오 등. image_prompt 필수.
- **Type B (공식 이미지/유튜브)**: 구글 검색이나 유튜브에서 찾을 수 있는 공식 자료. 기업 로고, 제품 사진, 뉴스 기사, 공식 유튜브 영상 등. search_keywords 필수.
- **Type C (작품/성과물)**: 게스트나 관련 인물의 실제 작품, 성과, 결과물. 책 표지, 앱 스크린샷, 연구 결과 등.

## 규칙
1. 청크당 3~6개 추천
2. 각 인서트 컷에 block_range 지정 (표시될 블록 구간)
3. trigger_quote: 이 인서트 컷을 트리거하는 원문 발언 (정확한 인용)
4. trigger_reason: 왜 이 지점에 인서트 컷이 필요한지
5. instruction: 편집자에게 전달할 구체적 지시사항
6. source_type: "illustration"(A), "official_image"(B), "official_youtube"(B), "guest_provided"(C)

## 출력 (JSON만, 코드블록 없이)
{
  "insert_cuts": [
    {
      "type": "A|B|C",
      "type_name": "회상 일러스트|공식 이미지|작품/성과물",
      "title": "인서트컷 제목",
      "trigger_quote": "이 인서트컷을 유발하는 원문 발언",
      "trigger_reason": "이 지점에 인서트 컷이 필요한 이유",
      "instruction": "편집자에게 전달할 구체적 지시",
      "block_range": [시작블록, 끝블록],
      "source_type": "illustration|official_image|official_youtube|guest_provided",
      "image_prompt": "(Type A만) 미드저니 스타일 영문 프롬프트",
      "search_keywords": ["(Type B만) 검색 키워드1", "키워드2"],
      "youtube_search": { "query": "(Type B만) 유튜브 검색어" },
      "asset_note": "소재 확보 시 주의사항 (선택)"
    }
  ]
}`;

export async function handleInsertCuts(body, env, headers, user) {
  if (!body || typeof body !== "object") return badRequest(headers, "body 필수");
  const blocks = body.blocks || [];
  if (!Array.isArray(blocks) || blocks.length === 0) {
    return badRequest(headers, "blocks가 비어있습니다.");
  }
  if (!env?.OPENAI_API_KEY) {
    return jsonResponse({ success: false, error: "OPENAI_API_KEY not configured", code: 503 }, { status: 503 }, headers);
  }

  const chunkIndex = body.chunk_index ?? 0;
  const totalChunks = body.total_chunks ?? 1;
  const existingCount = body.existing_count ?? 0;
  const selectedText = body.analysis?.selected_text || null;

  let userMsg = `## 인터뷰 대본 (청크 ${chunkIndex + 1}/${totalChunks})\n\n`;
  for (const b of blocks) {
    userMsg += `[블록 ${b.index}] ${b.speaker || ""} ${b.timestamp || ""}\n${b.text || ""}\n\n`;
  }
  if (selectedText) userMsg += `\n## 편집자 선택 텍스트 (이 부분에 대한 인서트 컷 추천)\n"${selectedText}"\n`;
  if (existingCount > 0) userMsg += `\n참고: 이미 ${existingCount}개의 인서트 컷이 생성되어 있습니다. 중복되지 않는 새로운 구간을 찾아주세요.\n`;

  const result = await callOpenAI(env, {
    model: "gpt-4.1",
    messages: [buildSystemMessage(INSERT_CUTS_SYSTEM_PROMPT), { role: "user", content: userMsg }],
    temperature: 0.3,
    max_tokens: 8000,
    response_format: { type: "json_object" },
  });
  if (!result.ok) return jsonResponse({ success: false, error: result.error || "LLM call failed" }, { status: result.status >= 400 ? result.status : 502 }, headers);
  const parsed = openaiJSON(result.data) || {};
  return jsonResponse({ success: true, result: { insert_cuts: parsed.insert_cuts || [] }, usage: result.data?.usage }, { status: 200 }, headers);
}

// ─── /hl-recommend (★ M2 Phase 5c — 하이라이트 AI 추천) ────────────────
// 사료: editor/worker/index.js:3845-3917

export const HL_RECOMMEND_PROMPT = `당신은 유튜브 인터뷰 채널 'ttimes'의 하이라이트 편집자입니다.
인터뷰 원고를 읽고, 30~40초 분량의 하이라이트 영상에 쓸 수 있는 인상적인 발언 구간을 추천합니다.

## 하이라이트란?
- 인터뷰에서 가장 임팩트 있는 발언 5~8개를 뽑아 이어 붙인 30~40초짜리 쇼츠/프리뷰 영상
- 시청자가 "이 인터뷰 본편을 봐야겠다"고 느끼게 만드는 것이 목적
- 각 발언은 2~8초 분량 (10~50자 정도)

## 좋은 하이라이트 구간의 조건
1. 그 자체로 임팩트가 있는 문장 (맥락 없이 들어도 "오?" 하는 발언)
2. 구체적 숫자나 사실이 포함된 발언 ("토큰을 월 4000달러 씁니다")
3. 감정이 실린 단언 ("적게 써서 잘할 가능성은 없어요")
4. 대비/반전이 있는 발언 ("주니어는 400불, 시니어는 4000불")
5. 게스트만의 독특한 표현이나 비유
6. 호스트(홍재의)의 날카로운 질문이나 반응도 포함 가능

## 피해야 할 구간
- 너무 긴 설명이나 나열
- 맥락 없이는 이해 불가능한 발언
- "네", "그렇죠" 같은 맞장구만 있는 부분

## 출력 형식 (JSON만 출력)
{
  "candidates": [
    {
      "text": "원고에서 발췌한 정확한 텍스트",
      "speaker": "화자명",
      "reason": "왜 하이라이트에 적합한지",
      "impact": "high|medium",
      "estimated_seconds": 3
    }
  ],
  "suggested_flow": "추천 순서대로 이어붙였을 때의 흐름 설명 (1문장)"
}

## 규칙
- 후보를 8~12개 추천 (편집자가 그중 5~8개를 선택)
- impact가 high인 것을 5개 이상 포함
- 원고의 텍스트를 정확히 발췌 (수정하지 말 것)
- estimated_seconds는 ttimes 인터뷰 말하기 속도 기준 (초당 약 9자, 분당 540자)
- 총 후보의 합산이 60~90초 분량이 되도록`;

/**
 * Compress long script to head + middle + tail (총 maxChars 이내).
 * 사료: editor/worker/index.js:3887-3892 (compressScriptForHl)
 */
export function compressScriptForHl(text, maxChars) {
  if (typeof text !== "string") return "";
  if (text.length <= maxChars) return text;
  const h = Math.floor(maxChars * 0.4);
  const t = Math.floor(maxChars * 0.4);
  const mid = maxChars - h - t - 50;
  const ms = Math.floor(text.length * 0.4);
  return text.substring(0, h) + "\n[...중략...]\n" + text.substring(ms, ms + mid) + "\n[...중략...]\n" + text.substring(text.length - t);
}

export async function handleHlRecommend(body, env, headers, user) {
  if (!body || typeof body !== "object") return badRequest(headers, "body 필수");
  if (typeof body.script !== "string" || body.script.length === 0) {
    return badRequest(headers, "script required");
  }
  if (!env?.OPENAI_API_KEY) {
    return jsonResponse({ success: false, error: "OPENAI_API_KEY not configured", code: 503 }, { status: 503 }, headers);
  }

  const compressed = compressScriptForHl(body.script, 14000);
  const result = await callOpenAI(env, {
    model: "gpt-4.1",
    messages: [buildSystemMessage(HL_RECOMMEND_PROMPT), { role: "user", content: compressed }],
    temperature: 0.5,
    max_tokens: 2000,
    response_format: { type: "json_object" },
  });
  if (!result.ok) return jsonResponse({ success: false, error: result.error || "LLM call failed" }, { status: result.status >= 400 ? result.status : 502 }, headers);
  const parsed = openaiJSON(result.data);
  if (!parsed) return serverError(headers, "/hl-recommend: JSON parse failed");
  return jsonResponse({ success: true, result: parsed, usage: result.data?.usage }, { status: 200 }, headers);
}

// ─── /hl-timestamps (★ M2 Phase 5d — 유튜브 챕터 생성) ─────────────────
// 사료: editor/worker/index.js:3923-3980

export const HL_TIMESTAMPS_PROMPT = `당신은 유튜브 인터뷰 영상의 챕터(타임스탬프)를 생성하는 전문가입니다.

## 작업
인터뷰 원고를 읽고, 유튜브 영상 설명란에 넣을 타임스탬프(챕터)를 생성합니다.

## 핵심 규칙
1. 토픽이 전환되는 지점을 찾아서 5~10개의 챕터로 나누기
2. 각 챕터의 제목은 시청자가 검색할 만한 구체적이고 흥미로운 문구 (SEO 최적화)
3. "인트로", "아웃트로", "마무리" 같은 일반적인 제목 대신 내용을 반영한 제목 사용
4. 각 챕터 전환점이 원고 어디에 있는지 "해당 구간의 첫 문장"을 anchor_text로 제공

## 중요
- 원고의 화자 타임스탬프는 편집 전 원본 시간이므로 무시하세요
- 최종 영상 시간은 별도로 계산됩니다
- 당신은 오직 "토픽 전환점"과 "소제목"만 잡아주면 됩니다

## 출력 형식 (JSON만 출력)
{
  "chapters": [
    {
      "title": "챕터 제목 (검색 최적화된 구체적 문구)",
      "anchor_text": "이 챕터가 시작되는 원고의 첫 문장 또는 핵심 구절 (정확히 발췌)",
      "summary": "이 구간에서 다루는 내용 한 줄 요약"
    }
  ],
  "video_title_suggestion": "영상 전체를 아우르는 제목 제안 (선택)"
}

## 규칙
- 첫 번째 챕터는 영상 시작 부분 (인트로 대신 내용 반영 제목)
- 5~10개 챕터 생성
- anchor_text는 원고에서 정확히 발췌 (수정하지 말 것)
- 챕터 제목은 15자 이내로 간결하게`;

export async function handleHlTimestamps(body, env, headers, user) {
  if (!body || typeof body !== "object") return badRequest(headers, "body 필수");
  if (typeof body.script !== "string" || body.script.length === 0) {
    return badRequest(headers, "script required");
  }
  if (!env?.OPENAI_API_KEY) {
    return jsonResponse({ success: false, error: "OPENAI_API_KEY not configured", code: 503 }, { status: 503 }, headers);
  }

  const compressed = compressScriptForHl(body.script, 14000);
  const result = await callOpenAI(env, {
    model: "gpt-4.1",
    messages: [buildSystemMessage(HL_TIMESTAMPS_PROMPT), { role: "user", content: compressed }],
    temperature: 0.4,
    max_tokens: 2000,
    response_format: { type: "json_object" },
  });
  if (!result.ok) return jsonResponse({ success: false, error: result.error || "LLM call failed" }, { status: result.status >= 400 ? result.status : 502 }, headers);
  const parsed = openaiJSON(result.data);
  if (!parsed) return serverError(headers, "/hl-timestamps: JSON parse failed");
  return jsonResponse({ success: true, result: parsed, usage: result.data?.usage }, { status: 200 }, headers);
}
// ─── /setgen (★ M2 Phase 6b — 세트 생성 키워드+트렌드+3종 GPT) ────────
// 사료: editor/worker/index.js:3983-4212

export const SETGEN_KEYWORD_SYSTEM = `인터뷰 원고에서 유튜브 검색에 활용할 핵심 키워드를 추출합니다.
JSON만 출력. 다른 텍스트 없이.
{"keywords":["키워드1","키워드2",...],"guest_summary":"게스트 한줄 소개","notable_quotes":["인상적 발언1","인상적 발언2"]}
규칙:
- keywords: 6~10개. 고유명사(인물, 기업, 서비스명) 우선. "AI 커머스"처럼 구체화
- notable_quotes: 원고에서 게스트가 한 인상적 발언 3~5개 (원문 그대로). 직관적이고 파급력 있는 표현 우선`;

/**
 * Setgen prompt builder (4 type: balanced / script / focus / trend).
 * 사료: editor/worker/index.js:3993-4044 (prod makeSetgenPrompt)
 */
export function makeSetgenPrompt(type) {
  const typeGuide = {
    balanced: "## 이번 후보: ⚖️ 밸런스형\n원고의 핵심 발언 + 시의성 있는 트렌드의 교집합을 찾아 앵글을 잡습니다.\n- 썸네일/제목: 원고 내용에 충실하되, 트렌드 데이터에서 시의성이 확인된 표현을 자연스럽게 활용\n- 설명문: 원고 내용 요약 + \"지금 왜 이 주제가 중요한지\" 시의성 연결",
    script:   "## 이번 후보: 📝 스크립트 충실형\n게스트만의 독보적 시각과 인상적 발언을 최대한 살립니다.\n- 썸네일/제목: 게스트의 실제 발언이나 비유를 직접 활용. 트렌드 키워드를 억지로 넣지 않음\n- 설명문: 게스트의 분석과 주장을 충실하게 전달\n- \"이 게스트가 아니면 들을 수 없는 이야기\"가 드러나야 함",
    focus:    "## 이번 후보: 🎯 선택과 집중\n편집자가 지정한 키워드를 중심 앵글로 세트를 만듭니다.\n\n★ 가장 중요한 규칙: 키워드가 언급된 특정 문장 하나만 보지 마세요.\n원고 전체에서 해당 키워드와 관련된 모든 맥락을 파악한 뒤 세트를 만드세요.\n- 게스트가 왜 이 주제를 꺼냈는가 (배경)\n- 어떤 흐름과 논리로 설명하고 있는가 (전개)\n- 어떤 결론이나 전망을 제시하는가 (핵심 메시지)\n이 세 가지를 종합해서 \"이 영상에서 [키워드]에 대해 알 수 있는 것\"의 전체 그림을 세트에 담으세요.\n\n- 썸네일/제목: 키워드 관련 전체 맥락에서 가장 임팩트 있는 앵글을 잡을 것\n- 설명문: 키워드와 관련된 게스트의 분석 흐름을 충실하게 요약",
    trend:    "## 이번 후보: 🔍 시의성 극대화형\n지금 사람들이 관심 있는 주제와 원고 내용의 교집합을 극대화합니다.\n- 썸네일/제목: 뉴스건수가 많거나 급상승 중인 키워드를 앞에 배치. \"지금 뜨는 주제\"임을 즉시 느끼게\n- 설명문: 현재 이슈 → 원고의 분석 → 왜 지금 봐야 하는지 순서로 구성\n- 트렌드 데이터에서 뉴스 건수가 가장 많은 키워드, 급상승 매칭된 키워드를 최우선 활용",
  };

  return `당신은 유튜브 인터뷰 채널 'ttimes'의 편집자입니다.

## ttimes 채널 특성
- 구독자 수만~수십만 규모의 테크/비즈니스 심층 인터뷰 채널
- 시청자 유입의 69%가 홈 피드 추천(41%)과 추천 동영상(28%)
- 검색 유입은 11.7%에 불과 → 태그/검색 최적화보다 CTR이 핵심
- 현재 노출 클릭률 3.5% → 4~5%로 올리는 것이 최우선 목표

## 세트 생성의 핵심 원칙
### 1. 썸네일/제목: 홈 피드에서 스크롤을 멈추게 하는 것
- "정보 격차(information gap)" — 모르면 손해일 것 같은 느낌
- 구체적 숫자, 고유명사, 대비 구조가 효과적

### 2. 시의성이 CTR을 올린다
- 트렌드 데이터에서 뉴스 건수가 많은 키워드 = 지금 사람들이 관심 있는 주제

### 3. Quality CTR
- 썸네일/제목이 약속한 것을 영상이 반드시 전달해야 함
- 원고에 분명히 있는 내용만 활용

### 4. 썸네일+제목 "1+1=3" 원칙 (가장 중요)
- 썸네일과 제목은 서로 다른 정보를 전달해야 함
- 보완 패턴: (A) 감정/훅+맥락, (B) 결과/수치+원인/질문, (C) 발언+프레이밍

${typeGuide[type]}

## 출력 형식 (JSON만 출력)
{
  "tags": [{"tag":"키워드","source":"trend|script|both","reason":"근거"}],
  "thumbnail": {"lines":["줄1","줄2","줄3(선택)"],"reason":"앵글 선택 이유"},
  "youtube_title": {"text":"제목","reason":"CTR 전략"},
  "description": {"text":"설명문","reason":"구성 전략"}
}

## 태그 규칙: 12~15개 (1단어 5~6개, 2단어 6~8개, 3단어 1~2개)
## 썸네일: 2~3줄, 핵심 훅 + 구체적 정보
## 유튜브 제목: 40~60자, 핵심 주제어 앞 20자, (게스트명 직함) 형식 끝
## 설명문: 4~6문장, 시의성→인사이트→게스트 소개

## 트렌드 데이터 해석법
- 🔥급상승 = Google Trends 급상승 → 시의성 최고
- 📰뉴스 N건 = 최근 24시간 뉴스 기사 수
- 급상승 + 뉴스 많음 + 원고 내용 = 최적의 앵글`;
}

// ─── /setgen 외부 트렌드 데이터 fetch (사료 4046-4086) ──────────────────

async function getYTSuggestions(keyword) {
  try {
    const res = await fetch("https://clients1.google.com/complete/search?client=youtube&hl=ko&gl=kr&ds=yt&q=" + encodeURIComponent(keyword), { headers: { "User-Agent": "Mozilla/5.0" } });
    const text = await res.text();
    const s = text.indexOf("["), e = text.lastIndexOf("]") + 1;
    if (s === -1) return [];
    return (JSON.parse(text.substring(s, e))[1] || []).map((i) => i[0]);
  } catch { return []; }
}

async function getGoogleSuggestions(keyword) {
  try {
    const res = await fetch("https://suggestqueries.google.com/complete/search?client=firefox&hl=ko&gl=kr&q=" + encodeURIComponent(keyword), { headers: { "User-Agent": "Mozilla/5.0" } });
    return (await res.json())[1] || [];
  } catch { return []; }
}

async function getGoogleTrendsRSS() {
  try {
    const res = await fetch("https://trends.google.com/trending/rss?geo=KR", { headers: { "User-Agent": "Mozilla/5.0" } });
    const xml = await res.text();
    const titles = [];
    let re = /<title><!\[CDATA\[([^\]]+)\]\]><\/title>/g;
    let m;
    while ((m = re.exec(xml)) !== null) titles.push(m[1]);
    if (titles.length <= 1) {
      re = /<item>[\s\S]*?<title>([^<]+)<\/title>/g;
      while ((m = re.exec(xml)) !== null) titles.push(m[1]);
    }
    return titles.slice(0, 20);
  } catch { return []; }
}

async function getNewsCount(keyword) {
  try {
    const url = "https://news.google.com/rss/search?q=" + encodeURIComponent(keyword) + "+when:1d&hl=ko&gl=KR&ceid=KR:ko";
    const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
    const xml = await res.text();
    return (xml.match(/<item>/g) || []).length;
  } catch { return 0; }
}

async function callGPTForSetgen(env, systemPrompt, userMsg, maxTokens, temp) {
  const r = await callOpenAI(env, {
    model: "gpt-4.1",
    messages: [buildSystemMessage(systemPrompt), { role: "user", content: userMsg }],
    temperature: temp,
    max_tokens: maxTokens,
    response_format: { type: "json_object" },
  });
  if (!r.ok) throw new Error(r.error || "callOpenAI failed");
  const parsed = openaiJSON(r.data);
  if (!parsed) throw new Error("JSON parse failed");
  return parsed;
}

export async function handleSetgen(body, env, headers, user) {
  if (!body || typeof body !== "object") return badRequest(headers, "body 필수");
  const { script, guest_name, guest_title } = body;
  const focus_keyword = body.focus_keyword || "";
  if (typeof script !== "string" || script.length === 0) {
    return badRequest(headers, "script required");
  }
  if (!env?.OPENAI_API_KEY) {
    return jsonResponse({ success: false, error: "OPENAI_API_KEY not configured", code: 503 }, { status: 503 }, headers);
  }

  try {
    // Step 1: 키워드 + 인상 발언 추출
    const kwResult = await callGPTForSetgen(env, SETGEN_KEYWORD_SYSTEM, compressScriptForHl(script, 10000), 800, 0.3);
    const keywords = kwResult.keywords || [];
    const guestSummary = kwResult.guest_summary || "";
    const notableQuotes = kwResult.notable_quotes || [];

    // Step 2: 트렌드 데이터 병렬 수집
    const trendData = {};
    const kwSlice = keywords.slice(0, 8);
    const acPromises = kwSlice.map((kw) =>
      Promise.all([getYTSuggestions(kw), getGoogleSuggestions(kw), getNewsCount(kw)]).then((r) => {
        trendData[kw] = { youtube: r[0].slice(0, 8), google: r[1].slice(0, 8), news_24h: r[2] };
      })
    );
    const trendsPromise = getGoogleTrendsRSS();
    const results = await Promise.all([Promise.all(acPromises), trendsPromise]);
    const trendingNow = results[1] || [];

    // Step 3: 트렌드 블록 포맷
    let tb = "## 실시간 트렌드 데이터\n\n";
    tb += "### 🔥 Google Trends 한국 급상승 검색어 (상위 20)\n";
    if (trendingNow.length > 0) trendingNow.forEach((t, i) => { tb += (i + 1) + ". " + t + "\n"; });
    else tb += "(수집 실패)\n";
    tb += "\n### 키워드별 시의성 지표\n\n";
    for (const kw in trendData) {
      const d = trendData[kw];
      tb += '#### "' + kw + '" 📰뉴스 ' + d.news_24h + '건/24h';
      const matched = trendingNow.filter((t) => t.indexOf(kw) >= 0 || kw.indexOf(t) >= 0);
      if (matched.length > 0) tb += " 🔥급상승";
      tb += "\n";
      if (d.youtube.length > 0) tb += "YT자동완성: " + d.youtube.slice(0, 5).map((s, i) => (i + 1) + "." + s).join(" | ") + "\n";
      if (d.google.length > 0) tb += "Google자동완성: " + d.google.slice(0, 5).map((s, i) => (i + 1) + "." + s).join(" | ") + "\n";
      tb += "\n";
    }

    let quotesBlock = "";
    if (notableQuotes.length > 0) {
      quotesBlock = "\n## 게스트 인상적 발언 (원문)\n";
      notableQuotes.forEach((q, i) => { quotesBlock += (i + 1) + '. "' + q + '"\n'; });
    }

    // Step 4: 3개 후보 개별 호출 (balanced / trend / [focus or script])
    const guestInfo = "## 게스트\n- 이름: " + (guest_name || "(추출)") + "\n- 직함: " + (guest_title || guestSummary || "(추출)") + "\n\n";
    const scriptBlock = "\n## 인터뷰 원고\n" + compressScriptForHl(script, 7000);
    const userBase = guestInfo + tb + quotesBlock + scriptBlock;

    let thirdType, thirdPrompt, thirdUser, thirdTemp;
    if (focus_keyword.trim()) {
      thirdType = "focus";
      thirdPrompt = makeSetgenPrompt("focus");
      thirdUser = guestInfo + tb + quotesBlock + "\n## 🎯 편집자 지정 앵글\n키워드: " + focus_keyword + "\n" + scriptBlock;
      thirdTemp = 0.75;
    } else {
      thirdType = "script";
      thirdPrompt = makeSetgenPrompt("script");
      thirdUser = userBase;
      thirdTemp = 0.7;
    }

    const setResults = await Promise.all([
      callGPTForSetgen(env, makeSetgenPrompt("balanced"), userBase, 2000, 0.8),
      callGPTForSetgen(env, makeSetgenPrompt("trend"), userBase, 2000, 0.85),
      callGPTForSetgen(env, thirdPrompt, thirdUser, 2000, thirdTemp),
    ]);

    const merged = {
      tags: [],
      thumbnail: [
        Object.assign({ type: "balanced" }, setResults[0].thumbnail),
        Object.assign({ type: "trend" }, setResults[1].thumbnail),
        Object.assign({ type: thirdType }, setResults[2].thumbnail),
      ],
      youtube_title: [
        Object.assign({ type: "balanced" }, setResults[0].youtube_title),
        Object.assign({ type: "trend" }, setResults[1].youtube_title),
        Object.assign({ type: thirdType }, setResults[2].youtube_title),
      ],
      description: [
        Object.assign({ type: "balanced" }, setResults[0].description),
        Object.assign({ type: "trend" }, setResults[1].description),
        Object.assign({ type: thirdType }, setResults[2].description),
      ],
    };

    // 태그 병합 — source=both 우선
    const tagMap = {};
    setResults.forEach((sr) => {
      (sr.tags || []).forEach((t) => {
        if (!tagMap[t.tag]) tagMap[t.tag] = t;
        else if (t.source === "both") tagMap[t.tag] = t;
      });
    });
    merged.tags = Object.values(tagMap).slice(0, 15);

    return jsonResponse({
      success: true,
      result: merged,
      trend_data: trendData,
      trending_now: trendingNow,
      keywords_extracted: keywords,
      notable_quotes: notableQuotes,
      focus_keyword,
    }, { status: 200 }, headers);
  } catch (e) {
    console.error(logPrefix("/setgen"), "error:", e?.message || e);
    return jsonResponse({ success: false, error: e?.message || String(e) }, { status: 500 }, headers);
  }
}
// ─── /subtitle-format (★ M2 Phase 4 — V2.2 + V3, N4 PROMPT_INJECTION_GUARD) ──
// 사료: editor/worker/index.js:2747-3569 (prod V2.1/V3 prompt + post-processing)
// 변경점:
//   - PROMPT_INJECTION_GUARD interpolation 제거 → buildSystemMessage prepend
//   - 직접 fetch → callOpenAI 경유 (일관성)
//   - model "gpt-5.4-mini" 보존 (사용자 환경 별칭)

export const SUBTITLE_FORMAT_PROMPT = `<role>
You are a Korean subtitle line-break position expert. You receive Korean interview transcript text with numbered words (eojeols). Your ONLY job is to decide WHERE to place line breaks by returning the word numbers. You do NOT rewrite, modify, or reproduce any of the original text.
</role>

<task>
Given numbered words like: [1]거기서 [2]광고 [3]매출 [4]잘 [5]나오고 [6]있으니까
Return ONLY the word numbers AFTER which a line break should be placed.
Output: {"breaks_after": [6]}
This means: break after word 6 → line 1 = words 1–6, line 2 starts at word 7.
</task>

<decision_criteria>
Your decisions must follow this priority order:

PRIORITY 1 — Never split semantic chunks (see <never_split>)
PRIORITY 2 — Break at clause boundaries (see <clause_boundaries>)
PRIORITY 3 — Every line SHOULD be between 12 and 28 characters.
HARD LIMIT: No line may exceed 35 characters under any circumstance.
If keeping a semantic chunk intact would produce a line over 35 characters, you MUST find a break point inside that chunk — even semantic chunks can be split when they exceed 35 characters.

MINIMUM BREAK DENSITY: For every 5 words in the input, there must be at least 1 break.
A 50-word input must have at least 10 breaks.
A 60-word input must have at least 12 breaks.
If your output has fewer breaks than this minimum, you are making lines too long.

When PRIORITY 2 and 3 conflict:
- If a clause boundary produces a line over 28 characters → you MUST find an additional break point inside that clause. Look for internal phrase boundaries (object+verb, adverb+predicate, list items).
- If a clause boundary produces a line under 12 characters → acceptable ONLY if the line is a semantically complete unit (direct speech, exclamation, or a standalone clause ending). Otherwise merge with adjacent line.

CRITICAL RULE: A line over 35 characters is ALWAYS wrong, no matter what. When you see 5+ words accumulating without a break, you are probably making a line too long. Break it.
</decision_criteria>

<line_length_guide>
Korean eojeols average about 3–4 characters each (including the trailing space).
Use this rough mapping to stay within 12–28 characters per line:

| Words in line | Approximate chars | Verdict      |
|---------------|-------------------|--------------|
| 2–3 words     | 8–15 chars        | Short — OK only if semantically complete |
| 4–5 words     | 14–22 chars       | Ideal range  |
| 6–7 words     | 20–28 chars       | Upper limit — check carefully |
| 8+ words      | 28+ chars         | TOO LONG — must break somewhere inside |

When you have 7+ words between breaks, STOP and look for an internal break point.
</line_length_guide>

<clause_boundaries>
These are natural break points in Korean speech.

Break AFTER words ending with these suffixes:
~하고, ~해서, ~인데, ~지만, ~니까, ~있고, ~거든요, ~잖아요, ~됐고, ~보니까, ~계세요, ~는데, ~때문에, ~합니다, ~돼요, ~거고, ~이고, ~하는, ~됩니다, ~있어요, ~거예요, ~하죠, ~되고

Break BEFORE these conjunctions (they start a new line):
그래서, 그리고, 하지만, 결국, 심지어, 특히, 마찬가지로, 근데, 그러니까, 그런데, 그러면, 그러다, 그런

Break BEFORE direct speech (quoted utterances start a new line).
</clause_boundaries>

<semantic_chunks>
A semantic chunk is a group of words forming ONE meaning unit. Never place a break inside a chunk.

| Chunk Type                    | Example (keep together)       |
|-------------------------------|-------------------------------|
| Subject/Topic + Particle      | 사용자의 역량이                |
| Modifier clause + Head noun   | 돌아가고 있는 곳들이            |
| Adverb(ial phrase) + Predicate| 많이 쓸수록                    |
| Object + Predicate            | 토큰을 생산할                  |
| Main verb + Aux verb + Ending | 나오고 있으니까                |
| Noun + Particle               | 사용자의 (사용자 / 의 = ERROR) |
</semantic_chunks>

<never_split>
Breaking inside ANY of these patterns is a critical error.

| Pattern Type                  | Keep Together            | WRONG Split              |
|-------------------------------|--------------------------|--------------------------|
| Modifier clause + Head noun   | 돌아가고 있는 곳들이       | 돌아가고 있는 / 곳들이     |
| Object + Predicate            | 토큰을 많이 쓸수록        | 토큰을 많이 / 쓸수록      |
| Main verb + Auxiliary verb    | 나오고 있으니까           | 나오고 / 있으니까         |
| Adverb + Verb                 | 꽤 돌아가고              | 꽤 / 돌아가고            |
| Noun + Particle               | 사용자의                 | 사용자 / 의              |
| Orphaned single word on a line | (never allowed)         |                          |
</never_split>

<examples>

<example id="1">
<input>
[1]마찬가지로 [2]워크 [3]에이전트도 [4]사용자의 [5]역량이 [6]중요합니다 [7]회사 [8]데이터를 [9]다 [10]주고 [11]예를 [12]들면 [13]인사 [14]규정 [15]다 [16]주고 [17]제가 [18]한 [19]줄로 [20]물어봐요 [21]나 [22]내일 [23]집에 [24]가도 [25]돼? [26]이러면 [27]답을 [28]할 [29]수가 [30]없죠 [31]이게 [32]도대체 [33]무슨 [34]뜻인데요
</input>
<correct_output>{"breaks_after": [3, 6, 12, 20, 25, 30]}</correct_output>
</example>

<example id="2">
<input>
[1]거기서 [2]광고 [3]매출 [4]잘 [5]나오고 [6]있으니까 [7]그런 [8]거에 [9]장점은 [10]있지만 [11]결국 [12]아마존 [13]마이크로소프트 [14]구글 [15]애플은 [16]토큰을 [17]많이 [18]쓸수록 [19]회사가 [20]좋아지는 [21]회사가 [22]되려고 [23]하고 [24]있고
</input>
<correct_output>{"breaks_after": [6, 10, 13, 18, 21]}</correct_output>
<wrong_output reason="Line too long — no break between [11] and [24] produces 44ch line">
breaks_after: [6, 10] → 44ch = CRITICAL ERROR
</wrong_output>
</example>

<example id="3">
<input>
[1]1년 [2]만에 [3]30년 [4]개발자 [5]기업 [6]분석 [7]시리즈를 [8]저희가 [9]다시 [10]시작해서 [11]지금 [12]이어가고 [13]있는데 [14]일단 [15]토큰을 [16]중심으로 [17]하는 [18]토큰 [19]이코노미가 [20]굉장히 [21]중요하다고 [22]말씀해 [23]주셨고 [24]코딩 [25]에이전트는 [26]이미 [27]다 [28]보급돼서 [29]우리가 [30]잘 [31]쓰고 [32]있고
</input>
<correct_output>{"breaks_after": [7, 13, 19, 23, 28]}</correct_output>
</example>

<example id="4">
<input>
[1]이 [2]사람들이 [3]하는 [4]일을 [5]어떻게 [6]AI로 [7]잘할 [8]것인가라고 [9]해서 [10]일반 [11]직군 [12]AX를 [13]하고 [14]있는데 [15]일반 [16]직군 [17]AX의 [18]제일 [19]중요한 [20]게 [21]이 [22]워크 [23]에이전트라고 [24]보고 [25]있습니다
</input>
<correct_output>{"breaks_after": [9, 14, 20]}</correct_output>
<wrong_output reason="No internal breaks — single 46ch line">
breaks_after: [] → 46ch = CRITICAL ERROR
</wrong_output>
</example>

</examples>

<output_format>
Return ONLY valid JSON. Nothing before or after.
{"breaks_after": [3, 6, 12, 20, 25, 30]}

The numbers are word indices AFTER which a line break is inserted.
Do NOT include the last word's index (no trailing break).
Do NOT output any text, explanation, or markdown — JSON only.

Before outputting the JSON, silently verify:
1. Count your breaks. For N input words, you need at least N/5 breaks.
2. Check: is there any gap of 8+ word indices between consecutive breaks? If yes, add a break in that gap.
3. Only then output the final JSON.
</output_format>`;

export const SUBTITLE_FORMAT_PROMPT_V3 = `<role>
You are a Korean subtitle line-break formatter. Your job is to split Korean interview transcripts into subtitle lines that viewers can read at a glance. You must maintain consistent quality from the first line to the last, regardless of input length.
</role>

<hard_rules>
These rules apply to EVERY line with NO exceptions:
1. Every output line must be 15–25 characters (including spaces).
2. Lines under 10 characters → FAILURE. Lines over 25 characters → FAILURE.
3. Remove trailing periods (.) and commas (,). Preserve ? and !
4. Remove metadata lines (filenames, dates, durations, speaker labels, dividers).
5. Output the formatted text only — one subtitle line per line, no numbering, no explanations.
6. After the formatted lines, output NOTHING else.
</hard_rules>

<speaker_markers>
Input text contains [화자명] markers at the start of each speaker turn.
- ALWAYS start a new line after each [화자명] marker.
- NEVER merge text from different speakers into one line.
- Remove the [화자명] markers from your output — they are only for your reference.
</speaker_markers>

<process>
Follow this exact sequence for every input:

STEP 1 — FOR THE INPUT:

  1a. Mark clause boundaries
  Clause-ending suffixes (break AFTER these):
  ~하고, ~해서, ~인데, ~지만, ~니까, ~있고, ~거든요, ~잖아요, ~됐고, ~보니까, ~계세요

  Conjunctions (break BEFORE these — they start a new line):
  그래서, 그리고, 하지만, 결국, 심지어, 특히, 마찬가지로

  1b. Identify semantic chunks within each clause
  A semantic chunk is a group of words forming ONE idea:
  - [Subject/Topic + Particle]: 사용자의 역량이
  - [Modifier clause + Head noun]: 돌아가고 있는 곳들이
  - [Adverb(ial phrase) + Predicate]: 많이 쓸수록
  - [Object + Predicate]: 토큰을 생산할
  - [Main verb + Auxiliary verb + Ending]: 나오고 있으니까

  1c. Place line breaks BETWEEN semantic chunks, never inside them.
  Choose the break point closest to the 15–25 character target.

  1d. VALIDATE every line.
  Count characters. If any line is < 15 or > 25, fix it NOW before outputting.

STEP 2 — FINAL VALIDATION
Do a final character-count check on the entire output.
</process>

<never_split>
The following patterns must ALWAYS stay on a single line. Breaking inside them is a critical error.

| Pattern Type                  | Keep Together            | WRONG Split              |
|-------------------------------|--------------------------|--------------------------|
| Modifier clause + Head noun   | 돌아가고 있는 곳들이       | 돌아가고 있는 / 곳들이     |
| Object + Predicate            | 토큰을 많이 쓸수록        | 토큰을 많이 / 쓸수록      |
| Main verb + Auxiliary verb    | 나오고 있으니까           | 나오고 / 있으니까         |
| Adverb + Verb                 | 꽤 돌아가고              | 꽤 / 돌아가고            |
| Noun + Particle               | 사용자의                 | 사용자 / 의              |
| Orphaned single word on a line | (never allowed)         |                          |
</never_split>

<examples>

<example id="1">
<description>Mixed sentence types: statement, direct speech with ?, and short clauses. Shows conjunction-start rule, quote handling, and semantic unit preservation.</description>

<input>마찬가지로 워크 에이전트도 사용자의 역량이 중요합니다 회사 데이터를 다 주고 예를 들면 인사 규정 다 주고 제가 한 줄로 물어봐요 나 내일 집에 가도 돼? 이러면 답을 할 수가 없죠 이게 도대체 무슨 뜻인데요</input>

<correct_output>
마찬가지로 워크 에이전트도
사용자의 역량이 중요합니다
회사 데이터를 다 주고 예를 들면
인사 규정 다 주고 제가 한 줄로 물어봐요
나 내일 집에 가도 돼?
이러면 답을 할 수가 없죠
이게 도대체 무슨 뜻인데요
</correct_output>

<line_by_line_analysis>
Line 1: "마찬가지로 워크 에이전트도" (15ch) — Conjunction starts the line
Line 2: "사용자의 역량이 중요합니다" (15ch) — [Subject+Particle] + [Predicate] complete clause
Line 3: "회사 데이터를 다 주고 예를 들면" (18ch) — Clause ending ~주고 + transitional
Line 4: "인사 규정 다 주고 제가 한 줄로 물어봐요" (22ch) — Clause ending ~주고 + new subject
Line 5: "나 내일 집에 가도 돼?" (15ch) — Direct speech with ? preserved
Line 6: "이러면 답을 할 수가 없죠" (15ch) — [Object+Predicate] kept intact
Line 7: "이게 도대체 무슨 뜻인데요" (15ch) — [Adverb+Predicate] kept intact
</line_by_line_analysis>
</example>

<example id="2">
<description>Long compound sentence with proper nouns and nested modifier clause. Demonstrates never_split rules.</description>

<input>거기서 광고 매출 잘 나오고 있으니까 그런 거에 장점은 있지만 결국 아마존 마이크로소프트 구글 애플은 결국 토큰을 많이 쓸수록 회사가 좋아지는 회사가 되려고 하고 있고</input>

<correct_output>
거기서 광고 매출 잘 나오고 있으니까
그런 거에 장점은 있지만
결국 아마존 마이크로소프트
구글 애플은 토큰을 많이 쓸수록
회사가 좋아지는 회사가
되려고 하고 있고
</correct_output>

<line_by_line_analysis>
Line 1: "거기서 광고 매출 잘 나오고 있으니까" (20ch) — [Main verb + Auxiliary verb] kept intact
Line 2: "그런 거에 장점은 있지만" (14ch) — Clause ending ~지만
Line 3: "결국 아마존 마이크로소프트" (15ch) — Conjunction starts new line
Line 4: "구글 애플은 토큰을 많이 쓸수록" (17ch) — [Object + Predicate] kept intact
Line 5: "회사가 좋아지는 회사가" (13ch) — [Modifier clause + Head noun] kept intact
Line 6: "되려고 하고 있고" (10ch) — [Main verb + Auxiliary verb + Ending] kept intact
</line_by_line_analysis>

<wrong_output reason="Splits [Main verb + Auxiliary verb]">
거기서 광고 매출 잘 나오고
있으니까 그런 거에 장점은 있지만
</wrong_output>

<wrong_output reason="Splits [Object + Predicate]">
구글 애플은 토큰을 많이
쓸수록 회사가 좋아지는 회사가
</wrong_output>

<wrong_output reason="Splits [Modifier clause + Head noun]">
회사가 좋아지는
회사가 되려고 하고 있고
</wrong_output>
</example>

</examples>

<quote_rules>
- When quoted speech ('...' or "...") spans multiple lines, repeat the quote marks on each line.
- Direct speech always starts a new line.
</quote_rules>

<quality_reminder>
Read this before processing EACH chunk:
- Line 300 must be the same quality as line 1.
- Every line: 15–25 characters. Count them.
- Never split semantic chunks. Break only BETWEEN meaning units.
- If you feel yourself rushing, SLOW DOWN and re-validate.
</quality_reminder>`;

// ─── V2 전처리 (사료 2887-2926) ────────────────────────────────────────

export function preprocessForV2(rawText) {
  let text = rawText
    .replace(/^[-=─]{3,}$/gm, "")
    .replace(/^\d{6}_[^\n]+$/gm, "")
    .replace(/^\d{1,2}:\d{2}(:\d{2})?$/gm, "")
    .replace(/^\d+분\s*\d+초?$/gm, "")
    .replace(/^(싱크|녹취|편|장)\s*[:：].*$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  const words = text.split(/\s+/).filter((w) => w.length > 0);
  const numbered = words.map((w, i) => `[${i + 1}]${w}`).join(" ");
  return { words, numbered, totalWords: words.length };
}

export function chunkWords(words, targetSize = 80) {
  const SENTENCE_ENDINGS = /[.?!]$/;
  const CLAUSE_ENDINGS = /(니다|어요|거든요|잖아요|는데요|네요|세요|죠|고요)$/;
  const chunks = [];
  let start = 0;
  while (start < words.length) {
    let end = Math.min(start + targetSize, words.length);
    if (end < words.length) {
      let bestBreak = -1;
      const searchStart = Math.max(start, start + Math.floor(targetSize * 0.8));
      const searchEnd = Math.min(words.length, start + Math.floor(targetSize * 1.2));
      for (let i = searchEnd - 1; i >= searchStart; i--) {
        if (SENTENCE_ENDINGS.test(words[i]) || CLAUSE_ENDINGS.test(words[i])) {
          bestBreak = i + 1;
          break;
        }
      }
      if (bestBreak > 0) end = bestBreak;
    }
    const chunkW = words.slice(start, end);
    const numbered = chunkW.map((w, i) => `[${start + i + 1}]${w}`).join(" ");
    chunks.push({ words: chunkW, numbered, globalOffset: start });
    start = end;
  }
  return chunks;
}

// ─── V2 후처리 엔진 (사료 2928-3105) ────────────────────────────────────

const V2_MIN_CHARS = 12;
const V2_MAX_CHARS = 28;
const V2_HARD_LIMIT = 35;

export function buildLinesV2(words, breaksAfter) {
  const breakSet = new Set(breaksAfter);
  const lines = [];
  let currentWords = [];
  for (let i = 0; i < words.length; i++) {
    currentWords.push(words[i]);
    if (breakSet.has(i + 1) || i === words.length - 1) {
      const text = currentWords.join(" ");
      lines.push({ text, words: [...currentWords] });
      currentWords = [];
    }
  }
  return lines;
}

async function validateAndResplit(lines, env) {
  const MAX_RETRIES = 2;
  let resplitCount = 0;
  const resplitLines = [];

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const violations = [];
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].text.length > V2_HARD_LIMIT) violations.push(i);
    }
    if (violations.length === 0) break;

    for (let vi = violations.length - 1; vi >= 0; vi--) {
      const idx = violations[vi];
      const start = Math.max(0, idx - 1);
      const end = Math.min(lines.length - 1, idx + 1);
      const contextLines = lines.slice(start, end + 1);
      const contextWords = contextLines.flatMap((l) => l.words);
      const numbered = contextWords.map((w, i) => `[${i + 1}]${w}`).join(" ");

      resplitCount++;
      resplitLines.push(idx);

      const r = await callOpenAI(env, {
        model: "gpt-5.4-mini",
        messages: [buildSystemMessage(SUBTITLE_FORMAT_PROMPT), { role: "user", content: numbered }],
        temperature: 0.1,
        max_tokens: 500,
        response_format: { type: "json_object" },
      });
      if (r.ok) {
        const parsed = openaiJSON(r.data);
        if (parsed && Array.isArray(parsed.breaks_after)) {
          const newBreaks = parsed.breaks_after.filter((n) => typeof n === "number" && n >= 1 && n < contextWords.length);
          const newLines = buildLinesV2(contextWords, newBreaks);
          lines.splice(start, end - start + 1, ...newLines);
        }
      }
    }
  }

  // 최후 fallback: 35ch 초과 남으면 중간 강제 분할
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].text.length > V2_HARD_LIMIT) {
      const ws = lines[i].words;
      const mid = Math.floor(ws.length / 2);
      const line1 = { text: ws.slice(0, mid).join(" "), words: ws.slice(0, mid) };
      const line2 = { text: ws.slice(mid).join(" "), words: ws.slice(mid) };
      lines.splice(i, 1, line1, line2);
    }
  }
  return { lines, resplitCount, resplitLines };
}

export function mergeShortLines(lines) {
  const result = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.words.length <= 1 || line.text.length < V2_MIN_CHARS) {
      // 앞줄과 시도
      if (result.length > 0) {
        const prev = result[result.length - 1];
        const mergedWithPrev = prev.text + " " + line.text;
        if (mergedWithPrev.length <= V2_MAX_CHARS) {
          result[result.length - 1] = { text: mergedWithPrev, words: [...prev.words, ...line.words] };
          continue;
        }
      }
      // 다음 줄과 시도
      if (i + 1 < lines.length) {
        const next = lines[i + 1];
        const mergedWithNext = line.text + " " + next.text;
        if (mergedWithNext.length <= V2_MAX_CHARS) {
          result.push({ text: mergedWithNext, words: [...line.words, ...next.words] });
          i++;
          continue;
        }
      }
    }
    result.push(line);
  }
  return result;
}

export function removeTrailingPunctuation(lines) {
  return lines.map((line) => ({ ...line, text: line.text.replace(/[.,]+$/, "") }));
}

export function fixQuotesV2(lines) {
  let inSingle = false, inDouble = false;
  return lines.map((line) => {
    let text = line.text;
    const sc = (text.match(/'/g) || []).length;
    const dc = (text.match(/"/g) || []).length;
    if (inSingle && !text.startsWith("'")) text = "'" + text;
    if (inDouble && !text.startsWith('"')) text = '"' + text;
    if (sc % 2 === 1) inSingle = !inSingle;
    if (dc % 2 === 1) inDouble = !inDouble;
    if (inSingle && !text.endsWith("'")) text = text + "'";
    if (inDouble && !text.endsWith('"')) text = text + '"';
    return { ...line, text };
  });
}

async function postProcessSubtitleV2(words, breaksAfter, env) {
  let lines = buildLinesV2(words, breaksAfter);
  const resplitResult = await validateAndResplit(lines, env);
  lines = resplitResult.lines;
  lines = mergeShortLines(lines);
  lines = removeTrailingPunctuation(lines);
  lines = fixQuotesV2(lines);
  return {
    text: lines.map((l) => l.text).join("\n"),
    resplitCount: resplitResult.resplitCount,
    resplitLines: resplitResult.resplitLines,
    finalLineCount: lines.length,
  };
}

// ─── V3 후처리 (사료 3258-3342) ────────────────────────────────────────

async function resplitLongLines(lines, env) {
  let resplitCount = 0;
  const result = [];
  for (const line of lines) {
    if (line.length <= 35) { result.push(line); continue; }
    resplitCount++;
    const r = await callOpenAI(env, {
      model: "gpt-5.4-mini",
      messages: [buildSystemMessage(SUBTITLE_FORMAT_PROMPT_V3), { role: "user", content: line }],
      temperature: 0.1,
      max_tokens: 1000,
    });
    if (r.ok) {
      const text = (openaiText(r.data) || "").trim();
      const newLines = text.split("\n").filter((l) => l.trim());
      if (newLines.length > 1) { result.push(...newLines); continue; }
    }
    result.push(line);
  }
  return { lines: result, resplitCount };
}

export function mergeShortLinesSimple(lines) {
  const result = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed) continue;
    const wordCount = trimmed.split(/\s+/).length;
    if (wordCount <= 1 || trimmed.length < 10) {
      if (result.length > 0 && (result[result.length - 1] + " " + trimmed).length <= 28) {
        result[result.length - 1] += " " + trimmed;
        continue;
      }
      if (i + 1 < lines.length && (trimmed + " " + lines[i + 1].trim()).length <= 28) {
        result.push(trimmed + " " + lines[i + 1].trim());
        i++;
        continue;
      }
    }
    result.push(trimmed);
  }
  return result;
}

export function removeTrailingPuncSimple(lines) {
  return lines.map((l) => {
    let s = l.trimEnd();
    while (s.endsWith(".") || s.endsWith(",")) s = s.slice(0, -1).trimEnd();
    return s;
  }).filter((l) => l.length > 0);
}

export function fixQuotesSimple(lines) {
  let inSingle = false, inDouble = false;
  return lines.map((line) => {
    let text = line;
    const sc = (text.match(/'/g) || []).length;
    const dc = (text.match(/"/g) || []).length;
    if (inSingle && !text.startsWith("'")) text = "'" + text;
    if (inDouble && !text.startsWith('"')) text = '"' + text;
    if (sc % 2 === 1) inSingle = !inSingle;
    if (dc % 2 === 1) inDouble = !inDouble;
    if (inSingle && !text.endsWith("'")) text = text + "'";
    if (inDouble && !text.endsWith('"')) text = text + '"';
    return text;
  });
}

/**
 * /subtitle-format handler — V3 + V2 + V1 하위 호환 3-branch dispatch.
 *
 * 사료: editor/worker/index.js:3348-3570 (prod handleSubtitleFormat)
 *
 * @param body { version?: "v3"|"v2", text?, words?, blocks? }
 *   - V3: { version:"v3", text } — 화자 턴 단위, plain text 응답
 *   - V2: { version:"v2", text(numbered), words } — Word-Index, breaks_after JSON
 *   - V1: { blocks: [{text}] } — fallback, 자동 청크 + V2 흐름
 */
export async function handleSubtitleFormat(body, env, headers, user) {
  if (!body || typeof body !== "object") return badRequest(headers, "body 필수");
  if (!env?.OPENAI_API_KEY) {
    return jsonResponse({ success: false, error: "OPENAI_API_KEY not configured", code: 503 }, { status: 503 }, headers);
  }

  // ── V3 branch ─────────────────────────────────────────────────────────
  if (body.version === "v3" && typeof body.text === "string" && body.text.length > 0) {
    const inputText = body.text;
    const r = await callOpenAI(env, {
      model: "gpt-5.4-mini",
      messages: [buildSystemMessage(SUBTITLE_FORMAT_PROMPT_V3), { role: "user", content: inputText }],
      temperature: 0.1,
      max_tokens: 4000,
    });
    if (!r.ok) {
      const status = r.status === 429 ? 429 : (r.status >= 400 ? r.status : 502);
      return jsonResponse({ success: false, error: r.error || "LLM call failed", _debug: { version: "v3", inputLength: inputText.length } }, { status }, headers);
    }
    const rawText = (openaiText(r.data) || "").trim();
    const finishReason = r.data?.choices?.[0]?.finish_reason;
    if (!rawText) {
      return jsonResponse({ success: false, error: "Empty response", _debug: { version: "v3", finishReason } }, { status: 500 }, headers);
    }

    // 후처리 chain
    let lines = rawText.split("\n").filter((l) => l.trim());
    lines = removeTrailingPuncSimple(lines);
    lines = mergeShortLinesSimple(lines);
    lines = fixQuotesSimple(lines);
    const resplitResult = await resplitLongLines(lines, env);
    lines = resplitResult.lines;

    const formatted = lines.join("\n");
    const inputClean = inputText.replace(/\s+/g, "");
    const outputClean = formatted.replace(/[\n\s]+/g, "");
    const ratio = inputClean.length > 0 ? Math.round((outputClean.length / inputClean.length) * 100) : 100;

    return jsonResponse({
      success: true,
      formatted,
      _debug: {
        version: "v3",
        inputLength: inputText.length,
        outputLength: formatted.length,
        lineCount: lines.length,
        ratio,
        truncated: ratio < 80,
        resplitCount: resplitResult.resplitCount,
        finishReason,
      },
    }, { status: 200 }, headers);
  }

  // ── V2 branch ─────────────────────────────────────────────────────────
  if (body.version === "v2" && typeof body.text === "string" && Array.isArray(body.words)) {
    const numbered = body.text;
    const words = body.words;
    const wordCount = words.length;

    let r = await callOpenAI(env, {
      model: "gpt-5.4-mini",
      messages: [buildSystemMessage(SUBTITLE_FORMAT_PROMPT), { role: "user", content: numbered }],
      temperature: 0.1,
      max_tokens: 2000,
      response_format: { type: "json_object" },
    });

    // 429 1회 재시도
    if (!r.ok && r.status === 429) {
      await new Promise((resolve) => setTimeout(resolve, 3000));
      r = await callOpenAI(env, {
        model: "gpt-5.4-mini",
        messages: [buildSystemMessage(SUBTITLE_FORMAT_PROMPT), { role: "user", content: numbered }],
        temperature: 0.1,
        max_tokens: 2000,
        response_format: { type: "json_object" },
      });
    }
    if (!r.ok) {
      return jsonResponse(
        { success: false, error: r.error || "LLM call failed", _debug: { wordCount } },
        { status: r.status >= 400 ? r.status : 502 },
        headers
      );
    }

    const parsed = openaiJSON(r.data);
    const finishReason = r.data?.choices?.[0]?.finish_reason;
    let breaksAfter = null;
    if (parsed && Array.isArray(parsed.breaks_after)) {
      breaksAfter = parsed.breaks_after.filter((n) => typeof n === "number" && n >= 1 && n < wordCount);
    }
    // fallback: 글자수 기반 자동 분할
    if (!breaksAfter || breaksAfter.length === 0) {
      breaksAfter = [];
      let charCount = 0;
      for (let i = 0; i < words.length - 1; i++) {
        charCount += words[i].length + 1;
        if (charCount >= 20) { breaksAfter.push(i + 1); charCount = 0; }
      }
    }

    const ppResult = await postProcessSubtitleV2(words, breaksAfter, env);
    return jsonResponse({
      success: true,
      formatted: ppResult.text,
      _debug: {
        version: "v2.2-p005",
        wordCount,
        breaksCount: breaksAfter.length,
        breaksAfter,
        resplitCount: ppResult.resplitCount,
        resplitLines: ppResult.resplitLines,
        finalLineCount: ppResult.finalLineCount,
        outputLength: ppResult.text.length,
        finishReason,
      },
    }, { status: 200 }, headers);
  }

  // ── V1 하위 호환 branch ─────────────────────────────────────────────────
  const { blocks } = body;
  if (!Array.isArray(blocks) || blocks.length === 0) {
    return badRequest(headers, "text/version or blocks required");
  }

  const fullText = blocks.map((b) => b.text || "").join("\n");
  const { words } = preprocessForV2(fullText);
  const wordChunks = chunkWords(words);

  let allBreaksAfter = [];
  for (const chunk of wordChunks) {
    const r = await callOpenAI(env, {
      model: "gpt-5.4-mini",
      messages: [buildSystemMessage(SUBTITLE_FORMAT_PROMPT), { role: "user", content: chunk.numbered }],
      temperature: 0.1,
      max_tokens: 2000,
      response_format: { type: "json_object" },
    });
    if (r.ok) {
      const parsed = openaiJSON(r.data);
      if (parsed && Array.isArray(parsed.breaks_after)) {
        allBreaksAfter.push(...parsed.breaks_after.filter((n) => typeof n === "number" && n >= 1 && n <= words.length));
      }
    }
  }
  allBreaksAfter = [...new Set(allBreaksAfter)].sort((a, b) => a - b);
  if (allBreaksAfter.length === 0) {
    let cc = 0;
    for (let i = 0; i < words.length - 1; i++) {
      cc += words[i].length + 1;
      if (cc >= 20) { allBreaksAfter.push(i + 1); cc = 0; }
    }
  }

  const ppResult = await postProcessSubtitleV2(words, allBreaksAfter, env);
  return jsonResponse(
    { success: true, formatted: ppResult.text, blocks: [{ index: 0, text: ppResult.text }] },
    { status: 200 },
    headers
  );
}
