// lab fresh v2 — 인터뷰 텍스트 → reviewBlocks 파서 (★ 실 UI Phase 1)
// 사료: editor/docs/src/utils/lengthModel.js (prod parseBlocks 정합 port)
//
// 책임:
//   - text → 블록 array: { index, speaker, timestamp, text, lines }
//   - 3 패턴: "화자 MM:SS" (next line body) / "화자 MM:SS body inline" / "참석자 N MM:SS body"

/**
 * Parse interview transcript text into structured blocks.
 *
 * @param {string} text — full text of the transcript (cleanText or fullText)
 * @returns {Array<{ index, speaker, timestamp, text, lines }>}
 */
export function parseBlocks(text) {
  const lines = (text || "").split("\n");
  const blocks = [];
  let cur = null;

  // 패턴 1: "화자 MM:SS" (줄 전체가 화자+타임스탬프만 — 다음 줄이 본문)
  const hdr = /^(.+?)\s+(\d{1,2}:\d{2}(?::\d{2})?)\s*$/;
  // 패턴 2: "화자 MM:SS 본문내용" (인라인, 한글/영문 화자명)
  const hdrInline = /^([가-힣a-zA-Z\s]{2,15}?)\s+(\d{1,2}:\d{2}(?::\d{2})?)\s*(.+)$/;
  // 패턴 3: "참석자 N MM:SS본문" — "참석자/화자/Speaker + 숫자" 전용
  const hdrNumbered = /^((?:참석자|화자|Speaker)\s*\d+)\s+(\d{1,2}:\d{2}(?::\d{2})?)\s*(.*)$/;

  for (const line of lines) {
    const t = line.trim();
    if (!t) {
      if (cur) { blocks.push(cur); cur = null; }
      continue;
    }
    // 패턴 3 먼저 (가장 구체적)
    const m3 = t.match(hdrNumbered);
    if (m3) {
      if (cur) blocks.push(cur);
      const bodyText = (m3[3] || "").trim();
      cur = { index: blocks.length, speaker: m3[1].trim(), timestamp: m3[2], text: bodyText, lines: bodyText ? [bodyText] : [] };
      continue;
    }
    const m = t.match(hdr);
    if (m) {
      if (cur) blocks.push(cur);
      cur = { index: blocks.length, speaker: m[1], timestamp: m[2], text: "", lines: [] };
    } else {
      const m2 = t.match(hdrInline);
      if (m2) {
        if (cur) blocks.push(cur);
        const bodyText = m2[3].trim();
        cur = { index: blocks.length, speaker: m2[1].trim(), timestamp: m2[2], text: bodyText, lines: [bodyText] };
      } else if (cur) {
        cur.text += (cur.text ? "\n" : "") + t;
        cur.lines.push(t);
      } else {
        cur = { index: blocks.length, speaker: "—", timestamp: "", text: t, lines: [t] };
      }
    }
  }
  if (cur) blocks.push(cur);
  return blocks.map((b, i) => ({ ...b, index: i }));
}

/**
 * Compose manuscript + review data from raw docx parse result.
 *
 * @param {object} tc — { paragraphs, hasTrackChanges, fullText, cleanText }
 * @param {string} fileName
 * @returns {{ manuscript, review }} — 두 탭 data 동시 갱신용
 */
export function buildManuscriptAndReview(tc, fileName) {
  const reviewBlocks = parseBlocks(tc.fullText || "");
  // computeBlockStrikes 는 docxParser 에서 import (순환 X — 호출처에서 합성)
  return {
    manuscript: {
      text: tc.cleanText,
      fileName,
      paragraphs: tc.paragraphs,
      hasTrackChanges: tc.hasTrackChanges,
      fullText: tc.fullText,
    },
    review: {
      reviewBlocks,
      paragraphs: tc.paragraphs,
      cleanText: tc.cleanText,
      hasTrackChanges: tc.hasTrackChanges,
      // blockStrikeRanges / deletedBlockIndices 는 호출처에서 computeBlockStrikes 후 합성
    },
  };
}
