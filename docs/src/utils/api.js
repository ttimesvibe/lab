// ═══════════════════════════════════════════════
// API CLIENT — Mock ↔ Live switchable
// ═══════════════════════════════════════════════

export function delay(ms){return new Promise(r=>setTimeout(r,ms))}

function authHeaders() {
  const token = localStorage.getItem("ttimes_token");
  return token ? { "Authorization": `Bearer ${token}` } : {};
}

function handle401(r) {
  if (r.status === 401) {
    localStorage.removeItem("ttimes_token");
    localStorage.removeItem("ttimes_user");
    window.location.reload();
    throw new Error("인증이 만료되었습니다. 다시 로그인해주세요.");
  }
}

export async function apiCall(endpoint, body, config, retries = 4) {
  if (config.apiMode === "mock") return null;
  const url = `${config.workerUrl}/${endpoint}`;

  for (let i = 0; i < retries; i++) {
    let r;
    try {
      r = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify(body),
      });
    } catch (netErr) {
      // 네트워크 에러 또는 CORS 차단
      if (i < retries - 1) {
        const waitTime = (i + 1) * 5000;
        console.warn(`🌐 네트워크 에러 (${endpoint}): ${netErr.message}. ${waitTime/1000}초 후 재시도 (${i+1}/${retries})`);
        await delay(waitTime);
        continue;
      }
      throw new Error(`네트워크 연결 실패 (${endpoint}). Worker 서버 상태를 확인해주세요.\n원인: ${netErr.message}`);
    }

    // 401 체크를 파싱 전에 먼저 수행
    handle401(r);

    let d;
    try {
      const text = await r.text();
      d = JSON.parse(text);
    } catch (parseErr) {
      if (i < retries - 1) {
        const waitTime = (i + 1) * 5000;
        console.warn(`⚠️ Worker 비정상 응답 (${endpoint}): status=${r.status}. ${waitTime/1000}초 후 재시도 (${i+1}/${retries})`);
        await delay(waitTime);
        continue;
      }
      throw new Error(`Worker 서버 오류 (${endpoint}, HTTP ${r.status}). 입력이 너무 크거나 Worker 타임아웃일 수 있습니다.`);
    }

    if (d.success) return d;

    if (r.status === 429 || d.status === 429 || (d.error && d.error.includes("Rate limited"))) {
      const waitTime = (i + 1) * 5000;
      console.warn(`⏳ API 한도 초과! ${waitTime/1000}초 후 자동으로 재시도합니다... (${i+1}/${retries})`);
      await delay(waitTime);
      continue;
    }

    throw new Error(d.error || `${endpoint} failed`);
  }

  throw new Error("API 요청 한도 초과로 여러 번 재시도했지만 실패했습니다. 잠시 후 다시 시도해주세요.");
}

// 세션 저장/불러오기도 같은 Worker를 사용
function getWorkerBase(config) {
  return config.workerUrl || "";
}

export async function apiSaveSession(sessionData, config) {
  const base = getWorkerBase(config);
  if (!base) throw new Error("Worker URL이 설정되지 않았습니다.");
  // CMS v2 — N5: user 객체 전송 (apiSaveTab 동일 패턴, D6-8 일관)
  const user = _currentUser();
  const body = user ? { ...sessionData, user } : sessionData;
  const r = await fetch(`${base}/save`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(body),
  });
  handle401(r);
  const d = await r.json();
  if (!d.success) throw new Error(d.error || "저장 실패");
  return d.id;
}

export async function apiLoadSession(id, config) {
  const base = getWorkerBase(config);
  if (!base) throw new Error("Worker URL이 설정되지 않았습니다.");
  const r = await fetch(`${base}/load/${id}`, { headers: authHeaders() });
  handle401(r);
  const d = await r.json();
  if (!r.ok) throw new Error(d.error || "불러오기 실패");
  return d;
}

// Step 0
export async function apiAnalyze(fullText, cfg, dictionaryWords) {
  if (cfg.apiMode === "mock") {
    await delay(700);
    return {
      overview: { topic: "인터뷰 주제 (Mock 분석)", keywords: ["프롬프트","클로드","앤트로픽"] },
      speakers: [], domain_terms: [],
      term_corrections: [
        {wrong:"엔트로피",correct:"앤트로픽",confidence:"high"},
        {wrong:"엠트로픽",correct:"앤트로픽",confidence:"high"},
        {wrong:"프롬보트",correct:"프롬프트",confidence:"high"},
        {wrong:"프롬포트",correct:"프롬프트",confidence:"high"},
        {wrong:"오프스",correct:"오퍼스",confidence:"high"},
        {wrong:"클로즈 스케일",correct:"클로드 스킬",confidence:"high"},
        {wrong:"프럼 엔지니어",correct:"프롬프트 엔지니어",confidence:"high"},
        {wrong:"컨텍트",correct:"컨텍스트",confidence:"high"},
      ],
      genre: { primary: "설명형", secondary: null, transitions: [] },
      tech_difficulty: "보통",
      audience_level: "관심 있는 비전문가",
    };
  }
  const payload = { full_text: fullText };
  if (dictionaryWords?.length > 0) payload.dictionary_words = dictionaryWords;
  const d = await apiCall("analyze", payload, cfg);
  return d.analysis;
}

// 1차 chunk
export async function apiCorrect(chunkText, idx, total, analysis, context, cfg) {
  if (cfg.apiMode === "mock") {
    await delay(300 + Math.random() * 400);
    return mockCorrectChunk(chunkText, analysis, cfg);
  }

  const d = await apiCall("correct", {
    chunk_text: chunkText, chunk_index: idx, total_chunks: total,
    context_blocks: context, analysis, custom_fillers: cfg.fillers, custom_terms: cfg.customTerms,
  }, cfg);

  return d.result;
}

// 2단계 — Draft Agent (청크 단위 호출 지원)
export async function apiHighlightsDraft(blocks, analysis, cfg, chunk_index, total_chunks) {
  if (cfg.apiMode === "mock") {
    await delay(800);
    const hl = [];
    blocks.filter(b => b.text.length > 80).forEach((b, i) => {
      if (i % 3 === 0) hl.push({
        block_index: b.index, speaker: b.speaker,
        source_text: b.text.substring(0, 50) + "...",
        subtitle: b.text.replace(/\s+/g," ").substring(0, 35) + "…",
        type: ["A1","B1","B2","C1","D1","E1"][i % 6],
        type_name: ["핵심 논지 압축","등호 정의형","용어 설명형","질문 프레이밍형","비교 평가형","기능 헤드라인"][i % 6],
        reason: "핵심 구간 (Draft)",
        placement_hint: null, sequence_id: null,
      });
    });
    return { highlights: hl.slice(0, 40) };
  }
  const body = { mode: "draft", blocks, analysis };
  if (chunk_index !== undefined) { body.chunk_index = chunk_index; body.total_chunks = total_chunks; }
  const d = await apiCall("highlights", body, cfg);
  return d.result;
}

// 2단계 — Editor Agent (청크 단위 호출 지원)
export async function apiHighlightsEdit(blocks, analysis, draftHighlights, cfg, chunk_index, total_chunks) {
  if (cfg.apiMode === "mock") {
    await delay(600);
    const kept = draftHighlights.filter((_, i) => i % 3 !== 2);
    const removed = draftHighlights.filter((_, i) => i % 3 === 2).map(h => ({
      block_index: h.block_index, reason: "밀도 조정으로 제거 (Mock)"
    }));
    return {
      highlights: kept,
      removed,
      stats: {
        draft_count: draftHighlights.length,
        final_count: kept.length,
        removal_rate: `${Math.round((1 - kept.length / draftHighlights.length) * 100)}%`,
      },
    };
  }
  const body = { mode: "edit", blocks, analysis, draft_highlights: draftHighlights };
  if (chunk_index !== undefined) { body.chunk_index = chunk_index; body.total_chunks = total_chunks; }
  const d = await apiCall("highlights", body, cfg);
  return d.result;
}

// ── 탭별 세션 저장/로드 (새 스키마) ──

// CMS v2 — apiSaveTab 시그니처 확장 (B5: baseSavedAt + baseVersion / B3: force / B11: deleted 응답 처리)
// opts: { baseSavedAt, baseVersion, force }
// 반환: { id, savedAt, version, merged, mergedBy }
// 충돌 (409): error.status=409, error.serverData / error.serverVersion / error.serverUpdatedBy 포함
// 삭제 (409 deleted): error.status=409, error.deleted=true
// CMS v2 — D6-8: 클라가 user 정보를 매 저장 시 전송 → 서버 meta.updatedBy 객체 기록
// JWT 토큰에서 sub/name 디코딩하여 body.user 로 전달.
function _currentUser() {
  try {
    const tk = localStorage.getItem("ttimes_token");
    if (!tk) return null;
    const payloadB64 = tk.split(".")[1];
    const payloadBytes = Uint8Array.from(atob(payloadB64.replace(/-/g, "+").replace(/_/g, "/")), c => c.charCodeAt(0));
    const payload = JSON.parse(new TextDecoder().decode(payloadBytes));
    return { sub: payload.sub, name: payload.name };
  } catch { return null; }
}

export async function apiSaveTab(sessionId, tab, data, config, fn, opts = {}) {
  const base = config.workerUrl;
  if (!base) throw new Error("Worker URL이 설정되지 않았습니다.");
  const body = { id: sessionId, tab, data, fn };
  const user = _currentUser();
  if (user) body.user = user;
  if (opts.baseSavedAt) body.baseSavedAt = opts.baseSavedAt;
  if (opts.baseVersion !== undefined) body.baseVersion = opts.baseVersion;
  if (opts.force) body.force = true;
  const r = await fetch(`${base}/save`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(body),
  });
  handle401(r);
  const d = await r.json();
  if (r.status === 409) {
    const err = new Error(d.error === "deleted" || d.error === "project deleted" ? "deleted" : "conflict");
    err.status = 409;
    err.serverSavedAt = d.serverSavedAt;
    err.serverVersion = d.serverVersion;
    err.serverUpdatedBy = d.serverUpdatedBy;
    err.serverData = d.serverData;
    err.deleted = d.error === "project deleted" || d.error === "deleted";
    err.deletedAt = d.deletedAt;
    err.deletedBy = d.deletedBy;
    throw err;
  }
  if (!d.success) {
    const err = new Error(d.error || "저장 실패");
    err.status = r.status;
    throw err;
  }
  return { id: d.id, savedAt: d.savedAt, version: d.version, merged: d.merged, mergedBy: d.mergedBy, warnings: d.warnings };
}

// CMS v2 — 멀티유저 sync (묶음 ⑫ Phase 3)
export async function apiHeartbeat(sessionId, config, user, tab) {
  const base = config.workerUrl;
  if (!base) return null;
  try {
    const r = await fetch(`${base}/session/${sessionId}/heartbeat`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({ user, tab }),
    });
    if (!r.ok) return null;
    return r.json();
  } catch { return null; }
}

export async function apiLeave(sessionId, config, user) {
  const base = config.workerUrl;
  if (!base) return null;
  try {
    const body = JSON.stringify({ user });
    // CMS v2 — CORS simple request 로 분류되도록 text/plain 사용 (preflight 회피)
    // Worker 측은 body 를 JSON 으로 파싱하므로 Content-Type 헤더 무관.
    const blob = new Blob([body], { type: "text/plain" });
    if (navigator.sendBeacon) {
      navigator.sendBeacon(`${base}/session/${sessionId}/leave`, blob);
      return { sent: "beacon" };
    }
    const r = await fetch(`${base}/session/${sessionId}/leave`, {
      method: "POST",
      headers: { "Content-Type": "text/plain", ...authHeaders() },
      body,
      keepalive: true,
    });
    if (!r.ok) return null;
    return r.json();
  } catch { return null; }
}

export async function apiActiveUsers(sessionId, config) {
  const base = config.workerUrl;
  if (!base) return [];
  try {
    const r = await fetch(`${base}/session/${sessionId}/active-users`, { headers: authHeaders() });
    if (!r.ok) return [];
    const d = await r.json();
    return d.active || [];
  } catch { return []; }
}

export async function apiLoadMeta(sessionId, config) {
  const base = config.workerUrl;
  if (!base) throw new Error("Worker URL이 설정되지 않았습니다.");
  const r = await fetch(`${base}/load/${sessionId}`, { headers: authHeaders() });
  handle401(r);
  if (!r.ok) throw new Error("메타 로드 실패");
  return r.json();
}

export async function apiLoadTab(sessionId, tab, config) {
  const base = config.workerUrl;
  if (!base) throw new Error("Worker URL이 설정되지 않았습니다.");
  const r = await fetch(`${base}/load/${sessionId}/${tab}`, { headers: authHeaders() });
  handle401(r);
  if (!r.ok) return null;
  return r.json();
}

// ── 하이라이트 추천 ──

export async function apiHlRecommend(script, config) {
  const d = await apiCall("hl-recommend", { script }, config);
  return d.result;
}

// ── 하이라이트 타임스탬프 ──

export async function apiHlTimestamps(script, config) {
  const d = await apiCall("hl-timestamps", { script }, config);
  return d.result;
}

// ── 세트 생성 ──

export async function apiSetgen(script, guestName, guestTitle, focusKeyword, config) {
  const d = await apiCall("setgen", {
    script, guest_name: guestName, guest_title: guestTitle, focus_keyword: focusKeyword,
  }, config);
  return d;
}

// ── 프로젝트 관리 (CMS 대시보드) ──

export async function apiProjectList(config, { page = 1, filter = "all", search = "" } = {}) {
  const base = config.workerUrl;
  if (!base) throw new Error("Worker URL이 설정되지 않았습니다.");
  const params = new URLSearchParams({ page, per_page: 20, filter, search });
  const r = await fetch(`${base}/projects?${params}`, { headers: authHeaders() });
  handle401(r);
  return r.json();
}

export async function apiProjectCreate(body, config) {
  const base = config.workerUrl;
  if (!base) throw new Error("Worker URL이 설정되지 않았습니다.");
  const r = await fetch(`${base}/projects/create`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(body),
  });
  handle401(r);
  const d = await r.json();
  if (!d.success) throw new Error(d.error || "프로젝트 생성 실패");
  return d;
}

export async function apiProjectUpdate(body, config) {
  const base = config.workerUrl;
  if (!base) throw new Error("Worker URL이 설정되지 않았습니다.");
  const r = await fetch(`${base}/projects/update`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(body),
  });
  handle401(r);
  return r.json();
}

export async function apiProjectDelete(id, config) {
  const base = config.workerUrl;
  if (!base) throw new Error("Worker URL이 설정되지 않았습니다.");
  const r = await fetch(`${base}/projects/delete`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ id }),
  });
  handle401(r);
  return r.json();
}

export async function apiProjectUpdateStep(id, step, stepIndex, config) {
  const base = config.workerUrl;
  if (!base) throw new Error("Worker URL이 설정되지 않았습니다.");
  const r = await fetch(`${base}/projects/update-step`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ id, step, stepIndex }),
  });
  handle401(r);
  return r.json();
}

export async function apiTeamMembers(config) {
  const base = config.workerUrl;
  if (!base) throw new Error("Worker URL이 설정되지 않았습니다.");
  const r = await fetch(`${base}/team/members`, { headers: authHeaders() });
  handle401(r);
  return r.json();
}

export function mockCorrectChunk(chunkText, analysis, cfg) {
  const chunks = [];
  const blockRe = /\[블록 (\d+)\]/g;
  const matches = [...chunkText.matchAll(blockRe)];
  const terms = analysis?.term_corrections || [];
  matches.forEach((m, mi) => {
    const bIdx = parseInt(m[1]);
    const start = m.index;
    const end = mi < matches.length - 1 ? matches[mi + 1].index : chunkText.length;
    const bText = chunkText.substring(start, end);
    const changes = [];
    cfg.fillers.forEach(f => {
      const re = new RegExp(`(?<=[가-힣a-zA-Z]\\s)${f}(?=\\s[가-힣a-zA-Z])`, "g");
      let fm; while ((fm = re.exec(bText)) !== null) {
        if (f === "이제" && bText.substring(fm.index, fm.index + 4).includes("이제는")) continue;
        changes.push({ type: "filler_removal", original: f, corrected: "", removed_fillers: [f] });
      }
    });
    terms.forEach(tc => {
      if (tc.confidence === "low") return;
      if (bText.includes(tc.wrong)) changes.push({ type: "term_correction", original: tc.wrong, corrected: tc.correct, reason: "STT 교정" });
    });
    if (changes.length > 0) chunks.push({ block_index: bIdx, changes });
  });
  return { chunks };
}
