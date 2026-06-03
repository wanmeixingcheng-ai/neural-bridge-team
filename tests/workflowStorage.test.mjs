import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { WORKFLOW_STATE_KEY, loadWorkflowState, normalizeWorkflowState, saveWorkflowState } from "../lib/workflowStorage.mjs";

function memoryStorage() {
  const data = new Map();
  return {
    getItem: key => data.get(key) || null,
    setItem: (key, value) => data.set(key, value),
    removeItem: key => data.delete(key),
  };
}

describe("workflowStorage", () => {
  it("normalizes invalid workflow state to an empty state", () => {
    const state = normalizeWorkflowState(null, "zh");
    assert.equal(state.mode, "idle");
    assert.deepEqual(state.members, []);
  });

  it("persists only bounded workflow state locally", () => {
    const storage = memoryStorage();
    saveWorkflowState({
      mode: "done",
      title: "任务",
      task: "z".repeat(6000),
      plan: {
        mode:"auto",
        strategy:"s".repeat(1000),
        task:"p".repeat(1000),
        steps:Array.from({ length:30 }, (_, index) => ({
          order:index + 1,
          memberId:`member-${index}`,
          member:"m".repeat(200),
          title:"t".repeat(300),
          model:"gemma31",
          purpose:"purpose".repeat(100),
        })),
      },
      members: [{ id: "aria", name: "ARIA", summary: "x".repeat(3000) }],
      artifacts: [{ title: "产物", content: "y".repeat(12000) }],
      progress: { done: 1, total: 1 },
    }, "zh", storage);

    const raw = storage.getItem(WORKFLOW_STATE_KEY);
    assert.ok(raw);
    const restored = loadWorkflowState("zh", storage);
    assert.equal(restored.mode, "done");
    assert.ok(restored.task.length < 4200);
    assert.equal(restored.plan.steps.length, 24);
    assert.ok(restored.plan.strategy.length < 360);
    assert.ok(restored.plan.steps[0].purpose.length < 320);
    assert.ok(restored.members[0].summary.length < 1800);
    assert.ok(restored.artifacts[0].content.length < 8200);
  });
});
