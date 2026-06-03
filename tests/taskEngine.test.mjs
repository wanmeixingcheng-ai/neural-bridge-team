import test from "node:test";
import assert from "node:assert/strict";

import {
  chooseWorkflowMembers,
  buildWorkflowRetryPrompt,
  emptyWorkflowState,
  extractPriorWorkflowResults,
  parsePlannerJson,
  planWorkflowMembersWithModel,
  recentConversationContext,
  wantsPriorIntegration,
} from "../lib/taskEngine.mjs";

const members = [
  { id:"aria", name:"ARIA", title:"总调度", layer:0, model:"claude", tags:["调度"] },
  { id:"cto", name:"山本 剛", title:"CTO", layer:1, model:"claude", tags:["架构"] },
  { id:"fe", name:"陈志远", title:"前端工程师", layer:2, model:"codex", tags:["React"] },
  { id:"qa", name:"吴晓敏", title:"QA", layer:2, model:"gemma26", tags:["测试"] },
  { id:"legal", name:"山田 律子", title:"法务", layer:3, model:"gemma26", tags:["合规"] },
];

test("empty workflow state is stable and localized", () => {
  assert.equal(emptyWorkflowState("zh").mode, "idle");
  assert.equal(emptyWorkflowState("en").title, "No task yet");
});

test("fallback planner can dispatch explicit groups", () => {
  assert.equal(chooseWorkflowMembers({ members }, "请让所有成员一起协作").length, members.length);
  assert.deepEqual(chooseWorkflowMembers({ members }, "开发组处理这个问题").map(item => item.id), ["fe", "qa"]);
  assert.deepEqual(chooseWorkflowMembers({ members }, "法务组审查隐私条款").map(item => item.id), ["legal"]);
});

test("prior workflow outputs are extracted for ARIA reintegration", () => {
  const results = extractPriorWorkflowResults([
    { role:"ai", text:"【林 美穂 · 项目经理 PM】\n项目计划" },
    { role:"ai", text:"【ARIA · 整合产物】\n最终报告" },
  ]);
  assert.equal(results.length, 1);
  assert.equal(results[0].member, "林 美穂");
  assert.equal(wantsPriorIntegration("不对，请整合前面成员成果"), true);
});

test("recent context preserves concise conversation history", () => {
  const context = recentConversationContext([
    { role:"user", text:"请分析文档" },
    { role:"ai", text:"【ARIA · 整合产物】\n报告" },
  ]);
  assert.match(context, /当前对话上下文/);
  assert.match(context, /用户：请分析文档/);
});

test("retry prompt preserves completed work and failed member context", () => {
  const prompt = buildWorkflowRetryPrompt({
    task:"生成上线计划",
    mode:"failed",
    phase:"QA · 请求失败",
    error:"model timeout",
    members:[
      { id:"pm", name:"林 美穂", title:"PM", status:"complete", summary:"已完成里程碑拆分" },
      { id:"qa", name:"吴晓敏", title:"QA", status:"failed", error:"测试模型超时" },
    ],
  }, "zh");

  assert.match(prompt, /不要从零开始/);
  assert.match(prompt, /生成上线计划/);
  assert.match(prompt, /吴晓敏/);
  assert.match(prompt, /测试模型超时/);
  assert.match(prompt, /已完成里程碑拆分/);
});

test("model planner JSON can be fenced and dispatch selected members", async () => {
  const workers = await planWorkflowMembersWithModel({
    router:{ model:"claude", systemPrompt:"router" },
    taskText:"请分析隐私条款",
    members,
    apiKeys:{},
    controls:{},
    language:"zh",
    signal:undefined,
    callModel:async () => "```json\n{\"target\":\"custom\",\"memberIds\":[\"legal\",\"cto\"],\"reason\":\"privacy\"}\n```",
  });
  assert.deepEqual(workers.map(item => item.id), ["legal", "cto"]);
  assert.deepEqual(parsePlannerJson("```json\n{\"target\":\"all\"}\n```"), { target:"all" });
});
