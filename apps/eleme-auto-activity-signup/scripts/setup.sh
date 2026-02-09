: | #!/bin/bash
# 饿了么自动报名活动 - 安装脚本
# 一键安装所有依赖和配置

set -e

echo "🚀 开始安装饿了么自动报名活动..."

# 检查Python版本
python_version=$(python3 --version 2>&1 | awk '{print $2}')
echo "✅ Python版本: $python_version"

# 检查pip
if ! command -v pip3 &> /dev/null; then
    echo "❌ 未找到pip3，请先安装pip3"
    exit 1
fi
echo "✅ pip3已安装"

# 安装Python依赖
echo "📦 安装Python依赖..."
pip3 install -r requirements.txt
echo "✅ Python依赖安装完成"

# 安装Playwright浏览器
echo "🌐 安装Playwright浏览器..."
playwright install chromium
echo "✅ Playwright浏览器安装完成"

# 复制环境变量模板
if [ ! -f ".env" ]; then
    echo "📋 创建环境变量配置文件..."
    cp .env.template .env
    echo "✅ 环境变量配置文件已创建，请编辑 .env 文件填写实际值"
else
    echo "⚠️  .env文件已存在，跳过创建"
fi

# 创建必要目录
echo "📁 创建必要目录..."
mkdir -p logs screenshots
echo "✅ 目录创建完成"

# 设置脚本权限
echo "🔧 设置脚本权限..."
chmod +x scripts/run_cron.sh
echo "✅ 脚本权限设置完成"

# 安装完成提示
echo ""
echo "="*60
echo "🎉 安装完成！"
echo "="*60
echo ""
echo "下一步操作:"
echo "1. 编辑 .env 文件，填写实际配置:"
echo "   - ELEME_ACTIVITY_URL (饿了么活动页面URL)"
echo "   - STORE_NAMES (门店名称)"
echo "   - FEISHU_WEBHOOK (飞书Webhook，可选)"
echo ""
echo "2. 测试运行:"
echo "   python3 src/activity_signup.py"
echo ""
echo "3. 设置定时任务 (可选):"
echo "   crontab -e"
echo "   添加: 0 10 * * * $(pwd)/scripts/run_cron.sh"
echo ""
echo "="*60
