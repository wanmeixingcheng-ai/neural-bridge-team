# Neural Bridge Team

19名AI团队成员协作工作台。 

## 技术栈

- Next.js 16
- Anthropic Claude / Google Gemini
- Upstash Redis
- Neon Postgres
- Vercel

## 环境变量

参考 `.env.example` 配置所需变量。

## 本地开发

```bash
npm install
npm run dev
```

## 测试

```bash
npm test
```

## Vercel 部署

项目使用显式 `vercel.json` 配置：

- Node.js 固定为 `22.x`
- 安装命令：`npm ci`
- 构建命令：`npm run build`
- 输出目录：`.next`
- 区域：`hnd1`

生产环境变量在 Vercel Dashboard 或 CLI 中配置，不提交到仓库。
