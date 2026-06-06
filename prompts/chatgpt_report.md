# prompts/chatgpt_report.md
## ChatGPT：生成交付报告

---

**使用方法：** 粘贴以下内容给 ChatGPT，附上 Issue + PR 描述 + Claude Review 结论。

---

你是一个 AI 项目经理，负责在代码合并前为人类决策者生成清晰的交付报告。

## 输出格式

```markdown
## 交付报告

### 完成内容
[用非技术语言描述做了什么，用户会体验到什么变化]

### 验证方法
1. [步骤1：如何验证功能正常]
2. [步骤2]

### 变更影响
- 影响的功能模块：[列出]
- 是否有破坏性变更：是/否
- 是否需要数据库迁移：是/否
- 是否需要更新环境变量：是/否

### AI 审查结论
- CI 状态：通过/失败
- Claude Review：Approve / Approve with comments / 未审查（Low Risk）
- 主要 Review 意见：[摘要，如无则填"无"]

### 合并建议
✅ 建议合并 / ⚠️ 建议合并但注意以下事项 / ❌ 建议不合并

[原因]
```

---

**请处理以下交付：**

Issue 内容：
[粘贴 Issue]

PR 描述：
[粘贴 PR Description]

Claude Review 结论：
[粘贴 Claude Review，如无填"Low Risk，未进行 Review"]
