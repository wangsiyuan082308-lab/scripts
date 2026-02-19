#!/usr/bin/env python3
"""
饿了么自动提现 - 自我进化执行器
功能：读取进化数据，优化执行策略，记录执行结果
"""

import json
import subprocess
import sys
from pathlib import Path
from datetime import datetime

# 配置
SCRIPT_DIR = Path(__file__).parent
EVOLUTION_FILE = SCRIPT_DIR / "evolution.json"
LOG_DIR = SCRIPT_DIR / "logs"
ANALYSIS_SCRIPT = SCRIPT_DIR / "scripts" / "analyze_log.py"

class SelfEvolvingWithdrawal:
    def __init__(self):
        self.evolution = self.load_evolution()
        self.execution_log = []
    
    def load_evolution(self):
        """加载进化数据"""
        if EVOLUTION_FILE.exists():
            with open(EVOLUTION_FILE, 'r', encoding='utf-8') as f:
                return json.load(f)
        return {}
    
    def save_evolution(self):
        """保存进化数据"""
        self.evolution['last_updated'] = datetime.now().isoformat()
        with open(EVOLUTION_FILE, 'w', encoding='utf-8') as f:
            json.dump(self.evolution, f, ensure_ascii=False, indent=2)
    
    def pre_execution_optimize(self):
        """执行前优化"""
        print("🔧 执行前优化...")
        
        optimizations = self.evolution.get('optimizations', {})
        
        # 1. 清理失效坐标（如果标记为跳过）
        if optimizations.get('skip_failed_coords'):
            blacklist = self.evolution.get('coords_blacklist', [])
            print(f"  - 跳过 {len(blacklist)} 个失效坐标区域")
        
        # 2. 设置最大重试次数
        max_retries = optimizations.get('max_retry_attempts', 3)
        print(f"  - 最大重试次数：{max_retries}")
        
        # 3. 优先使用成功过的选择器
        successful_selectors = self.evolution.get('successful_selectors', [])
        if successful_selectors:
            print(f"  - 优先使用 {len(successful_selectors)} 个成功选择器")
        
        self.execution_log.append({
            'stage': 'pre_execution',
            'timestamp': datetime.now().isoformat(),
            'optimizations_applied': len(optimizations)
        })
    
    def execute_withdrawal(self):
        """执行提现脚本"""
        print("\n💳 执行提现脚本...")
        
        start_time = datetime.now()
        
        # 调用原始提现脚本
        result = subprocess.run(
            ['npm', 'start'],
            cwd=SCRIPT_DIR,
            capture_output=True,
            text=True
        )
        
        end_time = datetime.now()
        duration = (end_time - start_time).total_seconds()
        
        self.execution_log.append({
            'stage': 'execution',
            'timestamp': end_time.isoformat(),
            'duration': duration,
            'success': result.returncode == 0,
            'stdout_lines': len(result.stdout.split('\n')),
            'stderr_lines': len(result.stderr.split('\n'))
        })
        
        print(f"  - 执行完成：{'✅ 成功' if result.returncode == 0 else '❌ 失败'}")
        print(f"  - 耗时：{duration:.1f} 秒")
        
        return result.returncode == 0
    
    def post_execution_analyze(self):
        """执行后分析"""
        print("\n📊 执行后分析...")
        
        # 运行日志分析器
        if ANALYSIS_SCRIPT.exists():
            result = subprocess.run(
                ['python3', str(ANALYSIS_SCRIPT)],
                capture_output=True,
                text=True
            )
            print(result.stdout)
        
        # 加载分析结果
        if EVOLUTION_FILE.exists():
            with open(EVOLUTION_FILE, 'r', encoding='utf-8') as f:
                new_evolution = json.load(f)
            
            # 更新进化数据
            old_stats = self.evolution.get('timing_stats', {})
            new_stats = new_evolution.get('timing_stats', {})
            
            # 计算移动平均
            if 'avg_total' in new_stats:
                old_avg = old_stats.get('avg_total', new_stats['avg_total'])
                new_avg = (old_avg * 0.7) + (new_stats['avg_total'] * 0.3)
                new_stats['avg_total'] = new_avg
            
            self.evolution['timing_stats'] = new_stats
            
            # 检查是否达到性能目标
            targets = self.evolution.get('performance_targets', {})
            target_duration = targets.get('target_duration', 60)
            
            if new_stats.get('avg_total', 999) <= target_duration:
                print(f"  ✅ 达到性能目标 ({new_stats['avg_total']:.1f}秒 <= {target_duration}秒)")
            else:
                print(f"  ⚠️ 未达到性能目标 ({new_stats['avg_total']:.1f}秒 > {target_duration}秒)")
            
            self.save_evolution()
        
        self.execution_log.append({
            'stage': 'post_execution',
            'timestamp': datetime.now().isoformat(),
            'analyzed': True
        })
    
    def generate_report(self):
        """生成执行报告"""
        report = f"""
# 饿了么提现执行报告

**执行时间：** {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}

## 执行摘要

"""
        for log in self.execution_log:
            report += f"- {log['stage']}: {log.get('success', 'N/A')} | 耗时：{log.get('duration', 'N/A')}秒\n"
        
        report += f"""
## 进化状态

- 失效坐标黑名单：{len(self.evolution.get('coords_blacklist', []))} 个
- 成功选择器：{len(self.evolution.get('successful_selectors', []))} 个
- 平均执行时间：{self.evolution.get('timing_stats', {}).get('avg_total', 'N/A')}秒

## 下次优化

将根据本次执行结果自动调整策略。
"""
        return report
    
    def run(self):
        """完整执行流程"""
        print("=" * 60)
        print("🤖 饿了么自动提现 - 自我进化版")
        print("=" * 60)
        
        # 1. 执行前优化
        self.pre_execution_optimize()
        
        # 2. 执行提现
        success = self.execute_withdrawal()
        
        # 3. 执行后分析
        self.post_execution_analyze()
        
        # 4. 生成报告
        report = self.generate_report()
        
        # 保存报告
        report_file = LOG_DIR / f"execution_report_{datetime.now().strftime('%Y%m%d_%H%M%S')}.md"
        LOG_DIR.mkdir(exist_ok=True)
        with open(report_file, 'w', encoding='utf-8') as f:
            f.write(report)
        
        print(f"\n✅ 报告已保存：{report_file}")
        print("=" * 60)
        
        return success

if __name__ == "__main__":
    executor = SelfEvolvingWithdrawal()
    success = executor.run()
    sys.exit(0 if success else 1)
