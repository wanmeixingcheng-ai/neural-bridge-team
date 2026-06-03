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

function confirmCodexDispatch() {
  if (typeof window === "undefined") return false;
  return window.confirm("Codex development tasks are sent to the GitHub Issue queue. They are created as pending approval by default. Production auto-run requires both CODEX_TASK_AUTO_RUN=true and ALLOW_PRODUCTION_CODEX_AUTO_RUN=true. Continue?");
}

async function callCodexHandoff(systemPrompt, messages, apiKeys = {}) {
  const lastUserMessage = [...messages].reverse().find(message => message.role === "user")?.text || "";

  if (isCasualGreeting(lastUserMessage)) {
    return [
      "你好，我是Neural Bridge的Codex执行角色。",
      "如果你需要我生成或执行开发任务，请直接描述目标、约束和验收标准；我会按当前项目结构处理。",
      "",
      "后端相关请求请尽量说明：身份验证方式、API边界、安全约束、环境变量、部署目标。",
    ].join("\n");
  }

  let taskResult = null;
  try {
    if (!confirmCodexDispatch()) {
      return "已取消 Codex 开发任务投递。";
    }
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
  } catch (error) {
    taskResult = { ok: false, error: error.message };
  }

  return [
    "这个开发任务应交给当前 Codex 工作区执行，不需要 OpenAI API Key。",
    taskResult?.ok ? `已投递：${taskResult.issueUrl || taskResult.taskId}` : `后端投递失败：${taskResult?.error || "未知错误"}`,
    taskResult?.forwarded
      ? (taskResult.pendingApproval ? "任务已进入待审批队列；需要人工把 issue 标记为 codex-task 后 self-hosted runner 才会执行。" : "任务已进入自动执行队列，self-hosted runner 会接手处理。")
      : "自动投递尚未配置完成。",
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

async function callModel(modelKey, systemPrompt, messages, apiKeys = {}, options = {}, signal) {
  if (modelKey === "codex") {
    return callCodexHandoff(systemPrompt, messages, apiKeys);
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
    return data.text || "无响应";
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
  return data.text || "无响应";
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
    provider,
    external: !!provider,
  };
}

function outboundBlockedByLocalOnly(modelKey, apiKeys = {}) {
  return !!apiKeys.localOnlyMode && !!modelKey;
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

export {
  callAnthropic,
  callCodexHandoff,
  callGoogle,
  callModel,
  detectInputLanguage,
  extractUrls,
  modelProviderInfo,
  modelUsageSummary,
  outboundBlockedByLocalOnly,
  outboundProviderLabel,
  responsePolicy,
  toPrompt,
  urlsToPrompt,
};
