import test from "node:test";
import assert from "node:assert/strict";

import {
  createSessionToken,
  verifySessionToken,
  SESSION_COOKIE,
} from "../app/api/auth/session.js";
import { POST as chatPost, sanitizeModelText } from "../app/api/chat/route.js";
import { GET as knowledgeBrainGet, POST as knowledgeBrainPost } from "../app/api/knowledge-brain/route.js";
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

test("chat knowledge brain runtime blocks unsafe high risk external model calls", async () => {
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
        messages: [{ role: "user", text: "この市場価値は絶対に安全です" }],
        options:{
          knowledgeBrain:{
            toolId:"M4",
            taskType:"valuation",
            riskLevel:"high",
            retrievalResults:[],
            policyRules:[],
            localOnly:true,
          },
        },
      }),
    });
    request.cookies = {
      get(name) {
        return name === SESSION_COOKIE ? { value: token } : undefined;
      },
    };

    const response = await chatPost(request);
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(fetchCalled, false);
    assert.equal(payload.knowledgeBrain.ok, false);
    assert.equal(payload.knowledgeBrain.route.blocked_external_reason, "local_only");
    assert.equal(payload.knowledgeBrain.policy.blocks_final_answer, true);
    assert.equal(payload.knowledgeBrain.output.risk_level, "high");
    assert.equal(payload.knowledgeBrain.output.disclaimer.length > 0, true);
    assert.equal(payload.knowledgeBrain.event.tool_id, "M4");
    assert.equal(payload.knowledgeBrain.event.action, "chat_runtime_gate");
    assert.equal(payload.knowledgeBrain.event.blocked_external_reason, "local_only");
    assert.equal(payload.knowledgeBrain.event.external_model_allowed, false);
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

test("chat knowledge brain runtime blocks high risk tools without validation readiness", async () => {
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
        messages: [{ role: "user", text: "賃料査定の根拠を整理してください" }],
        options:{
          knowledgeBrain:{
            toolId:"M4",
            taskType:"valuation",
            riskLevel:"high",
            retrievalResults:[
              { id:"ku-valuation-1", sourceId:"src-valuation-1", title:"Approved valuation source", content:"Approved source-backed valuation note." },
            ],
            policyRules:[],
            toolValidationRuns:[],
            evalCases:[],
          },
        },
      }),
    });
    request.cookies = {
      get(name) {
        return name === SESSION_COOKIE ? { value: token } : undefined;
      },
    };

    const response = await chatPost(request);
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(fetchCalled, false);
    assert.equal(payload.knowledgeBrain.ok, false);
    assert.equal(payload.knowledgeBrain.toolGate.ok, false);
    assert.equal(payload.knowledgeBrain.toolGate.issues.includes("high_risk_validation_not_ready"), true);
    assert.equal(payload.knowledgeBrain.toolGate.issues.includes("false_negative_eval_coverage_not_ready"), true);
    assert.equal(payload.knowledgeBrain.event.metadata.tool_gate_ok, false);
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

test("chat knowledge brain runtime injects gate metadata for allowed model calls", async () => {
  const previousSecret = process.env.APP_AUTH_SECRET;
  const previousPassword = process.env.APP_PASSWORD;
  const previousAnthropic = process.env.ANTHROPIC_API_KEY;
  process.env.APP_AUTH_SECRET = "test-auth-secret-at-least-32-bytes";
  process.env.APP_PASSWORD = "owner-password";
  process.env.ANTHROPIC_API_KEY = "test-api-key";
  const token = createSessionToken();
  let providerSystemPrompt = "";
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (_url, init = {}) => {
    const body = JSON.parse(init.body || "{}");
    providerSystemPrompt = body.system || "";
    return Response.json({
      content:[{ type:"text", text:"Source-backed synthetic answer." }],
    });
  };

  try {
    const request = new Request("https://neural-bridge.local/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        modelKey: "claude",
        systemPrompt: "You are ARIA.",
        messages: [{ role: "user", text: "Summarize approved source" }],
        options:{
          knowledgeBrain:{
            toolId:"M1",
            taskType:"property_summary",
            riskLevel:"medium",
            retrievalResults:[
              { id:"ku-1", sourceId:"src-1", title:"Approved fact", content:"Synthetic source-backed fact." },
            ],
          },
        },
      }),
    });
    request.cookies = {
      get(name) {
        return name === SESSION_COOKIE ? { value: token } : undefined;
      },
    };

    const response = await chatPost(request);
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.text, "Source-backed synthetic answer.");
    assert.equal(payload.knowledgeBrain.ok, true);
    assert.equal(payload.knowledgeBrain.audit.used_knowledge_brain, true);
    assert.equal(payload.knowledgeBrain.toolGate.ok, true);
    assert.equal(payload.knowledgeBrain.event.tool_id, "M1");
    assert.equal(payload.knowledgeBrain.event.response_status, 200);
    assert.deepEqual(payload.knowledgeBrain.event.source_ids, ["src-1"]);
    assert.deepEqual(payload.knowledgeBrain.event.knowledge_ids, ["ku-1"]);
    assert.match(providerSystemPrompt, /Knowledge Brain runtime gate/);
    assert.match(providerSystemPrompt, /knowledge_ids: ku-1/);
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

test("knowledge brain api requires authentication", async () => {
  const request = new Request("https://neural-bridge.local/api/knowledge-brain", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action:"inventory" }),
  });
  request.cookies = { get() { return undefined; } };

  const response = await knowledgeBrainPost(request);
  const payload = await response.json();

  assert.equal(response.status, 401);
  assert.equal(payload.ok, false);
});

test("knowledge brain api computes runtime gate without provider transit", async () => {
  const previousSecret = process.env.APP_AUTH_SECRET;
  const previousPassword = process.env.APP_PASSWORD;
  process.env.APP_AUTH_SECRET = "test-auth-secret-at-least-32-bytes";
  process.env.APP_PASSWORD = "owner-password";
  const token = createSessionToken();
  let fetchCalled = false;
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    fetchCalled = true;
    throw new Error("knowledge brain api must not call providers");
  };

  try {
    const request = new Request("https://neural-bridge.local/api/knowledge-brain", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action:"runtime_gate",
        runtime:{
          toolId:"M4",
          taskType:"valuation",
          prompt:"賃料査定の根拠を確認する",
          riskLevel:"high",
          retrievalResults:[
            { id:"ku-approved-1", sourceId:"src-official-1", title:"Approved source", content:"Official approved valuation note." },
          ],
          localOnly:true,
        },
        records:{
          toolValidationRuns:[],
          evalCases:[],
        },
      }),
    });
    request.cookies = {
      get(name) {
        return name === SESSION_COOKIE ? { value: token } : undefined;
      },
    };

    const response = await knowledgeBrainPost(request);
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(fetchCalled, false);
    assert.equal(payload.ok, true);
    assert.equal(payload.action, "runtime_gate");
    assert.equal(payload.runtime.tool_id, "M4");
    assert.equal(payload.runtime.route.external_model_allowed, false);
    assert.equal(payload.runtime.route.blocked_external_reason, "local_only");
    assert.deepEqual(payload.runtime.audit.source_ids, ["src-official-1"]);
    assert.equal(payload.toolGate.tool_id, "M4");
    assert.equal(payload.toolGate.ok, false);
    assert.equal(payload.event.tool_id, "M4");
    assert.equal(payload.event.route_model, "knowledge_only");
    assert.equal(payload.event.external_model_allowed, false);
    assert.deepEqual(payload.event.source_ids, ["src-official-1"]);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousSecret === undefined) delete process.env.APP_AUTH_SECRET;
    else process.env.APP_AUTH_SECRET = previousSecret;
    if (previousPassword === undefined) delete process.env.APP_PASSWORD;
    else process.env.APP_PASSWORD = previousPassword;
  }
});

test("knowledge brain api routes runtime gate events into review queue", async () => {
  const previousSecret = process.env.APP_AUTH_SECRET;
  const previousPassword = process.env.APP_PASSWORD;
  process.env.APP_AUTH_SECRET = "test-auth-secret-at-least-32-bytes";
  process.env.APP_PASSWORD = "owner-password";
  const token = createSessionToken();

  try {
    const request = new Request("https://neural-bridge.local/api/knowledge-brain", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action:"review_queue",
        records:{
          runtime_gate_events:[
            { id:"rt-api-risk", tool_id:"M4", action:"chat_runtime_gate", route_model:"small_model", external_model_allowed:true, blocked_external_reason:"", policy_result:{ ok:true }, output_quality:{ ok:true }, source_ids:["src-risk"], knowledge_ids:["ku-risk"], response_status:200, review_status:"candidate", risk_level:"high", version:1 },
            { id:"rt-api-other", tool_id:"M1", action:"chat_runtime_gate", route_model:"small_model", external_model_allowed:false, blocked_external_reason:"local_only", policy_result:{ ok:true }, output_quality:{ ok:true }, source_ids:["src-other"], knowledge_ids:["ku-other"], response_status:200, review_status:"candidate", risk_level:"medium", version:1 },
          ],
          risk_records:[
            { id:"risk-api-1", entity_type:"risk", source_id:"src-risk", property_id:"prop-api-1", title:"Contract risk", risk_type:"contract", finding:"Needs expert confirmation.", review_status:"candidate", risk_level:"high", evidence_ref_ids:[], requires_expert_confirmation:false, version:1 },
          ],
        },
        targetTypes:["runtime_gate_event"],
        sourceIds:["src-risk"],
        reasons:["high_risk_external_model_allowed"],
      }),
    });
    request.cookies = {
      get(name) {
        return name === SESSION_COOKIE ? { value: token } : undefined;
      },
    };

    const response = await knowledgeBrainPost(request);
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.ok, true);
    assert.equal(payload.action, "review_queue");
    assert.equal(payload.summary.runtimeGateEvents, 2);
    assert.equal(payload.summary.invalidRuntimeGateEvents, 1);
    assert.equal(payload.summary.japaneseRealEstateRecords, 1);
    assert.equal(payload.summary.invalidJapaneseRealEstateRecords, 1);
    assert.equal(payload.items.length, 1);
    assert.equal(payload.items[0].target_type, "runtime_gate_event");
    assert.equal(payload.items[0].target_id, "rt-api-risk");
    assert.equal(payload.items[0].tool_id, "M4");
    assert.equal(payload.items[0].reasons.includes("high_risk_external_model_allowed"), true);
    assert.equal(payload.actionSummary.some(item => item.action === "block_high_risk_external_model_route" && item.sourceIds.includes("src-risk")), true);
  } finally {
    if (previousSecret === undefined) delete process.env.APP_AUTH_SECRET;
    else process.env.APP_AUTH_SECRET = previousSecret;
    if (previousPassword === undefined) delete process.env.APP_PASSWORD;
    else process.env.APP_PASSWORD = previousPassword;
  }
});

test("knowledge brain api exposes authenticated tool registry", async () => {
  const previousSecret = process.env.APP_AUTH_SECRET;
  const previousPassword = process.env.APP_PASSWORD;
  process.env.APP_AUTH_SECRET = "test-auth-secret-at-least-32-bytes";
  process.env.APP_PASSWORD = "owner-password";
  const token = createSessionToken();

  try {
    const request = new Request("https://neural-bridge.local/api/knowledge-brain", {
      method: "GET",
    });
    request.cookies = {
      get(name) {
        return name === SESSION_COOKIE ? { value: token } : undefined;
      },
    };

    const response = await knowledgeBrainGet(request);
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.ok, true);
    assert.equal(payload.action, "tool_registry");
    assert.equal(payload.tools.some(tool => tool.tool_id === "M4"), true);
  } finally {
    if (previousSecret === undefined) delete process.env.APP_AUTH_SECRET;
    else process.env.APP_AUTH_SECRET = previousSecret;
    if (previousPassword === undefined) delete process.env.APP_PASSWORD;
    else process.env.APP_PASSWORD = previousPassword;
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
