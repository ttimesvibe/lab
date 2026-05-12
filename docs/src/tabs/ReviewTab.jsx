// lab fresh v2 — ReviewTab (★ 실 UI Phase 3, /analyze 연동)
// 사료: editor/docs/src/tabs/ReviewTab.jsx (prod) + S2.4.2.a 0차 검토
//
// 책임:
//   - 0차 검토 화면: 분량 요약 + paragraphs 본문 표시 + 삭제선 시각화
//   - "분석 시작 (1차 교정 준비)" 버튼 → /analyze 호출 → correction.anal 박제
//   - /correct chunking + diff UI 는 Phase 4 (다 세션)

import { useState } from "react";
import { apiAnalyze } from "../utils/api.js";

export function ReviewTab({ tabId, data, onSave, onMultiSave, sessionId, config, currentTab, authUser }) {
  const reviewBlocks = data?.reviewBlocks || [];
  const cleanText = data?.cleanText || "";
  const paragraphs = data?.paragraphs || [];
  const hasTrackChanges = data?.hasTrackChanges || false;
  const deletedBlockIndices = data?.deletedBlockIndices || [];
  const delSet = new Set(deletedBlockIndices);

  const totalChars = paragraphs.reduce(
    (sum, p) => sum + p.reduce((s, seg) => s + (seg.text?.length || 0), 0),
    0
  );
  const cleanChars = cleanText.length;
  const deletedChars = totalChars - cleanChars;

  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeError, setAnalyzeError] = useState("");
  const [analyzeResult, setAnalyzeResult] = useState(null);  // 마지막 분석 결과 요약

  /**
   * ★ Phase 3: /analyze 호출 → correction.anal 박제.
   * Phase 4 에서 /correct chunked 호출 + diff UI 추가 예정.
   */
  async function handleStartAnalyze() {
    if (analyzing) return;
    setAnalyzing(true);
    setAnalyzeError("");
    setAnalyzeResult(null);
    try {
      // full_text = cleanText (삭제 제거된 본문) — 최소 100자 보장
      const fullText = cleanText || reviewBlocks.map((b) => `${b.speaker} ${b.timestamp}\n${b.text}`).join("\n\n");
      if (fullText.length < 100) {
        throw new Error(`원고가 너무 짧습니다 (현재 ${fullText.length}자, 최소 100자 필요).`);
      }

      const r = await apiAnalyze({ full_text: fullText }, config);
      if (!r?.success || !r?.analysis) {
        throw new Error(r?.error || "/analyze 응답에 analysis 가 없습니다");
      }

      const analysis = r.analysis;
      const summary = {
        speakers: analysis.speakers?.length || 0,
        termCorrections: analysis.term_corrections?.length || 0,
        domainTerms: analysis.domain_terms?.length || 0,
        genre: analysis.genre?.primary || "(없음)",
        techDifficulty: analysis.tech_difficulty || "(없음)",
        topic: analysis.overview?.topic || "(없음)",
      };
      setAnalyzeResult(summary);

      // correction.anal 박제 (다음 단계 /correct 가 사용)
      // ★ onMultiSave 가 review (_analyzed flag) + correction (anal) 동시 갱신
      if (typeof onMultiSave === "function") {
        onMultiSave({
          review: { ...data, _analyzed: true },
          correction: { anal: analysis, blocks: reviewBlocks.filter((b) => !delSet.has(b.index)) },
        });
      } else {
        onSave({ ...data, _analyzed: true });
      }
    } catch (e) {
      console.error("[ReviewTab] analyze error:", e);
      setAnalyzeError(e?.message || String(e));
    } finally {
      setAnalyzing(false);
    }
  }

  if (reviewBlocks.length === 0) {
    return (
      <div className="tab tab-review">
        <h2>0차 검토 (Review)</h2>
        <div style={{ padding: 16, color: "#666" }}>
          세션: {sessionId} · 사용자: {authUser?.name || authUser?.sub}
        </div>
        <div style={{ padding: 16, background: "#fff8e1", borderRadius: 4, color: "#7a5b00" }}>
          원고가 아직 박혀있지 않습니다. <strong>원고 탭</strong>에서 .docx 파일을 업로드하세요.
        </div>
      </div>
    );
  }

  return (
    <div className="tab tab-review">
      <h2 style={{ margin: "0 0 12px 0" }}>0차 검토 (Review)</h2>

      {/* 분량 요약 카드 */}
      <div style={{ display: "flex", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 180, padding: 12, background: "#f0f4ff", borderRadius: 6 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#345", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4 }}>
            📄 원본 분량
          </div>
          <div style={{ fontSize: 20, fontWeight: 700, color: "#234" }}>
            {reviewBlocks.length} 블록
          </div>
          <div style={{ fontSize: 12, color: "#567" }}>
            전체 {totalChars.toLocaleString()} 자
            {hasTrackChanges && ` · 삭제 ${deletedChars.toLocaleString()} 자 (${Math.round((deletedChars / Math.max(totalChars, 1)) * 100)}%)`}
          </div>
        </div>
        <div style={{ flex: 1, minWidth: 180, padding: 12, background: "#ecfdf5", borderRadius: 6 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#065f46", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4 }}>
            ✅ 1차 교정 입력
          </div>
          <div style={{ fontSize: 20, fontWeight: 700, color: "#047857" }}>
            {reviewBlocks.length - delSet.size} 블록 잔존
          </div>
          <div style={{ fontSize: 12, color: "#059669" }}>
            정리 텍스트 {cleanChars.toLocaleString()} 자
            {delSet.size > 0 && ` · ${delSet.size} 블록 80%+ 삭제`}
          </div>
        </div>
      </div>

      {/* 진행 버튼 + 분석 결과 */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 12 }}>
          {analyzing && <span style={{ color: "#06f", fontSize: 13 }}>분석 중... (LLM 호출, 10~30초 소요)</span>}
          <button
            onClick={handleStartAnalyze}
            disabled={analyzing}
            style={{
              padding: "8px 20px", borderRadius: 6, border: "none",
              background: analyzing ? "#bbb" : "linear-gradient(135deg, #4a6cf7, #7c3aed)",
              color: "#fff", fontSize: 13, fontWeight: 700,
              cursor: analyzing ? "not-allowed" : "pointer",
              boxShadow: analyzing ? "none" : "0 2px 8px rgba(74,108,247,0.3)",
            }}
          >
            {analyzeResult ? "재분석" : (hasTrackChanges ? "삭제선 제거 → 분석 시작" : "분석 시작 (1차 교정 준비)")}
          </button>
        </div>
        {analyzeError && (
          <div style={{ marginTop: 8, padding: 10, background: "#fee2e2", borderRadius: 4, color: "#991b1b", fontSize: 13 }}>
            ❌ {analyzeError}
          </div>
        )}
        {analyzeResult && (
          <div style={{ marginTop: 10, padding: 12, background: "#ecfdf5", borderRadius: 4, fontSize: 13 }}>
            <div style={{ fontWeight: 700, color: "#047857", marginBottom: 6 }}>✅ 분석 완료 — correction.anal 박제됨</div>
            <div style={{ color: "#065f46", lineHeight: 1.6 }}>
              주제: {analyzeResult.topic}<br/>
              화자 {analyzeResult.speakers}명 · 용어 교정 후보 {analyzeResult.termCorrections}건 · 전문용어 {analyzeResult.domainTerms}개<br/>
              장르: {analyzeResult.genre} · 기술 난이도: {analyzeResult.techDifficulty}
            </div>
            <div style={{ marginTop: 8, fontSize: 12, color: "#666" }}>
              ★ 다음 단계 (Phase 4): "1차 교정 시작" 버튼 → /correct chunked 호출 + diff UI
            </div>
          </div>
        )}
      </div>

      {/* paragraphs 본문 (삭제선 시각화) */}
      <div style={{ borderTop: "1px solid #eee", paddingTop: 12 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: "#666", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>
          원고 검토{hasTrackChanges ? " — 취소선은 빨간색으로 표시됩니다" : ""}
        </div>
        <div style={{ maxHeight: "60vh", overflowY: "auto", padding: "8px 0", fontSize: 14, lineHeight: 1.8 }}>
          {paragraphs.length > 0 ? (
            paragraphs.map((p, pi) => {
              const paraText = p.map((s) => s.text).join("");
              if (!paraText.trim()) return <div key={pi} style={{ height: 8 }} />;
              return (
                <p key={pi} style={{ margin: "0 0 4px 0", wordBreak: "keep-all", whiteSpace: "pre-wrap" }}>
                  {p.map((seg, si) =>
                    seg.deleted ? (
                      <span
                        key={si}
                        style={{
                          textDecoration: "line-through",
                          textDecorationColor: "#ef4444",
                          background: "rgba(239,68,68,0.12)",
                          color: "#dc2626",
                          padding: "1px 2px",
                          borderRadius: 2,
                        }}
                      >
                        {seg.text}
                      </span>
                    ) : (
                      <span key={si}>{seg.text}</span>
                    )
                  )}
                </p>
              );
            })
          ) : (
            // paragraphs 없음 (mammoth fallback 등) → blocks 로 fallback 표시
            reviewBlocks.map((b) => (
              <div key={b.index} style={{ marginBottom: 8, opacity: delSet.has(b.index) ? 0.4 : 1 }}>
                <div style={{ fontSize: 12, color: "#666", fontWeight: 600 }}>
                  [{b.index}] {b.speaker} {b.timestamp}
                  {delSet.has(b.index) && <span style={{ color: "#ef4444", marginLeft: 8 }}>(80%+ 삭제)</span>}
                </div>
                <div style={{ whiteSpace: "pre-wrap", wordBreak: "keep-all" }}>{b.text}</div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
