// lab fresh v2 — MetadataTab (★ baseline stub, internal)
// 사료: S2.4.2.i 메타데이터 (analyze 결과 자동 채움 + 수동 편집)

export function MetadataTab({ tabId, data, onSave, sessionId, config, currentTab, authUser }) {
  const interviewee = data?.interviewee || "";
  const topic = data?.topic || "";
  const keywords = data?.keywords || {};
  const speakers = data?.speakers || [];
  const genre = data?.genre || {};

  function handleField(field, value) {
    onSave({ ...data, [field]: value });
  }

  return (
    <div className="tab tab-metadata">
      <h2>메타데이터 (Metadata)</h2>
      <div className="metadata">
        인터뷰이: {interviewee || "(미설정)"} / 주제: {topic || "(미설정)"} /
        화자 {speakers.length} / 장르 {genre.primary || "(미설정)"}
      </div>
      <p>★ baseline stub — 실 메타데이터 UI 는 후속 마일스톤.</p>
    </div>
  );
}
