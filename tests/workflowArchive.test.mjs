import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildWorkflowContinuationPrompt, formatWorkflowRecordMarkdown, normalizeWorkflowRecord } from "../lib/workflowArchive.mjs";

describe("workflowArchive", () => {
  it("normalizes a workflow run into a bounded record", () => {
    const record = normalizeWorkflowRecord({
      title: "x".repeat(200),
      task: "task",
      source: "aria-workflow",
      members: [{ id: "pm", name: "林 美穂", title: "PM", summary: "s".repeat(3000) }],
      results: [{ member: "林 美穂", title: "PM", text: "r".repeat(9000) }],
      artifacts: [{ title: "报告", content: "a".repeat(16000) }],
    });

    assert.equal(record.source, "aria-workflow");
    assert.equal(record.title.length, 120);
    assert.equal(record.members.length, 1);
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
      results: [{ member: "林 美穂", title: "PM", text: "项目计划内容" }],
      artifacts: [{ title: "最终产物", content: "整合结论" }],
    }, "zh");

    assert.match(markdown, /# 综合报告/);
    assert.match(markdown, /## 任务/);
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
});
