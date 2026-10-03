/**
 * `@heyta/ui` —— 四端共用的 UI 组件
 * ==================================
 *
 * 这一层的存在理由只有一条（ADR-0003 §2.1）：**业务与界面逻辑不能在 `apps/<应用>` 里
 * 各写一份。** 每多一个宿主就多一份拷贝，而拷贝之间的漂移不会报错，
 * 只会让"Web 上是对的、Android 上是错的"变成常态。
 *
 * 边界：
 *   - 进得来的：RN 原语写成的展示组件、以及它们依赖的纯逻辑（各目录下的 `model.ts`）。
 *   - 进不来的：任何 `apps/<应用>` 的东西、任何 i18n（会拖进第二份 React）、
 *     任何 DOM 标签、任何裸样式值（`check:design` 会拦）。
 */

export {
  TaskList,
  type FlatTaskListProps,
  type SectionedTaskListProps,
  type TaskListLabels,
  type TaskListProps,
} from './task-list/TaskList.js';
export {
  TaskGroupHead,
  type TaskGroupCollapse,
  type TaskGroupHeadProps,
} from './task-list/TaskGroupHead.js';
export { TaskBadges, type TaskBadgesProps } from './task-list/TaskBadges.js';
export {
  flattenSections,
  sortTasksForDisplay,
  toTaskRow,
  toTaskRows,
  type SectionRow,
  /**
   * ⚠️ `type TaskRow` 的**转出点搬到了文件末尾**（`./task-list/TaskRow.js`）。
   *
   * 🔴 这不是风格调整，是 TypeScript 逼出来的：`TaskRow` 现在既是
   * **行模型类型**（本模块）又是**行组件值**（`TaskRow.tsx`）。桶文件若把
   * 同一个名字从两个模块各转出一次，`tsc` 直接报
   * `TS2300: Duplicate identifier 'TaskRow'`（实测）。函数声明与接口声明
   * 可以合并，所以现在由 `TaskRow.tsx` 用一个**同名 interface + 同名 function**
   * 同时承担两种含义，`index.ts` 只在末尾转出那一个符号。
   * 消费者写法（`type TaskRow` / `type TaskRow as SharedTaskRow`）一字未变。
   */
  type TaskSection,
  type ToTaskRowOptions,
} from './task-list/model.js';
export { HeytaIcon, type HeytaIconData, type HeytaIconProps } from './icon/Icon.js';
export {
  TrashBoard,
  type TrashBoardLabels,
  type TrashBoardProps,
} from './trash/TrashBoard.js';
export {
  SearchPanel,
  type SearchPanelLabels,
  type SearchPanelProps,
} from './search/SearchPanel.js';
/**
 * 玻璃材质表面（ADR-0042）：档位（chrome/panel/sheet）× 端能力协商的
 * **唯一合法居所** —— 业务组件不得散写 `Platform.OS` 材质分叉。
 * web 的另一半（blur + saturate + rim）在宿主 CSS 的 `.ht-material`。
 */
export {
  materialSurface,
  type MaterialSurfaceStyle,
  type MaterialTier,
  type MaterialTokens,
} from './material/material-surface.js';
/**
 * 搜索面板的**判据层**（宿主算键盘光标要用同一套，不许在 `apps/*` 重写一遍）：
 * 跳转项怎么过滤、结果怎么摊平成有序数组、光标怎么走。
 */
export {
  buildResultEntries,
  CURSOR_IN_INPUT,
  filterQuickActions,
  MAX_QUICK_ACTIONS,
  moveCursor,
  type QuickAction,
  type QuickActionGroup,
  type SearchResultEntry,
  type SearchResultKind,
  type SearchGroups,
} from './search/model.js';
export { CalendarBoard, type CalendarBoardProps } from './calendar/CalendarBoard.js';
export { CalendarToolbar, type CalendarToolbarProps } from './calendar/CalendarToolbar.js';
export {
  calendarDayTone,
  calendarDayMarkerView,
  calendarCellBars,
  stepCalendarCursor,
  groupTasksByDueDate,
  MAX_CALENDAR_BARS,
  type CalendarBoardLabels,
  type CalendarCellBar,
  type CalendarViewKind,
  type CalendarDayTone,
  type CalendarDayMarker,
  type CalendarToolbarLabels,
} from './calendar/model.js';
export {
  formatDayTitleText,
  formatWeekRangeText,
  weekdayMessageKey,
  formatMonthTitleText,
  WEEKDAY_MESSAGE_KEYS,
  type CalendarDateKey,
  type CalendarTranslate,
} from './calendar/date-text.js';
/**
 * 空态：**唯一权威定义**。
 *
 * `scripts/check-empty-state.mjs` 的断言 C 把 `empty-state/EmptyState.tsx`
 * 登记为全仓唯一的权威定义处，并钉住"它必须从这里导出" —— 一个导出不出去
 * 的权威定义等于不存在。两端现有的两个 `EmptyState` 是**待收编的债**，
 * 收编后应变成对本项的薄转发。
 */
export {
  EmptyState,
  type EmptyStateDetailTone,
  type EmptyStateProps,
  type EmptyStateSlots,
} from './empty-state/EmptyState.js';
export {
  nonBlank,
  toEmptyStateViewModel,
  type EmptyStateViewModel,
} from './empty-state/model.js';
export {
  FocusPanel,
  type FocusPanelLabels,
  type FocusPanelProps,
} from './focus/FocusPanel.js';
export { FocusRing, type FocusRingProps } from './focus/FocusRing.js';
export {
  FOCUS_KIND_ORDER,
  focusDisplayText,
  focusRoundLengthMs,
  focusLogFailureMessageKey,
  focusPrimaryAction,
  focusTone,
  toFocusViewModel,
  type FocusLogFailureMessageKey,
  type FocusPrimaryAction,
  type FocusTone,
  type FocusViewModel,
} from './focus/model.js';

export {
  CategoryReportView,
  type CategoryReportLabels,
  type CategoryReportViewProps,
} from './categories/CategoryReport.js';
export {
  categoryBarSegments,
  categoryHeatToken,
  categorySlotToken,
  hasUnsetCategorySlot,
  isEmptyCategoryReport,
  type CategoryBarSegment,
  type CategoryColorToken,
  type CategoryHeatLevel,
} from './categories/model.js';

export {
  HeytaUiProvider,
  resolveHeytaUiTheme,
  useHeytaText,
  useHeytaTokens,
  useHeytaUiTheme,
  type HeytaUiNativeAccessors,
  type HeytaUiProviderProps,
  type HeytaUiTheme,
} from './theme.js';

/**
 * 同步 / 冲突（M3 第四刀）。
 *
 * 与上面几块同一个形状：**共享视图 + 判断收在 `model.ts`**。
 * ✅ **已登记进 `scripts/check-ui-provider.mjs` 的 `PROVIDER_DEPENDENT`**
 * （2026-10-05 核实）。宿主把它们放在 `<HeytaUiProvider>` 之外
 * **会红**，而且报错会指名文件与行号。
 *
 * ⚠️ **这一段曾经写着"尚未登记"，而那句后来变成了假话。** 它当时是实测为真的
 * （补登记尚未做），但补上之后**没有人回来改注释** —— 于是文件里留下了一条
 * 与事实相反的指令（"请补登记：X"）。本仓反复吃这个形状：**注释不是判据，
 * 且状态一变它就变成错误信息**。所以下面这些"已登记"的句子同样有保质期 ——
 * 唯一值得信的是 `PROVIDER_DEPENDENT` 本身。
 */
export {
  ConflictResolutionView,
  type ConflictResolutionLabels,
  type ConflictResolutionViewProps,
  type ConflictSideRenderInfo,
} from './sync/ConflictResolutionView.js';
export { SyncStatusBar, type SyncStatusBarLabels, type SyncStatusBarProps } from './sync/SyncStatusBar.js';
export {
  NO_CONFLICT_FRESHNESS,
  conflictBlockedReason,
  conflictCanChoose,
  conflictChoiceForSide,
  conflictLookupCode,
  conflictSummaryStyle,
  preferredConflictSide,
  syncFailureMessageKey,
  syncStatusAffordances,
  syncStatusBusy,
  syncStatusColorToken,
  syncStatusGlyph,
  syncStatusSeverity,
  type ConflictBlockedReason,
  type ConflictChoice,
  type ConflictFreshness,
  type ConflictLike,
  type ConflictPayloadSummaryLike,
  type ConflictSideKind,
  type ConflictSideLike,
  type ConflictSummaryStyle,
  type SyncColorToken,
  type SyncFailureMessageKey,
  type SyncGlyph,
  type SyncSeverity,
  type SyncStatusAffordances,
  type SyncStatusKind,
  type SyncStatusLike,
} from './sync/model.js';

/**
 * ── M3 第四刀（sync）收尾：实体名 / 冲突原因 → 共享词条 key ──
 *
 * 🔴 **本块是追加的**（`index.ts` 是多写者共享文件，只许在末尾追加）。
 * 上面那份 sync 导出清单没有被改动。
 *
 * 这一段与上面同属"判断收在 model.ts"：两端从同一张表取词条 key，
 * 不再各自维护一份 `ENTITY_LABEL_KEYS` / `REASON_KEYS`。
 */
export {
  CONFLICT_REASON_FALLBACK_KEY,
  CONFLICT_REASON_KEYS,
  ENTITY_LABEL_KEYS,
  conflictReasonKey,
  conflictReasonLabelOf,
  entityLabelKey,
  entityLabelOf,
  type ConflictReasonKey,
  type ConflictReasonText,
  type EntityLabelKey,
  type EntityLabelText,
} from './sync/model.js';

/**
 * ── M3 `ai` 第一刀：出境披露的**唯一实现** ──
 *
 * 🔴 **本块是追加的**（`index.ts` 是多写者共享文件，只许在末尾追加）。
 * 上面的导出清单没有被改动。
 *
 * `AiDisclosure` 透过 `useHeytaTokens` / `useHeytaText` 取 token，
 * 所以宿主必须把它挂在 `<HeytaUiProvider>` 之内。
 *
 * ✅ **已登记进 `scripts/check-ui-provider.mjs` 的 `PROVIDER_DEPENDENT`**
 * （2026-10-05 核实）。宿主把它们放在 `<HeytaUiProvider>` 之外
 * **会红**，而且报错会指名文件与行号。
 *
 * ⚠️ **这一段曾经写着"尚未登记"，而那句后来变成了假话。** 它当时是实测为真的
 * （补登记尚未做），但补上之后**没有人回来改注释** —— 于是文件里留下了一条
 * 与事实相反的指令（"请补登记：X"）。本仓反复吃这个形状：**注释不是判据，
 * 且状态一变它就变成错误信息**。所以下面这些"已登记"的句子同样有保质期 ——
 * 唯一值得信的是 `PROVIDER_DEPENDENT` 本身。
 */
export {
  AiPanelHead,
  type AiPanelHeadProps,
} from './ai/AiPanelHead.js';
export {
  AiPanel,
  type AiPanelProps,
  type AiPanelRole,
} from './ai/AiPanel.js';
export {
  AiDisclosure,
  type AiDisclosureInput as AiDisclosureRouteInput,
  type AiDisclosureLabels,
  type AiDisclosureProps,
  type AiDisclosureTarget,
} from './ai/AiDisclosure.js';
export {
  AI_DISCLOSURE_DIMENSIONS,
  aiDisclosureTestIds,
  disclosureParityGaps,
  requiredDisclosureDimensions,
  toAiDisclosureViewModel,
  type AiDisclosureDimension,
  type AiDisclosureInput,
  type AiDisclosureTestIds,
  type AiDisclosureViewModel,
} from './ai/model.js';

/**
 * ── M3 第五刀（settings）：**"设置里的一行长什么样"只有这一个实现** ──
 *
 * 🔴 **本块是追加的**（`index.ts` 是多写者共享文件，只许在末尾追加）。
 * 上面所有导出清单都没有被改动。
 *
 * `SettingsSection` / `SettingsRow` 都透过 `useHeytaTokens` / `useHeytaText`
 * 取 token，所以用了它们的宿主必须挂在 `<HeytaUiProvider>` 之内。
 *
 * ✅ **已登记进 `scripts/check-ui-provider.mjs` 的 `PROVIDER_DEPENDENT`**
 * （2026-10-05 核实）。宿主把它们放在 `<HeytaUiProvider>` 之外
 * **会红**，而且报错会指名文件与行号。
 *
 * ⚠️ **这一段曾经写着"尚未登记"，而那句后来变成了假话。** 它当时是实测为真的
 * （补登记尚未做），但补上之后**没有人回来改注释** —— 于是文件里留下了一条
 * 与事实相反的指令（"请补登记：X"）。本仓反复吃这个形状：**注释不是判据，
 * 且状态一变它就变成错误信息**。所以下面这些"已登记"的句子同样有保质期 ——
 * 唯一值得信的是 `PROVIDER_DEPENDENT` 本身。
 */
export {
  SettingsRow,
  SettingsSection,
  type SettingsRowProps,
  type SettingsSectionProps,
} from './settings/Settings.js';
export {
  isSettingActionable,
  resolvePendingUploadPresentation,
  resolveSettingAvailability,
  settingsRowKey,
  shouldRenderSettingsRow,
  type PendingUploadPresentation,
  type SettingAvailability,
  type SettingsActionRow,
  type SettingsHeadingRow,
  type SettingsNoteRow,
  type SettingsRowModel,
  type SettingsRowTone,
  type SettingsToggleRow,
  type SettingsValueRow,
} from './settings/model.js';

/**
 * ── M3 第六刀（quadrant）：**"四象限卡里的行 = 列表里的行"** ──
 *
 * 🔴 **本块是追加的**（`index.ts` 是多写者共享文件，只许在末尾追加）。
 * 上面所有导出清单都没有被改动。
 *
 * `QuadrantBoard` 透过 `useHeytaTokens` / `useHeytaText` 取 token，
 * 所以用了它的宿主必须挂在 `<HeytaUiProvider>` 之内。
 * 它的每一格**直接渲染共享的 `TaskList`** —— 于是卡里的行与列表里的行
 * 是同一条代码路径（判据见 `apps/web/tests/quadrant-row-parity.spec.tsx`）。
 *
 * ✅ **已登记进 `scripts/check-ui-provider.mjs` 的 `PROVIDER_DEPENDENT`**
 * （2026-10-05 核实）。宿主把它们放在 `<HeytaUiProvider>` 之外
 * **会红**，而且报错会指名文件与行号。
 *
 * ⚠️ **这一段曾经写着"尚未登记"，而那句后来变成了假话。** 它当时是实测为真的
 * （补登记尚未做），但补上之后**没有人回来改注释** —— 于是文件里留下了一条
 * 与事实相反的指令（"请补登记：X"）。本仓反复吃这个形状：**注释不是判据，
 * 且状态一变它就变成错误信息**。所以下面这些"已登记"的句子同样有保质期 ——
 * 唯一值得信的是 `PROVIDER_DEPENDENT` 本身。
 * （web 宿主 `features/quadrant/QuadrantBoard.tsx` 自带一层 Provider，
 * 因为它挂在 `App.tsx` 里 `tasks` 那棵树的**兄弟节点**上 —— 见那里的文件头。）
 */
export {
  QuadrantBoard,
  type QuadrantBoardLabels,
  type QuadrantBoardProps,
} from './quadrant/QuadrantBoard.js';
export {
  QUADRANT_ORDER,
  quadrantSlot,
  quadrantSlotToken,
  toQuadrantCards,
  type QuadrantBucket,
  type QuadrantCardModel,
  type QuadrantColorToken,
} from './quadrant/model.js';

/**
 * ── M3 §4.2 补缺：**`TaskRow` 的 `density` 档位**（本轮新增） ──
 *
 * 🔴 **本块是追加的**（`index.ts` 是多写者共享文件，只许在末尾追加）。
 * 上面所有导出清单都没有被改动 —— 只有一处例外，且已在原处注明：
 * `./task-list/model.js` 的 `type TaskRow` 转出点搬到了本块，
 * 因为同名"类型 + 组件值"不能在桶文件里分两行转出（`TS2300`，实测）。
 *
 * 契约出处：`docs/research/dida-view-unification.md` §4.2 ——
 * 列表 = 宽松 / 象限卡 = `compact` / 日历格 = `minimal`，**不是三份 JSX**。
 *
 * 一句话总结这次的形状：**`TaskRow` 是行骨架的唯一实现，
 * `DENSITY_SPEC` 是"三档差在哪"的唯一登记处** ——
 * 所以"多档密度"不会漂成"多份 if 分支"（`tests/task-row-density.spec.ts`
 * 用源码级断言钉住组件里没有 `density ===` 这种散落判断）。
 *
 * `TaskRow` 透过 `useHeytaTokens` / `useHeytaText` 取 token，所以用了它的
 * 宿主必须挂在 `<HeytaUiProvider>` 之内。
 *
 * ✅ **已登记进 `scripts/check-ui-provider.mjs` 的 `PROVIDER_DEPENDENT`**
 * （2026-10-05 核实）。宿主把它们放在 `<HeytaUiProvider>` 之外
 * **会红**，而且报错会指名文件与行号。
 *
 * ⚠️ **这一段曾经写着"尚未登记"，而那句后来变成了假话。** 它当时是实测为真的
 * （补登记尚未做），但补上之后**没有人回来改注释** —— 于是文件里留下了一条
 * 与事实相反的指令（"请补登记：X"）。本仓反复吃这个形状：**注释不是判据，
 * 且状态一变它就变成错误信息**。所以下面这些"已登记"的句子同样有保质期 ——
 * 唯一值得信的是 `PROVIDER_DEPENDENT` 本身。
 */
export {
  TaskRow,
  type TaskRowLabels,
  type TaskRowProps,
} from './task-list/TaskRow.js';
export {
  DEFAULT_TASK_ROW_DENSITY,
  DENSITY_SPEC,
  TASK_ROW_DENSITIES,
  resolveTaskRowDensity,
  type TaskRowDensity,
  type TaskRowDensitySpec,
} from './task-list/density.js';


/**
 * ── M3 第七刀（habits）：**"一个习惯一张卡 + 近 90 天热力图"只有这一个实现** ──
 *
 * 🔴 **本块是追加的**（`index.ts` 是多写者共享文件，只许在末尾追加）。
 * 上面所有导出清单都没有被改动。
 *
 * `HabitBoard` 透过 `useHeytaTokens` / `useHeytaText` 取 token，所以用了它的
 * 宿主必须挂在 `<HeytaUiProvider>` 之内。
 *
 * ✅ **`HabitBoard` 已登记进 `scripts/check-ui-provider.mjs` 的
 * `PROVIDER_DEPENDENT`**（由父 agent 在本刀收尾时补上 —— 该脚本不在本刀白名单）。
 * 这是同一个缺口第五次出现（sync → AI → settings → quadrant → habits），
 * 每次都靠父 agent 事后复核才补上。门禁已实测会红：
 * 在 `/tmp` 副本里拆掉 `features/habits/HabitsView.tsx` 的 Provider →
 * `🔴 apps/web/src/features/habits/HabitsView.tsx:221 —— 组件 <HabitBoard>`。
 *
 * 还有一条**刻意**的接口形状要记在这：连续与韧性的**配对**不由本组件算，
 * 而是宿主经 `growth: HabitGrowthFn` 注入 `@heyta/app-host#habitGrowth` ——
 * 那里是"两个数字必须用同一份日志、同一个 today"的唯一实现，
 * 而 `packages/ui` 不能 import `@heyta/app-host`（那是宿主接线层）。
 */
export {
  HabitBoard,
  type HabitBoardLabels,
  type HabitBoardProps,
  type HabitHeatmapLabels,
} from './habits/HabitBoard.js';
export {
  HABIT_HEATMAP_DAYS,
  HEATMAP_MONTH_KEYS,
  HEATMAP_WEEK_START,
  frozenDays,
  habitHeatLevel,
  habitHeatmap,
  heatmapLevelToken,
  heatmapTotal,
  monthOfDate,
  shouldOfferFreshStart,
  shouldOfferRepair,
  toHabitProgressRows,
  toHeatmapWeeks,
  type HabitGrowthFn,
  type HabitHeatLevel,
  type HabitHeatToken,
  type HeatmapMonthKey,
  type HabitProgressRow,
  type HeatmapDay,
  type HeatmapWeek,
  type HeatmapWeekStart,
} from './habits/model.js';

/**
 * ── M3 第八刀（capture）：**"输入一句话 → 看见读懂了什么 → 逐条确认"只有这一个实现** ──
 *
 * 🔴 **本块是追加的**（`index.ts` 是多写者共享文件，只许在末尾追加）。
 * 上面所有导出清单都没有被改动。
 *
 * `CaptureComposer` 透过 `useHeytaTokens` / `useHeytaText` 取 token，所以用了
 * 它的宿主必须挂在 `<HeytaUiProvider>` 之内。它已经登记进
 * `scripts/check-ui-provider.mjs` 的 `PROVIDER_DEPENDENT`（本刀同时做的 ——
 * 那个缺口此前连续出现过五次，第六次不该再由父 agent 事后补）。
 *
 * 判断全在 `./capture/model.ts`（node 单测跑穿）：芯片三态、忽略清单的增删、
 * 标题空不空、本地日期 → epoch。组件里因此没有分支。
 *
 * 🔴 **解析本身一条都没重写** —— 它仍然是 `@heyta/domain#parseCapture`。
 * 这里新增的只有"展示 / 交互 / 换算"。
 *
 * ⚠️ `renderAssistant` 是给宿主内容留的插槽（web 的 AI 一句话捕获）。
 * 它**不**等于把 AI 面板收进了共享层 —— 移动端本轮仍只有确定性捕获，
 * 理由与最小一步写在 `capture/CaptureComposer.tsx` 文件头。
 */
export {
  CaptureComposer,
  type CaptureAssistantContext,
  type CaptureComposerLabels,
  type CaptureComposerProps,
} from './capture/CaptureComposer.js';
export {
  captureCanSubmit,
  captureChipAction,
  captureChipKey,
  captureChipRemainingDays,
  capturePriorityLabelKey,
  parseCaptureDraft,
  shouldResetCaptureIgnore,
  toAiCaptureSubmitPlan,
  toCaptureChips,
  toCaptureSubmitPlan,
  toggleCaptureIgnore,
  type CaptureAiFields,
  type CaptureChip,
  type CaptureChipAction,
  type CapturePriorityLabelKey,
  type CaptureSubmitPlan,
} from './capture/model.js';

/**
 * ── M3 第九刀（projects）：**"一个清单/标签行长什么样"只有这一个实现** ──
 *
 * 🔴 **本块是追加的**（`index.ts` 是多写者共享文件，只许在末尾追加）。
 * 上面所有导出清单都没有被改动。
 *
 * `OrganizerList` 透过 `useHeytaTokens` / `useHeytaText` 取 token，所以用了
 * 它的宿主必须挂在 `<HeytaUiProvider>` 之内。它已经登记进
 * `scripts/check-ui-provider.mjs` 的 `PROVIDER_DEPENDENT`（**本刀同时做的** ——
 * 那个缺口此前连续出现过六次：sync → AI → settings → quadrant → habits → capture，
 * 第七次不该再由父 agent 事后补）。
 *
 * 判断全在 `./projects/model.ts`（node 单测跑穿）：未归档过滤、顶层 / 一层子级、
 * 未完成未删除任务的计数口径、稳定 key。组件里因此没有分支。
 *
 * 🔴 **行骨架一条都没重写**：迁移前两端各有一份（web 是 `<button class=
 * "ht-nav__item">` + `countIn`，mobile 是 kit `Text` 平表），现在只有这一份。
 * 移动端因此第一次真的按层级渲染清单（此前是平表）。
 *
 * ⚠️ 计数位只在 `> 0` 时渲染 —— 与 `App.tsx` 的 `NavButton` 同一条规则；
 * web 侧栏空清单上原本常驻的 `0` 随之消失（可见的行为变化，已在汇报里登记）。
 */
export {
  OrganizerList,
  type OrganizerListLabels,
  type OrganizerListProps,
  type OrganizerRowContext,
} from './projects/OrganizerList.js';
export {
  aliveProjects,
  childProjects,
  openTagCounts,
  openTaskCount,
  openTaskCounts,
  organizerRowKey,
  toOrganizerNodes,
  toOrganizerTree,
  toTagItems,
  topLevelProjects,
  type OrganizerItem,
  type OrganizerNode,
} from './projects/model.js';

/**
 * ── M3 第十刀（reminders / notes）：**"一条提醒、一张便签长什么样"各只有一个实现** ──
 *
 * 🔴 **本块是追加的**（`index.ts` 是多写者共享文件，只许在末尾追加）。
 * 上面所有导出清单都没有被改动。
 *
 * 为什么这两个功能必须进共享层，而不是各端各画一份：
 *
 *   · **提醒的"什么时候算到期"是一个定义**（`@heyta/domain#reminderPhase` /
 *     `#reminderEffectiveAt`）。两端各写一次 `snoozedUntil ?? triggerAt`，
 *     就会有一端漏掉 snooze，症状是"用户按了稍后提醒，到点又弹一次"，
 *     而且只在跨端时出现。`ReminderList` + `./reminders/model.ts` 把
 *     "状态 / 有效时刻 / 能不能 snooze / dismiss"收成一处。
 *   · **便签的顺序是一个定义**（`#sortNotesForDisplay`：钉选 → `updatedAt`
 *     降序 → id 字典序）。两端各 `sort()` 一次的结果是同一条便签在两端
 *     位置不同，用户会以为"同步把顺序搞乱了"。
 *
 * 为什么**文案要注入**：`packages/ui` 不能 import `@heyta/i18n` ——
 * 那个包自己带过一份 React，四端会同时中招（`check:mobile-bundle` 盯着）。
 * 所以 `ReminderListLabels` / `NotesBoardLabels` 的每一项（含依赖行内容的
 * 无障碍名 `a11yRemove(when)`）都由宿主注入；提醒的时间格式
 * （`formatWhen`）同理，因为"相对还是绝对、多久算今天"是本地化口径。
 *
 * 两者都透过 `useHeytaTokens` / `useHeytaText` 取 token，所以用了它们的宿主
 * 必须挂在 `<HeytaUiProvider>` 之内。
 *
 * ✅ **已登记进 `scripts/check-ui-provider.mjs` 的 `PROVIDER_DEPENDENT`**
 * （2026-10-05 核实）。宿主把它们放在 `<HeytaUiProvider>` 之外
 * **会红**，而且报错会指名文件与行号。
 *
 * ⚠️ **这一段曾经写着"尚未登记"，而那句后来变成了假话。** 它当时是实测为真的
 * （补登记尚未做），但补上之后**没有人回来改注释** —— 于是文件里留下了一条
 * 与事实相反的指令（"请补登记：X"）。本仓反复吃这个形状：**注释不是判据，
 * 且状态一变它就变成错误信息**。所以下面这些"已登记"的句子同样有保质期 ——
 * 唯一值得信的是 `PROVIDER_DEPENDENT` 本身。
 */
export {
  ReminderList,
  type ReminderListLabels,
  type ReminderListProps,
} from './reminders/ReminderList.js';
export {
  canDismissReminder,
  canSnoozeReminder,
  offsetPresets,
  reminderPhaseToken,
  toReminderRows,
  type ReminderBadgeToken,
  type ReminderRow,
} from './reminders/model.js';

export {
  NotesBoard,
  type NotesBoardLabels,
  type NotesBoardProps,
} from './notes/NotesBoard.js';
export {
  NOTE_EXCERPT_LENGTH,
  toNoteRows,
  type NoteRow,
} from './notes/model.js';

/**
 * ── M3 第十一刀（motivation）：**"成长这一屏长什么样"只有这一个实现** ──
 *
 * 🔴 **本块是追加的**（`index.ts` 是多写者共享文件，只许在末尾追加）。
 * 上面所有导出清单都没有被改动。
 *
 * 这一刀是**两端收敛**，不是"迁完移动端白拿"：迁移前 web 有
 * `apps/web/src/features/motivation/`（1,032 行 / 7 文件），mobile 有
 * `apps/mobile/src/screens/GrowthScreen.tsx`（578 行）—— 两份各自实现，
 * 而且**各有对方没有的能力**（web 有年度热力图 + 分享，mobile 有 L2 连续性）。
 * 共享层是那个并集，逐条差异写在 `motivation/GrowthBoard.tsx` 的文件头。
 *
 * 🔴 **一个业务数字都不在这里重算。** 今天该做几件 / 连续怎么数 / 里程碑阈值 /
 * 身份判据 / 周窗口全在 `@heyta/domain`；摊平 + 滤墓碑 + 注入 `now` 全在
 * `@heyta/app-host#motivation`（那里写着"怎么算今日只能有一份实现"）。
 * `packages/ui` 不能 import `@heyta/app-host`（宿主接线层），所以投影结果
 * **由宿主注入**，连续性走 `growth: HabitGrowthFn` —— 与 `HabitBoard` 同一个手法。
 *
 * ✅ **已登记进 `scripts/check-ui-provider.mjs` 的 `PROVIDER_DEPENDENT`**
 * （2026-10-05 核实）。宿主把它们放在 `<HeytaUiProvider>` 之外
 * **会红**，而且报错会指名文件与行号。
 *
 * ⚠️ **这一段曾经写着"尚未登记"，而那句后来变成了假话。** 它当时是实测为真的
 * （补登记尚未做），但补上之后**没有人回来改注释** —— 于是文件里留下了一条
 * 与事实相反的指令（"请补登记：X"）。本仓反复吃这个形状：**注释不是判据，
 * 且状态一变它就变成错误信息**。所以下面这些"已登记"的句子同样有保质期 ——
 * 唯一值得信的是 `PROVIDER_DEPENDENT` 本身。
 * 它们全部透过 `useHeytaTokens` / `useHeytaText` 取 token，所以用了它们的宿主
 * 必须挂在 `<HeytaUiProvider>` 之内。补登记之前门禁不覆盖它们：宿主拆掉
 * Provider **也不会红**，而运行时会抛
 * 「useHeytaUiTheme 必须在 <HeytaUiProvider> 内使用。」
 * 这是同一个缺口第**八**次出现（sync → AI → settings → quadrant → habits →
 * capture → projects → reminders/notes），父 agent 每次都要事后复核才补上。
 */
export {
  ActivityHeatmap,
  type ActivityHeatmapLabels,
  type ActivityHeatmapProps,
} from './motivation/ActivityHeatmap.js';
export {
  GrowthBoard,
  type GrowthBoardLabels,
  type GrowthBoardProps,
  type MotivationSectionId,
} from './motivation/GrowthBoard.js';
export {
  HabitStreakList,
  type HabitStreakLabels,
  type HabitStreakListProps,
} from './motivation/HabitStreakList.js';
export {
  IdentityTagList,
  type IdentityTagListLabels,
  type IdentityTagListProps,
} from './motivation/IdentityTagList.js';
export {
  MilestoneMap,
  type MilestoneMapLabels,
  type MilestoneMapProps,
} from './motivation/MilestoneMap.js';
export {
  MotivationProgressBar,
  type MotivationProgressBarProps,
  type MotivationProgressToken,
  type MotivationProgressTone,
} from './motivation/ProgressBar.js';
export {
  ShareSummarySection,
  type ShareSummaryLabels,
  type ShareSummarySectionProps,
} from './motivation/ShareSummarySection.js';
export {
  TodayProgressCard,
  type TodayProgressLabels,
  type TodayProgressCardProps,
} from './motivation/TodayProgressCard.js';
export {
  WeeklyReviewCard,
  type WeeklyReviewLabels,
  type WeeklyReviewCardProps,
} from './motivation/WeeklyReviewCard.js';
export {
  NEAR_MISS_LIMIT,
  SHARE_RESET_MS,
  WEEK_STAT_IDS,
  activityLevel,
  growthHint,
  activityHeatmapTotal,
  isUnplannedOnly,
  milestoneGroups,
  nearMissTags,
  progressPercent,
  progressRatio,
  ratioText,
  reachedTagIds,
  shouldShowTodayBreakdown,
  shouldShowTodayFocus,
  toActivityHeatmapDays,
  toHabitStreakRows,
  weekHeadlineCount,
  weekStatRows,
  type ActivityDayCount,
  type ActivityHeatLevel,
  type ActivityHeatmapDay,
  type GrowthHint,
  type HabitStreakRow,
  type HeadlineKind,
  type MilestoneGroup,
  type MilestoneTier,
  type ShareState,
  type TagNearMiss,
  type WeekStatId,
  type WeekStatRow,
} from './motivation/model.js';

export { TimelineBoard, type TimelineBoardProps } from './timeline/TimelineBoard.js';
export {
  ChecklistPlanPreview,
  type ChecklistPlanLabels,
  type ChecklistPlanPreviewProps,
} from './timeline/ChecklistPlanPreview.js';
export { GanttChart, type GanttChartProps } from './timeline/GanttChart.js';
export {
  BOARD_HEADER_PERCENT,
  TRACK_FRACTION,
  axisTicksForWindow,
  msAtRegionX,
  moveStartMs,
  resizeMinutes,
  boardWindow,
  dueText,
  isAllDayMs,
  isOverdue,
  markerMs,
  percentAt,
  sortRowsForBoard,
  tickText,
  todayPercent,
  type BoardTick,
  type BoardWindow,
  type TimelineScheduleChange,
  type TickGranularity,
  type TimelineBoardLabels,
} from './timeline/board-model.js';
export {
  MAX_AXIS_MARKS,
  MINUTES_PER_DAY,
  MINUTES_PER_HOUR,
  MULTI_DAY_THRESHOLD_MINUTES,
  axisTicks,
  chartSpan,
  dayBands,
  formatClock,
  formatDuration,
  formatRange,
  formatRelativeRange,
  indexByTitle,
  normalizeClock,
  safeLocalDate,
  todayWindow,
  type GanttLabels,
} from './timeline/model.js';

/**
 * ── W8：认证的**失败原因 → 词条 key** 收在这里一份 ──
 *
 * 🔴 **本块是追加的**（`index.ts` 是多写者共享文件，只许在末尾追加）。
 *
 * 收编理由与形状见 `auth/model.ts` 的文件头：这条路此前在
 * `apps/web/src/features/auth/AuthPanel.tsx` 与
 * `apps/mobile/src/auth/failure-key.ts` **各写了一份**，
 * 与仓库此前对"同步失败"做过的收编是**同一个模式**
 * （那份用 `common.sync.error.*`，这份用 `common.auth.error.*`）。
 */
export {
  AUTH_TERMS_REQUIRED_KEY,
  STEPS_WITHOUT_TOKEN,
  authFailureMessageKey,
  hasTokenAfter,
  type AuthFailureMessageKey,
  type AuthJourneyStep,
} from './auth/model.js';

/**
 * ── ⑩-2：子任务的**界面语义**（拒绝原因 → 词条 key）收在这里一份 ──
 *
 * 🔴 **本块是追加的**（`index.ts` 是多写者共享文件，只许在末尾追加）。
 * 形状与 `auth/model.ts` 的 `authFailureMessageKey` 一致：
 * 领域层给封闭集合，这里翻成 key，**句子本身在词条表里**。
 */
export {
  rejectionReasonOf,
  subtaskRejectionMessageKey,
  type SubtaskRejectionMessageKey,
} from './subtasks/model.js';

/**
 * ── 习惯目标的**口径 → 摘要词条 key** 收在这里一份 ──
 *
 * 🔴 **本块是追加的**（`index.ts` 是多写者共享文件，只许在末尾追加）。
 * web 与 mobile 各有一个目标编辑器，而哪种口径说哪句话是同一个判断。
 */
export { habitGoalSummaryKey, type HabitGoalSummaryKey } from './habits/model.js';

/**
 * ── 习惯**清单行**（列表 + 窗格形态里"扫一眼"的那一列）──
 *
 * 🔴 **本块是追加的**（`index.ts` 是多写者共享文件，只许在末尾追加）。
 * 移动端此前没有这一列 —— N 张详情卡直接堆叠，看不到"哪几条今天还没打"。
 *
 * `HABIT_LIST_WEEK_DAYS` 单独导出，不并进 `HABIT_HEATMAP_DAYS`：清单要"扫一眼"
 * （7 天），详情窗格要"看趋势"（90 天）。合成一个常量 = 逼一面放弃自己的读法。
 */
export { HABIT_LIST_WEEK_DAYS } from './habits/model.js';
export {
  HabitProgressList,
  type HabitProgressListLabels,
  type HabitProgressListProps,
} from './habits/HabitProgressList.js';

/**
 * ── W6：认证表单的**共享纯逻辑**（口令这条路）──
 *
 * 🔴 **本块是追加的**（`index.ts` 是多写者共享文件，只许在末尾追加）。
 *
 * 为什么要单独一块而不是并进上面那个 `auth/model.js` 的导出：上面那块是 W8 收编
 * 「失败原因 → key」时开的，形状只有 `authFailureMessageKey` 一个函数；这一块的
 * 判据（策略码、两步、autofill 取值、显隐默认档、两个秘密的命名）都是**邮箱+口令**
 * 这条路带来的，四端要一起用同一份，写在各端 shell 里就是 §3.5 那份漂移的复发。
 */
export {
  AUTH_EMAIL_AUTOCOMPLETE,
  E2EE_PASSPHRASE_LABEL_KEY,
  SIGN_IN_PASSWORD_LABEL_KEY,
  authFormStageAfterContinue,
  defaultPasswordRevealed,
  firstAuthErrorField,
  passwordAutocomplete,
  passwordPolicyMessageKey,
  policyMentionsMax,
  type AuthFormMode,
  type AuthFormField,
  type AuthFormStage,
  type AuthPolicyMessageKey,
} from './auth/model.js';

/**
 * ── W6：认证**表单组件**（§10 欠的组件那一半）──
 *
 * 🔴 **本块是追加的**（`index.ts` 是多写者共享文件，只许在末尾追加）。
 *
 * 上面那块是纯逻辑，这一块是**唯一一份表单**。它存在的理由就是
 * `docs/plans/user-journey-and-auth.md` §10.1 记的那两个数字：web 的
 * `AuthPanel.tsx` 484 行 + mobile 的 `AuthScreen.tsx` 403 行，同一件事两遍。
 * 各端从此只做**宿主壳**（把 store 的状态翻成 `status`/`busy`、把 `t()` 的结果
 * 交进 `labels`、决定条款链接落在哪），**不许**再各写一份字段、显隐开关、
 * autofill 取值与错误落点。
 */
export {
  AuthForm,
  type AuthFormLabels,
  type AuthFormProps,
  type AuthFormStatus,
} from './auth/AuthForm.js';

/**
 * ── W7：失败句子**连同要填的数字**一起交出 ──
 *
 * 🔴 **本块是追加的**（`index.ts` 是多写者共享文件，只许在末尾追加）。
 *
 * 为什么不在上面那块 W6 的导出里加一行：那一块正被别的会话改（同一份
 * `auth/model.ts` 的口令路径），而这里的形状是**这次修 bug 的产物** ——
 * `authFailureMessageKey` 只交 key，带 `{min}`/`{max}`/`{seconds}` 的三条词条
 * 于是有"宿主拿到 key、忘了填数"的空间，web 的两处面板真实漏过。
 * `authFailureMessage` 把两半绑成一次返回，宿主没法只拿一半。
 */
export {
  authFailureMessage,
  type AuthMessageVars,
} from './auth/model.js';

/**
 * ── #10 第 ② 步：任务行上的**清单归属**徽章 ──
 *
 * 🔴 **本块是追加的**（`index.ts` 是多写者共享文件，只许在末尾追加）。
 * 上面那块 projects 导出正被别的会话动（`OrganizerList` 那一族），
 * 在这里追加一行比插进那块更安全。
 *
 * 为什么 `TaskBadges` 已经有 `list` 槽、还要转出这个函数：
 * `TaskBadges` 只认"给了就画"（渲染层不做业务判断），而**"什么算有归属"**
 * （收集箱 / 悬空 id / 空名字都给 `null`）必须只有一份。两端各自
 * `projects.find(...)` 就是两份判断 —— 那正是本次要消除的东西。
 */
export { listNameFor } from './projects/model.js';

/**
 * ── 批一（多端入口覆盖）：四端共用的月历日期选择器 ──
 *
 * 从 mobile 的 `ui/DatePicker.tsx` 上提（web 补 due 事后编辑，两端同一只）。
 * 文案走 `DatePickerLabels` 宿主注入；日期数学走 `@heyta/domain`。
 */
export {
  DatePicker,
  type DatePickerLabels,
  type DatePickerQuickPick,
} from './date-picker/DatePicker.js';

/**
 * ── 批次二 W0：锚点弹层的定位算术 ──
 *
 * 🔴 **本块是追加的**（`index.ts` 是多写者共享文件，只许在末尾追加）。
 *
 * 只转出算术，不转出测量：`packages/ui` 进不来 DOM，而"量触发器与面板的 rect"
 * 与"捕获阶段的 scroll 重算"本来就必须住在每个宿主里（见 `overlay/model.ts` 文件头）。
 */
export {
  placeAnchoredPanel,
  type AnchoredPanelOptions,
  type AnchoredPanelPosition,
  type AnchoredPanelViewport,
  type PanelPlacement,
  type PanelSize,
  type TriggerRect,
} from './overlay/model.js';

/**
 * ── 批次二 W5：倒数日/纪念日板 ──
 *
 * 🔴 **本块是追加的**（`index.ts` 是多写者共享文件，只许在末尾追加）。
 *
 * 转出的是**卡片怎么画、怎么筛、怎么分行**（`countdown/model.ts`）与那张板子本身；
 * 天数、闰月、顺序、归档判定一律留在 `@heyta/domain`，op 的构造留在
 * `@heyta/app-host` —— 这一层转出的是展示，不是判断。
 */
export {
  EventBoard,
  type EventBoardLabels,
  type EventBoardProps,
  type EventEditPatch,
} from './countdown/EventBoard.js';
export {
  COUNTDOWN_FILTERS,
  cardTextsFor,
  countdownFace,
  filterEventCards,
  toEventCards,
  toEventRows,
  type CountdownFace,
  type CountdownFilter,
  type CountdownView,
  type EventCard,
  type EventCardTextLabels,
  type EventCardTexts,
} from './countdown/model.js';
