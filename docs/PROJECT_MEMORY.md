# Project Memory

This document captures the durable understanding of the current repository so future Codex sessions do not have to rediscover the basics.

## 1. High-level summary

The repository started from `vue-vben-admin` but has been repurposed into an internal merchant tools platform.

It currently mixes:

- admin UI screens
- local Excel processing tools
- Electron IPC-powered desktop workflows
- browser automation for Eleme-related operations
- a Nitro mock backend that acts as both auth/menu service and a thin adapter over local JSON data

## 2. Monorepo structure

Top-level packages that matter most:

- `apps/web-antd`
  - the main Vue 3 app
  - includes Electron main/preload code
  - contains most user-facing features
- `apps/backend-mock`
  - Nitro/H3 backend
  - mock auth/menu endpoints
  - Eleme activity/records/log endpoints
- `packages/*`
  - shared vben packages and utilities
- `internal/*`
  - lint/build/tsconfig/tailwind/vite support
- `scripts/turbo-run`
  - interactive helper used by root `pnpm dev`
- `scripts/vsh`
  - lint/check helper package

## 3. Runtime architecture

### Frontend

`apps/web-antd` is a Vite app using Vue 3 and Ant Design Vue.

The bootstrap path is:

- `apps/web-antd/src/main.ts`
- `apps/web-antd/src/bootstrap.ts`
- router from `apps/web-antd/src/router`

The app enables:

- i18n
- Vben component adapters
- form adapter
- motion plugin
- auth/token interceptors

### Backend

`apps/backend-mock` is a Nitro app.

Observed responsibilities:

- login / refresh / logout
- menu and user info
- activity center APIs
- finance/purchase/store/supplier mock endpoints

The frontend dev server proxies `/api` to `http://localhost:5320/api`.

### Electron

`apps/web-antd/electron/main.ts` registers IPC handlers for:

- Eleme activity sheet generation
- Eleme baohaojia processing
- procurement Excel conversion
- procurement plan generation
- procurement task execution
- store/supplier/merchant/task JSON storage
- app auto-update events

`apps/web-antd/electron/preload.ts` exposes a curated `window.ipcRenderer` bridge with an allowlist.

## 4. Current product areas

### Dashboard workspace

The dashboard home is `apps/web-antd/src/views/dashboard/workspace/index.vue`.

It acts like a launcher for the main internal tools:

- Excel convert
- Eleme script conversion
- Eleme baohaojia helper
- Procurement plan generator

These pages are under `apps/web-antd/src/views/dashboard/tools`.

### Activity center

Activity center routes exist already and are not just planned docs:

- `/activity/list`
- `/activity/detail/:id`
- `/activity/records`
- `/activity/logs`

Key files:

- `apps/web-antd/src/router/routes/modules/activity.ts`
- `apps/web-antd/src/views/activity/list/index.vue`
- `apps/web-antd/src/views/activity/detail/index.vue`
- `apps/web-antd/src/views/activity/records/index.vue`
- `apps/web-antd/src/views/activity/execution-logs/index.vue`

This area uses `requestClient` to call backend mock endpoints such as:

- `/eleme/activities`
- `/eleme/records`
- `/eleme/logs`

The list page includes:

- summary cards
- recommendation levels `p0` to `p3`
- search/status filtering
- export to Excel
- detail drawer

### Procurement tooling

There are two procurement-related flows:

1. `process-excel-buffers`
   - Excel conversion/analyzer flow
2. `generate-procurement-plan`
   - procurement plan generation flow

The newer plan generation implementation is in:

- `apps/web-antd/electron/features/procurement/plan-generator.ts`
- tests in `apps/web-antd/electron/features/procurement/__tests__/plan-generator.test.ts`

Observed behavior:

- takes one or more source Excel files
- normalizes them into the Aoxiang import template
- currently only supports target type `aoxiang`
- hardcodes supplier code `2168183`
- saves through Electron save dialog

### Eleme automation

There are two separate Eleme-related areas:

1. `eleme-activity`
   - large automation/orchestration area
   - activity collection, signup, status checking, data transforms
2. `eleme-baohaojia`
   - Excel/helper flow for promotional activity handling

The backend activity APIs depend on OpenClaw-generated JSON/log files rather than a database.

## 5. OpenClaw data dependency

The Eleme activity backend is tightly coupled to an external local workspace:

- `~/.openclaw/workspace/skills/eleme-activity-assistant/data`
- `~/.openclaw/workspace/skills/eleme-activity-assistant/logs`

`apps/backend-mock/api/eleme/activities.ts`:

- reads `activities.json`
- merges signup results from `super_brand_signup_*.json`
- merges signup history from `报名历史.json`
- merges history from `activities_history.json`
- derives activity fields from text when needed
- computes recommendation levels using a simple ROI heuristic

Important environment note:

- The path uses `process.env.HOME`
- On Windows, that may not be set
- If activity pages appear empty on Windows, check `HOME` first

## 6. Auth model

Auth is fully mock-based right now.

Files:

- `apps/backend-mock/api/auth/login.post.ts`
- `apps/backend-mock/api/auth/refresh.post.ts`
- `apps/backend-mock/utils/mock-data.ts`

Known accounts:

- `vben / 123456`
- `admin / password`
- `jack / 123456`

JWT secrets are hardcoded mock secrets in `apps/backend-mock/utils/jwt-utils.ts`.

## 7. Persistence model caveat

There is a notable split between renderer and Electron persistence:

- renderer code for stores/suppliers uses IndexedDB through `apps/web-antd/src/api/system-settings-repo.ts`
- Electron main also exposes JSON storage in `apps/web-antd/electron/shared/storage.ts`

This means future changes to store/supplier/merchant flows must first confirm which storage path is the real source of truth for the current UI.

Do not assume Electron JSON storage is already what the renderer uses.

## 8. Withdrawal automation status

The Eleme withdrawal flow is no longer just a local script. It is now integrated into the desktop product.

Core files:

- `apps/web-antd/electron/features/withdrawal-task`
- `apps/web-antd/src/api/withdrawal-task.ts`
- `apps/web-antd/src/router/routes/modules/withdrawal.ts`
- `apps/web-antd/src/views/withdrawal-task/index.vue`
- `apps/web-antd/electron/main.ts`
- `apps/web-antd/electron/preload.ts`

Current product integration:

- top-level route `/withdrawal`
- child page `/withdrawal/task`
- page supports manual execution
- page opens a real-time log modal during execution
- renderer subscribes to `withdrawal-log`
- Electron IPC entry is `execute-withdrawal-task`

Automation traits:

- Playwright-style browser automation
- supports `--stores` and `--dry-run`
- root script is `pnpm dev:withdraw`
- CLI entry is `withdrawal-cli.ts`
- bridge entry is `automation-bridge.ts`
- reads env vars like `ELEME_PASSWORD`, `ELEME_TARGET_STORES`, `MIN_WITHDRAW_AMOUNT`, `WITHDRAWAL_DRY_RUN`

Execution assumptions that must remain stable:

- store context must be read before switching, after switching, and again before withdrawal
- if the current store does not match the target store, execution must fail fast
- store selection must use exact candidate matching and must not fall back to chain-level aliases
- a store only counts as success when all positive-balance accounts have been withdrawn successfully
- account detection should be driven by visible withdrawal controls, not page-level summary amounts

Reference implementation for the durable rules:

- `apps/web-antd/electron/features/withdrawal-task/automation/store-rules.js`
- `apps/web-antd/electron/features/withdrawal-task/__tests__/store-rules.test.ts`

Operational detail:

- the finance route that matched the current Eleme console is `https://nr.ele.me/app/eleme-nr-bfe-newretail/common-next#/pc/accountManagementPc/accountFlow`
- runtime data and debug artifacts may appear in repo root:
  - `user_data/`
  - `coords.json`
  - `evolution.json`
  - `logs/`
  - `debug/`

Do not treat those runtime artifacts as normal source files.

## 9. Release workflow risk

The repository currently has one release workflow:

- `.github/workflows/release-electron.yml`
- human-readable SOP: `docs/RELEASE_PROCESS.md`

Observed behavior:

- triggers on `push` to `main`
- only runs when paths under `apps/web-antd/**`, `packages/**`, or the workflow file itself change
- bumps both root `package.json` and `apps/web-antd/package.json`
- commits the bump from GitHub Actions
- creates a release tag from GitHub Actions
- current local fix replaces `git push origin main --tags --force` with `git push origin HEAD:main --follow-tags`
- current local fix also changes the tag to an annotated tag so `--follow-tags` will publish it

Important caution:

- older versions of this workflow used force-push semantics and were risky
- even with the safer local fix, pushing local work directly to `main` still triggers release automation
- if a future session needs to trigger release automation, validate the branch state first
- treat the workflow as release infrastructure, not as a harmless CI build

## 10. Local-worktree observations

At the time this memory was written, the worktree was not clean.

Observed local changes/artifacts included:

- `package.json` modified to add `dev:withdraw`
- untracked `apps/web-antd/electron/features/withdrawal-task/`
- untracked `debug/`
- untracked `coords.json`
- untracked `user_data/`

Future sessions should avoid reverting unrelated changes without explicit user instruction.

## 11. Practical guidance for future sessions

- Start by reading `AGENTS.md`, then this file.
- If working on UI/business flows, inspect `apps/web-antd/src/views/*` and matching routes.
- If working on local processing, inspect Electron IPC handlers in `apps/web-antd/electron/main.ts`.
- If working on activity center issues, inspect both frontend pages and `apps/backend-mock/api/eleme/*`.
- If activity data looks missing on Windows, verify the OpenClaw path resolution before debugging the UI.
- If changing store/supplier persistence, verify whether the code path is IndexedDB or Electron JSON storage.
- If changing withdrawal logic, start with `store-rules.js`, `automation-bridge.ts`, and the manual UI page before touching selectors.
- Before any release push, inspect `.github/workflows/release-electron.yml` and verify the action is still using the safer non-force push path.
- Avoid treating runtime artifacts from withdrawal automation as normal source files.

## 12. Likely next areas of work

Based on the current tree, the most likely ongoing custom product work is:

- finishing or stabilizing withdrawal automation
- continuing Eleme activity tooling
- improving procurement workflows
- tightening the integration between web UI, Electron utilities, and local automation data

## 13. Current architecture direction

The repository should now be understood as an early-stage **即时零售运营自动化中台**, not just a collection of desktop helper scripts.

The intended business split is:

- **线上运营 domain**
  - platform activity discovery
  - activity recommendation
  - signup gating
  - activity-type-specific signup material generation
  - batch signup task orchestration
- **采购 domain**
  - product master
  - procurement cost
  - supplier constraints
  - procurement rules and suggestion logic
- **inventory / alerting domain**
  - inventory health
  - shortage / oversell / stale stock warnings
  - execution and alert closure

Important boundary:

- online-ops may depend on procurement and product-master data
- but activity signup workflows still belong to online-ops, not procurement

Concrete example already present in the tree:

- Eleme 爆好价报名 is not only a recommendation problem
- it uses a type-specific Excel conversion flow
- that conversion reads product-master / procurement-cost data
- and outputs signup material for batch activity operations

Relevant files for that chain:

- `apps/web-antd/electron/features/eleme-baohaojia/index.ts`
- `apps/web-antd/electron/features/eleme-activity/automation/transform-baohao.ts`
- `apps/web-antd/electron/features/product-master/index.ts`
- `apps/web-antd/electron/features/eleme-activity/index.ts`

## 14. AI decision layer status

An initial activity decision layer now exists in backend-mock and should be treated as the first middle-platform AI module rather than a final production policy engine.

Current files:

- `apps/backend-mock/utils/decision/activity-catalog.ts`
- `apps/backend-mock/utils/decision/activity-ai.ts`
- `apps/backend-mock/utils/decision/activity-decision.ts`
- `apps/backend-mock/api/decision/activity/recommend.post.ts`
- `apps/web-antd/src/api/activity-decision.ts`

Current behavior:

- normalizes Eleme activity data and signup history
- computes ROI and score/risk
- applies hard gates before AI enhancement
- outputs structured `allow / review / block`
- suggests `auto_apply / manual_review / skip`

Important implementation rule:

- this decision layer should stay in **shadow / advisory / bounded** mode until it is validated against the real production behavior already used in `scripts`
- do not replace mature execution logic with inferred rules without side-by-side comparison

## 15. Operator entry layer

There is now a dedicated OpenClaw + Feishu agent for this repository:

- agent: `scripts-codex`
- workspace: `/Users/mac/Documents/GitHub/scripts`
- role: project-specific operator / copilot for the `scripts` repository

The agent is intended to be the formal natural-language entrypoint for this project, but it should call structured middle-platform interfaces and task flows rather than directly turning free text into high-risk platform actions.

## 16. Skill guidance

For future sessions, the preferred skill split is:

- `scripts-online-ops`
  - online operations rules
  - Eleme / Meituan platform activity and execution boundaries
  - common online-ops middle-platform model
- procurement skill (future / separate)
  - cost price
  - supplier rules
  - procurement suggestion and purchasing constraints

Do not merge online-ops and procurement into one business skill. They collaborate, but they are different domains.
