#!/bin/bash
# 饿了么自动提现 - 自我进化版定时任务
# 每天 11:10 执行，自动分析优化

set -e

# 配置
PROJECT_DIR="/Users/mac/Documents/GitHub/scripts/apps/eleme-auto-withdraw"
LOG_DIR="$PROJECT_DIR/logs"
LOG_FILE="$LOG_DIR/withdrawal_$(date '+%Y%m%d').log"

# 创建日志目录
mkdir -p "$LOG_DIR"

# 日志函数
log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

log "🚀 开始饿了么自动提现任务（自我进化版）"
log "项目目录：$PROJECT_DIR"

# 进入项目目录
cd "$PROJECT_DIR"

# 检查依赖
if [ ! -d "node_modules" ]; then
    log "⚠️  未找到 node_modules，正在安装依赖..."
    npm install >> "$LOG_FILE" 2>&1
    log "✅ 依赖安装完成"
fi

# 执行自我进化脚本
log "🤖 执行自我进化提现脚本..."
if python3 scripts/self_evolving_executor.py >> "$LOG_FILE" 2>&1; then
    log "✅ 饿了么自动提现任务执行成功"
    exit_code=0
    result_msg="✅ 饿了么自动提现执行成功（自我进化版）"
else
    log "❌ 饿了么自动提现任务执行失败"
    exit_code=1
    result_msg="❌ 饿了么自动提现执行失败，请查看日志：$LOG_FILE"
fi

# 发送飞书通知
log "正在发送飞书通知..."
python3 <<EOF >> "$LOG_FILE" 2>&1
import sys
sys.path.insert(0, '/Users/mac/.openclaw/workspace/scripts/python')
from safe_feishu_send import safe_send

result = safe_send(
    message="$result_msg\n\n日志文件：$LOG_FILE\n执行时间：$(date '+%Y-%m-%d %H:%M:%S')",
    channel="feishu"
)
print("✅ 飞书通知已发送" if result.get('success') else f"⚠️ 发送结果：{result}")
EOF

log "任务完成"
exit $exit_code
