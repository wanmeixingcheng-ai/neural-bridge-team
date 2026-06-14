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
  knowledgeBrainReviewQueueActionSummary,
  knowledgeBrainReviewQueueItems,
  knowledgeBrainReviewQueueSummary,
  knowledgeBrainToolRegistry,
  knowledgeBrainToolRuntimeGate,
} from "../../../lib/projectBrain.mjs";
import { buildRuntimeGateEventRecord } from "../../../lib/knowledgeBrainSchemas.mjs";

const KNOWLEDGE_BRAIN_MAX_REQUEST_BYTES = 512 * 1024;
const KNOWLEDGE_BRAIN_RATE_WINDOW_MS = 60_000;
const KNOWLEDGE_BRAIN_RATE_LIMIT = 20;

function recordsFromBody(body = {}) {
  const records = body.records && typeof body.records === "object" ? body.records : body;
  const recordArray = (...names) => {
    for (const name of names) {
      if (Array.isArray(records[name])) return records[name];
    }
    return [];
  };
  const japaneseRealEstateRecords = [
    ...recordArray("japaneseRealEstateRecords", "japanese_real_estate_records"),
    ...recordArray("property_records"),
    ...recordArray("land_records"),
    ...recordArray("building_records"),
    ...recordArray("lease_records"),
    ...recordArray("expense_records"),
    ...recordArray("loan_records"),
    ...recordArray("tax_records"),
    ...recordArray("risk_records"),
    ...recordArray("area_records"),
    ...recordArray("transaction_records"),
  ];
  return {
    sources:recordArray("sources", "source_registry"),
    knowledgeUnits:recordArray("knowledgeUnits", "knowledge_units"),
    evidenceRefs:recordArray("evidenceRefs", "evidence_refs"),
    policyRules:recordArray("policyRules", "policy_rules"),
    scenarios:recordArray("scenarios"),
    evalCases:recordArray("evalCases", "eval_cases"),
    japaneseRealEstateRecords,
    calculationRuns:recordArray("calculationRuns", "calculation_runs"),
    propertyDossiers:recordArray("propertyDossiers", "property_dossiers"),
    toolValidationRuns:recordArray("toolValidationRuns", "tool_validation_runs"),
    runtimeGateEvents:recordArray("runtimeGateEvents", "runtime_gate_events"),
  };
}

function runtimeConfigFromBody(body = {}) {
  const config = body.runtime && typeof body.runtime === "object" ? body.runtime : body;
  return {
    toolId:config.toolId || config.tool_id || "",
    taskType:config.taskType || config.task_type || "",
    prompt:config.prompt || "",
    languageMode:config.languageMode || config.language_mode || "ja",
    riskLevel:config.riskLevel || config.risk_level || "medium",
    retrievalResults:Array.isArray(config.retrievalResults) ? config.retrievalResults : Array.isArray(config.retrieval_results) ? config.retrieval_results : [],
    policyRules:Array.isArray(config.policyRules) ? config.policyRules : Array.isArray(config.policy_rules) ? config.policy_rules : [],
    template:config.template || null,
    templateInputs:config.templateInputs || config.template_inputs || {},
    answerBody:config.answerBody || config.answer_body || "",
    localOnly:config.localOnly === true || config.local_only === true,
    auditOnly:config.auditOnly === true || config.audit_only === true,
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
  const bodyArray = (...names) => {
    for (const name of names) {
      if (Array.isArray(body[name])) return body[name];
    }
    return [];
  };
  if (action === "tool_registry") {
    return { ok:true, action, tools:knowledgeBrainToolRegistry() };
  }
  if (action === "runtime_gate") {
    const runtimeConfig = runtimeConfigFromBody(body);
    const runtime = buildKnowledgeBrainRuntimeResult(runtimeConfig);
    const toolGate = knowledgeBrainToolRuntimeGate(runtimeConfig.toolId, {
      toolValidationRuns:records.toolValidationRuns,
      evalCases:records.evalCases,
      externalRelease:body.externalRelease === true || body.external_release === true,
    });
    return {
      ok:true,
      action,
      runtime,
      toolGate,
      event:buildRuntimeGateEventRecord({
        tool_id:runtime.tool_id,
        action,
        task_type:runtimeConfig.taskType,
        risk_level:runtime.risk_level === "critical" ? "restricted" : runtime.risk_level,
        route:runtime.route,
        policy:runtime.policy,
        output_quality:runtime.output_quality,
        source_ids:runtime.audit?.source_ids || [],
        knowledge_ids:runtime.audit?.knowledge_ids || [],
        response_status:runtime.route?.blocked_external_reason || runtime.policy?.blocks_final_answer ? 200 : 200,
        metadata:{
          runtime_ok:runtime.ok,
          tool_gate_ok:toolGate.ok,
          policy_rule_ids:runtime.policy?.policy_rule_ids || [],
        },
      }),
    };
  }
  if (action === "review_queue") {
    const items = knowledgeBrainReviewQueueItems({
      ...records,
      limit:Number.isFinite(body.limit) ? Math.min(Math.max(Math.floor(body.limit), 1), 100) : 50,
      targetTypes:bodyArray("targetTypes", "target_types"),
      sourceIds:bodyArray("sourceIds", "source_ids"),
      reviewStatuses:bodyArray("reviewStatuses", "review_statuses"),
      riskLevels:bodyArray("riskLevels", "risk_levels"),
      reasons:Array.isArray(body.reasons) ? body.reasons : [],
      query:body.query || "",
    });
    return {
      ok:true,
      action,
      summary:knowledgeBrainReviewQueueSummary(records),
      items,
      actionSummary:knowledgeBrainReviewQueueActionSummary(items),
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
        toolId:body.toolId || body.tool_id || "M4",
        externalRelease:body.externalRelease === true || body.external_release === true,
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
