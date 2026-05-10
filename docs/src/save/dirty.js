// lab fresh v2 — A2 dirty tracking + 약속 Y block flags
// 사료: editor/ops/lab-v2-fresh-2026-05-09.md
//   - 헌장 §1 dirty 정의: 사용자 입력 → dirty=true / PUT 성공 → dirty=false / fetch+load → dirty 안 만듦
//   - 헌장 §3 금지: dirty=false 인 탭 어떤 경로로도 KV PUT X
//   - 약속 Y: fetch / 서버 받기 / 초기 load 는 dirty 차단 명시 메커니즘 (block flags)
//   - S5.1 A2: Dirty Tracking 단일 진실
//
// 책임:
//   - dirty Set (11 탭 dirty 추적)
//   - block flags (isInitialLoad / isLoadingTab[tab] / isApplyingServer)
//   - markDirty 호출 시 block flag 검사 (약속 Y) → 차단 시 dirty 안 만듦

import { isValidTab } from "./tabs.js";

/**
 * Create a dirty tracker.
 *
 * Returns an object with:
 *   - markDirty(tab) → true (added) / false (blocked or invalid)
 *   - markClean(tab?) → 특정 탭 또는 전체 clear
 *   - isDirty(tab?) → boolean
 *   - getDirtyTabs() → Set<string>
 *   - setBlockFlag(name, value) — name ∈ "isInitialLoad" | "isApplyingServer"
 *   - setLoadingTab(tab, value)
 *   - isBlocked() — 전역 block (initial load / applying server)
 *   - isTabBlocked(tab) — 전역 + tab loading
 *   - getBlockFlags() — snapshot
 */
export function createDirtyTracker() {
  const dirty = new Set();
  const blockFlags = {
    isInitialLoad: false,
    isLoadingTab: {},      // { tabId: true }
    isApplyingServer: false,
  };

  function isBlocked() {
    return blockFlags.isInitialLoad || blockFlags.isApplyingServer;
  }

  function isTabBlocked(tab) {
    if (isBlocked()) return true;
    return !!blockFlags.isLoadingTab[tab];
  }

  return {
    /**
     * Mark a tab dirty. Blocked by 약속 Y guards.
     * Returns true if added, false if blocked or invalid.
     */
    markDirty(tab) {
      if (!isValidTab(tab)) return false;
      if (isTabBlocked(tab)) return false;
      dirty.add(tab);
      return true;
    },

    /**
     * Mark a tab clean (PUT 성공 후) or all clean (tab undefined).
     */
    markClean(tab) {
      if (tab === undefined || tab === null) {
        dirty.clear();
      } else if (isValidTab(tab)) {
        dirty.delete(tab);
      }
    },

    /**
     * Check dirty status.
     */
    isDirty(tab) {
      if (tab === undefined || tab === null) return dirty.size > 0;
      return dirty.has(tab);
    },

    /**
     * Get a snapshot of dirty tabs.
     */
    getDirtyTabs() {
      return new Set(dirty);
    },

    /**
     * Get count.
     */
    dirtyCount() {
      return dirty.size;
    },

    // ─── Block flags (★ 약속 Y 메커니즘) ──────────────────────────────

    /**
     * Set a global block flag. name ∈ "isInitialLoad" | "isApplyingServer".
     */
    setBlockFlag(name, value) {
      if (name === "isInitialLoad" || name === "isApplyingServer") {
        blockFlags[name] = !!value;
      }
    },

    /**
     * Set the loading-tab flag for a specific tab.
     */
    setLoadingTab(tab, value) {
      if (!isValidTab(tab)) return;
      if (value) blockFlags.isLoadingTab[tab] = true;
      else delete blockFlags.isLoadingTab[tab];
    },

    isBlocked,
    isTabBlocked,

    /**
     * Get a snapshot of block flags (for testing/inspection).
     */
    getBlockFlags() {
      return {
        isInitialLoad: blockFlags.isInitialLoad,
        isApplyingServer: blockFlags.isApplyingServer,
        isLoadingTab: { ...blockFlags.isLoadingTab },
      };
    },

    /**
     * Run a function with a temporary block flag active.
     * Usage:
     *   await withBlock("isInitialLoad", async () => { await loadData(); });
     */
    async withBlock(flagName, fn) {
      if (flagName === "isInitialLoad" || flagName === "isApplyingServer") {
        blockFlags[flagName] = true;
        try {
          return await fn();
        } finally {
          blockFlags[flagName] = false;
        }
      } else {
        // tab name
        const tab = flagName;
        if (!isValidTab(tab)) return await fn();
        blockFlags.isLoadingTab[tab] = true;
        try {
          return await fn();
        } finally {
          delete blockFlags.isLoadingTab[tab];
        }
      }
    },
  };
}
