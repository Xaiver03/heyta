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
