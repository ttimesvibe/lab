// lab fresh v2 — ManuscriptTab (★ baseline stub, internal)
// 사료: S2.4.2.k 원고 (raw docx 업로드 결과)
// W-2 영역: manuscript 재업로드 시 5 cap 백업 (utils/backup.js 의 manuscript_replace type)

export function ManuscriptTab({ tabId, data, onSave, sessionId, config, currentTab, authUser }) {
  const text = data?.text || "";
  const fileName = data?.fileName || "";
  const paragraphs = data?.paragraphs || [];
  const hasTrackChanges = data?.hasTrackChanges || false;

  async function handleFileUpload(file) {
    if (!file) return;
    // ★ 재업로드 시 confirm + 백업 5 cap (W-2)
    if (text && !confirm(`이미 원고가 박혀있습니다. 새 파일로 교체하시겠습니까?`)) {
      return;
    }
    // (실 docx 파싱 + 백업 로직은 후속 마일스톤)
    onSave({ ...data, fileName: file.name });
  }

  return (
    <div className="tab tab-manuscript">
      <h2>원고 (Manuscript)</h2>
      <div className="metadata">
        파일: {fileName || "(없음)"} / 텍스트 {text.length} 자 /
        문단 {paragraphs.length} / 변경추적 {hasTrackChanges ? "✓" : "X"}
      </div>
      <p>★ baseline stub — 실 docx 업로드 + 파싱은 후속 마일스톤.</p>
    </div>
  );
}
