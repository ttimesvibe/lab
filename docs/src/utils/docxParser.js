// lab fresh v2 — DOCX track changes 파서 (★ 실 UI Phase 1)
// 사료: editor/docs/src/utils/docxParser.js (prod 정합 port)
//
// 책임:
//   - DOCX 파일의 변경 추적 (track changes) 파싱
//   - w:strike / w:dstrike 검출 (90% 누락 회피 — val=false/0 만 제외)
//   - paragraphs/segments → fullText (삭제 포함) + cleanText (삭제 제외)
//   - computeBlockStrikes: reviewBlocks 별 삭제 구간 + 80% 삭제 블록

import JSZip from "jszip";

// w:strike / w:dstrike — val=false/0 만 negative lookahead 로 제외
export const STRIKE_DETECT_RE = /<w:(?:strike|dstrike)(?:\s+w:val="(?!(?:false|0)")[^"]*")?\s*\/>|<w:(?:strike|dstrike)(?:\s+w:val="(?!(?:false|0)")[^"]*")?\s*><\/w:(?:strike|dstrike)>/;

/**
 * Parse DOCX with Word's track changes (w:del) preserved.
 * @param {ArrayBuffer} arrayBuffer
 * @returns {Promise<{ paragraphs, hasTrackChanges, fullText, cleanText }>}
 */
export async function parseDocxWithTrackChanges(arrayBuffer) {
  const zip = await JSZip.loadAsync(arrayBuffer);
  const docXml = await zip.file("word/document.xml")?.async("string");
  if (!docXml) throw new Error("word/document.xml을 찾을 수 없습니다");

  const bodyMatch = docXml.match(/<w:body[^>]*>([\s\S]*?)<\/w:body>/);
  if (!bodyMatch) throw new Error("문서 본문을 찾을 수 없습니다");
  const bodyXml = bodyMatch[1];

  const paragraphs = parseBodyXml(bodyXml);
  const hasTrackChanges = paragraphs.some((p) => p.some((s) => s.deleted));
  const fullText = paragraphs.map((p) => p.map((s) => s.text).join("")).join("\n");
  const cleanText = paragraphs.map((p) => p.filter((s) => !s.deleted).map((s) => s.text).join("")).join("\n");
  return { paragraphs, hasTrackChanges, fullText, cleanText };
}

/**
 * 본문 XML (w:body 내부) → paragraphs.
 *   paragraphs: Array<Array<{text, deleted}>>
 *
 * ★ self-closing <w:del .../> + <w:ins .../> 은 먼저 skip (단락 마크 표시,
 *   본문 텍스트 영향 X). 안 그러면 후속 [^>]* 가 self-closing 의 `/` 까지
 *   흡수해 다음 </w:del> 까지 swallow 하는 버그 발생.
 */
export function parseBodyXml(bodyXml) {
  const paragraphs = [];
  const pRegex = /<w:p[ >][\s\S]*?<\/w:p>/g;
  let pMatch;
  while ((pMatch = pRegex.exec(bodyXml)) !== null) {
    const pXml = pMatch[0];
    const segments = [];
    const tokenRegex = /<w:del\b[^>]*\/>|<w:ins\b[^>]*\/>|<w:del\b[^>]*>([\s\S]*?)<\/w:del>|<w:ins\b[^>]*>([\s\S]*?)<\/w:ins>|<w:r[ >]([\s\S]*?)<\/w:r>/g;
    let tMatch;
    while ((tMatch = tokenRegex.exec(pXml)) !== null) {
      if (tMatch[1] === undefined && tMatch[2] === undefined && tMatch[3] === undefined) continue;
      if (tMatch[1] !== undefined) {
        const delText = extractTextFromRuns(tMatch[1]);
        if (delText) segments.push({ text: delText, deleted: true });
      } else if (tMatch[2] !== undefined) {
        const insText = extractTextFromRuns(tMatch[2]);
        if (insText) segments.push({ text: insText, deleted: false });
      } else if (tMatch[3] !== undefined) {
        const runContent = tMatch[3];
        const runText = extractTextFromRun(runContent);
        const isStrike = STRIKE_DETECT_RE.test(runContent);
        if (runText) segments.push({ text: runText, deleted: isStrike });
      }
    }
    if (segments.length > 0) paragraphs.push(segments);
  }
  return paragraphs;
}

export function extractTextFromRuns(xml) {
  const texts = [];
  const rRegex = /<w:r[ >][\s\S]*?<\/w:r>/g;
  let m;
  while ((m = rRegex.exec(xml)) !== null) {
    const t = extractTextFromRun(m[0]);
    if (t !== "") texts.push(t);
  }
  return texts.join("");
}

export function extractTextFromRun(runXml) {
  const texts = [];
  const tokenRegex = /<w:(?:t|delText)[^>]*>([\s\S]*?)<\/w:(?:t|delText)>|<w:br\/>/g;
  let m;
  while ((m = tokenRegex.exec(runXml)) !== null) {
    if (m[1] !== undefined) texts.push(m[1]);
    else texts.push("\n");
  }
  return texts.join("");
}

/**
 * paragraphs (track changes 세그먼트) + reviewBlocks → 블록별 삭제 구간.
 *   - blockStrikeRanges: { [blockIndex]: [{s, e}, ...] }
 *   - deletedBlockIndices: number[] (80% 이상 삭제)
 */
export function computeBlockStrikes(paragraphs, reviewBlocks, fullText) {
  const charMap = [];
  for (let pi = 0; pi < paragraphs.length; pi++) {
    for (const seg of paragraphs[pi]) {
      for (let ci = 0; ci < seg.text.length; ci++) charMap.push(seg.deleted);
    }
    if (pi < paragraphs.length - 1) charMap.push(false);
  }

  const blockStrikeRanges = {};
  const deletedBlockIndices = new Set();
  let searchFrom = 0;

  for (const rb of reviewBlocks) {
    const blockStart = fullText.indexOf(rb.text, searchFrom);
    if (blockStart === -1) continue;
    searchFrom = blockStart + rb.text.length;

    const ranges = [];
    let rangeStart = -1;
    let deletedCount = 0;
    for (let ci = 0; ci < rb.text.length; ci++) {
      const isDel = (blockStart + ci) < charMap.length && charMap[blockStart + ci];
      if (isDel) {
        deletedCount++;
        if (rangeStart === -1) rangeStart = ci;
      } else {
        if (rangeStart !== -1) { ranges.push({ s: rangeStart, e: ci }); rangeStart = -1; }
      }
    }
    if (rangeStart !== -1) ranges.push({ s: rangeStart, e: rb.text.length });

    if (ranges.length > 0) blockStrikeRanges[rb.index] = ranges;
    const textLen = rb.text.replace(/\s/g, "").length;
    if (textLen > 0 && deletedCount >= textLen * 0.8) deletedBlockIndices.add(rb.index);
  }
  return { blockStrikeRanges, deletedBlockIndices: [...deletedBlockIndices] };
}
