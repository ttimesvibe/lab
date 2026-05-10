// lab fresh v2 — CorrectionTab (★ baseline stub)
// 사료: S2.4.2.b 1차 교정 + LLM /analyze + /correct + validateCorrections

export function CorrectionTab({ tabId, data, onSave, sessionId, config, currentTab, authUser }) {
  const blocks = data?.blocks || [];
  const anal = data?.anal || null;
  const diffs = data?.diffs || [];
  const scriptEdits = data?.scriptEdits || {};
  const blockDeletions = data?.blockDeletions || {};

  function handleBlockEdit(blockIndex, newText) {
    const newBlocks = blocks.map((b) =>
      b.index === blockIndex ? { ...b, text: newText } : b
    );
    onSave({ ...data, blocks: newBlocks });
  }

  function handleScriptEditUpdate(blockIndex, text) {
    onSave({ ...data, scriptEdits: { ...scriptEdits, [blockIndex]: text } });
  }

  return (
    <div className="tab tab-correction">
      <h2>1차 교정 (Correction)</h2>
      <div className="metadata">
        블록 {blocks.length} / 분석 {anal ? "✓" : "X"} / diffs {diffs.length}
      </div>
      {blocks.length === 0 ? (
        <p>0차 검토에서 [1차 편집 시작] 을 누르세요.</p>
      ) : (
        <div>
          <p>★ baseline stub — 실 교정 UI 는 후속 마일스톤 (M3+).</p>
          <p>현재: 데이터 표시 + onSave callback 검증.</p>
        </div>
      )}
    </div>
  );
}
