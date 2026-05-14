// lab fresh v2 — CorrectionTab (★ 실 UI Phase 3b, /correct chunked + diff)
// 사료: S2.4.2.b 1차 교정 + worker /correct (BASE_CORRECT_PROMPT + Step 1-V 8 rule)

import { useState } from "react";
import { apiCorrect } from "../utils/api.js";
import { splitChunks, chunkToText, chunkCtx } from "../utils/lengthModel.js";

/**
 * Color per diff type — 시각 분류.
 */
const DIFF_TYPE_STYLES = {
  filler_removal:  { bg: "#fef3c7", border: "#f59e0b", label: "필러 제거" },
  term_correction: { bg: "#dbeafe", border: "#3b82f6", label: "용어 교정" },
  spelling:        { bg: "#e0e7ff", border: "#6366f1", label: "맞춤법" },
};

export function CorrectionTab({ tabId, data, onSave, onMultiSave, sessionId, config, currentTab, authUser }) {
  const blocks = data?.blocks || [];
  const anal = data?.anal || null;
  const diffs = data?.diffs || [];

  const [correcting, setCorrecting] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [error, setError] = useState("");

  // block_index → changes[] 로 인덱싱 (시각화 빠르게)
  const diffByBlock = new Map();
  for (const chunk of diffs) {
    for (const change of chunk.changes || []) {
      const idx = chunk.block_index ?? change.block_index;
      if (idx === undefined) continue;
      if (!diffByBlock.has(idx)) diffByBlock.set(idx, []);
      diffByBlock.get(idx).push(change);
    }
  }
  const totalChanges = diffs.reduce((sum, c) => sum + (c.changes?.length || 0), 0);

  async function handleStartCorrect() {
    if (correcting) return;
    if (!anal) {
      setError("사전 분석 (0차 검토 → 사전 분석 시작) 먼저 실행하세요.");
      return;
    }
    if (blocks.length === 0) {
      setError("교정 대상 블록이 없습니다.");
      return;
    }

    setCorrecting(true);
    setError("");

    try {
      // ★ 빈 텍스트 블록 제외 (strike 전체였던 블록은 .index 보존을 위해 빈 텍스트로 박혀있음)
      const blocksForLLM = blocks.filter((b) => b.text && b.text.trim().length > 0);
      // ★ splitChunks: 8K 자 청크 + 2 블록 context overlap
      // (이전 15K — gpt-4o-mini 응답이 timeout 초과 사례 → 8K 로 축소, 호출 횟수는 늘지만 각각 빨라짐)
      const chunks = splitChunks(blocksForLLM, 8000);
      setProgress({ done: 0, total: chunks.length });

      const allDiffs = [];
      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        const chunkText = chunkToText(chunk);
        const contextBlocks = chunkCtx(chunk);

        const r = await apiCorrect({
          chunk_text: chunkText,
          chunk_index: i,
          total_chunks: chunks.length,
          context_blocks: contextBlocks,
          analysis: anal,
        }, config);

        if (!r?.success || !r?.result) {
          throw new Error(`청크 ${i + 1}/${chunks.length} 교정 실패: ${r?.error || "응답 형식 X"}`);
        }
        if (Array.isArray(r.result.chunks)) {
          allDiffs.push(...r.result.chunks);
        }
        setProgress({ done: i + 1, total: chunks.length });
      }

      // correction.diffs 박제
      onSave({ ...data, diffs: allDiffs });
    } catch (e) {
      console.error("[CorrectionTab] correct error:", e);
      setError(e?.message || String(e));
    } finally {
      setCorrecting(false);
    }
  }

  return (
    <div className="tab tab-correction">
      <h2 style={{ margin: "0 0 12px 0" }}>1차 교정 (Correction)</h2>

      {/* 상태 카드 */}
      <div style={{ display: "flex", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 160, padding: 12, background: "#f0f4ff", borderRadius: 6 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#345", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4 }}>
            📦 입력 블록
          </div>
          <div style={{ fontSize: 20, fontWeight: 700, color: "#234" }}>{blocks.length}</div>
        </div>
        <div style={{ flex: 1, minWidth: 160, padding: 12, background: anal ? "#ecfdf5" : "#fee2e2", borderRadius: 6 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: anal ? "#065f46" : "#991b1b", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4 }}>
            🔍 사전 분석
          </div>
          <div style={{ fontSize: 20, fontWeight: 700, color: anal ? "#047857" : "#dc2626" }}>
            {anal ? "✓" : "미실행"}
          </div>
          {anal && (
            <div style={{ fontSize: 11, color: "#059669", marginTop: 2 }}>
              {anal.term_corrections?.length || 0} 매핑 · {anal.speakers?.length || 0} 화자
            </div>
          )}
        </div>
        <div style={{ flex: 1, minWidth: 160, padding: 12, background: "#fef3c7", borderRadius: 6 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#78350f", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4 }}>
            ✏️ 교정 변경
          </div>
          <div style={{ fontSize: 20, fontWeight: 700, color: "#92400e" }}>{totalChanges}</div>
          <div style={{ fontSize: 11, color: "#b45309", marginTop: 2 }}>
            {diffs.length} 청크 / {diffByBlock.size} 블록
          </div>
        </div>
      </div>

      {/* 실행 버튼 */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 12 }}>
          {correcting && (
            <span style={{ color: "#06f", fontSize: 13 }}>
              교정 중... 청크 {progress.done}/{progress.total} (각 30-60초 소요)
            </span>
          )}
          <button
            onClick={handleStartCorrect}
            disabled={correcting || !anal || blocks.length === 0}
            style={{
              padding: "8px 20px", borderRadius: 6, border: "none",
              background: (correcting || !anal) ? "#bbb" : "linear-gradient(135deg, #4a6cf7, #7c3aed)",
              color: "#fff", fontSize: 13, fontWeight: 700,
              cursor: (correcting || !anal) ? "not-allowed" : "pointer",
              boxShadow: (correcting || !anal) ? "none" : "0 2px 8px rgba(74,108,247,0.3)",
            }}
          >
            {totalChanges > 0 ? "1차 교정 재실행" : "1차 교정 시작"}
          </button>
        </div>
        {error && (
          <div style={{ marginTop: 8, padding: 10, background: "#fee2e2", borderRadius: 4, color: "#991b1b", fontSize: 13 }}>
            ❌ {error}
          </div>
        )}
        {totalChanges > 0 && !correcting && (
          <div style={{ marginTop: 8, padding: 10, background: "#ecfdf5", borderRadius: 4, fontSize: 13, color: "#065f46" }}>
            ✅ 1차 교정 완료 — 아래 블록별 diff 확인. 저장 버튼 누르면 KV 에 박힘.
          </div>
        )}
      </div>

      {/* 블록 별 diff (간이) */}
      {blocks.length === 0 ? (
        <p style={{ color: "#666" }}>0차 검토 탭에서 사전 분석을 먼저 실행하세요.</p>
      ) : (
        <div style={{ borderTop: "1px solid #eee", paddingTop: 12 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#666", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>
            교정 결과 (블록별)
          </div>
          <div style={{ maxHeight: "55vh", overflowY: "auto", fontSize: 13, lineHeight: 1.6 }}>
            {blocks.map((b) => {
              const changes = diffByBlock.get(b.index) || [];
              return (
                <div key={b.index} style={{ marginBottom: 12, padding: 10, background: changes.length > 0 ? "#fffbeb" : "#fafafa", borderRadius: 4, border: changes.length > 0 ? "1px solid #fde68a" : "1px solid #eee" }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: "#666", marginBottom: 4 }}>
                    [{b.index}] {b.speaker} {b.timestamp}
                    {changes.length > 0 && (
                      <span style={{ marginLeft: 8, padding: "1px 6px", background: "#f59e0b", color: "#fff", borderRadius: 3, fontSize: 10 }}>
                        {changes.length} 변경
                      </span>
                    )}
                  </div>
                  <div style={{ whiteSpace: "pre-wrap", wordBreak: "keep-all" }}>{b.text}</div>
                  {changes.length > 0 && (
                    <div style={{ marginTop: 6, paddingTop: 6, borderTop: "1px dashed #f59e0b" }}>
                      {changes.map((ch, ci) => {
                        const style = DIFF_TYPE_STYLES[ch.type] || { bg: "#f3f4f6", border: "#9ca3af", label: ch.type };
                        return (
                          <div key={ci} style={{ marginBottom: 4, padding: 6, background: style.bg, borderLeft: `3px solid ${style.border}`, borderRadius: 3 }}>
                            <div style={{ fontSize: 10, fontWeight: 700, color: style.border, marginBottom: 2 }}>
                              {style.label}{ch.subtype ? ` · ${ch.subtype}` : ""}
                            </div>
                            <div style={{ fontSize: 12 }}>
                              <span style={{ textDecoration: "line-through", color: "#991b1b" }}>{ch.original}</span>
                              {" → "}
                              <span style={{ color: "#065f46", fontWeight: 600 }}>{ch.corrected}</span>
                            </div>
                            {ch.reason && (
                              <div style={{ fontSize: 11, color: "#666", marginTop: 2 }}>{ch.reason}</div>
                            )}
                          </div>
                        );
                      })}
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
