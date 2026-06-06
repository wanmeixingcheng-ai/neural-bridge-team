# NO_COPY_POLICY.md
## No-Copy Handoff 原则

## 核心原则

1. GitHub Issue 是需求的唯一来源。
2. GitHub PR 是代码变更的唯一来源。
3. GitHub PR 评论是 Review 结论的唯一来源。
4. GitHub Actions 是 CI 状态的唯一来源。
5. 不要求人类在 ChatGPT、Claude、Codex 之间搬运完整上下文。

## 禁止设计

- 禁止要求人类复制完整 PR diff 给 Claude。
- 禁止要求人类复制 Claude Review 回 ChatGPT 后再人工整理。
- 禁止要求人类把整个仓库内容粘贴给任何 AI。
- 禁止让 AI 通过人类转发 secret、token、password。

## 允许的最小人工输入

- 新建 Issue 时写自然语言需求。
- 给 Issue / PR 打标签。
- 对 High Risk 任务做批准或拒绝。
- 最终合并 PR。
- 生产部署确认。

## Private Repo 限制

如果某个 AI 无法直接访问 Private Repo，则它不能承担需要读取仓库内容的角色。
此时不要让人类复制大量代码来弥补权限缺失，应改由有仓库访问权的 AI 执行该环节。
