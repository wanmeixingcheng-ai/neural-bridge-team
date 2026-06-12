import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  HIGH_RISK_SOURCE_TYPES,
  JRE_ENTITY_TYPES,
  KNOWLEDGE_BRAIN_STORES,
  assertHighRiskReviewable,
  buildBuildingRecord,
  buildCalculationRunRecord,
  buildEvalCaseRecord,
  buildEvidenceRefRecord,
  buildExpenseRecord,
  buildKnowledgeUnitRecord,
  buildLandRecord,
  buildLeaseRecord,
  buildLoanRecord,
  buildPolicyRuleRecord,
  buildPropertyRecord,
  buildRiskRecord,
  buildScenarioRecord,
  buildSourceRegistryRecord,
  buildTaxRecord,
  buildTransactionRecord,
  buildAreaRecord,
  normalizeReviewStatus,
  normalizeRiskLevel,
  normalizeVersion,
  validateEvidenceRefQuality,
  validateCalculationRunRecord,
  validateJapaneseRealEstateRecord,
  validateKnowledgeUnitQuality,
  validateKnowledgeUnitVersionChain,
  validateSourceRegistryRecord,
  validateSourceBackedConclusion,
} from "../lib/knowledgeBrainSchemas.mjs";

test("knowledge brain stores define phase 0 and phase 1 database tables", () => {
  assert.deepEqual(Object.values(KNOWLEDGE_BRAIN_STORES).map(store => store.name), [
    "source_registry",
    "knowledge_units",
    "policy_rules",
    "scenarios",
    "eval_cases",
    "evidence_refs",
    "calculation_runs",
    "property_records",
    "land_records",
    "building_records",
    "lease_records",
    "expense_records",
    "loan_records",
    "tax_records",
    "risk_records",
    "area_records",
    "transaction_records",
  ]);

  for (const store of Object.values(KNOWLEDGE_BRAIN_STORES)) {
    assert.ok(
      store.indexes.some(([, keyPath]) => keyPath === "source_id") ||
      store.name === "source_registry" ||
      store.name === "calculation_runs"
    );
    assert.ok(store.indexes.some(([, keyPath]) => keyPath === "review_status"));
    assert.ok(store.indexes.some(([, keyPath]) => keyPath === "risk_level"));
    assert.ok(store.indexes.some(([, keyPath]) => keyPath === "version") || store.name === "source_registry");
  }

  assert.deepEqual(KNOWLEDGE_BRAIN_STORES.sourceRegistry.indexes.find(([name]) => name === "sourceTypeReview")?.[1], ["source_type", "review_status"]);
  assert.deepEqual(KNOWLEDGE_BRAIN_STORES.knowledgeUnits.indexes.find(([name]) => name === "sourceReview")?.[1], ["source_id", "review_status"]);
  assert.deepEqual(KNOWLEDGE_BRAIN_STORES.evidenceRefs.indexes.find(([name]) => name === "targetReview")?.[1], ["target_type", "target_id", "review_status"]);
  assert.deepEqual(KNOWLEDGE_BRAIN_STORES.calculationRuns.indexes.find(([name]) => name === "propertyType")?.[1], ["property_id", "calculation_type"]);
});

test("japanese real estate entity schemas cover property workspace data domains", () => {
  assert.deepEqual(JRE_ENTITY_TYPES, [
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

  const storeNames = Object.values(KNOWLEDGE_BRAIN_STORES).map(store => store.name);
  for (const type of JRE_ENTITY_TYPES) {
    assert.ok(storeNames.includes(`${type}_records`));
  }
});

test("calculation run schema preserves deterministic formulas and audit references", () => {
  const run = buildCalculationRunRecord({
    property_id:"prop-1",
    calculation_type:"investment_metrics",
    inputs:{ acquisitionPrice:60000000 },
    formulas:{ netYieldPercent:"noi / acquisitionPrice * 100" },
    outputs:{ netYieldPercent:4.05 },
    source_ids:["src-lease"],
    evidence_ref_ids:["ev-lease"],
    review_status:"candidate",
    risk_level:"medium",
  });
  const invalid = validateCalculationRunRecord({
    id:"calc-1",
    property_id:"",
    calculation_type:"investment_metrics",
    calculation_method:"llm",
    inputs:{},
    formulas:{},
    outputs:{},
    source_ids:[],
    evidence_ref_ids:[],
    review_status:"candidate",
    risk_level:"high",
    version:1,
  });

  assert.equal(run.calculation_method, "deterministic_code");
  assert.equal(run.version, 1);
  assert.equal(validateCalculationRunRecord(run).ok, true);
  assert.deepEqual(invalid.issues, [
    "missing_property_id",
    "non_deterministic_calculation",
    "missing_inputs",
    "missing_formulas",
    "missing_outputs",
    "missing_source_ids",
    "missing_evidence_ref_ids",
    "high_risk_calculation_not_approved",
  ]);
});

test("source registry treats REINS and high-risk uploads as non-training sources", () => {
  assert.ok(HIGH_RISK_SOURCE_TYPES.includes("reins_user_upload"));

  const source = buildSourceRegistryRecord({
    source_type:"reins_user_upload",
    title:"REINS uploaded material",
    training_allowed:true,
  });

  assert.equal(source.risk_level, "high");
  assert.equal(source.training_allowed, false);
  assert.equal(source.review_status, "candidate");
  assert.equal(source.version, 1);
});

test("source registry validation enforces consent and deletion boundaries", () => {
  const valid = validateSourceRegistryRecord({
    source_type:"public_manual",
    title:"Public source",
    review_status:"approved",
    risk_level:"low",
    version:1,
    training_allowed:true,
    deletion_requested:false,
    consent_scope:"explicit_opt_in",
  });
  const invalid = validateSourceRegistryRecord({
    source_type:"contract",
    title:"",
    review_status:"approved",
    risk_level:"high",
    version:1,
    training_allowed:true,
    deletion_requested:true,
    consent_scope:"none",
  });

  assert.equal(valid.ok, true);
  assert.deepEqual(invalid.issues, [
    "missing_title",
    "deleted_source_training_enabled",
    "high_risk_training_enabled",
    "training_without_explicit_consent",
  ]);
});

test("database schema enforces source registry training boundaries", () => {
  const sql = readFileSync(new URL("../lib/database.sql", import.meta.url), "utf8");

  assert.match(sql, /nb_source_registry_training_boundary_chk/);
  assert.match(sql, /consent_scope in \('opt_in', 'explicit_opt_in'\)/);
  assert.match(sql, /deletion_requested = false/);
  assert.match(sql, /risk_level not in \('high', 'restricted'\)/);
  assert.match(sql, /source_type not in \('reins_user_upload', 'contract', 'important_matter_explanation', 'customer_record'\)/);
});

test("database schema enforces evidence locator and quote or hash boundary", () => {
  const sql = readFileSync(new URL("../lib/database.sql", import.meta.url), "utf8");

  assert.match(sql, /nb_evidence_refs_locator_chk/);
  assert.match(sql, /length\(trim\(locator\)\) > 0/);
  assert.match(sql, /nb_evidence_refs_quote_or_hash_chk/);
  assert.match(sql, /length\(trim\(quote\)\) > 0 or length\(trim\(hash\)\) > 0/);
});

test("database schema enforces knowledge unit content quality boundary", () => {
  const sql = readFileSync(new URL("../lib/database.sql", import.meta.url), "utf8");

  assert.match(sql, /nb_knowledge_units_domain_chk/);
  assert.match(sql, /length\(trim\(domain\)\) > 0/);
  assert.match(sql, /nb_knowledge_units_title_chk/);
  assert.match(sql, /length\(trim\(title\)\) > 0/);
  assert.match(sql, /nb_knowledge_units_content_chk/);
  assert.match(sql, /length\(trim\(content\)\) >= 12/);
});

test("database schema enforces evidence id fields as json arrays", () => {
  const sql = readFileSync(new URL("../lib/database.sql", import.meta.url), "utf8");

  for (const constraintName of [
    "nb_knowledge_units_tags_array_chk",
    "nb_knowledge_units_evidence_ref_ids_array_chk",
    "nb_policy_rules_applies_to_array_chk",
    "nb_policy_rules_evidence_ref_ids_array_chk",
    "nb_scenarios_expected_outputs_array_chk",
    "nb_scenarios_evidence_ref_ids_array_chk",
    "nb_eval_cases_evidence_ref_ids_array_chk",
    "nb_jre_records_evidence_ref_ids_array_chk",
  ]) {
    assert.match(sql, new RegExp(constraintName));
  }

  assert.match(sql, /jsonb_typeof\(tags\) = 'array'/);
  assert.match(sql, /jsonb_typeof\(source_ids\) = 'array'/);
  assert.match(sql, /jsonb_typeof\(evidence_ref_ids\) = 'array'/);
});

test("database schema enforces metadata and payload fields as json objects", () => {
  const sql = readFileSync(new URL("../lib/database.sql", import.meta.url), "utf8");

  for (const constraintName of [
    "nb_source_registry_metadata_object_chk",
    "nb_knowledge_units_metadata_object_chk",
    "nb_policy_rules_metadata_object_chk",
    "nb_scenarios_metadata_object_chk",
    "nb_eval_cases_scoring_rubric_object_chk",
    "nb_eval_cases_metadata_object_chk",
    "nb_evidence_refs_metadata_object_chk",
    "nb_jre_records_attributes_object_chk",
    "nb_jre_records_metadata_object_chk",
  ]) {
    assert.match(sql, new RegExp(constraintName));
  }

  assert.match(sql, /jsonb_typeof\(metadata\) = 'object'/);
  assert.match(sql, /jsonb_typeof\(attributes\) = 'object'/);
  assert.match(sql, /jsonb_typeof\(inputs\) = 'object'/);
  assert.match(sql, /jsonb_typeof\(formulas\) = 'object'/);
  assert.match(sql, /jsonb_typeof\(outputs\) = 'object'/);
  assert.match(sql, /jsonb_typeof\(dossier_snapshot\) = 'object'/);
});

test("database schema requires reviewer metadata for approved high risk records", () => {
  const sql = readFileSync(new URL("../lib/database.sql", import.meta.url), "utf8");

  for (const constraintName of [
    "nb_source_registry_high_risk_review_metadata_chk",
    "nb_knowledge_units_high_risk_review_metadata_chk",
    "nb_policy_rules_high_risk_review_metadata_chk",
    "nb_scenarios_high_risk_review_metadata_chk",
    "nb_eval_cases_high_risk_review_metadata_chk",
    "nb_evidence_refs_high_risk_review_metadata_chk",
    "nb_jre_records_high_risk_review_metadata_chk",
  ]) {
    assert.match(sql, new RegExp(constraintName));
  }

  assert.match(sql, /review_status <> 'approved' or risk_level not in \('high', 'restricted'\)/);
  assert.match(sql, /length\(trim\(metadata->>'reviewed_by'\)\) > 0/);
  assert.match(sql, /length\(trim\(metadata->>'reviewed_at'\)\) > 0/);
});

test("database schema enforces governance record core text boundaries", () => {
  const sql = readFileSync(new URL("../lib/database.sql", import.meta.url), "utf8");

  assert.match(sql, /nb_policy_rules_core_text_chk/);
  assert.match(sql, /length\(trim\(rule_type\)\) > 0 and length\(trim\(title\)\) > 0 and length\(trim\(rule_text\)\) > 0/);
  assert.match(sql, /nb_scenarios_core_text_chk/);
  assert.match(sql, /length\(trim\(scenario_type\)\) > 0 and length\(trim\(title\)\) > 0 and length\(trim\(description\)\) > 0/);
  assert.match(sql, /nb_eval_cases_core_text_chk/);
  assert.match(sql, /length\(trim\(prompt\)\) > 0 and length\(trim\(expected_behavior\)\) > 0/);
});

test("database schema enforces Japanese real estate core identity boundaries", () => {
  const sql = readFileSync(new URL("../lib/database.sql", import.meta.url), "utf8");

  assert.match(sql, /nb_jre_records_title_chk/);
  assert.match(sql, /length\(trim\(title\)\) > 0/);
  assert.match(sql, /nb_jre_records_property_id_chk/);
  assert.match(sql, /entity_type = 'property' or length\(trim\(property_id\)\) > 0/);
});

test("database schema enforces calculation run deterministic payload boundary", () => {
  const sql = readFileSync(new URL("../lib/database.sql", import.meta.url), "utf8");

  assert.match(sql, /nb_calculation_runs_method_chk check \(calculation_method = 'deterministic_code'\)/);
  assert.match(sql, /nb_calculation_runs_payload_chk/);
  assert.match(sql, /inputs <> '\{\}'::jsonb/);
  assert.match(sql, /formulas <> '\{\}'::jsonb/);
  assert.match(sql, /outputs <> '\{\}'::jsonb/);
  assert.match(sql, /jsonb_typeof\(inputs\) = 'object'/);
  assert.match(sql, /jsonb_typeof\(formulas\) = 'object'/);
  assert.match(sql, /jsonb_typeof\(outputs\) = 'object'/);
  assert.match(sql, /jsonb_typeof\(source_ids\) = 'array'/);
  assert.match(sql, /jsonb_typeof\(evidence_ref_ids\) = 'array'/);
  assert.match(sql, /jsonb_array_length\(source_ids\) > 0/);
  assert.match(sql, /jsonb_array_length\(evidence_ref_ids\) > 0/);
});

test("database schema indexes review and source filtering paths", () => {
  const sql = readFileSync(new URL("../lib/database.sql", import.meta.url), "utf8");

  for (const indexName of [
    "nb_source_registry_consent_idx",
    "nb_source_registry_deletion_idx",
    "nb_source_registry_type_review_idx",
    "nb_knowledge_units_source_review_idx",
    "nb_policy_rules_review_idx",
    "nb_policy_rules_risk_idx",
    "nb_policy_rules_source_review_idx",
    "nb_scenarios_review_idx",
    "nb_scenarios_risk_idx",
    "nb_scenarios_source_review_idx",
    "nb_eval_cases_review_idx",
    "nb_eval_cases_risk_idx",
    "nb_eval_cases_source_review_idx",
    "nb_evidence_refs_review_idx",
    "nb_evidence_refs_risk_idx",
    "nb_evidence_refs_target_review_idx",
    "nb_jre_records_property_review_idx",
    "nb_calculation_runs_property_type_idx",
    "nb_calculation_runs_source_ids_idx",
    "nb_calculation_runs_evidence_ref_ids_idx",
  ]) {
    assert.match(sql, new RegExp(indexName));
  }
});

test("knowledge unit requires source, review status, risk level, and version", () => {
  const unit = buildKnowledgeUnitRecord({
    source_id:"src-1",
    domain:"D01",
    title:"重要事項説明 risk note",
    content:"Source-backed content only.",
    risk_level:"high",
    review_status:"in_review",
  });

  assert.equal(unit.source_id, "src-1");
  assert.equal(unit.review_status, "in_review");
  assert.equal(unit.risk_level, "high");
  assert.equal(unit.version, 1);
  assert.equal(assertHighRiskReviewable(unit), true);
});

test("policy rules default to expert-confirmed high-risk review flow", () => {
  const rule = buildPolicyRuleRecord({
    source_id:"src-1",
    rule_type:"reins_boundary",
    title:"No automated REINS scraping",
    rule_text:"Only provide official login entrance; do not proxy login or scrape.",
  });

  assert.equal(rule.review_status, "in_review");
  assert.equal(rule.risk_level, "high");
  assert.equal(rule.requires_expert_confirmation, true);
});

test("scenario, eval case, and evidence refs preserve source linkage", () => {
  const scenario = buildScenarioRecord({
    source_id:"src-1",
    scenario_type:"due_diligence",
    title:"Uploaded evidence review",
    description:"User uploads source material for risk review.",
  });
  const evalCase = buildEvalCaseRecord({
    source_id:"src-1",
    scenario_id:scenario.id,
    prompt:"Assess the uploaded material.",
    expected_behavior:"Cite evidence and ask for expert review for high-risk findings.",
  });
  const evidence = buildEvidenceRefRecord({
    source_id:"src-1",
    target_type:"knowledge_unit",
    target_id:"ku-1",
    locator:"page 2",
    quote:"short quote",
  });

  assert.equal(scenario.source_id, "src-1");
  assert.equal(evalCase.scenario_id, scenario.id);
  assert.equal(evidence.target_id, "ku-1");
  assert.equal(evidence.source_id, "src-1");
});

test("evidence ref quality validation catches missing locator and unapproved high risk evidence", () => {
  const valid = validateEvidenceRefQuality({
    source_id:"src-1",
    target_type:"knowledge_unit",
    target_id:"ku-1",
    locator:"page 2",
    quote:"short quote",
    review_status:"approved",
    risk_level:"medium",
    version:1,
  });
  const invalid = validateEvidenceRefQuality({
    source_id:"",
    target_type:"knowledge_unit",
    target_id:"",
    locator:"",
    quote:"",
    hash:"",
    review_status:"candidate",
    risk_level:"high",
    version:1,
  });

  assert.equal(valid.ok, true);
  assert.deepEqual(invalid.issues, [
    "missing_source_id",
    "missing_target_id",
    "missing_locator",
    "high_risk_evidence_not_approved",
    "missing_quote_or_hash",
  ]);
});

test("schema enum normalization rejects invalid states", () => {
  assert.equal(normalizeReviewStatus("approved"), "approved");
  assert.equal(normalizeRiskLevel("restricted"), "restricted");
  assert.equal(normalizeVersion("2"), 2);
  assert.throws(() => normalizeReviewStatus("published"), /review_status/);
  assert.throws(() => normalizeRiskLevel("critical"), /risk_level/);
  assert.throws(() => normalizeVersion(0), /version/);
});

test("source-backed conclusion validation gates high-risk claims", () => {
  const approvedHighRisk = validateSourceBackedConclusion({
    source_id:"src-1",
    review_status:"approved",
    risk_level:"high",
    version:1,
    evidence_ref_ids:["ev-1"],
  });
  const missingEvidence = validateSourceBackedConclusion({
    source_id:"src-1",
    review_status:"approved",
    risk_level:"high",
    version:1,
    evidence_ref_ids:[],
  });
  const notApproved = validateSourceBackedConclusion({
    source_id:"src-1",
    review_status:"candidate",
    risk_level:"restricted",
    version:1,
    evidence_ref_ids:["ev-1"],
  });
  const lowRisk = validateSourceBackedConclusion({
    source_id:"src-1",
    review_status:"candidate",
    risk_level:"low",
    version:1,
    evidence_ref_ids:[],
  });

  assert.equal(approvedHighRisk.ok, true);
  assert.equal(approvedHighRisk.requiresExpertConfirmation, true);
  assert.deepEqual(missingEvidence.issues, ["high_risk_missing_evidence"]);
  assert.deepEqual(notApproved.issues, ["high_risk_not_approved"]);
  assert.equal(lowRisk.ok, true);
  assert.equal(lowRisk.requiresExpertConfirmation, false);
});

test("knowledge unit quality validation catches missing fields and weak content", () => {
  const valid = validateKnowledgeUnitQuality({
    source_id:"src-1",
    domain:"D01",
    title:"Flood hazard note",
    content:"This unit summarizes a source-backed flood hazard finding.",
    review_status:"approved",
    risk_level:"medium",
    version:1,
    evidence_ref_ids:[],
  });
  const weak = validateKnowledgeUnitQuality({
    source_id:"src-1",
    domain:"",
    title:"",
    content:"short",
    review_status:"candidate",
    risk_level:"low",
    version:1,
    evidence_ref_ids:[],
  });
  const highRiskMissingEvidence = validateKnowledgeUnitQuality({
    source_id:"src-1",
    domain:"D02",
    title:"Contract risk",
    content:"This unit contains a high-risk contract conclusion.",
    review_status:"approved",
    risk_level:"high",
    version:1,
    evidence_ref_ids:[],
  });

  assert.equal(valid.ok, true);
  assert.deepEqual(weak.issues, ["missing_domain", "missing_title", "content_too_short"]);
  assert.equal(highRiskMissingEvidence.ok, false);
  assert.deepEqual(highRiskMissingEvidence.issues, ["high_risk_missing_evidence"]);
  assert.equal(highRiskMissingEvidence.requiresExpertConfirmation, true);
});

test("knowledge unit version chain validation preserves lineage", () => {
  const valid = validateKnowledgeUnitVersionChain([
    { id:"ku-v1", source_id:"src-1", version:1 },
    { id:"ku-v2", source_id:"src-1", version:2, supersedes_id:"ku-v1" },
  ]);
  const invalid = validateKnowledgeUnitVersionChain([
    { id:"self", source_id:"src-1", version:2, supersedes_id:"self" },
    { id:"missing", source_id:"src-1", version:2, supersedes_id:"none" },
    { id:"same-version", source_id:"src-1", version:1, supersedes_id:"base" },
    { id:"cross-source", source_id:"src-2", version:3, supersedes_id:"base" },
    { id:"base", source_id:"src-1", version:1 },
  ]);

  assert.equal(valid.ok, true);
  assert.equal(invalid.ok, false);
  assert.deepEqual(invalid.issues, [
    { id:"self", issue:"self_supersedes" },
    { id:"missing", issue:"missing_superseded_unit" },
    { id:"same-version", issue:"non_incrementing_version" },
    { id:"cross-source", issue:"supersedes_cross_source" },
  ]);
});

test("japanese real estate records preserve source linkage and deterministic calculation boundary", () => {
  const base = {
    source_id:"src-1",
    property_id:"prop-1",
    title:"渋谷区サンプル物件",
    review_status:"approved",
    risk_level:"medium",
    evidence_ref_ids:["ev-1"],
  };
  const property = buildPropertyRecord({ ...base, id:"prop-1", address:"東京都渋谷区", property_type:"mansion" });
  const land = buildLandRecord({ ...base, land_area_sqm:120.5, zoning:"商業地域" });
  const building = buildBuildingRecord({ ...base, built_year:1998, structure:"RC" });
  const lease = buildLeaseRecord({ ...base, unit_label:"201", rent_amount:140000 });
  const expense = buildExpenseRecord({ ...base, expense_type:"management_fee", amount:12000, calculation_method:"source_reported" });
  const loan = buildLoanRecord({ ...base, principal_amount:32000000, interest_rate:1.2, calculation_method:"deterministic_code" });
  const tax = buildTaxRecord({ ...base, tax_type:"fixed_asset_tax", amount:90000, calculation_method:"manual_entry" });
  const risk = buildRiskRecord({ ...base, risk_type:"contract", finding:"重要事項説明の専門確認が必要", risk_level:"high", requires_expert_confirmation:true });
  const area = buildAreaRecord({ ...base, municipality:"渋谷区", station:"渋谷" });
  const transaction = buildTransactionRecord({ ...base, transaction_type:"sale", price_amount:52000000, calculation_method:"source_reported" });

  for (const record of [property, land, building, lease, expense, loan, tax, risk, area, transaction]) {
    assert.equal(record.source_id, "src-1");
    assert.equal(record.version, 1);
    assert.equal(validateJapaneseRealEstateRecord(record).ok, true);
  }

  assert.equal(loan.calculation_method, "deterministic_code");
  assert.equal(risk.requires_expert_confirmation, true);
});

test("japanese real estate validation blocks weak high-impact and LLM-computed financial records", () => {
  const llmFinancial = validateJapaneseRealEstateRecord({
    id:"expense-1",
    entity_type:"expense",
    source_id:"src-1",
    property_id:"prop-1",
    title:"LLM calculated expense",
    review_status:"approved",
    risk_level:"medium",
    version:1,
    calculation_method:"llm",
    evidence_ref_ids:["ev-1"],
  });
  const weakRisk = validateJapaneseRealEstateRecord({
    id:"risk-1",
    entity_type:"risk",
    source_id:"src-1",
    property_id:"prop-1",
    title:"Unreviewed contract risk",
    review_status:"candidate",
    risk_level:"high",
    version:1,
    calculation_method:"source_reported",
    evidence_ref_ids:[],
    requires_expert_confirmation:false,
  });

  assert.deepEqual(llmFinancial.issues, ["llm_financial_calculation"]);
  assert.deepEqual(weakRisk.issues, [
    "high_risk_missing_evidence",
    "high_risk_not_approved",
    "high_impact_record_not_approved",
    "risk_record_missing_expert_confirmation",
  ]);
});
