#!/bin/bash
# 清理浏览器锁文件和残留进程

echo "🔧 正在清理浏览器环境..."

# 1. 强制关闭残留Chrome进程
echo "  → 关闭残留Chrome进程..."
pkill -f "Google Chrome for Testing" 2>/dev/null || true
pkill -f "Chromium" 2>/dev/null || true
sleep 2

# 2. 删除锁文件
echo "  → 删除锁文件..."
rm -f "$(dirname "$0")/user_data/SingletonLock"
rm -f "$(dirname "$0")/user_data/SingletonSocket"

# 3. 清理临时文件
echo "  → 清理临时文件..."
rm -rf "$(dirname "$0")/user_data/Default/Cache"/* 2>/dev/null || true

echo "✅ 浏览器环境清理完成！"
