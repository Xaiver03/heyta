# 计划归档层 —— 已完成 / 已被取代的计划，只作历史

> 📦 **这一层只放已完成或已被取代的计划：只作历史，不要照这里任何一份再开工。**
> 现役口径见 [计划层索引](../README.md) 与 [总路线图](../roadmap.md)。

本目录这 11 篇各自的**曾用用途**与**现役替代品**（下表就是这一层的全部内容）：

| 文件 | 它曾经做什么 | 现役替代品 / 现役口径 |
|---|---|---|
| [activity-categories-and-colors.md](activity-categories-and-colors.md) | 活动分类与分类着色的增量计划：颜色由用户赋义、App 不判健康度；真正的工程量在时间归因（零新增字段跑通第一版） | 已并入 `main`，语义活在共享层 `packages/domain/src/activity-categories.ts`；计划层现役口径 [总路线图](../roadmap.md) §1.2 激励与成长体系 |
| [ai-gap-audit-and-remediation.md](ai-gap-audit-and-remediation.md) | AI 功能实现度审计（基线 `c667fb4`，只读）＋把缺口拆成三个互不重叠的整改模块 | [AI 策略入口](../ai-strategy.md) 与 [AI 架构](../../reference/ai-architecture.md)；三个模块均已并入 `main`（`06d7be3` / `0614475` / `73b13b2`） |
| [ai-open-decisions.md](ai-open-decisions.md) | AI 线「代码解决不了、必须产品拍板」的决策清单 | 已全部决策；现役策略口径 [AI 策略入口](../ai-strategy.md)，逐条决策理由在 [ADR 索引](../../adr/README.md) |
| [ai-remediation-module-1-engine.md](ai-remediation-module-1-engine.md) | 模块 1 任务书：AI 引擎层正确性与孤立分支治理（交付物是对抗性验证，零源码改动） | 已执行；现役 AI 计划口径 [AI 策略入口](../ai-strategy.md) 与 [AI 能力面闭环](../ai-assistant-closure.md) |
| [ai-remediation-module-2-journey.md](ai-remediation-module-2-journey.md) | 模块 2 任务书：AI 用户旅程闭环与「界面说真话」 | 已并入 `main`（`0614475`）；现役 AI 计划口径 [AI 策略入口](../ai-strategy.md) 与 [AI 能力面闭环](../ai-assistant-closure.md) |
| [ai-remediation-module-3-memory-moat.md](ai-remediation-module-3-memory-moat.md) | 模块 3 任务书：把「记忆护城河」接到用户眼前（用真 IndexedDB 钉死 `readRecentOps` 的窗口方向） | 已并入 `main`（`73b13b2`）；现役 AI 计划口径 [AI 策略入口](../ai-strategy.md) 与 [AI 架构](../../reference/ai-architecture.md) |
| [ai-remediation-parallel-runbook.md](ai-remediation-parallel-runbook.md) | 三个 AI 模块并行开工的 runbook：分叉点 tag、租约门禁、合并程序 | 它的**可执行版本**仍在用：`scripts/check-module-boundaries.mjs`；计划层现役口径 [AI 策略入口](../ai-strategy.md) |
| [ai-tool-calling.md](ai-tool-calling.md) | AI 工具调用的分阶段计划（P0–P2 已落地；P3–P4 未开工） | 不变量见 [ADR-0035](../../adr/0035-ai-tool-calling-reuses-local-api.md)，进度与下一步以 [AI 策略入口](../ai-strategy.md) §7–§8 为准 |
| [motivation-and-progression.md](motivation-and-progression.md) | 激励与成长体系的设计：三层架构 × 四个循环、不改 schema 的落地映射、E2EE 下的指标方案 | L1/L2/L3 已实现并并入 `main`；计划层现役口径 [总路线图](../roadmap.md) §1.2 激励与成长体系 |
| [phase-1-single-client-loop.md](phase-1-single-client-loop.md) | P1 详细计划：单端（Web）闭环 | P1 已完成（`pnpm verify:p1` 11 条零 mock E2E）；现役口径 [总路线图](../roadmap.md) 的 P1 行与 [多端统一主计划](../multi-end-unified-strategy.md) |
| [phase-2-multi-platform.md](phase-2-multi-platform.md) | P2 详细计划：多端补齐（存储契约 / SQLite / RN / 鸿蒙） | 已被取代；现役替代品 [多端适配计划](../multi-platform-adaptation.md) 与 [桌面原生迁移计划](../desktop-native-migration.md)，二者又收敛于唯一权威主计划 [多端统一主计划](../multi-end-unified-strategy.md) |

> 🔴 本目录**不再扩编**：这 11 篇是产品负责人 2026-10-16 要求「只保留最新那一批」后归进来的存量。
> 新的完成计划要归档时，**先把「现役替代品」填成真实存在的文件**，再回到 [计划层索引](../README.md) §三 登记。
