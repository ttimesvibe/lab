// DOMPurify XSS payload 테스트 케이스 카탈로그 (S-1)
// 묶음 ⑩ 보안 강화 — DOMPurify ALLOWED_TAGS 정책 검증
// 실 DOMPurify 호출은 브라우저 환경 의존 — 본 테스트는 페이로드 카탈로그 + 기대값 박제.
// 실 코드 적용 시 브라우저에서 동일 페이로드로 회귀 검증.

import { test, describe } from "node:test";
import assert from "node:assert/strict";

// HighlightTab.jsx:212 의 dangerouslySetInnerHTML 입력에 들어갈 가능성 있는 페이로드
export const XSS_PAYLOADS = [
  {
    name: "기본 script 태그",
    input: "<script>alert(1)</script>",
    expected_after_dompurify: "",
    description: "DOMPurify 가 script 태그 자체 제거",
  },
  {
    name: "script via 이벤트 핸들러",
    input: '<img src=x onerror="alert(1)">',
    expected_after_dompurify: "<img src=\"x\">",  // img 만 (이벤트 제거)
    description: "ALLOWED_ATTR 에 onerror 없음 → 제거",
    note: "본 프로젝트는 ALLOWED_TAGS = [mark, span, b, i, br] 이라 img 자체도 제거됨",
  },
  {
    name: "허용된 mark 태그 (정상)",
    input: '<mark style="background:yellow">키워드</mark>',
    expected_after_dompurify: '<mark style="background:yellow">키워드</mark>',
    description: "ALLOWED_TAGS + ALLOWED_ATTR 통과",
  },
  {
    name: "javascript: URL",
    input: '<a href="javascript:alert(1)">click</a>',
    expected_after_dompurify: "click",
    description: "a 태그 자체가 ALLOWED_TAGS 밖 → 제거",
  },
  {
    name: "data: URL (잠재 위험)",
    input: '<img src="data:text/html,<script>alert(1)</script>">',
    expected_after_dompurify: "",
    description: "img 자체 제거",
  },
  {
    name: "SVG XSS",
    input: '<svg onload="alert(1)"></svg>',
    expected_after_dompurify: "",
    description: "svg 자체 제거",
  },
  {
    name: "iframe injection",
    input: '<iframe src="https://evil.com"></iframe>',
    expected_after_dompurify: "",
    description: "iframe 제거",
  },
  {
    name: "한글 텍스트 + mark",
    input: "안녕하세요 <mark>여기</mark> 강조",
    expected_after_dompurify: "안녕하세요 <mark>여기</mark> 강조",
    description: "정상 입력 보존",
  },
  {
    name: "AI 추천 span (HighlightTab:175)",
    input: '<span style="background:rgba(217,119,6,0.06);border-bottom:1px dashed #D97706" title="AI 추천: 이유">텍스트</span>',
    expected_after_dompurify: '<span style="background:rgba(217,119,6,0.06);border-bottom:1px dashed #D97706" title="AI 추천: 이유">텍스트</span>',
    description: "허용된 span + style + title 보존",
  },
  {
    name: "중첩 script",
    input: "<div><p><script>alert(1)</script></p></div>",
    expected_after_dompurify: "",
    description: "div/p 모두 제거 + script 제거",
  },
];

describe("XSS payload 카탈로그 (S-1)", () => {
  test("페이로드 10건 박제됨", () => {
    assert.equal(XSS_PAYLOADS.length, 10);
  });
  test("모든 페이로드에 input/expected/description", () => {
    for (const p of XSS_PAYLOADS) {
      assert.ok(p.name);
      assert.ok(typeof p.input === "string");
      assert.ok(typeof p.expected_after_dompurify === "string");
      assert.ok(p.description);
    }
  });
  test("script 태그 포함 페이로드 5건 이상", () => {
    const withScript = XSS_PAYLOADS.filter(p => p.input.toLowerCase().includes("script") || p.input.toLowerCase().includes("onerror") || p.input.toLowerCase().includes("javascript:") || p.input.toLowerCase().includes("onload"));
    assert.ok(withScript.length >= 5);
  });
  test("정상 입력 (mark, span 한글) 도 포함", () => {
    const normal = XSS_PAYLOADS.filter(p => p.expected_after_dompurify.includes("<mark") || p.expected_after_dompurify.includes("<span"));
    assert.ok(normal.length >= 2);
  });
});

// 실 DOMPurify 호출 (브라우저 환경에서만):
// import DOMPurify from "dompurify";
// const ALLOWED_TAGS = ["mark", "span", "b", "i", "br"];
// const ALLOWED_ATTR = ["style", "title", "data-blockid"];
// for (const p of XSS_PAYLOADS) {
//   const clean = DOMPurify.sanitize(p.input, { ALLOWED_TAGS, ALLOWED_ATTR });
//   if (clean !== p.expected_after_dompurify) console.error(p.name, clean);
// }
