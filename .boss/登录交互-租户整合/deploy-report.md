# 部署交付报告

## 1. 部署状态

- **状态**：未执行正式部署
- **日期**：2026-03-31
- **原因**：本轮目标聚焦于本地联调闭环，未提供 GitHub 仓库 / 服务器 / 线上环境接入要求。

## 2. 本地可运行结果

- 前端仓库：`/Users/mac/Documents/GitHub/scripts`
- 后端项目：`/Users/mac/Documents/GitHub/scripts-backend`
- 后端启动命令：

```bash
cd /Users/mac/Documents/GitHub/scripts-backend
pnpm start
```

- 前端开发命令：

```bash
cd /Users/mac/Documents/GitHub/scripts
pnpm -F @vben/web-antd run dev
```

## 3. 本地联调约定

- 前端开发代理已指向：`http://127.0.0.1:3030/api`
- 后端真实认证与主数据已可用
- 其余未迁移业务接口仍由后端代理到现有 mock

## 4. 后续部署建议

1. 为 `scripts-backend` 初始化 Git 仓库并推送到 GitHub
2. 准备 `.env.production` 与后端部署环境变量
3. 确认 PM2 / Docker / 服务器目标环境
4. 补齐 E2E 后再进入正式发布
