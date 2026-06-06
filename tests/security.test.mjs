import test from "node:test";
import assert from "node:assert/strict";

import {
  createSessionToken,
  verifySessionToken,
  SESSION_COOKIE,
} from "../app/api/auth/session.js";
import { POST as chatPost, sanitizeModelText } from "../app/api/chat/route.js";
import { checkRateLimit } from "../lib/rateLimit.mjs";
import { containsSensitiveSecret } from "../lib/secretPolicy.mjs";

test("session tokens require an independent auth secret", () => {
  const previousSecret = process.env.APP_AUTH_SECRET;
  const previousPassword = process.env.APP_PASSWORD;
  delete process.env.APP_AUTH_SECRET;
  process.env.APP_PASSWORD = "owner-password";

  assert.throws(() => createSessionToken(), /APP_AUTH_SECRET/);

  if (previousSecret === undefined) delete process.env.APP_AUTH_SECRET;
  else process.env.APP_AUTH_SECRET = previousSecret;
  if (previousPassword === undefined) delete process.env.APP_PASSWORD;
  else process.env.APP_PASSWORD = previousPassword;
});

test("changing APP_PASSWORD invalidates existing session tokens", () => {
  const previousSecret = process.env.APP_AUTH_SECRET;
  const previousPassword = process.env.APP_PASSWORD;
  process.env.APP_AUTH_SECRET = "test-auth-secret-at-least-32-bytes";
  process.env.APP_PASSWORD = "old-owner-password";

  const token = createSessionToken();
  assert.equal(verifySessionToken(token), true);

  process.env.APP_PASSWORD = "new-owner-password";
  assert.equal(verifySessionToken(token), false);

  if (previousSecret === undefined) delete process.env.APP_AUTH_SECRET;
  else process.env.APP_AUTH_SECRET = previousSecret;
  if (previousPassword === undefined) delete process.env.APP_PASSWORD;
  else process.env.APP_PASSWORD = previousPassword;
});

test("secret detector blocks common credentials before external transit", () => {
  assert.equal(containsSensitiveSecret("normal product task without credentials"), false);
  assert.equal(containsSensitiveSecret("GITHUB_TOKEN=ghp_abcdefghijklmnopqrstuvwxyz1234567890"), true);
  assert.equal(containsSensitiveSecret("-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----"), true);
  assert.equal(containsSensitiveSecret("api_key: sk-proj-abcdefghijklmnopqrstuvwxyz123456"), true);
});

test("chat blocks secret-like content before model dispatch", async () => {
  const previousSecret = process.env.APP_AUTH_SECRET;
  const previousPassword = process.env.APP_PASSWORD;
  const previousAnthropic = process.env.ANTHROPIC_API_KEY;
  process.env.APP_AUTH_SECRET = "test-auth-secret-at-least-32-bytes";
  process.env.APP_PASSWORD = "owner-password";
  process.env.ANTHROPIC_API_KEY = "test-api-key-that-should-not-be-used";
  const token = createSessionToken();
  let fetchCalled = false;
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    fetchCalled = true;
    throw new Error("model provider should not be called");
  };

  try {
    const request = new Request("https://neural-bridge.local/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        modelKey: "claude",
        systemPrompt: "You are ARIA.",
        messages: [
          {
            role: "user",
            text: "Please use this token: ghp_abcdefghijklmnopqrstuvwxyz1234567890",
          },
        ],
      }),
    });
    request.cookies = {
      get(name) {
        return name === SESSION_COOKIE ? { value: token } : undefined;
      },
    };

    const response = await chatPost(request);
    const payload = await response.json();

    assert.equal(response.status, 400);
    assert.equal(payload.forwarded, false);
    assert.equal(fetchCalled, false);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousSecret === undefined) delete process.env.APP_AUTH_SECRET;
    else process.env.APP_AUTH_SECRET = previousSecret;
    if (previousPassword === undefined) delete process.env.APP_PASSWORD;
    else process.env.APP_PASSWORD = previousPassword;
    if (previousAnthropic === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = previousAnthropic;
  }
});

test("chat sanitization blocks model prompt-analysis leakage", () => {
  const leaked = [
    '[ARIA · 总调度]',
    'The user said "你好" (Hello).',
    'The user previously interacted, and the last assistant response was "ARIA 已启动自动调度...".',
    '* Rule 1: Only Chinese.',
    '* Constraint: "Do not introduce yourself".',
    '* Total Task is "你好".',
    'Since the user said "你好", I should acknowledge the greeting.',
  ].join("\n");

  const sanitized = sanitizeModelText(leaked, "zh");

  assert.equal(sanitized, "请发送具体任务指令或上传相关文档。");
  assert.equal(sanitized.includes("The user said"), false);
  assert.equal(sanitized.includes("Rule 1"), false);
  assert.equal(sanitized.includes("Total Task"), false);
});

test("chat greetings are not answered by a local canned shortcut", async () => {
  const previousSecret = process.env.APP_AUTH_SECRET;
  const previousPassword = process.env.APP_PASSWORD;
  const previousAnthropic = process.env.ANTHROPIC_API_KEY;
  process.env.APP_AUTH_SECRET = "test-auth-secret-at-least-32-bytes";
  process.env.APP_PASSWORD = "owner-password";
  delete process.env.ANTHROPIC_API_KEY;
  const token = createSessionToken();

  try {
    const request = new Request("https://neural-bridge.local/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        modelKey: "claude",
        systemPrompt: "You are ARIA.",
        messages: [{ role: "user", text: "你好" }],
      }),
    });
    request.cookies = {
      get(name) {
        return name === SESSION_COOKIE ? { value: token } : undefined;
      },
    };

    const response = await chatPost(request);
    const payload = await response.json();

    assert.equal(response.status, 500);
    assert.equal(payload.text, undefined);
    assert.equal(payload.error, "ANTHROPIC_API_KEY is not configured");
  } finally {
    if (previousSecret === undefined) delete process.env.APP_AUTH_SECRET;
    else process.env.APP_AUTH_SECRET = previousSecret;
    if (previousPassword === undefined) delete process.env.APP_PASSWORD;
    else process.env.APP_PASSWORD = previousPassword;
    if (previousAnthropic === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = previousAnthropic;
  }
});

test("rate limiter enforces namespace and window limits", () => {
  const request = {
    headers: {
      get(name) {
        if (name === "x-forwarded-for") return "203.0.113.10";
        return "";
      },
    },
  };
  assert.equal(checkRateLimit({ request, namespace:"test-security", limit:2, windowMs:1000, now:1000 }), true);
  assert.equal(checkRateLimit({ request, namespace:"test-security", limit:2, windowMs:1000, now:1100 }), true);
  assert.equal(checkRateLimit({ request, namespace:"test-security", limit:2, windowMs:1000, now:1200 }), false);
  assert.equal(checkRateLimit({ request, namespace:"test-security", limit:2, windowMs:1000, now:2101 }), true);
});
