// lab fresh v2 — VisualTab (★ 실 UI Phase 6 — /visuals + /insert-cuts)
// 사료: S2.4.2.e 자료·그래픽 + worker VISUAL_TYPES_SPEC 23 type + 3 type 인서트
//
// 두 endpoint 분리 호출:
//   /visuals      → 차트/도표 (visual_guides[])
//   /insert-cuts  → 보조 영상/이미지 (insert_cuts[])

import { useState } from "react";
import { apiVisuals, apiInsertCuts } from "../utils/api.js";

// priority 별 색
const PRIORITY_STYLES = {
  high:   { color: "#dc2626", bg: "#fee2e2", label: "🔴 high" },
  medium: { color: "#d97706", bg: "#fef3c7", label: "🟡 medium" },
  low:    { color: "#16a34a", bg: "#d1fae5", label: "🟢 low" },
};

// 인서트 type 별 색
const CUT_TYPE_STYLES = {
  A: { color: "#8b5cf6", bg: "#ede9fe", label: "A 회상 일러스트" },
  B: { color: "#3b82f6", bg: "#dbeafe", label: "B 공식 이미지/유튜브" },
  C: { color: "#10b981", bg: "#d1fae5", label: "C 작품/성과물" },
};

export function VisualTab({ tabId, data, allTabData, onSave, onMultiSave, sessionId, config, currentTab, authUser }) {
  const visualGuides = data?.visualGuides || [];
  const insertCuts = data?.insertCuts || [];

  const correctionBlocks = allTabData?.correction?.blocks || [];
  const analysis = allTabData?.correction?.anal || null;

  const [running, setRunning] = useState(""); // "visuals" | "cuts" | ""
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");

  async function callLLM(endpoint, kind) {
    if (running) return;
    if (correctionBlocks.length === 0) {
      setError("1차 교정 먼저 완료하세요.");
      return;
    }
    setRunning(kind);
    setError("");
    setProgress(`${endpoint === "visuals" ? "시각자료" : "인서트 컷"} 생성 중... (LLM 호출, 30-90초)`);

    try {
      const blocksForLLM = correctionBlocks
        .filter((b) => b.text && b.text.trim().length > 0)
        .map((b) => ({ index: b.index, speaker: b.speaker, timestamp: b.timestamp, text: b.text }));

      const fn = endpoint === "visuals" ? apiVisuals : apiInsertCuts;
      const r = await fn({
        blocks: blocksForLLM,
        analysis,
        existing_count: endpoint === "visuals" ? visualGuides.length : insertCuts.length,
      }, config);
      if (!r?.success || !r?.result) {
        throw new Error(`${endpoint} 실패: ${r?.error || "응답 형식 X"}`);
      }

      if (endpoint === "visuals") {
        const guides = r.result.visual_guides || [];
        onSave({ ...data, visualGuides: guides, _visualsGeneratedAt: new Date().toISOString() });
        setProgress(`✅ ${guides.length} 시각자료 생성됨`);
      } else {
        const cuts = r.result.insert_cuts || [];
        onSave({ ...data, insertCuts: cuts, _cutsGeneratedAt: new Date().toISOString() });
        setProgress(`✅ ${cuts.length} 인서트 컷 생성됨`);
      }
    } catch (e) {
      console.error(`[VisualTab] ${endpoint} error:`, e);
      setError(e?.message || String(e));
      setProgress("");
    } finally {
      setRunning("");
    }
  }

  const hasCorrection = correctionBlocks.length > 0;

  return (
    <div className="tab tab-visual">
      <h2 style={{ margin: "0 0 12px 0" }}>자료·그래픽 (Visual)</h2>

      {/* 상태 카드 */}
      <div style={{ display: "flex", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 160, padding: 12, background: hasCorrection ? "#f0f4ff" : "#fee2e2", borderRadius: 6 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: hasCorrection ? "#345" : "#991b1b", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4 }}>
            📦 입력 블록
          </div>
          <div style={{ fontSize: 20, fontWeight: 700, color: hasCorrection ? "#234" : "#dc2626" }}>
            {correctionBlocks.length}
          </div>
        </div>
        <div style={{ flex: 1, minWidth: 160, padding: 12, background: visualGuides.length > 0 ? "#ecfdf5" : "#fef3c7", borderRadius: 6 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: visualGuides.length > 0 ? "#065f46" : "#78350f", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4 }}>
            📊 시각자료
          </div>
          <div style={{ fontSize: 20, fontWeight: 700, color: visualGuides.length > 0 ? "#047857" : "#92400e" }}>
            {visualGuides.length}
          </div>
        </div>
        <div style={{ flex: 1, minWidth: 160, padding: 12, background: insertCuts.length > 0 ? "#ecfdf5" : "#fef3c7", borderRadius: 6 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: insertCuts.length > 0 ? "#065f46" : "#78350f", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4 }}>
            🎬 인서트 컷
          </div>
          <div style={{ fontSize: 20, fontWeight: 700, color: insertCuts.length > 0 ? "#047857" : "#92400e" }}>
            {insertCuts.length}
          </div>
        </div>
      </div>

      {/* 두 버튼 */}
      <div style={{ marginBottom: 16, display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap" }}>
        {running && <span style={{ color: "#06f", fontSize: 13, alignSelf: "center" }}>{progress}</span>}
        <button
          onClick={() => callLLM("visuals", "visuals")}
          disabled={!!running || !hasCorrection}
          style={{
            padding: "8px 16px", borderRadius: 6, border: "none",
            background: running === "visuals" || !hasCorrection ? "#bbb" : "linear-gradient(135deg, #3b82f6, #6366f1)",
            color: "#fff", fontSize: 13, fontWeight: 700,
            cursor: running || !hasCorrection ? "not-allowed" : "pointer",
          }}
        >
          {visualGuides.length > 0 ? "📊 시각자료 재생성" : "📊 시각자료 생성 (/visuals)"}
        </button>
        <button
          onClick={() => callLLM("insert-cuts", "cuts")}
          disabled={!!running || !hasCorrection}
          style={{
            padding: "8px 16px", borderRadius: 6, border: "none",
            background: running === "cuts" || !hasCorrection ? "#bbb" : "linear-gradient(135deg, #10b981, #06b6d4)",
            color: "#fff", fontSize: 13, fontWeight: 700,
            cursor: running || !hasCorrection ? "not-allowed" : "pointer",
          }}
        >
          {insertCuts.length > 0 ? "🎬 인서트 컷 재생성" : "🎬 인서트 컷 생성 (/insert-cuts)"}
        </button>
      </div>

      {error && (
        <div style={{ marginBottom: 12, padding: 10, background: "#fee2e2", borderRadius: 4, color: "#991b1b", fontSize: 13 }}>
          ❌ {error}
        </div>
      )}

      {!hasCorrection && (
        <div style={{ padding: 16, background: "#f7f7f7", borderRadius: 4, color: "#666" }}>
          1차 교정 먼저 완료하세요 (1차 교정 탭).
        </div>
      )}

      {/* 시각자료 시각화 */}
      {visualGuides.length > 0 && (
        <div style={{ borderTop: "1px solid #eee", paddingTop: 12, marginBottom: 16 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#666", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>
            시각자료 ({visualGuides.length}) — 23 type 지원
          </div>
          <div style={{ maxHeight: "35vh", overflowY: "auto" }}>
            {visualGuides.map((v, i) => {
              const ps = PRIORITY_STYLES[v.priority] || PRIORITY_STYLES.medium;
              return (
                <div key={i} style={{ padding: 10, marginBottom: 6, background: "#fafafa", borderLeft: `3px solid ${ps.color}`, borderRadius: 3, fontSize: 13 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                    <span style={{ fontWeight: 700 }}>{v.title}</span>
                    <span style={{ fontSize: 11, padding: "1px 6px", background: ps.bg, color: ps.color, borderRadius: 3 }}>
                      {ps.label}
                    </span>
                  </div>
                  <div style={{ fontSize: 11, color: "#666", marginBottom: 4 }}>
                    type: <code style={{ background: "#f3f4f6", padding: "1px 4px", borderRadius: 2 }}>{v.type}</code>
                    {" · "}블록 [{v.block_range?.[0]}~{v.block_range?.[1]}]
                    {v.duration_seconds && ` · ${v.duration_seconds}초`}
                  </div>
                  {v.reason && (
                    <div style={{ fontSize: 12, color: "#666", marginBottom: 4 }}>
                      이유: {v.reason}
                    </div>
                  )}
                  {v.source_text && (
                    <div style={{ fontSize: 11, color: "#888", marginBottom: 4, fontStyle: "italic" }}>
                      원문: "{(v.source_text || "").slice(0, 100)}..."
                    </div>
                  )}
                  {v.chart_data && (
                    <details>
                      <summary style={{ cursor: "pointer", fontSize: 11, color: "#06f" }}>chart_data 보기</summary>
                      <pre style={{ background: "#1f2937", color: "#e5e7eb", padding: 8, fontSize: 11, overflow: "auto", marginTop: 4 }}>
                        {JSON.stringify(v.chart_data, null, 2)}
                      </pre>
                    </details>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 인서트 컷 시각화 */}
      {insertCuts.length > 0 && (
        <div style={{ borderTop: "1px solid #eee", paddingTop: 12 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#666", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>
            인서트 컷 ({insertCuts.length}) — Type A/B/C
          </div>
          <div style={{ maxHeight: "35vh", overflowY: "auto" }}>
            {insertCuts.map((c, i) => {
              const ts = CUT_TYPE_STYLES[c.type] || { color: "#6b7280", bg: "#f3f4f6", label: c.type };
              return (
                <div key={i} style={{ padding: 10, marginBottom: 6, background: ts.bg, borderLeft: `3px solid ${ts.color}`, borderRadius: 3, fontSize: 13 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                    <span style={{ fontWeight: 700 }}>{c.title}</span>
                    <span style={{ fontSize: 11, padding: "1px 6px", background: "#fff", color: ts.color, borderRadius: 3, fontWeight: 600 }}>
                      {ts.label}
                    </span>
                  </div>
                  <div style={{ fontSize: 11, color: "#666", marginBottom: 4 }}>
                    블록 [{c.block_range?.[0]}~{c.block_range?.[1]}]
                    {c.source_type && ` · source: ${c.source_type}`}
                  </div>
                  {c.trigger_quote && (
                    <div style={{ fontSize: 12, padding: 4, background: "#fff8e1", borderRadius: 2, marginBottom: 4 }}>
                      💬 트리거 발언: "{c.trigger_quote}"
                    </div>
                  )}
                  {c.trigger_reason && (
                    <div style={{ fontSize: 11, color: "#666", marginBottom: 4 }}>
                      이유: {c.trigger_reason}
                    </div>
                  )}
                  {c.instruction && (
                    <div style={{ fontSize: 12, padding: 6, background: "rgba(255,255,255,0.6)", borderRadius: 2, marginBottom: 4 }}>
                      📝 편집자 지시: {c.instruction}
                    </div>
                  )}
                  {c.type === "A" && c.image_prompt && (
                    <details>
                      <summary style={{ cursor: "pointer", fontSize: 11, color: "#06f" }}>미드저니 프롬프트</summary>
                      <pre style={{ fontSize: 11, padding: 6, background: "#1f2937", color: "#e5e7eb", borderRadius: 2, marginTop: 4, whiteSpace: "pre-wrap" }}>
                        {c.image_prompt}
                      </pre>
                    </details>
                  )}
                  {c.type === "B" && c.search_keywords && c.search_keywords.length > 0 && (
                    <div style={{ fontSize: 11, color: "#666", marginTop: 4 }}>
                      🔍 검색 키워드: {c.search_keywords.map((k) => `"${k}"`).join(", ")}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
