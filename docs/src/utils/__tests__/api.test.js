// lab fresh v2 — api.js 단위 테스트
// 사료: P0-06 retry / P0-08 404-500 분기 / 묶음 ⑫ Phase 1+2+3

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

// fetch mock
let fetchCalls = [];
let fetchResponses = [];

function mockFetchOnce(response) {
  fetchResponses.push(response);
}

globalThis.fetch = async (url, opts) => {
  fetchCalls.push({ url: String(url), opts });
  if (fetchResponses.length === 0) {
    throw new Error("No mock response queued");
  }
  const next = fetchResponses.shift();
  if (next instanceof Error) throw next;
  return next;
};

function makeResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

const {
  apiCall,
  ApiError,
  setToken,
  getToken,
  apiSaveTab,
  apiLoadTab,
  apiHeartbeat,
  apiActiveUsers,
  apiHealth,
  apiErrorMessage,
} = await import("../api.js");

const cfg = { workerUrl: "https://lab.ttimes.workers.dev" };

beforeEach(() => {
  fetchCalls = [];
  fetchResponses = [];
  setToken(null);
});

// ─── ApiError ────────────────────────────────────────────────────────────

test("ApiError: status + body 박제", () => {
  const e = new ApiError("conflict", 409, { x: 1 });
  assert.equal(e.status, 409);
  assert.deepEqual(e.body, { x: 1 });
});

// ─── apiCall ────────────────────────────────────────────────────────────

test("apiCall: 200 정상 응답", async () => {
  mockFetchOnce(makeResponse(200, { success: true, data: "ok" }));
  const r = await apiCall({ url: "https://x/health" });
  assert.deepEqual(r, { success: true, data: "ok" });
});

test("apiCall: 4xx → ApiError throw, retry X", async () => {
  mockFetchOnce(makeResponse(403, { error: "권한 없음" }));
  await assert.rejects(
    apiCall({ url: "https://x/save", method: "POST", body: {} }),
    (e) => e instanceof ApiError && e.status === 403
  );
  assert.equal(fetchCalls.length, 1);  // retry X
});

test("apiCall: 401 → ApiError throw, retry X", async () => {
  mockFetchOnce(makeResponse(401, { error: "expired" }));
  await assert.rejects(
    apiCall({ url: "https://x/save", method: "POST", body: {} }),
    (e) => e instanceof ApiError && e.status === 401
  );
});

test("apiCall: 5xx → retry 4 (1+3) → 최종 throw", async () => {
  for (let i = 0; i < 4; i++) mockFetchOnce(makeResponse(500, { error: "internal" }));
  await assert.rejects(
    apiCall({ url: "https://x/save", method: "POST", body: {} }),
    (e) => e instanceof ApiError && e.status === 500
  );
  assert.equal(fetchCalls.length, 4);  // 1 + 3 retry
});

test("apiCall: 5xx 후 200 → retry 후 성공", async () => {
  mockFetchOnce(makeResponse(503, { error: "down" }));
  mockFetchOnce(makeResponse(200, { success: true }));
  const r = await apiCall({ url: "https://x/save", method: "POST", body: {} });
  assert.equal(r.success, true);
  assert.equal(fetchCalls.length, 2);
});

test("apiCall: network error → retry", async () => {
  mockFetchOnce(new Error("Failed to fetch"));
  mockFetchOnce(makeResponse(200, { ok: 1 }));
  const r = await apiCall({ url: "https://x/save" });
  assert.deepEqual(r, { ok: 1 });
});

test("apiCall: retry=false → 단일 시도", async () => {
  mockFetchOnce(makeResponse(500, { error: "x" }));
  await assert.rejects(
    apiCall({ url: "https://x/h", retry: false }),
    (e) => e.status === 500
  );
  assert.equal(fetchCalls.length, 1);
});

test("apiCall: token 박제 시 Authorization Bearer 헤더", async () => {
  setToken("mytoken");
  mockFetchOnce(makeResponse(200, {}));
  await apiCall({ url: "https://x/sessions" });
  assert.equal(fetchCalls[0].opts.headers.Authorization, "Bearer mytoken");
});

test("apiCall: body 박제 시 Content-Type + JSON.stringify", async () => {
  mockFetchOnce(makeResponse(200, {}));
  await apiCall({ url: "https://x/save", method: "POST", body: { a: 1 } });
  assert.equal(fetchCalls[0].opts.headers["Content-Type"], "application/json");
  assert.equal(fetchCalls[0].opts.body, JSON.stringify({ a: 1 }));
});

// ─── apiLoadTab — ★ P0-08 (404 vs 5xx 구분) ─────────────────────────────

test("apiLoadTab: 200 → data", async () => {
  mockFetchOnce(makeResponse(200, { success: true, data: { x: 1 } }));
  const r = await apiLoadTab("abc12345", "correction", cfg);
  assert.deepEqual(r.data, { x: 1 });
});

test("apiLoadTab: 404 → null (정상, 데이터 없음)", async () => {
  mockFetchOnce(makeResponse(404, { error: "탭 데이터 없음" }));
  const r = await apiLoadTab("abc12345", "correction", cfg);
  assert.equal(r, null);
});

test("apiLoadTab: 5xx → throw (★ P0-08 — 404 와 구분)", async () => {
  for (let i = 0; i < 4; i++) mockFetchOnce(makeResponse(500, { error: "x" }));
  await assert.rejects(
    apiLoadTab("abc12345", "correction", cfg),
    (e) => e instanceof ApiError && e.status === 500
  );
});

// ─── apiSaveTab (Phase 1 — baseSavedAt + version + force + user) ────────

test("apiSaveTab: opts 동봉 (D6-8 user + Phase 1 baseSavedAt/Version)", async () => {
  mockFetchOnce(makeResponse(200, { success: true, version: 2 }));
  await apiSaveTab(
    "abc12345", "correction", { blocks: [] }, cfg, "test.docx",
    {
      baseSavedAt: "T1",
      baseVersion: 1,
      force: false,
      user: { sub: "alice@mt.co.kr", name: "Alice" },
    }
  );
  const body = JSON.parse(fetchCalls[0].opts.body);
  assert.equal(body.id, "abc12345");
  assert.equal(body.tab, "correction");
  assert.equal(body.baseSavedAt, "T1");
  assert.equal(body.baseVersion, 1);
  assert.equal(body.user.sub, "alice@mt.co.kr");
});

test("apiSaveTab: manual=true → retry X (즉시 모달)", async () => {
  mockFetchOnce(makeResponse(500, { error: "x" }));
  await assert.rejects(
    apiSaveTab("abc12345", "correction", {}, cfg, "x", { manual: true }),
    (e) => e instanceof ApiError
  );
  assert.equal(fetchCalls.length, 1);  // retry X
});

// ─── apiHeartbeat (Phase 3) ──────────────────────────────────────────────

test("apiHeartbeat: tab + user 동봉 + retry X", async () => {
  mockFetchOnce(makeResponse(200, { success: true, active: [] }));
  await apiHeartbeat("abc12345", cfg, { sub: "alice@mt.co.kr" }, "correction");
  const body = JSON.parse(fetchCalls[0].opts.body);
  assert.equal(body.tab, "correction");
});

test("apiHeartbeat: 5xx → retry X (다음 회차로 회복)", async () => {
  mockFetchOnce(makeResponse(500, {}));
  await assert.rejects(
    apiHeartbeat("abc12345", cfg, { sub: "x" }, "correction"),
    (e) => e instanceof ApiError
  );
  assert.equal(fetchCalls.length, 1);
});

test("apiActiveUsers: GET", async () => {
  mockFetchOnce(makeResponse(200, { success: true, active: [{ sub: "alice" }] }));
  const r = await apiActiveUsers("abc12345", cfg);
  assert.equal(r.active.length, 1);
});

// ─── apiErrorMessage (한글 변환) ─────────────────────────────────────────

test("apiErrorMessage: ApiError 의 body.error 한글 매핑", () => {
  const e = new ApiError("conflict", 409, { error: "409" });
  assert.ok(apiErrorMessage(e).includes("다른 편집자"));
});

test("apiErrorMessage: status code 만 → 한글 매핑", () => {
  const e = new ApiError("HTTP 503", 503, null);
  assert.ok(apiErrorMessage(e).includes("점검") || apiErrorMessage(e).includes("서버"));
});

test("apiErrorMessage: 일반 Error → translateError", () => {
  const r = apiErrorMessage(new Error("Failed to fetch"));
  assert.ok(r.includes("인터넷"));
});
