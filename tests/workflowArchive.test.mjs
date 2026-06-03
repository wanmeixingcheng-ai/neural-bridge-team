import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  artifactContentHash,
  buildWorkflowContinuationPrompt,
  buildWorkflowKnowledgePayload,
  buildWorkflowRecordDetails,
  buildWorkflowRecoveryPrompt,
  buildWorkflowRerunPrompt,
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
        protocol:{ intent:"分析项目", task_type:"product", priority:"high", expected_outputs:["报告"], risks:["范围不清"] },
        steps:[{ order:1, member:"林 美穂", title:"PM", model:"gemma26", purpose:"里程碑与风险拆解" }],
      },
      modelUsage:{
        external:true,
        providers:["Google Gemini/Gemma"],
        models:[{ modelKey:"gemma26", provider:"Google Gemini/Gemma", external:true }],
      },
      results: [{ member: "林 美穂", title: "PM", text: "项目计划内容" }],
      artifacts: [{ title: "最终产物", content: "整合结论" }],
    }, "zh");

    assert.match(markdown, /# 综合报告/);
    assert.match(markdown, /## 任务/);
    assert.match(markdown, /## 调度计划/);
    assert.match(markdown, /意图: 分析项目/);
    assert.match(markdown, /预期产物: 报告/);
    assert.match(markdown, /里程碑与风险拆解/);
    assert.match(markdown, /## 模型调用/);
    assert.match(markdown, /Google Gemini\/Gemma/);
    assert.match(markdown, /### v1 · 最终产物/);
    assert.match(markdown, /指纹/);
    assert.match(markdown, /林 美穂/);
    assert.match(markdown, /项目计划内容/);
    assert.match(markdown, /整合结论/);
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
      plan: {
        strategy:"ARIA 自动调度",
        steps:[{ order:1, member:"林 美穂", title:"PM", model:"gemma26", purpose:"项目拆解" }],
      },
      modelUsage:{
        external:true,
        providers:["Google Gemini/Gemma"],
        models:[{ modelKey:"gemma26", provider:"Google Gemini/Gemma", external:true }],
      },
      results: [{ member: "林 美穂", title: "PM", text: "项目计划内容" }],
      artifacts: [{ title: "最终产物", content: "整合结论" }],
    }, "zh");

    assert.equal(payload.document.source, "workflow-archive:aria-workflow");
    assert.match(payload.document.title, /工作流产物/);
    assert.match(payload.document.text, /## 调度计划/);
    assert.match(payload.document.text, /## 模型调用/);
    assert.match(payload.document.text, /## 成员成果/);
    assert.equal(payload.memory.status, "approved");
    assert.equal(payload.memory.metadata.workflowRecordId, "wf-1");
    assert.equal(payload.memory.metadata.artifactVersions[0].version, 1);
    assert.match(payload.memory.metadata.artifactVersions[0].hash, /^a-/);
    assert.match(payload.memory.content, /整合结论/);
  });

  it("builds compact workflow details for archive expansion", () => {
    const details = buildWorkflowRecordDetails({
      title:"综合报告",
      task:"分析项目",
      source:"aria-workflow",
      members:[{ name:"林 美穂", title:"PM", model:"gemma26" }],
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
      artifacts:[{ title:"最终产物", kind:"整合报告", content:"整合结论" }],
    }, "zh");

    assert.ok(details.overview.some(item => item.label === "状态"));
    assert.equal(details.plan.steps[0], "1. 林 美穂 · PM");
    assert.equal(details.plan.protocol.priority, "high");
    assert.match(details.modelUsage.lines[0], /Google Gemini/);
    assert.match(details.artifacts[0].title, /^v1/);
    assert.match(details.artifacts[0].meta, /^整合报告 · a-/);
  });

  it("generates stable artifact content fingerprints", () => {
    assert.equal(artifactContentHash("same output"), artifactContentHash("same output"));
    assert.notEqual(artifactContentHash("same output"), artifactContentHash("different output"));
  });
});
