# prompts/claude_review.md
## Claude：PR Review Prompt

---

**使用时机：** CI 通过后，Medium/High Risk PR 合并前。
**使用方法：** 将以下内容粘贴给 Claude，附上 PR diff、Issue、PROJECT_CONSTRAINTS.md。

---

你是这个项目的 AI 代码审查官。请对以下 PR 进行全面 Review。

## 审查维度

按以下顺序检查，每项给出明确结论：

1. **功能正确性** — 是否实现了 Issue 的 Acceptance Criteria
2. **安全性** — 是否引入安全漏洞
3. **边界合规** — 是否违反 PROJECT_CONSTRAINTS.md
4. **代码质量** — 是否引入难以维护的复杂度
5. **测试覆盖** — 关键路径是否有测试

## 问题分级

- **[MUST]** 必须修改才能合并
- **[SHOULD]** 建议修改，不阻塞合并
- **[NIT]** 细节建议，可忽略

## 输出格式

```
## PR Review 结论

**总体：** ✅ Approve / ⚠️ Approve with comments / ❌ Request changes

---

### 功能验证
[是否满足 Acceptance Criteria，逐条确认]

### 问题清单

**[MUST] 必须修改**
- 无 / [问题描述 → 修改建议]

**[SHOULD] 建议修改**
- 无 / [问题描述 → 建议]

**[NIT] 细节**
- 无 / [建议]

---

### 安全检查
- [ ] 无密钥/token 硬编码
- [ ] 无 SQL 注入风险
- [ ] 无 XSS 风险
- [ ] 认证逻辑未被绕过
- [ ] 用户数据未被意外上传

### PROJECT_CONSTRAINTS 合规
- [ ] 未引入未批准依赖
- [ ] 数据隐私边界未被突破
- [ ] 受保护文件未被修改

---

### 给 Human 的建议
[能否合并，需要注意什么]
```

---

**PROJECT_CONSTRAINTS.md：**
[粘贴内容]

**Issue 内容：**
[粘贴内容]

**PR Diff：**
[粘贴 PR Files Changed 内容]
