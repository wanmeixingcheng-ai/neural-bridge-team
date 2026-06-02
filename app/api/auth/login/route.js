import { NextResponse } from "next/server";
import { createHash, timingSafeEqual } from "crypto";
import {
  createSessionToken,
  REMEMBER_SESSION_TTL_SECONDS,
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
  sessionCookieOptions,
} from "../session.js";

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

function secureCompare(a, b) {
  const left = createHash("sha256").update(`${a || ""}`).digest();
  const right = createHash("sha256").update(`${b || ""}`).digest();
  return timingSafeEqual(left, right);
}

export async function POST(request) {
  const key = requestKey(request);
  if (isRateLimited(key)) {
    return Response.json({ ok: false, error: LOGIN_ERROR }, { status: 429 });
  }

  const { password, remember } = await request.json().catch(() => ({}));
  const expected = process.env.APP_PASSWORD;

  if (!expected) {
    return Response.json({ ok: false, error: "APP_PASSWORD is not configured" }, { status: 500 });
  }

  if (!password || !secureCompare(password, expected)) {
    recordFailure(key);
    return Response.json({ ok: false, error: LOGIN_ERROR }, { status: 401 });
  }

  clearFailures(key);
  const sessionTtl = remember ? REMEMBER_SESSION_TTL_SECONDS : SESSION_TTL_SECONDS;
  const response = NextResponse.json({ ok: true });
  let token;
  try {
    token = createSessionToken(sessionTtl);
  } catch {
    return Response.json({ ok: false, error: "APP_AUTH_SECRET is not configured" }, { status: 500 });
  }
  response.cookies.set(SESSION_COOKIE, token, sessionCookieOptions(sessionTtl));
  return response;
}
