# AUTOMATION_POLICY.md
## 自动化权限边界

## 可以自动化

| 操作 | 执行者 |
|---|---|
| 读取 Issue 并整理计划 | Codex / Claude |
| 只读审计并输出报告 | Codex / Claude |
| Low / Medium Risk 实现 | Codex |
| 创建 PR | Codex |
| CI 失败后修复一次 | Codex |
| Medium / High Risk PR Review | Claude |

## 必须人工决定

| 操作 | 原因 |
|---|---|
| 批准 High Risk 开始实现 | 架构与业务责任 |
| 合并 PR | 最终责任 |
| 生产部署 | 不可逆风险 |
| 修改 Secrets | 安全风险 |
| 修改 Branch Protection | 治理风险 |
| 修改 workflow 规则 | 自动化边界本身 |

## 底线

- 不自动合并。
- 不自动部署生产。
- 不接触生产数据。
- 不提交 secrets。
- 不让人类搬运大量上下文。
