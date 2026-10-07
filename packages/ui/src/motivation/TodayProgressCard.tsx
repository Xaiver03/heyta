/**
 * 今日进度（共享视图，L1）
 * ==========================
 *
 * M3「motivation」这一刀的即时反馈层：**"今天做了几件 / 还差几件"这件事
 * 只有这一个实现。**
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 为什么需要它
 *
 * 诊断（`docs/plans/motivation-and-progression.md` §0）：heyta 缺的不是功能，
 * 是**回路**。打卡 → 界面只把按钮从"打卡"变成"已打卡"，然后什么都没有。
 * 这个卡片补上"奖励"那一段：完成之后有东西立刻变了，而且方向可见。
 *
 * 迁移前 web 有 `features/motivation/TodayProgressCard.tsx`（180 行 DOM/CSS），
 * mobile 有 `GrowthScreen.tsx` 里的 `TodaySection`（80 行）—— 两份各自回答
 * "还剩多少"与"该说哪句话"。它们**已经漂移过一次**：
 * `total === 0 && done > 0`（没有计划、却顺手做完了事）在两端都出现过
 * "今天 2/1　还有 -1 件没做　今天的都做完了"这种同一张卡上自相矛盾的读数。
 * 现在分支只有一处（`model.ts#growthHint`），说相反的话在结构上不可能。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 领域规则一条都不在这里
 *
 * 计划量怎么算（今天该做的习惯 + 今天到期或逾期的任务）、逾期不倒扣、
 * 计划外完成算 `bonus`、`closed` 何时为真 —— 全在
 * `@heyta/domain#computeTodayProgress`；摊平 / 滤墓碑 / 注入 `now` 在
 * `@heyta/app-host#todayProgressFromState`。
 * 本组件只**消费**宿主传进来的 {@link TodayProgress}，一个数字都不重算。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 文案一律由宿主注入，本文件不 import `@heyta/i18n`
 *
 * 与 `TaskList` / `HabitBoard` / `NotesBoard` 同一个理由：i18n 包自己带过
 * 一份 React，四端会同时中招（`check:mobile-bundle` 盯着）。所以依赖数字的
 * 文案是函数，模板留在有 i18n 的那一侧。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 只用 RN 原语（`View` / `Text` / `StyleSheet`），不 import DOM 标签
 */

import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { HeytaNativeTokens } from '@heyta/design-system';
import type { TodayProgress } from '@heyta/domain';
import { useHeytaText, useHeytaTokens } from '../theme.js';
import { MotivationProgressBar } from './ProgressBar.js';
import { StateIllustration } from '../empty-state/StateIllustration.js';
import {
  growthHint,
  isUnplannedOnly,
  ratioText,
  shouldShowTodayBreakdown,
  shouldShowTodayFocus,
  type GrowthHint,
} from './model.js';

/** 面板全部文案，**每一项都由宿主注入**（见文件头）。 */
export interface TodayProgressLabels {
  /**
   * 还剩多少 / 该说哪句话。
   *
   * 🔴 **一个函数、四种分支由宿主自己分**（而不是共享层给四个字符串）：
   * 有的语言没有"还剩 N 件"这种句式，而 `total === 0` 时 `remaining` 是负数
   * —— 宿主必须能看见 `hint` 这个判据，才不会把 `remaining` 当成唯一的默认。
   */
  readonly hint: (info: {
    readonly hint: GrowthHint;
    readonly done: number;
    /** `total - done`，**可能是负数**（计划外完成时），宿主负责别把它画出来。 */
    readonly remaining: number;
  }) => string;
  /**
   * 进度条的无障碍名。
   *
   * ⚠️ 有计划外完成时**必须说清分母是什么** —— `done > total` 时只念
   * "完成 2 件，共 1 件"会让读屏用户以为进度坏了。所以 `bonus` 也在这里。
   */
  readonly barA11y: (info: {
    readonly done: number;
    readonly total: number;
    readonly bonus: number;
  }) => string;
  readonly habits: (info: { readonly done: number; readonly planned: number }) => string;
  readonly tasks: (info: { readonly done: number; readonly planned: number }) => string;
  readonly focus: (minutes: number) => string;
  /** 计划外也做了事 —— 这正是"小胜"该被看见的地方。只在 `bonus > 0` 时调用。 */
  readonly bonus: (count: number) => string;
  readonly closed: string;
}

export interface TodayProgressCardProps {
  /** `@heyta/app-host#todayProgressFromState` 的输出。 */
  readonly progress: TodayProgress;
  readonly labels: TodayProgressLabels;
  readonly testID?: string;
}

/** 取一份 token 表，建出这套样式。**一个裸值都没有**（`check:design` 会拦）。 */
function makeStyles(tokens: HeytaNativeTokens) {
  return StyleSheet.create({
    card: {
      gap: tokens['space.2'],
      padding: tokens['space.3'],
      borderRadius: tokens['radius.lg'],
      backgroundColor: tokens['color.surface'],
    },
    head: {
      flexDirection: 'row',
      alignItems: 'flex-end',
      gap: tokens['space.2'],
    },
    /** 比例后面跟着一句提示，长提示要能换行而不是把数字挤出屏幕。 */
    hint: {
      flexShrink: 1,
      paddingBottom: tokens['space.1'],
    },
    facts: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: tokens['space.3'],
    },
    completed: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: tokens['space.2'],
    },
    completedText: {
      flexShrink: 1,
      color: tokens['color.success-strong'],
    },
    /** 明细四项在每个数字上等宽（9→10 时整行不跳）。 */
    numeric: {
      fontVariant: ['tabular-nums'],
    },
  });
}

export function TodayProgressCard({
  progress,
  labels,
  testID,
}: TodayProgressCardProps): React.JSX.Element {
  const tokens = useHeytaTokens();
  const text = useHeytaText();
  const styles = useMemo(() => makeStyles(tokens), [tokens]);

  const hint = growthHint(progress);
  // 没有计划、却有完成：比率是 100%，但那不是"达成计划"，是别的东西。
  const unplannedOnly = isUnplannedOnly(progress);

  return (
    <View style={styles.card} testID={testID}>
      <View style={styles.head}>
        <Text style={[text['numeric-display'], { color: tokens['color.foreground'] }]}>
          {ratioText(progress)}
        </Text>
        <Text
          style={[text['row-meta'], styles.hint, { color: tokens['color.foreground-muted'] }]}
        >
          {labels.hint({
            hint,
            done: progress.done,
            // ⚠️ 这里**不** clamp：判据本身（可能是负的）也是信息，
            // 由宿主决定怎么说（web 的分支因此不会写出"还有 -1 件"）。
            remaining: progress.total - progress.done,
          })}
        </Text>
      </View>

      <MotivationProgressBar
        ratio={progress.ratio}
        // 计划外完成时用 success 而不是 primary：那不是"完成了任务"，
        // 是"今天比计划多做了" —— 两个意思不该画成一个样子。
        tone={unplannedOnly || progress.closed ? 'success' : 'primary'}
        label={labels.barA11y({
          done: progress.done,
          total: progress.total,
          bonus: progress.bonus,
        })}
      />

      {/*
        🔴 四项明细只在"有计划"时展开（`shouldShowTodayBreakdown`）：
        没有计划时铺一行 `0 / 0 / 0` 除了让人以为自己漏了什么，没有任何信息量。
        ⚠️ 这是从 web 取的口径 —— mobile 迁移前空计划也会画那三行。
      */}
      {shouldShowTodayBreakdown(progress) ? (
        <View style={styles.facts}>
          <Text style={[text.caption, { color: tokens['color.foreground-muted'] }]}>
            {labels.habits({ done: progress.habitsDone, planned: progress.habitsPlanned })}
          </Text>
          <Text style={[text.caption, { color: tokens['color.foreground-muted'] }]}>
            {labels.tasks({ done: progress.tasksDone, planned: progress.tasksPlanned })}
          </Text>
          {/*
            🔴 计划外也做了事 → 说出来。这正是"小胜"该被看见的地方。
            它排在最右，因为它是**附加**，不是计划的一部分。
          */}
          {progress.bonus > 0 ? (
            <Text style={[text.caption, styles.numeric, { color: tokens['color.primary'] }]}>
              {labels.bonus(progress.bonus)}
            </Text>
          ) : null}
        </View>
      ) : null}

      {/*
        专注时长**独立于**上面的明细：没有计划的一天也可以有专注。
        ⚠️ `> 0` 才显示 —— mobile 迁移前常驻一行"专注 0 分钟"，那是噪音
        （与 web 的 `progress.focusMinutes > 0 &&` 取齐）。
      */}
      {shouldShowTodayFocus(progress) ? (
        <Text
          style={[text.caption, styles.numeric, { color: tokens['color.foreground-muted'] }]}
        >
          {labels.focus(progress.focusMinutes)}
        </Text>
      ) : null}

      {progress.closed ? (
        <View style={styles.completed}>
          <StateIllustration variant="complete" />
          <Text style={[text.caption, styles.completedText]}>{labels.closed}</Text>
        </View>
      ) : null}
    </View>
  );
}
