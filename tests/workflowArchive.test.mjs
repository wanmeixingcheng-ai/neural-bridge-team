import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  archiveWorkflowRecordSnapshot,
  artifactContentHash,
  buildWorkflowArtifactKnowledgePayload,
  buildWorkflowArtifactRevisionPrompt,
  buildWorkflowContinuationPrompt,
  buildWorkflowKnowledgePayload,
  buildWorkflowRecordDetails,
  buildWorkflowRecoveryPrompt,
  buildWorkflowRerunPrompt,
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
    });

    assert.equal(record.source, "aria-workflow");
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
  });

  it("formats a full workflow record as markdown", () => {
    const markdown = formatWorkflowRecordMarkdown({
      title: "综合报告",
      task: "分析项目",
      source: "aria-workflow",
      members: [{ id: "pm", name: "林 美穂", title: "PM", model: "gemma26" }],
      plan: {
        strategy:"ARIA 自动调度 · 核心判断",
        protocol:{ intent:"分析项目", task_type:"product", priority:"high", subtasks:["拆解目标", "复核风险"], expected_outputs:["报告"], risks:["范围不清"] },
        steps:[{ order:1, member:"林 美穂", title:"PM", model:"gemma26", purpose:"里程碑与风险拆解", subtask:"拆解目标", output:"报告", acceptanceCriteria:"输出必须覆盖：报告" }],
      },
      modelUsage:{
        external:true,
        localOnlyMode:true,
        providers:["Google Gemini/Gemma"],
        models:[{ modelKey:"gemma26", provider:"Google Gemini/Gemma", external:true }],
      },
      quality:{ complete:false, missingMembers:[{ id:"qa", name:"吴晓敏", title:"QA" }] },
      results: [{ member: "林 美穂", title: "PM", text: "项目计划内容" }],
      artifacts: [{ title: "最终产物", content: "整合结论" }],
    }, "zh");

    assert.match(markdown, /# 综合报告/);
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
  });

  it("formats a single workflow artifact as markdown", () => {
    const markdown = formatWorkflowArtifactMarkdown({
      title:"综合报告",
      task:"分析项目",
      status:"done",
      artifacts:[
        { title:"最终产物", kind:"整合报告", version:2, hash:"a-test", content:"整合结论" },
      ],
    }, 0, "zh");

    assert.match(markdown, /^# 最终产物/);
    assert.match(markdown, /版本: v2/);
    assert.match(markdown, /指纹: a-test/);
    assert.match(markdown, /来源工作流: 综合报告/);
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
        models:[{ modelKey:"gemma26", provider:"Google Gemini/Gemma", external:true }],
      },
      quality:{ complete:true, missingMembers:[] },
      artifacts:[{ title:"部署报告", kind:"审计报告", hash:"a-test", content:"已完成" }],
    }, "zh");

    assert.match(markdown, /^# 工作流审计: 生产任务/);
    assert.match(markdown, /Local-only: no/);
    assert.match(markdown, /外发模型: yes/);
    assert.match(markdown, /## 权限与工具调用/);
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
    assert.match(prompt, /v2 · 最终产物/);
    assert.match(prompt, /a-v2/);
    assert.match(prompt, /v2 内容/);
    assert.match(prompt, /林 美穂 · PM/);
    assert.match(prompt, /新版完整产物/);
  });

  it("builds a recovery prompt for failed workflow records", () => {
    const prompt = buildWorkflowRecoveryPrompt({
      title:"失败任务",
      task:"生成上线方案",
      status:"failed",
      error:"CTO 调用失败",
      members:[
        { name:"林 美穂", title:"PM", model:"gemma26", status:"complete" },
        { name:"Alex Chen", title:"CTO", model:"claude", status:"failed" },
      ],
      results:[{ member:"林 美穂", title:"PM", text:"已完成里程碑拆解" }],
    }, "zh");

    assert.match(prompt, /恢复以下失败/);
    assert.match(prompt, /生成上线方案/);
    assert.match(prompt, /CTO 调用失败/);
    assert.match(prompt, /Alex Chen · CTO/);
    assert.match(prompt, /只重试失败或缺失部分/);
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
        models:[{ modelKey:"gemma26", provider:"Google Gemini/Gemma", external:true }],
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
    assert.equal(payload.memory.metadata.workflowRecordId, "wf-candidate");
  });

  it("builds a single artifact knowledge payload as candidate by default", () => {
    const payload = buildWorkflowArtifactKnowledgePayload({
      id:"wf-artifact",
      title:"综合报告",
      task:"分析项目",
      source:"aria-workflow",
      status:"done",
      artifacts:[{ title:"最终产物", version:3, hash:"a-v3", content:"第三版结论" }],
    }, 0, "zh");

    assert.equal(payload.document.status, "candidate");
    assert.equal(payload.memory.status, "candidate");
    assert.equal(payload.document.source, "workflow-artifact:wf-artifact:a-v3");
    assert.match(payload.document.title, /工作流产物版本/);
    assert.match(payload.document.text, /artifactVersion: v3/);
    assert.match(payload.document.text, /第三版结论/);
    assert.equal(payload.memory.metadata.artifactVersion, 3);
    assert.equal(payload.memory.metadata.artifactHash, "a-v3");
    assert.equal(payload.memory.metadata.workflowRecordId, "wf-artifact");
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
    assert.equal(payload.memory.metadata.artifactHash, "approved-v2");
  });

  it("builds compact workflow details for archive expansion", () => {
    const details = buildWorkflowRecordDetails({
      title:"综合报告",
      task:"分析项目",
      source:"aria-workflow",
      members:[{ name:"林 美穂", title:"PM", model:"gemma26" }, { name:"陈志远", title:"前端工程师", model:"codex" }],
      plan:{
        strategy:"ARIA 自动调度",
        protocol:{ intent:"分析项目", task_type:"product", priority:"high", expected_outputs:["报告"], risks:["范围不清"] },
        steps:[{ order:1, member:"林 美穂", title:"PM", model:"gemma26", purpose:"项目拆解" }],
      },
      modelUsage:{
        external:true,
        providers:["Google Gemini/Gemma"],
        models:[{ modelKey:"gemma26", provider:"Google Gemini/Gemma", external:true }],
      },
      quality:{ complete:false, missingMembers:[{ id:"qa", name:"吴晓敏", title:"QA" }] },
      artifacts:[{ title:"最终产物", kind:"整合报告", content:"整合结论" }],
    }, "zh");

    assert.ok(details.overview.some(item => item.label === "状态"));
    assert.equal(details.plan.steps[0], "1. 林 美穂 · PM");
    assert.equal(details.plan.protocol.priority, "high");
    assert.equal(details.quality.complete, false);
    assert.match(details.modelUsage.lines[0], /Google Gemini/);
    assert.match(details.modelUsage.disclosure.join(" "), /任务文本/);
    assert.equal(details.toolCalls.needsAttention, true);
    assert.equal(details.toolCalls.entries.find(item => item.id === "codex-dispatch").status, "needs_admin");
    assert.match(details.toolCalls.entries.find(item => item.id === "codex-dispatch").detail, /管理员 token/);
    assert.match(details.artifacts[0].title, /^v1/);
    assert.match(details.artifacts[0].meta, /^整合报告 · a-/);
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
    }, "2026-06-03T20:30:00.000Z");

    assert.equal(archived.status, "archived");
    assert.equal(archived.updatedAt, "2026-06-03T20:30:00.000Z");
    assert.equal(archived.members[0].name, "林 美穂");
    assert.equal(archived.results[0].text, "项目计划内容");
    assert.equal(archived.artifacts[0].content, "整合结论");
    assert.match(formatWorkflowRecordMarkdown(archived, "zh"), /archived/);
  });

  it("generates stable artifact content fingerprints", () => {
    assert.equal(artifactContentHash("same output"), artifactContentHash("same output"));
    assert.notEqual(artifactContentHash("same output"), artifactContentHash("different output"));
  });
});
