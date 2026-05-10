// lab fresh v2 — A8 Polling (★ 4 책임만, 헌장 §X)
// 사료: editor/ops/lab-v2-fresh-2026-05-09.md
//   - 헌장 §X 책임 한정:
//       1. heartbeat (30초 주기)
//       2. active-users 갱신 (단계 A)
//       3. 토스트 알림 (다른 편집자 X 탭 수정)
//       4. /leave 트리거 (pagehide sendBeacon, 인증 면제)
//   - 헌장 §X 명시 거부: 폴링이 11 탭 데이터 동기화 X
//   - 묶음 ⑫ M11: heartbeat 응답에 active list 동봉 (추가 read 0)
//   - D12-2: TTL 90초 / heartbeat 30초
//   - D12-4: visibilitychange 즉시 1회
//   - D12-5: 토스트 5분 debounce per user
//   - D12-6: leave endpoint pagehide
//   - S5.1 A8
//
// 책임:
//   - createPolling(deps) — start / stop / leave / onVisibilityChange
//   - 다른 사용자 stages.updatedAt 변경 감지 → onOtherUserToast
//   - heartbeat 401 → 폴링 중단 (호출자가 로그인 모달)

const HEARTBEAT_INTERVAL_MS = 30 * 1000;        // D12-2 — 30초 주기
const VIS_CHANGE_DEBOUNCE_MS = 1000;            // visibilitychange 1초 debounce
const TOAST_DEBOUNCE_PER_USER_MS = 5 * 60 * 1000; // D12-5 — 5분 per user

/**
 * Create a polling layer with injected dependencies.
 *
 * @param {object} deps
 *   - sessionId (string)
 *   - cfg (object) — { workerUrl }
 *   - getUser (function) — () => user | null
 *   - getCurrentTab (function) — () => string | null  (★ N5 해소: 현재 탭 1 개만)
 *   - getRefs (function) — () => refs ({ [tab]: { savedAt, version } })
 *   - apiHeartbeat (function) — inject
 *   - apiLeave (function) — sendBeacon
 *   - apiLoadMeta (function) — meta polling (옵션)
 *   - onActiveUsers (function|null) — (users) => void
 *   - onOtherUserToast (function|null) — (info) => void
 *     info: { tab, sub, name, at }
 *   - on401 (function|null) — () => void  (로그인 모달 trigger)
 *
 * Returns:
 *   - start() — heartbeat 시작 (즉시 1회 + 30초 주기)
 *   - stop() — 중단
 *   - leave() — sendBeacon /leave (pagehide 호출)
 *   - onVisibilityChange() — 활성 시 즉시 1회 polling
 *   - tickOnce() — 단일 tick (테스트 용)
 *   - isStopped() — 상태
 */
export function createPolling(deps = {}) {
  const {
    sessionId,
    cfg,
    getUser,
    getCurrentTab,
    getRefs,
    apiHeartbeat,
    apiLeave,
    apiLoadMeta,
    onActiveUsers,
    onOtherUserToast,
    on401,
  } = deps;

  if (!sessionId) throw new Error("createPolling: sessionId required");
  if (typeof apiHeartbeat !== "function") {
    throw new Error("createPolling: apiHeartbeat inject required");
  }

  let timer = null;
  let stopped = false;
  let lastVisChange = 0;
  let inFlight = false;
  // 5분 debounce per user (★ D12-5)
  const lastToastTs = new Map();  // sub → timestamp

  async function tick() {
    if (stopped || inFlight) return;
    inFlight = true;
    try {
      const user = typeof getUser === "function" ? getUser() : null;
      const tab = typeof getCurrentTab === "function" ? getCurrentTab() : null;

      // 1. heartbeat (M11 — active list 동봉)
      try {
        const r = await apiHeartbeat(sessionId, cfg, user, tab);
        if (r?.active && typeof onActiveUsers === "function") {
          onActiveUsers(r.active);
        }
      } catch (e) {
        if (e?.status === 401) {
          stopped = true;
          if (typeof on401 === "function") on401();
          return;
        }
        // 다른 에러 — silent (다음 회차 회복)
      }

      // 2. meta polling (다른 사용자 변경 감지)
      if (typeof apiLoadMeta === "function" && typeof onOtherUserToast === "function") {
        try {
          const meta = await apiLoadMeta(sessionId, cfg);
          const stages = meta?.meta?.stages;
          if (stages && user) {
            detectOtherUserUpdate(stages, user);
          }
        } catch {
          // silent
        }
      }
    } finally {
      inFlight = false;
    }
  }

  function detectOtherUserUpdate(stages, user) {
    const refs = typeof getRefs === "function" ? getRefs() : {};
    const now = Date.now();
    for (const [tab, stage] of Object.entries(stages)) {
      if (!stage?.updatedAt || !stage?.updatedBy) continue;
      // 자기 자신 제외
      if (stage.updatedBy.sub === user?.sub) continue;
      const refSavedAt = refs?.[tab]?.savedAt;
      // refs 의 savedAt 보다 새로움 → 다른 사용자 변경
      if (refSavedAt && stage.updatedAt > refSavedAt) {
        // 5분 debounce per user (D12-5)
        const lastTs = lastToastTs.get(stage.updatedBy.sub) || 0;
        if (now - lastTs > TOAST_DEBOUNCE_PER_USER_MS) {
          lastToastTs.set(stage.updatedBy.sub, now);
          if (typeof onOtherUserToast === "function") {
            onOtherUserToast({
              tab,
              sub: stage.updatedBy.sub,
              name: stage.updatedBy.name,
              at: stage.updatedAt,
            });
          }
        }
      }
    }
  }

  function start() {
    if (timer || stopped) return false;
    // 즉시 1회 + 30초 주기
    tick();
    timer = setInterval(tick, HEARTBEAT_INTERVAL_MS);
    return true;
  }

  function stop() {
    stopped = true;
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  }

  function leave() {
    if (typeof apiLeave !== "function") return false;
    const user = typeof getUser === "function" ? getUser() : null;
    if (!user) return false;
    return apiLeave(sessionId, cfg, user);
  }

  function onVisibilityChange() {
    if (typeof document === "undefined") return;
    if (document.visibilityState !== "visible") return;
    const now = Date.now();
    if (now - lastVisChange < VIS_CHANGE_DEBOUNCE_MS) return;
    lastVisChange = now;
    tick();
  }

  return {
    start,
    stop,
    leave,
    onVisibilityChange,
    tickOnce: tick,                 // 테스트용
    isStopped: () => stopped,
    _internal: { lastToastTs },     // 테스트용 (debounce 검증)
  };
}
