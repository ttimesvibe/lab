// ═══════════════════════════════════════════════════════════════════════════
// ScriptTab.jsx — 1.5단계 스크립트 편집 탭 컴포넌트
// 헌장 v1.1 §5/§6 정식 충족 — TabComponentInterface 따름.
// ═══════════════════════════════════════════════════════════════════════════
//
// 책임: 스크립트 편집 화면 본체 (블록 편집 + 통계 + 자막 도구 + 자막 2패널)
// 데이터: data = { blocks, scriptEdits } (TAB_SCHEMAS.script)
//
// 저장 영역:
//   - setScriptEdits — scriptEdits 갱신 → App.jsx useEffect 가 dirty 마킹
//   - 다른 setState 는 모두 툴 영역 (저장 X)
//
// 툴 영역 (저장 시스템과 명확히 구분):
//   - handleCopyRaw: clipboard 복사 (저장 X)
//   - postProcessSubtitle: 자막 후처리 보정 (dead code — V3 에서 Worker 처리)
//   - handleCopySubtitle: AI 자막 포맷팅 (LLM apiCall + 청크 처리 + 캐시)
//   - subtitleCache / subtitleResult: 메모리 cache + UI 패널 (저장 X)
//
// 결합 영역 (의도된 비즈니스 로직):
//   - ScriptEditBlock 의 onSave: setScriptEdits (저장) + setSubtitleCache(null) (캐시 무효화)
//   - 사용자 편집 시 옛 자막 결과 무효 — 의도된 결합. 분리 X.
//
// 영역 외 (App.jsx 잔존):
//   - LLM 호출 인프라 (apiCall / cfg) — props 로 받음
//   - 자동저장 / dirty 마킹 — App.jsx useEffect (setState 가 자동 트리거)
//
// ───────────────────────────────────────────────────────────────────────────

import React from "react";
import { getCorrectedText } from "../utils/diffRenderer.js";
import { ScriptEditBlock } from "../components/BlockComponents.jsx";

export default function ScriptTab({
  // TabComponentInterface 표준
  tabId,                  // eslint-disable-line no-unused-vars
  data,                   // eslint-disable-line no-unused-vars  (R3 시점 사용)
  onSave,                 // eslint-disable-line no-unused-vars  (setState 가 자동 dirty 마킹)
  // 데이터
  blocks,
  dm,
  scriptEdits,
  blockDeletions,
  // 통계
  fC, tC, sC,
  // 헬퍼
  applyDeletions,
  // setters
  setScriptEdits,
  // 자막 도구 영역
  subtitleCache,
  subtitleResult,
  setSubtitleCache,
  setSubtitleResult,
  // API
  apiCall,
  cfg,
  // 테마
  C, FN,
}) {
  const editedCount = Object.keys(scriptEdits).length;

  // 원본 텍스트 복사 (포맷팅 없이)
  const handleCopyRaw = (e) => {
    const lines = blocks.map(b => {
      const idx = b.index;
      let t = scriptEdits[idx] !== undefined ? scriptEdits[idx] : getCorrectedText(b.text, dm[idx]);
      t = applyDeletions(t, blockDeletions[idx]);
      return t;
    });
    const text = lines.join("\n\n");
    try { navigator.clipboard.writeText(text); } catch {
      const ta = document.createElement("textarea");
      ta.value = text; ta.style.cssText = "position:fixed;left:-9999px";
      document.body.appendChild(ta); ta.select(); document.execCommand("copy"); document.body.removeChild(ta);
    }
    const btn = e.currentTarget;
    btn.textContent = "✅ 복사됨!";
    setTimeout(() => { btn.textContent = "📋 원본 복사"; }, 1500);
  };

  // AI 자막 포맷팅 복사
  // ── 후처리 보정: AI 출력의 형식 오류를 코드로 강제 교정 ──
  // 주: V3 부터 Worker 후처리 완료 — 본 함수는 dead code (사용 X). 호환 보존.
  // eslint-disable-next-line no-unused-vars
  const postProcessSubtitle = (text) => {
    let lines = text.split('\n');

    // 1) 메타 정보 / 구분선 제거
    const isMetaLine = (t, lineIdx) => {
      if (!t) return false;
      // 구분선: 대시/등호 3개 이상 포함
      if (/[-=]{3,}/.test(t)) return true;
      // 파일명 패턴: "260327_박종천 싱크" 등
      if (/^\d{6}[_\s]/.test(t)) return true;
      // 날짜+시간 패턴
      if (/^\d{4}\.\d{2}\.\d{2}\s/.test(t)) return true;
      // 분초 패턴
      if (/\d+분\s*\d+초/.test(t) && t.length < 40) return true;
      // 편/장 구분
      if (/^\d+편(\/\d+편)?$/.test(t)) return true;
      // 싱크/녹취 헤더
      if (/싱크|녹취록|Sync/i.test(t) && t.length < 30) return true;
      // 이름 나열: 텍스트 앞부분(처음 10줄)에서만, 2~5어절 한글/영문, 구두점 없음
      if (lineIdx < 10 && /^[가-힣a-zA-Z]+(\s[가-힣a-zA-Z]+){1,4}$/.test(t) && t.length < 25 && !/[.?!,]/.test(t)) return true;
      return false;
    };
    lines = lines.filter((l, i) => {
      const t = l.trim();
      if (!t) return true; // 빈 줄 유지
      return !isMetaLine(t, i);
    });

    // 2) 줄 끝 구두점 제거 (마침표, 쉼표) — 물음표/느낌표는 유지
    lines = lines.map(l => {
      let s = l.trimEnd();
      while (s.endsWith('.') || s.endsWith(',')) {
        s = s.slice(0, -1).trimEnd();
      }
      return s;
    });

    // 3) [제거됨] 짧은 줄 합치기는 문장 경계를 무시할 수 있어 제거

    // 4) 따옴표 보정 — 줄바꿈된 따옴표 구간에 각 줄마다 따옴표 적용
    const fixQuotes = (lines, q) => {
      const result = [];
      let inQuote = false;
      let quoteChar = q;
      for (let i = 0; i < lines.length; i++) {
        let l = lines[i];
        if (!l.trim()) { result.push(l); inQuote = false; continue; }

        const opens = (l.match(new RegExp('\\' + quoteChar, 'g')) || []).length;
        const hasOpen = l.includes(quoteChar);

        if (!inQuote && hasOpen && opens % 2 === 1) {
          // 따옴표 열림 — 닫히지 않은 상태
          // 열린 따옴표 위치 찾기
          const qIdx = l.indexOf(quoteChar);
          const afterQ = l.substring(qIdx);
          if ((afterQ.match(new RegExp('\\' + quoteChar, 'g')) || []).length === 1) {
            // 이 줄에서 열리고 닫히지 않음
            inQuote = true;
            // 줄 끝에 닫는 따옴표 추가
            l = l.trimEnd() + quoteChar;
          }
        } else if (inQuote) {
          // 따옴표 안에 있는 줄
          if (hasOpen && opens % 2 === 1) {
            // 닫는 따옴표가 있음 → 따옴표 구간 종료
            // 줄 시작에 여는 따옴표가 없으면 추가
            if (!l.trimStart().startsWith(quoteChar)) {
              l = quoteChar + l.trimStart();
            }
            inQuote = false;
          } else {
            // 중간 줄 — 양쪽에 따옴표 추가
            const trimmed = l.trim();
            if (!trimmed.startsWith(quoteChar)) l = quoteChar + trimmed;
            if (!l.trimEnd().endsWith(quoteChar)) l = l.trimEnd() + quoteChar;
          }
        }
        result.push(l);
      }
      return result;
    };

    let processed = fixQuotes(lines, "'");
    processed = fixQuotes(processed, '"');

    return processed.join('\n');
  };

  const handleCopySubtitle = async (e) => {
    const btn = e.currentTarget;
    const origBtnText = btn.textContent;

    // 캐시가 있으면 2패널 표시 (이미 결과가 있으면 바로 보여줌)
    if (subtitleCache) {
      setSubtitleResult(subtitleCache);
      return;
    }

    btn.textContent = "⏳ AI 포맷팅 중 (0%)...";
    btn.style.opacity = "0.7";
    btn.disabled = true;
    try {
      const allTexts = blocks.map(b => {
        const idx = b.index;
        let text = scriptEdits[idx] !== undefined
          ? scriptEdits[idx]
          : getCorrectedText(b.text, dm[idx]);
        text = applyDeletions(text, blockDeletions[idx]);
        const speaker = b.speaker && b.speaker !== "—" ? `[${b.speaker}]` : "";
        return speaker ? `${speaker}\n${text}` : text;
      });

      // PATCH-008: 600~1000자 범위 + 화자 턴 경계에서 끊기
      const CHUNK_MIN = 600;
      const CHUNK_MAX = 1000;
      const SENTENCE_END = /(?<=[.?!요죠다까])\s+/;
      const isMetaBlock = (text) => {
        const t = text.trim();
        if (!t) return true;
        if (/^\d{6}[_\s]/.test(t)) return true;
        if (/^\d{4}\.\d{2}\.\d{2}/.test(t)) return true;
        if (/^\d+분\s*\d+초/.test(t)) return true;
        if (/^[-=─]{3,}$/.test(t)) return true;
        if (/^={5,}/.test(t)) return true;
        return false;
      };
      const chunks = [];
      let currentChunk = "";
      for (const blockText of allTexts) {
        if (!blockText.trim()) continue;
        if (isMetaBlock(blockText)) continue;

        const wouldBe = currentChunk.length + (currentChunk ? 1 : 0) + blockText.length;

        if (currentChunk.length >= CHUNK_MIN && wouldBe > CHUNK_MAX) {
          chunks.push(currentChunk);
          currentChunk = blockText;
        } else if (wouldBe > CHUNK_MAX && currentChunk.length < CHUNK_MIN) {
          if (currentChunk) chunks.push(currentChunk);
          if (blockText.length > CHUNK_MAX) {
            const sentences = blockText.split(SENTENCE_END);
            let partial = "";
            for (const sent of sentences) {
              if (partial.length + sent.length + 1 > CHUNK_MAX && partial.length > 0) {
                chunks.push(partial);
                partial = sent;
              } else {
                partial += (partial ? ' ' : '') + sent;
              }
            }
            currentChunk = partial || "";
          } else {
            currentChunk = blockText;
          }
        } else {
          currentChunk += (currentChunk ? '\n' : '') + blockText;
        }
      }
      if (currentChunk) chunks.push(currentChunk);

      // 검증 함수
      const validateAndUse = (d, originalChunk) => {
        if (!d || !d.formatted) return originalChunk;
        if (d._debug?.truncated) {
          console.warn(`[자막] 축약 감지 (${d._debug.ratio}%) — 원본 사용`);
          return originalChunk;
        }
        return d.formatted;
      };

      const PARALLEL = 3;
      const formattedChunks = new Array(chunks.length);

      // Warmup: 첫 블록 순차 호출 → prompt cache 생성
      console.log(`[자막 V3] ${chunks.length}개 블록 처리 시작`);
      const first = await apiCall("subtitle-format", { text: chunks[0], version: "v3" }, cfg);
      if (first._debug) console.log(`[자막 DEBUG] chunk 0:`, first._debug);
      formattedChunks[0] = validateAndUse(first, chunks[0]);

      // 나머지: PARALLEL개씩 병렬 호출 → cache hit
      for (let i = 1; i < chunks.length; i += PARALLEL) {
        const pct = Math.round((i / chunks.length) * 100);
        btn.textContent = `⏳ AI 포맷팅 중 (${pct}%)...`;

        const batch = chunks.slice(i, i + PARALLEL);
        const promises = batch.map((chunk, j) =>
          apiCall("subtitle-format", { text: chunk, version: "v3" }, cfg)
            .then(d => ({ idx: i + j, d, chunk }))
            .catch(err => ({ idx: i + j, d: null, chunk, err }))
        );

        const results = await Promise.all(promises);
        for (const { idx, d, chunk } of results) {
          if (d?._debug) console.log(`[자막 DEBUG] chunk ${idx}:`, d._debug);
          formattedChunks[idx] = validateAndUse(d, chunk);
        }
      }

      // V3: Worker 후처리 완료 — 프론트 후처리 스킵
      const finalText = formattedChunks.join('\n');

      setSubtitleCache(finalText);
      setSubtitleResult(finalText);

      btn.textContent = origBtnText;
      btn.style.opacity = "1";
    } catch (err) {
      btn.textContent = "❌ 실패";
      console.error("자막 포맷팅 실패:", err);
      setTimeout(() => { btn.textContent = origBtnText; btn.style.opacity = "1"; }, 2000);
    } finally {
      btn.disabled = false;
    }
  };

  return <div style={{display:"flex",flex:1,overflow:"hidden"}}>
    <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>
    <div style={{flex:1,overflowY:"auto",padding:0}}>
      <div style={{padding:"8px 16px",fontSize:11,fontWeight:700,color:C.txD,textTransform:"uppercase",
        letterSpacing:"0.08em",borderBottom:`1px solid ${C.bd}`,position:"sticky",top:0,background:C.bg,zIndex:2,
        display:"flex",justifyContent:"space-between",alignItems:"center"}}>
        <span>최종 스크립트 편집</span>
        <span style={{fontSize:11,color:C.txM,fontWeight:400,textTransform:"none",letterSpacing:0}}>
          블록을 클릭하면 편집할 수 있습니다{editedCount > 0 ? ` · 수동 수정 ${editedCount}건` : ""}
        </span>
      </div>
      {blocks.map(b => {
        const idx = b.index;
        const corrected = getCorrectedText(b.text, dm[idx]);
        const editedVal = scriptEdits[idx];
        const isEdited = editedVal !== undefined && editedVal !== corrected;
        return <ScriptEditBlock key={idx} block={b} correctedText={corrected}
          editedVal={editedVal} isEdited={isEdited}
          deletions={blockDeletions[idx]}
          onSave={val => {
            if (val !== null) setScriptEdits(prev=>({...prev,[idx]:val}));
            else setScriptEdits(prev=>{const n={...prev};delete n[idx];return n;});
            setSubtitleCache(null); setSubtitleResult(null);
          }}
          onRevert={() => { setScriptEdits(prev=>{const n={...prev};delete n[idx];return n;}); setSubtitleCache(null); setSubtitleResult(null); }}
        />;
      })}
    </div>
    <div style={{display:"flex",gap:12,padding:"10px 20px",background:C.sf,borderTop:`1px solid ${C.bd}`,
      fontSize:13,color:C.txM,flexShrink:0,alignItems:"center"}}>
      <span>블록: <b style={{color:C.tx}}>{blocks.length}</b></span>
      {editedCount > 0 && <span>수동 수정: <b style={{color:"#22C55E"}}>{editedCount}</b></span>}
      <span>AI 교정: <b style={{color:C.cTx}}>{fC+tC+sC}</b></span>
      <button onClick={handleCopyRaw}
        style={{marginLeft:"auto",padding:"7px 16px",borderRadius:8,border:`1px solid ${C.bd}`,
          background:"transparent",color:C.txM,fontSize:12,fontWeight:600,
          cursor:"pointer"}}>
        📋 원본 복사
      </button>
      <button onClick={handleCopySubtitle}
        style={{padding:"7px 20px",borderRadius:8,border:"none",
          background:`linear-gradient(135deg,${C.ac},#7C3AED)`,color:"#fff",fontSize:13,fontWeight:700,
          cursor:"pointer",boxShadow:"0 3px 12px rgba(74,108,247,0.3)",
          display:"flex",alignItems:"center",gap:6}}>
        🎬 자막용 복사
      </button>
    </div>
    </div>
    {/* 자막 2패널 — 우측 */}
    {subtitleResult && <div style={{width:420,minWidth:420,borderLeft:`1px solid ${C.bd}`,
      display:"flex",flexDirection:"column",background:"rgba(0,0,0,0.08)"}}>
      <div style={{padding:"8px 14px",fontSize:11,fontWeight:700,color:C.txD,textTransform:"uppercase",
        letterSpacing:"0.08em",borderBottom:`1px solid ${C.bd}`,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
        <span>자막 포맷팅 결과</span>
        <div style={{display:"flex",gap:6}}>
          <button onClick={async()=>{
            try { await navigator.clipboard.writeText(subtitleResult); } catch {
              const ta = document.createElement("textarea");
              ta.value = subtitleResult; ta.style.cssText = "position:fixed;left:-9999px";
              document.body.appendChild(ta); ta.select(); document.execCommand("copy"); document.body.removeChild(ta);
            }
          }} style={{fontSize:10,fontWeight:600,padding:"3px 10px",borderRadius:4,border:`1px solid ${C.bd}`,
            background:"rgba(255,255,255,0.06)",color:C.txM,cursor:"pointer"}}>📋 복사</button>
          <button onClick={()=>setSubtitleResult(null)}
            style={{fontSize:10,fontWeight:600,padding:"3px 8px",borderRadius:4,border:`1px solid ${C.bd}`,
              background:"rgba(255,255,255,0.06)",color:C.txD,cursor:"pointer"}}>✕ 닫기</button>
        </div>
      </div>
      <div style={{flex:1,overflowY:"auto",padding:"12px 16px"}}>
        <pre style={{fontSize:13,color:C.tx,lineHeight:1.7,whiteSpace:"pre-wrap",wordBreak:"break-word",
          fontFamily:FN,margin:0}}>{subtitleResult}</pre>
      </div>
    </div>}
  </div>;
}
