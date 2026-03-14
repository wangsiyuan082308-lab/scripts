#!/bin/bash
# 提现任务 - Scripts 触发
# LaunchAgent: /Users/mac/Library/LaunchAgents/com.oby.eleme-withdrawal.plist

SCRIPTS_DIR="/Users/mac/.openclaw/scripts"
LOG_DIR="$SCRIPTS_DIR/logs"
LOG_FILE="$LOG_DIR/withdrawal_$(date +%Y%m%d).log"

# 原脚本路径
ORIGINAL_SCRIPT="/Users/mac/.openclaw/skills-pool/business/eleme-auto-withdrawal"

mkdir -p "$LOG_DIR"

{
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] 提现任务启动 (Scripts)"
  
  cd "$ORIGINAL_SCRIPT"
  npm run start
  
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] 提现任务结束"
} >> "$LOG_FILE" 2>&1