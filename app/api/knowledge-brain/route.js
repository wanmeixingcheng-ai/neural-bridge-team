import { isAuthenticatedAsync } from "../auth/session.js";
import { auditEvent } from "../../../lib/auditLog.mjs";
import { checkRateLimitAsync, rateLimitResponse } from "../../../lib/rateLimit.mjs";
import { readJsonLimited, requestBodyTooLargeResponse } from "../../../lib/requestBody.mjs";
import { containsSensitiveSecret, sensitiveContentResponse } from "../../../lib/secretPolicy.mjs";
import {
  buildKnowledgeBrainRuntimeResult,
  knowledgeBrainColdStartReadiness,
  knowledgeBrainHighRiskToolReadiness,
  knowledgeBrainInventoryStats,
  knowledgeBrainReviewQueueItems,
  knowledgeBrainToolRegistry,
  knowledgeBrainToolRuntimeGate,
} from "../../../lib/projectBrain.mjs";

const KNOWLEDGE_BRAIN_MAX_REQUEST_BYTES = 512 * 1024;
const KNOWLEDGE_BRAIN_RATE_WINDOW_MS = 60_000;
const KNOWLEDGE_BRAIN_RATE_LIMIT = 20;

function recordsFromBody(body = {}) {
  const records = body.records && typeof body.records === "object" ? body.records : body;
  return {
    sources:Array.isArray(records.sources) ? records.sources : [],
    knowledgeUnits:Array.isArray(records.knowledgeUnits) ? records.knowledgeUnits : [],
    evidenceRefs:Array.isArray(records.evidenceRefs) ? records.evidenceRefs : [],
    policyRules:Array.isArray(records.policyRules) ? records.policyRules : [],
    scenarios:Array.isArray(records.scenarios) ? records.scenarios : [],
    evalCases:Array.isArray(records.evalCases) ? records.evalCases : [],
    japaneseRealEstateRecords:Array.isArray(records.japaneseRealEstateRecords) ? records.japaneseRealEstateRecords : [],
    calculationRuns:Array.isArray(records.calculationRuns) ? records.calculationRuns : [],
    propertyDossiers:Array.isArray(records.propertyDossiers) ? records.propertyDossiers : [],
    toolValidationRuns:Array.isArray(records.toolValidationRuns) ? records.toolValidationRuns : [],
  };
}

function runtimeConfigFromBody(body = {}) {
  const config = body.runtime && typeof body.runtime === "object" ? body.runtime : body;
  return {
    toolId:config.toolId || "",
    taskType:config.taskType || "",
    prompt:config.prompt || "",
    languageMode:config.languageMode || "ja",
    riskLevel:config.riskLevel || "medium",
    retrievalResults:Array.isArray(config.retrievalResults) ? config.retrievalResults : [],
    policyRules:Array.isArray(config.policyRules) ? config.policyRules : [],
    template:config.template || null,
    templateInputs:config.templateInputs || {},
    answerBody:config.answerBody || "",
    localOnly:config.localOnly === true,
    auditOnly:config.auditOnly === true,
  };
}

function sensitiveRuntimeText(body = {}) {
  const config = runtimeConfigFromBody(body);
  return [
    config.prompt,
    config.answerBody,
    JSON.stringify(config.templateInputs || {}),
  ].join("\n");
}

function knowledgeBrainResponse(action, body = {}) {
  const records = recordsFromBody(body);
  if (action === "tool_registry") {
    return { ok:true, action, tools:knowledgeBrainToolRegistry() };
  }
  if (action === "runtime_gate") {
    return {
      ok:true,
      action,
      runtime:buildKnowledgeBrainRuntimeResult(runtimeConfigFromBody(body)),
      toolGate:knowledgeBrainToolRuntimeGate(body.toolId || body.runtime?.toolId || "", {
        toolValidationRuns:records.toolValidationRuns,
        evalCases:records.evalCases,
        externalRelease:body.externalRelease === true,
      }),
    };
  }
  if (action === "review_queue") {
    return {
      ok:true,
      action,
      items:knowledgeBrainReviewQueueItems({
        ...records,
        limit:Number.isFinite(body.limit) ? Math.min(Math.max(Math.floor(body.limit), 1), 100) : 50,
        targetTypes:Array.isArray(body.targetTypes) ? body.targetTypes : [],
        reviewStatuses:Array.isArray(body.reviewStatuses) ? body.reviewStatuses : [],
        riskLevels:Array.isArray(body.riskLevels) ? body.riskLevels : [],
        reasons:Array.isArray(body.reasons) ? body.reasons : [],
        query:body.query || "",
      }),
    };
  }
  if (action === "cold_start_readiness") {
    return {
      ok:true,
      action,
      readiness:knowledgeBrainColdStartReadiness(records, body.options || {}),
    };
  }
  if (action === "high_risk_readiness") {
    return {
      ok:true,
      action,
      readiness:knowledgeBrainHighRiskToolReadiness(records, {
        toolId:body.toolId || "M4",
        externalRelease:body.externalRelease === true,
        ...(body.options || {}),
      }),
    };
  }
  return {
    ok:true,
    action:"inventory",
    inventory:knowledgeBrainInventoryStats(records),
  };
}

export async function GET(request) {
  if (!await isAuthenticatedAsync(request)) {
    await auditEvent(request, { type:"knowledge_brain.auth_failed", status:"blocked" });
    return Response.json({ ok:false, error:"未登录" }, { status:401 });
  }
  await auditEvent(request, { type:"knowledge_brain.tool_registry", status:"ok" });
  return Response.json(knowledgeBrainResponse("tool_registry"));
}

export async function POST(request) {
  if (!await isAuthenticatedAsync(request)) {
    await auditEvent(request, { type:"knowledge_brain.auth_failed", status:"blocked" });
    return Response.json({ ok:false, error:"未登录" }, { status:401 });
  }
  if (!await checkRateLimitAsync({ request, namespace:"knowledge-brain", limit:KNOWLEDGE_BRAIN_RATE_LIMIT, windowMs:KNOWLEDGE_BRAIN_RATE_WINDOW_MS })) {
    await auditEvent(request, { type:"knowledge_brain.rate_limited", status:"blocked" });
    return rateLimitResponse("Knowledge Brain rate limit exceeded");
  }

  let body;
  try {
    body = await readJsonLimited(request, KNOWLEDGE_BRAIN_MAX_REQUEST_BYTES);
  } catch (error) {
    const response = requestBodyTooLargeResponse(error);
    if (response) return response;
    body = {};
  }

  const action = `${body.action || "inventory"}`.trim();
  if (action === "runtime_gate" && containsSensitiveSecret(sensitiveRuntimeText(body))) {
    await auditEvent(request, { type:"knowledge_brain.secret_blocked", status:"blocked", target:action });
    return sensitiveContentResponse();
  }
  const allowedActions = new Set(["inventory", "review_queue", "cold_start_readiness", "high_risk_readiness", "runtime_gate", "tool_registry"]);
  if (!allowedActions.has(action)) {
    return Response.json({ ok:false, error:"Unsupported Knowledge Brain action" }, { status:400 });
  }

  const payload = knowledgeBrainResponse(action, body);
  await auditEvent(request, { type:"knowledge_brain.computed", status:"ok", target:action });
  return Response.json(payload);
}
