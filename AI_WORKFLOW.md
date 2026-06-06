# AI_WORKFLOW.md
## v2.2 No-Copy 工作流 SOP

## 目标

把所有任务上下文固定在 GitHub，避免人类在 ChatGPT、Claude、Codex 之间反复复制粘贴。

---

## 普通开发流程

```text
Human 在 GitHub Issue 写自然语言需求
  ↓
打 `ai:triage` 标签
  ↓
Codex 读取 Issue + AGENTS.md + PROJECT_CONSTRAINTS.md
  ↓
Codex 在 Issue 评论中生成 Implementation Plan
  ↓
Human 确认标签：ready-for-codex / approved-for-codex
  ↓
Codex 创建 feature branch + 实现 + 测试 + PR
  ↓
GitHub Actions 检查
  ↓
Claude 读取 PR URL / PR 内容做 Review
  ↓
Codex 根据 Review 修改一次或多次
  ↓
Human 最终合并
```

---

## 审计流程

```text
Human 新建 Issue：请只读审计本仓库
  ↓
打 `audit-only` 标签
  ↓
Codex 或 Claude 读取仓库
  ↓
在 Issue 评论输出审计报告
  ↓
Human 根据报告决定是否创建修复 Issue
```

审计任务默认不允许：
- 修改代码
- 创建修复 PR
- 推送分支
- 打印 secrets 值

---

## ChatGPT 在 v2.2 的定位

ChatGPT 不再被设计为必须读取 Private Repo 的环节。

ChatGPT 负责：
- 帮 Human 把模糊想法变成更清晰的 Issue 文案
- 设计工作流规则
- 复核 Codex / Claude 已经输出的报告
- 生成给人看的解释、决策建议、修复顺序

ChatGPT 不负责：
- 直接读取 Private GitHub 仓库
- 直接获取 PR diff
- 代替 GitHub 存储上下文

---

## 风险控制

- Low Risk：Codex 可实现，PR 后可由 Human 直接审查。
- Medium Risk：Codex 可实现，合并前需要 Claude Review。
- High Risk：Claude 架构审查 + Human 明确批准后，Codex 才能实现。
- audit-only：只输出报告，不改文件。

---

## 每次任务 Human 只需要做什么

1. 在 GitHub Issue 写自然语言需求。
2. 打必要标签。
3. 看 PR / Review / CI。
4. 决定是否合并。

不再要求 Human：
- 复制 prompt 模板
- 复制 Issue 给 Claude
- 复制 PR diff 给 Claude
- 复制 Review 给 ChatGPT
- 复制整仓库给任何 AI
