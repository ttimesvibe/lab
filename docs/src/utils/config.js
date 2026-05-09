// lab fresh v2 — frontend config
// 사료: editor/ops/lab-v2-fresh-2026-05-09.md (S2'.5 te_cfg 격리 + S2.6 drift guard)

// ★ Canonical Worker URL (build drift guard 검증 대상)
// docs/build.js 의 CANONICAL_WORKER_URL 과 같은 commit 에서 함께 수정 의무.
// 양쪽 불일치 시 prebuild drift guard 가 빌드 차단.
const CANONICAL_WORKER_URL = "https://lab.ttimes.workers.dev";

export const DEFAULT_CONFIG = Object.freeze({
  workerUrl: CANONICAL_WORKER_URL,
  apiMode: "live",       // mock | live
  fillerWords: ["음", "어", "그", "막", "뭐", "이제"],
  chunkSize: 60,         // subtitle 어절 단위
});

// te_cfg localStorage 의 workerUrl 무시 (4/24 drift 사고 후속)
// → 사용자 설정에서 workerUrl 변경 불가, build 타임 박힌 canonical 강제
// → PROD/TEST/lab 같은 origin (ttimesvibe.github.io) 공유 영역의 KV 섞임 차단
export function loadConfig() {
  let stored = {};
  try {
    const raw = localStorage.getItem("te_cfg");
    if (raw) stored = JSON.parse(raw);
  } catch {
    stored = {};
  }
  return {
    ...DEFAULT_CONFIG,
    ...stored,
    workerUrl: DEFAULT_CONFIG.workerUrl,  // ★ te_cfg 의 workerUrl 무시 (격리 의무)
  };
}

export function saveConfig(cfg) {
  try {
    const { workerUrl, ...rest } = cfg;  // workerUrl 제외 (격리)
    localStorage.setItem("te_cfg", JSON.stringify(rest));
  } catch {
    // localStorage 가득 참 등 — silent
  }
}
