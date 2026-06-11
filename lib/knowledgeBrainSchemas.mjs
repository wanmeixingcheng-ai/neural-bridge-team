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

const JRE_ENTITY_TYPES = Object.freeze([
  "property",
  "land",
  "building",
  "lease",
  "expense",
  "loan",
  "tax",
  "risk",
  "area",
  "transaction",
]);

const FINANCIAL_ENTITY_TYPES = Object.freeze([
  "expense",
  "loan",
  "tax",
  "transaction",
]);

function jreEntityStore(entityType) {
  return {
    name:`${entityType}_records`,
    indexes:[
      ["sourceId", "source_id"],
      ["propertyId", "property_id"],
      ["reviewStatus", "review_status"],
      ["riskLevel", "risk_level"],
      ["version", "version"],
      ["updatedAt", "updated_at"],
    ],
  };
}

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
  propertyRecords:jreEntityStore("property"),
  landRecords:jreEntityStore("land"),
  buildingRecords:jreEntityStore("building"),
  leaseRecords:jreEntityStore("lease"),
  expenseRecords:jreEntityStore("expense"),
  loanRecords:jreEntityStore("loan"),
  taxRecords:jreEntityStore("tax"),
  riskRecords:jreEntityStore("risk"),
  areaRecords:jreEntityStore("area"),
  transactionRecords:jreEntityStore("transaction"),
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

function validateSourceRegistryRecord(source = {}) {
  const issues = [];
  if (!`${source.source_type || ""}`.trim()) issues.push("missing_source_type");
  if (!`${source.title || ""}`.trim()) issues.push("missing_title");
  if (!source.review_status) issues.push("missing_review_status");
  if (!source.risk_level) issues.push("missing_risk_level");
  if (!source.version) issues.push("missing_version");
  if (source.deletion_requested === true && source.training_allowed === true) {
    issues.push("deleted_source_training_enabled");
  }
  if (["high", "restricted"].includes(source.risk_level) && source.training_allowed === true) {
    issues.push("high_risk_training_enabled");
  }
  if (source.training_allowed === true && !["opt_in", "explicit_opt_in"].includes(source.consent_scope)) {
    issues.push("training_without_explicit_consent");
  }
  return {
    ok:issues.length === 0,
    issues,
  };
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

function normalizeCalculationMethod(value = "source_reported") {
  const method = `${value || "source_reported"}`.trim();
  const allowed = ["source_reported", "deterministic_code", "manual_entry", "unknown"];
  assertEnum("calculation_method", method, allowed);
  return method;
}

function buildJapaneseRealEstateRecord(entityType, input = {}) {
  const normalizedEntityType = `${entityType || ""}`.trim();
  assertEnum("entity_type", normalizedEntityType, JRE_ENTITY_TYPES);
  const isProperty = normalizedEntityType === "property";
  const isFinancial = FINANCIAL_ENTITY_TYPES.includes(normalizedEntityType);
  return {
    ...baseFields(input, {
      idPrefix:normalizedEntityType,
      defaultRisk:input.risk_level || (normalizedEntityType === "risk" ? "high" : "medium"),
    }),
    entity_type:normalizedEntityType,
    source_id:requireSourceId(input),
    property_id:isProperty ? `${input.property_id || input.id || ""}`.trim() : requireText("property_id", input.property_id),
    title:requireText("title", input.title),
    locale:`${input.locale || "ja-JP"}`.trim(),
    evidence_ref_ids:Array.isArray(input.evidence_ref_ids) ? input.evidence_ref_ids : [],
    calculation_method:isFinancial ? normalizeCalculationMethod(input.calculation_method) : "source_reported",
    attributes:input.attributes && typeof input.attributes === "object" ? input.attributes : {},
    metadata:input.metadata && typeof input.metadata === "object" ? input.metadata : {},
  };
}

function buildPropertyRecord(input = {}) {
  return {
    ...buildJapaneseRealEstateRecord("property", input),
    address:`${input.address || ""}`.trim(),
    property_type:`${input.property_type || "unknown"}`.trim(),
  };
}

function buildLandRecord(input = {}) {
  return {
    ...buildJapaneseRealEstateRecord("land", input),
    land_area_sqm:input.land_area_sqm ?? null,
    zoning:`${input.zoning || ""}`.trim(),
    ownership_right:`${input.ownership_right || ""}`.trim(),
  };
}

function buildBuildingRecord(input = {}) {
  return {
    ...buildJapaneseRealEstateRecord("building", input),
    built_year:input.built_year ?? null,
    structure:`${input.structure || ""}`.trim(),
    floor_area_sqm:input.floor_area_sqm ?? null,
  };
}

function buildLeaseRecord(input = {}) {
  return {
    ...buildJapaneseRealEstateRecord("lease", input),
    unit_label:`${input.unit_label || ""}`.trim(),
    rent_amount:input.rent_amount ?? null,
    lease_status:`${input.lease_status || "unknown"}`.trim(),
  };
}

function buildExpenseRecord(input = {}) {
  return {
    ...buildJapaneseRealEstateRecord("expense", input),
    expense_type:`${input.expense_type || "unknown"}`.trim(),
    amount:input.amount ?? null,
    period:`${input.period || ""}`.trim(),
  };
}

function buildLoanRecord(input = {}) {
  return {
    ...buildJapaneseRealEstateRecord("loan", input),
    principal_amount:input.principal_amount ?? null,
    interest_rate:input.interest_rate ?? null,
    term_months:input.term_months ?? null,
  };
}

function buildTaxRecord(input = {}) {
  return {
    ...buildJapaneseRealEstateRecord("tax", input),
    tax_type:`${input.tax_type || "unknown"}`.trim(),
    amount:input.amount ?? null,
    period:`${input.period || ""}`.trim(),
  };
}

function buildRiskRecord(input = {}) {
  return {
    ...buildJapaneseRealEstateRecord("risk", input),
    risk_type:requireText("risk_type", input.risk_type),
    finding:requireText("finding", input.finding),
    severity:`${input.severity || "unknown"}`.trim(),
    requires_expert_confirmation:input.requires_expert_confirmation !== false,
  };
}

function buildAreaRecord(input = {}) {
  return {
    ...buildJapaneseRealEstateRecord("area", input),
    municipality:`${input.municipality || ""}`.trim(),
    station:`${input.station || ""}`.trim(),
    area_code:`${input.area_code || ""}`.trim(),
  };
}

function buildTransactionRecord(input = {}) {
  return {
    ...buildJapaneseRealEstateRecord("transaction", input),
    transaction_type:`${input.transaction_type || "unknown"}`.trim(),
    price_amount:input.price_amount ?? null,
    contract_date:`${input.contract_date || ""}`.trim(),
  };
}

function validateJapaneseRealEstateRecord(record = {}) {
  const issues = [];
  const conclusion = validateSourceBackedConclusion(record);
  issues.push(...conclusion.issues);
  if (!JRE_ENTITY_TYPES.includes(record.entity_type)) issues.push("invalid_entity_type");
  if (!`${record.title || ""}`.trim()) issues.push("missing_title");
  if (record.entity_type !== "property" && !`${record.property_id || ""}`.trim()) issues.push("missing_property_id");
  if (FINANCIAL_ENTITY_TYPES.includes(record.entity_type) && record.calculation_method === "llm") {
    issues.push("llm_financial_calculation");
  }
  if (["risk", "transaction"].includes(record.entity_type) && record.review_status !== "approved") {
    issues.push("high_impact_record_not_approved");
  }
  if (record.entity_type === "risk" && record.requires_expert_confirmation !== true) {
    issues.push("risk_record_missing_expert_confirmation");
  }
  return {
    ok:issues.length === 0,
    issues:[...new Set(issues)],
    requiresExpertConfirmation:conclusion.requiresExpertConfirmation || record.entity_type === "risk",
  };
}

function validateEvidenceRefQuality(ref = {}) {
  const issues = [];
  if (!ref.source_id) issues.push("missing_source_id");
  if (!`${ref.target_type || ""}`.trim()) issues.push("missing_target_type");
  if (!`${ref.target_id || ""}`.trim()) issues.push("missing_target_id");
  if (!`${ref.locator || ""}`.trim()) issues.push("missing_locator");
  if (!ref.review_status) issues.push("missing_review_status");
  if (!ref.risk_level) issues.push("missing_risk_level");
  if (!ref.version) issues.push("missing_version");
  if (["high", "restricted"].includes(ref.risk_level) && ref.review_status !== "approved") {
    issues.push("high_risk_evidence_not_approved");
  }
  if (!`${ref.quote || ""}`.trim() && !`${ref.hash || ""}`.trim()) {
    issues.push("missing_quote_or_hash");
  }
  return {
    ok:issues.length === 0,
    issues,
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

function validateKnowledgeUnitQuality(unit = {}) {
  const issues = [];
  const conclusion = validateSourceBackedConclusion(unit);
  issues.push(...conclusion.issues);
  if (!`${unit.domain || ""}`.trim()) issues.push("missing_domain");
  if (!`${unit.title || ""}`.trim()) issues.push("missing_title");
  if (!`${unit.content || ""}`.trim()) issues.push("missing_content");
  if (`${unit.content || ""}`.trim().length > 0 && `${unit.content || ""}`.trim().length < 12) {
    issues.push("content_too_short");
  }
  return {
    ok:issues.length === 0,
    issues:[...new Set(issues)],
    requiresExpertConfirmation:conclusion.requiresExpertConfirmation,
  };
}

function validateKnowledgeUnitVersionChain(units = []) {
  const byId = new Map(units.filter(unit => unit?.id).map(unit => [unit.id, unit]));
  const issues = [];
  for (const unit of units) {
    if (!unit?.id) {
      issues.push({ id:"", issue:"missing_id" });
      continue;
    }
    if (unit.supersedes_id) {
      if (unit.supersedes_id === unit.id) {
        issues.push({ id:unit.id, issue:"self_supersedes" });
        continue;
      }
      const previous = byId.get(unit.supersedes_id);
      if (!previous) {
        issues.push({ id:unit.id, issue:"missing_superseded_unit" });
        continue;
      }
      if (normalizeVersion(unit.version) <= normalizeVersion(previous.version)) {
        issues.push({ id:unit.id, issue:"non_incrementing_version" });
      }
      if (unit.source_id !== previous.source_id) {
        issues.push({ id:unit.id, issue:"supersedes_cross_source" });
      }
    }
  }
  return {
    ok:issues.length === 0,
    issues,
  };
}

export {
  FINANCIAL_ENTITY_TYPES,
  HIGH_RISK_SOURCE_TYPES,
  JRE_ENTITY_TYPES,
  KNOWLEDGE_BRAIN_STORES,
  REVIEW_STATUSES,
  RISK_LEVELS,
  assertHighRiskReviewable,
  buildEvalCaseRecord,
  buildEvidenceRefRecord,
  buildAreaRecord,
  buildBuildingRecord,
  buildExpenseRecord,
  buildJapaneseRealEstateRecord,
  buildLandRecord,
  buildLeaseRecord,
  buildLoanRecord,
  buildKnowledgeUnitRecord,
  buildPolicyRuleRecord,
  buildPropertyRecord,
  buildRiskRecord,
  buildScenarioRecord,
  buildSourceRegistryRecord,
  buildTaxRecord,
  buildTransactionRecord,
  normalizeCalculationMethod,
  normalizeReviewStatus,
  normalizeRiskLevel,
  normalizeVersion,
  validateEvidenceRefQuality,
  validateJapaneseRealEstateRecord,
  validateKnowledgeUnitQuality,
  validateKnowledgeUnitVersionChain,
  validateSourceRegistryRecord,
  validateSourceBackedConclusion,
};
