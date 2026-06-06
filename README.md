# AI Workflow v2.2 — No-Copy Handoff

> 目标：把 GitHub 作为唯一任务中枢，尽量消除 ChatGPT / Claude / Codex / GitHub 之间的反复复制粘贴。

## 这版修正了 v2.1 的核心问题

v2.1 主要是“Prompt 手册”，很多步骤仍要求人手动复制：
- ChatGPT 输出 Issue → 复制到 GitHub
- GitHub Issue → 复制到 Claude
- PR diff → 复制到 Claude
- Claude Review → 复制回 PR
- Issue + PR + Review → 复制给 ChatGPT 生成报告

v2.2 的原则是：

**所有上下文都留在 GitHub；每个 AI 只读取 GitHub 里的 Issue / PR / Repo 文件，不靠人类搬运上下文。**

## 真实边界

这套方案能减少重复搬运，但不能突破各产品的权限边界：

- ChatGPT 当前不能自动登录你的 Private GitHub 仓库。
- 不应把 GitHub 密码、PAT、Secret 发给 ChatGPT。
- 如果某个 AI 没有 GitHub 仓库访问权，它就不能直接审计 Private 仓库。

因此，v2.2 的正确用法是：

- **GitHub = 任务与上下文中心**
- **Codex = 仓库内执行 / 审计 / PR 创建者**
- **Claude = 仓库内架构审查 / PR Review（需要 Claude 具备 GitHub 访问权）**
- **ChatGPT = 上游产品经理 / 规则设计者 / 报告复核者，不再承担必须读取 Private Repo 的环节**

## 每次任务的最少操作

### 普通开发任务

1. 你在 GitHub 新建 Issue，只写自然语言需求。
2. 打标签：`ai:triage`。
3. Codex 读取 Issue + 仓库规则，整理计划并实现。
4. Codex 开 PR。
5. CI 自动检查。
6. Claude 直接读取 PR URL 或 GitHub PR 内容做 Review。
7. 你只做最终合并判断。

### 仓库审计任务

1. 你在 GitHub 新建 Issue：`请只读审计本仓库，不要修改代码`。
2. 打标签：`audit-only`。
3. Codex / Claude 在 Issue 或 PR 评论里输出审计报告。
4. 不创建代码修改 PR；除非你明确要求生成报告文件。

## 文件说明

```text
README.md                         本文件
AI_WORKFLOW.md                    No-Copy 工作流
AGENTS.md                         Codex 行为规范
CLAUDE.md                         Claude 审查规范
PROJECT_CONSTRAINTS.md            项目约束模板
NO_COPY_POLICY.md                 禁止反复复制粘贴的原则
AUDIT_ONLY_POLICY.md              只读审计规则
AUTOMATION_POLICY.md              自动化边界
RISK_LEVELS.md                    风险分级
CI_REPAIR_POLICY.md               CI 修复边界
GITHUB_LABELS.md                  标签清单
.github/ISSUE_TEMPLATE/ai_request.yml
.github/PULL_REQUEST_TEMPLATE.md
.github/workflows/ai-governance.yml
scripts/collect_audit_context.py  可选：生成审计上下文文件
prompts/codex_issue_runner.md     给 Codex 的一次性启动提示
prompts/claude_pr_review_by_url.md
prompts/claude_audit_by_url.md
```

## 一次性接入

1. 把本目录文件复制到项目根目录。
2. 填写 `PROJECT_CONSTRAINTS.md`。
3. 创建 `GITHUB_LABELS.md` 里的标签。
4. 设置 Branch Protection：禁止直接推送 main，要求 PR + CI。
5. 确认 Codex / Claude 已被授权访问该 Private Repo。

完成后，每次任务不再需要把 Issue、diff、Review 反复复制来回。
