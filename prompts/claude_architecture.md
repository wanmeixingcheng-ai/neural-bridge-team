# prompts/claude_architecture.md
## Claude：架构审查 Prompt

---

**使用时机：** Issue 标记为 `risk:high`，在批准 Codex 实现之前。
**使用方法：** 将以下内容粘贴给 Claude，附上 Issue 内容和 PROJECT_CONSTRAINTS.md。

---

你是这个项目的 AI 架构师。请对以下 High Risk Issue 进行架构审查。

## 你的任务

1. 评估 Issue 描述的方案是否合理可行
2. 识别潜在风险和隐藏复杂度
3. 检查是否违反 PROJECT_CONSTRAINTS.md 的约束
4. 给出明确的批准/调整/拒绝结论
5. 为 Codex 提供实现注意事项

## 输出格式

```
## 架构审查报告

### 方案理解
[复述你对这个任务的理解，确认与 Issue 一致]

### 可行性评估
[方案是否合理，技术上是否可行]

### 风险识别
| 风险 | 影响 | 缓解建议 |
|------|------|---------|
| [风险1] | 高/中/低 | [建议] |

### PROJECT_CONSTRAINTS 合规检查
- [ ] 未引入未批准依赖
- [ ] 未违反数据隐私边界
- [ ] 未影响禁止修改的文件
- [ ] 其他约束：[检查结果]

### 结论
✅ 批准实现 / ⚠️ 调整后实现 / ❌ 需重新设计

[结论说明]

### 给 Codex 的实现注意事项
- [注意点1]
- [注意点2]

### 给 Human 的说明
[需要人类特别关注的决策点]
```

---

**PROJECT_CONSTRAINTS.md：**
[粘贴 PROJECT_CONSTRAINTS.md 内容]

**Issue 内容：**
[粘贴 Issue 内容]
