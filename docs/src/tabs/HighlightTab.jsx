// lab fresh v2 — HighlightTab (★ baseline stub)
// 사료: S2.4.2.g 하이라이트 + LLM /hl-recommend + /hl-timestamps
// ★ S4a.3 / S4c.5 PS10: dangerouslySetInnerHTML XSS — 본 baseline 에선 textContent + DOMPurify 의무.

export function HighlightTab({ tabId, data, onSave, sessionId, config, currentTab, authUser }) {
  const clips = data?.clips || [];
  const hl = data?.hl || [];

  function handleClipUpdate(stableId, updates) {
    const newClips = clips.map((c) => (c._stableId === stableId ? { ...c, ...updates } : c));
    onSave({ ...data, clips: newClips });
  }

  return (
    <div className="tab tab-highlight">
      <h2>하이라이트 (Highlight)</h2>
      <div className="metadata">
        클립 {clips.length} / 강조자막 {hl.length}
      </div>
      <p>★ baseline stub — 실 클립 UI 는 후속 마일스톤.</p>
      <p>
        ★ DOMPurify 의무 — innerHTML 사용 X 또는 sanitize 적용 (S4c.5 PS10).
      </p>
    </div>
  );
}
