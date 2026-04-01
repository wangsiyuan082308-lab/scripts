# scripts

> Frontend framework note: this repository's web app is built on Vben. For route cache, tabbar, preferences, and refresh behavior, read [docs/VBEN_FRONTEND_NOTES.md](./docs/VBEN_FRONTEND_NOTES.md) first.

`scripts` 是一个从 `vue-vben-admin` 演进而来的即时零售运营自动化平台 monorepo。

当前仓库已经不再只是通用后台模板，而是同时承载：

- Web 管理台
- Electron 桌面能力
- 本地 Excel 处理工具
- 活动报名与提现自动化
- 商品主数据、采购与决策辅助能力

## 仓库定位

这个仓库主要负责“操作台”和“工具台”两层能力：

- `apps/web-antd`
  - 主应用，提供 Web/Electron 双形态界面
  - 聚合活动中心、采购、商品中心、门店/商户/供应商管理、提现任务等能力
- `packages/*`
  - 共享的 Vben 基础包与通用能力
- `docs/*`
  - 面向仓库维护者的项目说明、变更记录与发布流程

相邻仓库 `../scripts-backend` 是当前唯一后端服务入口；`scripts` 更偏前台工作台、桌面工具和自动化桥接。

## 当前主要产品域

- 活动中心
  - 饿了么活动列表、记录、日志、推荐结果展示
- 决策中心
  - 站点选址、活动建议等 AI/规则辅助入口
- 商品中心
  - 商品总表导入、商品比价、结果查看
- 采购域
  - 采购工作台、任务、运行记录、告警规则、采购报告
- 财务域
  - 提现任务、财务报表
- 基础资料
  - 商户、门店、供应商、账号等管理页

## 运行方式

建议使用 Node.js 20+ 与 pnpm 10+。

```bash
pnpm install
```

常用命令：

```bash
# 交互式 turbo 开发入口
pnpm dev

# 仅启动前端
pnpm dev:antd

# 前端 + Electron 调试
pnpm dev:antd:electron

# 运行提现 CLI
pnpm dev:withdraw
```

## 文档导航

- [项目总览](./docs/PROJECT_MAP.md)
- [项目记忆](./docs/PROJECT_MEMORY.md)
- [系统变更记录](./docs/CHANGELOG.md)
- [Electron 发布流程](./docs/RELEASE_PROCESS.md)
- [商家工具扩展方案](./docs/merchant-tool-extension.md)
- [OpenClaw 财务分析说明](./docs/openclaw-finance-analysis.md)

## 需要先知道的事实

- 根仓库仍保留不少 `vue-vben-admin` 的基础设施和共享包。
- 当前业务定位已经明显偏向“即时零售运营自动化平台”，不要再把它理解成纯后台模板。
- 当前所有业务接口统一走 `scripts-backend`，不再依赖本仓库内的 mock 服务。
- Electron 能力和自动化流程是这个仓库的重要组成部分，不是附属脚本。

## 补充说明

- `apps/eleme-auto-withdraw` 目录当前未见有效源码，现阶段不要把它当成主实现入口。
- 真正投入使用的提现能力位于 `apps/web-antd/electron/features/withdrawal-task`。
- 如需了解后端能力，请同时阅读 [`C:\Users\31314\Documents\GitHub\scripts-backend\README.md`](C:\Users\31314\Documents\GitHub\scripts-backend\README.md)。
