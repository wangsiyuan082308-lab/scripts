# Vben Frontend Notes

This repository uses Vben as the frontend shell for routing, tabbar, layout, and preferences. When debugging "page does not refresh", "page looks cached", or "same route click behaves strangely", always inspect the Vben switches first.

## Core rules

- Global page-cache ability is controlled by `preferences.tabbar.enable` and `preferences.tabbar.keepAlive`.
- Route-level page cache is controlled by `meta.keepAlive`.
- `activePath` is only for menu highlight and parent-menu activation.
- `fullPathKey` controls whether the route/tab instance key uses `fullPath` or `path`.
- `persist` only controls whether open tabs survive a reload. It is not the same thing as component cache.

## Local source of truth

- App override preferences:
  - `apps/web-antd/src/preferences.ts`
- Default Vben preferences:
  - `packages/@core/preferences/src/config.ts`
- Preference-derived runtime switches:
  - `packages/@core/preferences/src/use-preferences.ts`
- Route meta typings:
  - `packages/@core/base/typings/src/vue-router.d.ts`
- Layout content rendering:
  - `packages/effects/layouts/src/basic/content/content.vue`
- Tab storage and refresh behavior:
  - `packages/stores/src/modules/tabbar.ts`
- Preferences UI:
  - `packages/effects/layouts/src/widgets/preferences/preferences-drawer.vue`
  - `packages/effects/layouts/src/widgets/preferences/blocks/layout/tabbar.vue`

## Current repository observations

- The project keeps Vben's global tabbar cache ability enabled by default.
- Most business routes in `apps/web-antd/src/router/routes/modules/*` do not explicitly declare `meta.keepAlive`.
- Therefore, not every screen should be assumed to be cached just because the tabbar is enabled.
- If a screen appears stale, first verify whether the route actually opted into `meta.keepAlive`.

## Recommended debugging order

1. Check whether the issue happens on menu click, tab click, browser back/forward, or programmatic `router.push`.
2. Check the active Vben preferences, especially `tabbar.enable`, `tabbar.keepAlive`, and `tabbar.persist`.
3. Check the route meta for `keepAlive`, `activePath`, `fullPathKey`, `hideInTab`, and `maxNumOfOpenTab`.
4. Only after that, inspect page-level lifecycle hooks such as `onMounted` and `onActivated`.

## Frontend Conventions

When building or modifying pages in `apps/web-antd`, prefer the repository's existing base abstractions over writing raw page scaffolding from scratch.

### List pages

Use `SimpleTemplate` as the default entry for CRUD-style list pages.

- `SimpleTemplate` already wraps:
  - `BaseSearchGroup`
  - `BaseTableGroup`
  - common search handling
  - table loading state
  - request binding
  - exposed `search()` refresh method
- Prefer `searchFormItems`, `columns`, `headerOptions`, and `serveMethods` instead of hand-rolling a separate search area and table container.

Relevant file:

- `apps/web-antd/src/components/base/SimpleTemplate/index.vue`

### Modal forms

Use `BaseModelForm` for popup forms and `BaseForm` conventions for form item structure.

- `BaseModelForm` is the standard modal form wrapper.
- `BaseForm` expects field config in the `child` shape.
- Standard form item structure should look like:
  - `label`
  - `rules`
  - `show`
  - `child: { renderType, valueKey, ... }`
- Do not mix page-local ad hoc form config shapes when the page is already following the base form system.

Relevant files:

- `apps/web-antd/src/components/base/BaseModelForm/index.vue`
- `apps/web-antd/src/components/base/BaseForm/BaseForm.vue`
- `apps/web-antd/src/components/base/BaseForm/BaseFormRender.vue`

### Request layer

- Prefer the existing API modules under `apps/web-antd/src/api/*`.
- Prefer `requestClient` rather than creating page-local request wrappers.
- Keep normalization logic inside the API module when possible.

### Page implementation rule

For system-style management pages such as merchant, store, supplier, and account:

- list view: `SimpleTemplate`
- popup edit/create: `BaseModelForm`
- form schema: `BaseForm` child config

Only bypass these abstractions when there is a clear interaction requirement they cannot support.

## Official references

- [Vben settings](https://doc.vben.pro/guide/essentials/settings.html)
- [Vben routes and menu meta](https://doc.vben.pro/guide/essentials/route.html)
