# Eleme Withdrawal Automation

## Run

From the repo root:

```bash
pnpm dev:withdraw
```

Run specific stores:

```bash
pnpm exec tsx apps/web-antd/electron/features/withdrawal-task/withdrawal-cli.ts --stores "安吉店,长兴店"
```

Safe validation without opening the real withdrawal flow:

```bash
pnpm exec tsx apps/web-antd/electron/features/withdrawal-task/withdrawal-cli.ts --dry-run
```

## Environment

Optional environment variables:

- `ELEME_PASSWORD`: withdrawal password
- `ELEME_TARGET_STORES`: comma-separated default store names
- `MIN_WITHDRAW_AMOUNT`: skip withdrawal when balance is less than or equal to this amount
- `WITHDRAWAL_DRY_RUN`: set to `1`/`true` to skip real browser actions

The script reads `.env` automatically through `dotenv/config`.

## Runtime Files

Generated in the repo root:

- `user_data/`: Playwright persistent browser profile
- `coords.json`: learned click coordinates
- `evolution.json`: adaptive timing config
- `logs/`: runtime logs and screenshots

## Stability Rules

These rules are intentionally baked into the code now so future refactors do not
quietly change live-withdrawal behavior:

- The script reads the current store before switching, after switching, and again right
  before withdrawal. If the active store does not match the target store, execution fails
  instead of continuing in the wrong context.
- Dropdown search for stores uses only store-specific candidates such as
  `目标门店`, `目标门店单店`, and the branch name. Chain-level aliases are only kept as
  fallback references for finance pages and diagnostics, not for store selection.
- A store is marked `success` only when every actionable account succeeds. Zero-balance
  accounts are skipped, but they no longer mask a failed positive-balance withdrawal.
- Account scanning is derived from visible `提现` buttons so the page-level total amount is
  not mistaken for a withdrawable account.

## Suggested Checks

Use these before touching the live flow:

```bash
pnpm exec vitest run apps/web-antd/electron/features/withdrawal-task/__tests__/store-rules.test.ts
pnpm exec tsx apps/web-antd/electron/features/withdrawal-task/withdrawal-cli.ts --dry-run
```
