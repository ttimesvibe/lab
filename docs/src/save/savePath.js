// lab fresh v2 — A4 Save Path (자동/수동 통일, ★ 헌장 §a/§b/§c)
// 사료: editor/ops/lab-v2-fresh-2026-05-09.md
//   - 헌장 약속 핵심:
//       (a) 정확성: dirty 인 모든 탭 모든 변경분 빠짐없이 PUT
//       (b) 비겹침: baseSavedAt mismatch → 충돌 처리 (자동/수동 동일 PUT 경로)
//       (c) 부분 실패 격리: 한 탭 conflict/실패가 다른 탭 PUT 막지 않음
//   - 헌장 §3 금지: dirty=false 인 탭 PUT 절대 X
//   - 헌장 §5: 11 탭 동등 (SAVE_DISPATCH 사용)
//   - S5.1 A4: Save Path 단일 PUT 경로
//   - S1.11 N6: 응답 merged/mergedBy 처리 (B10 토스트)
//
// 책임:
//   - saveDirtyTabsToKV(dirtyTabs, deps) — 11 탭 dispatch + Promise.allSettled
//   - 자동 (throttle fire) ↔ 수동 (저장 버튼) 동일 코드 경로

import { SAVE_DISPATCH, readTabData } from "./dispatchers.js";
import { isValidTab } from "./tabs.js";
import { ApiError } from "../utils/api.js";

/**
 * Save dirty tabs to KV (★ A4 단일 PUT 경로).
 *
 * @param {Set<string>|string[]} dirtyTabs - tab keys to save
 * @param {object} deps
 *   - state (object) — { tabData: { [tab]: data } }
 *   - sessionId (string)
 *   - cfg (object) — { workerUrl }
 *   - fn (string) — 파일명 (메타 보강)
 *   - user (object|null) — { sub, name, role } (D6-8 meta.updatedBy)
 *   - refs (object) — { [tab]: { savedAt, version } } (★ Phase 1 baseSavedAt + version)
 *   - apiSaveTab (function) — inject (testability)
 *   - manual (boolean) — 수동 저장 (true) → retry X
 *   - force (boolean) — ConflictModal "강제저장" 시
 *   - onMerged (function) — ★ N6 토스트 callback (tab, mergedBy)
 *
 * Returns:
 *   { success: [...], failed: [...], conflicts: [...], merged: [...] }
 *
 * 호출자 (engine 또는 App.jsx):
 *   - throttle fire → manual=false
 *   - 수동 저장 버튼 → manual=true
 *   - ConflictModal 강제저장 → manual=true, force=true
 */
export async function saveDirtyTabsToKV(dirtyTabs, deps = {}) {
  const {
    state,
    sessionId,
    cfg,
    fn,
    user,
    refs = {},
    apiSaveTab,
    manual = false,
    force = false,
    onMerged,
  } = deps;

  if (typeof apiSaveTab !== "function") {
    throw new Error("saveDirtyTabsToKV: apiSaveTab inject required");
  }
  if (!sessionId) {
    throw new Error("saveDirtyTabsToKV: sessionId required");
  }

  const tabs = Array.isArray(dirtyTabs) ? dirtyTabs : [...(dirtyTabs || [])];
  if (tabs.length === 0) {
    return { success: [], failed: [], conflicts: [], merged: [] };
  }

  // 11 탭 dispatch — 모든 탭 동일 패턴 (★ N3 차단)
  const promises = tabs.map(async (tab) => {
    if (!isValidTab(tab)) {
      return { tab, status: "skip", reason: "invalid tab" };
    }
    const data = SAVE_DISPATCH[tab](state);
    // 헌장 §3: dirty 인데 data null → skip + warning
    if (data === null || data === undefined) {
      return { tab, status: "skip", reason: "no data" };
    }

    const opts = {
      baseSavedAt: refs[tab]?.savedAt,
      baseVersion: refs[tab]?.version,
      force,
      user,
      manual,
    };

    try {
      const r = await apiSaveTab(sessionId, tab, data, cfg, fn, opts);
      // ★ N6 영역: merged + mergedBy 응답 처리 (B10 토스트)
      const merged = !!r?.merged;
      return {
        tab,
        status: "success",
        response: r,
        savedAt: r?.savedAt,
        version: r?.version,
        merged,
        mergedBy: r?.mergedBy,
      };
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        return { tab, status: "conflict", error: e };
      }
      return { tab, status: "failed", error: e };
    }
  });

  // ★ Promise.allSettled — 부분 실패 격리 (헌장 §c)
  const settled = await Promise.allSettled(promises);

  const success = [];
  const failed = [];
  const conflicts = [];
  const merged = [];

  for (const s of settled) {
    if (s.status === "fulfilled") {
      const v = s.value;
      if (v.status === "success" || v.status === "skip") {
        success.push(v);
        if (v.merged && v.mergedBy) {
          merged.push({ tab: v.tab, mergedBy: v.mergedBy });
        }
      } else if (v.status === "conflict") {
        conflicts.push(v);
      } else {
        failed.push(v);
      }
    } else {
      // Promise reject (uncaught) — 방어
      failed.push({ tab: "?", status: "failed", error: s.reason });
    }
  }

  // ★ N6 토스트 dispatch
  if (typeof onMerged === "function") {
    for (const m of merged) onMerged(m.tab, m.mergedBy);
  }

  return { success, failed, conflicts, merged };
}

/**
 * Build refs from a snapshot of tabData responses.
 * 호출자가 각 PUT 응답 의 savedAt + version 박제 시 사용.
 */
export function updateRefs(refs, tab, savedAt, version) {
  if (!isValidTab(tab)) return refs;
  return { ...refs, [tab]: { savedAt, version } };
}
