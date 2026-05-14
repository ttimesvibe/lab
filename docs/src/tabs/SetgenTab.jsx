// lab fresh v2 — SetgenTab (★ 실 UI Phase 8 — /setgen multi-step)
// 사료: S2.4.2.h 세트 + worker SETGEN_KEYWORD_SYSTEM + makeSetgenPrompt 4 type
//
// /setgen multi-step (worker 측 약 60-120초):
//   Step 1: 키워드 + 인상 발언 추출 (gpt-4.1 temp 0.3)
//   Step 2: 트렌드 데이터 병렬 수집 (Google Trends RSS + YT/Google Suggestions + News RSS)
//   Step 3: 3 type 후보 병렬 GPT (balanced + trend + [focus|script])

import { useState } from "react";
import { apiSetgen } from "../utils/api.js";

const TYPE_STYLES = {
  balanced: { color: "#3b82f6", bg: "#dbeafe", label: "⚖️ 밸런스형" },
  trend:    { color: "#ef4444", bg: "#fee2e2", label: "🔍 시의성 극대화" },
  script:   { color: "#10b981", bg: "#d1fae5", label: "📝 스크립트 충실" },
  focus:    { color: "#8b5cf6", bg: "#ede9fe", label: "🎯 선택과 집중" },
};

export function SetgenTab({ tabId, data, allTabData, onSave, onMultiSave, sessionId, config, currentTab, authUser }) {
  const result = data?.result || null;
  const trendData = data?.trendData || {};
  const trendingNow = data?.trendingNow || [];
  const keywordsExtracted = data?.keywordsExtracted || [];
  const notableQuotes = data?.notableQuotes || [];

  // 입력 — correction.blocks 또는 cleanText 우선
  const correctionBlocks = allTabData?.correction?.blocks || [];
  const cleanText = allTabData?.review?.cleanText || allTabData?.manuscript?.text || "";
  const projectName = allTabData?.meta?.fn || "";

  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [focusKeyword, setFocusKeyword] = useState(data?.focusKeyword || "");
  const [guestName, setGuestName] = useState(data?.guestName || "");
  const [guestTitle, setGuestTitle] = useState(data?.guestTitle || "");

  function getInputScript() {
    if (correctionBlocks.length > 0) {
      return correctionBlocks
        .filter((b) => b.text && b.text.trim().length > 0)
        .map((b) => `[${b.speaker || "화자"}] ${b.text}`)
        .join("\n\n");
    }
    return cleanText;
  }

  async function handleStartSetgen() {
    if (running) return;
    const script = getInputScript();
    if (script.length < 200) {
      setError("입력 텍스트가 너무 짧습니다 (최소 200자).");
      return;
    }
    setRunning(true);
    setError("");
    setProgress("세트 생성 중... (트렌드 RSS + 3 GPT 병렬, 60-120초 소요)");

    try {
      const r = await apiSetgen({
        script,
        guest_name: guestName.trim() || undefined,
        guest_title: guestTitle.trim() || undefined,
        focus_keyword: focusKeyword.trim() || undefined,
      }, config);
      if (!r?.success || !r?.result) {
        throw new Error("setgen 실패: " + (r?.error || "응답 형식 X"));
      }

      onSave({
        ...data,
        result: r.result,
        trendData: r.trend_data || {},
        trendingNow: r.trending_now || [],
        keywordsExtracted: r.keywords_extracted || [],
        notableQuotes: r.notable_quotes || [],
        focusKeyword: r.focus_keyword || focusKeyword,
        guestName,
        guestTitle,
        _generatedAt: new Date().toISOString(),
      });
      setProgress(`✅ 3 후보 세트 생성됨 (태그 ${(r.result.tags || []).length}, 썸네일 ${(r.result.thumbnail || []).length}, 제목 ${(r.result.youtube_title || []).length})`);
    } catch (e) {
      console.error("[SetgenTab] setgen error:", e);
      setError(e?.message || String(e));
      setProgress("");
    } finally {
      setRunning(false);
    }
  }

  const hasInput = correctionBlocks.length > 0 || cleanText.length > 200;
  const tags = result?.tags || [];
  const thumbnails = result?.thumbnail || [];
  const titles = result?.youtube_title || [];
  const descriptions = result?.description || [];

  return (
    <div className="tab tab-setgen">
      <h2 style={{ margin: "0 0 12px 0" }}>세트 (YouTube 메타 + 트렌드)</h2>

      {/* 입력 폼 */}
      <div style={{ marginBottom: 16, padding: 12, background: "#f9fafb", borderRadius: 6 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: "#666", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8 }}>
          세트 생성 옵션 (선택)
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
          <input
            type="text"
            placeholder="게스트 이름 (예: 박종천)"
            value={guestName}
            onChange={(e) => setGuestName(e.target.value)}
            disabled={running}
            style={{ flex: 1, minWidth: 160, padding: "6px 10px", border: "1px solid #d1d5db", borderRadius: 4, fontSize: 13 }}
          />
          <input
            type="text"
            placeholder="게스트 직함 (예: 30년 차 개발자)"
            value={guestTitle}
            onChange={(e) => setGuestTitle(e.target.value)}
            disabled={running}
            style={{ flex: 1, minWidth: 160, padding: "6px 10px", border: "1px solid #d1d5db", borderRadius: 4, fontSize: 13 }}
          />
        </div>
        <input
          type="text"
          placeholder="포커스 키워드 (선택 — 입력 시 'focus' type 후보 생성, 미입력 시 'script' type)"
          value={focusKeyword}
          onChange={(e) => setFocusKeyword(e.target.value)}
          disabled={running}
          style={{ width: "100%", padding: "6px 10px", border: "1px solid #d1d5db", borderRadius: 4, fontSize: 13, boxSizing: "border-box" }}
        />
      </div>

      {/* 상태 카드 */}
      <div style={{ display: "flex", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 160, padding: 12, background: hasInput ? "#f0f4ff" : "#fee2e2", borderRadius: 6 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: hasInput ? "#345" : "#991b1b", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4 }}>
            📦 입력
          </div>
          <div style={{ fontSize: 14, fontWeight: 700, color: hasInput ? "#234" : "#dc2626" }}>
            {correctionBlocks.length > 0 ? `1차 교정 ${correctionBlocks.length} 블록` : cleanText.length > 200 ? `${cleanText.length.toLocaleString()} 자` : "입력 부족"}
          </div>
        </div>
        <div style={{ flex: 1, minWidth: 160, padding: 12, background: result ? "#ecfdf5" : "#fef3c7", borderRadius: 6 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: result ? "#065f46" : "#78350f", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4 }}>
            🎬 세트 후보
          </div>
          <div style={{ fontSize: 20, fontWeight: 700, color: result ? "#047857" : "#92400e" }}>
            {result ? thumbnails.length : 0}
          </div>
          {result && (
            <div style={{ fontSize: 11, color: "#059669", marginTop: 2 }}>
              태그 {tags.length} · 제목 {titles.length}
            </div>
          )}
        </div>
        <div style={{ flex: 1, minWidth: 160, padding: 12, background: trendingNow.length > 0 ? "#ecfdf5" : "#fef3c7", borderRadius: 6 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: trendingNow.length > 0 ? "#065f46" : "#78350f", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4 }}>
            🔥 트렌드 (KR)
          </div>
          <div style={{ fontSize: 20, fontWeight: 700, color: trendingNow.length > 0 ? "#047857" : "#92400e" }}>
            {trendingNow.length}
          </div>
        </div>
      </div>

      {/* 실행 버튼 */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 12 }}>
          {running && <span style={{ color: "#06f", fontSize: 13 }}>{progress}</span>}
          <button
            onClick={handleStartSetgen}
            disabled={running || !hasInput}
            style={{
              padding: "8px 20px", borderRadius: 6, border: "none",
              background: running || !hasInput ? "#bbb" : "linear-gradient(135deg, #ef4444, #8b5cf6)",
              color: "#fff", fontSize: 13, fontWeight: 700,
              cursor: running || !hasInput ? "not-allowed" : "pointer",
            }}
          >
            {result ? "🎬 세트 재생성" : "🎬 세트 생성 (트렌드 + 3 GPT 병렬)"}
          </button>
        </div>
        {error && (
          <div style={{ marginTop: 8, padding: 10, background: "#fee2e2", borderRadius: 4, color: "#991b1b", fontSize: 13 }}>
            ❌ {error}
          </div>
        )}
      </div>

      {!hasInput && (
        <div style={{ padding: 16, background: "#f7f7f7", borderRadius: 4, color: "#666" }}>
          1차 교정 완료된 본문 또는 0차 검토의 cleanText 가 필요합니다 (최소 200자).
        </div>
      )}

      {/* 키워드 + 인상 발언 (추출 결과) */}
      {keywordsExtracted.length > 0 && (
        <div style={{ marginBottom: 16, padding: 12, background: "#f9fafb", borderRadius: 6 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#666", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>
            🔑 추출 키워드 ({keywordsExtracted.length})
          </div>
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
            {keywordsExtracted.map((kw, i) => {
              const tn = trendingNow.filter((t) => t.indexOf(kw) >= 0 || kw.indexOf(t) >= 0).length > 0;
              const news = trendData[kw]?.news_24h || 0;
              return (
                <span key={i} style={{ padding: "3px 8px", background: tn ? "#fee2e2" : "#fff", border: "1px solid #d1d5db", borderRadius: 12, fontSize: 12 }}>
                  {kw} {tn && "🔥"} {news > 0 && <span style={{ color: "#666", fontSize: 11 }}>📰{news}</span>}
                </span>
              );
            })}
          </div>
        </div>
      )}

      {/* 3 후보 세트 표시 */}
      {result && thumbnails.length > 0 && (
        <div style={{ borderTop: "1px solid #eee", paddingTop: 12 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#666", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>
            3 후보 세트 (썸네일 / 제목 / 설명문)
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 12 }}>
            {thumbnails.map((th, i) => {
              const ts = TYPE_STYLES[th.type] || TYPE_STYLES.balanced;
              const title = titles[i];
              const desc = descriptions[i];
              return (
                <div key={i} style={{ padding: 12, background: ts.bg, border: `2px solid ${ts.color}`, borderRadius: 6 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: ts.color, marginBottom: 8 }}>
                    {ts.label}
                  </div>

                  {/* 썸네일 */}
                  <div style={{ marginBottom: 10, padding: 8, background: "#fff", borderRadius: 4 }}>
                    <div style={{ fontSize: 10, color: "#888", marginBottom: 4 }}>🖼️ 썸네일</div>
                    {(th.lines || []).map((l, li) => (
                      <div key={li} style={{ fontSize: 14, fontWeight: 700, color: "#222", lineHeight: 1.3 }}>{l}</div>
                    ))}
                    {th.reason && <div style={{ fontSize: 10, color: "#666", marginTop: 4, fontStyle: "italic" }}>{th.reason}</div>}
                  </div>

                  {/* 제목 */}
                  {title && (
                    <div style={{ marginBottom: 10, padding: 8, background: "#fff", borderRadius: 4 }}>
                      <div style={{ fontSize: 10, color: "#888", marginBottom: 4 }}>📝 제목 ({(title.text || "").length}자)</div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: "#222" }}>{title.text}</div>
                      {title.reason && <div style={{ fontSize: 10, color: "#666", marginTop: 4, fontStyle: "italic" }}>{title.reason}</div>}
                    </div>
                  )}

                  {/* 설명문 */}
                  {desc && (
                    <div style={{ padding: 8, background: "#fff", borderRadius: 4 }}>
                      <div style={{ fontSize: 10, color: "#888", marginBottom: 4 }}>📄 설명문</div>
                      <div style={{ fontSize: 12, color: "#222", lineHeight: 1.5, whiteSpace: "pre-wrap" }}>{desc.text}</div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 통합 태그 */}
      {tags.length > 0 && (
        <div style={{ marginTop: 16, padding: 12, background: "#f9fafb", borderRadius: 6 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#666", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>
            🏷️ 통합 태그 ({tags.length})
          </div>
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
            {tags.map((t, i) => (
              <span key={i} style={{ padding: "3px 8px", background: t.source === "both" ? "#fef3c7" : t.source === "trend" ? "#fee2e2" : "#dbeafe", border: "1px solid #d1d5db", borderRadius: 12, fontSize: 12 }}>
                {t.tag}
                <span style={{ marginLeft: 4, fontSize: 10, color: "#666" }}>· {t.source}</span>
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
