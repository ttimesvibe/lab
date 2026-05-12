// lab fresh v2 — 영상 길이 분량 예측 모델 (★ 실 UI Phase 3a 보강)
// 사료: editor/docs/src/utils/lengthModel.js (prod 정합 port)
//
// LINEAR REGRESSION MODEL (v2)
//   영상길이(분) = SLOPE × cleanText 글자수 + INTERCEPT
//   7건 학습 / LOO MAE 3.9% / R² = 0.949

export const TRAINING_DATA = Object.freeze([
  { name: "김창현1편", chars: 12255, minutes: 21 + 20 / 60 },
  { name: "김창현2편", chars: 15684, minutes: 27 + 30 / 60 },
  { name: "박종천1편", chars: 16500, minutes: 25 + 50 / 60 },
  { name: "강정수1편", chars: 15274, minutes: 25 + 45 / 60 },
  { name: "박종천3편", chars: 19288, minutes: 30 + 46 / 60 },
  { name: "허진호1편", chars: 21509, minutes: 32 + 11 / 60 },
  { name: "이세돌2편", chars: 20765, minutes: 32 + 48 / 60 },
]);

const SLOPE = 0.001210;
const INTERCEPT = 7.05;
const LOO_RESIDUAL_STD = 1.19;

/**
 * cleanText 글자수 → 영상 길이 예측 (초 단위, 95% 신뢰구간 포함).
 * @returns {{ pointSec, lowSec, highSec, pointMin, ci95, count }}
 */
export function calcRegression(cleanChars) {
  const pointMin = SLOPE * cleanChars + INTERCEPT;
  const ci95 = 1.96 * LOO_RESIDUAL_STD;
  return {
    pointSec: pointMin * 60,
    lowSec: (pointMin - ci95) * 60,
    highSec: (pointMin + ci95) * 60,
    pointMin,
    ci95,
    count: TRAINING_DATA.length,
  };
}

/** "MM:SS" 또는 "HH:MM:SS" 문자열 → 초. */
export function tsToSeconds(ts) {
  if (!ts) return 0;
  const parts = ts.split(":").map(Number);
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return 0;
}

/** 초 → "MM:SS" 또는 "H:MM:SS". */
export function secondsToDisplay(sec) {
  sec = Math.round(sec);
  if (sec >= 3600) {
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/**
 * 블록 분량 계산 (타임스탬프 기반).
 * @param blocks reviewBlocks
 * @param deletedBlockIndices Set<number> (80%+ 삭제 블록)
 */
export function calcDuration(blocks, deletedBlockIndices = new Set()) {
  let totalSeconds = 0, deletedSeconds = 0, keptSeconds = 0;
  let totalChars = 0, deletedChars = 0, keptChars = 0;

  const delSet = deletedBlockIndices instanceof Set ? deletedBlockIndices : new Set(deletedBlockIndices || []);

  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    const nextB = blocks[i + 1];
    const startSec = tsToSeconds(b.timestamp);
    const endSec = nextB ? tsToSeconds(nextB.timestamp) : (startSec + 10);
    const duration = Math.max(0, endSec - startSec);
    const isDeleted = delSet.has(i);
    const charLen = (b.text || "").length;

    totalSeconds += duration;
    totalChars += charLen;
    if (isDeleted) {
      deletedSeconds += duration;
      deletedChars += charLen;
    } else {
      keptSeconds += duration;
      keptChars += charLen;
    }
  }
  return { totalSeconds, deletedSeconds, keptSeconds, totalChars, deletedChars, keptChars };
}
