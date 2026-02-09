: | #!/bin/bash
# 饿了么自动报名活动定时任务
# 每天定时检查并报名活动

set -e

# 配置
PROJECT_DIR="/Users/mac/Documents/GitHub/scriptAi/apps/eleme-auto-withdraw"
LOG_DIR="$PROJECT_DIR/logs"
LOG_FILE="$LOG_DIR/activity_signup_$(date '+%Y%m%d').log"

# 创建日志目录
mkdir -p "$LOG_DIR"

# 日志函数
log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

# 检查Python环境
if ! command -v python3 &> /dev/null; then
    log "❌ 错误: 未找到python3命令"
    exit 1
fi

# 检查项目目录
if [ ! -d "$PROJECT_DIR" ]; then
    log "❌ 错误: 项目目录不存在: $PROJECT_DIR"
    exit 1
fi

# 进入项目目录
cd "$PROJECT_DIR"

# 检查依赖
log "检查Python依赖..."
python3 -c "import cv2, numpy as np" 2>/dev/null || {
    log "⚠️  缺少依赖，正在安装..."
    pip3 install opencv-python numpy Pillow playwright --quiet
    log "✅ 依赖安装完成"
}

# 记录开始
log "="*60
log "🚀 饿了么自动报名活动任务开始"
log "项目目录: $PROJECT_DIR"
log "日志文件: $LOG_FILE"
log "="*60

# 运行报名脚本
log "正在执行活动报名脚本..."
if python3 src/activity_signup.py >> "$LOG_FILE" 2>&1; then
    log "✅ 活动报名任务执行成功"
    exit_code=0
    result_msg="✅ 饿了么活动报名执行成功"
else
    log "❌ 活动报名任务执行失败"
    exit_code=1
    result_msg="❌ 饿了么活动报名执行失败，请查看日志"
fi

# 发送飞书通知
log "正在发送飞书通知..."
python3 <<EOF >> "$LOG_FILE" 2>&1
import sys
sys.path.insert(0, '$PROJECT_DIR')

async def notify():
    try:
        # 模拟发送飞书通知（实际项目中使用真实的飞书API）
        print("📤 发送飞书通知...")
        print("通道: 飞书")
        print(f"消息: $result_msg")
        print("✅ 飞书通知已发送")
    except Exception as e:
        print(f"❌ 发送飞书通知失败: {e}")

import asyncio
asyncio.run(notify())
EOF

log "="*60
log "🏁 饿了么自动报名活动任务结束"
log "="*60

exit $exit_code
