# Project Map

This document explains the current workspace shape, the responsibility split between repositories, and the frontend conventions that matter during debugging.

## 1. Workspace

Under `C:\Users\31314\Documents\GitHub` there are two primary repositories:

- `scripts`
  - frontend workspace
  - main Vue/Vite/Electron application lives here
  - shared Vben packages also live here
- `scripts-backend`
  - standalone Fastify backend
  - current unified backend entry for business APIs

The current runtime split is:

- `scripts` = operator console, desktop tooling, Electron bridge
- `scripts-backend` = backend APIs and data services

## 2. scripts Repository

### 2.1 Main app

- `apps/web-antd`
  - main web application
  - also contains Electron `main` and `preload`
  - built on top of the Vben route/layout/tabbar/preferences system

### 2.2 Shared packages

- `packages/@core/preferences`
  - default preferences and runtime preference helpers
- `packages/stores`
  - tabbar storage, route refresh behavior, access state
- `packages/effects/layouts`
  - layout shell, menu, tabbar, content area, preferences drawer
- `packages/@core/base/typings`
  - route meta typings such as `keepAlive`, `activePath`, and `fullPathKey`

### 2.3 Current product areas

- dashboard / workspace
- activity center
- decision center
- product center
- procurement
- finance / withdrawal
- merchant / store / supplier / account management

## 3. Frontend Architecture Notes

The frontend is based on Vben, so route behavior must be understood through Vben conventions first.

### 3.1 Relevant switches

- global cache ability:
  - `preferences.tabbar.enable`
  - `preferences.tabbar.keepAlive`
- route-level cache:
  - `meta.keepAlive`
- menu highlight only:
  - `meta.activePath`
- route/tab identity:
  - `meta.fullPathKey`
- tab persistence across reload:
  - `preferences.tabbar.persist`

### 3.2 Relevant files

- `apps/web-antd/src/preferences.ts`
- `apps/web-antd/src/router/routes/modules/*`
- `packages/@core/preferences/src/config.ts`
- `packages/@core/preferences/src/use-preferences.ts`
- `packages/@core/base/typings/src/vue-router.d.ts`
- `packages/effects/layouts/src/basic/content/content.vue`
- `packages/stores/src/modules/tabbar.ts`
- `packages/effects/layouts/src/widgets/preferences/preferences-drawer.vue`

### 3.3 Practical rule

If a page seems stale, cached, or "does not refresh", inspect the Vben preference switches and route meta before changing the page component itself.

For more detail, read:

- [VBEN_FRONTEND_NOTES.md](./VBEN_FRONTEND_NOTES.md)

## 4. Frontend Conventions

For business CRUD pages in `apps/web-antd`, prefer the repository's existing base components instead of rebuilding common scaffolding page by page.

- list pages should default to `SimpleTemplate`
- popup create/edit forms should default to `BaseModelForm`
- form item schemas should follow `BaseForm`'s `child` structure
- page requests should go through `src/api/*` modules and `requestClient`

Practical rule:

- merchant / store / supplier / account style pages should normally be implemented as `SimpleTemplate + BaseModelForm + BaseForm`
- only bypass those abstractions when the interaction requirement clearly cannot be expressed with the existing components

## 5. Backend Relationship

Frontend business requests should go to `scripts-backend`.

Important current note:

- local mock service has been removed from the current runtime path
- if old documentation mentions `apps/backend-mock`, treat that as historical context only

## 6. Recommended Reading Order

1. `scripts/README.md`
2. `scripts/docs/PROJECT_MEMORY.md`
3. `scripts/docs/VBEN_FRONTEND_NOTES.md`
4. `scripts-backend/README.md`
