# Goal：时间线重做 —— P1 诚实 UI（共轴 + 三态降级）→ P2 排期面

> 状态：**✅ 已完成（P1 + P2 全部四手势，2026-10-02）**。P1 证据在
> [`ui-review-fill-zh-timeline.md`](ui-review-fill-zh-timeline.md) §5.4 与本文件 §8；
> **P2 已交付（证据在 R-doc §5.5 与本文件 §9）**：ADR-0043 的字段 / `setSchedule` /
> 三态生产者 / 拖拽手势 / 三条骨架判据全部落地，真实拖拽 E2E `RESULT=OK`。
> P3（打磨）按 §4 登记进 roadmap，不在本 goal。
> 🔴 **触发**：产品负责人两轮原话 ——「这个时间线的 UI 很离谱啊，怎么可能都是文字？时间线是线呢？」
> （R4 立案）与「时间线前端的 UX 完全就是扯淡……你做一些深度的调研」（本轮立项）。
> 深度调研已完成并落档：[`../research/timeline-view-deep-dive.md`](../research/timeline-view-deep-dive.md)。
> **本 goal 是 R4 的实施载体 + P2 的启动单**；执行会话以本文件为唯一任务书。

---

## 0. 目标一句话 + 与既有文档的分工

把时间线从「每个任务一张自归一化甘特图」重做成「**一根全视图共用的时间轴、行 = 任务、
条/点/未排期泳道三态降级**」的真实时间线（P1）；随后拍板数据模型、接上滴答式拖拽排期（P2）。

| 文档 | 管什么 | 关系 |
|---|---|---|
| [`../research/timeline-view-deep-dive.md`](../research/timeline-view-deep-dive.md) | 调研证据：现状数据流、滴答/Notion/Todoist 交互模型、能力差距表、三阶段方案 | 证据层，**不改**（结论有变新增勘误） |
| [`ui-review-fill-zh-timeline.md`](ui-review-fill-zh-timeline.md) §5 | R4 全案：实测数字、三态降级表（唯一事实源）、8 条判据、变异清单 | P1 的**实施规格**，完工后在其台账落证据 |
| 本文件 | 执行顺序、P2 范围、碰撞面、收尾纪律 | **任务书本体** |

## 1. 动手前必读（按序）

1. 本文件全文；
2. [`ui-review-fill-zh-timeline.md`](ui-review-fill-zh-timeline.md) §5（R4）——**判据 4 在改代码前必须先红**（§7 元规则一：先修探针再改代码）；
3. [`../research/timeline-view-deep-dive.md`](../research/timeline-view-deep-dive.md) §1–§4；
4. `AGENTS.md` §3.3（新字段可选 + 运行时默认）、§3.4（一个意图 = 一个 op）、§3.5（apps/ 不许有业务语义）、§5（设计系统三硬规则）、§6.2（界面验收两硬性规定）、§7 元规则三条。

## 2. P1 范围（诚实 UI；**零 schema 改动**）

### 2.1 分层刀口（与 R4 §5.3 一致，此处补足到可执行）

| 层 | 刀 |
|---|---|
| `packages/domain/src/timeline.ts` | 新增「任务在时间上的位置」三态类型 `range / point / unscheduled`，**在类型上可区分**（判别联合，不是靠 `durationMinutes` 有无这种弱信号）；`sharedTimelineSpan` **要么改成同时共原点、要么改名** —— 名字承诺了它没做的事就是下一个类 A |
| `packages/app-host/src/timeline-plan.ts` | `TimelineTaskLike` 扩 `dueDate?`（可选字段）；产出三态之一；🔴 **绝不编长度**：只有估时没日期 ⇒ `unscheduled`；只有日期没估时 ⇒ `point`；两者都有才 `range` |
| `packages/ui/src/timeline/` | 新 `TimelineBoard`：**整视图一根轴**（`gantt-axis` 数量 == 1）、行 = 任务、左侧冻结行头 + 横向滚动（**单容器方案**，禁多 ScrollView 同步滚）；`point` 画菱形、`range` 画条、`unscheduled` 进**有名字的「未排期」泳道**且不落图；今天线贯穿全图；逾期用警示色画在真实位置；**每行保留文字标题与日期**（无障碍表面不许丢，R4 判据 6） |
| AI 估时 | 降级为行/菱形旁的 **badge**（`≈90′ · AI`），不画成任何几何长度；落地页那句「虚线是 AI 估的」从条上撤下，等 P2 有真 `range` 再回来 |
| 旧 `GanttChart` | 刻度/今天线/条几何的**计算函数上移**给 `TimelineBoard` 复用；「每任务一张」的容器结构废弃；清单排程（`parseChecklistFromNote` + `buildTimeline`，数学保留）**降级进任务详情**当预览，并标明它是「任务内部坐标系」 |
| `apps/web` / `apps/mobile` | 宿主只做接线：web `TimelinePanel` 换喂新板；移动端 `TimelineScreen` chip 消费同一共享组件。**apps/ 里不许出现一行排期语义**（§3.5） |
| `packages/i18n` | `web.timeline.*` / `web.gantt.*` 按新视图改写，**中英同步**；`web.shell.modules.timeline.note`（「按日期把任务铺在一条时间轴上」）第一次变成真话 |
| 落地页 | 展厅件（`mockup/timeline-shape.ts`）**本来就是正确形状，不动**；P1 完工判据含「应用视图与它形状对齐」 |

### 2.2 与 R-doc 做序的冲突裁决

R-doc §7 把 R4 排在 R5/R1/R2 之后。**产品负责人 2026-10-01 指令（本 goal）优先：时间线先做。**
理由与边界：新 `TimelineBoard` 的行头**不是** `TaskRow`（R1 的负边距不随行进来）；
但两条教训必须带走 ——
① 容器高度按 R2 的结论写：**母层给确定约束、子层按约束长**，不许写 `100vh`（共享层还服务 RN）；
② 若实施中必须动 `TaskRow` / `.ht-content` / 任何行骨架，**先停下**，按 R-doc 对应小节的判据把那一刀做对再回来 —— 不许顺手改、更不许绕开判据改。

### 2.3 P1 判据

**R4 §5.3 的 8 条原样执行**（一根轴数量==1；相对位置符号一致且正向对照；无假 bar；界面时间必须来自 `dueDate` 且**改前必红**；未排期可见不落图；无障碍文字面；桌面+移动+暗色截图人看；三种变异），外加本 goal 三条：

9. **锚点不消失**：`timeline-view` testID 继续存在 —— `e2e` 的白屏锚点与 `VIEW_ANCHOR` 登记项挂在它上面，重画时**刻意迁移**并同步改登记，不许静默丢（R6 判据 4 的同族教训）；
10. **门禁不回退**：`check:design` / `check:ui-language` / `check:layering` / `check:row-single-source` 全绿 —— 新板写在 `packages/ui`，不许在 web 留 `.ht-timeline-*` CSS 家族；
11. **移动端同一份**：Android 模拟器上 `verify:mobile-timeline` 的两条判据翻新成新形状（任务标题出现在**共轴**上；无日期任务出现在**未排期泳道**），并保持零 mock。

**不引入任何第三方甘特/图表库** —— §3.1/§3.2 两道门 + RN 三端兼容，且要的形状（冻结行头 + 泳道 + 共轴）自绘并不大。

## 3. P2 范围（排期面；**P1 全绿后才开工；先 ADR 后代码**）

### 3.1 前置 ADR（写完并标「已接受」才许动模型）

给 `Task` 增加两个**可选**字段：`startDate?: number`（epoch ms）与 `durationMinutes?: number`（正整数）。
ADR 必须写清：

- 合规形状：可选 + 运行时默认，**不 bump `CURRENT_SCHEMA_VERSION`**（AGENTS §3.3；hydration 不炸）；
- **note 回退**：`durationMinutes` 缺失时读 `readDurationFromNote` 兜底 —— 旧数据不搬家、不迁移、不失效；
- 三态推导规则：`range = startDate (+duration 或 dueDate)`；`point = 仅 dueDate`；`unscheduled = 都没有`；
- `dueDate` 既有语义**一字不改**；
- 授权依据：产品负责人 2026-10-01 批准三阶段方案（=`ai-capability-branches.md` §5.1 预警的「先确认要做时间线再动模型」那次确认）；
- ADR 编号取当前最大号 +1。

### 3.2 交互（每一项 = 一个 op，走 `dispatch()` → op-log → 自动同步）

| 手势 | 语义 | op |
|---|---|---|
| 从「未排期」泳道拖到轴上 | 排期 | `setSchedule({ startDate, dueDate? })`；初始长度取估时 badge |
| 横向拖整条 | 移动 | `setSchedule` 平移 |
| 拖条两端 | 改时长 | `setSchedule({ durationMinutes })` |
| 点轴上空白 | 建任务带日期 | 既有建任务 op + 日期，**一个 op 完成，不 fan-out** |
| 点条/点/行头 | 开任务详情 | 读路径，无 op |

- 新 action 落在 `packages/app-host` 的 `createTaskActions` 一侧；拖拽写入走 `dispatch()`，**绕过 op-log 直改 store 是违规**（§3.4）；
- 两台设备拖同一条 = 既有 LWW + `clientId` + 冲突对话框，**不新增机制**；被回放的 op 不得再次触发副作用（排期 op 只带字段载荷，天然满足）。

### 3.3 P2 判据骨架（实施时写全，先立三条）

1. 每种拖拽断言 **op-log 里出现对应形状的 op**（不是只断言 UI 状态变了）；
2. 拖拽后离线刷新，位置仍在（本地优先）；
3. 变异：绕过 dispatch 直改 store ⇒ 判据 1 红。

## 4. 明确不做（范围外，登记不执行）

- **团队甘特**：依赖连线 / 资源分配 / 关键路径 / 进度百分比 —— Jira 的形状；滴答自己都只做轻量版；
- **自动排期 AI**：AI 只估时（建议值），**条的落点永远是用户的手**（ADR-0005 一脉相承）；
- **日历与时间线合并**：日历是「读」的面、时间线是「排」的面，分工钉死；
- **P3 打磨**（颜色按清单色槽 / 周·月缩放档 / 重复任务只画下一次 / 窗口外指示符 / 移动端拖拽手势 / 子任务 vs 备注清单的二元性）→ 登记进 roadmap，不阻塞本 goal。

## 5. 证据载体与收尾纪律

- **主战场是移动端 + 桌面原生壳；web 证据只能标「桌面载荷」**（R-doc §0 前置纪律）。每阶段：桌面载荷截图 + Android 模拟器截图 + 暗色各至少一张，**人真打开看**（§6.2 规定一），固定路径落 `e2e/test-results/`；
- 每完成一阶段：在 [`ui-review-fill-zh-timeline.md`](ui-review-fill-zh-timeline.md) 台账 R4 行**落证据**（实测数字 + 截图路径 + 变异结果），本文件状态行同步推进 —— **不许只改状态不留证据**；
- 提交前至少 `pnpm -r typecheck && pnpm -r test`（sync-server 沙箱例外按 AGENTS §6 用 `--filter` 排除）；P1 完工加跑 §2.3 判据 10 的四道门禁；
- 🔴 **碰撞面**：本工作树里若另一条会话的 vite 在跑，`pnpm check:ai-e2e` / 完整 `pnpm check` / `reinstall:all` **不得跑**（§7 第 87 条 SIGKILL）—— 跑不了就如实登记缺口，不假装做过；四端重装按 §6.1.1 在可跑环境补齐；
- 不动 `AGENTS.md` / `CONTRIBUTING.md` 规则；不改已接受 ADR 的结论；不引入第三方依赖。

## 6. 执行顺序（P1 内部）

1. **先红**：写判据 4 的探针（有 `dueDate` 无估时的任务 ⇒ 界面区间不含该时刻），确认当前必红；
2. 领域层三态类型 + `sharedTimelineSpan` 裁决（含单测与变异）；
3. app-host 入参扩展与三态产出（含单测：三态各一条 + 绝不编长度的变异）；
4. `TimelineBoard`（轴 → 行 → 菱形/条 → 泳道 → 今天线 → 逾期色），每步带几何断言；
5. 宿主接线（web + mobile）+ i18n 中英 + 旧 `GanttChart` 拆解与详情预览；
6. e2e 翻新（含锚点迁移登记）+ `verify:mobile-timeline` 翻新；
7. 截图三端 + 人看 + 台账落证据 + 收尾门禁。

---

## 8. P1 交付记录（2026-10-02）

**按 §6 顺序全部执行完毕**，与计划只有一个偏差（§2.2 的授权裁决 + 移动端验收环境适配）：

| 步 | 结果 |
|---|---|
| 先红探针 | 两轮红（假时间 / 缺 15:00）→ 重画后转绿，永久钉在 `apps/web/tests/timeline-board.spec.tsx` |
| domain | `timeline-position.ts`（`TaskTimePosition` 三态 + `TimelineBoardRow` 无长度字段）；`sharedTimelineSpan` 删除 |
| app-host | `TimelineTaskLike.dueDate?` + `deriveTaskTimePosition` + `planTimelineRows`；`planTimelineBlocks`（无生产消费者）删除；862 测试全绿 |
| 共享 UI | `TimelineBoard`（一根轴/行=任务/菱形/未排期泳道/今天线/逾期/compact 刻度）+ `ChecklistPlanPreview`；`TimelineView` 删除；ui 396 全绿 |
| 宿主 | web `TimelinePanel` / `App.tsx`、mobile `TimelineScreen` / `TasksScreen` / `TaskDetailSheet`（详情预览挂载点）；i18n 中英同步（`web.board.*` 27 键） |
| e2e | `timeline-view` 锚点保留；R1 e2e 时间线腿改为新板锚点判据；`verify:mobile-timeline` 判据翻新（轴日期 + 泳道），**Android 真机 6/6** |
| 变异 | 三种全精确红（12 红 / 2 红 / 1 红）后恢复源码复验全绿 |
| 门禁 | check:design / ui-language / layering / row-single-source / ui-provider 全绿；domain 747 / app-host 866 / ui 396 / i18n 22 / web 全绿（存量 9 红属并行会话 auth 在飞面，单跑 habits 19/19 证套件顺序污染） |
| 截图 | 桌面浅/暗 + Android 各一，人真看（路径见 R-doc §5.4） |

**实施中新修的缺陷**（都是判据/截图当场抓的）：compact 刻度重叠（密度减半 + 今天前缀保留）、
`tickText` 紧凑档今天只剩颜色载体（1.4.1 违规，已修）。

**P2 未开工**（如实）：ADR-0043 已写并标已接受（授权依据见其头部）；代码侧
（字段 / `setSchedule` / 拖拽）留待下一轮，清单在 ADR §7。**不许在 P2 半途宣告本 goal 完成**。

---

## 9. P2 交付记录（2026-10-02）

按 [ADR-0043](../adr/0043-timeline-p2-task-start-date-duration.md) §7 清单**全部落地**：

| 项 | 结果 |
|---|---|
| 字段 | `Task.startDate?` / `durationMinutes?`（可选、不 bump schema、hydration 安全） |
| `setSchedule` | async + 存在性 throw + 点名才写（移动/改时长互不混 payload）+ 夹取 [5,480]；`dueDate` 不在管辖区 |
| 三态生产者 | `range/point/unscheduled` 穷举 + 字段优先 / note 回退（ADR §4） |
| 拖拽 | 泳道拖上轴 / 拖条移动 / 拖右缘改时长 / **点也可拖**（start+due ⇒ range）；纯函数换算（除向）+ 拒绝滚动态祖先抢占 |
| 判据 | app-host op 形状 7 条 + web 出口 2 条（真实 op-log）+ 板 range 渲染 2 条 + 拖挂数学 4 条；变异（绕过 dispatch 直改实体）⇒ 2 红 → 恢复 ⇒ 绿 |
| 真实拖拽 | Playwright 真应用手势：points 2→1、bars=1、RESULT=OK；截图人看 |
| 回归 | domain 747 / app-host 881 / ui 400 / i18n 22 / web 1323 全绿；五门禁 + typecheck 0 错 + docs-link 0 |

**手势 4「点空白建任务带日期」（2026-10-02 补齐，§3.2 表格第四行）**：
`TimelineBoard.onCreateAt`（轴 = 点击面）→ `NewTaskFields.startDate` → 既有建任务 op
（一条 CRT，不 fan-out）；标题走 `web.board.untitledTask`（中英）；op 形状判据
（恰好一条 CRT 带日期字段）+ 真实点击取证（新点落在点击时刻，含逾期警示路径）。
实施坑：`measureInWindow` 异步回调让瞬时的 down→up 手势拿到 null 布局 —— 渲染后
effect 主动测量修掉（详见 R-doc §5.5）。

**已知边界（如实）**：移动端不传 `onScheduleTask` = 只读板（手势平台适配 = goal §4 P3）；
`storage-backend-shell` 出现过一次与本刀无关的全量顺序 flake（单跑/复跑均绿，已登记）；
桌面截图证据为**桌面载荷**口径（web 壳同源），Android 侧本轮只验读路径（P1 判据 6/6 仍绿）。
