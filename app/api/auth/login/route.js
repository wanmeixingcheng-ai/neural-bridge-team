import { NextResponse } from "next/server";
import { createHash, timingSafeEqual } from "crypto";
import {
  createSessionToken,
  persistSessionToken,
  REMEMBER_SESSION_TTL_SECONDS,
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
  sessionCookieOptions,
} from "../session.js";
import { auditEvent } from "../../../../lib/auditLog.mjs";
import { redis } from "../../../../lib/externalStore.mjs";

const LOGIN_WINDOW_MS = 10 * 60 * 1000;
const LOGIN_MAX_FAILURES = 5;
const loginFailures = globalThis.__nbLoginFailures || new Map();
globalThis.__nbLoginFailures = loginFailures;
const LOGIN_ERROR = "登录失败，请检查密码或稍后重试";

function requestKey(request) {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || request.headers.get("x-real-ip") || "unknown";
}

function failureBucket(key, now = Date.now()) {
  const current = loginFailures.get(key);
  if (!current || now - current.startedAt > LOGIN_WINDOW_MS) {
    return { startedAt: now, count: 0 };
  }
  return current;
}

function isRateLimited(key) {
  return failureBucket(key).count >= LOGIN_MAX_FAILURES;
}

function recordFailure(key) {
  const bucket = failureBucket(key);
  bucket.count += 1;
  loginFailures.set(key, bucket);
}

function clearFailures(key) {
  loginFailures.delete(key);
}

async function isGlobalFailureLimited(key) {
  const store = redis();
  if (!store) return false;
  const count = Number(await store.get(`login_fail:${key}`) || 0);
  return count >= LOGIN_MAX_FAILURES;
}

async function recordGlobalFailure(key) {
  const store = redis();
  if (!store) return false;
  const count = await store.incr(`login_fail:${key}`);
  if (count === 1) {
    await store.pexpire(`login_fail:${key}`, LOGIN_WINDOW_MS);
  }
  return true;
}

async function clearGlobalFailures(key) {
  const store = redis();
  if (!store) return false;
  await store.del(`login_fail:${key}`);
  return true;
}

function secureCompare(a, b) {
  const left = createHash("sha256").update(`${a || ""}`).digest();
  const right = createHash("sha256").update(`${b || ""}`).digest();
  return timingSafeEqual(left, right);
}

export async function POST(request) {
  const key = requestKey(request);
  if (await isGlobalFailureLimited(key) || isRateLimited(key)) {
    await auditEvent(request, { type:"auth.login.rate_limited", status:"blocked", target:key });
    return Response.json({ ok: false, error: LOGIN_ERROR }, { status: 429 });
  }

  const { password, remember } = await request.json().catch(() => ({}));
  const expected = process.env.APP_PASSWORD;

  if (!expected) {
    await auditEvent(request, { type:"auth.login.config_error", status:"failed" });
    return Response.json({ ok: false, error: "APP_PASSWORD is not configured" }, { status: 500 });
  }

  if (!password || !secureCompare(password, expected)) {
    recordFailure(key);
    await recordGlobalFailure(key);
    await auditEvent(request, { type:"auth.login.failed", status:"failed", target:key });
    return Response.json({ ok: false, error: LOGIN_ERROR }, { status: 401 });
  }

  clearFailures(key);
  await clearGlobalFailures(key);
  const sessionTtl = remember ? REMEMBER_SESSION_TTL_SECONDS : SESSION_TTL_SECONDS;
  const response = NextResponse.json({ ok: true });
  let token;
  try {
    token = createSessionToken(sessionTtl);
    await persistSessionToken(token, sessionTtl, { actor:"owner", ip:key });
  } catch {
    await auditEvent(request, { type:"auth.login.session_error", status:"failed", target:key });
    return Response.json({ ok: false, error: "APP_AUTH_SECRET is not configured" }, { status: 500 });
  }
  await auditEvent(request, { type:"auth.login.success", status:"ok", actor:"owner", target:key });
  response.cookies.set(SESSION_COOKIE, token, sessionCookieOptions(sessionTtl));
  return response;
}
