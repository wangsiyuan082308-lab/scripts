# 系统更新日志

## 2026-03-13

### 🎉 功能优化

#### 补货量计算逻辑优化

**位置：** `apps/web-antd/electron/features/procurement/index.ts`

**改动：**
- ❌ **移除**：不再减半处理
- ✅ **新增**：直接使用周销量（或月销量，根据模式）
- ✅ **保留**：起订量校验（确保不低于起订量）
- ✅ **新增**：黄色标记提醒（原采购量 > 实际销量 1.5倍）

**新旧逻辑对比：**

| 场景 | 旧逻辑 | 新逻辑 |
|------|--------|--------|
| 建议补货量 > 周销 | 减半 | 使用周销 |
| 周销 < 起订量 | 先减半，再检查起订量 | 直接使用起订量 |
| 原采购量远大于销量 | 标红 | 标黄提醒 |

**优势：**
- 更符合实际销售情况
- 避免过度缩减导致缺货
- 确保满足起订量要求

---

## 2026-03-12

### 🎉 新功能

#### 1. 翱象采购计划格式支持

**位置：** `apps/web-antd/electron/features/procurement/plan-generator.ts`

**改进内容：**
- ✅ 支持新的翱象采购订单格式（10个字段）转换为标准格式（6个字段）
- ✅ 智能字段映射，支持模糊匹配
- ✅ 新增"采购单位"字段支持
- ✅ 兼容新旧两种格式

**输入格式（新）：**
```
*门店/仓编码  商品名称  *SKU编码  *采购量  采购单价(元)  供应商编码  物流单号  采购单位  预计到货日期  网采订单留言内容
```

**输出格式（标准翱象）：**
```
*仓库/门店编码  *商品编码  *补货量  供应商编码  单位  采购价
```

**字段映射规则：**
| 输入字段 | 输出字段 | 说明 |
|---------|---------|------|
| *门店/仓编码 | *仓库/门店编码 | 直接映射 |
| *SKU编码 | *商品编码 | 直接映射 |
| *采购量 | *补货量 | 直接映射 |
| 供应商编码 | 供应商编码 | 直接映射 |
| 采购单位 | 单位 | ✅ 新增支持 |
| 采购单价(元) | 采购价 | 直接映射 |

**使用方法：**
1. 打开工作台 → 采购计划生成
2. 选择目标平台：翱象
3. 上传新格式 Excel 文件
4. 点击"生成计划"

---

### 🐛 Bug 修复

#### 2. Electron 自动更新 404 错误修复

**问题：**
```
Cannot download "https://github.com/wangsiyuan082308-lab/scripts/releases/download/v5.5.31/@vben/web-antd-5.5.31-arm64-mac.zip"
status 404
```

**根本原因：**
- electron-updater 使用 `package.json` 的 `name` 字段（`@vben/web-antd`）拼接下载 URL
- electron-builder 使用 `productName` 字段（`前端小工具`）生成实际文件名
- 导致文件名不匹配，返回 404

**修复方案：**

1. **调整 `package.json` 字段顺序** - 将 `productName` 移到 `build` 配置的最前面
2. **增强日志输出** - 添加详细的更新日志便于排查问题
3. **延迟检查更新** - 避免 Electron 启动时立即检查更新导致卡顿

**修改文件：**
- `apps/web-antd/package.json` - 调整 build 配置字段顺序
- `apps/web-antd/electron/main.ts` - 增强更新日志和延迟检查

**改进后的更新流程：**
```typescript
// 延迟 3 秒检查更新
setTimeout(() => {
  autoUpdater.logger = console;  // 输出详细日志
  autoUpdater.checkForUpdatesAndNotify();
}, 3000);

// 详细的事件日志
autoUpdater.on('update-available', (info) => {
  console.log('[AutoUpdater] Update available:', info.version);
  // ...
});
```

---

### 📋 已知问题

#### 饿了么活动助手前端页面缺失

**状态：** 后端 API 已完成，前端页面待开发

**已完成的 API：**
- ✅ `/api/eleme/activities` - 活动列表 + ROI 计算
- ✅ `/api/eleme/records` - 报名记录
- ✅ `/api/eleme/logs` - 执行日志

**待开发的前端页面：**
- 📝 `apps/web-antd/src/views/dashboard/eleme/activity-list.vue`
- 📝 `apps/web-antd/src/views/dashboard/eleme/activity-records.vue`
- 📝 `apps/web-antd/src/views/dashboard/eleme/activity-logs.vue`

---

## 技术栈

- **前端：** Vue3 + Vite + Ant Design + TypeScript
- **后端：** Nitro (H3 框架)
- **桌面端：** Electron + electron-builder + electron-updater
- **自动化：** OpenClaw (Playwright)
- **构建工具：** Turbo + pnpm workspace

---

## 相关文档

- [饿了么活动助手扩展方案](./merchant-tool-extension.md)
- [采购计划生成工具使用说明](../apps/web-antd/electron/features/procurement/README.md)
- [Electron 自动更新配置](https://www.electron.build/auto-update)