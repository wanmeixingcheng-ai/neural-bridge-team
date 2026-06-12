import test from "node:test";
import assert from "node:assert/strict";

import { approvedKnowledgeBrainSearchResults, approvedKnowledgeUnitSearchResults, approvedMemoryMetadata, buildCalculationRunFromInvestmentMetrics, buildCalculationRunUpdatePayload, buildEvidenceRefUpdatePayload, buildJapaneseRealEstateRecordPayload, buildJapaneseRealEstateSourceIngestRecords, buildKnowledgeDocumentIngestRecords, buildKnowledgeGovernanceRecordPayload, buildKnowledgeGovernanceUpdatePayload, buildKnowledgeUnitUpdatePayload, buildPropertyDossier, buildPropertyDossierInvestmentMetrics, buildSourceRegistryUpdatePayload, buildSourceWithdrawalPatch, buildVersionedKnowledgePatch, chunkText, filterCalculationRunRecords, filterEvidenceRefRecords, filterJapaneseRealEstateRecords, filterKnowledgeDocumentRecords, filterKnowledgeGovernanceRecords, filterKnowledgeUnitRecords, filterProjectMemoriesBySourceType, filterSourceRegistryRecords, knowledgeBrainInventoryStats, knowledgeBrainReferenceIntegrityActions, knowledgeBrainReviewQueueItems, knowledgeBrainReviewQueueSummary, projectMemoryApprovalQueueSummary, projectMemoryNeedsApproval, projectMemorySourceTypeCounts, rememberWorkflowArtifact, selectLowValueMemories, trainingEligibleSources, validateKnowledgeBrainReferenceIntegrity } from "../lib/projectBrain.mjs";

test("project brain chunks long text with overlap", () => {
  const chunks = chunkText("a".repeat(30), 10, 2);
  assert.equal(chunks.length, 4);
  assert.equal(chunks[0].length, 10);
});

test("project brain ignores empty chunk content", () => {
  assert.deepEqual(chunkText("   "), []);
});

test("knowledge document ingest builds source, units, and evidence refs", () => {
  const records = buildKnowledgeDocumentIngestRecords({
    title:"Area hazard note",
    source:"attachment",
    text:"Flood risk source paragraph. ".repeat(120),
    chunks:["Flood risk source paragraph.", "Station access source paragraph."],
    documentId:"doc-1",
  });

  assert.equal(records.source.source_type, "attachment");
  assert.equal(records.source.review_status, "candidate");
  assert.equal(records.source.training_allowed, false);
  assert.equal(records.knowledgeUnits.length, 2);
  assert.equal(records.evidenceRefs.length, 2);
  assert.equal(records.knowledgeUnits[0].source_id, records.source.id);
  assert.equal(records.evidenceRefs[0].target_id, records.knowledgeUnits[0].id);
  assert.deepEqual(records.knowledgeUnits[0].evidence_ref_ids, [records.evidenceRefs[0].id]);
});

test("knowledge document ingest keeps REINS uploads high-risk and out of training", () => {
  const records = buildKnowledgeDocumentIngestRecords({
    title:"REINS uploaded listing",
    source:"reins_user_upload",
    text:"User uploaded REINS evidence.",
    trainingAllowed:true,
  });

  assert.equal(records.source.source_type, "reins_user_upload");
  assert.equal(records.source.risk_level, "high");
  assert.equal(records.source.training_allowed, false);
  assert.equal(records.knowledgeUnits[0].risk_level, "high");
  assert.equal(records.evidenceRefs[0].risk_level, "high");
});

test("knowledge document filters status source query archived and recency", () => {
  const filtered = filterKnowledgeDocumentRecords([
    { id:"old", title:"Hazard notes", source:"attachment", status:"candidate", archived:false, updatedAt:"2026-06-12T01:00:00.000Z" },
    { id:"new", title:"Updated hazard notes", source:"attachment", status:"candidate", archived:false, updatedAt:"2026-06-12T02:00:00.000Z" },
    { id:"approved", title:"Approved hazard notes", source:"attachment", status:"approved", archived:false, updatedAt:"2026-06-12T03:00:00.000Z" },
    { id:"other-source", title:"Hazard notes", source:"public_web", status:"candidate", archived:false, updatedAt:"2026-06-12T04:00:00.000Z" },
    { id:"archived", title:"Archived hazard notes", source:"attachment", status:"candidate", archived:true, updatedAt:"2026-06-12T05:00:00.000Z" },
  ], {
    statuses:["candidate"],
    sources:["attachment"],
    query:"hazard",
  });

  assert.deepEqual(filtered.map(doc => doc.id), ["new", "old"]);
});

test("japanese real estate record payload routes entities to their stores and blocks LLM math", () => {
  const payload = buildJapaneseRealEstateRecordPayload("loan", {
    source_id:"src-1",
    property_id:"prop-1",
    title:"Loan terms",
    review_status:"approved",
    risk_level:"medium",
    calculation_method:"deterministic_code",
    principal_amount:32000000,
    interest_rate:1.2,
    evidence_ref_ids:["ev-1"],
  });

  assert.equal(payload.storeName, "loan_records");
  assert.equal(payload.record.entity_type, "loan");
  assert.equal(payload.record.calculation_method, "deterministic_code");
  assert.equal(payload.record.principal_amount, 32000000);
  assert.equal(payload.record.interest_rate, 1.2);
  assert.equal(payload.quality.ok, true);
  assert.throws(() => buildJapaneseRealEstateRecordPayload("expense", {
    source_id:"src-1",
    property_id:"prop-1",
    title:"LLM expense",
    review_status:"approved",
    risk_level:"medium",
    calculation_method:"llm",
    evidence_ref_ids:["ev-1"],
  }), /must not use LLM calculation/);
});

test("japanese real estate source ingest builds auditable source, evidence, and entity records", () => {
  const ingest = buildJapaneseRealEstateSourceIngestRecords({
    title:"User uploaded REINS listing",
    source:"REINS manual upload",
    text:"Uploaded listing text retained locally.",
    records:[
      {
        id:"prop-1",
        entity_type:"property",
        property_id:"prop-1",
        title:"Property profile",
        address:"Tokyo",
        evidence:{ locator:"page 1", quote:"Property profile quote" },
      },
      {
        id:"risk-1",
        entity_type:"risk",
        property_id:"prop-1",
        title:"Flood risk",
        risk_type:"hazard",
        finding:"Flood risk needs expert review",
        risk_level:"high",
        requires_expert_confirmation:true,
        evidence:{ locator:"page 3", quote:"Flood risk quote" },
      },
    ],
    metadata:{ trainingAllowed:true, consentScope:"explicit_opt_in" },
  });

  assert.equal(ingest.source.source_type, "reins_user_upload");
  assert.equal(ingest.source.risk_level, "high");
  assert.equal(ingest.source.training_allowed, false);
  assert.equal(ingest.records.length, 2);
  assert.equal(ingest.records[0].storeName, "property_records");
  assert.equal(ingest.records[0].record.source_id, ingest.source.id);
  assert.equal(ingest.records[0].record.address, "Tokyo");
  assert.deepEqual(ingest.records[0].record.evidence_ref_ids, ["ev-prop-1"]);
  assert.equal(ingest.records[1].record.risk_type, "hazard");
  assert.equal(ingest.records[1].record.finding, "Flood risk needs expert review");
  assert.equal(ingest.evidenceRefs[0].target_type, "jre_property");
  assert.equal(ingest.evidenceRefs[0].target_id, "prop-1");
  assert.equal(ingest.reviewQueue.japaneseRealEstateRecords, 2);
  assert.equal(ingest.reviewQueue.highRiskExpertReview, 3);
  assert.equal(ingest.referenceIntegrity.ok, false);
  assert.equal(ingest.referenceIntegrity.issues.filter(issue => issue.issue === "high_risk_unapproved_evidence").length, 2);
});

test("japanese real estate filters property source review risk query and archived records", () => {
  const filtered = filterJapaneseRealEstateRecords([
    { id:"old", entity_type:"risk", source_id:"src-1", property_id:"prop-1", title:"Flood risk", risk_type:"hazard", finding:"Flood hazard finding.", review_status:"candidate", risk_level:"high", updated_at:"2026-06-12T01:00:00.000Z" },
    { id:"new", entity_type:"risk", source_id:"src-1", property_id:"prop-1", title:"Updated flood risk", risk_type:"hazard", finding:"Flood hazard finding.", review_status:"candidate", risk_level:"high", updated_at:"2026-06-12T02:00:00.000Z" },
    { id:"approved", entity_type:"risk", source_id:"src-1", property_id:"prop-1", title:"Approved flood risk", risk_type:"hazard", finding:"Flood hazard finding.", review_status:"approved", risk_level:"high", updated_at:"2026-06-12T03:00:00.000Z" },
    { id:"other-source", entity_type:"risk", source_id:"src-2", property_id:"prop-1", title:"Other flood risk", risk_type:"hazard", finding:"Flood hazard finding.", review_status:"candidate", risk_level:"high", updated_at:"2026-06-12T04:00:00.000Z" },
    { id:"other-property", entity_type:"risk", source_id:"src-1", property_id:"prop-2", title:"Other flood risk", risk_type:"hazard", finding:"Flood hazard finding.", review_status:"candidate", risk_level:"high", updated_at:"2026-06-12T05:00:00.000Z" },
    { id:"archived", entity_type:"risk", source_id:"src-1", property_id:"prop-1", title:"Archived flood risk", risk_type:"hazard", finding:"Flood hazard finding.", review_status:"archived", risk_level:"high", updated_at:"2026-06-12T06:00:00.000Z" },
  ], {
    propertyId:"prop-1",
    sourceIds:["src-1"],
    reviewStatuses:["candidate"],
    riskLevels:["high"],
    query:"flood",
  });

  assert.deepEqual(filtered.map(record => record.id), ["new", "old"]);
});

test("knowledge governance record payload routes policy, scenario, and eval records", () => {
  const policy = buildKnowledgeGovernanceRecordPayload("policy_rule", {
    source_id:"src-1",
    rule_type:"reins_boundary",
    title:"REINS boundary",
    rule_text:"Do not automate REINS login or scraping.",
    review_status:"in_review",
    risk_level:"high",
    evidence_ref_ids:["ev-rule"],
  });
  const scenario = buildKnowledgeGovernanceRecordPayload("scenario", {
    source_id:"src-1",
    scenario_type:"due_diligence",
    title:"Evidence review",
    description:"Review uploaded evidence without source-less conclusions.",
    review_status:"candidate",
    risk_level:"medium",
    evidence_ref_ids:["ev-scenario"],
  });
  const evalCase = buildKnowledgeGovernanceRecordPayload("eval_case", {
    source_id:"src-1",
    scenario_id:scenario.record.id,
    prompt:"Summarize a high-risk contract finding.",
    expected_behavior:"Cite evidence and require expert confirmation.",
    review_status:"candidate",
    risk_level:"high",
    evidence_ref_ids:["ev-eval"],
  });

  assert.equal(policy.storeName, "policy_rules");
  assert.equal(policy.record.requires_expert_confirmation, true);
  assert.equal(policy.record.version, 1);
  assert.equal(scenario.storeName, "scenarios");
  assert.equal(scenario.record.source_id, "src-1");
  assert.deepEqual(scenario.record.evidence_ref_ids, ["ev-scenario"]);
  assert.equal(evalCase.storeName, "eval_cases");
  assert.equal(evalCase.record.scenario_id, scenario.record.id);
  assert.deepEqual(evalCase.record.evidence_ref_ids, ["ev-eval"]);
  assert.throws(() => buildKnowledgeGovernanceRecordPayload("unknown", {}), /recordType must be one of/);
});

test("knowledge governance update payload versions reviewed records", () => {
  const update = buildKnowledgeGovernanceUpdatePayload("policy_rule", {
    id:"rule-1",
    source_id:"src-1",
    rule_type:"reins_boundary",
    title:"REINS boundary",
    rule_text:"Do not automate REINS login.",
    review_status:"approved",
    risk_level:"high",
    version:2,
    evidence_ref_ids:["ev-rule"],
    requires_expert_confirmation:true,
    metadata:{ owner:"compliance" },
  }, {
    rule_text:"Do not automate REINS login, browsing, scraping, or bulk download.",
    metadata:{ note:"expanded boundary" },
  }, {
    changedBy:"reviewer",
    reason:"policy_refinement",
    now:"2026-06-12T02:00:00.000Z",
  });

  assert.equal(update.storeName, "policy_rules");
  assert.equal(update.record.version, 3);
  assert.equal(update.record.review_status, "candidate");
  assert.equal(update.record.source_id, "src-1");
  assert.equal(update.record.metadata.owner, "compliance");
  assert.equal(update.record.metadata.note, "expanded boundary");
  assert.equal(update.record.metadata.previous_version, 2);
  assert.equal(update.record.metadata.changed_by, "reviewer");
  assert.equal(update.record.metadata.change_reason, "policy_refinement");
  assert.equal(update.quality.ok, false);
  assert.deepEqual(update.quality.issues, ["high_risk_not_approved"]);
});

test("knowledge governance filters source review risk query archived and recency", () => {
  const filtered = filterKnowledgeGovernanceRecords([
    { id:"old", source_id:"src-1", review_status:"candidate", risk_level:"high", title:"REINS rule", rule_text:"Do not automate REINS login.", updated_at:"2026-06-12T01:00:00.000Z" },
    { id:"new", source_id:"src-1", review_status:"candidate", risk_level:"high", title:"REINS boundary", rule_text:"Do not scrape REINS.", updated_at:"2026-06-12T02:00:00.000Z" },
    { id:"approved", source_id:"src-1", review_status:"approved", risk_level:"high", title:"REINS approved", rule_text:"Do not scrape REINS.", updated_at:"2026-06-12T03:00:00.000Z" },
    { id:"medium", source_id:"src-1", review_status:"candidate", risk_level:"medium", title:"REINS medium", rule_text:"Do not scrape REINS.", updated_at:"2026-06-12T04:00:00.000Z" },
    { id:"other-source", source_id:"src-2", review_status:"candidate", risk_level:"high", title:"REINS other", rule_text:"Do not scrape REINS.", updated_at:"2026-06-12T05:00:00.000Z" },
    { id:"archived", source_id:"src-1", review_status:"archived", risk_level:"high", title:"REINS archived", rule_text:"Do not scrape REINS.", updated_at:"2026-06-12T06:00:00.000Z" },
  ], {
    sourceId:"src-1",
    reviewStatuses:["candidate"],
    riskLevels:["high"],
    query:"reins",
  });

  assert.deepEqual(filtered.map(record => record.id), ["new", "old"]);
});

test("property dossier groups records and exposes review and quality queues", () => {
  const dossier = buildPropertyDossier({
    propertyId:"prop-1",
    records:[
      { id:"prop-1", entity_type:"property", source_id:"src-1", property_id:"prop-1", title:"Property", review_status:"approved", risk_level:"medium", version:1, calculation_method:"source_reported", evidence_ref_ids:["ev-1"] },
      { id:"lease-1", entity_type:"lease", source_id:"src-1", property_id:"prop-1", title:"Lease", review_status:"candidate", risk_level:"medium", version:1, calculation_method:"source_reported", evidence_ref_ids:["ev-2"] },
      { id:"risk-1", entity_type:"risk", source_id:"src-1", property_id:"prop-1", title:"Risk", review_status:"candidate", risk_level:"high", version:1, calculation_method:"source_reported", evidence_ref_ids:[], requires_expert_confirmation:false },
      { id:"prop-2", entity_type:"property", source_id:"src-1", property_id:"prop-2", title:"Other", review_status:"approved", risk_level:"medium", version:1, calculation_method:"source_reported", evidence_ref_ids:["ev-3"] },
    ],
  });

  assert.equal(dossier.records, 3);
  assert.equal(dossier.byType.property.length, 1);
  assert.equal(dossier.byType.lease.length, 1);
  assert.equal(dossier.byType.risk.length, 1);
  assert.deepEqual(dossier.evidenceRefIds, ["ev-1", "ev-2"]);
  assert.deepEqual(dossier.needsReview, ["lease-1", "risk-1"]);
  assert.deepEqual(dossier.qualityIssues.map(item => item.id), ["risk-1"]);
});

test("property dossier investment metrics use deterministic code and transaction price", () => {
  const metrics = buildPropertyDossierInvestmentMetrics({
    propertyId:"prop-1",
    vacancyRatePercent:5,
    records:[
      { id:"prop-1", entity_type:"property", source_id:"src-1", property_id:"prop-1", title:"Property", review_status:"approved", risk_level:"medium", version:1, calculation_method:"source_reported", evidence_ref_ids:["ev-property"] },
      { id:"lease-1", entity_type:"lease", source_id:"src-lease", property_id:"prop-1", title:"Lease 1", review_status:"approved", risk_level:"medium", version:1, rent_amount:150000, period:"monthly", evidence_ref_ids:["ev-lease"] },
      { id:"expense-1", entity_type:"expense", source_id:"src-expense", property_id:"prop-1", title:"Management fee", review_status:"approved", risk_level:"medium", version:1, amount:20000, period:"monthly", calculation_method:"source_reported", evidence_ref_ids:["ev-expense"] },
      { id:"tax-1", entity_type:"tax", source_id:"src-tax", property_id:"prop-1", title:"Fixed asset tax", review_status:"approved", risk_level:"medium", version:1, amount:180000, period:"annual", calculation_method:"source_reported", evidence_ref_ids:["ev-tax"] },
      { id:"loan-1", entity_type:"loan", source_id:"src-loan", property_id:"prop-1", title:"Loan", review_status:"approved", risk_level:"medium", version:1, principal_amount:30000000, interest_rate:1.2, term_months:360, calculation_method:"deterministic_code", evidence_ref_ids:["ev-loan"] },
      { id:"tx-1", entity_type:"transaction", source_id:"src-tx", property_id:"prop-1", title:"Purchase", review_status:"approved", risk_level:"medium", version:1, price_amount:60000000, contract_date:"2026-01-10", calculation_method:"source_reported", evidence_ref_ids:["ev-tx"] },
    ],
  });

  assert.equal(metrics.calculation_method, "deterministic_code");
  assert.equal(metrics.inputs.acquisitionPrice, 60000000);
  assert.equal(metrics.outputs.annualPotentialRent, 1800000);
  assert.equal(metrics.outputs.noi, 1290000);
  assert.equal(metrics.outputs.netYieldPercent, 2.15);
  assert.deepEqual(metrics.audit.sourceIds, ["src-lease", "src-expense", "src-tax", "src-loan"]);
  assert.deepEqual(metrics.dossier.needsReview, []);
});

test("investment metrics become auditable calculation run records", () => {
  const metrics = buildPropertyDossierInvestmentMetrics({
    propertyId:"prop-1",
    acquisitionPrice:60000000,
    records:[
      { id:"lease-1", entity_type:"lease", source_id:"src-lease", property_id:"prop-1", title:"Lease 1", review_status:"approved", risk_level:"medium", version:1, rent_amount:150000, period:"monthly", evidence_ref_ids:["ev-lease"] },
      { id:"expense-1", entity_type:"expense", source_id:"src-expense", property_id:"prop-1", title:"Management fee", review_status:"approved", risk_level:"medium", version:1, amount:20000, period:"monthly", calculation_method:"source_reported", evidence_ref_ids:["ev-expense"] },
    ],
  });
  const run = buildCalculationRunFromInvestmentMetrics(metrics, { reviewStatus:"candidate", riskLevel:"medium" });

  assert.equal(run.property_id, "prop-1");
  assert.equal(run.calculation_type, "investment_metrics");
  assert.equal(run.calculation_method, "deterministic_code");
  assert.equal(run.outputs.grossYieldPercent, 3);
  assert.deepEqual(run.source_ids, ["src-lease", "src-expense"]);
  assert.deepEqual(run.evidence_ref_ids, ["ev-lease", "ev-expense"]);
  assert.equal(run.dossier_snapshot.records, 2);
});

test("calculation run update payload versions deterministic outputs", () => {
  const update = buildCalculationRunUpdatePayload({
    id:"calc-1",
    property_id:"prop-1",
    calculation_type:"investment_metrics",
    calculation_method:"deterministic_code",
    inputs:{ acquisitionPrice:60000000 },
    formulas:{ grossYieldPercent:"annualPotentialRent / acquisitionPrice * 100" },
    outputs:{ grossYieldPercent:3 },
    source_ids:["src-1"],
    evidence_ref_ids:["ev-1"],
    review_status:"approved",
    risk_level:"medium",
    version:2,
    metadata:{ owner:"analyst" },
  }, {
    outputs:{ grossYieldPercent:3.1 },
    metadata:{ note:"rerun after rent correction" },
  }, {
    changedBy:"calculation-service",
    reason:"deterministic_rerun",
    now:"2026-06-12T03:00:00.000Z",
  });

  assert.equal(update.record.version, 3);
  assert.equal(update.record.review_status, "candidate");
  assert.equal(update.record.calculation_method, "deterministic_code");
  assert.equal(update.record.outputs.grossYieldPercent, 3.1);
  assert.equal(update.record.metadata.previous_version, 2);
  assert.equal(update.record.metadata.changed_by, "calculation-service");
  assert.equal(update.quality.ok, true);
});

test("calculation run filters property type source review risk query and archived records", () => {
  const filtered = filterCalculationRunRecords([
    { id:"old", property_id:"prop-1", calculation_type:"investment_metrics", review_status:"candidate", risk_level:"medium", source_ids:["src-1"], outputs:{ noiYield:5.2 }, updated_at:"2026-06-12T01:00:00.000Z" },
    { id:"new", property_id:"prop-1", calculation_type:"investment_metrics", review_status:"candidate", risk_level:"medium", source_ids:["src-1"], outputs:{ noiYield:5.4 }, updated_at:"2026-06-12T02:00:00.000Z" },
    { id:"approved", property_id:"prop-1", calculation_type:"investment_metrics", review_status:"approved", risk_level:"medium", source_ids:["src-1"], outputs:{ noiYield:5.5 }, updated_at:"2026-06-12T03:00:00.000Z" },
    { id:"other-source", property_id:"prop-1", calculation_type:"investment_metrics", review_status:"candidate", risk_level:"medium", source_ids:["src-2"], outputs:{ noiYield:5.6 }, updated_at:"2026-06-12T04:00:00.000Z" },
    { id:"other-property", property_id:"prop-2", calculation_type:"investment_metrics", review_status:"candidate", risk_level:"medium", source_ids:["src-1"], outputs:{ noiYield:5.7 }, updated_at:"2026-06-12T05:00:00.000Z" },
    { id:"archived", property_id:"prop-1", calculation_type:"investment_metrics", review_status:"archived", risk_level:"medium", source_ids:["src-1"], outputs:{ noiYield:5.8 }, updated_at:"2026-06-12T06:00:00.000Z" },
  ], {
    propertyId:"prop-1",
    calculationType:"investment_metrics",
    sourceIds:["src-1"],
    reviewStatuses:["candidate"],
    riskLevels:["medium"],
    query:"noiYield",
  });

  assert.deepEqual(filtered.map(record => record.id), ["new", "old"]);
});

test("property dossier investment metrics refuse to guess acquisition price", () => {
  assert.throws(() => buildPropertyDossierInvestmentMetrics({
    propertyId:"prop-1",
    records:[
      { id:"lease-1", entity_type:"lease", source_id:"src-lease", property_id:"prop-1", title:"Lease 1", review_status:"approved", risk_level:"medium", version:1, rent_amount:150000, period:"monthly", evidence_ref_ids:["ev-lease"] },
    ],
  }), /acquisitionPrice/);
});

test("knowledge unit search only returns approved, retained source-backed units", () => {
  const hits = approvedKnowledgeUnitSearchResults({
    query:"hazard",
    sources:[
      { id:"src-approved", review_status:"approved", deletion_requested:false },
      { id:"src-candidate", review_status:"candidate", deletion_requested:false },
      { id:"src-deleted", review_status:"approved", deletion_requested:true },
    ],
    units:[
      { id:"ku-approved", source_id:"src-approved", review_status:"approved", title:"Approved", content:"hazard hazard note", evidence_ref_ids:["ev-1"], metadata:{ legacyDocumentId:"doc-1", legacyChunkIndex:0 } },
      { id:"ku-candidate-source", source_id:"src-candidate", review_status:"approved", title:"Candidate source", content:"hazard note" },
      { id:"ku-deleted-source", source_id:"src-deleted", review_status:"approved", title:"Deleted source", content:"hazard note" },
      { id:"ku-candidate-unit", source_id:"src-approved", review_status:"candidate", title:"Candidate unit", content:"hazard note" },
    ],
  });

  assert.equal(hits.length, 1);
  assert.equal(hits[0].id, "ku-approved");
  assert.equal(hits[0].score, 2);
  assert.equal(hits[0].docId, "doc-1");
  assert.deepEqual(hits[0].evidenceRefIds, ["ev-1"]);
});

test("knowledge unit filters source domain review risk query and recency", () => {
  const filtered = filterKnowledgeUnitRecords([
    { id:"old", source_id:"src-1", domain:"risk", review_status:"candidate", risk_level:"high", title:"Hazard note", content:"Flood hazard finding.", tags:["flood"], updated_at:"2026-06-12T01:00:00.000Z" },
    { id:"new", source_id:"src-1", domain:"risk", review_status:"candidate", risk_level:"high", title:"Updated hazard note", content:"Flood hazard finding.", tags:["flood"], updated_at:"2026-06-12T02:00:00.000Z" },
    { id:"approved", source_id:"src-1", domain:"risk", review_status:"approved", risk_level:"high", title:"Approved hazard", content:"Flood hazard finding.", updated_at:"2026-06-12T03:00:00.000Z" },
    { id:"other-domain", source_id:"src-1", domain:"area", review_status:"candidate", risk_level:"high", title:"Area hazard", content:"Flood hazard finding.", updated_at:"2026-06-12T04:00:00.000Z" },
    { id:"other-source", source_id:"src-2", domain:"risk", review_status:"candidate", risk_level:"high", title:"Other hazard", content:"Flood hazard finding.", updated_at:"2026-06-12T05:00:00.000Z" },
  ], {
    sourceIds:["src-1"],
    domains:["risk"],
    reviewStatuses:["candidate"],
    riskLevels:["high"],
    query:"flood",
  });

  assert.deepEqual(filtered.map(unit => unit.id), ["new", "old"]);
});

test("knowledge unit update payload versions source-backed content", () => {
  const update = buildKnowledgeUnitUpdatePayload({
    id:"ku-1",
    source_id:"src-1",
    domain:"D01",
    title:"Old hazard finding",
    content:"This source-backed hazard finding needs correction.",
    review_status:"approved",
    risk_level:"medium",
    version:4,
    evidence_ref_ids:["ev-1"],
    metadata:{ owner:"analyst" },
  }, {
    title:"Updated hazard finding",
    content:"This source-backed hazard finding was corrected with updated evidence.",
    metadata:{ note:"corrected wording" },
  }, {
    changedBy:"reviewer",
    reason:"wording_correction",
    now:"2026-06-12T04:00:00.000Z",
  });

  assert.equal(update.record.version, 5);
  assert.equal(update.record.review_status, "candidate");
  assert.equal(update.record.source_id, "src-1");
  assert.equal(update.record.metadata.previous_version, 4);
  assert.equal(update.record.metadata.changed_by, "reviewer");
  assert.equal(update.record.metadata.change_reason, "wording_correction");
  assert.equal(update.quality.ok, true);
});

test("evidence ref update payload versions source and target linked evidence", () => {
  const update = buildEvidenceRefUpdatePayload({
    id:"ev-1",
    source_id:"src-1",
    target_type:"knowledge_unit",
    target_id:"ku-1",
    locator:"page 1",
    quote:"Old quote",
    review_status:"approved",
    risk_level:"medium",
    version:2,
    metadata:{ reviewer:"analyst" },
  }, {
    locator:"page 2",
    quote:"Updated quote",
    metadata:{ note:"corrected locator" },
  }, {
    changedBy:"reviewer",
    reason:"evidence_locator_correction",
    now:"2026-06-12T04:30:00.000Z",
  });

  assert.equal(update.record.version, 3);
  assert.equal(update.record.review_status, "candidate");
  assert.equal(update.record.source_id, "src-1");
  assert.equal(update.record.target_type, "knowledge_unit");
  assert.equal(update.record.target_id, "ku-1");
  assert.equal(update.record.metadata.previous_version, 2);
  assert.equal(update.record.metadata.changed_by, "reviewer");
  assert.equal(update.record.metadata.change_reason, "evidence_locator_correction");
  assert.equal(update.quality.ok, true);
});

test("evidence ref filters source target review risk query and recency", () => {
  const filtered = filterEvidenceRefRecords([
    { id:"old", source_id:"src-1", target_type:"knowledge_unit", target_id:"ku-1", locator:"page 1", quote:"Flood quote", review_status:"candidate", risk_level:"high", updated_at:"2026-06-12T01:00:00.000Z" },
    { id:"new", source_id:"src-1", target_type:"knowledge_unit", target_id:"ku-1", locator:"page 2", quote:"Flood quote", review_status:"candidate", risk_level:"high", updated_at:"2026-06-12T02:00:00.000Z" },
    { id:"approved", source_id:"src-1", target_type:"knowledge_unit", target_id:"ku-1", locator:"page 3", quote:"Flood quote", review_status:"approved", risk_level:"high", updated_at:"2026-06-12T03:00:00.000Z" },
    { id:"other-target", source_id:"src-1", target_type:"jre_risk", target_id:"risk-1", locator:"page 4", quote:"Flood quote", review_status:"candidate", risk_level:"high", updated_at:"2026-06-12T04:00:00.000Z" },
    { id:"other-source", source_id:"src-2", target_type:"knowledge_unit", target_id:"ku-1", locator:"page 5", quote:"Flood quote", review_status:"candidate", risk_level:"high", updated_at:"2026-06-12T05:00:00.000Z" },
  ], {
    sourceIds:["src-1"],
    targetTypes:["knowledge_unit"],
    targetIds:["ku-1"],
    reviewStatuses:["candidate"],
    riskLevels:["high"],
    query:"flood",
  });

  assert.deepEqual(filtered.map(ref => ref.id), ["new", "old"]);
});

test("knowledge brain search only returns approved source-backed phase 1 records", () => {
  const hits = approvedKnowledgeBrainSearchResults({
    query:"hazard",
    sources:[
      { id:"src-approved", review_status:"approved", deletion_requested:false },
      { id:"src-candidate", review_status:"candidate", deletion_requested:false },
      { id:"src-deleted", review_status:"approved", deletion_requested:true },
    ],
    policyRules:[
      { id:"rule-1", source_id:"src-approved", review_status:"approved", title:"Hazard policy", rule_type:"risk", rule_text:"hazard findings require expert review", evidence_ref_ids:["ev-rule"] },
      { id:"rule-candidate-source", source_id:"src-candidate", review_status:"approved", title:"Hazard candidate source", rule_text:"hazard", evidence_ref_ids:["ev-x"] },
    ],
    scenarios:[
      { id:"scenario-1", source_id:"src-approved", review_status:"approved", title:"Hazard review", scenario_type:"due_diligence", description:"review hazard evidence", evidence_ref_ids:["ev-scn"] },
      { id:"scenario-candidate", source_id:"src-approved", review_status:"candidate", title:"Hazard draft", description:"hazard", evidence_ref_ids:["ev-draft"] },
    ],
    evalCases:[
      { id:"eval-1", source_id:"src-approved", review_status:"approved", prompt:"Explain hazard evidence", expected_behavior:"cite hazard evidence", evidence_ref_ids:["ev-eval"] },
    ],
    japaneseRealEstateRecords:[
      { id:"risk-1", entity_type:"risk", source_id:"src-approved", review_status:"approved", title:"Hazard finding", risk_type:"hazard", finding:"hazard zone", evidence_ref_ids:["ev-risk"] },
      { id:"risk-deleted", entity_type:"risk", source_id:"src-deleted", review_status:"approved", title:"Deleted hazard", finding:"hazard", evidence_ref_ids:["ev-del"] },
    ],
    calculationRuns:[
      { id:"calc-1", property_id:"prop-1", calculation_type:"investment_metrics", review_status:"approved", source_ids:["src-approved"], evidence_ref_ids:["ev-calc"], inputs:{}, formulas:{}, outputs:{ hazardAdjustedYield:"hazard adjustment" } },
      { id:"calc-source-missing", property_id:"prop-1", calculation_type:"investment_metrics", review_status:"approved", source_ids:[], evidence_ref_ids:["ev-calc"], outputs:{ hazard:"hazard" } },
    ],
  });

  assert.deepEqual(hits.map(hit => hit.id).sort(), ["calc-1", "eval-1", "risk-1", "rule-1", "scenario-1"].sort());
  assert.equal(hits.find(hit => hit.id === "risk-1").type, "jre_risk");
  assert.deepEqual(hits.find(hit => hit.id === "calc-1").sourceIds, ["src-approved"]);
  assert.deepEqual(hits.find(hit => hit.id === "rule-1").evidenceRefIds, ["ev-rule"]);
});

test("training eligible sources require opt-in, approval, low risk, and no deletion request", () => {
  const eligible = trainingEligibleSources([
    { id:"ok", review_status:"approved", training_allowed:true, deletion_requested:false, risk_level:"low" },
    { id:"not-approved", review_status:"candidate", training_allowed:true, deletion_requested:false, risk_level:"low" },
    { id:"not-consented", review_status:"approved", training_allowed:false, deletion_requested:false, risk_level:"low" },
    { id:"deleted", review_status:"approved", training_allowed:true, deletion_requested:true, risk_level:"low" },
    { id:"high-risk", review_status:"approved", training_allowed:true, deletion_requested:false, risk_level:"high" },
    { id:"restricted", review_status:"approved", training_allowed:true, deletion_requested:false, risk_level:"restricted" },
  ]);

  assert.deepEqual(eligible.map(source => source.id), ["ok"]);
});

test("source registry filters review risk training query and deletion state", () => {
  const filtered = filterSourceRegistryRecords([
    { id:"old", title:"Hazard map", provider:"Tokyo", source_type:"public_web", review_status:"approved", risk_level:"low", training_allowed:true, deletion_requested:false, updated_at:"2026-06-12T01:00:00.000Z" },
    { id:"new", title:"New hazard map", provider:"Tokyo", source_type:"public_web", review_status:"approved", risk_level:"low", training_allowed:true, deletion_requested:false, updated_at:"2026-06-12T02:00:00.000Z" },
    { id:"candidate", title:"Hazard draft", provider:"Tokyo", source_type:"public_web", review_status:"candidate", risk_level:"low", training_allowed:true, deletion_requested:false, updated_at:"2026-06-12T03:00:00.000Z" },
    { id:"high", title:"Hazard REINS upload", provider:"User", source_type:"reins_user_upload", review_status:"approved", risk_level:"high", training_allowed:false, deletion_requested:false, updated_at:"2026-06-12T04:00:00.000Z" },
    { id:"deleted", title:"Hazard deleted", provider:"Tokyo", source_type:"public_web", review_status:"approved", risk_level:"low", training_allowed:true, deletion_requested:true, updated_at:"2026-06-12T05:00:00.000Z" },
  ], {
    sourceTypes:["public_web"],
    reviewStatuses:["approved"],
    riskLevels:["low"],
    trainingAllowed:true,
    query:"hazard",
  });

  assert.deepEqual(filtered.map(source => source.id), ["new", "old"]);
});

test("source registry update payload versions records and disables high-risk training", () => {
  const update = buildSourceRegistryUpdatePayload({
    id:"src-1",
    source_type:"attachment",
    title:"User supplied public note",
    review_status:"approved",
    risk_level:"low",
    version:1,
    consent_scope:"explicit_opt_in",
    training_allowed:true,
    deletion_requested:false,
    metadata:{ owner:"free-tier-user" },
  }, {
    source_type:"reins_user_upload",
    title:"User supplied REINS upload",
    risk_level:"high",
    training_allowed:true,
    metadata:{ classification:"reins" },
  }, {
    changedBy:"reviewer",
    reason:"source_reclassified",
    now:"2026-06-12T05:00:00.000Z",
  });

  assert.equal(update.record.version, 2);
  assert.equal(update.record.review_status, "candidate");
  assert.equal(update.record.training_allowed, false);
  assert.equal(update.record.source_type, "reins_user_upload");
  assert.equal(update.record.risk_level, "high");
  assert.equal(update.record.metadata.previous_version, 1);
  assert.equal(update.record.metadata.changed_by, "reviewer");
  assert.equal(update.record.metadata.change_reason, "source_reclassified");
  assert.equal(update.quality.ok, true);
  assert.deepEqual(trainingEligibleSources([update.record]), []);
});

test("source withdrawal patch disables training and preserves deletion audit metadata", () => {
  const withdrawn = buildSourceWithdrawalPatch({
    id:"src-free-tier",
    review_status:"approved",
    training_allowed:true,
    deletion_requested:false,
    risk_level:"low",
    metadata:{ consent_scope:"explicit_opt_in" },
  }, {
    reason:"free_tier_opt_out",
    requestedBy:"owner",
    now:"2026-06-12T00:00:00.000Z",
  });

  assert.equal(withdrawn.review_status, "archived");
  assert.equal(withdrawn.training_allowed, false);
  assert.equal(withdrawn.deletion_requested, true);
  assert.equal(withdrawn.metadata.deletion_reason, "free_tier_opt_out");
  assert.equal(withdrawn.metadata.deletion_requested_by, "owner");
  assert.equal(withdrawn.metadata.training_withdrawn_at, "2026-06-12T00:00:00.000Z");
  assert.deepEqual(trainingEligibleSources([withdrawn]), []);
});

test("versioned knowledge patch increments version and resets review metadata", () => {
  const patch = buildVersionedKnowledgePatch({
    id:"risk-1",
    version:2,
    review_status:"approved",
    metadata:{ owner:"analyst" },
  }, {
    title:"Updated risk",
    metadata:{ note:"source correction" },
  }, {
    changedBy:"reviewer",
    reason:"evidence_update",
    now:"2026-06-12T01:00:00.000Z",
  });

  assert.equal(patch.version, 3);
  assert.equal(patch.review_status, "candidate");
  assert.equal(patch.updated_at, "2026-06-12T01:00:00.000Z");
  assert.equal(patch.metadata.owner, "analyst");
  assert.equal(patch.metadata.note, "source correction");
  assert.equal(patch.metadata.previous_version, 2);
  assert.equal(patch.metadata.changed_by, "reviewer");
  assert.equal(patch.metadata.change_reason, "evidence_update");
  assert.throws(() => buildVersionedKnowledgePatch({ version:2 }, { version:2 }), /increment version/);
});

test("knowledge brain inventory stats expose review, risk, evidence, and training counts", () => {
  const stats = knowledgeBrainInventoryStats({
    sources:[
      { id:"src-1", source_type:"public_manual", title:"Public source", review_status:"approved", training_allowed:true, deletion_requested:false, risk_level:"low", version:1, consent_scope:"explicit_opt_in" },
      { id:"src-2", source_type:"attachment", title:"Candidate source", review_status:"candidate", training_allowed:false, deletion_requested:false, risk_level:"medium", version:1 },
      { id:"src-3", source_type:"contract", title:"Deleted contract", review_status:"archived", training_allowed:false, deletion_requested:true, risk_level:"high", version:1 },
      { id:"src-4", source_type:"contract", title:"Bad source", review_status:"approved", training_allowed:true, deletion_requested:true, risk_level:"high", version:1, consent_scope:"none" },
    ],
    knowledgeUnits:[
      { id:"ku-1", source_id:"src-1", domain:"D01", title:"Approved unit", content:"Approved source-backed content.", review_status:"approved", risk_level:"low", version:1, evidence_ref_ids:[] },
      { id:"ku-2", source_id:"src-2", domain:"D02", title:"High risk candidate", content:"High-risk candidate content.", review_status:"candidate", risk_level:"high", version:1, evidence_ref_ids:[] },
      { id:"ku-3", source_id:"src-1", domain:"D03", title:"Restricted unit", content:"Restricted source-backed content.", review_status:"approved", risk_level:"restricted", version:1, evidence_ref_ids:["ev-1"] },
      { id:"ku-4", source_id:"src-1", domain:"", title:"", content:"short", review_status:"candidate", risk_level:"low", version:1, evidence_ref_ids:[] },
      { id:"ku-5", source_id:"src-1", domain:"D01", title:"Versioned unit", content:"Versioned source-backed content.", review_status:"approved", risk_level:"low", version:2, supersedes_id:"ku-1", evidence_ref_ids:[] },
      { id:"ku-6", source_id:"src-1", domain:"D01", title:"Broken version", content:"Broken version lineage content.", review_status:"approved", risk_level:"low", version:1, supersedes_id:"ku-1", evidence_ref_ids:[] },
    ],
    evidenceRefs:[
      { id:"ev-1", source_id:"src-1", target_type:"knowledge_unit", target_id:"ku-3", locator:"page 2", quote:"short quote", review_status:"approved", risk_level:"low", version:1 },
      { id:"ev-2", source_id:"src-2", target_type:"knowledge_unit", target_id:"ku-2", locator:"", quote:"", hash:"", review_status:"candidate", risk_level:"high", version:1 },
    ],
    policyRules:[{ id:"rule-1", source_id:"src-1", rule_type:"expert_boundary", title:"Expert boundary", rule_text:"High-risk outputs require expert review.", review_status:"in_review", risk_level:"high", evidence_ref_ids:[], requires_expert_confirmation:true, version:1 }],
    scenarios:[
      { id:"scenario-1", source_id:"src-1", scenario_type:"due_diligence", title:"Review", description:"Review uploaded evidence.", review_status:"candidate", risk_level:"medium", evidence_ref_ids:[], version:1 },
      { id:"scenario-2", source_id:"src-1", scenario_type:"reporting", title:"Report", description:"Report approved evidence.", review_status:"approved", risk_level:"medium", evidence_ref_ids:[], version:1 },
    ],
    evalCases:[{ id:"eval-1", source_id:"src-1", prompt:"Cite evidence.", expected_behavior:"Cite approved evidence.", review_status:"candidate", risk_level:"medium", evidence_ref_ids:[], version:1 }],
    calculationRuns:[
      { id:"calc-1", property_id:"prop-1", calculation_type:"investment_metrics", calculation_method:"deterministic_code", inputs:{ acquisitionPrice:60000000 }, formulas:{ grossYieldPercent:"annualPotentialRent / acquisitionPrice * 100" }, outputs:{ grossYieldPercent:3 }, source_ids:["src-1"], evidence_ref_ids:["ev-1"], review_status:"candidate", risk_level:"medium", version:1 },
      { id:"calc-bad", property_id:"prop-1", calculation_type:"investment_metrics", calculation_method:"llm", inputs:{}, formulas:{}, outputs:{}, source_ids:[], evidence_ref_ids:[], review_status:"approved", risk_level:"medium", version:1 },
    ],
    japaneseRealEstateRecords:[
      { id:"prop-1", entity_type:"property", source_id:"src-1", property_id:"prop-1", title:"Approved property", review_status:"approved", risk_level:"medium", version:1, calculation_method:"source_reported", evidence_ref_ids:["ev-1"] },
      { id:"risk-1", entity_type:"risk", source_id:"src-2", property_id:"prop-1", title:"Candidate risk", review_status:"candidate", risk_level:"high", version:1, calculation_method:"source_reported", evidence_ref_ids:[], requires_expert_confirmation:false },
    ],
  });

  assert.equal(stats.sourceRegistry, 2);
  assert.equal(stats.deletedSources, 2);
  assert.equal(stats.trainingEligibleSources, 1);
  assert.equal(stats.sourceReviewStatus.approved, 2);
  assert.equal(stats.sourceReviewStatus.archived, 1);
  assert.equal(stats.sourceRiskLevels.high, 2);
  assert.equal(stats.invalidSources, 1);
  assert.equal(stats.sourceRegistryQualityIssues.deleted_source_training_enabled, 1);
  assert.equal(stats.sourceRegistryQualityIssues.high_risk_training_enabled, 1);
  assert.equal(stats.sourceRegistryQualityIssues.training_without_explicit_consent, 1);
  assert.equal(stats.knowledgeUnits, 6);
  assert.equal(stats.approvedKnowledgeUnits, 4);
  assert.equal(stats.highRiskKnowledgeUnits, 2);
  assert.equal(stats.invalidKnowledgeUnits, 2);
  assert.equal(stats.knowledgeUnitQualityIssues.high_risk_missing_evidence, 1);
  assert.equal(stats.knowledgeUnitQualityIssues.high_risk_not_approved, 1);
  assert.equal(stats.knowledgeUnitQualityIssues.missing_domain, 1);
  assert.equal(stats.knowledgeUnitQualityIssues.missing_title, 1);
  assert.equal(stats.knowledgeUnitQualityIssues.content_too_short, 1);
  assert.equal(stats.versionChainIssues, 1);
  assert.deepEqual(stats.knowledgeUnitVersionChainIssues, [{ id:"ku-6", issue:"non_incrementing_version" }]);
  assert.equal(stats.knowledgeUnitReviewStatus.candidate, 2);
  assert.equal(stats.evidenceRefs, 2);
  assert.equal(stats.approvedEvidenceRefs, 1);
  assert.equal(stats.invalidEvidenceRefs, 1);
  assert.equal(stats.evidenceRefQualityIssues.missing_locator, 1);
  assert.equal(stats.evidenceRefQualityIssues.high_risk_evidence_not_approved, 1);
  assert.equal(stats.evidenceRefQualityIssues.missing_quote_or_hash, 1);
  assert.equal(stats.referenceIntegrityIssues, 0);
  assert.deepEqual(stats.knowledgeBrainReferenceIntegrityIssues, []);
  assert.deepEqual(stats.knowledgeBrainReferenceIntegrityActions, []);
  assert.equal(stats.policyRules, 1);
  assert.equal(stats.policyRuleReviewStatus.in_review, 1);
  assert.equal(stats.policyRuleRiskLevels.high, 1);
  assert.equal(stats.invalidPolicyRules, 1);
  assert.equal(stats.policyRuleQualityIssues.high_risk_missing_evidence, 1);
  assert.equal(stats.policyRuleQualityIssues.high_risk_not_approved, 1);
  assert.equal(stats.scenarios, 2);
  assert.equal(stats.scenarioReviewStatus.candidate, 1);
  assert.equal(stats.invalidScenarios, 0);
  assert.equal(stats.evalCases, 1);
  assert.equal(stats.evalCaseReviewStatus.candidate, 1);
  assert.equal(stats.invalidEvalCases, 0);
  assert.equal(stats.calculationRuns, 2);
  assert.equal(stats.invalidCalculationRuns, 1);
  assert.equal(stats.calculationRunQualityIssues.non_deterministic_calculation, 1);
  assert.equal(stats.calculationRunQualityIssues.missing_inputs, 1);
  assert.equal(stats.japaneseRealEstateRecords, 2);
  assert.equal(stats.japaneseRealEstateRecordsByType.property, 1);
  assert.equal(stats.japaneseRealEstateRecordsByType.risk, 1);
  assert.equal(stats.invalidJapaneseRealEstateRecords, 1);
  assert.equal(stats.japaneseRealEstateRecordQualityIssues.high_risk_missing_evidence, 1);
  assert.equal(stats.japaneseRealEstateRecordQualityIssues.risk_record_missing_expert_confirmation, 1);
  assert.equal(stats.reviewQueue.total, 8);
  assert.equal(stats.reviewQueue.sources, 1);
  assert.equal(stats.reviewQueue.knowledgeUnits, 2);
  assert.equal(stats.reviewQueue.policyRules, 1);
  assert.equal(stats.reviewQueue.scenarios, 1);
  assert.equal(stats.reviewQueue.evalCases, 1);
  assert.equal(stats.reviewQueue.japaneseRealEstateRecords, 1);
  assert.equal(stats.reviewQueue.calculationRuns, 1);
  assert.equal(stats.reviewQueue.highRiskExpertReview, 4);
  assert.deepEqual(stats.reviewQueue.invalidKnowledgeUnitIds, ["ku-2", "ku-4"]);
  assert.deepEqual(stats.reviewQueue.invalidPolicyRuleIds, ["rule-1"]);
  assert.deepEqual(stats.reviewQueue.invalidScenarioIds, []);
  assert.deepEqual(stats.reviewQueue.invalidEvalCaseIds, []);
  assert.deepEqual(stats.reviewQueue.invalidJapaneseRealEstateRecordIds, ["risk-1"]);
  assert.deepEqual(stats.reviewQueue.invalidCalculationRunIds, ["calc-bad"]);
  assert.equal(stats.reviewQueueItems.some(item => item.target_id === "rule-1" && item.reasons.includes("high_risk_missing_evidence")), true);
  assert.equal(stats.reviewQueueItems.some(item => item.target_id === "risk-1" && item.reasons.includes("risk_record_missing_expert_confirmation")), true);
});

test("knowledge brain reference integrity detects broken source and evidence graph", () => {
  const integrity = validateKnowledgeBrainReferenceIntegrity({
    sources:[
      { id:"src-approved", review_status:"approved", deletion_requested:false },
      { id:"src-candidate", review_status:"candidate", deletion_requested:false },
      { id:"src-deleted", review_status:"approved", deletion_requested:true },
    ],
    evidenceRefs:[
      { id:"ev-wrong-target", source_id:"src-approved", target_type:"knowledge_unit", target_id:"other-ku", review_status:"approved" },
      { id:"ev-candidate", source_id:"src-approved", target_type:"jre_risk", target_id:"risk-1", review_status:"candidate" },
      { id:"ev-missing-source", source_id:"src-missing", target_type:"calculation_run", target_id:"calc-1", review_status:"approved" },
    ],
    knowledgeUnits:[
      { id:"ku-unapproved-source", source_id:"src-candidate", review_status:"approved", risk_level:"medium", evidence_ref_ids:[] },
      { id:"ku-missing-evidence", source_id:"src-approved", review_status:"approved", risk_level:"medium", evidence_ref_ids:["ev-missing"] },
      { id:"ku-target-mismatch", source_id:"src-approved", review_status:"approved", risk_level:"medium", evidence_ref_ids:["ev-wrong-target"] },
    ],
    policyRules:[
      { id:"rule-unapproved-source", source_id:"src-candidate", review_status:"approved", risk_level:"medium", evidence_ref_ids:[] },
    ],
    scenarios:[
      { id:"scenario-missing-source", source_id:"src-missing", review_status:"candidate", risk_level:"medium", evidence_ref_ids:[] },
    ],
    evalCases:[
      { id:"eval-missing-evidence", source_id:"src-approved", review_status:"approved", risk_level:"medium", evidence_ref_ids:["ev-missing-eval"] },
    ],
    japaneseRealEstateRecords:[
      { id:"risk-1", entity_type:"risk", source_id:"src-approved", review_status:"approved", risk_level:"high", evidence_ref_ids:["ev-candidate"] },
    ],
    calculationRuns:[
      { id:"calc-1", source_ids:["src-deleted", "src-missing"], review_status:"approved", risk_level:"medium", evidence_ref_ids:["ev-missing-source"] },
    ],
  });

  assert.equal(integrity.ok, false);
  assert.deepEqual(integrity.issues.map(issue => issue.issue).sort(), [
    "approved_record_unapproved_evidence",
    "approved_record_unapproved_source",
    "approved_record_unapproved_source",
    "deleted_source_ref",
    "evidence_missing_source_ref",
    "evidence_target_mismatch",
    "high_risk_unapproved_evidence",
    "missing_evidence_ref",
    "missing_evidence_ref",
    "missing_source_ref",
    "missing_source_ref",
  ].sort());
  assert.equal(integrity.issues.find(issue => issue.issue === "evidence_target_mismatch").target_id, "ku-target-mismatch");
  assert.equal(integrity.issues.find(issue => issue.issue === "deleted_source_ref").target_id, "calc-1");
  assert.equal(integrity.issues.find(issue => issue.target_id === "rule-unapproved-source").issue, "approved_record_unapproved_source");
  assert.equal(integrity.issues.find(issue => issue.target_id === "scenario-missing-source").issue, "missing_source_ref");
  assert.equal(integrity.issues.find(issue => issue.target_id === "eval-missing-evidence").issue, "missing_evidence_ref");
});

test("knowledge brain reference integrity actions map issues to repair guidance", () => {
  const actions = knowledgeBrainReferenceIntegrityActions({
    issues:[
      { target_type:"knowledge_unit", target_id:"ku-1", issue:"missing_source_ref", source_id:"src-missing" },
      { target_type:"knowledge_unit", target_id:"ku-2", issue:"evidence_target_mismatch", evidence_ref_id:"ev-1" },
      { target_type:"jre_risk", target_id:"risk-1", issue:"high_risk_unapproved_evidence", evidence_ref_id:"ev-2" },
      { target_type:"calculation_run", target_id:"calc-1", issue:"unknown_issue" },
    ],
  });

  assert.deepEqual(actions.map(item => item.action), [
    "restore_source_or_archive_record",
    "relink_evidence_to_target",
    "expert_review_evidence_before_approval",
    "manual_review_required",
  ]);
  assert.equal(actions[0].blocks_approval, true);
  assert.equal(actions[3].blocks_approval, false);
});

test("knowledge brain review queue summarizes pending and expert review work", () => {
  const summary = knowledgeBrainReviewQueueSummary({
    sources:[
      { id:"src-candidate", review_status:"candidate", risk_level:"medium" },
      { id:"src-high", review_status:"in_review", risk_level:"high" },
      { id:"src-approved", review_status:"approved", risk_level:"high" },
    ],
    knowledgeUnits:[
      { id:"ku-ok", source_id:"src-approved", domain:"D01", title:"OK", content:"Approved source-backed content.", review_status:"approved", risk_level:"medium", version:1 },
      { id:"ku-bad", source_id:"src-high", domain:"", title:"", content:"short", review_status:"candidate", risk_level:"restricted", version:1 },
    ],
    policyRules:[
      { id:"rule-approved", review_status:"approved", risk_level:"high", requires_expert_confirmation:true },
      { id:"rule-review", review_status:"in_review", risk_level:"medium", requires_expert_confirmation:true },
    ],
    japaneseRealEstateRecords:[
      { id:"risk-review", entity_type:"risk", source_id:"src-high", property_id:"prop-1", title:"Risk", review_status:"candidate", risk_level:"high", version:1, calculation_method:"source_reported", evidence_ref_ids:[], requires_expert_confirmation:true },
    ],
    calculationRuns:[
      { id:"calc-review", property_id:"prop-1", calculation_type:"investment_metrics", calculation_method:"deterministic_code", inputs:{ acquisitionPrice:1 }, formulas:{ grossYieldPercent:"x" }, outputs:{ grossYieldPercent:1 }, source_ids:["src-high"], evidence_ref_ids:["ev-1"], review_status:"candidate", risk_level:"medium", version:1 },
    ],
  });

  assert.equal(summary.total, 6);
  assert.equal(summary.sources, 2);
  assert.equal(summary.knowledgeUnits, 1);
  assert.equal(summary.policyRules, 1);
  assert.equal(summary.japaneseRealEstateRecords, 1);
  assert.equal(summary.calculationRuns, 1);
  assert.equal(summary.highRiskExpertReview, 4);
  assert.equal(summary.invalidKnowledgeUnits, 1);
  assert.deepEqual(summary.invalidKnowledgeUnitIds, ["ku-bad"]);
  assert.equal(summary.invalidJapaneseRealEstateRecords, 1);
  assert.deepEqual(summary.invalidJapaneseRealEstateRecordIds, ["risk-review"]);
  assert.equal(summary.invalidCalculationRuns, 0);
});

test("knowledge brain review queue items expose actionable reasons across stores", () => {
  const items = knowledgeBrainReviewQueueItems({
    sources:[
      { id:"src-review", source_type:"manual", title:"Source", review_status:"candidate", risk_level:"medium", version:1 },
    ],
    evidenceRefs:[
      { id:"ev-risk", source_id:"src-review", target_type:"knowledge_unit", target_id:"ku-risk", locator:"", quote:"", review_status:"candidate", risk_level:"high", version:1 },
    ],
    knowledgeUnits:[
      { id:"ku-risk", source_id:"src-review", domain:"D01", title:"Risk", content:"High risk source-backed finding.", review_status:"candidate", risk_level:"high", version:1, evidence_ref_ids:[] },
    ],
    policyRules:[
      { id:"rule-risk", source_id:"src-review", rule_type:"expert", title:"Expert", rule_text:"Expert review required.", review_status:"in_review", risk_level:"high", version:1, evidence_ref_ids:[], requires_expert_confirmation:true },
    ],
    scenarios:[
      { id:"scenario-review", source_id:"src-review", scenario_type:"due_diligence", title:"Review", description:"Review evidence.", review_status:"candidate", risk_level:"medium", version:1, evidence_ref_ids:[] },
    ],
    evalCases:[
      { id:"eval-review", source_id:"src-review", prompt:"Prompt", expected_behavior:"Expected", review_status:"candidate", risk_level:"medium", version:1, evidence_ref_ids:[] },
    ],
    japaneseRealEstateRecords:[
      { id:"risk-review", entity_type:"risk", source_id:"src-review", property_id:"prop-1", title:"Risk", review_status:"candidate", risk_level:"high", version:1, calculation_method:"source_reported", evidence_ref_ids:[], requires_expert_confirmation:false },
    ],
    calculationRuns:[
      { id:"calc-review", property_id:"prop-1", calculation_type:"investment_metrics", calculation_method:"deterministic_code", inputs:{}, formulas:{}, outputs:{}, source_ids:[], evidence_ref_ids:[], review_status:"candidate", risk_level:"medium", version:1 },
    ],
  });

  assert.equal(items[0].risk_level, "high");
  assert.equal(items.some(item => item.target_type === "evidence_ref" && item.reasons.includes("missing_locator")), true);
  assert.equal(items.some(item => item.target_id === "ku-risk" && item.reasons.includes("high_risk_missing_evidence")), true);
  assert.equal(items.some(item => item.target_id === "rule-risk" && item.reasons.includes("expert_confirmation_required")), true);
  assert.equal(items.some(item => item.target_id === "risk-review" && item.reasons.includes("risk_record_missing_expert_confirmation")), true);
  assert.equal(items.some(item => item.target_id === "calc-review" && item.reasons.includes("missing_source_ids")), true);
});

test("workflow artifact memory title is local to project brain", async () => {
  await assert.doesNotReject(() => rememberWorkflowArtifact({
    task:"让 Codex 创建一个测试 Issue，不要改代码，只验证任务投递",
    results:[{ member:"陈志远", title:"前端工程师", text:"Codex 开发任务已真实投递到执行队列。" }],
    finalText:"Codex 开发任务已真实投递到执行队列。",
    lang:"zh",
    source:"aria-workflow",
  }));
});

test("project brain filters memories by workflow source type", () => {
  const memories = [
    { id:"record", metadata:{ sourceType:"workflow_record" } },
    { id:"artifact", metadata:{ sourceType:"workflow_artifact_version" } },
    { id:"manual", metadata:{} },
  ];

  assert.deepEqual(filterProjectMemoriesBySourceType(memories, "all").map(item => item.id), ["record", "artifact", "manual"]);
  assert.deepEqual(filterProjectMemoriesBySourceType(memories, "manual").map(item => item.id), ["manual"]);
  assert.deepEqual(filterProjectMemoriesBySourceType(memories, "workflow_record").map(item => item.id), ["record"]);
  assert.deepEqual(filterProjectMemoriesBySourceType(memories, "workflow_artifact_version").map(item => item.id), ["artifact"]);
});

test("project brain counts memory source types", () => {
  const counts = projectMemorySourceTypeCounts([
    { metadata:{ sourceType:"workflow_record" } },
    { metadata:{ sourceType:"workflow_artifact_version" } },
    { metadata:{ sourceType:"workflow_artifact_version" } },
    { metadata:{} },
  ]);

  assert.equal(counts.all, 4);
  assert.equal(counts.workflow_record, 1);
  assert.equal(counts.workflow_artifact_version, 2);
  assert.equal(counts.manual, 1);
});

test("project brain summarizes pending approval queues", () => {
  const summary = projectMemoryApprovalQueueSummary([
    { id:"approved", status:"approved", metadata:{ sourceType:"workflow_record", ingestAction:"workflow_record_approved" } },
    { id:"record", status:"candidate", metadata:{ sourceType:"workflow_record", ingestAction:"workflow_record_candidate", workflowRecordId:"wf-1" } },
    { id:"artifact", status:"approved", metadata:{ sourceType:"workflow_artifact_version", ingestAction:"artifact_version_candidate", ingestRequiresReview:true, workflowRecordId:"wf-1" } },
    { id:"manual", status:"candidate", metadata:{} },
  ]);

  assert.equal(summary.total, 3);
  assert.equal(summary.bySource.workflow_record, 1);
  assert.equal(summary.bySource.workflow_artifact_version, 1);
  assert.equal(summary.bySource.manual, 1);
  assert.equal(summary.byAction.workflow_record_candidate, 1);
  assert.equal(summary.byAction.artifact_version_candidate, 1);
  assert.deepEqual(summary.workflowRecordIds, ["wf-1", "wf-1"]);
});

test("project brain detects approval-needed memories beyond candidate status", () => {
  assert.equal(projectMemoryNeedsApproval({ status:"candidate", metadata:{} }), true);
  assert.equal(projectMemoryNeedsApproval({ status:"approved", metadata:{ requiresApproval:true } }), true);
  assert.equal(projectMemoryNeedsApproval({ status:"approved", metadata:{ ingestRequiresReview:true } }), true);
  assert.equal(projectMemoryNeedsApproval({ status:"approved", metadata:{ ingestRequiresReview:false } }), false);
});

test("project brain selects low-value memories within the requested source", () => {
  const now = Date.parse("2026-06-04T00:00:00.000Z");
  const memories = [
    { id:"manual-low", status:"candidate", importance:1, metadata:{} },
    { id:"manual-strong", status:"candidate", importance:4, metadata:{} },
    { id:"workflow-low", status:"candidate", importance:1, metadata:{ sourceType:"workflow_record" } },
    { id:"workflow-expired", status:"candidate", importance:5, expiresAt:"2026-06-03T00:00:00.000Z", metadata:{ sourceType:"workflow_record" } },
  ];

  assert.deepEqual(selectLowValueMemories(memories, { sourceType:"manual", now }).map(item => item.id), ["manual-low"]);
  assert.deepEqual(selectLowValueMemories(memories, { sourceType:"workflow_record", now }).map(item => item.id), ["workflow-low", "workflow-expired"]);
});

test("approved memory metadata clears workflow approval requirements", () => {
  const metadata = approvedMemoryMetadata({
    sourceType:"workflow_record",
    sourceDocId:"doc-1",
    approvalState:"candidate",
    documentState:"candidate",
    requiresApproval:true,
    approvalSummary:"工作流记录 · 记忆 candidate · 文档 candidate · 状态 done",
  }, { approvedAt:"2026-06-04T00:00:00.000Z" });

  assert.equal(metadata.approvalState, "approved");
  assert.equal(metadata.documentState, "approved");
  assert.equal(metadata.requiresApproval, false);
  assert.equal(metadata.approvalAction, "approved");
  assert.equal(metadata.approvedAt, "2026-06-04T00:00:00.000Z");
  assert.equal(metadata.conflict, null);
  assert.match(metadata.approvalSummary, /记忆 approved/);
  assert.match(metadata.approvalSummary, /文档 approved/);
});
