import { isAuthenticatedAsync } from "../auth/session.js";
import { readJsonLimited, requestBodyTooLargeResponse } from "../../../lib/requestBody.mjs";
import { checkRateLimitAsync } from "../../../lib/rateLimit.mjs";
import { auditEvent } from "../../../lib/auditLog.mjs";
import { lookup } from "node:dns/promises";
import net from "node:net";

const FETCH_URL_MAX_REQUEST_BYTES = 8 * 1024;
const MAX_RESPONSE_BYTES = 1_000_000;
const FETCH_TIMEOUT_MS = 10000;
const RATE_WINDOW_MS = 60_000;
const RATE_LIMIT = 20;
function isBlockedIp(ip) {
  if (!ip) return true;
  if (ip === "::1" || ip === "0:0:0:0:0:0:0:1") return true;
  if (ip.startsWith("::ffff:")) return isBlockedIp(ip.slice(7));
  if (ip.includes(":")) {
    const lower = ip.toLowerCase();
    return lower === "::" ||
      lower.startsWith("fc") ||
      lower.startsWith("fd") ||
      lower.startsWith("fe80:") ||
      lower.startsWith("2001:db8:");
  }
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [a, b, c] = parts;
  return a === 0 ||
    a === 10 ||
    a === 127 ||
    a >= 224 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0 && c === 0) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 100 && b >= 64 && b <= 127);
}

async function validateFetchUrl(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("Invalid URL");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Only http and https URLs are allowed");
  }
  parsed.hash = "";
  parsed.username = "";
  parsed.password = "";
  const hostname = parsed.hostname.toLowerCase().replace(/\.$/, "");
  if (!hostname ||
      hostname === "localhost" ||
      hostname.endsWith(".localhost") ||
      hostname.endsWith(".local") ||
      hostname.endsWith(".internal") ||
      hostname.endsWith(".lan") ||
      hostname.endsWith(".home") ||
      hostname === "metadata.google.internal") {
    throw new Error("Local URLs are not allowed");
  }
  if (net.isIP(hostname)) {
    if (isBlockedIp(hostname)) throw new Error("Private or local IP addresses are not allowed");
    return parsed;
  }
  const records = await lookup(hostname, { all: true, verbatim: true });
  if (!records.length || records.some(record => isBlockedIp(record.address))) {
    throw new Error("Private or local network targets are not allowed");
  }
  return parsed;
}

function isAllowedContentType(contentType) {
  const value = `${contentType || ""}`.toLowerCase().split(";")[0].trim();
  return value === "text/html" ||
    value === "text/plain" ||
    value === "text/markdown" ||
    value === "application/json" ||
    value === "application/xml" ||
    value === "text/xml" ||
    value === "application/xhtml+xml" ||
    value.endsWith("+json") ||
    value.endsWith("+xml");
}

async function readLimitedText(response) {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_RESPONSE_BYTES) {
      await reader.cancel().catch(() => {});
      throw new Error("Response body is too large");
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks.map(chunk => Buffer.from(chunk))));
}

async function safeFetch(url) {
  let current = await validateFetchUrl(url);
  for (let redirectCount = 0; redirectCount <= 5; redirectCount += 1) {
    const res = await fetch(current, {
      headers: {
        "User-Agent": "NeuralBridge/1.0 (+https://neural-bridge-team.vercel.app)",
      },
      redirect: "manual",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (![301, 302, 303, 307, 308].includes(res.status)) {
      return { res, finalUrl: current };
    }
    const location = res.headers.get("location");
    if (!location) return { res, finalUrl: current };
    current = await validateFetchUrl(new URL(location, current).toString());
  }
  throw new Error("Too many redirects");
}

function extractText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, "\"")
    .replace(/\s+/g, " ")
    .trim();
}

export async function POST(request) {
  if (!await isAuthenticatedAsync(request)) {
    await auditEvent(request, { type:"fetch_url.auth_failed", status:"blocked" });
    return Response.json({ error: "未登录" }, { status: 401 });
  }
  if (!await checkRateLimitAsync({ request, namespace:"fetch-url", limit:RATE_LIMIT, windowMs:RATE_WINDOW_MS })) {
    await auditEvent(request, { type:"fetch_url.rate_limited", status:"blocked" });
    return Response.json({ error: "URL fetch rate limit exceeded" }, { status: 429 });
  }

  let body;
  try {
    body = await readJsonLimited(request, FETCH_URL_MAX_REQUEST_BYTES);
  } catch (error) {
    const response = requestBodyTooLargeResponse(error);
    if (response) return response;
    body = {};
  }
  const { url } = body;
  if (!url) {
    return Response.json({ error: "Invalid URL" }, { status: 400 });
  }

  try {
    const { res, finalUrl } = await safeFetch(url);
    if (!res.ok) {
      return Response.json({ error: `Fetch failed: ${res.status}` }, { status: 502 });
    }
    const contentType = res.headers.get("content-type") || "";
    if (!isAllowedContentType(contentType)) {
      return Response.json({ error: "Unsupported content type" }, { status: 415 });
    }
    const contentLength = Number(res.headers.get("content-length") || 0);
    if (contentLength > MAX_RESPONSE_BYTES) {
      return Response.json({ error: "Response body is too large" }, { status: 413 });
    }
    const raw = await readLimitedText(res);
    const text = contentType.includes("html") ? extractText(raw) : raw.replace(/\s+/g, " ").trim();
    await auditEvent(request, { type:"fetch_url.success", status:"ok", target:finalUrl.hostname });
    return Response.json({
      url: finalUrl.toString(),
      title: raw.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/\s+/g, " ").trim() || url,
      text: text.slice(0, 12000),
      truncated: text.length > 12000,
    });
  } catch {
    await auditEvent(request, { type:"fetch_url.failed", status:"failed" });
    return Response.json({ error: "URL fetch failed" }, { status: 500 });
  }
}
