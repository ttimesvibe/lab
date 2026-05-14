// lab fresh v2 — ScriptTab (★ 사료 §4.2.c 정합 재구현)
//
// 사료 본질 (PRD §4.2.c + §12.1):
//   UI "스크립트" 탭 = "1차 교정의 단순 텍스트 추출"
//     - 1차 교정된 본문을 자연스러운 문단으로 통독 (영상 편집 전 참고용 최종 원고)
//     - 삭제선 자동 적용 (이미 cleanText 기반)
//     - 사용자가 블록 단위로 추가 편집 가능
//     - 별도 KV 키 없음 — correction.scriptEdits[block.index] 에 동봉 (dirtyKey: "correction")
//
//   internal "자막" (subtitle) = /subtitle-format LLM 결과 (PRD §4.2.j)
//     - 영상에 박을 자막 (15-25자 strict 짧은 줄들) — 시청자용
//     - 사료가 internal 로 분류 — 사용자가 매번 보고 만지는 영역 아님
//     - 현 lab 에 export 단계 없음 → ScriptTab 하단 details 영역에 internal 의미로 배치

import { useState } from "react";
import { apiSubtitleFormat } from "../utils/api.js";

export function ScriptTab({ tabId, data, allTabData, onSave, onMultiSave, sessionId, config, currentTab, authUser }) {
  // ★ 통원고 데이터 = correction 의 1차 교정 결과
  const correction = allTabData?.correction || {};
  const correctionBlocks = correction.blocks || [];
  const scriptEdits = correction.scriptEdits || {};  // key=block.index, value=편집된 text

  // ★ 자막 (subtitle) internal data — details 펼침으로만 노출
  const subtitles = data?.subtitles || [];
  const subtitleFormat = data?.format || null;
  const subtitleGeneratedAt = data?._generatedAt || null;

  const [editingBlockIdx, setEditingBlockIdx] = useState(null);
  const [editText, setEditText] = useState("");
  const [showSubtitle, setShowSubtitle] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [subtitleError, setSubtitleError] = useState("");

  // 블록 별 표시 텍스트 = scriptEdits 우선 (사용자 편집본), fallback = correction.blocks 의 .text
  function getDisplayText(block) {
    return (scriptEdits[block.index] !== undefined && scriptEdits[block.index] !== null)
      ? scriptEdits[block.index]
      : (block.text || "");
  }

  function isEdited(block) {
    return scriptEdits[block.index] !== undefined && scriptEdits[block.index] !== block.text;
  }

  function handleStartEdit(block) {
    setEditingBlockIdx(block.index);
    setEditText(getDisplayText(block));
  }

  function handleSaveEdit(block) {
    const trimmed = editText.trim();
    const orig = block.text || "";
    const newScriptEdits = { ...scriptEdits };
    if (trimmed === orig.trim()) {
      // 원본과 같으면 entry 제거
      delete newScriptEdits[block.index];
    } else {
      newScriptEdits[block.index] = trimmed;
    }
    // ★ correction.scriptEdits 동봉 박제 (dirtyKey: "correction", PRD §12.1)
    if (typeof onMultiSave === "function") {
      onMultiSave({ correction: { ...correction, scriptEdits: newScriptEdits } });
    }
    setEditingBlockIdx(null);
    setEditText("");
  }

  function handleCancelEdit() {
    setEditingBlockIdx(null);
    setEditText("");
  }

  function handleRevert(block) {
    if (!confirm("이 블록의 편집을 취소하고 1차 교정 원본으로 되돌리시겠습니까?")) return;
    const newScriptEdits = { ...scriptEdits };
    delete newScriptEdits[block.index];
    if (typeof onMultiSave === "function") {
      onMultiSave({ correction: { ...correction, scriptEdits: newScriptEdits } });
    }
  }

  // ─── 자막 (internal) 생성 ────────────────────────────────────────────
  async function handleGenerateSubtitle() {
    if (generating || correctionBlocks.length === 0) return;
    setGenerating(true);
    setSubtitleError("");
    try {
      // 사용자 편집 반영된 본문으로 자막 생성
      const inputText = correctionBlocks
        .filter((b) => getDisplayText(b).trim().length > 0)
        .map((b) => `[${b.speaker || "화자"}] ${getDisplayText(b)}`)
        .join("\n\n");

      const r = await apiSubtitleFormat({ version: "v3", text: inputText }, config);
      if (!r?.success || typeof r.formatted !== "string") {
        throw new Error(r?.error || "응답 형식 X");
      }
      const lines = r.formatted.split("\n").filter((l) => l.trim().length > 0);
      const newSubtitles = lines.map((line, i) => ({ index: i, text: line.trim() }));
      onSave({
        ...data,
        subtitles: newSubtitles,
        format: "v3",
        _generatedAt: new Date().toISOString(),
      });
    } catch (e) {
      setSubtitleError(e?.message || String(e));
    } finally {
      setGenerating(false);
    }
  }

  // 통계
  const totalBlocks = correctionBlocks.length;
  const editedCount = Object.keys(scriptEdits).filter((k) => {
    const b = correctionBlocks.find((bb) => String(bb.index) === String(k));
    return b && scriptEdits[k] !== b.text;
  }).length;
  const totalChars = correctionBlocks.reduce((s, b) => s + getDisplayText(b).length, 0);

  return (
    <div className="tab tab-script">
      <h2 style={{ margin: "0 0 12px 0" }}>스크립트 — 1차 교정 통원고</h2>
      <div style={{ fontSize: 12, color: "#666", marginBottom: 12 }}>
        ★ 1차 교정된 본문을 통독하며 자유롭게 다듬는 영역. 블록 클릭으로 인라인 편집.
        사용자 편집은 <code>correction.scriptEdits</code> 에 동봉 저장 (별도 KV 키 X).
      </div>

      {/* 통계 카드 */}
      <div style={{ display: "flex", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 140, padding: 10, background: "#f0f4ff", borderRadius: 6 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: "#345", marginBottom: 4 }}>📦 블록</div>
          <div style={{ fontSize: 18, fontWeight: 700, color: "#234" }}>{totalBlocks}</div>
        </div>
        <div style={{ flex: 1, minWidth: 140, padding: 10, background: editedCount > 0 ? "#fef3c7" : "#fafafa", borderRadius: 6 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: editedCount > 0 ? "#78350f" : "#666", marginBottom: 4 }}>✏️ 편집된 블록</div>
          <div style={{ fontSize: 18, fontWeight: 700, color: editedCount > 0 ? "#92400e" : "#666" }}>{editedCount}</div>
        </div>
        <div style={{ flex: 1, minWidth: 140, padding: 10, background: "#fafafa", borderRadius: 6 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: "#666", marginBottom: 4 }}>📝 전체 분량</div>
          <div style={{ fontSize: 18, fontWeight: 700, color: "#222" }}>{totalChars.toLocaleString()} 자</div>
        </div>
      </div>

      {/* 통원고 — 자연스러운 문단 통독 + 인라인 편집 */}
      {correctionBlocks.length === 0 ? (
        <div style={{ padding: 16, background: "#f7f7f7", borderRadius: 4, color: "#666" }}>
          1차 교정 먼저 완료하세요. (0차 검토 → 사전 분석 → 1차 교정 시작)
        </div>
      ) : (
        <div style={{ borderTop: "1px solid #eee", paddingTop: 12 }}>
          <div style={{ maxHeight: "60vh", overflowY: "auto", fontSize: 14, lineHeight: 1.7 }}>
            {correctionBlocks.map((b) => {
              const isEditing = editingBlockIdx === b.index;
              const edited = isEdited(b);
              const displayText = getDisplayText(b);
              return (
                <div
                  key={b.index}
                  style={{
                    marginBottom: 10,
                    padding: 10,
                    background: isEditing ? "#fffbeb" : edited ? "#fef3c7" : "#fff",
                    border: isEditing ? "2px solid #f59e0b" : edited ? "1px solid #fde68a" : "1px solid #eee",
                    borderRadius: 4,
                  }}
                >
                  <div style={{ fontSize: 11, color: "#666", marginBottom: 4, display: "flex", justifyContent: "space-between" }}>
                    <span>
                      [{b.index}] {b.speaker} {b.timestamp}
                      {edited && <span style={{ marginLeft: 6, padding: "1px 6px", background: "#f59e0b", color: "#fff", borderRadius: 3, fontSize: 10 }}>✏️ 편집됨</span>}
                    </span>
                    {!isEditing && (
                      <span style={{ display: "flex", gap: 4 }}>
                        <button onClick={() => handleStartEdit(b)} style={{ padding: "2px 8px", border: "1px solid #ccc", background: "#fff", borderRadius: 3, cursor: "pointer", fontSize: 11 }}>편집</button>
                        {edited && (
                          <button onClick={() => handleRevert(b)} style={{ padding: "2px 8px", border: "1px solid #ef4444", color: "#ef4444", background: "#fff", borderRadius: 3, cursor: "pointer", fontSize: 11 }}>되돌리기</button>
                        )}
                      </span>
                    )}
                  </div>
                  {isEditing ? (
                    <div>
                      <textarea
                        value={editText}
                        onChange={(e) => setEditText(e.target.value)}
                        autoFocus
                        rows={Math.max(3, Math.ceil(editText.length / 70))}
                        style={{ width: "100%", padding: 8, border: "1px solid #f59e0b", borderRadius: 3, fontSize: 14, lineHeight: 1.6, fontFamily: "inherit", boxSizing: "border-box", resize: "vertical" }}
                        onKeyDown={(e) => {
                          if (e.key === "Escape") handleCancelEdit();
                          if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) handleSaveEdit(b);
                        }}
                      />
                      <div style={{ marginTop: 4, display: "flex", gap: 4, justifyContent: "flex-end" }}>
                        <span style={{ fontSize: 11, color: "#666", alignSelf: "center", marginRight: 8 }}>Ctrl+Enter 저장 · Esc 취소</span>
                        <button onClick={() => handleSaveEdit(b)} style={{ padding: "4px 12px", border: "none", background: "#3b82f6", color: "#fff", borderRadius: 3, cursor: "pointer", fontSize: 12 }}>저장</button>
                        <button onClick={handleCancelEdit} style={{ padding: "4px 12px", border: "1px solid #ccc", background: "#fff", borderRadius: 3, cursor: "pointer", fontSize: 12 }}>취소</button>
                      </div>
                    </div>
                  ) : (
                    <div style={{ whiteSpace: "pre-wrap", wordBreak: "keep-all", color: "#222" }}>
                      {displayText}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ★ 자막 (subtitle) — internal 영역 (사료 §4.2.j) — details 펼침으로만 노출 */}
      <details style={{ marginTop: 20, padding: 12, background: "#f9fafb", borderRadius: 6 }} open={showSubtitle}>
        <summary
          onClick={(e) => { e.preventDefault(); setShowSubtitle(!showSubtitle); }}
          style={{ cursor: "pointer", fontSize: 12, fontWeight: 700, color: "#666", textTransform: "uppercase", letterSpacing: "0.05em" }}
        >
          ★ 자막 포맷팅 (internal — /subtitle-format) — {showSubtitle ? "접기" : "펼치기"}
        </summary>
        <div style={{ marginTop: 10, fontSize: 12, color: "#666" }}>
          사료 §4.2.j: 자막은 internal 산출물. 영상 export 시점에 SRT 등으로 사용. 현재는 미리보기만.
        </div>
        <div style={{ marginTop: 8, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
          <div style={{ fontSize: 12, color: "#444" }}>
            {subtitles.length > 0
              ? `자막 ${subtitles.length} 라인 (format: ${subtitleFormat}${subtitleGeneratedAt ? ` · ${new Date(subtitleGeneratedAt).toLocaleString("ko-KR")}` : ""})`
              : "자막 미생성"}
          </div>
          <button
            onClick={handleGenerateSubtitle}
            disabled={generating || correctionBlocks.length === 0}
            style={{
              padding: "6px 14px", border: "none", borderRadius: 4,
              background: generating || correctionBlocks.length === 0 ? "#bbb" : "#06b6d4",
              color: "#fff", fontSize: 12, fontWeight: 600,
              cursor: generating || correctionBlocks.length === 0 ? "not-allowed" : "pointer",
            }}
          >
            {generating ? "생성 중... (30-90초)" : subtitles.length > 0 ? "자막 재생성" : "자막 생성 (V3)"}
          </button>
        </div>
        {subtitleError && (
          <div style={{ marginTop: 8, padding: 8, background: "#fee2e2", borderRadius: 4, color: "#991b1b", fontSize: 12 }}>
            ❌ {subtitleError}
          </div>
        )}
        {subtitles.length > 0 && (
          <div style={{ marginTop: 10, maxHeight: "30vh", overflowY: "auto", fontSize: 13, lineHeight: 1.6 }}>
            {subtitles.map((s) => {
              const len = (s.text || "").length;
              const violation = len > 25 || len < 10;
              return (
                <div
                  key={s.index}
                  style={{
                    padding: "5px 10px",
                    marginBottom: 2,
                    background: violation ? "#fef3c7" : "#fff",
                    borderLeft: violation ? "3px solid #f59e0b" : "3px solid #e5e7eb",
                    borderRadius: 2,
                    display: "flex",
                    justifyContent: "space-between",
                  }}
                >
                  <span style={{ wordBreak: "keep-all" }}>{s.text}</span>
                  <span style={{ fontSize: 11, color: violation ? "#b45309" : "#999", marginLeft: 12, flexShrink: 0 }}>{len}자</span>
                </div>
              );
            })}
          </div>
        )}
      </details>
    </div>
  );
}
