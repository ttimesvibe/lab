// lab fresh v2 — A3 30s cascading throttle (★ debounce X)
// 사료: editor/ops/lab-v2-fresh-2026-05-09.md
//   - 헌장 §1 1조 cascading throttle:
//       1. dirty 발생 → 30s timer 시작
//       2. 30s 후 fire → 그 시점 dirty 인 모든 탭 PUT
//       3. PUT 후 dirty 잔존 → 30s timer 새로 시작
//       4. dirty 비면 timer 정지
//       5. 새 dirty → 첫 dirty 부터 시작
//       ★ timer 는 사용자 입력으로만 진행. 탭 이동/폴링/fetch 영향 0.
//   - S1.6 결함 D 회피: deps chain X. 단순 setTimeout.
//   - S5.1 A3: Throttle Engine
//
// ★ 핵심 차이 (debounce vs cascading throttle):
//   - debounce: 매 입력마다 timer reset → 마지막 입력 후 30s
//   - cascading throttle: 첫 입력에 timer 시작 → 30s 후 fire
//                         → fire 후 dirty 잔존 시 새 cycle (★ reset 아님)
//
// 헌장 §1 보장: 사용자가 30s 내 다른 탭으로 이동하거나 폴링이 와도 timer 영향 0.

const DEFAULT_DELAY_MS = 30 * 1000;

/**
 * Create a cascading throttle.
 *
 * @param {object} opts
 *   - delayMs (number, default 30000) — fire 까지 기다리는 시간
 *   - onFire (async function) — fire 시 호출 (saveDirtyTabsToKV 등)
 *
 * Returns:
 *   - schedule() — dirty 발생 시 호출. 이미 scheduled 면 no-op (★ reset X)
 *   - cancel() — 명시 취소 (PUT 후 dirty 비었을 때)
 *   - isScheduled() — 현재 timer 활성?
 *   - fireNow() — 즉시 fire (수동 저장 버튼 등)
 *   - dispose() — cleanup (컴포넌트 unmount)
 */
export function createCascadingThrottle({ delayMs = DEFAULT_DELAY_MS, onFire } = {}) {
  if (typeof onFire !== "function") {
    throw new Error("createCascadingThrottle: onFire (function) required");
  }

  let timer = null;
  let scheduled = false;
  let firing = false;
  let disposed = false;

  function schedule() {
    if (disposed) return false;
    if (scheduled) return false;  // ★ 이미 진행 중이면 reset X
    scheduled = true;
    timer = setTimeout(async () => {
      timer = null;
      scheduled = false;
      if (disposed) return;
      firing = true;
      try {
        await onFire();
      } finally {
        firing = false;
      }
    }, delayMs);
    return true;
  }

  function cancel() {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    scheduled = false;
  }

  async function fireNow() {
    cancel();
    if (disposed) return;
    firing = true;
    try {
      await onFire();
    } finally {
      firing = false;
    }
  }

  function isScheduled() {
    return scheduled;
  }

  function isFiring() {
    return firing;
  }

  function dispose() {
    disposed = true;
    cancel();
  }

  return { schedule, cancel, fireNow, isScheduled, isFiring, dispose };
}
