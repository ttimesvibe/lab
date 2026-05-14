// Build helper: swap index.html to dev entry → vite build → copy dist output back
// + Drift guard: ensure config.js workerUrl is canonical and no stale URLs leak into bundle
// + Stale-bundle purge: remove assets/*.js not referenced by index.html
import { readFileSync, writeFileSync, cpSync, readdirSync, unlinkSync } from "fs";
import { execSync } from "child_process";
import { join } from "path";

const indexPath = "index.html";

// Canonical lab (test) worker URL — single source of truth for drift detection
// ★ 본 repo 는 prod editor 의 clone 이지만 lab Worker 가리킴 — prod 와 데이터 분리 의무 (사용자 원칙 2/3)
const CANONICAL_WORKER_URL = "https://lab.ttimes.workers.dev";
// Any previously-used URL that must NEVER appear in shipped bundles
// 번들에 절대 들어가면 안 되는 URL (PROD 로의 역방향 drift 방지 — lab → prod KV 섞임 차단)
const FORBIDDEN_WORKER_URLS = [
  "https://alleditor.ttimes6000.workers.dev",       // ★ 실제 PROD worker URL — lab 이 잘못 호출하면 prod KV 섞임
  "https://editor.ttimes.workers.dev",              // 옛 test worker (Phase 8 폐기 예정)
  "https://ttimes-edit.ttimes.workers.dev",         // 옛 worker (4/12 죽음)
];

// ─────────────────────────────────────────────
// Prebuild drift guard: config.js workerUrl must be canonical
// ─────────────────────────────────────────────
const cfgPath = "src/utils/config.js";
const cfgSrc = readFileSync(cfgPath, "utf8");
const cfgUrlMatch = cfgSrc.match(/workerUrl:\s*"([^"]+)"/);
if (!cfgUrlMatch) {
  console.error(`❌ drift-guard: ${cfgPath} 에서 workerUrl 을 찾을 수 없습니다`);
  process.exit(1);
}
if (cfgUrlMatch[1] !== CANONICAL_WORKER_URL) {
  console.error(`❌ drift-guard: ${cfgPath} workerUrl 이 canonical 과 다릅니다`);
  console.error(`   expected: ${CANONICAL_WORKER_URL}`);
  console.error(`   actual:   ${cfgUrlMatch[1]}`);
  process.exit(1);
}
for (const bad of FORBIDDEN_WORKER_URLS) {
  if (cfgSrc.includes(bad)) {
    console.error(`❌ drift-guard: ${cfgPath} 에 금지된 URL 포함 — ${bad}`);
    process.exit(1);
  }
}
console.log(`✅ drift-guard (pre): config.js workerUrl = ${CANONICAL_WORKER_URL}`);

// Step 1: Swap index.html to use source entry for Vite
let html = readFileSync(indexPath, "utf8");
const prodScript = html.match(/<script[^>]*src="[^"]*"[^>]*><\/script>/)?.[0];
html = html.replace(/<script[^>]*src="[^"]*"[^>]*><\/script>/, '<script type="module" src="/src/main.jsx"></script>');
writeFileSync(indexPath, html);
console.log("✅ index.html → dev entry");

// Step 2: Run vite build
try {
  execSync("npx vite build", { stdio: "inherit" });
} catch (e) {
  // Restore original on failure
  if (prodScript) {
    html = readFileSync(indexPath, "utf8");
    html = html.replace(/<script[^>]*src="[^"]*"[^>]*><\/script>/, prodScript);
    writeFileSync(indexPath, html);
  }
  process.exit(1);
}

// Step 3: Copy dist output to docs root
cpSync("dist/assets", "assets", { recursive: true });
cpSync("dist/index.html", indexPath);
console.log("✅ dist → docs root copied");

// Step 3b: Purge stale bundles not referenced by current index.html
{
  const finalHtml = readFileSync(indexPath, "utf8");
  const referenced = new Set();
  const jsRefRegex = /assets\/([A-Za-z0-9_\-]+\.js)/g;
  let m;
  while ((m = jsRefRegex.exec(finalHtml)) !== null) referenced.add(m[1]);
  const allJs = readdirSync("assets").filter(f => f.endsWith(".js"));
  const toDelete = allJs.filter(f => !referenced.has(f));
  for (const f of toDelete) {
    unlinkSync(`assets/${f}`);
    console.log(`🗑  stale bundle 제거: ${f}`);
  }
  if (toDelete.length === 0) console.log("✅ stale bundle 없음");
}

// ─────────────────────────────────────────────
// Postbuild drift guard: bundled JS must have canonical URL only
// ─────────────────────────────────────────────
const assetsDir = "assets";
const jsFiles = readdirSync(assetsDir).filter(f => f.endsWith(".js"));
let driftFound = false;
for (const f of jsFiles) {
  const src = readFileSync(join(assetsDir, f), "utf8");
  for (const bad of FORBIDDEN_WORKER_URLS) {
    if (src.includes(bad)) {
      console.error(`❌ drift-guard (post): ${f} 에 금지된 URL 잔존 — ${bad}`);
      driftFound = true;
    }
  }
  if (!src.includes(CANONICAL_WORKER_URL)) {
    // Non-entry chunks may not reference the URL at all — only warn if no JS file has it
  }
}
if (driftFound) {
  console.error(`❌ drift-guard (post): 빌드 결과에서 drift 감지됨, 배포 금지`);
  process.exit(1);
}
const anyHasCanonical = jsFiles.some(f => readFileSync(join(assetsDir, f), "utf8").includes(CANONICAL_WORKER_URL));
if (!anyHasCanonical) {
  console.error(`❌ drift-guard (post): 빌드 결과 어떤 JS 에도 canonical workerUrl 이 없습니다`);
  process.exit(1);
}
console.log(`✅ drift-guard (post): 번들 ${jsFiles.length}개 검사 완료, drift 없음`);
