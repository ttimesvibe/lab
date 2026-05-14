// CMS v2 — D2 + B3 모달 (저장 실패 / 충돌 / 복원 / 백업 목록)
// 묶음 ① ½ — 컴맹 친화 한글, 큰 글씨, 4중 백업 통합
// 분리된 파일로 두어 Modals.jsx 의 기존 동작 비파괴.

import { C, FN } from "../utils/styles.js";
import { translateError, tabLabel } from "../utils/errorMessages.js";
import { downloadBackupAsJSON, listBackups, deleteBackup } from "../utils/backup.js";

const OVERLAY_STYLE = {
  position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)",
  zIndex: 10000, display: "flex", alignItems: "center", justifyContent: "center",
  padding: 20,
};
const PANEL_STYLE = {
  background: "#fff", borderRadius: 14, padding: 32,
  maxWidth: 520, width: "100%", boxShadow: "0 20px 60px rgba(0,0,0,0.4)",
  fontFamily: FN,
};

export function SaveFailModal({ failedTabs, sessionId, fn, payload, onRetry, onClose }) {
  const handleBackup = () => {
    const r = downloadBackupAsJSON({ sessionId, fn, payload, type: "save_failure" });
    if (r.ok) alert("백업 파일이 다운로드되었습니다. 안전하게 보관해주세요.");
  };
  return (
    <div style={OVERLAY_STYLE}>
      <div style={PANEL_STYLE}>
        <div style={{ fontSize: 48, textAlign: "center", marginBottom: 12 }}>🚨</div>
        <h2 style={{ fontSize: 28, fontWeight: 800, color: "#DC2626", textAlign: "center", margin: "0 0 16px" }}>
          저장에 실패했습니다
        </h2>
        <p style={{ fontSize: 16, color: "#374151", textAlign: "center", margin: "0 0 20px", lineHeight: 1.6 }}>
          걱정하지 마세요.<br/>작업물은 사라지지 않았습니다.
        </p>
        <div style={{ background: "#FEF2F2", border: "1px solid #FECACA", borderRadius: 8, padding: 16, marginBottom: 16 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: "#991B1B", marginBottom: 8 }}>저장되지 않은 탭:</div>
          <ul style={{ margin: 0, paddingLeft: 20, fontSize: 16, color: "#374151", lineHeight: 1.8 }}>
            {failedTabs.map((f) => (
              <li key={f.tab}>
                <b>{tabLabel(f.tab)}</b>
                <div style={{ fontSize: 13, color: "#6B7280", marginTop: 2 }}>{translateError(f.error)}</div>
              </li>
            ))}
          </ul>
        </div>
        <button onClick={handleBackup} style={{
          width: "100%", padding: "14px 16px", marginBottom: 10, border: "none", borderRadius: 10,
          background: "#16A34A", color: "#fff", fontSize: 17, fontWeight: 700, cursor: "pointer",
          boxShadow: "0 4px 12px rgba(22,163,74,0.3)",
        }}>💾  내 작업물 백업 파일로 저장하기</button>
        <button onClick={onRetry} style={{
          width: "100%", padding: "12px 16px", marginBottom: 10, border: "none", borderRadius: 10,
          background: "#2563EB", color: "#fff", fontSize: 16, fontWeight: 600, cursor: "pointer",
        }}>🔄  다시 저장 시도하기</button>
        <button onClick={onClose} style={{
          width: "100%", padding: "10px 16px", border: "1px solid #D1D5DB", borderRadius: 10,
          background: "#fff", color: "#6B7280", fontSize: 14, cursor: "pointer",
        }}>닫기</button>
      </div>
    </div>
  );
}

// M4 — ConflictModal 2 옵션 영역 (헌장 §4 정식 충족)
// 옛 onMerge 옵션 영역 폐기 (clientMergeTabData 영역의 코드 보존하되 UX 미노출).
// 자기 sub 영역은 자동 통합 (App.jsx 의 saveDirtyTabsToKV 영역에서 처리, 본 modal 영역 X).
export function ConflictModal({ tab, serverUpdatedBy, onAcceptServer, onForceMine, onClose }) {
  const who = serverUpdatedBy?.name || serverUpdatedBy?.sub || "다른 편집자";
  return (
    <div style={OVERLAY_STYLE}>
      <div style={PANEL_STYLE}>
        <div style={{ fontSize: 40, textAlign: "center", marginBottom: 12 }}>⚠️</div>
        <h2 style={{ fontSize: 22, fontWeight: 800, color: "#D97706", textAlign: "center", margin: "0 0 12px", lineHeight: 1.4 }}>
          다른 사용자와의 동시 저장이 일어났습니다.<br/>30초 이내의 변경사항이 일어났습니다.
        </h2>
        <p style={{ fontSize: 15, color: "#374151", textAlign: "center", margin: "0 0 8px", lineHeight: 1.6 }}>
          <b>{who}</b>님이 <b>{tabLabel(tab)}</b> 탭을 수정했습니다.
        </p>
        <p style={{ fontSize: 14, color: "#6B7280", textAlign: "center", margin: "0 0 20px" }}>
          내 변경사항은 안전하게 백업되었습니다.<br/>어떻게 처리하시겠습니까?
        </p>
        {/* 옵션 1 — 내 저장 사항 강제저장 */}
        <button onClick={onForceMine} style={{
          width: "100%", padding: "14px 16px", marginBottom: 10, border: "none", borderRadius: 10,
          background: "#2563EB", color: "#fff", fontSize: 15, fontWeight: 700, cursor: "pointer",
        }}>1. 내 저장 사항을 강제저장한다</button>
        {/* 옵션 2 — 내 변경 사항 이전의 상황으로 동기화 */}
        <button onClick={onAcceptServer} style={{
          width: "100%", padding: "14px 16px", marginBottom: 10, border: "1px solid #D1D5DB", borderRadius: 10,
          background: "#fff", color: "#374151", fontSize: 15, fontWeight: 700, cursor: "pointer",
        }}>2. 내 변경 사항 이전의 상황으로 동기화한다</button>
        <button onClick={onClose} style={{
          width: "100%", padding: "10px 16px", border: "1px solid #D1D5DB", borderRadius: 10,
          background: "#fff", color: "#9CA3AF", fontSize: 13, cursor: "pointer",
        }}>나중에 결정</button>
      </div>
    </div>
  );
}

export function RestoreModal({ backup, totalCount, onRestore, onSkip, onShowList }) {
  const dt = backup.backupAt ? new Date(backup.backupAt) : null;
  const dtStr = dt ? `${dt.getFullYear()}년 ${dt.getMonth()+1}월 ${dt.getDate()}일 ${dt.getHours()}시 ${dt.getMinutes()}분` : "이전";
  return (
    <div style={OVERLAY_STYLE}>
      <div style={PANEL_STYLE}>
        <div style={{ fontSize: 40, textAlign: "center", marginBottom: 12 }}>📂</div>
        <h2 style={{ fontSize: 24, fontWeight: 800, color: "#2563EB", textAlign: "center", margin: "0 0 12px" }}>
          이전 작업물을 발견했습니다
        </h2>
        <p style={{ fontSize: 15, color: "#374151", textAlign: "center", margin: "0 0 8px", lineHeight: 1.6 }}>
          {dtStr}에<br/>저장이 실패했던 작업입니다.
        </p>
        <p style={{ fontSize: 14, color: "#6B7280", textAlign: "center", margin: "0 0 20px" }}>
          프로젝트: <b>{backup.fn || "(제목 없음)"}</b>
          {totalCount > 1 && <><br/>(총 {totalCount}개의 백업이 있습니다)</>}
        </p>
        <button onClick={onRestore} style={{
          width: "100%", padding: "14px 16px", marginBottom: 10, border: "none", borderRadius: 10,
          background: "#16A34A", color: "#fff", fontSize: 16, fontWeight: 700, cursor: "pointer",
        }}>✓ 이어서 작업하기</button>
        {totalCount > 1 && (
          <button onClick={onShowList} style={{
            width: "100%", padding: "12px 16px", marginBottom: 10, border: "1px solid #D1D5DB", borderRadius: 10,
            background: "#fff", color: "#374151", fontSize: 14, cursor: "pointer",
          }}>다른 백업 보기</button>
        )}
        <button onClick={onSkip} style={{
          width: "100%", padding: "10px 16px", border: "1px solid #D1D5DB", borderRadius: 10,
          background: "#fff", color: "#9CA3AF", fontSize: 13, cursor: "pointer",
        }}>무시하고 새로 시작</button>
      </div>
    </div>
  );
}

export function BackupListModal({ onSelect, onClose }) {
  const backups = listBackups();
  return (
    <div style={OVERLAY_STYLE}>
      <div style={{ ...PANEL_STYLE, maxWidth: 640, maxHeight: "80vh", overflow: "auto" }}>
        <h2 style={{ fontSize: 22, fontWeight: 700, margin: "0 0 16px" }}>저장된 백업 목록 ({backups.length}개)</h2>
        {backups.length === 0 && <p style={{ color: "#9CA3AF" }}>백업이 없습니다.</p>}
        {backups.map((b) => (
          <div key={b.key} style={{ borderBottom: "1px solid #E5E7EB", padding: "12px 0" }}>
            <div style={{ fontSize: 15, fontWeight: 600 }}>{b.fn || "(제목 없음)"}</div>
            <div style={{ fontSize: 12, color: "#6B7280", marginTop: 2 }}>
              {b.backupAt} · {b.type} · 세션 {b.sessionId}
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
              <button onClick={() => onSelect(b)} style={{ padding: "6px 12px", border: "none", borderRadius: 6, background: "#16A34A", color: "#fff", fontSize: 12, cursor: "pointer" }}>복원</button>
              <button onClick={() => downloadBackupAsJSON({ sessionId: b.sessionId, fn: b.fn, payload: b.data, type: b.type })} style={{ padding: "6px 12px", border: "1px solid #D1D5DB", borderRadius: 6, background: "#fff", fontSize: 12, cursor: "pointer" }}>다운로드</button>
              <button onClick={() => { if (confirm("이 백업을 삭제하시겠습니까?")) { deleteBackup(b.key); window.location.reload(); } }} style={{ padding: "6px 12px", border: "1px solid #FCA5A5", borderRadius: 6, background: "#fff", color: "#DC2626", fontSize: 12, cursor: "pointer" }}>삭제</button>
            </div>
          </div>
        ))}
        <button onClick={onClose} style={{ marginTop: 16, padding: "10px 16px", border: "1px solid #D1D5DB", borderRadius: 8, background: "#fff", cursor: "pointer", width: "100%" }}>닫기</button>
      </div>
    </div>
  );
}
