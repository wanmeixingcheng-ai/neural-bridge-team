import test from "node:test";
import assert from "node:assert/strict";

import {
  buildWorkboardCardActionEvent,
  buildWorkboardCardActionPrompt,
  buildWorkboardCommentEvent,
  buildWorkboardExecutionPacket,
  buildWorkboardExecutionPacketEvent,
  buildWorkflowExecutionGateEvent,
  chooseWorkflowMembers,
  ensureExecutableWorkflowMembers,
  buildWorkflowPlanEditPrompt,
  buildWorkflowReassignmentPrompt,
  buildWorkflowRetryPrompt,
  buildWorkflowSkipPrompt,
  buildWorkflowResumePrompt,
  buildWorkflowPlan,
  buildWorkflowConfirmationPrompt,
  emptyWorkflowState,
  extractPriorWorkflowResults,
  inferWorkflowTaskType,
  normalizeWorkflowProtocol,
  parseAutomationDirective,
  parsePlannerJson,
  plannerRequiredMemberIds,
  planWorkflowDispatchWithModel,
  planWorkflowMembersWithModel,
  recentConversationContext,
  wantsPriorIntegration,
  workflowQueueSummary,
  workflowExecutionReadiness,
  workflowRequiresConfirmation,
  workflowExternalDisclosureLines,
  workflowFailureReassignmentPlan,
  workflowFallbackModelForMember,
  workflowAuditSummary,
  workflowLifecycleSteps,
  workflowPermissionChecklist,
  workflowOutputQaChecklist,
  workflowQualityCheck,
  workflowToolCallChecklist,
  workflowWorkboardCards,
  workflowWorkboardHandoffs,
  workflowWorkboardSummary,
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
  assert.deepEqual(emptyWorkflowState("zh").comments, []);
});

test("fallback planner can dispatch explicit groups", () => {
  assert.equal(chooseWorkflowMembers({ members }, "请让所有成员一起协作").length, members.length);
  assert.deepEqual(chooseWorkflowMembers({ members }, "开发组处理这个问题").map(item => item.id), ["fe", "qa"]);
  assert.deepEqual(chooseWorkflowMembers({ members }, "法务组审查隐私条款").map(item => item.id), ["legal"]);
});

test("forced workflow actions always resolve to executable members", () => {
  assert.deepEqual(
    ensureExecutableWorkflowMembers([{ id:"aria", name:"ARIA" }], members, "请开发并测试这个功能").map(item => item.id),
    ["cto", "fe", "qa"],
  );
  assert.deepEqual(
    ensureExecutableWorkflowMembers([], members, "请法务审查隐私条款").map(item => item.id),
    ["legal"],
  );
});

test("automation heartbeat directives become executable workflow tasks", () => {
  const directive = parseAutomationDirective(`<heartbeat>
    <automation_id>neural-bridge</automation_id>
    <current_time_iso>2026-06-04T10:34:49.708Z</current_time_iso>
    <instructions>
自动按阶段连续完成 Neural Bridge 项目的全部待办任务，不要从头重建。
每个阶段必须运行 npm run test 和 npm run build。
    </instructions>
  </heartbeat>`);

  assert.equal(directive.detected, true);
  assert.equal(directive.automationId, "neural-bridge");
  assert.match(directive.taskText, /自动按阶段连续完成 Neural Bridge/);
  assert.match(directive.taskText, /npm run test/);
  assert.doesNotMatch(directive.taskText, /<heartbeat>/);
  assert.match(directive.displayText, /自动化任务 neural-bridge/);
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

test("reassignment prompt asks ARIA to execute fallback routes only", () => {
  const prompt = buildWorkflowReassignmentPrompt({
    task:"生成上线计划",
    mode:"failed",
    error:"handoff failed",
    members:[
      { id:"pm", name:"林 美穂", title:"PM", status:"complete", summary:"已完成里程碑拆分" },
      { id:"audit", name:"孙建国", title:"开发审计", model:"claude", status:"failed", error:"busy" },
      { id:"fe", name:"陈志远", title:"前端工程师", model:"codex", status:"failed", error:"handoff failed" },
    ],
  }, "zh");

  assert.match(prompt, /按以下自动改派方案恢复/);
  assert.match(prompt, /claude -> gemma26/);
  assert.match(prompt, /codex -> manual_confirmation/);
  assert.match(prompt, /不要重复已完成成员工作/);
  assert.match(prompt, /已完成里程碑拆分/);
  assert.match(prompt, /只执行改派后的失败部分/);
});

test("skip prompt preserves completed work and asks ARIA to integrate gaps", () => {
  const prompt = buildWorkflowSkipPrompt({
    task:"生成上线计划",
    mode:"failed",
    members:[
      { id:"pm", name:"林 美穂", title:"PM", status:"complete", summary:"已完成里程碑拆分" },
      { id:"qa", name:"吴晓敏", title:"QA", status:"failed", error:"测试模型超时" },
      { id:"audit", name:"孙建国", title:"开发审计", status:"queued" },
    ],
  }, "zh");

  assert.match(prompt, /跳过以下未完成或失败成员/);
  assert.match(prompt, /吴晓敏 · QA/);
  assert.match(prompt, /孙建国 · 开发审计/);
  assert.match(prompt, /已完成里程碑拆分/);
  assert.match(prompt, /最终可交付产物/);
});

test("resume prompt keeps completed outputs and lists remaining queue", () => {
  const prompt = buildWorkflowResumePrompt({
    task:"生成上线计划",
    mode:"stopped",
    members:[
      { id:"pm", name:"林 美穂", title:"PM", status:"complete", summary:"已完成里程碑拆分" },
      { id:"qa", name:"吴晓敏", title:"QA", status:"queued", task:"执行回归测试" },
      { id:"audit", name:"孙建国", title:"开发审计", status:"failed", error:"模型繁忙" },
    ],
  }, "zh");

  assert.match(prompt, /继续以下被停止或未完成/);
  assert.match(prompt, /已完成里程碑拆分/);
  assert.match(prompt, /吴晓敏 · QA: queued · 执行回归测试/);
  assert.match(prompt, /孙建国 · 开发审计: failed · 模型繁忙/);
  assert.match(prompt, /不要丢弃已完成成果/);
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
  assert.equal(queue.remaining, 2);
  assert.equal(queue.needsAttention, true);
  assert.equal(queue.completionRate, 25);
  assert.equal(queue.nextAction, "retry_failed");
  assert.equal(queue.next.id, "qa");

  assert.equal(workflowQueueSummary([{ status:"working" }]).nextAction, "continue_queue");
  assert.equal(workflowQueueSummary([{ status:"complete" }]).nextAction, "ready_to_integrate");
  assert.equal(workflowQueueSummary([{ status:"stopped" }]).nextAction, "review_queue");
  assert.equal(workflowQueueSummary([]).nextAction, "idle");
});

test("workflow workboard cards expose dependencies, handoffs, and comments", () => {
  const cards = workflowWorkboardCards({
    task:"发布 Workboard",
    members:[
      { id:"pm", name:"林 美穂", title:"PM", status:"complete", summary:"需求已拆完" },
      { id:"fe", name:"陈志远", title:"前端工程师", status:"working", task:"实现看板" },
      { id:"qa", name:"吴晓敏", title:"QA", status:"queued" },
    ],
    plan:{
      steps:[
        { order:1, memberId:"pm", member:"林 美穂", title:"PM", subtask:"拆需求", input:"用户目标", output:"PRD", acceptanceCriteria:"范围清晰" },
        { order:2, memberId:"fe", member:"陈志远", title:"前端工程师", subtask:"实现看板", input:"PRD", output:"UI", dependencies:["pm"], acceptanceCriteria:"移动端不溢出" },
        { order:3, memberId:"qa", member:"吴晓敏", title:"QA", subtask:"验收 Workboard", input:"UI", output:"QA 报告", dependencies:["fe"], acceptanceCriteria:"关键状态清晰" },
      ],
    },
    comments:[
      { targetMemberId:"fe", author:"human", text:"注意手机端" },
    ],
  }, "zh");

  assert.equal(cards.length, 3);
  assert.equal(cards[0].progress, 100);
  assert.equal(cards[0].handoffTo, "陈志远 · 前端工程师");
  assert.deepEqual(cards[0].downstream, ["陈志远 · 前端工程师"]);
  assert.equal(cards[0].dependencyState, "none");
  assert.equal(cards[0].agentComment, "需求已拆完");
  assert.equal(cards[1].progress, 50);
  assert.deepEqual(cards[1].dependencies, ["pm"]);
  assert.equal(cards[1].dependencyState, "ready");
  assert.deepEqual(cards[1].blockedBy, []);
  assert.equal(cards[1].handoffTo, "吴晓敏 · QA");
  assert.equal(cards[1].comments[0].text, "注意手机端");
  assert.equal(cards[1].acceptanceCriteria, "移动端不溢出");
  assert.equal(cards[2].dependencyState, "blocked");
  assert.deepEqual(cards[2].blockedBy, ["陈志远"]);

  const summary = workflowWorkboardSummary(cards);
  assert.equal(summary.total, 3);
  assert.equal(summary.ready, 1);
  assert.equal(summary.blocked, 1);
  assert.equal(summary.working, 1);
  assert.equal(summary.completionRate, 33);
  assert.equal(summary.handoffReady, 1);
  assert.equal(summary.handoffBlocked, 1);
  assert.equal(summary.needsAttention, true);
  assert.equal(summary.nextAction, "monitor_working");
  assert.equal(summary.nextCard.member, "陈志远");
});

test("workflow workboard summary recommends the next production action", () => {
  assert.equal(workflowWorkboardSummary([]).nextAction, "idle");
  assert.equal(workflowWorkboardSummary([{ status:"failed", dependencyState:"ready" }]).nextAction, "retry_failed");
  assert.equal(workflowWorkboardSummary([{ status:"queued", dependencyState:"ready", member:"FE" }]).nextAction, "start_ready");
  assert.equal(workflowWorkboardSummary([{ status:"queued", dependencyState:"blocked", blockedBy:["PM"] }]).nextAction, "wait_dependencies");
  assert.equal(workflowWorkboardSummary([{ status:"complete", dependencyState:"none" }]).nextAction, "integrate");
});

test("workflow workboard handoffs summarize agent data flow", () => {
  const handoffs = workflowWorkboardHandoffs([
    { id:"pm", member:"林 美穂", title:"PM", status:"complete", dependencyState:"none", output:"PRD", downstream:["陈志远 · 前端工程师"] },
    { id:"fe", member:"陈志远", title:"前端工程师", status:"working", dependencyState:"ready", output:"UI", handoffTo:"吴晓敏 · QA" },
    { id:"qa", member:"吴晓敏", title:"QA", status:"queued", dependencyState:"blocked", blockedBy:["陈志远"], handoffTo:"ARIA 整合" },
  ]);

  assert.equal(handoffs.length, 3);
  assert.deepEqual(handoffs[0], {
    from:"林 美穂 · PM",
    to:"陈志远 · 前端工程师",
    status:"ready",
    output:"PRD",
    ready:true,
    blockedBy:[],
  });
  assert.equal(handoffs[1].status, "in_progress");
  assert.equal(handoffs[1].ready, false);
  assert.equal(handoffs[2].status, "blocked_source");
  assert.deepEqual(handoffs[2].blockedBy, ["陈志远"]);
});

test("workboard card action prompt targets a single executable card", () => {
  const prompt = buildWorkboardCardActionPrompt({
    title:"Workboard 生产化",
    mode:"running",
  }, {
    member:"吴晓敏",
    title:"QA",
    status:"queued",
    dependencyState:"blocked",
    task:"验收 Workboard",
    input:"UI",
    output:"QA 报告",
    dependencies:["fe"],
    blockedBy:["陈志远"],
    handoffTo:"ARIA 整合",
    acceptanceCriteria:"关键状态清晰",
    agentComment:"等待前端输出",
    comments:[{ author:"human", text:"先检查移动端卡片是否溢出" }],
  }, "unblock", "zh");

  assert.match(prompt, /解除/);
  assert.match(prompt, /Workboard 生产化/);
  assert.match(prompt, /吴晓敏 · QA/);
  assert.match(prompt, /阻塞来源: 陈志远/);
  assert.match(prompt, /验收标准: 关键状态清晰/);
  assert.match(prompt, /最近评论: human: 先检查移动端卡片是否溢出/);
  assert.match(prompt, /## 执行包/);
  assert.match(prompt, /输出契约/);
  assert.match(prompt, /不要只解释计划/);
});

test("workboard card action event records auditable card operations", () => {
  const event = buildWorkboardCardActionEvent({
    id:"qa",
    member:"吴晓敏",
    title:"QA",
    dependencyState:"blocked",
    blockedBy:["陈志远"],
    handoffTo:"ARIA 整合",
  }, "unblock", "2026-06-05T01:56:00.000Z");

  assert.equal(event.at, "2026-06-05T01:56:00.000Z");
  assert.equal(event.type, "workboard_card_action");
  assert.equal(event.member, "吴晓敏");
  assert.equal(event.status, "unblock");
  assert.match(event.detail, /dependency=blocked/);
  assert.match(event.detail, /blocked_by=陈志远/);
  assert.match(event.detail, /handoff=ARIA 整合/);
});

test("workboard comment event records human and agent collaboration", () => {
  const event = buildWorkboardCommentEvent({
    targetMemberId:"fe",
    targetMember:"陈志远",
    author:"human",
    text:"请接收 PM 输出并补移动端验收",
    at:"2026-06-05T08:10:00.000Z",
  });

  assert.equal(event.at, "2026-06-05T08:10:00.000Z");
  assert.equal(event.type, "workboard_comment");
  assert.equal(event.member, "陈志远");
  assert.equal(event.status, "human");
  assert.match(event.detail, /card=fe/);
  assert.match(event.detail, /移动端验收/);
});

test("workflow lifecycle steps expose the production task state machine", () => {
  const running = workflowLifecycleSteps("summarizing", "zh");
  assert.deepEqual(running.map(item => item.status), ["planning", "dispatched", "running", "waiting_confirmation", "done", "partial_failed", "failed", "archived"]);
  assert.equal(running.find(item => item.status === "running").state, "current");
  assert.equal(running.find(item => item.status === "dispatched").state, "complete");
  assert.equal(workflowLifecycleSteps("done", "en").find(item => item.status === "done").state, "complete");
  assert.equal(workflowLifecycleSteps("partial_failed", "en").find(item => item.status === "partial_failed").state, "current");
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

  const localOnly = workflowPermissionChecklist({
    task:"部署到 Vercel",
    members:[{ id:"fe", model:"codex" }],
    modelUsage:{ external:true, localOnlyMode:true },
  }, "zh");
  assert.equal(localOnly.blocked, true);
  assert.equal(localOnly.entries.find(item => item.id === "external-models").status, "blocked_by_local_only");
  assert.equal(localOnly.entries.find(item => item.id === "codex-dispatch").status, "blocked_by_local_only");
  assert.equal(localOnly.entries.find(item => item.id === "deployment").status, "blocked_by_local_only");
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

test("workflow tool call checklist flags tool permissions and states", () => {
  const checklist = workflowToolCallChecklist({
    task:"读取 https://example.com 后部署到 Vercel，并让 Codex 修复",
    members:[{ id:"fe", model:"codex" }],
    artifacts:[{ content:"产物" }],
    plan:{ protocol:{ expected_outputs:["部署报告"] } },
    modelUsage:{ external:true, models:[{ modelKey:"claude" }] },
  }, "zh");

  assert.equal(checklist.needsAttention, true);
  assert.equal(checklist.entries.find(item => item.id === "model-gateway").status, "recorded");
  assert.equal(checklist.entries.find(item => item.id === "knowledge").status, "available");
  assert.equal(checklist.entries.find(item => item.id === "web-fetch").status, "needs_confirmation");
  assert.equal(checklist.entries.find(item => item.id === "codex-dispatch").status, "needs_admin");
  assert.equal(checklist.entries.find(item => item.id === "vercel-deploy").status, "needs_admin");

  const localOnly = workflowToolCallChecklist({
    task:"读取 https://example.com 后部署到 Vercel",
    members:[{ id:"fe", model:"codex" }],
    modelUsage:{ external:true, localOnlyMode:true, models:[{ modelKey:"claude" }] },
  }, "zh");
  assert.equal(localOnly.needsAttention, true);
  assert.equal(localOnly.entries.find(item => item.id === "model-gateway").status, "blocked_by_local_only");
  assert.equal(localOnly.entries.find(item => item.id === "web-fetch").status, "blocked_by_local_only");
  assert.equal(localOnly.entries.find(item => item.id === "codex-dispatch").status, "blocked_by_local_only");
  assert.equal(localOnly.entries.find(item => item.id === "vercel-deploy").status, "blocked_by_local_only");
});

test("workflow execution readiness gates real task execution", () => {
  const ready = workflowExecutionReadiness({
    task:"生成 Workboard 计划",
    members:[{ id:"pm", name:"林 美穂", title:"PM", status:"queued", model:"gemma26" }],
    plan:{ steps:[{ order:1, memberId:"pm", member:"林 美穂", title:"PM", subtask:"拆解任务", output:"PRD" }] },
    modelUsage:{ external:true, models:[{ modelKey:"gemma26" }] },
  }, "zh");
  assert.equal(ready.status, "ready_to_execute");
  assert.equal(ready.canExecute, true);
  assert.equal(ready.nextCard.member, "林 美穂");
  assert.equal(ready.summary.completionRate, 0);

  const waitingPermission = workflowExecutionReadiness({
    task:"读取 https://example.com 后部署到 Vercel",
    members:[{ id:"fe", name:"陈志远", title:"前端工程师", status:"queued", model:"codex" }],
    plan:{ steps:[{ order:1, memberId:"fe", member:"陈志远", title:"前端工程师", subtask:"部署", output:"验证报告" }] },
    modelUsage:{ external:true, models:[{ modelKey:"codex" }] },
  }, "zh");
  assert.equal(waitingPermission.status, "waiting_permission");
  assert.equal(waitingPermission.canExecute, false);
  assert.equal(waitingPermission.needsPermission, true);
  assert.ok(waitingPermission.blockers.some(item => item.status === "needs_admin"));

  const blocked = workflowExecutionReadiness({
    task:"读取 https://example.com",
    members:[{ id:"fe", name:"陈志远", title:"前端工程师", status:"queued", model:"codex" }],
    modelUsage:{ external:true, localOnlyMode:true, models:[{ modelKey:"codex" }] },
  }, "zh");
  assert.equal(blocked.status, "blocked_by_local_only");
  assert.equal(blocked.blockedByLocalOnly, true);
  assert.equal(blocked.canExecute, false);
});

test("workflow execution gate event records blocked execution attempts", () => {
  const readiness = workflowExecutionReadiness({
    task:"读取 https://example.com 并部署",
    members:[{ id:"fe", name:"陈志远", title:"前端工程师", status:"queued", model:"codex" }],
    modelUsage:{ external:true, localOnlyMode:true, models:[{ modelKey:"codex" }] },
  }, "zh");
  const event = buildWorkflowExecutionGateEvent(readiness, "2026-06-05T07:14:00.000Z");

  assert.equal(event.at, "2026-06-05T07:14:00.000Z");
  assert.equal(event.type, "workflow_execution_gate");
  assert.equal(event.status, "blocked_by_local_only");
  assert.match(event.detail, /Local-only/);
  assert.match(event.detail, /blockers=/);
});

test("workboard execution packet describes real tool execution needs", () => {
  const packet = buildWorkboardExecutionPacket({
    task:"读取 https://example.com 后让 Codex 修复并部署到 Vercel",
    members:[{ id:"fe", name:"陈志远", title:"前端工程师", status:"queued", model:"codex" }],
    plan:{ steps:[{ order:1, memberId:"fe", member:"陈志远", title:"前端工程师", subtask:"修复并部署", input:"网页问题", output:"部署验证", acceptanceCriteria:"生产站 200" }] },
    modelUsage:{ external:true, models:[{ modelKey:"codex" }] },
  }, {
    id:"fe",
    member:"陈志远",
    title:"前端工程师",
    status:"queued",
    dependencyState:"ready",
    task:"修复并部署",
    input:"网页问题",
    output:"部署验证",
    handoffTo:"ARIA 整合",
    acceptanceCriteria:"生产站 200",
  }, "zh");

  assert.equal(packet.id, "exec-fe");
  assert.equal(packet.status, "blocked");
  assert.equal(packet.canExecute, false);
  assert.equal(packet.action, "continue");
  assert.ok(packet.requiredTools.some(tool => tool.id === "codex-dispatch"));
  assert.ok(packet.requiredTools.some(tool => tool.id === "vercel-deploy"));
  assert.ok(packet.blockers.some(item => item.status === "needs_admin"));
  assert.match(packet.instructions.join("\n"), /只执行这张 Workboard 卡片/);
  assert.match(packet.outputContract, /实际产物/);
});

test("workboard execution packet carries dependency evidence for blocked cards", () => {
  const packet = buildWorkboardExecutionPacket({
    task:"发布 Workboard",
    members:[
      { id:"fe", name:"陈志远", title:"前端工程师", status:"working" },
      { id:"qa", name:"吴晓敏", title:"QA", status:"queued" },
    ],
    plan:{ steps:[
      { order:1, memberId:"fe", member:"陈志远", title:"前端工程师", subtask:"实现看板", output:"UI" },
      { order:2, memberId:"qa", member:"吴晓敏", title:"QA", subtask:"验收 Workboard", input:"UI", output:"QA 报告", dependencies:["fe"] },
    ] },
  }, {
    id:"qa",
    member:"吴晓敏",
    title:"QA",
    status:"queued",
    dependencyState:"blocked",
    dependencies:["fe"],
    blockedBy:["陈志远"],
    task:"验收 Workboard",
    input:"UI",
    output:"QA 报告",
    handoffTo:"ARIA 整合",
  }, "zh");

  assert.equal(packet.status, "blocked");
  assert.equal(packet.card.dependencyEvidence.length, 1);
  assert.deepEqual(packet.card.dependencyEvidence[0], {
    dependency:"fe",
    member:"陈志远",
    title:"前端工程师",
    status:"working",
    output:"UI",
    blocked:true,
  });
  assert.match(packet.instructions.join("\n"), /依赖证据: 陈志远 · 前端工程师 · working · UI · blocked/);
});

test("workboard execution packet event records executable tool contract", () => {
  const packet = buildWorkboardExecutionPacket({
    members:[
      { id:"pm", name:"林 美穂", title:"PM", status:"complete" },
      { id:"fe", name:"陈志远", title:"前端工程师", status:"queued" },
    ],
    plan:{ steps:[
      { order:1, memberId:"pm", member:"林 美穂", title:"PM", output:"PRD" },
      { order:2, memberId:"fe", member:"陈志远", title:"前端工程师", output:"验证报告", dependencies:["pm"] },
    ] },
  }, {
    id:"fe",
    member:"陈志远",
    title:"前端工程师",
    status:"queued",
    dependencyState:"ready",
    dependencies:["pm"],
    task:"修复",
    output:"验证报告",
    handoffTo:"ARIA 整合",
    acceptanceCriteria:"测试通过",
  }, "zh");
  const event = buildWorkboardExecutionPacketEvent(packet, "2026-06-05T07:24:00.000Z");

  assert.equal(event.type, "workboard_execution_packet");
  assert.equal(event.member, "陈志远");
  assert.equal(event.status, "ready");
  assert.match(event.detail, /action=continue/);
  assert.match(event.detail, /deps=pm:complete/);
  assert.match(event.detail, /handoff=ARIA 整合/);
  assert.match(event.detail, /acceptance=测试通过/);
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

test("single member fallback decision is explicit and reusable", () => {
  assert.equal(workflowFallbackModelForMember({ id:"cto", model:"claude" }, "zh").toModel, "gemma26");
  assert.equal(workflowFallbackModelForMember({ id:"fe", model:"codex" }, "zh").action, "manual_confirmation");
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
