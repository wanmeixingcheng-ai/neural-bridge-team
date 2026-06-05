import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  archiveWorkflowRecordSnapshot,
  artifactContentHash,
  buildWorkflowArtifactKnowledgePayload,
  buildWorkflowArtifactRevisionPrompt,
  buildWorkflowAttentionRecoveryPrompt,
  buildWorkflowContinuationPrompt,
  buildWorkflowEventRecoveryPrompt,
  buildWorkflowKnowledgePayload,
  buildWorkflowRecordDetails,
  buildWorkflowRecoveryPrompt,
  buildWorkflowRerunPrompt,
  filterWorkflowRecordsByStatus,
  formatWorkflowAuditMarkdown,
  formatWorkflowArtifactMarkdown,
  formatWorkflowRecordMarkdown,
  normalizeWorkflowRecord,
} from "../lib/workflowArchive.mjs";

describe("workflowArchive", () => {
  it("normalizes a workflow run into a bounded record", () => {
    const record = normalizeWorkflowRecord({
      title: "x".repeat(200),
      task: "task",
      source: "aria-workflow",
      trigger:{ type:"automation", automationId:"neural-bridge", label:"自动化任务 neural-bridge" },
      members: [{ id: "pm", name: "林 美穂", title: "PM", summary: "s".repeat(3000) }],
      plan: {
        strategy: "s".repeat(1000),
        steps: Array.from({ length:30 }, (_, index) => ({
          order:index + 1,
          memberId:`m-${index}`,
          member:"成员",
          title:"角色",
          model:"gemma31",
          purpose:"p".repeat(900),
          subtask:"s".repeat(900),
          output:"o".repeat(900),
          dependencies:["prev"],
          acceptanceCriteria:"a".repeat(900),
        })),
      },
      results: [{ member: "林 美穂", title: "PM", text: "r".repeat(9000) }],
      artifacts: [{ title: "报告", content: "a".repeat(16000) }],
      comments:[{ targetMemberId:"fe", targetMember:"陈志远", author:"human", text:"Workboard 评论".repeat(200), at:"2026-06-04T00:01:00.000Z" }],
      modelUsage:{ models:[{ modelKey:"gemma26", actualModel:"gemma-4-26b-a4b-it", provider:"Google Gemini/Gemma", external:true }] },
      events:[{ at:"2026-06-04T00:00:00.000Z", type:"auto_reassignment", member:"CTO", model:"claude -> gemma26", status:"running", detail:"busy" }],
    });

    assert.equal(record.source, "aria-workflow");
    assert.equal(record.trigger.automationId, "neural-bridge");
    assert.equal(record.title.length, 120);
    assert.equal(record.members.length, 1);
    assert.equal(record.plan.steps.length, 24);
    assert.ok(record.plan.strategy.length < 600);
    assert.ok(record.plan.steps[0].purpose.length < 600);
    assert.ok(record.plan.steps[0].subtask.length < 600);
    assert.equal(record.plan.steps[0].dependencies[0], "prev");
    assert.equal(record.artifacts[0].version, 1);
    assert.match(record.artifacts[0].hash, /^a-/);
    assert.ok(record.members[0].summary.length < 1800);
    assert.ok(record.results[0].text.length < 6200);
    assert.ok(record.artifacts[0].content.length < 12200);
    assert.equal(record.modelUsage.models[0].actualModel, "gemma-4-26b-a4b-it");
    assert.equal(record.comments[0].targetMember, "陈志远");
    assert.ok(record.comments[0].text.length < 1300);
    assert.equal(record.events[0].type, "auto_reassignment");
  });

  it("formats a full workflow record as markdown", () => {
    const markdown = formatWorkflowRecordMarkdown({
      title: "综合报告",
      task: "分析项目",
      source: "aria-workflow",
      trigger:{ type:"automation", automationId:"neural-bridge" },
      members: [{ id: "pm", name: "林 美穂", title: "PM", model: "gemma26", status:"complete" }, { id:"fe", name:"陈志远", title:"前端工程师", model:"codex", status:"queued" }],
      plan: {
        strategy:"ARIA 自动调度 · 核心判断",
        protocol:{ intent:"分析项目", task_type:"product", priority:"high", subtasks:["拆解目标", "复核风险"], expected_outputs:["报告"], risks:["范围不清"] },
        steps:[
          { order:1, memberId:"pm", member:"林 美穂", title:"PM", model:"gemma26", purpose:"里程碑与风险拆解", subtask:"拆解目标", output:"报告", acceptanceCriteria:"输出必须覆盖：报告" },
          { order:2, memberId:"fe", member:"陈志远", title:"前端工程师", model:"codex", purpose:"实现界面", subtask:"实现看板", input:"报告", output:"UI", dependencies:["pm"], acceptanceCriteria:"移动端稳定" },
        ],
      },
      modelUsage:{
        external:true,
        localOnlyMode:true,
        providers:["Google Gemini/Gemma"],
        models:[{ modelKey:"gemma26", actualModel:"gemma-4-26b-a4b-it", provider:"Google Gemini/Gemma", external:true }],
      },
      quality:{ complete:false, missingMembers:[{ id:"qa", name:"吴晓敏", title:"QA" }] },
      results: [{ member: "林 美穂", title: "PM", text: "项目计划内容" }],
      artifacts: [{ title: "最终产物", content: "整合结论" }],
      comments:[{ targetMemberId:"fe", targetMember:"陈志远", author:"human", text:"请前端继续接收 PM 输出", at:"2026-06-04T00:02:00.000Z" }],
      events:[{ at:"2026-06-04T00:00:00.000Z", type:"fallback_failed", member:"QA", model:"gemma26", status:"failed", detail:"timeout" }],
    }, "zh");

    assert.match(markdown, /# 综合报告/);
    assert.match(markdown, /触发: automation · neural-bridge/);
    assert.match(markdown, /## 任务/);
    assert.match(markdown, /## 调度计划/);
    assert.match(markdown, /意图: 分析项目/);
    assert.match(markdown, /子任务: 拆解目标 \/ 复核风险/);
    assert.match(markdown, /预期产物: 报告/);
    assert.match(markdown, /验收: 输出必须覆盖：报告/);
    assert.match(markdown, /里程碑与风险拆解/);
    assert.match(markdown, /## 模型调用/);
    assert.match(markdown, /Google Gemini\/Gemma/);
    assert.equal(normalizeWorkflowRecord({ modelUsage:{ external:true, localOnlyMode:true, models:[{ modelKey:"claude" }] } }).modelUsage.localOnlyMode, true);
    assert.match(markdown, /任务文本、相关上下文/);
    assert.match(markdown, /## 质量检查/);
    assert.match(markdown, /吴晓敏 · QA/);
    assert.match(markdown, /### v1 · 最终产物/);
    assert.match(markdown, /指纹/);
    assert.match(markdown, /林 美穂/);
    assert.match(markdown, /项目计划内容/);
    assert.match(markdown, /整合结论/);
    assert.match(markdown, /## Workboard/);
    assert.match(markdown, /摘要: 可执行 1 · 阻塞 0 · 失败 0/);
    assert.match(markdown, /\| 陈志远 · 前端工程师 \| queued \| ready \| 实现看板 \| UI \| ARIA 整合 \|/);
    assert.match(markdown, /Workboard 评论/);
    assert.match(markdown, /请前端继续接收 PM 输出/);
    assert.match(markdown, /执行事件/);
    assert.match(markdown, /fallback_failed/);
  });

  it("formats a single workflow artifact as markdown", () => {
    const markdown = formatWorkflowArtifactMarkdown({
      title:"综合报告",
      task:"分析项目",
      status:"done",
      modelUsage:{
        external:true,
        providers:["Google Gemini/Gemma"],
        models:[{ modelKey:"gemma26", actualModel:"gemma-4-26b-a4b-it", provider:"Google Gemini/Gemma", external:true }],
      },
      artifacts:[
        { title:"最终产物", kind:"整合报告", version:2, hash:"a-test", content:"整合结论" },
      ],
    }, 0, "zh");

    assert.match(markdown, /^# 最终产物/);
    assert.match(markdown, /版本: v2/);
    assert.match(markdown, /指纹: a-test/);
    assert.match(markdown, /来源工作流: 综合报告/);
    assert.match(markdown, /## 生命周期/);
    assert.match(markdown, /已完成: complete/);
    assert.match(markdown, /## 模型与外发披露/);
    assert.match(markdown, /任务文本、相关上下文/);
    assert.match(markdown, /## 产物内容/);
    assert.match(markdown, /整合结论/);
  });

  it("formats a workflow audit package with permissions and evidence", () => {
    const markdown = formatWorkflowAuditMarkdown({
      title:"生产任务",
      task:"部署并验证",
      source:"aria-workflow",
      status:"done",
      members:[
        { name:"陈志远", title:"前端工程师", model:"codex", status:"complete" },
        { name:"吴晓敏", title:"QA", model:"gemma26", status:"complete" },
      ],
      modelUsage:{
        external:true,
        localOnlyMode:false,
        providers:["Google Gemini/Gemma"],
        models:[{ modelKey:"gemma26", actualModel:"gemma-4-26b-a4b-it", provider:"Google Gemini/Gemma", external:true }],
      },
      quality:{ complete:true, missingMembers:[] },
      artifacts:[{ title:"部署报告", kind:"审计报告", hash:"a-test", content:"已完成" }],
      events:[
        { at:"2026-06-04T01:00:00.000Z", type:"auto_reassignment", member:"吴晓敏", model:"claude -> gemma26", status:"running", detail:"claude busy" },
        { at:"2026-06-04T01:02:00.000Z", type:"fallback_failed", member:"吴晓敏", model:"gemma26", status:"failed", detail:"timeout" },
      ],
    }, "zh");

    assert.match(markdown, /^# 工作流审计: 生产任务/);
    assert.match(markdown, /Local-only: no/);
    assert.match(markdown, /外发模型: yes/);
    assert.match(markdown, /## 生命周期/);
    assert.match(markdown, /已完成: complete/);
    assert.match(markdown, /## 权限与工具调用/);
    assert.match(markdown, /## 执行事件/);
    assert.match(markdown, /auto_reassignment/);
    assert.match(markdown, /claude busy/);
    assert.match(markdown, /### 模型执行路径/);
    assert.match(markdown, /吴晓敏: claude -> gemma26 · auto_reassignment · running/);
    assert.match(markdown, /## 恢复建议/);
    assert.match(markdown, /重试或改派该成员: 吴晓敏 · timeout/);
    assert.match(markdown, /模型网关/);
    assert.match(markdown, /## 质量闸门/);
    assert.match(markdown, /成员成果完整: yes/);
    assert.match(markdown, /陈志远 · 前端工程师 · codex · complete/);
    assert.match(markdown, /v1 · 部署报告 · 审计报告 · a-test/);
  });

  it("formats waiting-confirmation records with their planning evidence", () => {
    const markdown = formatWorkflowRecordMarkdown({
      title:"部署确认",
      task:"部署生产版本",
      status:"waiting_confirmation",
      source:"aria-workflow",
      members:[{ name:"陈志远", title:"前端工程师", model:"codex", status:"queued" }],
      plan:{
        strategy:"ARIA 自动调度",
        protocol:{ intent:"部署生产版本", task_type:"development", priority:"high", subtasks:["构建"], expected_outputs:["部署验证"], risks:["生产回归"], needs_user_confirmation:true },
        steps:[{ order:1, member:"陈志远", title:"前端工程师", model:"codex", subtask:"构建", output:"部署包", acceptanceCriteria:"构建通过" }],
      },
    }, "zh");

    assert.match(markdown, /waiting_confirmation/);
    assert.match(markdown, /部署生产版本/);
    assert.match(markdown, /子任务: 构建/);
    assert.match(markdown, /风险: 生产回归/);
  });

  it("builds a continuation prompt from prior workflow evidence", () => {
    const prompt = buildWorkflowContinuationPrompt({
      title: "综合报告",
      task: "分析项目",
      results: [{ member: "林 美穂", title: "PM", text: "项目计划内容很长，需要继续拆分里程碑。" }],
      artifacts: [{ title: "最终产物", content: "整合结论：先做工作流继续能力。" }],
    }, "zh");

    assert.match(prompt, /不要重新从零开始/);
    assert.match(prompt, /分析项目/);
    assert.match(prompt, /整合结论/);
    assert.match(prompt, /林 美穂 · PM/);
    assert.match(prompt, /调度哪些成员/);
  });

  it("builds a rerun prompt that preserves the objective but requests fresh dispatch", () => {
    const prompt = buildWorkflowRerunPrompt({
      title: "综合报告",
      task: "分析项目",
      plan: { strategy:"ARIA 自动调度 · 先产品后工程" },
      results: [{ member: "林 美穂", title: "PM", text: "项目计划内容" }],
    }, "zh");

    assert.match(prompt, /复跑以下历史工作流/);
    assert.match(prompt, /分析项目/);
    assert.match(prompt, /先产品后工程/);
    assert.match(prompt, /启动新的 ARIA 调度/);
    assert.match(prompt, /林 美穂 · PM/);
  });

  it("builds an artifact revision prompt for the next version", () => {
    const prompt = buildWorkflowArtifactRevisionPrompt({
      title:"综合报告",
      task:"分析项目",
      results:[{ member:"林 美穂", title:"PM", text:"范围和里程碑证据" }],
      artifacts:[
        { title:"最终产物", kind:"整合报告", version:2, hash:"a-v2", content:"v2 内容" },
      ],
    }, 0, "zh");

    assert.match(prompt, /生成下一版本/);
    assert.match(prompt, /原工作流: 综合报告/);
    assert.match(prompt, /分析项目/);
    assert.match(prompt, /来源版本: v2 · 最终产物/);
    assert.match(prompt, /目标版本: v3/);
    assert.match(prompt, /a-v2/);
    assert.match(prompt, /v2 内容/);
    assert.match(prompt, /林 美穂 · PM/);
    assert.match(prompt, /v3 完整产物/);
  });

  it("builds a recovery prompt for failed workflow records", () => {
    const prompt = buildWorkflowRecoveryPrompt({
      title:"失败任务",
      task:"生成上线方案",
      status:"failed",
      error:"CTO 调用失败",
      members:[
        { name:"林 美穂", title:"PM", model:"gemma26", status:"complete" },
        { name:"Alex Chen", title:"CTO", model:"claude", status:"failed", error:"claude busy" },
      ],
      results:[{ member:"林 美穂", title:"PM", text:"已完成里程碑拆解" }],
      artifacts:[{ title:"旧版产物", content:"旧版上线方案" }],
    }, "zh");

    assert.match(prompt, /恢复以下失败/);
    assert.match(prompt, /生成上线方案/);
    assert.match(prompt, /CTO 调用失败/);
    assert.match(prompt, /Alex Chen · CTO/);
    assert.match(prompt, /claude busy/);
    assert.match(prompt, /旧版上线方案/);
    assert.match(prompt, /不要覆盖旧版本/);
  });

  it("builds a recovery prompt for a specific execution event", () => {
    const prompt = buildWorkflowEventRecoveryPrompt({
      title:"部分失败",
      task:"上线自动化工作流",
      members:[
        { name:"林 美穂", title:"PM", status:"complete" },
        { name:"吴晓敏", title:"QA", status:"failed" },
      ],
      results:[{ member:"林 美穂", title:"PM", text:"已完成里程碑拆解" }],
      artifacts:[{ title:"旧版产物", content:"旧版上线方案" }],
      events:[
        { type:"auto_reassignment", member:"吴晓敏", model:"claude -> gemma26", status:"running", detail:"claude busy" },
        { type:"fallback_failed", member:"吴晓敏", model:"gemma26", status:"failed", detail:"timeout" },
      ],
    }, 1, "zh");

    assert.match(prompt, /按以下执行事件恢复/);
    assert.match(prompt, /重试或改派该成员/);
    assert.match(prompt, /吴晓敏/);
    assert.match(prompt, /timeout/);
    assert.match(prompt, /旧版上线方案/);
  });

  it("builds a batch recovery prompt for records needing attention", () => {
    const prompt = buildWorkflowAttentionRecoveryPrompt([
      { id:"ok", title:"完成记录", status:"done", task:"已完成" },
      { id:"failed", title:"失败记录", status:"failed", task:"修复失败", members:[{ name:"Codex", title:"开发", status:"failed" }], error:"构建失败" },
      { id:"approval", title:"确认记录", status:"waiting_confirmation", task:"需要确认" },
      { id:"codex", title:"Codex 记录", status:"done", task:"投递开发", members:[{ name:"Codex", title:"开发", model:"codex" }] },
    ], "zh");

    assert.match(prompt, /批量恢复/);
    assert.match(prompt, /失败记录/);
    assert.match(prompt, /确认记录/);
    assert.match(prompt, /Codex 记录/);
    assert.doesNotMatch(prompt, /完成记录/);
    assert.match(prompt, /工具权限风险/);
    assert.match(prompt, /toolRisks: .*Codex\/GitHub 投递 · needs_admin · admin/);
    assert.match(prompt, /Codex · 开发/);
  });

  it("builds an approved knowledge payload from a workflow record", () => {
    const payload = buildWorkflowKnowledgePayload({
      id: "wf-1",
      title: "综合报告",
      task: "分析项目",
      source: "aria-workflow",
      members:[{ id:"pm", name:"林 美穂", title:"PM", model:"gemma26", status:"complete" }],
      plan: {
        strategy:"ARIA 自动调度",
        protocol:{ intent:"分析项目", task_type:"product", priority:"high" },
        steps:[{ order:1, member:"林 美穂", title:"PM", model:"gemma26", purpose:"项目拆解" }],
      },
      modelUsage:{
        external:true,
        providers:["Google Gemini/Gemma"],
        models:[{ modelKey:"gemma26", actualModel:"gemma-4-26b-a4b-it", provider:"Google Gemini/Gemma", external:true }],
      },
      quality:{ complete:true, missingMembers:[] },
      results: [{ member: "林 美穂", title: "PM", text: "项目计划内容" }],
      artifacts: [{ title: "最终产物", content: "整合结论" }],
    }, "zh");

    assert.equal(payload.document.source, "workflow-archive:aria-workflow");
    assert.equal(payload.document.status, "approved");
    assert.match(payload.document.title, /工作流产物/);
    assert.match(payload.document.text, /## 调度计划/);
    assert.match(payload.document.text, /## 模型调用/);
    assert.match(payload.document.text, /## 成员成果/);
    assert.equal(payload.memory.status, "approved");
    assert.equal(payload.memory.metadata.approvalState, "approved");
    assert.equal(payload.memory.metadata.documentState, "approved");
    assert.equal(payload.memory.metadata.workflowRecordId, "wf-1");
    assert.equal(payload.memory.metadata.sourceType, "workflow_record");
    assert.equal(payload.memory.metadata.ingestAction, "workflow_record_approved");
    assert.equal(payload.memory.metadata.ingestRequiresReview, false);
    assert.equal(payload.memory.metadata.requiresApproval, false);
    assert.match(payload.memory.metadata.approvalSummary, /工作流记录/);
    assert.match(payload.memory.metadata.approvalSummary, /记忆 approved/);
    assert.match(payload.memory.metadata.approvalSummary, /成员 1/);
    assert.equal(payload.memory.metadata.status, "done");
    assert.equal(payload.memory.metadata.taskType, "product");
    assert.equal(payload.memory.metadata.priority, "high");
    assert.equal(payload.memory.metadata.qualityComplete, true);
    assert.deepEqual(payload.memory.metadata.members, ["林 美穂 · PM"]);
    assert.equal(payload.memory.metadata.artifactVersions[0].version, 1);
    assert.match(payload.memory.metadata.artifactVersions[0].hash, /^a-/);
    assert.match(payload.memory.content, /taskType: product/);
    assert.match(payload.memory.content, /qualityComplete: yes/);
    assert.match(payload.memory.content, /整合结论/);
  });

  it("builds a candidate knowledge payload for manual approval", () => {
    const payload = buildWorkflowKnowledgePayload({
      id:"wf-candidate",
      title:"候选报告",
      task:"分析项目",
      source:"aria-workflow",
      members:[{ id:"pm", name:"林 美穂", title:"PM", model:"gemma26", status:"complete" }],
      artifacts:[{ title:"最终产物", content:"候选结论" }],
    }, "zh", { memoryStatus:"candidate", documentStatus:"candidate" });

    assert.equal(payload.document.status, "candidate");
    assert.equal(payload.memory.status, "candidate");
    assert.equal(payload.memory.metadata.approvalState, "candidate");
    assert.equal(payload.memory.metadata.documentState, "candidate");
    assert.equal(payload.memory.metadata.requiresApproval, true);
    assert.equal(payload.memory.metadata.ingestAction, "workflow_record_candidate");
    assert.equal(payload.memory.metadata.ingestRequiresReview, true);
    assert.match(payload.memory.metadata.approvalSummary, /工作流记录/);
    assert.match(payload.memory.metadata.approvalSummary, /记忆 candidate/);
    assert.match(payload.memory.metadata.approvalSummary, /文档 candidate/);
    assert.equal(payload.memory.metadata.workflowRecordId, "wf-candidate");
  });

  it("builds a single artifact knowledge payload as candidate by default", () => {
    const payload = buildWorkflowArtifactKnowledgePayload({
      id:"wf-artifact",
      title:"综合报告",
      task:"分析项目",
      source:"aria-workflow",
      status:"done",
      artifacts:[
        { title:"最终产物", version:2, hash:"a-v2", content:"第二版结论" },
        { title:"最终产物", version:3, hash:"a-v3", content:"第三版结论" },
      ],
    }, 1, "zh");

    assert.equal(payload.document.status, "candidate");
    assert.equal(payload.memory.status, "candidate");
    assert.equal(payload.document.source, "workflow-artifact:wf-artifact:a-v3");
    assert.match(payload.document.title, /工作流产物版本/);
    assert.match(payload.document.text, /artifactVersion: v3/);
    assert.match(payload.document.text, /previousArtifactHash: a-v2/);
    assert.match(payload.document.text, /nextVersion: v4/);
    assert.match(payload.document.text, /第三版结论/);
    assert.equal(payload.memory.metadata.artifactVersion, 3);
    assert.equal(payload.memory.metadata.artifactHash, "a-v3");
    assert.equal(payload.memory.metadata.previousArtifactHash, "a-v2");
    assert.equal(payload.memory.metadata.nextVersion, 4);
    assert.equal(payload.memory.metadata.workflowRecordId, "wf-artifact");
    assert.equal(payload.memory.metadata.sourceType, "workflow_artifact_version");
    assert.equal(payload.memory.metadata.ingestAction, "artifact_version_candidate");
    assert.equal(payload.memory.metadata.ingestRequiresReview, true);
    assert.equal(payload.memory.metadata.requiresApproval, true);
    assert.match(payload.memory.metadata.approvalSummary, /产物版本 v3/);
    assert.match(payload.memory.metadata.approvalSummary, /a-v3/);
    assert.match(payload.memory.metadata.approvalSummary, /记忆 candidate/);
  });

  it("builds an approved artifact knowledge payload for direct indexing", () => {
    const payload = buildWorkflowArtifactKnowledgePayload({
      id:"wf-approved-artifact",
      title:"上线报告",
      task:"整理最终产物",
      source:"aria-workflow",
      status:"done",
      artifacts:[{ title:"上线产物", version:2, hash:"approved-v2", content:"可直接复用的上线结论" }],
    }, 0, "zh", { memoryStatus:"approved", documentStatus:"approved" });

    assert.equal(payload.document.status, "approved");
    assert.equal(payload.memory.status, "approved");
    assert.equal(payload.memory.metadata.approvalState, "approved");
    assert.equal(payload.memory.metadata.documentState, "approved");
    assert.equal(payload.memory.metadata.sourceType, "workflow_artifact_version");
    assert.equal(payload.memory.metadata.artifactHash, "approved-v2");
    assert.equal(payload.memory.metadata.ingestAction, "artifact_version_approved");
    assert.equal(payload.memory.metadata.ingestRequiresReview, false);
    assert.equal(payload.memory.metadata.requiresApproval, false);
    assert.match(payload.memory.metadata.approvalSummary, /产物版本 v2/);
    assert.match(payload.memory.metadata.approvalSummary, /记忆 approved/);
  });

  it("builds compact workflow details for archive expansion", () => {
    const details = buildWorkflowRecordDetails({
      title:"综合报告",
      task:"分析项目",
      source:"aria-workflow",
      members:[{ id:"pm", name:"林 美穂", title:"PM", model:"gemma26", status:"complete" }, { id:"fe", name:"陈志远", title:"前端工程师", model:"codex", status:"queued" }],
      plan:{
        strategy:"ARIA 自动调度",
        protocol:{ intent:"分析项目", task_type:"product", priority:"high", expected_outputs:["报告"], risks:["范围不清"] },
        steps:[
          { order:1, memberId:"pm", member:"林 美穂", title:"PM", model:"gemma26", purpose:"项目拆解", output:"PRD" },
          { order:2, memberId:"fe", member:"陈志远", title:"前端工程师", model:"codex", purpose:"实现界面", dependencies:["pm"], output:"UI" },
        ],
      },
      modelUsage:{
        external:true,
        providers:["Google Gemini/Gemma"],
        models:[{ modelKey:"gemma26", actualModel:"gemma-4-26b-a4b-it", provider:"Google Gemini/Gemma", external:true }],
      },
      quality:{ complete:false, missingMembers:[{ id:"qa", name:"吴晓敏", title:"QA" }] },
      events:[
        { type:"auto_reassignment", member:"吴晓敏", model:"claude -> gemma26", status:"running", detail:"busy" },
        { type:"fallback_failed", member:"吴晓敏", model:"gemma26", status:"failed", detail:"timeout" },
        { type:"manual_confirmation", member:"陈志远", model:"codex", status:"failed", detail:"admin token required" },
      ],
      comments:[{ targetMemberId:"fe", targetMember:"陈志远", author:"human", text:"继续接 QA 结果", at:"2026-06-04T00:02:00.000Z" }],
      artifacts:[{ title:"最终产物", kind:"整合报告", content:"整合结论" }],
    }, "zh");

    assert.ok(details.overview.some(item => item.label === "状态"));
    assert.equal(details.plan.steps[0], "1. 林 美穂 · PM");
    assert.equal(details.plan.protocol.priority, "high");
    assert.equal(details.quality.complete, false);
    assert.match(details.modelUsage.lines[0], /Google Gemini/);
    assert.match(details.modelUsage.lines[0], /gemma26 -> gemma-4-26b-a4b-it/);
    assert.match(details.modelUsage.disclosure.join(" "), /任务文本/);
    assert.match(details.modelUsage.routeLines.join(" "), /陈志远 · 前端工程师: codex/);
    assert.match(details.modelUsage.routeLines.join(" "), /claude -> gemma26/);
    assert.equal(details.workboard.summary.ready, 1);
    assert.equal(details.workboard.cards[0].title, "林 美穂 · PM");
    assert.equal(details.workboard.cards[1].member, "陈志远");
    assert.equal(details.workboard.cards[1].role, "前端工程师");
    assert.equal(details.workboard.cards[1].dependencyState, "ready");
    assert.equal(details.workboard.cards[0].handoffTo, "陈志远 · 前端工程师");
    assert.equal(details.events[0].title, "auto_reassignment · 吴晓敏");
    assert.match(details.events[0].detail, /busy/);
    assert.equal(details.recoveryActions.length, 3);
    assert.equal(details.recoveryActions.find(item => item.type === "retry_or_reassign").member, "吴晓敏");
    assert.match(details.recoveryActions.find(item => item.type === "manual_confirmation").label, /人工确认/);
    assert.equal(details.toolCalls.needsAttention, true);
    assert.equal(details.comments[0].title, "human · 陈志远");
    assert.equal(details.comments[0].detail, "继续接 QA 结果");
    assert.equal(details.toolCalls.entries.find(item => item.id === "codex-dispatch").status, "needs_admin");
    assert.match(details.toolCalls.entries.find(item => item.id === "codex-dispatch").detail, /管理员 token/);
    assert.match(details.artifacts[0].title, /^v1/);
    assert.match(details.artifacts[0].meta, /^整合报告 · a-/);
    assert.equal(details.artifacts[0].nextVersion, 2);
  });

  it("archives a workflow record snapshot without losing evidence", () => {
    const archived = archiveWorkflowRecordSnapshot({
      id:"wf-archive",
      title:"综合报告",
      task:"分析项目",
      status:"done",
      members:[{ name:"林 美穂", title:"PM", status:"complete" }],
      results:[{ member:"林 美穂", title:"PM", text:"项目计划内容" }],
      artifacts:[{ title:"最终产物", content:"整合结论" }],
      comments:[{ targetMemberId:"pm", targetMember:"林 美穂", author:"human", text:"归档前确认", at:"2026-06-04T00:03:00.000Z" }],
    }, "2026-06-03T20:30:00.000Z");

    assert.equal(archived.status, "archived");
    assert.equal(archived.updatedAt, "2026-06-03T20:30:00.000Z");
    assert.equal(archived.members[0].name, "林 美穂");
    assert.equal(archived.results[0].text, "项目计划内容");
    assert.equal(archived.artifacts[0].content, "整合结论");
    assert.equal(archived.comments[0].text, "归档前确认");
    assert.match(formatWorkflowRecordMarkdown(archived, "zh"), /archived/);
  });

  it("preserves partial failure evidence for recovery", () => {
    const markdown = formatWorkflowRecordMarkdown({
      id:"partial",
      status:"partial_failed",
      title:"部分失败",
      members:[
        { id:"pm", name:"林 美穂", title:"PM", model:"claude", status:"complete" },
        { id:"qa", name:"吴晓敏", title:"QA", model:"gemma26", status:"failed", error:"fallback timeout" },
      ],
    }, "zh");

    assert.match(markdown, /partial_failed/);
    assert.match(markdown, /fallback timeout/);
    assert.deepEqual(filterWorkflowRecordsByStatus([{ id:"partial", status:"partial_failed" }], "needs_attention").map(item => item.id), ["partial"]);
  });

  it("filters workflow records by normalized status", () => {
    const records = [
      { id:"done", status:"done", title:"完成" },
      { id:"partial", status:"partial_failed", title:"部分失败" },
      { id:"failed", status:"failed", title:"失败" },
      { id:"approval", status:"waiting_confirmation", title:"待确认" },
      { id:"codex", status:"done", title:"Codex", members:[{ name:"Codex", title:"开发", model:"codex" }] },
      { id:"archived", status:"archived", title:"归档" },
    ];

    assert.equal(filterWorkflowRecordsByStatus(records, "all").length, 6);
    assert.deepEqual(filterWorkflowRecordsByStatus(records, "failed").map(item => item.id), ["failed"]);
    assert.deepEqual(filterWorkflowRecordsByStatus(records, "partial_failed").map(item => item.id), ["partial"]);
    assert.deepEqual(filterWorkflowRecordsByStatus(records, "archived").map(item => item.id), ["archived"]);
    assert.deepEqual(filterWorkflowRecordsByStatus(records, "needs_attention").map(item => item.id), ["partial", "failed", "approval", "codex"]);
  });

  it("generates stable artifact content fingerprints", () => {
    assert.equal(artifactContentHash("same output"), artifactContentHash("same output"));
    assert.notEqual(artifactContentHash("same output"), artifactContentHash("different output"));
  });
});
