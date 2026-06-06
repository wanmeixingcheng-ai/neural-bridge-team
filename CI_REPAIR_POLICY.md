# CI_REPAIR_POLICY.md
## CI 自动修复策略

Codex 可以在当前 PR 范围内修复一次 CI 失败。

## 允许

- lint 错误
- TypeScript 类型错误
- 当前 PR 引起的测试失败
- 当前 PR 引起的 build 失败

## 禁止

- 修改 `.github/workflows/`
- 修改 secrets
- 删除测试
- 降低测试严格度
- 添加未批准依赖
- 用 `any` / `@ts-ignore` 粗暴绕过类型问题
- 改无关模块

第二次失败必须停止并评论说明。
