// ═══════════════════════════════════════════════════════════════════════════
// GuideTab.jsx — 편집 가이드 탭 컴포넌트
// 헌장 v1.1 §5/§6 정식 충족 — TabComponentInterface 따름.
// ═══════════════════════════════════════════════════════════════════════════
//
// 책임: 편집 가이드 화면 본체 (좌측 교정본 + 인라인 사용 자막 + 우측 GuideCard 사이드바 + 푸터)
// 데이터: data = { hl, hlStats, hlVerdicts, hlEdits, hlMarkers } (TAB_SCHEMAS.guide)
//
// 저장 영역 (자동 dirty 마킹):
//   - setHl / setHlVerdicts / setHlEdits / setHlMarkers
//
// 로컬 UI state (저장 X — App.jsx 상위 보관):
//   - gReady / gBusy / bookmark / matchingMode / selPopup / addingAt / addForm / partialBusy
//
// 툴 영역 (LLM / 외부 호출 — App.jsx 헤더 잔존, props 로 전달):
//   - handleGuide        : 2-Pass 일괄 생성 (apiHighlightsDraft + apiHighlightsEdit)
//   - handlePartialGenerate : 부분 생성
//   - handleTermGen      : B2 용어 AI 설명 생성
//   - handleAddSubtitle  : 자막 추가 (state 만)
//   - handleMarkerAdd / handleMarkerClear : 형광펜
//
// 결합 영역 (의도된 비즈니스 로직):
//   - onVerdict 콜백: verdict 변경 시 hlMarkers / matchingMode 동시 정리.
//   - onDelete / onRelocate 콜백: hl + hlVerdicts + hlEdits + hlMarkers 동시 갱신.
//
// 영역 외 (App.jsx 잔존):
//   - LLM 호출 (handleGuide 등) — props 로 전달
//   - 자동저장 / dirty 마킹 — App.jsx useEffect (setState 가 자동 트리거)
//   - Scroll sync useEffect — App.jsx 별도 영역 (lRef/rRef 만 props 로 받음)
//   - 글로벌 키보드 / 단축키 — App.jsx
//
// ───────────────────────────────────────────────────────────────────────────

import React from "react";
import { getCorrectedText } from "../utils/diffRenderer.js";
import { Badge, MarkedText, TypeBadge } from "../components/BlockComponents.jsx";
import { GuideCard } from "../components/GuideCard.jsx";
import { MARKER_COLORS } from "../utils/styles.js";

export default function GuideTab({
  // TabComponentInterface 표준
  tabId,                  // eslint-disable-line no-unused-vars
  data,                   // eslint-disable-line no-unused-vars (현재 props 직접 받음 — R3 시점 통합)
  onSave,                 // eslint-disable-line no-unused-vars (setState 가 자동 dirty 마킹)
  // 데이터 (저장 영역)
  hl,
  hlStats,
  hlVerdicts,
  hlEdits,
  hlMarkers,
  guides,                 // App.jsx useMemo (hl 정렬 결과)
  // 데이터 (correction 계열 공용)
  blocks,
  dm,
  scriptEdits,
  blockDeletions,
  aBlock,
  // 통계
  fC, tC,
  // 로컬 UI state (App.jsx 상위 보관)
  gReady, gBusy,
  bookmark,
  matchingMode,
  selPopup,
  addingAt, addForm,
  partialBusy,
  // setters (저장 영역)
  setHl, setHlVerdicts, setHlEdits, setHlMarkers,
  // setters (UI state)
  setGReady,
  setBookmark,
  setMatchingMode,
  setSelPopup,
  setAddingAt, setAddForm,
  setTab,
  // 헬퍼 / 핸들러
  applyDeletions,
  scrollTo,
  handleGuide,
  handlePartialGenerate,
  handleTermGen,
  handleAddSubtitle,
  handleMarkerAdd,
  handleMarkerClear,
  // refs
  lRef, rRef, bEls,
  // 테마
  C,
}) {
  return <>
    {!gReady&&!gBusy && <div style={{padding:48,textAlign:"center"}}>
      <div style={{display:"inline-flex",alignItems:"center",gap:6,padding:"5px 12px",borderRadius:16,
        background:"rgba(34,197,94,0.1)",border:"1px solid rgba(34,197,94,0.2)",fontSize:12,color:C.ok,marginBottom:20}}>
        ✅ 1차 교정 완료 — 필러 {fC}건, 용어 {tC}건</div>
      <div style={{display:"flex",gap:16,justifyContent:"center",flexWrap:"wrap",maxWidth:560,margin:"0 auto"}}>
        <div onClick={handleGuide} style={{flex:1,minWidth:220,padding:24,borderRadius:14,border:`2px solid ${C.ac}`,
          background:`${C.ac}11`,cursor:"pointer",textAlign:"left",transition:"all .15s"}}>
          <div style={{fontSize:16,fontWeight:700,color:C.tx,marginBottom:8}}>▶ 강조자막 생성하기</div>
          <div style={{fontSize:13,color:C.txM,lineHeight:1.5}}>AI가 일괄 생성하는 강조자막 프로세스</div>
          <div style={{fontSize:11,color:C.txD,marginTop:6}}>Draft Agent → Editor Agent (2-Pass)</div>
        </div>
        <div onClick={()=>{setTab("guide"); setGReady(true);}} style={{flex:1,minWidth:220,padding:24,borderRadius:14,border:`2px solid ${C.bd}`,
          background:C.sf,cursor:"pointer",textAlign:"left",transition:"all .15s"}}>
          <div style={{fontSize:16,fontWeight:700,color:C.tx,marginBottom:8}}>✏️ 내가 직접 편집하기</div>
          <div style={{fontSize:13,color:C.txM,lineHeight:1.5}}>편집자가 직접 읽으면서 강조자막을 부분 생성할 수 있습니다</div>
          <div style={{fontSize:11,color:C.txD,marginTop:6}}>텍스트 드래그 → 부분 생성</div>
        </div>
      </div>
    </div>}
    {gReady && <div style={{flex:1,display:"flex",overflow:"hidden"}}>
      <div ref={lRef} data-scroll-container style={{flex:1,overflowY:"auto",borderRight:`1px solid ${C.bd}`}}>
        <div style={{padding:"8px 16px",fontSize:11,fontWeight:700,color:C.txD,textTransform:"uppercase",
          letterSpacing:"0.08em",borderBottom:`1px solid ${C.bd}`,position:"sticky",top:0,background:C.bg,zIndex:2,
          display:"flex",alignItems:"center",justifyContent:"space-between"}}>
          <span>교정본</span>
          {/* 텍스트 선택 시 자막 생성 바 — 본문 가림 방지 위해 sticky 헤더에 inline */}
          {selPopup && <div style={{display:"flex",gap:6,alignItems:"center",
            background:C.sf,border:`1px solid ${C.ac}`,borderRadius:8,padding:"3px 8px",
            boxShadow:`0 2px 8px ${C.ac}33`}}>
            <button onClick={()=>handlePartialGenerate(selPopup.blockIdx, selPopup.text)}
              disabled={partialBusy}
              title={`선택: "${selPopup.text.slice(0,60)}${selPopup.text.length>60?'…':''}"`}
              style={{padding:"4px 10px",borderRadius:5,border:"none",letterSpacing:0,
                background:`linear-gradient(135deg,${C.ac},#7C3AED)`,color:"#fff",fontSize:11,fontWeight:700,
                textTransform:"none",cursor:partialBusy?"wait":"pointer",opacity:partialBusy?0.6:1}}>
              {partialBusy ? "⏳ 생성 중..." : "✨ 이 구간으로 자막 생성"}
            </button>
            <button onClick={()=>setSelPopup(null)}
              style={{background:"none",border:"none",color:C.txD,cursor:"pointer",fontSize:13,padding:"0 4px"}}>✕</button>
          </div>}
          <div style={{display:"flex",alignItems:"center",gap:6}}>
            {bookmark != null && <button onClick={()=>{
              const el = bEls.current[`g${bookmark}`];
              if (el) el.scrollIntoView({behavior:"smooth",block:"center"});
            }} style={{fontSize:10,fontWeight:600,padding:"2px 8px",borderRadius:4,border:`1px solid #F59E0B`,
              background:"rgba(245,158,11,0.12)",color:"#F59E0B",cursor:"pointer",textTransform:"none",letterSpacing:0}}>
              📌 #{bookmark} 이동
            </button>}
            <button onClick={()=>{
              if (bookmark === aBlock) { setBookmark(null); }
              else if (aBlock != null) { setBookmark(aBlock); }
              else {
                // 현재 스크롤 위치에서 가장 가까운 블록 찾기
                const container = lRef.current;
                if (!container) return;
                const containerTop = container.scrollTop + container.getBoundingClientRect().top;
                let closest = 0, minDist = Infinity;
                for (const [k, el] of Object.entries(bEls.current)) {
                  if (!k.startsWith("g")) continue;
                  const idx = parseInt(k.slice(1));
                  const dist = Math.abs(el.getBoundingClientRect().top - container.getBoundingClientRect().top);
                  if (dist < minDist) { minDist = dist; closest = idx; }
                }
                setBookmark(closest);
              }
            }} style={{fontSize:10,fontWeight:600,padding:"2px 8px",borderRadius:4,
              border:`1px solid ${bookmark!=null?"#F59E0B":C.bd}`,
              background:bookmark!=null?"rgba(245,158,11,0.12)":"transparent",
              color:bookmark!=null?"#F59E0B":C.txM,cursor:"pointer",textTransform:"none",letterSpacing:0}}>
              {bookmark != null ? `📌 #{bookmark} 해제` : "📌 책갈피"}
            </button>
          </div>
        </div>
        {matchingMode && <div style={{padding:"6px 16px",background:MARKER_COLORS[matchingMode.color]?.bg,
          borderBottom:`1px solid ${MARKER_COLORS[matchingMode.color]?.border}`,
          display:"flex",alignItems:"center",justifyContent:"space-between",position:"sticky",top:28,zIndex:2}}>
          <span style={{fontSize:12,fontWeight:600,color:MARKER_COLORS[matchingMode.color]?.border}}>
            🖍 블록 #{matchingMode.blockIdx}에서 텍스트를 드래그하여 형광펜을 칠하세요
          </span>
          <button onClick={()=>setMatchingMode(null)}
            style={{fontSize:11,padding:"2px 10px",borderRadius:4,border:`1px solid ${MARKER_COLORS[matchingMode.color]?.border}`,
              background:"rgba(0,0,0,0.3)",color:MARKER_COLORS[matchingMode.color]?.border,cursor:"pointer",fontWeight:600}}>완료</button>
        </div>}
        {blocks.map(b=>{
          const idx = b.index;
          const hasScriptEdit = scriptEdits[idx] !== undefined;
          const correctedText = getCorrectedText(b.text, dm[idx]);
          const displayText = hasScriptEdit ? scriptEdits[idx] : null;
          // blockDeletions도 반영 — 1차 교정에서 드래그로 추가한 삭제선까지 일관 적용
          const finalText = applyDeletions(hasScriptEdit ? scriptEdits[idx] : correctedText, blockDeletions[idx]);
          // 매칭 모드에서 이 블록이 대상인지 확인
          const activeMatchBlock = matchingMode ? matchingMode.blockIdx : null;
          return <div key={idx}>
          {bookmark === idx && <div style={{padding:"4px 16px",background:"rgba(245,158,11,0.1)",
            borderBottom:`2px solid #F59E0B`,display:"flex",alignItems:"center",gap:6}}>
            <span style={{fontSize:11,fontWeight:700,color:"#F59E0B"}}>📌 책갈피 — 여기까지 확인함</span>
          </div>}
          <div ref={el=>{if(el)bEls.current[`g${idx}`]=el}} onClick={()=>scrollTo(idx)}
            onMouseUp={()=>{
              // 좌표는 더 이상 필요 없음 — 헤더/푸터 sticky 바에 inline 표시
              const sel = window.getSelection();
              const txt = sel?.toString()?.trim();
              if (txt && txt.length >= 5) {
                setSelPopup({ blockIdx: idx, text: txt });
              }
            }}
            style={{padding:"10px 16px",
              borderLeft:`4px solid ${aBlock===idx?"#A855F7":hasScriptEdit?"#22C55E":"transparent"}`,
              background:aBlock===idx?"rgba(168,85,247,0.08)":hasScriptEdit?"rgba(34,197,94,0.04)":"transparent",
              cursor:"pointer",transition:"all 0.25s ease"}}>
            <div style={{marginBottom:4,display:"flex",alignItems:"center",gap:6}}>
              <span style={{fontSize:10,fontWeight:700,color:C.txD,fontFamily:"monospace",
                background:"rgba(255,255,255,0.06)",padding:"1px 5px",borderRadius:3}}>#{idx}</span>
              <Badge name={b.speaker}/>
              <span style={{fontSize:11,color:C.txD,fontFamily:"monospace"}}>{b.timestamp}</span>
              {hasScriptEdit && <span style={{fontSize:9,fontWeight:700,padding:"1px 6px",borderRadius:3,
                background:"rgba(34,197,94,0.15)",color:"#22C55E"}}>수정됨</span>}
              {activeMatchBlock===idx && <span style={{fontSize:9,fontWeight:700,padding:"1px 6px",borderRadius:3,
                background:MARKER_COLORS[matchingMode?.color]?.bg,color:MARKER_COLORS[matchingMode?.color]?.border,
                border:`1px solid ${MARKER_COLORS[matchingMode?.color]?.border}`}}>
                🖍 드래그로 구간 선택</span>}
            </div>
            <MarkedText text={finalText} blockIdx={idx}
              hlMarkers={hlMarkers}
              matchingMode={activeMatchBlock===idx ? matchingMode : null}
              onMarkerAdd={handleMarkerAdd}/>
          </div>
          {/* "사용" 판정된 자막을 해당 블록 아래에 인라인 카드로 표시 */}
          {(() => {
            const usedGuides = guides.filter(g => g.block_index === idx && hlVerdicts[`${g.block_index}-${g.subtitle}`] === "use");
            if (usedGuides.length === 0) return null;

            const swapInHl = (gA, gB) => {
              // hl 배열에서 두 아이템의 위치를 서로 바꿈
              setHl(prev => {
                const next = [...prev];
                const iA = next.indexOf(gA);
                const iB = next.indexOf(gB);
                if (iA === -1 || iB === -1) return prev;
                [next[iA], next[iB]] = [next[iB], next[iA]];
                return next;
              });
            };

            return usedGuides.map((g, gi) => {
              const gKey = `${g.block_index}-${g.subtitle}`;
              const gEditedText = hlEdits[gKey];
              const gHasEdit = gEditedText && gEditedText !== g.subtitle;
              const displaySubtitle = gHasEdit ? gEditedText : g.subtitle;
              const canUp = gi > 0;
              const canDown = gi < usedGuides.length - 1;
              const marker = hlMarkers[gKey];
              const markerColor = marker?.color;
              const mc = markerColor ? MARKER_COLORS[markerColor] : null;
              const isActiveMatch = matchingMode?.key === gKey;
              // 타입별 기본 색상 — C_user만 자료(주황), AI 생성 C는 자막(초록)
              const isUserMaterial = g.type?.startsWith("C_user");
              const typeColor = isUserMaterial ? "#F97316" : g.type?.charAt(0) === "B" ? "#3B82F6" : "#22C55E";
              const typeBgLight = isUserMaterial ? "rgba(249,115,22,0.06)" : g.type?.charAt(0) === "B" ? "rgba(59,130,246,0.06)" : "rgba(34,197,94,0.06)";
              const typeBorder = isUserMaterial ? "rgba(249,115,22,0.3)" : g.type?.charAt(0) === "B" ? "rgba(59,130,246,0.3)" : "rgba(34,197,94,0.3)";

              return <div key={`inline-${gi}`} style={{margin:"2px 16px 4px",padding:"8px 12px",borderRadius:8,
                border:`1px solid ${mc ? mc.border : typeBorder}`,
                background:mc ? mc.bg.replace("0.3","0.08") : typeBgLight,
                display:"flex",alignItems:"center",gap:8,
                boxShadow:isActiveMatch?`0 0 0 2px ${mc?.border||C.ac}`:"none",
                transition:"all 0.15s"}}>
                {/* 순서 변경 화살표 (2개 이상일 때만 표시) */}
                {usedGuides.length > 1 && <div style={{display:"flex",flexDirection:"column",gap:1,flexShrink:0}}>
                  <button onClick={e=>{e.stopPropagation();if(canUp)swapInHl(g,usedGuides[gi-1])}}
                    disabled={!canUp}
                    style={{fontSize:9,lineHeight:1,padding:"1px 4px",border:"none",borderRadius:3,
                      background:canUp?"rgba(255,255,255,0.08)":"transparent",
                      color:canUp?C.txM:"transparent",cursor:canUp?"pointer":"default"}}>▲</button>
                  <button onClick={e=>{e.stopPropagation();if(canDown)swapInHl(g,usedGuides[gi+1])}}
                    disabled={!canDown}
                    style={{fontSize:9,lineHeight:1,padding:"1px 4px",border:"none",borderRadius:3,
                      background:canDown?"rgba(255,255,255,0.08)":"transparent",
                      color:canDown?C.txM:"transparent",cursor:canDown?"pointer":"default"}}>▼</button>
                </div>}
                <span style={{fontSize:11,color:mc?.border||typeColor,fontWeight:700,flexShrink:0}}>▶</span>
                <TypeBadge type={g.type} onChangeType={(newCat)=>{
                  setHl(prev => prev.map(h => h === g ? {...h, type: newCat + (g.type?.slice(1)||"1")} : h));
                }}/>
                <div style={{flex:1,fontSize:13,fontWeight:500,color:mc?.border||typeColor,lineHeight:1.4,whiteSpace:"pre-line"}}>
                  {displaySubtitle}
                </div>
                {/* 형광펜 색상 선택 */}
                <div style={{display:"flex",gap:2,flexShrink:0}}>
                  {Object.entries(MARKER_COLORS).filter(([,cv]) => !cv._hidden).map(([colorKey, cv]) => (
                    <button key={colorKey} onClick={e=>{e.stopPropagation();
                      if (isActiveMatch && matchingMode.color === colorKey) {
                        // 같은 색 다시 클릭 → 매칭 모드 해제
                        setMatchingMode(null);
                      } else {
                        // 매칭 모드 활성화: 이 자막의 블록에서 드래그 가능
                        setMatchingMode({ key: gKey, color: colorKey, blockIdx: g.block_index });
                      }
                    }}
                    title={`${cv.label} 형광펜${markerColor===colorKey?" (선택됨)":""}`}
                    style={{width:16,height:16,borderRadius:3,border:`2px solid ${
                      isActiveMatch && matchingMode.color===colorKey ? "#fff" :
                      markerColor===colorKey ? cv.border : "transparent"}`,
                      background:cv.bg.replace("0.3","0.6"),cursor:"pointer",
                      boxShadow:isActiveMatch && matchingMode.color===colorKey?"0 0 4px rgba(255,255,255,0.5)":"none",
                      transition:"all 0.12s"}}/>
                  ))}
                  {/* 형광펜 지우기 */}
                  {marker && <button onClick={e=>{e.stopPropagation();handleMarkerClear(gKey);setMatchingMode(null)}}
                    title="형광펜 지우기"
                    style={{fontSize:9,lineHeight:1,padding:"2px 4px",border:`1px solid ${C.bd}`,borderRadius:3,
                      background:"rgba(255,255,255,0.06)",color:C.txD,cursor:"pointer"}}>✕</button>}
                </div>
                {/* 복사 버튼 */}
                <button onClick={e=>{e.stopPropagation();
                  navigator.clipboard.writeText(displaySubtitle);
                  const btn=e.currentTarget;btn.textContent="✓";
                  setTimeout(()=>{btn.textContent="복사"},1200);
                }} style={{fontSize:10,fontWeight:600,padding:"3px 8px",borderRadius:4,border:`1px solid ${C.bd}`,
                  background:"rgba(255,255,255,0.06)",color:C.txM,cursor:"pointer",flexShrink:0,
                  minWidth:36,transition:"all 0.15s"}}>복사</button>
              </div>;
            });
          })()}
          {/* 선택된 블록에 자막 추가 버튼 */}
          {aBlock===b.index && addingAt!==b.index && (
            <div style={{padding:"4px 16px 8px",display:"flex",justifyContent:"flex-end"}}>
              <button onClick={e=>{e.stopPropagation();setAddingAt(b.index);setAddForm({subtitle:"",type:"A1"})}}
                style={{fontSize:11,fontWeight:600,padding:"4px 12px",borderRadius:6,
                  border:`1px dashed ${C.hBd}`,background:"rgba(168,85,247,0.08)",
                  color:C.hBd,cursor:"pointer"}}>+ 자막 추가</button>
            </div>
          )}
          {/* 자막 추가 입력 폼 */}
          {addingAt===b.index && (
            <div onClick={e=>e.stopPropagation()} style={{margin:"0 16px 10px",padding:12,borderRadius:10,
              border:`1px solid ${C.hBd}`,background:"rgba(168,85,247,0.06)"}}>
              <div style={{display:"flex",gap:6,marginBottom:8}}>
                {[["A1","강조자막"],["B2","용어 설명"]].map(([t,l])=>
                  <button key={t} onClick={()=>setAddForm(f=>({...f,type:t}))}
                    style={{fontSize:11,fontWeight:600,padding:"3px 10px",borderRadius:5,cursor:"pointer",
                      border:`1px solid ${addForm.type===t?C.hBd:"transparent"}`,
                      background:addForm.type===t?"rgba(168,85,247,0.15)":"rgba(255,255,255,0.04)",
                      color:addForm.type===t?C.hBd:C.txD}}>{l}</button>)}
              </div>
              {/* B2 용어 설명: 용어 입력 + AI 생성 */}
              {addForm.type==="B2" && (
                <div style={{display:"flex",gap:4,marginBottom:6}}>
                  <input value={addForm.termInput||""} onChange={e=>setAddForm(f=>({...f,termInput:e.target.value}))}
                    placeholder="용어를 입력하세요 (예: 에이전트)"
                    style={{flex:1,padding:"5px 8px",borderRadius:6,border:`1px solid ${C.bd}`,
                      background:"rgba(0,0,0,0.3)",color:C.tx,fontSize:12,outline:"none"}}
                    onKeyDown={e=>{if(e.key==="Enter"){e.preventDefault();handleTermGen();}}}/>
                  <button onClick={handleTermGen} disabled={addForm.generating}
                    style={{fontSize:11,fontWeight:600,padding:"4px 10px",borderRadius:5,border:"none",
                      background:addForm.generating?"rgba(59,130,246,0.3)":"rgba(59,130,246,0.8)",
                      color:"#fff",cursor:addForm.generating?"not-allowed":"pointer",whiteSpace:"nowrap"}}>
                    {addForm.generating?"생성 중...":"AI 설명 생성"}</button>
                </div>
              )}
              <textarea value={addForm.subtitle} onChange={e=>setAddForm(f=>({...f,subtitle:e.target.value}))}
                placeholder={addForm.type==="B2"?"용어(English) : 설명":addForm.type==="C1"?"추가 삭제 내용":"강조자막 내용"}
                rows={2} autoFocus={addForm.type!=="B2"}
                style={{width:"100%",padding:"6px 8px",borderRadius:6,border:`1px solid ${C.bd}`,
                  background:"rgba(0,0,0,0.3)",color:C.tx,fontSize:13,fontFamily:"'Pretendard',sans-serif",
                  lineHeight:1.5,resize:"vertical",outline:"none"}}
                onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();handleAddSubtitle();}if(e.key==="Escape")setAddingAt(null);}}/>
              <div style={{display:"flex",gap:4,marginTop:6,justifyContent:"flex-end"}}>
                <button onClick={()=>setAddingAt(null)}
                  style={{fontSize:11,padding:"3px 10px",borderRadius:4,border:`1px solid ${C.bd}`,
                    background:"transparent",color:C.txM,cursor:"pointer"}}>취소</button>
                <button onClick={handleAddSubtitle}
                  style={{fontSize:11,padding:"3px 10px",borderRadius:4,border:"none",
                    background:C.hBd,color:"#fff",fontWeight:600,cursor:"pointer"}}>추가</button>
              </div>
            </div>
          )}
        </div>})}
      {/* 텍스트 선택 popup 은 floating 대신 sticky 헤더/푸터 inline 으로 표시 (본문 가림 방지) */}
      {partialBusy && <div style={{padding:"8px 16px",background:"rgba(74,108,247,0.1)",
        borderTop:`1px solid ${C.ac}`,fontSize:12,color:C.ac,textAlign:"center"}}>
        ⏳ 부분 강조자막 생성 중...
      </div>}
      </div>
      <div ref={rRef} data-scroll-container style={{width:400,minWidth:400,overflowY:"auto",background:"rgba(0,0,0,0.12)"}}>
        <div style={{padding:"8px 14px",fontSize:11,fontWeight:700,color:C.txD,textTransform:"uppercase",
          letterSpacing:"0.08em",borderBottom:`1px solid ${C.bd}`,position:"sticky",top:0,background:C.sf,zIndex:2,
          display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <span>강조자막 가이드</span>
          {!guides.length && !gBusy && <button onClick={handleGuide}
            style={{fontSize:10,fontWeight:600,padding:"3px 10px",borderRadius:5,border:"none",
              background:`linear-gradient(135deg,${C.ac},#7C3AED)`,color:"#fff",cursor:"pointer"}}>
            일괄 생성하기
          </button>}
        </div>
        <div style={{padding:"6px 10px"}}>
          {!guides.length && <p style={{padding:20,textAlign:"center",fontSize:12,color:C.txD}}>항목 없음</p>}
          {guides.map((g,i)=><div key={`hl-${i}`} data-hl-block={g.block_index}>
            <GuideCard item={g}
            blocks={blocks}
            active={aBlock===g.block_index}
            onClick={g2=>scrollTo(g2.block_index)}
            verdict={hlVerdicts[`${g.block_index}-${g.subtitle}`]}
            onVerdict={(item, v) => {
              const key = `${item.block_index}-${item.subtitle}`;
              const prevVerdict = hlVerdicts[key];
              setHlVerdicts(prev => ({...prev, [key]: v}));
              // "사용" → 다른 상태로 변경 시 형광펜 제거
              if (prevVerdict === "use" && v !== "use") {
                setHlMarkers(prev => { const next = {...prev}; delete next[key]; return next; });
                if (matchingMode?.key === key) setMatchingMode(null);
              }
            }}
            editedText={hlEdits[`${g.block_index}-${g.subtitle}`]}
            onEdit={(item, text) => setHlEdits(prev => {
              const key = `${item.block_index}-${item.subtitle}`;
              const next = {...prev};
              if (text === null) delete next[key]; else next[key] = text;
              return next;
            })}
            onRelocate={(item, newIdx) => {
              // block_index 변경 → hl 배열에서 해당 아이템의 block_index 업데이트
              // verdict/edit 키도 함께 이전
              const oldKey = `${item.block_index}-${item.subtitle}`;
              const newKey = `${newIdx}-${item.subtitle}`;
              setHl(prev => prev.map(h =>
                h === item ? {...h, block_index: newIdx} : h
              ));
              setHlVerdicts(prev => {
                const next = {...prev};
                if (next[oldKey] !== undefined) { next[newKey] = next[oldKey]; delete next[oldKey]; }
                return next;
              });
              setHlEdits(prev => {
                const next = {...prev};
                if (next[oldKey] !== undefined) { next[newKey] = next[oldKey]; delete next[oldKey]; }
                return next;
              });
            }}
            onChangeType={(newCat) => {
              setHl(prev => prev.map(h => h === g ? {...h, type: newCat + (g.type?.slice(1)||"1")} : h));
            }}
            onDelete={(item) => {
              const key = `${item.block_index}-${item.subtitle}`;
              setHl(prev => prev.filter(h => h !== item));
              setHlVerdicts(prev => { const next = {...prev}; delete next[key]; return next; });
              setHlEdits(prev => { const next = {...prev}; delete next[key]; return next; });
              setHlMarkers(prev => { const next = {...prev}; delete next[key]; return next; });
              if (matchingMode?.key === key) setMatchingMode(null);
            }}
          />
          </div>)}
        </div>
      </div>
    </div>}
    {gReady && <div style={{display:"flex",gap:20,padding:"10px 20px",background:C.sf,borderTop:`1px solid ${C.bd}`,
      fontSize:13,color:C.txM,flexShrink:0}}>
      <span>강조자막: <b style={{color:C.hBd}}>{hl.length}</b></span>
      {hlStats && <>
        <span style={{color:C.txD}}>|</span>
        <span style={{fontSize:12}}>Draft {hlStats.draft_count}건 → Final {hlStats.final_count}건 ({hlStats.removal_rate} 필터링)</span>
      </>}
      {(() => {
        const vals = Object.values(hlVerdicts).filter(Boolean);
        const useC = vals.filter(v=>v==="use").length;
        const disC = vals.filter(v=>v==="discard").length;
        const unchk = hl.length - useC - disC;
        if (useC + disC === 0) return null;
        return <>
          <span style={{color:C.txD}}>|</span>
          <span style={{fontSize:12}}>
            <span style={{color:"#22C55E"}}>사용 {useC}</span>
            {" · "}<span style={{color:"#EF4444"}}>폐기 {disC}</span>
            {" · "}<span style={{color:C.txD}}>미선택 {unchk}</span>
          </span>
        </>;
      })()}
      {/* 텍스트 선택 시 자막 생성 바 — 헤더와 쌍, 푸터 우측 */}
      {selPopup && <div style={{marginLeft:"auto",display:"flex",gap:6,alignItems:"center",
        background:C.bg,border:`1px solid ${C.ac}`,borderRadius:8,padding:"3px 8px",
        boxShadow:`0 2px 8px ${C.ac}33`}}>
        <button onClick={()=>handlePartialGenerate(selPopup.blockIdx, selPopup.text)}
          disabled={partialBusy}
          title={`선택: "${selPopup.text.slice(0,60)}${selPopup.text.length>60?'…':''}"`}
          style={{padding:"4px 10px",borderRadius:5,border:"none",
            background:`linear-gradient(135deg,${C.ac},#7C3AED)`,color:"#fff",fontSize:11,fontWeight:700,
            cursor:partialBusy?"wait":"pointer",opacity:partialBusy?0.6:1}}>
          {partialBusy ? "⏳ 생성 중..." : "✨ 이 구간으로 자막 생성"}
        </button>
        <button onClick={()=>setSelPopup(null)}
          style={{background:"none",border:"none",color:C.txD,cursor:"pointer",fontSize:13,padding:"0 4px"}}>✕</button>
      </div>}
    </div>}
  </>;
}
