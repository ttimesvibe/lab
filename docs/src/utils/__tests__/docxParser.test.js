// lab fresh v2 — docxParser + parseBlocks 단위 테스트
// 사료: editor/docs/src/utils/docxParser.test.js (prod 회귀 테스트 정합)

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseBodyXml, extractTextFromRun, extractTextFromRuns, computeBlockStrikes,
  STRIKE_DETECT_RE,
} from "../docxParser.js";
import { parseBlocks, stripStrikeFromBlocks } from "../parseBlocks.js";

// ─── STRIKE_DETECT_RE ────────────────────────────────────────────────────

test("STRIKE_DETECT_RE: 다양한 strike 형태 검출 + val=false/0 제외", () => {
  // 매칭 (true)
  assert.match("<w:strike/>", STRIKE_DETECT_RE);
  assert.match('<w:strike w:val="true"/>', STRIKE_DETECT_RE);
  assert.match('<w:strike w:val="1"/>', STRIKE_DETECT_RE);
  assert.match("<w:dstrike/>", STRIKE_DETECT_RE);
  assert.match("<w:strike></w:strike>", STRIKE_DETECT_RE);
  // 제외
  assert.doesNotMatch('<w:strike w:val="false"/>', STRIKE_DETECT_RE);
  assert.doesNotMatch('<w:strike w:val="0"/>', STRIKE_DETECT_RE);
});

// ─── extractTextFromRun ──────────────────────────────────────────────────

test("extractTextFromRun: w:t 본문 추출", () => {
  const xml = '<w:rPr/><w:t>안녕하세요</w:t>';
  assert.equal(extractTextFromRun(xml), "안녕하세요");
});

test("extractTextFromRun: w:br 줄바꿈 처리", () => {
  const xml = '<w:t>줄1</w:t><w:br/><w:t>줄2</w:t>';
  assert.equal(extractTextFromRun(xml), "줄1\n줄2");
});

test("extractTextFromRun: w:delText 도 매칭", () => {
  const xml = '<w:delText>삭제될 텍스트</w:delText>';
  assert.equal(extractTextFromRun(xml), "삭제될 텍스트");
});

// ─── parseBodyXml ────────────────────────────────────────────────────────

test("parseBodyXml: 단순 w:p / w:r / w:t 파싱", () => {
  const body = '<w:p><w:r><w:t>첫째 단락</w:t></w:r></w:p><w:p><w:r><w:t>둘째 단락</w:t></w:r></w:p>';
  const p = parseBodyXml(body);
  assert.equal(p.length, 2);
  assert.deepEqual(p[0], [{ text: "첫째 단락", deleted: false }]);
  assert.deepEqual(p[1], [{ text: "둘째 단락", deleted: false }]);
});

test("parseBodyXml: strike 검출 → deleted: true", () => {
  const body = '<w:p><w:r><w:rPr><w:strike/></w:rPr><w:t>삭제선</w:t></w:r></w:p>';
  const p = parseBodyXml(body);
  assert.equal(p[0][0].deleted, true);
});

test("parseBodyXml: w:del 블록 → 삭제 텍스트로 마킹", () => {
  const body = '<w:p><w:del><w:r><w:delText>삭제됨</w:delText></w:r></w:del><w:r><w:t>유지</w:t></w:r></w:p>';
  const p = parseBodyXml(body);
  // segments 순서: del 먼저 (deleted: true), 그 다음 일반 run (deleted: false)
  assert.equal(p[0].length, 2);
  assert.equal(p[0][0].text, "삭제됨");
  assert.equal(p[0][0].deleted, true);
  assert.equal(p[0][1].text, "유지");
  assert.equal(p[0][1].deleted, false);
});

test("parseBodyXml: ★ self-closing <w:del/> 은 후속 텍스트 swallow X (회귀)", () => {
  // self-closing w:del 은 단락 마크 표시 — skip 해야 함
  const body = '<w:p><w:del w:id="1"/><w:r><w:t>이건 정상 텍스트</w:t></w:r></w:p>';
  const p = parseBodyXml(body);
  assert.equal(p[0].length, 1);
  assert.equal(p[0][0].text, "이건 정상 텍스트");
  assert.equal(p[0][0].deleted, false);
});

// ─── parseBlocks ─────────────────────────────────────────────────────────

test("parseBlocks: 빈 문자열 → []", () => {
  assert.deepEqual(parseBlocks(""), []);
});

test("parseBlocks: 패턴 1 '화자 MM:SS\\n본문'", () => {
  const text = "홍재의 00:00\n안녕하세요 오늘 인터뷰입니다";
  const blocks = parseBlocks(text);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].speaker, "홍재의");
  assert.equal(blocks[0].timestamp, "00:00");
  assert.equal(blocks[0].text, "안녕하세요 오늘 인터뷰입니다");
  assert.equal(blocks[0].index, 0);
});

test("parseBlocks: 패턴 2 인라인 '홍재의 00:00 본문'", () => {
  const text = "홍재의 00:00 본문 시작";
  const blocks = parseBlocks(text);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].speaker, "홍재의");
  assert.equal(blocks[0].text, "본문 시작");
});

test("parseBlocks: 패턴 3 '참석자 1 00:00본문'", () => {
  const text = "참석자 1 00:00안녕하세요";
  const blocks = parseBlocks(text);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].speaker, "참석자 1");
  assert.equal(blocks[0].timestamp, "00:00");
});

test("parseBlocks: 여러 블록 + 빈 줄 separator", () => {
  const text = "홍재의 00:00\n안녕하세요\n\n강정수 00:30\n반갑습니다";
  const blocks = parseBlocks(text);
  assert.equal(blocks.length, 2);
  assert.equal(blocks[0].speaker, "홍재의");
  assert.equal(blocks[1].speaker, "강정수");
  assert.equal(blocks[1].timestamp, "00:30");
  // index 재정렬
  assert.equal(blocks[0].index, 0);
  assert.equal(blocks[1].index, 1);
});

test("parseBlocks: 화자 없는 텍스트 → speaker '—'", () => {
  const text = "그냥 본문만 있는 텍스트";
  const blocks = parseBlocks(text);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].speaker, "—");
  assert.equal(blocks[0].timestamp, "");
});

test("parseBlocks: HH:MM:SS 타임스탬프 (1시간 초과)", () => {
  const text = "홍재의 01:23:45\n긴 인터뷰";
  const blocks = parseBlocks(text);
  assert.equal(blocks[0].timestamp, "01:23:45");
});

// ─── computeBlockStrikes ─────────────────────────────────────────────────

test("computeBlockStrikes: 삭제 구간 없음 → 빈 결과", () => {
  const paragraphs = [[{ text: "정상 텍스트입니다", deleted: false }]];
  const reviewBlocks = [{ index: 0, text: "정상 텍스트입니다" }];
  const r = computeBlockStrikes(paragraphs, reviewBlocks, "정상 텍스트입니다");
  assert.deepEqual(r.blockStrikeRanges, {});
  assert.deepEqual(r.deletedBlockIndices, []);
});

test("computeBlockStrikes: 부분 삭제 → ranges 박제", () => {
  // "안녕[삭제]하세요" — 5~8자 deleted
  const paragraphs = [[
    { text: "안녕", deleted: false },
    { text: "[삭제]", deleted: true },
    { text: "하세요", deleted: false },
  ]];
  const fullText = "안녕[삭제]하세요";
  const reviewBlocks = [{ index: 0, text: fullText }];
  const r = computeBlockStrikes(paragraphs, reviewBlocks, fullText);
  assert.ok(r.blockStrikeRanges[0]);
  assert.equal(r.blockStrikeRanges[0].length, 1);
  // [삭제] = 4 chars (chars 2-5)
  assert.equal(r.blockStrikeRanges[0][0].s, 2);
  assert.equal(r.blockStrikeRanges[0][0].e, 6);
});

// ─── stripStrikeFromBlocks (★ Phase 3b fix — LLM 입력 strike 제외) ───────

test("stripStrikeFromBlocks: ranges 없으면 원본 그대로", () => {
  const blocks = [{ index: 0, text: "안녕하세요" }];
  const r = stripStrikeFromBlocks(blocks, {});
  assert.equal(r[0].text, "안녕하세요");
});

test("stripStrikeFromBlocks: 단일 range 제거", () => {
  // "안녕[삭제]하세요" — chars 2-6 삭제
  const blocks = [{ index: 0, text: "안녕[삭제]하세요" }];
  const ranges = { 0: [{ s: 2, e: 6 }] };
  const r = stripStrikeFromBlocks(blocks, ranges);
  assert.equal(r[0].text, "안녕하세요");
});

test("stripStrikeFromBlocks: 여러 range 제거 (뒤에서부터 처리, 인덱스 안 밀림)", () => {
  // "ABC[X]DEF[Y]GHI" — chars 3-6 (X) + 9-12 (Y) 삭제
  const blocks = [{ index: 0, text: "ABC[X]DEF[Y]GHI" }];
  const ranges = { 0: [{ s: 3, e: 6 }, { s: 9, e: 12 }] };
  const r = stripStrikeFromBlocks(blocks, ranges);
  assert.equal(r[0].text, "ABCDEFGHI");
});

test("stripStrikeFromBlocks: blockIndex 별 독립 처리", () => {
  const blocks = [
    { index: 0, text: "AAAAA" },        // strip
    { index: 1, text: "BBBBB" },        // 그대로
    { index: 2, text: "CCCCC" },        // strip
  ];
  const ranges = {
    0: [{ s: 1, e: 3 }],
    2: [{ s: 2, e: 4 }],
  };
  const r = stripStrikeFromBlocks(blocks, ranges);
  assert.equal(r[0].text, "AAA");
  assert.equal(r[1].text, "BBBBB");
  assert.equal(r[2].text, "CCC");
});

test("stripStrikeFromBlocks: blockStrikeRanges null/undefined → 그대로 반환", () => {
  const blocks = [{ index: 0, text: "ABC" }];
  assert.equal(stripStrikeFromBlocks(blocks, null)[0].text, "ABC");
  assert.equal(stripStrikeFromBlocks(blocks, undefined)[0].text, "ABC");
});

test("computeBlockStrikes: 80% 이상 삭제 → deletedBlockIndices", () => {
  const paragraphs = [[{ text: "거의 다 삭제된 블록입니다", deleted: true }]];
  const fullText = "거의 다 삭제된 블록입니다";
  const reviewBlocks = [{ index: 0, text: fullText }];
  const r = computeBlockStrikes(paragraphs, reviewBlocks, fullText);
  assert.ok(r.deletedBlockIndices.includes(0));
});
