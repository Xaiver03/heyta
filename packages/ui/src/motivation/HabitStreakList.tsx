/**
 * 连续性（共享视图，L2）
 * ========================
 *
 * 「为了一个目标持续做下去」的连续性层：每个习惯的**当前连续 / 历史最长 /
 * 累计达成天数**，外加两条衔接提示（"昨天还能补回来" / "重新开始"）。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 这一块是 mobile **独有**的能力，web 迁移前没有
 *
 * `apps/mobile/src/screens/GrowthScreen.tsx` 从第 269 行起有完整的 L2 区块
 * （`data.habits.map(...)`，共 58 行）；而 web 的 `GrowthView.tsx` 里
 * **一行都没有** —— 它只有周复盘 / 年度热力 / 里程碑 / 身份标签。
 * 所以这一刀不是"迁完移动端白拿"，是把**手机端已有的能力补进共享层**，
 * 让 web 也能用同一份（web 是否放它到成长页由 web 那一刀决定，不是这里）。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 连续 / 韧性的配对**由宿主注入**（`growth`），本文件不自己配对
 *
 * `@heyta/app-host#habitGrowth` 的文件头把"两个数字必须用同一份日志、
 * 同一个 `today` 算出来"写成了硬契约。共享层若在这里自己调 `computeStreak`
 * 就会让配对出现第二个实现 —— 与 `habits/HabitBoard.tsx` **同一个手法**
 * （照抄那个模式），测试传一个桩。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 排版上的一条产品红线（写在这里，因为这是改 UI 时最容易丢的）
 *
 * **中断之后屏幕上一定有三个没变小的数字**，而且"历史最长 / 累计"就在
 * "当前连续"旁边。这是"中断不等于失去"在排版上的实现方式，不是一句安慰文案。
 * 所以这里**不允许**把 longest / total 藏进折叠区，也不允许把它们画成灰色小字
 * 之外的样子 —— 它们与 current 同级。
 *
 * ⚠️ 三个数字走的是**韧性口径**（`resilience.resilience.current/longest/total`），
 * 不是日历口径的 `streak`。两个"连续"数字**永远不能相减**（ADR-0022）。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 文案一律由宿主注入（理由见 `TodayProgressCard`）；本文件不 import `@heyta/i18n`
 * 🔴 只用 RN 原语（`View` / `Text` / `Pressable` / `StyleSheet`）
 */

import React, { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { HeytaNativeTokens } from '@heyta/design-system';
import type { Habit, HabitLog, LocalDate } from '@heyta/domain';
import { useHeytaText, useHeytaTokens } from '../theme.js';
import {
  frozenDays,
  shouldOfferFreshStart,
  shouldOfferRepair,
  type HabitGrowthFn,
} from '../habits/model.js';
import { toHabitStreakRows } from './model.js';

/** 面板全部文案，**每一项都由宿主注入**（见文件头）。 */
export interface HabitStreakLabels {
  /** 一个习惯都没有时显示什么。 */
  readonly empty: string;
  /** "当前连续"这个标签（数字在它旁边，字号更大）。 */
  readonly current: string;
  readonly longest: (count: number) => string;
  readonly total: (count: number) => string;
  /** 冻结说明（"这段连续里有 N 天是冻结保住的"）。省略 = 不渲染那一行。 */
  readonly freeze?: (count: number) => string;
  /** 补打卡提示（"昨天还能补回来——补完是 N 天"）。 */
  readonly repair: (info: { readonly date: LocalDate; readonly count: number }) => string;
  /** 补打卡按钮上的字。省略 = 不给按钮，只给提示文字。 */
  readonly repairAction?: string;
  readonly repairA11y?: (info: { readonly date: LocalDate; readonly name: string }) => string;
  /** 重新开始提示（"已经 N 天没做了；最长 / 累计都还在"）。 */
  readonly freshStart: (info: {
    readonly days: number;
    readonly longest: number;
    readonly total: number;
  }) => string;
  readonly freshStartAction?: string;
  readonly freshStartA11y?: (name: string) => string;
  readonly a11yHabit: (name: string) => string;
}

export interface HabitStreakListProps {
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
  readonly labels: HabitStreakLabels;
  /**
   * 补打卡。**不要在组件内部改数据** —— 变更必须走宿主的 action 层。
   * 省略 = 只显示提示文字（mobile 迁移前就是这样）。
   */
  readonly onRepair?: (habitId: string, date: LocalDate) => void;
  /** 重新开始。省略 = 只显示提示文字。 */
  readonly onFreshStart?: (habitId: string) => void;
  /** 正在处理中的习惯 id —— 用于置灰它的按钮，避免连点发出两条 op。 */
  readonly busyHabitId?: string | null;
  readonly testID?: string;
}

/** 取一份 token 表，建出这套样式。**一个裸值都没有**（`check:design` 会拦）。 */
function makeStyles(tokens: HeytaNativeTokens) {
  return StyleSheet.create({
    list: {
      gap: tokens['space.3'],
    },
    card: {
      gap: tokens['space.2'],
      padding: tokens['space.3'],
      borderRadius: tokens['radius.lg'],
      backgroundColor: tokens['color.surface'],
      borderWidth: tokens['border-width.thin'],
      borderColor: tokens['color.border'],
    },
    currentRow: {
      flexDirection: 'row',
      alignItems: 'flex-end',
      gap: tokens['space.2'],
    },
    /** 数字后面跟着"当前连续"这个词，长语言下要能换行。 */
    currentLabel: {
      flexShrink: 1,
      paddingBottom: tokens['space.1'],
    },
    keptRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      gap: tokens['space.2'],
    },
    /** 三个数字在**句子里**（英文语序要求如此），所以等宽给在承载它们的 Text 上。 */
    numeric: {
      fontVariant: ['tabular-nums'],
    },
    /** 两个衔接入口与上面的指标区用**边框**分开（扁平风格不用阴影）。 */
    action: {
      gap: tokens['space.2'],
      paddingTop: tokens['space.2'],
      borderTopWidth: tokens['border-width.thin'],
      borderTopColor: tokens['color.border-subtle'],
    },
    actionButton: {
      minHeight: tokens['touch-target.min'],
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: tokens['space.3'],
      borderRadius: tokens['radius.md'],
      borderWidth: tokens['border-width.thin'],
      borderColor: tokens['color.border'],
      backgroundColor: 'transparent',
      alignSelf: 'flex-start',
    },
    /** 忙时置灰整张卡的按钮 —— 用 token 的不透明度，不写死数字。 */
    busy: {
      opacity: tokens['state.disabled-opacity'],
    },
    empty: {
      gap: tokens['space.1'],
    },
  });
}

export function HabitStreakList({
  habits,
  logs,
  now,
  growth,
  labels,
  onRepair,
  onFreshStart,
  busyHabitId,
  testID,
}: HabitStreakListProps): React.JSX.Element {
  const tokens = useHeytaTokens();
  const text = useHeytaText();
  const styles = useMemo(() => makeStyles(tokens), [tokens]);

  // 连续性全部由 `./model.ts` 的纯函数算出来，这里只负责摆。
  const rows = useMemo(
    () => toHabitStreakRows(habits, logs, now, growth),
    [habits, logs, now, growth],
  );

  if (rows.length === 0) {
    return (
      <View style={styles.empty} testID={testID}>
        <Text style={[text['row-meta'], { color: tokens['color.foreground-subtle'] }]}>
          {labels.empty}
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.list} testID={testID}>
      {rows.map((row) => {
        const r = row.resilience.resilience;
        const { repair, freshStart } = row.resilience;
        const busy = busyHabitId === row.habit.id;
        const frozen = frozenDays(row.resilience);

        return (
          <View key={row.habit.id} style={styles.card} testID={`habit-streak-${row.habit.id}`}>
            <Text
              style={[text['row-title'], { color: tokens['color.foreground'] }]}
              numberOfLines={1}
              accessibilityLabel={labels.a11yHabit(row.habit.name)}
            >
              {row.habit.name}
            </Text>

            <View style={styles.currentRow}>
              <Text style={[text['numeric-display'], { color: tokens['color.foreground'] }]}>
                {String(r.current)}
              </Text>
              <Text
                style={[
                  text['row-meta'],
                  styles.currentLabel,
                  { color: tokens['color.foreground-muted'] },
                ]}
              >
                {labels.current}
              </Text>
            </View>

            {/*
              🔴 这两个数字**只增不减**，而且在当前连续的正下方 ——
              连续归零时屏幕上仍有没变小的东西（见文件头）。
            */}
            <View style={styles.keptRow}>
              <Text
                style={[text['numeric-body'], styles.numeric, { color: tokens['color.foreground-muted'] }]}
              >
                {labels.longest(r.longest)}
              </Text>
              <Text
                style={[text['numeric-body'], styles.numeric, { color: tokens['color.foreground-muted'] }]}
              >
                {labels.total(r.total)}
              </Text>
            </View>

            {/*
              冻结**必须明说**：悄悄替用户吸收一次中断会偷走他对规则的理解。
              显示的**不是余额**（ADR-0022 决定余额不上界面）。
            */}
            {frozen > 0 && labels.freeze !== undefined ? (
              <Text
                style={[text.caption, styles.numeric, { color: tokens['color.foreground-muted'] }]}
              >
                {labels.freeze(frozen)}
              </Text>
            ) : null}

            {/*
              续接。🔴 **先给数字，再给按钮**：先说"补上就是连续 21 天"给的是
              承诺，反过来读起来是"你该做点什么"。只在领域层给出 `repair` 时出现。
            */}
            {shouldOfferRepair(row.resilience) && repair !== undefined ? (
              <View style={styles.action}>
                <Text style={[text.caption, { color: tokens['color.foreground-muted'] }]}>
                  {labels.repair({ date: repair.date, count: repair.streakIfRepaired })}
                </Text>
                {onRepair === undefined || labels.repairAction === undefined ? null : (
                  <Pressable
                    onPress={() => {
                      onRepair(row.habit.id, repair.date);
                    }}
                    disabled={busy}
                    testID={`habit-streak-repair-${row.habit.id}`}
                    accessibilityRole="button"
                    accessibilityLabel={
                      labels.repairA11y === undefined
                        ? labels.repairAction
                        : labels.repairA11y({ date: repair.date, name: row.habit.name })
                    }
                    style={[styles.actionButton, busy ? styles.busy : null]}
                  >
                    <Text style={[text.caption, { color: tokens['color.foreground'] }]}>
                      {labels.repairAction}
                    </Text>
                  </Pressable>
                )}
              </View>
            ) : null}

            {/*
              重新开始。🔴 **不能**出现"你已经落后了"这类措辞；文案里必须明确
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
                {onFreshStart === undefined || labels.freshStartAction === undefined ? null : (
                  <Pressable
                    onPress={() => {
                      onFreshStart(row.habit.id);
                    }}
                    disabled={busy}
                    testID={`habit-streak-freshstart-${row.habit.id}`}
                    accessibilityRole="button"
                    accessibilityLabel={
                      labels.freshStartA11y === undefined
                        ? labels.freshStartAction
                        : labels.freshStartA11y(row.habit.name)
                    }
                    style={[styles.actionButton, busy ? styles.busy : null]}
                  >
                    <Text style={[text.caption, { color: tokens['color.foreground'] }]}>
                      {labels.freshStartAction}
                    </Text>
                  </Pressable>
                )}
              </View>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}
