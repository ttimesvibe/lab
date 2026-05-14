// ═══════════════════════════════════════════════════════════
// ttimes Auth Worker — Phase 1: 인증 인프라
// ═══════════════════════════════════════════════════════════

const ALLOWED_ORIGINS = [
  "https://ttimesvibe.github.io",
  "http://localhost:5173",
  "http://localhost:4173",
];

function getCorsHeaders(request) {
  const origin = request.headers.get("Origin");
  const allowedOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : null;
  const headers = {
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,Authorization",
    "Access-Control-Max-Age": "86400",
  };
  if (allowedOrigin) headers["Access-Control-Allow-Origin"] = allowedOrigin;
  return headers;
}

// ═══════════════════════════════════════════════════════════
// 비밀번호 해싱 (PBKDF2-SHA256, 100k iterations)
// ═══════════════════════════════════════════════════════════

const LEGACY_SALT_SUFFIX = "ttimes_auth_salt_v1";

function generateRandomSalt() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes));
}

async function hashPasswordWithSalt(password, salt) {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]
  );
  const hash = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: encoder.encode(salt), iterations: 100000, hash: "SHA-256" },
    keyMaterial, 256
  );
  return btoa(String.fromCharCode(...new Uint8Array(hash)));
}

// 레거시 호환: 랜덤 솔트 없는 기존 해시용
async function hashPasswordLegacy(password, email) {
  return await hashPasswordWithSalt(password, email + LEGACY_SALT_SUFFIX);
}

// 새 비밀번호 해싱: 랜덤 솔트 생성 + 해시
async function hashPasswordNew(password) {
  const salt = generateRandomSalt();
  const hash = await hashPasswordWithSalt(password, salt);
  return { hash, salt };
}

// 비밀번호 검증: 타이밍 공격 방지 (constant-time 비교)
async function verifyPassword(password, email, storedHash, storedSalt) {
  let computedHash;
  if (storedSalt) {
    computedHash = await hashPasswordWithSalt(password, storedSalt);
  } else {
    computedHash = await hashPasswordLegacy(password, email);
  }
  // constant-time 비교
  const encoder = new TextEncoder();
  const a = encoder.encode(computedHash);
  const b = encoder.encode(storedHash);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

// ═══════════════════════════════════════════════════════════
// JWT 생성 / 검증 (HMAC-SHA256, Web Crypto API)
// ═══════════════════════════════════════════════════════════

// base64url: 바이너리(Latin1) 전용 — 시그니처 등
function bytesToBase64Url(uint8arr) {
  let binary = "";
  for (const b of uint8arr) binary += String.fromCharCode(b);
  return btoa(binary).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

// base64url: Unicode 문자열용 — JWT header/payload (한글 포함 가능)
function strToBase64Url(str) {
  const bytes = new TextEncoder().encode(str);
  return bytesToBase64Url(bytes);
}

function base64UrlToStr(b64) {
  const padded = b64.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

function base64UrlToBytes(b64) {
  const padded = b64.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function createJWT(payload, secret) {
  const header = { alg: "HS256", typ: "JWT" };
  const now = Math.floor(Date.now() / 1000);
  const fullPayload = {
    ...payload,
    iat: now,
    exp: now + 90 * 24 * 60 * 60, // 90일
    jti: crypto.randomUUID(),
  };

  const encoder = new TextEncoder();
  const headerB64 = strToBase64Url(JSON.stringify(header));
  const payloadB64 = strToBase64Url(JSON.stringify(fullPayload));
  const data = `${headerB64}.${payloadB64}`;

  const key = await crypto.subtle.importKey(
    "raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(data));
  const sigB64 = bytesToBase64Url(new Uint8Array(sig));

  return `${data}.${sigB64}`;
}

async function verifyJWT(token, secret) {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("Invalid token format");
  const [headerB64, payloadB64, sigB64] = parts;

  const encoder = new TextEncoder();
  const data = `${headerB64}.${payloadB64}`;

  const key = await crypto.subtle.importKey(
    "raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]
  );
  const sigBytes = base64UrlToBytes(sigB64);
  const valid = await crypto.subtle.verify("HMAC", key, sigBytes, encoder.encode(data));
  if (!valid) throw new Error("Invalid signature");

  const payload = JSON.parse(base64UrlToStr(payloadB64));
  if (payload.exp < Date.now() / 1000) throw new Error("Token expired");

  return payload;
}

// ═══════════════════════════════════════════════════════════
// 인증 헬퍼
// ═══════════════════════════════════════════════════════════

async function extractUser(request, env) {
  const auth = request.headers.get("Authorization");
  if (!auth || !auth.startsWith("Bearer ")) return null;
  try {
    const payload = await verifyJWT(auth.slice(7), env.JWT_SECRET);
    // KV에서 현재 사용자 active 상태 확인 (비활성화 즉시 차단)
    const raw = await env.AUTH.get(`user:${payload.sub}`);
    if (!raw) return null;
    const user = JSON.parse(raw);
    if (!user.active) return null;
    return payload;
  } catch {
    return null;
  }
}

async function requireAdmin(request, env) {
  const user = await extractUser(request, env);
  if (!user) return { error: "인증이 필요합니다", status: 401 };
  if (user.role !== "admin") return { error: "관리자 권한이 필요합니다", status: 403 };
  return { user };
}

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

// ═══════════════════════════════════════════════════════════
// 로그 기록
// ═══════════════════════════════════════════════════════════

async function writeLog(env, email, action, request) {
  const now = new Date();
  const yyyymmdd = now.toISOString().slice(0, 10).replace(/-/g, "");
  const ts = now.getTime();
  const key = `log:${yyyymmdd}:${ts}:${email}`;
  const entry = {
    email,
    action,
    ip: request.headers.get("CF-Connecting-IP") || "unknown",
    userAgent: (request.headers.get("User-Agent") || "").slice(0, 200),
    timestamp: now.toISOString(),
  };
  await env.AUTH.put(key, JSON.stringify(entry), { expirationTtl: 90 * 24 * 60 * 60 }); // 90일 보관
}

// ═══════════════════════════════════════════════════════════
// 로그인 실패 잠금 (5회 → 15분)
// ═══════════════════════════════════════════════════════════

async function checkLockout(env, email) {
  const raw = await env.AUTH.get(`lockout:${email}`);
  if (!raw) return { locked: false, count: 0 };
  const data = JSON.parse(raw);
  if (data.lockedUntil && new Date(data.lockedUntil) > new Date()) {
    return { locked: true, count: data.count, lockedUntil: data.lockedUntil };
  }
  return { locked: false, count: data.count || 0 };
}

async function recordLoginFailure(env, email) {
  const { count } = await checkLockout(env, email);
  const newCount = count + 1;
  const data = { count: newCount };
  if (newCount >= 5) {
    data.lockedUntil = new Date(Date.now() + 15 * 60 * 1000).toISOString();
  }
  await env.AUTH.put(`lockout:${email}`, JSON.stringify(data), { expirationTtl: 15 * 60 }); // 15분 TTL
}

async function clearLockout(env, email) {
  await env.AUTH.delete(`lockout:${email}`);
}

// ═══════════════════════════════════════════════════════════
// POST /login
// ═══════════════════════════════════════════════════════════

async function handleLogin(body, env, request, cors) {
  const { email, password } = body;
  if (!email || !password) return json({ error: "이메일과 비밀번호를 입력해주세요" }, 400, cors);

  const normalizedEmail = email.trim().toLowerCase();

  // 잠금 체크
  const lockout = await checkLockout(env, normalizedEmail);
  if (lockout.locked) {
    return json({ error: "로그인 시도 횟수 초과. 15분 후 다시 시도해주세요.", lockedUntil: lockout.lockedUntil }, 423, cors);
  }

  // 사용자 조회
  const raw = await env.AUTH.get(`user:${normalizedEmail}`);
  if (!raw) {
    await recordLoginFailure(env, normalizedEmail);
    await writeLog(env, normalizedEmail, "login_fail", request);
    return json({ error: "이메일 또는 비밀번호가 올바르지 않습니다" }, 401, cors);
  }

  const user = JSON.parse(raw);

  // 활성 체크
  if (!user.active) {
    return json({ error: "비활성화된 계정입니다. 관리자에게 문의하세요." }, 403, cors);
  }

  // 비밀번호 검증 (랜덤 솔트 또는 레거시 결정론적 솔트)
  const valid = await verifyPassword(password, normalizedEmail, user.passwordHash, user.salt);
  if (!valid) {
    await recordLoginFailure(env, normalizedEmail);
    await writeLog(env, normalizedEmail, "login_fail", request);
    return json({ error: "이메일 또는 비밀번호가 올바르지 않습니다" }, 401, cors);
  }

  // 성공 → 잠금 해제 + JWT 발급
  await clearLockout(env, normalizedEmail);

  const token = await createJWT({
    sub: user.email,
    name: user.name,
    role: user.role,
  }, env.JWT_SECRET);

  // lastLogin 갱신
  user.lastLogin = new Date().toISOString();
  await env.AUTH.put(`user:${normalizedEmail}`, JSON.stringify(user));

  // 로그 기록
  await writeLog(env, normalizedEmail, "login", request);

  return json({
    success: true,
    token,
    user: { email: user.email, name: user.name, role: user.role },
    mustChangePassword: user.mustChangePassword || false,
  }, 200, cors);
}

// ═══════════════════════════════════════════════════════════
// POST /change-password
// ═══════════════════════════════════════════════════════════

async function handleChangePassword(body, env, request, cors) {
  const jwtUser = await extractUser(request, env);
  if (!jwtUser) return json({ error: "인증이 필요합니다" }, 401, cors);

  const { currentPassword, newPassword } = body;
  if (!currentPassword || !newPassword) return json({ error: "현재 비밀번호와 새 비밀번호를 입력해주세요" }, 400, cors);
  if (newPassword.length < 6) return json({ error: "새 비밀번호는 6자 이상이어야 합니다" }, 400, cors);

  const email = jwtUser.sub;
  const raw = await env.AUTH.get(`user:${email}`);
  if (!raw) return json({ error: "사용자를 찾을 수 없습니다" }, 404, cors);

  const user = JSON.parse(raw);
  const valid = await verifyPassword(currentPassword, email, user.passwordHash, user.salt);
  if (!valid) return json({ error: "현재 비밀번호가 올바르지 않습니다" }, 401, cors);

  const { hash, salt } = await hashPasswordNew(newPassword);
  user.passwordHash = hash;
  user.salt = salt;
  user.mustChangePassword = false;
  await env.AUTH.put(`user:${email}`, JSON.stringify(user));

  await writeLog(env, email, "password_change", request);

  return json({ success: true }, 200, cors);
}

// ═══════════════════════════════════════════════════════════
// GET /verify
// ═══════════════════════════════════════════════════════════

async function handleVerify(env, request, cors) {
  const jwtUser = await extractUser(request, env);
  if (!jwtUser) return json({ error: "유효하지 않은 토큰입니다" }, 401, cors);

  return json({
    success: true,
    user: { email: jwtUser.sub, name: jwtUser.name, role: jwtUser.role },
  }, 200, cors);
}

// ═══════════════════════════════════════════════════════════
// POST /admin/create-user
// ═══════════════════════════════════════════════════════════

async function handleCreateUser(body, env, request, cors) {
  const auth = await requireAdmin(request, env);
  if (auth.error) return json({ error: auth.error }, auth.status, cors);

  const { email, name, password, role } = body;
  if (!email || !name || !password) return json({ error: "이메일, 이름, 비밀번호는 필수입니다" }, 400, cors);
  if (!["admin", "editor"].includes(role)) return json({ error: "role은 admin 또는 editor여야 합니다" }, 400, cors);
  if (password.length < 6) return json({ error: "비밀번호는 6자 이상이어야 합니다" }, 400, cors);

  const normalizedEmail = email.trim().toLowerCase();
  const existing = await env.AUTH.get(`user:${normalizedEmail}`);
  if (existing) return json({ error: "이미 존재하는 이메일입니다" }, 409, cors);

  const { hash: passwordHash, salt } = await hashPasswordNew(password);
  const newUser = {
    email: normalizedEmail,
    passwordHash,
    salt,
    name: name.trim(),
    role,
    createdAt: new Date().toISOString(),
    lastLogin: null,
    mustChangePassword: true,
    active: true,
  };

  await env.AUTH.put(`user:${normalizedEmail}`, JSON.stringify(newUser));
  await writeLog(env, auth.user.sub, `create_user:${normalizedEmail}`, request);

  return json({ success: true, email: normalizedEmail, name: newUser.name, role }, 200, cors);
}

// ═══════════════════════════════════════════════════════════
// POST /admin/update-user
// ═══════════════════════════════════════════════════════════

async function handleUpdateUser(body, env, request, cors) {
  const auth = await requireAdmin(request, env);
  if (auth.error) return json({ error: auth.error }, auth.status, cors);

  const { email, name, role, active } = body;
  if (!email) return json({ error: "이메일은 필수입니다" }, 400, cors);

  const normalizedEmail = email.trim().toLowerCase();
  const raw = await env.AUTH.get(`user:${normalizedEmail}`);
  if (!raw) return json({ error: "사용자를 찾을 수 없습니다" }, 404, cors);

  const user = JSON.parse(raw);
  if (name !== undefined) user.name = name.trim();
  if (role !== undefined && ["admin", "editor"].includes(role)) user.role = role;
  if (active !== undefined) user.active = !!active;

  await env.AUTH.put(`user:${normalizedEmail}`, JSON.stringify(user));
  await writeLog(env, auth.user.sub, `update_user:${normalizedEmail}`, request);

  return json({ success: true }, 200, cors);
}

// ═══════════════════════════════════════════════════════════
// POST /admin/delete-user
// ═══════════════════════════════════════════════════════════

async function handleDeleteUser(body, env, request, cors) {
  const auth = await requireAdmin(request, env);
  if (auth.error) return json({ error: auth.error }, auth.status, cors);

  const { email } = body;
  if (!email) return json({ error: "이메일은 필수입니다" }, 400, cors);

  const normalizedEmail = email.trim().toLowerCase();

  // 자기 자신 삭제 불가
  if (normalizedEmail === auth.user.sub) {
    return json({ error: "자기 자신은 삭제할 수 없습니다" }, 400, cors);
  }

  const existing = await env.AUTH.get(`user:${normalizedEmail}`);
  if (!existing) return json({ error: "사용자를 찾을 수 없습니다" }, 404, cors);

  await env.AUTH.delete(`user:${normalizedEmail}`);
  await writeLog(env, auth.user.sub, `delete_user:${normalizedEmail}`, request);

  return json({ success: true }, 200, cors);
}

// ═══════════════════════════════════════════════════════════
// POST /admin/reset-password
// ═══════════════════════════════════════════════════════════

async function handleResetPassword(body, env, request, cors) {
  const auth = await requireAdmin(request, env);
  if (auth.error) return json({ error: auth.error }, auth.status, cors);

  const { email, newPassword } = body;
  if (!email || !newPassword) return json({ error: "이메일과 새 비밀번호는 필수입니다" }, 400, cors);
  if (newPassword.length < 6) return json({ error: "비밀번호는 6자 이상이어야 합니다" }, 400, cors);

  const normalizedEmail = email.trim().toLowerCase();
  const raw = await env.AUTH.get(`user:${normalizedEmail}`);
  if (!raw) return json({ error: "사용자를 찾을 수 없습니다" }, 404, cors);

  const user = JSON.parse(raw);
  const { hash, salt } = await hashPasswordNew(newPassword);
  user.passwordHash = hash;
  user.salt = salt;
  user.mustChangePassword = true;

  await env.AUTH.put(`user:${normalizedEmail}`, JSON.stringify(user));
  await writeLog(env, auth.user.sub, `reset_password:${normalizedEmail}`, request);

  return json({ success: true }, 200, cors);
}

// ═══════════════════════════════════════════════════════════
// GET /admin/users
// ═══════════════════════════════════════════════════════════

async function handleListUsers(env, request, cors) {
  const auth = await requireAdmin(request, env);
  if (auth.error) return json({ error: auth.error }, auth.status, cors);

  const list = await env.AUTH.list({ prefix: "user:" });
  const users = [];
  for (const key of list.keys) {
    const raw = await env.AUTH.get(key.name);
    if (raw) {
      const user = JSON.parse(raw);
      // passwordHash 제외
      users.push({
        email: user.email,
        name: user.name,
        role: user.role,
        createdAt: user.createdAt,
        lastLogin: user.lastLogin,
        mustChangePassword: user.mustChangePassword,
        active: user.active,
      });
    }
  }

  return json({ success: true, users }, 200, cors);
}

// ═══════════════════════════════════════════════════════════
// GET /admin/logs
// ═══════════════════════════════════════════════════════════

async function handleListLogs(env, request, cors) {
  const auth = await requireAdmin(request, env);
  if (auth.error) return json({ error: auth.error }, auth.status, cors);

  const url = new URL(request.url);
  const days = parseInt(url.searchParams.get("days")) || 7;

  // 최근 N일의 로그를 조회
  const logs = [];
  const now = new Date();
  for (let i = 0; i < days; i++) {
    const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
    const yyyymmdd = d.toISOString().slice(0, 10).replace(/-/g, "");
    const list = await env.AUTH.list({ prefix: `log:${yyyymmdd}:` });
    for (const key of list.keys) {
      const raw = await env.AUTH.get(key.name);
      if (raw) logs.push(JSON.parse(raw));
    }
  }

  // 최신순 정렬
  logs.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

  return json({ success: true, logs, days }, 200, cors);
}

// ═══════════════════════════════════════════════════════════
// 메인 라우터
// ═══════════════════════════════════════════════════════════

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const cors = getCorsHeaders(request);

    // CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }

    // KV 체크
    if (!env.AUTH) {
      return json({ error: "KV not configured" }, 500, cors);
    }

    try {
      // ── GET 엔드포인트 ──
      if (request.method === "GET") {
        if (path === "/verify") return await handleVerify(env, request, cors);
        if (path === "/admin/users") return await handleListUsers(env, request, cors);
        if (path === "/admin/logs") return await handleListLogs(env, request, cors);
        if (path === "/health") return json({ status: "ok", timestamp: new Date().toISOString() }, 200, cors);
        return json({ error: "Not found" }, 404, cors);
      }

      // ── POST 엔드포인트 ──
      if (request.method === "POST") {
        const body = await request.json();

        if (path === "/login") return await handleLogin(body, env, request, cors);
        if (path === "/change-password") return await handleChangePassword(body, env, request, cors);
        if (path === "/admin/create-user") return await handleCreateUser(body, env, request, cors);
        if (path === "/admin/update-user") return await handleUpdateUser(body, env, request, cors);
        if (path === "/admin/delete-user") return await handleDeleteUser(body, env, request, cors);
        if (path === "/admin/reset-password") return await handleResetPassword(body, env, request, cors);
        return json({ error: "Not found" }, 404, cors);
      }

      return json({ error: "Method not allowed" }, 405, cors);

    } catch (err) {
      console.error("Auth Worker error:", err);
      return json({ error: "서버 내부 오류가 발생했습니다" }, 500, cors);
    }
  },
};
