// lab fresh v2 — Worker Part 3: 촬영 일정 (Shoot) 핸들러 (5 endpoint)
// 사료: editor/ops/lab-v2-fresh-2026-05-09.md
//   - S2.4.5 촬영 일정 (Shoot)
//   - S2.5 외부 통합 — Apps Script Email + Calendar
//   - S1.10.2.c 캘린더 회귀 분석 (CAL-1 calendarEventId 결손 영구 silent skip 차단)
//   - S1.9 N7 (handleShootUpdate/Delete warnings 응답 노출)
//
// 5 endpoint:
//   GET  /shoots              → handleShootList
//   POST /shoots/create       → handleShootCreate (★ calendarEventId + Apps Script + 이메일)
//   POST /shoots/update       → handleShootUpdate (변경 감지 + addGuests/removeGuests)
//   POST /shoots/delete       → handleShootDelete (deleteEvent + 취소 이메일)
//   POST /shoots/move-stage   → handleShootMoveStage (stage 만 변경, 캘린더 변경 X)

import {
  isValidId,
  logPrefix,
  jsonResponse,
  badRequest,
  notFound,
  serverError,
} from "./utils.js";
import { sanitizePayload } from "./merge.js";
import { generateId } from "./projects.js";

// ─── 상수 ────────────────────────────────────────────────────────────────

const SHOOT_INDEX_KEY = "shoot_index";
const PROJECT_INDEX_KEY = "project_index";

// 캘린더 이메일 매핑 (사료 S2'.7)
// 사용자별 등록 이메일 (회사) → 캘린더 초대 받을 이메일 (개인)
export const CALENDAR_EMAIL_MAP = Object.freeze({
  "hjae@mt.co.kr": "repfootball@gmail.com",
  "24min@mt.co.kr": "sammylee9393@gmail.com",
});

// Apps Script URLs (env 로 주입 가능, 없으면 기본 placeholder)
function getAppsScriptUrls(env) {
  return {
    email: env?.APPS_SCRIPT_EMAIL_URL || null,
    calendar: env?.APPS_SCRIPT_CALENDAR_URL || null,
  };
}

// ─── Apps Script callout 추상 ────────────────────────────────────────────

/**
 * Call Apps Script (Email or Calendar).
 *
 * 사료 S2'.3: 302 redirect 처리 (4/20 4a74c3c), text/plain JSON.
 *
 * @param {string} targetUrl
 * @param {object} payload
 * @returns {Promise<{ok, status, data?, error?}>}
 */
export async function callAppsScript(targetUrl, payload) {
  if (!targetUrl) return { ok: false, status: 0, error: "Apps Script URL not configured" };
  try {
    const r = await fetch(targetUrl, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(payload || {}),
      redirect: "follow",  // 302 처리
    });
    const status = r.status;
    if (!r.ok) {
      return { ok: false, status, error: `HTTP ${status}` };
    }
    let data;
    try {
      data = await r.json();
    } catch {
      // text 응답 fallback
      try {
        const text = await r.text();
        data = { raw: text };
      } catch {
        data = null;
      }
    }
    return { ok: true, status, data };
  } catch (e) {
    return { ok: false, status: 0, error: e?.message || String(e) };
  }
}

/**
 * Extract eventId from Apps Script response (★ CAL-1 영역 — fallback chain).
 * 사료 S1.10.2.c: calData.eventId 가 falsy 일 때 다른 키명 fallback.
 */
export function extractEventId(calData) {
  if (!calData || typeof calData !== "object") return null;
  if (calData.eventId) return calData.eventId;
  if (calData.id) return calData.id;
  if (calData.googleEventId) return calData.googleEventId;
  if (calData.event && calData.event.id) return calData.event.id;
  return null;
}

// ─── KV 헬퍼 ─────────────────────────────────────────────────────────────

async function readShootIndex(env) {
  if (!env || !env.SESSIONS) return [];
  try {
    const raw = await env.SESSIONS.get(SHOOT_INDEX_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch (e) {
    console.error(logPrefix("kv-index", "shoot_index read failed", e?.message));
    return [];
  }
}

async function writeShootIndex(env, arr, warnings) {
  const serialized = JSON.stringify(arr);
  if (serialized.length > 900_000) {
    warnings?.push("shoot_index near 1MB limit");
  }
  await env.SESSIONS.put(SHOOT_INDEX_KEY, serialized);
}

// ─── handleShootList — GET /shoots ──────────────────────────────────────

export async function handleShootList(env, headers, user) {
  if (!env || !env.SESSIONS) return serverError(headers, "KV not configured");
  const shoots = await readShootIndex(env);
  return jsonResponse({ success: true, shoots }, { status: 200 }, headers);
}

// ─── handleShootCreate — POST /shoots/create ────────────────────────────

/**
 * POST /shoots/create  body: {
 *   guest, topic, dateTime, totalEpisodes?, studio?, roles?,
 *   parentShootId?,
 * }
 *
 * - id 자동 생성
 * - shoot_index push
 * - shoot.shootDate 가 있으면 Apps Script Calendar.createEvent
 * - 알림 이메일 (배정원에게)
 * - ★ CAL-1: calendarEventId 결손 시 warnings 응답
 */
export async function handleShootCreate(body, env, headers, user) {
  if (!env || !env.SESSIONS) return serverError(headers, "KV not configured");
  if (!user || !user.sub) return badRequest(headers, "인증 필요");
  if (!body || typeof body.guest !== "string" || body.guest.trim() === "") {
    return badRequest(headers, "guest 필수");
  }

  const cleanBody = sanitizePayload(body);
  const id = generateId(8);
  const now = new Date().toISOString();
  const warnings = [];

  const shoot = {
    id,
    guest: cleanBody.guest,
    topic: cleanBody.topic || "",
    dateTime: cleanBody.dateTime || null,
    totalEpisodes: cleanBody.totalEpisodes || null,
    studio: cleanBody.studio || null,
    roles: cleanBody.roles || { filming: [], progress: [], scriptEdit: [], videoEdit: [] },
    stage: "pre-production",
    childProjectIds: [],
    parentShootId: cleanBody.parentShootId || null,
    creator: user.name || user.sub,
    creatorEmail: user.sub,
    createdAt: now,
    updatedAt: now,
    calendarEventId: null,
  };

  // shoot_index 갱신 (저장 먼저, 캘린더 동기는 best-effort)
  const arr = await readShootIndex(env);
  arr.unshift(shoot);
  await writeShootIndex(env, arr, warnings);

  // Apps Script Calendar.createEvent (best-effort)
  const urls = getAppsScriptUrls(env);
  if (shoot.dateTime && urls.calendar) {
    const allEmails = collectAllEmails(shoot);
    const calRes = await callAppsScript(urls.calendar, {
      action: "createEvent",
      title: `${shoot.guest} ${shoot.topic || ""}`.trim(),
      startTime: shoot.dateTime,
      guests: allEmails,
      studio: shoot.studio,
    });
    if (calRes.ok) {
      const eventId = extractEventId(calRes.data);
      if (eventId) {
        shoot.calendarEventId = eventId;
        // KV 재읽기 + 갱신 (race 방지)
        const idxArr = await readShootIndex(env);
        const idx = idxArr.findIndex((s) => s && s.id === id);
        if (idx >= 0) {
          idxArr[idx] = shoot;
          await writeShootIndex(env, idxArr, warnings);
        }
      } else {
        // ★ CAL-1: eventId fallback 모두 실패 → warnings 응답
        console.warn(logPrefix("apps-script", "createEvent no eventId", JSON.stringify(calRes.data)));
        warnings.push("calendar event created but eventId missing — 캘린더 동기화 비활성");
      }
    } else {
      console.error(logPrefix("apps-script", "createEvent failed", calRes.error));
      warnings.push(`calendar event create failed: ${calRes.error}`);
    }
  }

  // 알림 이메일 (best-effort)
  if (urls.email && shoot.dateTime) {
    const emails = collectAllEmails(shoot);
    if (emails.length > 0) {
      const r = await callAppsScript(urls.email, {
        action: "shootCreated",
        guest: shoot.guest,
        dateTime: shoot.dateTime,
        recipients: emails,
      });
      if (!r.ok) {
        warnings.push(`email notification failed: ${r.error}`);
      }
    }
  }

  return jsonResponse(
    { success: true, shoot, warnings: warnings.length ? warnings : undefined },
    { status: 200 },
    headers
  );
}

/**
 * Collect all emails from shoot.roles (filming + progress + scriptEdit + videoEdit).
 * CALENDAR_EMAIL_MAP fallback (회사 이메일 → 개인 이메일).
 */
function collectAllEmails(shoot) {
  const set = new Set();
  if (shoot.roles && typeof shoot.roles === "object") {
    for (const role of Object.keys(shoot.roles)) {
      const list = shoot.roles[role];
      if (!Array.isArray(list)) continue;
      for (const m of list) {
        const email = typeof m === "string" ? m : m?.email;
        if (!email) continue;
        // CALENDAR_EMAIL_MAP fallback
        const calEmail = CALENDAR_EMAIL_MAP[email] || email;
        set.add(calEmail);
      }
    }
  }
  return [...set];
}

// ─── handleShootUpdate — POST /shoots/update ────────────────────────────

/**
 * POST /shoots/update  body: { id, guest?, topic?, dateTime?, totalEpisodes?, studio?, roles?, ... }
 *
 * 변경 감지 (date/guest/topic) → callAppsScript("updateEvent")
 * 멤버 변경 → addGuests / removeGuests
 *
 * ★ N7 영역: handleShootUpdate 도 외부 호출 실패 → warnings 응답 노출
 */
export async function handleShootUpdate(body, env, headers, user) {
  if (!env || !env.SESSIONS) return serverError(headers, "KV not configured");
  if (!body || !isValidId(body.id)) return badRequest(headers, "invalid id");

  const arr = await readShootIndex(env);
  const idx = arr.findIndex((s) => s && s.id === body.id);
  if (idx < 0) return notFound(headers, "촬영 일정을 찾을 수 없습니다.");

  const oldShoot = { ...arr[idx] };
  const cleanBody = sanitizePayload(body);
  const now = new Date().toISOString();
  const warnings = [];

  // 변경 감지 (캘린더 동기화 대상)
  const dateChanged = cleanBody.dateTime !== undefined && cleanBody.dateTime !== oldShoot.dateTime;
  const guestChanged = cleanBody.guest !== undefined && cleanBody.guest !== oldShoot.guest;
  const topicChanged = cleanBody.topic !== undefined && cleanBody.topic !== oldShoot.topic;

  // 멤버 변경 감지
  const oldEmails = new Set(collectAllEmails(oldShoot));
  // 갱신
  const newShoot = { ...oldShoot };
  if (cleanBody.guest !== undefined) newShoot.guest = cleanBody.guest;
  if (cleanBody.topic !== undefined) newShoot.topic = cleanBody.topic;
  if (cleanBody.dateTime !== undefined) newShoot.dateTime = cleanBody.dateTime;
  if (cleanBody.totalEpisodes !== undefined) newShoot.totalEpisodes = cleanBody.totalEpisodes;
  if (cleanBody.studio !== undefined) newShoot.studio = cleanBody.studio;
  if (cleanBody.roles !== undefined) newShoot.roles = cleanBody.roles;
  newShoot.updatedAt = now;
  arr[idx] = newShoot;
  await writeShootIndex(env, arr, warnings);

  const newEmails = new Set(collectAllEmails(newShoot));
  const addedEmails = [...newEmails].filter((e) => !oldEmails.has(e));
  const removedEmails = [...oldEmails].filter((e) => !newEmails.has(e));

  // Apps Script (best-effort)
  const urls = getAppsScriptUrls(env);
  const calId = newShoot.calendarEventId;

  // ★ CAL-1: calendarEventId 결손 시 모든 후속 동기화 silent skip → warnings
  if (!calId && (dateChanged || guestChanged || topicChanged || addedEmails.length || removedEmails.length)) {
    warnings.push("calendarEventId 결손 — 캘린더 동기화 silent skip (CAL-1)");
  }

  if (urls.calendar && calId && (dateChanged || guestChanged || topicChanged)) {
    const r = await callAppsScript(urls.calendar, {
      action: "updateEvent",
      eventId: calId,
      title: `${newShoot.guest} ${newShoot.topic || ""}`.trim(),
      startTime: newShoot.dateTime,
    });
    if (!r.ok) {
      console.error(logPrefix("apps-script", "updateEvent failed", r.error));
      warnings.push(`updateEvent failed: ${r.error}`);
    }
  }

  if (urls.calendar && calId && addedEmails.length > 0) {
    const r = await callAppsScript(urls.calendar, { action: "addGuests", eventId: calId, guests: addedEmails });
    if (!r.ok) warnings.push(`addGuests failed: ${r.error}`);
  }
  if (urls.calendar && calId && removedEmails.length > 0) {
    const r = await callAppsScript(urls.calendar, { action: "removeGuests", eventId: calId, guests: removedEmails });
    if (!r.ok) warnings.push(`removeGuests failed: ${r.error}`);
  }

  // 일정 변경 알림 이메일
  if (urls.email && dateChanged) {
    const r = await callAppsScript(urls.email, {
      action: "shootRescheduled",
      guest: newShoot.guest,
      oldDateTime: oldShoot.dateTime,
      newDateTime: newShoot.dateTime,
      recipients: collectAllEmails(newShoot),
    });
    if (!r.ok) warnings.push(`reschedule email failed: ${r.error}`);
  }

  return jsonResponse(
    { success: true, shoot: newShoot, warnings: warnings.length ? warnings : undefined },
    { status: 200 },
    headers
  );
}

// ─── handleShootDelete — POST /shoots/delete ────────────────────────────

/**
 * POST /shoots/delete  body: { id }
 *
 * 캘린더 이벤트 삭제 + 취소 이메일.
 * shoot_index 에서 entry 제거. childProjectIds 도 정리 (parentShootId 끊기).
 *
 * ★ N7 영역: 외부 호출 실패 → warnings 응답
 */
export async function handleShootDelete(body, env, headers, user) {
  if (!env || !env.SESSIONS) return serverError(headers, "KV not configured");
  if (!body || !isValidId(body.id)) return badRequest(headers, "invalid id");

  const arr = await readShootIndex(env);
  const idx = arr.findIndex((s) => s && s.id === body.id);
  if (idx < 0) return notFound(headers, "촬영 일정을 찾을 수 없습니다.");

  const shoot = arr[idx];
  const warnings = [];

  // shoot_index entry 제거
  arr.splice(idx, 1);
  await writeShootIndex(env, arr, warnings);

  // childProjects 의 parentShootId 끊기
  if (Array.isArray(shoot.childProjectIds) && shoot.childProjectIds.length > 0) {
    try {
      const piRaw = await env.SESSIONS.get(PROJECT_INDEX_KEY);
      if (piRaw) {
        const pi = JSON.parse(piRaw);
        if (Array.isArray(pi)) {
          let changed = false;
          for (const p of pi) {
            if (p && shoot.childProjectIds.includes(p.id)) {
              p.parentShootId = null;
              changed = true;
            }
          }
          if (changed) await env.SESSIONS.put(PROJECT_INDEX_KEY, JSON.stringify(pi));
        }
      }
    } catch (e) {
      warnings.push(`project_index parentShootId cleanup failed: ${e?.message}`);
    }
  }

  // Apps Script — 캘린더 이벤트 삭제 + 취소 이메일 (best-effort)
  const urls = getAppsScriptUrls(env);
  if (!shoot.calendarEventId) {
    warnings.push("calendarEventId 결손 — 캘린더 삭제 silent skip (CAL-1)");
  }
  if (urls.calendar && shoot.calendarEventId) {
    const r = await callAppsScript(urls.calendar, {
      action: "deleteEvent",
      eventId: shoot.calendarEventId,
    });
    if (!r.ok) {
      console.error(logPrefix("apps-script", "deleteEvent failed", r.error));
      warnings.push(`deleteEvent failed: ${r.error}`);
    }
  }
  if (urls.email) {
    const recipients = collectAllEmails(shoot);
    if (recipients.length > 0) {
      const r = await callAppsScript(urls.email, {
        action: "shootCancelled",
        guest: shoot.guest,
        dateTime: shoot.dateTime,
        recipients,
      });
      if (!r.ok) warnings.push(`cancel email failed: ${r.error}`);
    }
  }

  return jsonResponse(
    { success: true, deletedId: body.id, warnings: warnings.length ? warnings : undefined },
    { status: 200 },
    headers
  );
}

// ─── handleShootMoveStage — POST /shoots/move-stage ─────────────────────

/**
 * POST /shoots/move-stage  body: { id, stage }
 *
 * 4 stage: pre-production / editing / post-production / done.
 * 캘린더 변경 X (stage 만 갱신).
 */
export async function handleShootMoveStage(body, env, headers, user) {
  if (!env || !env.SESSIONS) return serverError(headers, "KV not configured");
  if (!body || !isValidId(body.id)) return badRequest(headers, "invalid id");
  const VALID_STAGES = ["pre-production", "editing", "post-production", "done"];
  if (!VALID_STAGES.includes(body.stage)) {
    return badRequest(headers, "invalid stage");
  }

  const arr = await readShootIndex(env);
  const idx = arr.findIndex((s) => s && s.id === body.id);
  if (idx < 0) return notFound(headers, "촬영 일정을 찾을 수 없습니다.");

  arr[idx].stage = body.stage;
  arr[idx].updatedAt = new Date().toISOString();
  const warnings = [];
  await writeShootIndex(env, arr, warnings);

  return jsonResponse(
    { success: true, shoot: arr[idx], warnings: warnings.length ? warnings : undefined },
    { status: 200 },
    headers
  );
}
