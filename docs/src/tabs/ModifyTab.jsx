// lab fresh v2 — ModifyTab (★ 실 UI Phase 9 — 수정 카드 + YouTube 임베딩)
// 사료: S2.4.2.f 수정사항 + S4a.4 모범 5건 (TAB-MOD-01~03)
//
// 책임:
//   - YouTube URL 입력 → 자동 videoId 추출 → 임베드
//   - 수정 카드 추가/편집/삭제 (timestamp + note + status)
//   - LLM 호출 X (편집자 메모용)

import { useState } from "react";

const STATUS_STYLES = {
  pending:    { color: "#d97706", bg: "#fef3c7", label: "⏳ 대기" },
  done:       { color: "#16a34a", bg: "#d1fae5", label: "✅ 완료" },
  in_progress: { color: "#3b82f6", bg: "#dbeafe", label: "🔄 진행 중" },
};

/**
 * YouTube URL → videoId 추출.
 *   https://www.youtube.com/watch?v=ABC123  → "ABC123"
 *   https://youtu.be/ABC123                  → "ABC123"
 *   https://www.youtube.com/embed/ABC123     → "ABC123"
 */
function extractYouTubeId(url) {
  if (!url || typeof url !== "string") return "";
  const patterns = [
    /youtube\.com\/watch\?v=([a-zA-Z0-9_-]{11})/,
    /youtu\.be\/([a-zA-Z0-9_-]{11})/,
    /youtube\.com\/embed\/([a-zA-Z0-9_-]{11})/,
  ];
  for (const re of patterns) {
    const m = url.match(re);
    if (m) return m[1];
  }
  return "";
}

export function ModifyTab({ tabId, data, allTabData, onSave, onMultiSave, sessionId, config, currentTab, authUser }) {
  const cards = data?.cards || [];
  const videoUrl = data?.videoUrl || "";
  const videoId = data?.videoId || extractYouTubeId(videoUrl);
  const title = data?.title || allTabData?.meta?.fn || "";

  const [urlInput, setUrlInput] = useState(videoUrl);
  const [newCardTs, setNewCardTs] = useState("");
  const [newCardNote, setNewCardNote] = useState("");
  const [editingId, setEditingId] = useState(null);
  const [editNote, setEditNote] = useState("");

  function handleSaveVideoUrl() {
    const id = extractYouTubeId(urlInput.trim());
    onSave({ ...data, videoUrl: urlInput.trim(), videoId: id });
  }

  function handleAddCard() {
    if (!newCardNote.trim()) return;
    const newCard = {
      _stableId: `card_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      timestamp: newCardTs.trim(),
      note: newCardNote.trim(),
      status: "pending",
      createdAt: new Date().toISOString(),
    };
    onSave({ ...data, cards: [...cards, newCard] });
    setNewCardTs("");
    setNewCardNote("");
  }

  function handleStatusChange(id, newStatus) {
    const newCards = cards.map((c) => (c._stableId === id ? { ...c, status: newStatus, updatedAt: new Date().toISOString() } : c));
    onSave({ ...data, cards: newCards });
  }

  function handleEditStart(card) {
    setEditingId(card._stableId);
    setEditNote(card.note || "");
  }

  function handleEditSave(id) {
    const newCards = cards.map((c) => (c._stableId === id ? { ...c, note: editNote.trim(), updatedAt: new Date().toISOString() } : c));
    onSave({ ...data, cards: newCards });
    setEditingId(null);
    setEditNote("");
  }

  function handleDelete(id) {
    if (!confirm("이 카드를 삭제하시겠습니까?")) return;
    const newCards = cards.filter((c) => c._stableId !== id);
    onSave({ ...data, cards: newCards });
  }

  // 상태별 카운트
  const counts = {
    pending: cards.filter((c) => c.status === "pending").length,
    in_progress: cards.filter((c) => c.status === "in_progress").length,
    done: cards.filter((c) => c.status === "done").length,
  };

  return (
    <div className="tab tab-modify">
      <h2 style={{ margin: "0 0 12px 0" }}>수정사항 (Modify)</h2>

      {/* 영상 URL 입력 + 임베드 */}
      <div style={{ marginBottom: 16, padding: 12, background: "#f9fafb", borderRadius: 6 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: "#666", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>
          📹 영상 (YouTube URL)
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            type="text"
            placeholder="https://www.youtube.com/watch?v=... 또는 https://youtu.be/..."
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            style={{ flex: 1, padding: "6px 10px", border: "1px solid #d1d5db", borderRadius: 4, fontSize: 13 }}
          />
          <button
            onClick={handleSaveVideoUrl}
            disabled={!urlInput.trim() || urlInput.trim() === videoUrl}
            style={{
              padding: "6px 14px", borderRadius: 4, border: "none",
              background: !urlInput.trim() || urlInput.trim() === videoUrl ? "#bbb" : "#3b82f6",
              color: "#fff", fontSize: 13, fontWeight: 600,
              cursor: !urlInput.trim() || urlInput.trim() === videoUrl ? "not-allowed" : "pointer",
            }}
          >
            저장
          </button>
        </div>
        {videoId && (
          <div style={{ marginTop: 10 }}>
            <div style={{ fontSize: 11, color: "#666", marginBottom: 4 }}>
              videoId: <code style={{ background: "#fff", padding: "1px 4px", borderRadius: 2 }}>{videoId}</code>
            </div>
            <div style={{ position: "relative", paddingBottom: "56.25%", height: 0, overflow: "hidden", borderRadius: 4 }}>
              <iframe
                src={`https://www.youtube.com/embed/${videoId}`}
                title="YouTube preview"
                frameBorder="0"
                allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
                style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%" }}
              />
            </div>
          </div>
        )}
      </div>

      {/* 상태 카드 */}
      <div style={{ display: "flex", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 120, padding: 10, background: "#fef3c7", borderRadius: 6 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: "#78350f", marginBottom: 4 }}>⏳ 대기</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: "#92400e" }}>{counts.pending}</div>
        </div>
        <div style={{ flex: 1, minWidth: 120, padding: 10, background: "#dbeafe", borderRadius: 6 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: "#1e3a8a", marginBottom: 4 }}>🔄 진행 중</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: "#1d4ed8" }}>{counts.in_progress}</div>
        </div>
        <div style={{ flex: 1, minWidth: 120, padding: 10, background: "#d1fae5", borderRadius: 6 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: "#065f46", marginBottom: 4 }}>✅ 완료</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: "#047857" }}>{counts.done}</div>
        </div>
        <div style={{ flex: 1, minWidth: 120, padding: 10, background: "#f3f4f6", borderRadius: 6 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: "#374151", marginBottom: 4 }}>📋 전체</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: "#1f2937" }}>{cards.length}</div>
        </div>
      </div>

      {/* 카드 추가 폼 */}
      <div style={{ marginBottom: 16, padding: 12, background: "#f0f9ff", borderRadius: 6, border: "1px dashed #93c5fd" }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: "#0369a1", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>
          ➕ 새 수정사항 추가
        </div>
        <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
          <input
            type="text"
            placeholder="타임스탬프 (선택, 예: 1:23:45)"
            value={newCardTs}
            onChange={(e) => setNewCardTs(e.target.value)}
            style={{ width: 200, padding: "6px 10px", border: "1px solid #d1d5db", borderRadius: 4, fontSize: 13 }}
          />
          <input
            type="text"
            placeholder="수정 내용 (필수)"
            value={newCardNote}
            onChange={(e) => setNewCardNote(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleAddCard();
            }}
            style={{ flex: 1, padding: "6px 10px", border: "1px solid #d1d5db", borderRadius: 4, fontSize: 13 }}
          />
          <button
            onClick={handleAddCard}
            disabled={!newCardNote.trim()}
            style={{
              padding: "6px 16px", borderRadius: 4, border: "none",
              background: !newCardNote.trim() ? "#bbb" : "#0ea5e9",
              color: "#fff", fontSize: 13, fontWeight: 700,
              cursor: !newCardNote.trim() ? "not-allowed" : "pointer",
            }}
          >
            추가
          </button>
        </div>
        <div style={{ fontSize: 11, color: "#666" }}>
          ★ Enter 키로도 추가 가능
        </div>
      </div>

      {/* 카드 목록 */}
      {cards.length === 0 ? (
        <div style={{ padding: 16, background: "#f7f7f7", borderRadius: 4, color: "#666" }}>
          수정사항 없음. 위 폼으로 새 카드를 추가하세요.
        </div>
      ) : (
        <div style={{ borderTop: "1px solid #eee", paddingTop: 12 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#666", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>
            수정 카드 ({cards.length})
          </div>
          <div style={{ maxHeight: "55vh", overflowY: "auto" }}>
            {cards.map((c) => {
              const ss = STATUS_STYLES[c.status] || STATUS_STYLES.pending;
              const isEditing = editingId === c._stableId;
              return (
                <div key={c._stableId} style={{ padding: 10, marginBottom: 6, background: "#fff", border: `1px solid ${ss.color}`, borderLeft: `4px solid ${ss.color}`, borderRadius: 4 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                    <span style={{ fontSize: 11, color: "#666" }}>
                      {c.timestamp && <code style={{ background: "#f3f4f6", padding: "1px 4px", borderRadius: 2, marginRight: 6 }}>{c.timestamp}</code>}
                      <span style={{ color: "#999" }}>{c.createdAt ? new Date(c.createdAt).toLocaleString("ko-KR") : ""}</span>
                    </span>
                    <select
                      value={c.status || "pending"}
                      onChange={(e) => handleStatusChange(c._stableId, e.target.value)}
                      style={{ padding: "2px 6px", border: `1px solid ${ss.color}`, color: ss.color, background: ss.bg, borderRadius: 3, fontSize: 11, fontWeight: 600 }}
                    >
                      <option value="pending">⏳ 대기</option>
                      <option value="in_progress">🔄 진행 중</option>
                      <option value="done">✅ 완료</option>
                    </select>
                  </div>

                  {isEditing ? (
                    <div style={{ display: "flex", gap: 4 }}>
                      <input
                        type="text"
                        value={editNote}
                        onChange={(e) => setEditNote(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") handleEditSave(c._stableId);
                          if (e.key === "Escape") { setEditingId(null); setEditNote(""); }
                        }}
                        autoFocus
                        style={{ flex: 1, padding: "4px 8px", border: "1px solid #3b82f6", borderRadius: 3, fontSize: 13 }}
                      />
                      <button onClick={() => handleEditSave(c._stableId)} style={{ padding: "4px 10px", border: "none", background: "#3b82f6", color: "#fff", borderRadius: 3, cursor: "pointer", fontSize: 12 }}>저장</button>
                      <button onClick={() => { setEditingId(null); setEditNote(""); }} style={{ padding: "4px 10px", border: "1px solid #ccc", background: "#fff", borderRadius: 3, cursor: "pointer", fontSize: 12 }}>취소</button>
                    </div>
                  ) : (
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                      <div style={{ flex: 1, fontSize: 14, color: "#222", lineHeight: 1.5, wordBreak: "keep-all" }}>
                        {c.note}
                      </div>
                      <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                        <button onClick={() => handleEditStart(c)} style={{ padding: "3px 8px", border: "1px solid #ccc", background: "#fff", borderRadius: 3, cursor: "pointer", fontSize: 11 }}>편집</button>
                        <button onClick={() => handleDelete(c._stableId)} style={{ padding: "3px 8px", border: "1px solid #ef4444", color: "#ef4444", background: "#fff", borderRadius: 3, cursor: "pointer", fontSize: 11 }}>삭제</button>
                      </div>
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
