// lab fresh v2 — ManuscriptTab (★ 실 UI Phase 1, mammoth.js docx 업로드)
// 사료: S2.4.2.k 원고 + editor/docs/src/views/NewProjectModal.jsx readFile()
// W-2 영역: manuscript 재업로드 시 5 cap 백업 (utils/backup.js 의 manuscript_replace type)

import { useState, useRef } from "react";
import * as mammoth from "mammoth";
import { parseDocxWithTrackChanges, computeBlockStrikes } from "../utils/docxParser.js";
import { parseBlocks } from "../utils/parseBlocks.js";

/**
 * Read docx file → { text, fullText, paragraphs, hasTrackChanges }
 * 1차: parseDocxWithTrackChanges (변경 추적 보존)
 * fallback: mammoth.extractRawText (삭제선 없음)
 */
async function readDocxFile(file) {
  if (!file.name.toLowerCase().endsWith(".docx")) {
    const text = await file.text();
    return { text, fullText: text, paragraphs: null, hasTrackChanges: false };
  }
  const arrayBuffer = await file.arrayBuffer();
  try {
    const tc = await parseDocxWithTrackChanges(arrayBuffer.slice(0));
    return {
      text: tc.cleanText,
      fullText: tc.fullText,
      paragraphs: tc.paragraphs,
      hasTrackChanges: tc.hasTrackChanges,
    };
  } catch (e) {
    console.warn("[ManuscriptTab] track changes 파싱 실패, mammoth fallback:", e.message);
    const result = await mammoth.extractRawText({ arrayBuffer });
    return { text: result.value, fullText: result.value, paragraphs: null, hasTrackChanges: false };
  }
}

export function ManuscriptTab({ tabId, data, onSave, onMultiSave, sessionId, config, currentTab, authUser }) {
  const text = data?.text || "";
  const fileName = data?.fileName || "";
  const paragraphs = data?.paragraphs || [];
  const hasTrackChanges = data?.hasTrackChanges || false;

  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const fileInputRef = useRef(null);

  async function handleFileUpload(file) {
    if (!file) return;
    if (text && !confirm(`이미 원고가 박혀있습니다. 새 파일로 교체하시겠습니까?`)) return;

    setUploading(true);
    setError("");
    try {
      const tc = await readDocxFile(file);

      // 원고 + 0차 검토 derived 양탭 동시 갱신
      const manuscriptData = {
        text: tc.text,
        fileName: file.name,
        paragraphs: tc.paragraphs,
        hasTrackChanges: tc.hasTrackChanges,
        fullText: tc.fullText,
      };

      // 0차 검토 derive: fullText → reviewBlocks → blockStrikeRanges
      const reviewBlocks = parseBlocks(tc.fullText || tc.text || "");
      let blockStrikeRanges = {};
      let deletedBlockIndices = [];
      if (tc.paragraphs && Array.isArray(tc.paragraphs)) {
        const r = computeBlockStrikes(tc.paragraphs, reviewBlocks, tc.fullText || "");
        blockStrikeRanges = r.blockStrikeRanges;
        deletedBlockIndices = r.deletedBlockIndices;
      }
      const reviewData = {
        reviewBlocks,
        paragraphs: tc.paragraphs,
        cleanText: tc.text,
        hasTrackChanges: tc.hasTrackChanges,
        blockStrikeRanges,
        deletedBlockIndices,
      };

      if (typeof onMultiSave === "function") {
        // 양탭 동시 갱신 — engine markDirty 자동
        onMultiSave({ manuscript: manuscriptData, review: reviewData });
      } else {
        // fallback: 본 탭만 갱신 (review 는 사용자가 명시 fetch 해야)
        onSave(manuscriptData);
      }
    } catch (e) {
      console.error("[ManuscriptTab] upload error:", e);
      setError(`업로드 실패: ${e.message || e}`);
    } finally {
      setUploading(false);
    }
  }

  function handleFileInputChange(e) {
    const file = e.target.files?.[0];
    if (file) handleFileUpload(file);
  }

  return (
    <div className="tab tab-manuscript">
      <h2>원고 (Manuscript)</h2>
      <div className="metadata" style={{ marginBottom: 16, color: "#666" }}>
        파일: {fileName || "(없음)"} · 텍스트 {text.length.toLocaleString()} 자 ·
        문단 {paragraphs.length} · 변경추적 {hasTrackChanges ? "✓" : "X"}
      </div>

      <div style={{ marginBottom: 16 }}>
        <input
          ref={fileInputRef}
          type="file"
          accept=".docx,.txt"
          onChange={handleFileInputChange}
          disabled={uploading}
          style={{ display: "block" }}
        />
        <p style={{ fontSize: 12, color: "#888", marginTop: 4 }}>
          .docx (변경 추적 포함) 또는 .txt 파일. 업로드 시 0차 검토 (review) 데이터 자동 생성.
        </p>
      </div>

      {uploading && <p style={{ color: "#06f" }}>업로드 + 파싱 중...</p>}
      {error && <p style={{ color: "#c00" }}>{error}</p>}

      {text && (
        <div style={{ marginTop: 16, padding: 12, background: "#f7f7f7", borderRadius: 4 }}>
          <p style={{ margin: 0, fontSize: 13, color: "#666" }}>
            ✅ 원고 박힘. 0차 검토 (review) 탭에서 블록 확인 가능.
            {hasTrackChanges && " 변경 추적 (w:del) 감지 → 삭제선 영역 자동 표시."}
          </p>
        </div>
      )}
    </div>
  );
}
