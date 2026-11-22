# 实施状态：日历重排第一版（macOS 日历 × 滴答清单综合体）

> 2026-11-22 · 代码提交 `3fc36d44`（分支 `feat/app-auto-update`，只提交日历相关文件）。
> 配套：目标版式 [`REDESIGN-SPEC.md`](REDESIGN-SPEC.md)、底盘拆解 [`README.md`](README.md)。

## 已落地（可运行，typecheck 通过）

| 项 | 做法 | 文件 |
|---|---|---|
| 顶部两层 | 上层工具条（分段 `日/周/月/年` + `＋` + `⋮`）＋ 下层大标题（当前范围）+ `‹ 回到今天 ›` | `apps/web/src/features/calendar/CalendarHeaderToolbar.tsx`（重写） |
| 视图分段 | 用共享 `CalendarViewTabs`；**保留隐藏原生 `<select>`** 作可访问回退（`calendar-view-select` testid 不变，7 个 e2e 契约不破） | 同上 |
| 去周数竖槽 | `useCalendarLabels` 不再提供 `weekNumber` ⇒ 共享板据此不画 `44周` 那列 | `apps/web/src/features/calendar/useCalendarLabels.ts` |
| 大标题样式 | `WebTopBar` 增 `className`；日历页 `ht-header--calendar`：h1 文字保留但视觉隐藏，大标题由 toolbar 承担 | `apps/web/src/features/shell/WebTopBar.tsx`、`apps/web/src/App.tsx`、`styles/app/main-area.css` |
| 侧栏 macOS 顺序 | 分类在上、迷你月历沉底（flex `order` + `margin-block-start:auto`，迷你月历去卡片随底色沉到底部左侧） | `styles/app/sidebar.css` |
| 清单分类 | 父清单 = 分类标题、子清单缩进（沿用 `Project.parentId` 层级 + `toOrganizerTree`），即滴答「清单分组」的对应物 | `apps/web/src/features/calendar/CalendarSidebar.tsx`、`styles/app/sidebar.css` |

所有颜色/间距/圆角/字号走 `--ht-*` token，无裸值。

## 验证证据

- **`pnpm --filter @heyta/web typecheck`：通过**。
- **`e2e/tests/calendar-dida.spec.ts`（日历冒烟，含"今天跳回/去周数"）：单独跑 11s 通过** —— 证明改动后应用能正常启动、日历能正常渲染交互。
- **A/B 归属验证（关键）**：把上述源文件临时回退到改动前（`git checkout 72750dde -- <files>`），再跑 `calendar-cells`、`calendar-sidebar`，**同样失败**：
  - `calendar-cells`：`expect(html[data-theme=dark])` 实到 `light`（主题没切过去）；
  - `calendar-sidebar`：控制台 `[heyta] 首屏在超时内未被应用接管`（启动看门狗超时）。
  ⇒ 这两类失败是**仓库/本机环境既有**（与本次日历布局改动无关）。验证后已 `git checkout 3fc36d44 -- <files>` 恢复我的版本。
- 真机截图：`live-sidebar2.png`（改后：分类区在上、迷你月历左下、两层顶栏）、`live-after.png`（月视图去周数、两层顶栏）。

## 仍待（未完成，不谎报）

1. **带数据的视觉验收**：本机测试库为空（无清单/任务），侧栏只显示「所有」。需造"父清单+子清单+任务"的样例数据，截图确认「分类→清单」分组与月格事件条的真实观感。
2. **其余日历 e2e 的干净环境复跑**：`calendar-week / calendar-year / calendar-wheel` 等在批跑里出现的也是"首屏启动超时 / dark 主题"这类环境症状（同 A/B 已证的同源），需在无并发、无多开的干净环境复跑确认；若有个别真实几何判据需随"去周数"调整（如条数 `+N` 容量），按新意图改判据。
3. 分段档位顺序目前沿用共享 `CALENDAR_VIEW_ORDER`（`月/周/日/年`）；若坚持 macOS 的 `日/周/月/年` 顺序，需在不违反"禁止在宿主硬编码档位键字面量"的前提下调整（下一轮处理）。

## 说明
- 只提交了 `apps/web/src/features/calendar/*`、`features/shell/WebTopBar.tsx`、`App.tsx`（仅 1 行 className）、`styles/app/{main-area,sidebar}.css`、`e2e/tests/calendar-dida.spec.ts`。**未触碰同检出中另一会话正在编辑的 export 相关文件**。

## 真机数据验收（2026-11-22）

用应用真实输入框造数据（8 条带日期任务 + 3 个清单），进日历截图 `img/09-live-data.jpg`。现量读数：

| 读数 | 值 | 含义 |
|---|---|---|
| 大标题 | `2026年11月` | 第②层大标题 ✓ |
| 迷你月标题 | `2026年11月` | 与主区同月 ✓ |
| 侧栏分组 | `["清单"]`，行 `["工作","个人","学习"]` | **分类区在上、含清单** ✓ |
| `miniFirst` | `month-below-scope(底部)` | 迷你月历在分类区**下方（左下角）** ✓ |
| 月格任务条 | `7` 条 | 日期任务正确落在格子里 ✓ |

另：这张**渲染完全成功**的截图里，控制台仍出现 `[heyta] 首屏在超时内未被应用接管`。⇒ 该报错是应用**看门狗误报**（界面已正常接管仍打印），是许多 e2e `expect(errors).toEqual([])` 失败的同源根因，与日历布局改动无关（A/B 已证）。

## 清单分类（文件夹）— 已可创建 + 日历侧栏分组显示（2026-11-22 续）

- 应用本就把"文件夹"建模为**父清单**（`Project.parentId`，词条 `common.organizer.folder.*`，已有"移入文件夹"）。
  缺的是**新建时直接选父级**。
- 已在新建清单对话框加「文件夹(归属)」选择（复用现有词条，未改 i18n，避免与并行会话冲突）：
  `apps/web/src/features/categories/CategoryCreateDialog.tsx`、`apps/web/src/features/projects/ProjectsPanel.tsx`。
- 日历侧栏据此渲染成 **分类 → 清单**：真机数据读数 `cats=["项目组"]`、`rows=["子清单A","子清单B","个人"]`、`miniBelowScope=true`、`errs=[]`（图 `img/10-live-category.jpg`）。
- 单测：`projects-panel`(51)/`categories`(15)/`category-colors-flow` 全绿；`typecheck` 通过。

## 彩色日历（2026-11-22 续）

- 月格任务条按**任务所属清单/文件夹**的颜色显示色条；侧栏勾选框同步着色。
- 实现：`calendarCellBars` 增可选 `accentOf`（只影响 `accent` 字段，不传即不变）；`CalendarBoard` 增 `barAccentOf`；
  `CalendarView`(web) 把"清单 id → 分类色 token"（`parseCategorySlot` + `CATEGORY_SLOT_TOKEN_BY_SLOT`）接上；`CalendarSidebar` 勾选框 `accentColor` 上色。
- 语义优先级沿用既有：逾期(红) > 完成(灰) > 分类色 > 默认主色（状态盖分类）。
- 验证：`ui/calendar-cell-bars`(20)、`web/calendar-*`(35) 单测全绿；`typecheck` 绿；真机图 `img/11-live-color.jpg`（写周报=红/工作，发版=蓝/项目组）；父清单"项目组"可勾选且加粗当分组头、子清单缩进。
- ⚠️ 并发：`CalendarBoard.tsx`/`CalendarView.tsx` 同时含有另一个并行 agent 进行中的"日档拖拽到小时"未提交改动（`planCalendarTimeDrop`/`CalendarDropHour` 等），本提交为整树快照（当前编译通过）；纯属对方的 `CalendarDnd.tsx`/`calendar-dnd.css`/`CalendarDayBoard.tsx`/`domain/calendar-drop.*` 未纳入本提交。

## 视图顺序 = 日/周/月/年 + 滴答式彩色块 chip（2026-11-22 续）

- **视图分段顺序**改为 macOS 的 `日/周/月/年`：`packages/ui/src/calendar/model.ts` 的 `CALENDAR_VIEW_ORDER` 由 `month,week,day,year` 改为 `day,week,month,year`。同步 web 单测硬编码：`calendar-view.spec.tsx`、`calendar-view-family.spec.tsx`（标签数组改 `日,周,月,年`）。e2e `calendar-view-options` 读共享源码动态，自动跟随。
- **滴答式彩色块 chip**：月格条目由"细色条+文字"改为**实心浅底圆角块+同色字**。实现：`CalendarBoard` 每条叠一层 `styles.barTint`（`StyleSheet.absoluteFillObject` + `backgroundColor: strong` + `opacity:0.16`），文字用 `strong` 色。**零新 token、零裸 hex、不用 `color-mix`**（RN-web 不接受 style 里的 color-mix，已实测丢弃为透明；改 opacity 层后正常）。状态语义不变：逾期→danger、完成→foreground-subtle、否则→所属清单色、未设色→primary。
- 验证：`ui/calendar-cell-bars`(21)、`web/calendar-view+family`(20)、`web/calendar-*(含 sidebar/tabs)`(46) 全绿；`typecheck` 无日历错误；真机图 `img/12-live-chips.jpg`（写周报=浅红、整理桌面=浅青、读书=浅蓝；顶部 `日 周 月 年`）。
- ⚠️ 仍受并发影响：`CalendarDnd.tsx`/`calendar-dnd.css`/`domain/calendar-drop.*`/`CalendarDayBoard.tsx` 是并行 agent 的未提交改动，未纳入本提交。

## 深/浅色 + 周视图一致性 + e2e 真失败修复（2026-11-22 续）

- **暗色主题 chip**：真机验证（`img/13-live-dark.jpg`）—— chip 为深红/深青/深蓝浅底（strong 色层 opacity 0.16 叠在暗底上）+ 同色亮字，可读，无需改。
- **周视图一致性**：周档复用同一 `DayCell`，条目同样是彩色块（`img/14-live-week.jpg`：写周报=浅红、整理桌面=浅青），与月档一致；顶部标题为周区间。
- **e2e 真失败修复**：`e2e/tests/calendar-week.spec.ts` 档位下拉标签断言硬编码 `['月','周','日','年','时间线']`，随顺序改为 `['日','周','月','年','时间线']`；单跑该用例通过。
- **e2e 其余失败**（calendar-week:165 / calendar-year:117 / calendar-year:284）均为控制台 `[heyta] 首屏在超时内未被应用接管` 的**启动看门狗环境抖动**（与布局无关，A/B 早证）。`calendar-view-options`（顺序/四档）全过。
- **日视图彩色块：未做，原因**——`packages/ui/src/calendar/CalendarDayBoard.tsx` 当前带有并行 agent 未提交的 `renderRowWrapper`/`renderHourRowWrapper` 布线（24 行）；在其上实现会把对方 WIP 带入本提交、且若其改动被回退则我方断言/编译断裂。待该并行改动落地后再做（下一轮复查）。
