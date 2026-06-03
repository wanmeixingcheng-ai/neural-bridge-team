import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { normalizeWorkflowRecord } from "../lib/workflowArchive.mjs";

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
});
