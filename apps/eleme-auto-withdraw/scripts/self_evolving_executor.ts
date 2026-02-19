
import * as fs from 'fs';
import * as path from 'path';

/**
 * 模拟的知识库条目
 */
interface KnowledgeEntry {
  timestamp: number;
  parameters: {
    waitTime: number;
    userAgent: string;
  };
  result: 'success' | 'fail' | 'blocked';
  duration: number;
}

/**
 * 模拟的进化配置
 */
interface EvolutionConfig {
  baseWaitTime: number; // 基础等待时间 (ms)
  failureThreshold: number; // 失败阈值，超过则增加等待时间
  maxWaitTime: number; // 最大等待时间
  userAgents: string[]; // UA 池
}

const DEFAULT_CONFIG: EvolutionConfig = {
  baseWaitTime: 1000,
  failureThreshold: 3,
  maxWaitTime: 5000,
  userAgents: [
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  ],
};

const KNOWLEDGE_FILE = path.join(process.cwd(), 'knowledge_base.json');
const CONFIG_FILE = path.join(process.cwd(), 'evolution.json');

/**
 * 自我进化执行器原型
 */
class SelfEvolvingExecutor {
  private knowledgeBase: KnowledgeEntry[] = [];
  private config: EvolutionConfig = DEFAULT_CONFIG;
  private currentFailureCount = 0;

  constructor() {
    this.loadConfig();
    this.loadKnowledgeBase();
    this.watchConfig();
  }

  /**
   * 加载配置
   */
  private loadConfig() {
    if (fs.existsSync(CONFIG_FILE)) {
      try {
        const data = fs.readFileSync(CONFIG_FILE, 'utf-8');
        this.config = { ...DEFAULT_CONFIG, ...JSON.parse(data) };
        console.log('配置已加载:', this.config);
      } catch (error) {
        console.error('配置加载失败，使用默认值');
      }
    } else {
      this.saveConfig(); // 初始化文件
    }
  }

  /**
   * 保存配置
   */
  private saveConfig() {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(this.config, null, 2));
  }

  /**
   * 监听配置变化（热更新）
   */
  private watchConfig() {
    console.log(`正在监听配置文件变化: ${CONFIG_FILE}`);
    fs.watchFile(CONFIG_FILE, (curr, prev) => {
      if (curr.mtime !== prev.mtime) {
        console.log('\n检测到配置文件变更，正在热重载...');
        this.loadConfig();
      }
    });
  }

  /**
   * 加载历史知识
   */
  private loadKnowledgeBase() {
    if (fs.existsSync(KNOWLEDGE_FILE)) {
      try {
        const data = fs.readFileSync(KNOWLEDGE_FILE, 'utf-8');
        this.knowledgeBase = JSON.parse(data);
        console.log(`已加载 ${this.knowledgeBase.length} 条历史记录`);
      } catch {}
    }
  }

  /**
   * 保存知识库
   */
  private saveKnowledgeBase() {
    // 仅保留最近 100 条
    if (this.knowledgeBase.length > 100) {
      this.knowledgeBase = this.knowledgeBase.slice(-100);
    }
    fs.writeFileSync(KNOWLEDGE_FILE, JSON.stringify(this.knowledgeBase, null, 2));
  }

  /**
   * 决策引擎：根据历史决定本次执行参数
   */
  private decideParameters() {
    // 简单的规则：如果最近连续失败超过阈值，增加等待时间
    const recentFailures = this.knowledgeBase.slice(-5).filter(k => k.result !== 'success').length;
    
    let adjustedWaitTime = this.config.baseWaitTime;
    
    if (recentFailures > 0) {
      console.log(`警告: 最近 5 次执行中有 ${recentFailures} 次非成功状态，正在调整策略...`);
      // 指数退避策略
      adjustedWaitTime = Math.min(
        this.config.baseWaitTime * Math.pow(1.5, recentFailures), 
        this.config.maxWaitTime
      );
    }

    // 随机选择 UA
    const userAgent = this.config.userAgents[Math.floor(Math.random() * this.config.userAgents.length)];

    return {
      waitTime: Math.round(adjustedWaitTime),
      userAgent,
    };
  }

  /**
   * 模拟执行任务
   */
  public async executeTask() {
    const params = this.decideParameters();
    console.log(`\n>>> 开始执行任务`);
    console.log(`    策略参数: 等待时间=${params.waitTime}ms, UA=${params.userAgent.substring(0, 30)}...`);

    const startTime = Date.now();
    
    // 模拟执行过程
    await new Promise(resolve => setTimeout(resolve, params.waitTime));

    // 模拟结果（80% 成功率，随等待时间增加而提高）
    // 假设等待时间越长，被风控概率越低
    const successProbability = 0.5 + (params.waitTime / 5000) * 0.4; // 基础 50%，最大加成 40%
    const random = Math.random();
    
    let result: 'success' | 'fail' | 'blocked' = 'success';
    if (random > successProbability) {
        result = random > 0.9 ? 'blocked' : 'fail';
    }

    const duration = Date.now() - startTime;
    console.log(`    执行结果: ${result.toUpperCase()} (耗时 ${duration}ms)`);

    // 记录结果
    this.recordResult(params, result, duration);

    // 如果被风控，触发自动降级（这里简单模拟修改配置）
    if (result === 'blocked') {
        console.log('!!! 触发风控，自动增加基础等待时间 !!!');
        this.config.baseWaitTime += 1000;
        this.saveConfig();
    }
  }

  /**
   * 记录结果并学习
   */
  private recordResult(params: any, result: 'success' | 'fail' | 'blocked', duration: number) {
    this.knowledgeBase.push({
      timestamp: Date.now(),
      parameters: params,
      result,
      duration
    });
    this.saveKnowledgeBase();
  }
}

// --- 运行演示 ---
async function main() {
  const executor = new SelfEvolvingExecutor();
  
  console.log('启动自我进化执行器演示 (按 Ctrl+C 停止)...');
  
  // 模拟循环执行
  while (true) {
    await executor.executeTask();
    // 间隔 2 秒再次执行
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
}

if (require.main === module) {
  main().catch(console.error);
}
