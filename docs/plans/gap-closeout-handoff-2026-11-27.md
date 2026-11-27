# 滴答覆盖图谱补齐 · 交付与合并说明（2026-11-27）

> 分支：`integrate/gap-close-20261126`（tip `acba4a16`，基于 `c1e459dc`）
> 规模：35 个提交、11 条特性分支合并、**122 个文件 / +9,880 行**。
> 目的：把覆盖图谱里「可落代码」的缺口实现出来，供最终并入主线。

## 1. 已实现并合入本分支的格（实现度→有）
- 日历：#40 显示设置/配色、#41 外部日历订阅入口、#54 课程表视图（周×时段网格+导入）
- 统计：#16 总结屏、#46 习惯打卡记录、#48 习惯统计图、#50 专注统计图+补录
- 输入：#6 全局命令面板、#7 快捷键一览
- 设置/引导：#18 智能清单显示配置、#57 通知默认值、#56 强调色+应用图标、#62 TOTP、#69 Web 首启
- 任务：#15 委派 UI、#29 检查项级提醒、#30 任务模板（可选新实体，不 bump schema）
- 桌面/外壳：#51 白噪音（WebAudio 合成）、#70 打印、#36 置顶常驻便签窗、#72 托盘落下面板窗、#61 本地应用锁（PIN/WebCrypto）

## 2. ADR 定档关闭
- [ADR-0093](../adr/0093-team-and-seat-billing-out-of-scope.md)：团队/席位/工时 = 不做（#65）
- [ADR-0094](../adr/0094-platform-native-capabilities-boundary.md)：系统快捷指令 = 平台独占范围外（#73）；打印/应用锁/浮动便签 = 要做（已实现）

## 3. 验收读数（本分支上真跑）
- `pnpm -r typecheck` rc=0
- 15 项 check 门禁全绿：ui-language / design-token-refs / overlay / focus-single-source / menu-keyboard / choice-surface / action-vs-choice / row-single-source / empty-state / settings-row-anatomy / privacy-as-blocker / schema-migration-drift / migrations / token-hashing / session-revocation
- `@heyta/web` 2721 通过；`@heyta/domain` 1471 通过；`@heyta/local-api` 411 通过
- 覆盖图谱现量：**A 61 / B 15 / H 0 / D 3 / C 0**（`node scripts/ticktick-coverage-report.mjs`）

## 4. 已知「非本批引入」的红（动手前先看，别误判为本批造成）
- `@heyta/app-host` 3 个 AI 测试、`@heyta/ai` 6 个 capability-manifest/routing 测试：**上游既有**（在主检出同版本同样红，伴生另一条 AI workstream）。
- `apps/desktop` `tests/reuse.spec.ts` 3 条：**上游 `feat/app-auto-update` 既有**（`app-update*.ts → @heyta/app-host`），与本批无关。
- `check:surface-budget`：上游既有 font-rungs（`ai-chat-direction-a.css`）。
- `check:docs`：`docs/plans/desktop-native-migration.md` 旧链接（本分支基于较早基线；主线已修）。

## 5. 合并注意（🔴 重要）
本分支**未并入主线**：主检出 `feat/app-auto-update` 当时**正被另一条 workstream 持续提交、且工作区脏（64 项）**，直接合会与对方在途改动冲突、并可能覆盖其成果（AGENTS §6 并发纪律）。
- 建议：等主检出那一条 workstream 收口到干净点后，再把本分支 merge 进主线。
- ⚠️ 本分支与主线**都改过** `docs/research/ticktick-coverage-graph.md`：合并时该文件必冲突。**实现度以本分支为准**（本分支有真实代码），**B 档靶子证据以主线那条 workstream 的新截图/登记为准**，人工合并两者。

## 6. 仍开着的（非本分支能独自了结）
- **B 档 15 格**：实现度已「有」，缺滴答一手靶子。补靶子清单见 [`ticktick-b-targets-2026-11-27.md`](ticktick-b-targets-2026-11-27.md)。
- **#3 顶部 tab 条**：按 `entry-layers` 判「复用 rail、不新增」，属有意不新增（非漏做），留 D。
