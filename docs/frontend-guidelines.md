# Frontend Guidelines

## List Pages

- For backend-style list pages in `apps/web-antd/src/views/**`, prefer [`SimpleTemplate`](../apps/web-antd/src/components/base/SimpleTemplate/index.vue) as the default page shell.
- If the page is primarily "search + table", do not hand-roll `Card + Form + Table` first. Use `SimpleTemplate` unless there is a clear interaction gap that it cannot cover.
- Every search field must provide an explicit `label`. Do not rely on `placeholder` alone to convey meaning.
- Search areas should use inline form layout so the label and render area stay on the same line. Prefer passing `layout="inline"` when using `SimpleTemplate`.
- Put search fields in `searchFormItems` and end the group with the standard `suffixButton` search/reset actions.
- Table column `render` callbacks should be written with JSX/TSX. Do not use `h()` for page-level table renderers unless there is a framework limitation.
- Summary/list pages that aggregate operational logs should provide a clear "查看详情" entry when users need to inspect the underlying event rows or delivery rows.

## Procurement Center

- Procurement center pages such as task lists, store-level sold-out logs, and similar operations tables should align with the existing `SimpleTemplate` pattern used in other management pages.
