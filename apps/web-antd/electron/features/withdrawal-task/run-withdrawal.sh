#!/bin/bash
# 饿了么自动提现脚本入口

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../../../../.." && pwd)"
LOG_DIR="$REPO_ROOT/logs"
LOG_FILE="$LOG_DIR/withdrawal_$(date +%Y%m%d).log"

mkdir -p "$LOG_DIR"

{
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] 提现任务启动"
  cd "$REPO_ROOT"
  pnpm exec tsx apps/web-antd/electron/features/withdrawal-task/withdrawal-cli.ts "$@"
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] 提现任务结束"
} >> "$LOG_FILE" 2>&1
