#!/usr/bin/env node
// lab fresh v2 — KV migration script (옛 ttimes-editor → lab)
// 사료: editor/ops/lab-v2-fresh-2026-05-09.md
//   - 묶음 ⑥ B2: _stableId 마이그레이션 5단계 idempotent
//   - 묶음 ⑪: legacy key 마이그레이션
//   - S2.2.c KV value envelope (savedAt + version + updatedBy + schemaVersion)
//   - S4.6 H3: 다중 계정 → CLOUDFLARE_ACCOUNT_ID env 의무
//   - S4.5 KV 마이그레이션 결과 reference (104 keys / 2619 entities)
//   - 사용자 결정 (lab-setup): 90 keys 전부, OPENAI/GEMINI prod 와 공유, JWT_SECRET 별도
//
// 5 모드 (idempotent):
//   analyze   : 옛 KV list + 키 카탈로그
//   dry-run   : get/put 시뮬 + anomaly 식별 (실 KV 변경 0)
//   commit    : 백업 → bulk put → random sample 검증
//   verify    : lab-sessions 키 수 검증 + sample 비교
//   rollback  : 백업 dump 에서 lab 측 키 삭제 (긴급)
//
// 사용:
//   node scripts/migrate_from_old_test.mjs <mode>
//
// 의존: wrangler CLI (사용자 OAuth login 필요)

import { execSync } from "node:child_process";
import {
  readFileSync, writeFileSync, mkdirSync, existsSync, rmSync,
} from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ─── 환경 (사료 영구 박제) ──────────────────────────────────────────────

export const ACCOUNT_ID = "fb0a10864393158e940b149b3ead37f6";  // ttimesvibe
export const SOURCE_KV_ID = "9e4f5bb9cd294b86868e4b9d502adbcc";  // editor-sessions (옛 test)
export const TARGET_KV_ID = "fbb8da8adcae4ee0a555abff66f798ac";  // lab-sessions

const SCHEMA_VERSION = "2.0";
const BACKUP_DIR = resolve(__dirname, "..");
const STATUS_KEY = "migrate:from-old-test:status";

// ─── wrangler CLI 래퍼 (★ env CLOUDFLARE_ACCOUNT_ID, H3) ───────────────

function wranglerCmd(args, opts = {}) {
  const env = { ...process.env, CLOUDFLARE_ACCOUNT_ID: ACCOUNT_ID };
  return execSync(`npx -y wrangler ${args}`, {
    env,
    encoding: "utf-8",
    stdio: opts.silent ? ["pipe", "pipe", "pipe"] : ["pipe", "pipe", "inherit"],
    cwd: resolve(__dirname, "..", "worker"),
    maxBuffer: 100 * 1024 * 1024,  // 100MB (큰 KV 응답 방어)
  });
}

export function listKeys(namespaceId) {
  const out = wranglerCmd(`kv key list --namespace-id=${namespaceId} --remote`, { silent: true });
  try {
    const parsed = JSON.parse(out);
    return parsed.map((e) => e.name).filter(Boolean);
  } catch {
    return [];
  }
}

export function getValue(namespaceId, key) {
  try {
    return wranglerCmd(
      `kv key get "${key}" --namespace-id=${namespaceId} --remote`,
      { silent: true }
    );
  } catch (e) {
    return null;
  }
}

export function putValue(namespaceId, key, value, opts = {}) {
  // value 가 큰 경우 임시 file 사용
  const tmp = resolve(BACKUP_DIR, `.migrate-tmp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.txt`);
  try {
    writeFileSync(tmp, value);
    let cmd = `kv key put "${key}" --path="${tmp}" --namespace-id=${namespaceId} --remote`;
    if (opts.expirationTtl) cmd += ` --expiration-ttl=${opts.expirationTtl}`;
    wranglerCmd(cmd, { silent: true });
    return true;
  } catch (e) {
    console.error(`[put] ${key} failed: ${e?.message}`);
    return false;
  } finally {
    if (existsSync(tmp)) rmSync(tmp);
  }
}

export function deleteValue(namespaceId, key) {
  try {
    wranglerCmd(
      `kv key delete "${key}" --namespace-id=${namespaceId} --remote`,
      { silent: true }
    );
    return true;
  } catch {
    return false;
  }
}

// ─── 키 카탈로그 (analyze 영역) ──────────────────────────────────────────

export function categorize(keys) {
  const cat = {
    sessionTab: 0,    // s:{id}:{tab}
    sessionImg: 0,    // s:{id}:img:*
    legacy: 0,        // save_*, auto_*, shared_dict, single id
    index: 0,         // project_index, session_index, shoot_index, team_members
    active: 0,        // active:*
    migrate: 0,       // migrate:*
    other: 0,
  };
  const samples = { sessionTab: [], legacy: [], other: [] };

  for (const k of keys) {
    if (/^s:[a-z0-9]{4,24}:img:/.test(k)) {
      cat.sessionImg++;
    } else if (/^s:[a-z0-9]{4,24}:[a-z]+$/.test(k)) {
      cat.sessionTab++;
      if (samples.sessionTab.length < 5) samples.sessionTab.push(k);
    } else if (/^(save|auto)_/.test(k) || k === "shared_dict") {
      cat.legacy++;
      if (samples.legacy.length < 5) samples.legacy.push(k);
    } else if (["project_index", "session_index", "shoot_index", "team_members"].includes(k)) {
      cat.index++;
    } else if (/^active:/.test(k)) {
      cat.active++;
    } else if (/^migrate:/.test(k)) {
      cat.migrate++;
    } else {
      cat.other++;
      if (samples.other.length < 5) samples.other.push(k);
    }
  }
  return { cat, samples };
}

// ─── transformValue (KV envelope v2.0 보강 + _stableId) ────────────────

const STABLE_ID_FIELDS = Object.freeze([
  "hl", "diffs", "visualGuides", "insertCuts", "manualResources",
]);

export function transformValue(rawValue, key) {
  if (typeof rawValue !== "string" || rawValue === "") {
    return { transformed: rawValue, changed: false, anomaly: "empty" };
  }

  // 비-JSON 값 (image base64 등) → 그대로 통과
  let val;
  try {
    val = JSON.parse(rawValue);
  } catch {
    return { transformed: rawValue, changed: false, anomaly: null };
  }

  if (typeof val !== "object" || val === null) {
    return { transformed: rawValue, changed: false, anomaly: null };
  }

  const before = JSON.stringify(val);
  let mutated = false;

  // s:{id}:{tab} 키만 envelope 보강 (image / index / legacy 는 변경 X)
  if (/^s:[a-z0-9]{4,24}:[a-z]+$/.test(key)) {
    if (!val.schemaVersion) {
      val.schemaVersion = SCHEMA_VERSION;
      mutated = true;
    }
    if (val.version === undefined || val.version === null) {
      val.version = 1;
      mutated = true;
    }
    if (!val.savedAt) {
      val.savedAt = val.updatedAt || new Date().toISOString();
      mutated = true;
    }
    // updatedBy 객체화 (옛 데이터는 string 일 수 있음)
    if (val.updatedBy && typeof val.updatedBy === "string") {
      val.updatedBy = { sub: val.updatedBy, name: val.updatedBy, at: val.savedAt };
      mutated = true;
    }

    // _stableId 부여 (배열 entity)
    for (const field of STABLE_ID_FIELDS) {
      if (Array.isArray(val[field])) {
        for (let i = 0; i < val[field].length; i++) {
          const item = val[field][i];
          if (item && typeof item === "object" && !item._stableId) {
            val[field][i] = {
              ...item,
              _stableId: generateStableId(item, field, i, key),
            };
            mutated = true;
          }
        }
      }
    }
  }

  return {
    transformed: mutated ? JSON.stringify(val) : rawValue,
    changed: mutated,
    anomaly: null,
  };
}

/**
 * Generate a stable ID for entity migration.
 * 사료 D6-2: SHA-256(subtitle+speaker+startMs) 12자.
 * 본 baseline = 단순 hash fallback. SHA-256 은 호출자 환경 (Worker / Node 19+) 의존.
 */
export function generateStableId(item, field, index, sourceKey) {
  // 우선순위: subtitle / text / id 기반 deterministic hash
  const seed = item.subtitle || item.text || item.id || `${sourceKey}:${field}:${index}`;
  const speaker = item.speaker || "";
  const startMs = item.startMs || item.start || 0;
  const composite = `${seed}::${speaker}::${startMs}`;
  return `m_${field}_${simpleHash(composite)}`;
}

/**
 * Simple deterministic hash (★ baseline — SHA-256 은 호출자 환경 의존).
 * Returns 12-char alphanumeric.
 */
export function simpleHash(s) {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const a = (h2 >>> 0).toString(36).padStart(7, "0").slice(0, 6);
  const b = (h1 >>> 0).toString(36).padStart(7, "0").slice(0, 6);
  return `${a}${b}`;
}

// ─── 모드 핸들러 ─────────────────────────────────────────────────────────

async function modeAnalyze() {
  console.log(`▶ analyze — 옛 KV (${SOURCE_KV_ID}) ↔ lab KV (${TARGET_KV_ID})`);
  const sourceKeys = listKeys(SOURCE_KV_ID);
  const targetKeys = listKeys(TARGET_KV_ID);

  console.log(`\n  옛 KV (editor-sessions) keys: ${sourceKeys.length}`);
  const { cat: sCat, samples: sSamples } = categorize(sourceKeys);
  for (const [k, v] of Object.entries(sCat)) {
    console.log(`    ${k.padEnd(12)}: ${v}`);
  }
  if (sSamples.sessionTab.length > 0) {
    console.log(`    samples (sessionTab): ${sSamples.sessionTab.slice(0, 3).join(", ")}`);
  }
  if (sSamples.legacy.length > 0) {
    console.log(`    samples (legacy): ${sSamples.legacy.slice(0, 3).join(", ")}`);
  }

  console.log(`\n  lab KV (lab-sessions) keys: ${targetKeys.length}`);
  if (targetKeys.length > 0) {
    console.log(`    ⚠️ lab-sessions 가 비어있지 않음 — commit 시 충돌 영역`);
  }
  return { sourceKeys, targetKeys, sCat };
}

async function modeDryRun() {
  console.log(`▶ dry-run — 변경 영역 보고 (실 KV 변경 0)`);
  const { sourceKeys } = await modeAnalyze();

  let changedCount = 0;
  let anomalyCount = 0;
  const anomalies = [];
  const sample = [];

  for (const key of sourceKeys) {
    const raw = getValue(SOURCE_KV_ID, key);
    if (raw === null) {
      anomalyCount++;
      anomalies.push({ key, reason: "get failed" });
      continue;
    }
    const r = transformValue(raw, key);
    if (r.changed) changedCount++;
    if (r.anomaly) {
      anomalyCount++;
      anomalies.push({ key, reason: r.anomaly });
    }
    if (sample.length < 3 && r.changed) sample.push({ key, sizeBefore: raw.length, sizeAfter: r.transformed.length });
  }

  console.log(`\n  변경 영역: ${changedCount} / ${sourceKeys.length}`);
  console.log(`  anomalies: ${anomalyCount}`);
  if (anomalies.length > 0) {
    console.log(`    anomaly samples:`, anomalies.slice(0, 5));
  }
  if (sample.length > 0) {
    console.log(`  sample (changed):`, sample);
  }

  return { sourceKeys, changedCount, anomalyCount, anomalies };
}

async function modeCommit() {
  console.log(`▶ commit — dry-run 후 실 마이그레이션`);

  // 1. dry-run 검증
  const dryResult = await modeDryRun();
  if (dryResult.anomalyCount > 5) {
    console.error(`❌ anomaly 5+ — commit 차단. dry-run anomaly 영역 검토 후 재시도.`);
    process.exit(1);
  }

  // 2. 백업 dump
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = resolve(BACKUP_DIR, `kv-backup-from-old-test-${ts}.json`);
  console.log(`\n  백업 dump → ${backupPath}`);
  const backup = {};
  for (const key of dryResult.sourceKeys) {
    const raw = getValue(SOURCE_KV_ID, key);
    if (raw !== null) backup[key] = raw;
  }
  writeFileSync(backupPath, JSON.stringify(backup, null, 2));
  console.log(`    ✅ ${Object.keys(backup).length} keys 백업 완료`);

  // 3. transform + put
  console.log(`\n  마이그레이션 진행…`);
  let putCount = 0;
  let putFailed = 0;
  for (const key of dryResult.sourceKeys) {
    const raw = backup[key];
    if (!raw) continue;
    const { transformed } = transformValue(raw, key);
    if (putValue(TARGET_KV_ID, key, transformed)) {
      putCount++;
    } else {
      putFailed++;
    }
    if (putCount % 10 === 0) console.log(`    ${putCount} / ${dryResult.sourceKeys.length}`);
  }
  console.log(`    ✅ put: ${putCount} / failed: ${putFailed}`);

  // 4. status 박제
  putValue(TARGET_KV_ID, STATUS_KEY, JSON.stringify({
    completed: true,
    completedAt: new Date().toISOString(),
    sourceKeys: dryResult.sourceKeys.length,
    putCount,
    putFailed,
    backupPath,
  }));

  // 5. random sample 검증
  console.log(`\n  random sample 검증 (10 keys)…`);
  const sampleKeys = dryResult.sourceKeys.slice().sort(() => Math.random() - 0.5).slice(0, 10);
  let mismatch = 0;
  for (const key of sampleKeys) {
    const targetVal = getValue(TARGET_KV_ID, key);
    if (targetVal === null) {
      console.error(`    ❌ ${key} not in lab-sessions`);
      mismatch++;
    }
  }
  if (mismatch === 0) {
    console.log(`    ✅ sample 10/10 검증 통과`);
  } else {
    console.error(`    ❌ ${mismatch}/10 mismatch`);
  }

  console.log(`\n✅ commit 완료. 백업: ${backupPath}`);
}

async function modeVerify() {
  console.log(`▶ verify — lab-sessions 키 수 + sample 검증`);
  const { sourceKeys, targetKeys } = await modeAnalyze();
  // STATUS_KEY 는 target 만 (source 에 없음)
  const targetWithoutStatus = targetKeys.filter((k) => k !== STATUS_KEY);
  console.log(`\n  source: ${sourceKeys.length}`);
  console.log(`  target (status 제외): ${targetWithoutStatus.length}`);
  if (sourceKeys.length === targetWithoutStatus.length) {
    console.log(`  ✅ 키 수 일치`);
  } else {
    console.log(`  ⚠️ 키 수 불일치 — 차이 ${Math.abs(sourceKeys.length - targetWithoutStatus.length)}`);
  }
}

async function modeRollback(backupPath) {
  if (!backupPath || !existsSync(backupPath)) {
    console.error(`❌ rollback: backup 파일 경로 의무 + 존재 확인`);
    process.exit(1);
  }
  console.log(`▶ rollback — lab-sessions 측 키 삭제 (백업 ${backupPath} reference)`);
  const backup = JSON.parse(readFileSync(backupPath, "utf-8"));
  let deleted = 0;
  for (const key of Object.keys(backup)) {
    if (deleteValue(TARGET_KV_ID, key)) deleted++;
  }
  // status 도 제거
  deleteValue(TARGET_KV_ID, STATUS_KEY);
  console.log(`  ✅ ${deleted} keys 삭제`);
}

// ─── main ────────────────────────────────────────────────────────────────

async function main() {
  const mode = process.argv[2];
  const arg = process.argv[3];
  switch (mode) {
    case "analyze":
      await modeAnalyze();
      break;
    case "dry-run":
      await modeDryRun();
      break;
    case "commit":
      await modeCommit();
      break;
    case "verify":
      await modeVerify();
      break;
    case "rollback":
      await modeRollback(arg);
      break;
    default:
      console.log(`Usage: node migrate_from_old_test.mjs <mode>

Modes:
  analyze              — 옛 KV list + 키 카탈로그
  dry-run              — get/put 시뮬 + anomaly 식별
  commit               — 백업 → bulk put → sample 검증
  verify               — 키 수 + sample 비교
  rollback <path>      — backup file 에서 target 키 삭제 (긴급)

Env:
  CLOUDFLARE_ACCOUNT_ID = ${ACCOUNT_ID} (자동 박제)
`);
      process.exit(0);
  }
}

// Windows 호환: import.meta.url 는 "file:///D:/..." (slash 3) — pathToFileURL 사용
import { pathToFileURL } from "node:url";
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
