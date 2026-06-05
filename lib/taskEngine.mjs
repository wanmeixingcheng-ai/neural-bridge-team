export const WORKFLOW_STATUS_LABELS = {
  zh: { idle:"待命中", planning:"待规划", dispatched:"已分派", waiting_confirmation:"等待确认", running:"执行中", summarizing:"汇总中", done:"已完成", partial_failed:"部分失败", failed:"失败", archived:"已归档", stopped:"已停止", queued:"待执行", working:"执行中", complete:"已完成" },
  ja: { idle:"待機中", planning:"計画待ち", dispatched:"割当済み", waiting_confirmation:"確認待ち", running:"実行中", summarizing:"統合中", done:"完了", partial_failed:"一部失敗", failed:"失敗", archived:"アーカイブ済み", stopped:"停止", queued:"待機", working:"実行中", complete:"完了" },
  en: { idle:"Ready", planning:"Planning", dispatched:"Dispatched", waiting_confirmation:"Waiting for confirmation", running:"Running", summarizing:"Summarizing", done:"Done", partial_failed:"Partial failure", failed:"Failed", archived:"Archived", stopped:"Stopped", queued:"Queued", working:"Working", complete:"Done" },
};

export const WORKFLOW_LIFECYCLE_STATUSES = ["planning", "dispatched", "running", "waiting_confirmation", "done", "partial_failed", "failed", "archived"];

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
    comments:[],
    error:"",
    progress:{ done:0, total:0 },
  };
}

export function workflowStatusLabel(lang, status) {
  return WORKFLOW_STATUS_LABELS[lang]?.[status] || WORKFLOW_STATUS_LABELS.zh[status] || status;
}

export function workflowLifecycleSteps(mode = "idle", lang = "zh") {
  const effectiveMode = mode === "summarizing" ? "running" : mode;
  const currentIndex = WORKFLOW_LIFECYCLE_STATUSES.indexOf(effectiveMode);
  return WORKFLOW_LIFECYCLE_STATUSES.map((status, index) => {
    let state = "pending";
    if (effectiveMode === "done") state = index <= WORKFLOW_LIFECYCLE_STATUSES.indexOf("done") ? "complete" : "pending";
    else if (effectiveMode === "partial_failed") state = status === "partial_failed" ? "current" : index <= WORKFLOW_LIFECYCLE_STATUSES.indexOf("done") ? "complete" : "pending";
    else if (effectiveMode === "failed") state = status === "failed" ? "current" : index < WORKFLOW_LIFECYCLE_STATUSES.indexOf("failed") ? "complete" : "pending";
    else if (effectiveMode === "archived") state = index <= WORKFLOW_LIFECYCLE_STATUSES.indexOf("archived") ? "complete" : "pending";
    else if (currentIndex >= 0) state = index < currentIndex ? "complete" : index === currentIndex ? "current" : "pending";
    return {
      status,
      label:workflowStatusLabel(lang, status),
      state,
    };
  });
}

export function workflowQueueSummary(members = []) {
  const list = Array.isArray(members) ? members : [];
  const queued = list.filter(member => member.status === "queued");
  const working = list.filter(member => member.status === "working");
  const complete = list.filter(member => member.status === "complete");
  const failed = list.filter(member => member.status === "failed");
  const remaining = list.filter(member => !["complete", "failed"].includes(member.status));
  const next = working[0] || queued[0] || null;
  const nextAction = failed.length
    ? "retry_failed"
    : next
      ? "continue_queue"
      : list.length && complete.length === list.length
        ? "ready_to_integrate"
        : remaining.length
          ? "review_queue"
          : "idle";
  return {
    total:list.length,
    queued:queued.length,
    working:working.length,
    complete:complete.length,
    failed:failed.length,
    remaining:remaining.length,
    needsAttention:failed.length > 0 || (list.length > 0 && complete.length + failed.length < list.length && !next),
    completionRate:list.length ? Math.round((complete.length / list.length) * 100) : 0,
    nextAction,
    next:next ? {
      id:next.id || "",
      name:next.name || next.id || "",
      title:next.title || "",
      status:next.status || "",
    } : null,
  };
}

export function workflowWorkboardCards(workflow = {}, lang = "zh") {
  const label = (zh, ja, en) => lang === "ja" ? ja : lang === "en" ? en : zh;
  const members = Array.isArray(workflow.members) ? workflow.members : [];
  const steps = Array.isArray(workflow.plan?.steps) ? workflow.plan.steps : [];
  const comments = Array.isArray(workflow.comments) ? workflow.comments : [];
  const progressByStatus = { complete:100, working:50, failed:0, queued:0 };
  const memberKeys = member => [
    member.id,
    member.name,
    member.title,
    member.member,
  ].filter(Boolean).map(value => `${value}`.trim().toLowerCase());
  const stepKeys = step => [
    step.memberId,
    step.member,
    step.title,
  ].filter(Boolean).map(value => `${value}`.trim().toLowerCase());
  const matchesKey = (keys, value) => keys.includes(`${value || ""}`.trim().toLowerCase());
  const memberByDependency = dependency => members.find(member => memberKeys(member).some(key => key === `${dependency || ""}`.trim().toLowerCase()));
  return members.map((member, index) => {
    const step = steps.find(item =>
      item.memberId === member.id ||
      item.member === member.name ||
      item.member === member.id ||
      item.title === member.title
    ) || {};
    const keys = [...memberKeys(member), ...stepKeys(step)];
    const dependencies = Array.isArray(step.dependencies) ? step.dependencies : [];
    const blockedBy = dependencies
      .map(dependency => {
        const dependencyMember = memberByDependency(dependency);
        if (!dependencyMember) return `${dependency || ""}`.trim();
        return dependencyMember.status === "complete" ? "" : (dependencyMember.name || dependencyMember.id || dependency);
      })
      .filter(Boolean);
    const dependencyState = dependencies.length === 0
      ? "none"
      : blockedBy.length
        ? "blocked"
        : "ready";
    const downstreamSteps = steps.filter(item =>
      Array.isArray(item.dependencies) &&
      item.dependencies.some(dependency => matchesKey(keys, dependency))
    );
    const nextStep = downstreamSteps[0] || steps.find(item => Number(item.order) === Number(step.order || index + 1) + 1) || null;
    const cardComments = comments
      .filter(item => !item.targetMemberId || item.targetMemberId === member.id || item.targetMember === member.name)
      .slice(-6);
    const agentComment = member.error || member.summary || "";
    return {
      id:member.id || step.memberId || `member-${index}`,
      member:member.name || step.member || member.id || "",
      title:member.title || step.title || "",
      status:member.status || "queued",
      progress:progressByStatus[member.status] ?? 0,
      task:member.task || step.subtask || step.purpose || "",
      input:step.input || workflow.task || "",
      output:step.output || "",
      dependencies,
      dependencyState,
      blockedBy,
      acceptanceCriteria:step.acceptanceCriteria || "",
      handoffTo:nextStep ? `${nextStep.member || nextStep.memberId || ""}${nextStep.title ? ` · ${nextStep.title}` : ""}` : label("ARIA 整合", "ARIA 統合", "ARIA integration"),
      downstream:downstreamSteps.map(item => `${item.member || item.memberId || ""}${item.title ? ` · ${item.title}` : ""}`).filter(Boolean),
      agentComment,
      comments:cardComments,
    };
  });
}

export function workflowWorkboardSummary(cards = []) {
  const list = Array.isArray(cards) ? cards : [];
  const blocked = list.filter(card => card.dependencyState === "blocked");
  const ready = list.filter(card => card.dependencyState !== "blocked" && ["queued", "working"].includes(card.status));
  const working = list.filter(card => card.status === "working");
  const done = list.filter(card => card.status === "complete");
  const failed = list.filter(card => card.status === "failed");
  const handoffs = workflowWorkboardHandoffs(list);
  const next = working[0] || ready[0] || blocked[0] || null;
  return {
    total:list.length,
    ready:ready.length,
    blocked:blocked.length,
    working:working.length,
    done:done.length,
    failed:failed.length,
    completionRate:list.length ? Math.round((done.length / list.length) * 100) : 0,
    handoffReady:handoffs.filter(handoff => handoff.ready).length,
    handoffBlocked:handoffs.filter(handoff => ["blocked_source", "failed_source"].includes(handoff.status)).length,
    needsAttention:failed.length > 0 || blocked.length > 0,
    nextCard:next ? {
      id:next.id,
      member:next.member,
      title:next.title,
      status:next.status,
      dependencyState:next.dependencyState,
      blockedBy:next.blockedBy || [],
    } : null,
    nextAction:failed.length
      ? "retry_failed"
      : working.length
        ? "monitor_working"
        : ready.length
          ? "start_ready"
          : blocked.length
            ? "wait_dependencies"
            : list.length
              ? "integrate"
              : "idle",
  };
}

export function workflowWorkboardHandoffs(cards = []) {
  const list = Array.isArray(cards) ? cards : [];
  return list.flatMap(card => {
    const downstream = Array.isArray(card.downstream) && card.downstream.length
      ? card.downstream
      : card.handoffTo
        ? [card.handoffTo]
        : [];
    return downstream
      .filter(Boolean)
      .map(target => {
        const status = card.status === "failed"
          ? "failed_source"
          : card.dependencyState === "blocked"
            ? "blocked_source"
            : card.status === "complete"
              ? "ready"
              : card.status === "working"
                ? "in_progress"
                : "waiting_source";
        return {
          from:`${card.member || card.id || ""}${card.title ? ` · ${card.title}` : ""}`.trim(),
          to:target,
          status,
          output:card.output || "",
          ready:status === "ready",
          blockedBy:Array.isArray(card.blockedBy) ? card.blockedBy : [],
        };
      });
  });
}

export function buildWorkboardCardActionPrompt(workflow = {}, card = {}, action = "continue", lang = "zh") {
  const label = (zh, ja, en) => lang === "ja" ? ja : lang === "en" ? en : zh;
  const packet = buildWorkboardExecutionPacket(workflow, card, lang);
  const recentComments = Array.isArray(card.comments) ? card.comments.slice(-4) : [];
  const actionIntro = {
    retry: label("请重试以下 Workboard 任务卡。不要重跑整个工作流，只处理这张卡及其必要下游交付。", "以下の Workboard タスクカードを再試行してください。ワークフロー全体をやり直さず、このカードと必要な下流引き渡しだけを処理してください。", "Retry the Workboard task card below. Do not rerun the whole workflow; handle only this card and required downstream handoff."),
    unblock: label("请解除以下 Workboard 任务卡的依赖阻塞。先处理阻塞来源，再继续这张卡，不要丢弃已完成成员成果。", "以下の Workboard タスクカードの依存ブロックを解除してください。まずブロック元を処理し、その後このカードを続行し、完了済み成果を破棄しないでください。", "Unblock the Workboard task card below. Resolve the blocking dependency first, then continue this card without discarding completed outputs."),
    continue: label("请继续推进以下 Workboard 任务卡。只执行这张卡的明确子任务，并把输出交付给下游成员或 ARIA 整合。", "以下の Workboard タスクカードを続行してください。このカードの明確なサブタスクだけを実行し、出力を下流メンバーまたは ARIA 統合へ引き渡してください。", "Continue the Workboard task card below. Execute only this card's explicit subtask and hand the output to the downstream member or ARIA integration."),
  }[action] || label("请继续推进以下 Workboard 任务卡。", "以下の Workboard タスクカードを続行してください。", "Continue the Workboard task card below.");
  return [
    actionIntro,
    "",
    `${label("原工作流", "元ワークフロー", "Source workflow")}: ${workflow.title || workflow.task || "-"}`,
    `${label("工作流状态", "ワークフロー状態", "Workflow status")}: ${workflow.mode || workflow.status || "-"}`,
    "",
    `${label("任务卡", "タスクカード", "Task card")}: ${card.member || "-"} · ${card.title || "-"}`,
    `${label("卡片状态", "カード状態", "Card status")}: ${card.status || "-"} · ${label("依赖状态", "依存状態", "Dependency")}: ${card.dependencyState || "-"}`,
    `${label("子任务", "サブタスク", "Subtask")}: ${card.task || "-"}`,
    `${label("输入", "入力", "Input")}: ${card.input || "-"}`,
    `${label("预期输出", "期待出力", "Expected output")}: ${card.output || "-"}`,
    `${label("依赖", "依存", "Dependencies")}: ${card.dependencies?.length ? card.dependencies.join(" / ") : "-"}`,
    `${label("阻塞来源", "ブロック元", "Blocked by")}: ${card.blockedBy?.length ? card.blockedBy.join(" / ") : "-"}`,
    `${label("交付对象", "引き渡し先", "Handoff to")}: ${card.handoffTo || "-"}`,
    `${label("验收标准", "受入条件", "Acceptance criteria")}: ${card.acceptanceCriteria || "-"}`,
    card.agentComment ? `${label("已有成员摘要", "既存メンバー要約", "Existing member summary")}: ${card.agentComment}` : "",
    recentComments.length ? `${label("最近评论", "最近コメント", "Recent comments")}: ${recentComments.map(comment => `${comment.author || "human"}: ${comment.text || ""}`).join(" / ")}` : "",
    "",
    `## ${label("执行包", "実行パッケージ", "Execution packet")}`,
    `${label("状态", "状態", "Status")}: ${packet.status} · ${label("可执行", "実行可", "Executable")}: ${packet.canExecute ? "yes" : "no"}`,
    `${label("所需工具", "必要ツール", "Required tools")}: ${packet.requiredTools.length ? packet.requiredTools.map(tool => `${tool.name} · ${tool.status} · ${tool.permission}`).join(" / ") : "-"}`,
    `${label("阻塞项", "ブロッカー", "Blockers")}: ${packet.blockers.length ? packet.blockers.map(blocker => `${blocker.name || blocker.id} · ${blocker.status}`).join(" / ") : "-"}`,
    `${label("输出契约", "出力契約", "Output contract")}: ${packet.outputContract}`,
    "",
    label("输出必须是可直接进入下一张卡或最终整合的产物；不要只解释计划。", "出力は次のカードまたは最終統合へ直接渡せる成果物にしてください。計画説明だけで終わらないでください。", "The output must be an artifact that can move directly to the next card or final integration; do not stop at planning."),
  ].filter(line => line !== "").join("\n").trim();
}

export function buildWorkboardCardActionEvent(card = {}, action = "continue", at = new Date().toISOString()) {
  return {
    at,
    type:"workboard_card_action",
    member:card.member || card.id || "",
    model:"",
    status:action,
    detail:[
      `${card.title || ""}`.trim(),
      card.dependencyState ? `dependency=${card.dependencyState}` : "",
      card.blockedBy?.length ? `blocked_by=${card.blockedBy.join(" / ")}` : "",
      card.handoffTo ? `handoff=${card.handoffTo}` : "",
    ].filter(Boolean).join(" · ").slice(0, 1000),
  };
}

export function buildWorkboardCommentEvent(comment = {}, at = comment.at || new Date().toISOString()) {
  return {
    at,
    type:"workboard_comment",
    member:comment.targetMember || comment.targetMemberId || "",
    model:"",
    status:comment.author || "human",
    detail:[
      comment.targetMemberId ? `card=${comment.targetMemberId}` : "",
      comment.text ? `${comment.text}` : "",
    ].filter(Boolean).join(" · ").slice(0, 1000),
  };
}

export function workflowQualityCheck(workers = [], results = []) {
  const resultKeys = new Set((Array.isArray(results) ? results : []).flatMap(result => [
    `${result.member || ""}`.trim(),
    `${result.name || ""}`.trim(),
    `${result.title || ""}`.trim(),
  ].filter(Boolean)));
  const missingMembers = (Array.isArray(workers) ? workers : [])
    .filter(worker => {
      const names = [`${worker.name || ""}`.trim(), `${worker.member || ""}`.trim(), `${worker.title || ""}`.trim()].filter(Boolean);
      return !names.some(name => resultKeys.has(name));
    })
    .map(worker => ({
      id:worker.id || "",
      name:worker.name || worker.member || "",
      title:worker.title || "",
    }));
  return {
    complete:missingMembers.length === 0,
    missingMembers,
  };
}

export function workflowFailureReassignmentPlan(members = [], lang = "zh") {
  const label = (zh, ja, en) => lang === "ja" ? ja : lang === "en" ? en : zh;
  const failed = (Array.isArray(members) ? members : []).filter(member => member.status === "failed" || member.error);
  const actions = failed.map(member => {
    const model = `${member.model || ""}`.toLowerCase();
    const toModel = model === "claude"
      ? "gemma26"
      : model === "gemma31"
        ? "gemma26"
        : model === "gemma26" || model === "flash"
          ? "claude"
          : model === "codex"
            ? "manual_confirmation"
            : "gemma26";
    const reason = model === "codex"
      ? label("Codex 投递或执行失败时，先转人工确认后再重新投递。", "Codex 投递または実行失敗時は、先に人間確認へ回してから再投递します。", "When Codex handoff or execution fails, route to human confirmation before dispatching again.")
      : model === "claude"
        ? label("Claude 不可用或繁忙时，转 Gemma 4 26B 继续产出。", "Claude が利用不可または混雑時は、Gemma 4 26B に切り替えて続行します。", "When Claude is unavailable or busy, switch to Gemma 4 26B to continue.")
        : label("当前模型失败时，切换到备选模型并保留已完成成果。", "現在モデル失敗時は、代替モデルへ切り替え、完了済み成果を保持します。", "When the current model fails, switch to the fallback model and keep completed outputs.");
    return {
      memberId:member.id || "",
      name:member.name || member.member || member.id || "",
      title:member.title || "",
      fromModel:member.model || "",
      toModel,
      action:toModel === "manual_confirmation" ? "manual_confirmation" : "model_fallback",
      reason,
    };
  });
  return {
    needed:actions.length > 0,
    actions,
  };
}

export function workflowFallbackModelForMember(member = {}, lang = "zh") {
  const action = workflowFailureReassignmentPlan([{ ...member, status:"failed" }], lang).actions[0];
  return action || {
    memberId:member.id || "",
    name:member.name || member.member || member.id || "",
    title:member.title || "",
    fromModel:member.model || "",
    toModel:"gemma26",
    action:"model_fallback",
    reason:"",
  };
}

export function workflowAuditSummary(workflow = {}, lang = "zh") {
  const label = (zh, ja, en) => lang === "ja" ? ja : lang === "en" ? en : zh;
  const members = Array.isArray(workflow.members) ? workflow.members : [];
  const artifacts = Array.isArray(workflow.artifacts) ? workflow.artifacts : [];
  const models = Array.isArray(workflow.modelUsage?.models) ? workflow.modelUsage.models : [];
  const providers = Array.isArray(workflow.modelUsage?.providers) ? workflow.modelUsage.providers.filter(Boolean) : [];
  const requiresConfirmation = workflow.mode === "waiting_confirmation" || !!workflow.plan?.protocol?.needs_user_confirmation;
  const lines = [
    `${label("操作者", "実行者", "Actor")}: ${label("当前登录用户", "現在のログインユーザー", "current signed-in user")}`,
    `${label("任务状态", "タスク状態", "Task status")}: ${workflowStatusLabel(lang, workflow.mode || "idle")}`,
    `${label("执行成员", "実行メンバー", "Assigned members")}: ${members.length}`,
    `${label("外部模型", "外部モデル", "External models")}: ${workflow.modelUsage?.external ? providers.join(" / ") || label("已记录", "記録済み", "recorded") : label("无", "なし", "none")}`,
    `${label("高风险确认", "高リスク確認", "High-risk confirmation")}: ${requiresConfirmation ? label("需要", "必要", "required") : label("不需要", "不要", "not required")}`,
    `${label("产物版本", "成果物バージョン", "Artifact versions")}: ${artifacts.length}`,
  ];
  if (workflow.quality) {
    lines.push(`${label("成果检查", "成果チェック", "Output check")}: ${workflow.quality.complete ? label("完整", "完全", "complete") : label("有缺失", "不足あり", "missing outputs")}`);
  }
  return {
    external:!!workflow.modelUsage?.external,
    requiresConfirmation,
    lines,
    models:models.map(model => `${model.modelKey || ""}${model.provider ? ` · ${model.provider}` : ""}`).filter(Boolean),
  };
}

export function workflowPermissionChecklist(workflow = {}, lang = "zh") {
  const label = (zh, ja, en) => lang === "ja" ? ja : lang === "en" ? en : zh;
  const task = `${workflow.task || workflow.title || ""}`;
  const protocol = workflow.plan?.protocol || {};
  const modelUsage = workflow.modelUsage || {};
  const localOnlyMode = !!modelUsage.localOnlyMode;
  const hasCodex = Array.isArray(workflow.members) && workflow.members.some(member => `${member.model || ""}`.toLowerCase() === "codex");
  const hasDeploy = taskMatches(task, ["部署", "上线", "vercel", "deploy", "publish"]);
  const entries = [
    {
      id:"external-models",
      label:label("外部模型调用", "外部モデル呼び出し", "External model calls"),
      status:localOnlyMode && modelUsage.external ? "blocked_by_local_only" : modelUsage.external ? "needs_disclosure" : "ok",
      detail:localOnlyMode && modelUsage.external
        ? label("Local-only 已开启，外部模型调用会被阻止。", "Local-only が有効なため、外部モデル呼び出しはブロックされます。", "Local-only is enabled, so external model calls are blocked.")
        : modelUsage.external
        ? label("会外发任务文本、成员子任务和必要上下文。", "タスク本文、メンバーサブタスク、必要文脈を外部送信します。", "Task text, member subtasks, and necessary context may be sent externally.")
        : label("未记录外部模型提供商。", "外部モデル提供元は記録されていません。", "No external model provider recorded."),
    },
    {
      id:"high-risk-confirmation",
      label:label("高风险操作确认", "高リスク操作確認", "High-risk operation confirmation"),
      status:protocol.needs_user_confirmation ? "needs_confirmation" : "ok",
      detail:protocol.needs_user_confirmation
        ? label("继续前需要用户确认。", "続行前にユーザー確認が必要です。", "User confirmation is required before continuing.")
        : label("当前计划未要求额外确认。", "現在の計画では追加確認は不要です。", "No extra confirmation required by the current plan."),
    },
    {
      id:"codex-dispatch",
      label:label("Codex 任务投递", "Codex タスク投递", "Codex task dispatch"),
      status:localOnlyMode && hasCodex ? "blocked_by_local_only" : hasCodex ? "admin_required" : "ok",
      detail:localOnlyMode && hasCodex
        ? label("Local-only 已开启，Codex/GitHub 投递会被取消。", "Local-only が有効なため、Codex/GitHub 投递はキャンセルされます。", "Local-only is enabled, so Codex/GitHub dispatch is canceled.")
        : hasCodex
        ? label("投递到 GitHub/Codex 队列前需要管理员 token 和确认。", "GitHub/Codex キュー投递前に管理者 token と確認が必要です。", "Administrator token and confirmation are required before GitHub/Codex queue dispatch.")
        : label("未分派 Codex 执行成员。", "Codex 実行メンバーは割当られていません。", "No Codex execution member assigned."),
    },
    {
      id:"deployment",
      label:label("部署/发布动作", "デプロイ/公開操作", "Deployment/publish action"),
      status:localOnlyMode && hasDeploy ? "blocked_by_local_only" : hasDeploy ? "admin_required" : "ok",
      detail:localOnlyMode && hasDeploy
        ? label("Local-only 已开启，远程部署动作会被阻止。", "Local-only が有効なため、リモートデプロイはブロックされます。", "Local-only is enabled, so remote deployment is blocked.")
        : hasDeploy
        ? label("真正部署前必须再次确认外发和系统变更。", "実デプロイ前に外部送信とシステム変更の再確認が必要です。", "External transfer and system changes must be confirmed again before real deployment.")
        : label("未检测到部署或发布意图。", "デプロイまたは公開意図は検出されていません。", "No deployment or publish intent detected."),
    },
  ];
  return {
    blocked:entries.some(entry => entry.status === "needs_confirmation" || entry.status === "admin_required" || entry.status === "blocked_by_local_only"),
    entries,
  };
}

export function workflowOutputQaChecklist(workflow = {}, lang = "zh") {
  const label = (zh, ja, en) => lang === "ja" ? ja : lang === "en" ? en : zh;
  const artifacts = Array.isArray(workflow.artifacts) ? workflow.artifacts : [];
  const members = Array.isArray(workflow.members) ? workflow.members : [];
  const completeMembers = members.filter(member => member.status === "complete");
  const modelUsageRecorded = !!workflow.modelUsage?.models?.length;
  const qualityComplete = workflow.quality ? !!workflow.quality.complete : completeMembers.length > 0 && completeMembers.length === members.length;
  const checks = [
    {
      id:"artifact-present",
      label:label("最终产物", "最終成果物", "Final artifact"),
      passed:artifacts.some(artifact => `${artifact.content || ""}`.trim().length > 0),
      detail:artifacts.length ? label("已生成可导出的产物。", "エクスポート可能な成果物があります。", "Exportable artifact is present.") : label("尚未生成产物。", "成果物はまだありません。", "No artifact generated yet."),
    },
    {
      id:"member-outputs",
      label:label("成员成果", "メンバー成果", "Member outputs"),
      passed:qualityComplete,
      detail:qualityComplete ? label("分派成员成果完整。", "割当メンバーの成果は揃っています。", "Assigned member outputs are complete.") : label("存在缺失或未完成成员成果。", "不足または未完了のメンバー成果があります。", "Some member outputs are missing or incomplete."),
    },
    {
      id:"model-disclosure",
      label:label("模型披露", "モデル開示", "Model disclosure"),
      passed:modelUsageRecorded,
      detail:modelUsageRecorded ? label("已记录模型调用路径。", "モデル呼び出し経路を記録済みです。", "Model call path is recorded.") : label("尚未记录模型调用路径。", "モデル呼び出し経路は未記録です。", "Model call path is not recorded."),
    },
    {
      id:"language-consistency",
      label:label("语言一致", "言語一貫性", "Language consistency"),
      passed:!!workflow.language || !!lang,
      detail:label("按当前工作台语言生成和展示。", "現在のワークスペース言語で生成・表示します。", "Generated and shown in the current workspace language."),
    },
  ];
  return {
    passed:checks.every(check => check.passed),
    checks,
  };
}

export function workflowToolCallChecklist(workflow = {}, lang = "zh") {
  const label = (zh, ja, en) => lang === "ja" ? ja : lang === "en" ? en : zh;
  const task = `${workflow.task || workflow.title || ""}`;
  const modelUsage = workflow.modelUsage || {};
  const localOnlyMode = !!modelUsage.localOnlyMode;
  const members = Array.isArray(workflow.members) ? workflow.members : [];
  const artifacts = Array.isArray(workflow.artifacts) ? workflow.artifacts : [];
  const hasCodex = members.some(member => `${member.model || ""}`.toLowerCase() === "codex");
  const hasWeb = taskMatches(task, ["http://", "https://", "网页", "网站", "url", "web", "fetch", "抓取", "读取链接"]);
  const hasDeploy = taskMatches(task, ["部署", "上线", "vercel", "deploy", "publish"]);
  const hasKnowledge = !!workflow.plan?.protocol?.expected_outputs?.length || artifacts.length > 0;
  const entries = [
    {
      id:"model-gateway",
      name:label("模型网关", "モデルゲートウェイ", "Model gateway"),
      permission:modelUsage.external ? "external" : "local",
      status:localOnlyMode && modelUsage.external ? "blocked_by_local_only" : modelUsage.models?.length ? "recorded" : "pending",
      detail:localOnlyMode && modelUsage.external ? label("Local-only 阻止外部模型调用。", "Local-only が外部モデル呼び出しをブロックします。", "Local-only blocks external model calls.") : modelUsage.external ? label("调用外部模型提供商。", "外部モデル提供元を呼び出します。", "Calls external model providers.") : label("未记录外部模型调用。", "外部モデル呼び出しは未記録です。", "No external model call recorded."),
    },
    {
      id:"knowledge",
      name:label("知识库/长期记忆", "知識庫/長期記憶", "Knowledge and memory"),
      permission:"local",
      status:hasKnowledge ? "available" : "optional",
      detail:hasKnowledge ? label("产物可入库并用于后续检索。", "成果物を知識庫に保存し後続検索に使えます。", "Artifacts can be added to knowledge for future retrieval.") : label("当前未生成可入库产物。", "現在、保存可能な成果物はありません。", "No artifact ready for knowledge ingestion yet."),
    },
    {
      id:"web-fetch",
      name:label("网页读取", "Web読取", "Web fetch"),
      permission:"external",
      status:localOnlyMode && hasWeb ? "blocked_by_local_only" : hasWeb ? "needs_confirmation" : "not_needed",
      detail:localOnlyMode && hasWeb ? label("Local-only 阻止网页读取代理。", "Local-only が Web 読取プロキシをブロックします。", "Local-only blocks the web fetch proxy.") : hasWeb ? label("读取网页会把 URL 发送到服务端代理。", "Web読取は URL をサーバープロキシへ送信します。", "Fetching pages sends URLs to the server proxy.") : label("未检测到网页读取需求。", "Web読取の必要は検出されていません。", "No web fetch need detected."),
    },
    {
      id:"codex-dispatch",
      name:label("Codex/GitHub 投递", "Codex/GitHub 投递", "Codex/GitHub dispatch"),
      permission:"admin",
      status:localOnlyMode && hasCodex ? "blocked_by_local_only" : hasCodex ? "needs_admin" : "not_needed",
      detail:localOnlyMode && hasCodex ? label("Local-only 阻止 Codex/GitHub 投递。", "Local-only が Codex/GitHub 投递をブロックします。", "Local-only blocks Codex/GitHub dispatch.") : hasCodex ? label("需要管理员 token 和投递确认。", "管理者 token と投递確認が必要です。", "Requires admin token and dispatch confirmation.") : label("未分派 Codex 执行。", "Codex 実行は割当られていません。", "No Codex execution assigned."),
    },
    {
      id:"vercel-deploy",
      name:label("Vercel 部署", "Vercel デプロイ", "Vercel deploy"),
      permission:"admin",
      status:localOnlyMode && hasDeploy ? "blocked_by_local_only" : hasDeploy ? "needs_admin" : "not_needed",
      detail:localOnlyMode && hasDeploy ? label("Local-only 阻止远程部署。", "Local-only がリモートデプロイをブロックします。", "Local-only blocks remote deploy.") : hasDeploy ? label("真正部署前必须确认生产变更。", "実デプロイ前に本番変更確認が必要です。", "Production changes must be confirmed before real deploy.") : label("未检测到部署动作。", "デプロイ操作は検出されていません。", "No deploy action detected."),
    },
  ];
  return {
    needsAttention:entries.some(entry => ["needs_confirmation", "needs_admin", "blocked_by_local_only"].includes(entry.status)),
    entries,
  };
}

export function workflowExecutionReadiness(workflow = {}, lang = "zh") {
  const label = (zh, ja, en) => lang === "ja" ? ja : lang === "en" ? en : zh;
  const cards = workflowWorkboardCards(workflow, lang);
  const summary = workflowWorkboardSummary(cards);
  const toolCalls = workflowToolCallChecklist(workflow, lang);
  const blockers = toolCalls.entries
    .filter(entry => ["blocked_by_local_only", "needs_admin", "needs_confirmation"].includes(entry.status))
    .map(entry => ({
      id:entry.id,
      name:entry.name,
      status:entry.status,
      permission:entry.permission,
      detail:entry.detail,
    }));
  const failedCard = cards.find(card => card.status === "failed") || null;
  const readyCard = cards.find(card => card.dependencyState !== "blocked" && ["queued", "working"].includes(card.status)) || null;
  const blockedCard = cards.find(card => card.dependencyState === "blocked") || null;
  const nextCard = failedCard || readyCard || blockedCard || null;
  const blockedByLocalOnly = blockers.some(item => item.status === "blocked_by_local_only");
  const needsConfirmation = blockers.some(item => ["needs_admin", "needs_confirmation"].includes(item.status));
  const status = blockedByLocalOnly
    ? "blocked_by_local_only"
    : needsConfirmation
      ? "waiting_permission"
      : failedCard
        ? "retry_ready"
        : readyCard
          ? "ready_to_execute"
          : blockedCard
            ? "waiting_dependencies"
            : cards.length
              ? "ready_to_integrate"
              : "idle";
  const action = {
    blocked_by_local_only:label("关闭 Local-only 或改成本地整理任务。", "Local-only を解除するかローカル整理タスクへ変更してください。", "Disable Local-only or convert the task to local-only work."),
    waiting_permission:label("先完成权限/外发确认，再执行工具动作。", "権限/外部送信確認を先に完了してからツール操作を実行してください。", "Complete permission/external-send confirmation before executing tools."),
    retry_ready:label("优先重试失败卡片或按改派方案恢复。", "失敗カードを優先して再試行、または再割当案で復旧してください。", "Retry the failed card or recover using reassignment."),
    ready_to_execute:label("可以执行下一张 Workboard 卡片。", "次の Workboard カードを実行できます。", "The next Workboard card is executable."),
    waiting_dependencies:label("等待上游卡片完成并交付产物。", "上流カードの完了と成果物引き渡しを待機します。", "Wait for upstream cards to finish and hand off outputs."),
    ready_to_integrate:label("成员卡片已处理，可进入 ARIA 整合。", "メンバーカード処理済み、ARIA 統合へ進めます。", "Member cards are handled; proceed to ARIA integration."),
    idle:label("暂无可执行工作流。", "実行可能なワークフローはありません。", "No executable workflow yet."),
  }[status];
  return {
    status,
    canExecute:["retry_ready", "ready_to_execute", "ready_to_integrate"].includes(status),
    needsPermission:needsConfirmation,
    blockedByLocalOnly,
    action,
    nextCard:nextCard ? {
      id:nextCard.id,
      member:nextCard.member,
      title:nextCard.title,
      status:nextCard.status,
      dependencyState:nextCard.dependencyState,
      blockedBy:nextCard.blockedBy || [],
    } : null,
    blockers,
    summary:{
      cards:summary.total,
      ready:summary.ready,
      blocked:summary.blocked,
      failed:summary.failed,
      completionRate:summary.completionRate,
      nextAction:summary.nextAction,
    },
  };
}

export function buildWorkflowExecutionGateEvent(readiness = {}, at = new Date().toISOString()) {
  const blockers = Array.isArray(readiness.blockers) ? readiness.blockers : [];
  const nextCard = readiness.nextCard || {};
  return {
    at,
    type:"workflow_execution_gate",
    member:nextCard.member || nextCard.id || "",
    model:"",
    status:readiness.status || "unknown",
    detail:[
      readiness.action || "",
      nextCard.title ? `next=${nextCard.member || ""} · ${nextCard.title}` : "",
      blockers.length ? `blockers=${blockers.map(item => `${item.name || item.id}:${item.status}`).join(" / ")}` : "",
    ].filter(Boolean).join(" · ").slice(0, 1000),
  };
}

export function buildWorkboardExecutionPacket(workflow = {}, card = {}, lang = "zh") {
  const label = (zh, ja, en) => lang === "ja" ? ja : lang === "en" ? en : zh;
  const readiness = workflowExecutionReadiness(workflow, lang);
  const toolCalls = workflowToolCallChecklist(workflow, lang);
  const cards = workflowWorkboardCards(workflow, lang);
  const matchDependency = (candidate, dependency) => {
    const target = `${dependency || ""}`.trim().toLowerCase();
    return [
      candidate.id,
      candidate.member,
      candidate.title,
      `${candidate.member || ""} · ${candidate.title || ""}`.trim(),
    ].filter(Boolean).some(value => `${value}`.trim().toLowerCase() === target);
  };
  const dependencyEvidence = (Array.isArray(card.dependencies) ? card.dependencies : [])
    .map(dependency => {
      const source = cards.find(candidate => matchDependency(candidate, dependency)) || null;
      return {
        dependency:`${dependency || ""}`,
        member:source?.member || `${dependency || ""}`,
        title:source?.title || "",
        status:source?.status || "",
        output:source?.output || "",
        blocked:source ? source.status !== "complete" : (card.blockedBy || []).includes(dependency),
      };
    });
  const requiredTools = toolCalls.entries
    .filter(entry => !["not_needed", "optional"].includes(entry.status))
    .map(entry => ({
      id:entry.id,
      name:entry.name,
      permission:entry.permission,
      status:entry.status,
      detail:entry.detail,
    }));
  const action = card.status === "failed" ? "retry" : card.dependencyState === "blocked" ? "unblock" : "continue";
  const blocked = readiness.blockedByLocalOnly || readiness.needsPermission || card.dependencyState === "blocked";
  return {
    id:`exec-${card.id || card.member || "card"}`,
    status:blocked ? "blocked" : "ready",
    canExecute:!blocked && readiness.canExecute,
    action,
    card:{
      id:card.id || "",
      member:card.member || "",
      title:card.title || "",
      status:card.status || "",
      dependencyState:card.dependencyState || "",
      task:card.task || "",
      input:card.input || "",
      output:card.output || "",
      dependencyEvidence,
      handoffTo:card.handoffTo || "",
      acceptanceCriteria:card.acceptanceCriteria || "",
    },
    blockers:[
      ...readiness.blockers,
      ...(card.dependencyState === "blocked" ? [{ id:"workboard-dependency", name:label("Workboard 依赖", "Workboard 依存", "Workboard dependency"), status:"blocked", permission:"workflow", detail:(card.blockedBy || []).join(" / ") }] : []),
    ],
    requiredTools,
    instructions:[
      label("只执行这张 Workboard 卡片，不要重跑整个工作流。", "この Workboard カードだけを実行し、ワークフロー全体を再実行しないでください。", "Execute only this Workboard card; do not rerun the entire workflow."),
      card.input ? `${label("输入", "入力", "Input")}: ${card.input}` : "",
      card.output ? `${label("预期输出", "期待出力", "Expected output")}: ${card.output}` : "",
      dependencyEvidence.length ? `${label("依赖证据", "依存エビデンス", "Dependency evidence")}: ${dependencyEvidence.map(item => `${item.member || item.dependency}${item.title ? ` · ${item.title}` : ""} · ${item.status || "unknown"}${item.output ? ` · ${item.output}` : ""}${item.blocked ? " · blocked" : ""}`).join(" / ")}` : "",
      card.handoffTo ? `${label("交付对象", "引き渡し先", "Handoff to")}: ${card.handoffTo}` : "",
      card.acceptanceCriteria ? `${label("验收标准", "受入条件", "Acceptance criteria")}: ${card.acceptanceCriteria}` : "",
      readiness.action ? `${label("执行判定", "実行判定", "Execution readiness")}: ${readiness.action}` : "",
    ].filter(Boolean),
    outputContract:label("输出必须是可交给下游成员或 ARIA 整合的实际产物，并说明使用过的工具、权限状态和未完成风险。", "出力は下流メンバーまたは ARIA 統合へ渡せる実成果物とし、使用したツール、権限状態、未完リスクを明記してください。", "Output must be a real artifact handoff-ready for downstream members or ARIA integration, with tools used, permission state, and remaining risks."),
  };
}

export function buildWorkboardExecutionPacketEvent(packet = {}, at = new Date().toISOString()) {
  const tools = Array.isArray(packet.requiredTools) ? packet.requiredTools : [];
  const blockers = Array.isArray(packet.blockers) ? packet.blockers : [];
  return {
    at,
    type:"workboard_execution_packet",
    member:packet.card?.member || packet.card?.id || "",
    model:"",
    status:packet.status || "unknown",
    detail:[
      packet.action ? `action=${packet.action}` : "",
      packet.canExecute ? "can_execute=yes" : "can_execute=no",
      tools.length ? `tools=${tools.map(tool => `${tool.id}:${tool.status}`).join(" / ")}` : "",
      blockers.length ? `blockers=${blockers.map(blocker => `${blocker.id || blocker.name}:${blocker.status}`).join(" / ")}` : "",
      packet.card?.handoffTo ? `handoff=${packet.card.handoffTo}` : "",
      packet.card?.acceptanceCriteria ? `acceptance=${packet.card.acceptanceCriteria}` : "",
    ].filter(Boolean).join(" · ").slice(0, 1000),
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

export function ensureExecutableWorkflowMembers(workers = [], allMembers = [], taskText = "") {
  const planned = Array.isArray(workers) ? workers.filter(Boolean) : [];
  const runnablePlanned = planned.filter(member => member?.id && member.id !== "aria");
  if (runnablePlanned.length) return runnablePlanned;

  const fallback = chooseWorkflowMembers({ members:allMembers }, taskText)
    .filter(member => member?.id && member.id !== "aria");
  if (fallback.length) return fallback;

  return (Array.isArray(allMembers) ? allMembers : [])
    .filter(member => member?.id && member.id !== "aria")
    .slice(0, 4);
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

function decodeAutomationText(text = "") {
  return `${text || ""}`
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'");
}

function stripAutomationXml(text = "") {
  return decodeAutomationText(text)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseAutomationDirective(text = "") {
  const source = `${text || ""}`.trim();
  if (!/<heartbeat[\s>]/i.test(source) && !/<automation_id>/i.test(source)) {
    return { detected:false, automationId:"", taskText:source, displayText:source };
  }
  const automationId = stripAutomationXml(source.match(/<automation_id>([\s\S]*?)<\/automation_id>/i)?.[1] || "");
  const instructions = source.match(/<instructions>([\s\S]*?)<\/instructions>/i)?.[1] || source;
  const taskText = stripAutomationXml(instructions);
  const title = automationId ? `自动化任务 ${automationId}` : "自动化任务";
  return {
    detected:true,
    automationId,
    taskText,
    displayText:taskText ? `${title}: ${summarizeForWorkflow(taskText)}` : title,
  };
}

export function inferWorkflowTaskType(taskText = "") {
  const text = `${taskText || ""}`.toLowerCase();
  const hits = [];
  if (taskMatches(text, ["研究", "调研", "分析", "竞品", "报告", "research", "market"])) hits.push("research");
  if (taskMatches(text, ["开发", "代码", "修复", "测试", "部署", "github", "vercel", "build", "test", "development"])) hits.push("development");
  if (taskMatches(text, ["法务", "合规", "隐私", "协议", "条款", "legal"])) hits.push("legal");
  if (taskMatches(text, ["产品", "需求", "prd", "体验", "路线图", "product"])) hits.push("product");
  if (taskMatches(text, ["财务", "预算", "成本", "定价", "营收", "finance", "roi"])) hits.push("finance");
  return hits.length > 1 ? "mixed" : hits[0] || "mixed";
}

export function workflowRequiresConfirmation(taskText = "", protocol = {}) {
  if (protocol?.needs_user_confirmation) return true;
  return taskMatches(taskText, [
    "部署", "上线", "删除", "清空", "重置", "外发", "发送到", "投递", "codex", "github", "vercel",
    "deploy", "delete", "reset", "send to", "handoff", "external", "publish",
  ]);
}

export function normalizeWorkflowProtocol(protocol = {}, { taskText = "", workers = [] } = {}) {
  const allowedTypes = new Set(["research", "development", "legal", "product", "finance", "mixed"]);
  const allowedPriorities = new Set(["low", "medium", "high"]);
  const list = Array.isArray(workers) ? workers : [];
  const requiredMembers = Array.isArray(protocol.required_members) && protocol.required_members.length
    ? protocol.required_members
    : list.map(member => member.id || member.name).filter(Boolean);
  return {
    intent:summarizeForWorkflow(protocol.intent || taskText),
    task_type:allowedTypes.has(protocol.task_type) ? protocol.task_type : inferWorkflowTaskType(taskText),
    priority:allowedPriorities.has(protocol.priority) ? protocol.priority : "medium",
    required_members:requiredMembers.slice(0, 24).map(item => `${item || ""}`.slice(0, 80)).filter(Boolean),
    subtasks:Array.isArray(protocol.subtasks) ? protocol.subtasks.slice(0, 24).map(item => `${item || ""}`.slice(0, 300)).filter(Boolean) : [],
    expected_outputs:Array.isArray(protocol.expected_outputs) ? protocol.expected_outputs.slice(0, 12).map(item => `${item || ""}`.slice(0, 240)).filter(Boolean) : [],
    risks:Array.isArray(protocol.risks) ? protocol.risks.slice(0, 12).map(item => `${item || ""}`.slice(0, 240)).filter(Boolean) : [],
    needs_user_confirmation:workflowRequiresConfirmation(taskText, protocol),
  };
}

export function buildWorkflowPlan({ taskText = "", workers = [], mode = "auto", lang = "zh", protocol = null } = {}) {
  const label = (zh, ja, en) => lang === "ja" ? ja : lang === "en" ? en : zh;
  const list = Array.isArray(workers) ? workers : [];
  const normalizedProtocol = normalizeWorkflowProtocol(protocol || {}, { taskText, workers:list });
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
    protocol:normalizedProtocol,
    generatedAt:new Date().toISOString(),
    steps:list.map((member, index) => {
      const subtask = normalizedProtocol.subtasks[index] || normalizedProtocol.subtasks[0] || summarizeForWorkflow(taskText);
      const output = normalizedProtocol.expected_outputs[index] || normalizedProtocol.expected_outputs[0] || label("成员可交付成果", "メンバー成果物", "Member deliverable");
      return {
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
        subtask,
        input:index === 0 ? summarizeForWorkflow(taskText) : label("前序成员成果", "先行メンバー成果", "Prior member outputs"),
        output,
        deadline:normalizedProtocol.priority === "high" ? label("本轮立即完成", "このラウンドで即時完了", "Complete in this run") : label("本轮工作流内完成", "このワークフロー内で完了", "Complete within this workflow"),
        dependencies:index === 0 ? [] : [list[index - 1]?.id || list[index - 1]?.name || `step-${index}`],
        acceptanceCriteria:label(`输出必须覆盖：${output}`, `出力は次を満たす：${output}`, `Output must cover: ${output}`),
      };
    }),
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
  const reassignment = workflowFailureReassignmentPlan(workflow.members, lang);
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
    `${label("建议改派", "推奨再割当", "Suggested reassignment")}:`,
    reassignment.actions.length
      ? reassignment.actions.map(action => `- ${action.name} · ${action.title}: ${action.fromModel || "-"} -> ${action.toModel}; ${action.reason}`).join("\n")
      : "-",
    "",
    `${label("已完成成员摘要", "完了済みメンバー要約", "Completed member summaries")}:`,
    completedMembers || "-",
    "",
    label("请先判断是否需要调整执行成员，再继续生成可执行产物。", "担当メンバーの調整が必要か判断してから、実行可能な成果物を続けて生成してください。", "First decide whether assigned members should change, then continue producing the actionable output."),
  ].filter(line => line !== "").join("\n").trim();
}

export function buildWorkflowReassignmentPrompt(workflow = {}, lang = "zh") {
  const label = (zh, ja, en) => lang === "ja" ? ja : lang === "en" ? en : zh;
  const reassignment = workflowFailureReassignmentPlan(workflow.members, lang);
  const completedMembers = Array.isArray(workflow.members)
    ? workflow.members
      .filter(member => member.status === "complete" && member.summary)
      .slice(0, 8)
      .map(member => `- ${member.name || member.id} · ${member.title || ""}: ${member.summary}`)
      .join("\n")
    : "";
  return [
    label("请按以下自动改派方案恢复工作流。不要从零开始，不要重复已完成成员工作。", "以下の自動再割当案に従ってワークフローを復旧してください。最初からやり直さず、完了済みメンバー作業を繰り返さないでください。", "Recover the workflow using the fallback reassignment plan below. Do not restart from scratch or repeat completed member work."),
    "",
    `${label("原任务", "元タスク", "Original task")}:`,
    workflow.task || workflow.title || "-",
    "",
    `${label("当前失败状态", "現在の失敗状態", "Current failure state")}: ${workflow.mode || "-"}`,
    workflow.error ? `${label("错误", "エラー", "Error")}: ${workflow.error}` : "",
    "",
    `${label("改派动作", "再割当アクション", "Reassignment actions")}:`,
    reassignment.actions.length
      ? reassignment.actions.map(action => `- ${action.name} · ${action.title}: ${action.fromModel || "-"} -> ${action.toModel}; ${action.action}; ${action.reason}`).join("\n")
      : "-",
    "",
    `${label("已完成成员摘要", "完了済みメンバー要約", "Completed member summaries")}:`,
    completedMembers || "-",
    "",
    label("请只执行改派后的失败部分，最后由 ARIA 整合新版最终产物，并在产物中标明哪些部分来自改派。", "再割当後の失敗部分だけを実行し、最後に ARIA が新版の最終成果物として統合し、どの部分が再割当由来か明記してください。", "Run only the reassigned failed parts, then have ARIA integrate the updated final artifact and mark which parts came from fallback reassignment."),
  ].filter(line => line !== "").join("\n").trim();
}

export function buildWorkflowSkipPrompt(workflow = {}, lang = "zh") {
  const label = (zh, ja, en) => lang === "ja" ? ja : lang === "en" ? en : zh;
  const members = Array.isArray(workflow.members) ? workflow.members : [];
  const skipped = members
    .filter(member => member.status !== "complete")
    .map(member => `- ${member.name || member.id} · ${member.title || ""}: ${member.status || "-"}${member.error ? ` · ${member.error}` : ""}`)
    .join("\n");
  const completed = members
    .filter(member => member.status === "complete")
    .slice(0, 10)
    .map(member => `- ${member.name || member.id} · ${member.title || ""}: ${member.summary || "-"}`)
    .join("\n");
  return [
    label("请跳过以下未完成或失败成员，不再等待他们输出。基于已完成成员成果直接由 ARIA 整合最终产物，并在产物中明确标注缺口和风险。", "以下の未完了または失敗メンバーをスキップし、これ以上待たないでください。完了済み成果だけを基に ARIA が最終成果物を統合し、不足とリスクを明記してください。", "Skip the unfinished or failed members below. Do not wait for them. Have ARIA integrate the final artifact from completed outputs and explicitly note gaps and risks."),
    "",
    `${label("原任务", "元タスク", "Original task")}:`,
    workflow.task || workflow.title || "-",
    "",
    `${label("跳过成员", "スキップ対象", "Skipped members")}:`,
    skipped || "-",
    "",
    `${label("保留成果", "保持する成果", "Kept outputs")}:`,
    completed || "-",
    "",
    label("输出必须是最终可交付产物，不要只解释为什么跳过。", "出力は最終成果物にしてください。スキップ理由の説明だけで終わらないでください。", "The output must be the final deliverable, not just an explanation of the skip."),
  ].join("\n").trim();
}

export function buildWorkflowResumePrompt(workflow = {}, lang = "zh") {
  const label = (zh, ja, en) => lang === "ja" ? ja : lang === "en" ? en : zh;
  const members = Array.isArray(workflow.members) ? workflow.members : [];
  const completed = members
    .filter(member => member.status === "complete")
    .slice(0, 10)
    .map(member => `- ${member.name || member.id} · ${member.title || ""}: ${member.summary || "-"}`)
    .join("\n");
  const remaining = members
    .filter(member => member.status !== "complete")
    .map(member => `- ${member.name || member.id} · ${member.title || ""}: ${member.status || "queued"}${member.task ? ` · ${member.task}` : ""}${member.error ? ` · ${member.error}` : ""}`)
    .join("\n");
  return [
    label("请继续以下被停止或未完成的自动生产工作流。不要从零开始；保留已完成成员成果，只继续剩余成员队列，最后由 ARIA 整合最终产物。", "停止または未完了の自動ワークフローを続行してください。最初からやり直さず、完了済み成果を保持し、残りのメンバーキューだけを続行し、最後に ARIA が最終成果物を統合してください。", "Resume the stopped or incomplete automation workflow below. Do not restart; keep completed outputs, continue only the remaining member queue, then have ARIA integrate the final artifact."),
    "",
    `${label("原任务", "元タスク", "Original task")}:`,
    workflow.task || workflow.title || "-",
    "",
    `${label("已完成成果", "完了済み成果", "Completed outputs")}:`,
    completed || "-",
    "",
    `${label("剩余成员队列", "残りメンバーキュー", "Remaining member queue")}:`,
    remaining || "-",
    "",
    label("如果剩余成员仍不可用，请给出最小替代调度，但不要丢弃已完成成果。", "残りメンバーが利用不可の場合は、最小限の代替調度を提案し、完了済み成果を破棄しないでください。", "If remaining members are unavailable, propose the smallest fallback dispatch without discarding completed outputs."),
  ].join("\n").trim();
}

export function workflowExternalDisclosureLines(modelUsage = {}, lang = "zh") {
  const label = (zh, ja, en) => lang === "ja" ? ja : lang === "en" ? en : zh;
  const providers = Array.isArray(modelUsage.providers) ? modelUsage.providers.filter(Boolean) : [];
  const models = Array.isArray(modelUsage.models) ? modelUsage.models : [];
  if (!models.length) {
    return [label("模型调用：尚未记录。", "モデル呼び出し：未記録。", "Model calls: not recorded yet.")];
  }
  if (!modelUsage.external) {
    return [label("外发：无外部模型提供商。", "外部送信：外部モデル提供元なし。", "External transfer: no external model provider.")];
  }
  return [
    `${label("外发：会发送给", "外部送信：送信先", "External transfer: sent to")} ${providers.join(" / ") || label("当前模型提供商", "現在のモデル提供元", "current model provider")}`,
    `${label("内容：任务文本、相关上下文、成员子任务和必要知识片段。", "内容：タスク本文、関連文脈、メンバーのサブタスク、必要な知識断片。", "Content: task text, relevant context, member subtasks, and necessary knowledge snippets.")}`,
  ];
}

export function buildWorkflowConfirmationPrompt(workflow = {}, lang = "zh") {
  const label = (zh, ja, en) => lang === "ja" ? ja : lang === "en" ? en : zh;
  const plan = workflow.plan || {};
  const protocol = plan.protocol || {};
  const steps = Array.isArray(plan.steps) ? plan.steps : [];
  return [
    label("我已确认继续执行以下高风险工作流。请不要从零规划；基于已确认计划继续调度成员并生成最终产物。", "以下の高リスクワークフローの続行を確認しました。最初から計画し直さず、確認済み計画に基づいてメンバーを調度し、最終成果物を生成してください。", "I confirm proceeding with the high-risk workflow below. Do not restart planning; continue dispatching members from the confirmed plan and produce the final artifact."),
    "",
    `${label("任务", "タスク", "Task")}:`,
    workflow.task || workflow.title || "-",
    "",
    `${label("意图", "意図", "Intent")}: ${protocol.intent || "-"}`,
    `${label("类型", "種別", "Type")}: ${protocol.task_type || "-"} · ${label("优先级", "優先度", "Priority")}: ${protocol.priority || "-"}`,
    protocol.expected_outputs?.length ? `${label("预期产物", "期待成果物", "Expected outputs")}: ${protocol.expected_outputs.join(" / ")}` : "",
    protocol.risks?.length ? `${label("风险", "リスク", "Risks")}: ${protocol.risks.join(" / ")}` : "",
    ...workflowExternalDisclosureLines(workflow.modelUsage || {}, lang),
    "",
    `${label("已确认成员和子任务", "確認済みメンバーとサブタスク", "Confirmed members and subtasks")}:`,
    ...(steps.length
      ? steps.map(step => `${step.order}. ${step.member} · ${step.title} · ${step.model}\n   ${label("子任务", "サブタスク", "Subtask")}: ${step.subtask || step.purpose || "-"}\n   ${label("输出", "出力", "Output")}: ${step.output || "-"}\n   ${label("验收", "受入条件", "Acceptance")}: ${step.acceptanceCriteria || "-"}`)
      : ["-"]),
    "",
    label("请继续执行，但在真正部署、删除、外发文件、投递 Codex/GitHub/Vercel 前，明确说明将发生的数据外发或系统变更。", "実際のデプロイ、削除、ファイル外部送信、Codex/GitHub/Vercel 投递の前に、発生するデータ外部送信またはシステム変更を明示してください。", "Continue execution, but before actual deployment, deletion, external file transfer, or Codex/GitHub/Vercel handoff, state the external data transfer or system change clearly."),
  ].filter(line => line !== "").join("\n").trim();
}

export function buildWorkflowPlanEditPrompt(workflow = {}, lang = "zh") {
  const label = (zh, ja, en) => lang === "ja" ? ja : lang === "en" ? en : zh;
  const plan = workflow.plan || {};
  const steps = Array.isArray(plan.steps) ? plan.steps : [];
  return [
    label("请基于以下当前调度计划进行调整，然后继续执行。", "以下の現在の調度計画を調整してから続行してください。", "Revise the current dispatch plan below, then continue execution."),
    "",
    `${label("任务", "タスク", "Task")}:`,
    workflow.task || plan.task || workflow.title || "-",
    "",
    `${label("当前策略", "現在の方針", "Current strategy")}:`,
    plan.strategy || "-",
    "",
    `${label("当前成员顺序", "現在のメンバー順", "Current member order")}:`,
    ...(steps.length
      ? steps.map(step => `${step.order}. ${step.member} · ${step.title} · ${step.model}\n   ${step.purpose}`)
      : ["-"]),
    "",
    label("请输出新的成员顺序、每位成员的职责、是否需要增删成员，并继续生成可执行产物。", "新しいメンバー順、各メンバーの役割、追加・削除が必要かを示し、実行可能な成果物を続けて生成してください。", "Return the new member order, each member's responsibility, whether members should be added or removed, and then continue producing the actionable output."),
  ].join("\n").trim();
}

export function parsePlannerJson(text) {
  const raw = `${text || ""}`.trim();
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const candidate = fenced || raw.match(/\{[\s\S]*\}/)?.[0] || raw;
  return JSON.parse(candidate);
}

export function plannerRequiredMemberIds(plan = {}) {
  const ids = Array.isArray(plan.required_members) && plan.required_members.length
    ? plan.required_members
    : plan.memberIds;
  return Array.isArray(ids) ? ids.map(id => `${id || ""}`.trim()).filter(Boolean) : [];
}

export async function planWorkflowDispatchWithModel({ router, taskText, members, apiKeys, controls, language, signal, callModel }) {
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
  "reason": "一句话说明调度依据",
  "intent": "用户真实意图",
  "task_type": "research | development | legal | product | finance | mixed",
  "priority": "low | medium | high",
  "required_members": ["aria"],
  "subtasks": ["明确的子任务"],
  "expected_outputs": ["最终应该产出的文件、报告或决策"],
  "risks": ["需要关注的风险"],
  "needs_user_confirmation": false
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
    if (plan?.target === "all") {
      return { workers:members, protocol:normalizeWorkflowProtocol(plan, { taskText, workers:members }) };
    }
    if (plan?.target === "core") {
      const workers = members.filter(member => member.layer === 0 || member.layer === 1);
      return { workers, protocol:normalizeWorkflowProtocol(plan, { taskText, workers }) };
    }
    if (plan?.target === "exec") {
      const workers = members.filter(member => member.layer === 2);
      return { workers, protocol:normalizeWorkflowProtocol(plan, { taskText, workers }) };
    }
    if (plan?.target === "business") {
      const workers = members.filter(member => member.layer === 3);
      return { workers, protocol:normalizeWorkflowProtocol(plan, { taskText, workers }) };
    }
    const planned = plannerRequiredMemberIds(plan).map(id => byId.get(id)).filter(Boolean);
    const workers = planned.length ? planned : chooseWorkflowMembers({ members }, taskText);
    return { workers, protocol:normalizeWorkflowProtocol(plan, { taskText, workers }) };
  } catch {
    const workers = chooseWorkflowMembers({ members }, taskText);
    return { workers, protocol:normalizeWorkflowProtocol({}, { taskText, workers }) };
  }
}

export async function planWorkflowMembersWithModel(options) {
  const dispatch = await planWorkflowDispatchWithModel(options);
  return dispatch.workers;
}
