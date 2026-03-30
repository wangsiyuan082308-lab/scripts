# Electron 发布流程

本文档描述当前仓库的 Electron 自动发布流程，基于当前生效的 GitHub Actions 工作流：

- `.github/workflows/release-electron.yml`

## 触发条件

工作流会在以下条件同时满足时自动触发：

- push 到 `main`
- 本次 push 改动命中以下任一路径：
- `apps/web-antd/**`
- `packages/**`
- `.github/workflows/release-electron.yml`

这意味着：

- 仅修改 `docs/**` 默认不会触发自动打包发布
- 合并到 `main` 的桌面端或共享包改动，会直接进入发布流程

## 自动执行内容

当前 workflow 名称为 `Build & Release Electron`，完整流程如下：

1. 在 `main` 上自动递增 patch 版本号
2. 同时更新根目录 `package.json` 和 `apps/web-antd/package.json`
3. 由 GitHub Actions 自动提交版本 bump
4. 自动创建并推送 tag，格式为 `vX.Y.Z`
5. 在 macOS runner 上构建 Electron 安装包
6. 在 Windows runner 上基于刚刚生成的 tag 构建安装包
7. 汇总构建产物并创建 GitHub Release

## 发布产物

正常情况下会产出：

- macOS `.dmg`
- macOS `.zip`
- `latest-mac.yml`
- Windows `.exe`
- Windows `latest.yml`
- 对应版本号的 GitHub Release

## 标准操作步骤

建议的发布入口是：

1. 在功能分支完成开发和验证
2. 将需要发布的改动合并到 `main`
3. 观察 GitHub Actions 中的 `Build & Release Electron`
4. 等待版本 bump commit、tag、构建、Release 全部完成
5. 到 GitHub Releases 确认安装包是否齐全

## 如何确认发布是否真的开始

合并或推送到 `main` 后，可以按下面顺序确认：

1. 打开仓库 Actions 页面
2. 找到 `Build & Release Electron`
3. 确认本次运行的触发提交就是刚推到 `main` 的提交
4. 确认后续出现 GitHub Actions 自动生成的 `chore: release vX.Y.Z` 提交
5. 确认仓库 tag 列表里出现新的 `vX.Y.Z`

## 如何确认发布已经完成

发布完成时，通常应同时满足：

- GitHub Actions 运行状态为 `success`
- 仓库里出现新的 `vX.Y.Z` tag
- GitHub Releases 中出现同版本 release
- release 附件中包含 macOS 和 Windows 安装包

## 重要注意事项

- 当前 workflow 是发布基础设施，不是普通 CI；推到 `main` 就可能直接发版
- workflow 会自行回写 `main`，因为它会提交版本 bump 和 tag
- 当前 workflow 使用 `git push origin HEAD:main --follow-tags`，不要改回 force push
- 如果只想补文档而不触发发布，应避免只通过改动 `apps/web-antd/**` 或 `packages/**` 来做无关提交

## 常见排查点

如果你以为已经“上线”但没有自动发布，先检查：

1. 是否真的推到了 `main`
2. 改动路径是否命中 workflow 的 `paths`
3. Actions 是否因权限、依赖安装、打包失败而中断
4. 是否已经生成版本 bump commit，但后续 macOS 或 Windows 构建失败
5. GitHub Release 是否因产物缺失而没有完整创建

如果发布失败，优先查看：

- GitHub Actions 对应 run 的日志
- `release` job 的版本 bump 和 macOS 构建
- `build-windows` job 的 Windows 打包
- `publish` job 的 Release 上传结果

## 当前流程适用范围

本文档仅描述当前仓库里 Electron 桌面端的自动发布流程。

如果未来新增：

- Web 单独发布
- 手动审批步骤
- 预发环境发布
- Draft Release 流程

需要同步更新本文档。
