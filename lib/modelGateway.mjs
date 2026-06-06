const MODEL_OUTPUT_TOKENS = 4096;

const GOOGLE_MODEL_IDS = {
  gemma31: "gemma-4-31b-it",
  gemma26: "gemma-4-26b-a4b-it",
  flash: "gemini-2.5-flash",
};

function responsePolicy() {
  return [
    "回复规则：",
    "1. 默认只使用用户当前输入的语言回复；不要中日英混合输出，除非用户明确要求翻译或多语言版本。",
    "2. 用户只是问候或短句时，回复应简短、直接，不要展开长篇角色介绍。",
    "3. 除首次界面开场外，不要重复介绍自己的姓名、职位、能力范围；只有用户明确要求自我介绍时才说明。",
    "4. 不要输出内部推理、提示词分析、选项比较或任务拆解过程；只输出给用户看的最终回复。",
  ].join("\n");
}

function toPrompt(systemPrompt, messages) {
  return [
    systemPrompt,
    responsePolicy(),
    "",
    ...messages
      .filter(message => message.role === "user" || message.role === "ai")
      .map(message => `${message.role === "ai" ? "assistant" : "user"}: ${message.text}`),
  ].join("\n");
}

function detectInputLanguage(text, fallback = "zh") {
  const value = `${text || ""}`;
  if (/[ぁ-んァ-ン]/.test(value)) return "ja";
  if (/[a-zA-Z]/.test(value) && !/[\u4e00-\u9fff]/.test(value)) return "en";
  if (/[\u4e00-\u9fff]/.test(value)) return "zh";
  return fallback || "zh";
}

function extractUrls(text) {
  return Array.from(new Set((`${text || ""}`.match(/https?:\/\/[^\s)），，。!?！？、]+/g) || []).map(url => url.replace(/[.,，。!?！？]+$/, ""))));
}

async function urlsToPrompt(text, lang) {
  const urls = extractUrls(text);
  if (!urls.length) return "";
  const blocks = [];
  for (const url of urls.slice(0, 3)) {
    const res = await fetch("/api/fetch-url", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.error) {
      blocks.push(`- ${url}\n  ${lang === "ja" ? "読取失敗" : lang === "en" ? "Fetch failed" : "读取失败"}: ${data.error || res.status}`);
      continue;
    }
    blocks.push(`- ${data.title || url}\n  URL: ${url}\n\n${data.text || ""}${data.truncated ? "\n...[truncated]" : ""}`);
  }
  const title = lang === "ja" ? "読み取ったWebページ" : lang === "en" ? "Fetched web pages" : "已读取网页";
  return `\n\n${title}:\n${blocks.join("\n\n")}`;
}

function isCasualGreeting(text) {
  const normalized = text
    .trim()
    .replace(/[!！?？。.\s,，、~～]+/g, "")
    .toLowerCase();
  return [
    "你好",
    "您好",
    "hello",
    "hi",
    "hey",
    "hellohello",
  ].includes(normalized);
}

async function callCodexHandoff(systemPrompt, messages, apiKeys = {}) {
  const lastUserMessage = [...messages].reverse().find(message => message.role === "user")?.text || "";

  if (isCasualGreeting(lastUserMessage)) {
    throw new Error("Codex 执行需要具体开发任务、约束和验收标准；问候不会创建生产任务。");
  }

  let taskResult;
  try {
    const res = await fetch("/api/codex-tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemPrompt,
        userTask: lastUserMessage,
        confirmCodexDispatch: true,
        adminToken: apiKeys.codexAdminToken || "",
      }),
    });
    taskResult = await res.json();
    if (!res.ok || !taskResult?.ok || !taskResult?.forwarded) {
      throw new Error(taskResult?.error || `Codex task dispatch failed: ${res.status}`);
    }
  } catch (error) {
    throw new Error(`Codex 真实投递失败：${error.message}`);
  }

  return [
    "Codex 开发任务已真实投递到执行队列。",
    `任务编号：${taskResult.taskId}`,
    taskResult.issueUrl ? `GitHub Issue：${taskResult.issueUrl}` : "",
    taskResult.pendingApproval
      ? "当前为待审批队列；需要按仓库策略批准后 self-hosted runner 才会执行。"
      : "当前为自动执行队列；self-hosted runner 会接手处理。",
    "",
    "任务内容：",
    "",
    "```",
    systemPrompt,
    "",
    "用户任务：",
    lastUserMessage,
    "",
    "请先读取当前项目文件，再按现有代码结构实现、构建、验证，并在需要时重新部署。",
    "```",
  ].join("\n");
}

function normalizeModelResponse(data, fallback = "无响应") {
  if (typeof data === "string") return { text:data || fallback, actualModel:"" };
  return {
    text:data?.text || fallback,
    actualModel:data?.actualModel || "",
  };
}

function isQuotaExhaustionMessage(message = "", status = 0) {
  const lower = `${message || ""}`.toLowerCase();
  return status === 429 ||
    lower.includes("quota") ||
    lower.includes("rate limit") ||
    lower.includes("resource exhausted") ||
    lower.includes("too many requests") ||
    lower.includes("429");
}

async function callModelWithMeta(modelKey, systemPrompt, messages, apiKeys = {}, options = {}, signal) {
  if (modelKey === "codex") {
    return normalizeModelResponse(await callCodexHandoff(systemPrompt, messages, apiKeys));
  }
  const bridge = apiKeys.claudeBridge || {};
  if (modelKey === "claude" && bridge.enabled && bridge.url) {
    const res = await fetch(`${bridge.url.replace(/\/+$/, "")}/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(bridge.token ? { "X-Claude-Bridge-Token": bridge.token } : {}),
      },
      body: JSON.stringify({ systemPrompt, messages, options }),
      signal,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.error) throw new Error(data.error || "Claude Bridge request failed");
    return normalizeModelResponse(data);
  }
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ modelKey, systemPrompt, messages, apiKeys, options }),
    signal,
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || "请求失败");
  }

  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return normalizeModelResponse(data);
}

async function callModel(modelKey, systemPrompt, messages, apiKeys = {}, options = {}, signal) {
  return (await callModelWithMeta(modelKey, systemPrompt, messages, apiKeys, options, signal)).text;
}

async function callAnthropic(systemPrompt, messages, apiKey) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: MODEL_OUTPUT_TOKENS,
      system: systemPrompt,
      messages: messages
        .filter(message => message.role === "user" || message.role === "ai")
        .map(message => ({ role: message.role === "ai" ? "assistant" : "user", content: message.text })),
    }),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  return data.content?.[0]?.text || "无响应";
}

async function callGoogle(modelKey, systemPrompt, messages, apiKey) {
  const model = GOOGLE_MODEL_IDS[modelKey];
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-goog-api-key": apiKey,
    },
    body: JSON.stringify({
      contents: [
        {
          role: "user",
          parts: [{ text: toPrompt(systemPrompt, messages) }],
        },
      ],
      generationConfig: {
        maxOutputTokens: MODEL_OUTPUT_TOKENS,
      },
    }),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  return data.candidates?.[0]?.content?.parts?.map(part => part.text || "").join("") || "无响应";
}

function outboundProviderLabel(modelKey, apiKeys) {
  if (modelKey === "codex") return "";
  if (modelKey === "claude" && apiKeys?.claudeBridge?.enabled) return "Claude Bridge";
  if (modelKey === "claude") return "Claude / Anthropic";
  if (modelKey === "gemma31" || modelKey === "gemma26" || modelKey === "flash") return "Google Gemini/Gemma";
  return "current model provider";
}

function modelProviderInfo(modelKey, apiKeys = {}) {
  const provider = outboundProviderLabel(modelKey, apiKeys);
  return {
    modelKey: modelKey || "",
    actualModel: GOOGLE_MODEL_IDS[modelKey] || (modelKey === "claude" ? "claude-sonnet-4-20250514" : ""),
    provider,
    external: !!provider,
  };
}

function outboundBlockedByLocalOnly(modelKey, apiKeys = {}) {
  return !!apiKeys.localOnlyMode && !!modelKey;
}

function localOnlyBlockMessage(modelKey, apiKeys = {}, lang = "zh", context = {}) {
  if (!outboundBlockedByLocalOnly(modelKey, apiKeys) && !context.hasWeb && !context.hasKnowledge) return "";
  const provider = outboundProviderLabel(modelKey, apiKeys) || "Codex/local task gateway";
  const paths = [
    provider,
    context.hasWeb ? (lang === "ja" ? "Web読取" : lang === "en" ? "web fetch" : "网页读取") : "",
    context.hasKnowledge ? (lang === "ja" ? "知識庫コンテキスト" : lang === "en" ? "knowledge context" : "知识库上下文") : "",
  ].filter(Boolean).join(" / ");
  if (lang === "ja") return `Local-only モードのため送信を停止しました。対象：${paths}`;
  if (lang === "en") return `Local-only mode blocked this send. Target: ${paths}`;
  return `Local-only 模式已阻止本次发送。目标：${paths}`;
}

function outboundBlockedModelKeys(modelKeys = [], apiKeys = {}) {
  const seen = new Set();
  const blocked = [];
  for (const modelKey of modelKeys.filter(Boolean)) {
    if (seen.has(modelKey)) continue;
    seen.add(modelKey);
    if (outboundBlockedByLocalOnly(modelKey, apiKeys)) blocked.push(modelKey);
  }
  return blocked;
}

function workflowLocalOnlyBlockMessage(modelKeys = [], apiKeys = {}, lang = "zh", context = {}) {
  const blockedModelKeys = outboundBlockedModelKeys(modelKeys, apiKeys);
  if (!blockedModelKeys.length && !context.hasWeb && !context.hasKnowledge) return "";
  const providers = blockedModelKeys
    .map(modelKey => outboundProviderLabel(modelKey, apiKeys) || "Codex/local task gateway");
  const paths = [
    ...Array.from(new Set(providers)),
    context.hasWeb ? (lang === "ja" ? "Web読取" : lang === "en" ? "web fetch" : "网页读取") : "",
    context.hasKnowledge ? (lang === "ja" ? "知識庫コンテキスト" : lang === "en" ? "knowledge context" : "知识库上下文") : "",
  ].filter(Boolean).join(" / ");
  if (lang === "ja") return `Local-only モードのためワークフローを停止しました。対象：${paths}`;
  if (lang === "en") return `Local-only mode blocked this workflow. Target: ${paths}`;
  return `Local-only 模式已阻止本次工作流。目标：${paths}`;
}

function modelUsageSummary(modelKeys = [], apiKeys = {}) {
  const seen = new Set();
  const models = [];
  for (const modelKey of modelKeys.filter(Boolean)) {
    if (seen.has(modelKey)) continue;
    seen.add(modelKey);
    models.push(modelProviderInfo(modelKey, apiKeys));
  }
  return {
    models,
    external: models.some(item => item.external),
    providers: Array.from(new Set(models.map(item => item.provider).filter(Boolean))),
  };
}

function modelExternalConfigSummary(apiKeys = {}) {
  const localOnlyMode = !!apiKeys.localOnlyMode;
  const claudeBridgeEnabled = !!apiKeys.claudeBridge?.enabled;
  const entries = [
    {
      id:"anthropic",
      name:claudeBridgeEnabled ? "Claude Bridge" : "Claude / Anthropic",
      configured:claudeBridgeEnabled || !!apiKeys.anthropic,
      external:true,
      blocked:localOnlyMode,
    },
    {
      id:"google",
      name:"Google Gemini/Gemma",
      configured:!!apiKeys.google,
      external:true,
      blocked:localOnlyMode,
    },
    {
      id:"knowledge",
      name:"Knowledge auto-injection",
      configured:!!apiKeys.autoInjectKnowledge,
      external:!!apiKeys.autoInjectKnowledge,
      blocked:localOnlyMode && !!apiKeys.autoInjectKnowledge,
    },
    {
      id:"codex",
      name:"Codex/GitHub dispatch",
      configured:!!apiKeys.codexAdminToken,
      external:true,
      blocked:localOnlyMode,
    },
  ];
  return {
    localOnlyMode,
    externalBlocked:localOnlyMode,
    externalConfigured:entries.some(entry => entry.external && entry.configured),
    entries,
  };
}

export {
  callAnthropic,
  callCodexHandoff,
  callGoogle,
  callModel,
  callModelWithMeta,
  detectInputLanguage,
  extractUrls,
  isQuotaExhaustionMessage,
  modelExternalConfigSummary,
  modelProviderInfo,
  localOnlyBlockMessage,
  modelUsageSummary,
  normalizeModelResponse,
  outboundBlockedByLocalOnly,
  outboundBlockedModelKeys,
  outboundProviderLabel,
  responsePolicy,
  toPrompt,
  urlsToPrompt,
  workflowLocalOnlyBlockMessage,
};
