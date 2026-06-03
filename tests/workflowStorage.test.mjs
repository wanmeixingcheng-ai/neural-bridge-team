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
        protocol:{
          intent:"恢复工作流状态",
          task_type:"development",
          priority:"high",
          required_members:["aria", "fe"],
          subtasks:["修复恢复字段"],
          expected_outputs:["完整任务队列"],
          risks:["刷新后丢失上下文"],
        },
        steps:Array.from({ length:30 }, (_, index) => ({
          order:index + 1,
          memberId:`member-${index}`,
          member:"m".repeat(200),
          title:"t".repeat(300),
          model:"gemma31",
          purpose:"purpose".repeat(100),
          subtask:"subtask".repeat(120),
          input:"input".repeat(120),
          output:"output".repeat(120),
          deadline:"本轮工作流内完成",
          dependencies:Array.from({ length:12 }, (_, dep) => `dependency-${dep}`),
          acceptanceCriteria:"accept".repeat(120),
        })),
      },
      modelUsage:{
        external:true,
        providers:["Claude / Anthropic", "Google Gemini/Gemma"],
        models:Array.from({ length:20 }, (_, index) => ({
          modelKey:`model-${index}`,
          provider:"p".repeat(300),
          external:index % 2 === 0,
        })),
      },
      members: [{ id: "aria", name: "ARIA", summary: "x".repeat(3000) }],
      quality:{ complete:false, missingMembers:Array.from({ length:30 }, (_, index) => ({ id:`m-${index}`, name:"n".repeat(300), title:"t".repeat(300) })) },
      artifacts: [{ title: "产物", content: "y".repeat(12000) }],
      progress: { done: 1, total: 1 },
    }, "zh", storage);

    const raw = storage.getItem(WORKFLOW_STATE_KEY);
    assert.ok(raw);
    const restored = loadWorkflowState("zh", storage);
    assert.equal(restored.mode, "done");
    assert.ok(restored.task.length < 4200);
    assert.equal(restored.plan.steps.length, 24);
    assert.equal(restored.plan.protocol.task_type, "development");
    assert.equal(restored.plan.protocol.priority, "high");
    assert.deepEqual(restored.plan.protocol.required_members, ["aria", "fe"]);
    assert.ok(restored.plan.strategy.length < 360);
    assert.ok(restored.plan.steps[0].purpose.length < 320);
    assert.ok(restored.plan.steps[0].subtask.length < 540);
    assert.ok(restored.plan.steps[0].input.length < 540);
    assert.ok(restored.plan.steps[0].output.length < 540);
    assert.equal(restored.plan.steps[0].deadline, "本轮工作流内完成");
    assert.equal(restored.plan.steps[0].dependencies.length, 8);
    assert.ok(restored.plan.steps[0].acceptanceCriteria.length < 540);
    assert.equal(restored.modelUsage.models.length, 12);
    assert.equal(restored.modelUsage.external, true);
    assert.ok(restored.modelUsage.models[0].provider.length <= 120);
    assert.equal(restored.quality.complete, false);
    assert.equal(restored.quality.missingMembers.length, 24);
    assert.ok(restored.quality.missingMembers[0].name.length <= 120);
    assert.equal(restored.artifacts[0].version, 1);
    assert.match(restored.artifacts[0].hash, /^a-/);
    assert.ok(restored.members[0].summary.length < 1800);
    assert.ok(restored.artifacts[0].content.length < 8200);
  });
});
