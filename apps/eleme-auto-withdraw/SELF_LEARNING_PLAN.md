# 自我进化脚本实施路线图 (Self-Learning Roadmap)

本计划旨在分阶段实现《饿了么自动提现脚本自我进化与增强方案》中设计的各项功能。

## 阶段一：基础架构重构与安全加固 (Week 1)
**目标**：解决现有代码的高危问题，建立模块化架构。

- [ ] **R1.1 模块拆分**
    - 将 `index.ts` 拆分为 `ConfigManager`, `BrowserManager`, `StoreService`, `Logger`。
- [ ] **R1.2 安全升级**
    - 移除硬编码密码，集成 `dotenv`。
    - 引入 `.env.example` 和 `.gitignore` 规则。
- [ ] **R1.3 日志系统**
    - 引入 `winston`，实现 JSON 格式日志输出到 `logs/app.log`。
- [ ] **R1.4 基础重试机制**
    - 封装 `RetryPolicy` 类，实现指数退避重试。

## 阶段二：风控适应与规则引擎 (Week 2)
**目标**：降低被检测风险，实现策略动态调整。

- [ ] **R2.1 行为模拟**
    - 集成 `ghost-cursor` 模拟真实鼠标轨迹。
    - 实现随机化的 `ThinkingTime`（思考时间）。
- [ ] **R2.2 规则引擎雏形**
    - 创建 `rules.json` 配置文件。
    - 实现 `RuleEngine` 类，支持热加载配置（无需重启）。
- [ ] **R2.3 自动降级**
    - 识别验证码页面，触发 `CoolDown`（冷却）模式。

## 阶段三：数据驱动与自我进化 (Week 3)
**目标**：通过历史数据优化执行参数。

- [ ] **R3.1 数据持久化**
    - 引入 `better-sqlite3` 或 `lowdb`。
    - 记录表结构：`executions`, `withdrawals`, `errors`。
- [ ] **R3.2 知识库构建**
    - 实现 `KnowledgeBase`，分析最近 10 次执行的成功率。
    - 自动调整：如果某时间段成功率 < 80%，自动避开该时段。
- [ ] **R3.3 可视化报表**
    - 编写 `report-generator.ts`，生成 HTML 格式的周报。

## 阶段四：监控告警与CI/CD (Week 4)
**目标**：实现无人值守与自动化交付。

- [ ] **R4.1 告警集成**
    - 实现 `WebhookNotifier`，对接飞书/钉钉。
- [ ] **R4.2 自动化测试**
    - 编写 Unit Test (Jest/Vitest)。
    - 编写 E2E Test (针对 Mock Server)。
- [ ] **R4.3 CI/CD 流水线**
    - 配置 GitHub Actions，实现代码检查、测试和构建。

---

## 交付标准 (SLA)

| 指标 | 目标值 | 验证方法 |
| :--- | :--- | :--- |
| **提现成功率** | ≥ 99% | 连续运行 100 次，失败次数 ≤ 1 |
| **脚本崩溃率** | ≤ 0.1% | 长期运行监控进程退出码 |
| **风控恢复时间** | ≤ 5 分钟 | 模拟触发风控后，脚本自动暂停并恢复的耗时 |
| **代码覆盖率** | ≥ 80% | Jest 覆盖率报告 |
| **响应时效** | 实时 | 告警消息延迟 < 10秒 |

## 快速开始 (原型预览)

运行以下命令查看自我进化模块的原型演示：

```bash
# 确保已安装依赖
npm install
# 运行原型
ts-node scripts/self_evolving_executor.ts
```
