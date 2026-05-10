// lab fresh v2 — ReviewTab (★ baseline stub, TabComponentInterface 따름)
// 사료: TabComponentInterface.md / S2.4.2.a 0차 검토
//
// 책임: docx 업로드 → paragraphs → 삭제선 표시 (track changes 보존)
// 본 baseline = 단순 props 표시 + onSave callback. 실 UI 는 후속 마일스톤.

export function ReviewTab({ tabId, data, onSave, sessionId, config, currentTab, authUser }) {
  const blocks = data?.reviewBlocks || [];
  const cleanText = data?.cleanText || "";

  function handleStartCorrection() {
    // 사용자 입력 — onSave 호출 (★ engine.markDirty + applyState)
    onSave({ ...data, _correctionStarted: true });
  }

  return (
    <div className="tab tab-review">
      <h2>0차 검토 (Review)</h2>
      <div className="metadata">
        세션: {sessionId} · 사용자: {authUser?.name || authUser?.sub}
      </div>
      {blocks.length > 0 ? (
        <div>
          <p>총 {blocks.length} 블록 / 정리 텍스트 {cleanText.length} 자</p>
          <button onClick={handleStartCorrection}>1차 교정 시작</button>
        </div>
      ) : (
        <div>
          <p>원고를 업로드하세요. (manuscript 탭)</p>
        </div>
      )}
    </div>
  );
}
