# PROJECT_CONSTRAINTS.md
## 项目专属约束模板

> 这是每个项目唯一必须人工填写的文件。

## 1. 项目基本信息

```text
项目名称：
仓库地址：
技术栈：
部署环境：
主要用户：
```

## 2. AI 权限边界

### AI 可以做
```text
- 读取仓库源码
- 创建 feature branch
- 创建 PR
- 评论 Issue / PR
- 修复 Low / Medium Risk 任务
```

### AI 不可以做
```text
- 合并 PR
- 推送 main/master
- 读取或修改生产数据
- 修改 GitHub Secrets
- 修改生产部署配置
- 输出 secret/token/password 真实值
```

## 3. 技术边界

### 已批准依赖
```text
- 
```

### 禁止新增依赖
```text
- 
```

## 4. 数据隐私边界

### 只能本地保存的数据
```text
- 
```

### 允许服务端保存的数据
```text
- 
```

### 绝对禁止上传的数据
```text
- 
```

## 5. 外部 API / 服务

### 已批准服务
```text
- 
```

### Secret 管理方式
```text
- GitHub Secrets / Vercel Env / Supabase Dashboard 等
- 禁止 hardcode
```

## 6. Protected Files

```text
- AGENTS.md
- CLAUDE.md
- AI_WORKFLOW.md
- NO_COPY_POLICY.md
- AUDIT_ONLY_POLICY.md
- AUTOMATION_POLICY.md
- PROJECT_CONSTRAINTS.md
- .github/workflows/
```

## 7. High Risk 自动判定

以下修改必须标记 High Risk：

```text
- Auth / 登录 / 权限
- 数据库 schema
- 支付
- CI/CD
- Secrets
- 外部服务接入
- 生产部署
- 多 Agent Prompt / 系统提示词
```
