// lab fresh v2 — GuideTab (★ 실 UI Phase 5 — /highlights 2-Pass + 16 type)
// 사료: S2.4.2.d 편집 가이드 + worker DRAFT_AGENT_PROMPT + EDITOR_AGENT_PROMPT
//
// 2-Pass 흐름:
//   1) Draft: 후보 1.5~2배 넉넉히 생성 (mode="draft")
//   2) Editor: 검증·선별·다듬기 (mode="edit", draft_highlights 전달)

import { useState } from "react";
import { apiHighlights } from "../utils/api.js";

// 16 자막 유형 분류 (DRAFT_AGENT_PROMPT §4 정합)
const HL_TYPE_GROUPS = {
  A: { label: "핵심 전달", color: "#3b82f6", bg: "#dbeafe" },
  B: { label: "정의·설명", color: "#6366f1", bg: "#e0e7ff" },
  C: { label: "구조화", color: "#8b5cf6", bg: "#ede9fe" },
  D: { label: "평가·반응", color: "#f59e0b", bg: "#fef3c7" },
  E: { label: "기능·실무", color: "#10b981", bg: "#d1fae5" },
};
function typeColor(t) {
  const g = (t || "").charAt(0).toUpperCase();
  return HL_TYPE_GROUPS[g] || { label: "?", color: "#6b7280", bg: "#f3f4f6" };
}

export function GuideTab({ tabId, data, allTabData, onSave, onMultiSave, sessionId, config, currentTab, authUser }) {
  const hl = data?.hl || [];
  const hlStats = data?.hlStats || null;
  const _draftCount = data?._draftCount || 0;
  const _generatedAt = data?._generatedAt || null;

  // 다른 탭 데이터
  const correctionBlocks = allTabData?.correction?.blocks || [];
  const analysis = allTabData?.correction?.anal || null;

  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");

  /**
   * 2-Pass 실행: Draft → Editor.
   * Draft: 후보 풍부 생성. Editor: 검증·선별·다듬기.
   */
  async function handleStartHighlights() {
    if (running) return;
    if (correctionBlocks.length === 0) {
      setError("1차 교정 먼저 완료하세요.");
      return;
    }
    setRunning(true);
    setError("");

    try {
      // Pass 1: Draft
      setProgress("Draft Agent 실행 중... (후보 1.5~2배 넉넉히 생성)");
      const blocksForLLM = correctionBlocks
        .filter((b) => b.text && b.text.trim().length > 0)
        .map((b) => ({ index: b.index, speaker: b.speaker, timestamp: b.timestamp, text: b.text }));

      const draftRes = await apiHighlights({
        mode: "draft",
        blocks: blocksForLLM,
        analysis,
      }, config);
      if (!draftRes?.success || !draftRes?.result) {
        throw new Error("Draft 실패: " + (draftRes?.error || "응답 형식 X"));
      }
      const draftHighlights = draftRes.result?.highlights || [];
      if (draftHighlights.length === 0) {
        throw new Error("Draft Agent 가 후보를 생성하지 않았습니다");
      }

      // Pass 2: Editor
      setProgress(`Editor Agent 실행 중... (Draft ${draftHighlights.length} 후보 검증·선별)`);
      const editorRes = await apiHighlights({
        mode: "edit",
        blocks: blocksForLLM,
        analysis,
        draft_highlights: draftHighlights,
      }, config);
      if (!editorRes?.success || !editorRes?.result) {
        throw new Error("Editor 실패: " + (editorRes?.error || "응답 형식 X"));
      }
      const finalHighlights = editorRes.result?.highlights || [];
      const stats = editorRes.result?.stats || null;
      const removed = editorRes.result?.removed || [];

      onSave({
        ...data,
        hl: finalHighlights,
        hlStats: { ...stats, removed_items: removed },
        _draftCount: draftHighlights.length,
        _generatedAt: new Date().toISOString(),
      });
      setProgress(`✅ ${finalHighlights.length} 강조자막 생성 (Draft ${draftHighlights.length} → 최종 ${finalHighlights.length})`);
    } catch (e) {
      console.error("[GuideTab] highlights error:", e);
      setError(e?.message || String(e));
      setProgress("");
    } finally {
      setRunning(false);
    }
  }

  const hasCorrection = correctionBlocks.length > 0;

  // 유형별 그룹화
  const byGroup = { A: [], B: [], C: [], D: [], E: [], "?": [] };
  for (const h of hl) {
    const g = (h.type || "").charAt(0).toUpperCase();
    if (byGroup[g]) byGroup[g].push(h);
    else byGroup["?"].push(h);
  }

  return (
    <div className="tab tab-guide">
      <h2 style={{ margin: "0 0 12px 0" }}>편집 가이드 (강조자막)</h2>

      {/* 상태 카드 */}
      <div style={{ display: "flex", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 160, padding: 12, background: hasCorrection ? "#f0f4ff" : "#fee2e2", borderRadius: 6 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: hasCorrection ? "#345" : "#991b1b", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4 }}>
            📦 입력 블록
          </div>
          <div style={{ fontSize: 20, fontWeight: 700, color: hasCorrection ? "#234" : "#dc2626" }}>
            {correctionBlocks.length}
          </div>
          <div style={{ fontSize: 11, color: "#666", marginTop: 2 }}>
            {hasCorrection ? "correction.blocks" : "1차 교정 필요"}
          </div>
        </div>
        <div style={{ flex: 1, minWidth: 160, padding: 12, background: analysis ? "#ecfdf5" : "#fef3c7", borderRadius: 6 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: analysis ? "#065f46" : "#78350f", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4 }}>
            🔍 분석 (genre 영향)
          </div>
          <div style={{ fontSize: 14, fontWeight: 700, color: analysis ? "#047857" : "#92400e" }}>
            {analysis?.genre?.primary || "미실행"}
          </div>
          {analysis?.tech_difficulty && (
            <div style={{ fontSize: 11, color: "#059669", marginTop: 2 }}>
              난이도: {analysis.tech_difficulty}
            </div>
          )}
        </div>
        <div style={{ flex: 1, minWidth: 160, padding: 12, background: hl.length > 0 ? "#ecfdf5" : "#fef3c7", borderRadius: 6 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: hl.length > 0 ? "#065f46" : "#78350f", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4 }}>
            ✨ 강조자막
          </div>
          <div style={{ fontSize: 20, fontWeight: 700, color: hl.length > 0 ? "#047857" : "#92400e" }}>
            {hl.length}
          </div>
          {_draftCount > 0 && (
            <div style={{ fontSize: 11, color: "#059669", marginTop: 2 }}>
              Draft {_draftCount} → 최종 {hl.length}
            </div>
          )}
        </div>
      </div>

      {/* 진행 버튼 */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 12 }}>
          {running && <span style={{ color: "#06f", fontSize: 13 }}>{progress}</span>}
          <button
            onClick={handleStartHighlights}
            disabled={running || !hasCorrection}
            style={{
              padding: "8px 20px", borderRadius: 6, border: "none",
              background: running || !hasCorrection ? "#bbb" : "linear-gradient(135deg, #4a6cf7, #7c3aed)",
              color: "#fff", fontSize: 13, fontWeight: 700,
              cursor: running || !hasCorrection ? "not-allowed" : "pointer",
              boxShadow: running || !hasCorrection ? "none" : "0 2px 8px rgba(74,108,247,0.3)",
            }}
          >
            {hl.length > 0 ? "재생성 (2-Pass)" : "강조자막 생성 (Draft → Editor 2-Pass)"}
          </button>
        </div>
        {error && (
          <div style={{ marginTop: 8, padding: 10, background: "#fee2e2", borderRadius: 4, color: "#991b1b", fontSize: 13 }}>
            ❌ {error}
          </div>
        )}
        {!running && progress && hl.length > 0 && (
          <div style={{ marginTop: 8, padding: 10, background: "#ecfdf5", borderRadius: 4, color: "#065f46", fontSize: 13 }}>
            {progress}
            {hlStats?.removal_rate && ` · 제거율 ${hlStats.removal_rate}`}
          </div>
        )}
      </div>

      {/* 강조자막 표시 (유형별 그룹화) */}
      {hl.length === 0 ? (
        <div style={{ padding: 16, background: "#f7f7f7", borderRadius: 4, color: "#666" }}>
          {hasCorrection
            ? "위 버튼으로 강조자막을 생성하세요. Draft → Editor 2-Pass (약 60-120초)."
            : "1차 교정 먼저 완료하세요 (1차 교정 탭)."}
        </div>
      ) : (
        <div style={{ borderTop: "1px solid #eee", paddingTop: 12 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#666", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>
            강조자막 (유형별 그룹화 — 16 type / 5 그룹)
          </div>
          <div style={{ maxHeight: "60vh", overflowY: "auto" }}>
            {Object.entries(HL_TYPE_GROUPS).map(([g, info]) => {
              const items = byGroup[g] || [];
              if (items.length === 0) return null;
              return (
                <div key={g} style={{ marginBottom: 16 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: info.color, marginBottom: 6, display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ padding: "2px 8px", background: info.bg, borderRadius: 3 }}>{g}. {info.label}</span>
                    <span style={{ color: "#999", fontWeight: 400 }}>· {items.length}건</span>
                  </div>
                  {items.map((h, hi) => (
                    <div key={hi} style={{ padding: 10, marginBottom: 4, background: info.bg, borderLeft: `3px solid ${info.color}`, borderRadius: 3, fontSize: 13 }}>
                      <div style={{ fontSize: 11, color: "#666", marginBottom: 4 }}>
                        [블록 {h.block_index ?? "?"}] {h.speaker || "?"} · {h.type} {h.type_name && `(${h.type_name})`} · {(h.subtitle || "").length}자
                      </div>
                      <div style={{ fontWeight: 600, color: "#222", lineHeight: 1.5 }}>{h.subtitle}</div>
                      {h.source_text && (
                        <div style={{ fontSize: 11, color: "#666", marginTop: 4, fontStyle: "italic" }}>
                          원문: "{(h.source_text || "").slice(0, 80)}..."
                        </div>
                      )}
                      {h.reason && (
                        <div style={{ fontSize: 11, color: "#888", marginTop: 4 }}>
                          이유: {h.reason}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
          {hlStats?.removed_items && hlStats.removed_items.length > 0 && (
            <details style={{ marginTop: 12, padding: 10, background: "#fafafa", borderRadius: 4 }}>
              <summary style={{ cursor: "pointer", fontSize: 12, color: "#666" }}>
                ★ Editor 가 제거한 후보 {hlStats.removed_items.length}건 보기
              </summary>
              <div style={{ marginTop: 8, fontSize: 12 }}>
                {hlStats.removed_items.map((r, i) => (
                  <div key={i} style={{ padding: 4, borderBottom: "1px dashed #eee" }}>
                    [블록 {r.block_index ?? "?"}] {r.reason}
                  </div>
                ))}
              </div>
            </details>
          )}
        </div>
      )}
    </div>
  );
}
