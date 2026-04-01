# Project Memory

This document records the current durable understanding of the `scripts` repository so future sessions do not have to rediscover the same system boundaries.

## 1. Current identity

This repository is no longer a generic `vue-vben-admin` demo. It should be understood as the frontend and desktop workspace for an internal merchant operations platform.

It currently combines:

- Vben-based web admin screens
- Electron desktop capabilities
- local Excel processing tools
- browser automation support
- operator-facing business workflows

## 2. Repository boundary

### scripts

Primary responsibilities:

- web frontend
- Electron main/preload bridge
- local desktop tooling
- shared Vben packages

### scripts-backend

Primary responsibilities:

- auth
- merchant/store/supplier/account APIs
- activity APIs
- finance APIs
- decision APIs
- procurement APIs

Important current rule:

- frontend business APIs should be treated as going through `scripts-backend`
- old `backend-mock` references are historical only

## 3. Frontend system model

`apps/web-antd` uses Vben for:

- route generation
- layout shell
- tabbar behavior
- preference-driven runtime switches
- keep-alive integration

This means "page refresh" and "page cache" behavior should never be judged as plain Vue Router behavior only.

## 4. Vben cache and refresh rules

### 4.1 Global switches

The global ability for page caching is controlled by:

- `preferences.tabbar.enable`
- `preferences.tabbar.keepAlive`

Relevant files:

- `packages/@core/preferences/src/config.ts`
- `packages/@core/preferences/src/use-preferences.ts`

### 4.2 Route-level switches

Route behavior is further controlled by route meta:

- `keepAlive`
  - page-level cache opt-in
- `activePath`
  - menu highlight only
- `fullPathKey`
  - whether route/tab identity uses `fullPath` or `path`
- `hideInTab`
  - tab visibility
- `maxNumOfOpenTab`
  - duplicate tab limit

Relevant file:

- `packages/@core/base/typings/src/vue-router.d.ts`

### 4.3 Important distinction

- `persist` means tabs survive reload
- `keepAlive` means component instance caching

Do not confuse the two during debugging.

### 4.4 Practical debugging order

When a page "does not refresh", "seems cached", or "reuses old state", inspect in this order:

1. Which user action triggered it:
   - menu click
   - tab click
   - browser back/forward
   - programmatic `router.push`
2. Current Vben preferences:
   - `tabbar.enable`
   - `tabbar.keepAlive`
   - `tabbar.persist`
3. Route meta:
   - `keepAlive`
   - `activePath`
   - `fullPathKey`
4. Only then inspect page lifecycle hooks such as `onMounted` or `onActivated`

## 5. Preferences UI note

The repository previously exposed tabbar switches such as `persist`, `draggable`, and `wheelable`, but did not expose the official `tabbar.keepAlive` switch in the preferences drawer.

That gap has now been documented and wired into the preferences UI.

Relevant files:

- `packages/effects/layouts/src/widgets/preferences/preferences-drawer.vue`
- `packages/effects/layouts/src/widgets/preferences/blocks/layout/tabbar.vue`
- `packages/locales/src/langs/en-US/preferences.json`
- `packages/locales/src/langs/zh-CN/preferences.json`

## 6. Main business areas

Current major frontend areas include:

- dashboard / workspace
- activity center
- decision center
- product center
- procurement
- finance / withdrawal
- merchant / store / supplier / account management

## 7. Frontend implementation rule

For standard management pages, do not start from raw tables, raw forms, and page-local request wrappers unless there is a clear reason.

Preferred composition:

- list page: `SimpleTemplate`
- popup form: `BaseModelForm`
- form schema: `BaseForm` child config
- request layer: `src/api/*` + `requestClient`

This is the default expectation for merchant, store, supplier, account, and similar CRUD-style pages.

## 8. Operational guidance

- Before changing route refresh behavior, read `docs/VBEN_FRONTEND_NOTES.md`.
- Before changing backend assumptions, also read `C:\Users\31314\Documents\GitHub\scripts-backend\README.md`.
- Avoid assuming an old mock-based architecture unless you have verified the referenced file still exists.
