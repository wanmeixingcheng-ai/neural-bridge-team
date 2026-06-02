import http from "node:http";
import { spawn } from "node:child_process";
import { createHash, timingSafeEqual } from "node:crypto";

const host = process.env.CLAUDE_BRIDGE_HOST || "127.0.0.1";
const port = Number(process.env.CLAUDE_BRIDGE_PORT || 8787);
const token = process.env.CLAUDE_BRIDGE_TOKEN || "";
const maxBodyBytes = Number(process.env.CLAUDE_BRIDGE_MAX_BODY_BYTES || 512_000);
const rateWindowMs = Number(process.env.CLAUDE_BRIDGE_RATE_WINDOW_MS || 60_000);
const rateLimit = Number(process.env.CLAUDE_BRIDGE_RATE_LIMIT || 20);
const allowedOriginHosts = new Set((process.env.CLAUDE_BRIDGE_ALLOWED_ORIGINS || "http://127.0.0.1,http://localhost,https://neural-bridge-team.vercel.app")
  .split(",")
  .map(value => value.trim())
  .filter(Boolean)
  .map(value => {
    try { return new URL(value).hostname; } catch { return value; }
  }));
const allowedOriginSchemes = new Set(["http:", "https:"]);
const rateBuckets = new Map();

if (!token || token.length < 16) {
  console.error("CLAUDE_BRIDGE_TOKEN with at least 16 characters is required. Refusing to start without token protection.");
  process.exit(1);
}

function parseAllowedOrigin(origin) {
  if (!origin) return null;
  try {
    const parsed = new URL(origin);
    if (!allowedOriginSchemes.has(parsed.protocol)) return false;
    if (!allowedOriginHosts.has(parsed.hostname)) return false;
    if (parsed.hostname === "neural-bridge-team.vercel.app" && parsed.protocol !== "https:") return false;
    if ((parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost") && parsed.protocol !== "http:") return false;
    return parsed;
  } catch {
    return false;
  }
}

function isAllowedOrigin(origin) {
  return !!parseAllowedOrigin(origin);
}

function isValidToken(value) {
  const left = createHash("sha256").update(`${value || ""}`).digest();
  const right = createHash("sha256").update(token).digest();
  return timingSafeEqual(left, right);
}

function checkRateLimit(request) {
  const forwarded = `${request.headers["x-forwarded-for"] || ""}`.split(",")[0].trim();
  const key = forwarded || request.socket.remoteAddress || "unknown";
  const now = Date.now();
  const bucket = rateBuckets.get(key);
  if (!bucket || now - bucket.startedAt > rateWindowMs) {
    rateBuckets.set(key, { startedAt: now, count: 1 });
    return true;
  }
  bucket.count += 1;
  return bucket.count <= rateLimit;
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", chunk => {
      body += chunk;
      if (body.length > maxBodyBytes) {
        request.destroy();
        reject(new Error("Request too large"));
      }
    });
    request.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error("Invalid JSON"));
      }
    });
    request.on("error", reject);
  });
}

function send(request, response, status, data) {
  const origin = request.headers.origin;
  const headers = {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Claude-Bridge-Token",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Vary": "Origin",
  };
  if (origin && isAllowedOrigin(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
  }
  response.writeHead(status, headers);
  response.end(JSON.stringify(data));
}

function buildPrompt(messages = []) {
  return messages
    .filter(message => message.role === "user" || message.role === "ai")
    .map(message => `${message.role === "ai" ? "assistant" : "user"}: ${message.text || ""}`)
    .join("\n");
}

function runClaude({ systemPrompt, messages, options = {} }) {
  return new Promise((resolve, reject) => {
    const prompt = buildPrompt(messages);
    const effort = options.reasoningLevel === "high" ? "high" : options.reasoningLevel === "low" ? "low" : "medium";
    const args = [
      "--print",
      "--model", "sonnet",
      "--effort", effort,
      "--output-format", "text",
      "--no-session-persistence",
      "--system-prompt", systemPrompt || "",
    ];
    const env = { ...process.env };
    delete env.ANTHROPIC_API_KEY;

    const child = spawn("claude", args, {
      shell: process.platform === "win32",
      env,
      windowsHide: true,
    });

    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error("Claude Bridge timeout"));
    }, Number(process.env.CLAUDE_BRIDGE_TIMEOUT_MS || 120000));

    child.stdout.on("data", chunk => { stdout += chunk.toString(); });
    child.stderr.on("data", chunk => { stderr += chunk.toString(); });
    child.on("error", error => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", code => {
      clearTimeout(timeout);
      if (code === 0 && stdout.trim()) {
        resolve(stdout.trim());
        return;
      }
      reject(new Error(stderr.trim() || `Claude exited with code ${code}`));
    });
    child.stdin.write(prompt);
    child.stdin.end();
  });
}

const server = http.createServer(async (request, response) => {
  const hasAllowedOrigin = isAllowedOrigin(request.headers.origin);
  if (!hasAllowedOrigin) {
    send(request, response, 403, { error: "Origin is not allowed" });
    return;
  }
  if (request.method === "OPTIONS") {
    send(request, response, 200, { ok: true });
    return;
  }
  if (request.method === "GET" && request.url === "/health") {
    send(request, response, 200, { ok: true, service: "neural-bridge-claude-code-bridge" });
    return;
  }
  if (request.method !== "POST" || request.url !== "/chat") {
    send(request, response, 404, { error: "Not found" });
    return;
  }
  if (!checkRateLimit(request)) {
    send(request, response, 429, { error: "Claude Bridge rate limit exceeded" });
    return;
  }
  if (!isValidToken(request.headers["x-claude-bridge-token"])) {
    send(request, response, 401, { error: "Invalid Claude Bridge token" });
    return;
  }

  try {
    const payload = await readJson(request);
    const text = await runClaude(payload);
    send(request, response, 200, { text });
  } catch (error) {
    send(request, response, 500, { error: error.message || "Claude Bridge request failed" });
  }
});

server.listen(port, host, () => {
  console.log(`Claude Bridge listening on http://${host}:${port}`);
  console.log("Token protection: enabled");
});
