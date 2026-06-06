# CI_REPAIR_POLICY.md
## CI 自动修复策略

---

## 目标

允许 Codex 在受控条件下对当前 PR 引起的 CI 失败自动修复一次，
提高重复开发流程的自动化率，同时防止修复行为失控。

---

## 允许修复的内容

Codex 可以修复：
- lint 格式错误
- TypeScript 类型错误
- 当前 PR 引起的单元测试失败
- 当前 PR 引起的构建失败
- 小范围配置错误（非 workflow、非 secrets）

---

## 禁止以修复 CI 为由做的事

- 修改 `.github/workflows/` 下的任何文件
- 修改 secrets 或环境变量配置
- 新增未在 `PROJECT_CONSTRAINTS.md` 批准的外部依赖
- 删除测试用例
- 降低测试覆盖率标准
- 绕过 TypeScript 类型检查（如添加 `@ts-ignore`、`as any`）
- 修改与当前 PR 无关的模块
- 大幅重构

---

## 修复次数限制

每个 PR **最多允许一次**自动 CI 修复。

第二次 CI 失败时，Codex 必须：
1. 停止所有修复尝试
2. 在 PR 评论中说明：
   - 哪个 check 失败
   - 已尝试的修复内容
   - 当前怀疑的原因
   - 需要 Human 或 Claude 判断的地方
3. 打上 `needs-human-ci-review` 标签，等待人工介入

---

## 记录要求

如果使用过 CI 自动修复，PR 描述的 **CI Repair** 部分必须填写完整。
未填写视为未完成，Claude Review 时应标记为 [MUST] 补充。

---

## 与自动化率的关系

CI 自动修复是提升自动化率的合理手段，适用于可重复、可验证的低风险修复。
它不是绕过审查的工具。修复后的代码同样需要通过 Claude Review（Medium/High Risk）和 Human 最终确认。
