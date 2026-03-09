# 前端小工具平台 - 扩展方案

## 现状

```
apps/
├── web-antd/          # Vue3 + Ant Design 管理面板（支持 Electron）
│   └── src/views/dashboard/tools/   # 5个工具页面
└── backend-mock/      # Nitro 后端（H3 框架）
```

已有工具：采购计划Excel转换、饿了么活动报名脚本、爆好价助手、财务报表、采购计划生成

## 扩展目标

将饿了么活动助手（OpenClaw skill）迁移到 monorepo，新增：
1. **活动列表页** - 展示所有可报名活动 + P0/P1/P2 推荐分级
2. **报名记录页** - 查看历史报名状态
3. **执行日志页** - 查看活动助手运行日志

## 架构设计

### 不改变的
- 活动爬虫仍由 OpenClaw cron 定时执行（Playwright 需要浏览器环境）
- 爬取结果写入 JSON 数据文件
- 飞书推送保持不变

### 新增的
```
apps/
├── web-antd/src/
│   ├── views/dashboard/eleme/
│   │   ├── activity-list.vue      # 活动列表 + ROI 推荐
│   │   ├── activity-records.vue   # 报名记录
│   │   └── activity-logs.vue      # 执行日志
│   └── router/routes/modules/
│       └── dashboard.ts           # 新增路由（显示在菜单）
│
└── backend-mock/api/eleme/
    ├── activities.ts              # GET /api/eleme/activities
    ├── records.ts                 # GET /api/eleme/records
    └── logs.ts                    # GET /api/eleme/logs

数据源（共享）:
  ~/.openclaw/workspace/skills/eleme-activity-assistant/
  ├── data/activities.json         # 活动数据
  ├── data/报名历史.json            # 报名记录
  └── logs/                        # 执行日志
```

### 数据流
```
OpenClaw Cron (每天09:00)
  → Playwright 爬取饿了么活动
  → 写入 data/activities.json
  → 飞书推送摘要

Web 面板 (随时查看)
  → backend-mock 读取 JSON 文件
  → 前端展示活动列表/日志/记录
```

## 技术要点

1. **数据共享**：backend-mock 直接读取 OpenClaw workspace 的 JSON 文件，零迁移成本
2. **ROI 计算**：前端复用活动助手的推荐算法（P0/P1/P2/P3 分级）
3. **日志解析**：读取 logs/ 目录下的 .log 文件，按时间倒序展示
4. **无需数据库**：JSON 文件足够，后续需要再升级 SQLite

## 实施步骤

1. 创建 3 个后端 API 路由
2. 创建 3 个前端页面
3. 更新路由配置，在菜单中显示
4. 测试验证
