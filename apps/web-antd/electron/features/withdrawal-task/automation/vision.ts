/**
 * 视觉定位工具
 * 使用 image 模型识别元素位置
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Page } from 'playwright';

import { getSharedAiConfig } from '../../../shared/ai-config';
import { ensureWithdrawalEnvLoaded } from './config.js';

export interface VisionPosition {
  x: number;
  y: number;
  width?: number;
  height?: number;
  description?: string;
}

export interface AccountInfo {
  name: string;
  amount: number;
  withdrawButton: VisionPosition | null;
}

/**
 * 使用视觉模型分析财务页面
 */
export async function analyzeFinancePage(
  screenshotPath: string
): Promise<AccountInfo[]> {
  const prompt = `分析这个饿了么财务页面，找出所有账户信息。

请返回 JSON 数组格式：
[
  {
    "name": "账户名称（如：主资金账户、网商云资金账户）",
    "amount": 余额数字,
    "withdrawButton": {
      "x": 提现按钮中心X坐标,
      "y": 提现按钮中心Y坐标,
      "description": "按钮描述"
    }
  }
]

注意：
1. 只返回真实账户，不包括"账户可用总金额"等汇总项
2. 提现按钮通常在账户金额右侧
3. 只返回 JSON 数组，不要其他内容`;

  try {
    const result = await callImageModel(screenshotPath, prompt);
    
    // 解析 JSON
    const match = result.match(/\[[\s\S]*\]/);
    if (match) {
      const accounts = JSON.parse(match[0]);
      console.log(`[视觉分析] 发现 ${accounts.length} 个账户`);
      return accounts;
    }
    
    return [];
  } catch (error) {
    console.error('[视觉分析] 失败:', error);
    return [];
  }
}

/**
 * 调用图像模型（使用 OpenAI 兼容接口）
 */
async function callImageModel(imagePath: string, prompt: string): Promise<string> {
  ensureWithdrawalEnvLoaded();

  const aiConfig = await getSharedAiConfig();
  if (!aiConfig.apiKey) {
    console.error('[视觉模型] 未找到本地模型配置');
    throw new Error('未配置本地模型 API Key');
  }
  const baseUrl = aiConfig.baseUrl;
  
  // 读取图片并转 base64
  const imageBuffer = fs.readFileSync(imagePath);
  const base64Image = imageBuffer.toString('base64');
  const mimeType = imagePath.endsWith('.png') ? 'image/png' : 'image/jpeg';
  
  try {
    const response = await fetch(baseUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${aiConfig.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: aiConfig.model,
        messages: [
          {
            role: 'user',
            content: [
              { 
                type: 'image_url',
                image_url: {
                  url: `data:${mimeType};base64,${base64Image}`
                }
              },
              {
                type: 'text',
                text: prompt
              }
            ]
          }
        ]
      })
    });
    
    const data = await response.json() as any;
    
    if (data.error) {
      console.error('[视觉模型] API 错误:', data.error);
      return '';
    }
    
    const content = data.choices?.[0]?.message?.content || '';
    console.log('[视觉模型] 返回内容长度:', content.length);
    
    return content;
  } catch (error) {
    console.error('[视觉模型] 请求失败:', error);
    return '';
  }
}

/**
 * 截图并分析账户
 */
export async function getAccountsWithVision(
  page: Page
): Promise<AccountInfo[]> {
  const screenshotDir = path.join(process.cwd(), 'logs', 'vision');
  
  // 确保目录存在
  if (!fs.existsSync(screenshotDir)) {
    fs.mkdirSync(screenshotDir, { recursive: true });
  }
  
  try {
    // 截图
    const screenshotPath = path.join(screenshotDir, `finance_${Date.now()}.png`);
    await page.screenshot({ path: screenshotPath, fullPage: false });
    
    console.log(`[视觉定位] 截图保存: ${screenshotPath}`);
    
    // 视觉分析
    const accounts = await analyzeFinancePage(screenshotPath);
    
    return accounts;
  } catch (error) {
    console.error('[视觉定位] 获取账户失败:', error);
    return [];
  }
}

/**
 * 点击指定坐标
 */
export async function clickAt(
  page: Page,
  x: number,
  y: number,
  options: { delay?: number } = {}
): Promise<void> {
  await page.mouse.click(x, y);
  
  if (options.delay) {
    await new Promise(resolve => setTimeout(resolve, options.delay));
  }
}

/**
 * 视觉定位并点击提现按钮
 */
export async function clickWithdrawButtonByVision(
  page: Page,
  accountName: string
): Promise<boolean> {
  const accounts = await getAccountsWithVision(page);
  
  const account = accounts.find(a => 
    a.name.includes(accountName) || accountName.includes(a.name)
  );
  
  if (account?.withdrawButton) {
    console.log(`[视觉定位] 点击 ${account.name} 的提现按钮 (${account.withdrawButton.x}, ${account.withdrawButton.y})`);
    await clickAt(page, account.withdrawButton.x, account.withdrawButton.y, { delay: 2000 });
    return true;
  }
  
  console.warn(`[视觉定位] 未找到 ${accountName} 的提现按钮`);
  return false;
}
