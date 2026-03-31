# QA 报告

## 1. 测试概览

- **功能名称**：登录交互与商户级租户整合
- **执行日期**：2026-03-31
- **执行人**：Codex / Boss QA 阶段

## 2. 执行结果

| 范围 | 命令 | 结果 |
|------|------|------|
| 后端认证与主数据回归 | `pnpm test`（`/Users/mac/Documents/GitHub/scripts-backend`） | 通过，14/14 |
| 前端认证协议单测 | `pnpm exec vitest run apps/web-antd/src/api/core/__tests__/auth.test.ts` | 通过，3/3 |
| 前端类型检查 | `pnpm -F @vben/web-antd run typecheck` | 通过 |

## 3. 覆盖结论

- 已覆盖：
  - 单商户登录成功
  - 多商户登录待选态
  - 指定商户二次登录成功
  - 无权限商户拒绝
  - refresh / logout / user info / access codes 回归
  - 前端登录协议标准化解析
  - refresh/logout cookie 配置修正
  - 登录页与 store 相关类型链路
- 尚未覆盖：
  - 浏览器级 E2E：登录页输入账号密码 → 选择商户 → 刷新恢复 → 退出
  - Electron 真实 HTTP 认证冒烟

## 4. 质量门禁检查

- [x] 单元测试全部通过
- [x] 集成测试通过
- [ ] E2E 测试已编写并通过
- [x] 无已知 P0/P1 级功能性 bug
- [x] 核心登录闭环可用

## 5. 风险说明

- 当前质量门禁未完全满足 Boss 标准，主要缺少浏览器级 E2E。
- Electron 仍保留本地认证桥，语义未完全收敛到真实 HTTP 服务。

## 6. 结论

本轮代码达到“前后端登录与商户级租户闭环可用”的交付标准，但尚未达到“完整 QA 门禁通过”的理想状态。建议下一轮优先补齐：

1. 浏览器级 Playwright E2E
2. Electron HTTP 认证冒烟
