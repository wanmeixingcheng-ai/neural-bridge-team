# PROJECT_CONSTRAINTS.md
# Neural Bridge — 不動産 AI Knowledge Brain
# v2.2-final | 2026-06-07

> 本文件为 Neural Bridge 项目专属约束文件。
> 所有 AI（Codex / Claude）必须在实现任何功能前先读取本文件。
> 本文件为 Protected File，禁止 AI 自行修改。

---

## 1. 项目基本信息

```text
项目名称：Neural Bridge 不動産 AI Knowledge Brain
仓库地址：wanmeixingcheng-ai/neural-bridge-real-estate-ai
技术栈：Next.js / React / TypeScript / IndexedDB(Dexie.js) /
        PostgreSQL(pgvector) / Supabase Auth / Vercel / GitHub Actions
主要用户：日本中小不动产会社の営業・管理・オーナー対応担当
```

---

## 2. AI 权限边界

### AI 可以做
```text
- 读取仓库源码
- 创建 feature branch
- 创建 PR
- 评论 Issue / PR
- 修复 Low / Medium Risk 任务（需 approved-for-codex 标签）
```

### AI 不可以做
```text
- 合并 PR
- 推送 main / master
- 读取或修改生产数据
- 修改 GitHub Secrets
- 修改生产部署配置
- 输出 secret / token / password 真实值
- 修改任何 Protected File（见第 11 节）
```

---

## 3. 套餐分层与数据使用政策

### 授权方式
```text
注册时通过服务条款一次性同意，后续无任何弹窗或确认步骤。
与 Claude・ChatGPT・GitHub Copilot 等主流 AI 产品标准做法一致。
```

### 免费层（Free）
```text
- AI 功能全部可用，有使用量上限
- 使用行为数据 + 脱敏后的生成物 → 用于改进 Neural Bridge Knowledge Brain
- 原始客户个人信息经默认脱敏处理后方可用于训练
- 服务条款明示：用户对确保其客户知情负有责任
- 脱敏规则：系统默认规则（姓名/電話/メール/住所替换为占位符）
- 不可自定义脱敏字段
```

### 付费层（Pro / Business）
```text
- AI 功能全部可用，使用量更高或无限
- 数据默认完全私密，不用于任何训练
- 可在 Settings > 隐私 > 数据贡献 中自愿选择贡献脱敏数据（默认关闭）
- 脱敏规则：支持自定义字段规则
- 本地 IndexedDB 数据完全私密，不受套餐影响
```

### 两个层级共同规则
```text
- 注册时一次性同意，后续无弹窗
- 脱敏开关均在 Settings > 隐私 中配置，一次设置永久生效
- 用户业务数据默认只存本地 IndexedDB
- API Key 只存后端，不暴露给浏览器
```

---

## 4. 数据存储边界

| 数据类别 | 保存位置 | 免费层 | 付费层 |
|---|---|---|---|
| 用户账号 / 认证 | Supabase Auth（后端） | 上云 | 上云 |
| Knowledge Brain 知识库 | PostgreSQL 后端 | 上云（行业知识） | 上云 |
| **用户业务输入** | **IndexedDB（本地）** | **脱敏后用于训练** | **默认私密** |
| **用户生成物** | **IndexedDB（本地）** | **脱敏后用于训练** | **默认私密** |
| **Daily Review 原始数据** | **IndexedDB（本地）** | **脱敏后用于训练** | **默认私密** |
| 使用行为日志 | 后端 / 分析系统 | 用于训练 | 用于产品改进（匿名） |

### 绝对禁止
```text
- 未经脱敏直接上传客户原始个人信息用于训练
- 用户业务数据自动写入全局 Knowledge Brain
- API Key 暴露给浏览器或出现在 Git 中
- 工具绕过 Knowledge Brain 直接调用大模型
```

---

## 5. Knowledge Brain 调用规则

```text
- 所有工具（M1–M10）必须通过 Knowledge Brain 调用知识
- 禁止工具 hardcode Prompt 直接调用大模型
- 只有 review_status = "approved" 的知识单元才可被正式 Agent 调用
- high / critical 风险知识必须专家或内部审核才可 approved
- 用户业务数据禁止自动写入全局 Knowledge Brain
```

---

## 6. Policy Engine 强制规则（P001–P011）

```text
P001 任何输出         → 来源标注；禁止编造未检索事实
P002 価格・市場価値   → 用户提供来源 + 要確認；禁止 AI 生成市场价
P003 契約・重要事項   → 免责声明 + 要確認 + 建议宅建士；禁止最终法律判断
P004 税務・贈与・相続 → 免责声明 + 建议税理士；禁止税额或节税最终结论
P005 ローン・審査     → 免责声明 + 建议金融機関/FP；禁止贷款可否最终判断
P006 建築構造・耐震   → 建议建筑士 + 要確認；禁止断定安全性
P007 ハザード・災害   → 数据来源 + 检查日期 + 要確認；禁止断定安全/无风险
P008 風水診断         → 文化性免责声明；禁止作科学结论或断定资产价值
P009 施工見積・工事費 → 标注为相场目安；禁止作正式报价
P010 学区・周辺・交通 → 数据来源 + 检查日期 + 要確認；禁止无来源断定
P011 外国人客户説明   → 多语言免责声明；建议专业翻译确认重要条款
```

---

## 7. Epic 编号（E0–E14）

```text
E0  Knowledge Brain Architecture         ← 已完成
E1  Knowledge Schema & Source Registry
E2  Ingestion Pipeline
E3  Knowledge Review Console
E4  Vector / Hybrid Retriever
E5  Policy Engine
E6  Cost / Model Router
E7  Agent Runtime
E8  Template Engine
E9  M1–M10 Tool Integration
E10 Privacy / Local Data / Handoff
E11 Daily Review Agent
E12 Eval System
E13 Commercial Knowledge Expansion
E14 UI Layer
```

### Phase → Epic 対応

```text
Phase 0  总设计           → E0  ← 已完成
Phase 1  Knowledge v0.1   → E1 + E5 + E8
Phase 2  开发验证知识库    → E2 + E3
Phase 3  Retriever+Router  → E4 + E6
Phase 4  Agent Brain       → E7 + E10
Phase 5  工具接入          → E9
Phase 6  Daily Review + UI → E11 + E14
Phase 7  v0.5 内测         → E12 + E13（启动）
Phase 8  v1.0 商业冷启动   → E13（扩展）
```

---

## 8. Output Builder 输出规范

```json
{
  "answer_body":         "主回答内容",
  "sources":             ["来源ID / 来源名称 / 检查日期"],
  "kakunin_items":       ["用户未提供或 AI 无法确认的事项"],
  "disclaimer":          "免责声明（高风险场景必须）",
  "model_used":          "template_only | knowledge_only | small_model | large_model",
  "knowledge_ids_cited": ["NB-KB-000001"],
  "risk_level":          "low | medium | high | critical"
}
```

---

## 9. handoff_packages 数据结构

```json
{
  "package_id":           "HO-YYYYMMDD-001",
  "created_at":           "YYYY-MM-DD",
  "source_session_ids":   [],
  "summary":              "引き継ぎ概要",
  "open_kakunin_items":   [],
  "risk_residuals":       [],
  "next_actions":         [],
  "target_agent_or_tool": "M5 | 文書リスク Agent | ...",
  "status":               "pending | accepted | completed"
}
```

---

## 10. Daily Review IndexedDB Stores

```text
daily_activity_logs:
  event_id, date, module, action_type, entity_ref, risk_flag, created_at

daily_reviews:
  review_id, date, summary, completed_tasks, unfinished_tasks,
  kakunin_items, risk_items, tomorrow_priorities,
  model_used, cost_tier, kakunin_count, risk_item_count, created_at

review_preferences:
  enabled, workday_end_time, language, include_conversations,
  include_artifacts, allow_cloud_ai, default_redaction, model_preference

review_action_items:
  action_id, review_id, title, priority, due_date, status,
  related_task_id, assigned_to_agent, created_from_risk
```

---

## 11. Protected Files（禁止 AI 修改）

```text
- AGENTS.md
- CLAUDE.md
- AI_WORKFLOW.md
- PROJECT_CONSTRAINTS.md        ← 本文件
- AUTOMATION_POLICY.md
- CI_REPAIR_POLICY.md
- RISK_LEVELS.md
- DEVELOPMENT_RULES.md
- KNOWLEDGE_BRAIN_STRATEGY.md
- .github/workflows/
- .github/PULL_REQUEST_TEMPLATE.md
- .github/ISSUE_TEMPLATE/
```

---

## 12. High Risk 自动判定

```text
以下修改必须标记 risk:high：
- Auth / 登录 / 权限
- 数据库 schema
- 套餐分层逻辑 / 数据使用政策变更
- 服务条款 / 隐私政策内容变更
- 脱敏逻辑变更
- Policy Engine 规则变更
- Agent System Prompt 变更
- Knowledge Unit review_status 流转逻辑
- CI/CD 配置 / Secrets / API Key 管理
- 外部服务接入 / 生产部署
```

---

## 13. 最高原则

```text
1. 用户业务数据默认只在本地 IndexedDB
   免费层：脱敏后可用于训练（服务条款已告知）
   付费层：默认完全私密

2. 注册时一次性服务条款同意，后续无弹窗
   与 Claude・ChatGPT・GitHub Copilot 标准做法一致

3. Knowledge Brain 只接收来源明确 + 许可明确 + 审核通过的知识

4. AI 不得编造价格・面积・交通時間・学区・周辺施設・合同结论・正式査定结论

5. 高风险输出必须附带免责声明和要確認

6. API Key 只存后端，禁止暴露给浏览器

7. 工具不得绕过 Knowledge Brain 直接调用大模型
```

---

## 14. 工作流执行规则（AI Workflow v2.2）

```text
Human 写 GitHub Issue → 打标签 → Codex 实现 → Claude Review → Human 合并

Codex：代码实现、PR 创建、测试
Claude：架构审查、PR Review（只读审计，不写代码）
ChatGPT：战略规划、Issue 撰写、验收标准
Human：最终合并、商业优先级、专家协调

Codex 必须先读本文件 + AGENTS.md + AI_WORKFLOW.md，再动手实现
```

---

## 15. UI 架构规范（E14）

### 技术栈
```text
Next.js / React / TypeScript / Tailwind CSS / shadcn/ui / PWA
```

### 三栏布局
```text
左侧导航（220px）| 中间对话区（flex:1）| 右侧多功能面板（256px，可折叠）
移动端：左侧默认折叠（汉堡菜单），右侧默认隐藏
```

### 品牌色
```text
--nb-blue:   #3B82C4  （Logo "Neural"、气泡、选中状态、发送按钮）
--nb-orange: #F5A623  （Logo "Bridge"、项目图标）
--nb-gray:   #8A8A8A  （Logo 副标题）
```

### 固定区域规则
```text
以下区域必须 flex-shrink: 0，不随内容滚动：
- Logo 区 / 搜索框 / REINS 入口 / 用户底栏（左侧）
- TopBar / 物件摘要条 / @ 选择栏 / 输入区（中间）
- 右侧面板标签栏
唯一可滚动：.msgs（消息区）/ .nav（导航区）/ .panel-body（面板内容）
```

### 用户弹出卡
```text
背景必须硬编码实色：亮色 #ffffff / 暗色 #1c1c1e
禁止使用 CSS 变量透明值作为弹出卡背景
position: absolute，bottom: 52px，left: 8px，width: 196px
```

### REINS 入口
```text
位置：左侧导航，搜索框下方
链接：https://system.reins.jp/login/main/KG/GKG001200
打开方式：新标签页
提示文字："点击跳转 · 用户自行登录"
禁止：不保存账号密码 / 不代理登录 / 不自动抓取
```

### 语言规则
```text
界面语言 Dropdown：中文 / 日本語 / English
默认输出语言 Dropdown：中文 / 日本語 / 中日双语 / 客户用日文 / 社内用日本語
系统语言 zh-* → 中文；ja-* → 日本語；en-* → English；其他 → 日本語
两者独立设置，互不影响
```

*版本：v2.3-final | 2026-06-14*
