const REVIEW_STATUSES = Object.freeze([
  "draft",
  "candidate",
  "in_review",
  "approved",
  "rejected",
  "archived",
]);

const RISK_LEVELS = Object.freeze([
  "low",
  "medium",
  "high",
  "restricted",
]);

const HIGH_RISK_SOURCE_TYPES = Object.freeze([
  "reins_user_upload",
  "contract",
  "important_matter_explanation",
  "customer_record",
]);

const KNOWLEDGE_BRAIN_STORES = Object.freeze({
  sourceRegistry: {
    name:"source_registry",
    indexes:[
      ["sourceType", "source_type"],
      ["reviewStatus", "review_status"],
      ["riskLevel", "risk_level"],
      ["trainingAllowed", "training_allowed"],
      ["updatedAt", "updated_at"],
    ],
  },
  knowledgeUnits: {
    name:"knowledge_units",
    indexes:[
      ["sourceId", "source_id"],
      ["domain", "domain"],
      ["reviewStatus", "review_status"],
      ["riskLevel", "risk_level"],
      ["version", "version"],
      ["updatedAt", "updated_at"],
    ],
  },
  policyRules: {
    name:"policy_rules",
    indexes:[
      ["sourceId", "source_id"],
      ["ruleType", "rule_type"],
      ["reviewStatus", "review_status"],
      ["riskLevel", "risk_level"],
      ["version", "version"],
    ],
  },
  scenarios: {
    name:"scenarios",
    indexes:[
      ["sourceId", "source_id"],
      ["scenarioType", "scenario_type"],
      ["reviewStatus", "review_status"],
      ["riskLevel", "risk_level"],
      ["version", "version"],
    ],
  },
  evalCases: {
    name:"eval_cases",
    indexes:[
      ["sourceId", "source_id"],
      ["scenarioId", "scenario_id"],
      ["reviewStatus", "review_status"],
      ["riskLevel", "risk_level"],
      ["version", "version"],
    ],
  },
  evidenceRefs: {
    name:"evidence_refs",
    indexes:[
      ["sourceId", "source_id"],
      ["targetId", "target_id"],
      ["targetType", "target_type"],
      ["reviewStatus", "review_status"],
      ["riskLevel", "risk_level"],
      ["version", "version"],
    ],
  },
});

function stableId(prefix, now = Date.now(), random = Math.random()) {
  return `${prefix}-${now.toString(36)}-${random.toString(36).slice(2, 10)}`;
}

function isoNow(now = new Date()) {
  return now.toISOString();
}

function assertEnum(name, value, allowed) {
  if (!allowed.includes(value)) {
    throw new Error(`${name} must be one of: ${allowed.join(", ")}`);
  }
}

function normalizeReviewStatus(value = "candidate") {
  const status = `${value || "candidate"}`.trim();
  assertEnum("review_status", status, REVIEW_STATUSES);
  return status;
}

function normalizeRiskLevel(value = "medium") {
  const level = `${value || "medium"}`.trim();
  assertEnum("risk_level", level, RISK_LEVELS);
  return level;
}

function normalizeVersion(value = 1) {
  const version = value === undefined || value === null || value === "" ? 1 : Number(value);
  if (!Number.isInteger(version) || version < 1) {
    throw new Error("version must be a positive integer.");
  }
  return version;
}

function requireText(name, value) {
  const text = `${value || ""}`.trim();
  if (!text) throw new Error(`${name} is required.`);
  return text;
}

function baseFields(input = {}, { idPrefix, defaultRisk = "medium", defaultReview = "candidate" } = {}) {
  const now = isoNow();
  return {
    id:input.id || stableId(idPrefix),
    review_status:normalizeReviewStatus(input.review_status || defaultReview),
    risk_level:normalizeRiskLevel(input.risk_level || defaultRisk),
    version:normalizeVersion(input.version),
    created_at:input.created_at || now,
    updated_at:input.updated_at || now,
  };
}

function highRiskDefaultForSourceType(sourceType) {
  return HIGH_RISK_SOURCE_TYPES.includes(sourceType) ? "high" : "medium";
}

function buildSourceRegistryRecord(input = {}) {
  const sourceType = requireText("source_type", input.source_type);
  const riskLevel = input.risk_level || highRiskDefaultForSourceType(sourceType);
  const record = {
    ...baseFields(input, { idPrefix:"src", defaultRisk:riskLevel }),
    source_type:sourceType,
    title:requireText("title", input.title),
    origin_url:`${input.origin_url || ""}`.trim(),
    provider:`${input.provider || ""}`.trim(),
    jurisdiction:`${input.jurisdiction || "JP"}`.trim(),
    collected_by:`${input.collected_by || "user"}`.trim(),
    collection_method:`${input.collection_method || "manual"}`.trim(),
    license:`${input.license || ""}`.trim(),
    consent_scope:`${input.consent_scope || "none"}`.trim(),
    training_allowed:input.training_allowed === true,
    deletion_requested:input.deletion_requested === true,
    retention_policy:`${input.retention_policy || "project_local_default"}`.trim(),
    metadata:input.metadata && typeof input.metadata === "object" ? input.metadata : {},
  };
  if (HIGH_RISK_SOURCE_TYPES.includes(record.source_type)) {
    record.training_allowed = false;
  }
  return record;
}

function requireSourceId(input = {}) {
  return requireText("source_id", input.source_id);
}

function buildKnowledgeUnitRecord(input = {}) {
  return {
    ...baseFields(input, { idPrefix:"ku", defaultRisk:input.risk_level || "medium" }),
    source_id:requireSourceId(input),
    domain:requireText("domain", input.domain),
    title:requireText("title", input.title),
    content:requireText("content", input.content),
    locale:`${input.locale || "ja-JP"}`.trim(),
    tags:Array.isArray(input.tags) ? input.tags : [],
    evidence_ref_ids:Array.isArray(input.evidence_ref_ids) ? input.evidence_ref_ids : [],
    supersedes_id:`${input.supersedes_id || ""}`.trim(),
    metadata:input.metadata && typeof input.metadata === "object" ? input.metadata : {},
  };
}

function buildPolicyRuleRecord(input = {}) {
  return {
    ...baseFields(input, { idPrefix:"rule", defaultRisk:input.risk_level || "high", defaultReview:"in_review" }),
    source_id:requireSourceId(input),
    rule_type:requireText("rule_type", input.rule_type),
    title:requireText("title", input.title),
    rule_text:requireText("rule_text", input.rule_text),
    applies_to:Array.isArray(input.applies_to) ? input.applies_to : [],
    requires_expert_confirmation:input.requires_expert_confirmation !== false,
    evidence_ref_ids:Array.isArray(input.evidence_ref_ids) ? input.evidence_ref_ids : [],
    metadata:input.metadata && typeof input.metadata === "object" ? input.metadata : {},
  };
}

function buildScenarioRecord(input = {}) {
  return {
    ...baseFields(input, { idPrefix:"scn", defaultRisk:input.risk_level || "medium" }),
    source_id:requireSourceId(input),
    scenario_type:requireText("scenario_type", input.scenario_type),
    title:requireText("title", input.title),
    description:requireText("description", input.description),
    expected_outputs:Array.isArray(input.expected_outputs) ? input.expected_outputs : [],
    evidence_ref_ids:Array.isArray(input.evidence_ref_ids) ? input.evidence_ref_ids : [],
    metadata:input.metadata && typeof input.metadata === "object" ? input.metadata : {},
  };
}

function buildEvalCaseRecord(input = {}) {
  return {
    ...baseFields(input, { idPrefix:"eval", defaultRisk:input.risk_level || "medium", defaultReview:"candidate" }),
    source_id:requireSourceId(input),
    scenario_id:`${input.scenario_id || ""}`.trim(),
    prompt:requireText("prompt", input.prompt),
    expected_behavior:requireText("expected_behavior", input.expected_behavior),
    forbidden_behavior:`${input.forbidden_behavior || ""}`.trim(),
    scoring_rubric:input.scoring_rubric && typeof input.scoring_rubric === "object" ? input.scoring_rubric : {},
    evidence_ref_ids:Array.isArray(input.evidence_ref_ids) ? input.evidence_ref_ids : [],
    metadata:input.metadata && typeof input.metadata === "object" ? input.metadata : {},
  };
}

function buildEvidenceRefRecord(input = {}) {
  return {
    ...baseFields(input, { idPrefix:"ev", defaultRisk:input.risk_level || "medium" }),
    source_id:requireSourceId(input),
    target_type:requireText("target_type", input.target_type),
    target_id:requireText("target_id", input.target_id),
    locator:requireText("locator", input.locator),
    quote:`${input.quote || ""}`.trim(),
    hash:`${input.hash || ""}`.trim(),
    metadata:input.metadata && typeof input.metadata === "object" ? input.metadata : {},
  };
}

function assertHighRiskReviewable(record = {}) {
  if (!record.source_id) throw new Error("High risk knowledge must include source_id.");
  if (!record.review_status) throw new Error("High risk knowledge must include review_status.");
  if (!record.risk_level) throw new Error("High risk knowledge must include risk_level.");
  if (!record.version) throw new Error("High risk knowledge must include version.");
  return true;
}

function validateSourceBackedConclusion(record = {}) {
  const issues = [];
  const riskLevel = `${record.risk_level || ""}` || "medium";
  const evidenceRefIds = Array.isArray(record.evidence_ref_ids) ? record.evidence_ref_ids : [];
  if (!record.source_id) issues.push("missing_source_id");
  if (!record.review_status) issues.push("missing_review_status");
  if (!record.version) issues.push("missing_version");
  if (!record.risk_level) issues.push("missing_risk_level");
  if (["high", "restricted"].includes(riskLevel) && evidenceRefIds.length === 0) {
    issues.push("high_risk_missing_evidence");
  }
  if (["high", "restricted"].includes(riskLevel) && record.review_status !== "approved") {
    issues.push("high_risk_not_approved");
  }
  return {
    ok:issues.length === 0,
    issues,
    requiresExpertConfirmation:["high", "restricted"].includes(riskLevel),
  };
}

export {
  HIGH_RISK_SOURCE_TYPES,
  KNOWLEDGE_BRAIN_STORES,
  REVIEW_STATUSES,
  RISK_LEVELS,
  assertHighRiskReviewable,
  buildEvalCaseRecord,
  buildEvidenceRefRecord,
  buildKnowledgeUnitRecord,
  buildPolicyRuleRecord,
  buildScenarioRecord,
  buildSourceRegistryRecord,
  normalizeReviewStatus,
  normalizeRiskLevel,
  normalizeVersion,
  validateSourceBackedConclusion,
};
