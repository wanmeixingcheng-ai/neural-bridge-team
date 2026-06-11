import test from "node:test";
import assert from "node:assert/strict";

import { approvedKnowledgeUnitSearchResults, approvedMemoryMetadata, buildKnowledgeDocumentIngestRecords, chunkText, filterProjectMemoriesBySourceType, knowledgeBrainInventoryStats, projectMemoryApprovalQueueSummary, projectMemoryNeedsApproval, projectMemorySourceTypeCounts, rememberWorkflowArtifact, selectLowValueMemories, trainingEligibleSources } from "../lib/projectBrain.mjs";

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
      { id:"src-1", review_status:"approved", training_allowed:true, deletion_requested:false, risk_level:"low" },
      { id:"src-2", review_status:"candidate", training_allowed:false, deletion_requested:false, risk_level:"medium" },
      { id:"src-3", review_status:"archived", training_allowed:false, deletion_requested:true, risk_level:"high" },
    ],
    knowledgeUnits:[
      { id:"ku-1", review_status:"approved", risk_level:"low" },
      { id:"ku-2", review_status:"candidate", risk_level:"high" },
      { id:"ku-3", review_status:"approved", risk_level:"restricted" },
    ],
    evidenceRefs:[
      { id:"ev-1", review_status:"approved", risk_level:"low" },
      { id:"ev-2", review_status:"candidate", risk_level:"high" },
    ],
    policyRules:[{ id:"rule-1" }],
    scenarios:[{ id:"scenario-1" }, { id:"scenario-2" }],
    evalCases:[{ id:"eval-1" }],
  });

  assert.equal(stats.sourceRegistry, 2);
  assert.equal(stats.deletedSources, 1);
  assert.equal(stats.trainingEligibleSources, 1);
  assert.equal(stats.sourceReviewStatus.approved, 1);
  assert.equal(stats.sourceReviewStatus.archived, 1);
  assert.equal(stats.sourceRiskLevels.high, 1);
  assert.equal(stats.knowledgeUnits, 3);
  assert.equal(stats.approvedKnowledgeUnits, 2);
  assert.equal(stats.highRiskKnowledgeUnits, 2);
  assert.equal(stats.knowledgeUnitReviewStatus.candidate, 1);
  assert.equal(stats.evidenceRefs, 2);
  assert.equal(stats.approvedEvidenceRefs, 1);
  assert.equal(stats.policyRules, 1);
  assert.equal(stats.scenarios, 2);
  assert.equal(stats.evalCases, 1);
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
