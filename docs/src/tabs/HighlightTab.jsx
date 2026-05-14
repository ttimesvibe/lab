// lab fresh v2 — HighlightTab (★ 실 UI Phase 7 — /hl-recommend + /hl-timestamps)
// 사료: S2.4.2.g 하이라이트 + worker HL_RECOMMEND_PROMPT + HL_TIMESTAMPS_PROMPT
//
// 두 endpoint:
//   /hl-recommend   — 8~12 후보 임팩트 발언 (30~40초 쇼츠/프리뷰용)
//   /hl-timestamps  — 5~10 챕터 (YouTube 영상 설명란용)

import { useState } from "react";
import { apiHlRecommend, apiHlTimestamps } from "../utils/api.js";

const IMPACT_STYLES = {
  high:   { color: "#dc2626", bg: "#fee2e2", label: "🔥 high" },
  medium: { color: "#d97706", bg: "#fef3c7", label: "📌 medium" },
};

export function HighlightTab({ tabId, data, allTabData, onSave, onMultiSave, sessionId, config, currentTab, authUser }) {
  const clips = data?.clips || [];
  const chapters = data?.chapters || [];
  const suggestedFlow = data?.suggestedFlow || "";
  const videoTitleSuggestion = data?.videoTitleSuggestion || "";

  // 입력 소스: correction.blocks 의 본문 join (또는 cleanText)
  const correctionBlocks = allTabData?.correction?.blocks || [];
  const cleanText = allTabData?.review?.cleanText || allTabData?.manuscript?.text || "";

  const [running, setRunning] = useState(""); // "recommend" | "chapters" | ""
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");

  function getInputScript() {
    if (correctionBlocks.length > 0) {
      return correctionBlocks
        .filter((b) => b.text && b.text.trim().length > 0)
        .map((b) => `[${b.speaker || "화자"}] ${b.text}`)
        .join("\n\n");
    }
    return cleanText;
  }

  async function handleRecommend() {
    if (running) return;
    const script = getInputScript();
    if (script.length < 100) {
      setError("입력 텍스트가 너무 짧습니다 (최소 100자).");
      return;
    }
    setRunning("recommend");
    setError("");
    setProgress("하이라이트 후보 추천 중... (LLM 호출, 30-60초)");

    try {
      const r = await apiHlRecommend({ script }, config);
      if (!r?.success || !r?.result) {
        throw new Error("hl-recommend 실패: " + (r?.error || "응답 형식 X"));
      }
      const candidates = r.result.candidates || [];
      const flow = r.result.suggested_flow || "";

      onSave({
        ...data,
        clips: candidates,
        suggestedFlow: flow,
        _recommendedAt: new Date().toISOString(),
      });
      setProgress(`✅ ${candidates.length} 후보 추천됨 (총 ${candidates.reduce((s, c) => s + (c.estimated_seconds || 0), 0)}초 분량)`);
    } catch (e) {
      console.error("[HighlightTab] hl-recommend error:", e);
      setError(e?.message || String(e));
      setProgress("");
    } finally {
      setRunning("");
    }
  }

  async function handleTimestamps() {
    if (running) return;
    const script = getInputScript();
    if (script.length < 100) {
      setError("입력 텍스트가 너무 짧습니다 (최소 100자).");
      return;
    }
    setRunning("chapters");
    setError("");
    setProgress("YouTube 챕터 생성 중... (LLM 호출, 30-60초)");

    try {
      const r = await apiHlTimestamps({ script }, config);
      if (!r?.success || !r?.result) {
        throw new Error("hl-timestamps 실패: " + (r?.error || "응답 형식 X"));
      }
      const chs = r.result.chapters || [];
      const vts = r.result.video_title_suggestion || "";

      onSave({
        ...data,
        chapters: chs,
        videoTitleSuggestion: vts,
        _chaptersGeneratedAt: new Date().toISOString(),
      });
      setProgress(`✅ ${chs.length} 챕터 생성됨`);
    } catch (e) {
      console.error("[HighlightTab] hl-timestamps error:", e);
      setError(e?.message || String(e));
      setProgress("");
    } finally {
      setRunning("");
    }
  }

  const hasInput = correctionBlocks.length > 0 || cleanText.length > 100;
  const totalSeconds = clips.reduce((s, c) => s + (c.estimated_seconds || 0), 0);

  return (
    <div className="tab tab-highlight">
      <h2 style={{ margin: "0 0 12px 0" }}>하이라이트</h2>

      {/* 상태 카드 */}
      <div style={{ display: "flex", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 160, padding: 12, background: hasInput ? "#f0f4ff" : "#fee2e2", borderRadius: 6 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: hasInput ? "#345" : "#991b1b", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4 }}>
            📦 입력 소스
          </div>
          <div style={{ fontSize: 14, fontWeight: 700, color: hasInput ? "#234" : "#dc2626" }}>
            {correctionBlocks.length > 0 ? `1차 교정 ${correctionBlocks.length} 블록` : cleanText.length > 100 ? `${cleanText.length.toLocaleString()} 자` : "입력 부족"}
          </div>
        </div>
        <div style={{ flex: 1, minWidth: 160, padding: 12, background: clips.length > 0 ? "#ecfdf5" : "#fef3c7", borderRadius: 6 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: clips.length > 0 ? "#065f46" : "#78350f", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4 }}>
            🎬 추천 클립 (쇼츠 후보)
          </div>
          <div style={{ fontSize: 20, fontWeight: 700, color: clips.length > 0 ? "#047857" : "#92400e" }}>
            {clips.length}
          </div>
          {clips.length > 0 && (
            <div style={{ fontSize: 11, color: "#059669", marginTop: 2 }}>
              총 {totalSeconds}초 · 30-40초 쇼츠 목표
            </div>
          )}
        </div>
        <div style={{ flex: 1, minWidth: 160, padding: 12, background: chapters.length > 0 ? "#ecfdf5" : "#fef3c7", borderRadius: 6 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: chapters.length > 0 ? "#065f46" : "#78350f", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4 }}>
            📑 챕터 (YouTube)
          </div>
          <div style={{ fontSize: 20, fontWeight: 700, color: chapters.length > 0 ? "#047857" : "#92400e" }}>
            {chapters.length}
          </div>
        </div>
      </div>

      {/* 두 버튼 */}
      <div style={{ marginBottom: 16, display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap" }}>
        {running && <span style={{ color: "#06f", fontSize: 13, alignSelf: "center" }}>{progress}</span>}
        <button
          onClick={handleRecommend}
          disabled={!!running || !hasInput}
          style={{
            padding: "8px 16px", borderRadius: 6, border: "none",
            background: running === "recommend" || !hasInput ? "#bbb" : "linear-gradient(135deg, #ef4444, #f97316)",
            color: "#fff", fontSize: 13, fontWeight: 700,
            cursor: running || !hasInput ? "not-allowed" : "pointer",
          }}
        >
          {clips.length > 0 ? "🎬 클립 재추천" : "🎬 쇼츠 클립 추천 (/hl-recommend)"}
        </button>
        <button
          onClick={handleTimestamps}
          disabled={!!running || !hasInput}
          style={{
            padding: "8px 16px", borderRadius: 6, border: "none",
            background: running === "chapters" || !hasInput ? "#bbb" : "linear-gradient(135deg, #06b6d4, #3b82f6)",
            color: "#fff", fontSize: 13, fontWeight: 700,
            cursor: running || !hasInput ? "not-allowed" : "pointer",
          }}
        >
          {chapters.length > 0 ? "📑 챕터 재생성" : "📑 YouTube 챕터 (/hl-timestamps)"}
        </button>
      </div>

      {error && (
        <div style={{ marginBottom: 12, padding: 10, background: "#fee2e2", borderRadius: 4, color: "#991b1b", fontSize: 13 }}>
          ❌ {error}
        </div>
      )}

      {!hasInput && (
        <div style={{ padding: 16, background: "#f7f7f7", borderRadius: 4, color: "#666" }}>
          1차 교정 완료된 본문 또는 0차 검토의 cleanText 가 필요합니다.
        </div>
      )}

      {/* 쇼츠 클립 후보 */}
      {clips.length > 0 && (
        <div style={{ borderTop: "1px solid #eee", paddingTop: 12, marginBottom: 16 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#666", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>
            🎬 쇼츠 클립 후보 ({clips.length}건, 총 {totalSeconds}초)
          </div>
          {suggestedFlow && (
            <div style={{ marginBottom: 12, padding: 10, background: "#fef3c7", borderRadius: 4, fontSize: 13, color: "#78350f" }}>
              💡 추천 흐름: {suggestedFlow}
            </div>
          )}
          <div style={{ maxHeight: "35vh", overflowY: "auto" }}>
            {clips.map((c, i) => {
              const ims = IMPACT_STYLES[c.impact] || IMPACT_STYLES.medium;
              return (
                <div key={i} style={{ padding: 10, marginBottom: 6, background: "#fafafa", borderLeft: `3px solid ${ims.color}`, borderRadius: 3, fontSize: 13 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                    <span style={{ fontWeight: 600, color: "#222" }}>{c.speaker || "?"} · {c.estimated_seconds || "?"}초</span>
                    <span style={{ fontSize: 11, padding: "1px 6px", background: ims.bg, color: ims.color, borderRadius: 3, fontWeight: 700 }}>
                      {ims.label}
                    </span>
                  </div>
                  <div style={{ fontStyle: "italic", color: "#222", lineHeight: 1.5, marginBottom: 4 }}>
                    "{c.text}"
                  </div>
                  {c.reason && (
                    <div style={{ fontSize: 11, color: "#666" }}>
                      이유: {c.reason}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* YouTube 챕터 */}
      {chapters.length > 0 && (
        <div style={{ borderTop: "1px solid #eee", paddingTop: 12 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#666", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>
            📑 YouTube 챕터 ({chapters.length})
          </div>
          {videoTitleSuggestion && (
            <div style={{ marginBottom: 12, padding: 10, background: "#ecfdf5", borderRadius: 4, fontSize: 13, color: "#065f46" }}>
              💡 영상 제목 제안: <strong>{videoTitleSuggestion}</strong>
            </div>
          )}
          <div style={{ maxHeight: "35vh", overflowY: "auto" }}>
            {chapters.map((ch, i) => (
              <div key={i} style={{ padding: 10, marginBottom: 4, background: "#fafafa", borderLeft: "3px solid #06b6d4", borderRadius: 3, fontSize: 13 }}>
                <div style={{ fontWeight: 700, color: "#0e7490", marginBottom: 4 }}>
                  {String(i + 1).padStart(2, "0")}. {ch.title}
                </div>
                {ch.summary && (
                  <div style={{ fontSize: 12, color: "#444", marginBottom: 4 }}>{ch.summary}</div>
                )}
                {ch.anchor_text && (
                  <div style={{ fontSize: 11, color: "#888", fontStyle: "italic" }}>
                    🔍 anchor: "{(ch.anchor_text || "").slice(0, 80)}..."
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
