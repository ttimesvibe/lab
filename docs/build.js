// lab fresh v2 — frontend build script (drift guard pre+post)
// 사료: editor/ops/lab-v2-fresh-2026-05-09.md (S5.1 A14.1 + S2.6)
//
// 책임:
//   1. PREBUILD drift guard — config.js 의 workerUrl 이 canonical 인지
//   2. vite build
//   3. dist → docs/ 복사
//   4. STALE 번들 auto-purge (index.html 미참조 assets/*.js 삭제)
//   5. POSTBUILD drift guard — assets/*.js 에 forbidden URL 잔존 X 검증

import { execSync } from "node:child_process";
import {
  readFileSync, writeFileSync, readdirSync,
  copyFileSync, existsSync, mkdirSync, unlinkSync,
} from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ★ Canonical worker URL (lab 전용)
// docs/src/utils/config.js 의 DEFAULT_CONFIG.workerUrl 과 같은 commit 에서 함께 수정 의무
const CANONICAL_WORKER_URL = "https://lab.ttimes.workers.dev";

// ★ Forbidden URLs — prod / 옛 test / 옛 worker 잔존 차단
const FORBIDDEN_WORKER_URLS = [
  "alleditor.ttimes6000.workers.dev",        // prod editor
  "editor.ttimes.workers.dev",               // 옛 test (Phase 3 폐기 예정)
  "ttimes-edit.ttimes.workers.dev",          // 옛 worker (4/12 죽음)
];

const CONFIG_PATH = join(__dirname, "src", "utils", "config.js");
const INDEX_HTML = join(__dirname, "index.html");
const DIST_DIR = join(__dirname, "dist");
const ASSETS_DIR = join(__dirname, "assets");

// 1. PREBUILD DRIFT GUARD
function prebuildDriftGuard() {
  console.log("▶ prebuild drift guard");
  if (!existsSync(CONFIG_PATH)) {
    console.warn("  ⚠️ config.js 없음 — skip");
    return;
  }
  const content = readFileSync(CONFIG_PATH, "utf-8");
  if (!content.includes(CANONICAL_WORKER_URL)) {
    console.error(`❌ prebuild: config.js workerUrl ≠ canonical (${CANONICAL_WORKER_URL})`);
    process.exit(1);
  }
  for (const forbidden of FORBIDDEN_WORKER_URLS) {
    if (content.includes(forbidden)) {
      console.error(`❌ prebuild: config.js 에 forbidden URL 잔존 — ${forbidden}`);
      process.exit(1);
    }
  }
  console.log(`  ✅ config.js → ${CANONICAL_WORKER_URL}`);
}

// 2. VITE BUILD
function viteBuild() {
  console.log("▶ vite build");
  execSync("npx -y vite build", { stdio: "inherit", cwd: __dirname });
}

// 3. dist → docs/ 복사
function copyDistToDocs() {
  console.log("▶ dist → docs/ 복사");
  if (!existsSync(DIST_DIR)) {
    console.error("❌ dist/ 없음 — vite build 실패?");
    process.exit(1);
  }
  // dist/index.html → docs/index.html
  copyFileSync(join(DIST_DIR, "index.html"), INDEX_HTML);
  // dist/assets/* → docs/assets/*
  if (!existsSync(ASSETS_DIR)) mkdirSync(ASSETS_DIR);
  const distAssets = join(DIST_DIR, "assets");
  if (existsSync(distAssets)) {
    for (const f of readdirSync(distAssets)) {
      copyFileSync(join(distAssets, f), join(ASSETS_DIR, f));
    }
  }
  console.log("  ✅ 복사 완료");
}

// 4. STALE 번들 auto-purge
function stalePurge() {
  console.log("▶ stale 번들 auto-purge");
  if (!existsSync(ASSETS_DIR)) return;
  const html = readFileSync(INDEX_HTML, "utf-8");
  const referenced = new Set();
  for (const m of html.matchAll(/assets\/([^"'\s>]+)/g)) {
    referenced.add(m[1]);
  }
  let purged = 0;
  for (const f of readdirSync(ASSETS_DIR)) {
    if (!referenced.has(f) && f.endsWith(".js")) {
      unlinkSync(join(ASSETS_DIR, f));
      purged++;
    }
  }
  console.log(`  ✅ ${purged} stale bundle 삭제`);
}

// 5. POSTBUILD DRIFT GUARD
function postbuildDriftGuard() {
  console.log("▶ postbuild drift guard");
  if (!existsSync(ASSETS_DIR)) return;
  let found = false;
  let canonicalSeen = false;
  for (const f of readdirSync(ASSETS_DIR)) {
    if (!f.endsWith(".js")) continue;
    const content = readFileSync(join(ASSETS_DIR, f), "utf-8");
    for (const forbidden of FORBIDDEN_WORKER_URLS) {
      if (content.includes(forbidden)) {
        console.error(`❌ postbuild: ${f} 에 forbidden URL 잔존 — ${forbidden}`);
        found = true;
      }
    }
    if (content.includes(CANONICAL_WORKER_URL)) canonicalSeen = true;
  }
  if (found) {
    console.error("   대응: src/utils/config.js 의 workerUrl 검증");
    process.exit(1);
  }
  if (!canonicalSeen) {
    console.warn(`  ⚠️ assets/*.js 에 ${CANONICAL_WORKER_URL} 미발견 — config.js 미사용?`);
  }
  console.log("  ✅ forbidden URL 0건");
}

// MAIN
prebuildDriftGuard();
viteBuild();
copyDistToDocs();
stalePurge();
postbuildDriftGuard();
console.log("✅ build 완료");
