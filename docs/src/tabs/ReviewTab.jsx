// lab fresh v2 — ReviewTab (★ 실 UI Phase 3, /analyze 연동)
// 사료: editor/docs/src/tabs/ReviewTab.jsx (prod) + S2.4.2.a 0차 검토
//
// 책임:
//   - 0차 검토 화면: 분량 요약 + paragraphs 본문 표시 + 삭제선 시각화
//   - "분석 시작 (1차 교정 준비)" 버튼 → /analyze 호출 → correction.anal 박제
//   - /correct chunking + diff UI 는 Phase 4 (다 세션)

import { useState } from "react";
import { apiAnalyze } from "../utils/api.js";
import { calcRegression, calcDuration, secondsToDisplay } from "../utils/lengthModel.js";
import { stripStrikeFromBlocks } from "../utils/parseBlocks.js";

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

  // ★ 분량 예측 (LOO MAE 3.9% 선형회귀, 7건 학습)
  //   keptSeconds: 타임스탬프 기반 잔존 분량 (삭제 80%+ 블록 제외)
  //   reg.pointSec: cleanText 글자수 기반 예측 분량 + 95% 신뢰구간
  const duration = calcDuration(reviewBlocks, delSet);
  const reg = calcRegression(cleanChars);

  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeError, setAnalyzeError] = useState("");
  // ★ 분석 결과는 review.data._analysisSummary 에 박제 (탭 이동/리로드 후에도 보존)
  //   data 가 바뀌면 자동 반영. 별도 useState X.
  const analyzeResult = data?._analysisSummary || null;

  /**
   * ★ Phase 3: /analyze 호출 → correction.anal 박제.
   * Phase 4 에서 /correct chunked 호출 + diff UI 추가 예정.
   */
  async function handleStartAnalyze() {
    if (analyzing) return;
    setAnalyzing(true);
    setAnalyzeError("");
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
        analyzedAt: new Date().toISOString(),
      };

      // ★ review._analysisSummary 박제 → 탭 이동/리로드 후에도 시각 표시 보존
      // ★ correction.anal + blocks 박제 → 다음 단계 /correct 가 사용
      //
      // ★★ 인덱스 정합 (헌장 §5 D6-1 immutable block.index):
      //   reviewBlocks 의 원래 .index 를 보존하면서 strike 영역 strip.
      //   incoming.blocks 의 idx 가 existing 의 idx 와 1:1 일치 → array_id_union merge 시
      //   이전 분석의 잔존이 깔끔하게 incoming 으로 덮임 (중복 회피).
      //
      //   cleanText 에서 parseBlocks 재실행은 새 0-based idx 부여 → existing 의 idx 와 불일치 →
      //   array_id_union 이 양쪽 다 살림 → 중복 발생. (★ 사용자 보고)
      const cleanedBlocks = stripStrikeFromBlocks(reviewBlocks, data?.blockStrikeRanges || {});

      if (typeof onMultiSave === "function") {
        onMultiSave({
          review: { ...data, _analyzed: true, _analysisSummary: summary },
          correction: { anal: analysis, blocks: cleanedBlocks },
        });
      } else {
        onSave({ ...data, _analyzed: true, _analysisSummary: summary });
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

      {/* 분량 요약 카드 — 원본 분량 + 잔존 + ★ 예상 영상 길이 (LOO MAE 3.9%) */}
      <div style={{ display: "flex", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 180, padding: 12, background: "#f0f4ff", borderRadius: 6 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#345", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4 }}>
            📄 원본 분량
          </div>
          <div style={{ fontSize: 20, fontWeight: 700, color: "#234" }}>
            {duration.totalSeconds > 0 ? secondsToDisplay(duration.totalSeconds) : `${reviewBlocks.length} 블록`}
          </div>
          <div style={{ fontSize: 12, color: "#567" }}>
            {totalChars.toLocaleString()}자 · {reviewBlocks.length}블록
            {hasTrackChanges && ` · 삭제 ${deletedChars.toLocaleString()}자 (${Math.round((deletedChars / Math.max(totalChars, 1)) * 100)}%)`}
          </div>
        </div>

        <div style={{ flex: 1, minWidth: 200, padding: 12, background: "#ecfdf5", borderRadius: 6, border: "1px solid rgba(34,197,94,0.2)" }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#065f46", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4 }}>
            🎬 예상 영상 길이
          </div>
          <div style={{ fontSize: 22, fontWeight: 800, color: "#047857" }}>
            {secondsToDisplay(reg.pointSec)}
          </div>
          <div style={{ marginTop: 4, padding: "3px 8px", borderRadius: 4, background: "rgba(34,197,94,0.1)", display: "inline-block", fontSize: 11, color: "#047857", fontWeight: 600 }}>
            {secondsToDisplay(reg.lowSec)} ~ {secondsToDisplay(reg.highSec)} <span style={{ opacity: 0.7 }}>(95% CI)</span>
          </div>
          <div style={{ fontSize: 11, color: "#059669", marginTop: 4 }}>
            {reg.count}건 학습 · 선형회귀 LOO MAE 3.9% · 정리 후 {cleanChars.toLocaleString()}자
          </div>
          {duration.keptSeconds > 0 && (
            <div style={{ fontSize: 11, color: "#059669", marginTop: 2 }}>
              타임스탬프 기준 잔존: {secondsToDisplay(duration.keptSeconds)} · {reviewBlocks.length - delSet.size}블록
            </div>
          )}
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
            {analyzeResult ? "사전 분석 재실행" : (hasTrackChanges ? "삭제선 제거 → 사전 분석 시작" : "사전 분석 시작")}
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
