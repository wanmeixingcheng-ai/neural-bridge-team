# RISK_LEVELS.md
## 风险分级

## Low Risk

- 文案、样式、小型 UI 调整
- 单文件 bug 修复
- 小工具函数
- 文档更新

Codex 可实现，Human 可直接审查合并。

## Medium Risk

- 新增页面 / 组件
- 跨文件业务逻辑
- API 调用方式变化
- 状态管理变化
- 用户可见行为变化

Codex 可实现，合并前需要 Claude Review。

## High Risk

- 认证 / 授权
- 数据库 schema
- Secrets / CI/CD / 部署
- 支付
- 新外部服务
- 架构迁移
- 核心 Prompt / Agent 规则

需要 Claude Architecture Review + Human 批准。

## Audit-only

只读审计，不修改代码，不创建修复 PR。
