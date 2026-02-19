#!/usr/bin/env python3
"""
饿了么提现 - 增强版日志埋点系统
功能：结构化日志、关键节点计时、决策记录、性能指标
"""

import json
import logging
import time
import sys
from pathlib import Path
from datetime import datetime
from typing import Dict, List, Optional

# 配置
LOG_DIR = Path("/Users/mac/Documents/GitHub/scripts/apps/eleme-auto-withdraw/logs")
METRICS_DIR = Path("/Users/mac/Documents/GitHub/scripts/apps/eleme-auto-withdraw/metrics")
EVOLUTION_FILE = Path("/Users/mac/Documents/GitHub/scripts/apps/eleme-auto-withdraw/evolution.json")

class EnhancedLogger:
    """增强版日志记录器"""
    
    def __init__(self, session_id: str = None):
        self.session_id = session_id or datetime.now().strftime('%Y%m%d_%H%M%S')
        self.log_file = LOG_DIR / f"detailed_{self.session_id}.jsonl"
        self.metrics_file = METRICS_DIR / f"metrics_{self.session_id}.json"
        
        # 确保目录存在
        LOG_DIR.mkdir(exist_ok=True)
        METRICS_DIR.mkdir(exist_ok=True)
        
        # 初始化指标
        self.metrics = {
            'session_id': self.session_id,
            'start_time': datetime.now().isoformat(),
            'end_time': None,
            'total_duration': 0,
            'stages': {},
            'decisions': [],
            'errors': [],
            'performance': {
                'store_switches': [],
                'withdrawal_attempts': [],
                'button_clicks': [],
                'coordinate_attempts': []
            }
        }
        
        # 阶段计时器
        self.stage_timers = {}
        
        # 设置标准日志
        logging.basicConfig(
            level=logging.INFO,
            format='[%(asctime)s] %(levelname)s: %(message)s',
            handlers=[
                logging.StreamHandler(sys.stdout),
                logging.FileHandler(LOG_DIR / f"detailed_{self.session_id}.log")
            ]
        )
        self.logger = logging.getLogger(__name__)
    
    def start_stage(self, stage_name: str, metadata: Dict = None):
        """开始一个阶段"""
        self.stage_timers[stage_name] = time.time()
        self.metrics['stages'][stage_name] = {
            'start': datetime.now().isoformat(),
            'end': None,
            'duration': None,
            'status': 'started',
            'metadata': metadata or {}
        }
        self._write_log({
            'type': 'stage_start',
            'stage': stage_name,
            'timestamp': datetime.now().isoformat(),
            'metadata': metadata or {}
        })
        self.logger.info(f"🚀 开始阶段：{stage_name}")
    
    def end_stage(self, stage_name: str, status: str = 'success', metadata: Dict = None):
        """结束一个阶段"""
        if stage_name in self.stage_timers:
            duration = time.time() - self.stage_timers[stage_name]
            self.metrics['stages'][stage_name].update({
                'end': datetime.now().isoformat(),
                'duration': round(duration, 2),
                'status': status,
                'metadata': {**(self.metrics['stages'][stage_name]['metadata']), **(metadata or {})}
            })
            del self.stage_timers[stage_name]
            
            self._write_log({
                'type': 'stage_end',
                'stage': stage_name,
                'status': status,
                'duration': duration,
                'timestamp': datetime.now().isoformat(),
                'metadata': metadata or {}
            })
            self.logger.info(f"✅ 结束阶段：{stage_name} ({duration:.2f}s) - {status}")
    
    def record_decision(self, decision: str, reason: str, alternatives: List = None):
        """记录决策"""
        decision_record = {
            'decision': decision,
            'reason': reason,
            'alternatives': alternatives or [],
            'timestamp': datetime.now().isoformat()
        }
        self.metrics['decisions'].append(decision_record)
        self._write_log({
            'type': 'decision',
            **decision_record
        })
        self.logger.info(f"🤔 决策：{decision} - {reason}")
    
    def record_performance(self, category: str, value: float, unit: str = 's', metadata: Dict = None):
        """记录性能指标"""
        if category not in self.metrics['performance']:
            self.metrics['performance'][category] = []
        
        self.metrics['performance'][category].append({
            'value': value,
            'unit': unit,
            'timestamp': datetime.now().isoformat(),
            'metadata': metadata or {}
        })
        self._write_log({
            'type': 'performance',
            'category': category,
            'value': value,
            'unit': unit,
            'timestamp': datetime.now().isoformat(),
            'metadata': metadata or {}
        })
    
    def record_error(self, error: str, context: Dict = None, recoverable: bool = True):
        """记录错误"""
        error_record = {
            'error': error,
            'context': context or {},
            'recoverable': recoverable,
            'timestamp': datetime.now().isoformat()
        }
        self.metrics['errors'].append(error_record)
        self._write_log({
            'type': 'error',
            'level': 'warning' if recoverable else 'critical',
            **error_record
        })
        if recoverable:
            self.logger.warning(f"⚠️ 错误：{error}")
        else:
            self.logger.error(f"❌ 严重错误：{error}")
    
    def record_coordinate_attempt(self, store: str, coord: Dict, success: bool, duration: float):
        """记录坐标点击尝试"""
        self.metrics['performance']['coordinate_attempts'].append({
            'store': store,
            'coord': coord,
            'success': success,
            'duration': duration,
            'timestamp': datetime.now().isoformat()
        })
        self._write_log({
            'type': 'coordinate_attempt',
            'store': store,
            'coord': coord,
            'success': success,
            'duration': duration
        })
    
    def record_button_click(self, selector: str, success: bool, attempts: int, duration: float):
        """记录按钮点击"""
        self.metrics['performance']['button_clicks'].append({
            'selector': selector,
            'success': success,
            'attempts': attempts,
            'duration': duration,
            'timestamp': datetime.now().isoformat()
        })
        self._write_log({
            'type': 'button_click',
            'selector': selector,
            'success': success,
            'attempts': attempts,
            'duration': duration
        })
    
    def _write_log(self, entry: Dict):
        """写入 JSONL 日志"""
        with open(self.log_file, 'a', encoding='utf-8') as f:
            f.write(json.dumps(entry, ensure_ascii=False) + '\n')
    
    def finalize(self):
        """完成会话，保存最终指标"""
        self.metrics['end_time'] = datetime.now().isoformat()
        
        # 计算总时长
        start = datetime.fromisoformat(self.metrics['start_time'])
        end = datetime.fromisoformat(self.metrics['end_time'])
        self.metrics['total_duration'] = round((end - start).total_seconds(), 2)
        
        # 保存指标
        with open(self.metrics_file, 'w', encoding='utf-8') as f:
            json.dump(self.metrics, f, ensure_ascii=False, indent=2)
        
        # 生成摘要
        self._generate_summary()
        
        self.logger.info(f"📊 会话完成：{self.session_id} ({self.metrics['total_duration']}s)")
    
    def _generate_summary(self):
        """生成执行摘要"""
        summary = []
        summary.append("=" * 60)
        summary.append("📊 执行摘要")
        summary.append("=" * 60)
        summary.append(f"会话 ID: {self.session_id}")
        summary.append(f"总时长：{self.metrics['total_duration']}秒")
        summary.append(f"阶段数：{len(self.metrics['stages'])}")
        summary.append(f"决策数：{len(self.metrics['decisions'])}")
        summary.append(f"错误数：{len(self.metrics['errors'])}")
        
        # 阶段统计
        summary.append("\n阶段耗时:")
        for stage, data in self.metrics['stages'].items():
            duration = data.get('duration', 'N/A')
            status = data.get('status', 'unknown')
            status_emoji = '✅' if status == 'success' else '⚠️' if status == 'warning' else '❌'
            summary.append(f"  {status_emoji} {stage}: {duration}s")
        
        # 性能统计
        summary.append("\n性能指标:")
        for category, items in self.metrics['performance'].items():
            if items:
                values = [item['value'] for item in items]
                avg = sum(values) / len(values)
                summary.append(f"  {category}: {len(items)}次, 平均={avg:.2f}{items[0].get('unit', '')}")
        
        summary.append("=" * 60)
        
        # 保存摘要
        summary_file = METRICS_DIR / f"summary_{self.session_id}.txt"
        with open(summary_file, 'w', encoding='utf-8') as f:
            f.write('\n'.join(summary))
        
        # 打印摘要
        for line in summary:
            self.logger.info(line)


# 全局日志实例
enhanced_logger = EnhancedLogger()


if __name__ == "__main__":
    # 测试
    logger = EnhancedLogger()
    
    logger.start_stage("initialization", {"config": "test"})
    time.sleep(0.5)
    logger.end_stage("initialization", "success")
    
    logger.record_decision("使用坐标点击", "历史成功率 80%", ["常规查找"])
    
    logger.record_performance("store_switch", 3.2, "s")
    logger.record_error("坐标点击失败", {"coord": {"x": 100, "y": 200}}, recoverable=True)
    
    logger.finalize()
    
    print(f"\n✅ 测试完成！日志文件：{logger.log_file}")
    print(f"✅ 指标文件：{logger.metrics_file}")
