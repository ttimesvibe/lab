// lab fresh v2 — GuideTab (★ baseline stub)
// 사료: S2.4.2.d 편집 가이드 + LLM /highlights 2-Pass

export function GuideTab({ tabId, data, onSave, sessionId, config, currentTab, authUser }) {
  const hl = data?.hl || [];
  const hlVerdicts = data?.hlVerdicts || {};
  const hlEdits = data?.hlEdits || {};
  const hlMarkers = data?.hlMarkers || {};

  function handleVerdict(stableId, verdict) {
    onSave({ ...data, hlVerdicts: { ...hlVerdicts, [stableId]: verdict } });
  }

  function handleEdit(stableId, text) {
    onSave({ ...data, hlEdits: { ...hlEdits, [stableId]: text } });
  }

  function handleMarker(stableId, color) {
    onSave({ ...data, hlMarkers: { ...hlMarkers, [stableId]: color } });
  }

  return (
    <div className="tab tab-guide">
      <h2>편집 가이드 (Guide)</h2>
      <div className="metadata">
        강조자막 {hl.length} 개 / verdict {Object.keys(hlVerdicts).length}
      </div>
      <p>★ baseline stub — 실 강조자막 UI + 2-Pass LLM 호출은 후속 마일스톤.</p>
    </div>
  );
}
