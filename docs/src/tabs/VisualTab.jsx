// lab fresh v2 — VisualTab (★ baseline stub)
// 사료: S2.4.2.e 자료-그래픽 + LLM /visuals + /insert-cuts
// ★ S1.10.2.a — 옛 prod 의 부모/자식 비대칭 (visual 자체 fetch + onSave round-trip)
//   본 baseline 에선 자체 fetch X (engine.enterTab 단일 책임).

export function VisualTab({ tabId, data, onSave, sessionId, config, currentTab, authUser }) {
  const visualGuides = data?.visualGuides || [];
  const insertCuts = data?.insertCuts || [];
  const manualResources = data?.manualResources || [];
  const verdicts = data?.verdicts || {};

  function handleVerdictUpdate(stableId, verdict) {
    onSave({ ...data, verdicts: { ...verdicts, [stableId]: verdict } });
  }

  function handleAddManualResource(item) {
    onSave({ ...data, manualResources: [...manualResources, item] });
  }

  return (
    <div className="tab tab-visual">
      <h2>자료·그래픽 (Visual)</h2>
      <div className="metadata">
        자료 {visualGuides.length} / 인서트 {insertCuts.length} /
        수동 자료 {manualResources.length}
      </div>
      <p>★ baseline stub — 실 visual UI + LLM 호출은 후속 마일스톤.</p>
      <p>
        본 컴포넌트는 자체 fetch X (★ 헌장 약속 X — engine.enterTab 단일 책임).
        onSave 는 즉시 KV PUT 패턴 (★ A 패턴, S1.8.6).
      </p>
    </div>
  );
}
