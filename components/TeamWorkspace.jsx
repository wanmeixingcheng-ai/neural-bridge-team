"use client";

import { useState, useRef, useEffect } from "react";
import mammoth from "mammoth/mammoth.browser";
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";
import {
  ATTACHMENT_TEXT_BUDGET_CHARS,
  ATTACHMENT_TEXT_PER_FILE_CHARS,
  estimateTokensFromChars,
  formatBytes,
  validateAttachmentTotalSize,
  validateImageCount,
  validateImageFile,
} from "../lib/attachmentPolicy.mjs";
import {
  emptyWorkflowState,
  buildWorkflowPlanEditPrompt,
  buildWorkflowRetryPrompt,
  buildWorkflowSkipPrompt,
  buildWorkflowResumePrompt,
  buildWorkflowPlan,
  buildWorkflowConfirmationPrompt,
  extractPriorWorkflowResults,
  memberWorkflowTask,
  planWorkflowDispatchWithModel,
  recentConversationContext,
  summarizeForWorkflow,
  wantsPriorIntegration,
  workflowQueueSummary,
  workflowFailureReassignmentPlan,
  workflowAuditSummary,
  workflowLifecycleSteps,
  workflowPermissionChecklist,
  workflowQualityCheck,
  workflowOutputQaChecklist,
  workflowStatusLabel,
  workflowToolCallChecklist,
  workflowExternalDisclosureLines,
} from "../lib/taskEngine.mjs";
import {
  approveProjectMemory,
  archiveLowValueMemories,
  brainContextPrompt,
  deleteKnowledgeDb,
  deleteKnowledgeDocument,
  deleteProjectMemory,
  enforceMemoryRetention,
  exportKnowledgeLibrary,
  importKnowledgeLibrary,
  knowledgeStats,
  learnFromExchange,
  listKnowledgeDocuments,
  listProjectMemories,
  putKnowledgeDocument,
  putProjectMemory,
  rememberWorkflowArtifact,
  searchKnowledgeForPanel,
  updateKnowledgeDocument,
  updateProjectMemory,
} from "../lib/projectBrain.mjs";
import {
  callModel,
  detectInputLanguage,
  localOnlyBlockMessage,
  modelUsageSummary,
  outboundBlockedByLocalOnly,
  outboundProviderLabel,
  urlsToPrompt,
} from "../lib/modelGateway.mjs";
import {
  clearMemoryConflictMetadata,
  memoryHasConflict,
} from "../lib/memoryPolicy.mjs";
import {
  clearWorkflowState,
  loadWorkflowState,
  saveWorkflowState,
} from "../lib/workflowStorage.mjs";
import {
  artifactContentHash,
  buildWorkflowContinuationPrompt,
  buildWorkflowKnowledgePayload,
  buildWorkflowRecordDetails,
  buildWorkflowRecoveryPrompt,
  buildWorkflowRerunPrompt,
  deleteWorkflowArchive,
  formatWorkflowArtifactMarkdown,
  formatWorkflowRecordMarkdown,
  listWorkflowRecords,
  markWorkflowRecordArchived,
  saveWorkflowRecord,
} from "../lib/workflowArchive.mjs";

// ─── THEME ───────────────────────────────────────────────────────────────────
const T = {
  bg: "#eef1f7", surface: "#ffffff", card: "#f5f7fb", border: "#e4e8ef",
  blue: "#2d6fbe", blueGlow: "#2d6fbe20", orange: "#e8941a", orangeGlow: "#e8941a20",
  green: "#1e6b3a", yellow: "#b7770d", red: "#c0392b", purple: "#6c3483",
  text: "#1a1a2e", muted: "#8a93a8", faint: "#c0c8d8",
  gemini: "#4285f4", gemma31: "#0f9d58", gemma26: "#34a853", codex: "#10b981",
};

const DATE_LOCALES = { zh:"zh-CN", ja:"ja-JP", en:"en-US" };
const CHAT_HISTORY_KEY = "nb_chat_history";
const CHAT_HISTORY_LIMIT = 24;

const I18N = {
  zh: {
    settings:"设置", workspace:"项目工作台", departments:"部门", groups:"群组", projects:"项目", automations:"自动化", search:"搜索", conversations:"对话",
    knowledge:"知识库",
    mainLabels:"主标签", members:"成员", noResults:"无结果", customMembers:"自定义成员",
    coreGroup:"核心群组", execGroup:"执行群组", bizGroup:"商业群组", allGroup:"全员群组", customGroup:"自定义群组",
    searchPlaceholder:"搜索成员、项目、对话", task:"任务", projectPath:"项目目录", automationTask:"自动化任务",
    loggedIn:"已登录", groupChat:"群组对话", collaborating:"名成员协作", saveLocal:"本地下载保存", generating:"正在生成回复...", groupGenerating:"群组成员正在依次回复...",
    commandTo:"向", sendCommand:"下达指令...", sendTask:"下达任务...", login:"登录", loggingIn:"登录中...", password:"访问密码",
    settingsTitle:"设置", loginUser:"登录用户", username:"用户名", language:"语言", autoLanguage:"自动（系统语言优先）", chinese:"中文", japanese:"日本語", english:"English",
    apiHelp:"API Key 和高权限 token 仅保存在当前页面内存，刷新后清空；普通偏好才会保存到浏览器。业务数据优先本地处理；调用云端模型、网页读取、GitHub 队列或远程部署服务时，相关内容可能发送至对应服务。",
    memberManagement:"成员管理", addMember:"增加成员", cancel:"取消", save:"保存", selectGroupMembers:"选择要参与群组对话的成员", startGroup:"开始群聊",
    newMember:"新成员", customMemberTitle:"自定义成员",
    ready:"已就绪。发送一条任务后，群组成员会依次回复。", requestFailed:"请求失败", unknownError:"未知错误",
    dept_command:"调度中心", dept_strategy:"产品与战略部", dept_market:"市场与商业部", dept_engineering:"技术执行部", dept_quality:"质量与数据部", dept_support:"文案法务财务部", dept_custom:"自定义成员",
    project_workspace:"工作台改版", project_automation:"自动化任务", project_docs:"文档与方案",
    "auto_issue-runner":"GitHub Issue 自动执行", "auto_file-save":"浏览器本地下载保存", auto_deploy:"Vercel 生产部署",
    conv_aria:"ARIA 调度记录", conv_dev:"开发任务记录", conv_save:"保存任务记录", conv_dispatch:"总调度", conv_codex:"Codex 自动化",
  },
  ja: {
    settings:"設定", workspace:"プロジェクトワークスペース", departments:"部門", groups:"グループ", projects:"プロジェクト", automations:"自動化", search:"検索", conversations:"会話",
    knowledge:"知識庫",
    mainLabels:"メイン項目", members:"メンバー", noResults:"結果なし", customMembers:"カスタムメンバー",
    coreGroup:"中核グループ", execGroup:"実行グループ", bizGroup:"ビジネスグループ", allGroup:"全員グループ", customGroup:"カスタムグループ",
    searchPlaceholder:"メンバー、プロジェクト、会話を検索", task:"タスク", projectPath:"プロジェクトディレクトリ", automationTask:"自動化タスク",
    loggedIn:"ログイン中", groupChat:"グループ会話", collaborating:"名が共同作業中", saveLocal:"ローカル保存", generating:"返信を生成中...", groupGenerating:"グループメンバーが順番に返信中...",
    commandTo:"", sendCommand:"に指示を入力...", sendTask:"にタスクを入力...", login:"ログイン", loggingIn:"ログイン中...", password:"アクセスパスワード",
    settingsTitle:"設定", loginUser:"ログインユーザー", username:"ユーザー名", language:"言語", autoLanguage:"自動（システム言語優先）", chinese:"中文", japanese:"日本語", english:"English",
    apiHelp:"API Key と高権限 token は現在のページメモリだけに保持され、再読み込み後は消えます。通常の設定だけがブラウザに保存されます。業務データはローカル処理を優先しますが、クラウドモデル、Web読取、GitHub キュー、リモートデプロイを使う場合は関連内容が各サービスへ送信されることがあります。",
    memberManagement:"メンバー管理", addMember:"メンバー追加", cancel:"キャンセル", save:"保存", selectGroupMembers:"グループ会話に参加するメンバーを選択", startGroup:"グループ開始",
    newMember:"新規メンバー", customMemberTitle:"カスタムメンバー",
    ready:"準備完了です。タスクを送信すると、グループメンバーが順番に返信します。", requestFailed:"リクエスト失敗", unknownError:"不明なエラー",
    dept_command:"司令部", dept_strategy:"プロダクト戦略部", dept_market:"市場・事業部", dept_engineering:"技術実行部", dept_quality:"品質・データ部", dept_support:"文案・法務・財務部", dept_custom:"カスタムメンバー",
    project_workspace:"ワークスペース改修", project_automation:"自動化タスク", project_docs:"文書・企画",
    "auto_issue-runner":"GitHub Issue 自動実行", "auto_file-save":"ブラウザ経由でローカル保存", auto_deploy:"Vercel 本番デプロイ",
    conv_aria:"ARIA 指揮記録", conv_dev:"開発タスク記録", conv_save:"保存タスク記録", conv_dispatch:"総合指揮", conv_codex:"Codex 自動化",
  },
  en: {
    settings:"Settings", workspace:"Project workspace", departments:"Departments", groups:"Groups", projects:"Projects", automations:"Automation", search:"Search", conversations:"Chats",
    knowledge:"Knowledge",
    mainLabels:"Main labels", members:"members", noResults:"No results", customMembers:"Custom members",
    coreGroup:"Core group", execGroup:"Execution group", bizGroup:"Business group", allGroup:"All-hands group", customGroup:"Custom group",
    searchPlaceholder:"Search members, projects, chats", task:"Task", projectPath:"Project directory", automationTask:"Automation task",
    loggedIn:"Signed in", groupChat:"Group chat", collaborating:"members collaborating", saveLocal:"Download locally", generating:"Generating reply...", groupGenerating:"Group members are replying...",
    commandTo:"Message ", sendCommand:"...", sendTask:" task...", login:"Log in", loggingIn:"Logging in...", password:"Access password",
    settingsTitle:"Settings", loginUser:"Signed-in user", username:"Username", language:"Language", autoLanguage:"Auto (system language first)", chinese:"中文", japanese:"日本語", english:"English",
    apiHelp:"API keys and privileged tokens are kept only in current page memory and cleared on reload; only non-secret preferences are saved in the browser. Business data is handled locally first; cloud models, web reading, GitHub queues, or remote deployment services may receive related content when used.",
    memberManagement:"Member management", addMember:"Add member", cancel:"Cancel", save:"Save", selectGroupMembers:"Select members for the group chat", startGroup:"Start group chat",
    newMember:"New member", customMemberTitle:"Custom member",
    ready:"is ready. Send a task and members will reply in sequence.", requestFailed:"Request failed", unknownError:"Unknown error",
    dept_command:"Command Center", dept_strategy:"Product & Strategy", dept_market:"Market & Business", dept_engineering:"Engineering", dept_quality:"Quality & Data", dept_support:"Content, Legal & Finance", dept_custom:"Custom members",
    project_workspace:"Workspace redesign", project_automation:"Automation tasks", project_docs:"Docs & plans",
    "auto_issue-runner":"GitHub Issue runner", "auto_file-save":"Browser local download save", auto_deploy:"Vercel production deploy",
    conv_aria:"ARIA dispatch log", conv_dev:"Development task log", conv_save:"Save task log", conv_dispatch:"Coordinator", conv_codex:"Codex automation",
  },
};

function effectiveLanguage(value) {
  if (!value || value === "auto") return defaultLanguage();
  return I18N[value] ? value : "zh";
}

function t(lang, key) {
  return I18N[lang]?.[key] || I18N.zh[key] || key;
}

function loadChatHistory() {
  try {
    const data = JSON.parse(localStorage.getItem(CHAT_HISTORY_KEY) || "[]");
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

function saveChatHistory(sessions) {
  try {
    localStorage.setItem(CHAT_HISTORY_KEY, JSON.stringify(sessions.slice(0, CHAT_HISTORY_LIMIT)));
  } catch {}
}

function chatPreview(messages = []) {
  const item = [...messages].reverse().find(message => message?.text?.trim());
  return `${item?.text || ""}`.replace(/\s+/g, " ").trim().slice(0, 72);
}

function firstUserTitle(messages = [], fallback = "New chat") {
  const item = messages.find(message => message?.role === "user" && message?.text?.trim());
  return `${item?.text || fallback}`.replace(/\s+/g, " ").trim().slice(0, 36) || fallback;
}

// ─── MODEL CONFIG ─────────────────────────────────────────────────────────────
const MODELS = {
  claude:  { name: "Claude Sonnet", color: T.orange,  tag: "Claude"       },
  codex:   { name: "Codex",         color: T.codex,   tag: "Codex"        },
  gemma31: { name: "Gemma 4 31B",   color: T.gemma31, tag: "Gemma 4 31B"  },
  gemma26: { name: "Gemma 4 26B",   color: T.gemma26, tag: "Gemma 4 26B"  },
  flash:   { name: "Gemini2.5Flash", color: T.gemini, tag: "Gemini2.5Flash" },
};

function workflowModeColor(mode) {
  if (mode === "done") return T.green;
  if (mode === "failed") return T.red;
  if (mode === "stopped" || mode === "waiting_confirmation") return T.yellow;
  if (mode === "running" || mode === "summarizing" || mode === "planning") return T.blue;
  return T.muted;
}

// ─── TEAM DATA ────────────────────────────────────────────────────────────────
const TEAM = [
  {
    id:"aria", layer:0, name:"ARIA", title:"总调度", emoji:"◎", model:"claude",
    tags:["智能路由","任务分发","结果整合"],
    systemPrompt:`你是Neural Bridge项目总调度ARIA（AI Router & Integration Agent）。
职责：分析用户需求 → 判断需要哪些团队成员 → 分发任务说明 → 整合汇总。
Neural Bridge：面向日本中小不动产公司的AI助手，业务数据优先本地处理，本地 IndexedDB，PWA，14个AI角色；调用云端模型、网页读取、GitHub 队列或远程部署服务时，相关内容可能发送至对应服务。
团队共18名成员分3层。当用户提出任务时：1）分析任务类型 2）列出需要介入的成员及其分工 3）给出整合建议和下一步行动。严谨专业，直接切入重点，用中文回复。`,
  },
  // 第一层
  { id:"cpo",  layer:1, name:"陈远航", title:"首席产品官 CPO", emoji:"◈", model:"gemma31",
    tags:["产品战略","功能优先级","体验决策"],
    systemPrompt:`你是Neural Bridge首席产品官陈远航，十年ToB SaaS产品经验。职责：产品战略、功能优先级、用户体验把控。项目背景：面向日本中小不动产公司，业务数据优先本地处理，PWA，14个AI角色，IndexedDB；调用云端模型、网页读取、GitHub 队列或远程部署服务时，相关内容可能发送至对应服务。严谨有决断力，给出具体可执行的产品决策，不泛泛而谈。中文回复。` },
  { id:"cto",  layer:1, name:"山本 剛", title:"首席技术官 CTO", emoji:"⬡", model:"claude",
    tags:["架构决策","技术选型","任务拆解"],
    systemPrompt:`你是Neural Bridge首席技术官山本剛，全栈架构师，专注PWA与隐私安全。职责：技术选型、架构决策、将需求拆解为可执行的开发任务规格。技术栈：React PWA、IndexedDB、最小化身份验证服务器。核心约束：业务数据优先本地处理；调用云端模型、网页读取、GitHub 队列或远程部署服务时，相关内容可能发送至对应服务。严谨精密，输出可直接交工程师执行的技术规格。中文回复。` },
  { id:"pm",   layer:1, name:"林 美穂", title:"项目经理 PM",    emoji:"◇", model:"gemma26",
    tags:["进度追踪","里程碑","风险预警"],
    systemPrompt:`你是Neural Bridge项目经理林美穂，PMP认证，擅长跨团队协调。职责：进度追踪、里程碑制定、风险识别预警。当前阶段：产品规划期。结构化呈现信息，主动识别风险和依赖关系。中文回复。` },
  { id:"pd",   layer:1, name:"张思琪", title:"产品经理",        emoji:"◉", model:"gemma31",
    tags:["PRD","用户故事","验收标准"],
    systemPrompt:`你是Neural Bridge产品经理张思琪，专注用户研究与需求文档。职责：PRD、用户故事、功能细化、验收标准。用户是日本不动产从业者，非技术型。需求描述清晰无歧义，验收标准可量化。中文回复。` },
  { id:"ux",   layer:1, name:"伊藤 彩香", title:"UI/UX设计师",  emoji:"○", model:"gemma26",
    tags:["界面设计","交互流程","设计规范"],
    systemPrompt:`你是Neural Bridge UI/UX设计师伊藤彩香，擅长简洁功能性界面设计。职责：界面设计方向、交互流程、设计规范。产品：移动+PC同等权重PWA，面向日本不动产从业者，需专业感和信赖感。给出具体设计决策，而非模糊建议。中文回复。` },
  { id:"mr",   layer:1, name:"王浩然",  title:"市场研究员",     emoji:"◎", model:"gemma31",
    tags:["市场调研","竞品分析","用户洞察"],
    systemPrompt:`你是Neural Bridge市场研究员王浩然，深耕日本B2B市场五年。职责：日本中小不动产公司调研、竞品分析、用户洞察。数据导向，给出有依据的市场判断。中文回复。` },
  { id:"bs",   layer:1, name:"刘建明",  title:"商业策略师",     emoji:"◆", model:"gemma31",
    tags:["定价模式","商业模式","盈利规划"],
    systemPrompt:`你是Neural Bridge商业策略师刘建明，多个SaaS产品商业化经验。职责：定价策略、商业模式、免費枠方案、盈利路径。约束：服务器只做身份验证，无法按用量计费，需创新定价思路。务实决断，量化收益预测。中文回复。` },
  { id:"ba",   layer:1, name:"中村 誠", title:"商业分析师",     emoji:"◈", model:"gemma31",
    tags:["市场规模","竞争格局","ROI分析"],
    systemPrompt:`你是Neural Bridge商业分析师中村誠，擅长市场规模测算与竞品建模。职责：市场规模分析、竞争格局评估、投资回报测算。数据严谨，用数字说话。中文回复。` },
  // 第二层
  { id:"fe",   layer:2, name:"陈志远",  title:"前端工程师",     emoji:"⬢", model:"codex",
    tags:["React","PWA","IndexedDB"],
    systemPrompt:`你是Neural Bridge前端工程师陈志远，React/PWA专家。职责：接收CTO技术规格，生成可直接在Codex执行的前端任务单。技术栈：React、PWA、IndexedDB。输出需包含文件路径、组件结构、具体实现。严谨精确。中文说明，代码英文。` },
  { id:"be",   layer:2, name:"李志强",  title:"后端工程师",     emoji:"⬡", model:"codex",
    tags:["身份验证","API设计","安全"],
    systemPrompt:`你是Neural Bridge后端工程师李志强，专注最小化服务器架构与安全。职责：设计最小化身份验证服务器，生成Codex可执行的后端任务单。核心约束：业务数据优先本地处理，服务器侧仅保留必要认证与受控代理能力；调用云端模型、网页读取、GitHub 队列或远程部署服务时，相关内容可能发送至对应服务。安全优先，代码精简。中文说明，代码英文。` },
  { id:"ai",   layer:2, name:"赵思远",  title:"AI集成工程师",   emoji:"◎", model:"codex",
    tags:["Prompt设计","API集成","角色逻辑"],
    systemPrompt:`你是Neural Bridge AI集成工程师赵思远，Prompt工程与LLM集成专家。职责：为14个不动产AI角色设计System Prompt，设计API调用逻辑。14个角色包括：賃貸仲介、売買仲介、契約書チェッカー、法規確認、税務Q&A、ローン相談、物件調査、メール文案、リノベ提案、風水アドバイザー、財務会計、集客SNS、管理業務、多言語対応。严谨专业。中文回复。` },
  { id:"qa",   layer:2, name:"吴晓敏",  title:"QA测试工程师",   emoji:"◇", model:"gemma26",
    tags:["测试用例","兼容性","质量保证"],
    systemPrompt:`你是Neural Bridge QA测试工程师吴晓敏，跨端兼容测试专家。职责：测试用例、跨端兼容矩阵、功能验收方案。重点：PWA在iOS/Android/PC的兼容性，IndexedDB数据完整性，离线功能。严谨细致，覆盖边界场景。中文回复。` },
  { id:"audit",layer:2, name:"孙建国",  title:"开发审计",       emoji:"◈", model:"claude",
    tags:["代码安全","合规审查","技术债"],
    systemPrompt:`你是Neural Bridge开发审计孙建国，代码安全审查与合规专家。职责：代码质量审查、开发流程合规、安全漏洞识别、技术债评估。重点：验证业务数据优先本地处理、外发路径透明可控、IndexedDB安全性、身份验证安全。严格客观，安全问题零容忍。中文回复。` },
  { id:"da",   layer:2, name:"赵雨桐",  title:"数据分析师",     emoji:"◉", model:"gemma26",
    tags:["用户行为","产品指标","增长分析"],
    systemPrompt:`你是Neural Bridge数据分析师赵雨桐，用户行为数据与产品增长分析专家。职责：数据埋点方案、产品指标体系、用户行为分析框架。约束：数据存本地IndexedDB，无服务器端数据收集。数据驱动，指标清晰可量化。中文回复。` },
  // 第三层
  { id:"copy", layer:3, name:"小林 奈緒",title:"文案策划",      emoji:"○", model:"gemma26",
    tags:["日文文案","营销素材","双语"],
    systemPrompt:`你是Neural Bridge文案策划小林奈緒，中日双语文案，不动产行业经验。职责：产品文案、营销素材、官网内容、日文UI文字。品牌调性：专业可信赖，核心承诺「あなたのデータは、あなたの手元に」。文案精准有力，日文地道自然。默认只使用用户输入语言回复；只有用户明确要求双语或翻译时才输出多语言。` },
  { id:"legal",layer:3, name:"山田 律子",title:"法务顾问",      emoji:"◆", model:"gemma26",
    tags:["隐私法规","数据合规","用户协议"],
    systemPrompt:`你是Neural Bridge法务顾问山田律子，专注日本隐私法与数据合规。职责：隐私政策、用户协议、数据处理合规性，确保符合日本个人情報保護法。重点：隐私优先、本地优先和外发路径透明披露的法律表述。严谨准确，给出具体修改建议。中文回复。` },
  { id:"cfo",  layer:3, name:"郑国强",  title:"财务总监 CFO",   emoji:"◈", model:"gemma26",
    tags:["预算管理","财务规划","融资准备"],
    systemPrompt:`你是Neural Bridge财务总监郑国强，擅长早期创业公司财务规划。职责：预算管理、成本核算、收支规划、融资准备。现状：产品规划阶段，尚无收入，需控制开发成本。务实稳健，数字清晰。中文回复。` },
  { id:"fa",   layer:3, name:"木村 恵子",title:"财务分析师",    emoji:"◇", model:"gemma26",
    tags:["财务预测","现金流","成本分析"],
    systemPrompt:`你是Neural Bridge财务分析师木村恵子，现金流预测与成本结构分析专家。职责：财务模型、现金流预测、成本结构分析、盈亏平衡测算。数据精确，模型严谨。中文回复。` },
];

const LAYERS = {
  0: { label: "总调度", color: T.orange },
  1: { label: "第一层 · 核心参谋", color: T.blue },
  2: { label: "第二层 · 专项执行", color: T.green },
  3: { label: "第三层 · 商业支撑", color: T.yellow },
};

const DEPARTMENTS = [
  { id:"command", name:"调度中心", color:T.orange, members:["aria"] },
  { id:"strategy", name:"产品与战略部", color:T.blue, members:["cpo","pd","pm","ux"] },
  { id:"market", name:"市场与商业部", color:T.gemma31, members:["mr","bs","ba"] },
  { id:"engineering", name:"技术执行部", color:T.codex, members:["cto","fe","be","ai","audit"] },
  { id:"quality", name:"质量与数据部", color:T.green, members:["qa","da"] },
  { id:"support", name:"文案法务财务部", color:T.yellow, members:["copy","legal","cfo","fa"] },
];

const PROJECTS = [
  { id:"workspace", name:"工作台改版", path:"outputs/neural-bridge-workspace" },
  { id:"automation", name:"自动化任务", path:"outputs/neural-bridge-automation" },
  { id:"docs", name:"文档与方案", path:"outputs/neural-bridge-docs" },
];

const AUTOMATION_TASKS = [
  { id:"issue-runner", name:"GitHub Issue 自动执行" },
  { id:"file-save", name:"浏览器本地下载保存" },
  { id:"deploy", name:"Vercel 生产部署" },
];

function defaultLanguage() {
  if (typeof navigator === "undefined") return "zh";
  const lang = (navigator.language || "").toLowerCase();
  if (lang.startsWith("ja")) return "ja";
  if (lang.startsWith("en")) return "en";
  return "zh";
}

// ─── LOCAL FILE OUTPUT ──────────────────────────────────────────────────────────
function localSaveFileName(member) {
  const raw = `${member?.name || "Neural Bridge"} ${member?.title || ""}`.trim();
  const safe = raw.replace(/[\\/:*?"<>|]/g, "_").replace(/\s+/g, "-").slice(0, 60) || "Neural-Bridge";
  return `${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}-${safe}.md`;
}

async function saveToLocalOutputs(member, text) {
  const fileName = localSaveFileName(member);
  const blob = new Blob([`${text || ""}`], { type:"text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
  return fileName;
}

// ─── SETTINGS MODAL ───────────────────────────────────────────────────────────
function SettingsModal({ keys, onSave, onClose }) {
  const [vals, setVals] = useState({ anthropic: keys.anthropic||"", google: keys.google||"" });
  const [show, setShow] = useState({});
  const fields = [
    { key:"anthropic", label:"Anthropic API Key", hint:"Claude · sk-ant-...", color: T.orange },
    { key:"google",    label:"Google AI Studio Key", hint:"Gemma 4 31B / Gemma 4 26B / Gemini2.5Flash · AIza...", color: T.gemini },
  ];
  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.8)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:500, backdropFilter:"blur(8px)" }} onClick={onClose}>
      <div onClick={e=>e.stopPropagation()} style={{ background:T.surface, border:`1px solid ${T.border}`, borderRadius:"20px", padding:"28px", width:"90%", maxWidth:"460px" }}>
        <div style={{ fontSize:"16px", fontWeight:800, color:T.text, marginBottom:"4px" }}>API Key 设置</div>
        <div style={{ fontSize:"12px", color:T.muted, marginBottom:"22px" }}>Key 仅保存在当前页面内存，不会上传任何服务器</div>
        {fields.map(f => (
          <div key={f.key} style={{ marginBottom:"14px" }}>
            <div style={{ fontSize:"11px", fontWeight:700, color:f.color, marginBottom:"6px", letterSpacing:"0.06em" }}>{f.label}</div>
            <div style={{ position:"relative" }}>
              <input type={show[f.key]?"text":"password"} value={vals[f.key]} onChange={e=>setVals(v=>({...v,[f.key]:e.target.value}))}
                placeholder={f.hint}
                style={{ width:"100%", padding:"10px 40px 10px 14px", borderRadius:"10px", border:`1px solid ${vals[f.key]?f.color:T.border}`, background:T.card, color:T.text, fontSize:"12.5px", outline:"none" }} />
              <button onClick={()=>setShow(s=>({...s,[f.key]:!s[f.key]}))} style={{ position:"absolute", right:"10px", top:"50%", transform:"translateY(-50%)", background:"none", border:"none", cursor:"pointer", color:T.muted, fontSize:"14px" }}>
                {show[f.key]?"🙈":"👁️"}
              </button>
            </div>
          </div>
        ))}
        <div style={{ display:"flex", gap:"10px", marginTop:"6px" }}>
          <button onClick={onClose} style={{ flex:1, padding:"11px", borderRadius:"10px", border:`1px solid ${T.border}`, background:"transparent", color:T.muted, fontSize:"13px", cursor:"pointer" }}>取消</button>
          <button onClick={()=>{ onSave(vals); onClose(); }} style={{ flex:2, padding:"11px", borderRadius:"10px", border:"none", background:T.blue, color:"#fff", fontSize:"13px", fontWeight:700, cursor:"pointer" }}>保存</button>
        </div>
      </div>
    </div>
  );
}

// ─── CHAT PANEL ───────────────────────────────────────────────────────────────
function ChatPanel({ member, onClose }) {
  const m = MODELS[member.model];
  const [messages, setMessages] = useState([{ role:"ai", text:`你好，我是${member.name}，${member.title}。${member.id==="aria"?"请告诉我你想推进什么，我来为你调度团队。":`负责${member.tags.join(" · ")}。有什么需要推进的？`}` }]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  const bottomRef = useRef(null);
  useEffect(()=>{ bottomRef.current?.scrollIntoView({behavior:"smooth"}); }, [messages]);

  const send = async (txt) => {
    const text = (txt||input).trim();
    if (!text||loading) return;
    setInput(""); setError(""); setSaved("");
    const newMsgs = [...messages, {role:"user",text}];
    setMessages(newMsgs); setLoading(true);
    try {
      const reply = await callModel(member.model, member.systemPrompt, newMsgs);
      setMessages(m=>[...m,{role:"ai",text:reply}]);
    } catch(e) {
      setError(e.message||"请求失败");
    }
    setLoading(false);
  };

  const saveMessage = async (text) => {
    setError(""); setSaved("");
    try {
      const fileName = await saveToLocalOutputs(member, text);
      setSaved(`已通过浏览器下载保存到本机：${fileName}`);
    } catch (e) {
      setError(e.message || "保存失败");
    }
  };

  const quickPrompts = member.id==="aria"
    ? ["Neural Bridge当前最优先的任务是什么？","帮我制定本周工作计划","分析定价方案，应该召集哪些成员？"]
    : [`${member.title}今天应该推进什么？`,"当前阶段有哪些风险需要注意？","给我一个具体的行动建议"];

  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.75)", display:"flex", alignItems:"flex-end", justifyContent:"center", zIndex:300, backdropFilter:"blur(8px)" }} onClick={onClose}>
      <div onClick={e=>e.stopPropagation()} style={{ background:T.surface, borderRadius:"20px 20px 0 0", width:"100%", maxWidth:"660px", height:"86vh", display:"flex", flexDirection:"column", border:`1px solid ${T.border}`, borderBottom:"none" }}>
        {/* Header */}
        <div style={{ padding:"16px 20px", display:"flex", alignItems:"center", gap:"14px", borderBottom:`1px solid ${T.border}`, flexShrink:0 }}>
          <div style={{ width:44, height:44, borderRadius:"12px", background:`${m.color}18`, border:`1.5px solid ${m.color}40`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:"20px", color:m.color, fontWeight:900 }}>
            {member.emoji}
          </div>
          <div style={{ flex:1 }}>
            <div style={{ fontSize:"15px", fontWeight:800, color:T.text }}>{member.name}</div>
            <div style={{ fontSize:"11px", color:T.muted, marginTop:"1px" }}>{member.title}</div>
          </div>
          <div style={{ background:`${m.color}15`, color:m.color, borderRadius:"8px", padding:"4px 10px", fontSize:"10px", fontWeight:700, letterSpacing:"0.04em" }}>{m.tag}</div>
          <button onClick={onClose} style={{ background:T.card, border:`1px solid ${T.border}`, borderRadius:"8px", width:"32px", height:"32px", cursor:"pointer", color:T.muted, fontSize:"14px", display:"flex", alignItems:"center", justifyContent:"center" }}>✕</button>
        </div>

        {/* Messages */}
        <div style={{ flex:1, overflowY:"auto", padding:"18px 20px", display:"flex", flexDirection:"column", gap:"14px" }}>
          {messages.map((msg,i) => (
            <div key={i} style={{ display:"flex", justifyContent:msg.role==="user"?"flex-end":"flex-start", gap:"10px", alignItems:"flex-end" }}>
              {msg.role==="ai" && (
                <div style={{ width:28, height:28, borderRadius:"8px", background:`${m.color}18`, border:`1px solid ${m.color}30`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:"13px", color:m.color, flexShrink:0 }}>{member.emoji}</div>
              )}
              <div style={{ maxWidth:"78%", padding:"11px 15px", borderRadius: msg.role==="user"?"14px 14px 4px 14px":"14px 14px 14px 4px", background: msg.role==="user"?T.blue:T.card, color:T.text, fontSize:"13.5px", lineHeight:1.75, border:`1px solid ${msg.role==="user"?T.blue:T.border}`, whiteSpace:"pre-wrap" }}>
                {msg.text}
                {msg.role==="ai" && i > 0 && (
                  <div style={{ marginTop:"10px", display:"flex", justifyContent:"flex-end" }}>
                    <button title="内容将通过浏览器下载保存，不经过 GitHub 队列。" onClick={()=>saveMessage(msg.text)} style={{ border:`1px solid ${T.border}`, background:T.surface, color:T.muted, borderRadius:"7px", padding:"4px 8px", fontSize:"10.5px", cursor:"pointer" }}>本地下载保存</button>
                  </div>
                )}
              </div>
            </div>
          ))}
          {loading && (
            <div style={{ display:"flex", gap:"10px", alignItems:"flex-end" }}>
              <div style={{ width:28, height:28, borderRadius:"8px", background:`${m.color}18`, border:`1px solid ${m.color}30`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:"13px", color:m.color }}>{member.emoji}</div>
              <div style={{ padding:"12px 16px", borderRadius:"14px 14px 14px 4px", background:T.card, border:`1px solid ${T.border}` }}>
                <div style={{ display:"flex", gap:"5px" }}>
                  {[0,1,2].map(i=><div key={i} style={{ width:6, height:6, borderRadius:"50%", background:m.color, opacity:0.5, animation:`nb-pulse 1.2s ${i*0.2}s ease-in-out infinite` }}/>)}
                </div>
              </div>
            </div>
          )}
          {error && <div style={{ padding:"10px 14px", borderRadius:"10px", background:"#ef444415", border:"1px solid #ef444430", color:"#ef4444", fontSize:"12.5px" }}>⚠ {error}</div>}
          {saved && <div style={{ padding:"10px 14px", borderRadius:"10px", background:"#10b98115", border:"1px solid #10b98130", color:T.codex, fontSize:"12.5px" }}>{saved}</div>}
          <div ref={bottomRef}/>
        </div>

        {/* Quick prompts */}
        {messages.length<=1 && (
          <div style={{ padding:"0 20px 12px", display:"flex", gap:"8px", flexWrap:"wrap" }}>
            {quickPrompts.map(p=>(
              <button key={p} onClick={()=>send(p)} style={{ padding:"7px 14px", borderRadius:"8px", border:`1px solid ${T.border}`, background:T.card, color:T.muted, fontSize:"12px", cursor:"pointer" }}>{p}</button>
            ))}
          </div>
        )}

        {/* Input */}
        <div style={{ padding:"14px 20px", borderTop:`1px solid ${T.border}`, flexShrink:0 }}>
          <div style={{ display:"flex", gap:"10px", alignItems:"center" }}>
            <input value={input} onChange={e=>setInput(e.target.value)} onKeyDown={e=>e.key==="Enter"&&!e.shiftKey&&send()}
              placeholder={`向${member.name}下达指令…`} disabled={loading}
              style={{ flex:1, padding:"11px 16px", borderRadius:"10px", border:`1px solid ${T.border}`, background:T.card, color:T.text, fontSize:"13.5px", outline:"none" }}/>
            <button onClick={()=>send()} disabled={loading||!input.trim()} style={{ width:42, height:42, borderRadius:"10px", border:"none", background:loading||!input.trim()?T.faint:T.blue, color:"#fff", fontSize:"18px", cursor:loading||!input.trim()?"default":"pointer", display:"flex", alignItems:"center", justifyContent:"center" }}>↑</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function AuthGate({ onAuthenticated }) {
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const login = async () => {
    if (!password.trim() || loading) return;
    setLoading(true); setError("");
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password, remember }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "登录失败");
      onAuthenticated();
    } catch (e) {
      setError(e.message || "登录失败");
    }
    setLoading(false);
  };

  return (
    <div style={{ minHeight:"100vh", display:"flex", alignItems:"center", justifyContent:"center", background:T.bg, padding:"20px", fontFamily:"'Noto Sans SC','PingFang SC','Microsoft YaHei',sans-serif" }}>
      <div style={{ width:"100%", maxWidth:"360px", background:T.surface, border:`1px solid ${T.border}`, borderRadius:"18px", padding:"24px" }}>
        <div style={{ fontSize:"18px", fontWeight:900, color:T.text, marginBottom:"6px" }}>Neural Bridge</div>
        <div style={{ fontSize:"12px", color:T.muted, marginBottom:"18px" }}>请输入访问密码</div>
        <input type="password" value={password} onChange={e=>setPassword(e.target.value)} onKeyDown={e=>e.key==="Enter"&&login()} placeholder="访问密码"
          style={{ width:"100%", padding:"12px 14px", borderRadius:"10px", border:`1px solid ${T.border}`, background:T.card, color:T.text, outline:"none", fontSize:"13px" }} />
        <label style={{ display:"flex", alignItems:"center", gap:"8px", marginTop:"10px", color:T.muted, fontSize:"12px", fontWeight:700 }}>
          <input type="checkbox" checked={remember} onChange={e=>setRemember(e.target.checked)} />
          保持登录（30 天）
        </label>
        {error && <div style={{ marginTop:"10px", color:T.red, fontSize:"12px" }}>{error}</div>}
        <button onClick={login} disabled={loading||!password.trim()} style={{ marginTop:"14px", width:"100%", padding:"12px", borderRadius:"10px", border:"none", background:loading||!password.trim()?T.faint:T.blue, color:"#fff", fontWeight:800, cursor:loading||!password.trim()?"default":"pointer" }}>
          {loading?"登录中...":"登录"}
        </button>
      </div>
    </div>
  );
}

// ─── MEMBER CARD ──────────────────────────────────────────────────────────────
function MemberCard({ member, onClick }) {
  const m = MODELS[member.model];
  const [hov, setHov] = useState(false);
  return (
    <div onClick={onClick} onMouseEnter={()=>setHov(true)} onMouseLeave={()=>setHov(false)}
      style={{ background:hov?T.card:T.surface, border:`1px solid ${hov?m.color+"40":T.border}`, borderRadius:"14px", padding:"16px", cursor:"pointer", transition:"all 0.18s" }}>
      <div style={{ display:"flex", alignItems:"center", gap:"12px", marginBottom:"10px" }}>
        <div style={{ width:36, height:36, borderRadius:"10px", background:`${m.color}15`, border:`1px solid ${m.color}30`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:"16px", color:m.color, fontWeight:900, flexShrink:0 }}>
          {member.emoji}
        </div>
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ fontSize:"13.5px", fontWeight:800, color:T.text }}>{member.name}</div>
          <div style={{ fontSize:"10.5px", color:T.muted, marginTop:"1px" }}>{member.title}</div>
        </div>
        <div style={{ background:`${m.color}12`, color:m.color, borderRadius:"6px", padding:"3px 8px", fontSize:"9.5px", fontWeight:700, flexShrink:0 }}>{m.tag}</div>
      </div>
      <div style={{ display:"flex", gap:"5px", flexWrap:"wrap" }}>
        {member.tags.map(t=>(
          <span key={t} style={{ background:T.bg, border:`1px solid ${T.border}`, color:T.muted, borderRadius:"5px", padding:"3px 8px", fontSize:"10px" }}>{t}</span>
        ))}
      </div>
    </div>
  );
}

// ─── ARIA CARD ────────────────────────────────────────────────────────────────
function AriaCard({ onClick }) {
  const [hov, setHov] = useState(false);
  return (
    <div onClick={onClick} onMouseEnter={()=>setHov(true)} onMouseLeave={()=>setHov(false)}
      style={{ background:hov?"#fff8ed":T.surface, border:`1px solid ${hov?T.orange+"60":T.orange+"30"}`, borderRadius:"18px", padding:"22px 24px", cursor:"pointer", transition:"all 0.2s", marginBottom:"24px", position:"relative", overflow:"hidden", boxShadow:hov?`0 10px 28px ${T.orange}18`:"none" }}>
      <div style={{ position:"absolute", top:-30, right:-30, width:120, height:120, borderRadius:"50%", background:`${T.orange}08` }}/>
      <div style={{ display:"flex", alignItems:"center", gap:"16px" }}>
        <div style={{ width:52, height:52, borderRadius:"14px", background:`${T.orange}18`, border:`1.5px solid ${T.orange}50`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:"24px", color:T.orange, fontWeight:900, flexShrink:0 }}>◎</div>
        <div style={{ flex:1 }}>
          <div style={{ display:"flex", alignItems:"center", gap:"10px", marginBottom:"5px" }}>
            <span style={{ fontSize:"18px", fontWeight:900, color:T.text }}>ARIA</span>
            <span style={{ background:`${T.orange}18`, color:T.orange, borderRadius:"6px", padding:"3px 10px", fontSize:"10px", fontWeight:700 }}>总调度 · Claude Sonnet</span>
          </div>
          <div style={{ fontSize:"12.5px", color:T.muted, lineHeight:1.5 }}>告诉我你想做什么，我自动分析任务、调配18位团队成员协作完成</div>
        </div>
        <div style={{ color:T.orange, fontSize:"18px", opacity: hov?1:0.4, transition:"opacity 0.2s" }}>→</div>
      </div>
    </div>
  );
}

// ─── KEY STATUS BAR ───────────────────────────────────────────────────────────
function KeyStatus({ keys, onOpen }) {
  const statuses = [
    { label:"Claude", ok:!!keys.anthropic, color:T.orange },
    { label:"Google", ok:!!keys.google,    color:T.gemini },
    { label:"Codex",  ok:true,             color:T.codex  },
  ];
  return (
    <button onClick={onOpen} style={{ display:"flex", alignItems:"center", gap:"8px", padding:"7px 14px", borderRadius:"10px", border:`1px solid ${T.border}`, background:T.card, cursor:"pointer" }}>
      {statuses.map(s=>(
        <div key={s.label} style={{ display:"flex", alignItems:"center", gap:"4px" }}>
          <div style={{ width:6, height:6, borderRadius:"50%", background:s.ok?s.color:T.faint }}/>
          <span style={{ fontSize:"10.5px", color:s.ok?s.color:T.faint, fontWeight:600 }}>{s.label}</span>
        </div>
      ))}
      <span style={{ fontSize:"10.5px", color:T.muted, marginLeft:"2px" }}>⚙</span>
    </button>
  );
}

function SidebarMember({ member, active, onClick }) {
  const model = MODELS[member.model];
  return (
    <button onClick={onClick} style={{ width:"100%", display:"flex", alignItems:"center", gap:"10px", padding:"9px 10px", borderRadius:"9px", border:`1px solid ${active?model.color+"55":"transparent"}`, background:active?`${model.color}12`:"transparent", cursor:"pointer", textAlign:"left" }}>
      <span style={{ width:28, height:28, borderRadius:"8px", background:`${model.color}16`, color:model.color, display:"flex", alignItems:"center", justifyContent:"center", fontWeight:900, flexShrink:0 }}>{member.emoji}</span>
      <span style={{ minWidth:0, flex:1 }}>
        <span style={{ display:"block", color:T.text, fontSize:"12.5px", fontWeight:800, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{member.name}</span>
        <span style={{ display:"block", color:T.muted, fontSize:"10px", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{member.title}</span>
      </span>
      <span style={{ color:model.color, fontSize:"9px", fontWeight:800, flexShrink:0 }}>{model.tag}</span>
    </button>
  );
}

function TeamSidebar({ selectedId, onSelect, onGroup, onSettings, open, onCustomGroup, onKnowledge, members, projects, automations, conversations, onConversation, onClose, lang }) {
  const [section, setSection] = useState(null);
  const [deptId, setDeptId] = useState(null);
  const [query, setQuery] = useState("");
  const today = new Date().toLocaleDateString(DATE_LOCALES[lang] || DATE_LOCALES.zh, { year:"numeric", month:"long", day:"numeric", weekday:"long" });
  const memberById = Object.fromEntries(members.map(m => [m.id, m]));
  const filteredMembers = query.trim()
    ? members.filter(m => `${m.name} ${m.title} ${m.tags.join(" ")}`.toLowerCase().includes(query.trim().toLowerCase()))
    : null;
  const assignedMemberIds = new Set(DEPARTMENTS.flatMap(dept => dept.members));
  const customMembers = members.filter(member => !assignedMemberIds.has(member.id));
  const departments = customMembers.length
    ? [...DEPARTMENTS, { id:"custom", name:t(lang, "customMembers"), color:T.purple, members:customMembers.map(m => m.id) }]
    : DEPARTMENTS;
  const activeDept = departments.find(dept => dept.id === deptId);
  const openSection = (next) => {
    setSection(next);
    setDeptId(null);
  };
  const finishNavigation = (action) => {
    action();
    setSection(null);
    setDeptId(null);
    setQuery("");
    onClose?.();
  };
  const sectionTitle = {
    search:t(lang, "search"),
    departments:t(lang, "departments"),
    groups:t(lang, "groups"),
    projects:t(lang, "projects"),
    automations:t(lang, "automations"),
    conversations:t(lang, "conversations"),
  }[section];
  const mainSections = [
    { id:"departments", name:t(lang, "departments"), color:T.blue },
    { id:"groups", name:t(lang, "groups"), color:T.orange },
    { id:"projects", name:t(lang, "projects"), color:T.green },
    { id:"knowledge", name:t(lang, "knowledge"), color:T.purple },
    { id:"automations", name:t(lang, "automations"), color:T.codex },
    { id:"search", name:t(lang, "search"), color:T.purple },
  ];
  return (
    <aside className={`nb-sidebar ${open ? "open" : ""}`}>
      <div style={{ padding:"18px 14px 14px", borderBottom:`1px solid ${T.border}` }}>
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:"10px" }}>
          <div style={{ fontSize:"15px", fontWeight:900, lineHeight:1.15 }}>
            <span style={{ color:T.blue }}>Neural</span><span style={{ color:T.orange }}> Bridge</span>
          </div>
          <button onClick={()=>{ onSettings(); onClose?.(); }} title={t(lang, "settings")} style={{ border:`1px solid ${T.border}`, background:T.card, color:T.muted, borderRadius:"8px", padding:"6px 9px", fontSize:"11px", fontWeight:800, cursor:"pointer" }}>{t(lang, "settings")}</button>
        </div>
        <div style={{ color:T.muted, fontSize:"10.5px", marginTop:"4px" }}>{t(lang, "workspace")} · {today}</div>
      </div>

      <div style={{ flex:1, overflowY:"auto", padding:"12px 10px 18px" }}>
        {!section && (
          <div>
            <div style={{ display:"flex", flexDirection:"column", gap:"6px" }}>
              {mainSections.map(item => (
                <button key={item.id} className="nb-main-row" onClick={()=>item.id==="knowledge" ? finishNavigation(()=>onKnowledge()) : openSection(item.id)}>
                  <span style={{ color:item.color }}>{item.name}</span>
                </button>
              ))}
            </div>
            <div style={{ color:T.muted, fontSize:"12px", fontWeight:800, padding:"18px 8px 8px" }}>{t(lang, "conversations")}</div>
            <div style={{ display:"flex", flexDirection:"column", gap:"3px" }}>
              {!conversations.length && <div style={{ color:T.faint, fontSize:"11px", padding:"8px 10px", lineHeight:1.5 }}>{lang==="ja" ? "まだ保存された会話はありません。" : lang==="en" ? "No saved chats yet." : "暂无已保存对话。"}</div>}
              {conversations.map(conv => (
                <button key={conv.id} className="nb-chat-title-row" onClick={()=>finishNavigation(()=>onConversation(conv))}>
                  <span>{conv.title}</span>
                  <small>{conv.subtitle}</small>
                </button>
              ))}
            </div>
          </div>
        )}

        {section && (
          <div>
            <button className="nb-back-row" onClick={()=>{ deptId ? setDeptId(null) : setSection(null); }}>
              ← {deptId ? sectionTitle : t(lang, "mainLabels")}
            </button>
            <div style={{ color:T.text, fontSize:"13px", fontWeight:900, padding:"6px 8px 12px" }}>
              {activeDept ? t(lang, `dept_${activeDept.id}`) || activeDept.name : sectionTitle}
            </div>

            {section === "search" && (
              <div>
                <input value={query} onChange={e=>setQuery(e.target.value)} placeholder={t(lang, "searchPlaceholder")} style={{ width:"100%", border:`1px solid ${T.border}`, background:T.card, color:T.text, borderRadius:"9px", padding:"9px 10px", fontSize:"12px", outline:"none", marginBottom:"10px" }} />
                <div style={{ display:"flex", flexDirection:"column", gap:"4px" }}>
                  {(filteredMembers || []).map(member => (
                    <SidebarMember key={member.id} member={member} active={member.id===selectedId} onClick={()=>finishNavigation(()=>onSelect(member))} />
                  ))}
                  {query.trim() && (filteredMembers || []).length===0 && <div style={{ color:T.faint, fontSize:"12px", padding:"8px" }}>{t(lang, "noResults")}</div>}
                </div>
              </div>
            )}

            {section === "departments" && !activeDept && departments.map(dept => (
              <button key={dept.id} className="nb-nav-row" onClick={()=>setDeptId(dept.id)}>
                <span style={{ color:dept.color }}>{t(lang, `dept_${dept.id}`) || dept.name}</span>
                <small>{dept.members.length} {t(lang, "members")}</small>
              </button>
            ))}

            {section === "departments" && activeDept && (
              <div style={{ display:"flex", flexDirection:"column", gap:"4px" }}>
                {activeDept.members.map(id => memberById[id]).filter(Boolean).map(member => (
                  <SidebarMember key={member.id} member={member} active={member.id===selectedId} onClick={()=>finishNavigation(()=>onSelect(member))} />
                ))}
              </div>
            )}

            {section === "groups" && (
              <div style={{ display:"flex", flexDirection:"column", gap:"6px" }}>
                <button onClick={()=>finishNavigation(()=>onGroup("core"))} className="nb-side-action" style={{ color:T.blue }}>{t(lang, "coreGroup")}</button>
                <button onClick={()=>finishNavigation(()=>onGroup("exec"))} className="nb-side-action" style={{ color:T.green }}>{t(lang, "execGroup")}</button>
                <button onClick={()=>finishNavigation(()=>onGroup("biz"))} className="nb-side-action" style={{ color:T.yellow }}>{t(lang, "bizGroup")}</button>
                <button onClick={()=>finishNavigation(()=>onGroup("all"))} className="nb-side-action" style={{ color:T.orange }}>{t(lang, "allGroup")}</button>
                <button onClick={()=>finishNavigation(()=>onCustomGroup())} className="nb-side-action" style={{ color:T.purple }}>{t(lang, "customGroup")}</button>
              </div>
            )}

            {section === "projects" && projects.map(project => (
              <button key={project.id} className="nb-nav-row" onClick={()=>finishNavigation(()=>onConversation({ id:`project-${project.id}`, title:t(lang, `project_${project.id}`) || project.name, text:`${t(lang, "projectPath")}：${project.path}` }))}>
                <span>{t(lang, `project_${project.id}`) || project.name}</span><small>{project.path}</small>
              </button>
            ))}

            {section === "automations" && automations.map(task => (
              <button key={task.id} className="nb-nav-row" onClick={()=>finishNavigation(()=>onConversation({ id:`auto-${task.id}`, title:t(lang, `auto_${task.id}`) || task.name, text:`${t(lang, "automationTask")}：${t(lang, `auto_${task.id}`) || task.name}` }))}>
                <span>{t(lang, `auto_${task.id}`) || task.name}</span><small>{t(lang, "task")}</small>
              </button>
            ))}

            {section === "conversations" && (
              conversations.length
                ? conversations.map(conv => (
                  <button key={conv.id} className="nb-nav-row" onClick={()=>finishNavigation(()=>onConversation(conv))}>
                    <span>{conv.title}</span><small>{conv.preview || conv.subtitle}</small>
                  </button>
                ))
                : <div style={{ color:T.faint, fontSize:"12px", padding:"10px" }}>{lang==="ja" ? "会話を送信すると、ここに履歴が表示されます。" : lang==="en" ? "Send a chat and it will appear here." : "发送对话后，这里会显示历史记录。"}</div>
            )}
          </div>
        )}
      </div>

      <div style={{ padding:"10px", borderTop:`1px solid ${T.border}`, background:T.surface }}>
        <button onClick={()=>{ onSettings(); onClose?.(); }} style={{ width:"100%", border:`1px solid ${T.border}`, background:T.card, color:T.text, borderRadius:"10px", padding:"10px", fontSize:"12px", fontWeight:900, cursor:"pointer", textAlign:"left" }}>{t(lang, "settings")}</button>
      </div>
    </aside>
  );
}

function ChatControls({ controls, setControls, defaultModel, lang }) {
  const modelEntries = Object.entries(MODELS);
  const label = (zh, ja, en) => lang === "ja" ? ja : lang === "en" ? en : zh;
  const defaultLabel = defaultModel
    ? `${MODELS[defaultModel]?.tag || defaultModel}`
    : label("各成员默认", "各メンバー既定", "Each member default");
  return (
    <div className="nb-chat-controls">
      <label>
        <span>{label("思考", "思考", "Thinking")}</span>
        <select value={controls.thinkingMode} onChange={e=>setControls(v=>({...v, thinkingMode:e.target.value}))}>
          <option value="off">{label("关闭", "オフ", "Off")}</option>
          <option value="on">{label("开启", "オン", "On")}</option>
        </select>
      </label>
      <label>
        <span>{label("模型", "モデル", "Model")}</span>
        <select value={controls.modelOverride} onChange={e=>setControls(v=>({...v, modelOverride:e.target.value}))}>
          <option value="">{label(`角色默认（${defaultLabel}）`, `役割既定（${defaultLabel}）`, `Role default (${defaultLabel})`)}</option>
          {modelEntries.map(([key, model]) => (
            <option key={key} value={key}>{model.tag}</option>
          ))}
        </select>
      </label>
      <label>
        <span>{label("推理", "推論", "Reasoning")}</span>
        <select value={controls.reasoningLevel} onChange={e=>setControls(v=>({...v, reasoningLevel:e.target.value}))}>
          <option value="low">{label("轻量", "軽量", "Low")}</option>
          <option value="medium">{label("标准", "標準", "Medium")}</option>
          <option value="high">{label("深度", "深度", "High")}</option>
        </select>
      </label>
    </div>
  );
}

function isReadableTextFile(file) {
  return file.type.startsWith("text/") || /\.(txt|md|csv|json|js|jsx|ts|tsx|html|css|xml|yaml|yml|py|java|c|cpp|h|log)$/i.test(file.name);
}

function isDocxFile(file) {
  return file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" || /\.docx$/i.test(file.name);
}

function isPdfFile(file) {
  return file.type === "application/pdf" || /\.pdf$/i.test(file.name);
}

function isImageFile(file) {
  return file.type.startsWith("image/") || /\.(png|jpe?g|webp|gif)$/i.test(file.name);
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function imageDimensions(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const result = { width:img.naturalWidth || img.width, height:img.naturalHeight || img.height };
      URL.revokeObjectURL(url);
      resolve(result);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Image metadata read failed"));
    };
    img.src = url;
  });
}

async function attachmentsToImages(attachments, lang = "zh") {
  const images = [];
  validateImageCount(attachments.filter(item => isImageFile(item.file)).length, lang);
  for (const item of attachments) {
    const file = item.file;
    if (!isImageFile(file)) continue;
    const dimensions = await imageDimensions(file);
    validateImageFile({ file, width:dimensions.width, height:dimensions.height, lang });
    const dataUrl = await fileToDataUrl(file);
    const [, base64 = ""] = `${dataUrl}`.split(",");
    images.push({ name:file.name, mimeType:file.type || "image/png", data:base64, width:dimensions.width, height:dimensions.height });
  }
  return images;
}

async function readPdfText(file) {
  const buffer = await file.arrayBuffer();
  const document = await pdfjsLib.getDocument({ data: buffer, disableWorker: true }).promise;
  const pages = [];
  const limit = Math.min(document.numPages, 80);
  for (let pageNumber = 1; pageNumber <= limit; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const content = await page.getTextContent();
    const text = content.items.map(item => item.str || "").join(" ").replace(/\s+/g, " ").trim();
    if (text) pages.push(`Page ${pageNumber}\n${text}`);
  }
  if (document.numPages > limit) {
    pages.push(`...[PDF truncated after ${limit} pages of ${document.numPages}]`);
  }
  return pages.join("\n\n");
}

async function readAttachmentText(file) {
  if (isDocxFile(file)) {
    const buffer = await file.arrayBuffer();
    const result = await mammoth.extractRawText({ arrayBuffer: buffer });
    return result.value || "";
  }
  if (isPdfFile(file)) {
    return readPdfText(file);
  }
  if (isReadableTextFile(file)) {
    return file.text();
  }
  return "";
}

async function attachmentsToPrompt(attachments, lang) {
  if (!attachments.length) return "";
  validateAttachmentTotalSize(attachments, lang);
  const title = lang === "ja" ? "添付ファイル" : lang === "en" ? "Attached files" : "附件文件";
  const blocks = [];
  const failures = [];
  let remainingBudget = ATTACHMENT_TEXT_BUDGET_CHARS;
  for (const item of attachments) {
    const file = item.file;
    if (isImageFile(file)) continue;
    if (remainingBudget <= 0) {
      failures.push(`${file.name}: ${lang === "ja" ? "テキスト予算を超過しました。" : lang === "en" ? "Text budget exceeded." : "已超过附件文本预算。"}`);
      continue;
    }
    const meta = `${file.name} (${file.type || "unknown"}, ${formatBytes(file.size)})`;
    try {
      const text = await readAttachmentText(file);
      if (!text.trim()) {
        failures.push(`${file.name}: ${lang === "ja" ? "内容は空、または未対応形式です。" : lang === "en" ? "Content is empty or unsupported." : "内容为空或暂不支持读取。"}`);
        continue;
      }
      const fileBudget = Math.min(ATTACHMENT_TEXT_PER_FILE_CHARS, remainingBudget);
      const clipped = text.length > fileBudget ? `${text.slice(0, fileBudget)}\n...[truncated by attachment budget]` : text;
      remainingBudget -= clipped.length;
      blocks.push(`- ${meta}\n  ${lang === "ja" ? "本文読取済み" : lang === "en" ? "Extracted text" : "已读取正文"}: ${text.length} characters; sent about ${estimateTokensFromChars(Math.min(text.length, fileBudget))} tokens\n\n${clipped}`);
      await putKnowledgeDocument({ title:file.name, source:"attachment", text });
    } catch (error) {
      failures.push(`${file.name}: ${lang === "ja" ? "読取に失敗しました。" : lang === "en" ? "Failed to read content." : "内容读取失败。"} ${error.message || ""}`.trim());
    }
  }
  if (failures.length) {
    throw new Error(failures.join("\n"));
  }
  if (!blocks.length) {
    if (attachments.every(item => isImageFile(item.file))) return "";
    throw new Error(lang === "ja" ? "添付ファイルの本文を読み取れませんでした。" : lang === "en" ? "No attachment text could be extracted." : "未能读取附件正文。");
  }
  const instruction = lang === "ja"
    ? "以下はユーザーがアップロードした添付ファイルから抽出した本文です。この本文を未読とは扱わず、必ず分析対象にしてください。"
    : lang === "en"
      ? "The following text was extracted from the user's uploaded attachments. Treat it as read content and use it in your analysis."
      : "以下内容已从用户上传的附件中成功提取。请不要再声称无法读取附件，必须基于这些正文进行分析。";
  return `\n\n${title}:\n${instruction}\n\n${blocks.join("\n\n")}`;
}

function AttachmentPicker({ attachments, setAttachments, disabled, lang }) {
  const inputRef = useRef(null);
  const label = lang === "ja" ? "ファイル" : lang === "en" ? "File" : "文件";
  const riskTitle = lang === "ja"
    ? "添付本文・画像はローカル知識庫に保存され、送信時に選択中のモデル提供元へ送信されることがあります。"
    : lang === "en"
      ? "Attachment text/images may be saved to the local knowledge base and sent to the selected model provider when submitted."
      : "附件正文/图片可能保存到本地知识库，并在发送时传给当前模型提供商。";
  const remove = (id) => setAttachments(list => list.filter(item => item.id !== id));
  return (
    <>
      <input
        ref={inputRef}
        type="file"
        multiple
        style={{ display:"none" }}
        onChange={e => {
          const files = Array.from(e.target.files || []);
          setAttachments(list => [
            ...list,
            ...files.map(file => ({ id:`${file.name}-${file.size}-${file.lastModified}-${Math.random().toString(36).slice(2)}`, file })),
          ]);
          e.target.value = "";
        }}
      />
      <button type="button" className="nb-attach-button" disabled={disabled} onClick={()=>inputRef.current?.click()} title={`${label} · ${riskTitle}`}>＋</button>
      {attachments.length > 0 && (
        <div className="nb-attachment-list">
          {attachments.map(item => (
            <button key={item.id} type="button" onClick={()=>remove(item.id)} title={item.file.name}>
              <span>{item.file.name}</span>
              <small>{formatBytes(item.file.size)}</small>
            </button>
          ))}
        </div>
      )}
    </>
  );
}

function VoiceInputButton({ disabled, lang, onText }) {
  const [listening, setListening] = useState(false);
  const start = () => {
    if (disabled || typeof window === "undefined") return;
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) return;
    const recognition = new SpeechRecognition();
    recognition.lang = lang === "ja" ? "ja-JP" : lang === "en" ? "en-US" : "zh-CN";
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognition.onstart = () => setListening(true);
    recognition.onend = () => setListening(false);
    recognition.onerror = () => setListening(false);
    recognition.onresult = (event) => {
      const text = event.results?.[0]?.[0]?.transcript || "";
      if (text) onText(text);
    };
    recognition.start();
  };
  const label = lang === "ja" ? "音声入力" : lang === "en" ? "Voice input" : "语音输入";
  return <button type="button" className={`nb-voice-button ${listening ? "listening" : ""}`} disabled={disabled} onClick={start} title={label}>⌕</button>;
}

function speakText(text, lang) {
  if (typeof window === "undefined" || !window.speechSynthesis || !text) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = lang === "ja" ? "ja-JP" : lang === "en" ? "en-US" : "zh-CN";
  window.speechSynthesis.speak(utterance);
}

function confirmOutboundContext({ lang, modelKey, apiKeys, hasAttachments, hasWeb, hasKnowledge }) {
  if (outboundBlockedByLocalOnly(modelKey, apiKeys)) return false;
  const provider = outboundProviderLabel(modelKey, apiKeys);
  if (!provider) return true;
  return true;
}

function WorkspaceChat({ member, apiKeys, onMenu, onWorkPanel, onSessionUpdate, activeSession, lang, allMembers = TEAM, onWorkflowState, draftPrompt }) {
  const [controls, setControls] = useState({ thinkingMode:"off", modelOverride:"", reasoningLevel:"medium" });
  const effectiveModel = controls.modelOverride || member.model;
  const model = MODELS[effectiveModel] || MODELS[member.model];
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState([]);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const bottomRef = useRef(null);
  const abortRef = useRef(null);
  const sessionRef = useRef(null);

  useEffect(() => {
    const intro = lang === "ja"
      ? `こんにちは、${member.name}です。${member.title}として対応します。ご用件を送ってください。`
      : lang === "en"
        ? `Hi, I am ${member.name}, ${member.title}. Send the task you want to handle.`
        : `你好，我是${member.name}，${member.title}。请直接发送任务。`;
    if (activeSession?.kind === "member" && activeSession.targetId === member.id && activeSession.messages?.length) {
      sessionRef.current = activeSession;
      setMessages(activeSession.messages);
    } else {
      sessionRef.current = null;
      setMessages([{ role:"ai", text:intro }]);
    }
    setInput("");
    setError("");
    setNotice("");
  }, [member.id, lang, activeSession?.id]);

  useEffect(() => {
    if (!draftPrompt?.text || draftPrompt.targetId !== member.id) return;
    setInput(draftPrompt.text);
  }, [draftPrompt?.nonce, draftPrompt?.targetId, member.id]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior:"smooth" }); }, [messages, loading]);
  useEffect(() => {
    if (messages.length <= 1) return;
    if (!sessionRef.current) return;
    onSessionUpdate?.({
      ...sessionRef.current,
      kind:"member",
      targetId:member.id,
      title:firstUserTitle(messages, member.name),
      subtitle:member.title,
      preview:chatPreview(messages),
      messages,
      updatedAt:new Date().toISOString(),
    });
  }, [messages, member.id]);

  const send = async (txt) => {
    const text = (txt || input).trim();
    if ((!text && attachments.length === 0) || loading) return;
    setInput("");
    setError("");
    setNotice("");
    setAttachments([]);
    setLoading(true);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const attachmentPrompt = await attachmentsToPrompt(attachments, lang);
      const brainPrompt = apiKeys.autoInjectKnowledge ? await brainContextPrompt(text, lang) : "";
      const urlPrompt = await urlsToPrompt(text, lang);
      if (!confirmOutboundContext({
        lang,
        modelKey:effectiveModel,
        apiKeys,
        hasAttachments:!!attachmentPrompt || attachments.some(item => isImageFile(item.file)),
        hasWeb:!!urlPrompt,
        hasKnowledge:!!brainPrompt,
      })) {
        setNotice(localOnlyBlockMessage(effectiveModel, apiKeys, lang) || (lang === "ja" ? "送信をキャンセルしました。" : lang === "en" ? "Send canceled." : "已取消发送。"));
        return;
      }
      const displayText = attachments.length
        ? `${text || ""}\n\n${attachments.map(item => `📎 ${item.file.name} (${formatBytes(item.file.size)})`).join("\n")}`.trim()
        : text;
      const displayNext = [...messages, { role:"user", text:displayText }];
      if (!sessionRef.current) {
        sessionRef.current = {
          id:`member-${member.id}-${Date.now().toString(36)}`,
          kind:"member",
          targetId:member.id,
          title:firstUserTitle(displayNext, member.name),
          subtitle:member.title,
        };
      }
      const images = await attachmentsToImages(attachments, lang);
      const modelNext = [...messages, { role:"user", text:`${text || ""}${urlPrompt}${attachmentPrompt}${brainPrompt}`, images }];
      const requestLanguage = detectInputLanguage(text, lang);
      setMessages(displayNext);
      if (member.id === "aria") {
        const conversationContext = recentConversationContext(messages);
        const priorResults = extractPriorWorkflowResults(messages);
        const integrateExisting = priorResults.length > 0 && wantsPriorIntegration(text);
        const modelText = `${text || ""}${urlPrompt}${attachmentPrompt}${brainPrompt}${conversationContext}`;
        const dispatch = integrateExisting ? { workers:[], protocol:null } : await planWorkflowDispatchWithModel({
          router:{ ...member, model:effectiveModel },
          taskText:`${text}${conversationContext}`,
          members:allMembers,
          apiKeys,
          controls,
          language:requestLanguage,
          signal:controller.signal,
          callModel,
        });
        const workers = dispatch.workers;
        const workflowId = `wf-${Date.now().toString(36)}`;
        const results = integrateExisting ? [...priorResults] : [];
        const workflowPlan = buildWorkflowPlan({
          taskText:text,
          workers:integrateExisting ? priorResults.map((item, index) => ({ id:`prior-${index}`, name:item.member, title:item.title, model:item.model, layer:1 })) : workers,
          mode:integrateExisting ? "integrate" : "auto",
          lang:requestLanguage,
          protocol:dispatch.protocol,
        });
        const workflowModelUsage = modelUsageSummary([
          ...workers.map(worker => controls.modelOverride || worker.model),
          effectiveModel,
        ], apiKeys);
        workflowModelUsage.localOnlyMode = !!apiKeys.localOnlyMode;
        const needsConfirmation = !integrateExisting && workflowPlan.protocol?.needs_user_confirmation;
        onWorkflowState?.({
          id:workflowId,
          title:firstUserTitle([{ role:"user", text:displayText }], member.name),
          task:text,
          mode:needsConfirmation ? "waiting_confirmation" : integrateExisting ? "summarizing" : "planning",
          phase:needsConfirmation
            ? (lang === "ja" ? "高リスク操作の確認待ち" : lang === "en" ? "Waiting for high-risk action confirmation" : "等待确认高风险操作")
            : integrateExisting
            ? (lang === "ja" ? "ARIA が既存メンバー成果を統合中" : lang === "en" ? "ARIA is integrating existing member outputs" : "ARIA 正在整合已有成员成果")
            : (lang === "ja" ? "ARIA が担当メンバーを選定中" : lang === "en" ? "ARIA is selecting members" : "ARIA 正在选择执行成员"),
          startedAt:new Date().toISOString(),
          updatedAt:new Date().toISOString(),
          members:integrateExisting
            ? priorResults.map((item, index) => ({ id:`prior-${index}`, name:item.member, title:item.title, model:item.model, status:"complete", task:"", summary:item.summary, error:"" }))
            : workers.map(worker => ({ id:worker.id, name:worker.name, title:worker.title, model:worker.model, status:"queued", task:"", summary:"", error:"" })),
          plan:workflowPlan,
          modelUsage:workflowModelUsage,
          artifacts:[],
          error:"",
          progress:integrateExisting ? { done:priorResults.length, total:priorResults.length } : { done:0, total:workers.length },
        });
        setMessages(m => [...m, {
          role:"ai",
          text:integrateExisting
            ? (lang==="ja" ? `ARIA は既存のメンバー成果 ${priorResults.length} 件を統合します。` : lang==="en" ? `ARIA will integrate ${priorResults.length} existing member outputs.` : `ARIA 将整合当前对话中的 ${priorResults.length} 条已有成员成果。`)
            : (lang==="ja"
                ? `ARIA 自動調度を開始しました。担当：${workers.map(item => item.name).join("、")}`
                : lang==="en"
                  ? `ARIA automatic dispatch started. Assigned members: ${workers.map(item => item.name).join(", ")}`
            : `ARIA 已启动自动调度。执行成员：${workers.map(item => item.name).join("、")}`),
        }]);
        if (needsConfirmation) {
          await saveWorkflowRecord({
            id:workflowId,
            title:firstUserTitle([{ role:"user", text:displayText }], member.name),
            task:text,
            source:"aria-workflow",
            status:"waiting_confirmation",
            language:requestLanguage,
            members:workers.map(worker => ({ id:worker.id, name:worker.name, title:worker.title, model:worker.model, status:"queued" })),
            plan:workflowPlan,
            modelUsage:workflowModelUsage,
            results:[],
            artifacts:[],
          }).catch(() => {});
          setMessages(m => [...m, {
            role:"ai",
            text:lang==="ja"
              ? "このタスクにはデプロイ、外部送信、削除、または投递操作が含まれる可能性があります。確認してから「确认继续」と送信してください。"
              : lang==="en"
                ? "This task may include deployment, external transfer, deletion, or task handoff. Review the plan, then send \"确认继续\" to proceed."
                : "该任务可能包含部署、外发、删除或任务投递操作。请先检查计划，确认后发送“确认继续”。",
          }]);
          setLoading(false);
          return;
        }
        for (const worker of workers) {
          if (controller.signal.aborted) break;
          const memberTask = memberWorkflowTask(worker, modelText, results, requestLanguage);
          onWorkflowState?.(state => ({
            ...state,
            mode:"running",
            phase:`${worker.name} · ${worker.title}`,
            updatedAt:new Date().toISOString(),
            members:state.members.map(item => item.id === worker.id ? { ...item, status:"working", task:memberTask.slice(0, 180) } : item),
          }));
          const workerModel = controls.modelOverride || worker.model;
          const reply = await callModel(workerModel, worker.systemPrompt, [{ role:"user", text:memberTask, images }], apiKeys, { ...controls, language:requestLanguage }, controller.signal);
          const safeReply = reply || (lang === "en" ? "No response." : lang === "ja" ? "応答がありません。" : "无响应");
          results.push({ member:worker.name, title:worker.title, model:workerModel, text:safeReply, summary:summarizeForWorkflow(safeReply) });
          setMessages(m => [...m, { role:"ai", text:`【${worker.name} · ${worker.title}】\n${safeReply}` }]);
          onWorkflowState?.(state => ({
            ...state,
            mode:"running",
            phase:lang === "ja" ? "次の担当へ引き継ぎ中" : lang === "en" ? "Handing off to next member" : "正在移交下一位成员",
            updatedAt:new Date().toISOString(),
            members:state.members.map(item => item.id === worker.id ? { ...item, status:"complete", summary:summarizeForWorkflow(safeReply) } : item),
            progress:{ done:state.members.filter(item => item.status === "complete").length + 1, total:state.members.length },
          }));
          await learnFromExchange({ member:worker, userText:text, reply:safeReply, lang:requestLanguage });
        }
        if (!controller.signal.aborted && results.length) {
          const quality = workflowQualityCheck(workers, results);
          onWorkflowState?.(state => ({
            ...state,
            mode:"summarizing",
            phase:quality.complete
              ? (lang === "ja" ? "ARIA が成果を統合中" : lang === "en" ? "ARIA is integrating results" : "ARIA 正在整合产物")
              : (lang === "ja" ? "一部メンバー成果が不足、ARIA が補完統合中" : lang === "en" ? "Some member outputs are missing; ARIA is integrating with gaps noted" : "部分成员成果缺失，ARIA 正在带缺口整合"),
            updatedAt:new Date().toISOString(),
            quality,
          }));
          const integrationPrompt = `${requestLanguage === "en" ? "Reply only in English." : requestLanguage === "ja" ? "日本語だけで回答してください。" : "只用中文回复。"}
你是自动生产工作流的总调度。请把以下成员成果整合成最终产物。
总任务：
${text}
${conversationContext}

成员成果：
${results.map(item => `【${item.member}｜${item.title}】\n${item.text}`).join("\n\n")}

输出要求：
1. 直接给最终结论和可执行下一步。
2. 合并重复内容，保留冲突和风险。
3. 如果用户在追问“是否完整/不对/继续”，必须基于上方已有成员成果重新给出完整整合版。
4. 不要自我介绍，不要展示内部推理。`;
          let finalText = "";
          try {
            finalText = await callModel(effectiveModel, member.systemPrompt, [{ role:"user", text:integrationPrompt }], apiKeys, { ...controls, language:requestLanguage }, controller.signal);
          } catch {
            finalText = `${lang === "ja" ? "統合モデルの呼び出しに失敗したため、メンバー成果をローカルで整理しました。" : lang === "en" ? "The integration model failed, so member results were organized locally." : "整合模型调用失败，已在本地整理成员成果。"}\n\n${results.map(item => `## ${item.member} · ${item.title}\n${item.text}`).join("\n\n")}`;
          }
          const artifactTitle = firstUserTitle([{ role:"user", text }], lang === "en" ? "Workflow output" : lang === "ja" ? "ワークフロー成果" : "工作流产物");
          const artifact = { title:artifactTitle, kind:lang === "en" ? "Integrated report" : lang === "ja" ? "統合レポート" : "整合报告", version:1, hash:artifactContentHash(finalText), content:finalText, createdAt:new Date().toISOString() };
          await rememberWorkflowArtifact({ task:text, results, finalText, lang:requestLanguage, source:"aria-workflow" });
          await saveWorkflowRecord({
            id:workflowId,
            title:artifactTitle,
            task:text,
            source:"aria-workflow",
            status:"done",
            language:requestLanguage,
            members:workers.map(worker => ({ id:worker.id, name:worker.name, title:worker.title, model:worker.model, status:"complete" })),
            plan:workflowPlan,
            modelUsage:workflowModelUsage,
            quality,
            results,
            artifacts:[artifact],
          }).catch(() => {});
          setMessages(m => [...m, { role:"ai", text:`【ARIA · ${lang === "ja" ? "統合成果" : lang === "en" ? "Integrated output" : "整合产物"}】\n${finalText}` }]);
          onWorkflowState?.(state => ({
            ...state,
            mode:"done",
            phase:lang === "ja" ? "成果物生成完了" : lang === "en" ? "Output generated" : "产物已生成",
            updatedAt:new Date().toISOString(),
            artifacts:[artifact],
            quality,
            progress:{ done:state.members.length, total:state.members.length },
          }));
        }
        return;
      }
      const reply = await callModel(effectiveModel, member.systemPrompt, modelNext, apiKeys, { ...controls, language:requestLanguage }, controller.signal);
      setMessages(m => [...m, { role:"ai", text:reply || "无响应" }]);
      await learnFromExchange({ member, userText:text, reply, lang:requestLanguage });
    } catch (e) {
      if (e.name === "AbortError") {
        if (member.id === "aria") {
          onWorkflowState?.(state => ({
            ...state,
            mode:"stopped",
            phase:lang==="ja" ? "ユーザーが停止しました" : lang==="en" ? "Stopped by user" : "用户已停止",
            updatedAt:new Date().toISOString(),
          }));
        }
        setNotice(lang === "ja" ? "生成を停止しました。" : lang === "en" ? "Generation stopped." : "已停止生成。");
        setLoading(false);
        abortRef.current = null;
        return;
      }
      if (member.id === "aria") {
        onWorkflowState?.(state => ({
          ...state,
          mode:"failed",
          phase:t(lang, "requestFailed"),
          error:e.message || t(lang, "unknownError"),
          updatedAt:new Date().toISOString(),
        }));
      }
      setError(e.message || t(lang, "requestFailed"));
    } finally {
      setLoading(false);
      abortRef.current = null;
    }
  };

  const stop = () => {
    abortRef.current?.abort();
  };

  const saveMessage = async (text) => {
    setError("");
    setNotice("");
    try {
      const fileName = await saveToLocalOutputs(member, text);
      setNotice(lang === "ja" ? `ブラウザ経由でローカルに保存しました：${fileName}` : lang === "en" ? `Saved locally through the browser download channel: ${fileName}` : `已通过浏览器下载保存到本机：${fileName}`);
    } catch (e) {
      setError(e.message || t(lang, "requestFailed"));
    }
  };

  const quickPrompts = member.id==="aria"
    ? (lang==="ja" ? ["今週の作業計画を作成","価格案を分析して関係メンバーを調整","現在の最優先タスクを列挙"] : lang==="en" ? ["Create this week's work plan","Analyze pricing and coordinate members","List current top-priority tasks"] : ["帮我制定本周工作计划","分析定价方案，调度相关成员","列出当前最高优先级任务"])
    : (lang==="ja" ? [`${member.title}として今日進めるべきことは？`,"現段階のリスクは？","実行可能な提案を1つ"] : lang==="en" ? [`What should ${member.title} move forward today?`,"What are the current risks?","Give me one actionable suggestion"] : [`${member.title}今天应该推进什么？`,"当前阶段有哪些风险？","给我一个可执行建议"]);

  return (
    <main className="nb-chat">
      <header className="nb-chat-header">
        <div style={{ display:"flex", alignItems:"center", gap:"12px", minWidth:0 }}>
          <button className="nb-menu-button" onClick={onMenu}>☰</button>
          <div style={{ width:42, height:42, borderRadius:"11px", background:`${model.color}18`, color:model.color, border:`1px solid ${model.color}35`, display:"flex", alignItems:"center", justifyContent:"center", fontWeight:900, fontSize:"18px", flexShrink:0 }}>{member.emoji}</div>
          <div style={{ minWidth:0 }}>
            <div style={{ color:T.text, fontSize:"15px", fontWeight:900 }}>{member.name}</div>
            <div style={{ color:T.muted, fontSize:"11px", marginTop:"2px" }}>{member.title}</div>
          </div>
        </div>
        <div style={{ display:"flex", alignItems:"center", gap:"8px" }}>
          <button className="nb-mobile-work-button" onClick={onWorkPanel}>{lang==="ja" ? "状態" : lang==="en" ? "Status" : "状态"}</button>
          <span style={{ background:`${model.color}14`, color:model.color, borderRadius:"8px", padding:"5px 9px", fontSize:"10px", fontWeight:900 }}>{model.tag}</span>
          <span style={{ color:T.green, fontSize:"10.5px", fontWeight:800, border:`1px solid ${T.border}`, borderRadius:"8px", padding:"5px 9px", background:T.card }}>{t(lang, "loggedIn")}</span>
        </div>
      </header>

      <section className="nb-message-list">
        {messages.map((msg, i) => (
          <div key={i} style={{ display:"flex", justifyContent:msg.role==="user"?"flex-end":"flex-start", gap:"10px" }}>
            {msg.role==="ai" && <div style={{ width:28, height:28, borderRadius:"8px", background:`${model.color}18`, color:model.color, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>{member.emoji}</div>}
            <div style={{ maxWidth:"min(760px, 82%)", background:msg.role==="user"?T.blue:T.surface, color:msg.role==="user"?"#fff":T.text, border:`1px solid ${msg.role==="user"?T.blue:T.border}`, borderRadius:msg.role==="user"?"14px 14px 4px 14px":"14px 14px 14px 4px", padding:"12px 15px", fontSize:"13.5px", lineHeight:1.75, whiteSpace:"pre-wrap" }}>
              {msg.text}
              {msg.role==="ai" && i>0 && msg.text && (
                <div style={{ marginTop:"10px", display:"flex", justifyContent:"flex-end", gap:"7px" }}>
                  <button onClick={()=>speakText(msg.text, lang)} style={{ border:`1px solid ${T.border}`, background:T.card, color:T.muted, borderRadius:"7px", padding:"5px 9px", fontSize:"10.5px", cursor:"pointer" }}>{lang==="ja" ? "読み上げ" : lang==="en" ? "Speak" : "朗读"}</button>
                  <button title={lang==="ja" ? "ブラウザのダウンロード機能でローカル保存します。GitHub キューは使用しません。" : lang==="en" ? "Saved through the browser download channel. The GitHub queue is not used." : "通过浏览器下载保存到本机，不经过 GitHub 队列。"} onClick={()=>saveMessage(msg.text)} style={{ border:`1px solid ${T.border}`, background:T.card, color:T.muted, borderRadius:"7px", padding:"5px 9px", fontSize:"10.5px", cursor:"pointer" }}>{t(lang, "saveLocal")}</button>
                </div>
              )}
            </div>
          </div>
        ))}
        {loading && <div style={{ color:T.muted, fontSize:"12px", padding:"4px 38px" }}>{t(lang, "generating")}</div>}
        {error && <div style={{ color:T.red, background:"#ef444415", border:"1px solid #ef444430", borderRadius:"10px", padding:"10px 12px", fontSize:"12px" }}>⚠ {error}</div>}
        {notice && <div style={{ color:T.codex, background:"#10b98115", border:"1px solid #10b98130", borderRadius:"10px", padding:"10px 12px", fontSize:"12px" }}>{notice}</div>}
        <div ref={bottomRef} />
      </section>

      {messages.length <= 1 && (
        <div className="nb-quick">
          {quickPrompts.map(p => <button key={p} onClick={()=>send(p)}>{p}</button>)}
        </div>
      )}

      <footer className="nb-composer">
        <AttachmentPicker attachments={attachments} setAttachments={setAttachments} disabled={loading} lang={lang} />
        <VoiceInputButton disabled={loading} lang={lang} onText={(text)=>setInput(value => `${value}${value ? " " : ""}${text}`)} />
        <input value={input} onChange={e=>setInput(e.target.value)} onKeyDown={e=>e.key==="Enter"&&!e.shiftKey&&send()} disabled={loading} placeholder={lang==="ja" ? `${member.name}${t(lang, "sendCommand")}` : `${t(lang, "commandTo")}${member.name}${t(lang, "sendCommand")}`} />
        {loading
          ? <button onClick={stop} className="nb-stop-button">■</button>
          : <button onClick={()=>send()} disabled={!input.trim() && attachments.length===0}>↑</button>}
      </footer>
      <ChatControls controls={controls} setControls={setControls} defaultModel={member.model} lang={lang} />
    </main>
  );
}

function GroupChat({ group, apiKeys, onMenu, onWorkPanel, onSessionUpdate, activeSession, lang, onWorkflowState }) {
  const [controls, setControls] = useState({ thinkingMode:"off", modelOverride:"", reasoningLevel:"medium" });
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const bottomRef = useRef(null);
  const abortRef = useRef(null);
  const sessionRef = useRef(null);

  useEffect(() => {
    if (activeSession?.kind === "group" && activeSession.group?.id === group.id && activeSession.messages?.length) {
      sessionRef.current = activeSession;
      setMessages(activeSession.messages);
    } else {
      sessionRef.current = null;
      setMessages([{ role:"ai", member:lang==="en" ? "System" : lang==="ja" ? "システム" : "系统", text:lang==="en" ? `${group.name} ${t(lang, "ready")}` : `${group.name} ${t(lang, "ready")}` }]);
    }
    setInput("");
    setError("");
  }, [group.id, lang, activeSession?.id]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior:"smooth" }); }, [messages, loading]);
  useEffect(() => {
    if (messages.length <= 1) return;
    if (!sessionRef.current) return;
    onSessionUpdate?.({
      ...sessionRef.current,
      kind:"group",
      group,
      title:firstUserTitle(messages, group.name),
      subtitle:`${group.members.length} ${t(lang, "members")}`,
      preview:chatPreview(messages),
      messages,
      updatedAt:new Date().toISOString(),
    });
  }, [messages, group.id]);

  const send = async () => {
    const text = input.trim();
    if ((!text && attachments.length === 0) || loading) return;
    setInput("");
    setError("");
    const currentAttachments = attachments;
    setAttachments([]);
    const attachmentPrompt = await attachmentsToPrompt(currentAttachments, lang);
    const brainPrompt = apiKeys.autoInjectKnowledge ? await brainContextPrompt(text, lang) : "";
    const urlPrompt = await urlsToPrompt(text, lang);
    const firstModel = controls.modelOverride || group.members[0]?.model || "";
    if (!confirmOutboundContext({
      lang,
      modelKey:firstModel,
      apiKeys,
      hasAttachments:!!attachmentPrompt || currentAttachments.some(item => isImageFile(item.file)),
      hasWeb:!!urlPrompt,
      hasKnowledge:!!brainPrompt,
    })) {
      setError("");
      setMessages(m => [...m, { role:"ai", member:lang==="en" ? "System" : lang==="ja" ? "システム" : "系统", text:localOnlyBlockMessage(firstModel, apiKeys, lang) || (lang==="ja" ? "送信をキャンセルしました。" : lang==="en" ? "Send canceled." : "已取消发送。") }]);
      return;
    }
    const displayText = currentAttachments.length
      ? `${text || ""}\n\n${currentAttachments.map(item => `📎 ${item.file.name} (${formatBytes(item.file.size)})`).join("\n")}`.trim()
      : text;
    const images = await attachmentsToImages(currentAttachments, lang);
    const modelText = `${text || ""}${urlPrompt}${attachmentPrompt}${brainPrompt}`;
    const requestLanguage = detectInputLanguage(text, lang);
    const base = [...messages, { role:"user", member:lang==="en" ? "You" : lang==="ja" ? "あなた" : "你", text:displayText }];
    if (!sessionRef.current) {
      sessionRef.current = {
        id:`group-${group.id}-${Date.now().toString(36)}`,
        kind:"group",
        group,
        title:firstUserTitle(base, group.name),
        subtitle:`${group.members.length} ${t(lang, "members")}`,
      };
    }
    setMessages(base);
    setLoading(true);
    const controller = new AbortController();
    abortRef.current = controller;
    let currentMember = null;
    const results = [];
    try {
      const router = group.members.find(item => item.id === "aria") || group.members[0];
      const dispatch = await planWorkflowDispatchWithModel({
        router:{ ...router, model:controls.modelOverride || router.model },
        taskText:text,
        members:group.members,
        apiKeys,
        controls,
        language:requestLanguage,
        signal:controller.signal,
        callModel,
      });
      const workers = dispatch.workers;
      const workflowId = `wf-${Date.now().toString(36)}`;
      const workflowPlan = buildWorkflowPlan({ taskText:text, workers, mode:"auto", lang:requestLanguage, protocol:dispatch.protocol });
      const workflowModelUsage = modelUsageSummary([
        ...workers.map(member => controls.modelOverride || member.model),
        controls.modelOverride || router.model,
      ], apiKeys);
      workflowModelUsage.localOnlyMode = !!apiKeys.localOnlyMode;
      const needsConfirmation = workflowPlan.protocol?.needs_user_confirmation;
      onWorkflowState?.({
        id:workflowId,
        title:firstUserTitle([{ role:"user", text:displayText }], group.name),
        task:text,
        mode:needsConfirmation ? "waiting_confirmation" : "planning",
        phase:needsConfirmation
          ? (lang === "ja" ? "高リスク操作の確認待ち" : lang === "en" ? "Waiting for high-risk action confirmation" : "等待确认高风险操作")
          : lang === "ja" ? "担当メンバーを選定中" : lang === "en" ? "Selecting members" : "正在选择执行成员",
        startedAt:new Date().toISOString(),
        updatedAt:new Date().toISOString(),
        members:workers.map(member => ({ id:member.id, name:member.name, title:member.title, model:member.model, status:"queued", task:"", summary:"", error:"" })),
        plan:workflowPlan,
        modelUsage:workflowModelUsage,
        artifacts:[],
        error:"",
        progress:{ done:0, total:workers.length },
      });
      setMessages(m => [...m, {
        role:"ai",
        member:lang==="en" ? "System" : lang==="ja" ? "システム" : "系统",
        text:lang==="ja"
          ? `自動ワークフローを開始しました。担当：${workers.map(item => item.name).join("、")}`
          : lang==="en"
            ? `Automatic workflow started. Assigned members: ${workers.map(item => item.name).join(", ")}`
            : `已启动自动工作流。执行成员：${workers.map(item => item.name).join("、")}`,
      }]);
      if (needsConfirmation) {
        await saveWorkflowRecord({
          id:workflowId,
          title:firstUserTitle([{ role:"user", text:displayText }], group.name),
          task:text,
          source:"group-workflow",
          status:"waiting_confirmation",
          language:requestLanguage,
          members:workers.map(member => ({ id:member.id, name:member.name, title:member.title, model:member.model, status:"queued" })),
          plan:workflowPlan,
          modelUsage:workflowModelUsage,
          results:[],
          artifacts:[],
        }).catch(() => {});
        setMessages(m => [...m, {
          role:"ai",
          member:lang==="en" ? "System" : lang==="ja" ? "システム" : "系统",
          text:lang==="ja"
            ? "このワークフローには高リスク操作が含まれる可能性があります。確認してから「确认继续」と送信してください。"
            : lang==="en"
              ? "This workflow may include high-risk actions. Review the plan, then send \"确认继续\" to proceed."
              : "该工作流可能包含高风险操作。请先检查计划，确认后发送“确认继续”。",
        }]);
        setLoading(false);
        return;
      }
      for (const member of workers) {
        currentMember = member;
        if (controller.signal.aborted) break;
        const memberTask = memberWorkflowTask(member, modelText, results, requestLanguage);
        onWorkflowState?.(state => ({
          ...state,
          mode:"running",
          phase:`${member.name} · ${member.title}`,
          updatedAt:new Date().toISOString(),
          members:state.members.map(item => item.id === member.id ? { ...item, status:"working", task:memberTask.slice(0, 180) } : item),
        }));
        const effectiveModel = controls.modelOverride || member.model;
        const reply = await callModel(effectiveModel, member.systemPrompt, [{ role:"user", text:memberTask, images }], apiKeys, { ...controls, language:requestLanguage }, controller.signal);
        const safeReply = reply || (lang === "en" ? "No response." : lang === "ja" ? "応答がありません。" : "无响应");
        results.push({ member:member.name, title:member.title, model:effectiveModel, text:safeReply, summary:summarizeForWorkflow(safeReply) });
        setMessages(m => [...m, { role:"ai", member:member.name, title:member.title, model:effectiveModel, emoji:member.emoji, text:safeReply }]);
        onWorkflowState?.(state => ({
          ...state,
          mode:"running",
          phase:lang === "ja" ? "次の担当へ引き継ぎ中" : lang === "en" ? "Handing off to next member" : "正在移交下一位成员",
          updatedAt:new Date().toISOString(),
          members:state.members.map(item => item.id === member.id ? { ...item, status:"complete", summary:summarizeForWorkflow(safeReply) } : item),
          progress:{ done:state.members.filter(item => item.status === "complete").length + 1, total:state.members.length },
        }));
        await learnFromExchange({ member, userText:text, reply, lang:requestLanguage });
      }
      if (!controller.signal.aborted && results.length) {
        const quality = workflowQualityCheck(workers, results);
        onWorkflowState?.(state => ({
          ...state,
          mode:"summarizing",
          phase:quality.complete
            ? (lang === "ja" ? "ARIA が成果を統合中" : lang === "en" ? "ARIA is integrating results" : "ARIA 正在整合产物")
            : (lang === "ja" ? "一部メンバー成果が不足、ARIA が補完統合中" : lang === "en" ? "Some member outputs are missing; ARIA is integrating with gaps noted" : "部分成员成果缺失，ARIA 正在带缺口整合"),
          updatedAt:new Date().toISOString(),
          quality,
        }));
        const aria = group.members.find(member => member.id === "aria") || workers[0];
        const integrationPrompt = `${requestLanguage === "en" ? "Reply only in English." : requestLanguage === "ja" ? "日本語だけで回答してください。" : "只用中文回复。"}
你是自动生产工作流的总调度。请把以下成员成果整合成最终产物。
总任务：
${text}

成员成果：
${results.map(item => `【${item.member}｜${item.title}】\n${item.text}`).join("\n\n")}

输出要求：
1. 直接给最终结论和可执行下一步。
2. 合并重复内容，保留冲突和风险。
3. 不要自我介绍，不要展示内部推理。`;
        let finalText = "";
        try {
          finalText = await callModel(controls.modelOverride || aria.model, aria.systemPrompt, [{ role:"user", text:integrationPrompt }], apiKeys, { ...controls, language:requestLanguage }, controller.signal);
        } catch (summaryError) {
          finalText = `${lang === "ja" ? "統合モデルの呼び出しに失敗したため、メンバー成果をローカルで整理しました。" : lang === "en" ? "The integration model failed, so member results were organized locally." : "整合模型调用失败，已在本地整理成员成果。"}\n\n${results.map(item => `## ${item.member} · ${item.title}\n${item.text}`).join("\n\n")}`;
        }
        const artifactTitle = firstUserTitle([{ role:"user", text }], lang === "en" ? "Workflow output" : lang === "ja" ? "ワークフロー成果" : "工作流产物");
        const artifact = { title:artifactTitle, kind:lang === "en" ? "Integrated report" : lang === "ja" ? "統合レポート" : "整合报告", version:1, hash:artifactContentHash(finalText), content:finalText, createdAt:new Date().toISOString() };
        await rememberWorkflowArtifact({ task:text, results, finalText, lang:requestLanguage, source:"group-workflow" });
        await saveWorkflowRecord({
          id:workflowId,
          title:artifactTitle,
          task:text,
          source:"group-workflow",
          status:"done",
          language:requestLanguage,
          members:workers.map(member => ({ id:member.id, name:member.name, title:member.title, model:member.model, status:"complete" })),
          plan:workflowPlan,
          modelUsage:workflowModelUsage,
          quality,
          results,
          artifacts:[artifact],
        }).catch(() => {});
        setMessages(m => [...m, { role:"ai", member:"ARIA", title:lang === "ja" ? "統合成果" : lang === "en" ? "Integrated output" : "整合产物", model:aria.model, emoji:aria.emoji || "◎", text:finalText }]);
        onWorkflowState?.(state => ({
          ...state,
          mode:"done",
          phase:lang === "ja" ? "成果物生成完了" : lang === "en" ? "Output generated" : "产物已生成",
          updatedAt:new Date().toISOString(),
          artifacts:[artifact],
          quality,
          progress:{ done:state.members.length, total:state.members.length },
        }));
      }
    } catch (e) {
        if (e.name === "AbortError") {
          onWorkflowState?.(state => ({
            ...state,
            mode:"stopped",
            phase:lang==="ja" ? "ユーザーが停止しました" : lang==="en" ? "Stopped by user" : "用户已停止",
            updatedAt:new Date().toISOString(),
          }));
          setMessages(m => {
            const copy = [...m];
            const last = copy[copy.length - 1];
            if (last?.role === "ai" && !last.text) copy.pop();
            copy.push({ role:"ai", member:lang==="en" ? "System" : lang==="ja" ? "システム" : "系统", text:lang==="ja" ? "生成を停止しました。" : lang==="en" ? "Generation stopped." : "已停止生成。" });
            return copy;
          });
          return;
        }
        setMessages(m => {
          const copy = [...m];
          const last = copy[copy.length - 1];
          if (last?.role === "ai" && last.member === currentMember?.name && !last.text) copy.pop();
          copy.push({ role:"ai", member:currentMember?.name || "系统", title:currentMember?.title, model:currentMember?.model, emoji:currentMember?.emoji, text:`${t(lang, "requestFailed")}：${e.message || t(lang, "unknownError")}` });
          return copy;
        });
        onWorkflowState?.(state => ({
          ...state,
          mode:"failed",
          phase:currentMember ? `${currentMember.name} · ${t(lang, "requestFailed")}` : t(lang, "requestFailed"),
          error:e.message || t(lang, "unknownError"),
          updatedAt:new Date().toISOString(),
          members:state.members.map(item => item.id === currentMember?.id ? { ...item, status:"failed", error:e.message || t(lang, "unknownError") } : item),
        }));
    } finally {
      setLoading(false);
      abortRef.current = null;
    }
  };

  const stop = () => {
    abortRef.current?.abort();
  };

  const saveGroupMessage = async (msg) => {
    try {
      const fileName = await saveToLocalOutputs({ name:msg.member, title:msg.title || group.name }, msg.text);
      setMessages(m => [...m, { role:"ai", member:lang==="en" ? "System" : lang==="ja" ? "システム" : "系统", text:lang==="ja" ? `ブラウザ経由でローカルに保存しました：${fileName}` : lang==="en" ? `Saved locally through the browser download channel: ${fileName}` : `已通过浏览器下载保存到本机：${fileName}` }]);
    } catch (e) {
      setError(e.message || t(lang, "requestFailed"));
    }
  };

  return (
    <main className="nb-chat">
      <header className="nb-chat-header">
        <div style={{ display:"flex", alignItems:"center", gap:"12px", minWidth:0 }}>
          <button className="nb-menu-button" onClick={onMenu}>☰</button>
          <div style={{ minWidth:0 }}>
            <div style={{ color:T.text, fontSize:"15px", fontWeight:900 }}>{group.name}</div>
            <div style={{ color:T.muted, fontSize:"11px", marginTop:"2px" }}>{lang==="zh" ? `${group.members.length} ${t(lang, "collaborating")}` : `${group.members.length} ${t(lang, "collaborating")}`}</div>
          </div>
        </div>
        <div style={{ display:"flex", alignItems:"center", gap:"8px" }}>
          <button className="nb-mobile-work-button" onClick={onWorkPanel}>{lang==="ja" ? "状態" : lang==="en" ? "Status" : "状态"}</button>
          <span style={{ color:T.green, fontSize:"10.5px", fontWeight:800, border:`1px solid ${T.border}`, borderRadius:"8px", padding:"5px 9px", background:T.card }}>{t(lang, "groupChat")}</span>
        </div>
      </header>
      <section className="nb-message-list">
        {messages.map((msg, i) => {
          const model = MODELS[msg.model] || { color:T.blue, tag:"" };
          return (
            <div key={i} style={{ display:"flex", justifyContent:msg.role==="user"?"flex-end":"flex-start", gap:"10px" }}>
              {msg.role==="ai" && <div style={{ width:28, height:28, borderRadius:"8px", background:`${model.color}18`, color:model.color, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>{msg.emoji || "◎"}</div>}
              <div style={{ maxWidth:"min(760px, 82%)", background:msg.role==="user"?T.blue:T.surface, color:msg.role==="user"?"#fff":T.text, border:`1px solid ${msg.role==="user"?T.blue:T.border}`, borderRadius:msg.role==="user"?"14px 14px 4px 14px":"14px 14px 14px 4px", padding:"12px 15px", fontSize:"13.5px", lineHeight:1.75, whiteSpace:"pre-wrap" }}>
                {msg.role==="ai" && <div style={{ color:model.color, fontSize:"11px", fontWeight:900, marginBottom:"5px" }}>{msg.member}{msg.title?` · ${msg.title}`:""}</div>}
                {msg.text}
                {msg.role==="ai" && i>0 && msg.text && <div style={{ marginTop:"10px", display:"flex", justifyContent:"flex-end", gap:"7px" }}><button onClick={()=>speakText(msg.text, lang)} style={{ border:`1px solid ${T.border}`, background:T.card, color:T.muted, borderRadius:"7px", padding:"5px 9px", fontSize:"10.5px", cursor:"pointer" }}>{lang==="ja" ? "読み上げ" : lang==="en" ? "Speak" : "朗读"}</button><button title={lang==="ja" ? "ブラウザのダウンロード機能でローカル保存します。GitHub キューは使用しません。" : lang==="en" ? "Saved through the browser download channel. The GitHub queue is not used." : "通过浏览器下载保存到本机，不经过 GitHub 队列。"} onClick={()=>saveGroupMessage(msg)} style={{ border:`1px solid ${T.border}`, background:T.card, color:T.muted, borderRadius:"7px", padding:"5px 9px", fontSize:"10.5px", cursor:"pointer" }}>{t(lang, "saveLocal")}</button></div>}
              </div>
            </div>
          );
        })}
        {loading && <div style={{ color:T.muted, fontSize:"12px", padding:"4px 38px" }}>{t(lang, "groupGenerating")}</div>}
        {error && <div style={{ color:T.red, background:"#ef444415", border:"1px solid #ef444430", borderRadius:"10px", padding:"10px 12px", fontSize:"12px" }}>⚠ {error}</div>}
        <div ref={bottomRef} />
      </section>
      <footer className="nb-composer">
        <AttachmentPicker attachments={attachments} setAttachments={setAttachments} disabled={loading} lang={lang} />
        <VoiceInputButton disabled={loading} lang={lang} onText={(text)=>setInput(value => `${value}${value ? " " : ""}${text}`)} />
        <input value={input} onChange={e=>setInput(e.target.value)} onKeyDown={e=>e.key==="Enter"&&!e.shiftKey&&send()} disabled={loading} placeholder={lang==="ja" ? `${group.name}${t(lang, "sendTask")}` : `${t(lang, "commandTo")}${group.name}${t(lang, "sendTask")}`} />
        {loading
          ? <button onClick={stop} className="nb-stop-button">■</button>
          : <button onClick={send} disabled={!input.trim() && attachments.length===0}>↑</button>}
      </footer>
      <ChatControls controls={controls} setControls={setControls} defaultModel="" lang={lang} />
    </main>
  );
}

function AppSettings({ open, settings, members, onSave, onMembersSave, onClearLocalData, onClose, lang }) {
  const [values, setValues] = useState(settings);
  const [draftMembers, setDraftMembers] = useState(members);
  useEffect(() => {
    setValues(settings);
    setDraftMembers(members);
  }, [settings, members, open]);
  if (!open) return null;
  const liveLang = effectiveLanguage(values.language || lang);
  const updateMember = (id, patch) => {
    setDraftMembers(list => list.map(m => m.id === id ? { ...m, ...patch } : m));
  };
  const removeMember = (id) => {
    setDraftMembers(list => list.filter(m => m.id !== id));
  };
  const addMember = () => {
    const id = `custom-${Date.now().toString(36)}`;
    setDraftMembers(list => [...list, {
      id, layer:2, name:t(liveLang, "newMember"), title:t(liveLang, "customMemberTitle"), emoji:"□", model:"gemma26",
      tags:[t(liveLang, "customMemberTitle")],
      systemPrompt:"你是Neural Bridge自定义成员。请根据用户任务给出清晰、可执行的建议。",
    }]);
  };
  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.45)", zIndex:600, display:"flex", alignItems:"center", justifyContent:"center", padding:"18px" }} onClick={onClose}>
      <div className="nb-settings-dialog" onClick={e=>e.stopPropagation()} style={{ width:"100%", maxWidth:"760px", maxHeight:"86vh", overflow:"hidden", display:"flex", flexDirection:"column", background:T.surface, border:`1px solid ${T.border}`, borderRadius:"16px" }}>
        <div style={{ padding:"18px 22px", borderBottom:`1px solid ${T.border}` }}>
        <div style={{ color:T.text, fontSize:"16px", fontWeight:900, marginBottom:"5px" }}>{t(liveLang, "settingsTitle")}</div>
          <div style={{ color:T.muted, fontSize:"12px" }}>{t(liveLang, "loginUser")}：{values.username || "Neural Bridge Owner"}</div>
        </div>
        <div style={{ overflowY:"auto", padding:"18px 22px" }}>
          <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(210px,1fr))", gap:"12px", marginBottom:"18px" }}>
            <label>
              <div style={{ color:T.muted, fontSize:"11px", fontWeight:800, marginBottom:"6px" }}>{t(liveLang, "username")}</div>
              <input value={values.username || ""} onChange={e=>setValues(v=>({...v, username:e.target.value}))} style={{ width:"100%", border:`1px solid ${T.border}`, background:T.card, color:T.text, borderRadius:"10px", padding:"11px 12px", outline:"none" }} />
            </label>
            <label>
              <div style={{ color:T.muted, fontSize:"11px", fontWeight:800, marginBottom:"6px" }}>{t(liveLang, "language")}</div>
              <select value={values.language || "auto"} onChange={e=>setValues(v=>({...v, language:e.target.value}))} style={{ width:"100%", border:`1px solid ${T.border}`, background:T.card, color:T.text, borderRadius:"10px", padding:"11px 12px", outline:"none" }}>
                <option value="auto">{t(liveLang, "autoLanguage")}</option>
                <option value="zh">{t(liveLang, "chinese")}</option>
                <option value="ja">{t(liveLang, "japanese")}</option>
                <option value="en">{t(liveLang, "english")}</option>
              </select>
            </label>
          </div>
          <div style={{ color:T.text, fontSize:"13px", fontWeight:900, marginBottom:"8px" }}>API Key</div>
          <div style={{ color:T.muted, fontSize:"12px", marginBottom:"12px" }}>{t(liveLang, "apiHelp")}</div>
          <div style={{ border:`1px solid ${T.orange}55`, background:T.surface, color:T.muted, borderRadius:"10px", padding:"10px 12px", fontSize:"11.5px", lineHeight:1.6, marginBottom:"12px" }}>
            {liveLang === "ja"
              ? "外部送信の主な経路: Vercel API、Anthropic/Google、Claude Bridge、Web読取、GitHub Issue キュー、Vercel デプロイ。送信前の確認を確認してください。"
              : liveLang === "en"
                ? "External paths include Vercel API, Anthropic/Google, Claude Bridge, web reading, GitHub Issue queues, and Vercel deployment. Review send confirmations before continuing."
                : "主要外发路径包括 Vercel API、Anthropic/Google、Claude Bridge、网页读取、GitHub Issue 队列和 Vercel 部署。发送前请确认弹窗中的数据路径。"}
          </div>
        {[
          ["anthropic", "Anthropic API Key", "sk-ant-..."],
          ["google", "Google AI Studio Key", "AIza..."],
        ].map(([key, label, placeholder]) => (
          <label key={key} style={{ display:"block", marginBottom:"12px" }}>
            <div style={{ color:T.muted, fontSize:"11px", fontWeight:800, marginBottom:"6px" }}>{label}</div>
            <input type="password" value={values.apiKeys?.[key] || ""} placeholder={placeholder} onChange={e=>setValues(v=>({...v, apiKeys:{...(v.apiKeys||{}), [key]:e.target.value}}))} style={{ width:"100%", border:`1px solid ${T.border}`, background:T.card, color:T.text, borderRadius:"10px", padding:"11px 12px", outline:"none" }} />
          </label>
        ))}
          <div style={{ color:T.text, fontSize:"13px", fontWeight:900, margin:"18px 0 8px" }}>
            {liveLang === "ja" ? "知識庫コンテキスト" : liveLang === "en" ? "Knowledge context" : "知识库上下文"}
          </div>
          <label style={{ display:"flex", alignItems:"flex-start", gap:"8px", marginBottom:"8px", color:T.text, fontSize:"12px", fontWeight:800 }}>
            <input type="checkbox" checked={!!values.autoInjectKnowledge} onChange={e=>setValues(v=>({...v, autoInjectKnowledge:e.target.checked}))} style={{ marginTop:"2px" }} />
            <span>{liveLang === "ja" ? "関連知識・長期記憶を自動注入する" : liveLang === "en" ? "Automatically inject related knowledge and long-term memory" : "自动注入相关知识和长期记忆"}</span>
          </label>
          <div style={{ color:values.autoInjectKnowledge ? T.red : T.muted, fontSize:"11.5px", lineHeight:1.6, marginBottom:"14px" }}>
            {liveLang === "ja"
              ? "有効にすると、IndexedDB 内の関連知識や記憶が現在のモデル提供元へ送信されます。デフォルトはオフです。"
              : liveLang === "en"
                ? "When enabled, related IndexedDB knowledge and memories are sent to the current model provider. This is off by default."
                : "开启后，IndexedDB 中检索到的相关知识和记忆会发送给当前模型提供商。默认关闭。"}
          </div>
          <label style={{ display:"flex", alignItems:"flex-start", gap:"8px", marginBottom:"8px", color:T.text, fontSize:"12px", fontWeight:800 }}>
            <input type="checkbox" checked={!!values.localOnlyMode} onChange={e=>setValues(v=>({...v, localOnlyMode:e.target.checked, autoInjectKnowledge:e.target.checked ? false : v.autoInjectKnowledge}))} style={{ marginTop:"2px" }} />
            <span>{liveLang === "ja" ? "Local-only モード（外部モデル送信をブロック）" : liveLang === "en" ? "Local-only mode (block external model sends)" : "Local-only 模式（阻止外部模型发送）"}</span>
          </label>
          <div style={{ color:values.localOnlyMode ? T.red : T.muted, fontSize:"11.5px", lineHeight:1.6, marginBottom:"14px" }}>
            {liveLang === "ja"
              ? "有効にすると、Claude/Gemini など外部モデルへの送信をキャンセルします。ローカル保存や Codex キュー以外の整理だけに使います。"
              : liveLang === "en"
                ? "When enabled, sends to external model providers such as Claude/Gemini are canceled. Use for local organization and local saves."
                : "开启后，发送到 Claude/Gemini 等外部模型提供商的请求会被取消。适合本地整理和本地保存。"}
          </div>
          <div style={{ color:T.text, fontSize:"13px", fontWeight:900, margin:"18px 0 8px" }}>Claude Code Bridge</div>
          <div style={{ color:T.muted, fontSize:"12px", marginBottom:"12px" }}>
            {liveLang === "ja" ? "ローカルの Claude Code を使う場合だけ有効にしてください。" : liveLang === "en" ? "Enable only when using a local Claude Code bridge." : "仅在使用本机 Claude Code 桥接服务时开启。"}
          </div>
          <label style={{ display:"flex", alignItems:"center", gap:"8px", marginBottom:"12px", color:T.text, fontSize:"12px", fontWeight:800 }}>
            <input type="checkbox" checked={!!values.claudeBridge?.enabled} onChange={e=>setValues(v=>({...v, claudeBridge:{ url:"http://127.0.0.1:8787", token:"", ...(v.claudeBridge||{}), enabled:e.target.checked }}))} />
            {liveLang === "ja" ? "Claude Code Bridge を有効化" : liveLang === "en" ? "Enable Claude Code Bridge" : "启用 Claude Code Bridge"}
          </label>
          <div style={{ display:"grid", gridTemplateColumns:"minmax(0,1.4fr) minmax(0,1fr)", gap:"12px", marginBottom:"16px" }}>
            <label>
              <div style={{ color:T.muted, fontSize:"11px", fontWeight:800, marginBottom:"6px" }}>Bridge URL</div>
              <input value={values.claudeBridge?.url || "http://127.0.0.1:8787"} onChange={e=>setValues(v=>({...v, claudeBridge:{ enabled:false, token:"", ...(v.claudeBridge||{}), url:e.target.value }}))} style={{ width:"100%", border:`1px solid ${T.border}`, background:T.card, color:T.text, borderRadius:"10px", padding:"11px 12px", outline:"none" }} />
            </label>
            <label>
              <div style={{ color:T.muted, fontSize:"11px", fontWeight:800, marginBottom:"6px" }}>Bridge Token</div>
              <input type="password" value={values.claudeBridge?.token || ""} onChange={e=>setValues(v=>({...v, claudeBridge:{ enabled:false, url:"http://127.0.0.1:8787", ...(v.claudeBridge||{}), token:e.target.value }}))} style={{ width:"100%", border:`1px solid ${T.border}`, background:T.card, color:T.text, borderRadius:"10px", padding:"11px 12px", outline:"none" }} />
            </label>
          </div>
          <div style={{ color:T.text, fontSize:"13px", fontWeight:900, margin:"18px 0 8px" }}>Codex Task Dispatch</div>
          <div style={{ color:T.muted, fontSize:"12px", marginBottom:"12px" }}>
            {liveLang === "ja" ? "本番環境では、開発タスクを GitHub Issue キューへ送信するには管理者トークンが必須です。タスク内容は GitHub と self-hosted runner に送信されます。" : liveLang === "en" ? "In production, dispatching development tasks to the GitHub Issue queue requires an administrator token. Task content is sent to GitHub and the self-hosted runner." : "生产环境向 GitHub Issue 队列投递开发任务必须提供管理员 token。任务内容会发送到 GitHub 和 self-hosted runner。"}
          </div>
          <label style={{ display:"block", marginBottom:"16px" }}>
            <div style={{ color:T.muted, fontSize:"11px", fontWeight:800, marginBottom:"6px" }}>Codex Admin Token</div>
            <input type="password" value={values.codexAdminToken || ""} onChange={e=>setValues(v=>({...v, codexAdminToken:e.target.value}))} style={{ width:"100%", border:`1px solid ${T.border}`, background:T.card, color:T.text, borderRadius:"10px", padding:"11px 12px", outline:"none" }} />
          </label>
          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", margin:"20px 0 10px" }}>
            <div style={{ color:T.text, fontSize:"13px", fontWeight:900 }}>{t(liveLang, "memberManagement")}</div>
            <button onClick={addMember} style={{ border:`1px solid ${T.border}`, background:T.card, color:T.blue, borderRadius:"8px", padding:"7px 10px", fontSize:"12px", fontWeight:800, cursor:"pointer" }}>{t(liveLang, "addMember")}</button>
          </div>
          <div style={{ display:"flex", flexDirection:"column", gap:"8px" }}>
            {draftMembers.map(member => (
              <div key={member.id} className="nb-member-edit-row" style={{ border:`1px solid ${T.border}`, background:T.card, borderRadius:"10px", padding:"10px", display:"grid", gridTemplateColumns:"72px 1fr 1fr 110px 36px", gap:"8px", alignItems:"center" }}>
                <input value={member.emoji} onChange={e=>updateMember(member.id,{emoji:e.target.value})} style={{ border:`1px solid ${T.border}`, borderRadius:"8px", padding:"8px", background:T.surface, color:T.text }} />
                <input value={member.name} onChange={e=>updateMember(member.id,{name:e.target.value})} style={{ border:`1px solid ${T.border}`, borderRadius:"8px", padding:"8px", background:T.surface, color:T.text }} />
                <input value={member.title} onChange={e=>updateMember(member.id,{title:e.target.value})} style={{ border:`1px solid ${T.border}`, borderRadius:"8px", padding:"8px", background:T.surface, color:T.text }} />
                <select value={member.model} onChange={e=>updateMember(member.id,{model:e.target.value})} style={{ border:`1px solid ${T.border}`, borderRadius:"8px", padding:"8px", background:T.surface, color:T.text }}>
                  {Object.keys(MODELS).map(k => <option key={k} value={k}>{MODELS[k].tag}</option>)}
                </select>
                <button onClick={()=>removeMember(member.id)} style={{ border:`1px solid ${T.border}`, background:T.surface, color:T.red, borderRadius:"8px", padding:"8px", cursor:"pointer" }}>×</button>
              </div>
            ))}
          </div>
        </div>
        <div style={{ display:"flex", gap:"10px", padding:"14px 22px", borderTop:`1px solid ${T.border}`, flexWrap:"wrap" }}>
          <button onClick={onClearLocalData} style={{ flex:"1 1 170px", border:`1px solid #ef444455`, background:"#ef444412", color:T.red, borderRadius:"10px", padding:"11px", cursor:"pointer", fontWeight:900 }}>
            {liveLang === "ja" ? "本機データを消去" : liveLang === "en" ? "Clear local data" : "清除本机数据"}
          </button>
          <button onClick={onClose} style={{ flex:"1 1 120px", border:`1px solid ${T.border}`, background:T.surface, color:T.muted, borderRadius:"10px", padding:"11px", cursor:"pointer" }}>{t(liveLang, "cancel")}</button>
          <button onClick={()=>{ onSave(values); onMembersSave(draftMembers); }} style={{ flex:"2 1 180px", border:"none", background:T.blue, color:"#fff", borderRadius:"10px", padding:"11px", fontWeight:900, cursor:"pointer" }}>{t(liveLang, "save")}</button>
        </div>
      </div>
    </div>
  );
}

function CustomGroupModal({ open, members, selectedIds, onChange, onStart, onClose, lang }) {
  if (!open) return null;
  const toggle = (id) => {
    onChange(selectedIds.includes(id) ? selectedIds.filter(x=>x!==id) : [...selectedIds, id]);
  };
  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.45)", zIndex:620, display:"flex", alignItems:"center", justifyContent:"center", padding:"18px" }} onClick={onClose}>
      <div onClick={e=>e.stopPropagation()} style={{ width:"100%", maxWidth:"560px", maxHeight:"82vh", overflow:"hidden", display:"flex", flexDirection:"column", background:T.surface, border:`1px solid ${T.border}`, borderRadius:"16px" }}>
        <div style={{ padding:"18px 20px", borderBottom:`1px solid ${T.border}` }}>
          <div style={{ color:T.text, fontSize:"16px", fontWeight:900 }}>{t(lang, "customGroup")}</div>
          <div style={{ color:T.muted, fontSize:"12px", marginTop:"4px" }}>{t(lang, "selectGroupMembers")}</div>
        </div>
        <div style={{ overflowY:"auto", padding:"14px", display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(210px,1fr))", gap:"8px" }}>
          {members.map(member => {
            const model = MODELS[member.model];
            const checked = selectedIds.includes(member.id);
            return (
              <label key={member.id} style={{ display:"flex", alignItems:"center", gap:"10px", border:`1px solid ${checked?model.color+"60":T.border}`, background:checked?`${model.color}10`:T.card, borderRadius:"10px", padding:"10px", cursor:"pointer" }}>
                <input type="checkbox" checked={checked} onChange={()=>toggle(member.id)} />
                <span style={{ width:28, height:28, borderRadius:"8px", background:`${model.color}16`, color:model.color, display:"flex", alignItems:"center", justifyContent:"center", fontWeight:900, flexShrink:0 }}>{member.emoji}</span>
                <span style={{ minWidth:0 }}>
                  <span style={{ display:"block", color:T.text, fontSize:"12.5px", fontWeight:800 }}>{member.name}</span>
                  <span style={{ display:"block", color:T.muted, fontSize:"10.5px" }}>{member.title}</span>
                </span>
              </label>
            );
          })}
        </div>
        <div style={{ padding:"14px 20px", borderTop:`1px solid ${T.border}`, display:"flex", gap:"10px" }}>
          <button onClick={onClose} style={{ flex:1, border:`1px solid ${T.border}`, background:T.surface, color:T.muted, borderRadius:"10px", padding:"11px", cursor:"pointer" }}>{t(lang, "cancel")}</button>
          <button onClick={onStart} disabled={selectedIds.length===0} style={{ flex:2, border:"none", background:selectedIds.length?T.purple:T.faint, color:"#fff", borderRadius:"10px", padding:"11px", fontWeight:900, cursor:selectedIds.length?"pointer":"default" }}>{t(lang, "startGroup")}（{selectedIds.length}）</button>
        </div>
      </div>
    </div>
  );
}

function InfoPanel({ item, onMenu, onWorkPanel, lang }) {
  return (
    <main className="nb-chat">
      <header className="nb-chat-header">
        <div style={{ display:"flex", alignItems:"center", gap:"12px", minWidth:0 }}>
          <button className="nb-menu-button" onClick={onMenu}>☰</button>
          <div>
            <div style={{ color:T.text, fontSize:"15px", fontWeight:900 }}>{item.title}</div>
            <div style={{ color:T.muted, fontSize:"11px", marginTop:"2px" }}>{item.subtitle || "目录与记录"}</div>
          </div>
        </div>
        <button className="nb-mobile-work-button" onClick={onWorkPanel}>{lang==="ja" ? "状態" : lang==="en" ? "Status" : "状态"}</button>
      </header>
      <section className="nb-message-list">
        <div style={{ background:T.surface, border:`1px solid ${T.border}`, borderRadius:"14px", padding:"16px", color:T.text, fontSize:"13.5px", lineHeight:1.8, whiteSpace:"pre-wrap" }}>{item.text}</div>
      </section>
    </main>
  );
}

function WorkflowArchiveList({ lang, refreshKey, onContinue }) {
  const [records, setRecords] = useState([]);
  const [selectedId, setSelectedId] = useState("");
  const [notice, setNotice] = useState("");
  const [savingId, setSavingId] = useState("");
  useEffect(() => {
    listWorkflowRecords({ limit:5 }).then(setRecords).catch(() => setRecords([]));
  }, [refreshKey]);
  if (!records.length) return null;
  const label = (zh, ja, en) => lang === "ja" ? ja : lang === "en" ? en : zh;
  const downloadRecord = async (record) => {
    const markdown = formatWorkflowRecordMarkdown(record, lang);
    const fileName = await saveToLocalOutputs({ name:"Workflow", title:record.title }, markdown);
    setNotice(label(`已下载：${fileName}`, `ダウンロードしました：${fileName}`, `Downloaded: ${fileName}`));
  };
  const downloadArtifact = async (record, index = 0) => {
    const markdown = formatWorkflowArtifactMarkdown(record, index, lang);
    const artifact = record.artifacts?.[index] || record.artifacts?.[0] || { title:record.title };
    const fileName = await saveToLocalOutputs({ name:"Artifact", title:artifact.title || record.title }, markdown);
    setNotice(label(`已下载产物：${fileName}`, `成果物を保存しました：${fileName}`, `Downloaded artifact: ${fileName}`));
  };
  const continueRecord = (record) => {
    onContinue?.(buildWorkflowContinuationPrompt(record, lang));
    setNotice(label("已放入 ARIA 输入框。", "ARIA の入力欄に入れました。", "Placed in ARIA input."));
  };
  const rerunRecord = (record) => {
    onContinue?.(buildWorkflowRerunPrompt(record, lang));
    setNotice(label("已放入 ARIA 输入框，可直接复跑。", "ARIA の入力欄に入れました。再実行できます。", "Placed in ARIA input for rerun."));
  };
  const recoverRecord = (record) => {
    onContinue?.(buildWorkflowRecoveryPrompt(record, lang));
    setNotice(label("已放入 ARIA 输入框，可恢复失败部分。", "ARIA の入力欄に入れました。失敗部分を復旧できます。", "Placed in ARIA input for recovery."));
  };
  const skipRecord = (record) => {
    onContinue?.(buildWorkflowSkipPrompt(record, lang));
    setNotice(label("已放入 ARIA 输入框，可跳过缺失成员并整合。", "ARIA の入力欄に入れました。不足メンバーをスキップして統合できます。", "Placed in ARIA input to skip missing members and integrate."));
  };
  const rememberRecord = async (record, approvalState = "approved") => {
    setSavingId(record.id);
    try {
      const approved = approvalState === "approved";
      const payload = buildWorkflowKnowledgePayload(record, lang, {
        memoryStatus:approved ? "approved" : "candidate",
        documentStatus:approved ? "approved" : "candidate",
      });
      const doc = await putKnowledgeDocument(payload.document);
      if (approved) await updateKnowledgeDocument(doc.id, { status:"approved", archived:false });
      await putProjectMemory({
        ...payload.memory,
        metadata:{ ...payload.memory.metadata, sourceDocId:doc.id },
      });
      setNotice(approved
        ? label("已加入知识库和长期记忆。", "知識庫と長期記憶に追加しました。", "Added to knowledge and long-term memory.")
        : label("已加入待确认知识和候选记忆。", "候補知識と候補記憶に追加しました。", "Added as candidate knowledge and memory."));
    } catch (e) {
      setNotice(e.message || label("加入知识库失败。", "知識庫への追加に失敗しました。", "Failed to add to knowledge."));
    } finally {
      setSavingId("");
    }
  };
  const archiveRecord = async (record) => {
    setSavingId(record.id);
    try {
      const archived = await markWorkflowRecordArchived(record.id);
      setRecords(items => items.map(item => item.id === archived.id ? archived : item));
      setNotice(label("已归档该工作流记录。", "このワークフロー記録をアーカイブしました。", "Workflow record archived."));
    } catch (e) {
      setNotice(e.message || label("归档失败。", "アーカイブに失敗しました。", "Archive failed."));
    } finally {
      setSavingId("");
    }
  };
  return (
    <div style={{ marginTop:"10px", border:`1px solid ${T.border}`, background:T.surface, borderRadius:"10px", padding:"12px" }}>
      <div style={{ color:T.muted, fontSize:"10.5px", fontWeight:800 }}>{label("最近工作流记录", "最近のワークフロー記録", "Recent workflow records")}</div>
      {notice && <div style={{ color:T.green, fontSize:"10.5px", lineHeight:1.45, marginTop:"7px" }}>{notice}</div>}
      <div style={{ display:"flex", flexDirection:"column", gap:"8px", marginTop:"8px" }}>
        {records.map(record => {
          const artifact = record.artifacts?.[0];
          const selected = selectedId === record.id;
          const details = selected ? buildWorkflowRecordDetails(record, lang) : null;
          const canRecover = record.status !== "done" || !!record.error || record.members?.some(member => member.status === "failed");
          return (
            <div key={record.id} style={{ border:`1px solid ${selected ? T.blue : T.border}`, background:selected ? T.surface : T.card, borderRadius:"8px", padding:"9px" }}>
              <button type="button" onClick={()=>setSelectedId(selected ? "" : record.id)} style={{ width:"100%", border:"none", background:"transparent", padding:0, cursor:"pointer", textAlign:"left" }}>
                <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:"8px" }}>
                  <div style={{ color:T.text, fontSize:"11.5px", fontWeight:900, minWidth:0, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{record.title}</div>
                  <div style={{ color:record.status === "done" ? T.green : record.status === "archived" ? T.muted : T.orange, fontSize:"10px", fontWeight:900, whiteSpace:"nowrap" }}>{workflowStatusLabel(lang, record.status)}</div>
                </div>
                <div style={{ color:T.muted, fontSize:"10px", marginTop:"3px" }}>{record.members?.length || 0} {label("名成员", "名", "members")} · {record.source}</div>
                {artifact?.content && <div style={{ color:T.text, fontSize:"10.8px", lineHeight:1.5, marginTop:"6px", maxHeight:selected ? "220px" : "72px", overflow:"hidden", whiteSpace:"pre-wrap" }}>{artifact.content}</div>}
              </button>
              {selected && (
                <div style={{ marginTop:"9px", borderTop:`1px solid ${T.border}`, paddingTop:"8px" }}>
                  {!!details?.overview?.length && (
                    <div style={{ display:"grid", gridTemplateColumns:"repeat(2,minmax(0,1fr))", gap:"6px", marginBottom:"8px" }}>
                      {details.overview.map(item => (
                        <div key={item.label} style={{ border:`1px solid ${T.border}`, background:T.card, borderRadius:"7px", padding:"6px", minWidth:0 }}>
                          <div style={{ color:T.muted, fontSize:"9.5px", fontWeight:800 }}>{item.label}</div>
                          <div style={{ color:T.text, fontSize:"10.5px", fontWeight:900, marginTop:"2px", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{item.value || "-"}</div>
                        </div>
                      ))}
                    </div>
                  )}
                  {details?.plan && (
                    <div style={{ border:`1px solid ${T.border}`, background:T.card, borderRadius:"7px", padding:"7px", marginBottom:"8px" }}>
                      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:"8px" }}>
                        <div style={{ color:T.text, fontSize:"10.8px", fontWeight:900 }}>{details.plan.title}</div>
                        <button type="button" onClick={()=>{ onContinue?.(buildWorkflowPlanEditPrompt(record, lang)); setNotice(label("已放入 ARIA 输入框。", "ARIA の入力欄に入れました。", "Placed in ARIA input.")); }} style={{ border:`1px solid ${T.blue}55`, background:T.surface, color:T.blue, borderRadius:"7px", padding:"4px 7px", fontSize:"9.5px", fontWeight:900, cursor:"pointer", whiteSpace:"nowrap" }}>{label("调整", "調整", "Edit")}</button>
                      </div>
                      <div style={{ color:T.muted, fontSize:"10px", lineHeight:1.45, marginTop:"3px" }}>{details.plan.strategy}</div>
                      {details.plan.protocol?.intent && <div style={{ color:T.text, fontSize:"10px", lineHeight:1.45, marginTop:"4px" }}>{details.plan.protocol.intent} · {details.plan.protocol.task_type} · {details.plan.protocol.priority}</div>}
                      <div style={{ color:T.text, fontSize:"10px", lineHeight:1.5, marginTop:"5px" }}>{details.plan.steps.join(" / ")}</div>
                    </div>
                  )}
                  {details?.modelUsage && (
                    <div style={{ border:`1px solid ${T.border}`, background:T.card, borderRadius:"7px", padding:"7px", marginBottom:"8px" }}>
                      <div style={{ color:T.text, fontSize:"10.8px", fontWeight:900 }}>{details.modelUsage.title}</div>
                      <div style={{ color:details.modelUsage.external ? T.orange : T.muted, fontSize:"10px", lineHeight:1.45, marginTop:"3px" }}>{details.modelUsage.lines.join(" / ")}</div>
                    </div>
                  )}
                  {details?.toolCalls && (
                    <div style={{ border:`1px solid ${details.toolCalls.needsAttention ? T.orange : T.border}`, background:T.card, borderRadius:"7px", padding:"7px", marginBottom:"8px" }}>
                      <div style={{ color:details.toolCalls.needsAttention ? T.orange : T.text, fontSize:"10.8px", fontWeight:900 }}>{label("工具调用", "ツール呼び出し", "Tool calls")}</div>
                      <div style={{ color:T.muted, fontSize:"10px", lineHeight:1.5, marginTop:"3px" }}>
                        {details.toolCalls.entries.map(entry => `${entry.name} · ${entry.status} · ${entry.permission}`).join(" / ")}
                      </div>
                    </div>
                  )}
                  {!!details?.artifacts?.length && (
                    <div style={{ border:`1px solid ${T.border}`, background:T.card, borderRadius:"7px", padding:"7px", marginBottom:"8px" }}>
                      <div style={{ color:T.text, fontSize:"10.8px", fontWeight:900 }}>{label("产物版本", "成果物バージョン", "Artifact versions")}</div>
                      <div style={{ display:"flex", flexDirection:"column", gap:"5px", marginTop:"5px" }}>
                        {details.artifacts.map((item, index) => (
                          <div key={`${item.title}-${index}`} style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:"7px" }}>
                            <div style={{ color:T.muted, fontSize:"10px", lineHeight:1.5, minWidth:0 }}>{item.title} · {item.meta}</div>
                            <button type="button" onClick={()=>downloadArtifact(record, index)} style={{ border:`1px solid ${T.border}`, background:T.surface, color:T.blue, borderRadius:"7px", padding:"4px 7px", fontSize:"9.5px", fontWeight:900, cursor:"pointer", whiteSpace:"nowrap" }}>{label("下载", "保存", "Download")}</button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {!!record.results?.length && <div style={{ color:T.muted, fontSize:"10.5px", lineHeight:1.5 }}>{record.results.slice(0, 6).map(result => `${result.member} · ${result.title}`).join(" / ")}</div>}
                  <div style={{ display:"flex", gap:"7px", marginTop:"8px", flexWrap:"wrap" }}>
                    <button type="button" onClick={()=>downloadRecord(record)} style={{ border:"none", background:T.blue, color:"#fff", borderRadius:"7px", padding:"6px 9px", fontSize:"10.5px", fontWeight:900, cursor:"pointer" }}>{label("下载完整记录", "完全記録を保存", "Download full record")}</button>
                    <button type="button" onClick={()=>continueRecord(record)} style={{ border:`1px solid ${T.blue}55`, background:T.surface, color:T.blue, borderRadius:"7px", padding:"6px 9px", fontSize:"10.5px", fontWeight:900, cursor:"pointer" }}>{label("继续任务", "続行", "Continue")}</button>
                    <button type="button" onClick={()=>rerunRecord(record)} style={{ border:`1px solid ${T.purple}55`, background:T.surface, color:T.purple, borderRadius:"7px", padding:"6px 9px", fontSize:"10.5px", fontWeight:900, cursor:"pointer" }}>{label("复跑", "再実行", "Rerun")}</button>
                    {canRecover && <button type="button" onClick={()=>recoverRecord(record)} style={{ border:`1px solid ${T.red}45`, background:T.surface, color:T.red, borderRadius:"7px", padding:"6px 9px", fontSize:"10.5px", fontWeight:900, cursor:"pointer" }}>{label("恢复", "復旧", "Recover")}</button>}
                    {canRecover && <button type="button" onClick={()=>skipRecord(record)} style={{ border:`1px solid ${T.yellow}55`, background:T.surface, color:T.yellow, borderRadius:"7px", padding:"6px 9px", fontSize:"10.5px", fontWeight:900, cursor:"pointer" }}>{label("跳过整合", "スキップ統合", "Skip integrate")}</button>}
                    <button type="button" disabled={savingId === record.id} onClick={()=>rememberRecord(record, "candidate")} style={{ border:`1px solid ${T.yellow}55`, background:T.surface, color:savingId === record.id ? T.faint : T.yellow, borderRadius:"7px", padding:"6px 9px", fontSize:"10.5px", fontWeight:900, cursor:savingId === record.id ? "default" : "pointer" }}>{label("待确认入库", "候補保存", "Add candidate")}</button>
                    <button type="button" disabled={savingId === record.id} onClick={()=>rememberRecord(record, "approved")} style={{ border:`1px solid ${T.green}55`, background:T.surface, color:savingId === record.id ? T.faint : T.green, borderRadius:"7px", padding:"6px 9px", fontSize:"10.5px", fontWeight:900, cursor:savingId === record.id ? "default" : "pointer" }}>{savingId === record.id ? label("入库中", "保存中", "Saving") : label("批准入库", "承認保存", "Approve + add")}</button>
                    {record.status !== "archived" && <button type="button" disabled={savingId === record.id} onClick={()=>archiveRecord(record)} style={{ border:`1px solid ${T.border}`, background:T.surface, color:savingId === record.id ? T.faint : T.muted, borderRadius:"7px", padding:"6px 9px", fontSize:"10.5px", fontWeight:900, cursor:savingId === record.id ? "default" : "pointer" }}>{label("归档记录", "アーカイブ", "Archive")}</button>}
                    <button type="button" onClick={()=>setSelectedId("")} style={{ border:`1px solid ${T.border}`, background:T.card, color:T.muted, borderRadius:"7px", padding:"6px 9px", fontSize:"10.5px", fontWeight:900, cursor:"pointer" }}>{label("收起", "閉じる", "Collapse")}</button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function WorkPanelContent({ title, subtitle, lang, workflow, onContinueWorkflow, onRetryWorkflow, onSkipWorkflow }) {
  const currentWorkflow = workflow || emptyWorkflowState(lang);
  const modeColor = workflowModeColor(currentWorkflow.mode);
  const progress = currentWorkflow.progress || { done:0, total:0 };
  const canRetry = ["failed", "stopped"].includes(currentWorkflow.mode);
  const canConfirm = currentWorkflow.mode === "waiting_confirmation";
  const queue = workflowQueueSummary(currentWorkflow.members);
  const protocol = currentWorkflow.plan?.protocol || null;
  const quality = currentWorkflow.quality || null;
  const reassignment = currentWorkflow.mode === "failed" ? workflowFailureReassignmentPlan(currentWorkflow.members, lang) : { needed:false, actions:[] };
  const lifecycle = workflowLifecycleSteps(currentWorkflow.mode, lang);
  const auditSummary = currentWorkflow.mode !== "idle" ? workflowAuditSummary(currentWorkflow, lang) : null;
  const permissionChecklist = currentWorkflow.mode !== "idle" ? workflowPermissionChecklist(currentWorkflow, lang) : null;
  const outputQa = currentWorkflow.mode !== "idle" ? workflowOutputQaChecklist(currentWorkflow, lang) : null;
  const toolCalls = currentWorkflow.mode !== "idle" ? workflowToolCallChecklist(currentWorkflow, lang) : null;
  const downloadCurrentArtifact = async (index = 0) => {
    const markdown = formatWorkflowArtifactMarkdown(currentWorkflow, index, lang);
    const artifact = currentWorkflow.artifacts?.[index] || { title:currentWorkflow.title };
    await saveToLocalOutputs({ name:"Artifact", title:artifact.title || currentWorkflow.title }, markdown);
  };
  return (
    <div className="nb-work-panel-body">
      <div style={{ fontSize:"13px", fontWeight:900, color:T.text }}>{lang==="ja" ? "プレビュー / 状態" : lang==="en" ? "Preview / Status" : "预览 / 任务状态"}</div>
      <div style={{ marginTop:"12px", border:`1px solid ${T.border}`, background:T.card, borderRadius:"10px", padding:"12px" }}>
        <div style={{ color:T.muted, fontSize:"10.5px", fontWeight:800 }}>{lang==="ja" ? "現在の対象" : lang==="en" ? "Current target" : "当前目标"}</div>
        <div style={{ color:T.text, fontSize:"13px", fontWeight:900, marginTop:"5px", lineHeight:1.45 }}>{title}</div>
        <div style={{ color:T.muted, fontSize:"11px", marginTop:"4px", lineHeight:1.45 }}>{subtitle}</div>
      </div>
      <div style={{ marginTop:"10px", border:`1px solid ${T.border}`, background:T.surface, borderRadius:"10px", padding:"12px" }}>
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:"8px" }}>
          <div style={{ color:T.muted, fontSize:"10.5px", fontWeight:800 }}>{lang==="ja" ? "自動ワークフロー" : lang==="en" ? "Automation workflow" : "自动生产工作流"}</div>
          <div style={{ color:modeColor, fontSize:"11px", fontWeight:900 }}>{workflowStatusLabel(lang, currentWorkflow.mode)}</div>
        </div>
        <div style={{ color:T.text, fontSize:"12.5px", fontWeight:900, marginTop:"8px", lineHeight:1.45 }}>{currentWorkflow.title}</div>
        {currentWorkflow.phase && <div style={{ color:T.muted, fontSize:"11px", marginTop:"5px", lineHeight:1.5 }}>{currentWorkflow.phase}</div>}
        {progress.total > 0 && (
          <div style={{ marginTop:"10px" }}>
            <div style={{ height:"7px", background:T.card, borderRadius:"999px", overflow:"hidden", border:`1px solid ${T.border}` }}>
              <div style={{ width:`${Math.min(100, Math.round((progress.done / progress.total) * 100))}%`, height:"100%", background:modeColor, transition:"width .2s ease" }} />
            </div>
            <div style={{ color:T.muted, fontSize:"10.5px", marginTop:"5px" }}>{progress.done} / {progress.total}</div>
          </div>
        )}
        {currentWorkflow.mode !== "idle" && (
          <div style={{ display:"flex", gap:"5px", flexWrap:"wrap", marginTop:"10px" }}>
            {lifecycle.map(step => {
              const color = step.state === "current" ? modeColor : step.state === "complete" ? T.green : T.muted;
              return (
                <span key={step.status} style={{ border:`1px solid ${color}35`, background:step.state === "pending" ? T.surface : `${color}12`, color, borderRadius:"999px", padding:"3px 7px", fontSize:"9.5px", fontWeight:900, whiteSpace:"nowrap" }}>
                  {step.label}
                </span>
              );
            })}
          </div>
        )}
        {currentWorkflow.plan?.steps?.length > 0 && (
          <div style={{ marginTop:"10px", border:`1px solid ${T.border}`, background:T.card, borderRadius:"8px", padding:"9px" }}>
            <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:"8px" }}>
              <div style={{ color:T.text, fontSize:"11.5px", fontWeight:900 }}>{lang==="ja" ? "調度計画" : lang==="en" ? "Dispatch plan" : "调度计划"}</div>
              <button type="button" onClick={()=>onContinueWorkflow?.(buildWorkflowPlanEditPrompt(currentWorkflow, lang))} style={{ border:`1px solid ${T.blue}55`, background:T.surface, color:T.blue, borderRadius:"7px", padding:"5px 8px", fontSize:"10px", fontWeight:900, cursor:"pointer", whiteSpace:"nowrap" }}>{lang==="ja" ? "調整" : lang==="en" ? "Edit" : "调整"}</button>
            </div>
            <div style={{ color:T.muted, fontSize:"10.5px", lineHeight:1.45, marginTop:"4px" }}>{currentWorkflow.plan.strategy}</div>
            {protocol && (
              <div style={{ border:`1px solid ${T.border}`, background:T.surface, borderRadius:"7px", padding:"7px", marginTop:"7px" }}>
                <div style={{ display:"flex", gap:"6px", flexWrap:"wrap", alignItems:"center" }}>
                  <span style={{ color:T.blue, background:T.blueGlow, borderRadius:"999px", padding:"3px 7px", fontSize:"9.5px", fontWeight:900 }}>{protocol.task_type}</span>
                  <span style={{ color:protocol.priority === "high" ? T.red : protocol.priority === "low" ? T.muted : T.orange, background:T.card, border:`1px solid ${T.border}`, borderRadius:"999px", padding:"3px 7px", fontSize:"9.5px", fontWeight:900 }}>{protocol.priority}</span>
                  {protocol.needs_user_confirmation && <span style={{ color:T.red, background:"#ef444415", borderRadius:"999px", padding:"3px 7px", fontSize:"9.5px", fontWeight:900 }}>{lang==="ja" ? "確認待ち" : lang==="en" ? "Needs confirmation" : "需确认"}</span>}
                </div>
                {protocol.intent && <div style={{ color:T.text, fontSize:"10.5px", lineHeight:1.45, marginTop:"6px" }}>{protocol.intent}</div>}
                {!!protocol.subtasks?.length && <div style={{ color:T.text, fontSize:"10px", lineHeight:1.45, marginTop:"5px" }}>{lang==="ja" ? "サブタスク：" : lang==="en" ? "Subtasks: " : "子任务："}{protocol.subtasks.join(" / ")}</div>}
                {!!protocol.expected_outputs?.length && <div style={{ color:T.muted, fontSize:"10px", lineHeight:1.45, marginTop:"5px" }}>{lang==="ja" ? "成果物：" : lang==="en" ? "Outputs: " : "产物："}{protocol.expected_outputs.join(" / ")}</div>}
                {!!protocol.risks?.length && <div style={{ color:T.red, fontSize:"10px", lineHeight:1.45, marginTop:"4px" }}>{lang==="ja" ? "リスク：" : lang==="en" ? "Risks: " : "风险："}{protocol.risks.join(" / ")}</div>}
              </div>
            )}
            <div style={{ display:"flex", flexDirection:"column", gap:"6px", marginTop:"8px" }}>
              {currentWorkflow.plan.steps.slice(0, 8).map(step => (
                <div key={`${step.order}-${step.memberId || step.member}`} style={{ display:"grid", gridTemplateColumns:"22px minmax(0,1fr)", gap:"6px", alignItems:"start" }}>
                  <div style={{ width:"22px", height:"22px", borderRadius:"7px", background:T.surface, border:`1px solid ${T.border}`, color:T.muted, display:"flex", alignItems:"center", justifyContent:"center", fontSize:"10px", fontWeight:900 }}>{step.order}</div>
                  <div style={{ minWidth:0 }}>
                    <div style={{ color:T.text, fontSize:"10.8px", fontWeight:900, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{step.member} · {step.title}</div>
                    <div style={{ color:T.muted, fontSize:"10px", lineHeight:1.4, marginTop:"2px" }}>{step.purpose}</div>
                    {step.subtask && <div style={{ color:T.text, fontSize:"10px", lineHeight:1.4, marginTop:"3px" }}>{step.subtask}</div>}
                    {step.output && <div style={{ color:T.muted, fontSize:"9.8px", lineHeight:1.4, marginTop:"2px" }}>{lang==="ja" ? "出力：" : lang==="en" ? "Output: " : "输出："}{step.output}</div>}
                    {!!step.dependencies?.length && <div style={{ color:T.muted, fontSize:"9.8px", lineHeight:1.4, marginTop:"2px" }}>{lang==="ja" ? "依存：" : lang==="en" ? "Depends: " : "依赖："}{step.dependencies.join(" / ")}</div>}
                    {step.acceptanceCriteria && <div style={{ color:T.green, fontSize:"9.8px", lineHeight:1.4, marginTop:"2px" }}>{lang==="ja" ? "受入：" : lang==="en" ? "Acceptance: " : "验收："}{step.acceptanceCriteria}</div>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        {queue.total > 0 && (
          <div style={{ marginTop:"10px", border:`1px solid ${T.border}`, background:T.card, borderRadius:"8px", padding:"9px" }}>
            <div style={{ color:T.text, fontSize:"11.5px", fontWeight:900 }}>{lang==="ja" ? "メンバータスクキュー" : lang==="en" ? "Member task queue" : "成员任务队列"}</div>
            <div style={{ display:"grid", gridTemplateColumns:"repeat(4,minmax(0,1fr))", gap:"6px", marginTop:"8px" }}>
              {[
                [lang==="ja" ? "待機" : lang==="en" ? "Queued" : "待执行", queue.queued, T.muted],
                [lang==="ja" ? "実行" : lang==="en" ? "Working" : "执行中", queue.working, T.blue],
                [lang==="ja" ? "完了" : lang==="en" ? "Done" : "已完成", queue.complete, T.green],
                [lang==="ja" ? "失敗" : lang==="en" ? "Failed" : "失败", queue.failed, T.red],
              ].map(([name, value, color]) => (
                <div key={name} style={{ border:`1px solid ${T.border}`, background:T.surface, borderRadius:"7px", padding:"6px", minWidth:0 }}>
                  <div style={{ color, fontSize:"12px", fontWeight:900, textAlign:"center" }}>{value}</div>
                  <div style={{ color:T.muted, fontSize:"9.5px", marginTop:"2px", textAlign:"center", whiteSpace:"nowrap" }}>{name}</div>
                </div>
              ))}
            </div>
            {queue.next && <div style={{ color:T.muted, fontSize:"10.5px", lineHeight:1.45, marginTop:"8px" }}>{lang==="ja" ? "次：" : lang==="en" ? "Next: " : "下一位："}{queue.next.name} · {queue.next.title}</div>}
          </div>
        )}
        {quality && (
          <div style={{ marginTop:"10px", border:`1px solid ${quality.complete ? T.green : T.red}40`, background:quality.complete ? "#10b98112" : "#ef444415", borderRadius:"8px", padding:"9px" }}>
            <div style={{ color:quality.complete ? T.green : T.red, fontSize:"11.5px", fontWeight:900 }}>{lang==="ja" ? "成果チェック" : lang==="en" ? "Output check" : "成果检查"}</div>
            <div style={{ color:T.text, fontSize:"10.5px", lineHeight:1.45, marginTop:"4px" }}>
              {quality.complete
                ? (lang==="ja" ? "全担当メンバーの成果があります。" : lang==="en" ? "All assigned member outputs are present." : "所有分派成员都有成果。")
                : `${lang==="ja" ? "不足：" : lang==="en" ? "Missing: " : "缺失："}${quality.missingMembers?.map(item => `${item.name} · ${item.title}`).join(" / ") || "-"}`}
            </div>
          </div>
        )}
        {outputQa && (
          <div style={{ marginTop:"10px", border:`1px solid ${outputQa.passed ? T.green : T.yellow}40`, background:outputQa.passed ? "#10b98110" : "#f59e0b10", borderRadius:"8px", padding:"9px" }}>
            <div style={{ color:outputQa.passed ? T.green : T.yellow, fontSize:"11.5px", fontWeight:900 }}>{lang==="ja" ? "成果物QA" : lang==="en" ? "Output QA" : "产物 QA"}</div>
            <div style={{ display:"grid", gridTemplateColumns:"repeat(2,minmax(0,1fr))", gap:"6px", marginTop:"7px" }}>
              {outputQa.checks.map(check => (
                <div key={check.id} style={{ border:`1px solid ${T.border}`, background:T.surface, borderRadius:"7px", padding:"6px", minWidth:0 }}>
                  <div style={{ color:check.passed ? T.green : T.yellow, fontSize:"10px", fontWeight:900, whiteSpace:"nowrap" }}>{check.label}</div>
                  <div style={{ color:T.muted, fontSize:"9.5px", lineHeight:1.35, marginTop:"2px" }}>{check.detail}</div>
                </div>
              ))}
            </div>
          </div>
        )}
        {reassignment.needed && (
          <div style={{ marginTop:"10px", border:`1px solid ${T.yellow}55`, background:"#f59e0b12", borderRadius:"8px", padding:"9px" }}>
            <div style={{ color:T.yellow, fontSize:"11.5px", fontWeight:900 }}>{lang==="ja" ? "自動再割当案" : lang==="en" ? "Fallback route" : "自动改派建议"}</div>
            <div style={{ display:"flex", flexDirection:"column", gap:"6px", marginTop:"7px" }}>
              {reassignment.actions.slice(0, 6).map(action => (
                <div key={`${action.memberId}-${action.toModel}`} style={{ color:T.text, fontSize:"10.5px", lineHeight:1.45 }}>
                  <strong>{action.name} · {action.title}</strong>
                  <span style={{ color:T.muted }}>：{action.fromModel || "-"} → {action.toModel}</span>
                  <div style={{ color:T.muted, marginTop:"2px" }}>{action.reason}</div>
                </div>
              ))}
            </div>
          </div>
        )}
        {auditSummary && (
          <div style={{ marginTop:"10px", border:`1px solid ${T.border}`, background:T.card, borderRadius:"8px", padding:"9px" }}>
            <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:"8px" }}>
              <div style={{ color:T.text, fontSize:"11.5px", fontWeight:900 }}>{lang==="ja" ? "監査サマリー" : lang==="en" ? "Audit summary" : "审计摘要"}</div>
              <span style={{ color:auditSummary.external ? T.orange : T.muted, fontSize:"9.5px", fontWeight:900 }}>{auditSummary.external ? (lang==="ja" ? "外部送信あり" : lang==="en" ? "External" : "有外发") : (lang==="ja" ? "ローカル中心" : lang==="en" ? "Local-first" : "本地优先")}</span>
            </div>
            <div style={{ color:T.muted, fontSize:"10px", lineHeight:1.55, marginTop:"5px" }}>{auditSummary.lines.join(" / ")}</div>
          </div>
        )}
        {permissionChecklist && (
          <div style={{ marginTop:"10px", border:`1px solid ${permissionChecklist.blocked ? T.yellow : T.border}`, background:permissionChecklist.blocked ? "#f59e0b10" : T.card, borderRadius:"8px", padding:"9px" }}>
            <div style={{ color:permissionChecklist.blocked ? T.yellow : T.text, fontSize:"11.5px", fontWeight:900 }}>{lang==="ja" ? "権限チェック" : lang==="en" ? "Permission checklist" : "权限检查"}</div>
            <div style={{ display:"flex", flexDirection:"column", gap:"5px", marginTop:"7px" }}>
              {permissionChecklist.entries.map(entry => {
                const color = entry.status === "ok" ? T.green : entry.status === "needs_disclosure" ? T.orange : T.yellow;
                return (
                  <div key={entry.id} style={{ color:T.text, fontSize:"10.2px", lineHeight:1.45 }}>
                    <span style={{ color, fontWeight:900 }}>{entry.label}</span>
                    <span style={{ color:T.muted }}> · {entry.detail}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
        {toolCalls && (
          <div style={{ marginTop:"10px", border:`1px solid ${toolCalls.needsAttention ? T.orange : T.border}`, background:toolCalls.needsAttention ? "#f59e0b10" : T.card, borderRadius:"8px", padding:"9px" }}>
            <div style={{ color:toolCalls.needsAttention ? T.orange : T.text, fontSize:"11.5px", fontWeight:900 }}>{lang==="ja" ? "ツール呼び出し" : lang==="en" ? "Tool calls" : "工具调用"}</div>
            <div style={{ display:"grid", gridTemplateColumns:"repeat(2,minmax(0,1fr))", gap:"6px", marginTop:"7px" }}>
              {toolCalls.entries.map(entry => {
                const color = entry.status === "recorded" || entry.status === "available" ? T.green : entry.status === "not_needed" || entry.status === "optional" ? T.muted : T.orange;
                return (
                  <div key={entry.id} style={{ border:`1px solid ${T.border}`, background:T.surface, borderRadius:"7px", padding:"6px", minWidth:0 }}>
                    <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:"5px" }}>
                      <div style={{ color:T.text, fontSize:"10px", fontWeight:900, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{entry.name}</div>
                      <span style={{ color, fontSize:"9px", fontWeight:900, whiteSpace:"nowrap" }}>{entry.permission}</span>
                    </div>
                    <div style={{ color:T.muted, fontSize:"9.5px", lineHeight:1.35, marginTop:"2px" }}>{entry.detail}</div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
        {!!currentWorkflow.modelUsage?.models?.length && (
          <div style={{ marginTop:"10px", border:`1px solid ${T.border}`, background:T.card, borderRadius:"8px", padding:"9px" }}>
            <div style={{ color:T.text, fontSize:"11.5px", fontWeight:900 }}>{lang==="ja" ? "モデル呼び出し" : lang==="en" ? "Model calls" : "模型调用"}</div>
            <div style={{ color:currentWorkflow.modelUsage.external ? T.orange : T.muted, fontSize:"10.5px", lineHeight:1.45, marginTop:"4px" }}>
              {workflowExternalDisclosureLines(currentWorkflow.modelUsage, lang).join(" ")}
            </div>
            <div style={{ display:"flex", gap:"6px", flexWrap:"wrap", marginTop:"8px" }}>
              {currentWorkflow.modelUsage.models.map(item => (
                <span key={item.modelKey} style={{ border:`1px solid ${T.border}`, background:T.surface, color:item.external ? T.orange : T.muted, borderRadius:"999px", padding:"4px 7px", fontSize:"10px", fontWeight:900 }}>
                  {item.modelKey}{item.provider ? ` · ${item.provider}` : ""}
                </span>
              ))}
            </div>
          </div>
        )}
        {!!currentWorkflow.members?.length && (
          <div style={{ display:"flex", flexDirection:"column", gap:"7px", marginTop:"10px" }}>
            {currentWorkflow.members.map(member => {
              const statusColor = member.status === "complete" ? T.green : member.status === "failed" ? T.red : member.status === "working" ? T.blue : T.muted;
              return (
                <div key={member.id} style={{ border:`1px solid ${T.border}`, background:T.card, borderRadius:"8px", padding:"8px" }}>
                  <div style={{ display:"flex", justifyContent:"space-between", gap:"8px", alignItems:"center" }}>
                    <div style={{ minWidth:0 }}>
                      <div style={{ color:T.text, fontSize:"11.5px", fontWeight:900, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{member.name}</div>
                      <div style={{ color:T.muted, fontSize:"10px", marginTop:"2px", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{member.title}</div>
                    </div>
                    <div style={{ color:statusColor, fontSize:"10px", fontWeight:900, whiteSpace:"nowrap" }}>{workflowStatusLabel(lang, member.status)}</div>
                  </div>
                  {member.summary && <div style={{ color:T.muted, fontSize:"10.5px", lineHeight:1.45, marginTop:"6px" }}>{member.summary}</div>}
                  {member.error && <div style={{ color:T.red, fontSize:"10.5px", lineHeight:1.45, marginTop:"6px" }}>{member.error}</div>}
                </div>
              );
            })}
          </div>
        )}
        {currentWorkflow.error && <div style={{ color:T.red, fontSize:"11px", lineHeight:1.5, marginTop:"9px" }}>{currentWorkflow.error}</div>}
        {canRetry && (
          <button type="button" onClick={()=>onContinueWorkflow?.(buildWorkflowResumePrompt(currentWorkflow, lang))} style={{ width:"100%", marginTop:"10px", border:`1px solid ${T.blue}55`, background:T.surface, color:T.blue, borderRadius:"8px", padding:"8px 10px", fontSize:"11px", fontWeight:900, cursor:"pointer" }}>
            {lang === "ja" ? "残りを続行" : lang === "en" ? "Resume remaining" : "继续剩余队列"}
          </button>
        )}
        {canRetry && (
          <button type="button" onClick={()=>onRetryWorkflow?.(buildWorkflowRetryPrompt(currentWorkflow, lang))} style={{ width:"100%", marginTop:"10px", border:`1px solid ${T.red}55`, background:T.surface, color:T.red, borderRadius:"8px", padding:"8px 10px", fontSize:"11px", fontWeight:900, cursor:"pointer" }}>
            {lang === "ja" ? "失敗部分を再試行" : lang === "en" ? "Retry failed parts" : "重试失败部分"}
          </button>
        )}
        {canRetry && (
          <button type="button" onClick={()=>onSkipWorkflow?.(buildWorkflowSkipPrompt(currentWorkflow, lang))} style={{ width:"100%", marginTop:"8px", border:`1px solid ${T.yellow}70`, background:T.surface, color:T.yellow, borderRadius:"8px", padding:"8px 10px", fontSize:"11px", fontWeight:900, cursor:"pointer" }}>
            {lang === "ja" ? "スキップして統合" : lang === "en" ? "Skip and integrate" : "跳过并整合"}
          </button>
        )}
        {canConfirm && (
          <button type="button" onClick={()=>onContinueWorkflow?.(buildWorkflowConfirmationPrompt(currentWorkflow, lang))} style={{ width:"100%", marginTop:"10px", border:`1px solid ${T.yellow}70`, background:T.surface, color:T.yellow, borderRadius:"8px", padding:"8px 10px", fontSize:"11px", fontWeight:900, cursor:"pointer" }}>
            {lang === "ja" ? "確認して続行" : lang === "en" ? "Confirm and continue" : "确认继续"}
          </button>
        )}
      </div>
      <div style={{ marginTop:"10px", border:`1px solid ${T.border}`, background:T.surface, borderRadius:"10px", padding:"12px" }}>
        <div style={{ color:T.muted, fontSize:"10.5px", fontWeight:800 }}>{lang==="ja" ? "成果物" : lang==="en" ? "Artifacts" : "产物"}</div>
        {!!currentWorkflow.artifacts?.length ? (
          <div style={{ display:"flex", flexDirection:"column", gap:"8px", marginTop:"8px" }}>
            {currentWorkflow.artifacts.map((artifact, index) => (
              <div key={`${artifact.title}-${index}`} style={{ border:`1px solid ${T.border}`, background:T.card, borderRadius:"8px", padding:"9px" }}>
                <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:"8px" }}>
                  <div style={{ color:T.text, fontSize:"11.5px", fontWeight:900, minWidth:0, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{artifact.title}</div>
                  <div style={{ display:"flex", alignItems:"center", gap:"6px", flexShrink:0 }}>
                    <div style={{ color:T.blue, background:T.surface, border:`1px solid ${T.border}`, borderRadius:"999px", padding:"2px 6px", fontSize:"9.5px", fontWeight:900, whiteSpace:"nowrap" }}>v{artifact.version || index + 1}</div>
                    <button type="button" onClick={()=>downloadCurrentArtifact(index)} style={{ border:`1px solid ${T.border}`, background:T.surface, color:T.blue, borderRadius:"7px", padding:"3px 7px", fontSize:"9.5px", fontWeight:900, cursor:"pointer", whiteSpace:"nowrap" }}>{lang==="ja" ? "保存" : lang==="en" ? "Download" : "下载"}</button>
                  </div>
                </div>
                <div style={{ color:T.muted, fontSize:"10.5px", marginTop:"3px" }}>{artifact.kind}{artifact.hash ? ` · ${artifact.hash}` : ""}</div>
                <div style={{ color:T.text, fontSize:"10.8px", lineHeight:1.5, marginTop:"6px", maxHeight:"96px", overflow:"hidden", whiteSpace:"pre-wrap" }}>{artifact.content}</div>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ color:T.text, fontSize:"12px", marginTop:"7px", lineHeight:1.65 }}>
            {lang==="ja"
              ? "ワークフロー完了後、統合成果がここに表示されます。返信下の保存ボタンでローカル保存できます。"
              : lang==="en"
                ? "Integrated workflow outputs appear here after completion. Use the save button under a reply to download locally."
                : "工作流完成后，整合产物会显示在这里。可点击回复下方保存按钮下载到本机。"}
          </div>
        )}
      </div>
      <WorkflowArchiveList lang={lang} refreshKey={`${currentWorkflow.id}-${currentWorkflow.mode}-${currentWorkflow.updatedAt}`} onContinue={onContinueWorkflow} />
    </div>
  );
}

function KnowledgePanel({ onMenu, onWorkPanel, lang }) {
  const [docs, setDocs] = useState([]);
  const [memories, setMemories] = useState([]);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState([]);
  const [note, setNote] = useState({ type:"decision", title:"", content:"" });
  const [message, setMessage] = useState("");
  const [stats, setStats] = useState(null);
  const [conflictsOnly, setConflictsOnly] = useState(false);
  const importRef = useRef(null);

  const refresh = async () => {
    const [nextDocs, nextMemories, nextStats] = await Promise.all([
      listKnowledgeDocuments(),
      listProjectMemories({ statuses:["short_term", "candidate", "approved"] }),
      knowledgeStats(),
    ]);
    setDocs(nextDocs);
    setMemories(nextMemories);
    setStats(nextStats);
  };

  useEffect(() => { refresh().catch(() => {}); }, []);

  const runSearch = async () => {
    setHits(await searchKnowledgeForPanel(query));
  };

  const addMemory = async () => {
    if (!note.title.trim() || !note.content.trim()) return;
    await putProjectMemory({ ...note, status:"approved" });
    setNote({ type:"decision", title:"", content:"" });
    setMessage(lang === "ja" ? "承認済み記憶を追加しました。" : lang === "en" ? "Approved memory added." : "已添加已批准记忆。");
    await refresh();
  };

  const bulkUpdateMemories = async (items, patch) => {
    for (const item of items) {
      if (patch.status === "approved") await approveProjectMemory(item);
      else await updateProjectMemory(item.id, patch);
    }
    await refresh();
  };

  const bulkDeleteMemories = async (items) => {
    for (const item of items) {
      await deleteProjectMemory(item.id);
    }
    await refresh();
  };

  const bulkReviewConflicts = async () => {
    const conflicted = memories.filter(memoryHasConflict);
    for (const item of conflicted) {
      await updateProjectMemory(item.id, { metadata:clearMemoryConflictMetadata(item.metadata) });
    }
    setMessage(label(`已确认保留 ${conflicted.length} 条冲突记忆。`, `${conflicted.length} 件の競合記憶を確認して保持しました。`, `Kept ${conflicted.length} reviewed conflict memories.`));
    await refresh();
  };

  const exportAll = async () => {
    const payload = await exportKnowledgeLibrary();
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type:"application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `neural-bridge-knowledge-${new Date().toISOString().slice(0,10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const importAll = async (file) => {
    if (!file) return;
    if (file.size > KB_IMPORT_MAX_BYTES) {
      throw new Error(label("知识库导入文件过大。", "知識庫インポートファイルが大きすぎます。", "Knowledge import file is too large."));
    }
    const payload = JSON.parse(await file.text());
    await importKnowledgeLibrary(payload);
    setMessage(lang === "ja" ? "知識庫をインポートしました。" : lang === "en" ? "Knowledge imported." : "已导入知识库。");
    await refresh();
  };

  const label = (zh, ja, en) => lang === "ja" ? ja : lang === "en" ? en : zh;
  const usageText = stats?.quota ? `${formatBytes(stats.usage || 0)} / ${formatBytes(stats.quota || 0)}` : "-";
  const visibleMemories = conflictsOnly ? memories.filter(memoryHasConflict) : memories;
  const conflictCount = memories.filter(memoryHasConflict).length;
  const approvedMemories = visibleMemories.filter(item => item.status === "approved");
  const shortTermMemories = visibleMemories.filter(item => item.status === "short_term");
  const candidateMemories = visibleMemories.filter(item => item.status === "candidate");
  const renderMemoryGroup = (title, items, kind) => (
    <div style={{ borderTop:`1px solid ${T.border}`, paddingTop:"10px", marginTop:"12px" }}>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:"8px", marginBottom:"8px", flexWrap:"wrap" }}>
        <div style={{ color:T.text, fontSize:"12.5px", fontWeight:900 }}>{title}（{items.length}）</div>
        {!!items.length && <div style={{ display:"flex", gap:"6px", flexWrap:"wrap" }}>
          {kind !== "approved" && <button onClick={()=>bulkUpdateMemories(items, { status:"approved", archived:false })} style={{ border:`1px solid ${T.border}`, background:T.surface, color:T.green, borderRadius:"7px", padding:"5px 8px", fontSize:"10.5px", cursor:"pointer" }}>{label("批量批准", "一括承認", "Approve all")}</button>}
          <button onClick={()=>bulkUpdateMemories(items, { status:"archived", archived:true })} style={{ border:`1px solid ${T.border}`, background:T.surface, color:T.muted, borderRadius:"7px", padding:"5px 8px", fontSize:"10.5px", cursor:"pointer" }}>{label("批量归档", "一括アーカイブ", "Archive all")}</button>
          <button onClick={()=>bulkDeleteMemories(items)} style={{ border:`1px solid ${T.border}`, background:T.surface, color:T.red, borderRadius:"7px", padding:"5px 8px", fontSize:"10.5px", cursor:"pointer" }}>{label("批量删除", "一括削除", "Delete all")}</button>
        </div>}
      </div>
      <div style={{ display:"flex", flexDirection:"column", gap:"8px" }}>
        {items.slice(0, 8).map(item => (
          <div key={item.id} style={{ border:`1px solid ${T.border}`, background:T.card, borderRadius:"9px", padding:"10px" }}>
            <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:"8px" }}>
              <div style={{ color:T.text, fontSize:"12px", fontWeight:900, minWidth:0, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{item.title}</div>
              {["artifact", "member_output"].includes(item.type) && <span style={{ color:item.type === "artifact" ? T.purple : T.blue, background:item.type === "artifact" ? `${T.purple}14` : `${T.blue}14`, borderRadius:"999px", padding:"3px 7px", fontSize:"9.5px", fontWeight:900, whiteSpace:"nowrap" }}>{item.type === "artifact" ? label("产物", "成果物", "Artifact") : label("成员", "メンバー", "Member")}</span>}
            </div>
            <div style={{ color:T.muted, fontSize:"10.5px", margin:"4px 0" }}>[{item.type}] {item.updatedAt?.slice(0,10)} · {item.status} · importance {item.importance || 1}{item.metadata?.sourceDocId ? ` · ${label("可入文档库", "文書庫連携", "indexable")}` : ""}</div>
            {item.metadata?.workflowRecordId && (
              <div style={{ color:T.muted, background:T.surface, border:`1px solid ${T.border}`, borderRadius:"7px", padding:"6px 7px", fontSize:"10px", lineHeight:1.45, marginBottom:"7px" }}>
                {[
                  `${label("工作流", "ワークフロー", "Workflow")}: ${item.metadata.workflowRecordId}`,
                  item.metadata.taskType ? `${label("类型", "種別", "Type")}: ${item.metadata.taskType}` : "",
                  item.metadata.priority ? `${label("优先级", "優先度", "Priority")}: ${item.metadata.priority}` : "",
                  item.metadata.qualityComplete !== null && item.metadata.qualityComplete !== undefined ? `${label("质量", "品質", "Quality")}: ${item.metadata.qualityComplete ? label("完整", "完全", "complete") : label("有缺失", "不足あり", "missing")}` : "",
                  item.metadata.members?.length ? `${label("成员", "メンバー", "Members")}: ${item.metadata.members.length}` : "",
                ].filter(Boolean).join(" · ")}
              </div>
            )}
            {item.metadata?.conflict && (
              <div style={{ color:T.red, background:"#ef444415", border:"1px solid #ef444430", borderRadius:"7px", padding:"6px 7px", fontSize:"10.5px", lineHeight:1.45, marginBottom:"7px", display:"flex", alignItems:"center", justifyContent:"space-between", gap:"8px", flexWrap:"wrap" }}>
                <span>{label("可能冲突：", "競合の可能性：", "Possible conflict: ")}{item.metadata.conflict.title || item.metadata.conflict.memoryId}</span>
                <button onClick={async()=>{ await updateProjectMemory(item.id, { metadata:clearMemoryConflictMetadata(item.metadata) }); await refresh(); }} style={{ border:`1px solid ${T.red}40`, background:T.surface, color:T.red, borderRadius:"7px", padding:"4px 7px", fontSize:"10px", cursor:"pointer", whiteSpace:"nowrap" }}>{label("确认保留", "確認して保持", "Keep reviewed")}</button>
              </div>
            )}
            <div style={{ color:T.text, fontSize:"11.5px", lineHeight:1.55, whiteSpace:"pre-wrap", maxHeight:"96px", overflow:"hidden" }}>{item.summary || item.content}</div>
            <div style={{ display:"flex", gap:"6px", marginTop:"8px", flexWrap:"wrap" }}>
              {item.status !== "approved" && <button onClick={async()=>{ await approveProjectMemory(item); await refresh(); }} style={{ border:`1px solid ${T.border}`, background:T.surface, color:T.green, borderRadius:"7px", padding:"5px 8px", fontSize:"10.5px", cursor:"pointer" }}>{item.metadata?.sourceDocId ? label("批准并入库", "承認して文書化", "Approve + index") : label("批准", "承認", "Approve")}</button>}
              {item.status !== "short_term" && <button onClick={async()=>{ await updateProjectMemory(item.id, { status:"short_term" }); await refresh(); }} style={{ border:`1px solid ${T.border}`, background:T.surface, color:T.muted, borderRadius:"7px", padding:"5px 8px", fontSize:"10.5px", cursor:"pointer" }}>{label("转短期", "短期へ", "Short-term")}</button>}
              {item.status !== "candidate" && <button onClick={async()=>{ await updateProjectMemory(item.id, { status:"candidate" }); await refresh(); }} style={{ border:`1px solid ${T.border}`, background:T.surface, color:T.muted, borderRadius:"7px", padding:"5px 8px", fontSize:"10.5px", cursor:"pointer" }}>{label("待确认", "候補へ", "Candidate")}</button>}
              <button onClick={async()=>{ await updateProjectMemory(item.id, { status:"archived", archived:true }); await refresh(); }} style={{ border:`1px solid ${T.border}`, background:T.surface, color:T.muted, borderRadius:"7px", padding:"5px 8px", fontSize:"10.5px", cursor:"pointer" }}>{label("归档", "アーカイブ", "Archive")}</button>
              <button onClick={async()=>{ await deleteProjectMemory(item.id); await refresh(); }} style={{ border:`1px solid ${T.border}`, background:T.surface, color:T.red, borderRadius:"7px", padding:"5px 8px", fontSize:"10.5px", cursor:"pointer" }}>{label("删除", "削除", "Delete")}</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
  return (
    <main className="nb-chat">
      <header className="nb-chat-header">
        <div style={{ display:"flex", alignItems:"center", gap:"12px", minWidth:0 }}>
          <button className="nb-menu-button" onClick={onMenu}>☰</button>
          <div>
            <div style={{ color:T.text, fontSize:"15px", fontWeight:900 }}>{t(lang, "knowledge")}</div>
            <div style={{ color:T.muted, fontSize:"11px", marginTop:"2px" }}>{label("项目大脑 · 本地 IndexedDB", "プロジェクト頭脳 · ローカル IndexedDB", "Project brain · local IndexedDB")}</div>
          </div>
        </div>
        <div style={{ display:"flex", gap:"8px", alignItems:"center" }}>
          <button className="nb-mobile-work-button" onClick={onWorkPanel}>{label("状态", "状態", "Status")}</button>
          <button onClick={exportAll} style={{ border:`1px solid ${T.border}`, background:T.card, color:T.text, borderRadius:"8px", padding:"7px 10px", fontSize:"11px", fontWeight:900, cursor:"pointer" }}>{label("导出", "エクスポート", "Export")}</button>
          <button onClick={()=>importRef.current?.click()} style={{ border:`1px solid ${T.border}`, background:T.card, color:T.text, borderRadius:"8px", padding:"7px 10px", fontSize:"11px", fontWeight:900, cursor:"pointer" }}>{label("导入", "インポート", "Import")}</button>
          <input ref={importRef} type="file" accept="application/json" style={{ display:"none" }} onChange={e=>importAll(e.target.files?.[0]).catch(error=>setMessage(error.message))} />
        </div>
      </header>
      <section className="nb-message-list">
        {message && <div style={{ color:T.green, background:"#10b98115", border:"1px solid #10b98130", borderRadius:"10px", padding:"10px 12px", fontSize:"12px" }}>{message}</div>}
        <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(150px,1fr))", gap:"10px" }}>
          {[
            [label("候选文档", "候補文書", "Candidate docs"), stats?.candidateDocuments || 0],
            [label("已批准文档", "承認済み文書", "Approved docs"), stats?.approvedDocuments || 0],
            [label("分块", "チャンク", "Chunks"), stats?.documentChunks || 0],
            [label("短期记忆", "短期記憶", "Short-term"), stats?.shortTermMemories || 0],
            [label("待确认", "候補", "Candidates"), stats?.candidateMemories || 0],
            [label("长期记忆", "承認済み", "Approved"), stats?.approvedMemories || 0],
            [label("已归档", "アーカイブ", "Archived"), stats?.archivedMemories || 0],
            [label("存储", "保存容量", "Storage"), usageText],
          ].map(([name, value]) => (
            <div key={name} style={{ background:T.surface, border:`1px solid ${T.border}`, borderRadius:"10px", padding:"12px" }}>
              <div style={{ color:T.muted, fontSize:"10.5px", fontWeight:800 }}>{name}</div>
              <div style={{ color:T.text, fontSize:"15px", fontWeight:900, marginTop:"5px" }}>{value}</div>
            </div>
          ))}
        </div>
        <div style={{ display:"grid", gridTemplateColumns:"minmax(0,1fr) minmax(0,1fr)", gap:"14px" }}>
          <div style={{ background:T.surface, border:`1px solid ${T.border}`, borderRadius:"12px", padding:"14px" }}>
            <div style={{ color:T.text, fontSize:"13px", fontWeight:900, marginBottom:"10px" }}>{label("文档库", "文書庫", "Documents")}（{docs.length}）</div>
            <div style={{ display:"flex", flexDirection:"column", gap:"8px" }}>
              {docs.map(doc => (
                <div key={doc.id} style={{ border:`1px solid ${T.border}`, background:T.card, borderRadius:"9px", padding:"10px" }}>
                  <div style={{ color:T.text, fontSize:"12px", fontWeight:900, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{doc.title}</div>
                  <div style={{ color:T.muted, fontSize:"10.5px", marginTop:"4px" }}>{doc.chunks} chunks · {doc.size} chars · {doc.source} · {doc.status}</div>
                  <div style={{ display:"flex", gap:"6px", marginTop:"8px", flexWrap:"wrap" }}>
                    {doc.status !== "approved" && <button onClick={async()=>{ await updateKnowledgeDocument(doc.id, { status:"approved", archived:false }); await refresh(); }} style={{ border:`1px solid ${T.border}`, background:T.surface, color:T.green, borderRadius:"7px", padding:"5px 8px", fontSize:"10.5px", cursor:"pointer" }}>{label("批准入上下文", "承認", "Approve")}</button>}
                    <button onClick={async()=>{ await updateKnowledgeDocument(doc.id, { status:"archived", archived:true }); await refresh(); }} style={{ border:`1px solid ${T.border}`, background:T.surface, color:T.muted, borderRadius:"7px", padding:"5px 8px", fontSize:"10.5px", cursor:"pointer" }}>{label("归档", "アーカイブ", "Archive")}</button>
                    <button onClick={async()=>{ await deleteKnowledgeDocument(doc.id); await refresh(); }} style={{ border:`1px solid ${T.border}`, background:T.surface, color:T.red, borderRadius:"7px", padding:"5px 8px", fontSize:"10.5px", cursor:"pointer" }}>{label("删除", "削除", "Delete")}</button>
                  </div>
                </div>
              ))}
              {!docs.length && <div style={{ color:T.faint, fontSize:"12px" }}>{label("上传附件后会先作为候选文档存入本地 IndexedDB；批准或发送时，相关正文可能进入当前模型提供商。", "添付は候補文書としてローカル IndexedDB に保存されます。承認または送信時に、関連本文が現在のモデル提供元へ送信されることがあります。", "Uploaded attachments are stored as candidate documents in local IndexedDB; approved or submitted content may be sent to the current model provider.")}</div>}
            </div>
          </div>
          <div style={{ background:T.surface, border:`1px solid ${T.border}`, borderRadius:"12px", padding:"14px" }}>
            <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:"8px", marginBottom:"10px", flexWrap:"wrap" }}>
              <div style={{ color:T.text, fontSize:"13px", fontWeight:900 }}>{label("记忆治理", "記憶ガバナンス", "Memory governance")}（{visibleMemories.length}/{memories.length}）</div>
              <button type="button" onClick={()=>setConflictsOnly(v=>!v)} style={{ border:`1px solid ${conflictsOnly ? T.red : T.border}`, background:conflictsOnly ? "#ef444415" : T.card, color:conflictsOnly ? T.red : T.muted, borderRadius:"999px", padding:"6px 9px", fontSize:"10.5px", fontWeight:900, cursor:"pointer", whiteSpace:"nowrap" }}>{conflictsOnly ? label("显示全部", "すべて表示", "Show all") : label(`仅看冲突 ${conflictCount}`, `競合のみ ${conflictCount}`, `Conflicts ${conflictCount}`)}</button>
            </div>
            <div style={{ color:T.muted, fontSize:"11.5px", lineHeight:1.55, marginBottom:"10px" }}>{label("普通对话进入短期记忆 7 天；明确“记住/这是规则/确定采用”等会自动进入长期记忆；AI 自动总结的决策、风险、规则进入待确认。", "通常会話は7日間の短期記憶です。明示的な記憶指示は長期記憶になり、AIの自動要約は候補になります。", "Normal conversations become 7-day short-term memory. Explicit memory instructions become approved long-term memory. AI summaries become candidates.")}</div>
            <div style={{ display:"grid", gridTemplateColumns:"110px 1fr", gap:"8px", marginBottom:"8px" }}>
              <select value={note.type} onChange={e=>setNote(v=>({...v,type:e.target.value}))} style={{ border:`1px solid ${T.border}`, background:T.card, color:T.text, borderRadius:"8px", padding:"8px" }}>
                <option value="decision">{label("决策", "決定", "Decision")}</option>
                <option value="fact">{label("事实", "事実", "Fact")}</option>
                <option value="risk">{label("风险", "リスク", "Risk")}</option>
                <option value="rule">{label("规则", "規則", "Rule")}</option>
                <option value="note">{label("笔记", "メモ", "Note")}</option>
              </select>
              <input value={note.title} onChange={e=>setNote(v=>({...v,title:e.target.value}))} placeholder={label("标题", "タイトル", "Title")} style={{ border:`1px solid ${T.border}`, background:T.card, color:T.text, borderRadius:"8px", padding:"8px" }} />
            </div>
            <textarea value={note.content} onChange={e=>setNote(v=>({...v,content:e.target.value}))} placeholder={label("写入一条长期记忆，例如产品决策、项目规则、风险。", "長期記憶を入力してください。", "Add a long-term memory.")} style={{ width:"100%", minHeight:"86px", border:`1px solid ${T.border}`, background:T.card, color:T.text, borderRadius:"8px", padding:"9px", resize:"vertical" }} />
            <div style={{ display:"flex", gap:"8px", marginTop:"8px", flexWrap:"wrap" }}>
              <button onClick={addMemory} style={{ border:"none", background:T.blue, color:"#fff", borderRadius:"8px", padding:"8px 12px", fontSize:"12px", fontWeight:900, cursor:"pointer" }}>{label("加入已批准记忆", "承認済みに追加", "Add approved")}</button>
              <button onClick={async()=>{ const count = await enforceMemoryRetention(); setMessage(label(`已按 TTL/容量归档 ${count} 条短期或待确认记忆。`, `${count} 件の短期/候補記憶を TTL/容量ルールでアーカイブしました。`, `Archived ${count} short-term/candidate memories by TTL/capacity rules.`)); await refresh(); }} style={{ border:`1px solid ${T.border}`, background:T.card, color:T.muted, borderRadius:"8px", padding:"8px 12px", fontSize:"12px", fontWeight:900, cursor:"pointer" }}>{label("执行 TTL/容量清理", "TTL/容量整理", "Run TTL/cap cleanup")}</button>
              <button onClick={async()=>{ const count = await archiveLowValueMemories(); setMessage(label(`已归档 ${count} 条低价值候选记忆。`, `${count} 件の低価値候補記憶をアーカイブしました。`, `Archived ${count} low-value candidate memories.`)); await refresh(); }} style={{ border:`1px solid ${T.border}`, background:T.card, color:T.muted, borderRadius:"8px", padding:"8px 12px", fontSize:"12px", fontWeight:900, cursor:"pointer" }}>{label("归档低价值候选", "低価値候補を整理", "Archive low-value candidates")}</button>
              {!!conflictCount && <button onClick={bulkReviewConflicts} style={{ border:`1px solid ${T.red}40`, background:"#ef444415", color:T.red, borderRadius:"8px", padding:"8px 12px", fontSize:"12px", fontWeight:900, cursor:"pointer" }}>{label("批量确认冲突", "競合を一括確認", "Review conflicts")}</button>}
            </div>
            {renderMemoryGroup(label("长期记忆", "長期記憶", "Long-term memory"), approvedMemories, "approved")}
            {renderMemoryGroup(label("短期记忆", "短期記憶", "Short-term memory"), shortTermMemories, "short_term")}
            {renderMemoryGroup(label("待确认记忆", "候補記憶", "Candidate memory"), candidateMemories, "candidate")}
          </div>
        </div>
        <div style={{ background:T.surface, border:`1px solid ${T.border}`, borderRadius:"12px", padding:"14px" }}>
          <div style={{ color:T.text, fontSize:"13px", fontWeight:900, marginBottom:"10px" }}>{label("搜索知识库", "知識庫検索", "Search knowledge")}</div>
          <div style={{ display:"flex", gap:"8px" }}>
            <input value={query} onChange={e=>setQuery(e.target.value)} onKeyDown={e=>e.key==="Enter"&&runSearch()} placeholder={label("输入关键词", "キーワード", "Keyword")} style={{ flex:1, border:`1px solid ${T.border}`, background:T.card, color:T.text, borderRadius:"8px", padding:"9px" }} />
            <button onClick={runSearch} style={{ border:"none", background:T.green, color:"#fff", borderRadius:"8px", padding:"8px 12px", fontSize:"12px", fontWeight:900, cursor:"pointer" }}>{label("搜索", "検索", "Search")}</button>
          </div>
          <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(260px,1fr))", gap:"8px", marginTop:"12px" }}>
            {hits.map(hit => (
              <div key={hit.id} style={{ border:`1px solid ${T.border}`, background:T.card, borderRadius:"9px", padding:"10px" }}>
                <div style={{ color:T.text, fontSize:"12px", fontWeight:900 }}>{hit.title}</div>
                <div style={{ color:T.muted, fontSize:"10.5px", margin:"4px 0" }}>chunk {hit.index + 1} · score {hit.score}</div>
                <div style={{ color:T.text, fontSize:"11.5px", lineHeight:1.55 }}>{hit.content.slice(0, 260)}</div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}

function RightWorkPanel({ open, onToggle, title, subtitle, lang, workflow, onContinueWorkflow, onRetryWorkflow, onSkipWorkflow }) {
  if (!open) return null;
  return (
    <aside className={`nb-work-panel ${open ? "open" : "collapsed"}`}>
      <button className="nb-work-toggle" onClick={onToggle}>{open ? "›" : "‹"}</button>
      {open && <WorkPanelContent title={title} subtitle={subtitle} lang={lang} workflow={workflow} onContinueWorkflow={onContinueWorkflow} onRetryWorkflow={onRetryWorkflow} onSkipWorkflow={onSkipWorkflow} />}
    </aside>
  );
}

function MobileWorkDrawer({ open, onClose, title, subtitle, lang, workflow, onContinueWorkflow, onRetryWorkflow, onSkipWorkflow }) {
  if (!open) return null;
  return (
    <div className="nb-mobile-work-backdrop" onClick={onClose}>
      <div className="nb-mobile-work-drawer" onClick={e=>e.stopPropagation()}>
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"12px 14px", borderBottom:`1px solid ${T.border}` }}>
          <div style={{ color:T.text, fontSize:"14px", fontWeight:900 }}>{lang==="ja" ? "状態と成果物" : lang==="en" ? "Status and artifacts" : "状态与产物"}</div>
          <button onClick={onClose} style={{ border:`1px solid ${T.border}`, background:T.card, color:T.muted, borderRadius:"8px", width:"32px", height:"32px", cursor:"pointer" }}>×</button>
        </div>
        <WorkPanelContent title={title} subtitle={subtitle} lang={lang} workflow={workflow} onContinueWorkflow={onContinueWorkflow} onRetryWorkflow={onRetryWorkflow} onSkipWorkflow={onSkipWorkflow} />
      </div>
    </div>
  );
}

function sanitizeSettingsForStorage(values = {}) {
  return {
    ...values,
    apiKeys:{ anthropic:"", google:"" },
    claudeBridge:{
      enabled:false,
      url:values.claudeBridge?.url || "http://127.0.0.1:8787",
      token:"",
    },
    codexAdminToken:"",
  };
}

function mergeStoredSettings(current, stored = {}) {
  const safe = sanitizeSettingsForStorage(stored);
  return {
    ...current,
    ...safe,
    apiKeys:current.apiKeys || { anthropic:"", google:"" },
    claudeBridge:{
      ...(current.claudeBridge || { enabled:false, url:"http://127.0.0.1:8787", token:"" }),
      url:safe.claudeBridge?.url || current.claudeBridge?.url || "http://127.0.0.1:8787",
      enabled:false,
      token:"",
    },
    codexAdminToken:"",
    autoInjectKnowledge:!!safe.autoInjectKnowledge,
    localOnlyMode:!!safe.localOnlyMode,
  };
}

// ─── APP ──────────────────────────────────────────────────────────────────────
export default function App() {
  const [authChecked, setAuthChecked] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [members, setMembers] = useState(TEAM);
  const [selected, setSelected] = useState(TEAM[0]);
  const [activeGroup, setActiveGroup] = useState(null);
  const [activeInfo, setActiveInfo] = useState(null);
  const [activeSession, setActiveSession] = useState(null);
  const [activeKnowledge, setActiveKnowledge] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [rightPanelOpen, setRightPanelOpen] = useState(false);
  const [mobileWorkOpen, setMobileWorkOpen] = useState(false);
  const [settings, setSettings] = useState({ username:"Neural Bridge Owner", language:"auto", apiKeys:{ anthropic:"", google:"" }, autoInjectKnowledge:false, localOnlyMode:false, claudeBridge:{ enabled:false, url:"http://127.0.0.1:8787", token:"" }, codexAdminToken:"" });
  const [customOpen, setCustomOpen] = useState(false);
  const [customIds, setCustomIds] = useState(["aria", "cto", "fe"]);
  const [chatHistory, setChatHistory] = useState([]);
  const [draftPrompt, setDraftPrompt] = useState(null);
  const lang = effectiveLanguage(settings.language);
  const [workflowState, setWorkflowState] = useState(() => loadWorkflowState(lang));
  const conversations = chatHistory.map(session => ({
    ...session,
    subtitle:session.subtitle || (session.kind === "group" ? t(lang, "groupChat") : ""),
    text:session.preview || "",
  }));

  useEffect(() => {
    try {
      const savedSettings = localStorage.getItem("nb_settings");
      const savedMembers = localStorage.getItem("nb_members");
      if (savedSettings) {
        const parsedSettings = JSON.parse(savedSettings);
        const sanitizedSettings = sanitizeSettingsForStorage(parsedSettings);
        localStorage.setItem("nb_settings", JSON.stringify(sanitizedSettings));
        setSettings(v => mergeStoredSettings(v, sanitizedSettings));
      }
      else setSettings(v => ({ ...v, language: defaultLanguage() }));
      if (savedMembers) {
        const parsed = JSON.parse(savedMembers);
        setMembers(parsed);
        setSelected(parsed[0] || TEAM[0]);
      }
      setChatHistory(loadChatHistory());
    } catch {}
  }, []);

  useEffect(() => {
    saveWorkflowState(workflowState, lang);
  }, [workflowState, lang]);

  useEffect(() => {
    fetch("/api/auth/session")
      .then(r => r.json())
      .then(data => setAuthenticated(!!data.authenticated))
      .finally(() => setAuthChecked(true));
  }, []);

  if (!authChecked) {
    return <div style={{ minHeight:"100vh", background:T.bg }} />;
  }

  if (!authenticated) {
    return <AuthGate onAuthenticated={()=>setAuthenticated(true)} />;
  }

  const selectMember = (member) => {
    setActiveGroup(null);
    setActiveInfo(null);
    setActiveSession(null);
    setActiveKnowledge(false);
    setSelected(member);
    setSidebarOpen(false);
  };

  const selectGroup = (type) => {
    const groupMap = {
      core: { id:"group-core", name:t(lang, "coreGroup"), members:TEAM.filter(m=>m.layer===0 || m.layer===1) },
      exec: { id:"group-exec", name:t(lang, "execGroup"), members:members.filter(m=>m.layer===2) },
      biz: { id:"group-biz", name:t(lang, "bizGroup"), members:members.filter(m=>m.layer===3) },
      all: { id:"group-all", name:t(lang, "allGroup"), members },
    };
    groupMap.core.members = members.filter(m=>m.layer===0 || m.layer===1);
    setActiveGroup(groupMap[type]);
    setActiveInfo(null);
    setActiveSession(null);
    setActiveKnowledge(false);
    setSidebarOpen(false);
  };

  const saveSettings = (values) => {
    setSettings(values);
    localStorage.setItem("nb_settings", JSON.stringify(sanitizeSettingsForStorage(values)));
    setSettingsOpen(false);
  };

  const saveMembers = (values) => {
    setMembers(values);
    localStorage.setItem("nb_members", JSON.stringify(values));
    if (!values.find(m => m.id === selected.id)) setSelected(values[0] || TEAM[0]);
  };

  const clearLocalData = async () => {
    const message = lang === "ja"
      ? "この端末のチャット履歴、設定、メンバー設定、知識庫を削除します。続行しますか？"
      : lang === "en"
        ? "Clear chat history, settings, custom members, and the knowledge database on this device?"
        : "将清除本机聊天历史、设置、自定义成员和知识库。是否继续？";
    if (!window.confirm(message)) return;
    localStorage.removeItem(CHAT_HISTORY_KEY);
    localStorage.removeItem("nb_settings");
    localStorage.removeItem("nb_members");
    clearWorkflowState();
    await deleteKnowledgeDb().catch(() => {});
    await deleteWorkflowArchive().catch(() => {});
    setChatHistory([]);
    setMembers(TEAM);
    setSelected(TEAM[0]);
    setActiveGroup(null);
    setActiveInfo(null);
    setActiveSession(null);
    setActiveKnowledge(false);
    setWorkflowState(emptyWorkflowState(lang));
    setSettings({ username:"Neural Bridge Owner", language:"auto", apiKeys:{ anthropic:"", google:"" }, autoInjectKnowledge:false, localOnlyMode:false, claudeBridge:{ enabled:false, url:"http://127.0.0.1:8787", token:"" }, codexAdminToken:"" });
    setSettingsOpen(false);
  };

  const startCustomGroup = () => {
    const selectedMembers = members.filter(m => customIds.includes(m.id));
    setActiveGroup({ id:`group-custom-${customIds.join("-")}`, name:t(lang, "customGroup"), members:selectedMembers });
    setActiveInfo(null);
    setActiveSession(null);
    setActiveKnowledge(false);
    setCustomOpen(false);
    setSidebarOpen(false);
  };

  const selectInfo = (item) => {
    if (item.kind === "member") {
      const member = members.find(m => m.id === item.targetId);
      if (member) {
        setActiveGroup(null);
        setActiveInfo(null);
        setActiveKnowledge(false);
        setSelected(member);
        setActiveSession(item);
        setSidebarOpen(false);
        return;
      }
    }
    if (item.kind === "group" && item.group) {
      setActiveGroup(item.group);
      setActiveInfo(null);
      setActiveSession(item);
      setActiveKnowledge(false);
      setSidebarOpen(false);
      return;
    }
    setActiveInfo(item);
    setActiveGroup(null);
    setActiveSession(null);
    setActiveKnowledge(false);
    setSidebarOpen(false);
  };
  const openKnowledge = () => {
    setActiveKnowledge(true);
    setActiveInfo(null);
    setActiveGroup(null);
    setActiveSession(null);
    setSidebarOpen(false);
  };
  const panelTitle = activeKnowledge ? t(lang, "knowledge") : activeInfo?.title || activeGroup?.name || selected.name;
  const panelSubtitle = activeKnowledge ? "IndexedDB" : activeInfo?.subtitle || (activeGroup ? `${activeGroup.members.length} ${t(lang, "members")}` : selected.title);
  const apiConfig = { ...(settings.apiKeys || {}), autoInjectKnowledge:!!settings.autoInjectKnowledge && !settings.localOnlyMode, localOnlyMode:!!settings.localOnlyMode, claudeBridge: settings.claudeBridge || {}, codexAdminToken:settings.codexAdminToken || "" };
  const updateChatSession = (session) => {
    setChatHistory(current => {
      const next = [session, ...current.filter(item => item.id !== session.id)]
        .sort((a, b) => Date.parse(b.updatedAt || "") - Date.parse(a.updatedAt || ""))
        .slice(0, CHAT_HISTORY_LIMIT);
      saveChatHistory(next);
      return next;
    });
  };
  const openWorkPanel = () => {
    if (window.matchMedia?.("(max-width:1024px), (pointer:coarse)")?.matches) {
      setMobileWorkOpen(true);
      return;
    }
    setRightPanelOpen(true);
  };
  const continueWorkflow = (text) => {
    const aria = members.find(member => member.id === "aria") || TEAM[0];
    setSelected(aria);
    setActiveGroup(null);
    setActiveInfo(null);
    setActiveSession(null);
    setActiveKnowledge(false);
    setMobileWorkOpen(false);
    setSidebarOpen(false);
    setDraftPrompt({ targetId:aria.id, text, nonce:Date.now() });
  };
  const retryWorkflow = (text) => {
    continueWorkflow(text);
    setRightPanelOpen(false);
  };
  const skipWorkflow = (text) => {
    continueWorkflow(text);
    setRightPanelOpen(false);
  };

  return (
    <div className="nb-app-root" style={{ fontFamily:"'Noto Sans SC','PingFang SC','Microsoft YaHei',sans-serif", background:T.bg, minHeight:"100vh", color:T.text }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@400;500;700;800;900&display=swap');
        *{box-sizing:border-box;margin:0;padding:0;}
        ::-webkit-scrollbar{width:4px;}
        ::-webkit-scrollbar-thumb{background:#ccc;border-radius:4px;}
        @keyframes nb-pulse{0%,100%{opacity:0.3;transform:scale(0.8);}50%{opacity:1;transform:scale(1);}}
        .nb-app-root{height:100dvh;overflow:hidden;}
        .nb-shell{height:100%;display:grid;grid-template-columns:310px minmax(0,1fr) 280px;background:${T.bg};overflow:hidden;}
        .nb-shell.panel-collapsed{grid-template-columns:310px minmax(0,1fr);}
        .nb-sidebar{display:flex;flex-direction:column;background:${T.surface};border-right:1px solid ${T.border};min-height:0;}
        .nb-chat{display:grid;grid-template-rows:auto minmax(0,1fr) auto auto auto;min-width:0;min-height:0;}
        .nb-work-panel{background:${T.surface};border-left:1px solid ${T.border};min-width:0;min-height:0;height:100%;position:relative;display:flex;flex-direction:column;overflow:hidden;}
        .nb-work-panel-body{padding:16px 14px;overflow-y:auto;min-height:0;flex:1;overscroll-behavior:contain;}
        .nb-work-toggle{position:absolute;left:8px;top:12px;width:28px;height:28px;border:1px solid ${T.border};background:${T.card};color:${T.muted};border-radius:8px;font-size:20px;line-height:1;cursor:pointer;z-index:2;}
        .nb-work-panel.open .nb-work-toggle{left:auto;right:10px;}
        .nb-work-panel.collapsed{align-items:center;background:${T.card};}
        .nb-mobile-work-button{display:block;border:1px solid ${T.border};background:${T.card};color:${T.text};border-radius:8px;padding:5px 9px;font-size:10.5px;font-weight:900;cursor:pointer;}
        .nb-mobile-work-backdrop{display:none;}
        .nb-chat-header{height:68px;background:${T.surface};border-bottom:1px solid ${T.border};display:flex;align-items:center;justify-content:space-between;padding:0 22px;gap:12px;}
        .nb-menu-button{display:none;border:1px solid ${T.border};background:${T.card};color:${T.text};border-radius:9px;width:36px;height:36px;font-size:17px;cursor:pointer;flex-shrink:0;}
        .nb-message-list{overflow-y:auto;padding:22px;display:flex;flex-direction:column;gap:14px;}
        .nb-quick{display:flex;gap:8px;flex-wrap:wrap;padding:0 22px 12px;}
        .nb-quick button{border:1px solid ${T.border};background:${T.surface};color:${T.muted};border-radius:9px;padding:8px 12px;font-size:12px;cursor:pointer;}
        .nb-composer{display:flex;gap:10px;padding:14px 22px 18px;background:${T.surface};border-top:1px solid ${T.border};align-items:center;flex-wrap:wrap;}
        .nb-composer input{flex:1;border:1px solid ${T.border};background:${T.card};color:${T.text};border-radius:12px;padding:12px 15px;font-size:13.5px;outline:none;}
        .nb-composer button{width:44px;border:none;border-radius:12px;background:${T.blue};color:#fff;font-size:18px;cursor:pointer;}
        .nb-composer button:disabled{background:${T.faint};cursor:default;}
        .nb-stop-button{background:${T.red}!important;color:#fff!important;font-size:13px!important;font-weight:900!important;}
        .nb-stop-button:hover{filter:brightness(.96);}
        .nb-attach-button{width:42px!important;height:42px!important;border:1px solid ${T.border}!important;background:${T.card}!important;color:${T.muted}!important;border-radius:12px!important;font-size:22px!important;line-height:1!important;font-weight:500!important;display:flex;align-items:center;justify-content:center;flex-shrink:0;}
        .nb-attach-button:hover{background:${T.surface}!important;color:${T.blue}!important;border-color:${T.blue}55!important;}
        .nb-voice-button{width:42px!important;height:42px!important;border:1px solid ${T.border}!important;background:${T.card}!important;color:${T.muted}!important;border-radius:12px!important;font-size:18px!important;line-height:1!important;font-weight:900!important;display:flex;align-items:center;justify-content:center;flex-shrink:0;}
        .nb-voice-button:hover,.nb-voice-button.listening{background:${T.surface}!important;color:${T.orange}!important;border-color:${T.orange}55!important;}
        .nb-attachment-list{width:100%;display:flex;gap:6px;flex-wrap:wrap;order:-1;}
        .nb-attachment-list button{width:auto!important;max-width:220px;height:auto!important;display:flex;align-items:center;gap:6px;border:1px solid ${T.border}!important;background:${T.card}!important;color:${T.text}!important;border-radius:8px!important;padding:5px 8px!important;font-size:11px!important;}
        .nb-attachment-list span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
        .nb-attachment-list small{color:${T.muted};font-size:10px;white-space:nowrap;}
        .nb-chat-controls{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;padding:0 22px 14px;background:${T.surface};border-top:1px solid ${T.border};}
        .nb-chat-controls label{display:flex;align-items:center;gap:6px;min-width:0;}
        .nb-chat-controls span{color:${T.muted};font-size:10.5px;font-weight:800;white-space:nowrap;}
        .nb-chat-controls select{min-width:0;width:100%;border:1px solid ${T.border};background:${T.card};color:${T.text};border-radius:8px;padding:7px 8px;font-size:11.5px;outline:none;}
        .nb-sidebar-backdrop{display:none;}
        .nb-side-action{border:1px solid ${T.border};background:${T.card};border-radius:8px;padding:7px;font-size:11px;font-weight:800;cursor:pointer;}
        .nb-main-row{width:100%;display:flex;align-items:center;border:1px solid transparent;background:transparent;border-radius:10px;padding:10px 12px;cursor:pointer;text-align:left;}
        .nb-main-row span{font-size:13px;font-weight:900;}
        .nb-main-row:hover,.nb-back-row:hover{background:${T.surface};border-color:${T.blue}55;}
        .nb-back-row{width:100%;border:1px solid ${T.border};background:${T.card};color:${T.muted};border-radius:9px;padding:8px 10px;margin-bottom:8px;font-size:12px;font-weight:800;cursor:pointer;text-align:left;}
        .nb-chat-title-row{width:100%;display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px;align-items:center;border:1px solid transparent;background:transparent;color:${T.text};border-radius:10px;padding:9px 10px;cursor:pointer;text-align:left;}
        .nb-chat-title-row:hover{background:${T.card};border-color:${T.border};}
        .nb-chat-title-row span{font-size:12.5px;font-weight:800;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
        .nb-chat-title-row small{font-size:10px;color:${T.muted};white-space:nowrap;}
        .nb-nav-row{width:100%;display:flex;flex-direction:column;align-items:flex-start;gap:2px;border:1px solid transparent;background:transparent;color:${T.text};border-radius:9px;padding:8px 10px;cursor:pointer;text-align:left;}
        .nb-nav-row:hover{background:${T.card};border-color:${T.border};}
        .nb-nav-row span{font-size:12px;font-weight:800;}
        .nb-nav-row small{font-size:10px;color:${T.muted};}
        @media(max-width:1024px), (pointer:coarse){
          html,body{height:100%;overflow:hidden;}
          .nb-app-root{height:100dvh;overflow:hidden;}
          .nb-shell{grid-template-columns:1fr;height:100%;}
          .nb-shell.panel-collapsed{grid-template-columns:1fr;}
          .nb-work-panel{display:none;}
          .nb-mobile-work-button{display:block;}
          .nb-mobile-work-backdrop{display:block;position:fixed;inset:0;background:rgba(0,0,0,.34);z-index:900;}
          .nb-mobile-work-drawer{position:absolute;left:0;right:0;bottom:0;max-height:72dvh;background:${T.surface};border-radius:16px 16px 0 0;border-top:1px solid ${T.border};box-shadow:0 -18px 45px rgba(0,0,0,.18);overflow:hidden;}
          .nb-mobile-work-drawer .nb-work-panel-body{max-height:calc(72dvh - 57px);overflow-y:auto;padding:12px;}
          .nb-chat{grid-template-rows:auto minmax(0,1fr) auto auto auto;height:100%;max-height:100%;}
          .nb-menu-button{display:flex;align-items:center;justify-content:center;}
          .nb-sidebar{position:fixed;left:-316px;top:0;bottom:0;width:306px;z-index:800;border-right:1px solid ${T.border};box-shadow:0 18px 50px rgba(0,0,0,0.24);transition:left .2s ease;}
          .nb-sidebar.open{left:0;}
          .nb-sidebar-backdrop{display:block;position:fixed;inset:0;background:rgba(0,0,0,.38);z-index:750;}
          .nb-chat-header{height:auto;min-height:52px;padding:8px 12px;}
          .nb-chat-header [style*="width:42px"]{width:34px!important;height:34px!important;font-size:15px!important;}
          .nb-message-list{padding:12px;gap:10px;}
          .nb-message-list [style*="max-width"]{max-width:min(720px,86%)!important;padding:10px 12px!important;font-size:13px!important;line-height:1.65!important;}
          .nb-quick{padding:0 12px 8px;gap:6px;}
          .nb-quick button{padding:7px 10px;font-size:11.5px;border-radius:8px;}
          .nb-composer{padding:10px 12px 12px;gap:8px;}
          .nb-composer input{padding:10px 12px;border-radius:11px;font-size:13px;}
          .nb-composer button{width:42px;height:42px;border-radius:11px;}
          .nb-attach-button{width:40px!important;height:40px!important;font-size:20px!important;}
          .nb-voice-button{width:40px!important;height:40px!important;font-size:17px!important;}
          .nb-attachment-list button{max-width:150px;}
          .nb-chat-controls{grid-template-columns:1fr 1fr 1fr;padding:0 12px 10px;gap:6px;}
          .nb-chat-controls label{flex-direction:column;align-items:flex-start;gap:3px;}
          .nb-chat-controls span{font-size:9.5px;}
          .nb-chat-controls select{font-size:10.5px;padding:6px 5px;}
          .nb-chat-header>div:last-child{gap:6px;}
          .nb-chat-header>div:last-child span{font-size:9px;padding:4px 7px;}
          .nb-message-list{min-height:0;}
          .nb-composer input{min-width:0;}
          .nb-member-edit-row{grid-template-columns:1fr!important;}
          .nb-member-edit-row input,.nb-member-edit-row select,.nb-member-edit-row button{width:100%;}
          .nb-settings-dialog{max-height:calc(100dvh - 24px)!important;}
        }
      `}</style>
      <div className={`nb-shell ${rightPanelOpen ? "" : "panel-collapsed"}`}>
        {sidebarOpen && <div className="nb-sidebar-backdrop" onClick={()=>setSidebarOpen(false)} />}
        <TeamSidebar selectedId={activeKnowledge ? "knowledge" : activeGroup?.id || activeInfo?.id || selected.id} onSelect={selectMember} onGroup={selectGroup} onSettings={()=>setSettingsOpen(true)} open={sidebarOpen} onClose={()=>setSidebarOpen(false)} onCustomGroup={()=>setCustomOpen(true)} onKnowledge={openKnowledge} members={members} projects={PROJECTS} automations={AUTOMATION_TASKS} conversations={conversations} onConversation={selectInfo} lang={lang} />
        {activeKnowledge
          ? <KnowledgePanel onMenu={()=>setSidebarOpen(true)} onWorkPanel={openWorkPanel} lang={lang} />
          : activeInfo
          ? <InfoPanel item={activeInfo} onMenu={()=>setSidebarOpen(true)} onWorkPanel={openWorkPanel} lang={lang} />
          : activeGroup
            ? <GroupChat key={activeGroup.id} group={activeGroup} apiKeys={apiConfig} onMenu={()=>setSidebarOpen(true)} onWorkPanel={openWorkPanel} onSessionUpdate={updateChatSession} activeSession={activeSession} lang={lang} onWorkflowState={setWorkflowState} />
            : <WorkspaceChat key={selected.id} member={selected} apiKeys={apiConfig} onMenu={()=>setSidebarOpen(true)} onWorkPanel={openWorkPanel} onSessionUpdate={updateChatSession} activeSession={activeSession} lang={lang} allMembers={members} onWorkflowState={setWorkflowState} draftPrompt={draftPrompt} />}
        <RightWorkPanel open={rightPanelOpen} onToggle={()=>setRightPanelOpen(v=>!v)} title={panelTitle} subtitle={panelSubtitle} lang={lang} workflow={workflowState} onContinueWorkflow={continueWorkflow} onRetryWorkflow={retryWorkflow} onSkipWorkflow={skipWorkflow} />
      </div>
      <MobileWorkDrawer open={mobileWorkOpen} onClose={()=>setMobileWorkOpen(false)} title={panelTitle} subtitle={panelSubtitle} lang={lang} workflow={workflowState} onContinueWorkflow={continueWorkflow} onRetryWorkflow={retryWorkflow} onSkipWorkflow={skipWorkflow} />
      <AppSettings open={settingsOpen} settings={settings} members={members} onSave={saveSettings} onMembersSave={saveMembers} onClearLocalData={clearLocalData} onClose={()=>setSettingsOpen(false)} lang={lang} />
      <CustomGroupModal open={customOpen} members={members} selectedIds={customIds} onChange={setCustomIds} onStart={startCustomGroup} onClose={()=>setCustomOpen(false)} lang={lang} />
    </div>
  );
}
