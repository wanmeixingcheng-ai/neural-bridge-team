import { createHmac, randomBytes, timingSafeEqual } from "crypto";
import { redis } from "../../../lib/externalStore.mjs";

export const SESSION_COOKIE = "nb_session";
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;
export const REMEMBER_SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;

function secret() {
  return process.env.APP_AUTH_SECRET || "";
}

function passwordVersion() {
  const password = process.env.APP_PASSWORD || "";
  const key = secret();
  if (!password || !key) return "";
  return createHmac("sha256", key).update(password).digest("base64url");
}

function base64UrlEncode(value) {
  return Buffer.from(value).toString("base64url");
}

function base64UrlDecode(value) {
  return Buffer.from(value, "base64url").toString("utf8");
}

function parseSessionToken(token) {
  if (!token || !token.includes(".")) return null;
  const [value, signature, ...rest] = token.split(".");
  if (rest.length || !value || !signature) return null;
  return { value, signature };
}

function tokenHash(token) {
  const key = secret();
  if (!key || !token) return "";
  return createHmac("sha256", key).update(token).digest("base64url");
}

function decodeSessionPayload(value) {
  return JSON.parse(base64UrlDecode(value));
}

export function signSession(value) {
  const key = secret();
  if (!key) {
    throw new Error("APP_AUTH_SECRET is required for sessions");
  }
  return createHmac("sha256", key).update(value).digest("base64url");
}

export function createSessionToken(ttlSeconds = SESSION_TTL_SECONDS) {
  const now = Math.floor(Date.now() / 1000);
  const maxAge = Number.isFinite(ttlSeconds) && ttlSeconds > 0
    ? Math.min(Math.floor(ttlSeconds), REMEMBER_SESSION_TTL_SECONDS)
    : SESSION_TTL_SECONDS;
  const value = base64UrlEncode(JSON.stringify({
    v: 1,
    iat: now,
    exp: now + maxAge,
    pwd: passwordVersion(),
    nonce: randomBytes(32).toString("base64url"),
  }));
  return `${value}.${signSession(value)}`;
}

export function verifySessionToken(token) {
  const parsed = parseSessionToken(token);
  if (!parsed) return false;
  const { value, signature } = parsed;
  let expected;
  try {
    expected = signSession(value);
  } catch {
    return false;
  }
  const signatureBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (signatureBuffer.length !== expectedBuffer.length) return false;
  try {
    if (!timingSafeEqual(signatureBuffer, expectedBuffer)) return false;
  } catch {
    return false;
  }
  try {
    const payload = decodeSessionPayload(value);
    const now = Math.floor(Date.now() / 1000);
    return payload?.v === 1 &&
      typeof payload.nonce === "string" &&
      payload.nonce.length >= 32 &&
      typeof payload.pwd === "string" &&
      payload.pwd === passwordVersion() &&
      Number.isFinite(payload.iat) &&
      Number.isFinite(payload.exp) &&
      payload.iat <= now &&
      payload.exp > now;
  } catch {
    return false;
  }
}

export async function persistSessionToken(token, ttlSeconds = SESSION_TTL_SECONDS, metadata = {}) {
  const store = redis();
  if (!store) return false;
  const parsed = parseSessionToken(token);
  if (!parsed) return false;
  let payload;
  try {
    payload = decodeSessionPayload(parsed.value);
  } catch {
    return false;
  }
  const ttl = Number.isFinite(ttlSeconds) && ttlSeconds > 0
    ? Math.min(Math.floor(ttlSeconds), REMEMBER_SESSION_TTL_SECONDS)
    : SESSION_TTL_SECONDS;
  await store.set(`session:${tokenHash(token)}`, {
    v: 1,
    nonce: payload.nonce,
    iat: payload.iat,
    exp: payload.exp,
    ...metadata,
  }, { ex: ttl });
  return true;
}

export async function revokeSessionToken(token) {
  const store = redis();
  if (!store || !token) return false;
  await store.del(`session:${tokenHash(token)}`);
  return true;
}

export function isAuthenticated(request) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  return verifySessionToken(token);
}

export async function isAuthenticatedAsync(request) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (!verifySessionToken(token)) return false;
  const store = redis();
  if (!store) return true;
  const record = await store.get(`session:${tokenHash(token)}`);
  return Boolean(record);
}

export function sessionCookieOptions(maxAge = SESSION_TTL_SECONDS) {
  const ttl = Number.isFinite(maxAge) && maxAge > 0
    ? Math.min(Math.floor(maxAge), REMEMBER_SESSION_TTL_SECONDS)
    : SESSION_TTL_SECONDS;
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: ttl,
  };
}
