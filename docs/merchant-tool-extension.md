# 前端小工具平台 - 饿了么活动助手扩展方案

## 项目概况

**仓库：** Vue Vben Admin Monorepo
**技术栈：** Vue3 + Vite + Ant Design + TypeScript + Nitro (H3)
**自动化框架：** OpenClaw (Playwright)

---

## 现状

```
apps/
├── web-antd/          # Vue3 + Ant Design 管理面板（支持 Electron）
│   └── src/views/dashboard/
│       ├── tools/               # 已有工具页面
│       │   ├── excel-convert.vue          # 采购计划Excel转换
│       │   ├── eleme-script.vue           # 饿了么活动报名脚本
│       │   ├── eleme-baohaojia.vue        # 爆好价助手
│       │   └── procurement-plan.vue       # 采购计划生成
│       └── workspace/           # 工作台首页
└── backend-mock/      # Nitro 后端（H3 框架）
    └── api/
        ├── auth/                # 认证相关
        ├── user/                # 用户信息
        ├── menu/                # 菜单配置
        ├── procurement-task/    # 采购任务
        ├── supplier/            # 供应商
        ├── purchase/            # 采购报表
        ├── finance/             # 财务报表
        └── eleme/               # ✅ 饿了么活动 API（已实现）
            ├── activities.ts    # 活动列表 + ROI 计算
            ├── activities/[id].ts  # 活动详情
            ├── records.ts       # 报名记录
            └── logs.ts          # 执行日志
```

**OpenClaw 技能池：** `~/.openclaw/workspace/skills/`
- `eleme-activity-assistant` - 饿了么活动助手（爬虫 + 推送）
- `oby-finance-analyzer` - 财务分析
- `aoixiang-auto-purchase` - 自动采购
- 其他技能...

---

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

### ✅ 第一阶段：后端 API（已完成）

**实现时间：** 2026-02 ~ 2026-03

**已完成的 API：**

#### 1. `/api/eleme/activities` - 活动列表

**核心功能：**
- 读取 `~/.openclaw/workspace/skills/eleme-activity-assistant/data/activities.json`
- 智能合并多个数据源：
  - `activities.json` - 主活动数据
  - `super_brand_signup_*.json` - 品牌报名结果
  - `报名历史.json` - 历史报名记录
  - `activities_history.json` - 历史活动数据
- ROI 智能计算算法：
  ```typescript
  ROI = (增量订单 × (客单价 × 毛利率 - 商家成本)) / (增量订单 × 商家成本)
  ```
- 自动分级推荐：
  - **P0** (今日必报): 截止时间 ≤ 7天 + ROI ≥ 1.0
  - **P1** (值得报名): 平台补贴 ≥ 5元 + ROI ≥ 1.5
  - **P2** (可选活动): ROI ≥ 1.0
  - **P3** (不推荐): ROI < 1.0
- 数据补全（从 fullText 自动提取）：
  - 活动时间（支持 YYYY/MM/DD 和 MM/DD 格式）
  - 平台补贴金额（最高补/平台补/平台出资）
  - 商家成本（商户出资/商家承担）
  - 平台来源（eleme/meituan）

**门店指标配置：**
```typescript
const STORE_METRICS = {
  '安吉店': { avgOrderValue: 45, grossMargin: 0.25, dailyOrders: 150 },
  '中山店': { avgOrderValue: 42, grossMargin: 0.23, dailyOrders: 120 },
  // ... 8个门店
};
```

**请求参数：**
- `status`: 过滤状态 (all | available | signed_up | expired)

**响应格式：**
```json
{
  "code": 0,
  "data": {
    "list": [
      {
        "id": "1772265898718",
        "name": "爆好价商品特价V1112",
        "status": "available",
        "level": "p0",
        "startTime": "2026/03/01",
        "endTime": "2026/03/15",
        "platformSubsidy": 10,
        "merchantCost": 5,
        "platform": "eleme",
        "url": "https://nr.ele.me/...",
        "fullText": "..."
      }
    ],
    "summary": {
      "total": 50,
      "available": 30,
      "signedUp": 15,
      "expired": 5,
      "p0": 5,
      "p1": 10,
      "p2": 15,
      "p3": 20
    }
  }
}
```

#### 2. `/api/eleme/records` - 报名记录

**数据来源：**
- `报名历史.json` - 历史报名记录
- `activities.json` 中 `status === 'signed_up'` 的活动

**功能：**
- 自动合并多个数据源
- 去重处理
- 补充报名时间、活动时间等信息

#### 3. `/api/eleme/logs` - 执行日志

**数据来源：**
- `~/.openclaw/workspace/skills/eleme-activity-assistant/logs/*.log`

**功能：**
- 支持按日期、级别过滤
- 倒序展示（最新在前）
- 限制返回数量（默认 200，最大 1000）
- 列出所有可用日志文件

**请求参数：**
- `date`: 日期过滤 (YYYYMMDD)
- `level`: 日志级别 (info | warn | error)
- `limit`: 数量限制 (默认 200)

---

### 🚧 第二阶段：前端页面（待实施）

**目标：** 创建饿了么活动管理模块

#### 需要创建的文件：

```
apps/web-antd/src/views/dashboard/eleme/
├── activity-list.vue      # 活动列表 + ROI 推荐
├── activity-records.vue   # 报名记录
└── activity-logs.vue      # 执行日志
```

#### 路由配置：

更新 `apps/web-antd/src/router/routes/modules/dashboard.ts`：

```typescript
{
  name: 'ElemeActivityList',
  path: '/dashboard/eleme/activities',
  component: () => import('#/views/dashboard/eleme/activity-list.vue'),
  meta: {
    icon: 'lucide:activity',
    title: '活动列表',
  },
},
{
  name: 'ElemeActivityRecords',
  path: '/dashboard/eleme/records',
  component: () => import('#/views/dashboard/eleme/activity-records.vue'),
  meta: {
    icon: 'lucide:clipboard-list',
    title: '报名记录',
  },
},
{
  name: 'ElemeActivityLogs',
  path: '/dashboard/eleme/logs',
  component: () => import('#/views/dashboard/eleme/activity-logs.vue'),
  meta: {
    icon: 'lucide:file-text',
    title: '执行日志',
  },
},
```

#### 页面设计参考：

**1. 活动列表页 (`activity-list.vue`)**

**布局：**
- 顶部：筛选器（状态、推荐等级）
- 统计卡片：总数、可报名、已报名、各等级数量
- 表格列：
  - 活动名称（可点击查看详情）
  - 推荐等级（P0/P1/P2/P3 彩色标签）
  - 活动时间
  - 平台补贴 / 商家成本
  - 状态（待报名/已报名/已过期）
  - 操作（查看详情、报名链接）
- 支持排序（按推荐等级、时间）

**功能：**
- 实时刷新
- 跳转到饿了么报名页面
- 标记已报名（调用 OpenClaw API）

**2. 报名记录页 (`activity-records.vue`)**

**布局：**
- 表格列：
  - 活动名称
  - 报名时间
  - 活动时间
  - 平台补贴 / 商家成本
  - 状态
  - 来源（OpenClaw/手动）
- 支持搜索、过滤

**3. 执行日志页 (`activity-logs.vue`)**

**布局：**
- 左侧：日志文件列表（按日期）
- 右侧：日志内容
  - 时间戳
  - 级别（info/warn/error 彩色标签）
  - 消息
  - 数据（可展开 JSON）
- 顶部：级别过滤器、搜索框

---

### 📋 第三阶段：集成优化（待规划）

#### 功能增强：
1. **一键报名** - 前端触发 OpenClaw 自动报名
2. **数据统计** - 报名成功率、ROI 分析
3. **智能提醒** - 浏览器通知（P0 活动提醒）
4. **数据导出** - 导出活动列表为 Excel

#### 性能优化：
1. **缓存策略** - 活动数据缓存 5 分钟
2. **分页加载** - 大数据集分页
3. **WebSocket** - 实时推送新活动

---
