# AUTOMATION_POLICY.md
## 自动化权限边界

> 明确哪些操作可以自动化，哪些必须人工。

---

## AI 可以自动执行

| 操作 | 执行者 |
|------|--------|
| 生成 GitHub Issue 草稿 | ChatGPT |
| 实现 Low/Medium Risk 代码 | Codex |
| 开 Pull Request | Codex |
| CI 失败后修复一次 | Codex |
| 架构审查（输出建议）| Claude |
| PR Review（输出建议）| Claude |
| 生成交付报告 | ChatGPT |

---

## 必须人工操作

| 操作 | 原因 |
|------|------|
| 标记 Risk Level | 业务判断，AI 只能建议 |
| 批准 High Risk 任务开始实现 | 架构决策 |
| 合并 PR 到 main 分支 | 最终责任 |
| 生产环境部署 | 不可逆操作 |
| 修改 `PROJECT_CONSTRAINTS.md` | 规则本身的变更 |
| 处理连续 CI 失败 | 需要上下文判断 |
| 添加新的外部服务 | 安全与成本影响 |

---

## 安全底线（任何情况下都不违反）

1. **不自动合并** — PR 合并永远需要人工点击
2. **不推送 main** — Codex 只在 feature branch 工作
3. **不修改 workflow** — CI/CD 配置只允许人工修改
4. **不访问生产数据** — AI 不接触真实用户数据
5. **CI 修复上限** — 每个 PR 最多自动修复一次 CI
6. **High Risk 必须等待** — 未收到 `approved-for-codex` 标签前不实现
