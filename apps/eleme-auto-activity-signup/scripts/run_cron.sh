: | #!/bin/bash
# 饿了么自动报名活动 - 定时任务脚本
# 每天定时执行活动报名任务

set -e

# 配置
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPT_DIR="$PROJECT_DIR/src"
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
    pip3 install -r requirements.txt --quiet
    log "✅ 依赖安装完成"
}

# 检查Playwright浏览器
log "检查Playwright浏览器..."
python3 -c "from playwright.async_api import async_playwright" 2>/dev/null || {
    log "⚠️  Playwright未安装，正在安装..."
    pip3 install playwright --quiet
    playwright install chromium
    log "✅ Playwright安装完成"
}

# 加载环境变量
if [ -f ".env" ]; then
    log "加载环境变量..."
    export $(cat .env | grep -v '^#' | xargs)
fi

# 记录开始
log "="*60
log "🚀 饿了么自动报名活动任务开始"
log "项目目录: $PROJECT_DIR"
log "日志文件: $LOG_FILE"
log "="*60

# 运行报名脚本
log "正在执行活动报名脚本..."
if python3 "$SCRIPT_DIR/activity_signup.py" >> "$LOG_FILE" 2>&1; then
    log "✅ 活动报名任务执行成功"
    exit_code=0
    result_msg="✅ 饿了么活动报名执行成功"
else
    log "❌ 活动报名任务执行失败"
    exit_code=1
    result_msg="❌ 饿了么活动报名执行失败，请查看日志"
fi

# 发送飞书通知（如果配置了webhook）
if [ -n "$FEISHU_WEBHOOK" ]; then
    log "正在发送飞书通知..."
    python3 <<EOF >> "$LOG_FILE" 2>&1
import requests
import json

webhook = "$FEISHU_WEBHOOK"
message = {
    "msg_type": "text",
    "content": {
        "text": "$result_msg\n\n日志文件: $LOG_FILE\n执行时间: $(date '+%Y-%m-%d %H:%M:%S')"
    }
}

try:
    response = requests.post(webhook, json=message, timeout=10)
    if response.status_code == 200:
        print("✅ 飞书通知已发送")
    else:
        print(f"❌ 飞书通知发送失败: {response.status_code}")
except Exception as e:
    print(f"❌ 发送飞书通知失败: {e}")
EOF
else
    log "⚠️ 未配置FEISHU_WEBHOOK，跳过飞书通知"
fi

log "="*60
log "🏁 饿了么自动报名活动任务结束"
log "="*60

exit $exit_code
