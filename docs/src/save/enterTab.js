// lab fresh v2 — A7 Tab Entry Fetch (★ 약속 X freshness)
// 사료: editor/ops/lab-v2-fresh-2026-05-09.md
//   - 헌장 약속 X: 탭 진입 시 freshness
//       - dirty=false → KV fresh fetch (화면 = 0초 전 KV)
//       - dirty=true → fetch X (React state 가 더 최신)
//   - 헌장 §X 명시 거부:
//       - 폴링이 freshness 책임 X (폴링은 토스트만)
//       - 마운트 시 모든 탭 prefetch X (Lazy 마운트 = default 탭만)
//   - 약속 Y 메커니즘: fetch 동안 dirty 차단 (block flag)
//   - S5.1 A7
//
// 책임:
//   - enterTab(tab, ctx) — 탭 진입 시 dispatch
//   - 11 탭 dispatch 단일 패턴 (FETCH_DISPATCH 사용)
//   - block flag 자동 cleanup (withBlock)

import { FETCH_DISPATCH } from "./dispatchers.js";
import { isValidTab } from "./tabs.js";

/**
 * Build an enterTab handler with injected dependencies.
 *
 * @param {object} deps
 *   - dirty (DirtyTracker) — markDirty 차단용 block flag
 *   - apiLoadTab (function) — fetch 함수 (testability)
 *   - applyState (function|null) — fetch 후 React state 갱신
 *     signature: (tab, data) => void
 *   - setRefs (function|null) — fetch 후 lastLoadedAt + version 박제
 *     signature: (tab, savedAt, version) => void
 *
 * Returns:
 *   enterTab(tab, ctx) — async
 *     ctx: { sessionId, cfg }
 */
export function buildEnterTabHandler(deps = {}) {
  const { dirty, apiLoadTab, applyState, setRefs } = deps;

  if (!dirty || typeof dirty.isDirty !== "function") {
    throw new Error("buildEnterTabHandler: dirty (DirtyTracker) inject required");
  }
  if (typeof apiLoadTab !== "function") {
    throw new Error("buildEnterTabHandler: apiLoadTab inject required");
  }

  return async function enterTab(tab, ctx = {}) {
    if (!isValidTab(tab)) {
      return { skipped: true, reason: "invalid tab" };
    }

    // ★ 헌장 약속 X: dirty=true 면 fetch 안 함 (React state 가 더 최신)
    if (dirty.isDirty(tab)) {
      return { skipped: true, reason: "dirty (state is fresher)" };
    }

    const { sessionId, cfg } = ctx;
    if (!sessionId) {
      return { skipped: true, reason: "no sessionId" };
    }

    // ★ 약속 Y 메커니즘: fetch 동안 dirty 차단 (block flag)
    return await dirty.withBlock(tab, async () => {
      let raw;
      try {
        raw = await FETCH_DISPATCH[tab](sessionId, cfg, apiLoadTab);
      } catch (e) {
        return { error: e, reason: "fetch failed" };
      }

      // raw === null → 404 (정상, 데이터 없음 — 신규 탭)
      if (raw === null || raw === undefined) {
        return { fetched: null };
      }

      // raw 가 KV envelope (savedAt + version + updatedBy + schemaVersion + content)
      // 의 형식이라면, content 만 분리하여 React state 박제.
      // 단순화: raw 자체를 그대로 박제 (React state 가 envelope 다 받음 OK).
      if (typeof applyState === "function") {
        applyState(tab, raw);
      }
      if (typeof setRefs === "function" && raw.savedAt && raw.version != null) {
        setRefs(tab, raw.savedAt, raw.version);
      }

      return { fetched: raw, savedAt: raw.savedAt, version: raw.version };
    });
  };
}

/**
 * Convenience: build a default-tab bootstrap handler.
 * 앱 마운트 시 default 탭 진입 (★ Lazy — 다른 탭 prefetch X).
 */
export function buildBootstrap(deps) {
  const enterTab = buildEnterTabHandler(deps);
  return async function bootstrap(defaultTab, ctx) {
    return await enterTab(defaultTab, ctx);
  };
}
