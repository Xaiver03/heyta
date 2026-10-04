#!/usr/bin/env node
/**
 * 「用了共享 UI，就必须挂在共享 UI 的主题 Provider **之内**」—— 结构性门禁
 * ==========================================================================
 *
 * 🔴 **这道门禁补的是一次真实的 P0**（2026-09-28）：
 *
 * ```
 * FATAL EXCEPTION: mqt_v_native
 * com.facebook.react.common.JavascriptException:
 *   Error: useHeytaUiTheme 必须在 <HeytaUiProvider> 内使用。
 *   This error is located at:  at TaskList (…index.android.bundle…)
 * ```
 *
 * `9d5050d` 把 `@heyta/ui` 的共享组件接进了 `apps/mobile`，但那个宿主**没有挂
 * `HeytaUiProvider`** —— 而 web 的垂直切片与桌面渲染进程**都挂了**。
 *
 * 为什么三道现有防线都没拦住：
 *
 * | 防线 | 为什么没拦住 |
 * |---|---|
 * | 类型系统 | Provider 是**运行时**契约，缺了不报类型错 |
 * | 单测 | 每个包各测各的；`packages/ui` 测的是"没有 Provider 会抛错"（那是对的） |
 * | 真机验收 | **列表为空时渲染的是空态，不走 `TaskList`** —— "装上能开、能配、能打字"全绿，直到**建出第一条任务**才崩 |
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 第一版判据（"源码里出现过 HeytaUiProvider"）又放跑了第二次真实崩溃
 * ─────────────────────────────────────────────────────────────────────────
 *
 * 2026-09-28 M3 的 focus 迁移当场发现：`apps/web/src/App.tsx` 里
 * `<HeytaUiProvider>` **只包了 `tasks` 那棵树**，而 focus 视图是它的**兄弟节点** ——
 * 于是打开专注页运行时抛「useHeytaUiTheme 必须在 `<HeytaUiProvider>` 内使用」。
 * 旧判据（本脚本的上一版）**报了绿**：它只看这个宿主的源码里**是否出现过**
 * `HeytaUiProvider`，**完全不看嵌套**。它能发现"整个宿主忘了挂"，
 * 发现不了"挂了一半"。
 *
 * 这一版因此把判据从「出现过」升级为「**在它的 JSX 子树之内**」。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 它查什么
 * ─────────────────────────────────────────────────────────────────────────
 *
 * 对 `apps/` 下每个宿主：
 *
 *   1. **原有判据**（不退化）：它是否 import 了 `@heyta/ui` 里**需要 Provider
 *      的符号**（`PROVIDER_DEPENDENT` 清单）；若是，它必须真的**挂**了
 *      `HeytaUiProvider`（是按配对标签扫出的 JSX 元素，不是注释里提过）。
 *   2. **新增判据**：每一个这样的**消费者**（组件 JSX 或 hook 调用）都必须落在
 *      某个 `HeytaUiProvider` 的 JSX 子树**之内**。落在外面 → 报错，并**指名
 *      道姓**说是哪个文件哪一行的哪个符号。
 *
 * 「需要 Provider 的符号」是一份**显式清单**，不是"任何 `@heyta/ui` 的导入"：
 * 那些纯函数/纯类型（`toTaskRow` / `focusDisplayTime`…）不碰 context，
 * 把它们也算进来会让门禁因为一句无关的 import 变红。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 "匹配不到就跳过"是禁止的（见 `check-pricing-consistency.mjs` 文件头）
 * ─────────────────────────────────────────────────────────────────────────
 *
 *   1. **判据锚点自检**：`PROVIDER_DEPENDENT` 里的每个符号，在 `packages/ui`
 *      里必须真的有一个**函数定义**（`export function <Name>`），且
 *      `useHeytaUiTheme` 的抛错文案必须还在。任何一条扫不到 → **报错
 *      「判据失效」**，而不是"0 违规 ✅"。这一条防的正是"把判据锚点改名之后
 *      门禁永远通过"。
 *   2. **Provider 解析自检**：一个文件里**看起来有** Provider 标签
 *      （`<HeytaUiProvider ...>` 或它的本地别名，如 mobile 的 `<ThemeProvider>`），
 *      但配对标签扫描**算不出它的 range** → **报错**，不是跳过。
 *      看不出 range 就没法判"之内/之外"，此时"通过"是假的。
 *
 * ⚠️ 本脚本的失败文本里**不能出现反引号**（它在模板字符串内部）——
 * 旧版踩过：嵌套反引号提前结束模板串，`<HeytaUiProvider>` 被当表达式求值，
 * **只在失败路径上**抛 ReferenceError。所以成功路径永远发现不了。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 覆盖边界（如实说明 —— 诚实的不完备 > 假的完备）
 * ─────────────────────────────────────────────────────────────────────────
 *
 * **这一层覆盖了**：同一宿主内、经**相对 import**（`./x` / `../x`）连接的
 * 组件渲染图，跟到**组件所在的文件**为止。
 *
 * **这一层没有覆盖**（所以别把它当"全覆盖"）：
 *
 *   1. **文件级近似**：只要一个文件可达，就认为它里面的消费者都被覆盖 ——
 *      不区分同一文件内的条件分支（`{cond ? <A/> : null}`）与代码路径。
 *      近似**只会漏报**；而"组件体插槽工厂"（useCallback / 箭头返回 JSX、
 *      工厂标识符在 Provider range 内被引用）曾是它的**误报源**，
 *      已按运行时嵌套补齐（2026-10-02）。要精确到"哪条渲染路径"得上真正的语法树。
 *   2. **经第三方/workspace 包转手的间接渲染**：`<X/>` 来自 `@heyta/xxx`
 *      （非 `@heyta/ui`）而我们又看不到它的源码时，跟不下去。
 *   3. **运行时才决定的组件**：`React.createElement` / 字符串变量拿到的组件 /
 *      lazy 动态导入的模块名，本脚本都看不到。若宿主用这些形式挂 Provider
 *      （而不是 JSX），第 1 条判据会把它报成"没挂 Provider"。
 *   4. **`packages/ui` 内部**：它自己的消费者天然在 Provider 之内吗？本脚本
 *      不判（`packages/ui` 是 Provider 的定义处，接口测试在 `packages/ui/tests`）。
 *
 * 这四条都写在**成功输出**里（见文件尾），不只写在注释里 ——
 * 否则读输出的人会以为门禁覆盖了它其实没覆盖的东西。
 *
 * 用法：node scripts/check-ui-provider.mjs
 *   非零退出 = 有违规或判据失效。
 *
 * `HEYTA_CHECK_ROOT`：与 `check-pricing-consistency.mjs` 同一个约定 ——
 * 只给**故障注入探针**用（把门禁跑在 `/tmp` 的副本上，不动共享工作区）。
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { lineAt, maskSource, scanJsxTree } from './lib/jsx-tree.mjs';

const ROOT =
  process.env.HEYTA_CHECK_ROOT === undefined
    ? resolve(dirname(fileURLToPath(import.meta.url)), '..')
    : resolve(process.env.HEYTA_CHECK_ROOT);

/**
 * `@heyta/ui` 里**依赖 `<HeytaUiProvider>`** 的导出。
 *
 * 加新共享组件时要更新这份清单 —— 判据是：它（或它渲染的组件）调了
 * `useHeytaUiTheme` / `useHeytaTokens` / `useHeytaText`。
 * 这比"扫 packages/ui 的调用图"简单，也更容易在 review 里看出来。
 */
const PROVIDER_DEPENDENT = [
  'TaskList',
  'TaskBadges',
  /**
   * 🔴 `TaskRow`（M3 第一刀抽出来的"一行"本身）。
   *
   * **它是补登记的，而且是被"注释对账"抓出来的，不是被崩溃抓出来的**：
   * `packages/ui/src/index.ts` 有 7 处写着"尚未登记进本脚本"，其中 6 处
   * 早就补上了（注释没跟着改，成了假话），**只有 `TaskRow` 这一处是真的**。
   * 用 `PROVIDER_DEPENDENT` 的实际内容与那 7 句话逐条对账才发现 —— 见 AGENTS.md
   * 的"注释不是判据"。
   *
   * 为什么它必须登记：`TaskRow` 是 `export function`，**宿主可以直接 import 它**
   * （`TaskList` 内部就是这么用的）。宿主若把它放在 `<HeytaUiProvider>` 之外，
   * 运行时同样抛「useHeytaUiTheme 必须在 <HeytaUiProvider> 内使用」，
   * 而在此之前本脚本不认识这个符号 ⇒ 门禁全绿。
   *
   * ⚠️ 它与 `TaskList` **不是**重复登记：`TaskList` 覆盖的是"宿主用了列表"，
   * `TaskRow` 覆盖的是"宿主直接用了行"。两者可以分别出现在不同位置。
   */
  'TaskRow',
  // M3 第二刀（focus）：`FocusPanel` / `FocusRing` 透过 `useHeytaTokens` /
  // `useHeytaText` 取 token，所以用了它们的宿主同样必须挂 Provider。
  'FocusPanel',
  'FocusRing',
  // M3 第三刀（categories）：`CategoryReportView` 透过 `useHeytaTokens` /
  // `useHeytaText` 取 token，所以用了它的宿主同样必须挂 Provider。
  'CategoryReportView',
  /**
   * M3 第四刀（sync）：`SyncStatusBar` / `ConflictResolutionView` 同样透过
   * `useHeytaTokens` / `useHeytaText` 取 token，所以宿主必须挂 Provider。
   *
   * 🔴 **这两个是补登记的，而它们的漏网恰好证明这份清单非有不可**：
   * 第四刀落地时它们不在表里，门禁照样全绿 —— 因为本脚本的**消费者扫描只覆盖
   * `apps/*`**（`HOST_DIRS`）：这两个组件内部的 `useHeytaTokens()` 调用在
   * `packages/ui` 里、根本不在扫描范围；而宿主侧写的是
   * `<SyncStatusBar>` / `<ConflictResolutionView>` 这种**组件 JSX**，
   * 在补登记之前**不是**判据认识的符号。⇒ 宿主把 Provider 拆掉**也不会红**，
   * 而那正是 P0 的形状（`useHeytaUiTheme 必须在 <HeytaUiProvider> 内使用`）。
   *
   * 两处宿主当时都在文件头**如实写了**"尚未登记进本脚本" —— 诚实，
   * 但门禁不会因为一句注释变红：**未登记的组件 = 没有门禁**。
   * 补上这两行才算真的关掉；下面的故障注入证明了它现在会红。
   */
  'SyncStatusBar',
  'ConflictResolutionView',
  /**
   * M3 第五刀（settings）：`SettingsSection` / `SettingsRow` 同样透过
   * `useHeytaTokens` / `useHeytaText` 取 token。
   *
   * 🔴 **这是同一个缺口第三次出现**（第四刀 sync、AI 那一刀、现在是 settings）——
   * 而且**每一次都是"新组件没登记，门禁照样全绿"**。三次的根因完全相同：
   * 本脚本的**消费者扫描只覆盖 `apps/*`**（`HOST_DIRS`），而共享组件内部的
   * `useHeytaTokens()` 调用在 `packages/ui` 里、不在扫描范围；宿主侧写的是
   * `<SettingsSection>` 这种**组件 JSX**，不登记就不是判据认识的符号。
   *
   * ⇒ **漏登记 = 没有门禁**：宿主把 `<HeytaUiProvider>` 拆掉不会红，
   * 而那正是 P0 的形状（`useHeytaUiTheme 必须在 <HeytaUiProvider> 内使用`）。
   *
   * ⚠️ **下次做新共享组件时，登记这一步必须和"写组件"同时发生** ——
   * 不要再靠"父 agent 事后复核"来补。
   */
  'SettingsSection',
  'SettingsRow',
  /**
   * M3 第六刀（quadrant）。🔴 **这是同一个缺口第四次出现**（sync → AI → settings → quadrant）：
   * 新共享组件没登记，门禁照样全绿。根因不变 —— 本脚本的消费者扫描只覆盖 `apps/*`，
   * 组件内部的 `useHeytaTokens()` 在 `packages/ui` 里不在扫描范围，而宿主侧写的是
   * `<QuadrantBoard>` 这种组件 JSX。**漏登记 = 没有门禁。**
   */
  'QuadrantBoard',
  /**
   * M3 第七刀（habits）。
   * 🔴 **这是同一个缺口第五次出现**（sync → AI → settings → quadrant → habits）。
   * 根因从未变过：本脚本的消费者扫描只覆盖 `apps/*`，而共享组件内部的
   * `useHeytaTokens()` 在 `packages/ui` 里不在范围内；宿主侧写的是
   * `<HabitBoard>` 这种组件 JSX，**不登记就不是判据认识的符号**。
   * ⇒ **漏登记 = 没有门禁**：宿主把 `<HeytaUiProvider>` 拆掉不会红。
   *
   * ⚠️ 这已经是第五次由"父 agent 事后复核"补上。**登记必须与写组件同时发生。**
   */
  'HabitBoard',
  /**
   * M3 第八刀（capture）。
   *
   * 🔴 **这是同一个缺口第六次出现的场合，也是第一次"登记与写组件同时发生"** ——
   * 前五次（sync → AI → settings → quadrant → habits）都是父 agent 事后复核补的。
   * 根因不变：本脚本的消费者扫描只覆盖 `apps/*`，组件内部的 `useHeytaTokens()`
   * 在 `packages/ui` 里不在扫描范围；宿主侧写的是 `<SharedCaptureComposer>`
   * （`CaptureComposer` 的别名）这种**组件 JSX**，**不登记就不是判据认识的符号**。
   * ⇒ 漏登记 = 没有门禁：宿主把 `<HeytaUiProvider>` 拆掉不会红，
   *    而运行时会抛「useHeytaUiTheme 必须在 <HeytaUiProvider> 内使用」。
   *
   * ⚠️ 本刀同时新增了 `capture/CaptureComposer.tsx`，它是共享层里**第一个**
   * 用 RN `TextInput` 的组件；登记的是组件符号，不是它的内部分支。
   */
  'CaptureComposer',
  /**
   * M3 第八刀（capture）关联项。
   * 🔴 **这是同一个缺口第七次出现**（sync → AI → settings → quadrant → habits → capture 的前身 → 本次）。
   * ⚠️ 特别之处：`packages/ui/src/index.ts:184-191` **早就写着**
   * 「`features/ai/AiDisclosureHost.tsx` 自带一层 Provider，但**门禁现在看不见它** —— 补登记：`AiDisclosure`」，
   * —— **但从来没有人真的登记**。`grep AiDisclosure scripts/check-ui-provider.mjs` 在此之前**零命中**。
   * ⇒ **"写了要做" 与 "做了" 之间的那道缝，就是这类缺口反复出现的地方。**
   *
   * 本次由父 agent 用"token 使用者 × 已登记项"交叉对账发现（不是靠读注释）：
   * 脚本里的组件名是**宿主用的 JSX 符号**，与文件名不同名（`CategoryReport.tsx` → `CategoryReportView`、
   * `Settings.tsx` → `SettingsSection`/`SettingsRow`），所以**必须按导出符号对账，不能按文件名**。
   */
  'AiDisclosure',
  /**
   * `ai` 面板族第一刀：面板头部（`packages/ui/src/ai/AiPanelHead.tsx`）。
   * 与 `AiDisclosure` 同一条理由 —— 它透过 `useHeytaTokens` / `useHeytaText`
   * 取 token，所以用它的宿主同样必须挂 `HeytaUiProvider`。
   */
  'AiPanelHead',
  /** `ai` 面板族最后一刀：面板容器（`packages/ui/src/ai/AiPanel.tsx`）。 */
  'AiPanel',
  /**
   * M3 第九刀（projects）：`OrganizerList` 透过 `useHeytaTokens` / `useHeytaText`
   * 取 token，所以用了它的宿主同样必须挂 Provider。
   *
   * 🔴 **同一个缺口第八次出现的场合，也是第二次"登记与写组件同时发生"**
   * （sync → AI → settings → quadrant → habits → capture → AI 补账 → 本次）。
   * 根因从未变过：本脚本的消费者扫描只覆盖 `apps/*`，而共享组件内部的
   * `useHeytaTokens()` 在 `packages/ui` 里、不在扫描范围；宿主侧写的是
   * `<OrganizerList>` 这种**组件 JSX**，不登记就不是判据认识的符号。
   * ⇒ 漏登记 = 没有门禁：宿主把 `<HeytaUiProvider>` 拆掉不会红，
   *    而运行时会抛「useHeytaUiTheme 必须在 <HeytaUiProvider> 内使用」。
   */
  'OrganizerList',
  /**
   * 便签与提醒（幻觉 #12 / B1-1 的界面层，`packages/ui/src/{notes,reminders}/`）。
   *
   * 🔴 **同一个缺口第九次出现的场合，也是第三次"登记与写组件同时发生"**
   * （sync → AI → settings → quadrant → habits → capture → AI 补账 → projects → 本次）。
   * 根因从未变过：本脚本的消费者扫描只覆盖 `apps/*`，而共享组件内部的
   * `useHeytaTokens()` 在 `packages/ui` 里、不在扫描范围；宿主侧写的是
   * `<ReminderList>` / `<NotesBoard>` 这种**组件 JSX**，不登记就不是判据认识的符号。
   * ⇒ 漏登记 = 没有门禁：宿主把 `<HeytaUiProvider>` 拆掉不会红，
   *    而运行时会抛「useHeytaUiTheme 必须在 <HeytaUiProvider> 内使用」。
   *
   * ⚠️ **登记在消费者之前**：本次是先登记、再让两位接线 agent 去接宿主。
   * 顺序反过来（等接线做完再补登记）就会漏掉一次"接线时忘了包 Provider"的机会 ——
   * 而这一次的宿主是**两个**（web 的行内提醒面板、mobile 的任务详情页），
   * 漏挂的概率比单宿主更高。
   *
   * ⚠️ 对账口径：登记的是**导出符号**，不是文件名
   * （`notes/NotesBoard.tsx` → `NotesBoard`，`reminders/ReminderList.tsx` → `ReminderList`）。
   */
  'ReminderList',
  'NotesBoard',
  /**
   * M3 第十一刀（motivation，`packages/ui/src/motivation/`）。
   *
   * 🔴 **同一个缺口第十次出现的场合，也是第四次"登记与写组件同时发生"**
   * —— 而且这一次是**在消费者存在之前**登记的：本轮先造共享层，
   * 两端（web 的 `features/motivation/**`、mobile 的 `GrowthScreen.tsx`）
   * 的换装由后续步骤做。所以这份登记是**提前**的，不是事后补账。
   *
   * 为什么提前登记在这条尤其重要：这一刀要换装的宿主是**两个**，
   * 而且 mobile 那一屏（578 行）与 web 那一屏（1,032 行）**各有对方没有的能力**
   * —— 换装时会各自重写渲染路径，漏挂 Provider 的机会比单宿主高。
   *
   * ⚠️ 对账口径：登记的是**导出符号**，不是文件名。注意
   * `motivation/ProgressBar.tsx` 的导出名是 **`MotivationProgressBar`**
   * （不是 `ProgressBar`）—— 与 `packages/ui/src/notes/` 的 `NotesBoard`
   * 同理：**符号名与文件名不同名时，只能按导出符号登记**。
   */
  'GrowthBoard',
  'TodayProgressCard',
  'WeeklyReviewCard',
  'HabitStreakList',
  'MilestoneMap',
  'IdentityTagList',
  'ActivityHeatmap',
  'ShareSummarySection',
  'MotivationProgressBar',
  /**
   * `timeline` 整刀第 1 步（`packages/ui/src/timeline/`）。
   *
   * 🔴 **同一个缺口第十一次出现的场合，也是第五次"登记与写组件同时发生"**
   * （sync → AI → settings → quadrant → habits → capture → AI 补账 → projects →
   * notes/reminders → motivation → 本次）。
   * 根因从未变过：本脚本的消费者扫描只覆盖 `apps/*`，而共享组件内部的
   * `useHeytaTokens()` 在 `packages/ui` 里、不在扫描范围；宿主侧写的是
   * `<TimelineView>` / `<GanttChart>` 这种**组件 JSX**，不登记就不是判据认识的符号。
   * ⇒ 漏登记 = 没有门禁：宿主把 `<HeytaUiProvider>` 拆掉不会红，
   *    而运行时会抛「useHeytaUiTheme 必须在 <HeytaUiProvider> 内使用」。
   *
   * ⚠️ 2026-10-01 时间线重画（goal：`docs/plans/goal-timeline-rework.md`）：
   * `TimelineView`（每任务一张甘特图）已删除，由 `TimelineBoard`（一根共轴）取代；
   * web 宿主（`features/timeline/TimelinePanel.tsx`）直接渲染的符号随之改名。
   * `GanttChart` 仍被共享层内部渲染（时间线重画后是**任务详情**的清单排程预览），
   * 但它是 `export function`，**宿主可以直接 import 它**（同 `TaskRow` 的理由），
   * 所以继续登记。
   */
  'TimelineBoard',
  'ChecklistPlanPreview',
  'GanttChart',
  /**
   * M3 第八刀（calendar）与第九刀（trash）。
   *
   * 🔴 **这是同一个缺口第六次出现**（sync → AI → settings → quadrant → habits →
   * calendar/trash）。根因一次都没变过：本脚本的消费者扫描只覆盖 `apps/*`，
   * 而共享组件内部的 `useHeytaTokens()` 在 `packages/ui` 里、不在范围内；
   * 宿主侧写的是 `<CalendarBoard>` / `<TrashBoard>` 这种组件 JSX，
   * **不登记就不是判据认识的符号** ⇒ **漏登记 = 没有门禁**。
   *
   * ⚠️ 这两个是**实测撞出来的**：`TrashBoard` 落地时 `TrashView` 忘了包
   * `<HeytaUiProvider>`，而 `pnpm check` **全绿** —— 一直到
   * `apps/web/tests/trash.spec.tsx` 5 条一起报
   * 「useHeytaUiTheme 必须在 <HeytaUiProvider> 内使用」才暴露。
   * 也就是说：**在这次事故里，唯一的防线是一条恰好覆盖到的单测**，
   * 而门禁本该在更早、更便宜的地方拦住它。
   */
  'CalendarBoard',
  'TrashBoard',
  'SearchPanel',
  /**
   * W4（`packages/ui/src/auth/AuthForm.tsx`）—— 登录/注册表单的**唯一一份实现**。
   *
   * 🔴 **第十二个场合，但这一条的代价与前面十一条不同**：前面漏登记的症状是
   * 运行时抛「useHeytaUiTheme 必须在 \<HeytaUiProvider\> 内使用」—— 那是**当场炸**，
   * 用户看不到界面，很难被误判成"没问题"。而 `AuthForm` 内部还用了
   * `useHeytaUiDimensions()`（口令显隐的**默认档**：桌面遮、移动明文），漏挂 Provider 时
   * 它**不抛**、落 `pointer === 'fine'` 的兜底分支 —— 于是平板/折叠屏展开态会被当成桌面。
   * **不炸的漏登记才是真危险**：界面看起来完全正常。
   *
   * ⚠️ 对账口径同 `motivation` 那段：登记的是**导出符号** `AuthForm`。
   * 同目录的 `authFailureMessageKey` 是纯函数、不碰主题，**不登记**
   * （`check:rn-aria` 那种"渲染形状"的判据也不管它）。
   */
  'AuthForm',
  'useHeytaTokens',
  'useHeytaText',
  'useHeytaUiTheme',
];
const PROVIDER_DEPENDENT_SET = new Set(PROVIDER_DEPENDENT);

/** Provider 的规范名（各端可能用别名，例如 mobile 的 `ThemeProvider`）。 */
const PROVIDER_NAME = 'HeytaUiProvider';
const UI_MODULE = '@heyta/ui';

/** 宿主目录。每一个都要单独判断 —— 它们各有各的 Provider 位置。 */
const HOST_DIRS = ['apps/web/src', 'apps/mobile/src', 'apps/desktop', 'apps/node-host/src'];

/** `packages/ui` 的源码目录：判据锚点的自检对象。 */
const UI_SRC = join('packages', 'ui', 'src');

const SKIP_DIRS = new Set([
  'node_modules',
  'dist',
  'dist-types',
  'build',
  'coverage',
  '.expo',
  '.turbo',
  '.gradle',
  '.cxx',
  'ios',
  'android',
  'Pods',
]);

/** 递归收集 `.ts` / `.tsx`（跳过构建产物、依赖与原生工程）。 */
function collectSourceFiles(dir) {
  const out = [];
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out; // 宿主/目录可能不存在（例如某个壳被删了）
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      out.push(...collectSourceFiles(full));
    } else if (/\.tsx?$/.test(entry) && !/\.d\.ts$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

/* ========================================================================
 * 一、判据锚点自检（packages/ui）
 * ====================================================================== */

/**
 * 🔴 锚点自检：`PROVIDER_DEPENDENT` 的每个符号都必须在 `packages/ui` 里
 * **真的有定义**，且 `useHeytaUiTheme` 的抛错文案还在。
 *
 * 为什么是"定义"而不是"index.ts 里出现过"：改名 `useHeytaUiTheme` 之后，
 * `index.ts` 里那行 `export { useHeytaUiTheme } from './theme.js'` 可能还在
 * （引用没改），于是"出现过"的检查会**照样通过** —— 而判据已经失效了。
 */
function checkAnchor() {
  const uiFiles = collectSourceFiles(join(ROOT, UI_SRC));
  const all = uiFiles.map((f) => ({ file: f, text: readFileSync(f, 'utf8') }));

  const missing = [];
  let referenceCount = 0;
  for (const name of PROVIDER_DEPENDENT) {
    const defRe = new RegExp(`export\\s+function\\s+${name}\\b`);
    if (!all.some((f) => defRe.test(f.text))) missing.push(name);
    // 记录"这个符号在 packages/ui 里被用到/定义到"的总次数，作为锚点活跃度的旁证。
    const useRe = new RegExp(`\\b${name}\\b`, 'g');
    for (const f of all) referenceCount += (f.text.match(useRe) ?? []).length;
  }

  /** `useHeytaUiTheme` 是**契约本身**：它必须仍然"在缺 Provider 时抛错"。 */
  const CONTRACT_SNIPPET = 'useHeytaUiTheme 必须在 ';
  const contractHolds = all.some((f) => f.text.includes(CONTRACT_SNIPPET));

  if (missing.length > 0 || !contractHolds || referenceCount === 0) {
    const lines = [];
    lines.push('🔴 判据失效：共享 UI 主题 Provider 的锚点在 packages/ui 里找不到了。');
    lines.push('');
    if (referenceCount === 0) {
      lines.push(`   · packages/ui 里扫不出 PROVIDER_DEPENDENT 的任何使用/定义。`);
    }
    if (missing.length > 0) {
      lines.push(
        `   · 这些符号在 packages/ui 里没有 export function 定义：${missing.join('、')}`,
      );
      lines.push(`     ⇒ 它们被改名/删除，而 PROVIDER_DEPENDENT 清单还指着旧名字。`);
    }
    if (!contractHolds) {
      lines.push(
        `   · packages/ui 里找不到抛错文案「${CONTRACT_SNIPPET}…」——` +
          ` Provider 的运行时契约可能被改掉了。`,
      );
    }
    lines.push('');
    lines.push('   这不是"没有违规"，是**这道检查已经不能做事了**。');
    lines.push('   修法：确认 packages/ui 仍导出清单里的每个符号（尤其是');
    lines.push('         useHeytaUiTheme / useHeytaTokens / useHeytaText），');
    lines.push('         并同步更新本脚本的 PROVIDER_DEPENDENT 清单。');
    return { error: lines.join('\n') };
  }
  return { uiFileCount: all.length, referenceCount };
}

/* ========================================================================
 * 二、宿主源码的模块/组件解析（轻量）
 * ====================================================================== */

const files = new Map(); // absPath -> FileRecord

/** `A, B as C, type D` → [{ local, source, isType }] */
function parseNamedSpecifiers(raw) {
  const out = [];
  for (const part of raw.split(',')) {
    let s = part.trim();
    if (s === '') continue;
    const isType = /^type\s+/.test(s);
    s = s.replace(/^type\s+/, '');
    const m = /^([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?$/.exec(s);
    if (m === null) continue;
    out.push({ local: m[2] ?? m[1], source: m[1], isType });
  }
  return out;
}

/**
 * 解析一份源码里的 import / re-export / 本地定义。
 * 🔴 只在**去掉注释**的掩码上跑正则 —— 注释里提到的 `import { TaskList }`
 *    不该被当成真实导入（旧版正是在这里差点被说明文字骗到）。
 */
function analyzeFile(absPath) {
  const text = readFileSync(absPath, 'utf8');
  const { structural, code } = maskSource(text);
  const { nodes } = scanJsxTree(text);

  const imports = new Map(); // local -> { module, source }
  const reexports = new Map(); // exported -> { module, source } | { local }
  const defs = new Set();

  for (const m of code.matchAll(/import\s+(?:type\s+)?\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g)) {
    for (const s of parseNamedSpecifiers(m[1])) {
      imports.set(s.local, { module: m[2], source: s.source, isType: s.isType });
    }
  }
  for (const m of code.matchAll(
    /import\s+([A-Za-z_$][\w$]*)\s*(?:,\s*\{([^}]*)\})?\s*from\s*['"]([^'"]+)['"]/g,
  )) {
    imports.set(m[1], { module: m[3], source: 'default', isType: false });
    if (m[2] !== undefined) {
      for (const s of parseNamedSpecifiers(m[2])) {
        imports.set(s.local, { module: m[3], source: s.source, isType: s.isType });
      }
    }
  }
  for (const m of code.matchAll(
    /export\s+(?:type\s+)?\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g,
  )) {
    for (const s of parseNamedSpecifiers(m[1])) {
      reexports.set(s.local, { module: m[2], source: s.source });
    }
  }
  for (const m of code.matchAll(/export\s+(?:type\s+)?\{([^}]*)\}\s*;/g)) {
    for (const s of parseNamedSpecifiers(m[1])) {
      if (!reexports.has(s.local)) reexports.set(s.local, { local: s.source });
    }
  }
  for (const m of code.matchAll(
    /(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g,
  )) {
    defs.add(m[1]);
  }
  for (const m of code.matchAll(/(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*[:=]/g)) {
    defs.add(m[1]);
  }

  const record = { path: absPath, text, structural, code, nodes, imports, reexports, defs };
  files.set(absPath, record);
  return record;
}

/** 相对 import 说明符 → 真实文件（`.js` 也可能指向 `.ts`/`.tsx`）。 */
function resolveLocalModule(fromFile, spec) {
  if (!spec.startsWith('.')) return null;
  const base = resolve(dirname(fromFile), spec);
  const ext = base.endsWith('.js') || base.endsWith('.jsx') ? base.slice(-3) : '';
  const stem = ext === '' ? base : base.slice(0, -3);
  const candidates =
    ext === ''
      ? [base, `${base}.ts`, `${base}.tsx`, `${base}.js`, `${base}.jsx`]
      : [`${stem}.ts`, `${stem}.tsx`, `${stem}.js`, `${stem}.jsx`, `${stem}.mts`, `${stem}.cts`];
  candidates.push(`${stem}/index.ts`, `${stem}/index.tsx`, `${stem}/index.js`);
  for (const c of candidates) {
    if (existsSync(c) && statSync(c).isFile()) return c;
  }
  return null;
}

/**
 * 把一个名字在文件里的解析结果规范化成三选一：
 *   `{ kind: 'ui', symbol }`     —— 最终来自 `@heyta/ui`（含别名/再导出）
 *   `{ kind: 'local', file }`    —— 本宿主内的组件
 *   `{ kind: 'external' | 'unknown' }`
 */
function resolveName(file, name, seen = new Set()) {
  const key = `${file.path}#${name}`;
  if (seen.has(key)) return { kind: 'unknown' };
  seen.add(key);

  const imp = file.imports.get(name);
  if (imp !== undefined) {
    if (imp.module === UI_MODULE) return { kind: 'ui', symbol: imp.source };
    const target = resolveLocalModule(file.path, imp.module);
    if (target !== null && files.has(target)) return resolveExported(target, imp.source, seen);
    return { kind: 'external' };
  }

  const re = file.reexports.get(name);
  if (re !== undefined) {
    if (re.module === undefined) return resolveName(file, re.local, seen);
    if (re.module === UI_MODULE) return { kind: 'ui', symbol: re.source };
    const target = resolveLocalModule(file.path, re.module);
    if (target !== null && files.has(target)) return resolveExported(target, re.source, seen);
    return { kind: 'external' };
  }

  if (file.defs.has(name)) return { kind: 'local', file: file.path, name };
  // 没导入就写 `<HeytaUiProvider>` 是极不推荐的写法，但认出来比漏掉好。
  if (name === PROVIDER_NAME) return { kind: 'ui', symbol: PROVIDER_NAME };
  return { kind: 'unknown' };
}

function resolveExported(targetPath, name, seen) {
  const file = files.get(targetPath);
  if (file === undefined) return { kind: 'external' };
  const key = `${targetPath}#${name}`;
  if (seen.has(key)) return { kind: 'unknown' };
  seen.add(key);

  const re = file.reexports.get(name);
  if (re !== undefined) {
    if (re.module === undefined) return resolveName(file, re.local, seen);
    if (re.module === UI_MODULE) return { kind: 'ui', symbol: re.source };
    const t2 = resolveLocalModule(targetPath, re.module);
    if (t2 !== null && files.has(t2)) return resolveExported(t2, re.source, seen);
    return { kind: 'external' };
  }
  if (file.imports.has(name)) return resolveName(file, name, seen);
  if (file.defs.has(name)) return { kind: 'local', file: targetPath, name };
  return { kind: 'unknown' };
}

/** 这份文件里解析成 `HeytaUiProvider` 的 JSX 元素（含本地别名）。 */
function providerNodesOf(file) {
  const out = [];
  for (const node of file.nodes) {
    if (node.name.includes('.')) continue;
    const r = resolveName(file, node.name);
    if (r.kind === 'ui' && r.symbol === PROVIDER_NAME) out.push({ file, node });
  }
  return out;
}

/**
 * `[from, to)` 区间里出现的所有 JSX 开标签名（含偏移）。
 *
 * 🔴 为什么不用 `file.nodes`：`scanJsxTree` 把整个开标签（含属性里的 `{…}`）
 * 当作一段跳过 —— 于是 **render prop 里嵌套的组件**（例如
 * `renderMeta={(row) => <SliceBadges row={row} />}`）**不会**成为独立节点。
 * 实测：`apps/web/src/dev/universal-slice.tsx` 的 `<SliceBadges>` 正是这种形态，
 * 只看 `file.nodes` 会把它算成"在 Provider 之外"，误报。
 *
 * 判据与 `isTagOpen` 一致：`<` 前一个非空字符不能是标识符字符（排除 TS 泛型
 * `useState<Foo>`）；这里另外接受 `return <Foo>` / `yield <Foo>`，因为这是合法
 * 的 JSX 返回形状，不能把 `return` 的末尾字母误当成泛型边界。
 */
function renderedTags(file, from, to) {
  const out = [];
  const re = /<([A-Za-z][\w$]*)/g;
  let m;
  while ((m = re.exec(file.structural)) !== null) {
    if (m.index < from || m.index >= to) continue;
    let p = m.index - 1;
    while (p >= 0 && (file.structural[p] === ' ' || file.structural[p] === '\t')) p--;
    // `return <Screen />` is JSX even though the previous non-space character
    // is the final `n` of the JavaScript keyword. Keep the generic-expression
    // guard for `value<Foo>`, while accepting JSX returned directly from a
    // function (the mobile feature-screen registry uses this shape).
    const before = file.structural.slice(Math.max(0, m.index - 32), m.index);
    const followsReturn = /\b(?:return|yield)\s*$/.test(before);
    if (p >= 0 && /[A-Za-z0-9_$)\]]/.test(file.structural[p]) && !followsReturn) continue;
    out.push({ name: m[1], offset: m.index });
  }
  return out;
}

/** 这份文件里所有的"需要 Provider 的消费者"（组件 JSX + hook 调用）。 */
function consumerUsagesOf(file) {
  const usages = [];
  for (const tag of renderedTags(file, 0, file.structural.length)) {
    const r = resolveName(file, tag.name);
    if (r.kind === 'ui' && PROVIDER_DEPENDENT_SET.has(r.symbol) && !r.symbol.startsWith('use')) {
      usages.push({
        symbol: r.symbol,
        offset: tag.offset,
        form: `组件 <${tag.name}>`,
        line: lineAt(file.text, tag.offset),
      });
    }
  }

  // hook：只有"本地名 → 最终解析成清单里的 use*"才看，避免把 `t(...)` 之类算进来。
  const hookLocals = new Map();
  const collect = (local) => {
    const r = resolveName(file, local);
    if (r.kind === 'ui' && PROVIDER_DEPENDENT_SET.has(r.symbol) && r.symbol.startsWith('use')) {
      hookLocals.set(local, r.symbol);
    }
  };
  for (const local of file.imports.keys()) collect(local);
  for (const local of file.reexports.keys()) collect(local);

  for (const [local, symbol] of hookLocals) {
    const re = new RegExp(`\\b${local.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\(`, 'g');
    for (const m of file.code.matchAll(re)) {
      usages.push({
        symbol,
        offset: m.index,
        form: `钩子 ${local}()`,
        line: lineAt(file.text, m.index),
      });
    }
  }
  return usages;
}

/* ========================================================================
 * 三、主流程
 * ====================================================================== */

const anchor = checkAnchor();
if (anchor.error !== undefined) {
  console.error(`${anchor.error}\n`);
  process.exit(1);
}

const hostReports = [];
const problems = [];

for (const hostDir of HOST_DIRS) {
  const hostFiles = collectSourceFiles(join(ROOT, hostDir)).map(analyzeFile);
  if (hostFiles.length === 0) continue;

  const providers = hostFiles.flatMap(providerNodesOf);

  /** 🔴 解析自检：看起来有 Provider 标签，但扫不出它的 range → 报错。 */
  const unparsed = [];
  for (const file of hostFiles) {
    const names = new Set();
    for (const local of new Set([...file.imports.keys(), ...file.reexports.keys()])) {
      const r = resolveName(file, local);
      if (r.kind === 'ui' && r.symbol === PROVIDER_NAME) names.add(local);
    }
    names.add(PROVIDER_NAME);
    for (const name of names) {
      const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      // 开标签出现次数（`</Name>` 不算，`<` 后面是 `/`）。
      const opens = (file.structural.match(new RegExp(`<\\s*${escaped}[\\s/>]`, 'g')) ?? []).length;
      if (opens === 0) continue;
      const parsedCount = providers.filter((p) => p.file === file && p.node.name === name).length;
      // 🔴 出现次数 > 解析出的元素数 = 有标签算不出 range，或者扫描被它带崩。
      //    两者都会让"之内/之外"这个判断失去意义，必须报错而不是跳过。
      if (opens > parsedCount) {
        const at = file.structural.search(new RegExp(`<\\s*${escaped}[\\s/>]`));
        unparsed.push({ file, name, line: lineAt(file.structural, at < 0 ? 0 : at), opens, parsedCount });
      }
    }
  }
  if (unparsed.length > 0) {
    for (const u of unparsed) {
      const where = relative(ROOT, u.file.path);
      problems.push(
        `判据失效：${where}:${String(u.line)} 看起来挂着 <${u.name}>（HeytaUiProvider 的挂点），` +
          `但配对标签扫描只解析出 ${String(u.parsedCount)} 个元素（源码里出现 ${String(u.opens)} 次）——` +
          `**算不出它的 JSX range**。\n` +
          `      ⇒ 算不出 range 就判不了"消费者在之内还是之外"，此时报"通过"是假的。\n` +
          `      修法：确认该标签有配对的闭合标签（或写成自闭合 <${u.name} … />），\n` +
          `            别用 React.createElement / 变量别名等扫描器看不见的形式挂 Provider。`,
      );
    }
  }

  const usages = hostFiles.flatMap((file) =>
    consumerUsagesOf(file).map((usage) => ({ ...usage, file })),
  );
  if (usages.length === 0) continue; // 不用共享 UI 的宿主是合法形态

  // ---- 原有判据（不退化）：宿主里必须真的挂了 Provider --------------------
  if (providers.length === 0) {
    const where = [...new Set(usages.map((u) => `${relative(ROOT, u.file.path)}（${u.symbol}）`))];
    problems.push(
      `${hostDir} 用了需要主题 Provider 的共享组件，但整个宿主里**没有挂** HeytaUiProvider` +
        `${unparsed.length > 0 ? '（或挂法无法解析）' : ''}：\n` +
        `      ${where.join('\n      ')}\n` +
        `      ⇒ 运行时会抛「useHeytaUiTheme 必须在 <HeytaUiProvider> 内使用。」而**类型与单测都不会红**。\n` +
        `      修法：在宿主根组件里把 HeytaUiProvider 包在所有用到共享组件的树之外\n` +
        `      （移动端用别名 ThemeProvider，见 apps/mobile/src/theme.tsx）。`,
    );
    continue;
  }

  // ---- 新增判据：每个消费者必须在某个 Provider 的 JSX 子树之内 -----------
  // 可达文件集：从每个 Provider 的子树**直接渲染**的本地组件出发，沿相对
  // import 的渲染图 BFS（跟到文件级，边界见文件头）。
  const reachable = new Set();
  for (const p of providers) {
    for (const tag of renderedTags(p.file, p.node.start, p.node.end)) {
      const r = resolveName(p.file, tag.name);
      if (r.kind === 'local' && !reachable.has(r.file)) reachable.add(r.file);
    }
  }
  const queue = [...reachable];
  while (queue.length > 0) {
    const file = files.get(queue.pop());
    if (file === undefined) continue;
    for (const tag of renderedTags(file, 0, file.structural.length)) {
      const r = resolveName(file, tag.name);
      if (r.kind === 'local' && !reachable.has(r.file)) {
        reachable.add(r.file);
        queue.push(r.file);
      }
    }
  }

  // ---- 插槽工厂（2026-10-02 补）--------------------------------------------
  // 组件体的 `const renderX = useCallback((…) => <Consumer …/>)` 在**运行时**
  // 是正确的：回调在共享组件的渲染过程中被调用，而共享组件挂在 Provider 之内
  //（App.tsx 的 renderTaskMeta / renderTrailing 正是此形态）。上面的判据看
  // **词法位置**，会把这类消费者误判成"在子树之外"（false positive）。
  // 规则：消费者所在的**工厂标识符**（包含它的、组件体缩进两格的
  // `const <name> = useCallback(…)` / `const <name> = (…) => …`）
  // 只要在某个 Provider 的 range 之内被**引用**过（如 `renderMeta={renderX}`），
  // 就按运行时嵌套判为"之内"。
  const providerRanges = providers.map((p) => ({
    file: p.file,
    start: p.node.start,
    end: p.node.end,
  }));
  // 插槽工厂扩展**可达性根集**：工厂定义在组件体（App.tsx:721 一类），
  // 消费者在工厂返回的组件文件里 —— 运行时它们经共享组件（Provider 之内）
  // 被调用，词法上却落在 Provider range 之外。凡工厂标识符在自己宿主文件的
  // 某个 Provider range 之内被引用，其声明区间（到下一个同缩进 const 为止）
  // 里渲染出的本地组件都按"Provider 之内"计。
  const slotRoots = [];
  for (const file of hostFiles) {
    const declRe = /\n  const (\w+)\s*=\s*(?:useCallback\(|\(|async)/g;
    const decls = [];
    let dm;
    while ((dm = declRe.exec(file.structural)) !== null) {
      decls.push({ name: dm[1], start: dm.index });
    }
    for (let i = 0; i < decls.length; i++) {
      const end = i + 1 < decls.length ? decls[i + 1].start : file.structural.length;
      const referenced = providerRanges.some(
        (r) =>
          r.file === file &&
          new RegExp(`\\b${decls[i].name}\\b`).test(file.structural.slice(r.start, r.end)),
      );
      if (referenced) slotRoots.push({ file, start: decls[i].start, end });
    }
  }
  for (const s of slotRoots) {
    for (const tag of renderedTags(s.file, s.start, s.end)) {
      const r = resolveName(s.file, tag.name);
      if (r.kind === 'local' && !reachable.has(r.file)) reachable.add(r.file);
    }
  }

  const uncovered = [];
  for (const u of usages) {
    const directlyInside = providers.some(
      (p) => p.file === u.file && u.offset >= p.node.start && u.offset < p.node.end,
    );
    if (!directlyInside && !reachable.has(u.file.path)) uncovered.push({ file: u.file, usage: u });
  }

  hostReports.push({
    hostDir,
    consumers: usages.length,
    providers: providers.length,
  });

  if (uncovered.length > 0) {
    const where = uncovered
      .map(({ file, usage }) => {
        const rel = relative(ROOT, file.path);
        return `      ${rel}:${String(usage.line)} —— ${usage.form}（${usage.symbol}）`;
      })
      .join('\n');
    problems.push(
      `${hostDir} 有 ${String(new Set(uncovered.map((x) => `${x.file.path}#${x.usage.line}`)).size)} 处` +
        `共享 UI 的消费者落在 HeytaUiProvider 的 JSX 子树**之外**：\n` +
        `${where}\n` +
        `      ⇒ 这正是 2026-09-28 那次真实崩溃的形状：Provider 只包了**一棵**子树，\n` +
        `        别的视图/组件是它的兄弟节点，一打开就抛\n` +
        `        「useHeytaUiTheme 必须在 <HeytaUiProvider> 内使用」，而类型与单测都不会红。\n` +
        `      修法：把 Provider 提到**同时包住**这些消费者的那一层（例如宿主根组件），\n` +
        `        或在每个视图各自挂一层 —— 判据是"消费者在 Provider 的子树之内"，\n` +
        `        不是"宿主里出现过 Provider"。`,
    );
  }
}

/* ========================================================================
 * 四、报告
 * ====================================================================== */

console.log('─'.repeat(72));
console.log('共享 UI 主题 Provider：用了共享 UI 的宿主必须把它挂在 Provider 之内');
console.log('─'.repeat(72));

if (problems.length > 0) {
  console.error('🔴 共享 UI 主题 Provider 覆盖不足 / 判据失效：\n');
  for (const p of problems) console.error(`  · ${p}\n`);
  console.error('🔴 check:ui-provider 未通过。\n');
  process.exit(1);
}

const summary =
  hostReports.length === 0
    ? '（本次没有宿主引用需要 Provider 的符号）'
    : hostReports
        .map((h) => `${h.hostDir}（${String(h.consumers)} 处消费者 / ${String(h.providers)} 个 Provider 挂点）`)
        .join('、');
console.log(`✅ 用了共享 UI 的宿主都挂了 HeytaUiProvider，且消费者都在它的 JSX 子树之内：${summary}`);
console.log('');
console.log('ℹ️ 覆盖边界（如实说明 —— 诚实的不完备 > 假的完备）：');
console.log('   · 覆盖：同一宿主内经相对 import 连接的组件渲染图，跟到**组件所在文件**为止。');
console.log('   · 覆盖②：插槽工厂 —— 组件体 const 工厂（useCallback / 箭头）里渲染的消费者，');
console.log('     只要工厂标识符在某个 Provider range 内被引用，按运行时嵌套判为之内');
console.log('     （2026-10-02 补：此前把 App.tsx 的 renderTaskMeta 形态误报成子树之外）。');
console.log('   · 不覆盖①：文件级近似 —— 文件可达即认为其消费者被覆盖，');
console.log('     不区分同一文件内的条件分支；近似只会漏报，插槽工厂规则消除了一类误报。');
console.log('   · 不覆盖②：经非 @heyta/ui 的 workspace 包再转手渲染共享组件的间接路径。');
console.log('   · 不覆盖③：React.createElement / 变量组件 / 动态 import 等运行时才决定的挂法。');
console.log('   · 不覆盖④：packages/ui 内部自身的消费者（它是 Provider 的定义处）。');
