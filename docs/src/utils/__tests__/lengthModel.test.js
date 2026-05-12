// lab fresh v2 — lengthModel 단위 테스트 (★ 회귀 + 분량 + 타임스탬프 변환)
// 사료: editor/docs/src/utils/lengthModel.js (prod 정합)

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  TRAINING_DATA, calcRegression, tsToSeconds, secondsToDisplay, calcDuration,
  splitChunks, chunkToText, chunkCtx,
} from "../lengthModel.js";

// ─── TRAINING_DATA ───────────────────────────────────────────────────────

test("TRAINING_DATA: 7건 학습 데이터 + 정합 검증", () => {
  assert.equal(TRAINING_DATA.length, 7);
  for (const d of TRAINING_DATA) {
    assert.equal(typeof d.chars, "number");
    assert.equal(typeof d.minutes, "number");
    assert.ok(d.chars > 0);
    assert.ok(d.minutes > 0);
  }
});

// ─── calcRegression (LOO MAE 3.9%) ──────────────────────────────────────

test("calcRegression: 15000자 → 분 단위 25분 안팎", () => {
  const r = calcRegression(15000);
  // 0.001210 × 15000 + 7.05 = 25.2분
  assert.ok(Math.abs(r.pointMin - 25.2) < 0.1);
  assert.equal(r.count, 7);
});

test("calcRegression: 95% CI = 1.96 × 1.19분 = ±2.33분", () => {
  const r = calcRegression(15000);
  const ci95Min = (r.highSec - r.pointSec) / 60;
  assert.ok(Math.abs(ci95Min - 1.96 * 1.19) < 0.01);
});

test("calcRegression: cleanChars 0 → 7.05분 (intercept)", () => {
  const r = calcRegression(0);
  assert.ok(Math.abs(r.pointMin - 7.05) < 0.01);
});

test("calcRegression: pointSec/lowSec/highSec 초 단위 정합", () => {
  const r = calcRegression(20000);
  assert.equal(Math.round(r.pointSec / 60), Math.round(r.pointMin));
  assert.ok(r.lowSec < r.pointSec);
  assert.ok(r.pointSec < r.highSec);
});

// ─── tsToSeconds ─────────────────────────────────────────────────────────

test("tsToSeconds: 빈/null → 0", () => {
  assert.equal(tsToSeconds(""), 0);
  assert.equal(tsToSeconds(null), 0);
  assert.equal(tsToSeconds(undefined), 0);
});

test("tsToSeconds: MM:SS 포맷", () => {
  assert.equal(tsToSeconds("00:00"), 0);
  assert.equal(tsToSeconds("01:30"), 90);
  assert.equal(tsToSeconds("12:34"), 12 * 60 + 34);
});

test("tsToSeconds: HH:MM:SS 포맷", () => {
  assert.equal(tsToSeconds("01:00:00"), 3600);
  assert.equal(tsToSeconds("01:23:45"), 3600 + 23 * 60 + 45);
});

// ─── secondsToDisplay ────────────────────────────────────────────────────

test("secondsToDisplay: 60초 미만 → 0:SS", () => {
  assert.equal(secondsToDisplay(0), "0:00");
  assert.equal(secondsToDisplay(45), "0:45");
});

test("secondsToDisplay: 60초 이상 1시간 미만 → M:SS", () => {
  assert.equal(secondsToDisplay(90), "1:30");
  assert.equal(secondsToDisplay(1500), "25:00");
});

test("secondsToDisplay: 1시간 이상 → H:MM:SS", () => {
  assert.equal(secondsToDisplay(3600), "1:00:00");
  assert.equal(secondsToDisplay(3665), "1:01:05");
});

test("secondsToDisplay: 반올림", () => {
  assert.equal(secondsToDisplay(89.6), "1:30");
  assert.equal(secondsToDisplay(89.4), "1:29");
});

// ─── calcDuration ────────────────────────────────────────────────────────

test("calcDuration: 빈 blocks → 0", () => {
  const r = calcDuration([], new Set());
  assert.equal(r.totalSeconds, 0);
  assert.equal(r.totalChars, 0);
});

test("calcDuration: 타임스탬프 기반 분량 + 삭제 분리", () => {
  const blocks = [
    { index: 0, speaker: "A", timestamp: "00:00", text: "안녕하세요" },     // 5자, 60초
    { index: 1, speaker: "A", timestamp: "01:00", text: "삭제 대상" },     // 5자, 30초 (삭제)
    { index: 2, speaker: "B", timestamp: "01:30", text: "끝" },          // 1자, 10초 (마지막은 +10)
  ];
  const r = calcDuration(blocks, new Set([1]));
  assert.equal(r.totalSeconds, 60 + 30 + 10);
  assert.equal(r.deletedSeconds, 30);
  assert.equal(r.keptSeconds, 60 + 10);
  assert.equal(r.totalChars, 11);
  assert.equal(r.deletedChars, 5);
  assert.equal(r.keptChars, 6);
});

test("calcDuration: deletedBlockIndices 가 Array 면 자동 Set 변환", () => {
  const blocks = [
    { index: 0, timestamp: "00:00", text: "abc" },
    { index: 1, timestamp: "00:10", text: "def" },
  ];
  const r = calcDuration(blocks, [0]);  // Array → Set 변환
  assert.equal(r.deletedChars, 3);
  assert.equal(r.keptChars, 3);
});

// ─── splitChunks (★ Phase 3b /correct chunked) ──────────────────────────

test("splitChunks: max 미만 → 1 청크", () => {
  const blocks = [
    { index: 0, text: "짧은 텍스트", speaker: "A" },
    { index: 1, text: "두번째", speaker: "A" },
  ];
  const chunks = splitChunks(blocks, 15000);
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0].length, 2);
});

test("splitChunks: max 초과 → 분할 + 2 블록 context overlap", () => {
  const blocks = [];
  for (let i = 0; i < 10; i++) {
    blocks.push({ index: i, text: "x".repeat(5000), speaker: "A", timestamp: `00:${i}` });
  }
  const chunks = splitChunks(blocks, 15000);
  assert.ok(chunks.length >= 2);
  // 두번째 청크 시작에 isContext=true 가 2개 있어야 (overlap)
  const contextInChunk2 = chunks[1].filter((b) => b.isContext);
  assert.equal(contextInChunk2.length, 2);
  // overlap 블록은 첫번째 청크의 마지막 2 블록
  const firstChunkLastTwo = chunks[0].slice(-2).map((b) => b.index);
  const ctxIndices = contextInChunk2.map((b) => b.index);
  assert.deepEqual(ctxIndices, firstChunkLastTwo);
});

test("chunkToText: isContext=false 블록만 라벨 포함 join", () => {
  const chunk = [
    { index: 5, text: "context", speaker: "A", timestamp: "00:50", isContext: true },
    { index: 6, text: "target1", speaker: "A", timestamp: "01:00" },
    { index: 7, text: "target2", speaker: "B", timestamp: "01:10" },
  ];
  const text = chunkToText(chunk);
  assert.ok(text.includes("[블록 6]"));
  assert.ok(text.includes("[블록 7]"));
  assert.ok(!text.includes("[블록 5]"));
  assert.ok(text.includes("target1"));
  assert.ok(!text.includes("context"));
});

test("chunkCtx: isContext=true 만 추출 (없으면 undefined)", () => {
  const chunk1 = [{ index: 0, text: "a", speaker: "A", timestamp: "00:00" }];
  assert.equal(chunkCtx(chunk1), undefined);

  const chunk2 = [
    { index: 5, text: "ctx1", speaker: "A", timestamp: "00:50", isContext: true },
    { index: 6, text: "ctx2", speaker: "A", timestamp: "00:55", isContext: true },
    { index: 7, text: "target", speaker: "B", timestamp: "01:00" },
  ];
  const ctx = chunkCtx(chunk2);
  assert.ok(ctx.includes("ctx1"));
  assert.ok(ctx.includes("ctx2"));
  assert.ok(!ctx.includes("target"));
});
