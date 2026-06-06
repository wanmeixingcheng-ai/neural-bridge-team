# AI_WORKFLOW.md
## 完整工作流 SOP

---

## 全局流程图

```
你（需求描述）
  ↓
[Step 1] ChatGPT → GitHub Issue（含 Risk Level）
  ↓
[Step 2] Human → 确认 Issue，打标签
  ↓
  ├── risk:high → [Step 3a] Claude 架构审查 → Human 批准
  ├── risk:medium → 直接到 Step 4
  └── risk:low → 直接到 Step 4
  ↓
[Step 4] Codex → 实现代码 → 开 PR
  ↓
[Step 5] GitHub Actions → CI 验证
  ├── 失败 → Codex 修复一次 → 重新 CI
  └── 通过 →
  ↓
  ├── risk:high/medium → [Step 6] Claude PR Review
  └── risk:low → 直接到 Step 7
  ↓
[Step 7] ChatGPT → 生成交付报告
  ↓
[Step 8] Human → 最终合并 + 部署
```

---

## Step 1：ChatGPT 生成 Issue

使用 `prompts/chatgpt_issue.md` 中的 Prompt。

**输入：** 你的需求描述（自然语言即可）
**输出：** 结构化 GitHub Issue，包含：
- 功能描述
- Acceptance Criteria（验收标准）
- 技术提示
- Risk Level 建议
- 给 Codex 的实现提示

**操作：**
1. 打开 ChatGPT，粘贴 `prompts/chatgpt_issue.md` 内容
2. 附上你的需求描述
3. 将输出复制到 GitHub Issue

---

## Step 2：Human 确认

打开 GitHub Issue，检查：
- [ ] Acceptance Criteria 是否准确反映了需求
- [ ] Risk Level 是否合理（见 `RISK_LEVELS.md`）
- [ ] 打上对应标签：`risk:low` / `risk:medium` / `risk:high`
- [ ] 如果满意，打上 `ready-for-codex` 标签

**Risk Level 快速判断：**
- 改样式、加文案、修 bug → `risk:low`
- 新增功能、修改 API → `risk:medium`
- 架构变更、数据库、安全相关 → `risk:high`

---

## Step 3a：Claude 架构审查（仅 High Risk）

使用 `prompts/claude_architecture.md` 中的 Prompt。

**输入：** Issue 完整内容 + `PROJECT_CONSTRAINTS.md` 内容
**输出：** 架构评估报告（见 `CLAUDE.md` 格式）

**操作：**
1. 打开 Claude，粘贴 `prompts/claude_architecture.md` 内容
2. 附上 Issue 内容和 PROJECT_CONSTRAINTS.md
3. 将审查结论复制回 GitHub Issue 评论
4. 根据结论决定是否批准，打上 `approved-for-codex` 标签

---

## Step 4：Codex 实现

Codex 读取 `AGENTS.md` 后自动执行：

1. 读 Issue 内容
2. 按 Acceptance Criteria 实现
3. 写/更新测试
4. 开 PR，填写标准描述
5. 打上 `risk:low/medium/high` 标签

---

## Step 5：CI 验证

GitHub Actions 自动运行（见 `.github/workflows/ai-ci.yml`）：
- lint 检查
- 单元测试
- 构建验证

CI 失败：Codex 自动修复一次 → 推送 → 重新触发 CI
CI 连续失败 2 次：Codex 停止，在 PR 留言，等待人工

---

## Step 6：Claude PR Review（Medium/High Risk）

使用 `prompts/claude_review.md` 中的 Prompt。

**输入：** PR diff + Issue 内容 + PROJECT_CONSTRAINTS.md
**输出：** Review 结论（见 `CLAUDE.md` 格式）

**操作：**
1. 打开 Claude，粘贴 `prompts/claude_review.md` 内容
2. 附上 PR diff（GitHub PR 页面 → Files changed → 复制）
3. 将 Review 结论粘贴到 PR 评论
4. 如果是 Request Changes，打 `needs-revision` 标签，Codex 修改后重新 Review

---

## Step 7：ChatGPT 交付报告

使用 `prompts/chatgpt_report.md` 中的 Prompt。

**输入：** Issue 内容 + PR 描述 + Claude Review 结论
**输出：** 人类可读的交付说明，包含：
- 完成了什么
- 如何验证
- 注意事项
- 是否可以合并的建议

---

## Step 8：Human 最终合并

检查清单：
- [ ] CI 全部通过
- [ ] Claude Review 结论为 Approve 或 Approve with comments（已处理）
- [ ] ChatGPT 交付报告已确认
- [ ] 手动验证关键功能
- 点击 Merge PR
- 确认部署成功

---

## 上下文传递规范

三个 AI 之间靠以下结构化内容传递上下文，不靠人工复述：

```json
{
  "issue_url": "https://github.com/.../issues/42",
  "risk_level": "medium",
  "acceptance_criteria": ["...", "..."],
  "claude_architecture_notes": "（High Risk 时填写）",
  "pr_url": "https://github.com/.../pull/43",
  "ci_result": "pass",
  "claude_review_result": "approve",
  "ready_to_merge": true
}
```

每次移交时，将上述 JSON 附在 Prompt 末尾。
