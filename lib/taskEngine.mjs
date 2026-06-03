export const WORKFLOW_STATUS_LABELS = {
  zh: { idle:"待命中", planning:"规划中", running:"执行中", summarizing:"汇总中", done:"已完成", failed:"失败", stopped:"已停止", queued:"待执行", working:"执行中", complete:"已完成" },
  ja: { idle:"待機中", planning:"計画中", running:"実行中", summarizing:"統合中", done:"完了", failed:"失敗", stopped:"停止", queued:"待機", working:"実行中", complete:"完了" },
  en: { idle:"Ready", planning:"Planning", running:"Running", summarizing:"Summarizing", done:"Done", failed:"Failed", stopped:"Stopped", queued:"Queued", working:"Working", complete:"Done" },
};

export function emptyWorkflowState(lang = "zh") {
  return {
    id:"",
    title:lang === "ja" ? "まだタスクはありません" : lang === "en" ? "No task yet" : "暂无任务",
    task:"",
    mode:"idle",
    phase:"",
    startedAt:"",
    updatedAt:"",
    members:[],
    plan:null,
    artifacts:[],
    error:"",
    progress:{ done:0, total:0 },
  };
}

export function workflowStatusLabel(lang, status) {
  return WORKFLOW_STATUS_LABELS[lang]?.[status] || WORKFLOW_STATUS_LABELS.zh[status] || status;
}

export function workflowQueueSummary(members = []) {
  const list = Array.isArray(members) ? members : [];
  const queued = list.filter(member => member.status === "queued");
  const working = list.filter(member => member.status === "working");
  const complete = list.filter(member => member.status === "complete");
  const failed = list.filter(member => member.status === "failed");
  const next = working[0] || queued[0] || null;
  return {
    total:list.length,
    queued:queued.length,
    working:working.length,
    complete:complete.length,
    failed:failed.length,
    next:next ? {
      id:next.id || "",
      name:next.name || next.id || "",
      title:next.title || "",
      status:next.status || "",
    } : null,
  };
}

export function taskMatches(text, words) {
  const normalized = `${text || ""}`.toLowerCase();
  return words.some(word => normalized.includes(word));
}

export function chooseWorkflowMembers(group, taskText) {
  const members = Array.isArray(group?.members) ? group.members : [];
  const byId = new Map(members.map(member => [member.id, member]));
  const selected = [];
  const add = (id) => {
    const member = byId.get(id);
    if (member && !selected.some(item => item.id === member.id)) selected.push(member);
  };

  if (taskMatches(taskText, ["全员", "全体", "大家", "所有人", "所有成员", "全部成员", "所有角色", "全部角色", "所有群组", "各群组", "整个团队", "全团队", "团队全部", "每个成员", "一起协作", "all members", "everyone", "whole team"])) {
    return members;
  }
  if (taskMatches(taskText, ["核心群组", "核心参谋", "第一层", "参谋", "管理层", "产品战略", "核心成员"])) {
    return members.filter(member => member.layer === 0 || member.layer === 1);
  }
  if (taskMatches(taskText, ["执行群组", "技术群组", "开发群组", "专项执行", "第二层", "技术组", "开发组", "工程组", "工程师", "开发成员", "技术部", "开发部", "代码执行", "codex"])) {
    return members.filter(member => member.layer === 2);
  }
  if (taskMatches(taskText, ["商业群组", "支撑群组", "文案法务财务", "第三层", "商业支撑", "法务财务", "文案组", "财务组", "法务组", "市场商务"])) {
    return members.filter(member => member.layer === 3);
  }

  add("aria");
  const wantsDev = taskMatches(taskText, ["开发", "代码", "修复", "部署", "接口", "前端", "后端", "pwa", "indexeddb", "bug", "deploy", "api"]);
  const wantsProduct = taskMatches(taskText, ["产品", "功能", "需求", "prd", "体验", "流程", "方案", "计划"]);
  const wantsResearch = taskMatches(taskText, ["分析", "研究", "调研", "文档", "市场", "竞品", "用户", "报告"]);
  const wantsLegal = taskMatches(taskText, ["法务", "合规", "隐私", "协议", "条款", "个人情報", "数据不上云", "安全"]);
  const wantsBusiness = taskMatches(taskText, ["商业", "定价", "收费", "预算", "财务", "成本", "盈利", "roi"]);
  const wantsDesign = taskMatches(taskText, ["界面", "手机", "移动端", "pc", "设计", "交互", "布局"]);

  if (wantsProduct || wantsResearch) ["cpo", "pd", "pm"].forEach(add);
  if (wantsResearch) ["mr", "ba"].forEach(add);
  if (wantsLegal) ["legal", "audit"].forEach(add);
  if (wantsBusiness) ["bs", "cfo", "fa"].forEach(add);
  if (wantsDesign) ["ux", "pd"].forEach(add);
  if (wantsDev) ["cto", "fe", "be", "ai", "qa", "audit"].forEach(add);

  if (selected.length <= 1) ["cpo", "cto", "pm", "mr", "legal"].forEach(add);
  return selected.slice(0, wantsDev ? 8 : 7);
}

export function memberWorkflowTask(member, taskText, previousResults, lang) {
  const prior = previousResults.length
    ? previousResults.map(item => `- ${item.member}（${item.title}）：${item.summary}`).join("\n")
    : (lang === "en" ? "No prior member output yet." : lang === "ja" ? "先行メンバーの成果はまだありません。" : "暂无前序成员成果。");
  const languageLine = lang === "en"
    ? "Reply only in the user's current language. Do not mix languages unless the user explicitly asks."
    : lang === "ja"
      ? "ユーザーの現在の言語だけで回答し、明示要求がない限り多言語を混在させない。"
      : "只使用用户当前语言回复，除非用户明确要求，不要混用多种语言。";
  return `${languageLine}
这是一个自动生产工作流，不是普通聊天。
总任务：
${taskText}

你的身份：${member.name}，${member.title}
你的目标：只完成你职责范围内的可交付成果。

前序成员成果：
${prior}

输出要求：
1. 不要自我介绍，不要展示内部推理。
2. 直接给出你负责的结论、方案、清单或执行规格。
3. 如果需要后续执行，请写清楚输入、输出、文件路径或验收标准。
4. 控制篇幅，避免重复其他成员内容。`;
}

export function summarizeForWorkflow(text) {
  return `${text || ""}`.replace(/\s+/g, " ").trim().slice(0, 220);
}

export function buildWorkflowPlan({ taskText = "", workers = [], mode = "auto", lang = "zh" } = {}) {
  const label = (zh, ja, en) => lang === "ja" ? ja : lang === "en" ? en : zh;
  const list = Array.isArray(workers) ? workers : [];
  const hasEngineering = list.some(member => member.layer === 2);
  const hasBusiness = list.some(member => member.layer === 3);
  const hasCore = list.some(member => member.layer === 0 || member.layer === 1);
  const strategy = [
    mode === "integrate"
      ? label("整合已有成员成果", "既存メンバー成果の統合", "Integrate existing member outputs")
      : label("ARIA 自动调度", "ARIA 自動調度", "ARIA automatic dispatch"),
    hasCore ? label("核心判断", "中核判断", "core judgment") : "",
    hasEngineering ? label("执行落地", "実行実装", "execution") : "",
    hasBusiness ? label("商业/支撑校验", "事業・支援確認", "business/support review") : "",
  ].filter(Boolean).join(" · ");
  return {
    mode,
    strategy,
    task:summarizeForWorkflow(taskText),
    generatedAt:new Date().toISOString(),
    steps:list.map((member, index) => ({
      order:index + 1,
      memberId:member.id || "",
      member:member.name || member.id || "",
      title:member.title || "",
      model:member.model || "",
      purpose:member.layer === 0
        ? label("总调度与最终整合", "総合調度と最終統合", "dispatch and integration")
        : member.layer === 1
          ? label("方向判断与方案约束", "方向判断と方針制約", "direction and constraints")
          : member.layer === 2
            ? label("执行规格与落地验证", "実行仕様と検証", "execution and validation")
            : label("商业、法务或运营支撑", "事業・法務・運用支援", "business, legal, or operations support"),
    })),
  };
}

export function recentConversationContext(messages = [], limit = 8) {
  const recent = messages
    .filter(message => message?.text?.trim())
    .slice(-limit)
    .map(message => `${message.role === "user" ? "用户" : "助手"}：${message.text}`)
    .join("\n\n");
  return recent ? `\n\n当前对话上下文：\n${recent}` : "";
}

export function extractPriorWorkflowResults(messages = []) {
  return messages
    .filter(message => message?.role === "ai" && /^【.+? · .+?】/.test(message.text || ""))
    .map(message => {
      const match = `${message.text}`.match(/^【(.+?) · (.+?)】\n([\s\S]*)$/);
      if (!match) return null;
      const [, member, title, text] = match;
      if (member === "ARIA" && /整合产物|Integrated output|統合成果/.test(title)) return null;
      return { member, title, model:"", text, summary:summarizeForWorkflow(text) };
    })
    .filter(Boolean);
}

export function wantsPriorIntegration(text) {
  return taskMatches(text, ["整合", "汇总", "总结", "完整", "发完整", "前面", "刚才", "上面", "成员成果", "他们的成果", "继续", "不对", "没有看到", "integrate", "summary", "previous"]);
}

export function buildWorkflowRetryPrompt(workflow = {}, lang = "zh") {
  const label = (zh, ja, en) => lang === "ja" ? ja : lang === "en" ? en : zh;
  const failedMembers = Array.isArray(workflow.members)
    ? workflow.members
      .filter(member => member.status === "failed" || member.error)
      .map(member => `- ${member.name || member.id} · ${member.title || ""}: ${member.error || member.summary || workflow.error || "-"}`)
      .join("\n")
    : "";
  const completedMembers = Array.isArray(workflow.members)
    ? workflow.members
      .filter(member => member.status === "complete" && member.summary)
      .slice(0, 8)
      .map(member => `- ${member.name || member.id} · ${member.title || ""}: ${member.summary}`)
      .join("\n")
    : "";
  return [
    label("请重试以下自动生产工作流。不要从零开始；保留已完成成员成果，只重新规划失败或未完成部分。", "以下の自動ワークフローを再試行してください。最初からやり直さず、完了済みメンバー成果を保持し、失敗または未完了部分だけを再計画してください。", "Retry the automation workflow below. Do not restart from scratch; keep completed member outputs and re-plan only failed or unfinished parts."),
    "",
    `${label("原任务", "元タスク", "Original task")}:`,
    workflow.task || workflow.title || "-",
    "",
    `${label("当前状态", "現在の状態", "Current status")}: ${workflow.mode || "-"}`,
    workflow.phase ? `${label("阶段", "フェーズ", "Phase")}: ${workflow.phase}` : "",
    workflow.error ? `${label("错误", "エラー", "Error")}: ${workflow.error}` : "",
    "",
    `${label("失败成员", "失敗したメンバー", "Failed members")}:`,
    failedMembers || "-",
    "",
    `${label("已完成成员摘要", "完了済みメンバー要約", "Completed member summaries")}:`,
    completedMembers || "-",
    "",
    label("请先判断是否需要调整执行成员，再继续生成可执行产物。", "担当メンバーの調整が必要か判断してから、実行可能な成果物を続けて生成してください。", "First decide whether assigned members should change, then continue producing the actionable output."),
  ].filter(line => line !== "").join("\n").trim();
}

export function parsePlannerJson(text) {
  const raw = `${text || ""}`.trim();
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const candidate = fenced || raw.match(/\{[\s\S]*\}/)?.[0] || raw;
  return JSON.parse(candidate);
}

export async function planWorkflowMembersWithModel({ router, taskText, members, apiKeys, controls, language, signal, callModel }) {
  const roster = members.map(member => ({
    id:member.id,
    name:member.name,
    title:member.title,
    layer:member.layer,
    model:member.model,
    tags:member.tags || [],
  }));
  const prompt = `${language === "en" ? "Reply with JSON only." : language === "ja" ? "JSONのみで回答してください。" : "只输出 JSON。"}
你是 Neural Bridge 的任务调度器。请根据用户任务，自主判断应该调度哪些成员或群组。

用户任务：
${taskText}

可调度成员：
${JSON.stringify(roster, null, 2)}

群组规则：
- core：layer 0 和 layer 1
- exec：layer 2
- business：layer 3
- all：所有成员
- custom：只选择你认为必要的 memberIds

输出 JSON，禁止输出解释文字：
{
  "target": "core | exec | business | all | custom",
  "memberIds": ["aria"],
  "reason": "一句话说明调度依据"
}

约束：
1. 不要为了省 token 而漏掉必要成员。
2. 普通任务优先选择少量关键成员。
3. 用户明确要求全员/所有群组/大家协作时，target 必须为 all。
4. 用户明确要求技术/开发/Codex 时，至少包含 layer 2 的相关工程成员。
5. 用户明确要求法务/财务/文案/商业支撑时，选择 layer 3 相关成员。`;
  try {
    const raw = await callModel(router.model, router.systemPrompt, [{ role:"user", text:prompt }], apiKeys, { ...controls, language }, signal);
    const plan = parsePlannerJson(raw);
    const byId = new Map(members.map(member => [member.id, member]));
    if (plan?.target === "all") return members;
    if (plan?.target === "core") return members.filter(member => member.layer === 0 || member.layer === 1);
    if (plan?.target === "exec") return members.filter(member => member.layer === 2);
    if (plan?.target === "business") return members.filter(member => member.layer === 3);
    const planned = Array.isArray(plan?.memberIds)
      ? plan.memberIds.map(id => byId.get(id)).filter(Boolean)
      : [];
    return planned.length ? planned : chooseWorkflowMembers({ members }, taskText);
  } catch {
    return chooseWorkflowMembers({ members }, taskText);
  }
}
