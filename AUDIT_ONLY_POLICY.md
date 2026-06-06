# AUDIT_ONLY_POLICY.md
## 只读审计规则

当 Issue 或任务中出现以下任意标签或描述时，必须进入只读审计模式：

- `audit-only`
- `只审计不修改`
- `read-only audit`
- `do not modify`

## 只读审计模式下允许

- 读取仓库文件
- 分析项目结构
- 分析依赖、配置、CI、部署、安全风险
- 输出审计报告到 Issue / PR 评论
- 建议后续修复 Issue

## 只读审计模式下禁止

- 修改任何文件
- 创建 commit
- 创建修复 PR
- 推送分支
- 自动执行修复
- 打印 secret / token / password 的真实值
- 修改 GitHub Actions、Secrets、Branch Protection

## 审计报告格式

```markdown
# Repository Audit Report

## Scope
- Repository:
- Audit mode: read-only
- Commit / branch reviewed:

## Executive Summary
[总体结论]

## P0 — Critical
| File | Problem | Risk | Recommendation |
|------|---------|------|----------------|

## P1 — High
| File | Problem | Risk | Recommendation |
|------|---------|------|----------------|

## P2 — Medium
| File | Problem | Risk | Recommendation |
|------|---------|------|----------------|

## P3 — Low
| File | Problem | Risk | Recommendation |
|------|---------|------|----------------|

## Security Notes
- Secrets exposure:
- Auth / authorization:
- Data privacy:

## CI / Deployment Notes
- CI:
- Build:
- Deploy:

## Recommended Next Issues
1. [P0/P1 修复任务]
2. [P2 修复任务]
```
