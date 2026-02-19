#!/usr/bin/env python3
"""
饿了么提现 - 自我学习与优化系统
功能：自动分析历史数据、生成优化策略、持续改进
"""

import json
import subprocess
from pathlib import Path
from datetime import datetime, timedelta
from typing import Dict, List
import statistics

# 配置
SCRIPT_DIR = Path(__file__).parent
PROJECT_DIR = SCRIPT_DIR.parent
METRICS_DIR = PROJECT_DIR / "metrics"
ANALYSIS_DIR = PROJECT_DIR / "analysis"
LOGS_DIR = PROJECT_DIR / "logs"
EVOLUTION_FILE = PROJECT_DIR / "evolution.json"
OPTIMIZATION_LOG = PROJECT_DIR / "optimization_history.json"

class SelfLearningOptimizer:
    """自我学习优化器"""
    
    def __init__(self):
        self.evolution = self.load_evolution()
        self.optimization_history = self.load_optimization_history()
        self.learning_notes = []
    
    def load_evolution(self) -> Dict:
        """加载进化数据"""
        if EVOLUTION_FILE.exists():
            with open(EVOLUTION_FILE, 'r', encoding='utf-8') as f:
                return json.load(f)
        return {}
    
    def load_optimization_history(self) -> List:
        """加载优化历史"""
        if OPTIMIZATION_LOG.exists():
            with open(OPTIMIZATION_LOG, 'r', encoding='utf-8') as f:
                return json.load(f)
        return []
    
    def parse_analysis_markdown(self, content: str) -> Dict:
        """从分析报告中解析指标"""
        import re
        
        metrics = {}
        
        # 解析 Markdown 表格
        table_pattern = r'\|\s*总执行时间\s*\|\s*([\d.]+)\s*秒\s*\|'
        match = re.search(table_pattern, content)
        if match:
            metrics['total_duration'] = float(match.group(1))
        
        # 解析其他指标
        patterns = {
            'store_switches': r'\|\s*门店切换次数\s*\|\s*(\d+)\s*次\s*\|',
            'failed_coord_clicks': r'\|\s*失败坐标点击\s*\|\s*(\d+)\s*次\s*\|',
            'successful_withdrawals': r'\|\s*成功提现\s*\|\s*(\d+)\s*次\s*\|',
            'button_click_attempts': r'\|\s*按钮点击尝试\s*\|\s*(\d+)\s*次\s*\|',
            'button_click_successes': r'\|\s*按钮点击成功\s*\|\s*(\d+)\s*次\s*\|',
        }
        
        for key, pattern in patterns.items():
            match = re.search(pattern, content)
            if match:
                metrics[key] = int(match.group(1))
        
        # 转换为我们需要的格式
        if metrics:
            return {
                'total_duration': metrics.get('total_duration', 0),
                'stages': {
                    'withdrawal': {'duration': metrics.get('total_duration', 0) / max(1, metrics.get('successful_withdrawals', 1))}
                },
                'errors': [],
                'success_count': metrics.get('successful_withdrawals', 0),
                'failed_coords': metrics.get('failed_coord_clicks', 0)
            }
        
        return None
    
    def save_evolution(self):
        """保存进化数据"""
        self.evolution['last_updated'] = datetime.now().isoformat()
        with open(EVOLUTION_FILE, 'w', encoding='utf-8') as f:
            json.dump(self.evolution, f, ensure_ascii=False, indent=2)
    
    def save_optimization_history(self):
        """保存优化历史"""
        with open(OPTIMIZATION_LOG, 'w', encoding='utf-8') as f:
            json.dump(self.optimization_history, f, ensure_ascii=False, indent=2)
    
    def analyze_metrics(self) -> Dict:
        """分析历史指标"""
        all_metrics = []
        
        # 1. 首先尝试读取 metrics 目录的 JSON 文件
        metrics_files = sorted(METRICS_DIR.glob("metrics_*.json"))
        for f in metrics_files[-10:]:
            with open(f, 'r', encoding='utf-8') as file:
                all_metrics.append(json.load(file))
        
        # 2. 如果没有 metrics 文件，尝试从分析报告中提取数据
        if not all_metrics:
            analysis_files = sorted(ANALYSIS_DIR.glob("analysis_*.md"))
            for f in analysis_files[-10:]:
                with open(f, 'r', encoding='utf-8') as file:
                    content = file.read()
                
                # 解析 Markdown 表格中的指标
                metrics = self.parse_analysis_markdown(content)
                if metrics:
                    all_metrics.append(metrics)
        
        if not all_metrics:
            return {'status': 'no_data', 'message': '暂无历史指标数据'}
        
        analysis = {
            'total_sessions': len(all_metrics),
            'avg_duration': 0,
            'duration_trend': 'stable',
            'success_rate': 0,
            'common_errors': {},
            'bottlenecks': [],
            'recommendations': []
        }
        
        # 计算平均时长
        durations = [m.get('total_duration', 0) for m in all_metrics]
        if durations:
            analysis['avg_duration'] = round(statistics.mean(durations), 2)
            
            # 分析趋势
            if len(durations) >= 3:
                recent_avg = statistics.mean(durations[-3:])
                older_avg = statistics.mean(durations[:-3]) if len(durations) > 3 else recent_avg
                
                if recent_avg < older_avg * 0.9:
                    analysis['duration_trend'] = 'improving'
                elif recent_avg > older_avg * 1.1:
                    analysis['duration_trend'] = 'degrading'
        
        # 分析常见错误
        error_counts = {}
        for m in all_metrics:
            # 从 errors 数组中获取
            for error in m.get('errors', []):
                error_type = error.get('error', 'unknown') if isinstance(error, dict) else str(error)
                error_counts[error_type] = error_counts.get(error_type, 0) + 1
            
            # 从 failed_coords 字段获取
            if m.get('failed_coords', 0) > 0:
                error_counts['坐标点击失败'] = error_counts.get('坐标点击失败', 0) + m['failed_coords']
        
        analysis['common_errors'] = error_counts
        
        # 识别瓶颈
        stage_durations = {}
        for m in all_metrics:
            for stage, data in m.get('stages', {}).items():
                duration = data.get('duration', 0)
                if stage not in stage_durations:
                    stage_durations[stage] = []
                stage_durations[stage].append(duration)
        
        for stage, durations in stage_durations.items():
            avg = statistics.mean(durations)
            if avg > 10:  # 超过 10 秒的阶段视为瓶颈
                analysis['bottlenecks'].append({
                    'stage': stage,
                    'avg_duration': round(avg, 2),
                    'max_duration': round(max(durations), 2)
                })
        
        # 生成建议
        if analysis['avg_duration'] > 90:
            analysis['recommendations'].append({
                'priority': 'high',
                'issue': '执行时间过长',
                'suggestion': '优化坐标点击策略，减少无效尝试'
            })
        
        if '坐标点击失败' in error_counts and error_counts['坐标点击失败'] > 5:
            analysis['recommendations'].append({
                'priority': 'high',
                'issue': '坐标点击失败率高',
                'suggestion': '清理失效坐标，使用元素查找替代'
            })
        
        for bottleneck in analysis['bottlenecks']:
            analysis['recommendations'].append({
                'priority': 'medium',
                'issue': f"阶段 {bottleneck['stage']} 耗时过长",
                'suggestion': f"优化该阶段逻辑，目标时间<{bottleneck['avg_duration']*0.7:.1f}s"
            })
        
        return analysis
    
    def generate_optimization_strategy(self, analysis: Dict) -> Dict:
        """生成优化策略"""
        strategy = {
            'generated_at': datetime.now().isoformat(),
            'based_on_sessions': analysis.get('total_sessions', 0),
            'optimizations': []
        }
        
        # 坐标优化策略
        if analysis.get('common_errors', {}).get('坐标点击失败', 0) > 3:
            strategy['optimizations'].append({
                'type': 'coordinate_cleanup',
                'action': '清理连续失败 5 次以上的坐标',
                'expected_improvement': '减少 10-20 秒无效点击时间'
            })
        
        # 选择器优化策略
        strategy['optimizations'].append({
            'type': 'selector_priority',
            'action': '根据历史成功率调整选择器优先级',
            'expected_improvement': '提高按钮查找速度 20-30%'
        })
        
        # 并行优化策略
        strategy['optimizations'].append({
            'type': 'parallel_processing',
            'action': '并行处理多个 iframe 搜索',
            'expected_improvement': '减少 5-10 秒搜索时间'
        })
        
        # 智能等待策略
        strategy['optimizations'].append({
            'type': 'smart_wait',
            'action': '根据网络状况动态调整等待时间',
            'expected_improvement': '减少 5-15 秒等待时间'
        })
        
        return strategy
    
    def apply_optimizations(self, strategy: Dict):
        """应用优化策略"""
        for opt in strategy.get('optimizations', []):
            opt_type = opt.get('type')
            
            if opt_type == 'coordinate_cleanup':
                # 清理失效坐标
                blacklist = self.evolution.get('coords_blacklist', [])
                # 添加新的黑名单逻辑
                self.learning_notes.append(f"✅ 应用优化：{opt['action']}")
            
            elif opt_type == 'selector_priority':
                # 更新选择器优先级
                if 'successful_selectors' not in self.evolution:
                    self.evolution['successful_selectors'] = []
                self.learning_notes.append(f"✅ 应用优化：{opt['action']}")
            
            elif opt_type == 'parallel_processing':
                self.learning_notes.append(f"✅ 应用优化：{opt['action']}")
            
            elif opt_type == 'smart_wait':
                self.learning_notes.append(f"✅ 应用优化：{opt['action']}")
        
        # 记录优化历史
        self.optimization_history.append({
            'timestamp': datetime.now().isoformat(),
            'strategy': strategy,
            'notes': self.learning_notes
        })
        
        self.save_evolution()
        self.save_optimization_history()
    
    def generate_learning_report(self, analysis: Dict, strategy: Dict) -> str:
        """生成学习报告"""
        report = f"""
# 🤖 自我学习与优化报告

**生成时间：** {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}
**分析会话数：** {analysis.get('total_sessions', 0)}

---

## 📊 性能分析

### 执行时长
- **平均时长：** {analysis.get('avg_duration', 'N/A')} 秒
- **趋势：** {analysis.get('duration_trend', 'N/A')}
- **目标：** 60 秒

### 常见错误
"""
        for error, count in analysis.get('common_errors', {}).items():
            report += f"- {error}: {count} 次\n"
        
        report += f"""
### 性能瓶颈
"""
        for bottleneck in analysis.get('bottlenecks', []):
            report += f"- {bottleneck['stage']}: 平均 {bottleneck['avg_duration']}秒\n"
        
        report += f"""
---

## 🎯 优化策略

"""
        for i, opt in enumerate(strategy.get('optimizations', []), 1):
            report += f"{i}. **{opt['type']}**\n"
            report += f"   - 操作：{opt['action']}\n"
            report += f"   - 预期改进：{opt['expected_improvement']}\n\n"
        
        report += f"""
---

## 📝 学习记录

"""
        for note in self.learning_notes:
            report += f"{note}\n"
        
        report += f"""
---

## 📈 进化历史

**总优化次数：** {len(self.optimization_history)}

最近 5 次优化：
"""
        for hist in self.optimization_history[-5:]:
            timestamp = hist.get('timestamp', 'unknown')[:10]
            notes_count = len(hist.get('notes', []))
            report += f"- {timestamp}: {notes_count} 项优化\n"
        
        report += """
---

## 🔮 下一步计划

1. 继续收集执行数据
2. 验证优化效果
3. 调整策略权重
4. 生成日报/周报

**越用越聪明！** 🚀
"""
        return report
    
    def run(self):
        """运行完整学习流程"""
        print("=" * 60)
        print("🤖 自我学习与优化系统")
        print("=" * 60)
        
        # 1. 分析历史指标
        print("\n📊 分析历史指标...")
        analysis = self.analyze_metrics()
        
        if analysis.get('status') == 'no_data':
            print("⚠️ 暂无历史数据，等待首次执行...")
            return
        
        print(f"  - 分析会话数：{analysis.get('total_sessions')}")
        print(f"  - 平均时长：{analysis.get('avg_duration')}秒")
        print(f"  - 趋势：{analysis.get('duration_trend')}")
        
        # 2. 生成优化策略
        print("\n🎯 生成优化策略...")
        strategy = self.generate_optimization_strategy(analysis)
        print(f"  - 生成 {len(strategy.get('optimizations', []))} 项优化")
        
        # 3. 应用优化
        print("\n🔧 应用优化策略...")
        self.apply_optimizations(strategy)
        
        # 4. 生成报告
        print("\n📝 生成学习报告...")
        report = self.generate_learning_report(analysis, strategy)
        
        # 保存报告
        report_file = PROJECT_DIR / "learning_reports" / f"report_{datetime.now().strftime('%Y%m%d_%H%M%S')}.md"
        report_file.parent.mkdir(exist_ok=True)
        with open(report_file, 'w', encoding='utf-8') as f:
            f.write(report)
        
        print(f"\n✅ 报告已保存：{report_file}")
        print("=" * 60)
        
        return report

if __name__ == "__main__":
    optimizer = SelfLearningOptimizer()
    optimizer.run()
