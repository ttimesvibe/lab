import { useState, useEffect } from "react";
import { C, FN } from "../utils/styles.js";
import { loadDictionary, saveDictionaryToServer } from "../utils/dictionary.js";

// CMS v2 — D2/B3 모달 (저장 실패 / 충돌 / 복원 / 백업 목록)
// 묶음 ① ½ — 별도 파일 ./v2_modals.jsx 에서 export
export { SaveFailModal, ConflictModal, RestoreModal, BackupListModal } from "./v2_modals.jsx";

export function ShareModal({ shareUrl, onClose }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(shareUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };
  return <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.65)",zIndex:200,
    display:"flex",alignItems:"center",justifyContent:"center"}} onClick={onClose}>
    <div onClick={e=>e.stopPropagation()} style={{background:C.sf,borderRadius:16,padding:28,
      width:480,border:`1px solid ${C.bd}`}}>
      <div style={{fontSize:17,fontWeight:700,color:C.tx,marginBottom:6}}>🔗 공유 링크 생성 완료</div>
      <div style={{fontSize:13,color:C.txM,marginBottom:16}}>
        아래 링크를 편집자에게 전달하세요. 30일간 유효합니다.
      </div>
      <div style={{display:"flex",gap:8,marginBottom:20}}>
        <input readOnly value={shareUrl}
          style={{flex:1,padding:"9px 12px",borderRadius:8,border:`1px solid ${C.bd}`,
            background:"rgba(0,0,0,0.3)",color:C.tx,fontSize:12,fontFamily:"monospace",outline:"none"}}
          onFocus={e=>e.target.select()}/>
        <button onClick={copy} style={{padding:"9px 16px",borderRadius:8,border:"none",
          background:copied?C.ok:C.ac,color:"#fff",fontSize:13,fontWeight:600,cursor:"pointer",
          minWidth:72,transition:"background 0.2s"}}>
          {copied?"✓ 복사됨":"복사"}
        </button>
      </div>
      <div style={{fontSize:12,color:C.txD,marginBottom:20}}>
        🔗 링크를 아는 사람은 열람 및 편집이 가능합니다.
      </div>
      <div style={{display:"flex",justifyContent:"flex-end"}}>
        <button onClick={onClose} style={{padding:"8px 20px",borderRadius:6,border:`1px solid ${C.bd}`,
          background:"transparent",color:C.txM,fontSize:13,cursor:"pointer"}}>닫기</button>
      </div>
    </div>
  </div>;
}

// SessionListModal 폐기 (2026-05-09): Dashboard 게시판 뷰가 superset 이라 누더기 정리.
// session_index KV 데이터는 화석 보존 (자연 만료, 자세한 결정 기록 CHANGELOG 참고).

export function SettingsModal({ config, onSave, onClose }) {
  const [m, setM] = useState(config.apiMode);
  const [u, setU] = useState(config.workerUrl);
  const [gk, setGk] = useState(""); // 더 이상 사용 안 함 — Worker에서 관리
  const [f, setF] = useState(config.fillers.join(", "));
  const [t, setT] = useState(Object.entries(config.customTerms).map(([k,v])=>`${k}=${v.join(",")}`).join("\n"));
  const [cs, setCs] = useState(config.chunkSize);
  // 비밀번호 변경
  const [pwCur, setPwCur] = useState("");
  const [pwNew, setPwNew] = useState("");
  const [pwConfirm, setPwConfirm] = useState("");
  const [pwLoading, setPwLoading] = useState(false);
  const [pwMsg, setPwMsg] = useState(null); // { type: "success"|"error", text }
  const handleChangePw = async () => {
    setPwMsg(null);
    if (pwNew.length < 8) { setPwMsg({ type: "error", text: "새 비밀번호는 8자 이상이어야 합니다." }); return; }
    if (pwNew !== pwConfirm) { setPwMsg({ type: "error", text: "새 비밀번호가 일치하지 않습니다." }); return; }
    setPwLoading(true);
    try {
      const token = localStorage.getItem("ttimes_token");
      const res = await fetch("https://auth.ttimes6000.workers.dev/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
        body: JSON.stringify({ currentPassword: pwCur, newPassword: pwNew }),
      });
      const data = await res.json();
      if (data.success) {
        if (data.token) localStorage.setItem("ttimes_token", data.token);
        setPwMsg({ type: "success", text: "비밀번호가 변경되었습니다." });
        setPwCur(""); setPwNew(""); setPwConfirm("");
      } else {
        setPwMsg({ type: "error", text: data.error || "비밀번호 변경 실패" });
      }
    } catch {
      setPwMsg({ type: "error", text: "서버에 연결할 수 없습니다." });
    } finally { setPwLoading(false); }
  };
  // 단어장 — 읽기 전용 (관리는 어드민 페이지에서)
  const [dictList] = useState(() => {
    const d = loadDictionary();
    return d.map(w => typeof w === "string" ? w : w.correct || w.wrong).filter(Boolean);
  });
  const save = () => {
    const ct = {};
    t.split("\n").filter(Boolean).forEach(l => { const [c,w] = l.split("="); if(c&&w) ct[c.trim()] = w.split(",").map(s=>s.trim()); });
    onSave({...config, apiMode:m, workerUrl:u.replace(/\/+$/,""),
      fillers:f.split(",").map(s=>s.trim()).filter(Boolean), customTerms:ct, chunkSize:parseInt(cs)||15000});
  };
  const iS = {width:"100%",padding:"8px 10px",borderRadius:6,border:`1px solid ${C.bd}`,
    background:"rgba(0,0,0,0.3)",color:C.tx,fontSize:13,fontFamily:FN,outline:"none"};
  return <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.6)",zIndex:100,
    display:"flex",alignItems:"center",justifyContent:"center"}} onClick={onClose}>
    <div onClick={e=>e.stopPropagation()} style={{background:C.sf,borderRadius:16,padding:28,
      width:480,maxHeight:"80vh",overflowY:"auto",border:`1px solid ${C.bd}`}}>
      <div style={{fontSize:18,fontWeight:700,color:C.tx,marginBottom:20}}>⚙️ 설정</div>
      <div style={{marginBottom:16}}>
        <label style={{fontSize:12,color:C.txM,fontWeight:600,display:"block",marginBottom:6}}>API 모드</label>
        <div style={{display:"flex",gap:4}}>
          {[["mock","Mock (데모)"],["live","Live (GPT-5.1)"]].map(([v,l])=>
            <button key={v} onClick={()=>setM(v)} style={{flex:1,padding:8,borderRadius:6,
              border:`1px solid ${m===v?C.ac:C.bd}`,background:m===v?C.acS:"transparent",
              color:m===v?C.ac:C.txM,fontSize:13,fontWeight:600,cursor:"pointer"}}>{l}</button>)}
        </div>
      </div>
      {/* Worker URL은 config.js 고정값 사용 */}
      <div style={{marginBottom:16}}>
        <label style={{fontSize:12,color:C.txM,fontWeight:600,display:"block",marginBottom:6}}>필러 단어 (쉼표 구분)</label>
        <input value={f} onChange={e=>setF(e.target.value)} style={iS}/>
      </div>
      <div style={{marginBottom:16}}>
        <label style={{fontSize:12,color:C.txM,fontWeight:600,display:"block",marginBottom:6}}>
          용어 사전 (줄바꿈, 형식: 올바른표기=오인식1,오인식2)</label>
        <textarea value={t} onChange={e=>setT(e.target.value)} rows={4}
          placeholder={"앤트로픽=엔트로피,엠트로픽\n프롬프트=프롬보트,프롬포트"} style={{...iS,resize:"vertical"}}/>
      </div>
      <div style={{marginBottom:20}}>
        <label style={{fontSize:12,color:C.txM,fontWeight:600,display:"block",marginBottom:6}}>청크 크기 (자)</label>
        <input type="number" value={cs} onChange={e=>setCs(e.target.value)} style={{...iS,width:120}}/>
      </div>
      <div style={{marginBottom:20,padding:14,background:"rgba(0,0,0,0.2)",borderRadius:10,border:`1px solid ${C.bd}`}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
          <label style={{fontSize:12,color:C.txM,fontWeight:600}}>📚 팀 단어장 (읽기 전용)</label>
          <span style={{fontSize:12,color:C.ac,fontWeight:600}}>{dictList.length}건</span>
        </div>
        <div style={{fontSize:11,color:C.txD,marginBottom:10}}>
          단어장 추가/삭제는 어드민 페이지에서만 가능합니다.
        </div>
        {dictList.length > 0 ? (
          <div style={{display:"flex",flexWrap:"wrap",gap:4,maxHeight:160,overflowY:"auto",
            padding:6,background:"rgba(0,0,0,0.15)",borderRadius:8}}>
            {dictList.map((word, i) => (
              <span key={i} style={{padding:"3px 8px",borderRadius:12,
                background:"rgba(74,108,247,0.12)",color:C.ac,fontSize:12,fontWeight:500}}>
                {word}
              </span>
            ))}
          </div>
        ) : (
          <div style={{fontSize:12,color:C.txD,padding:8,textAlign:"center"}}>등록된 단어가 없습니다.</div>
        )}
      </div>
      <div style={{marginBottom:20,padding:14,background:"rgba(0,0,0,0.2)",borderRadius:10,border:`1px solid ${C.bd}`}}>
        <label style={{fontSize:12,color:C.txM,fontWeight:600,display:"block",marginBottom:10}}>🔒 비밀번호 변경</label>
        <div style={{display:"flex",flexDirection:"column",gap:8}}>
          <input type="password" value={pwCur} onChange={e=>setPwCur(e.target.value)} placeholder="현재 비밀번호" style={iS}/>
          <input type="password" value={pwNew} onChange={e=>setPwNew(e.target.value)} placeholder="새 비밀번호 (8자 이상)" style={iS}/>
          <input type="password" value={pwConfirm} onChange={e=>setPwConfirm(e.target.value)} placeholder="새 비밀번호 확인" style={iS}/>
        </div>
        {pwMsg && <div style={{marginTop:8,padding:"8px 12px",borderRadius:6,fontSize:12,
          background:pwMsg.type==="success"?"rgba(34,197,94,0.1)":"rgba(239,68,68,0.1)",
          border:`1px solid ${pwMsg.type==="success"?"rgba(34,197,94,0.2)":"rgba(239,68,68,0.2)"}`,
          color:pwMsg.type==="success"?C.ok:"#EF4444"}}>{pwMsg.text}</div>}
        <button onClick={handleChangePw} disabled={pwLoading||!pwCur||!pwNew||!pwConfirm}
          style={{marginTop:8,padding:"7px 16px",borderRadius:6,border:"none",
            background:pwLoading?"rgba(74,108,247,0.4)":"rgba(74,108,247,0.8)",
            color:"#fff",fontSize:12,fontWeight:600,cursor:pwLoading?"not-allowed":"pointer",fontFamily:FN}}>
          {pwLoading?"변경 중...":"비밀번호 변경"}</button>
      </div>
      <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
        <button onClick={onClose} style={{padding:"8px 20px",borderRadius:6,border:`1px solid ${C.bd}`,
          background:"transparent",color:C.txM,fontSize:13,cursor:"pointer"}}>취소</button>
        <button onClick={save} style={{padding:"8px 20px",borderRadius:6,border:"none",
          background:C.ac,color:"#fff",fontSize:13,fontWeight:600,cursor:"pointer"}}>저장</button>
      </div>
    </div>
  </div>;
}
