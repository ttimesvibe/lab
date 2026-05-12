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
      max_tokens: 32000,
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
export const handleTermExplain = makeStubHandler("/term-explain", "용어 설명");
export const handleVisuals = makeStubHandler("/visuals", "자료·그래픽 추천");
export const handleInsertCuts = makeStubHandler("/insert-cuts", "인서트 추천");
export const handleHlRecommend = makeStubHandler("/hl-recommend", "하이라이트 추천");
export const handleHlTimestamps = makeStubHandler("/hl-timestamps", "하이라이트 타임스탬프");
export const handleSetgen = makeStubHandler("/setgen", "세트 생성");
export const handleSubtitleFormat = makeStubHandler("/subtitle-format", "자막 포맷팅 V2.2 (★ N4)");
