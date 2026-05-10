// lab fresh v2 — ScriptTab (★ baseline stub)
// 사료: S2.4.2.c 스크립트 (UI: script ↔ Worker: subtitle)
// PRD §12.1: UI script 의 사용자 입력 = correction.scriptEdits 동봉
//             worker subtitle 키 = /subtitle-format LLM 결과

export function ScriptTab({ tabId, data, onSave, sessionId, config, currentTab, authUser }) {
  // tabId = "subtitle" (worker key) — UI 는 "script" 로 표시
  const subtitles = data?.subtitles || [];
  const format = data?.format || null;

  function handleSubtitleEdit(index, newText) {
    const newSubtitles = subtitles.map((s, i) =>
      i === index ? { ...s, text: newText } : s
    );
    onSave({ ...data, subtitles: newSubtitles });
  }

  return (
    <div className="tab tab-script">
      <h2>스크립트 (Script)</h2>
      <div className="metadata">
        자막 {subtitles.length} 개 / 포맷 {format || "기본"}
      </div>
      <p>
        ★ baseline stub — UI "script" 는 사용자 입력 시 correction.scriptEdits 에
        동봉 저장. /subtitle-format LLM 결과는 본 worker subtitle 키에 박제.
      </p>
    </div>
  );
}
