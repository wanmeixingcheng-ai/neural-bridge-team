import { redis } from "./externalStore.mjs";

const buckets = globalThis.__nbRateLimitBuckets || new Map();
globalThis.__nbRateLimitBuckets = buckets;

export function requestKey(request) {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || request.headers.get("x-real-ip") || "unknown";
}

export function checkRateLimit({ request, namespace, limit, windowMs, now = Date.now() }) {
  const key = `${namespace}:${requestKey(request)}`;
  const bucket = buckets.get(key);
  if (!bucket || now - bucket.startedAt > windowMs) {
    buckets.set(key, { startedAt: now, count: 1 });
    return true;
  }
  bucket.count += 1;
  return bucket.count <= limit;
}

export async function checkRateLimitAsync({ request, namespace, limit, windowMs }) {
  const store = redis();
  if (!store) {
    return checkRateLimit({ request, namespace, limit, windowMs });
  }
  const key = `rate:${namespace}:${requestKey(request)}`;
  const count = await store.incr(key);
  if (count === 1) {
    await store.pexpire(key, windowMs);
  }
  return count <= limit;
}

export function rateLimitResponse(message = "Rate limit exceeded") {
  return Response.json({ ok: false, error: message }, { status: 429 });
}
