// ═══════════════════════════════════════════════════════════════════════════
// CorrectionTab.jsx — 1차 교정 탭 컴포넌트
// 헌장 v1.1 §5/§6 정식 충족 — TabComponentInterface 따름.
// ═══════════════════════════════════════════════════════════════════════════
//
// 책임: 1차 교정 화면 본체 (원문 / 수정본 양쪽 패널 + 통계 푸터)
// 데이터: data = { blocks, anal, diffs, scriptEdits, blockDeletions } (TAB_SCHEMAS.correction)
//
// 영역 외 (App.jsx 잔존):
//   - LLM 호출 (handleAnalyze / handleCorrect 등) — 헤더 영역
//   - 단어장 / term_review / dictionary — 별도 모달
//   - 자동저장 / dirty 마킹 — App.jsx 의 useEffect (setState 가 자동 트리거)
//   - Scroll sync useEffect — App.jsx 의 별도 영역 (lRef/rRef 만 props 로 받음)
//   - 글로벌 키보드 / 단축키 — App.jsx
//   - 마우스 / selPopup — App.jsx
//
// ───────────────────────────────────────────────────────────────────────────

import React from "react";
import { findPositions, getCorrectedText } from "../utils/diffRenderer.js";
import { BlockView, CorrectionRightBlock } from "../components/BlockComponents.jsx";

export default function CorrectionTab({
  // TabComponentInterface 표준
  tabId,                  // eslint-disable-line no-unused-vars
  data,                   // eslint-disable-line no-unused-vars (현재 props 직접 받음 — R3 시점 통합)
  onSave,                 // eslint-disable-line no-unused-vars (setState 가 자동 dirty 마킹)
  // 데이터
  blocks,
  dm,                     // diffs 의 derived map (App.jsx useMemo)
  scriptEdits,
  blockDeletions,
  aBlock,                 // 활성 블록 인덱스
  // 통계
  fC, tC, sC,
  // 헬퍼
  applyDeletions,         // App.jsx useCallback (closure 의존 회피용)
  scrollTo,               // App.jsx 함수
  // setters
  setBlockDeletions,
  setScriptEdits,
  setSubtitleCache,
  setSubtitleResult,
  // refs
  lRef, rRef, bEls,
  // 테마
  C,
}) {
  return <>
    <div style={{flex:1,display:"flex",overflow:"hidden"}}>
      <div ref={lRef} data-scroll-container style={{flex:1,overflowY:"auto",borderRight:`1px solid ${C.bd}`}}>
        <div style={{padding:"8px 16px",fontSize:11,fontWeight:700,color:C.txD,textTransform:"uppercase",
          letterSpacing:"0.08em",borderBottom:`1px solid ${C.bd}`,position:"sticky",top:0,background:C.bg,zIndex:2}}>원문</div>
        {blocks.map(b=><BlockView key={b.index} block={b} side="left" active={aBlock===b.index}
          pos={findPositions(b.text,dm[b.index])} onClick={scrollTo}
          bRef={el=>{if(el)bEls.current[`l${b.index}`]=el}}/>)}
      </div>
      <div ref={rRef} data-scroll-container style={{flex:1,overflowY:"auto"}}>
        <div style={{padding:"8px 16px",fontSize:11,fontWeight:700,color:C.txD,textTransform:"uppercase",
          letterSpacing:"0.08em",borderBottom:`1px solid ${C.bd}`,position:"sticky",top:0,background:C.bg,zIndex:2,
          display:"flex",alignItems:"center",gap:8}}>
          <span>수정본</span>
          {Object.keys(blockDeletions).length > 0 && <span style={{fontSize:10,fontWeight:700,padding:"2px 8px",borderRadius:4,
            background:"rgba(239,68,68,0.18)",color:"#EF4444",border:"1px solid rgba(239,68,68,0.3)",
            textTransform:"none",letterSpacing:"0.02em"}}>추가 삭제 있음</span>}
        </div>
        {blocks.map(b=>{
          const idx = b.index;
          const corrected = getCorrectedText(b.text, dm[idx]);
          const editedVal = scriptEdits[idx];
          const isEdited = editedVal !== undefined && editedVal !== corrected;
          return <CorrectionRightBlock key={idx} block={b} active={aBlock===idx}
            pos={findPositions(b.text,dm[idx])} onClick={scrollTo}
            bRef={el=>{if(el)bEls.current[`r${idx}`]=el}}
            correctedText={corrected} editedVal={editedVal} isEdited={isEdited}
            deletions={blockDeletions[idx]}
            onAddDeletion={(s, e) => {
              setBlockDeletions(prev => {
                const existing = prev[idx] || [];
                return {...prev, [idx]: [...existing, {s, e}]};
              });
              setSubtitleCache(null); setSubtitleResult(null);
            }}
            onRemoveDeletion={(s, e) => {
              setBlockDeletions(prev => {
                const existing = prev[idx] || [];
                const filtered = existing.filter(d => d.s !== s || d.e !== e);
                if (filtered.length === 0) { const n = {...prev}; delete n[idx]; return n; }
                return {...prev, [idx]: filtered};
              });
              setSubtitleCache(null); setSubtitleResult(null);
            }}
            onSave={val => {
              if (val !== null) setScriptEdits(prev=>({...prev,[idx]:val}));
              else setScriptEdits(prev=>{const n={...prev};delete n[idx];return n;});
              setSubtitleCache(null); setSubtitleResult(null);
            }}
            onRevert={() => { setScriptEdits(prev=>{const n={...prev};delete n[idx];return n;}); setSubtitleCache(null); setSubtitleResult(null); }}
          />;
        })}
      </div>
    </div>
    {(() => {
      // 원문/수정본 분량 계산
      const origChars = blocks.reduce((s, b) => s + b.text.replace(/\s/g, "").length, 0);
      const corrChars = blocks.reduce((s, b) => {
        const idx = b.index;
        let t = scriptEdits[idx] !== undefined ? scriptEdits[idx] : getCorrectedText(b.text, dm[idx]);
        t = applyDeletions(t, blockDeletions[idx]);
        return s + t.replace(/\s/g, "").length;
      }, 0);
      const origMs = Math.ceil(origChars / 200); // 원고지 매수 (200자 기준)
      const corrMs = Math.ceil(corrChars / 200);
      const diffChars = corrChars - origChars;
      const diffSign = diffChars > 0 ? "+" : "";
      return <div style={{display:"flex",gap:20,padding:"10px 20px",background:C.sf,borderTop:`1px solid ${C.bd}`,fontSize:13,color:C.txM,flexShrink:0,flexWrap:"wrap"}}>
        <span>필러: <b style={{color:C.fTx}}>{fC}</b></span>
        <span>용어: <b style={{color:C.cTx}}>{tC}</b></span>
        {sC > 0 && <span>맞춤법: <b style={{color:C.scTx}}>{sC}</b></span>}
        <span>총: <b style={{color:C.tx}}>{fC+tC+sC}</b></span>
        {Object.keys(scriptEdits).length > 0 && <span>수동 수정: <b style={{color:"#22C55E"}}>{Object.keys(scriptEdits).length}</b></span>}
        <span style={{marginLeft:"auto",borderLeft:`1px solid ${C.bd}`,paddingLeft:16,fontSize:12}}>
          원문 <b style={{color:C.tx}}>{origChars.toLocaleString()}</b>자 ({origMs}매)
          <span style={{margin:"0 6px",color:C.bd}}>→</span>
          수정본 <b style={{color:"#22C55E"}}>{corrChars.toLocaleString()}</b>자 ({corrMs}매)
          <span style={{marginLeft:8,color:diffChars<0?"#22C55E":"#F59E0B",fontSize:11}}>({diffSign}{diffChars.toLocaleString()}자)</span>
        </span>
      </div>;
    })()}
  </>;
}
