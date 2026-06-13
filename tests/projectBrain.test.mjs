import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { JRE_KNOWLEDGE_DOMAINS } from "../lib/knowledgeBrainSchemas.mjs";
import { KNOWLEDGE_BRAIN_COLD_START_DOMAIN_GROUPS, approvedKnowledgeBrainSearchResults, approvedKnowledgeUnitSearchResults, approvedMemoryMetadata, buildCalculationRunFromInvestmentMetrics, buildCalculationRunUpdatePayload, buildEvidenceRefUpdatePayload, buildJapaneseRealEstateRecordPayload, buildJapaneseRealEstateSourceIngestRecords, buildKnowledgeDocumentIngestRecords, buildKnowledgeGovernanceRecordPayload, buildKnowledgeGovernanceUpdatePayload, buildKnowledgeUnitUpdatePayload, buildPropertyDossier, buildPropertyDossierInvestmentMetrics, buildSourceRegistryIngestPayload, buildSourceRegistryUpdatePayload, buildSourceWithdrawalPatch, buildVersionedKnowledgePatch, chunkText, evalCaseCategory, evalCaseCategoryCounts, evalCaseMixReadiness, evalCaseMixReadinessActions, filterCalculationRunRecords, filterEvidenceRefRecords, filterJapaneseRealEstateRecords, filterKnowledgeBrainColdStartIngestionQueue, filterKnowledgeBrainReferenceIntegrityActions, filterKnowledgeBrainReviewQueueItems, filterKnowledgeDocumentRecords, filterKnowledgeGovernanceRecords, filterKnowledgeUnitRecords, filterProjectMemoriesBySourceType, filterSourceRegistryRecords, filterSourceUsagePermissionReport, knowledgeBrainColdStartDomainPlan, knowledgeBrainColdStartIngestionQueue, knowledgeBrainColdStartReadiness, knowledgeBrainColdStartReadinessActions, knowledgeBrainColdStartSourceAcquisitionPlan, knowledgeBrainDomainCoverage, knowledgeBrainHighRiskToolReadiness, knowledgeBrainImportAuditSummary, knowledgeBrainInventoryStats, knowledgeBrainReferenceIntegrityActions, knowledgeBrainReviewQueueItems, knowledgeBrainReviewQueueSummary, knowledgeBrainReviewerRoleActions, knowledgeBrainReviewerRoleSummary, normalizeImportedKnowledgeBrainRecord, normalizeImportedSourceRegistryRecord, projectMemoryApprovalQueueSummary, projectMemoryNeedsApproval, projectMemorySourceTypeCounts, putSourceRegistryRecord, rememberWorkflowArtifact, selectLowValueMemories, sourceContributionConsentActions, sourceContributionConsentReport, sourceColdStartTier, sourceColdStartTierCounts, sourceTrainingEligibilityBlockedReasonCounts, sourceTrainingEligibilityReasons, sourceTrainingEligibilityReport, sourceUsagePermissionBlockedReasonCounts, sourceUsagePermissionReport, sourceUsagePermissions, trainingEligibleSources, validateKnowledgeBrainReferenceIntegrity } from "../lib/projectBrain.mjs";

test("project brain chunks long text with overlap", () => {
  const chunks = chunkText("a".repeat(30), 10, 2);
  assert.equal(chunks.length, 4);
  assert.equal(chunks[0].length, 10);
});

test("project brain ignores empty chunk content", () => {
  assert.deepEqual(chunkText("   "), []);
});

test("knowledge database upgrades create missing indexes on existing stores", () => {
  const source = readFileSync(new URL("../lib/projectBrain.mjs", import.meta.url), "utf8");

  assert.match(source, /const KB_DB_VERSION = 5;/);
  assert.match(source, /function ensureKnowledgeBrainIndexes/);
  assert.match(source, /store\.indexNames\.contains\(indexName\)/);
  assert.match(source, /createKnowledgeBrainStores\(db, transaction\)/);
});

test("knowledge import disables unsafe source training flags", () => {
  assert.equal(normalizeImportedSourceRegistryRecord({
    source_type:"public_manual",
    consent_scope:"explicit_opt_in",
    risk_level:"low",
    deletion_requested:false,
    training_allowed:true,
  }).training_allowed, true);

  for (const source of [
    { source_type:"public_manual", consent_scope:"none", risk_level:"low", deletion_requested:false, training_allowed:true },
    { source_type:"public_manual", consent_scope:"explicit_opt_in", risk_level:"low", deletion_requested:true, training_allowed:true },
    { source_type:"public_manual", consent_scope:"explicit_opt_in", risk_level:"high", deletion_requested:false, training_allowed:true },
    { source_type:"reins_user_upload", consent_scope:"explicit_opt_in", risk_level:"low", deletion_requested:false, training_allowed:true },
    { source_type:"contract", consent_scope:"explicit_opt_in", risk_level:"low", deletion_requested:false, training_allowed:true },
  ]) {
    assert.equal(normalizeImportedSourceRegistryRecord(source).training_allowed, false);
  }

  const reins = normalizeImportedSourceRegistryRecord({
    source_type:"reins_user_upload",
    consent_scope:"explicit_opt_in",
    risk_level:"high",
    collection_method:"automated_scrape",
    training_allowed:true,
  });
  assert.equal(reins.collection_method, "manual");
  assert.equal(reins.training_allowed, false);
  assert.deepEqual(reins.metadata.import_warnings, [
    "reins_collection_method_sanitized",
    "training_disabled_high_risk",
    "training_disabled_high_risk_source_type",
  ]);

  const contract = normalizeImportedSourceRegistryRecord({
    source_type:"contract",
    consent_scope:"none",
    risk_level:"restricted",
    deletion_requested:true,
    training_allowed:true,
    metadata:{ owner:"ops", import_warnings:["training_disabled_high_risk"] },
  });
  assert.equal(contract.training_allowed, false);
  assert.equal(contract.metadata.owner, "ops");
  assert.deepEqual(contract.metadata.import_warnings, [
    "training_disabled_high_risk",
    "training_disabled_missing_explicit_consent",
    "training_disabled_deleted_source",
    "training_disabled_high_risk_source_type",
  ]);
});

test("knowledge import downgrades approved high risk records without reviewer metadata", () => {
  const source = normalizeImportedKnowledgeBrainRecord("source_registry", {
    id:"src-risk",
    source_type:"contract",
    title:"Contract",
    review_status:"approved",
    risk_level:"high",
    consent_scope:"explicit_opt_in",
    training_allowed:true,
    metadata:{ owner:"ops" },
  });

  assert.equal(source.review_status, "in_review");
  assert.equal(source.training_allowed, false);
  assert.equal(source.metadata.owner, "ops");
  assert.equal(source.metadata.import_original_review_status, "approved");
  assert.deepEqual(source.metadata.import_warnings, [
    "training_disabled_high_risk",
    "training_disabled_high_risk_source_type",
    "approved_high_risk_missing_reviewer_metadata",
    "missing_reviewed_by",
    "missing_reviewed_at",
  ]);

  const unit = normalizeImportedKnowledgeBrainRecord("knowledge_units", {
    id:"ku-risk",
    source_id:"src-risk",
    review_status:"approved",
    risk_level:"restricted",
    metadata:{ reviewed_by:"expert" },
  });

  assert.equal(unit.review_status, "in_review");
  assert.deepEqual(unit.metadata.import_warnings, [
    "approved_high_risk_missing_reviewer_metadata",
    "missing_reviewed_at",
  ]);

  const reviewed = normalizeImportedKnowledgeBrainRecord("knowledge_units", {
    id:"ku-reviewed",
    source_id:"src-risk",
    review_status:"approved",
    risk_level:"high",
    metadata:{ reviewed_by:"expert", reviewed_at:"2026-06-12T00:00:00.000Z" },
  });

  assert.equal(reviewed.review_status, "approved");
});

test("knowledge import audit summary previews safety rewrites", () => {
  const summary = knowledgeBrainImportAuditSummary({
    source_registry:[
      {
        id:"src-reins",
        source_type:"reins_user_upload",
        title:"REINS manual upload",
        review_status:"approved",
        risk_level:"high",
        collection_method:"automated_scrape",
        consent_scope:"explicit_opt_in",
        training_allowed:true,
      },
    ],
    knowledge_units:[
      {
        id:"ku-risk",
        source_id:"src-reins",
        domain:"D07",
        title:"Risk",
        content:"High-risk imported content.",
        review_status:"approved",
        risk_level:"high",
        version:1,
        metadata:{},
      },
    ],
  });

  assert.equal(summary.total, 2);
  assert.equal(summary.trainingDisabled, 1);
  assert.equal(summary.reviewDowngraded, 2);
  assert.equal(summary.reinsCollectionSanitized, 1);
  assert.equal(summary.importWarnings.training_disabled_high_risk_source_type, 1);
  assert.equal(summary.importWarnings.approved_high_risk_missing_reviewer_metadata, 2);
  assert.equal(summary.stores.source_registry.reinsCollectionSanitized, 1);
  assert.equal(summary.stores.knowledge_units.reviewDowngraded, 1);
});

test("source registry ingest payload enforces training and REINS boundaries", () => {
  const publicSource = buildSourceRegistryIngestPayload({
    title:"Tokyo public hazard map",
    source:"public_manual",
    sourceType:"public_manual",
    provider:"Tokyo",
    reviewStatus:"approved",
    riskLevel:"low",
    consentScope:"explicit_opt_in",
    trainingAllowed:true,
    metadata:{ owner:"free-tier-user" },
  });

  assert.equal(publicSource.quality.ok, true);
  assert.equal(publicSource.record.training_allowed, true);
  assert.equal(publicSource.trainingEligible, true);
  assert.equal(publicSource.record.metadata.owner, "free-tier-user");
  assert.equal(publicSource.record.metadata.legacySource, "public_manual");

  const reinsSource = buildSourceRegistryIngestPayload({
    title:"User uploaded REINS listing",
    source:"reins_user_upload",
    collectionMethod:"automated_scrape",
    reviewStatus:"approved",
    consentScope:"explicit_opt_in",
    trainingAllowed:true,
  });

  assert.equal(reinsSource.quality.ok, true);
  assert.equal(reinsSource.record.source_type, "reins_user_upload");
  assert.equal(reinsSource.record.collection_method, "manual");
  assert.equal(reinsSource.record.risk_level, "high");
  assert.equal(reinsSource.record.training_allowed, false);
  assert.equal(reinsSource.trainingEligible, false);
  assert.deepEqual(reinsSource.record.metadata.import_warnings, [
    "reins_collection_method_sanitized",
    "training_disabled_high_risk",
    "training_disabled_high_risk_source_type",
  ]);
});

test("source registry standalone persistence API is exported", () => {
  assert.equal(typeof putSourceRegistryRecord, "function");
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

test("knowledge document ingest disables training for high-risk source records", () => {
  const records = buildKnowledgeDocumentIngestRecords({
    title:"Official risk note",
    source:"public_manual",
    text:"High-risk official guidance excerpt.",
    riskLevel:"high",
    trainingAllowed:true,
    consentScope:"explicit_opt_in",
  });

  assert.equal(records.source.source_type, "public_manual");
  assert.equal(records.source.risk_level, "high");
  assert.equal(records.source.training_allowed, false);
  assert.deepEqual(records.source.metadata.import_warnings, ["training_disabled_high_risk"]);
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

test("japanese real estate source ingest disables training for high-risk source types", () => {
  const ingest = buildJapaneseRealEstateSourceIngestRecords({
    title:"Uploaded contract facts",
    source:"contract",
    records:[
      {
        id:"lease-1",
        entity_type:"lease",
        property_id:"prop-1",
        title:"Lease facts",
        rent_amount:120000,
        period:"monthly",
        evidence:{ locator:"clause 4", quote:"Monthly rent is 120000." },
      },
    ],
    metadata:{ trainingAllowed:true, consentScope:"explicit_opt_in" },
  });

  assert.equal(ingest.source.source_type, "contract");
  assert.equal(ingest.source.risk_level, "high");
  assert.equal(ingest.source.training_allowed, false);
  assert.deepEqual(ingest.source.metadata.import_warnings, [
    "training_disabled_high_risk",
    "training_disabled_high_risk_source_type",
  ]);
  assert.equal(ingest.records[0].record.source_id, ingest.source.id);
  assert.equal(ingest.evidenceRefs[0].source_id, ingest.source.id);
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
  assert.equal(policy.quality.ok, false);
  assert.deepEqual(policy.quality.issues, ["high_risk_not_approved"]);
  assert.equal(scenario.storeName, "scenarios");
  assert.equal(scenario.record.source_id, "src-1");
  assert.deepEqual(scenario.record.evidence_ref_ids, ["ev-scenario"]);
  assert.equal(evalCase.storeName, "eval_cases");
  assert.equal(evalCase.record.scenario_id, scenario.record.id);
  assert.deepEqual(evalCase.record.evidence_ref_ids, ["ev-eval"]);
  assert.equal(evalCase.quality.ok, false);
  assert.deepEqual(evalCase.quality.issues, ["high_risk_not_approved"]);
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

test("approved knowledge search excludes high risk records without reviewer metadata", () => {
  const reviewedMetadata = { reviewed_by:"expert", reviewed_at:"2026-06-12T00:00:00.000Z" };
  const hits = approvedKnowledgeBrainSearchResults({
    query:"hazard",
    sources:[
      { id:"src-reviewed", review_status:"approved", risk_level:"high", deletion_requested:false, metadata:reviewedMetadata },
      { id:"src-unreviewed", review_status:"approved", risk_level:"high", deletion_requested:false, metadata:{} },
    ],
    policyRules:[
      { id:"rule-reviewed", source_id:"src-reviewed", review_status:"approved", risk_level:"high", metadata:reviewedMetadata, title:"Hazard policy", rule_type:"risk", rule_text:"hazard reviewed", evidence_ref_ids:["ev-1"] },
      { id:"rule-missing-reviewer", source_id:"src-reviewed", review_status:"approved", risk_level:"high", metadata:{}, title:"Hazard policy", rule_type:"risk", rule_text:"hazard unreviewed", evidence_ref_ids:["ev-2"] },
      { id:"rule-unreviewed-source", source_id:"src-unreviewed", review_status:"approved", risk_level:"low", title:"Hazard policy", rule_type:"risk", rule_text:"hazard source unreviewed", evidence_ref_ids:["ev-3"] },
    ],
  });

  assert.deepEqual(hits.map(hit => hit.id), ["rule-reviewed"]);
});

test("training eligible sources require opt-in, approval, low risk, and no deletion request", () => {
  const eligible = trainingEligibleSources([
    { id:"ok", review_status:"approved", training_allowed:true, consent_scope:"explicit_opt_in", deletion_requested:false, risk_level:"low" },
    { id:"not-approved", review_status:"candidate", training_allowed:true, consent_scope:"explicit_opt_in", deletion_requested:false, risk_level:"low" },
    { id:"not-consented", review_status:"approved", training_allowed:true, consent_scope:"none", deletion_requested:false, risk_level:"low" },
    { id:"not-training-enabled", review_status:"approved", training_allowed:false, consent_scope:"explicit_opt_in", deletion_requested:false, risk_level:"low" },
    { id:"deleted", review_status:"approved", training_allowed:true, consent_scope:"explicit_opt_in", deletion_requested:true, risk_level:"low" },
    { id:"high-risk", review_status:"approved", training_allowed:true, consent_scope:"explicit_opt_in", deletion_requested:false, risk_level:"high" },
    { id:"restricted", review_status:"approved", training_allowed:true, consent_scope:"explicit_opt_in", deletion_requested:false, risk_level:"restricted" },
    { id:"reins-low-risk-bad-data", source_type:"reins_user_upload", review_status:"approved", training_allowed:true, consent_scope:"explicit_opt_in", deletion_requested:false, risk_level:"low" },
    { id:"contract-low-risk-bad-data", source_type:"contract", review_status:"approved", training_allowed:true, consent_scope:"explicit_opt_in", deletion_requested:false, risk_level:"low" },
  ]);

  assert.deepEqual(eligible.map(source => source.id), ["ok"]);
});

test("source training eligibility report explains blocked training reasons", () => {
  const sources = [
    { id:"ok", source_type:"public_manual", review_status:"approved", training_allowed:true, consent_scope:"explicit_opt_in", deletion_requested:false, risk_level:"low" },
    { id:"blocked", source_type:"contract", review_status:"candidate", training_allowed:false, consent_scope:"none", deletion_requested:true, risk_level:"restricted" },
  ];
  const report = sourceTrainingEligibilityReport(sources);

  assert.deepEqual(sourceTrainingEligibilityReasons(sources[0]), []);
  assert.equal(report[0].eligible, true);
  assert.equal(report[1].eligible, false);
  assert.deepEqual(report[1].reasons, [
    "source_not_approved",
    "training_not_enabled",
    "missing_explicit_consent",
    "deletion_requested",
    "high_risk_source",
    "high_risk_source_type",
  ]);
  assert.deepEqual(sourceTrainingEligibilityBlockedReasonCounts(sources), {
    source_not_approved:1,
    training_not_enabled:1,
    missing_explicit_consent:1,
    deletion_requested:1,
    high_risk_source:1,
    high_risk_source_type:1,
  });
});

test("source contribution consent report tracks free tier opt-in and withdrawal audit", () => {
  const report = sourceContributionConsentReport([
    { id:"free-ok", contributor_tier:"free_tier", consent_scope:"explicit_opt_in", training_allowed:true, deletion_requested:false },
    { id:"free-missing", metadata:{ contributor_tier:"free_tier" }, consent_scope:"none", training_allowed:false, deletion_requested:false },
    { id:"partner", contributor_tier:"partner", consent_scope:"opt_in", training_allowed:true, deletion_requested:false },
    { id:"deleted", contributor_tier:"free_tier", consent_scope:"none", training_allowed:false, deletion_requested:true, metadata:{ deletion_requested_at:"2026-06-12T00:00:00.000Z", training_withdrawn_at:"2026-06-12T00:00:00.000Z" } },
  ]);

  assert.equal(report.total, 4);
  assert.equal(report.freeTierSources, 3);
  assert.equal(report.freeTierMissingOptIn, 2);
  assert.equal(report.trainingAllowedSources, 2);
  assert.equal(report.trainingAllowedWithoutExplicitConsent, 1);
  assert.equal(report.deletionRequestedSources, 1);
  assert.equal(report.withdrawalAuditRecords, 1);
  assert.equal(report.deletionRequestsMissingAudit, 0);
  assert.equal(report.byContributorTier.free_tier, 3);
  assert.equal(report.byConsentScope.none, 2);
});

test("source contribution consent actions map consent gaps to repair work", () => {
  const actions = sourceContributionConsentActions({
    freeTierMissingOptIn:2,
    trainingAllowedWithoutExplicitConsent:1,
    deletionRequestsMissingAudit:1,
  });

  assert.deepEqual(actions.map(item => item.action), [
    "collect_free_tier_explicit_opt_in_or_disable_use",
    "disable_training_or_collect_explicit_consent",
    "record_deletion_and_training_withdrawal_audit",
  ]);
  assert.equal(actions.every(item => item.blocksReadiness), true);
});

test("source usage permissions separate reference derivative and training boundaries", () => {
  const publicSource = sourceUsagePermissions({
    id:"public",
    source_type:"public_manual",
    review_status:"approved",
    risk_level:"low",
    training_allowed:true,
    consent_scope:"explicit_opt_in",
    deletion_requested:false,
  });
  assert.equal(publicSource.reference.allowed, true);
  assert.equal(publicSource.derivative.allowed, true);
  assert.equal(publicSource.training.allowed, true);

  const contractSource = sourceUsagePermissions({
    id:"contract",
    source_type:"contract",
    review_status:"approved",
    risk_level:"high",
    training_allowed:true,
    consent_scope:"explicit_opt_in",
    deletion_requested:false,
    metadata:{ reviewed_by:"takken-reviewer", reviewed_at:"2026-06-12T00:00:00.000Z" },
  });
  assert.equal(contractSource.reference.allowed, true);
  assert.equal(contractSource.derivative.allowed, false);
  assert.deepEqual(contractSource.derivative.reasons, ["high_risk_derivative_requires_explicit_approval"]);
  assert.equal(contractSource.training.allowed, false);
  assert.deepEqual(contractSource.training.reasons, [
    "high_risk_source",
    "high_risk_source_type",
  ]);

  const explicitlyApprovedDerivative = sourceUsagePermissions({
    id:"reins-case",
    source_type:"reins_user_upload",
    review_status:"approved",
    risk_level:"high",
    training_allowed:false,
    consent_scope:"none",
    deletion_requested:false,
    metadata:{
      derivative_allowed:true,
      reviewed_by:"takken-reviewer",
      reviewed_at:"2026-06-12T00:00:00.000Z",
    },
  });
  assert.equal(explicitlyApprovedDerivative.reference.allowed, true);
  assert.equal(explicitlyApprovedDerivative.derivative.allowed, true);
  assert.equal(explicitlyApprovedDerivative.training.allowed, false);

  const deleted = sourceUsagePermissions({
    id:"deleted",
    source_type:"public_manual",
    review_status:"approved",
    risk_level:"low",
    training_allowed:true,
    consent_scope:"explicit_opt_in",
    deletion_requested:true,
  });
  assert.equal(deleted.reference.allowed, false);
  assert.equal(deleted.derivative.allowed, false);
  assert.deepEqual(deleted.reference.reasons, ["deletion_requested"]);
});

test("source usage permission blocker counts expose scope-specific reasons", () => {
  const counts = sourceUsagePermissionBlockedReasonCounts([
    { id:"candidate", source_type:"public_manual", review_status:"candidate", risk_level:"low", training_allowed:false, consent_scope:"none", deletion_requested:false },
    { id:"contract", source_type:"contract", review_status:"approved", risk_level:"high", training_allowed:false, consent_scope:"none", deletion_requested:false, metadata:{} },
  ]);

  assert.equal(counts["reference:source_not_approved"], 1);
  assert.equal(counts["derivative:source_not_approved"], 1);
  assert.equal(counts["derivative:high_risk_derivative_requires_explicit_approval"], 1);
  assert.equal(counts["derivative:missing_reviewed_by"], 1);
  assert.equal(counts["derivative:missing_reviewed_at"], 1);
  assert.equal(counts["training:training_not_enabled"], 2);
  assert.equal(counts["training:missing_explicit_consent"], 2);
  assert.equal(counts["training:high_risk_source_type"], 1);
});

test("source usage permission report lists per-source scope decisions", () => {
  const report = sourceUsagePermissionReport([
    { id:"ok", source_type:"public_manual", review_status:"approved", risk_level:"low", training_allowed:true, consent_scope:"explicit_opt_in", deletion_requested:false },
    { id:"deleted", source_type:"public_manual", review_status:"approved", risk_level:"low", training_allowed:true, consent_scope:"explicit_opt_in", deletion_requested:true },
  ]);

  assert.deepEqual(report.map(item => item.source_id), ["ok", "deleted"]);
  assert.equal(report[0].reference.allowed, true);
  assert.equal(report[0].training.allowed, true);
  assert.equal(report[1].reference.allowed, false);
  assert.deepEqual(report[1].reference.reasons, ["deletion_requested"]);
});

test("source usage permission report filters blocked scopes and reasons", () => {
  const report = sourceUsagePermissionReport([
    { id:"ok", source_type:"public_manual", review_status:"approved", risk_level:"low", training_allowed:true, consent_scope:"explicit_opt_in", deletion_requested:false },
    { id:"contract", source_type:"contract", review_status:"approved", risk_level:"high", training_allowed:false, consent_scope:"none", deletion_requested:false, metadata:{} },
    { id:"candidate", source_type:"public_manual", review_status:"candidate", risk_level:"low", training_allowed:false, consent_scope:"none", deletion_requested:false },
  ]);

  assert.deepEqual(filterSourceUsagePermissionReport(report, {
    scopes:["training"],
    allowed:false,
    reasons:["high_risk_source_type"],
  }).map(item => item.source_id), ["contract"]);

  assert.deepEqual(filterSourceUsagePermissionReport(report, {
    scopes:["derivative"],
    allowed:false,
    query:"reviewed_by",
  }).map(item => item.source_id), ["contract"]);

  assert.deepEqual(filterSourceUsagePermissionReport(report, {
    reviewStatuses:["candidate"],
    scopes:["reference"],
    allowed:false,
  }).map(item => item.source_id), ["candidate"]);
});

test("reviewer role summary exposes takken reviewer gaps for partner case domains", () => {
  const summary = knowledgeBrainReviewerRoleSummary({
    knowledgeUnits:[
      { id:"ku-d04-reviewed", domain:"D04", review_status:"approved", risk_level:"medium", metadata:{ reviewer_role:"takken_shi" } },
      { id:"ku-d05-missing-role", domain:"D05", review_status:"approved", risk_level:"medium", metadata:{ reviewed_by:"expert", reviewed_at:"2026-06-12T00:00:00.000Z" } },
      { id:"ku-d07-high", domain:"D07", review_status:"approved", risk_level:"high", metadata:{ reviewer_role:"legal_expert" } },
      { id:"ku-d06-candidate", domain:"D06", review_status:"candidate", risk_level:"medium", metadata:{} },
    ],
    policyRules:[
      { id:"rule-high-missing", review_status:"approved", risk_level:"restricted", metadata:{ reviewed_by:"expert" } },
    ],
  });

  assert.equal(summary.approvedRecords, 4);
  assert.equal(summary.highRiskApprovedRecords, 2);
  assert.equal(summary.missingReviewerRole, 2);
  assert.equal(summary.highRiskMissingReviewerRole, 1);
  assert.equal(summary.takkenReviewedRecords, 1);
  assert.equal(summary.partnerCaseApprovedKnowledgeUnits, 2);
  assert.equal(summary.partnerCaseKnowledgeUnitsMissingTakkenRole, 1);
  assert.equal(summary.byRole.takken_shi, 1);
  assert.equal(summary.byRole.unspecified, 2);
});

test("reviewer role actions expose reviewer capacity repair tasks", () => {
  const actions = knowledgeBrainReviewerRoleActions({
    missingReviewerRole:3,
    highRiskMissingReviewerRole:2,
    partnerCaseKnowledgeUnitsMissingTakkenRole:1,
  });

  assert.deepEqual(actions.map(item => item.action), [
    "record_reviewer_roles",
    "record_high_risk_reviewer_roles",
    "assign_takken_reviewer_for_partner_cases",
  ]);
  assert.equal(actions[0].blocksReadiness, false);
  assert.equal(actions[1].blocksReadiness, true);
  assert.equal(actions[2].id, "reviewer-role-action:partner_case_takken_review");
});

test("source cold start tier classifies explicit and known source categories", () => {
  const sources = [
    { id:"mlit", source_type:"public_web", provider:"MLIT" },
    { id:"assoc", source_type:"industry_association" },
    { id:"partner", source_type:"attachment", metadata:{ cold_start_tier:"partner_practitioner_case" } },
    { id:"ai", source_type:"ai_assisted_draft" },
    { id:"unknown", source_type:"attachment" },
  ];

  assert.equal(sourceColdStartTier(sources[0]), "tier_1_official_public");
  assert.equal(sourceColdStartTier(sources[2]), "tier_3_partner_practitioner_case");
  assert.deepEqual(sourceColdStartTierCounts(sources), {
    tier_1_official_public:1,
    tier_2_industry_association:1,
    tier_3_partner_practitioner_case:1,
    tier_4_ai_assisted_draft:1,
    unclassified:1,
  });
});

test("knowledge brain domain coverage tracks D01-D16 unit and eval gaps", () => {
  const coverage = knowledgeBrainDomainCoverage({
    knowledgeUnits:[
      { id:"ku-d01", domain:"D01", review_status:"approved" },
      { id:"ku-d02", domain:"D02", review_status:"candidate" },
      { id:"ku-other", domain:"DX", review_status:"approved" },
    ],
    evalCases:[
      { id:"eval-d01", domain:"D01", review_status:"approved" },
      { id:"eval-d03", metadata:{ domain:"D03" }, review_status:"candidate" },
      { id:"eval-other", domain:"DX", review_status:"approved" },
    ],
  });

  assert.equal(coverage.domains.D01.approvedKnowledgeUnits, 1);
  assert.equal(coverage.domains.D02.knowledgeUnits, 1);
  assert.equal(coverage.domains.D02.approvedKnowledgeUnits, 0);
  assert.equal(coverage.domains.D03.evalCases, 1);
  assert.equal(coverage.other.knowledgeUnits, 1);
  assert.equal(coverage.other.evalCases, 1);
  assert.equal(coverage.missingApprovedKnowledgeUnitDomains.includes("D02"), true);
  assert.equal(coverage.missingEvalCaseDomains.includes("D02"), true);
  assert.equal(coverage.missingEvalCaseDomains.includes("D01"), false);
});

test("cold start domain plan maps D01-D16 into source acquisition phases", () => {
  assert.deepEqual(KNOWLEDGE_BRAIN_COLD_START_DOMAIN_GROUPS.phase_2_1_official_public.domains, ["D07", "D08", "D16"]);
  assert.deepEqual(KNOWLEDGE_BRAIN_COLD_START_DOMAIN_GROUPS.phase_2_2_industry_templates.domains, ["D01", "D02", "D03", "D09", "D10"]);
  assert.deepEqual(KNOWLEDGE_BRAIN_COLD_START_DOMAIN_GROUPS.phase_2_3_partner_cases.domains, ["D04", "D05", "D06"]);
  assert.deepEqual(KNOWLEDGE_BRAIN_COLD_START_DOMAIN_GROUPS.phase_2_4_ai_assisted_long_tail.domains, ["D11", "D12", "D13", "D14", "D15"]);
  assert.deepEqual(KNOWLEDGE_BRAIN_COLD_START_DOMAIN_GROUPS.phase_2_1_official_public.recommendedProviders, ["MLIT", "RETIO", "Consumer Affairs Agency"]);
  assert.deepEqual(KNOWLEDGE_BRAIN_COLD_START_DOMAIN_GROUPS.phase_2_3_partner_cases.recommendedSourceTypes, ["partner_practitioner_case", "desensitized_case"]);

  const coveredDomains = Object.values(KNOWLEDGE_BRAIN_COLD_START_DOMAIN_GROUPS).flatMap(group => group.domains).sort();
  assert.deepEqual(coveredDomains, [...JRE_KNOWLEDGE_DOMAINS].sort());
});

test("cold start domain plan reports phase targets and missing domains", () => {
  const officialUnits = Array.from({ length:300 }, (_, index) => ({
    id:`ku-official-${index}`,
    domain:index % 2 === 0 ? "D07" : "D08",
    review_status:"approved",
  }));
  const plan = knowledgeBrainColdStartDomainPlan({
    knowledgeUnits:[
      ...officialUnits,
      { id:"ku-d01", domain:"D01", review_status:"approved" },
      { id:"ku-d04", domain:"D04", review_status:"candidate" },
    ],
    evalCases:[
      { id:"eval-d07", domain:"D07", review_status:"approved" },
      { id:"eval-d01", domain:"D01", review_status:"candidate" },
    ],
  });

  assert.equal(plan.groups.phase_2_1_official_public.approvedKnowledgeUnits, 300);
  assert.equal(plan.groups.phase_2_1_official_public.targetMet, true);
  assert.deepEqual(plan.groups.phase_2_1_official_public.missingApprovedKnowledgeUnitDomains, ["D16"]);
  assert.deepEqual(plan.groups.phase_2_2_industry_templates.missingEvalCaseDomains, ["D02", "D03", "D09", "D10"]);
  assert.equal(plan.groups.phase_2_3_partner_cases.targetMet, false);
  assert.equal(plan.allTargetsMet, false);
});

test("cold start source acquisition plan exposes source strategy and review boundary", () => {
  const plan = knowledgeBrainColdStartSourceAcquisitionPlan({
    knowledgeUnits:[
      { id:"ku-d07", domain:"D07", review_status:"approved" },
      { id:"ku-d01", domain:"D01", review_status:"approved" },
    ],
    evalCases:[
      { id:"eval-d07", domain:"D07", review_status:"approved" },
    ],
  });

  assert.deepEqual(plan.map(item => item.phase), [
    "phase_2_1_official_public",
    "phase_2_2_industry_templates",
    "phase_2_3_partner_cases",
    "phase_2_4_ai_assisted_long_tail",
  ]);
  assert.deepEqual(plan[0].recommendedArtifacts, ["official_guidance", "qa", "case_notes", "checklist"]);
  assert.equal(plan[0].dataBoundary, "public_authoritative_reference_only");
  assert.equal(plan[2].reviewerRoleRequired, "takken");
  assert.equal(plan[2].dataBoundary, "desensitized_partner_material_with_explicit_use_agreement");
  assert.equal(plan[3].dataBoundary, "draft_only_until_human_reviewed");
  assert.equal(plan.every(item => item.blocksReadiness), true);
});

test("cold start ingestion queue prioritizes missing domains by source phase", () => {
  const queue = knowledgeBrainColdStartIngestionQueue({
    knowledgeUnits:[
      { id:"ku-d07", domain:"D07", review_status:"approved" },
      { id:"ku-d01", domain:"D01", review_status:"approved" },
    ],
    evalCases:[
      { id:"eval-d07", domain:"D07", review_status:"approved" },
    ],
  });

  assert.deepEqual(queue.map(item => item.phase), [
    "phase_2_1_official_public",
    "phase_2_2_industry_templates",
    "phase_2_3_partner_cases",
    "phase_2_4_ai_assisted_long_tail",
  ]);
  assert.equal(queue[0].sourceTier, "tier_1_official_public");
  assert.equal(queue[0].id, "cold-start-ingest:phase_2_1_official_public");
  assert.equal(queue[0].taskType, "cold_start_ingestion_gap");
  assert.deepEqual(queue[0].recommendedSourceTypes, ["public_manual", "public_web", "official_public"]);
  assert.deepEqual(queue[0].recommendedProviders, ["MLIT", "RETIO", "Consumer Affairs Agency"]);
  assert.equal(queue[0].approvedKnowledgeUnitDeficit, 299);
  assert.deepEqual(queue[0].nextDomains, ["D08", "D16"]);
  assert.equal(queue[1].domainPriorities[0].domain, "D02");
  assert.equal(queue[1].domainPriorities[0].priorityScore, 3);
  assert.equal(queue[1].domainPriorities.find(item => item.domain === "D01").priorityScore, 1);
});

test("cold start ingestion queue omits completed phase targets", () => {
  const officialUnits = Array.from({ length:300 }, (_, index) => ({
    id:`ku-official-${index}`,
    domain:["D07", "D08", "D16"][index % 3],
    review_status:"approved",
  }));
  const queue = knowledgeBrainColdStartIngestionQueue({
    knowledgeUnits:[
      ...officialUnits,
      { id:"ku-d01", domain:"D01", review_status:"approved" },
    ],
    evalCases:[
      { id:"eval-d07", domain:"D07", review_status:"approved" },
      { id:"eval-d08", domain:"D08", review_status:"approved" },
      { id:"eval-d16", domain:"D16", review_status:"approved" },
    ],
  });

  assert.equal(queue.some(item => item.phase === "phase_2_1_official_public"), false);
  assert.equal(queue[0].phase, "phase_2_2_industry_templates");
});

test("cold start ingestion queue filters phase domain and source query", () => {
  const queue = knowledgeBrainColdStartIngestionQueue({
    knowledgeUnits:[
      { id:"ku-d07", domain:"D07", review_status:"approved" },
      { id:"ku-d01", domain:"D01", review_status:"approved" },
    ],
    evalCases:[
      { id:"eval-d07", domain:"D07", review_status:"approved" },
    ],
  });

  assert.deepEqual(filterKnowledgeBrainColdStartIngestionQueue(queue, {
    phases:["phase_2_3_partner_cases"],
  }).map(item => item.phase), ["phase_2_3_partner_cases"]);

  assert.deepEqual(filterKnowledgeBrainColdStartIngestionQueue(queue, {
    domains:["D06"],
  }).map(item => item.phase), ["phase_2_3_partner_cases"]);

  assert.deepEqual(filterKnowledgeBrainColdStartIngestionQueue(queue, {
    query:"retio",
  }).map(item => item.phase), ["phase_2_1_official_public"]);

  assert.deepEqual(filterKnowledgeBrainColdStartIngestionQueue(queue, {
    sourceTiers:["tier_4_ai_assisted_draft"],
    reviewModes:["team_review_with_external_sampling"],
  }).map(item => item.phase), ["phase_2_4_ai_assisted_long_tail"]);
});

test("eval case category counts support cold-start eval set mix tracking", () => {
  const evalCases = [
    { id:"prohibited", forbidden_behavior:"Do not produce legal advice." },
    { id:"scenario", scenario_id:"scenario-1" },
    { id:"retrieval", evidence_ref_ids:["ev-1"] },
    { id:"boundary", metadata:{ eval_category:"boundary" } },
  ];

  assert.equal(evalCaseCategory(evalCases[0]), "prohibited_behavior");
  assert.deepEqual(evalCaseCategoryCounts(evalCases), {
    prohibited_behavior:1,
    scenario:1,
    retrieval:1,
    boundary:1,
  });
});

test("eval case mix readiness requires approved high-risk eval distribution", () => {
  const blocked = evalCaseMixReadiness([
    { id:"draft-prohibited", review_status:"candidate", forbidden_behavior:"Do not produce legal advice." },
    { id:"approved-scenario", review_status:"approved", scenario_id:"scenario-1" },
  ], {
    minEvalCases:4,
    minCategoryRatios:{ prohibited_behavior:0.25, scenario:0.25, retrieval:0.25, boundary:0.25 },
  });

  assert.equal(blocked.ready, false);
  assert.equal(blocked.total, 1);
  assert.deepEqual(blocked.blockers.map(item => item.gate), [
    "approved_eval_cases",
    "eval_case_category_prohibited_behavior",
    "eval_case_category_retrieval",
    "eval_case_category_boundary",
  ]);
  assert.deepEqual(blocked.actions.map(item => item.action), [
    "approve_or_create_eval_cases",
    "create_prohibited_behavior_eval_cases",
    "create_retrieval_eval_cases",
    "create_boundary_eval_cases",
  ]);
  assert.equal(blocked.actions[0].id, "eval-mix-action:approved_eval_cases");

  const ready = evalCaseMixReadiness([
    { id:"prohibited", review_status:"approved", forbidden_behavior:"Do not produce legal advice." },
    { id:"scenario", review_status:"approved", scenario_id:"scenario-1" },
    { id:"retrieval", review_status:"approved", evidence_ref_ids:["ev-1"] },
    { id:"boundary", review_status:"approved", metadata:{ eval_category:"boundary" } },
  ], {
    minEvalCases:4,
    minCategoryRatios:{ prohibited_behavior:0.25, scenario:0.25, retrieval:0.25, boundary:0.25 },
  });

  assert.equal(ready.ready, true);
  assert.deepEqual(ready.blockers, []);
  assert.deepEqual(ready.actions, []);
});

test("eval case mix readiness actions map blockers to category build tasks", () => {
  assert.deepEqual(evalCaseMixReadinessActions([
    { gate:"approved_eval_cases", current:10, required:500 },
    { gate:"eval_case_category_scenario", current:20, required:150 },
  ]).map(item => item.action), [
    "approve_or_create_eval_cases",
    "create_scenario_eval_cases",
  ]);
});

test("knowledge brain cold start readiness reports v0.1 blockers", () => {
  const blocked = knowledgeBrainColdStartReadiness({
    sources:[
      { id:"src-1", source_type:"public_web", provider:"MLIT", review_status:"approved", risk_level:"low", training_allowed:false, deletion_requested:false },
    ],
    knowledgeUnits:[
      { id:"ku-1", source_id:"src-1", domain:"D01", title:"D01", content:"Approved source-backed content.", review_status:"approved", risk_level:"low", version:1 },
    ],
    evalCases:[],
  }, {
    minApprovedKnowledgeUnits:2,
    minEvalCases:1,
    requireAllDomains:false,
    requireIndustryAssociationSource:true,
    requirePartnerPractitionerSource:true,
  });

  assert.equal(blocked.ready, false);
  assert.deepEqual(blocked.blockers.map(item => item.gate), [
    "approved_knowledge_units",
    "eval_cases",
    "industry_association_source_tier",
    "partner_practitioner_source_tier",
  ]);
  assert.deepEqual(blocked.actions.map(item => item.action), [
    "ingest_approved_knowledge_units",
    "build_eval_cases",
    "ingest_industry_association_templates",
    "ingest_partner_practitioner_cases",
  ]);
  assert.equal(blocked.actions[0].id, "cold-start-action:approved_knowledge_units");
  assert.equal(blocked.actions[0].blocksReadiness, true);

  const ready = knowledgeBrainColdStartReadiness({
    sources:[
      { id:"src-1", source_type:"public_web", provider:"MLIT", review_status:"approved", risk_level:"low", training_allowed:false, deletion_requested:false },
      { id:"src-2", source_type:"industry_association", review_status:"approved", risk_level:"low", training_allowed:false, deletion_requested:false },
      { id:"src-3", source_type:"partner_practitioner_case", review_status:"approved", risk_level:"medium", training_allowed:false, deletion_requested:false },
    ],
    knowledgeUnits:[
      { id:"ku-1", source_id:"src-1", domain:"D01", title:"D01", content:"Approved source-backed content.", review_status:"approved", risk_level:"low", version:1 },
    ],
    evalCases:[
      { id:"eval-1", source_id:"src-1", prompt:"Check source.", expected_behavior:"Cite source.", review_status:"candidate", risk_level:"medium", version:1 },
    ],
  }, {
    minApprovedKnowledgeUnits:1,
    minEvalCases:1,
    requireAllDomains:false,
  });

  assert.equal(ready.ready, true);
  assert.deepEqual(ready.blockers, []);
  assert.deepEqual(ready.actions, []);
});

test("cold start readiness actions map blockers to repair actions", () => {
  assert.deepEqual(knowledgeBrainColdStartReadinessActions([
    { gate:"approved_knowledge_domain_coverage", current:2, required:0 },
    { gate:"eval_case_domain_coverage", current:3, required:0 },
    { gate:"official_public_source_tier", current:0, required:1 },
    { gate:"reference_integrity", current:5, required:0 },
    { gate:"unknown_gate", current:1, required:0 },
  ]).map(item => item.action), [
    "cover_missing_knowledge_domains",
    "cover_missing_eval_domains",
    "ingest_official_public_sources",
    "repair_reference_integrity",
    "manual_cold_start_review",
  ]);
});

test("cold start readiness can gate reviewer role coverage", () => {
  const readiness = knowledgeBrainColdStartReadiness({
    sources:[
      { id:"src-1", source_type:"public_web", provider:"MLIT", review_status:"approved", risk_level:"low", training_allowed:false, deletion_requested:false },
      { id:"src-2", source_type:"industry_association", review_status:"approved", risk_level:"low", training_allowed:false, deletion_requested:false },
      { id:"src-3", source_type:"partner_practitioner_case", review_status:"approved", risk_level:"medium", training_allowed:false, deletion_requested:false },
    ],
    knowledgeUnits:[
      { id:"ku-risk", source_id:"src-1", domain:"D07", title:"Risk", content:"Approved high-risk source-backed content.", review_status:"approved", risk_level:"high", version:1, evidence_ref_ids:["ev-1"], metadata:{ reviewed_by:"expert", reviewed_at:"2026-06-12T00:00:00.000Z" } },
      { id:"ku-partner", source_id:"src-3", domain:"D04", title:"Partner", content:"Approved partner source-backed content.", review_status:"approved", risk_level:"medium", version:1, evidence_ref_ids:["ev-2"], metadata:{ reviewed_by:"expert", reviewed_at:"2026-06-12T00:00:00.000Z" } },
    ],
    evidenceRefs:[
      { id:"ev-1", source_id:"src-1", target_type:"knowledge_unit", target_id:"ku-risk", locator:"p1", quote:"risk quote", review_status:"approved", risk_level:"low", version:1 },
      { id:"ev-2", source_id:"src-3", target_type:"knowledge_unit", target_id:"ku-partner", locator:"p2", quote:"partner quote", review_status:"approved", risk_level:"low", version:1 },
    ],
    evalCases:[
      { id:"eval-1", source_id:"src-1", domain:"D07", prompt:"Prompt", expected_behavior:"Expected", review_status:"approved", risk_level:"medium", version:1 },
    ],
  }, {
    minApprovedKnowledgeUnits:2,
    minEvalCases:1,
    requireAllDomains:false,
    requireReviewerRoleCoverage:true,
    requirePartnerCaseTakkenReviewer:true,
  });

  assert.equal(readiness.ready, false);
  assert.ok(readiness.blockers.some(item => item.gate === "high_risk_reviewer_role_coverage"));
  assert.ok(readiness.blockers.some(item => item.gate === "partner_case_takken_reviewer_coverage"));
  assert.ok(readiness.actions.some(item => item.action === "record_high_risk_reviewer_roles"));
  assert.ok(readiness.actions.some(item => item.action === "assign_takken_reviewer_for_partner_cases"));
});

test("cold start readiness gates source contribution consent gaps", () => {
  const readiness = knowledgeBrainColdStartReadiness({
    sources:[
      { id:"src-1", source_type:"public_web", provider:"MLIT", contributor_tier:"free_tier", consent_scope:"none", review_status:"approved", risk_level:"low", training_allowed:true, deletion_requested:false },
      { id:"src-2", source_type:"industry_association", review_status:"approved", risk_level:"low", training_allowed:false, deletion_requested:false },
      { id:"src-3", source_type:"partner_practitioner_case", review_status:"approved", risk_level:"medium", training_allowed:false, deletion_requested:false },
    ],
    knowledgeUnits:[
      { id:"ku-1", source_id:"src-1", domain:"D01", title:"D01", content:"Approved source-backed content.", review_status:"approved", risk_level:"low", version:1 },
    ],
    evalCases:[
      { id:"eval-1", source_id:"src-1", domain:"D01", prompt:"Prompt", expected_behavior:"Expected", review_status:"approved", risk_level:"medium", version:1 },
    ],
  }, {
    minApprovedKnowledgeUnits:1,
    minEvalCases:1,
    requireAllDomains:false,
    requireCleanReferenceIntegrity:false,
  });

  assert.equal(readiness.ready, false);
  assert.ok(readiness.blockers.some(item => item.gate.startsWith("source_contribution_consent:")));
  assert.ok(readiness.actions.some(item => item.action === "collect_free_tier_explicit_opt_in_or_disable_use"));
  assert.ok(readiness.actions.some(item => item.action === "disable_training_or_collect_explicit_consent"));
});

test("high-risk tools stay internal until cold start and eval set gates pass", () => {
  const blocked = knowledgeBrainHighRiskToolReadiness({
    sources:[
      { id:"src-1", source_type:"public_web", provider:"MLIT", review_status:"approved", risk_level:"low", training_allowed:false, deletion_requested:false },
    ],
    knowledgeUnits:[
      { id:"ku-1", source_id:"src-1", domain:"D01", title:"D01", content:"Approved source-backed content.", review_status:"approved", risk_level:"low", version:1 },
    ],
    evalCases:[
      { id:"eval-1", source_id:"src-1", prompt:"Check source.", expected_behavior:"Cite source.", review_status:"approved", risk_level:"medium", version:1, scenario_id:"scenario-1" },
    ],
  }, {
    toolId:"M4",
    coldStartOptions:{
      minApprovedKnowledgeUnits:2,
      minEvalCases:4,
      requireAllDomains:false,
      requireIndustryAssociationSource:true,
      requirePartnerPractitionerSource:true,
      requireCleanReferenceIntegrity:false,
    },
    evalMixOptions:{
      minEvalCases:4,
      minCategoryRatios:{ prohibited_behavior:0.25, scenario:0.25, retrieval:0.25, boundary:0.25 },
    },
  });

  assert.equal(blocked.ready, false);
  assert.equal(blocked.releaseMode, "internal_pilot");
  assert.equal(blocked.externalReleaseAllowed, false);
  assert.equal(blocked.internalPilotAllowed, true);
  assert.ok(blocked.blockers.some(item => item.gate === "cold_start_readiness"));
  assert.ok(blocked.blockers.some(item => item.gate === "eval_set_mix"));
  assert.ok(blocked.actions.some(item => item.readinessGate === "cold_start_readiness" && item.action === "ingest_approved_knowledge_units"));
  assert.ok(blocked.actions.some(item => item.readinessGate === "eval_set_mix" && item.action === "create_prohibited_behavior_eval_cases"));

  const ready = knowledgeBrainHighRiskToolReadiness({
    sources:[
      { id:"src-1", source_type:"public_web", provider:"MLIT", review_status:"approved", risk_level:"low", training_allowed:false, deletion_requested:false },
      { id:"src-2", source_type:"industry_association", review_status:"approved", risk_level:"low", training_allowed:false, deletion_requested:false },
      { id:"src-3", source_type:"partner_practitioner_case", review_status:"approved", risk_level:"medium", training_allowed:false, deletion_requested:false },
    ],
    knowledgeUnits:[
      { id:"ku-1", source_id:"src-1", domain:"D01", title:"D01", content:"Approved source-backed content.", review_status:"approved", risk_level:"low", version:1 },
    ],
    evalCases:[
      { id:"prohibited", source_id:"src-1", prompt:"Forbidden.", expected_behavior:"Refuse.", review_status:"approved", risk_level:"medium", version:1, forbidden_behavior:"Do not provide legal advice." },
      { id:"scenario", source_id:"src-1", prompt:"Scenario.", expected_behavior:"Route correctly.", review_status:"approved", risk_level:"medium", version:1, scenario_id:"scenario-1" },
      { id:"retrieval", source_id:"src-1", prompt:"Retrieve.", expected_behavior:"Cite evidence.", review_status:"approved", risk_level:"medium", version:1, evidence_ref_ids:["ev-1"] },
      { id:"boundary", source_id:"src-1", prompt:"Boundary.", expected_behavior:"Ask for expert review.", review_status:"approved", risk_level:"medium", version:1, metadata:{ eval_category:"boundary" } },
    ],
  }, {
    toolId:"M5",
    coldStartOptions:{
      minApprovedKnowledgeUnits:1,
      minEvalCases:4,
      requireAllDomains:false,
      requireCleanReferenceIntegrity:false,
    },
    evalMixOptions:{
      minEvalCases:4,
      minCategoryRatios:{ prohibited_behavior:0.25, scenario:0.25, retrieval:0.25, boundary:0.25 },
    },
  });

  assert.equal(ready.ready, true);
  assert.equal(ready.releaseMode, "external_release");
  assert.equal(ready.externalReleaseAllowed, true);
  assert.deepEqual(ready.blockers, []);
  assert.deepEqual(ready.actions, []);
});

test("high-risk tool readiness reports unsupported tool configuration action", () => {
  const readiness = knowledgeBrainHighRiskToolReadiness({
    sources:[],
    knowledgeUnits:[],
    evalCases:[],
  }, {
    toolId:"M9",
    coldStartOptions:{ minApprovedKnowledgeUnits:0, minEvalCases:0, requireAllDomains:false, requireOfficialPublicSource:false, requireIndustryAssociationSource:false, requirePartnerPractitionerSource:false, requireCleanReferenceIntegrity:false },
    evalMixOptions:{ minEvalCases:0, minCategoryRatios:{} },
  });

  assert.equal(readiness.ready, false);
  assert.deepEqual(readiness.actions.map(item => item.action), ["select_supported_high_risk_tool"]);
  assert.equal(readiness.actions[0].readinessGate, "tool_configuration");
});

test("high-risk tool readiness gates source contribution consent gaps", () => {
  const readiness = knowledgeBrainHighRiskToolReadiness({
    sources:[
      { id:"src-1", source_type:"public_web", provider:"MLIT", contributor_tier:"free_tier", consent_scope:"none", review_status:"approved", risk_level:"low", training_allowed:true, deletion_requested:false },
      { id:"src-2", source_type:"industry_association", review_status:"approved", risk_level:"low", training_allowed:false, deletion_requested:false },
      { id:"src-3", source_type:"partner_practitioner_case", review_status:"approved", risk_level:"medium", training_allowed:false, deletion_requested:false },
    ],
    knowledgeUnits:[
      { id:"ku-1", source_id:"src-1", domain:"D01", title:"D01", content:"Approved source-backed content.", review_status:"approved", risk_level:"low", version:1 },
    ],
    evalCases:[
      { id:"prohibited", source_id:"src-1", prompt:"Forbidden.", expected_behavior:"Refuse.", review_status:"approved", risk_level:"medium", version:1, forbidden_behavior:"Do not provide legal advice." },
      { id:"scenario", source_id:"src-1", prompt:"Scenario.", expected_behavior:"Route correctly.", review_status:"approved", risk_level:"medium", version:1, scenario_id:"scenario-1" },
      { id:"retrieval", source_id:"src-1", prompt:"Retrieve.", expected_behavior:"Cite evidence.", review_status:"approved", risk_level:"medium", version:1, evidence_ref_ids:["ev-1"] },
      { id:"boundary", source_id:"src-1", prompt:"Boundary.", expected_behavior:"Ask for expert review.", review_status:"approved", risk_level:"medium", version:1, metadata:{ eval_category:"boundary" } },
    ],
  }, {
    toolId:"M4",
    coldStartOptions:{
      minApprovedKnowledgeUnits:1,
      minEvalCases:4,
      requireAllDomains:false,
      requireCleanReferenceIntegrity:false,
    },
    evalMixOptions:{
      minEvalCases:4,
      minCategoryRatios:{ prohibited_behavior:0.25, scenario:0.25, retrieval:0.25, boundary:0.25 },
    },
  });

  assert.equal(readiness.ready, false);
  assert.equal(readiness.externalReleaseAllowed, false);
  assert.equal(readiness.blockers.filter(item => item.gate === "source_contribution_consent").length, 2);
  assert.equal(readiness.blockers.some(item => item.gate === "cold_start_readiness" && `${item.sub_gate || ""}`.startsWith("source_contribution_consent:")), false);
  assert.ok(readiness.blockers.some(item => item.gate === "source_contribution_consent"));
  assert.ok(readiness.actions.some(item => item.readinessGate === "source_contribution_consent" && item.action === "collect_free_tier_explicit_opt_in_or_disable_use"));
  assert.equal(readiness.sourceContributionConsentReport.trainingAllowedWithoutExplicitConsent, 1);
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

  const sourceTypeMatches = filterSourceRegistryRecords([
    { id:"reins", title:"Uploaded listing", provider:"User", source_type:"reins_user_upload", review_status:"candidate", risk_level:"high", training_allowed:false, deletion_requested:false, updated_at:"2026-06-12T01:00:00.000Z" },
  ], {
    query:"reins_user_upload",
  });

  assert.deepEqual(sourceTypeMatches.map(source => source.id), ["reins"]);
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
  assert.equal(update.record.collection_method, "manual");
  assert.equal(update.record.risk_level, "high");
  assert.equal(update.record.metadata.previous_version, 1);
  assert.equal(update.record.metadata.changed_by, "reviewer");
  assert.equal(update.record.metadata.change_reason, "source_reclassified");
  assert.equal(update.quality.ok, true);
  assert.deepEqual(trainingEligibleSources([update.record]), []);
});

test("source registry update payload disables training when consent is withdrawn", () => {
  const update = buildSourceRegistryUpdatePayload({
    id:"src-2",
    source_type:"public_web",
    title:"Opted in public source",
    review_status:"approved",
    risk_level:"low",
    version:1,
    consent_scope:"explicit_opt_in",
    training_allowed:true,
    deletion_requested:false,
  }, {
    consent_scope:"none",
    training_allowed:true,
  }, {
    changedBy:"owner",
    reason:"training_consent_withdrawn",
    now:"2026-06-12T05:30:00.000Z",
  });

  assert.equal(update.record.version, 2);
  assert.equal(update.record.training_allowed, false);
  assert.equal(update.record.consent_scope, "none");
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
  assert.equal(withdrawn.consent_scope, "none");
  assert.equal(withdrawn.deletion_requested, true);
  assert.equal(withdrawn.metadata.previous_consent_scope, "explicit_opt_in");
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

test("versioned approved knowledge patch records reviewer metadata", () => {
  const patch = buildVersionedKnowledgePatch({
    id:"ku-approval",
    version:1,
    review_status:"in_review",
    metadata:{ owner:"analyst" },
  }, {
    review_status:"approved",
    metadata:{ approval_note:"source and evidence checked" },
  }, {
    changedBy:"expert-reviewer",
    reason:"expert_approval",
    now:"2026-06-12T06:00:00.000Z",
  });

  assert.equal(patch.version, 2);
  assert.equal(patch.review_status, "approved");
  assert.equal(patch.metadata.previous_version, 1);
  assert.equal(patch.metadata.changed_by, "expert-reviewer");
  assert.equal(patch.metadata.change_reason, "expert_approval");
  assert.equal(patch.metadata.reviewed_by, "expert-reviewer");
  assert.equal(patch.metadata.reviewed_at, "2026-06-12T06:00:00.000Z");
  assert.equal(patch.metadata.approval_note, "source and evidence checked");
});

test("knowledge brain inventory stats expose review, risk, evidence, and training counts", () => {
  const stats = knowledgeBrainInventoryStats({
    sources:[
      { id:"src-1", source_type:"public_manual", title:"Public source", provider:"MLIT", review_status:"approved", training_allowed:true, deletion_requested:false, risk_level:"low", version:1, consent_scope:"explicit_opt_in", contributor_tier:"free_tier" },
      { id:"src-2", source_type:"attachment", title:"Candidate source", review_status:"candidate", training_allowed:false, deletion_requested:false, risk_level:"medium", version:1, metadata:{ cold_start_tier:"partner_practitioner_case" } },
      { id:"src-3", source_type:"contract", title:"Deleted contract", review_status:"archived", training_allowed:false, deletion_requested:true, risk_level:"high", version:1, metadata:{ cold_start_tier:"partner_practitioner_case" } },
      { id:"src-4", source_type:"contract", title:"Bad source", review_status:"approved", training_allowed:true, deletion_requested:true, risk_level:"high", version:1, consent_scope:"none", metadata:{ cold_start_tier:"industry_association" } },
    ],
    knowledgeUnits:[
      { id:"ku-1", source_id:"src-1", domain:"D01", title:"Approved unit", content:"Approved source-backed content.", review_status:"approved", risk_level:"low", version:1, evidence_ref_ids:[] },
      { id:"ku-2", source_id:"src-2", domain:"D02", title:"High risk candidate", content:"High-risk candidate content.", review_status:"candidate", risk_level:"high", version:1, evidence_ref_ids:[] },
      { id:"ku-3", source_id:"src-1", domain:"D03", title:"Restricted unit", content:"Restricted source-backed content.", review_status:"approved", risk_level:"restricted", version:1, evidence_ref_ids:["ev-1"], metadata:{ reviewed_by:"expert-reviewer", reviewed_at:"2026-06-12T06:00:00.000Z" } },
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
    evalCases:[{ id:"eval-1", source_id:"src-1", prompt:"Cite evidence.", expected_behavior:"Cite approved evidence.", review_status:"candidate", risk_level:"medium", evidence_ref_ids:[], version:1, metadata:{ eval_category:"retrieval" } }],
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
  assert.equal(stats.trainingBlockedByConsentSources, 1);
  assert.equal(stats.sourceReviewStatus.approved, 2);
  assert.equal(stats.sourceReviewStatus.archived, 1);
  assert.equal(stats.sourceRiskLevels.high, 2);
  assert.equal(stats.invalidSources, 1);
  assert.equal(stats.sourceRegistryQualityIssues.deleted_source_training_enabled, 1);
  assert.equal(stats.sourceRegistryQualityIssues.high_risk_training_enabled, 1);
  assert.equal(stats.sourceRegistryQualityIssues.training_without_explicit_consent, 1);
  assert.deepEqual(stats.sourceTrainingEligibilityBlockedReasons, {
    source_not_approved:2,
    training_not_enabled:2,
    missing_explicit_consent:3,
    deletion_requested:2,
    high_risk_source:2,
    high_risk_source_type:2,
  });
  assert.equal(stats.sourceContributionConsentReport.freeTierSources, 1);
  assert.equal(stats.sourceContributionConsentReport.trainingAllowedWithoutExplicitConsent, 1);
  assert.ok(stats.sourceContributionConsentActions.some(item => item.action === "disable_training_or_collect_explicit_consent"));
  assert.equal(stats.sourceUsagePermissionReport.length, 4);
  assert.equal(stats.sourceUsagePermissionReport[0].source_id, "src-1");
  assert.equal(stats.sourceUsagePermissionReport[0].reference.allowed, true);
  assert.equal(stats.sourceUsagePermissionReport[2].reference.allowed, false);
  assert.deepEqual(stats.sourceColdStartTierCounts, {
    tier_1_official_public:1,
    tier_3_partner_practitioner_case:2,
    tier_2_industry_association:1,
  });
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
  assert.equal(stats.knowledgeBrainDomainCoverage.domains.D01.approvedKnowledgeUnits, 3);
  assert.equal(stats.knowledgeBrainDomainCoverage.domains.D02.knowledgeUnits, 1);
  assert.equal(stats.knowledgeBrainDomainCoverage.domains.D03.approvedKnowledgeUnits, 1);
  assert.equal(stats.knowledgeBrainDomainCoverage.domains.D01.evalCases, 0);
  assert.equal(stats.knowledgeBrainDomainCoverage.missingApprovedKnowledgeUnitDomains.includes("D04"), true);
  assert.equal(stats.knowledgeBrainDomainCoverage.missingEvalCaseDomains.length, 16);
  assert.equal(stats.knowledgeBrainColdStartSourceAcquisitionPlan[2].reviewerRoleRequired, "takken");
  assert.equal(stats.evidenceRefs, 2);
  assert.equal(stats.approvedEvidenceRefs, 1);
  assert.equal(stats.invalidEvidenceRefs, 1);
  assert.equal(stats.evidenceRefQualityIssues.missing_locator, 1);
  assert.equal(stats.evidenceRefQualityIssues.high_risk_evidence_not_approved, 1);
  assert.equal(stats.evidenceRefQualityIssues.missing_quote_or_hash, 1);
  assert.equal(stats.referenceIntegrityIssues, 0);
  assert.deepEqual(stats.knowledgeBrainReferenceIntegrityIssues, []);
  assert.deepEqual(stats.knowledgeBrainReferenceIntegrityActions, []);
  assert.equal(stats.reviewerRoleSummary.approvedRecords > 0, true);
  assert.equal(stats.reviewerRoleSummary.highRiskApprovedRecords, 2);
  assert.equal(stats.reviewerRoleSummary.highRiskMissingReviewerRole, 2);
  assert.ok(stats.reviewerRoleActions.some(item => item.action === "record_high_risk_reviewer_roles"));
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
  assert.deepEqual(stats.evalCaseCategoryCounts, { retrieval:1 });
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
      { id:"ev-deleted-source", source_id:"src-deleted", target_type:"scenario", target_id:"scenario-deleted-evidence-source", review_status:"candidate" },
      { id:"ev-unapproved-source", source_id:"src-candidate", target_type:"eval_case", target_id:"eval-unapproved-evidence-source", review_status:"approved" },
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
      { id:"scenario-deleted-evidence-source", source_id:"src-approved", review_status:"candidate", risk_level:"medium", evidence_ref_ids:["ev-deleted-source"] },
    ],
    evalCases:[
      { id:"eval-missing-evidence", source_id:"src-approved", review_status:"approved", risk_level:"medium", evidence_ref_ids:["ev-missing-eval"] },
      { id:"eval-unapproved-evidence-source", source_id:"src-approved", review_status:"approved", risk_level:"medium", evidence_ref_ids:["ev-unapproved-source"] },
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
    "approved_evidence_unapproved_source",
    "approved_record_unapproved_source",
    "approved_record_unapproved_source",
    "deleted_source_ref",
    "evidence_deleted_source_ref",
    "evidence_missing_source_ref",
    "evidence_target_mismatch",
    "high_risk_unapproved_evidence",
    "missing_evidence_ref",
    "missing_evidence_ref",
    "missing_reviewed_at",
    "missing_reviewed_by",
    "missing_source_ref",
    "missing_source_ref",
  ].sort());
  assert.equal(integrity.issues.find(issue => issue.issue === "evidence_target_mismatch").target_id, "ku-target-mismatch");
  assert.equal(integrity.issues.find(issue => issue.issue === "deleted_source_ref").target_id, "calc-1");
  assert.equal(integrity.issues.find(issue => issue.target_id === "rule-unapproved-source").issue, "approved_record_unapproved_source");
  assert.equal(integrity.issues.find(issue => issue.target_id === "scenario-missing-source").issue, "missing_source_ref");
  assert.equal(integrity.issues.find(issue => issue.target_id === "eval-missing-evidence").issue, "missing_evidence_ref");
  assert.equal(integrity.issues.find(issue => issue.target_id === "scenario-deleted-evidence-source").issue, "evidence_deleted_source_ref");
  assert.equal(integrity.issues.find(issue => issue.target_id === "eval-unapproved-evidence-source").issue, "approved_evidence_unapproved_source");
  assert.equal(integrity.issues.some(issue => issue.target_id === "risk-1" && issue.issue === "missing_reviewed_by"), true);
});

test("knowledge brain reference integrity actions map issues to repair guidance", () => {
  const actions = knowledgeBrainReferenceIntegrityActions({
    issues:[
      { target_type:"knowledge_unit", target_id:"ku-1", issue:"missing_source_ref", source_id:"src-missing" },
      { target_type:"knowledge_unit", target_id:"ku-2", issue:"evidence_target_mismatch", evidence_ref_id:"ev-1" },
      { target_type:"jre_risk", target_id:"risk-1", issue:"high_risk_unapproved_evidence", evidence_ref_id:"ev-2" },
      { target_type:"policy_rule", target_id:"rule-1", issue:"missing_reviewed_by" },
      { target_type:"scenario", target_id:"scenario-1", issue:"approved_evidence_unapproved_source", evidence_ref_id:"ev-3", source_id:"src-candidate" },
      { target_type:"calculation_run", target_id:"calc-1", issue:"unknown_issue" },
    ],
  });

  assert.deepEqual(actions.map(item => item.action), [
    "restore_source_or_archive_record",
    "relink_evidence_to_target",
    "expert_review_evidence_before_approval",
    "record_expert_reviewer_metadata",
    "approve_evidence_source_before_record",
    "manual_review_required",
  ]);
  assert.equal(actions[0].blocks_approval, true);
  assert.equal(actions[3].blocks_approval, true);
  assert.equal(actions[4].blocks_approval, true);
  assert.equal(actions[5].blocks_approval, false);
});

test("knowledge brain reference integrity actions filter blockers target source issue action and query", () => {
  const actions = filterKnowledgeBrainReferenceIntegrityActions([
    { target_type:"knowledge_unit", target_id:"ku-1", issue:"missing_source_ref", source_id:"src-missing", action:"restore_source_or_archive_record", blocks_approval:true },
    { target_type:"knowledge_unit", target_id:"ku-2", issue:"evidence_target_mismatch", evidence_ref_id:"ev-1", action:"relink_evidence_to_target", blocks_approval:true },
    { target_type:"jre_risk", target_id:"risk-1", issue:"high_risk_unapproved_evidence", source_id:"src-risk", evidence_ref_id:"ev-2", action:"expert_review_evidence_before_approval", blocks_approval:true },
    { target_type:"calculation_run", target_id:"calc-1", issue:"unknown_issue", action:"manual_review_required", blocks_approval:false },
  ], {
    targetTypes:["jre_risk"],
    sourceIds:["src-risk"],
    issues:["high_risk_unapproved_evidence"],
    actions:["expert_review_evidence_before_approval"],
    blocksApproval:true,
    query:"risk-1",
  });

  assert.deepEqual(actions.map(item => item.target_id), ["risk-1"]);
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
      { id:"rule-approved-missing-reviewer", source_id:"src-review", rule_type:"expert", title:"Approved expert", rule_text:"Approved high-risk rule needs reviewer metadata.", review_status:"approved", risk_level:"high", version:1, evidence_ref_ids:["ev-risk"], requires_expert_confirmation:true },
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
  assert.equal(items.some(item => item.target_id === "rule-approved-missing-reviewer" && item.reasons.includes("missing_reviewed_by")), true);
  assert.equal(items.some(item => item.target_id === "rule-approved-missing-reviewer" && item.reasons.includes("missing_reviewed_at")), true);
  assert.equal(items.some(item => item.target_id === "rule-approved-missing-reviewer" && item.reasons.includes("approved_record_unapproved_source")), true);
  assert.equal(items.some(item => item.target_id === "risk-review" && item.reasons.includes("risk_record_missing_expert_confirmation")), true);
  assert.equal(items.some(item => item.target_id === "calc-review" && item.reasons.includes("missing_source_ids")), true);
});

test("knowledge brain review queue items filter target source review risk reason and query", () => {
  const items = filterKnowledgeBrainReviewQueueItems([
    { target_type:"knowledge_unit", target_id:"ku-1", source_id:"src-1", review_status:"candidate", risk_level:"high", reasons:["needs_review", "high_risk_missing_evidence"] },
    { target_type:"knowledge_unit", target_id:"ku-2", source_id:"src-1", review_status:"candidate", risk_level:"high", reasons:["needs_review"] },
    { target_type:"evidence_ref", target_id:"ev-1", source_id:"src-1", review_status:"candidate", risk_level:"high", reasons:["missing_locator"] },
    { target_type:"knowledge_unit", target_id:"ku-3", source_id:"src-2", review_status:"candidate", risk_level:"high", reasons:["high_risk_missing_evidence"] },
    { target_type:"knowledge_unit", target_id:"ku-4", source_id:"src-1", review_status:"approved", risk_level:"high", reasons:["high_risk_missing_evidence"] },
  ], {
    targetTypes:["knowledge_unit"],
    sourceIds:["src-1"],
    reviewStatuses:["candidate"],
    riskLevels:["high"],
    reasons:["high_risk_missing_evidence"],
    query:"ku-1",
  });

  assert.deepEqual(items.map(item => item.target_id), ["ku-1"]);
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
