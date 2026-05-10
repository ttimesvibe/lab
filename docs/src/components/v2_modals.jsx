// lab fresh v2 — D2 모달 4종 (★ 헌장 ① ½ + UX 결정)
// 사료: editor/ops/lab-v2-fresh-2026-05-09.md
//   - S3.2 D2 모달 (한글 32px + 안심 문구)
//   - 헌장 v1.1 ConflictModal 2 옵션 (강제저장 / 동기화)
//   - 묶음 ① ½ 4중 백업
//   - W-3 휴지통 복원 / W-4 백업 키 정리
//   - S5.1 A9 UX Surfaces
//
// 4 모달:
//   1. SaveFailModal     — 저장 실패 (한글 32px + 4중 백업 버튼)
//   2. ConflictModal     — 충돌 (★ 2 옵션 — 강제저장 / 동기화, v1.1)
//   3. RestoreModal      — 다음 로그인 즉시 (이전 작업물 복원 제안)
//   4. BackupListModal   — 백업 목록 (미리보기/다운로드/복원/삭제)
//
// ★ 모달은 모두 화면 중앙 + 배경 80% 어둡게 + ESC/외부 클릭 닫기 X (D2 사양).

import { useEffect, useState } from "react";
import { translateError, tabLabelKo } from "../utils/errorMessages.js";
import { downloadBackupAsJSON, listBackups, restoreFromBackup, deleteBackup } from "../utils/backup.js";

// ─── 공통 스타일 (D2 — 한글 + 큰 글씨 + 컴맹 친화) ────────────────────────

const STYLES = {
  backdrop: {
    position: "fixed",
    top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: "rgba(0,0,0,0.8)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 9999,
  },
  modal: {
    backgroundColor: "white",
    borderRadius: "12px",
    padding: "32px",
    maxWidth: "600px",
    width: "90%",
    maxHeight: "85vh",
    overflowY: "auto",
    boxShadow: "0 20px 60px rgba(0,0,0,0.3)",
  },
  title: {
    fontSize: "32px",
    fontWeight: "bold",
    marginBottom: "16px",
  },
  reassureText: {
    fontSize: "18px",
    color: "#374151",
    marginBottom: "20px",
  },
  bodyText: {
    fontSize: "16px",
    color: "#4B5563",
    marginBottom: "16px",
  },
  primaryBtn: {
    fontSize: "18px",
    padding: "14px 24px",
    backgroundColor: "#16A34A",
    color: "white",
    border: "none",
    borderRadius: "8px",
    cursor: "pointer",
    fontWeight: "bold",
    width: "100%",
    marginBottom: "12px",
  },
  secondaryBtn: {
    fontSize: "16px",
    padding: "12px 20px",
    backgroundColor: "#3B82F6",
    color: "white",
    border: "none",
    borderRadius: "8px",
    cursor: "pointer",
    width: "100%",
    marginBottom: "12px",
  },
  dangerBtn: {
    fontSize: "16px",
    padding: "12px 20px",
    backgroundColor: "#DC2626",
    color: "white",
    border: "none",
    borderRadius: "8px",
    cursor: "pointer",
    width: "100%",
    marginBottom: "12px",
  },
  ghostBtn: {
    fontSize: "14px",
    padding: "8px 16px",
    backgroundColor: "transparent",
    color: "#6B7280",
    border: "none",
    cursor: "pointer",
    textDecoration: "underline",
  },
};

// ─── 1. SaveFailModal (★ D2 — 한글 32px + 4중 백업) ─────────────────────

/**
 * Save failure modal (D2).
 *
 * Props:
 *   - visible (boolean)
 *   - failedTabs (string[]) — worker tab keys
 *   - error (Error|string) — translateError() 적용
 *   - payload (object) — JSON download 용 state snapshot
 *   - sessionId (string)
 *   - projectName (string)
 *   - onRetry (function) — [다시 시도] 클릭
 *   - onClose (function) — [닫기] 클릭
 */
export function SaveFailModal({
  visible, failedTabs = [], error, payload, sessionId, projectName,
  onRetry, onClose,
}) {
  if (!visible) return null;

  const errorMsg = translateError(error);
  const tabLabels = failedTabs.map(tabLabelKo).join(", ");

  function handleDownload() {
    const fileName = `백업_${projectName || sessionId || "프로젝트"}_${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
    downloadBackupAsJSON(payload, fileName);
  }

  return (
    <div style={STYLES.backdrop} role="dialog" aria-modal="true">
      <div style={STYLES.modal}>
        <div style={{ ...STYLES.title, color: "#DC2626" }}>
          🚨 저장에 실패했습니다
        </div>
        <div style={STYLES.reassureText}>
          걱정하지 마세요. 작업물은 사라지지 않았습니다.
        </div>

        {tabLabels && (
          <div style={STYLES.bodyText}>
            <strong>실패한 탭:</strong> {tabLabels}
          </div>
        )}

        <div style={STYLES.bodyText}>
          <strong>원인:</strong> {errorMsg}
        </div>

        <button style={STYLES.primaryBtn} onClick={handleDownload}>
          💾 내 작업물 백업 파일로 저장하기
        </button>

        <button style={STYLES.secondaryBtn} onClick={onRetry}>
          🔄 다시 저장 시도하기
        </button>

        <button style={STYLES.ghostBtn} onClick={onClose}>
          닫기
        </button>
      </div>
    </div>
  );
}

// ─── 2. ConflictModal (★ 2 옵션 — 헌장 v1.1) ────────────────────────────

/**
 * Conflict modal (★ 헌장 v1.1 — 2 옵션: 강제저장 / 동기화).
 *
 * Props:
 *   - visible (boolean)
 *   - tab (string) — worker tab key
 *   - serverUpdatedBy (object) — { sub, name, at }
 *   - onForceSave (function) — 옵션 1: "내 저장 사항을 강제저장한다"
 *   - onReceiveServer (function) — 옵션 2: "내 변경 사항 이전의 상황으로 동기화한다"
 *   - onClose (function) — 명시 [닫기] (dirty 정리 필요 — N7' 영역)
 */
export function ConflictModal({
  visible, tab, serverUpdatedBy, onForceSave, onReceiveServer, onClose,
}) {
  if (!visible) return null;

  const tabLabel = tabLabelKo(tab);
  const otherUserName = serverUpdatedBy?.name || serverUpdatedBy?.sub || "다른 편집자";

  return (
    <div style={STYLES.backdrop} role="dialog" aria-modal="true">
      <div style={STYLES.modal}>
        <div style={{ ...STYLES.title, color: "#D97706" }}>
          ⚠️ 동시 저장이 감지되었습니다
        </div>
        <div style={STYLES.reassureText}>
          다른 사용자와의 동시 저장이 일어났습니다.<br />
          30초 이내의 변경사항이 있을 수 있습니다.
        </div>

        <div style={STYLES.bodyText}>
          <strong>탭:</strong> {tabLabel}
        </div>
        <div style={STYLES.bodyText}>
          <strong>{otherUserName}</strong> 님이 같은 탭을 수정했습니다.
        </div>

        <button style={STYLES.dangerBtn} onClick={onForceSave}>
          🔥 내 저장 사항을 강제저장한다
        </button>

        <button style={STYLES.secondaryBtn} onClick={onReceiveServer}>
          ⬇️ 내 변경 사항 이전의 상황으로 동기화한다
        </button>

        <button style={STYLES.ghostBtn} onClick={onClose}>
          나중에 결정 (백업 후)
        </button>
      </div>
    </div>
  );
}

// ─── 3. RestoreModal (★ 다음 로그인 즉시) ───────────────────────────────

/**
 * Restore modal — 진입 시 자동 노출 (te_backup_* 키 1+ 발견 시).
 *
 * Props:
 *   - visible (boolean)
 *   - backup (object) — { backupAt, payload, type, sessionId }
 *   - totalCount (number) — 백업 총 개수
 *   - onRestore (function) — [이어서 작업하기]
 *   - onShowList (function) — [다른 백업 보기]
 *   - onSkip (function) — [무시하고 새로 시작] (백업 보존)
 */
export function RestoreModal({ visible, backup, totalCount, onRestore, onShowList, onSkip }) {
  if (!visible || !backup) return null;

  const backupDate = backup.backupAt ? new Date(backup.backupAt).toLocaleString("ko-KR") : "(시각 미상)";
  const projectName = backup.payload?.fn || backup.sessionId || "이전 프로젝트";

  return (
    <div style={STYLES.backdrop} role="dialog" aria-modal="true">
      <div style={STYLES.modal}>
        <div style={{ ...STYLES.title, color: "#0EA5E9" }}>
          📂 이전 작업물을 발견했습니다
        </div>
        <div style={STYLES.reassureText}>
          {backupDate} 에<br />
          저장이 실패했던 작업입니다.
        </div>

        <div style={STYLES.bodyText}>
          <strong>프로젝트:</strong> {projectName}
        </div>
        {totalCount > 1 && (
          <div style={STYLES.bodyText}>
            (총 <strong>{totalCount}개</strong>의 백업이 있습니다)
          </div>
        )}

        <button style={STYLES.primaryBtn} onClick={onRestore}>
          ✓ 이어서 작업하기
        </button>

        {totalCount > 1 && (
          <button style={STYLES.secondaryBtn} onClick={onShowList}>
            다른 백업 보기
          </button>
        )}

        <button style={STYLES.ghostBtn} onClick={onSkip}>
          무시하고 새로 시작
        </button>
      </div>
    </div>
  );
}

// ─── 4. BackupListModal (백업 목록 + 관리) ──────────────────────────────

/**
 * Backup list modal.
 *
 * Props:
 *   - visible (boolean)
 *   - onRestore (function) — (key) => void
 *   - onClose (function)
 */
export function BackupListModal({ visible, onRestore, onClose }) {
  const [backups, setBackups] = useState([]);

  useEffect(() => {
    if (visible) setBackups(listBackups());
  }, [visible]);

  if (!visible) return null;

  function handleDownload(key) {
    const data = restoreFromBackup(key);
    if (!data) return;
    const fileName = `백업_${data.sessionId || "프로젝트"}_${new Date(data.backupAt || Date.now()).toISOString().replace(/[:.]/g, "-")}.json`;
    downloadBackupAsJSON(data.payload, fileName);
  }

  function handleDelete(key) {
    if (!confirm("이 백업을 삭제하시겠습니까?")) return;
    deleteBackup(key);
    setBackups(listBackups());
  }

  return (
    <div style={STYLES.backdrop} role="dialog" aria-modal="true">
      <div style={STYLES.modal}>
        <div style={STYLES.title}>📚 백업 목록</div>
        <div style={STYLES.reassureText}>
          저장 실패 시 자동으로 박제된 작업물입니다.
        </div>

        {backups.length === 0 ? (
          <div style={STYLES.bodyText}>
            저장된 백업이 없습니다.
          </div>
        ) : (
          <div>
            {backups.map((b) => (
              <div key={b.key} style={{
                border: "1px solid #E5E7EB",
                borderRadius: "8px",
                padding: "12px",
                marginBottom: "12px",
              }}>
                <div style={{ ...STYLES.bodyText, marginBottom: "8px" }}>
                  <strong>{tabLabelKoOrType(b.type)}</strong>
                  <br />
                  <small style={{ color: "#6B7280" }}>
                    프로젝트: {b.sessionId} · {formatTs(b.ts)}
                  </small>
                </div>
                <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                  <button
                    style={{ ...STYLES.secondaryBtn, width: "auto", marginBottom: 0 }}
                    onClick={() => onRestore && onRestore(b.key)}
                  >
                    복원
                  </button>
                  <button
                    style={{ ...STYLES.secondaryBtn, width: "auto", marginBottom: 0, backgroundColor: "#0EA5E9" }}
                    onClick={() => handleDownload(b.key)}
                  >
                    다운로드
                  </button>
                  <button
                    style={{ ...STYLES.dangerBtn, width: "auto", marginBottom: 0 }}
                    onClick={() => handleDelete(b.key)}
                  >
                    삭제
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        <button style={STYLES.ghostBtn} onClick={onClose}>
          닫기
        </button>
      </div>
    </div>
  );
}

// ─── 헬퍼 ────────────────────────────────────────────────────────────────

function tabLabelKoOrType(type) {
  const TYPE_LABELS = {
    save_failure: "저장 실패",
    conflict: "충돌",
    manuscript_replace: "원고 재업로드",
  };
  return TYPE_LABELS[type] || type;
}

function formatTs(ts) {
  if (!ts) return "(시각 미상)";
  // ts: 2026-05-10T03-32-15-000Z-abcd
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})/.exec(ts);
  if (!m) return ts;
  return `${m[1]}년 ${m[2]}월 ${m[3]}일 ${m[4]}시 ${m[5]}분`;
}
