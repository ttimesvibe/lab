// lab fresh v2 — A7 enterTab + A8 polling 단위 테스트
// 사료: 헌장 약속 X / 약속 Y / S5.1 A7~A8 / D12-1~6

import { test } from "node:test";
import assert from "node:assert/strict";

import { createDirtyTracker } from "../dirty.js";
import { buildEnterTabHandler, buildBootstrap } from "../enterTab.js";
import { createPolling } from "../polling.js";

// ─── A7 enterTab ────────────────────────────────────────────────────────

test("enterTab: dirty=false → fetch (헌장 약속 X)", async () => {
  let fetchCalled = 0;
  const apiLoadTab = async (sid, tab, cfg) => {
    fetchCalled++;
    return { success: true, data: { savedAt: "T1", version: 1, blocks: [] } };
  };
  const dirty = createDirtyTracker();
  const states = {};
  const refs = {};
  const enterTab = buildEnterTabHandler({
    dirty, apiLoadTab,
    applyState: (tab, data) => { states[tab] = data; },
    setRefs: (tab, savedAt, version) => { refs[tab] = { savedAt, version }; },
  });
  const r = await enterTab("correction", { sessionId: "abc12345", cfg: {} });
  assert.equal(fetchCalled, 1);
  assert.ok(r.fetched);
  assert.equal(refs.correction.savedAt, "T1");
});

test("enterTab: ★ dirty=true → fetch X (헌장 약속 X)", async () => {
  let fetchCalled = 0;
  const apiLoadTab = async () => { fetchCalled++; return { data: {} }; };
  const dirty = createDirtyTracker();
  dirty.markDirty("correction");
  const enterTab = buildEnterTabHandler({ dirty, apiLoadTab });
  const r = await enterTab("correction", { sessionId: "abc12345", cfg: {} });
  assert.equal(fetchCalled, 0);
  assert.equal(r.skipped, true);
  assert.equal(r.reason, "dirty (state is fresher)");
});

test("enterTab: ★ 약속 Y — fetch 동안 dirty 차단 (block flag)", async () => {
  let dirtyCheckedDuringFetch = null;
  const dirty = createDirtyTracker();
  const apiLoadTab = async () => {
    // fetch 중에 markDirty 시도
    dirtyCheckedDuringFetch = dirty.markDirty("correction");  // 차단되어 false
    return { data: { savedAt: "T1", version: 1 } };
  };
  const enterTab = buildEnterTabHandler({ dirty, apiLoadTab });
  await enterTab("correction", { sessionId: "abc12345", cfg: {} });
  assert.equal(dirtyCheckedDuringFetch, false);  // ★ 약속 Y 차단
  // fetch 후 block 자동 해제
  assert.equal(dirty.markDirty("correction"), true);
});

test("enterTab: 404 → fetched=null (정상)", async () => {
  const apiLoadTab = async () => null;  // 404
  const dirty = createDirtyTracker();
  const enterTab = buildEnterTabHandler({ dirty, apiLoadTab });
  const r = await enterTab("correction", { sessionId: "abc12345", cfg: {} });
  assert.equal(r.fetched, null);
});

test("enterTab: invalid tab → skip", async () => {
  const dirty = createDirtyTracker();
  const enterTab = buildEnterTabHandler({ dirty, apiLoadTab: async () => null });
  const r = await enterTab("evil_tab", { sessionId: "abc12345", cfg: {} });
  assert.equal(r.skipped, true);
});

test("enterTab: sessionId 부재 → skip", async () => {
  const dirty = createDirtyTracker();
  const enterTab = buildEnterTabHandler({ dirty, apiLoadTab: async () => null });
  const r = await enterTab("correction", {});
  assert.equal(r.skipped, true);
});

test("enterTab: fetch 실패 → error 반환 (block 자동 해제)", async () => {
  const dirty = createDirtyTracker();
  const apiLoadTab = async () => { throw new Error("network"); };
  const enterTab = buildEnterTabHandler({ dirty, apiLoadTab });
  const r = await enterTab("correction", { sessionId: "abc12345", cfg: {} });
  assert.ok(r.error);
  // block 자동 해제 검증
  assert.equal(dirty.markDirty("correction"), true);
});

test("enterTab: dirty inject 부재 → throw", () => {
  assert.throws(
    () => buildEnterTabHandler({ apiLoadTab: async () => null }),
    /dirty.*inject/
  );
});

test("enterTab: apiLoadTab inject 부재 → throw", () => {
  const dirty = createDirtyTracker();
  assert.throws(
    () => buildEnterTabHandler({ dirty }),
    /apiLoadTab/
  );
});

test("buildBootstrap: default 탭 진입 (★ Lazy 마운트)", async () => {
  let fetched = null;
  const apiLoadTab = async (sid, tab) => ({ data: { savedAt: "T1", version: 1, tab } });
  const dirty = createDirtyTracker();
  const bootstrap = buildBootstrap({
    dirty, apiLoadTab,
    applyState: (tab, data) => { fetched = { tab, data }; },
  });
  await bootstrap("correction", { sessionId: "abc12345", cfg: {} });
  assert.equal(fetched.tab, "correction");
});

// ─── A8 polling ─────────────────────────────────────────────────────────

test("polling: start → 즉시 1회 tick", async () => {
  let count = 0;
  const polling = createPolling({
    sessionId: "abc12345",
    cfg: {},
    getUser: () => ({ sub: "alice@mt.co.kr" }),
    getCurrentTab: () => "correction",
    apiHeartbeat: async () => { count++; return { active: [] }; },
  });
  polling.start();
  await new Promise((r) => setTimeout(r, 30));
  assert.ok(count >= 1);
  polling.stop();
});

test("polling: heartbeat 응답에 active list 동봉 → onActiveUsers callback (M11)", async () => {
  let captured = null;
  const polling = createPolling({
    sessionId: "abc12345",
    cfg: {},
    getUser: () => ({ sub: "alice@mt.co.kr" }),
    getCurrentTab: () => "correction",
    apiHeartbeat: async () => ({ active: [{ sub: "bob@mt.co.kr", tabs: ["guide"] }] }),
    onActiveUsers: (users) => { captured = users; },
  });
  await polling.tickOnce();
  assert.ok(captured);
  assert.equal(captured[0].sub, "bob@mt.co.kr");
});

test("polling: 401 → 즉시 stop + on401 callback", async () => {
  let on401Called = false;
  const polling = createPolling({
    sessionId: "abc12345",
    cfg: {},
    getUser: () => ({ sub: "alice@mt.co.kr" }),
    getCurrentTab: () => "correction",
    apiHeartbeat: async () => {
      const e = new Error("expired");
      e.status = 401;
      throw e;
    },
    on401: () => { on401Called = true; },
  });
  await polling.tickOnce();
  assert.equal(on401Called, true);
  assert.equal(polling.isStopped(), true);
});

test("polling: ★ 다른 사용자 stages 변경 → onOtherUserToast", async () => {
  let captured = null;
  const polling = createPolling({
    sessionId: "abc12345",
    cfg: {},
    getUser: () => ({ sub: "alice@mt.co.kr" }),
    getCurrentTab: () => "correction",
    getRefs: () => ({ correction: { savedAt: "T1", version: 1 } }),
    apiHeartbeat: async () => ({ active: [] }),
    apiLoadMeta: async () => ({
      meta: {
        stages: {
          correction: {
            updatedAt: "T2",  // T1 보다 새로움
            updatedBy: { sub: "bob@mt.co.kr", name: "Bob" },
          },
        },
      },
    }),
    onOtherUserToast: (info) => { captured = info; },
  });
  await polling.tickOnce();
  assert.ok(captured);
  assert.equal(captured.tab, "correction");
  assert.equal(captured.sub, "bob@mt.co.kr");
});

test("polling: ★ 자기 자신 변경 → 토스트 X", async () => {
  let toastCount = 0;
  const polling = createPolling({
    sessionId: "abc12345",
    cfg: {},
    getUser: () => ({ sub: "alice@mt.co.kr" }),
    getCurrentTab: () => "correction",
    getRefs: () => ({ correction: { savedAt: "T1" } }),
    apiHeartbeat: async () => ({ active: [] }),
    apiLoadMeta: async () => ({
      meta: {
        stages: {
          correction: {
            updatedAt: "T2",
            updatedBy: { sub: "alice@mt.co.kr", name: "Alice" },  // 자기 자신
          },
        },
      },
    }),
    onOtherUserToast: () => { toastCount++; },
  });
  await polling.tickOnce();
  assert.equal(toastCount, 0);
});

test("polling: ★ 5분 debounce per user (D12-5)", async () => {
  let toastCount = 0;
  const polling = createPolling({
    sessionId: "abc12345",
    cfg: {},
    getUser: () => ({ sub: "alice@mt.co.kr" }),
    getCurrentTab: () => "correction",
    getRefs: () => ({ correction: { savedAt: "T1" } }),
    apiHeartbeat: async () => ({ active: [] }),
    apiLoadMeta: async () => ({
      meta: {
        stages: {
          correction: {
            updatedAt: "T2",
            updatedBy: { sub: "bob@mt.co.kr", name: "Bob" },
          },
        },
      },
    }),
    onOtherUserToast: () => { toastCount++; },
  });
  // 3 회 연속 tick — debounce 로 1 회만 토스트
  await polling.tickOnce();
  await polling.tickOnce();
  await polling.tickOnce();
  assert.equal(toastCount, 1);
});

test("polling: refs 의 savedAt 이전 → 자기가 본 데이터 → 토스트 X", async () => {
  let toastCount = 0;
  const polling = createPolling({
    sessionId: "abc12345",
    cfg: {},
    getUser: () => ({ sub: "alice@mt.co.kr" }),
    getCurrentTab: () => "correction",
    getRefs: () => ({ correction: { savedAt: "T2" } }),  // 이미 T2 봤음
    apiHeartbeat: async () => ({ active: [] }),
    apiLoadMeta: async () => ({
      meta: {
        stages: {
          correction: {
            updatedAt: "T2",  // 같은 시각
            updatedBy: { sub: "bob@mt.co.kr", name: "Bob" },
          },
        },
      },
    }),
    onOtherUserToast: () => { toastCount++; },
  });
  await polling.tickOnce();
  assert.equal(toastCount, 0);
});

test("polling: leave → apiLeave 호출 (sendBeacon)", () => {
  let leaveCalled = null;
  const polling = createPolling({
    sessionId: "abc12345",
    cfg: { workerUrl: "x" },
    getUser: () => ({ sub: "alice@mt.co.kr" }),
    apiHeartbeat: async () => ({}),
    apiLeave: (sid, cfg, user) => {
      leaveCalled = { sid, cfg, user };
      return true;
    },
  });
  polling.leave();
  assert.equal(leaveCalled.sid, "abc12345");
  assert.equal(leaveCalled.user.sub, "alice@mt.co.kr");
});

test("polling: leave — user 부재 → false", () => {
  const polling = createPolling({
    sessionId: "abc12345",
    cfg: {},
    getUser: () => null,
    apiHeartbeat: async () => ({}),
    apiLeave: () => true,
  });
  assert.equal(polling.leave(), false);
});

test("polling: stop 후 tick 무시", async () => {
  let count = 0;
  const polling = createPolling({
    sessionId: "abc12345",
    cfg: {},
    getUser: () => ({ sub: "x" }),
    apiHeartbeat: async () => { count++; return {}; },
  });
  polling.stop();
  await polling.tickOnce();
  assert.equal(count, 0);
});

test("polling: sessionId 부재 → throw", () => {
  assert.throws(
    () => createPolling({ apiHeartbeat: async () => ({}) }),
    /sessionId/
  );
});

test("polling: apiHeartbeat 부재 → throw", () => {
  assert.throws(
    () => createPolling({ sessionId: "abc12345" }),
    /apiHeartbeat/
  );
});
