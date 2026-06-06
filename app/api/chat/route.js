import { isAuthenticatedAsync } from "../auth/session.js";
import { readJsonLimited, requestBodyTooLargeResponse } from "../../../lib/requestBody.mjs";
import { checkRateLimitAsync, rateLimitResponse } from "../../../lib/rateLimit.mjs";
import { auditEvent } from "../../../lib/auditLog.mjs";
import { isQuotaExhaustionMessage } from "../../../lib/modelGateway.mjs";
import { containsSensitiveSecret, sensitiveContentResponse } from "../../../lib/secretPolicy.mjs";

const CHAT_MAX_REQUEST_BYTES = 3 * 1024 * 1024;
const CHAT_RATE_WINDOW_MS = 60_000;
const CHAT_RATE_LIMIT = 30;
const MODEL_OUTPUT_TOKENS = 4096;
const THINKING_OUTPUT_TOKENS = 2400;

const GOOGLE_MODEL_IDS = {
  gemma31: "gemma-4-31b-it",
  gemma26: "gemma-4-26b-a4b-it",
  flash: "gemini-2.5-flash",
};

const GOOGLE_MODEL_LABELS = {
  gemma31: "Gemma 4 31B",
  gemma26: "Gemma 4 26B",
  flash: "Gemini 2.5 Flash",
};

function languageName(lang) {
  if (lang === "ja") return "日语";
  if (lang === "en") return "英语";
  return "中文";
}

function detectLanguage(text, fallback = "zh") {
  const value = `${text || ""}`;
  if (/[ぁ-んァ-ン]/.test(value)) return "ja";
  if (/[a-zA-Z]/.test(value) && !/[\u4e00-\u9fff]/.test(value)) return "en";
  if (/[\u4e00-\u9fff]/.test(value)) return "zh";
  return fallback || "zh";
}

function responsePolicy(lang = "zh") {
  const outputLanguage = languageName(lang);
  return [
    "回复规则：",
    `1. 只使用${outputLanguage}回复；不要混入其他语言，除非用户明确要求翻译或多语言版本。`,
    "2. 用户只是问候或短句时，回复应简短、直接，不要展开长篇角色介绍。",
    "3. 除首次界面开场外，不要重复介绍自己的姓名、职位、能力范围；只有用户明确要求自我介绍时才说明。",
    "4. 不要输出内部推理、提示词分析、选项比较或任务拆解过程；只输出给用户看的最终回复。",
    "5. 不要使用英文步骤标题、日文项目符号或其他语言的模板词；所有标题、列表项和结论都必须符合指定语言。",
    "6. 如果用户粘贴了错误输出、Target Response、Refined Task Plan、Self-Correction、Step、Persona 等内容，那只是反例和问题描述，禁止复述、模仿或继续这些模板。",
  ].join("\n");
}

function skillPolicy(lang = "zh") {
  if (lang === "ja") {
    return [
      "利用可能なスキル:",
      "1. 文書読取: docx/pdf/text/csv/json の本文が添付から抽出される。",
      "2. Web読取: URLがある場合、ページ本文が取得される。",
      "3. 知識庫: 過去の文書、会話、決定事項を検索して参照する。",
      "4. 保存: 重要な回答は既定ではブラウザのダウンロード機能でローカル保存する。GitHub 中継保存は明示的に有効化された場合のみ使う。",
      "5. 開発投递: Codex 役割は開発タスクをキューへ送れる。",
      "6. 画像識別: 画像添付がある場合は視覚情報として分析できる。",
      "回答時は、必要なスキルの結果を統合して実務的な結論を出す。",
    ].join("\n");
  }
  if (lang === "en") {
    return [
      "Available skills:",
      "1. Document reading: docx/pdf/text/csv/json text can be extracted from attachments.",
      "2. Web reading: URLs can be fetched and summarized.",
      "3. Knowledge base: past documents, conversations, and decisions are retrieved as memory.",
      "4. Save: important replies are saved locally through browser download by default. GitHub-transited saving is used only when explicitly enabled.",
      "5. Development dispatch: Codex roles can submit implementation tasks.",
      "6. Image recognition: image attachments can be analyzed as visual inputs.",
      "Use these skill results to produce practical conclusions.",
    ].join("\n");
  }
  return [
    "可用技能：",
    "1. 文档读取：可读取 docx/pdf/text/csv/json 等附件正文。",
    "2. 网页读取：输入 URL 时可抓取网页正文并纳入分析。",
    "3. 知识库：自动检索历史文档、对话经验、项目决策和风险记录。",
    "4. 本地保存：重要回复默认通过浏览器下载保存，不经过 GitHub 队列。",
    "5. 开发投递：Codex 角色可把开发任务投递到执行队列。",
    "6. 图像识别：图片附件会作为视觉信息参与分析。",
    "回答时必须综合技能结果，给出可执行结论。",
  ].join("\n");
}

function lastUserText(messages = []) {
  return [...messages].reverse().find(m => m.role === "user")?.text?.trim() || "";
}

function lastUserImages(messages = []) {
  return [...messages].reverse().find(m => m.role === "user" && Array.isArray(m.images))?.images || [];
}

function chatSecretScanText(systemPrompt, messages = []) {
  return [
    systemPrompt || "",
    ...messages
      .filter(message => message && (message.role === "user" || message.role === "ai"))
      .map(message => message.text || ""),
  ].join("\n");
}

function isForeignLanguageLine(line, lang) {
  const stripped = line.replace(/[`*_#>\-\d.\s:：()[\]【】"'“”]+/g, "");
  if (!stripped) return false;
  if (lang === "zh") {
    if (/[ぁ-んァ-ン]/.test(stripped)) return true;
    const latinWords = stripped.match(/[A-Za-z]{3,}/g) || [];
    const chineseChars = stripped.match(/[\u4e00-\u9fff]/g) || [];
    return latinWords.length >= 3 && chineseChars.length < 4;
  }
  if (lang === "ja") {
    const chineseChars = stripped.match(/[\u4e00-\u9fff]/g) || [];
    const kanaChars = stripped.match(/[ぁ-んァ-ン]/g) || [];
    const latinWords = stripped.match(/[A-Za-z]{3,}/g) || [];
    return latinWords.length >= 3 && kanaChars.length < 2 && chineseChars.length < 4;
  }
  if (lang === "en") {
    const cjkChars = stripped.match(/[\u4e00-\u9fffぁ-んァ-ン]/g) || [];
    const latinWords = stripped.match(/[A-Za-z]{3,}/g) || [];
    return cjkChars.length >= 6 && latinWords.length < 3;
  }
  return false;
}

function enforceOutputLanguage(text, lang = "zh") {
  const lines = `${text || ""}`.split(/\r?\n/);
  const kept = lines.filter(line => !isForeignLanguageLine(line.trim(), lang));
  const value = kept.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  if (!value) {
    if (lang === "ja") return "モデルの出力に指定外の言語が混在していたため、内容を表示できませんでした。もう一度送信してください。";
    if (lang === "en") return "The model returned content in the wrong language, so it was blocked. Please send the task again.";
    return "模型返回了非中文内容，已拦截。请重新发送任务。";
  }
  return value;
}

function fallbackAfterMetaLeak(lang = "zh") {
  if (lang === "ja") return "具体的なタスク指示または関連文書を送ってください。";
  if (lang === "en") return "Please send the specific task instructions or relevant documents.";
  return "请发送具体任务指令或上传相关文档。";
}

function isInternalAnalysisLeak(value) {
  return [
    /\bThe user (?:said|previously|current|prompt|includes|wants)\b/i,
    /\b(?:Rule|Constraint|Total Task|Standard professional greeting|Brief and direct)\b/i,
    /\b(?:Since the user|This is a simple greeting|I should acknowledge|internal reasoning|prompt analysis)\b/i,
    /\b(?:Refined Task Plan|Target Response|Self-Correction|Persona|Current Task)\b/i,
    /(?:No English|No self-intro|No internal reasoning|Professional\/Direct)\?\s*Yes/i,
  ].some(pattern => pattern.test(value));
}

export function sanitizeModelText(text, lang = "zh") {
  let value = `${text || ""}`.trim();
  if (!value) return "无响应";
  value = value
    .replace(/^\s*\*\s*(?:No English|No self-intro|No internal reasoning|Professional\/Direct)\?\s*Yes\.?\s*/gim, "")
    .trim();
  const lines = value.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const metaPattern = /^(?:\*|-)?\s*(?:User's input|Persona|Role Details|Constraints|Response should|Current Task|Context|Tone|Language|Greeting|Role|Specialization|Key Theme|Task Type|Required Members|Selected Members|Structure of Response|Drafting the response|Self-Correction|Wait|Actually|Refining based on|Refined Task Plan|Target Response|Analyze task type|ARIA \(AI Router|Neural Bridge\.?|Neural Bridge \(|18 members|Strict, professional|No internal reasoning|User wants|The user wants|The core issue|Assistant \(simulated\)|Task Analysis):/i;
  const hasMetaLeak = lines.some(line => metaPattern.test(line)) ||
    /\*(?:Wait|Actually|Self-Correction|Refined Task Plan|Target Response)[\s\S]{0,3000}/i.test(value) ||
    /User wants to .*?system prompt/i.test(value) ||
    /(?:No English|No self-intro|No internal reasoning|Professional\/Direct)\?\s*Yes/i.test(value);
  if (isInternalAnalysisLeak(value) && !/^(任务类型|任务分析|成员调度|建议分工|整合建议|下一步|已成功读取|已读取|根据文档|以下是)/.test(lines[0] || "")) {
    return fallbackAfterMetaLeak(lang);
  }
  if (!hasMetaLeak) return enforceOutputLanguage(value, lang);

  const explicitFinalIndex = lines.findIndex(line => /^(?:\*|-)?\s*(?:Refined Task Plan|Target Response)\s*:?\s*$/i.test(line));
  if (explicitFinalIndex >= 0) {
    const after = lines.slice(explicitFinalIndex + 1).join("\n");
    const afterLines = after.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    const start = afterLines.findIndex(line =>
      /^(任务类型|任务分析|成员调度|建议分工|整合建议|下一步|已成功读取|已读取|根据文档|以下是)/.test(line) ||
      /^\d+\.\s*[\u4e00-\u9fff]/.test(line)
    );
    if (start >= 0) return enforceOutputLanguage(afterLines.slice(start).join("\n"), lang);
    return enforceOutputLanguage(after, lang);
  }

  const officialStart = lines.findIndex(line =>
    /^(任务类型|任务分析|成员调度|建议分工|整合建议|下一步|我将|已收到|收到|已成功读取|已读取|根据文档|根据你提供的信息|由于附件内容未读取)/.test(line) ||
    /^#{1,3}\s*(任务|成员|整合|下一步)/.test(line)
  );
  if (officialStart >= 0) {
    return enforceOutputLanguage(lines.slice(officialStart).join("\n"), lang);
  }

  const quotedTail = value.match(/["“]([^"“”]{2,180})["”]?\s*$/);
  if (quotedTail?.[1]) return enforceOutputLanguage(quotedTail[1].trim(), lang);
  const chineseBlocks = value
    .split(/\n{2,}/)
    .map(block => block.trim())
    .filter(block =>
      /[\u4e00-\u9fff]/.test(block) &&
      !/(User's input|Persona|Role Details|Constraints|Current Task|system prompt|Self-Correction|Wait,|Actually,)/i.test(block)
    );
  if (chineseBlocks.length) return enforceOutputLanguage(chineseBlocks[chineseBlocks.length - 1], lang);
  const plainTail = [...lines].reverse().find(line =>
    /[\u4e00-\u9fff]/.test(line) &&
    !/^(\*|-|\d+\.)/.test(line) &&
    !metaPattern.test(line)
  );
  return enforceOutputLanguage(plainTail || "当前模型返回了内部分析内容，已拦截。请重新发送任务或切换模型。", lang);
}

function cleanHistoryMessage(message, lang = "zh") {
  const text = `${message.text || ""}`;
  if (message.role !== "ai") return text;
  const cleaned = sanitizeModelText(text, lang);
  if (/Target Response|Refined Task Plan|Self-Correction|User's input|Persona|Current Task/i.test(cleaned)) {
    return "";
  }
  return cleaned;
}

function toPrompt(systemPrompt, messages, lang = "zh") {
  return [
    systemPrompt,
    responsePolicy(lang),
    skillPolicy(lang),
    "",
    ...messages
      .filter(m => m.role === "user" || m.role === "ai")
      .map(m => ({ role:m.role, text:cleanHistoryMessage(m, lang) }))
      .filter(m => m.text.trim())
      .map(m => `${m.role === "ai" ? "assistant" : "user"}: ${m.text}`),
  ].join("\n");
}

function clientApiKeysEnabled() {
  if (process.env.NODE_ENV === "production" && process.env.ENABLE_CLIENT_API_KEYS === "true") {
    console.warn("ENABLE_CLIENT_API_KEYS=true is unsafe in production; ignoring client-supplied provider keys.");
    return false;
  }
  if (process.env.ENABLE_CLIENT_API_KEYS === "true") return true;
  return process.env.NODE_ENV !== "production" && process.env.ENABLE_CLIENT_API_KEYS !== "false";
}

function providerApiKey(overrideKey, envName) {
  if (clientApiKeysEnabled() && overrideKey) return overrideKey;
  return process.env[envName];
}

function providerError(provider, message, status, modelLabel = "") {
  const text = `${message || ""}`.trim();
  const lower = text.toLowerCase();
  const prefix = modelLabel ? `${provider}（${modelLabel}）` : provider;
  if (!text) return `${prefix} 请求失败。`;
  if (lower.includes("internal error encountered") || lower.includes("internal error")) {
    return `${prefix} 服务端内部错误。通常是模型服务临时异常或该模型当前不可用，请稍后重试，或手动切换到 Gemini 2.5 Flash。`;
  }
  if (isQuotaExhaustionMessage(text, status)) {
    return `${prefix} 额度或频率限制不足：${text}`;
  }
  if (lower.includes("api key") || lower.includes("permission") || lower.includes("unauthorized") || status === 401 || status === 403) {
    return `${prefix} API Key 或权限错误：${text}`;
  }
  if (lower.includes("not found") || lower.includes("not supported")) {
    return `${prefix} 模型不可用或模型名称不受支持：${text}`;
  }
  if (lower.includes("high demand") || lower.includes("unavailable") || status === 503) {
    return `${prefix} 当前繁忙或暂不可用：${text}`;
  }
  return `${prefix} 请求失败：${text}`;
}

export async function POST(request) {
  if (!await isAuthenticatedAsync(request)) {
    await auditEvent(request, { type:"chat.auth_failed", status:"blocked" });
    return Response.json({ error: "未登录" }, { status: 401 });
  }
  if (!await checkRateLimitAsync({ request, namespace:"chat", limit:CHAT_RATE_LIMIT, windowMs:CHAT_RATE_WINDOW_MS })) {
    await auditEvent(request, { type:"chat.rate_limited", status:"blocked" });
    return rateLimitResponse("Chat rate limit exceeded");
  }

  let body;
  try {
    body = await readJsonLimited(request, CHAT_MAX_REQUEST_BYTES);
  } catch (error) {
    return requestBodyTooLargeResponse(error) || Response.json({ error: "Invalid request" }, { status: 400 });
  }
  const { modelKey, systemPrompt, messages = [], apiKeys, options = {} } = body;
  const userText = lastUserText(messages);
  const lang = detectLanguage(userText, options.language || "zh");
  const effectiveOptions = { ...options, language:lang };
  if (containsSensitiveSecret(chatSecretScanText(systemPrompt, messages))) {
    await auditEvent(request, { type:"chat.secret_blocked", status:"blocked" });
    return sensitiveContentResponse();
  }

  if (modelKey === "claude") {
    await auditEvent(request, { type:"chat.model_request", status:"ok", target:"claude" });
    return callAnthropic(systemPrompt, messages, apiKeys?.anthropic, effectiveOptions);
  }
  if (modelKey === "gemma31" || modelKey === "gemma26" || modelKey === "flash") {
    await auditEvent(request, { type:"chat.model_request", status:"ok", target:modelKey });
    return callGoogle(modelKey, systemPrompt, messages, apiKeys?.google, effectiveOptions);
  }

  return Response.json({ error: "Unsupported model" }, { status: 400 });
}

function reasoningBudget(level, provider) {
  const table = provider === "anthropic"
    ? { low: 1024, medium: 2048, high: 4096 }
    : { low: 512, medium: 1024, high: 2048 };
  return table[level] || table.medium;
}

function shouldThink(options) {
  return options?.thinkingMode === "on";
}

function thinkingPrompt(options) {
  if (!shouldThink(options)) return "";
  const level = options.reasoningLevel === "high" ? "深度" : options.reasoningLevel === "low" ? "轻量" : "标准";
  return `请使用${level}推理模式处理本次请求：先充分分析约束、风险和步骤，再给出清晰结论。不要输出隐藏思维链，只输出必要的推理摘要和最终答案。\n\n`;
}

async function callAnthropic(systemPrompt, messages, overrideKey, options = {}) {
  const apiKey = providerApiKey(overrideKey, "ANTHROPIC_API_KEY");
  if (!apiKey) {
    return Response.json({ error: "ANTHROPIC_API_KEY is not configured" }, { status: 500 });
  }
  const budget = reasoningBudget(options.reasoningLevel, "anthropic");
  const body = {
    model: "claude-sonnet-4-20250514",
    max_tokens: shouldThink(options) ? budget + THINKING_OUTPUT_TOKENS : MODEL_OUTPUT_TOKENS,
    system: `${systemPrompt}\n\n${responsePolicy(options.language || "zh")}`,
    messages: messages
      .filter(m => m.role === "user" || m.role === "ai")
      .map(m => {
        const content = [{ type:"text", text:cleanHistoryMessage(m, options.language || "zh") }];
        if (m.role === "user" && Array.isArray(m.images)) {
          m.images.forEach(image => content.push({
            type:"image",
            source:{ type:"base64", media_type:image.mimeType || "image/png", data:image.data },
          }));
        }
        return { role: m.role === "ai" ? "assistant" : "user", content };
      })
      .filter(m => m.content.some(part => part.type !== "text" || part.text.trim())),
  };
  if (shouldThink(options)) {
    body.thinking = { type: "enabled", budget_tokens: budget };
  }

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    const message = providerError("Anthropic Claude", data.error?.message || "Anthropic request failed", res.status);
    return Response.json({ error: message }, { status: res.status || 500 });
  }

  const data = await res.json();
  const text = data.content
    ?.filter(item => item.type === "text")
    .map(item => item.text || "")
    .join("") || "无响应";
  return Response.json({ text: sanitizeModelText(text, options.language || "zh") });
}

async function callGoogle(modelKey, systemPrompt, messages, overrideKey, options = {}) {
  const apiKey = providerApiKey(overrideKey, "GOOGLE_API_KEY");
  if (!apiKey) {
    return Response.json({ error: "GOOGLE_API_KEY is not configured" }, { status: 500 });
  }

  const result = await requestGoogleModel(modelKey, systemPrompt, messages, apiKey, options);
  if (result.ok) {
    return Response.json({
      text: sanitizeModelText(result.text || "无响应", options.language || "zh"),
      actualModel: GOOGLE_MODEL_IDS[modelKey],
    });
  }

  return Response.json({
    error: providerError("Google Gemini/Gemma", result.error || "Google request failed", result.status, GOOGLE_MODEL_LABELS[modelKey]),
    actualModel: GOOGLE_MODEL_IDS[modelKey],
  }, { status: result.status || 500 });
}

async function requestGoogleModel(modelKey, systemPrompt, messages, apiKey, options = {}) {
  const model = GOOGLE_MODEL_IDS[modelKey];
  const generationConfig = {
    maxOutputTokens: MODEL_OUTPUT_TOKENS,
  };
  if (shouldThink(options) && modelKey === "flash") {
    generationConfig.thinkingConfig = {
      thinkingBudget: reasoningBudget(options.reasoningLevel, "google"),
    };
  }
  const images = lastUserImages(messages);
  const parts = [
    { text: `${thinkingPrompt(options)}${toPrompt(systemPrompt, messages, options.language || "zh")}` },
    ...images.map(image => ({
      inlineData: {
        mimeType: image.mimeType || "image/png",
        data: image.data,
      },
    })),
  ];
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
          parts,
        },
      ],
      generationConfig,
    }),
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    return { ok: false, status: res.status || 500, error: data.error?.message || "Google request failed" };
  }

  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.map(p => p.text || "").join("") || "无响应";
  return { ok: true, text };
}
