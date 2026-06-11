import test from "node:test";
import assert from "node:assert/strict";

import {
  HIGH_RISK_SOURCE_TYPES,
  KNOWLEDGE_BRAIN_STORES,
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
} from "../lib/knowledgeBrainSchemas.mjs";

test("knowledge brain stores define phase 0 and phase 1 database tables", () => {
  assert.deepEqual(Object.values(KNOWLEDGE_BRAIN_STORES).map(store => store.name), [
    "source_registry",
    "knowledge_units",
    "policy_rules",
    "scenarios",
    "eval_cases",
    "evidence_refs",
  ]);

  for (const store of Object.values(KNOWLEDGE_BRAIN_STORES)) {
    assert.ok(store.indexes.some(([, keyPath]) => keyPath === "source_id") || store.name === "source_registry");
    assert.ok(store.indexes.some(([, keyPath]) => keyPath === "review_status"));
    assert.ok(store.indexes.some(([, keyPath]) => keyPath === "risk_level"));
    assert.ok(store.indexes.some(([, keyPath]) => keyPath === "version") || store.name === "source_registry");
  }
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

test("schema enum normalization rejects invalid states", () => {
  assert.equal(normalizeReviewStatus("approved"), "approved");
  assert.equal(normalizeRiskLevel("restricted"), "restricted");
  assert.equal(normalizeVersion("2"), 2);
  assert.throws(() => normalizeReviewStatus("published"), /review_status/);
  assert.throws(() => normalizeRiskLevel("critical"), /risk_level/);
  assert.throws(() => normalizeVersion(0), /version/);
});
