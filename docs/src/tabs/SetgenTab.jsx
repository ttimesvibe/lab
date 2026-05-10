// lab fresh v2 — SetgenTab (★ baseline stub)
// 사료: S2.4.2.h 세트 + LLM /setgen

export function SetgenTab({ tabId, data, onSave, sessionId, config, currentTab, authUser }) {
  const sets = data?.sets || [];
  const result = data?.result || null;
  const sel = data?.sel || null;
  const edits = data?.edits || {};

  function handleSelect(stableId, selected) {
    onSave({ ...data, sel: { ...(sel || {}), [stableId]: selected } });
  }

  function handleEdit(stableId, fields) {
    onSave({ ...data, edits: { ...edits, [stableId]: fields } });
  }

  return (
    <div className="tab tab-setgen">
      <h2>세트 (Setgen)</h2>
      <div className="metadata">
        세트 {sets.length} / 결과 {result ? "✓" : "X"}
      </div>
      <p>★ baseline stub — 실 세트 UI + LLM 호출은 후속 마일스톤.</p>
    </div>
  );
}
