# 架构说明

## 前端

新增 API 模块：

- `src/api/decision-center.ts`
- `src/api/product-master.ts`
- `src/api/product-compare.ts`

页面改造：

- `src/views/decision-center/index.vue`
- `src/views/dashboard/tools/product-master.vue`
- `src/views/product/compare/index.vue`

## 后端

新增 Fastify 路由：

- `GET/PUT /api/decision-center/product-compare/config`
- `GET /api/product/master/status`
- `GET /api/product/master/filter-options`
- `GET /api/product/master/records`
- `POST /api/product/master/refresh`
- `POST /api/product/master/import`
- `POST /api/product/compare/run`

新增后端能力库：

- `src/lib/excel.ts`
- `src/lib/product-master.ts`
- `src/lib/product-compare.ts`

## 存储策略

1. 系统设置主数据继续使用 SQLite。
2. 商品总表和商品比对配置使用后端运行时目录持久化，统一由 `scripts-backend` 管理。
3. 商品总表导入采用 `base64 + JSON body`，避免新增 multipart 依赖和前后端协议复杂度。
