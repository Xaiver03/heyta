# 时间线视图深度调研：现状、业界与目标设计

> 元信息：2026-10-01 立档。起因：产品负责人原话「时间线前端的 UX 完全就是扯淡……你做一些深度的调研」。
>
> 与 [`plans/ui-review-fill-zh-timeline.md`](../plans/ui-review-fill-zh-timeline.md) **R4** 的分工：R4 管「把说谎的 UI 修诚实」（实测、三态降级与 8 条判据已写好、未实施）；本篇管**更大的一层** —— 时间线作为**产品功能**该长成什么样、数据模型要不要为此动、分几步走。R4 是本篇 §4 P1 阶段的实施规格；本篇不复制 R4 的实测数字与判据，引用见对应小节。
>
> 标注约定：引用本仓库代码给 `文件:行号`（2026-10-01 读自当前工作树）；外部结论给 URL；没核实的写「未核实」。

---

## 0. 一句话结论

现在的时间线**病不在皮肤、在数据契约**：入参里没有任何"什么时候"（`TimelineTaskLike` 只有 `id/title/note`），画出来的却是日历时间 —— 所以它只能靠编（每任务一把自归一化的尺、没估时编 60 分钟、相对偏移印成假日历时间）。业界（滴答清单 = 我们的对标）的标准形状是：**一根全视图共用的时间轴、行 = 任务、条长 = 时长、无时间数据的任务不落图而进"待安排"区、拖拽即排期**。要做到这个形状，heyta 分三步走：**P1 先把 UI 修诚实**（= R4，不加字段）；**P2 拍板给 `Task` 加可选 `startDate` / `durationMinutes`**（一次 ADR，把时间线从"只读投影"变成"可拖拽的排期面"）；**P3 打磨**（颜色、重复任务、移动端手势）。**不建议**做成团队甘特（依赖连线/资源/关键路径）——那是团队工具的形状，个人任务管理里滴答自己也只做了"比甘特更轻"的版本。

---

## 1. 现状：heyta 的时间线现在是什么

### 1.1 数据流（全部读自当前工作树）

```
侧栏筛选（收集箱/今天/清单/标签/象限）
  └─ selectVisibleTasks → filterTasks（只留未完成）
      └─ planTimelineBlocks(tasks)                packages/app-host/src/timeline-plan.ts
          └─ parseChecklistFromNote(note)         备注 Markdown 清单行 + （依赖：X）行尾语法
          └─ readDurationFromNote(note)           备注里「预计耗时：N 分钟」那行（AI 写入）
          └─ buildTimeline(units, …)              packages/domain/src/timeline.ts：串行/拓扑排程
      └─ TimelineView → 每任务一张 GanttChart     packages/ui/src/timeline/
```

入参类型是整个问题的根（`packages/app-host/src/timeline-plan.ts:32-36`）：

```ts
export interface TimelineTaskLike { readonly id: string; readonly title: string; readonly note?: string; }
```

**没有 `dueDate`，没有任何"什么时候"。** 任务模型里现成的 `dueDate` / `completedAt` / `createdAt` 一个都没用上（grep 证实 `timeline-plan.ts` 与 `packages/ui/src/timeline/*` 对这三个字段零引用）。

### 1.2 三个病灶（R4 §5.1 已实测钉死，这里只列结论）

1. **每个任务一把尺**：三条任务 → 三张 `gantt-chart`，每张 1152px 宽、各自从 0 归一化 ⇒ 条都占满整行，"位置"这个最精确的视觉编码被彻底浪费。`sharedTimelineSpan` 名字叫"共用一把尺子"，实际只共了**长度单位**没共**坐标原点** —— 名字比实现大。
2. **界面说谎**：`gantt-dates-0` 实测显示「10-01 0:00 → 1:00」，而那条任务的截止时间是 15:00。相对偏移被印成了真日历时间。
3. **编长度**：没估时的任务按 `DEFAULT_DURATION_MINUTES = 60` 画出一条真的 1152×24 的条。文案诚实（「其中 1 条未估时，按 1 小时排」），但**诚实的兜底仍然造出了一条说谎的线**。

外加一个产品层病灶：**交互 = 0**。`packages/ui/src/timeline/` 全目录 grep `onPress|Pressable|ScrollView|Touchable` 零命中 —— 条不可点、不可拖、不可缩放，视图内部无滚动。它是一份"报告"，不是一个"面"。

### 1.3 应用与自己的营销承诺都不一致

落地页展厅件（`apps/landing/src/mockup/timeline-shape.ts`）画的反而是**正确的形状**：一根**四天共用轨道**、三行任务、宽度刻意不等（60%/30%/45%）、AI 估时用虚线边区分。营销文案（`landing.showcase.timeline.title`）：

> 「先看清这一周塞不塞得下 —— 每条任务按估时排进日程……不给你一个看起来很整齐的假象。」

而应用里真实实现是"每任务一张图 + 假日历时间 + 编出来的长度"。**用户从落地页走进应用，看到的是两种不同的产品。**

### 1.4 现有资产盘点（重画时能留什么、必须扔什么）

| 资产 | 位置 | 处置 |
|---|---|---|
| 备注清单解析（复选框/列表/依赖语法/去重/封顶） | `packages/domain/src/timeline.ts` `parseChecklistFromNote`，40+ 单测 | **留**：降级为任务详情内的"子条目排程预览"（另一个坐标系，标明即可） |
| AI 估时读写（`预计耗时：N 分钟`，走 op-log 同步、不加字段） | `duration-note.ts` + `AiDuration.tsx` | **留**：变成行/条上的**元数据**（badge），P2 后可作拖拽建条的初始长度；P2 若加 `durationMinutes` 字段，note 行降为**读时回退源** |
| 串行/拓扑排程数学 | `buildTimeline` | **留**：服务于详情内的子条目预览 |
| `GanttChart` 整图组件（每任务一张） | `packages/ui/src/timeline/GanttChart.tsx`（417 行） | **拆**：刻度/今天线/条的计算函数上移给新 `TimelineBoard` 复用；"每任务一张"的容器结构废弃 |
| `sharedTimelineSpan` | `timeline.ts:201` | 按名字兑现（共原点）或**改名** —— R4 已点名"留着它就是下一个类 A" |
| i18n 词条 `web.timeline.*` / `web.gantt.*`（中英各 20+ 条） | `packages/i18n` | 大半保留语义、随新视图改写；**中英必须同步**（`check:ui-language` 拦） |
| e2e / 真机验收 | `verify:mobile-timeline.sh`、`gantt-chart.spec.tsx` 等 | 判据换成 R4 的 8 条 + 本篇 §4 的交互判据 |

### 1.5 入口与视图边界

- **Web/桌面**：rail 第 5 个 tab（`apps/web/src/App.tsx:361`，ChartGantt 图标，功能模块默认开）。`App.tsx:352` 附近的注释「时间线占的是滴答 rail 里『日历』那一格（heyta 没有日历视图）」**已经过期** —— P2 里 `CalendarBoard` 已落地，heyta 现在两个视图都有，边界见 §3.2。
- **移动端**：不是独立 tab，是任务页 `list | quadrant | timeline` 三档 chip 的第三档（`apps/mobile/src/screens/TasksScreen.tsx:401`，ADR-0015 的处置）。
- 渲染四端同一份（`packages/ui`），规划语义一份（`packages/app-host`），宿主只做接线 —— 这个分层是对的，重画沿用它。

---

## 2. 业界怎么做（外部证据）

### 2.1 滴答清单 / TickTick —— 直接对标，交互模型完整可抄

以下 12 条全部来自官方帮助文档（英文版全文抓取，[Timeline View: A Game-Changer for Project Management](https://help.ticktick.com/articles/7055782331050622976)；中文帮助中心同文见 [时间线视图](https://help.dida365.com/articles/7019123502271692800)）：

1. **它是清单级视图**：一个清单在 列表 / 看板 / 时间线 三种视图间切换；智能清单（今天/明天/最近 7 天）**不提供**时间线。
2. 形态定位自述：「a **lighter project management tool compared to Gantt charts**」（[官网功能页](https://ticktick.com/features)同句）—— 给多周/多月的计划与调整用。
3. 任务显示为**横向条**：条的**长度 = 时长**、**位置 = 起止时间**；横向连续呈现，按住鼠标拖动即可横向滚动。
4. **只显示设了时间的任务**；没设时间的任务进**「待安排」区（"Schedule Tasks" section，在视图右侧）**—— 从那里**拖到时间线上即完成排期**。
5. **点击空白处直接建任务**，日期由落点自动填。
6. 滚动查看**周或月**。
7. **显示比例可切换：日 / 周 / 月**（鸟瞰）。
8. **拖条的边 = 改时长**（官方原话：代替"选中任务→时间设置→改结束时间→保存"的四步）。
9. **拖整条 = 移动**（起止随落点对齐到相应时间）。
10. 颜色可按**清单 / 标签 / 优先级**着色（视图选项，与日历一致）。
11. 手机 App 同样支持（V6.4.0 起进入移动端）。
12. 已知边界：**重复任务不会把每一次都画出来**。

社区侧补充（[Reddit r/ticktick 讨论](https://www.reddit.com/r/ticktick/comments/tssiji/what_are_your_thoughts_on_the_new_timeline)）：每条时间线只含**单个清单**的任务；着色维度与日历共用一套选项。

**注意一个前提差**：滴答的任务模型有"开始时间 + 结束时间/时长"，所以条有真实起止。heyta 的 `Task` 只有 `dueDate` —— 这是 §4 要分两步走的全部原因。

### 2.2 Notion Timeline —— 降级与并置的教科书

来自官方帮助（[Timeline view databases](https://www.notion.com/help/timelines)）：

- 需要**日期属性**（区间最佳）；「Show timeline by」可选用哪个日期属性驱动视图。
- **Table + Timeline 并置**：左侧表格永远列全部条目，**没日期的条目在表里可见但不落时间线** —— 从表里拖上时间线即排期。（Notion 没有 Jira 那种"backlog 泳道"，它用并置表格实现同一职责。）
- 拖条横移 = 改期；拖条两端 = 改时长；按任意属性 group = 泳道。
- 缩放从日到年；窗口外的条用**边缘指示符**标出而不是截断。

### 2.3 Todoist —— 反证：时间线是稀缺到值得收费的能力

Todoist **没有原生时间线**：官方的最近形态是 Upcoming 视图 + Pro 的日历布局（[Upcoming](https://www.todoist.com/inspiration/todoist-upcoming-view)、[Calendar layout](https://www.todoist.com/help/todoist/get-started/plan-your-week-with-the-upcoming-view-OKOg1mR8)），甘特式视图只能靠第三方（[Ganttify](https://gantt-chart.com/features/todoist)）。而滴答把 Task Duration 与 Timeline View 都放在 **Premium** 里 —— 「这是一个愿意付费的能力」（[`ai-capability-branches.md`](../plans/ai-capability-branches.md) §5.1 同判）。

### 2.4 三态降级：真实产品从不编长度

这一条 R4 §5.2 已把表做好（滴答/Notion/Jira/GitHub Roadmap/MS Planner/vis-timeline/dhtmlx/FullCalendar/Ant Design/OmniFocus 逐家对照），**唯一事实源在 R4，此处只留结论**：

- 有起止 → **条**；只有时刻 → **点/菱形**（不是条）；什么时间数据都没有 → **移出图区、进有名字的泳道/待安排区**。
- 唯一的"兜底时长"先例是日历引擎的**显式可配置项**（FullCalendar `defaultTimedEventDuration`）—— 看得见、标注自己是兜底，不冒充用户数据。
- 反面教材两个都有名字：small multiples 不共尺（Datawrapper）；Inappropriate Continuous Encoding（把没有的数据画成连续条，arXiv:2508.09716 §2.1）。**我们现在两个都踩着。**

---

## 3. 我们的系统：差距在哪

### 3.1 数据模型（`packages/domain/src/entities.ts` 的 `Task`）

已有的时间相关字段：`dueDate?`（epoch ms）、`completedAt?`（存在即完成）、`createdAt`（`EntityBase` 一定有）、`repeatRule?` + `repeatDtstart?`（RRULE）、`order?`（清单内排序）。可着色的：`projectId?`（清单的分类色 1–8 槽位，用户赋义）、`tagIds?`、`priority?`。层级：`parentId?`（**真子任务**，B1-3 落地）。

**没有的：`startDate`、任何形式的时长字段。** 唯一时长来源是 AI 写进 note 文本的「预计耗时：N 分钟」。

这就是当前时间线"只能靠编"的结构性原因：**视图要的坐标（起止），模型里只有一半（截止），还是可选的。**

### 3.2 视图边界：日历 vs 时间线（两个都留，分工钉死）

滴答同样两个视图并存，分工也是这么切的：

| | 日历（`CalendarBoard`，已有） | 时间线（本篇目标形态） |
|---|---|---|
| 回答的问题 | 「**哪天**有什么事」 | 「这一摊事**怎么排开**：先后、密度、挤不挤」 |
| 形态 | 月历格子 + 选中日的任务清单（日期级） | 横向**共用时间轴** + 行 = 任务 + 条/点（跨天/跨周） |
| 时间粒度 | 天 | 天→周→月（缩放档） |
| 核心交互 | 翻月、选日、勾任务 | **拖拽排期**、改时长、待安排区 ↔ 轴 |

一句钉死的口径（也修掉 §1.5 那条过期注释）：**日历是"读"的面，时间线是"排"的面。** 两者不合并 —— 合并了就两头都不是。

### 3.3 能力差距表（滴答模型 12 条 × heyta 现状）

| # | 滴答能力 | heyta 现状 | 差距归因 |
|---|---|---|---|
| 1 | 清单级视图，随清单切换 | 跟随侧栏筛选（含智能视图） | 形态可比，行为略宽（不算缺口） |
| 2 | 横向条：长度=时长、位置=起止 | 每任务一张自归一化图，位置无意义 | 🔴 P1（结构）+ P2（数据） |
| 3 | 无时间任务进「待安排」区 | 全部落图，没日期也画条 | 🔴 P1 |
| 4 | 拖拽排期（待安排 → 轴） | 无任何交互 | 🔴 P2 |
| 5 | 点击空白建任务带日期 | 无 | P2 |
| 6 | 周/月滚动 | 无滚动（视图内无滚动容器） | 🔴 P1 |
| 7 | 日/周/月缩放档 | 无（轴跨度由数据被动决定） | P2/P3 |
| 8 | 拖边改时长 | 无 | 🔴 P2（且依赖时长字段拍板） |
| 9 | 颜色按清单/标签/优先级 | 条固定主蓝 | P3（清单色槽已就位） |
| 10 | 移动端支持 | 移动端有（chip 第三档，同共享组件） | ✅ 结构已对 |
| 11 | 重复任务不全画 | 未处理（repeat 任务按 dueDate 一起画） | P3 |
| 12 | 只显示设了时间的任务 | 全部未完成任务都画 | 🔴 P1 |

---

## 4. 应该怎么做：三阶段

> 总原则（从 R4 §5.3 继承并放大）：**位置只编码真数据；缺什么就明说缺什么；写路径永远走 op-log。**

### P1 · 把 UI 修诚实（= R4 的实施，零 schema 改动）

**目标**：消灭"每任务一把尺 / 假日历时间 / 编长度"，让视图第一次拥有真实的坐标系。这一步不做完，P2 的任何交互都是在说谎的坐标系上拖拽。

结构（滴答/Notion/Jira 同构）：

```
┌─────────────────────────────────────────────────────────────┐
│ 工具条   ‹ 本周 ›   今天   周|月                              │
├──────────────┬──────────────────────────────────────────────┤
│ 行头（冻结）   │ 共用时间轴（一根，全视图只有一次）                │
│              │  周一  周二  周三 ▌今天 周五  周六  周日          │
│ 任务 A       │      ◆━━━━━━━━━━━        ← range：条（P2 起有） │
│ 任务 B       │              ◆ 90′         ← point：菱形+估时   │
│ 任务 C       │ ◆(逾期,警示色)               ← 逾期仍落原位      │
├──────────────┴──────────────────────────────────────────────┤
│ 📥 未排期（3）：任务 D · 任务 E · 任务 F     ← 有名字的泳道      │
└─────────────────────────────────────────────────────────────┘
```

- **领域层**：给"任务在时间上的位置"一个三态类型（`range | point | unscheduled`，在**类型上**可区分 —— R4 判定"靠有没有 `durationMinutes` 这种弱信号"是类 A 在数据层的复现）。
- **app-host**：`TimelineTaskLike` 扩入 `dueDate?`（可选字段）；产出三态之一；**绝不编长度**（只有估时没日期 ⇒ `unscheduled`；只有日期没估时 ⇒ `point`）。
- **共享 UI**：`TimelineBoard`（新）：整视图**一根轴**、行 = 任务、冻结行头 + 横向滚动；point 画菱形、range 画条、unscheduled 进泳道**不落图**；今天线贯穿；逾期用警示色仍画在真实位置。每行保留文字标题与日期（无障碍表面不许丢 —— WCAG 1.1.1，R4 判据 6）。
- **AI 估时降级为元数据**：菱形旁的 badge（`≈90′ AI`），不画成任何几何长度。落地页那句「虚线是 AI 估的」从条上撤下，等 P2 有了真实 `range` 再回来（届时虚线边=AI 初始长度、实线边=用户确认过，语义才成立）。
- **子条目排程进详情**：任务详情里保留"清单排程预览"（现有 `buildTimeline` 数学 + 缩小的图），标明它是"任务内部坐标系"。
- **判据**：R4 §5.3 的 8 条**原样执行**（一根轴数量==1；相对位置符号一致；无假 bar；界面时间必须来自 `dueDate` —— **改前必红**；未排期可见不落图；无障碍文字面；桌面+移动截图人看；三种变异）。外加本篇一条：**落地页展厅件与应用视图的形状契约**（共轨/行=任务）对齐，防再漂移。

### P2 · 排期面：拍板数据模型，接上滴答式拖拽（需要一次 ADR）

**前置拍板**：给 `Task` 增加两个**可选**字段（AGENTS §3.3 的形状：可选 + 运行时默认，hydration 不炸、不 bump `CURRENT_SCHEMA_VERSION`）：

- `startDate?`（epoch ms，可为"某天"粒度）
- `durationMinutes?`（正整数；note 里的 AI 估时行降为**读时回退源** —— 字段缺失时 `readDurationFromNote` 兜底，旧数据不搬家也不失效）

[`ai-capability-branches.md`](../plans/ai-capability-branches.md) §5.1 早有预警：「duration / startDate 属于不可逆层，必须先确认产品是否真的要做时间线视图，再动模型」—— 本篇就是那个"确认"：**要做**（滴答把这两件事放在 Premium 卖；heyta 的对标承诺里它们是同一条能力）。ADR 里要写清：新增字段全可选、note 回退、`range` 态由 `startDate(+duration 或 dueDate)` 推导、**不改既有字段语义**。

**交互**（每一项都是"一个用户意图 = 一个 op"，§3.4 纪律）：

| 手势 | 语义 | op |
|---|---|---|
| 从「未排期」泳道拖到轴上 | 排期 | `setSchedule({ startDate, dueDate? })`，初始长度取估时 badge |
| 横向拖整条 | 移动 | `setSchedule({ startDate, dueDate })` 平移 |
| 拖条两端 | 改时长 | `setSchedule({ durationMinutes })` |
| 点击轴上空白 | 建任务带日期 | 现有建任务 op + 日期字段，**一个 op 完成不 fan-out** |
| 点条/点/行头 | 开任务详情 | 读路径，无 op |

新 action 落在 `packages/app-host` 的 `createTaskActions` 一侧（§3.5：apps/ 不许出现一行"业务上该怎么做"）；拖拽的写入走 `dispatch()` → op-log → 自动同步（自动同步链路已有）；两台设备拖同一条 = 既有 LWW + `clientId` + 冲突对话框，不新增机制。**被回放的 op 不得再触发副作用** —— 排期 op 只带字段载荷，天然满足。

**判据形状**（实施时写全，先立三条骨架）：

1. 每种拖拽断言 **op-log 里出现对应形状的 op**（不是只断言 UI 状态变了 —— §7 元规则：「状态对」在「没生效」时也可能绿）；
2. 拖拽后离线刷新，位置仍在（本地优先）；
3. 变异：绕过 dispatch 直改 store ⇒ 判据 1 红（钉住"唯一写入口"）。

### P3 · 打磨（不阻塞前两步）

- **颜色**：按清单分类色（1–8 槽位，用户赋义 —— 与成长体系的着色裁决一致，App 不判健康度）；优先级用文字/描边表达，不做纯颜色编码（WCAG 1.4.1）。
- **缩放档**：周（默认）/ 月；日档是日历的职责，不做（§3.2 边界）。
- **重复任务**：只画**下一次**发生（滴答同款边界，写进用户文案）。
- **窗口外指示符**：条起点在可视窗口左侧时显示边缘箭头（Notion/Jira 同款），不截断。
- **移动端手势**：长按拖拽（RN gesture）；P1/P2 阶段移动端先保"读 + 点开详情"，拖拽后置。
- **子任务 vs 备注清单的二元性**：现在是两套"任务下面还有步骤"的机制（`parentId` 真子任务 vs note 文本清单），详情内的排程预览消费哪套是产品决策 —— 倾向子任务（真实体、可勾选、可同步），单独立条，不并进时间线这一刀。

### 明确不做（反需求）

- **团队甘特**：依赖连线、资源分配、关键路径、进度百分比 —— 那是 Jira/MS Project 的形状。heyta 单用户 + E2EE，滴答自己都只做了"比甘特更轻"的版本。
- **自动排期 AI**：AI 只估时（写进 note/字段的建议值），**条的落点永远是用户的手**。这与 ADR-0005"AI 是输入法不是业务规则"一脉相承。
- **把日历并进时间线**：见 §3.2，两者是"读"与"排"的分工。

---

## 5. 风险与开放问题

1. **RN 横向滚动 + 冻结行头 + 共轴**是 P1 最大的技术风险：轴、行区、泳道要在同一个横向滚动坐标系里，行头列钉在左边。RN/RNW 上多 ScrollView 同步滚动会有可见滞后，**优先单容器方案**（整个图区一个横向 ScrollView，行头列绝对定位随 onScroll 平移或反向钉住）。共享层一次做对，三端同一份。
2. **`dueDate` 的粒度歧义**：epoch ms 混装"某天"与"某时刻"。P1 的 point 语义要定：全天任务画在日列中央还是时刻位？（倾向：无时刻 → 日粒度居中；有时刻 → 时刻位。与日历视图的 `groupTasksByDueDate` 口径对齐。）
3. **旧数据**：没有任何 `startDate` 的存量任务在 P2 之后仍是 `point/unscheduled` —— 由 note 回退与三态降级兜住，不需要迁移。这条写进 ADR。
4. **R4 排期**：R4 在台账里排在 R5/R1/R2 之后（时间线重画会撞上行骨架与容器问题）。P1 不要提前于 R1（行骨架）动手。
5. **未核实**：滴答移动端时间线的具体手势（官方帮助只说"支持"，未写长按行为细节）；Notion 里程碑菱形在当前版本的精确表现（本篇未引用其行为，只用了 range/point 概念）。

---

## 6. 来源

**外部**（全部 2026-10-01 抓取）：

- TickTick 官方帮助 · [Timeline View: A Game-Changer for Project Management](https://help.ticktick.com/articles/7055782331050622976)（交互模型 12 条的主证据）
- TickTick 功能页 · [ticktick.com/features](https://ticktick.com/features)（"lighter than Gantt" 定位自述）
- TickTick 视图切换帮助 · [Select Different Views](https://help.ticktick.com/articles/7055782381696843776)（列表/看板/时间线三视图；智能清单不含时间线）
- Reddit · [r/ticktick Timeline 讨论](https://www.reddit.com/r/ticktick/comments/tssiji/what_are_your_thoughts_on_the_new_timeline)（单清单边界、着色维度）
- 滴答清单帮助中心 · [时间线视图](https://help.dida365.com/articles/7019123502271692800)（中文同文）
- Notion 帮助 · [Timeline view databases](https://www.notion.com/help/timelines)（Show by / Table+Timeline / 拖拽 / 分组）
- Notion 指南 · [Intro to Timeline view](https://www.notion.com/help/guides/intro-to-timeline-view)
- Todoist · [Upcoming view](https://www.todoist.com/inspiration/todoist-upcoming-view) / [Ganttify 集成](https://www.todoist.com/integrations/apps/ganttify)（"没有原生时间线"的反证）
- 人人都是产品经理 · [滴答清单产品体验报告](https://www.woshipm.com/evaluating/6108536.html)（日历=基础功能、时间线=特色功能的定位分工）

**内部**：

- [`plans/ui-review-fill-zh-timeline.md`](../plans/ui-review-fill-zh-timeline.md) —— R4 全案：实测数字、三态降级表（§5.2，本篇 §2.4 的唯一事实源）、8 条判据（§5.3）
- [`research/ai-competitive-and-architecture.md`](ai-competitive-and-architecture.md) —— 「滴答主动放弃甘特 / 时间线需要 duration 而Task 没有」的原始裁决
- [`research/dida365-feature-benchmark.md`](dida365-feature-benchmark.md) ——「只有 dueDate 无 startDate ⇒ time blocking 不成立；时间线里的 startDate 只是展示参数」
- [`plans/ai-capability-branches.md`](../plans/ai-capability-branches.md) §5.1 —— duration/startDate 属不可逆层、动模型前必须拍板的预警
- 代码证据见 §1 各 `文件:行号`
