import { normalizeWorkflowProtocol, workflowExternalDisclosureLines, workflowLifecycleSteps, workflowToolCallChecklist, workflowWorkboardCards, workflowWorkboardHandoffs, workflowWorkboardSummary } from "./taskEngine.mjs";

const WORKFLOW_DB_NAME = "neural_bridge_workflow_archive";
const WORKFLOW_DB_VERSION = 1;
const WORKFLOW_RECORD_LIMIT = 60;
const MAX_TEXT_CHARS = 12000;
const MAX_COMMENT_CHARS = 1200;

function truncateText(value, limit = MAX_TEXT_CHARS) {
  const text = `${value || ""}`;
  return text.length > limit ? `${text.slice(0, limit)}\n...[truncated]` : text;
}

function artifactContentHash(value) {
  const text = `${value || ""}`;
  let hash = 5381;
  for (let index = 0; index < text.length; index += 1) {
    hash = ((hash << 5) + hash) ^ text.charCodeAt(index);
  }
  return `a-${(hash >>> 0).toString(36)}`;
}

function normalizeWorkflowComments(comments) {
  return Array.isArray(comments)
    ? comments.slice(-80).map(comment => ({
      targetMemberId:`${comment.targetMemberId || ""}`.slice(0, 80),
      targetMember:`${comment.targetMember || ""}`.slice(0, 120),
      author:`${comment.author || "human"}`.slice(0, 80),
      text:truncateText(comment.text, MAX_COMMENT_CHARS),
      at:`${comment.at || comment.createdAt || ""}`.slice(0, 80),
    })).filter(comment => comment.text)
    : [];
}

function normalizeWorkflowRecord(record = {}) {
  const now = new Date().toISOString();
  const id = record.id || `wfr-${Date.now().toString(36)}`;
  return {
    id,
    title: `${record.title || "Workflow"}`.slice(0, 120),
    task: truncateText(record.task, 4000),
    source: record.source || "workflow",
    trigger: record.trigger && typeof record.trigger === "object"
      ? {
        type: `${record.trigger.type || ""}`.slice(0, 80),
        automationId: `${record.trigger.automationId || ""}`.slice(0, 120),
        label: `${record.trigger.label || ""}`.slice(0, 160),
      }
      : null,
    status: record.status || "done",
    language: record.language || "zh",
    createdAt: record.createdAt || now,
    updatedAt: record.updatedAt || now,
    members: Array.isArray(record.members)
      ? record.members.slice(0, 24).map(member => ({
        id: member.id || member.member || member.name || "",
        name: member.name || member.member || "",
        title: member.title || "",
        model: member.model || "",
        status: member.status || "complete",
        summary: truncateText(member.summary || member.text, 1600),
        error: truncateText(member.error, 1000),
      }))
      : [],
    plan: record.plan && typeof record.plan === "object"
      ? {
        mode: `${record.plan.mode || "auto"}`.slice(0, 32),
        strategy: truncateText(record.plan.strategy, 500),
        task: truncateText(record.plan.task, 800),
        protocol:normalizeWorkflowProtocol(record.plan.protocol || {}, { taskText:record.task || record.plan.task || "" }),
        generatedAt: record.plan.generatedAt || "",
        steps: Array.isArray(record.plan.steps)
          ? record.plan.steps.slice(0, 24).map(step => ({
            order: Number(step.order) || 0,
            memberId: `${step.memberId || ""}`.slice(0, 80),
            member: `${step.member || ""}`.slice(0, 120),
            title: `${step.title || ""}`.slice(0, 160),
            model: `${step.model || ""}`.slice(0, 80),
            purpose: truncateText(step.purpose, 500),
            subtask: truncateText(step.subtask, 500),
            input: truncateText(step.input, 500),
            output: truncateText(step.output, 500),
            deadline: `${step.deadline || ""}`.slice(0, 120),
            dependencies: Array.isArray(step.dependencies) ? step.dependencies.slice(0, 8).map(item => `${item || ""}`.slice(0, 80)) : [],
            acceptanceCriteria: truncateText(step.acceptanceCriteria, 500),
          }))
          : [],
      }
      : null,
    modelUsage: record.modelUsage && typeof record.modelUsage === "object"
      ? {
        external: !!record.modelUsage.external,
        localOnlyMode: !!record.modelUsage.localOnlyMode,
        providers: Array.isArray(record.modelUsage.providers)
          ? record.modelUsage.providers.slice(0, 8).map(provider => `${provider || ""}`.slice(0, 120))
          : [],
        models: Array.isArray(record.modelUsage.models)
          ? record.modelUsage.models.slice(0, 12).map(item => ({
            modelKey: `${item.modelKey || ""}`.slice(0, 80),
            actualModel: `${item.actualModel || ""}`.slice(0, 120),
            provider: `${item.provider || ""}`.slice(0, 120),
            external: !!item.external,
          }))
          : [],
      }
      : null,
    quality: record.quality && typeof record.quality === "object"
      ? {
        complete:!!record.quality.complete,
        missingMembers:Array.isArray(record.quality.missingMembers)
          ? record.quality.missingMembers.slice(0, 24).map(member => ({
            id:`${member.id || ""}`.slice(0, 80),
            name:`${member.name || ""}`.slice(0, 120),
            title:`${member.title || ""}`.slice(0, 160),
          }))
          : [],
      }
      : null,
    results: Array.isArray(record.results)
      ? record.results.slice(0, 24).map(result => ({
        member: result.member || result.name || "",
        title: result.title || "",
        model: result.model || "",
        summary: truncateText(result.summary || result.text, 1600),
        text: truncateText(result.text, 6000),
      }))
      : [],
    artifacts: Array.isArray(record.artifacts)
      ? record.artifacts.slice(0, 8).map((artifact, index) => {
        const content = truncateText(artifact.content || artifact.text, MAX_TEXT_CHARS);
        return {
        title: artifact.title || record.title || "Artifact",
        kind: artifact.kind || "Integrated report",
        version: Number(artifact.version) || index + 1,
        hash: artifact.hash || artifactContentHash(content),
        content,
        createdAt: artifact.createdAt || now,
      };
      })
      : [],
    comments:normalizeWorkflowComments(record.comments),
    events: Array.isArray(record.events)
      ? record.events.slice(0, 40).map(event => ({
        at: `${event.at || event.createdAt || ""}`.slice(0, 80),
        type: `${event.type || ""}`.slice(0, 80),
        member: `${event.member || event.name || ""}`.slice(0, 120),
        model: `${event.model || ""}`.slice(0, 80),
        status: `${event.status || ""}`.slice(0, 80),
        detail: truncateText(event.detail || event.error || event.message, 1000),
      }))
      : [],
    error: truncateText(record.error, 1000),
  };
}

function formatWorkflowRecordMarkdown(record, lang = "zh") {
  const item = normalizeWorkflowRecord(record);
  const label = (zh, ja, en) => lang === "ja" ? ja : lang === "en" ? en : zh;
  const workboardCards = workflowWorkboardCards(item, lang);
  const workboardSummary = workflowWorkboardSummary(workboardCards);
  const workboardHandoffs = workflowWorkboardHandoffs(workboardCards);
  const lines = [
    `# ${item.title}`,
    "",
    `- ${label("状态", "状態", "Status")}: ${item.status}`,
    `- ${label("来源", "ソース", "Source")}: ${item.source}`,
    item.trigger?.type ? `- ${label("触发", "トリガー", "Trigger")}: ${item.trigger.type}${item.trigger.automationId ? ` · ${item.trigger.automationId}` : ""}` : "",
    `- ${label("更新时间", "更新時刻", "Updated")}: ${item.updatedAt}`,
    "",
    `## ${label("任务", "タスク", "Task")}`,
    item.task || "-",
    "",
    `## ${label("执行成员", "担当メンバー", "Members")}`,
    ...(item.members.length
      ? item.members.map(member => `- ${member.name} · ${member.title} · ${member.model} · ${member.status}${member.error ? ` · ${member.error}` : ""}`)
      : ["-"]),
    "",
    `## ${label("调度计划", "調度計画", "Dispatch plan")}`,
    ...(item.plan?.steps?.length
      ? [
        item.plan.strategy || "-",
        item.plan.protocol?.intent ? `${label("意图", "意図", "Intent")}: ${item.plan.protocol.intent}` : "",
        item.plan.protocol?.task_type ? `${label("类型", "種別", "Type")}: ${item.plan.protocol.task_type} · ${label("优先级", "優先度", "Priority")}: ${item.plan.protocol.priority}` : "",
        item.plan.protocol?.subtasks?.length ? `${label("子任务", "サブタスク", "Subtasks")}: ${item.plan.protocol.subtasks.join(" / ")}` : "",
        item.plan.protocol?.expected_outputs?.length ? `${label("预期产物", "期待成果物", "Expected outputs")}: ${item.plan.protocol.expected_outputs.join(" / ")}` : "",
        item.plan.protocol?.risks?.length ? `${label("风险", "リスク", "Risks")}: ${item.plan.protocol.risks.join(" / ")}` : "",
        "",
        ...item.plan.steps.map(step => `${step.order}. ${step.member} · ${step.title} · ${step.model}\n   ${step.purpose}${step.subtask ? `\n   ${label("子任务", "サブタスク", "Subtask")}: ${step.subtask}` : ""}${step.output ? `\n   ${label("输出", "出力", "Output")}: ${step.output}` : ""}${step.acceptanceCriteria ? `\n   ${label("验收", "受入条件", "Acceptance")}: ${step.acceptanceCriteria}` : ""}`),
      ].filter(line => line !== "")
      : ["-"]),
    "",
    `## ${label("模型调用", "モデル呼び出し", "Model calls")}`,
    ...(item.modelUsage?.models?.length
      ? [
        `${label("外部提供商", "外部提供元", "External providers")}: ${item.modelUsage.external ? item.modelUsage.providers.join(", ") || "yes" : "no"}`,
        ...workflowExternalDisclosureLines(item.modelUsage, lang),
        "",
        ...item.modelUsage.models.map(model => `- ${model.modelKey}${model.actualModel ? ` -> ${model.actualModel}` : ""}${model.provider ? ` · ${model.provider}` : ""}${model.external ? "" : " · local/no external provider"}`),
      ]
      : ["-"]),
    "",
    `## ${label("质量检查", "品質チェック", "Quality check")}`,
    ...(item.quality
      ? [
        `${label("完整", "完全", "Complete")}: ${item.quality.complete ? "yes" : "no"}`,
        item.quality.missingMembers?.length ? `${label("缺失成员", "不足メンバー", "Missing members")}: ${item.quality.missingMembers.map(member => `${member.name} · ${member.title}`).join(" / ")}` : "",
      ].filter(Boolean)
      : ["-"]),
    "",
    `## ${label("成员成果", "メンバー成果", "Member outputs")}`,
    ...(item.results.length
      ? item.results.flatMap(result => [
        `### ${result.member} · ${result.title}`,
        "",
        result.text || result.summary || "-",
        "",
      ])
      : ["-"]),
    "",
    `## ${label("整合产物", "統合成果物", "Integrated artifacts")}`,
    ...(item.artifacts.length
      ? item.artifacts.flatMap(artifact => [
        `### v${artifact.version} · ${artifact.title}`,
        "",
        `- ${label("类型", "種別", "Kind")}: ${artifact.kind}`,
        `- ${label("指纹", "フィンガープリント", "Fingerprint")}: ${artifact.hash}`,
        "",
        artifact.content || "-",
        "",
      ])
      : ["-"]),
    "",
    `## Workboard`,
    ...(workboardCards.length
      ? [
        `${label("摘要", "サマリー", "Summary")}: ${label("可执行", "実行可", "Ready")} ${workboardSummary.ready} · ${label("阻塞", "ブロック", "Blocked")} ${workboardSummary.blocked} · ${label("失败", "失敗", "Failed")} ${workboardSummary.failed} · ${label("下一步", "次の一手", "Next action")}: ${workboardSummary.nextAction}`,
        "",
        "| Agent | Status | Dependency | Task | Output | Handoff |",
        "| --- | --- | --- | --- | --- | --- |",
        ...workboardCards.map(card => `| ${card.member || "-"} · ${card.title || "-"} | ${card.status || "-"} | ${card.dependencyState || "-"}${card.blockedBy?.length ? ` (${card.blockedBy.join(" / ")})` : ""} | ${truncateText(card.task, 200).replace(/\n/g, " ")} | ${truncateText(card.output, 160).replace(/\n/g, " ")} | ${card.handoffTo || "-"} |`),
        "",
        `### ${label("交接链路", "引き渡しチェーン", "Handoff chain")}`,
        ...(workboardHandoffs.length
          ? workboardHandoffs.map(handoff => `- ${handoff.status}: ${handoff.from || "-"} -> ${handoff.to || "-"}${handoff.output ? ` · ${truncateText(handoff.output, 160).replace(/\n/g, " ")}` : ""}${handoff.blockedBy?.length ? ` · blocked by ${handoff.blockedBy.join(" / ")}` : ""}`)
          : ["-"]),
      ]
      : ["-"]),
    "",
    `## ${label("Workboard 评论", "Workboard コメント", "Workboard comments")}`,
    ...(item.comments.length
      ? item.comments.map(comment => `- ${comment.at || "-"} · ${comment.author || "human"} · ${comment.targetMember || comment.targetMemberId || "-"}: ${comment.text}`)
      : ["-"]),
    "",
    `## ${label("执行事件", "実行イベント", "Execution events")}`,
    ...(item.events.length
      ? item.events.map(event => `- ${event.at || "-"} · ${event.type || "-"} · ${event.member || "-"} · ${event.model || "-"} · ${event.status || "-"}${event.detail ? ` · ${event.detail}` : ""}`)
      : ["-"]),
  ];
  return lines.join("\n").replace(/\n{4,}/g, "\n\n\n").trim();
}

function formatWorkflowArtifactMarkdown(record, artifactIndex = 0, lang = "zh") {
  const item = normalizeWorkflowRecord(record);
  const label = (zh, ja, en) => lang === "ja" ? ja : lang === "en" ? en : zh;
  const artifact = item.artifacts[artifactIndex] || item.artifacts[0] || null;
  if (!artifact) return "";
  const lifecycle = workflowLifecycleSteps(item.status, lang);
  const modelLines = workflowExternalDisclosureLines(item.modelUsage || {}, lang);
  return [
    `# ${artifact.title}`,
    "",
    `- ${label("版本", "バージョン", "Version")}: v${artifact.version}`,
    `- ${label("类型", "種別", "Kind")}: ${artifact.kind}`,
    `- ${label("指纹", "フィンガープリント", "Fingerprint")}: ${artifact.hash}`,
    `- ${label("来源工作流", "元ワークフロー", "Source workflow")}: ${item.title}`,
    `- ${label("工作流状态", "ワークフロー状態", "Workflow status")}: ${item.status}`,
    `- ${label("更新时间", "更新時刻", "Updated")}: ${item.updatedAt}`,
    "",
    `## ${label("生命周期", "ライフサイクル", "Lifecycle")}`,
    ...lifecycle.map(step => `- ${step.label}: ${step.state}`),
    "",
    `## ${label("模型与外发披露", "モデルと外部送信の開示", "Model and external disclosure")}`,
    ...(modelLines.length ? modelLines.map(line => `- ${line}`) : ["-"]),
    "",
    `## ${label("任务", "タスク", "Task")}`,
    "",
    item.task || "-",
    "",
    `## ${label("产物内容", "成果物本文", "Artifact content")}`,
    "",
    artifact.content || "-",
  ].join("\n").trim();
}

function formatWorkflowAuditMarkdown(record, lang = "zh") {
  const item = normalizeWorkflowRecord(record);
  const label = (zh, ja, en) => lang === "ja" ? ja : lang === "en" ? en : zh;
  const checklist = workflowToolCallChecklist(item, lang);
  const lifecycle = workflowLifecycleSteps(item.status, lang);
  const modelLines = workflowExternalDisclosureLines(item.modelUsage || {}, lang);
  const recoveryActions = workflowEventRecoveryActions(item, lang);
  const routeLines = [
    ...item.members
      .filter(member => member.model)
      .map(member => `${member.name || member.id || "-"} · ${member.title || "-"}: ${member.model} · ${member.status}`),
    ...item.events
      .filter(event => event.model)
      .map(event => `${event.member || "-"}: ${event.model} · ${event.type || "-"} · ${event.status || "-"}`),
  ].slice(-12);
  return [
    `# ${label("工作流审计", "ワークフロー監査", "Workflow audit")}: ${item.title}`,
    "",
    `- ${label("状态", "状態", "Status")}: ${item.status}`,
    `- ${label("来源", "ソース", "Source")}: ${item.source}`,
    `- ${label("更新时间", "更新時刻", "Updated")}: ${item.updatedAt}`,
    `- Local-only: ${item.modelUsage?.localOnlyMode ? "yes" : "no"}`,
    `- ${label("外发模型", "外部モデル", "External models")}: ${item.modelUsage?.external ? "yes" : "no"}`,
    "",
    `## ${label("生命周期", "ライフサイクル", "Lifecycle")}`,
    ...lifecycle.map(step => `- ${step.label}: ${step.state}`),
    "",
    `## ${label("模型与外发路径", "モデルと外部送信経路", "Model and external transfer paths")}`,
    ...(modelLines.length ? modelLines.map(line => `- ${line}`) : ["-"]),
    ...(item.modelUsage?.models?.length
      ? item.modelUsage.models.map(model => `- ${model.modelKey || "-"}${model.actualModel ? ` -> ${model.actualModel}` : ""} · ${model.provider || label("未记录提供商", "提供元未記録", "provider not recorded")} · ${model.external ? label("外发", "外部", "external") : label("本地/无外部提供商", "ローカル/外部提供元なし", "local/no external provider")}`)
      : []),
    ...(routeLines.length ? ["", `### ${label("模型执行路径", "モデル実行経路", "Model execution routes")}`, ...routeLines.map(line => `- ${line}`)] : []),
    "",
    `## ${label("权限与工具调用", "権限とツール呼び出し", "Permissions and tool calls")}`,
    ...(checklist.entries?.length
      ? checklist.entries.map(entry => `- ${entry.name}: ${entry.status} · ${entry.permission}${entry.detail ? ` · ${entry.detail}` : ""}`)
      : ["-"]),
    "",
    `## ${label("执行事件", "実行イベント", "Execution events")}`,
    ...(item.events.length
      ? item.events.map(event => `- ${event.at || "-"} · ${event.type || "-"} · ${event.member || "-"} · ${event.model || "-"} · ${event.status || "-"}${event.detail ? ` · ${event.detail}` : ""}`)
      : ["-"]),
    "",
    `## ${label("恢复建议", "復旧提案", "Recovery actions")}`,
    ...(recoveryActions.length
      ? recoveryActions.map(action => `- ${action.label}: ${action.member || "-"}${action.detail ? ` · ${action.detail}` : ""}`)
      : ["-"]),
    "",
    `## ${label("质量闸门", "品質ゲート", "Quality gates")}`,
    ...(item.quality
      ? [
        `- ${label("成员成果完整", "メンバー成果完全", "Member outputs complete")}: ${item.quality.complete ? "yes" : "no"}`,
        item.quality.missingMembers?.length
          ? `- ${label("缺失成员", "不足メンバー", "Missing members")}: ${item.quality.missingMembers.map(member => `${member.name} · ${member.title}`).join(" / ")}`
          : `- ${label("缺失成员", "不足メンバー", "Missing members")}: none`,
      ]
      : [`- ${label("未记录质量检查", "品質チェック未記録", "Quality check not recorded")}`]),
    "",
    `## ${label("执行账本", "実行台帳", "Execution ledger")}`,
    ...(item.members.length
      ? item.members.map(member => `- ${member.name || member.id || "-"} · ${member.title || "-"} · ${member.model || "-"} · ${member.status || "-"}`)
      : ["-"]),
    "",
    `## ${label("产物证据", "成果物エビデンス", "Artifact evidence")}`,
    ...(item.artifacts.length
      ? item.artifacts.map(artifact => `- v${artifact.version} · ${artifact.title} · ${artifact.kind} · ${artifact.hash}`)
      : ["-"]),
  ].join("\n").replace(/\n{4,}/g, "\n\n\n").trim();
}

function buildWorkflowContinuationPrompt(record, lang = "zh") {
  const item = normalizeWorkflowRecord(record);
  const label = (zh, ja, en) => lang === "ja" ? ja : lang === "en" ? en : zh;
  const artifact = item.artifacts[0];
  const memberBlock = item.results
    .slice(0, 6)
    .map(result => `- ${result.member} · ${result.title}: ${result.summary || summarizeLine(result.text)}`)
    .join("\n");
  return [
    label("请基于以下历史工作流继续推进，不要重新从零开始。", "以下の過去ワークフローを前提に続行してください。最初からやり直さないでください。", "Continue from the workflow below. Do not restart from scratch."),
    "",
    `${label("原任务", "元タスク", "Original task")}:`,
    item.task || "-",
    "",
    `${label("已有整合产物", "既存の統合成果物", "Existing integrated artifact")}:`,
    artifact?.content || "-",
    "",
    `${label("成员成果摘要", "メンバー成果サマリー", "Member output summaries")}:`,
    memberBlock || "-",
    "",
    label("请先判断下一步应该调度哪些成员，再继续生成可执行产物。", "次に担当すべきメンバーを判断し、実行可能な成果物を続けて生成してください。", "First decide which members should be dispatched next, then produce the next actionable output."),
  ].join("\n").trim();
}

function buildWorkflowRerunPrompt(record, lang = "zh") {
  const item = normalizeWorkflowRecord(record);
  const label = (zh, ja, en) => lang === "ja" ? ja : lang === "en" ? en : zh;
  const memberBlock = item.results
    .slice(0, 6)
    .map(result => `- ${result.member} · ${result.title}: ${result.summary || summarizeLine(result.text)}`)
    .join("\n");
  return [
    label("请复跑以下历史工作流：保持原目标，但根据当前上下文重新判断成员调度、补足遗漏，并生成新的可执行产物。", "以下の過去ワークフローを再実行してください。元の目的を保ちつつ、現在の文脈で担当メンバーを再判断し、漏れを補って新しい実行可能な成果物を生成してください。", "Rerun the workflow below: keep the original objective, reassess member dispatch from the current context, fill gaps, and produce a new actionable artifact."),
    "",
    `${label("原任务", "元タスク", "Original task")}:`,
    item.task || "-",
    "",
    `${label("上次调度策略", "前回の調度戦略", "Previous dispatch strategy")}:`,
    item.plan?.strategy || "-",
    "",
    `${label("上次成员成果摘要", "前回メンバー成果サマリー", "Previous member output summaries")}:`,
    memberBlock || "-",
    "",
    label("不要只总结历史记录；请启动新的 ARIA 调度并产出新版结果。", "履歴の要約だけで終わらせず、新しい ARIA 調度を開始して新版の結果を出してください。", "Do not merely summarize the archive; start a new ARIA dispatch and produce an updated result."),
  ].join("\n").trim();
}

function buildWorkflowAttentionRecoveryPrompt(records = [], lang = "zh") {
  const label = (zh, ja, en) => lang === "ja" ? ja : lang === "en" ? en : zh;
  const items = filterWorkflowRecordsByStatus(records, "needs_attention").slice(0, 5).map(record => normalizeWorkflowRecord(record));
  const lines = items.map((item, index) => {
    const failedMembers = item.members.filter(member => member.status === "failed").map(member => `${member.name} · ${member.title}`).join(" / ");
    const toolRisks = workflowToolCallChecklist(item, lang).entries
      .filter(entry => !["recorded", "available", "not_needed", "optional"].includes(entry.status))
      .map(entry => `${entry.name} · ${entry.status} · ${entry.permission}`)
      .join(" / ");
    return [
      `${index + 1}. ${item.title}`,
      `- status: ${item.status}`,
      `- task: ${summarizeLine(item.task, 260) || "-"}`,
      `- failedMembers: ${failedMembers || "-"}`,
      `- error: ${summarizeLine(item.error, 180) || "-"}`,
      `- toolRisks: ${toolRisks || "-"}`,
      `- artifact: ${summarizeLine(item.artifacts[0]?.content, 260) || "-"}`,
    ].join("\n");
  }).join("\n\n");
  return [
    label("请批量恢复以下需要处理的历史工作流。", "以下の要対応ワークフローをまとめて復旧してください。", "Batch recover the workflow records needing attention below."),
    "",
    label("要求：优先保留已有成员成果；失败成员先尝试改派；等待确认的计划先列出确认点；工具权限风险必须明确说明；最后输出新的可执行产物。", "要件：既存メンバー成果を優先して保持し、失敗メンバーは再割当を試み、確認待ち計画は確認点を列挙し、ツール権限リスクを明示し、最後に新しい実行可能な成果物を出力してください。", "Requirements: preserve existing member outputs first; reassign failed members; list confirmation points for waiting plans; disclose tool permission risks; then produce a new actionable artifact."),
    "",
    lines || "-",
  ].join("\n").trim();
}

function buildWorkflowArtifactRevisionPrompt(record, artifactIndex = 0, lang = "zh") {
  const item = normalizeWorkflowRecord(record);
  const label = (zh, ja, en) => lang === "ja" ? ja : lang === "en" ? en : zh;
  const artifact = item.artifacts[artifactIndex] || item.artifacts[0] || null;
  const sourceVersion = artifact?.version || artifactIndex + 1;
  const targetVersion = sourceVersion + 1;
  const memberBlock = item.results
    .slice(0, 6)
    .map(result => `- ${result.member} · ${result.title}: ${result.summary || summarizeLine(result.text)}`)
    .join("\n");
  return [
    label("请基于以下历史产物生成下一版本，不要从零开始。", "以下の過去成果物を基に次バージョンを生成してください。最初からやり直さないでください。", "Create the next version from the archived artifact below. Do not restart from scratch."),
    "",
    `${label("原工作流", "元ワークフロー", "Source workflow")}: ${item.title}`,
    `${label("原任务", "元タスク", "Original task")}:`,
    item.task || "-",
    "",
    `${label("来源版本", "元バージョン", "Source version")}: v${sourceVersion} · ${artifact?.title || item.title}`,
    `${label("来源指纹", "元フィンガープリント", "Source fingerprint")}: ${artifact?.hash || "-"}`,
    `${label("目标版本", "目標バージョン", "Target version")}: v${targetVersion}`,
    "",
    `${label("当前产物内容", "現在の成果物本文", "Current artifact content")}:`,
    artifact?.content || "-",
    "",
    `${label("成员成果证据", "メンバー成果エビデンス", "Member evidence")}:`,
    memberBlock || "-",
    "",
    label(`请先说明本次修订目标，然后输出 v${targetVersion} 完整产物；新版必须标注来源版本、来源指纹、主要变更、风险和下一步。`, `今回の改訂目的を先に示し、その後に v${targetVersion} の完全な成果物を出力してください。新版には元バージョン、元フィンガープリント、主な変更、リスク、次の一手を明記してください。`, `First state the revision objective, then output the complete v${targetVersion} artifact. Include source version, source fingerprint, key changes, risks, and next steps.`),
  ].join("\n").trim();
}

function buildWorkflowRecoveryPrompt(record, lang = "zh") {
  const item = normalizeWorkflowRecord(record);
  const label = (zh, ja, en) => lang === "ja" ? ja : lang === "en" ? en : zh;
  const completed = item.results
    .slice(0, 8)
    .map(result => `- ${result.member} · ${result.title}: ${result.summary || summarizeLine(result.text)}`)
    .join("\n");
  const failedMembers = item.members
    .filter(member => member.status === "failed")
    .map(member => `- ${member.name} · ${member.title} · ${member.model}${member.error ? ` · ${member.error}` : ""}`)
    .join("\n");
  const artifact = item.artifacts[0];
  return [
    label("请恢复以下失败或中断的历史工作流。", "以下の失敗または中断した過去ワークフローを復旧してください。", "Recover the failed or interrupted workflow below."),
    "",
    `${label("原任务", "元タスク", "Original task")}:`,
    item.task || "-",
    "",
    `${label("失败信息", "失敗情報", "Failure")}:`,
    item.error || item.status || "-",
    "",
    `${label("已完成成果", "完了済み成果", "Completed outputs")}:`,
    completed || "-",
    "",
    `${label("失败成员", "失敗メンバー", "Failed members")}:`,
    failedMembers || "-",
    "",
    `${label("已有整合产物", "既存の統合成果物", "Existing integrated artifact")}:`,
    artifact?.content || "-",
    "",
    label("请只重试失败或缺失部分，复用已完成成果和已有产物，不要覆盖旧版本；最后由 ARIA 整合新版产物并标注修复了哪些失败项。", "完了済み成果と既存成果物を再利用し、旧版を上書きせず、失敗または欠落部分だけを再試行してください。最後に ARIA が新版成果物として統合し、修復した失敗項目を明記してください。", "Retry only the failed or missing parts, reuse completed outputs and the existing artifact without overwriting the old version, then have ARIA integrate the updated artifact and state which failed items were fixed."),
  ].join("\n").trim();
}

function buildWorkflowEventRecoveryPrompt(record, actionIndex = 0, lang = "zh") {
  const item = normalizeWorkflowRecord(record);
  const label = (zh, ja, en) => lang === "ja" ? ja : lang === "en" ? en : zh;
  const actions = workflowEventRecoveryActions(item, lang);
  const action = actions[actionIndex] || actions[0] || null;
  const completed = item.results
    .slice(0, 8)
    .map(result => `- ${result.member} · ${result.title}: ${result.summary || summarizeLine(result.text)}`)
    .join("\n");
  return [
    label("请按以下执行事件恢复工作流，不要从零开始。", "以下の実行イベントに基づいてワークフローを復旧してください。最初からやり直さないでください。", "Recover the workflow from the execution event below. Do not restart from scratch."),
    "",
    `${label("原任务", "元タスク", "Original task")}:`,
    item.task || "-",
    "",
    `${label("恢复动作", "復旧アクション", "Recovery action")}: ${action?.label || "-"}`,
    `${label("目标成员", "対象メンバー", "Target member")}: ${action?.member || "-"}`,
    `${label("事件原因", "イベント理由", "Event reason")}: ${action?.detail || "-"}`,
    "",
    `${label("已完成成果", "完了済み成果", "Completed outputs")}:`,
    completed || "-",
    "",
    `${label("已有产物", "既存成果物", "Existing artifact")}:`,
    item.artifacts[0]?.content || "-",
    "",
    label("请只处理该事件对应的成员或确认点，保留已完成成果；最后输出新版整合产物，并说明本次恢复动作和仍需用户确认的风险。", "このイベントに対応するメンバーまたは確認点だけを処理し、完了済み成果を保持してください。最後に新版統合成果物を出し、今回の復旧アクションと残るユーザー確認リスクを明記してください。", "Handle only the member or confirmation point for this event, keep completed outputs, then produce an updated integrated artifact and state the recovery action plus any remaining user-confirmation risks."),
  ].join("\n").trim();
}

function workflowKnowledgeApprovalSummary(record, lang = "zh", { sourceType = "workflow_record", memoryStatus = "candidate", documentStatus = "candidate", artifactIndex = 0 } = {}) {
  const item = normalizeWorkflowRecord(record);
  const label = (zh, ja, en) => lang === "ja" ? ja : lang === "en" ? en : zh;
  const safeMemoryStatus = ["approved", "candidate"].includes(memoryStatus) ? memoryStatus : "candidate";
  const safeDocumentStatus = ["approved", "candidate"].includes(documentStatus) ? documentStatus : "candidate";
  const artifact = item.artifacts[artifactIndex] || item.artifacts[0] || null;
  const subject = sourceType === "workflow_artifact_version"
    ? `${label("产物版本", "成果物バージョン", "artifact version")} v${artifact?.version || artifactIndex + 1}${artifact?.hash ? ` · ${artifact.hash}` : ""}`
    : label("工作流记录", "ワークフロー記録", "workflow record");
  const evidence = sourceType === "workflow_artifact_version"
    ? `${label("状态", "状態", "status")} ${item.status} · ${label("标题", "タイトル", "title")} ${artifact?.title || item.title}`
    : `${label("状态", "状態", "status")} ${item.status} · ${label("成员", "メンバー", "members")} ${item.members.length} · ${label("产物", "成果物", "artifacts")} ${item.artifacts.length}`;
  return `${subject} · ${label("记忆", "メモリ", "memory")} ${safeMemoryStatus} · ${label("文档", "文書", "document")} ${safeDocumentStatus} · ${evidence}`;
}

function workflowKnowledgeIngestAction(sourceType = "workflow_record", memoryStatus = "candidate") {
  const source = sourceType === "workflow_artifact_version" ? "artifact_version" : "workflow_record";
  const status = memoryStatus === "approved" ? "approved" : "candidate";
  return `${source}_${status}`;
}

function buildWorkflowKnowledgePayload(record, lang = "zh", { memoryStatus = "approved", documentStatus = "approved" } = {}) {
  const item = normalizeWorkflowRecord(record);
  const label = (zh, ja, en) => lang === "ja" ? ja : lang === "en" ? en : zh;
  const title = `${label("工作流产物", "ワークフロー成果物", "Workflow artifact")} - ${item.title}`;
  const text = formatWorkflowRecordMarkdown(item, lang);
  const protocol = item.plan?.protocol || {};
  const memberNames = item.members.map(member => `${member.name || member.id}${member.title ? ` · ${member.title}` : ""}`).filter(Boolean);
  const workboardHandoffs = workflowWorkboardHandoffs(workflowWorkboardCards(item, lang));
  const safeMemoryStatus = ["approved", "candidate"].includes(memoryStatus) ? memoryStatus : "candidate";
  const safeDocumentStatus = ["approved", "candidate"].includes(documentStatus) ? documentStatus : "candidate";
  const approvalSummary = workflowKnowledgeApprovalSummary(item, lang, {
    sourceType:"workflow_record",
    memoryStatus:safeMemoryStatus,
    documentStatus:safeDocumentStatus,
  });
  return {
    document:{
      title,
      source:`workflow-archive:${item.source}`,
      text,
      status:safeDocumentStatus,
    },
    memory:{
      type:"artifact",
      title,
      content:[
        `workflowRecordId: ${item.id}`,
        `source: ${item.source}`,
        `status: ${item.status}`,
        protocol.task_type ? `taskType: ${protocol.task_type}` : "",
        protocol.priority ? `priority: ${protocol.priority}` : "",
        item.quality ? `qualityComplete: ${item.quality.complete ? "yes" : "no"}` : "",
        memberNames.length ? `members: ${memberNames.join(" / ")}` : "",
        workboardHandoffs.length ? `workboardHandoffs: ${workboardHandoffs.map(handoff => `${handoff.from || "-"} -> ${handoff.to || "-"} · ${handoff.status}${handoff.output ? ` · ${handoff.output}` : ""}`).join(" / ")}` : "",
        "",
        `${label("任务", "タスク", "Task")}:`,
        item.task || "-",
        "",
        `${label("整合产物", "統合成果物", "Integrated artifact")}:`,
        item.artifacts?.[0]?.content || "-",
      ].join("\n"),
      status:safeMemoryStatus,
      metadata:{
        workflowRecordId:item.id,
        sourceType:"workflow_record",
        source:item.source,
        approvalSummary,
        ingestAction:workflowKnowledgeIngestAction("workflow_record", safeMemoryStatus),
        ingestRequiresReview:safeMemoryStatus !== "approved",
        requiresApproval:safeMemoryStatus !== "approved" || safeDocumentStatus !== "approved",
        approvalState:safeMemoryStatus,
        documentState:safeDocumentStatus,
        status:item.status,
        taskType:protocol.task_type || "",
        priority:protocol.priority || "",
        qualityComplete:item.quality ? !!item.quality.complete : null,
        members:memberNames.slice(0, 24),
        workboardHandoffs:workboardHandoffs.slice(0, 24).map(handoff => ({
          from:handoff.from,
          to:handoff.to,
          status:handoff.status,
          output:handoff.output,
          ready:handoff.ready,
          blockedBy:handoff.blockedBy,
        })),
        artifactVersions:item.artifacts.map(artifact => ({
          version:artifact.version,
          hash:artifact.hash,
          title:artifact.title,
        })),
      },
    },
  };
}

function buildWorkflowArtifactKnowledgePayload(record, artifactIndex = 0, lang = "zh", { memoryStatus = "candidate", documentStatus = "candidate" } = {}) {
  const item = normalizeWorkflowRecord(record);
  const label = (zh, ja, en) => lang === "ja" ? ja : lang === "en" ? en : zh;
  const artifact = item.artifacts[artifactIndex] || item.artifacts[0] || null;
  const previousArtifact = artifactIndex > 0 ? item.artifacts[artifactIndex - 1] : null;
  const artifactVersion = artifact?.version || artifactIndex + 1;
  const safeMemoryStatus = ["approved", "candidate"].includes(memoryStatus) ? memoryStatus : "candidate";
  const safeDocumentStatus = ["approved", "candidate"].includes(documentStatus) ? documentStatus : "candidate";
  const approvalSummary = workflowKnowledgeApprovalSummary(item, lang, {
    sourceType:"workflow_artifact_version",
    memoryStatus:safeMemoryStatus,
    documentStatus:safeDocumentStatus,
    artifactIndex,
  });
  const title = `${label("工作流产物版本", "ワークフロー成果物バージョン", "Workflow artifact version")} - ${artifact?.title || item.title}`;
  const text = [
    `# ${artifact?.title || item.title}`,
    "",
    `- workflowRecordId: ${item.id}`,
    `- source: ${item.source}`,
    `- artifactVersion: v${artifactVersion}`,
    `- artifactHash: ${artifact?.hash || "-"}`,
    previousArtifact?.hash ? `- previousArtifactHash: ${previousArtifact.hash}` : "",
    `- nextVersion: v${artifactVersion + 1}`,
    `- workflowStatus: ${item.status}`,
    "",
    `## ${label("原任务", "元タスク", "Original task")}`,
    item.task || "-",
    "",
    `## ${label("产物内容", "成果物本文", "Artifact content")}`,
    artifact?.content || "-",
  ].join("\n").trim();
  return {
    document:{
      title,
      source:`workflow-artifact:${item.id}:${artifact?.hash || artifactIndex}`,
      text,
      status:safeDocumentStatus,
    },
    memory:{
      type:"artifact",
      title,
      content:text,
      status:safeMemoryStatus,
      metadata:{
        workflowRecordId:item.id,
        sourceType:"workflow_artifact_version",
        source:item.source,
        approvalSummary,
        ingestAction:workflowKnowledgeIngestAction("workflow_artifact_version", safeMemoryStatus),
        ingestRequiresReview:safeMemoryStatus !== "approved",
        requiresApproval:safeMemoryStatus !== "approved" || safeDocumentStatus !== "approved",
        approvalState:safeMemoryStatus,
        documentState:safeDocumentStatus,
        artifactVersion,
        artifactHash:artifact?.hash || "",
        previousArtifactHash:previousArtifact?.hash || "",
        nextVersion:artifactVersion + 1,
        artifactTitle:artifact?.title || item.title,
        status:item.status,
      },
    },
  };
}

function buildWorkflowRecordDetails(record, lang = "zh") {
  const item = normalizeWorkflowRecord(record);
  const label = (zh, ja, en) => lang === "ja" ? ja : lang === "en" ? en : zh;
  const workboardCards = workflowWorkboardCards(item, lang);
  const workboardSummary = workflowWorkboardSummary(workboardCards);
  const workboardHandoffs = workflowWorkboardHandoffs(workboardCards);
  return {
    overview:[
      { label:label("状态", "状態", "Status"), value:item.status },
      { label:label("来源", "ソース", "Source"), value:item.source },
      ...(item.trigger?.type ? [{ label:label("触发", "トリガー", "Trigger"), value:`${item.trigger.type}${item.trigger.automationId ? ` · ${item.trigger.automationId}` : ""}` }] : []),
      { label:label("更新时间", "更新時刻", "Updated"), value:item.updatedAt },
      { label:label("成员", "メンバー", "Members"), value:`${item.members.length}` },
    ],
    plan:item.plan?.steps?.length
      ? {
        title:label("调度计划", "調度計画", "Dispatch plan"),
        strategy:item.plan.strategy || "",
        protocol:item.plan.protocol || null,
        steps:item.plan.steps.slice(0, 8).map(step => `${step.order}. ${step.member} · ${step.title}${step.subtask ? ` · ${step.subtask}` : ""}`),
      }
      : null,
    modelUsage:item.modelUsage?.models?.length
      ? {
        title:label("模型调用", "モデル呼び出し", "Model calls"),
        external:item.modelUsage.external,
        lines:item.modelUsage.models.map(model => `${model.modelKey}${model.actualModel ? ` -> ${model.actualModel}` : ""}${model.provider ? ` · ${model.provider}` : ""}`),
        routeLines:[
          ...item.members
            .filter(member => member.model)
            .map(member => `${member.name || member.id || "-"} · ${member.title || "-"}: ${member.model} · ${member.status}`),
          ...item.events
            .filter(event => event.model)
            .map(event => `${event.member || "-"}: ${event.model} · ${event.type || "-"} · ${event.status || "-"}`),
        ].slice(-12),
        disclosure:workflowExternalDisclosureLines(item.modelUsage, lang),
      }
      : null,
    quality:item.quality || null,
    workboard:workboardCards.length
      ? {
        title:"Workboard",
        summary:workboardSummary,
        handoffs:workboardHandoffs.slice(0, 12).map(handoff => ({
          from:handoff.from || "",
          to:handoff.to || "",
          status:handoff.status || "",
          output:handoff.output || "",
          ready:!!handoff.ready,
          blockedBy:handoff.blockedBy || [],
        })),
        cards:workboardCards.slice(0, 8).map(card => ({
          title:`${card.member || "-"} · ${card.title || "-"}`,
          member:card.member || "",
          role:card.title || "",
          status:card.status,
          dependencyState:card.dependencyState,
          blockedBy:card.blockedBy || [],
          handoffTo:card.handoffTo || "",
          task:card.task || "",
          output:card.output || "",
        })),
      }
      : null,
    toolCalls:workflowToolCallChecklist(item, lang),
    recoveryActions:workflowEventRecoveryActions(item, lang),
    comments:item.comments.slice(-8).map(comment => ({
      title:`${comment.author || "human"} · ${comment.targetMember || comment.targetMemberId || "-"}`,
      meta:comment.at || "",
      detail:comment.text || "",
    })),
    events:item.events.slice(-8).map(event => ({
      title:`${event.type || "-"} · ${event.member || "-"}`,
      meta:`${event.model || "-"} · ${event.status || "-"}`,
      detail:event.detail || "",
    })),
    artifacts:item.artifacts.map(artifact => ({
      title:`v${artifact.version} · ${artifact.title}`,
      meta:`${artifact.kind} · ${artifact.hash}`,
      nextVersion:artifact.version + 1,
    })),
  };
}

function archiveWorkflowRecordSnapshot(record = {}, now = new Date().toISOString()) {
  return normalizeWorkflowRecord({
    ...record,
    status:"archived",
    updatedAt:now,
  });
}

function filterWorkflowRecordsByStatus(records = [], status = "all") {
  const safeStatus = `${status || "all"}`.toLowerCase();
  if (safeStatus === "all") return records;
  if (safeStatus === "needs_attention") return records.filter(record => workflowRecordNeedsAttention(record));
  return records.filter(record => normalizeWorkflowRecord(record).status === safeStatus);
}

function workflowRecordNeedsAttention(record = {}) {
  const item = normalizeWorkflowRecord(record);
  if (["failed", "partial_failed", "waiting_confirmation"].includes(item.status)) return true;
  if (item.error) return true;
  if (item.members.some(member => member.status === "failed")) return true;
  return workflowToolCallChecklist(item).needsAttention;
}

function workflowEventRecoveryActions(record = {}, lang = "zh") {
  const item = normalizeWorkflowRecord(record);
  const label = (zh, ja, en) => lang === "ja" ? ja : lang === "en" ? en : zh;
  const actions = [];
  for (const event of item.events) {
    const type = `${event.type || ""}`;
    if (type === "manual_confirmation") {
      actions.push({
        type:"manual_confirmation",
        member:event.member || "",
        label:label("人工确认后重投", "人間確認後に再投递", "Review manually before retry"),
        detail:event.detail || label("高风险投递需要确认后再执行。", "高リスク投递は確認後に再実行してください。", "High-risk handoff should be reviewed before retrying."),
      });
    } else if (type === "fallback_failed" || type === "member_failed") {
      actions.push({
        type:"retry_or_reassign",
        member:event.member || "",
        label:label("重试或改派该成员", "このメンバーを再試行または再割当", "Retry or reassign this member"),
        detail:event.detail || label("保留已完成成果，只恢复失败成员。", "完了済み成果を保持し、失敗メンバーだけ復旧します。", "Keep completed outputs and recover only the failed member."),
      });
    } else if (type === "auto_reassignment") {
      actions.push({
        type:"auto_reassignment",
        member:event.member || "",
        label:label("已自动改派", "自動再割当済み", "Automatically reassigned"),
        detail:event.model ? `${event.model}${event.detail ? ` · ${event.detail}` : ""}` : event.detail,
      });
    } else if (type === "workflow_execution_gate") {
      const localOnly = `${event.status || ""}` === "blocked_by_local_only";
      actions.push({
        type:localOnly ? "resolve_local_only_gate" : "resolve_execution_gate",
        member:event.member || "",
        label:localOnly
          ? label("处理 Local-only 阻塞", "Local-only ブロックを処理", "Resolve Local-only block")
          : label("完成权限确认后继续", "権限確認後に続行", "Confirm permissions then continue"),
        detail:event.detail || (localOnly
          ? label("先切换为本地整理任务，或明确关闭 Local-only 后再执行。", "まずローカル整理タスクへ切替えるか、Local-only を明示的に解除してから実行してください。", "Convert to local-only work or explicitly disable Local-only before execution.")
          : label("先完成外发、管理员或工具权限确认，再恢复该卡片执行。", "外部送信、管理者、またはツール権限確認を完了してからこのカードを復旧してください。", "Complete external-send, admin, or tool permission confirmation before resuming this card.")),
      });
    }
  }
  return actions.slice(-8);
}

function summarizeLine(text, limit = 220) {
  return `${text || ""}`.replace(/\s+/g, " ").trim().slice(0, limit);
}

function openWorkflowDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(WORKFLOW_DB_NAME, WORKFLOW_DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("records")) {
        const store = db.createObjectStore("records", { keyPath:"id" });
        store.createIndex("updatedAt", "updatedAt", { unique:false });
        store.createIndex("status", "status", { unique:false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function saveWorkflowRecord(record) {
  const item = normalizeWorkflowRecord(record);
  const db = await openWorkflowDb();
  await new Promise((resolve, reject) => {
    const request = db.transaction("records", "readwrite").objectStore("records").put(item);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
  db.close();
  await enforceWorkflowRecordLimit().catch(() => {});
  return item;
}

async function listWorkflowRecords({ limit = 20 } = {}) {
  const db = await openWorkflowDb();
  const items = await new Promise((resolve, reject) => {
    const request = db.transaction("records", "readonly").objectStore("records").getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
  db.close();
  return items
    .map(normalizeWorkflowRecord)
    .sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""))
    .slice(0, limit);
}

async function enforceWorkflowRecordLimit(limit = WORKFLOW_RECORD_LIMIT) {
  const items = await listWorkflowRecords({ limit: 1000 });
  const overflow = items.slice(limit);
  if (!overflow.length) return 0;
  const db = await openWorkflowDb();
  const tx = db.transaction("records", "readwrite");
  const store = tx.objectStore("records");
  for (const item of overflow) store.delete(item.id);
  await new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
  return overflow.length;
}

async function markWorkflowRecordArchived(id, now = new Date().toISOString()) {
  if (!id) throw new Error("Workflow record id is required.");
  const db = await openWorkflowDb();
  const updated = await new Promise((resolve, reject) => {
    const tx = db.transaction("records", "readwrite");
    const store = tx.objectStore("records");
    const getRequest = store.get(id);
    getRequest.onsuccess = () => {
      const existing = getRequest.result;
      if (!existing) {
        reject(new Error("Workflow record not found."));
        return;
      }
      const item = archiveWorkflowRecordSnapshot(existing, now);
      const putRequest = store.put(item);
      putRequest.onsuccess = () => resolve(item);
      putRequest.onerror = () => reject(putRequest.error);
    };
    getRequest.onerror = () => reject(getRequest.error);
  });
  db.close();
  return updated;
}

function deleteWorkflowArchive() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(WORKFLOW_DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("Workflow archive database is open in another tab."));
  });
}

export {
  WORKFLOW_DB_NAME,
  archiveWorkflowRecordSnapshot,
  artifactContentHash,
  deleteWorkflowArchive,
  buildWorkflowArtifactRevisionPrompt,
  buildWorkflowAttentionRecoveryPrompt,
  buildWorkflowArtifactKnowledgePayload,
  buildWorkflowContinuationPrompt,
  buildWorkflowEventRecoveryPrompt,
  buildWorkflowKnowledgePayload,
  buildWorkflowRecordDetails,
  buildWorkflowRecoveryPrompt,
  buildWorkflowRerunPrompt,
  filterWorkflowRecordsByStatus,
  formatWorkflowAuditMarkdown,
  formatWorkflowArtifactMarkdown,
  formatWorkflowRecordMarkdown,
  listWorkflowRecords,
  markWorkflowRecordArchived,
  normalizeWorkflowRecord,
  saveWorkflowRecord,
};
