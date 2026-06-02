import { createHmac, randomBytes, timingSafeEqual } from "crypto";

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
  if (!token || !token.includes(".")) return false;
  const [value, signature, ...rest] = token.split(".");
  if (rest.length) return false;
  if (!value || !signature) return false;
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
    const payload = JSON.parse(base64UrlDecode(value));
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

export function isAuthenticated(request) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  return verifySessionToken(token);
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
