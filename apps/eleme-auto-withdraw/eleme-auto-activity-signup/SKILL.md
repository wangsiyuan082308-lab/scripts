: | ---
name: eleme-auto-activity-signup
description: >
  饿了么自动报名活动 - 基于Playwright + OpenCV的图像识别自动化。
  定时截图识别活动页面，自动检测并点击报名按钮，支持定期清理旧截图和飞书通知。
version: 1.0.0
---

# 饿了么自动报名活动 v1.0.0

基于Playwright + OpenCV的图像识别自动化，定时检测饿了么活动页面并自动报名。

## ✨ 功能特性

- 🤖 **自动截图识别** - 定时截取活动页面并识别报名按钮
- 🎯 **智能图像识别** - 基于OpenCV的颜色识别和按钮检测
- 🔔 **自动报名** - 检测到活动自动点击报名
- 🗑️ **定期清理** - 自动删除7天前的旧截图
- 📝 **完整日志** - 详细操作日志记录
- 📱 **飞书通知** - 报名结果飞书消息推送
- 📊 **Dashboard支持** - 日志和截图可用于可视化展示

## 📋 前置要求

- Python 3.8+
- Node.js 14+（可选，用于Dashboard）
- Playwright浏览器驱动
- OpenCV

## 🚀 快速开始

### 1. 安装依赖

```bash
cd eleme-auto-activity-signup
pip install -r requirements.txt
playwright install chromium
```

### 2. 配置环境变量

```bash
cp .env.template .env
# 编辑 .env 文件，填写配置
```

### 3. 运行报名任务

**手动运行**：
```bash
python src/activity_signup.py
```

**定时任务**：
```bash
./scripts/run_cron.sh
```

## 🎯 工作流程

```
定时任务启动 → 打开活动页面 → 截图 → 
图像识别（检测报名按钮）→ 自动点击报名 → 
截图保存 → 飞书通知 → 定期清理旧截图
```

## 📁 项目结构

```
eleme-auto-activity-signup/
├── SKILL.md                          # 技能文档
├── requirements.txt                  # Python依赖
├── .env.template                     # 环境变量模板
├── src/
│   ├── activity_signup.py          # 主报名脚本
│   ├── image_recognition.py        # 图像识别模块
│   └── notification.py               # 飞书通知模块
├── scripts/
│   ├── run_cron.sh                   # 定时任务脚本
│   └── setup.sh                      # 安装脚本
├── logs/                             # 日志目录
│   └── activity_signup_YYYYMMDD.log
└── screenshots/                      # 截图目录
    └── *.png
```

## ⚙️ 配置说明

### 环境变量 (.env)

```bash
# 饿了么活动页面URL
ELEME_ACTIVITY_URL=https://nr.ele.me/app/eleme-nr-bfe-newretail/common-next#/pc/activityCenter

# 门店名称（多个用逗号分隔）
ELEME_STORES=Oby便利超市(安吉店),Oby便利超市(长兴店)

# 飞书Webhook（用于通知）
FEISHU_WEBHOOK=https://open.feishu.cn/open-apis/bot/v2/hook/your-webhook-token

# 截图保留天数
SCREENSHOT_KEEP_DAYS=7

# 图像识别阈值（0-1）
MATCH_THRESHOLD=0.8

# Playwright配置
PLAYWRIGHT_HEADLESS=false  # true为无头模式
```

### 活动关键词

在`src/config.py`中配置需要识别的活动关键词：

```python
ACTIVITY_KEYWORDS = [
    "报名",
    "立即报名",
    "参与活动",
    "领取",
    "立即参与"
]
```

## 🎯 图像识别原理

### 1. 颜色识别

基于OpenCV的颜色空间转换（HSV）识别报名按钮：

- **橙色/红色按钮**：报名按钮通常使用醒目的颜色
- **颜色范围**：HSV颜色空间过滤
- **轮廓检测**：查找按钮区域

### 2. 文字识别（可选）

集成Pytesseract OCR识别按钮文字：

```python
# 安装
pip install pytesseract

# 配置Tesseract路径（如果需要）
# Windows: C:\Program Files\Tesseract-OCR\tesseract.exe
# Mac: brew install tesseract
```

### 3. 模板匹配（高级）

如果有按钮模板图片，可以使用模板匹配：

```python
# 在screenshots/目录放置按钮模板
# template_button.png

template = cv2.imread('screenshots/template_button.png', 0)
result = cv2.matchTemplate(gray, template, cv2.TM_CCOEFF_NORMED)
```

## 📝 日志说明

### 日志文件

- **路径**：`logs/activity_signup_YYYYMMDD.log`
- **格式**：`[时间戳] 日志级别 消息内容`

### 日志示例

```
[2026-02-09 10:00:00] 🚀 开始执行饿了么自动报名活动
[2026-02-09 10:00:05] 🌐 正在打开活动页面: https://nr.ele.me/...
[2026-02-09 10:00:10] 📸 截图已保存: screenshots/activity_page_20260209_100010.png
[2026-02-09 10:00:15] 🔍 发现 3 个报名按钮
[2026-02-09 10:00:16] 🖱️ 点击坐标: (450, 320)
[2026-02-09 10:00:18] ✅ 报名成功！检测到提示: 报名成功
[2026-02-09 10:00:19] 📤 发送飞书通知...
[2026-02-09 10:00:20] 🧹 开始清理旧截图...
[2026-02-09 10:00:21] ✅ 清理完成，共删除 5 个旧截图
[2026-02-09 10:00:22] 🏁 饿了么自动报名活动任务结束
```

## 📊 Dashboard集成

### 日志分析

```python
# 分析报名成功率
import pandas as pd

logs = pd.read_csv('logs/activity_signup_*.log', parse_dates=['timestamp'])
success_rate = logs[logs['message'].str.contains('报名成功')].shape[0] / logs.shape[0]
```

### 截图展示

```python
# 获取最新截图
from pathlib import Path

screenshot_dir = Path('screenshots')
latest_screenshot = max(screenshot_dir.glob('*.png'), key=lambda f: f.stat().st_mtime)
```

## 🔧 故障排查

### 常见问题

**1. 找不到报名按钮**

- **原因**：页面结构变化、按钮颜色变化
- **解决**：更新颜色范围配置、添加模板匹配

**2. 报名失败**

- **原因**：网络延迟、页面未加载完成
- **解决**：增加等待时间、添加重试机制

**3. 截图识别不准确**

- **原因**：分辨率不同、缩放比例
- **解决**：使用相对坐标、适配不同分辨率

### 调试模式

```bash
# 开启调试日志
export DEBUG=true
python src/activity_signup.py
```

## 📈 优化建议

### 1. 机器学习优化

- 收集按钮样本，训练CNN分类器
- 使用YOLO目标检测识别按钮

### 2. 智能等待

- 动态等待页面加载完成
- 检测网络请求状态

### 3. 多门店支持

- 循环处理多个门店
- 并行执行提高效率

### 4. 异常处理

- 添加重试机制
- 捕获并记录详细错误

## 🤝 贡献指南

欢迎提交Issue和Pull Request！

### 开发环境

```bash
git clone https://github.com/your-repo/eleme-auto-activity-signup.git
cd eleme-auto-activity-signup
pip install -r requirements-dev.txt
pre-commit install
```

### 代码规范

- 使用Black格式化代码
- 遵循PEP 8规范
- 添加类型提示

## 📄 许可证

MIT License - 详见LICENSE文件

## 🔗 相关链接

- [OpenClaw文档](https://openclaw.org/docs)
- [Playwright文档](https://playwright.dev/python/docs/intro)
- [OpenCV文档](https://docs.opencv.org/)

## 💬 联系方式

- 问题反馈：[GitHub Issues](https://github.com/your-repo/eleme-auto-activity-signup/issues)
- 功能建议：欢迎提交Issue或PR

---

**版本**: 1.0.0  
**最后更新**: 2026-02-09  
**维护者**: OpenClaw社区
