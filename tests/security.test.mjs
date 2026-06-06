import test from "node:test";
import assert from "node:assert/strict";

import {
  createSessionToken,
  verifySessionToken,
} from "../app/api/auth/session.js";
import { auditEvent } from "../lib/auditLog.mjs";
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

test("audit events expose disabled persistence in production", async () => {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousDatabaseUrl = process.env.DATABASE_URL;
  const previousWarn = console.warn;
  process.env.NODE_ENV = "production";
  delete process.env.DATABASE_URL;
  const warnings = [];
  console.warn = (...args) => warnings.push(args.join(" "));

  try {
    const request = {
      headers: {
        get(name) {
          if (name === "x-forwarded-for") return "203.0.113.20";
          if (name === "user-agent") return "node-test";
          return "";
        },
      },
    };
    const record = await auditEvent(request, { type:"test.audit", status:"blocked" });

    assert.equal(record.persistence, "memory");
    assert.equal(record.ip, "203.0.113.20");
    assert.equal(warnings.some(message => message.includes("DATABASE_URL is not configured")), true);
  } finally {
    console.warn = previousWarn;
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
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
