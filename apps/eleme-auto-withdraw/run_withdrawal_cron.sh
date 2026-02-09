: | #!/bin/bash
# 饿了么自动提现定时任务脚本
# 每天11点执行，完成后飞书通知

set -e

# 配置
PROJECT_DIR="/Users/mac/Documents/GitHub/scriptAi/apps/eleme-auto-withdraw"
LOG_DIR="$PROJECT_DIR/logs"
LOG_FILE="$LOG_DIR/withdrawal_$(date '+%Y%m%d').log"

# 创建日志目录
mkdir -p "$LOG_DIR"

# 日志函数
log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

# 检查Node.js
if ! command -v node &> /dev/null; then
    log "❌ 错误: 未找到node命令"
    exit 1
fi

# 检查项目目录
if [ ! -d "$PROJECT_DIR" ]; then
    log "❌ 错误: 项目目录不存在: $PROJECT_DIR"
    exit 1
fi

# 进入项目目录
cd "$PROJECT_DIR"

# 记录开始
log "🚀 开始执行饿了么自动提现任务"
log "项目目录: $PROJECT_DIR"
log "日志文件: $LOG_FILE"

# 检查依赖
if [ ! -d "node_modules" ]; then
    log "⚠️  未找到node_modules，正在安装依赖..."
    npm install >> "$LOG_FILE" 2>&1
    log "✅ 依赖安装完成"
fi

# 运行提现脚本
log "正在执行提现脚本..."
if npm start >> "$LOG_FILE" 2>&1; then
    log "✅ 饿了么自动提现任务执行成功"
    exit_code=0
    result_msg="✅ 饿了么自动提现执行成功"
else
    log "❌ 饿了么自动提现任务执行失败"
    exit_code=1
    result_msg="❌ 饿了么自动提现执行失败，请查看日志: $LOG_FILE"
fi

# 发送飞书通知
log "正在发送飞书通知..."
node <<EOF >> "$LOG_FILE" 2>&1
const { message } = require('openclaw/tools');

async function notify() {
    try {
        await message.send({
            channel: "feishu",
            message: "$result_msg\n\n日志文件: $LOG_FILE\n执行时间: $(date '+%Y-%m-%d %H:%M:%S')"
        });
        console.log("✅ 飞书通知已发送");
    } catch (e) {
        console.error("❌ 发送飞书通知失败:", e.message);
    }
}

notify().catch(console.error);
EOF

log "任务完成"
exit $exit_code
