# AI Workflow v2.1
## ChatGPT + Codex + Claude 自动化开发工作流

> 跨项目通用 AI 工作流框架
> 默认 CI 适用于 **Node.js + npm** 项目
> 其他技术栈（pnpm / yarn / Python / 静态站点）需替换 `.github/workflows/ai-ci.yml`

---

## 三个 AI 的分工

| AI | 角色 | 做什么 |
|----|------|--------|
| **ChatGPT** | 需求翻译官 | 把人类需求翻译成结构化 Issue，最后生成交付报告 |
| **Codex** | 执行者 | 读 Issue 写代码、开 PR、修 CI（最多一次）|
| **Claude** | 审查官 | 架构评估、PR Review、风险判断 |
| **Human** | 决策者 | 标记 Risk Level、批准 High Risk、最终合并 |

---

## 自动化率说明

本方案的目标是提高重复开发流程的自动化程度。

**自动化率提升不代表允许 AI 绕过以下控制点：**
- GitHub Issue（所有任务从 Issue 开始）
- Pull Request（所有代码通过 PR 合并）
- CI 检查（自动修复最多一次）
- Claude Review（Medium/High Risk 必须）
- Branch protection（禁止直接推送 main）
- Human 最终合并
- Human 生产部署确认

自动化只适用于可重复、可验证、可回滚的开发流程环节。
生产权限、secrets、部署、认证、数据库迁移等高风险操作始终需要人工确认。

---

## 快速接入（3步）

1. 将本目录所有文件复制到项目根目录
2. 填写 `PROJECT_CONSTRAINTS.md`（唯一需要定制的文件）
3. 确认 GitHub Actions 已启用，打开 `prompts/` 目录，按需使用 Prompt 模板

---

## 文件说明

```
README.md                         本文件
AGENTS.md                         Codex 的行为规范（Codex 自动读取）
CLAUDE.md                         Claude 的角色和审查规范
AI_WORKFLOW.md                    完整工作流 SOP
PROJECT_CONSTRAINTS.md            ⭐ 项目专属约束（必须填写）
AUTOMATION_POLICY.md              自动化权限边界
RISK_LEVELS.md                    风险分级标准
CI_REPAIR_POLICY.md               CI 自动修复边界
prompts/
  chatgpt_issue.md                生成 Issue 的 Prompt
  chatgpt_report.md               生成交付报告的 Prompt
  claude_architecture.md          架构审查的 Prompt
  claude_review.md                PR Review 的 Prompt
.github/
  PULL_REQUEST_TEMPLATE.md        PR 标准模板
  ISSUE_TEMPLATE/ai_task.md       Issue 标准模板
  workflows/ai-ci.yml             GitHub Actions（Node.js + npm）
```

---

## 其他技术栈的 CI

如果你的项目不使用 Node.js + npm，请替换 `.github/workflows/ai-ci.yml`：

| 技术栈 | 替换方式 |
|--------|---------|
| pnpm | 将 `npm ci` 改为 `pnpm install --frozen-lockfile`，`npm run *` 改为 `pnpm *` |
| yarn | 将 `npm ci` 改为 `yarn install --frozen-lockfile`，`npm run *` 改为 `yarn *` |
| Python | 替换为 `pip install` + `pytest` |
| 静态站点 | 保留 protect-workflow-files 和 check-risk-label 两个 job，删除 validate job |

`protect-workflow-files` 和 `check-risk-label` 两个 job 与技术栈无关，所有项目都应保留。
