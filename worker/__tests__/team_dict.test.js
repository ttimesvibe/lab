// lab fresh v2 — team / dict 단위 테스트
import { test } from "node:test";
import assert from "node:assert/strict";
import { handleTeamMembers } from "../team.js";
import { handleDictGet, handleDictPost } from "../dict.js";

function makeKV(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    async get(key) { return map.has(key) ? map.get(key) : null; },
    async put(key, value, opts) { map.set(key, value); },
    async delete(key) { map.delete(key); },
    _map: map,
  };
}

const HEADERS = { "Content-Type": "application/json" };
const ALICE = { sub: "alice@mt.co.kr", name: "Alice", role: "editor" };

// ─── team ────────────────────────────────────────────────────────────────

test("handleTeamMembers: KV 캐시 반환", async () => {
  const SESSIONS = makeKV({
    team_members: JSON.stringify([
      { name: "Alice", email: "alice@mt.co.kr", role: "editor" },
    ]),
  });
  const r = await handleTeamMembers({ SESSIONS }, HEADERS, ALICE);
  const body = await r.json();
  assert.equal(body.success, true);
  assert.equal(body.members.length, 1);
});

test("handleTeamMembers: 캐시 부재 → 빈 배열", async () => {
  const SESSIONS = makeKV({});
  const r = await handleTeamMembers({ SESSIONS }, HEADERS, ALICE);
  const body = await r.json();
  assert.deepEqual(body.members, []);
});

test("handleTeamMembers: KV 부재 → 500", async () => {
  const r = await handleTeamMembers({}, HEADERS, ALICE);
  assert.equal(r.status, 500);
});

// ─── dict ────────────────────────────────────────────────────────────────

test("handleDictGet: 정상 조회", async () => {
  const SESSIONS = makeKV({
    shared_dict: JSON.stringify([{ term: "옐런", correction: "옐런" }]),
  });
  const r = await handleDictGet({ SESSIONS }, HEADERS, ALICE);
  const body = await r.json();
  assert.equal(body.dict.length, 1);
});

test("handleDictPost: 갱신 + sanitize", async () => {
  const SESSIONS = makeKV({});
  const r = await handleDictPost(
    { dict: [{ term: "GPT", correction: "GPT" }] },
    { SESSIONS }, HEADERS, ALICE
  );
  assert.equal(r.status, 200);
  const stored = JSON.parse(SESSIONS._map.get("shared_dict"));
  assert.equal(stored.length, 1);
});

test("handleDictPost: 인증 X → 400", async () => {
  const SESSIONS = makeKV({});
  const r = await handleDictPost({ dict: [] }, { SESSIONS }, HEADERS, null);
  assert.equal(r.status, 400);
});

test("handleDictPost: dict 배열 X → 400", async () => {
  const SESSIONS = makeKV({});
  const r = await handleDictPost({ dict: "not array" }, { SESSIONS }, HEADERS, ALICE);
  assert.equal(r.status, 400);
});
