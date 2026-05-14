// ═══════════════════════════════════════════════════════════════════════════
// ReviewTab.jsx — 0차 검토 탭 컴포넌트
// 헌장 v1.1 §5/§6 정식 충족 — TabComponentInterface 따름.
// ═══════════════════════════════════════════════════════════════════════════
//
// 책임: 0차 검토 화면 (원본 분량 / 예상 영상 길이 / 원고 표시 / 1차 교정 진행 버튼)
// 데이터: data.reviewData (TAB_SCHEMAS.review 의 fields)
//
// 본 컴포넌트는 read-only — 사용자 입력 시 onSave 호출 X (review 단계는 시각 검토만).
// 액션: onAction.onProceedToCorrection (1차 교정 진행 버튼)
//
// ───────────────────────────────────────────────────────────────────────────

import React from "react";
import { secondsToDisplay, calcRegression } from "../utils/lengthModel.js";

export default function ReviewTab({
  // TabComponentInterface 표준 props
  tabId,            // eslint-disable-line no-unused-vars  (인터페이스 통일성)
  data,             // { reviewData }
  onSave,           // eslint-disable-line no-unused-vars  (review 는 read-only — 호출 X)
  // 추가 props
  blocks,           // fallback (data.reviewData.reviewBlocks 가 비었을 때)
  fn,               // 파일명 (액션에서 사용)
  C,                // 테마
  onAction,         // { onProceedToCorrection }
}) {
  // data.reviewData 가 reviewData 자체 (TAB_SCHEMAS.review.fields = ["reviewData"])
  const reviewData = data?.reviewData;
  if (!reviewData) return null;

  const { deletedBlockIndices, duration, reviewBlocks, paragraphs, hasTrackChanges, cleanTextChars } = reviewData;
  const delSet = new Set(deletedBlockIndices || []);
  const usedBlocks = reviewBlocks || blocks || [];

  return (
    <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>
      {/* 분량 요약 카드 */}
      <div style={{padding:"16px 20px",background:C.sf,borderBottom:`1px solid ${C.bd}`,flexShrink:0}}>
        <div style={{display:"flex",gap:16,flexWrap:"wrap",alignItems:"flex-start"}}>
          {/* 원본 분량 */}
          <div style={{flex:1,minWidth:180,padding:14,borderRadius:10,background:"rgba(255,255,255,0.03)",border:`1px solid ${C.bd}`}}>
            <div style={{fontSize:11,fontWeight:700,color:C.txD,textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:8}}>📄 원본 분량</div>
            <div style={{fontSize:24,fontWeight:800,color:C.tx,marginBottom:4}}>{secondsToDisplay(duration.totalSeconds)}</div>
            <div style={{fontSize:12,color:C.txM}}>{duration.totalChars.toLocaleString()}자 · {usedBlocks.length}블록</div>
          </div>
          {/* 예상 영상 길이 */}
          <div style={{flex:1,minWidth:180,padding:14,borderRadius:10,background:"rgba(34,197,94,0.05)",border:"1px solid rgba(34,197,94,0.2)"}}>
            <div style={{fontSize:11,fontWeight:700,color:"#22C55E",textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:8}}>🎬 예상 영상 길이</div>
            {(() => {
              const cleanChars = cleanTextChars || duration.keptChars;
              const reg = calcRegression(cleanChars);
              return <>
                <div style={{fontSize:24,fontWeight:800,color:"#22C55E"}}>{secondsToDisplay(reg.pointSec)}</div>
                <div style={{marginTop:6,padding:"5px 10px",borderRadius:6,background:"rgba(34,197,94,0.08)",display:"inline-block"}}>
                  <span style={{fontSize:12,color:C.txM,fontWeight:600}}>
                    {secondsToDisplay(reg.lowSec)} ~ {secondsToDisplay(reg.highSec)}
                  </span>
                  <span style={{fontSize:10,color:C.txD,marginLeft:6}}>(95% 신뢰구간)</span>
                </div>
                <div style={{marginTop:6,fontSize:10,color:C.txD}}>
                  {reg.count}건 학습 · 선형회귀 (LOO MAE 3.9%) · 삭제 후 {cleanChars.toLocaleString()}자
                </div>
                {duration.keptSeconds > 0 && (
                  <div style={{fontSize:11,color:C.txD,marginTop:4}}>
                    타임스탬프 기준: {secondsToDisplay(duration.keptSeconds)}
                  </div>
                )}
              </>;
            })()}
            <div style={{fontSize:12,color:C.txM,marginTop:4}}>{usedBlocks.length - delSet.size}블록 잔존</div>
          </div>
        </div>
        {/* 진행 버튼 */}
        <div style={{marginTop:14,display:"flex",gap:10,justifyContent:"flex-end"}}>
          <button onClick={onAction?.onProceedToCorrection}
            style={{padding:"9px 24px",borderRadius:8,border:"none",
              background:`linear-gradient(135deg,${C.ac},#7C3AED)`,color:"#fff",fontSize:13,fontWeight:700,
              cursor:"pointer",boxShadow:"0 4px 14px rgba(74,108,247,0.3)"}}>
            {hasTrackChanges ? "삭제선 제거 → 1차 교정 시작" : "1차 교정 시작"}
          </button>
        </div>
      </div>
      {/* 원고 (삭제선 표시 — 블록화 없이 단락 그대로) */}
      <div style={{flex:1,overflowY:"auto"}}>
        <div style={{padding:"8px 16px",fontSize:11,fontWeight:700,color:C.txD,textTransform:"uppercase",
          letterSpacing:"0.08em",borderBottom:`1px solid ${C.bd}`,position:"sticky",top:0,background:C.bg,zIndex:2}}>
          원고 검토{hasTrackChanges ? " — 취소선은 빨간색으로 표시됩니다" : ""}
        </div>
        <div style={{padding:"16px 20px"}}>
          {(paragraphs || []).map((p, pi) => {
            const paraText = p.map(s => s.text).join("");
            if (!paraText.trim()) return <div key={pi} style={{height:12}}/>;
            return <p key={pi} style={{fontSize:14,lineHeight:1.9,color:C.tx,
              marginBottom:4,wordBreak:"keep-all",whiteSpace:"pre-wrap"}}>
              {p.map((seg, si) => seg.deleted
                ? <span key={si} style={{textDecoration:"line-through",textDecorationColor:"#EF4444",
                    background:"rgba(239,68,68,0.12)",color:"#EF4444",padding:"1px 2px",borderRadius:3}}>{seg.text}</span>
                : <span key={si}>{seg.text}</span>
              )}
            </p>;
          })}
        </div>
      </div>
    </div>
  );
}
