/**
 * 习惯打卡（共享视图）
 * ======================
 *
 * M3 第七刀的主角：**"一个习惯一张卡：打卡按钮 + 三个连续数字 + 冻结说明
 * + 补打卡/重新开始 + 近 90 天热力图"这件事只有这一个实现。**
 * web 与 mobile 只决定"把它放在页面的哪里"、注入文案，以及挂哪些各端特有的东西。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 为什么需要它（不是"少写点代码"）
 *
 * 迁之前 web 有 `features/habits/HabitsView.tsx`（374 行 DOM/CSS 实现），
 * 而 **mobile 一行都没有** —— 习惯是移动端完全缺失的签名功能（计划 §P8）。
 * 两端各自回答"今天打没打""冻结保住了几天""热力图几档"这些问题的结果是：
 * 同一个 `HabitLog` 在两个端上被读成两个样子，而差异**不会让任何测试变红**。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 连续 / 韧性的配对**由宿主注入**（`growth`），本文件不自己配对
 *
 * `@heyta/app-host#habitGrowth` 的文件头把"两个数字必须用同一份日志、同一个
 * `today` 算出来"写成了硬契约。共享层若在 `model.ts` 里自己调
 * `computeStreak` + `describeHabitResilience`，配对就出现了第二个实现 ——
 * 而 `packages/ui` 不能 import `@heyta/app-host`（那是宿主接线层）。
 * 所以接口是 `growth: HabitGrowthFn`：两端都传 `habitGrowth`，
 * 测试传一个桩。判断层在 `./model.ts`。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 热力图是**自绘**的（RN 原语），不是 `react-activity-calendar`
 *
 * web 迁移前用 `react-activity-calendar`（MIT）画热力图。它是 **DOM 库**，
 * 装进共享层等于让 iOS/鸿蒙去画 DOM —— 与"只用 RN 原语"直接冲突。
 * `docs/plans/multi-platform-adaptation.md` §「已知会卡住的地方」早就把
 * 热力图列成"RN SVG 自绘"的待办，这里兑现的是它 —— 而且**没有用 SVG**：
 * 13 列 × 7 格的方块用 `View` 就够，少一个渲染层。
 *
 * ⚠️ 由此带来的**真实落差（必须让产品负责人知道）**：
 * `react-activity-calendar` 的悬停提示与它的 `title` 属性随之消失。
 * 补回来的方式不是再装一个库，而是沿用 `CategoryReport.tsx` 那条路 ——
 * `cellTooltip` 写 `data-cell-title`，由**宿主 CSS** 的 `::after` 显示
 * （见 `apps/web/src/styles/app.css` 的 `[data-cell-title]`）。web 传它，
 * mobile 没有鼠标就不传（不产出属性）。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 没装进共享层的（逐条写清：证据 + 影响 + 最小一步）
 *
 * 1. **"新建习惯"的输入框留在各端。** web 是 `<form><input>`（要处理
 *    iOS Safari 聚焦缩放：字号必须 ≥16px），mobile 是 kit 的 `TextField`
 *    （自带 44px 字段高、焦点边框、`label`/`placeholder` 分离）。
 *    强行共享会逼其中一个端放弃自己的输入控件规范（那正是 `check:l4` 想
 *    分开的东西）。本组件因此**只管列表**，宿主负责它上面的那个 composer。
 *    · 影响：新增习惯的两处外观不同 —— 但"新增"这件事**没有第二份判断**
 *      （名字空则不做、id 怎么生成、打卡记录 id 的幂等性全在
 *      `@heyta/app-host#createHabitActions`）。
 *    · 最小一步：给 `packages/ui` 加一个 composer（`TextInput` + `Pressable`），
 *      两端把 `onSubmit` 接过去；需要在两个端各做一次截图验收。
 *
 * 2. **取色入口留在各端（经 `renderColorSlot` 插槽）。** 分类色槽位是
 *    「调色板由我们给、含义由用户赋」的落点，web 的 `ColorSlotPicker` 是
 *    DOM 实现（展开一行按钮 + `Esc` 收起），mobile 是 `ui/slot-picker.tsx`
 *    的 radiogroup。两者的**外观与交互不同是刻意的**（鼠标有 hover/Esc，
 *    触摸没有），但"槽位 → 颜色 token"的映射只有一处
 *    （`@heyta/ui` 的 `categorySlotToken`）。不传这个插槽就不渲染取色入口。
 *
 * 3. ~~**删除习惯没有进这一刀。** web 的 store 有 `deleteHabit`，而
 *    `HabitsView.tsx` 从迁移前就没有调用它（`grep` 实测 0 处）——
 *    所以这不是"迁移丢了"，是**它本来就没接上**。影响：习惯建出来就删不掉。
 *    最小一步：在卡片上加一个行尾 `•••`（宿主插槽），或把删除并入
 *    `TaskDetailSheet` 那样的详情层。~~
 *    **（2026-10-03 多端第三批已推翻，留原文是为了让后来者认出"动作层早就有、
 *    界面上零入口"这个形状。）** 现在两端都有入口：web 在详情窗格头部
 *    （`HabitsView.tsx` 调 `store.deleteHabit`），移动端在详情层两个图标 +
 *    内联改名框。**选的正是"并入详情层"那条**，而不是给卡片加 `•••` ——
 *    改名与删除是同一组"这条习惯我不想要了"的动作，放在一处只走一次导航。
 *    所以本组件**仍然只管列表**，这句结构性事实没变，变的只是"删不掉"。
 *    判据：`apps/mobile/tests/organizer-rename.spec.ts` 里那条习惯 describe
 *    （删除是**墓碑**、打卡历史一条不动、撤销后连续天数还在）。
 *
 * 4. **热力图强度只有两档（0 / 4）。** 与 web 迁移前逐字一致；`HabitLog`
 *    有 `value`、`Habit` 有 `target`，所以"打了一半"在数据上存在。
 *    把它画成中间档是**产品改动**，不是这次迁移该顺手做的。最小一步：
 *    先在领域层定分档口径，再改 `model.ts` 的 `habitHeatLevel`。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 文案一律由宿主注入，本文件不 import `@heyta/i18n`
 *
 * 与 `TaskList.tsx` / `CategoryReport.tsx` / `QuadrantBoard.tsx` 同一个理由：
 * i18n 包自己带过一份 React，四端会同时中招（`check:mobile-bundle` 盯着）。
 * 所以 `labels` 里依赖行内容的那几项是函数，模板留在有 i18n 的那一侧。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 只用 RN 原语，不 import 任何 DOM 标签
 *
 * `View` / `Text` / `Pressable` 在 `react-native-web` 上都有等价实现；
 * `<div>` 在 iOS 上不存在。
 */

import React, { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, type ViewProps } from 'react-native';
import type { HeytaNativeTokens } from '@heyta/design-system';
import type { Habit, HabitLog, LocalDate } from '@heyta/domain';
import { Check, Minus, Plus, Undo2 } from 'lucide';
import { HeytaIcon } from '../icon/Icon.js';
import { useHeytaText, useHeytaTokens } from '../theme.js';
import { HabitMetricIcon } from './HabitMetricIcon.js';
import {
  HABIT_HEATMAP_DAYS,
  habitHeatmap,
  hasCountableGoal,
  heatMonthLabelWidths,
  heatmapLevelToken,
  heatmapTotal,
  shouldOfferFreshStart,
  shouldOfferRepair,
  toHabitProgressRows,
  toHeatmapWeeks,
  type HabitGrowthFn,
  type HabitHeatLevel,
} from './model.js';

/**
 * 热力图那一段的全部文案，**每一项都由宿主注入**。
 *
 * `less` / `more` 省略就**不渲染图例整行**；`cellTooltip` 省略就不产出
 * `data-cell-title`（mobile 没有鼠标，理由见文件头）。
 */
export interface HabitHeatmapLabels {
  /** 月份标签（`1`–`12`）。只在"月份变了"的那一列调用，见 `toHeatmapWeeks`。 */
  readonly month: (month: number) => string;
  /** 整块热力图给屏幕阅读器的那一句（含名字、窗口长度、总次数）。 */
  readonly grid: (info: {
    readonly name: string;
    readonly total: number;
    readonly days: number;
  }) => string;
  /** 每一格的确切数字（悬停提示）。省略 = 不产出 `data-cell-title`。 */
  readonly cellTooltip?: (info: { readonly date: LocalDate; readonly count: number }) => string;
  readonly less?: string;
  readonly more?: string;
}

/** 面板全部文案，**每一项都由宿主注入**（见文件头）。 */
export interface HabitBoardLabels {
  /** 未打卡时按钮上的字。 */
  readonly checkIn: string;
  /** 已打卡时按钮上的字。 */
  readonly checkedIn: string;
  /**
   * 打卡按钮的无障碍名。**两个状态是两句不同的话**（"打卡" / "撤销"），
   * 所以是函数而不是"前缀 + 名字"。
   */
  readonly checkInA11y: (info: { readonly name: string; readonly doneToday: boolean }) => string;
  /** 当前连续。`count` 给宿主做单复数分支 —— 词条表没有 ICU。 */
  readonly streakCurrent: (count: number) => string;
  /** 历史最长。 */
  readonly streakLongest: (count: number) => string;
  /** 累计达成天数（生产者 = `resilience.total`，不是打卡次数）。 */
  readonly streakTotal: (count: number) => string;
  /**
   * 本月打卡天数（工单 W8；生产者 = `month.achievedDays`，口径 = **天**不是次）。
   * `count` 给宿主做单复数分支的余地（词条表没有 ICU，与上面三个同一个形状）。
   */
  readonly monthDays: (count: number) => string;
  /**
   * 本月完成率（整数百分比，生产者 = `Math.round(month.rate * 100)`，四舍五入
   * 在共享层做一次，两端不许各写一遍）。
   * 🔴 **只在 `month.scheduledDays > 0` 时被调用** —— 分母为 0 时"没有率可言"
   * 是裁决，不是数据缺失，界面必须走 {@link monthRatePending} 而不是 "0%"。
   */
  readonly monthRate: (percent: number) => string;
  /** 分母为 0 时的占位句（"本月还没有到期的计划日"）。静态文案，无参数。 */
  readonly monthRatePending: string;
  /**
   * 本月完成量（生产者 = `month.monthValue`，含未达标的那天的量）。
   *
   * `unit` 与 {@link amount} 同一个约定：**去掉空白后的 `habit.unit`，空串 = 没有单位**。
   * 有单位走 `本月完成量 {value} {unit}`，没有单位退化成不带单位的句子
   * （裁决 D：`unit` 只做显示，求和按纯数，不新建量纲封闭词表）。
   */
  readonly monthValue: (info: {
    readonly value: number;
    readonly unit: string;
  }) => string;
  /** 历史总完成量（生产者 = `month.totalValue`，**不限当月**）。形状同 {@link monthValue}。 */
  readonly totalValue: (info: {
    readonly value: number;
    readonly unit: string;
  }) => string;
  /**
   * 今天记了几格（工单 W6）。只在 {@link hasCountableGoal} 为真时调用。
   *
   * `unit` 是**去掉空白后的**那个字（`habit.unit`），空串表示习惯没有单位 ——
   * 补一个通用的「次」是**文案**的事，所以由宿主在这个函数里用
   * `web.habits.goal.defaultUnit` 那条词条兜底（与目标摘要同一个 fallback）。
   * 共享层不猜：猜出来的"次"对"每天 30 分钟"是错的。
   */
  readonly amount: (info: {
    readonly value: number;
    readonly target: number;
    readonly unit: string;
  }) => string;
  /** 「+」按钮的无障碍名。刻意**不是可见文案**（按钮只有图标，见下面那一块）。 */
  readonly amountPlusA11y: (info: { readonly name: string }) => string;
  /** 「−」按钮的无障碍名。 */
  readonly amountMinusA11y: (info: { readonly name: string }) => string;
  /** 冻结说明（"这段连续里有 N 天是冻结保住的"）。只在冻结数 > 0 时调用。 */
  readonly freeze: (count: number) => string;
  /** 补打卡提示（"某天漏了，补上就是连续 N 天"）。 */
  readonly repair: (info: { readonly date: LocalDate; readonly count: number }) => string;
  readonly repairAction: string;
  readonly repairA11y: (info: { readonly date: LocalDate; readonly name: string }) => string;
  /** 重新开始提示（"已经 N 天没打卡了；最长 / 累计都还在"）。 */
  readonly freshStart: (info: {
    readonly days: number;
    readonly longest: number;
    readonly total: number;
  }) => string;
  readonly freshStartAction: string;
  readonly freshStartA11y: (name: string) => string;
  /** 一个习惯都没有时显示什么。 */
  readonly empty: string;
  readonly heatmap: HabitHeatmapLabels;
}

export interface HabitBoardProps {
  /** 未删除的习惯（由宿主从 action 层取，`listHabits()` 已经是）。 */
  readonly habits: readonly Habit[];
  /** 未删除的打卡记录（`listLogs()` 已经是）。 */
  readonly logs: readonly HabitLog[];
  /** 当前时间（epoch ms）。显式传入，否则跨午夜与测试都不可复现。 */
  readonly now: number;
  /**
   * 连续 + 韧性的配对函数。**两端都传 `@heyta/app-host#habitGrowth`**
   * —— 这里是"配对只有一份实现"的落点（见文件头）。
   */
  readonly growth: HabitGrowthFn;
  readonly labels: HabitBoardLabels;
  /**
   * 打卡。**不要在组件内部改数据** —— 变更必须走宿主的 action 层。
   *
   * 🔴 两个调用点带的参数**不一样**，这不是疏忽而是 W6 的判据 ②：
   *   · 主按钮（"打卡"）**一个额外参数都不带** ⇒ 记的量落回 `habit.target ?? 1`，
   *     与加了数量行之前的行为逐字相同。老宿主只读第一个参数也不会漏掉什么。
   *   · 「+」带**明确的数值**（今天已有的格数 + 1）⇒ 计数型习惯第一次在界面上可达。
   *
   * ⚠️ 数值通道到这里为止都是**可选**的：宿主不接第三个参数，数量行照样画，
   * 但「+」点下去什么都不记 —— 所以两个宿主都必须把它透传给 `checkIn(habitId, date, value)`。
   * 这条由 `apps/web/tests/habits-board.spec.tsx` 的 F 组与 E 组的源码判据盯住。
   */
  readonly onCheckIn: (habitId: string, date?: LocalDate, value?: number) => void;
  /** 撤销打卡。 */
  readonly onUndoCheckIn: (habitId: string, date?: LocalDate) => void;
  /** 正在处理中的习惯 id —— 用于置灰它的按钮，避免连点发出两条 op。 */
  readonly busyHabitId?: string | null;
  /** 取色入口（web 是 `ColorSlotPicker`，mobile 是 `ui/slot-picker`）。不传就不渲染。 */
  readonly renderColorSlot?: (habit: Habit) => React.ReactNode;
  /**
   * **目标编辑入口**（数值 / 单位 / 达成口径）。不传就不渲染。
   *
   * 🔴 与 `renderColorSlot` 同一个形状，理由也同一条：**编辑控件留在各端**，
   * 共享层只负责"把这个位置让出来"。
   *
   * 为什么需要它：`Habit` 有 `target` / `unit` / `goalType`，`isAchieved`
   * 把三种口径都实现了，**但界面上一直没有任何地方能改** ——
   * 计数型（"每天 8 杯水"）与时长型（"每天 30 分钟"）到不了用户手里，
   * 而界面上看不出缺了什么（默认 `target: 1` / `atLeast` 长得很正常）。
   */
  readonly renderGoalSlot?: (habit: Habit) => React.ReactNode;
  /** 热力图窗口（天）。默认 {@link HABIT_HEATMAP_DAYS}。 */
  readonly heatmapDays?: number;
  readonly testID?: string;
}

/**
 * 把提示文案变成 `data-cell-title` 属性（不给就返回空对象）。
 *
 * ⚠️ **为什么必须 cast**：`dataSet` 是 **react-native-web 专有**的 prop，
 * `react-native` 自己的 `ViewProps` 里没有它 —— 不 cast 过不了 TS。
 * 与 `categories/CategoryReport.tsx` 的 `dataCellTitle` 逐字同一个理由与写法。
 */
function dataCellTitle(value: string | undefined): ViewProps {
  return value === undefined
    ? {}
    : ({ dataSet: { cellTitle: value } } as unknown as ViewProps);
}

/** 取一份 token 表，建出这套样式。**一个裸值都没有**（`check:design` 会拦）。 */
function makeStyles(tokens: HeytaNativeTokens) {
  return StyleSheet.create({
    board: {
      gap: tokens['space.3'],
    },
    card: {
      gap: tokens['space.3'],
      padding: tokens['space.3'],
      borderRadius: tokens['radius.lg'],
      backgroundColor: tokens['color.surface'],
    },
    headerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: tokens['space.3'],
    },
    nameWrap: {
      flex: 1,
    },
    nameRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: tokens['space.2'],
    },
    name: {
      // 长习惯名换行而不是把打卡按钮挤出屏幕：`flexShrink` 让它在
      // 名字行里让位，而不是撑破整张卡。
      flexShrink: 1,
    },
    /** 三个数字**在句子里**（英文语序要求如此），所以等宽给在整行上。 */
    metrics: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      alignItems: 'center',
      gap: tokens['space.3'],
      marginTop: tokens['space.1'],
    },
    metric: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: tokens['space.1'],
    },
    /**
     * 三个数字在**句子里**（英文语序要求如此），所以等宽给在承载它们的
     * `Text` 上，而不是给某个 `span`。RN 的写法是 `fontVariant`。
     */
    numeric: {
      fontVariant: ['tabular-nums'],
    },
    freeze: {
      marginTop: tokens['space.1'],
    },
    /**
     * 数量行（工单 W6）：`− 今天 5/8 杯 +`。
     *
     * 🔴 字号取 `caption` 而不是 `row-title`（在组件里由 `text.caption` 给）：
     * 它是**读数**，与那三个连续数字同一档；把它放大到名字那一档，
     * 一张卡里就出现两个标题（AGENTS §5 的文字层级）。
     */
    amountRow: {
      flexDirection: 'row',
      alignItems: 'center',
      alignSelf: 'flex-start',
      gap: tokens['space.2'],
      marginTop: tokens['space.2'],
    },
    /**
     * 步进按钮。**方形、触控尺寸、不填色**：
     * 填色会和主打卡按钮抢"哪个才是打卡"这个信号（`checkinOn` 才是填色的那个）。
     */
    stepButton: {
      width: tokens['touch-target.min'],
      height: tokens['touch-target.min'],
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: tokens['radius.md'],
      backgroundColor: 'transparent',
    },
    /** 补打卡 / 重新开始：与上面的指标区用留白分开。 */
    action: {
      gap: tokens['space.2'],
      paddingTop: tokens['space.2'],
    },
    checkin: {
      minWidth: tokens['touch-target.min'],
      minHeight: tokens['touch-target.min'],
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: tokens['space.1'],
      paddingHorizontal: tokens['space.3'],
      borderRadius: tokens['radius.md'],
    },
    checkinOn: {
      backgroundColor: tokens['color.primary'],
    },
    checkinOff: {
      backgroundColor: 'transparent',
    },
    checkinOnText: {
      color: tokens['color.on-primary'],
    },
    checkinOffText: {
      color: tokens['color.foreground'],
    },
    actionButton: {
      minHeight: tokens['touch-target.min'],
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: tokens['space.1'],
      paddingHorizontal: tokens['space.3'],
      borderRadius: tokens['radius.md'],
      backgroundColor: 'transparent',
      alignSelf: 'flex-start',
    },
    /** 忙时置灰整张卡的按钮 —— 用 token 的不透明度，不写死数字。 */
    busy: {
      opacity: tokens['state.disabled-opacity'],
    },
    heat: {
      gap: tokens['space.1'],
    },
    heatMonths: {
      flexDirection: 'row',
      gap: tokens['space.1'],
    },
    /**
     * 月份标签那一格**不在这里写宽度**：宽度 = 它标注的那几周（下界两列），
     * 由 `heatMonthLabelWidths` 按调用方传进来的 `cell`/`gap` 算出来。
     * 原先这里是 `width: tokens['icon.xs']`（现量 14px），而标签是「7月」「10月」这种 2–3 枚字形
     * ⇒ **每一枚都折成两行**（工单 H8，看图照出来的）。
     */
    heatMonthCell: {
      /* `flexShrink: 0`：那一排的总宽可以比容器宽（末列那种"两列下界"的标签会溢出），
         但**绝不被压回去** —— 压回去就是又折行，H8 那一族的原病。 */
      flexShrink: 0,
    },
    heatGrid: {
      flexDirection: 'row',
      gap: tokens['space.1'],
    },
    heatWeek: {
      flexDirection: 'column',
      gap: tokens['space.1'],
    },
    heatCell: {
      width: tokens['icon.xs'],
      height: tokens['icon.xs'],
      borderRadius: tokens['radius.sm'],
    },
    heatLegend: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: tokens['space.1'],
    },
    legendCell: {
      width: tokens['space.3'],
      height: tokens['space.3'],
      borderRadius: tokens['radius.sm'],
    },
  });
}

/** 一格。抽出来是为了让网格那段代码只回答"怎么排"。 */
function HeatCell({
  style,
  tooltip,
}: {
  style: ViewProps['style'];
  tooltip: string | undefined;
}): React.JSX.Element {
  return (
    <View
      style={style}
      // 格子本身对读屏是装饰性的：整块热力图有一句总述（`labels.heatmap.grid`），
      // 90 个格子的逐条读数只会把信息埋掉。
      accessible={false}
      {...dataCellTitle(tooltip)}
    />
  );
}

export function HabitBoard({
  habits,
  logs,
  now,
  growth,
  labels,
  onCheckIn,
  onUndoCheckIn,
  busyHabitId,
  renderColorSlot,
  renderGoalSlot,
  heatmapDays = HABIT_HEATMAP_DAYS,
  testID,
}: HabitBoardProps): React.JSX.Element {
  const tokens = useHeytaTokens();
  const text = useHeytaText();

  // 进度与热力图全部由 `./model.ts` 的纯函数算出来，这里只负责摆。
  const rows = useMemo(
    () => toHabitProgressRows(habits, logs, now, growth),
    [habits, logs, now, growth],
  );
  const styles = useMemo(() => makeStyles(tokens), [tokens]);

  if (rows.length === 0) {
    return (
      <View testID={testID}>
        <Text style={[text.caption, { color: tokens['color.foreground-muted'] }]}>
          {labels.empty}
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.board} testID={testID}>
      {rows.map((row) => {
        const r = row.resilience.resilience;
        const { repair, freshStart } = row.resilience;
        const busy = busyHabitId === row.habit.id;
        const heatmap = habitHeatmap(logs, row.habit.id, now, heatmapDays);
        const weeks = toHeatmapWeeks(heatmap);
        // 标签宽度 = 它跨过的那几列（下界两列），算法在 `heatMonthLabelWidths`（工单 H8）。
        const labelWidths = heatMonthLabelWidths(weeks, tokens['icon.xs'], tokens['space.1']);
        const total = heatmapTotal(heatmap);
        const { less, more } = labels.heatmap;

        return (
          <View key={row.habit.id} style={styles.card} testID={`habit-card-${row.habit.id}`}>
            <View style={styles.headerRow}>
              <View style={styles.nameWrap}>
                <View style={styles.nameRow}>
                  <Text style={[text['row-title'], styles.name]} numberOfLines={1}>
                    {row.habit.name}
                  </Text>
                  {/*
                    取色入口由宿主注入（见文件头第 2 条）。它决定这个习惯在
                    「成长 → 分类时长」里那一行的颜色；没设也能显示，只是没有颜色。
                  */}
                  {renderColorSlot === undefined ? null : renderColorSlot(row.habit)}
                </View>

                {/*
                  三指标**并存**：当前连续 / 历史最长 / 累计。
                  🔴 「累计」是唯一只增不减、且不被任何中断影响的数字 ——
                  断链那天用户最需要看见它，所以它必须常驻。
                  ⚠️ 前两个走的是**韧性口径**（`r`），不是日历口径的 `row.streak`；
                  两个"连续"数字**永远不能相减**（ADR-0022）。

                  工单 W8 在这排后面**追加**四格（本月打卡 / 本月完成率 /
                  本月完成量 / 总完成量）—— 同一套 `styles.metrics`/`styles.metric`
                  样式、同一处渲染，所以 web 与移动端两端一起吃到。
                  "总打卡天数"那一格**不重复加**：它 = 上面的「累计」
                  （`month.totalAchievedDays` 与 `resilience.total` 同口径，
                  domain 侧注释写明了这一等式，app-host 的判据钉住它）。
                  四格的存在性判据见 `apps/web/tests/habits-board.spec.tsx` 的 W8 组
                  （§7 第 82 条同族的教训：断言要写成**存在性**，"少了一格"才抓得住）。
                */}
                <View style={styles.metrics}>
                  <View style={styles.metric}>
                    <HabitMetricIcon kind="streak" size={tokens['font-size.xs']} />
                    <Text
                      style={[
                        text.caption,
                        styles.numeric,
                        { color: tokens['color.foreground-muted'] },
                      ]}
                    >
                      {labels.streakCurrent(r.current)}
                    </Text>
                  </View>
                  <View style={styles.metric}>
                    <HabitMetricIcon kind="best" size={tokens['font-size.xs']} />
                    <Text
                    style={[
                      text.caption,
                      styles.numeric,
                      { color: tokens['color.foreground-muted'] },
                    ]}
                  >
                    {labels.streakLongest(r.longest)}
                    </Text>
                  </View>
                  <View style={styles.metric}>
                    <HabitMetricIcon kind="total" size={tokens['font-size.xs']} />
                    <Text
                    style={[
                      text.caption,
                      styles.numeric,
                      { color: tokens['color.foreground-muted'] },
                    ]}
                  >
                    {labels.streakTotal(r.total)}
                    </Text>
                  </View>
                  <View style={styles.metric}>
                    <HabitMetricIcon kind="month" size={tokens['font-size.xs']} />
                    <Text
                    style={[
                      text.caption,
                      styles.numeric,
                      { color: tokens['color.foreground-muted'] },
                    ]}
                    testID={`habit-month-days-${row.habit.id}`}
                  >
                    {labels.monthDays(row.month.achievedDays)}
                    </Text>
                  </View>
                  <View style={styles.metric}>
                    <HabitMetricIcon kind="rate" size={tokens['font-size.xs']} />
                    <Text
                    style={[
                      text.caption,
                      styles.numeric,
                      { color: tokens['color.foreground-muted'] },
                    ]}
                    testID={`habit-month-rate-${row.habit.id}`}
                  >
                    {/*
                      🔴 分母为 0 走占位句而不是 "0%"（W8 裁决：那时**没有率可言**，
                      给 0% 是把"还没到期"说成"一个都没完成"——制造愧疚的形状）。
                      四舍五入只在这里做一次，两端的宿主不许各自再算。
                    */}
                    {row.month.scheduledDays === 0
                      ? labels.monthRatePending
                      : labels.monthRate(Math.round(row.month.rate * 100))}
                    </Text>
                  </View>
                  <View style={styles.metric}>
                    <HabitMetricIcon kind="journal" size={tokens['font-size.xs']} />
                    <Text
                    style={[
                      text.caption,
                      styles.numeric,
                      { color: tokens['color.foreground-muted'] },
                    ]}
                    testID={`habit-month-value-${row.habit.id}`}
                  >
                    {labels.monthValue({
                      value: row.month.monthValue,
                      unit: (row.habit.unit ?? '').trim(),
                    })}
                    </Text>
                  </View>
                  <View style={styles.metric}>
                    <HabitMetricIcon kind="calendar" size={tokens['font-size.xs']} />
                    <Text
                    style={[
                      text.caption,
                      styles.numeric,
                      { color: tokens['color.foreground-muted'] },
                    ]}
                    testID={`habit-total-value-${row.habit.id}`}
                  >
                    {labels.totalValue({
                      value: row.month.totalValue,
                      unit: (row.habit.unit ?? '').trim(),
                    })}
                    </Text>
                  </View>
                </View>

                {/*
                  🔴 目标编辑入口。放在指标块**之后**：目标与那几个数字是一组语义
                  （"每天 8 杯"是口径，"连续 3 天"是这个口径下的结果），
                  放到别处会被读成两件无关的事。
                */}
                {renderGoalSlot === undefined ? null : renderGoalSlot(row.habit)}

                {/*
                  🔴 数量行（工单 W6）：`HabitLog.value` 第一次在界面上**既可读也可写**。
                  在此之前 `checkIn` 收 `value`、reducer 物化 `value`、`isAchieved`
                  按 `value` 判达成，`upsert_habit_checkins` 那类工具也能传 ——
                  唯独没有一个人能从界面写出 5，于是"目标 8 页"的习惯只能一键记 8，
                  而界面上看不出这是缺功能（它长得和"做完了"一模一样）。

                  **放在目标编辑器之后、冻结说明之前**：它说的是**今天这一格**，
                  与"每天 8 杯"（口径）相邻、在"连续 3 天"（历史）之后；
                  放进热力图那一段会被读成历史读数。

                  ⚠️ 只给 {@link hasCountableGoal} 为真的习惯：一条"每天做一次"的习惯
                  多出一行「1/1」是噪声，而那也正是本次改动**不动**老习惯的理由
                  （老数据的 DOM 一个字节都不变）。

                  🔴 两个按钮带的参数**不一样**是有意的（见 `onCheckIn` 的注释）：
                  「+」明确带数值，主打卡按钮一个都不带。
                  「−」减到 0 时调的是 `onUndoCheckIn` —— "今天没做"是一条墓碑，
                  不是一条值为 0 的记录（动作层会直接抛）。
                */}
                {hasCountableGoal(row.habit) ? (
                  <View style={styles.amountRow} testID={`habit-amount-${row.habit.id}`}>
                    <Pressable
                      onPress={() => {
                        // 减到 **≤ 0** 走撤销打卡，不是发一条值为 0 的 op（动作层会抛），
                        // 也不发一个负数。写成 `<= 0` 而不是 `=== 1` 是因为
                        // `target` 可以是小数（"每天 0.5 小时"是合法目标，
                        // `setHabitGoal` 只拦负数与非有限数）—— 那时 0.5 − 1 是负数。
                        const next = row.todayValue - 1;
                        if (next <= 0) {
                          onUndoCheckIn(row.habit.id);
                          return;
                        }
                        onCheckIn(row.habit.id, undefined, next);
                      }}
                      // 🔴 减到 0 **不是**一个数值，而是"今天没做" ⇒ 没有记录时
                      //    这个按钮没有可减的东西，置灰而不是让它去发 `DEL`。
                      disabled={busy || row.todayValue <= 0}
                      testID={`habit-amount-minus-${row.habit.id}`}
                      accessibilityRole="button"
                      aria-disabled={busy || row.todayValue <= 0}
                      accessibilityLabel={labels.amountMinusA11y({ name: row.habit.name })}
                      style={[styles.stepButton, busy ? styles.busy : null]}
                    >
                      <HeytaIcon
                        data={Minus}
                        size={tokens['font-size.sm']}
                        color={tokens['color.foreground']}
                      />
                    </Pressable>

                    {/*
                      数字本身**常驻**，不只在编辑时出现 —— "记了多少"是这一格的
                      读数，与那三个连续数字同级；只在面板里出现就会变成
                      "点了才知道今天记了几格"。
                    */}
                    <Text
                      style={[
                        text.caption,
                        styles.numeric,
                        { color: tokens['color.foreground'] },
                      ]}
                      testID={`habit-amount-text-${row.habit.id}`}
                      accessibilityLiveRegion="polite"
                    >
                      {labels.amount({
                        value: row.todayValue,
                        target: row.habit.target ?? 1,
                        unit: (row.habit.unit ?? '').trim(),
                      })}
                    </Text>

                    <Pressable
                      onPress={() => {
                        onCheckIn(row.habit.id, undefined, row.todayValue + 1);
                      }}
                      disabled={busy}
                      testID={`habit-amount-plus-${row.habit.id}`}
                      accessibilityRole="button"
                      aria-disabled={busy}
                      accessibilityLabel={labels.amountPlusA11y({ name: row.habit.name })}
                      style={[styles.stepButton, busy ? styles.busy : null]}
                    >
                      <HeytaIcon
                        data={Plus}
                        size={tokens['font-size.sm']}
                        color={tokens['color.foreground']}
                      />
                    </Pressable>
                  </View>
                ) : null}

                {/*
                  冻结**必须明说**：悄悄替用户吸收一次中断会偷走他对规则的理解。
                  显示的**不是余额**（ADR-0022 决定余额不上界面）：说的是
                  "它刚刚替你保住了什么"。
                */}
                {r.frozenInCurrentRun > 0 ? (
                  <Text
                    style={[
                      text.caption,
                      styles.numeric,
                      styles.freeze,
                      { color: tokens['color.foreground-muted'] },
                    ]}
                  >
                    {labels.freeze(r.frozenInCurrentRun)}
                  </Text>
                ) : null}
              </View>

              <Pressable
                onPress={() => {
                  if (row.doneToday) onUndoCheckIn(row.habit.id);
                  else onCheckIn(row.habit.id);
                }}
                disabled={busy}
                testID={`habit-checkin-${row.habit.id}`}
                accessibilityRole="button"
                aria-pressed={row.doneToday}
        // 🔴 用**平铺** `aria-*`，不要用对象形态 `accessibilityState` / `accessibilityValue`：
        // RNW 0.21 会把对象形态**整个丢掉**（实测 `aria-checked` / `aria-valuenow` 都不出现），
        // 而 RN 0.71+ 两端都认平铺形态。判据见 `pnpm check:rn-aria`。
                aria-disabled={busy}
                accessibilityLabel={labels.checkInA11y({
                  name: row.habit.name,
                  doneToday: row.doneToday,
                })}
                style={[
                  styles.checkin,
                  row.doneToday ? styles.checkinOn : styles.checkinOff,
                  busy ? styles.busy : null,
                ]}
              >
                {/*
                  🔴 未打卡时是 `Plus`，不是 `Undo2`（一个回退箭头）——
                  后者是"撤销"的意思，挂在"去打卡"上语义正好反了。
                  改成 `Plus` 之后两个状态的差别也不只靠颜色：字形本身就不同。
                */}
                {row.doneToday ? (
                  <HeytaIcon
                    data={Check}
                    size={tokens['font-size.sm']}
                    color={tokens['color.on-primary']}
                  />
                ) : (
                  <HeytaIcon
                    data={Plus}
                    size={tokens['font-size.sm']}
                    color={tokens['color.foreground']}
                  />
                )}
                <Text
                  style={[
                    text.caption,
                    row.doneToday ? styles.checkinOnText : styles.checkinOffText,
                  ]}
                >
                  {row.doneToday ? labels.checkedIn : labels.checkIn}
                </Text>
              </Pressable>
            </View>

            {/*
              续接（"绝不错过两次"）。
              🔴 **先给数字，再给按钮**：先说"补上就是连续 21 天"给的是承诺，
              反过来读起来是"你该做点什么"。
              🔴 只在领域层给出 `repair` 时才出现（`streakIfRepaired ≥ 2`）。
            */}
            {shouldOfferRepair(row.resilience) && repair !== undefined ? (
              <View style={styles.action}>
                <Text style={[text.caption, { color: tokens['color.foreground-muted'] }]}>
                  {labels.repair({ date: repair.date, count: repair.streakIfRepaired })}
                </Text>
                <Pressable
                  onPress={() => {
                    onCheckIn(row.habit.id, repair.date);
                  }}
                  disabled={busy}
                  testID={`habit-repair-${row.habit.id}`}
                  accessibilityRole="button"
                  accessibilityLabel={labels.repairA11y({
                    date: repair.date,
                    name: row.habit.name,
                  })}
                  style={[styles.actionButton, busy ? styles.busy : null]}
                >
                  <HeytaIcon
                    data={Undo2}
                    size={tokens['font-size.xs']}
                    color={tokens['color.foreground']}
                  />
                  <Text style={[text.caption, { color: tokens['color.foreground'] }]}>
                    {labels.repairAction}
                  </Text>
                </Pressable>
              </View>
            ) : null}

            {/*
              重新开始（新鲜开始效应）。
              🔴 **不能**出现"你已经落后了"这类措辞；文案里必须明确
              "过去那些天没有被清掉"（模板在宿主侧）。
            */}
            {shouldOfferFreshStart(row.resilience) && freshStart !== undefined ? (
              <View style={styles.action}>
                <Text style={[text.caption, { color: tokens['color.foreground-muted'] }]}>
                  {labels.freshStart({
                    days: freshStart.daysSinceLast,
                    longest: freshStart.longest,
                    total: freshStart.total,
                  })}
                </Text>
                <Pressable
                  onPress={() => {
                    onCheckIn(row.habit.id);
                  }}
                  disabled={busy}
                  testID={`habit-freshstart-${row.habit.id}`}
                  accessibilityRole="button"
                  accessibilityLabel={labels.freshStartA11y(row.habit.name)}
                  style={[styles.actionButton, busy ? styles.busy : null]}
                >
                  <Text style={[text.caption, { color: tokens['color.foreground'] }]}>
                    {labels.freshStartAction}
                  </Text>
                </Pressable>
              </View>
            ) : null}

            <ScrollView horizontal testID={`${testID}-heat-scroll`}>
            <View style={styles.heat} testID={`${testID}-heat`}>
              {/* 月份标签与格子**同一套列宽**，否则标签会与它标注的那一列错开。
                  兑现这句话的方式不是把标签压成一列宽（那会折成两行，工单 H8），
                  而是**让标签跨过它标注的那几周**：宽度 = `span × 格宽 + (span−1) × 空隙`，
                  `span` 由 `heatMonthSpans(weeks)` 从同一份列数据数出来。 */}
              <View
                style={styles.heatMonths}
                testID={`${testID}-heat-months`}
                accessible
                accessibilityLabel={labels.heatmap.grid({
                  name: row.habit.name,
                  total,
                  days: heatmapDays,
                })}
              >
                {weeks.flatMap((week, index) => {
                  const width = labelWidths[index] ?? 0;
                  const month = week.month;
                  if (width === 0 || month === undefined) return [];
                  return [
                    <View
                      key={`m-${String(index)}`}
                      testID={`${testID}-heat-month-${String(index)}`}
                      style={[styles.heatMonthCell, { width }]}
                    >
                      <Text style={[text.caption, { color: tokens['color.foreground-muted'] }]}>
                        {labels.heatmap.month(month)}
                      </Text>
                    </View>,
                  ];
                })}
              </View>

              <View style={styles.heatGrid} testID={`${testID}-heat-grid`}>
                {weeks.map((week, weekIndex) => (
                  <View
                    key={`w-${String(weekIndex)}`}
                    testID={`${testID}-heat-week-${String(weekIndex)}`}
                    style={styles.heatWeek}
                  >
                    {week.days.map((day, dayIndex) =>
                      day === null ? (
                        <View key={`e-${String(dayIndex)}`} style={styles.heatCell} />
                      ) : (
                        <HeatCell
                          key={day.date}
                          style={[
                            styles.heatCell,
                            { backgroundColor: tokens[heatmapLevelToken(day.level)] },
                          ]}
                          tooltip={
                            labels.heatmap.cellTooltip === undefined
                              ? undefined
                              : labels.heatmap.cellTooltip({ date: day.date, count: day.count })
                          }
                        />
                      ),
                    )}
                  </View>
                ))}
              </View>

              {/*
                图例（少 → 多）。两端的文案都来自词条表；省略就不渲染整行。
                🔴 它与格子用**同一个**「档位 → heat token」映射，
                不另抄一份色阶（抄一份就会在改色时只改一处）。
              */}
              {less === undefined || more === undefined ? null : (
                <View style={styles.heatLegend}>
                  <Text style={[text.caption, { color: tokens['color.foreground-muted'] }]}>
                    {less}
                  </Text>
                  {([0, 1, 2, 3, 4] as readonly HabitHeatLevel[]).map((level) => (
                    <View
                      key={`legend-${String(level)}`}
                      style={[
                        styles.legendCell,
                        { backgroundColor: tokens[heatmapLevelToken(level)] },
                      ]}
                    />
                  ))}
                  <Text style={[text.caption, { color: tokens['color.foreground-muted'] }]}>
                    {more}
                  </Text>
                </View>
              )}
            </View>
            </ScrollView>
          </View>
        );
      })}
    </View>
  );
}
