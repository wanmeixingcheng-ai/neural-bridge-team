# PROJECT_CONSTRAINTS.md
## 项目专属约束

> ⭐ 这是唯一需要你填写的文件。
> 每个项目复制一份，填写本项目的实际情况。
> Codex 和 Claude 都会读取此文件作为最高优先级约束。

---

## 1. 项目基本信息

```
项目名称：
技术栈：（如 Next.js 14 + Supabase + TypeScript）
主要用户：
生产环境：（如 Vercel）
代码仓库：
```

---

## 2. 技术边界

### 允许的外部依赖（Codex 不得引入此列表以外的依赖）
```
- （填写已批准的 npm 包或库）
- （例：react, next, typescript, tailwindcss）
```

### 禁止的操作
```
- （填写项目特有的禁止事项）
- （例：禁止直接操作 DOM，禁止使用 class components）
```

### 数据库约束
```
- Schema 变更：需要人工审批（High Risk）
- 新增表：需要人工审批（High Risk）
- 查询优化：Medium Risk
```

---

## 3. 数据隐私边界

```
用户私有数据（只允许存本地/客户端）：
- （例：用户业务数据、个人信息）

服务端数据（允许存 DB）：
- （例：公共知识库、配置信息）

绝对禁止上传到服务端的数据：
- （明确列出）
```

---

## 4. API 与外部服务

```
已批准的外部 API：
- （例：Anthropic Claude API）
- （例：Supabase）

调用方式约束：
- （例：所有 Claude API 调用必须经过 /lib/claude-client.ts 封装）
- （例：禁止在组件层直接调用外部 API）

Secret 管理方式：
- （例：Vercel Environment Variables，禁止 hardcode）
```

---

## 5. 文件保护（Codex 禁止修改以下文件）

```
- AGENTS.md
- CLAUDE.md
- AI_WORKFLOW.md
- PROJECT_CONSTRAINTS.md（本文件）
- AUTOMATION_POLICY.md
- .github/workflows/
```

---

## 6. 项目特有 Stop Conditions

> 在通用 Stop Conditions 之外，本项目额外的停止条件：

```
- （例：任何涉及支付逻辑的修改）
- （例：修改用户认证流程）
- （例：修改超过 2 个 Agent 的 System Prompt）
```

---

## 7. 版本记录

| 日期 | 修改内容 | 修改人 |
|------|---------|--------|
| | 初始版本 | |

---

## 8. AI 自动化范围

### 本项目允许 AI 自动执行
- 
- 

### 本项目禁止 AI 自动执行
- 
- 

### 需要 Human 明确批准的操作
- 
- 
