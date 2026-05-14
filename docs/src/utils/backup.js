// CMS v2 — 4중 백업 헬퍼 (D2 사용자 결정 4건 모두 도입)
// 묶음 ① ½ + ⑨
// 1차: beforeunload 가드 (App.jsx 직접)
// 2차: localStorage 자동 (이 모듈)
// 3차: JSON 다운로드 (이 모듈)
// 4차: 자동 재시도 (saveDirtyTabsToKV 안에 통합)

const BACKUP_KEY_PREFIX = "te_backup_";

// CMS v2 — N2 (W-2): type 별 보관 정책
//   - save_failure / conflict / deleted_restore: 무제한 (D2 결정)
//   - manuscript_replace: 5개 cap (W-2 결정, D2 와 분리)
const TYPE_CAPS = { manuscript_replace: 5 };

function pruneByType(type, maxCount) {
  const prefix = `${BACKUP_KEY_PREFIX}${type}_`;
  const keys = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith(prefix)) keys.push(k);
  }
  keys.sort(); // 오래된 순 (timestamp 포함 키)
  while (keys.length >= maxCount) {
    const oldest = keys.shift();
    localStorage.removeItem(oldest);
    console.log(`[backup] cap 초과 정리: ${oldest}`);
  }
}

/**
 * type ∈ {"save_failure", "conflict", "manuscript_replace", "deleted_restore"}
 * - 기본: 무제한 보관 (D2)
 * - manuscript_replace: 5개 cap (FIFO, W-2)
 */
export function createEmergencyBackup({ type, sessionId, fn, tab, payload, reason }) {
  // CMS v2 — N2: type 별 cap 적용 (cap 있는 type 만)
  const cap = TYPE_CAPS[type];
  if (cap) pruneByType(type, cap);

  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const key = `${BACKUP_KEY_PREFIX}${type}_${sessionId}_${ts}`;
  // R3.e — tab 필드 추가 (W2 호환: 옛 backup 은 tab 영역 X, RestoreModal fallback 추론)
  const data = {
    type,
    sessionId,
    fn,
    tab: tab || null,
    backupAt: new Date().toISOString(),
    reason,
    data: payload,
  };
  try {
    localStorage.setItem(key, JSON.stringify(data));
    return { ok: true, key };
  } catch (e) {
    console.error("[backup] localStorage write failed:", e?.message || e);
    return { ok: false, error: e?.message || "localStorage full", key };
  }
}

/**
 * JSON 파일로 다운로드 (3차 백업 — 사용자 명시 클릭).
 * 파일명: 백업_{프로젝트명}_{ISO}.json
 */
export function downloadBackupAsJSON({ sessionId, fn, payload, type = "save_failure" }) {
  const ts = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  const safeName = (fn || "프로젝트").replace(/[\\/:*?"<>|]/g, "_");
  const filename = `백업_${safeName}_${ts}.json`;
  const data = {
    type,
    sessionId,
    fn,
    exportedAt: new Date().toISOString(),
    schemaVersion: "2.0",
    payload,
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
  return { ok: true, filename };
}

/**
 * 백업 목록 조회 (최신 순).
 */
export function listBackups() {
  const keys = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith(BACKUP_KEY_PREFIX)) keys.push(k);
  }
  return keys.sort().reverse().map((k) => {
    try {
      const data = JSON.parse(localStorage.getItem(k));
      return { key: k, ...data };
    } catch {
      return { key: k, error: "parse failed" };
    }
  });
}

/**
 * 가장 최근 백업 1개 (복원 모달 제안용).
 */
export function getLatestBackup() {
  const all = listBackups();
  return all.length > 0 ? all[0] : null;
}

/**
 * 백업 삭제 (사용자 명시 호출만).
 */
export function deleteBackup(key) {
  if (!key.startsWith(BACKUP_KEY_PREFIX)) return false;
  localStorage.removeItem(key);
  return true;
}

/**
 * 특정 sessionId 의 모든 백업 삭제 (영구 삭제 시 호출 — W3).
 */
export function deleteBackupsForSession(sessionId) {
  const all = listBackups();
  let deleted = 0;
  for (const b of all) {
    if (b.sessionId === sessionId) {
      localStorage.removeItem(b.key);
      deleted += 1;
    }
  }
  return deleted;
}

/**
 * 자동 재시도 (4차 백업).
 * @param {Function} fn — 실 저장 호출 (Promise 반환)
 * @param {number} maxAttempts
 * @returns {Promise<{ok, attempt, result?, error?}>}
 */
export async function autoRetry(fn, maxAttempts = 3) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const result = await fn();
      return { ok: true, attempt, result };
    } catch (err) {
      // 마지막 시도 실패 → throw
      if (attempt >= maxAttempts) {
        return { ok: false, attempt, error: err };
      }
      // 백오프: 1초, 2초, 3초
      await new Promise((r) => setTimeout(r, 1000 * attempt));
    }
  }
}
