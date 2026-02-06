# 饿了么自动提现脚本

本项目用于自动化执行饿了么商家后台的提现流程。

## ⚠️ 重要说明

本脚本仅供学习和内部使用。使用自动化脚本可能违反平台服务条款，请谨慎使用。
脚本使用了 Playwright 的持久化上下文来尽量模拟真实用户行为，但仍有被检测的风险。

## 功能

1.  **模拟登录**：自动打开登录页面，支持检测登录状态，如需登录会暂停等待用户手动操作。
2.  **自动切店**：自动搜索并切换到指定的“Oby便利超市（安吉店）”或“Oby便利超市（长兴店）”。
3.  **自动提现**：
    *   进入财务模块。
    *   识别所有 iframe 中的提现按钮（主资金账号、网商云账户）。
    *   点击提现 -> 点击全部提现 -> 确定。
    *   自动输入支付密码 `130816` 并提交。

## 环境要求

*   macOS (已验证)
*   Node.js (建议 v14+)
*   Google Chrome (Playwright 会自动下载 Chromium，也可配置使用本地 Chrome)

## 安装

```bash
npm install
```

## 运行

```bash
npm start
```

## 首次运行指南

1.  运行脚本后，会自动打开一个 Chromium 浏览器窗口。
2.  如果此时未登录，终端会提示“检测到需要登录！”。
3.  请在打开的浏览器窗口中，手动扫码或输入账号密码登录饿了么后台。
4.  登录成功并看到后台主页后，回到终端窗口，**按回车键**继续。
5.  脚本将自动执行后续的切店和提现操作。
6.  后续运行时，因为使用了持久化数据（`user_data` 目录），通常无需再次登录。

## 配置

主要配置位于 `src/index.ts` 文件顶部的 `CONFIG` 常量中：

```typescript
const CONFIG = {
  url: 'https://nr.ele.me/app/eleme-nr-bfe-newretail/common-next#/pc/orderProcessingPc/tab',
  password: '130816',
  targetStores: ['Oby便利超市（安吉店）', 'Oby便利超市（长兴店）'],
  userDataDir: path.join(process.cwd(), 'user_data'),
};
```

## 常见问题

*   **选择器失效**：如果页面改版，导致无法找到按钮，请查看终端报错信息，并修改 `src/index.ts` 中的选择器（如 `getByText` 或 CSS 选择器）。
*   **登录频繁失效**：请不要手动删除 `user_data` 目录，该目录保存了你的 Cookie 信息。
