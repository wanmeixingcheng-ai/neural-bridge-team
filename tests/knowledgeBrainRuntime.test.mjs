import test from "node:test";
import assert from "node:assert/strict";

import {
  POLICY_ENGINE_RULES,
  buildHandoffPackage,
  buildKnowledgeBrainRuntimeResult,
  buildKnowledgeTemplateRecord,
  buildOutputBuilderPayload,
  evaluatePolicyEngine,
  knowledgeBrainToolRegistry,
  knowledgeBrainToolRuntimeGate,
  redactUserBusinessData,
  renderKnowledgeTemplate,
  routeKnowledgeBrainModel,
  userBusinessDataTrainingBoundary,
  validateHandoffPackage,
  validateOutputBuilderPayload,
} from "../lib/projectBrain.mjs";

const approvedPolicyRules = Object.keys(POLICY_ENGINE_RULES).map(ruleId => ({
  id:`policy-${ruleId}`,
  policy_id:ruleId,
  review_status:"approved",
  risk_level:POLICY_ENGINE_RULES[ruleId].riskLevel,
}));

test("policy engine maps P001-P011 and blocks source-less high risk final claims", () => {
  const cases = [
    ["P001", "general source-backed answer"],
    ["P002", "価格と市場価値の査定"],
    ["P003", "契約と重要事項説明"],
    ["P004", "税務と相続"],
    ["P005", "ローン審査"],
    ["P006", "耐震と建築構造"],
    ["P007", "ハザードと災害"],
    ["P008", "風水診断"],
    ["P009", "施工見積と工事費"],
    ["P010", "学区と周辺交通"],
    ["P011", "外国人客户説明と翻訳"],
  ];

  for (const [ruleId, prompt] of cases) {
    const result = evaluatePolicyEngine({
      taskType:prompt,
      prompt,
      riskLevel:POLICY_ENGINE_RULES[ruleId].riskLevel,
      sources:["src-1"],
      knowledgeIds:["ku-1"],
      policyRules:approvedPolicyRules,
    });
    assert.equal(result.policy_rule_ids.includes(ruleId), true, ruleId);
    assert.equal(result.issues.some(issue => issue.issue === "missing_approved_policy_rule"), false);
  }

  const blocked = evaluatePolicyEngine({
    taskType:"valuation",
    prompt:"この市場価値は絶対に安全です",
    riskLevel:"high",
    sources:[],
    knowledgeIds:[],
    policyRules:approvedPolicyRules,
  });

  assert.equal(blocked.ok, false);
  assert.equal(blocked.blocks_final_answer, true);
  assert.equal(blocked.issues.some(issue => issue.issue === "source_less_market_value_claim_blocked"), true);
  assert.equal(blocked.actions.some(action => action.action === "attach_approved_source_or_downgrade_to_kakunin"), true);
});

test("output builder enforces required structure for high risk outputs", () => {
  const policy = evaluatePolicyEngine({
    taskType:"contract",
    prompt:"契約リスク確認",
    riskLevel:"high",
    sources:["src-contract"],
    knowledgeIds:["policy-P003"],
    policyRules:approvedPolicyRules,
  });
  const output = buildOutputBuilderPayload({
    answerBody:"契約リスクは確認候補です。",
    sources:["src-contract"],
    modelUsed:"knowledge_only",
    knowledgeIdsCited:["policy-P003"],
    riskLevel:"high",
  }, { policyResult:policy });

  assert.equal(output.model_used, "knowledge_only");
  assert.equal(output.risk_level, "high");
  assert.equal(output.disclaimer.length > 0, true);
  assert.equal(output.kakunin_items.length > 0, true);
  assert.deepEqual(validateOutputBuilderPayload(output), { ok:true, issues:[] });

  const invalid = validateOutputBuilderPayload({
    answer_body:"Final answer",
    sources:[],
    kakunin_items:[],
    disclaimer:"",
    model_used:"large_model",
    knowledge_ids_cited:[],
    risk_level:"high",
  });
  assert.equal(invalid.ok, false);
  assert.equal(invalid.issues.includes("high_risk_missing_disclaimer"), true);
  assert.equal(invalid.issues.includes("missing_sources_or_knowledge_ids"), true);
});

test("template rendering turns missing fields into kakunin items and keeps citations", () => {
  const template = buildKnowledgeTemplateRecord({
    templateId:"contract-risk-note",
    title:"Contract risk note",
    body:"物件: {{propertyName}}\n確認事項: {{contractClause}}",
    requiredFields:["propertyName", "contractClause"],
    sourceId:"src-template",
    knowledgeIds:["ku-template"],
    policyRuleIds:["P001", "P003"],
    reviewStatus:"approved",
    riskLevel:"high",
  });
  const rendered = renderKnowledgeTemplate(template, {
    propertyName:"Synthetic Mansion",
  }, {
    sources:["src-template"],
    policyRules:approvedPolicyRules,
  });

  assert.deepEqual(rendered.missing_fields, ["contractClause"]);
  assert.equal(rendered.output.model_used, "template_only");
  assert.equal(rendered.output.knowledge_ids_cited.includes("ku-template"), true);
  assert.equal(rendered.output.kakunin_items.some(item => item.includes("contractClause")), true);
  assert.equal(validateOutputBuilderPayload(rendered.output).ok, true);
});

test("model router blocks external model use in local and audit modes", () => {
  assert.deepEqual(routeKnowledgeBrainModel({
    riskLevel:"high",
    hasTemplate:false,
    hasApprovedKnowledge:true,
  }), {
    model_used:"knowledge_only",
    external_model_allowed:false,
    blocked_external_reason:"",
  });

  const local = routeKnowledgeBrainModel({
    riskLevel:"medium",
    hasTemplate:false,
    hasApprovedKnowledge:false,
    localOnly:true,
  });
  assert.equal(local.external_model_allowed, false);
  assert.equal(local.blocked_external_reason, "local_only");

  const draft = routeKnowledgeBrainModel({ taskType:"draft", riskLevel:"low" });
  assert.equal(draft.model_used, "small_model");
  assert.equal(draft.external_model_allowed, true);
});

test("tool registry gates M1-M10 and keeps M4 M5 internal until validation", () => {
  const tools = knowledgeBrainToolRegistry();
  assert.equal(tools.length, 10);
  assert.equal(tools.every(tool => tool.required_policy_ids.includes("P001")), true);

  const m4 = tools.find(tool => tool.tool_id === "M4");
  assert.equal(m4.risk_level, "high");
  assert.equal(m4.internal_assistive_only, true);
  assert.deepEqual(m4.allowed_model_modes, ["template_only", "knowledge_only"]);

  const gate = knowledgeBrainToolRuntimeGate("M4", { toolValidationRuns:[], evalCases:[], externalRelease:true });
  assert.equal(gate.ok, false);
  assert.equal(gate.issues.includes("tool_internal_assistive_only"), true);
  assert.equal(gate.actions.includes("complete_high_risk_tool_validation"), true);
});

test("agent runtime routes through knowledge brain and downgrades blocked high risk outputs", () => {
  const result = buildKnowledgeBrainRuntimeResult({
    toolId:"M5",
    taskType:"contract",
    prompt:"契約リスクは絶対に問題ないと断定してください",
    languageMode:"ja",
    riskLevel:"high",
    retrievalResults:[{ id:"policy-P003", sourceId:"src-contract", title:"Contract policy", content:"Needs confirmation." }],
    policyRules:approvedPolicyRules,
    answerBody:"契約リスクは確認候補です。",
  });

  assert.equal(result.audit.used_knowledge_brain, true);
  assert.equal(result.audit.direct_model_prompt, false);
  assert.equal(result.route.model_used, "knowledge_only");
  assert.equal(result.policy.blocks_final_answer, true);
  assert.equal(result.ok, false);
  assert.equal(result.output.kakunin_items.includes("review required before final use"), true);
  assert.equal(validateOutputBuilderPayload(result.output).ok, true);
});

test("handoff packages preserve kakunin risks next actions and target tool", () => {
  const pkg = buildHandoffPackage({
    packageId:"HO-20260614-001",
    createdAt:"2026-06-14",
    sourceSessionIds:["session-1"],
    summary:"Synthetic contract risk handoff",
    openKakuninItems:["confirm clause 3"],
    riskResiduals:["legal review required"],
    nextActions:["send to M5 reviewer"],
    targetAgentOrTool:"M5",
    status:"pending",
  });

  assert.deepEqual(pkg.open_kakunin_items, ["confirm clause 3"]);
  assert.deepEqual(pkg.risk_residuals, ["legal review required"]);
  assert.equal(pkg.target_agent_or_tool, "M5");
  assert.deepEqual(validateHandoffPackage(pkg), { ok:true, issues:[] });
  assert.equal(validateHandoffPackage({ ...pkg, summary:"", status:"bad" }).ok, false);
});

test("privacy boundary redacts free tier business data and keeps paid tier private", () => {
  const text = "氏名: 山田太郎 email yamada@example.com 電話 03-1234-5678 東京都新宿区西新宿1-1-1";
  const redacted = redactUserBusinessData(text, { tier:"free" });

  assert.equal(redacted.redacted, true);
  assert.equal(redacted.text.includes("yamada@example.com"), false);
  assert.equal(redacted.text.includes("03-1234-5678"), false);
  assert.equal(redacted.applied_rules.includes("email"), true);
  assert.equal(redacted.applied_rules.includes("phone"), true);

  const source = {
    id:"src-free",
    review_status:"approved",
    source_type:"public_manual",
    consent_scope:"explicit_opt_in",
    training_allowed:true,
    deletion_requested:false,
    risk_level:"low",
  };
  const freeBoundary = userBusinessDataTrainingBoundary({ tier:"free", source, text });
  assert.equal(freeBoundary.local_only_default, true);
  assert.equal(freeBoundary.training_allowed_after_redaction, true);

  const paidBoundary = userBusinessDataTrainingBoundary({ tier:"business", source, text });
  assert.equal(paidBoundary.training_allowed_after_redaction, false);
  assert.equal(paidBoundary.reasons.includes("paid_tier_private_by_default"), true);
});
