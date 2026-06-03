import test from "node:test";
import assert from "node:assert/strict";

import {
  chooseWorkflowMembers,
  buildWorkflowPlanEditPrompt,
  buildWorkflowRetryPrompt,
  buildWorkflowPlan,
  buildWorkflowConfirmationPrompt,
  emptyWorkflowState,
  extractPriorWorkflowResults,
  inferWorkflowTaskType,
  normalizeWorkflowProtocol,
  parsePlannerJson,
  plannerRequiredMemberIds,
  planWorkflowDispatchWithModel,
  planWorkflowMembersWithModel,
  recentConversationContext,
  wantsPriorIntegration,
  workflowQueueSummary,
  workflowRequiresConfirmation,
  workflowExternalDisclosureLines,
  workflowFailureReassignmentPlan,
  workflowAuditSummary,
  workflowLifecycleSteps,
  workflowPermissionChecklist,
  workflowOutputQaChecklist,
  workflowQualityCheck,
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
  assert.match(prompt, /建议改派/);
  assert.match(prompt, /gemma26/);
  assert.match(prompt, /已完成里程碑拆分/);
});

test("confirmation prompt resumes a reviewed high-risk workflow plan", () => {
  const prompt = buildWorkflowConfirmationPrompt({
    task:"部署生产版本",
    mode:"waiting_confirmation",
    modelUsage:{ external:true, providers:["Google Gemini/Gemma"], models:[{ modelKey:"gemma26", provider:"Google Gemini/Gemma", external:true }] },
    plan:{
      protocol:{ intent:"部署生产版本", task_type:"development", priority:"high", expected_outputs:["部署验证"], risks:["生产回归"] },
      steps:[
        { order:1, member:"陈志远", title:"前端工程师", model:"codex", subtask:"执行构建", output:"部署包", acceptanceCriteria:"构建通过" },
        { order:2, member:"吴晓敏", title:"QA", model:"gemma26", subtask:"验证生产站点", output:"验证结果", acceptanceCriteria:"返回 200" },
      ],
    },
  }, "zh");

  assert.match(prompt, /已确认继续执行/);
  assert.match(prompt, /部署生产版本/);
  assert.match(prompt, /陈志远 · 前端工程师/);
  assert.match(prompt, /执行构建/);
  assert.match(prompt, /部署验证/);
  assert.match(prompt, /生产回归/);
  assert.match(prompt, /Google Gemini\/Gemma/);
});

test("workflow plan explains dispatch order without changing selected workers", () => {
  const selected = chooseWorkflowMembers({ members }, "请开发并测试移动端布局");
  const plan = buildWorkflowPlan({
    taskText:"请开发并测试移动端布局",
    workers:selected,
    lang:"zh",
    protocol:{ subtasks:["修复移动端布局", "执行构建测试"], expected_outputs:["可部署修复", "测试结果"], priority:"high" },
  });

  assert.equal(plan.steps.length, selected.length);
  assert.equal(plan.steps[0].order, 1);
  assert.match(plan.strategy, /ARIA 自动调度/);
  assert.equal(plan.protocol.task_type, "development");
  assert.deepEqual(plan.protocol.required_members, selected.map(item => item.id));
  assert.equal(plan.steps[0].subtask, "修复移动端布局");
  assert.equal(plan.steps[0].output, "可部署修复");
  assert.equal(plan.steps[0].deadline, "本轮立即完成");
  assert.deepEqual(plan.steps[1].dependencies, [selected[0].id]);
  assert.match(plan.steps[0].acceptanceCriteria, /可部署修复/);
  assert.ok(plan.steps.some(step => step.memberId === "fe"));
});

test("workflow protocol normalizes ARIA planning fields", () => {
  const protocol = normalizeWorkflowProtocol({
    intent:"修复生产部署问题",
    task_type:"development",
    priority:"high",
    required_members:["aria", "cto", "fe"],
    subtasks:["定位失败", "修复并测试"],
    expected_outputs:["修复说明", "部署验证"],
    risks:["生产回归"],
    needs_user_confirmation:true,
  }, { taskText:"修复 Vercel 部署", workers:members });

  assert.equal(protocol.intent, "修复生产部署问题");
  assert.equal(protocol.task_type, "development");
  assert.equal(protocol.priority, "high");
  assert.equal(protocol.needs_user_confirmation, true);
  assert.deepEqual(protocol.required_members, ["aria", "cto", "fe"]);
  assert.equal(protocol.subtasks.length, 2);
  assert.equal(inferWorkflowTaskType("请研究产品定价和开发成本"), "mixed");
  assert.equal(workflowRequiresConfirmation("请部署到 Vercel"), true);
  assert.equal(workflowRequiresConfirmation("整理普通会议纪要"), false);
  assert.match(workflowExternalDisclosureLines({ external:true, providers:["Claude / Anthropic"], models:[{ modelKey:"claude", external:true }] }, "zh").join("\n"), /Claude \/ Anthropic/);
});

test("workflow plan edit prompt turns the current plan into an editable handoff", () => {
  const prompt = buildWorkflowPlanEditPrompt({
    task:"开发工作流记录详情",
    plan:{
      strategy:"ARIA 自动调度 · 执行落地",
      steps:[
        { order:1, member:"山本 剛", title:"CTO", model:"claude", purpose:"架构约束" },
        { order:2, member:"陈志远", title:"前端工程师", model:"codex", purpose:"界面实现" },
      ],
    },
  }, "zh");

  assert.match(prompt, /进行调整/);
  assert.match(prompt, /开发工作流记录详情/);
  assert.match(prompt, /ARIA 自动调度/);
  assert.match(prompt, /1\. 山本 剛/);
  assert.match(prompt, /增删成员/);
});

test("workflow queue summary tracks member execution states", () => {
  const queue = workflowQueueSummary([
    { id:"pm", name:"林 美穂", title:"PM", status:"complete" },
    { id:"qa", name:"吴晓敏", title:"QA", status:"working" },
    { id:"fe", name:"陈志远", title:"前端工程师", status:"queued" },
    { id:"audit", name:"佐藤 健", title:"安全审计", status:"failed" },
  ]);

  assert.equal(queue.total, 4);
  assert.equal(queue.complete, 1);
  assert.equal(queue.working, 1);
  assert.equal(queue.queued, 1);
  assert.equal(queue.failed, 1);
  assert.equal(queue.next.id, "qa");
});

test("workflow lifecycle steps expose the production task state machine", () => {
  const running = workflowLifecycleSteps("summarizing", "zh");
  assert.deepEqual(running.map(item => item.status), ["planning", "dispatched", "running", "waiting_confirmation", "done", "failed", "archived"]);
  assert.equal(running.find(item => item.status === "running").state, "current");
  assert.equal(running.find(item => item.status === "dispatched").state, "complete");
  assert.equal(workflowLifecycleSteps("done", "en").find(item => item.status === "done").state, "complete");
  assert.equal(workflowLifecycleSteps("failed", "zh").find(item => item.status === "failed").state, "current");
  assert.equal(workflowLifecycleSteps("archived", "zh").find(item => item.status === "archived").state, "complete");
});

test("workflow audit summary exposes external paths and control status", () => {
  const summary = workflowAuditSummary({
    mode:"waiting_confirmation",
    members:[{ id:"aria" }, { id:"qa" }],
    artifacts:[{ title:"报告" }],
    plan:{ protocol:{ needs_user_confirmation:true } },
    modelUsage:{
      external:true,
      providers:["Claude / Anthropic"],
      models:[{ modelKey:"claude", provider:"Claude / Anthropic", external:true }],
    },
    quality:{ complete:false, missingMembers:[{ id:"qa", name:"吴晓敏" }] },
  }, "zh");

  assert.equal(summary.external, true);
  assert.equal(summary.requiresConfirmation, true);
  assert.match(summary.lines.join("\n"), /Claude \/ Anthropic/);
  assert.match(summary.lines.join("\n"), /高风险确认: 需要/);
  assert.match(summary.lines.join("\n"), /成果检查: 有缺失/);
  assert.deepEqual(summary.models, ["claude · Claude / Anthropic"]);
});

test("workflow permission checklist flags risky production actions", () => {
  const checklist = workflowPermissionChecklist({
    task:"请部署到 Vercel 并投递 Codex",
    mode:"waiting_confirmation",
    members:[{ id:"fe", model:"codex" }],
    plan:{ protocol:{ needs_user_confirmation:true } },
    modelUsage:{ external:true, providers:["Google Gemini/Gemma"] },
  }, "zh");

  assert.equal(checklist.blocked, true);
  assert.equal(checklist.entries.find(item => item.id === "external-models").status, "needs_disclosure");
  assert.equal(checklist.entries.find(item => item.id === "high-risk-confirmation").status, "needs_confirmation");
  assert.equal(checklist.entries.find(item => item.id === "codex-dispatch").status, "admin_required");
  assert.equal(checklist.entries.find(item => item.id === "deployment").status, "admin_required");
  assert.equal(workflowPermissionChecklist({ task:"整理会议纪要", modelUsage:{ external:false } }, "zh").blocked, false);
});

test("workflow output QA checklist checks artifacts and member outputs", () => {
  const pass = workflowOutputQaChecklist({
    language:"zh",
    members:[{ status:"complete" }],
    artifacts:[{ content:"最终产物" }],
    modelUsage:{ models:[{ modelKey:"gemma26" }] },
    quality:{ complete:true, missingMembers:[] },
  }, "zh");
  assert.equal(pass.passed, true);

  const fail = workflowOutputQaChecklist({
    members:[{ status:"failed" }],
    artifacts:[],
    modelUsage:{ models:[] },
    quality:{ complete:false, missingMembers:[{ id:"qa" }] },
  }, "zh");
  assert.equal(fail.passed, false);
  assert.equal(fail.checks.find(item => item.id === "artifact-present").passed, false);
  assert.equal(fail.checks.find(item => item.id === "member-outputs").passed, false);
  assert.equal(fail.checks.find(item => item.id === "model-disclosure").passed, false);
});

test("workflow quality check flags missing member outputs", () => {
  const quality = workflowQualityCheck([
    { id:"pm", name:"林 美穂", title:"PM" },
    { id:"qa", name:"吴晓敏", title:"QA" },
  ], [
    { member:"林 美穂", title:"PM", text:"计划" },
  ]);

  assert.equal(quality.complete, false);
  assert.deepEqual(quality.missingMembers.map(item => item.id), ["qa"]);
  assert.equal(workflowQualityCheck([{ name:"林 美穂", title:"PM" }], [{ member:"林 美穂" }]).complete, true);
});

test("workflow failure reassignment plan routes failed members to fallbacks", () => {
  const plan = workflowFailureReassignmentPlan([
    { id:"audit", name:"孙建国", title:"开发审计", model:"claude", status:"failed", error:"busy" },
    { id:"fe", name:"陈志远", title:"前端工程师", model:"codex", status:"failed", error:"handoff failed" },
    { id:"qa", name:"吴晓敏", title:"QA", model:"gemma26", status:"complete" },
  ], "zh");

  assert.equal(plan.needed, true);
  assert.deepEqual(plan.actions.map(item => item.toModel), ["gemma26", "manual_confirmation"]);
  assert.equal(workflowFailureReassignmentPlan([{ id:"qa", status:"complete" }], "zh").needed, false);
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

test("model planner accepts the structured planning protocol member field", async () => {
  const workers = await planWorkflowMembersWithModel({
    router:{ model:"claude", systemPrompt:"router" },
    taskText:"请制定开发计划并检查风险",
    members,
    apiKeys:{},
    controls:{},
    language:"zh",
    signal:undefined,
    callModel:async () => JSON.stringify({
      target:"custom",
      intent:"开发计划和风险检查",
      task_type:"development",
      priority:"high",
      required_members:["aria", "cto", "fe", "qa"],
      subtasks:["拆分实现", "测试验证"],
      expected_outputs:["开发计划"],
      risks:["移动端回归"],
      needs_user_confirmation:false,
    }),
  });

  assert.deepEqual(workers.map(item => item.id), ["aria", "cto", "fe", "qa"]);
  assert.deepEqual(plannerRequiredMemberIds({ required_members:["fe"], memberIds:["qa"] }), ["fe"]);
});

test("model planner dispatch returns workers with normalized protocol", async () => {
  const dispatch = await planWorkflowDispatchWithModel({
    router:{ model:"claude", systemPrompt:"router" },
    taskText:"请修复移动端并部署",
    members,
    apiKeys:{},
    controls:{},
    language:"zh",
    signal:undefined,
    callModel:async () => JSON.stringify({
      target:"custom",
      intent:"修复移动端并部署",
      task_type:"development",
      priority:"high",
      required_members:["aria", "fe", "qa"],
      subtasks:["修复布局", "测试构建"],
      expected_outputs:["部署验证"],
      risks:["移动端回归"],
      needs_user_confirmation:false,
    }),
  });

  assert.deepEqual(dispatch.workers.map(item => item.id), ["aria", "fe", "qa"]);
  assert.equal(dispatch.protocol.intent, "修复移动端并部署");
  assert.equal(dispatch.protocol.priority, "high");
  assert.deepEqual(dispatch.protocol.expected_outputs, ["部署验证"]);
});
