import test from "node:test";
import assert from "node:assert/strict";

import { approvedKnowledgeUnitSearchResults, approvedMemoryMetadata, buildJapaneseRealEstateRecordPayload, buildKnowledgeDocumentIngestRecords, buildPropertyDossier, buildPropertyDossierInvestmentMetrics, chunkText, filterProjectMemoriesBySourceType, knowledgeBrainInventoryStats, knowledgeBrainReviewQueueSummary, projectMemoryApprovalQueueSummary, projectMemoryNeedsApproval, projectMemorySourceTypeCounts, rememberWorkflowArtifact, selectLowValueMemories, trainingEligibleSources } from "../lib/projectBrain.mjs";

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

test("japanese real estate record payload routes entities to their stores and blocks LLM math", () => {
  const payload = buildJapaneseRealEstateRecordPayload("loan", {
    source_id:"src-1",
    property_id:"prop-1",
    title:"Loan terms",
    review_status:"approved",
    risk_level:"medium",
    calculation_method:"deterministic_code",
    evidence_ref_ids:["ev-1"],
  });

  assert.equal(payload.storeName, "loan_records");
  assert.equal(payload.record.entity_type, "loan");
  assert.equal(payload.record.calculation_method, "deterministic_code");
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
    policyRules:[{ id:"rule-1", review_status:"in_review", risk_level:"high", requires_expert_confirmation:true }],
    scenarios:[{ id:"scenario-1" }, { id:"scenario-2" }],
    evalCases:[{ id:"eval-1" }],
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
  assert.equal(stats.policyRules, 1);
  assert.equal(stats.scenarios, 2);
  assert.equal(stats.evalCases, 1);
  assert.equal(stats.japaneseRealEstateRecords, 2);
  assert.equal(stats.japaneseRealEstateRecordsByType.property, 1);
  assert.equal(stats.japaneseRealEstateRecordsByType.risk, 1);
  assert.equal(stats.invalidJapaneseRealEstateRecords, 1);
  assert.equal(stats.japaneseRealEstateRecordQualityIssues.high_risk_missing_evidence, 1);
  assert.equal(stats.japaneseRealEstateRecordQualityIssues.risk_record_missing_expert_confirmation, 1);
  assert.equal(stats.reviewQueue.total, 4);
  assert.equal(stats.reviewQueue.sources, 1);
  assert.equal(stats.reviewQueue.knowledgeUnits, 2);
  assert.equal(stats.reviewQueue.policyRules, 1);
  assert.equal(stats.reviewQueue.highRiskExpertReview, 3);
  assert.deepEqual(stats.reviewQueue.invalidKnowledgeUnitIds, ["ku-2", "ku-4"]);
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
  });

  assert.equal(summary.total, 4);
  assert.equal(summary.sources, 2);
  assert.equal(summary.knowledgeUnits, 1);
  assert.equal(summary.policyRules, 1);
  assert.equal(summary.highRiskExpertReview, 3);
  assert.equal(summary.invalidKnowledgeUnits, 1);
  assert.deepEqual(summary.invalidKnowledgeUnitIds, ["ku-bad"]);
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
