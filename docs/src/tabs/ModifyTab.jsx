// lab fresh v2 — ModifyTab (★ baseline stub)
// 사료: S2.4.2.f 수정사항 + S4a.4 모범 5건 (TAB-MOD-01~03)
// 본 컴포넌트는 ★ 모범 패턴의 출처 (pagehide / autoSaveStatus / saveNow).
// 단 lab 에선 모범 패턴이 engine 안 박제 — 본 컴포넌트는 단순 onSave 호출만.

export function ModifyTab({ tabId, data, onSave, sessionId, config, currentTab, authUser }) {
  const cards = data?.cards || [];
  const videoUrl = data?.videoUrl || "";

  function handleAddCard(card) {
    onSave({ ...data, cards: [...cards, card] });
  }

  function handleVideoUrl(url) {
    onSave({ ...data, videoUrl: url });
  }

  return (
    <div className="tab tab-modify">
      <h2>수정사항 (Modify)</h2>
      <div className="metadata">
        카드 {cards.length} / 영상 URL {videoUrl ? "✓" : "X"}
      </div>
      <p>★ baseline stub — 실 카드 입력 UI + YouTube 임베딩은 후속 마일스톤.</p>
    </div>
  );
}
