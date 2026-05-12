// lab fresh v2 — ScriptTab (★ 실 UI Phase 4 — /subtitle-format V3 연동)
// 사료: S2.4.2.c 스크립트 (UI: script ↔ Worker: subtitle)
// PRD §12.1:
//   - UI "script" 의 사용자 입력 = correction.scriptEdits 동봉
//   - worker "subtitle" 키 = /subtitle-format LLM 결과 (V3 plain text)

import { useState } from "react";
import { apiSubtitleFormat } from "../utils/api.js";

export function ScriptTab({ tabId, data, allTabData, onSave, onMultiSave, sessionId, config, currentTab, authUser }) {
  // subtitle tab data: subtitles[] + format
  const subtitles = data?.subtitles || [];
  const format = data?.format || null;
  const _generatedAt = data?._generatedAt || null;

  // 다른 탭 데이터 참조
  const correctionBlocks = allTabData?.correction?.blocks || [];
  const cleanText = allTabData?.review?.cleanText || allTabData?.manuscript?.text || "";

  const [generating, setGenerating] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");

  /**
   * /subtitle-format V3 호출 — 화자 턴 단위 plain text 응답.
   * 입력: correction.blocks 의 본문 + [화자명] 마커
   * 출력: 줄 단위 자막 (15-25자 strict)
   */
  async function handleGenerate() {
    if (generating) return;

    // 입력 텍스트 구성: correction.blocks 있으면 우선 (교정 완료 본), 아니면 cleanText
    let inputText = "";
    if (correctionBlocks.length > 0) {
      inputText = correctionBlocks
        .filter((b) => b.text && b.text.trim().length > 0)
        .map((b) => `[${b.speaker || "화자"}] ${b.text}`)
        .join("\n\n");
    } else if (cleanText.length > 0) {
      inputText = cleanText;
    }

    if (inputText.length < 50) {
      setError("자막 생성 입력이 너무 짧습니다. 0차 검토에서 사전 분석 + 1차 교정 먼저 완료하세요.");
      return;
    }

    setGenerating(true);
    setError("");
    setProgress("자막 생성 중... (LLM 호출, 30-90초 소요)");

    try {
      const r = await apiSubtitleFormat({ version: "v3", text: inputText }, config);
      if (!r?.success || typeof r.formatted !== "string") {
        throw new Error(r?.error || "/subtitle-format 응답에 formatted 가 없습니다");
      }

      // 줄 단위 자막 배열로 변환
      const lines = r.formatted.split("\n").filter((l) => l.trim().length > 0);
      const newSubtitles = lines.map((line, i) => ({
        index: i,
        text: line.trim(),
      }));

      onSave({
        ...data,
        subtitles: newSubtitles,
        format: "v3",
        _generatedAt: new Date().toISOString(),
        _debug: r._debug,
      });
      setProgress(`✅ ${newSubtitles.length} 자막 라인 생성됨`);
    } catch (e) {
      console.error("[ScriptTab] subtitle-format error:", e);
      setError(e?.message || String(e));
      setProgress("");
    } finally {
      setGenerating(false);
    }
  }

  const hasCorrection = correctionBlocks.length > 0;
  const hasReview = cleanText.length > 0;

  return (
    <div className="tab tab-script">
      <h2 style={{ margin: "0 0 12px 0" }}>스크립트 (자막)</h2>

      {/* 상태 카드 */}
      <div style={{ display: "flex", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 160, padding: 12, background: "#f0f4ff", borderRadius: 6 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#345", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4 }}>
            📦 입력 소스
          </div>
          <div style={{ fontSize: 14, fontWeight: 700, color: "#234" }}>
            {hasCorrection
              ? `1차 교정 ${correctionBlocks.length} 블록`
              : hasReview
                ? `0차 검토 ${cleanText.length.toLocaleString()} 자`
                : "(없음)"}
          </div>
          <div style={{ fontSize: 11, color: "#567", marginTop: 2 }}>
            {hasCorrection ? "correction.blocks 우선" : "review.cleanText fallback"}
          </div>
        </div>
        <div style={{ flex: 1, minWidth: 160, padding: 12, background: subtitles.length > 0 ? "#ecfdf5" : "#fef3c7", borderRadius: 6 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: subtitles.length > 0 ? "#065f46" : "#78350f", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4 }}>
            🎬 생성된 자막
          </div>
          <div style={{ fontSize: 20, fontWeight: 700, color: subtitles.length > 0 ? "#047857" : "#92400e" }}>
            {subtitles.length} 라인
          </div>
          <div style={{ fontSize: 11, color: subtitles.length > 0 ? "#059669" : "#b45309", marginTop: 2 }}>
            {format ? `format: ${format}` : "미생성"}
            {_generatedAt && ` · ${new Date(_generatedAt).toLocaleString("ko-KR")}`}
          </div>
        </div>
      </div>

      {/* 진행 버튼 */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 12 }}>
          {generating && <span style={{ color: "#06f", fontSize: 13 }}>{progress}</span>}
          <button
            onClick={handleGenerate}
            disabled={generating || (!hasCorrection && !hasReview)}
            style={{
              padding: "8px 20px", borderRadius: 6, border: "none",
              background: generating ? "#bbb" : "linear-gradient(135deg, #4a6cf7, #7c3aed)",
              color: "#fff", fontSize: 13, fontWeight: 700,
              cursor: generating ? "not-allowed" : "pointer",
              boxShadow: generating ? "none" : "0 2px 8px rgba(74,108,247,0.3)",
            }}
          >
            {subtitles.length > 0 ? "자막 재생성" : "자막 생성 (V3)"}
          </button>
        </div>
        {error && (
          <div style={{ marginTop: 8, padding: 10, background: "#fee2e2", borderRadius: 4, color: "#991b1b", fontSize: 13 }}>
            ❌ {error}
          </div>
        )}
        {!generating && progress && (
          <div style={{ marginTop: 8, padding: 10, background: "#ecfdf5", borderRadius: 4, color: "#065f46", fontSize: 13 }}>
            {progress}
          </div>
        )}
      </div>

      {/* 자막 시각화 */}
      {subtitles.length === 0 ? (
        <div style={{ padding: 16, background: "#f7f7f7", borderRadius: 4, color: "#666" }}>
          {hasCorrection
            ? "위 버튼으로 자막을 생성하세요. 1차 교정 결과 기준."
            : hasReview
              ? "1차 교정 미완료 — 0차 검토의 cleanText 로 자막 생성 가능 (정확도 ↓)."
              : "0차 검토 + 1차 교정 먼저 완료하세요."}
        </div>
      ) : (
        <div style={{ borderTop: "1px solid #eee", paddingTop: 12 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#666", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>
            자막 미리보기 — 15-25자 strict (V3)
          </div>
          <div style={{ maxHeight: "55vh", overflowY: "auto", fontSize: 14, lineHeight: 1.8 }}>
            {subtitles.map((s) => {
              const charCount = (s.text || "").length;
              const isViolation = charCount > 25 || charCount < 10;
              return (
                <div
                  key={s.index}
                  style={{
                    padding: "8px 12px",
                    marginBottom: 4,
                    background: isViolation ? "#fef3c7" : "#fafafa",
                    borderLeft: isViolation ? "3px solid #f59e0b" : "3px solid #e5e7eb",
                    borderRadius: 3,
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                  }}
                >
                  <span style={{ wordBreak: "keep-all" }}>{s.text}</span>
                  <span style={{ fontSize: 11, color: isViolation ? "#b45309" : "#999", fontWeight: 600, marginLeft: 12, flexShrink: 0 }}>
                    {charCount}자
                  </span>
                </div>
              );
            })}
          </div>
          <div style={{ marginTop: 8, padding: 8, background: "#f3f4f6", borderRadius: 4, fontSize: 12, color: "#666" }}>
            총 {subtitles.length} 라인 ·{" "}
            {subtitles.filter((s) => (s.text || "").length > 25 || (s.text || "").length < 10).length} 라인이 15-25자 범위 외 (노란색)
          </div>
        </div>
      )}
    </div>
  );
}
