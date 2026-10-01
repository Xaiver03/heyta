/**
 * 习惯清单行（共享层，列表 + 窗格形态的"列表"那一半）
 * ====================================================
 *
 * 产品负责人 2026-10-01 的形态要求：习惯面 = **清单 + 详情**，清单负责
 * "扫一眼"（图标、最近几天打没打、三个具体数字），详情负责"看细节"。
 * web 那一侧已经按这个形状落地（`apps/web/src/features/habits/`），
 * **本文件是移动端拿到的同一套形状** —— 在此之前移动端是 N 张详情卡直接堆叠，
 * 没有任何"扫一眼"的那一列。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 这一层一个判断都不做
 *
 * 三个数字来自 `toHabitProgressRows` + 宿主注入的 `growth`（两端都传
 * `@heyta/app-host#habitGrowth`），那排点来自 `habitHeatmap`，颜色来自
 * `heatmapLevelToken`，底盘颜色来自 `categorySlotToken`，字形来自
 * `@heyta/domain#habitIconOf`。**这里不许出现 `computeStreak`、
 * 也不许自己数 `logs`** —— 那会变成第三份"什么算打过 / 连续几天"的答案。
 *
 * 🔴 走**韧性口径**（`progress.resilience.resilience`），与详情窗格逐字相同。
 *    日历口径的 `progress.streak` 与韧性口径永远不能相减（ADR-0022），
 *    所以这里只取一套，不做混合。
 *
 * 🔴 三个数字同等权重、常驻。"累计"是唯一只增不减的数字，断链那天用户
 *    最需要看见它，所以它不能被折进悬停、也不许在窄屏里第一个被砍。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠️ 与 web 的 DOM 清单**并存**是这一刀的已知债务（2026-10-01 记账）
 *
 * `apps/web/src/features/habits/HabitsList.tsx` 是 DOM + CSS 的实现，本文件是
 * RN 原语的实现 —— **两份像素，一份判据**。判据（数字、分档、窗口长度、
 * 色板映射、字形选择）全部住在 `model.ts` 与 `@heyta/domain`，所以漂移的
 * 上限只剩"看起来不太一样"，不会出现"两端数字不同"。
 *
 * 为什么这一刀不顺手合并：web 那份带着两列塌缩方向、暗色对比度两组真浏览器
 * 判据（`e2e/tests/habits-pane.spec.ts`），换渲染层等于把那批证据作废重做，
 * 而它不是这次要改的东西。**最小一步**：把 web 的 `.ht-habits__list` 换成消费
 * 本组件，塌缩与对比度判据随之重写到共享层，届时删掉 `HabitsList.tsx`。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 文案一律由宿主注入，本文件不 import `@heyta/i18n`
 *
 * 与 `HabitBoard.tsx` 同一个理由（i18n 包自己带一份 React，四端同时中招）。
 * 宿主两侧用的是**同一批词条 key**（`web.habits.*`），所以中英两边只有一份。
 *
 * ⚠️ 移动端与 web 的一处刻意差异：那排点**没有悬停提示** —— 手机没有鼠标。
 *    整行的 `accessibilityLabel` 一次说完三个数字，读屏不必逐格猜。
 */

import React, { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { HeytaNativeTokens } from '@heyta/design-system';
import type { Habit, HabitIcon, HabitLog } from '@heyta/domain';
import { habitIconOf, parseCategorySlot } from '@heyta/domain';
import {
  Activity,
  BookOpen,
  Check,
  Droplet,
  Flame,
  Leaf,
  Moon,
  Music,
  Pencil,
  Sun,
  TrendingUp,
} from 'lucide';
import { categorySlotToken } from '../categories/model.js';
import { HeytaIcon, type HeytaIconData } from '../icon/Icon.js';
import { useHeytaText, useHeytaTokens } from '../theme.js';
import {
  HABIT_LIST_WEEK_DAYS,
  heatmapLevelToken,
  habitHeatmap,
  toHabitProgressRows,
  type HabitGrowthFn,
} from './model.js';

/**
 * 闭集 key → Lucide **数据**（不是组件）。
 *
 * 🔴 类型是 `Record<HabitIcon, …>`，所以往 `HABIT_ICONS` 里加第 9 个 key
 *    而没在这里补上，`typecheck` 会直接指出缺哪一项 —— 不会出现"新图标在
 *    清单里静默画成上一个"的错。
 */
const HABIT_GLYPHS: Record<HabitIcon, HeytaIconData> = {
  drop: Droplet,
  activity: Activity,
  book: BookOpen,
  moon: Moon,
  leaf: Leaf,
  pencil: Pencil,
  sun: Sun,
  music: Music,
};

/** 清单全部文案，每一项由宿主注入（见文件头）。 */
export interface HabitProgressListLabels {
  /** 整列给屏幕阅读器的那一句（「习惯清单」）。 */
  readonly list: string;
  /**
   * 一条都没有时说的那句。
   *
   * 🔴 **必填，且由宿主构造**：空态只有一个实现是仓库的既有判据
   * （`scripts/check-empty-state.mjs` 断言 B），所以"没有习惯"这句话**不许**
   * 在视图里手写 —— 共享层渲染它，宿主只给文案，与 `HabitBoard.empty` 同形。
   */
  readonly empty: string;
  /** 整行的读法：三个数字一次说完。 */
  readonly row: (info: {
    readonly name: string;
    readonly current: number;
    readonly longest: number;
    readonly total: number;
  }) => string;
  /** 这一行点下去会做什么（「查看「X」的打卡记录」）。 */
  readonly selectA11y: (name: string) => string;
  /** 三个 chip 的完整句子（chip 上只放数字，句子给 `accessibilityLabel` 与详情层）。 */
  readonly streakCurrent: (count: number) => string;
  readonly streakLongest: (count: number) => string;
  readonly streakTotal: (count: number) => string;
}

export interface HabitProgressListProps {
  readonly habits: readonly Habit[];
  /** 全部打卡记录（已滤墓碑）。 */
  readonly logs: readonly HabitLog[];
  /** 显式传入的"现在"，与 `HabitBoard` 同一个值 —— 否则两列会跨午夜不一致。 */
  readonly now: number;
  readonly growth: HabitGrowthFn;
  readonly labels: HabitProgressListLabels;
  /** 详情层当前展开的那一条；`undefined` = 一个都没有。 */
  readonly selectedId?: string;
  readonly onSelect: (habitId: string) => void;
  /** 那排点的天数窗口，默认 `HABIT_LIST_WEEK_DAYS`。 */
  readonly weekDays?: number;
  readonly testID?: string;
}

function makeStyles(tokens: HeytaNativeTokens) {
  return StyleSheet.create({
    list: {
      gap: tokens['space.2'],
    },
    row: {
      gap: tokens['space.2'],
      padding: tokens['space.3'],
      minHeight: tokens['touch-target.min'],
      borderRadius: tokens['radius.lg'],
      backgroundColor: tokens['color.surface'],
      borderWidth: tokens['border-width.thin'],
      borderColor: tokens['color.border'],
    },
    /* 选中态用**边框**表达（扁平风格里阴影只给真正的浮层），再加一层极浅的
       主色底：两种线索，色觉差异下仍分得出。与 web 的 `.ht-habits__row[aria-current]` 同一条。 */
    rowSelected: {
      borderColor: tokens['color.primary'],
      backgroundColor: tokens['color.primary-subtle'],
    },
    head: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: tokens['space.2'],
      minWidth: 0,
    },
    disc: {
      width: tokens['icon.lg'],
      height: tokens['icon.lg'],
      borderRadius: tokens['radius.full'],
      borderWidth: tokens['border-width.thin'],
      alignItems: 'center',
      justifyContent: 'center',
    },
    name: {
      flexShrink: 1,
    },
    week: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: tokens['space.1'],
    },
    dot: {
      width: tokens['space.3'],
      height: tokens['space.3'],
      borderRadius: tokens['radius.full'],
    },
    chips: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: tokens['space.3'],
    },
    chip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: tokens['space.1'],
    },
    numeric: {
      fontVariant: ['tabular-nums'],
    },
  });
}

export function HabitProgressList({
  habits,
  logs,
  now,
  growth,
  labels,
  selectedId,
  onSelect,
  weekDays = HABIT_LIST_WEEK_DAYS,
  testID,
}: HabitProgressListProps): React.JSX.Element {
  const tokens = useHeytaTokens();
  const text = useHeytaText();
  const styles = useMemo(() => makeStyles(tokens), [tokens]);
  const rows = useMemo(
    () => toHabitProgressRows(habits, logs, now, growth),
    [habits, logs, now, growth],
  );

  // 🔴 空态由共享层渲染（`HabitBoard` 同一个形状、同一个 token），宿主只给文案。
  // `testID` 与 `accessibilityLabel` 一起带过来：验收和读屏都不该因为"还没有习惯"
  // 就找不到这一列。
  if (rows.length === 0) {
    return (
      <View testID={testID} accessible accessibilityLabel={labels.list}>
        <Text style={[text.caption, { color: tokens['color.foreground-muted'] }]}>
          {labels.empty}
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.list} testID={testID} accessible accessibilityLabel={labels.list}>
      {rows.map((row) => {
        const { habit } = row;
        const resilience = row.resilience.resilience;
        const week = habitHeatmap(logs, habit.id, now, weekDays);
        const selected = habit.id === selectedId;
        // 没设过色 → `categorySlotToken(undefined)` 就是设计系统指定的那一个
        // 中性 token（`UNSET_CATEGORY_TOKEN`），不在这里另挑"看起来中性"的颜色。
        const discColor = tokens[categorySlotToken(parseCategorySlot(habit.color))];

        return (
          <Pressable
            key={habit.id}
            testID={`habit-row-${habit.id}`}
            accessibilityRole="button"
            // 🔴 **平铺** `aria-pressed`，不要用对象形态 `accessibilityState` —— RNW 0.21
            // 会把对象形态整个丢掉（判据 `pnpm check:rn-aria`）。
            // ⚠️ web 那份 DOM 清单用的是 `aria-current="true"`：RN 的 `AriaProps` 类型里
            // **没有** `aria-current`，而 `aria-pressed` 是两端都认、`role="button"` 上
            // 合法的那一个。语义相同 —— "这一行的内容正在窗格里显示"。
            aria-pressed={selected}
            accessibilityLabel={labels.row({
              name: habit.name,
              current: resilience.current,
              longest: resilience.longest,
              total: resilience.total,
            })}
            accessibilityHint={labels.selectA11y(habit.name)}
            onPress={() => {
              onSelect(habit.id);
            }}
            style={selected ? [styles.row, styles.rowSelected] : styles.row}
          >
            <View style={styles.head}>
              <View style={[styles.disc, { borderColor: discColor }]}>
                <HeytaIcon
                  data={HABIT_GLYPHS[habitIconOf(habit)]}
                  size={tokens['icon.sm']}
                  color={discColor}
                />
              </View>
              <Text style={[text['row-title'], styles.name]} numberOfLines={1}>
                {habit.name}
              </Text>
            </View>

            {/*
              一排点：`Pressable` 已经带了 `accessibilityLabel`，整行在读屏里
              是**一个**元素，所以这些格子不会被逐格念出来（那会把三个数字
              的句子冲成 7 句"没打卡"）。手机上也没有悬停 ⇒ 不产 tooltip。
              ⚠️ 不把它们包成一个 `accessibilityRole="group"` 的子元素：RN 的
              `AccessibilityRole` 词表里**没有** `group`（web 那份 DOM 清单用的是
              `role="group"`），而给它独立的可访问身份只会让整行多念一遍。
            */}
            <View style={styles.week}>
              {week.map((day) => (
                <View
                  key={day.date}
                  style={[styles.dot, { backgroundColor: tokens[heatmapLevelToken(day.level)] }]}
                  testID={`habit-dot-${habit.id}-${day.date}`}
                />
              ))}
            </View>

            <View style={styles.chips}>
              {[
                {
                  key: 'current',
                  data: Flame,
                  value: resilience.current,
                  sentence: labels.streakCurrent(resilience.current),
                },
                {
                  key: 'longest',
                  data: TrendingUp,
                  value: resilience.longest,
                  sentence: labels.streakLongest(resilience.longest),
                },
                {
                  key: 'total',
                  data: Check,
                  value: resilience.total,
                  sentence: labels.streakTotal(resilience.total),
                },
              ].map((chip) => (
                <View
                  key={chip.key}
                  style={styles.chip}
                  accessible
                  accessibilityLabel={chip.sentence}
                  testID={`habit-chip-${habit.id}-${chip.key}`}
                >
                  <HeytaIcon
                    data={chip.data}
                    size={tokens['font-size.xs']}
                    color={tokens['color.foreground-muted']}
                  />
                  <Text
                    style={[
                      text.caption,
                      styles.numeric,
                      { color: tokens['color.foreground-muted'] },
                    ]}
                  >
                    {chip.value}
                  </Text>
                </View>
              ))}
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}
