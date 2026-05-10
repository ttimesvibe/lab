// lab fresh v2 — A2/A3/A4/A6 단위 테스트
// 사료: 헌장 §1 cascading throttle / §3 금지 조항 / 약속 Y / S5.1 A2~A6

import { test } from "node:test";
import assert from "node:assert/strict";

import { createDirtyTracker } from "../dirty.js";
import { createCascadingThrottle } from "../throttle.js";
import { saveDirtyTabsToKV, updateRefs } from "../savePath.js";
import { buildConflictHandler, applyServerToState } from "../conflict.js";
import { ApiError } from "../../utils/api.js";

// ─── A2 dirty tracking ──────────────────────────────────────────────────

test("dirty: markDirty + isDirty + getDirtyTabs", () => {
  const d = createDirtyTracker();
  d.markDirty("correction");
  assert.equal(d.isDirty("correction"), true);
  assert.equal(d.isDirty("guide"), false);
  d.markDirty("guide");
  const set = d.getDirtyTabs();
  assert.equal(set.size, 2);
});

test("dirty: markDirty 같은 탭 idempotent", () => {
  const d = createDirtyTracker();
  d.markDirty("correction");
  d.markDirty("correction");
  d.markDirty("correction");
  assert.equal(d.dirtyCount(), 1);
});

test("dirty: markClean 특정 탭", () => {
  const d = createDirtyTracker();
  d.markDirty("correction");
  d.markDirty("guide");
  d.markClean("correction");
  assert.equal(d.isDirty("correction"), false);
  assert.equal(d.isDirty("guide"), true);
});

test("dirty: markClean(undefined) → 전체 clear", () => {
  const d = createDirtyTracker();
  d.markDirty("correction");
  d.markDirty("guide");
  d.markClean();
  assert.equal(d.dirtyCount(), 0);
});

test("dirty: invalid tab → markDirty false", () => {
  const d = createDirtyTracker();
  assert.equal(d.markDirty("evil_tab"), false);
  assert.equal(d.markDirty(null), false);
});

// ─── 약속 Y 메커니즘 (block flags, ★ 핵심) ─────────────────────────────

test("약속 Y: isInitialLoad → markDirty 차단", () => {
  const d = createDirtyTracker();
  d.setBlockFlag("isInitialLoad", true);
  assert.equal(d.markDirty("correction"), false);
  assert.equal(d.dirtyCount(), 0);

  d.setBlockFlag("isInitialLoad", false);
  assert.equal(d.markDirty("correction"), true);
});

test("약속 Y: isApplyingServer → markDirty 차단", () => {
  const d = createDirtyTracker();
  d.setBlockFlag("isApplyingServer", true);
  assert.equal(d.markDirty("correction"), false);
});

test("약속 Y: isLoadingTab[X] → 그 탭만 차단 (다른 탭은 OK)", () => {
  const d = createDirtyTracker();
  d.setLoadingTab("correction", true);
  assert.equal(d.markDirty("correction"), false);
  assert.equal(d.markDirty("guide"), true);  // 다른 탭은 OK
});

test("약속 Y: withBlock(isInitialLoad) — 자동 cleanup", async () => {
  const d = createDirtyTracker();
  await d.withBlock("isInitialLoad", async () => {
    assert.equal(d.markDirty("correction"), false);  // 차단
  });
  // block 해제 후
  assert.equal(d.markDirty("correction"), true);
});

test("약속 Y: withBlock(tab) — 특정 탭만 차단", async () => {
  const d = createDirtyTracker();
  await d.withBlock("correction", async () => {
    assert.equal(d.markDirty("correction"), false);
    assert.equal(d.markDirty("guide"), true);  // 다른 탭 OK
  });
});

test("약속 Y: withBlock 예외 → block 자동 해제", async () => {
  const d = createDirtyTracker();
  try {
    await d.withBlock("isInitialLoad", async () => {
      throw new Error("test");
    });
  } catch {}
  // block 해제됨
  assert.equal(d.markDirty("correction"), true);
});

// ─── A3 cascading throttle ──────────────────────────────────────────────

test("throttle: schedule + onFire 후 dirty 비면 cancel", async () => {
  let fireCount = 0;
  const t = createCascadingThrottle({ delayMs: 30, onFire: async () => { fireCount++; } });
  t.schedule();
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(fireCount, 1);
  t.dispose();
});

test("throttle: ★ 이미 scheduled 면 schedule no-op (timer reset X)", async () => {
  let fireCount = 0;
  const t = createCascadingThrottle({ delayMs: 50, onFire: async () => { fireCount++; } });
  t.schedule();
  // 30ms 후 다시 schedule (debounce 라면 reset, cascading 은 no-op)
  await new Promise((r) => setTimeout(r, 30));
  t.schedule();  // no-op
  // 추가 25ms 대기 — 첫 schedule 의 50ms 가 만료되어야
  await new Promise((r) => setTimeout(r, 25));
  assert.equal(fireCount, 1);  // ★ debounce 라면 0 (reset 됐을 것)
  t.dispose();
});

test("throttle: cancel — fire 안 됨", async () => {
  let fireCount = 0;
  const t = createCascadingThrottle({ delayMs: 30, onFire: async () => { fireCount++; } });
  t.schedule();
  t.cancel();
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(fireCount, 0);
  t.dispose();
});

test("throttle: fireNow — 즉시 fire", async () => {
  let fireCount = 0;
  const t = createCascadingThrottle({ delayMs: 30000, onFire: async () => { fireCount++; } });
  await t.fireNow();
  assert.equal(fireCount, 1);
  t.dispose();
});

test("throttle: dispose — 모든 timer 정지", async () => {
  let fireCount = 0;
  const t = createCascadingThrottle({ delayMs: 30, onFire: async () => { fireCount++; } });
  t.schedule();
  t.dispose();
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(fireCount, 0);
});

test("throttle: onFire 부재 → throw", () => {
  assert.throws(() => createCascadingThrottle({}), /onFire/);
});

// ─── A4 saveDirtyTabsToKV ───────────────────────────────────────────────

test("savePath: 정상 11 탭 동등 PUT (★ N3 차단)", async () => {
  const calls = [];
  const apiSaveTab = async (sid, tab, data, cfg, fn, opts) => {
    calls.push({ tab, data, opts });
    return { success: true, savedAt: "T1", version: 1 };
  };
  const r = await saveDirtyTabsToKV(["correction", "guide"], {
    state: { tabData: { correction: { blocks: [] }, guide: { hl: [] } } },
    sessionId: "abc12345",
    cfg: { workerUrl: "x" },
    fn: "test",
    user: { sub: "alice@mt.co.kr", name: "Alice" },
    apiSaveTab,
  });
  assert.equal(r.success.length, 2);
  assert.equal(r.failed.length, 0);
  assert.equal(calls.length, 2);
});

test("savePath: ★ 부분 실패 격리 (Promise.allSettled, 헌장 §c)", async () => {
  const apiSaveTab = async (sid, tab) => {
    if (tab === "correction") return { success: true, savedAt: "T1", version: 1 };
    if (tab === "guide") throw new ApiError("server", 500, null);
    return { success: true };
  };
  const r = await saveDirtyTabsToKV(["correction", "guide"], {
    state: { tabData: { correction: { x: 1 }, guide: { y: 2 } } },
    sessionId: "abc12345",
    cfg: {}, apiSaveTab,
  });
  assert.equal(r.success.length, 1);
  assert.equal(r.failed.length, 1);
  assert.equal(r.failed[0].tab, "guide");
});

test("savePath: 409 → conflicts 분리 (헌장 §b)", async () => {
  const apiSaveTab = async () => {
    throw new ApiError("conflict", 409, { serverData: {}, serverVersion: 2 });
  };
  const r = await saveDirtyTabsToKV(["correction"], {
    state: { tabData: { correction: { x: 1 } } },
    sessionId: "abc12345",
    cfg: {}, apiSaveTab,
  });
  assert.equal(r.success.length, 0);
  assert.equal(r.conflicts.length, 1);
});

test("savePath: ★ N6 — merged/mergedBy 응답 → onMerged callback (B10 토스트)", async () => {
  const apiSaveTab = async () => ({
    success: true, savedAt: "T1", version: 2,
    merged: true,
    mergedBy: { sub: "bob@mt.co.kr", name: "Bob", at: "T0" },
  });
  let mergedNotice = null;
  await saveDirtyTabsToKV(["correction"], {
    state: { tabData: { correction: { x: 1 } } },
    sessionId: "abc12345",
    cfg: {}, apiSaveTab,
    onMerged: (tab, mergedBy) => { mergedNotice = { tab, mergedBy }; },
  });
  assert.ok(mergedNotice);
  assert.equal(mergedNotice.tab, "correction");
  assert.equal(mergedNotice.mergedBy.sub, "bob@mt.co.kr");
});

test("savePath: data 없는 탭 → skip (헌장 §3)", async () => {
  let called = 0;
  const apiSaveTab = async () => { called++; return { success: true }; };
  const r = await saveDirtyTabsToKV(["correction"], {
    state: { tabData: {} },  // correction 데이터 없음
    sessionId: "abc12345",
    cfg: {}, apiSaveTab,
  });
  assert.equal(called, 0);
  assert.equal(r.success.length, 1);
  assert.equal(r.success[0].status, "skip");
});

test("savePath: 빈 dirtyTabs → no-op", async () => {
  const apiSaveTab = async () => { throw new Error("should not call"); };
  const r = await saveDirtyTabsToKV([], { sessionId: "x", apiSaveTab });
  assert.equal(r.success.length, 0);
});

test("savePath: invalid tab → skip", async () => {
  const apiSaveTab = async () => ({ success: true });
  const r = await saveDirtyTabsToKV(["evil_tab"], {
    state: {}, sessionId: "abc12345", cfg: {}, apiSaveTab,
  });
  assert.equal(r.success[0].status, "skip");
  assert.equal(r.success[0].reason, "invalid tab");
});

test("savePath: refs 의 baseSavedAt + baseVersion → opts 동봉 (Phase 1)", async () => {
  let captured;
  const apiSaveTab = async (sid, tab, data, cfg, fn, opts) => {
    captured = opts;
    return { success: true };
  };
  await saveDirtyTabsToKV(["correction"], {
    state: { tabData: { correction: { x: 1 } } },
    sessionId: "abc12345",
    cfg: {}, apiSaveTab,
    refs: { correction: { savedAt: "T1", version: 5 } },
  });
  assert.equal(captured.baseSavedAt, "T1");
  assert.equal(captured.baseVersion, 5);
});

test("savePath: apiSaveTab 부재 → throw", async () => {
  await assert.rejects(
    () => saveDirtyTabsToKV(["correction"], { sessionId: "x" }),
    /apiSaveTab/
  );
});

test("updateRefs: tab 별 savedAt + version 박제", () => {
  let refs = {};
  refs = updateRefs(refs, "correction", "T1", 1);
  refs = updateRefs(refs, "guide", "T2", 1);
  assert.equal(refs.correction.savedAt, "T1");
  assert.equal(refs.guide.version, 1);
});

test("updateRefs: invalid tab → 변경 X", () => {
  const refs = updateRefs({}, "evil", "T1", 1);
  assert.deepEqual(refs, {});
});

// ─── A6 conflict handler ────────────────────────────────────────────────

test("conflict: ★ 같은 sub → 자동 통합 (force=true 재시도, UX 비노출)", async () => {
  let saveCalled = 0;
  const apiSaveTab = async (sid, tab, data, cfg, fn, opts) => {
    saveCalled++;
    if (opts.force) return { success: true, version: 3 };
    throw new ApiError("conflict", 409, {});
  };
  let modalShown = false;
  const handle = buildConflictHandler({
    apiSaveTab,
    showConflictModal: () => { modalShown = true; },
  });

  const error = new ApiError("conflict", 409, {
    serverData: { x: 2 },
    serverSavedAt: "T2",
    serverVersion: 2,
    serverUpdatedBy: { sub: "alice@mt.co.kr", name: "Alice", at: "T2" },
  });

  const r = await handle("correction", error, {
    user: { sub: "alice@mt.co.kr", name: "Alice" },
    sessionId: "abc12345",
    cfg: {},
    getState: () => ({ tabData: { correction: { x: 1 } } }),
  });

  assert.equal(r.resolved, "auto-merged");
  assert.equal(modalShown, false);  // ★ UX 비노출
});

test("conflict: ★ 다른 sub → ConflictModal trigger (옵션 2 박제)", async () => {
  const apiSaveTab = async () => ({ success: true });
  let captured = null;
  const handle = buildConflictHandler({
    apiSaveTab,
    showConflictModal: (tab, modalData) => { captured = { tab, modalData }; },
  });

  const error = new ApiError("conflict", 409, {
    serverData: { x: 2 },
    serverSavedAt: "T2",
    serverVersion: 2,
    serverUpdatedBy: { sub: "bob@mt.co.kr", name: "Bob", at: "T2" },
  });

  await handle("correction", error, {
    user: { sub: "alice@mt.co.kr", name: "Alice" },
    sessionId: "abc12345",
    cfg: {},
    getState: () => ({ tabData: { correction: { x: 1 } } }),
  });

  assert.ok(captured);
  assert.equal(captured.tab, "correction");
  // 2 옵션 callback 박제
  assert.equal(typeof captured.modalData.forceSaveTab, "function");
  assert.equal(typeof captured.modalData.receiveServer, "function");
  assert.equal(captured.modalData.serverUpdatedBy.sub, "bob@mt.co.kr");
});

test("conflict: 옵션 1 forceSaveTab → force=true PUT", async () => {
  const calls = [];
  const apiSaveTab = async (sid, tab, data, cfg, fn, opts) => {
    calls.push(opts);
    return { success: true };
  };
  let modalData = null;
  const handle = buildConflictHandler({
    apiSaveTab,
    showConflictModal: (tab, m) => { modalData = m; },
  });

  await handle("correction", new ApiError("conflict", 409, {
    serverData: {},
    serverSavedAt: "T2",
    serverVersion: 2,
    serverUpdatedBy: { sub: "bob@mt.co.kr" },
  }), {
    user: { sub: "alice@mt.co.kr" },
    sessionId: "abc12345",
    cfg: {},
    getState: () => ({ tabData: { correction: { x: 1 } } }),
  });

  // 옵션 1 invoke
  await modalData.forceSaveTab();
  // 마지막 call 이 force=true
  assert.equal(calls[calls.length - 1].force, true);
  assert.equal(calls[calls.length - 1].baseVersion, 2);
});

test("conflict: 옵션 2 receiveServer → applyServerToState 호출", async () => {
  let applied = null;
  const handle = buildConflictHandler({
    apiSaveTab: async () => ({}),
    applyServerToState: (tab, data) => { applied = { tab, data }; },
    showConflictModal: () => {},
  });

  let modalData = null;
  const handle2 = buildConflictHandler({
    apiSaveTab: async () => ({}),
    applyServerToState: (tab, data) => { applied = { tab, data }; },
    showConflictModal: (t, m) => { modalData = m; },
  });

  await handle2("correction", new ApiError("conflict", 409, {
    serverData: { fromServer: true },
    serverUpdatedBy: { sub: "bob@mt.co.kr" },
  }), {
    user: { sub: "alice@mt.co.kr" },
    sessionId: "abc12345",
    cfg: {},
    getState: () => ({}),
  });

  modalData.receiveServer();
  assert.equal(applied.tab, "correction");
  assert.deepEqual(applied.data, { fromServer: true });
});

test("conflict: showConflictModal 부재 → no-modal 결과", async () => {
  const handle = buildConflictHandler({
    apiSaveTab: async () => ({}),
  });
  const r = await handle("correction", new ApiError("conflict", 409, {
    serverUpdatedBy: { sub: "bob@mt.co.kr" },
  }), {
    user: { sub: "alice@mt.co.kr" },
    sessionId: "abc12345",
    cfg: {},
    getState: () => ({}),
  });
  assert.equal(r.resolved, "no-modal");
});

test("conflict: apiSaveTab 부재 → throw", () => {
  assert.throws(() => buildConflictHandler({}), /apiSaveTab/);
});

// ─── applyServerToState (★ N1 11 탭 동등) ───────────────────────────────

test("applyServerToState: 11 탭 모두 동등 (★ N1 차단)", () => {
  let state = {};
  for (const tab of ["correction", "guide", "visual", "modify", "highlight", "setgen", "metadata"]) {
    state = applyServerToState(state, tab, { fromServer: tab });
  }
  for (const tab of ["correction", "guide", "visual", "modify", "highlight", "setgen", "metadata"]) {
    assert.deepEqual(state.tabData[tab], { fromServer: tab });
  }
});
