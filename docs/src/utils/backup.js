// lab fresh v2 — frontend 4중 백업 (D2 + W-1~4)
// 사료: editor/ops/lab-v2-fresh-2026-05-09.md
//   - 묶음 ① ½ D2 (4중 백업 + 무제한 보관)
//   - W-1 통합 백업 키 명명 (te_backup_{type}_{sessionId}_{timestamp})
//   - W-2 manuscript_replace 5 cap (D2 무제한과 분리)
//   - W-3 영구 삭제 시 백업 키 정리 (호출자 책임)
//   - S3.2 D2 — 한글 모달 + JSON 정확 복원
//
// 책임:
//   - createEmergencyBackup (1차 beforeunload + 2차 localStorage 자동)
//   - downloadBackupAsJSON (3차 사용자 명시 클릭)
//   - listBackups / restoreFromBackup / deleteBackup
//   - autoRetry (4차 자동 재시도, 1+2+3초)
//
// 4중 백업 카탈로그:
//   1차 beforeunload 가드 — App.jsx 직접 (본 모듈 무관)
//   2차 localStorage 자동 — createEmergencyBackup
//   3차 JSON 다운로드 — downloadBackupAsJSON (사용자 클릭)
//   4차 자동 재시도 — autoRetry (1+2+3초)

const BACKUP_PREFIX = "te_backup_";
const SCHEMA_VERSION = "2.0";

// W-2 — manuscript_replace type 만 5 cap (FIFO). D2 무제한과 분리.
const MANUSCRIPT_REPLACE_CAP = 5;

/**
 * Build backup key.
 * Format: te_backup_{type}_{sessionId}_{ISO timestamp}-{nonce}
 *   - type: save_failure | conflict | manuscript_replace | (etc)
 *   - sessionId: project id
 *   - ISO: 2026-05-10T03-32-15-000Z (콜론 → 하이픈, 파일명 호환)
 *   - nonce: 4 random hex chars (★ 같은 ms 충돌 차단)
 */
function buildBackupKey(type, sessionId, ts) {
  const isoSafe = String(ts).replace(/[:.]/g, "-");
  const nonce = Math.floor(Math.random() * 0xFFFF).toString(16).padStart(4, "0");
  return `${BACKUP_PREFIX}${type}_${sessionId}_${isoSafe}-${nonce}`;
}

/**
 * Parse backup key.
 */
function parseBackupKey(key) {
  if (!key || !key.startsWith(BACKUP_PREFIX)) return null;
  const rest = key.slice(BACKUP_PREFIX.length);
  // rest = type_sessionId_timestamp
  //   - type: 마지막 두 underscore 이전 모두 (save_failure / conflict / manuscript_replace 등)
  //   - sessionId: 마지막 두 번째 토큰 (^[a-z0-9]{4,24}$)
  //   - ts: 마지막 토큰 (ISO timestamp, '-' 로 분리)
  // 안전한 방법: 뒤에서부터 분리 — sessionId 패턴 detect.
  const parts = rest.split("_");
  if (parts.length < 3) return null;

  // 뒤에서부터 sessionId 자리 찾기 (마지막 토큰은 ts, 그 직전 토큰이 sessionId)
  // ts 는 "-" 포함하므로 sessionId 검증으로 식별
  for (let i = parts.length - 2; i >= 1; i--) {
    if (/^[a-z0-9]{4,24}$/.test(parts[i])) {
      const type = parts.slice(0, i).join("_");
      const sessionId = parts[i];
      const ts = parts.slice(i + 1).join("_");
      // sanity: ts 가 ISO 패턴 (YYYY-MM-DD 시작) 인지 추가 검증
      if (/^\d{4}-\d{2}-\d{2}/.test(ts)) {
        return { type, sessionId, ts };
      }
    }
  }
  return null;
}

/**
 * Create an emergency backup in localStorage (★ 2차 백업).
 *
 * @param {object} payload - 모든 state (blocks/anal/diffs/hl/exportCache/...)
 * @param {object} opts - { type, sessionId, reason? }
 * @returns {string|null} backup key (or null on failure)
 *
 * W-2: manuscript_replace type 만 5 cap (FIFO).
 */
export function createEmergencyBackup(payload, opts = {}) {
  const type = opts.type || "save_failure";
  const sessionId = opts.sessionId || "_unknown";
  const ts = new Date().toISOString();
  const key = buildBackupKey(type, sessionId, ts);

  const data = {
    schemaVersion: SCHEMA_VERSION,
    backupAt: ts,
    type,
    sessionId,
    reason: opts.reason || null,
    payload,
  };

  try {
    localStorage.setItem(key, JSON.stringify(data));
  } catch (e) {
    // localStorage 가득 참 등 — silent return + console.error
    console.error(`[backup] localStorage write failed: ${e?.message}`);
    return null;
  }

  // W-2 — manuscript_replace 만 cap (FIFO)
  if (type === "manuscript_replace") {
    enforceCap(type, sessionId, MANUSCRIPT_REPLACE_CAP);
  }

  return key;
}

/**
 * Enforce FIFO cap for a given backup type + sessionId.
 */
function enforceCap(type, sessionId, cap) {
  const keys = listBackups()
    .filter((b) => b.type === type && b.sessionId === sessionId)
    .sort((a, b) => (a.ts > b.ts ? -1 : 1));  // 최신 우선
  for (let i = cap; i < keys.length; i++) {
    deleteBackup(keys[i].key);
  }
}

/**
 * Download backup as JSON file (★ 3차 백업, 사용자 명시 클릭).
 *
 * @param {object} payload
 * @param {string} fileName - 권장 형식: 백업_{프로젝트명}_{YYYY-MM-DD-HH-MM-SS}.json
 */
export function downloadBackupAsJSON(payload, fileName) {
  const data = {
    schemaVersion: SCHEMA_VERSION,
    downloadedAt: new Date().toISOString(),
    payload,
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName || `백업_${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * List all backups (sorted desc by ts).
 *
 * @returns {Array<{key, type, sessionId, ts, payload?}>}
 */
export function listBackups() {
  const out = [];
  if (typeof localStorage === "undefined") return out;
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (!k || !k.startsWith(BACKUP_PREFIX)) continue;
    const meta = parseBackupKey(k);
    if (!meta) continue;
    out.push({ key: k, ...meta });
  }
  out.sort((a, b) => (a.ts > b.ts ? -1 : 1));
  return out;
}

/**
 * Read backup payload by key.
 */
export function restoreFromBackup(key) {
  if (typeof localStorage === "undefined") return null;
  const raw = localStorage.getItem(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Get the latest backup (any type).
 */
export function getLatestBackup() {
  const all = listBackups();
  if (all.length === 0) return null;
  const latest = all[0];
  return restoreFromBackup(latest.key);
}

/**
 * Delete a backup (사용자 명시 또는 W-3 영구 삭제 정리).
 */
export function deleteBackup(key) {
  if (typeof localStorage === "undefined") return false;
  try {
    localStorage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

/**
 * Delete all backups for a sessionId (W-3 — 영구 삭제 시 정리).
 */
export function deleteBackupsForSession(sessionId) {
  let count = 0;
  for (const b of listBackups()) {
    if (b.sessionId === sessionId) {
      if (deleteBackup(b.key)) count++;
    }
  }
  return count;
}

/**
 * Auto-retry with exponential backoff (★ 4차 백업).
 *
 * @param {Function} fn - async fn to retry
 * @param {object} opts - { delays?: [1000, 2000, 3000], maxAttempts?: 4 }
 * @returns {Promise<{ok: boolean, value?, error?, attempts}>}
 *
 * 사료 D2: 1+2+3초 (3회), 4회 모두 실패 시 모달 노출.
 */
export async function autoRetry(fn, opts = {}) {
  const delays = opts.delays || [1000, 2000, 3000];
  const maxAttempts = opts.maxAttempts || delays.length + 1;
  let attempts = 0;
  let lastError;

  for (; attempts < maxAttempts; attempts++) {
    try {
      const value = await fn();
      return { ok: true, value, attempts: attempts + 1 };
    } catch (e) {
      lastError = e;
      // 재시도 X 케이스 (4xx — 사용자 입력 결함, retry 무의미)
      if (e?.status && e.status >= 400 && e.status < 500 && e.status !== 429) {
        return { ok: false, error: e, attempts: attempts + 1 };
      }
      // 마지막 시도가 아니면 backoff
      if (attempts < maxAttempts - 1) {
        await sleep(delays[attempts] || delays[delays.length - 1] || 3000);
      }
    }
  }

  return { ok: false, error: lastError, attempts };
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
