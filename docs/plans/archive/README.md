# 计划归档层 —— 已完成 / 已被取代的计划，只作历史

> 📦 **这一层只放已完成或已被取代的计划：只作历史，不要照这里任何一份再开工。**
> 现役口径见 [计划层索引](../README.md) 与 [总路线图](../roadmap.md)。

下表就是这一层的全部内容，逐篇给**曾用用途**与**现役替代品**（篇数不写在正文里：现量 `ls docs/plans/archive/*.md | wc -l`，目录另计）。

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
| [phase-1-single-client-loop.md](phase-1-single-client-loop.md) | P1 详细计划：单端（Web）闭环 | P1 已完成（`pnpm verify:p1` 的零 mock E2E，条数由脚本自报）；现役口径 [总路线图](../roadmap.md) 的 P1 行与 [多端统一主计划](../multi-end-unified-strategy.md) |
| [phase-2-multi-platform.md](phase-2-multi-platform.md) | P2 详细计划：多端补齐（存储契约 / SQLite / RN / 鸿蒙） | 已被取代；现役替代品 [多端适配计划](../multi-platform-adaptation.md) 与 [桌面原生迁移计划](../desktop-native-migration.md)，二者又收敛于唯一权威主计划 [多端统一主计划](../multi-end-unified-strategy.md) |
| [landing-page-optimization.md](landing-page-optimization.md) | 落地页那一轮视觉与首屏优化的任务书（状态行自记「本轮目标已完成」） | 落地页与站点的现役口径 [站点补齐与能力对标](../site-and-parity-alignment.md)；判据已内化进 `apps/landing` 的测试与 `pnpm check` 链 |
| [landing-motion-audit/](landing-motion-audit/) | 落地页动效审计与整改（`improve-animations` 产出，基线 `18b34ce`，5 条发现全部 DONE） | 同上：动效判据落在 `apps/landing` 的用词/帧率那几道门；站点现役口径 [site-and-parity-alignment.md](../site-and-parity-alignment.md) |
| [countdown-w8-shell-gate.md](countdown-w8-shell-gate.md) | 倒数日 W8：三端接线 + 壳级门禁那一格的落地结论 | 判据已内化为 `pnpm check:shell-surfaces`；倒数日线现役口径 [countdown-anniversary.md](../countdown-anniversary.md) §8.4 与 [批次二交接](../countdown-batch2-handoff.md) |
| [gate-blindspot-handoff.md](gate-blindspot-handoff.md) | 门禁盲区四项（状态行自记「全部处理完」） | 现役机制是 `pnpm check:gate-wiring`（链外门禁必须有可验消费方），盲区口径 [环境陷阱](../../reference/environment-traps.md) 的 400 号段 |
| [notification-and-activity.md](notification-and-activity.md) | 通知与活动流那一轮的实施计划（状态行：已完成 2026-09-29） | 现役口径 [总路线图](../roadmap.md) 的通知/提醒那一行与 [ADR-0051](../../adr/0051-mobile-reminder-delivery.md)；协作侧的"动态流"另见 [共享清单计划](../collaboration-shared-lists.md) §9 |
| [goal-landing-and-quality-audit.md](goal-landing-and-quality-audit.md) | 落地页与质量审计那一轮 goal 的执行账（状态行：已完成 2026-10-03） | 站点与质量现役口径 [site-and-parity-alignment.md](../site-and-parity-alignment.md)；审计类结论已折进 [UI 审计](../../research/ui-aesthetic-and-design-system-coverage-audit.md) |
| [goal-settings-ia.md](goal-settings-ia.md) | 设置信息架构那一轮 goal（移动端优先 + 电脑端验证，状态行：✅ 完成） | 规范本体 [账号信息架构](../../reference/account-information-architecture.md)；后续设置面改动按该规范走 |
| [waytofuture-handoff.md](waytofuture-handoff.md) | 备案与对外口径那一轮的交接书（状态行：全部已上线可用） | 合规线现役口径 [计划层索引](../README.md) 的备案那几行 + `docs/reference/` 的合规参考；**已上线的事实不再从这里读** |

> 🔴 **扩编只有这一条路**：产品负责人 2026-10-16 要求「只保留最新那一批」，此后每一批归档都必须
> ① 先确认那份计划**自己的状态行**声明完结（不是别人替它宣布）；② 把「现役替代品」填成**真实存在**的文件
> （`docs-link-check` 当场会验，指错就红）；③ 回 [计划层索引](../README.md) §三 同步登记；
> ④ 现量数一次入链（`grep -rn -F "<文件名>" --include=*.md .`），被 `docs/adr/` 指着的那几份**不动** ——
> ADR 冻结，改 href 等于改历史记录。2026-10-20 新增的八份就是按这四步走的。
