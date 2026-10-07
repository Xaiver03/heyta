# Goal：P0 体验整改（审计合并稿 §8「一周内」批）

> 状态：**进行中**（2026-10-06 立项）
> 依据（唯一工单来源）：[product-level-ia-ux-audit.md](../research/product-level-ia-ux-audit.md) §8。
> 本文档只记**执行状态与证据**，不复制审计论证。

## 0. 撞车登记（开工前置第 3 步的现量读数，2026-10-06 16:35）

| 文件 | 状态 | 判定 |
|---|---|---|
| `apps/web/src/App.tsx` | M，mtime **25 分钟前**（并行会话**实时写着**，diff 111 行） | 🔴 W1/W2/W3 全部落在它上面 ⇒ **换序，等静默** |
| `packages/i18n/src/locales/{zh-CN,en}.ts` | M，mtime **22 分钟前**（实时写，diff 各 4-5 行） | 🔴 一切"新增词条"的工单（W6 分组标题、W8b 宿主接线）⇒ **换序** |
| `apps/web/src/features/tasks/store.ts` | M，mtime **7.2 小时前**（陈旧线） | 🟡 允许**叠加**编辑，绝不回退既有 hunk |
| view-tabs.ts / narrow.css / TaskDetailCard.tsx / TaskRepeat.tsx / quadrant/ / packages/ui/src/notes/ | 干净 | ✅ 可开工 |

并行会话主题（从脏文件推断）：auth/本地销毁/设置锚点聚焦（`settings-anchor-focus.spec.tsx` 等新测试）。
⚠️ 该线在做**设置聚焦**，与 W2（设置浮层遮蔽详情列）相邻——W2 开工前必须先读它的未提交测试，两边都要绿。

## 1. 工单台账（判据见审计稿 §8；此处记状态与证据，收尾逐列回填）

| # | 工单 | 状态 | 执行体 | 证据（回填） |
|---|---|---|---|---|
| W1 | IA 收敛：实现"4+1 更多" | 🔴 阻塞（App.tsx 实时占用） | 待派 | — |
| W2 | 设置浮层遮蔽详情列 | 🔴 阻塞（同上；另见 §0 警告） | 待派 | — |
| W3 | AI 工具调用默认收起 | 🔴 阻塞（同上） | 待派 | — |
| W4 | 窄屏底部导航（纯 CSS） | 🔄 进行中 | 子 Agent | — |
| W5 | 四象限空态减重 | 🔄 进行中 | 子 Agent | — |
| W6 | 详情列四分组 + RRULE 高级化 | 🔴 阻塞（需 4-5 个新词条） | 待派 | — |
| W7 | Web 标题 + 手动优先级接线 | 🔄 进行中（零新增词条：labels.title + `web.ai.prioritize.priority.*` 现成） | 子 Agent | — |
| W8 | 便签静默失败 | 🔄 W8a（共享层）进行中；W8b（宿主 labels + 2 个新词条）阻塞于 i18n | 子 Agent / 主会话 | — |
| W9 | 视觉基线重取证 | ⏳ 依赖 W1-W8 落地后一次串行 Playwright 跑（端口独占，避免并行抢 4318/4319） | 主会话 | — |

## 2. 分工与边界（主会话统一维护，子 Agent 只回报）

- 并行度：W4/W5/W7/W8a 四组文件集互不相交，已并行；截图与 e2e **只在收尾串行跑一次**。
- 子 Agent 通用硬约束已随任务书下发：零新增词条（除 W8b）、不碰 App.tsx 与 i18n locale、不跑 `pnpm -r`、不 commit。
- 产品拍板项（审计稿 §3.3：专注提一级、搜索提一级）**不做**，收尾时汇总提问。

## 3. 收尾清单（AGENTS §8.7 完成定义）

- [ ] 每条工单按「设计 / 生产接线 / 失败与恢复 / 平台验收 / 当前产物」给证据或如实写"未做"
- [ ] `pnpm -r typecheck && pnpm -r test`（NO_COLOR=1 数失败）
- [ ] `check:design` / `check:ui-language` / `node research/tools/docs-link-check.mjs`
- [ ] 截图四铁律（先截图再断言 / 固定路径 / 抓 console / **人看图**——主会话逐张看）
- [ ] W8 改了共享层 ⇒ `pnpm reinstall:all`（跑不了如实登记，不冒充）
- [ ] 证据入 `apps/web/evidence/p0-remediation/`（含 README 索引）
