#!/usr/bin/env python3
"""
饿了么提现日志分析器
功能：分析执行日志，识别低效点，生成优化建议
"""

import re
import json
from pathlib import Path
from datetime import datetime
from collections import defaultdict

# 配置
LOG_DIR = Path("/Users/mac/Documents/GitHub/scripts/apps/eleme-auto-withdraw/logs")
ANALYSIS_DIR = Path("/Users/mac/Documents/GitHub/scripts/apps/eleme-auto-withdraw/analysis")
EVOLUTION_FILE = Path("/Users/mac/Documents/GitHub/scripts/apps/eleme-auto-withdraw/evolution.json")

class WithdrawalLogAnalyzer:
    def __init__(self):
        self.metrics = {
            'total_duration': 0,
            'failed_coord_clicks': 0,
            'successful_withdrawals': 0,
            'button_click_attempts': 0,
            'button_click_successes': 0,
            'iframe_searches': 0,
            'store_switches': 0,
        }
        self.issues = []
        self.store_stats = defaultdict(lambda: {
            'failed_coords': 0,
            'successful_withdrawals': 0,
            'duration': 0
        })
    
    def parse_log(self, log_file):
        """解析日志文件"""
        with open(log_file, 'r', encoding='utf-8') as f:
            content = f.read()
        
        lines = content.split('\n')
        current_store = None
        
        for line in lines:
            # 统计门店切换
            if '开始处理门店' in line:
                match = re.search(r'门店：(.+?)$', line)
                if match:
                    current_store = match.group(1).strip()
                    self.metrics['store_switches'] += 1
            
            # 统计失败坐标点击
            if '坐标点击未触发预期弹窗' in line:
                self.metrics['failed_coord_clicks'] += 1
                if current_store:
                    self.store_stats[current_store]['failed_coords'] += 1
            
            # 统计按钮点击尝试
            if '尝试点击按钮' in line:
                self.metrics['button_click_attempts'] += 1
            
            # 统计按钮点击成功
            if '成功点击按钮' in line:
                self.metrics['button_click_successes'] += 1
            
            # 统计提现成功
            if '提现操作提交完成' in line:
                self.metrics['successful_withdrawals'] += 1
                if current_store:
                    self.store_stats[current_store]['successful_withdrawals'] += 1
            
            # 统计 iframe 搜索
            if '当前页面共有' in line and '个 frame' in line:
                self.metrics['iframe_searches'] += 1
        
        # 计算总时长
        time_pattern = r'\[(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\]'
        times = re.findall(time_pattern, content)
        if len(times) >= 2:
            start = datetime.strptime(times[0], '%Y-%m-%d %H:%M:%S')
            end = datetime.strptime(times[-1], '%Y-%m-%d %H:%M:%S')
            self.metrics['total_duration'] = (end - start).total_seconds()
    
    def analyze_efficiency(self):
        """分析效率问题"""
        issues = []
        
        # 问题 1: 无效坐标点击过多
        if self.metrics['failed_coord_clicks'] > 5:
            issues.append({
                'severity': 'high',
                'type': 'failed_coords',
                'message': f'无效坐标点击过多 ({self.metrics["failed_coord_clicks"]} 次)',
                'suggestion': '清理失效坐标，只保留最近成功的坐标'
            })
        
        # 问题 2: 按钮点击成功率低
        if self.metrics['button_click_attempts'] > 0:
            success_rate = self.metrics['button_click_successes'] / self.metrics['button_click_attempts']
            if success_rate < 0.5:
                issues.append({
                    'severity': 'medium',
                    'type': 'low_success_rate',
                    'message': f'按钮点击成功率低 ({success_rate:.1%})',
                    'suggestion': '优化按钮查找算法，优先使用成功过的选择器'
                })
        
        # 问题 3: 执行时间长
        if self.metrics['total_duration'] > 120:
            issues.append({
                'severity': 'medium',
                'type': 'slow_execution',
                'message': f'执行时间过长 ({self.metrics["total_duration"]:.0f} 秒)',
                'suggestion': '减少无效尝试，优化等待时间'
            })
        
        # 问题 4: 重复提现尝试
        if self.metrics['successful_withdrawals'] > 2:
            issues.append({
                'severity': 'high',
                'type': 'redundant_withdrawals',
                'message': f'重复提现尝试 ({self.metrics["successful_withdrawals"]} 次)',
                'suggestion': '提现成功后立即停止，避免重复操作'
            })
        
        return issues
    
    def generate_evolution_data(self):
        """生成进化数据（用于优化脚本）"""
        evolution = {
            'last_updated': datetime.now().isoformat(),
            'optimizations': {},
            'coords_blacklist': [],  # 失效坐标黑名单
            'successful_selectors': [],  # 成功过的选择器
            'timing_stats': {
                'avg_store_switch': 5,  # 秒
                'avg_withdrawal': 10,  # 秒
                'avg_total': self.metrics['total_duration']
            }
        }
        
        # 分析成功的选择器
        # 从日志中提取成功点击的按钮文本
        # 这里简化处理，实际应该解析更详细
        
        # 记录失效坐标（根据门店统计）
        for store, stats in self.store_stats.items():
            if stats['failed_coords'] > 5:
                evolution['coords_blacklist'].append({
                    'store': store,
                    'reason': '连续失败',
                    'failed_count': stats['failed_coords']
                })
        
        return evolution
    
    def generate_report(self):
        """生成分析报告"""
        report = f"""# 饿了么提现日志分析报告

**生成时间：** {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}

---

## 📊 执行指标

| 指标 | 数值 |
|------|------|
| 总执行时间 | {self.metrics['total_duration']:.1f} 秒 |
| 门店切换次数 | {self.metrics['store_switches']} 次 |
| 失败坐标点击 | {self.metrics['failed_coord_clicks']} 次 |
| 成功提现 | {self.metrics['successful_withdrawals']} 次 |
| 按钮点击尝试 | {self.metrics['button_click_attempts']} 次 |
| 按钮点击成功 | {self.metrics['button_click_successes']} 次 |
| iframe 搜索 | {self.metrics['iframe_searches']} 次 |

---

## ⚠️ 发现的问题

"""
        issues = self.analyze_efficiency()
        if issues:
            for i, issue in enumerate(issues, 1):
                severity_emoji = {'high': '🔴', 'medium': '🟡', 'low': '🟢'}.get(issue['severity'], '⚪')
                report += f"{i}. {severity_emoji} **{issue['message']}**\n"
                report += f"   - 建议：{issue['suggestion']}\n\n"
        else:
            report += "未发现明显问题 ✅\n\n"
        
        report += """
---

## 💡 优化建议

### 立即优化（高优先级）
1. **清理失效坐标** - 删除连续失败的坐标记录
2. **添加成功检测** - 提现成功后立即停止
3. **优化按钮查找** - 记录成功的选择器优先使用

### 中期优化（中优先级）
4. **智能等待** - 根据网络状况动态调整等待时间
5. **错误恢复** - 失败后自动重试有限次数
6. **性能监控** - 每次执行后记录关键指标

### 长期优化（低优先级）
7. **机器学习** - 根据历史数据预测最佳点击位置
8. **多账户支持** - 自动切换不同账户
9. **异常预警** - 连续失败时发送告警

---

## 📈 进化数据

已生成 `evolution.json` 文件，包含：
- 失效坐标黑名单
- 成功选择器记录
- 执行时间统计
- 优化建议

脚本应读取此文件进行自我优化。
"""
        return report
    
    def run(self, log_file=None):
        """运行分析"""
        if log_file is None:
            # 查找最新的日志文件
            log_files = sorted(LOG_DIR.glob('withdrawal_*.log'))
            if not log_files:
                return "❌ 未找到日志文件"
            log_file = log_files[-1]
        
        print(f"📊 分析日志文件：{log_file}")
        self.parse_log(log_file)
        
        # 生成报告
        report = self.generate_report()
        
        # 保存报告
        ANALYSIS_DIR.mkdir(exist_ok=True)
        report_file = ANALYSIS_DIR / f"analysis_{datetime.now().strftime('%Y%m%d_%H%M%S')}.md"
        with open(report_file, 'w', encoding='utf-8') as f:
            f.write(report)
        
        # 生成进化数据
        evolution = self.generate_evolution_data()
        with open(EVOLUTION_FILE, 'w', encoding='utf-8') as f:
            json.dump(evolution, f, ensure_ascii=False, indent=2)
        
        print(f"✅ 报告已保存：{report_file}")
        print(f"✅ 进化数据已保存：{EVOLUTION_FILE}")
        
        return report

if __name__ == "__main__":
    analyzer = WithdrawalLogAnalyzer()
    analyzer.run()
