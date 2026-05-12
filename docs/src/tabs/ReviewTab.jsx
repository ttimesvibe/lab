// lab fresh v2 — ReviewTab (★ 실 UI Phase 2, paragraphs 시각화 + 삭제선)
// 사료: editor/docs/src/tabs/ReviewTab.jsx (prod) + S2.4.2.a 0차 검토
//
// 책임:
//   - 0차 검토 화면: 분량 요약 + paragraphs 본문 표시 + 삭제선 시각화
//   - "1차 교정 시작" 버튼 (Phase 3 에서 /analyze + /correct 연동 예정)
//
// 본 컴포넌트는 사실상 read-only — paragraphs/blocks 직접 편집 X.
//   onSave 는 _correctionStarted flag 박제 (engine markDirty trigger).

export function ReviewTab({ tabId, data, onSave, sessionId, config, currentTab, authUser }) {
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

  function handleStartCorrection() {
    // ★ Phase 3 에서 /analyze + /correct 연동 예정
    onSave({ ...data, _correctionStarted: true });
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

      {/* 진행 버튼 */}
      <div style={{ marginBottom: 16, display: "flex", justifyContent: "flex-end" }}>
        <button
          onClick={handleStartCorrection}
          style={{
            padding: "8px 20px", borderRadius: 6, border: "none",
            background: "linear-gradient(135deg, #4a6cf7, #7c3aed)",
            color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer",
            boxShadow: "0 2px 8px rgba(74,108,247,0.3)",
          }}
        >
          {hasTrackChanges ? "삭제선 제거 → 1차 교정 시작" : "1차 교정 시작"}
        </button>
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
