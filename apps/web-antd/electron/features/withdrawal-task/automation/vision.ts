/**
 * 视觉定位工具
 * 使用 image 模型识别元素位置
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Page } from 'playwright';
import { execSync } from 'node:child_process';

export interface VisionPosition {
  x: number;
  y: number;
  width?: number;
  height?: number;
  description?: string;
}

/**
 * 使用视觉模型定位元素
 * @param screenshotPath 截图路径
 * @param target 要定位的目标描述
 * @returns 元素位置坐标
 */
export async function locateByVision(
  screenshotPath: string,
  target: string
): Promise<VisionPosition | null> {
  // 构建提示词
  const prompt = `请找到"${target}"在图片中的位置。

返回 JSON 格式：
{
  "x": 中心点X坐标,
  "y": 中心点Y坐标,
  "width": 宽度(可选),
  "height": 高度(可选),
  "description": "元素的描述"
}

只返回 JSON，不要其他内容。`;

  try {
    // 调用 OpenClaw 的 image 工具（通过 npx openclaw）
    // 或者直接调用模型 API
    const result = await callImageModel(screenshotPath, prompt);
    
    // 解析 JSON
    const match = result.match(/\{[\s\S]*\}/);
    if (match) {
      return JSON.parse(match[0]);
    }
    
    return null;
  } catch (error) {
    console.error('视觉定位失败:', error);
    return null;
  }
}

/**
 * 调用图像模型
 */
async function callImageModel(imagePath: string, prompt: string): Promise<string> {
  // 使用 fetch 调用阿里云视觉模型
  const apiKey = process.env.ALIYUN_API_KEY || process.env.DASHSCOPE_API_KEY;
  const baseUrl = 'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation';
  
  // 读取图片并转 base64
  const imageBuffer = fs.readFileSync(imagePath);
  const base64Image = imageBuffer.toString('base64');
  const mimeType = imagePath.endsWith('.png') ? 'image/png' : 'image/jpeg';
  
  const response = await fetch(baseUrl, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'qwen-vl-plus',
      input: {
        messages: [
          {
            role: 'user',
            content: [
              { image: `data:${mimeType};base64,${base64Image}` },
              { text: prompt }
            ]
          }
        ]
      }
    })
  });
  
  const data = await response.json() as any;
  return data.output?.choices?.[0]?.message?.content || '';
}

/**
 * 截图并定位元素
 */
export async function findElementByVision(
  page: Page,
  target: string,
  options: { retries?: number } = {}
): Promise<VisionPosition | null> {
  const retries = options.retries || 3;
  const screenshotDir = path.join(process.cwd(), 'logs', 'vision');
  
  // 确保目录存在
  if (!fs.existsSync(screenshotDir)) {
    fs.mkdirSync(screenshotDir, { recursive: true });
  }
  
  for (let i = 0; i < retries; i++) {
    try {
      // 截图
      const screenshotPath = path.join(screenshotDir, `screenshot_${Date.now()}.png`);
      await page.screenshot({ path: screenshotPath, fullPage: false });
      
      // 视觉定位
      const position = await locateByVision(screenshotPath, target);
      
      // 清理截图（可选）
      // fs.unlinkSync(screenshotPath);
      
      if (position) {
        console.log(`[视觉定位] 找到 "${target}" 在 (${position.x}, ${position.y})`);
        return position;
      }
    } catch (error) {
      console.error(`[视觉定位] 第 ${i + 1} 次尝试失败:`, error);
    }
  }
  
  console.warn(`[视觉定位] 未能找到 "${target}"`);
  return null;
}

/**
 * 点击目标元素
 */
export async function clickByVision(
  page: Page,
  target: string,
  options: { retries?: number; delay?: number } = {}
): Promise<boolean> {
  const position = await findElementByVision(page, target, { retries: options.retries });
  
  if (position) {
    await page.mouse.click(position.x, position.y);
    
    if (options.delay) {
      await new Promise(resolve => setTimeout(resolve, options.delay));
    }
    
    return true;
  }
  
  return false;
}