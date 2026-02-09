: | #!/usr/bin/env python3
"""
饿了么自动报名活动 - OpenClaw技能版
基于Playwright + OpenCV的图像识别自动化
"""

import os
import sys
import asyncio
import cv2
import numpy as np
from pathlib import Path
from datetime import datetime, timedelta
from typing import List, Tuple, Optional

# 添加父目录到路径
sys.path.insert(0, str(Path(__file__).parent))

try:
    from playwright.async_api import async_playwright, Page, Browser
except ImportError:
    print("❌ 请先安装Playwright: pip install playwright")
    sys.exit(1)

try:
    from PIL import Image
except ImportError:
    print("❌ 请先安装Pillow: pip install Pillow")
    sys.exit(1)

# 配置
class Config:
    """配置类"""
    # 饿了么活动页面URL
    ACTIVITY_URL = os.getenv("ELEME_ACTIVITY_URL", "https://nr.ele.me/app/eleme-nr-bfe-newretail/common-next#/pc/activityCenter")
    
    # 截图保存路径
    SCREENSHOT_DIR = Path(os.getenv("SCREENSHOT_DIR", "screenshots"))
    
    # 日志文件
    LOG_FILE = Path(os.getenv("LOG_FILE", "activity_signup.log"))
    
    # 保留截图天数
    KEEP_DAYS = int(os.getenv("KEEP_DAYS", "7"))
    
    # 图像识别阈值
    MATCH_THRESHOLD = float(os.getenv("MATCH_THRESHOLD", "0.8"))
    
    # 活动关键词
    ACTIVITY_KEYWORDS = os.getenv("ACTIVITY_KEYWORDS", "报名,立即报名,参与活动,领取").split(",")
    
    # 门店名称
    STORE_NAMES = os.getenv("STORE_NAMES", "Oby便利超市(安吉店),Oby便利超市(长兴店)").split(",")

class ActivitySignupAutomation:
    """饿了么自动报名活动类"""
    
    def __init__(self, headless: bool = False):
        self.config = Config()
        self.headless = headless
        self.browser: Optional[Browser] = None
        self.page: Optional[Page] = None
        
        # 创建目录
        self.config.SCREENSHOT_DIR.mkdir(exist_ok=True)
        
    async def __aenter__(self):
        """异步上下文管理器入口"""
        await self.start()
        return self
        
    async def __aexit__(self, exc_type, exc_val, exc_tb):
        """异步上下文管理器出口"""
        await self.close()
    
    async def start(self):
        """启动浏览器"""
        print("🚀 启动浏览器...")
        playwright = await async_playwright().start()
        
        # 启动浏览器
        self.browser = await playwright.chromium.launch(
            headless=self.headless,
            args=[
                '--disable-blink-features=AutomationControlled',
                '--start-maximized'
            ]
        )
        
        # 创建上下文
        context = await self.browser.new_context(
            viewport={'width': 1920, 'height': 1080},
            user_agent='Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
        )
        
        # 添加脚本以隐藏自动化特征
        await context.add_init_script("""
            Object.defineProperty(navigator, 'webdriver', {
                get: () => undefined
            });
        """)
        
        self.page = await context.new_page()
        print("✅ 浏览器启动成功")
    
    async def close(self):
        """关闭浏览器"""
        if self.browser:
            await self.browser.close()
            print("✅ 浏览器已关闭")
    
    def log(self, message: str):
        """记录日志"""
        timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        log_message = f"[{timestamp}] {message}"
        print(log_message)
        
        # 写入日志文件
        with open(self.config.LOG_FILE, 'a', encoding='utf-8') as f:
            f.write(log_message + '\n')
    
    async def take_screenshot(self, name: str) -> Path:
        """截图"""
        if not self.page:
            raise Exception("页面未初始化")
        
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        screenshot_path = self.config.SCREENSHOT_DIR / f"{name}_{timestamp}.png"
        
        await self.page.screenshot(path=str(screenshot_path), full_page=True)
        self.log(f"📸 截图已保存: {screenshot_path}")
        
        return screenshot_path
    
    def find_activity_buttons(self, image_path: Path) -> List[Tuple[int, int, int, int]]:
        """
        在截图中查找活动报名按钮
        返回: [(x, y, w, h), ...]
        """
        # 读取截图
        screenshot = cv2.imread(str(image_path))
        if screenshot is None:
            self.log(f"❌ 无法读取截图: {image_path}")
            return []
        
        # 转换为灰度图
        gray = cv2.cvtColor(screenshot, cv2.COLOR_BGR2GRAY)
        
        # 使用OpenCV的颜色空间转换（HSV）识别报名按钮
        # 橙色/红色按钮识别
        hsv = cv2.cvtColor(screenshot, cv2.COLOR_BGR2HSV)
        
        # 定义按钮颜色范围（橙色/红色）
        lower_orange = np.array([10, 100, 100])
        upper_orange = np.array([25, 255, 255])
        mask = cv2.inRange(hsv, lower_orange, upper_orange)
        
        # 查找轮廓
        contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        
        buttons = []
        for contour in contours:
            area = cv2.contourArea(contour)
            if area > 1000:  # 过滤小区域
                x, y, w, h = cv2.boundingRect(contour)
                buttons.append((x, y, w, h))
                self.log(f"🔍 发现按钮区域: x={x}, y={y}, w={w}, h={h}")
        
        return buttons
    
    async def navigate_to_activity_page(self):
        """导航到活动页面"""
        if not self.page:
            raise Exception("页面未初始化")
        
        self.log(f"🌐 正在打开活动页面: {self.config.ACTIVITY_URL}")
        await self.page.goto(self.config.ACTIVITY_URL, wait_until='networkidle')
        
        # 等待页面加载完成
        await asyncio.sleep(3)
        
        # 截图
        screenshot_path = await self.take_screenshot("activity_page")
        
        return screenshot_path
    
    async def click_signup_button(self, x: int, y: int):
        """点击报名按钮"""
        if not self.page:
            raise Exception("页面未初始化")
        
        self.log(f"🖱️ 点击坐标: ({x}, {y})")
        await self.page.mouse.click(x, y)
        
        # 等待弹窗出现
        await asyncio.sleep(2)
        
        # 截图确认
        await self.take_screenshot("after_click")
    
    async def process_activity_signup(self) -> bool:
        """
        处理活动报名
        返回: 是否成功报名
        """
        self.log("🚀 开始处理活动报名...")
        
        try:
            # 1. 导航到活动页面
            screenshot_path = await self.navigate_to_activity_page()
            
            # 2. 查找报名按钮
            buttons = self.find_activity_buttons(screenshot_path)
            
            if not buttons:
                self.log("⚠️ 未找到活动报名按钮")
                return False
            
            self.log(f"✅ 找到 {len(buttons)} 个报名按钮")
            
            # 3. 点击第一个报名按钮
            x, y, w, h = buttons[0]
            center_x = x + w // 2
            center_y = y + h // 2
            
            await self.click_signup_button(center_x, center_y)
            
            # 4. 确认报名成功（检查是否有成功提示）
            if self.page:
                # 查找成功提示
                success_indicators = ["报名成功", "参与成功", "已成功"]
                page_content = await self.page.content()
                
                for indicator in success_indicators:
                    if indicator in page_content:
                        self.log(f"✅ 报名成功！检测到提示: {indicator}")
                        
                        # 截图保存成功页面
                        await self.take_screenshot("signup_success")
                        return True
                
                self.log("⚠️ 未检测到报名成功提示，请手动确认")
                return False
            
            return False
            
        except Exception as e:
            self.log(f"❌ 报名过程中出错: {str(e)}")
            # 错误截图
            if self.page:
                await self.take_screenshot("error")
            return False
    
    def cleanup_old_screenshots(self):
        """清理旧截图"""
        self.log("🧹 开始清理旧截图...")
        
        cutoff_date = datetime.now() - timedelta(days=self.config.KEEP_DAYS)
        deleted_count = 0
        
        for screenshot_file in self.config.SCREENSHOT_DIR.glob("*.png"):
            try:
                # 从文件名获取日期（假设格式: name_YYYYMMDD_HHMMSS.png）
                file_date_str = screenshot_file.stem.split('_')[-2]  # 获取日期部分
                file_date = datetime.strptime(file_date_str, "%Y%m%d")
                
                if file_date < cutoff_date:
                    screenshot_file.unlink()
                    deleted_count += 1
                    self.log(f"🗑️ 删除旧截图: {screenshot_file.name}")
            except Exception as e:
                self.log(f"⚠️ 无法处理文件 {screenshot_file}: {e}")
        
        self.log(f"✅ 清理完成，共删除 {deleted_count} 个旧截图")
        return deleted_count
    
    async def run_signup_workflow(self):
        """运行完整的报名流程"""
        self.log("=" * 50)
        self.log("🚀 饿了么自动报名活动任务开始")
        self.log("=" * 50)
        
        try:
            # 1. 清理旧截图
            self.cleanup_old_screenshots()
            
            # 2. 执行报名流程
            success = await self.process_activity_signup()
            
            # 3. 记录结果
            if success:
                self.log("✅ 活动报名任务完成！")
            else:
                self.log("⚠️ 活动报名任务未完成，请检查日志")
            
            return success
            
        except Exception as e:
            self.log(f"❌ 任务执行失败: {str(e)}")
            return False
        finally:
            self.log("=" * 50)
            self.log("🏁 饿了么自动报名活动任务结束")
            self.log("=" * 50)

# 使用示例
async def main():
    """主函数"""
    # 设置环境变量
    os.environ["PLAYWRIGHT_BROWSERS_PATH"] = "/Users/mac/Library/Caches/ms-playwright"
    
    async with ActivitySignupAutomation(headless=False) as automation:
        # 运行报名流程
        success = await automation.run_signup_workflow()
        
        # 返回退出码
        return 0 if success else 1

if __name__ == "__main__":
    # 运行异步主函数
    exit_code = asyncio.run(main())
    sys.exit(exit_code)
