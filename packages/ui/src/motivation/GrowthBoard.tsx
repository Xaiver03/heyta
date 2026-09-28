/**
 * 成长板（共享视图）—— 把各区块按**唯一一个顺序**拼起来
 * ========================================================
 *
 * M3「motivation」这一刀的收口：**"成长这一屏从上到下是什么"只有一个答案。**
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 为什么需要一个 composer（不是"顺手包一层"）
 *
 * 迁移前两端各有一屏：web 的 `GrowthView.tsx`（242 行）与 mobile 的
 * `GrowthScreen.tsx`（578 行）。它们的**区块顺序不同**，而且各自缺对方的块：
 *
 *   · web：周复盘 → 年度热力 → 分类时长 → 里程碑 → 身份 → 分享
 *   · mobile：今日进度 → 周复盘 → 连续性 → 里程碑 → 身份
 *
 * 于是"今天做了几件"在这屏上有两个位置、"热力在哪"有两个答案。区块组件
 * 共享之后，仍然需要有人回答**顺序** —— 那个答案就是本文件。
 * 两端再用 boolean 开关裁出自己那一份（`showXxx`），而不是各自重写一遍 JSX。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 区块顺序是**产品决定**，逐条记账
 *
 * 1. `compareNote`：一句"只与自己比"。mobile 有、web 没有。放在**最上面**，
 *    因为用户在其他 App 里被排行榜训练过，会下意识找"我排第几" ——
 *    主动说清楚比让人找不到而困惑好。
 * 2. `today`（L1 即时反馈）→ 3. `week`（L3 短周期）→ 4. `streaks`（L2 连续性）
 *    → 5. `heatmap`（L3 中周期）→ 7. `milestones` / 8. `tags`（L3 长周期）。
 *    时间尺度**由短到长**是刻意的（web 迁移前的文件头写着理由：只给短周期会
 *    显得琐碎，只给长周期会让今天做的事显得无关紧要）。
 *    ⚠️ `streaks` 插在 `week` 与 `heatmap` 之间，用的是 mobile 的位置：
 *    它是"每个习惯"的细粒度读数，紧接着周复盘（同样是细节层）比放在热力图
 *    之后更顺。web 迁移前没有这一块，所以这个位置没有旧约束。
 * 6. `categoryBreakdown`（宿主插槽）：web 迁移前把它放在**年度热力之后、
 *    里程碑之前**（`GrowthView.tsx` 第 144 行）。⚠️ 它上面的注释写着"放在
 *    周复盘与一年之间"，而**代码不是那么放的** —— 注释是过期的，代码才是判据，
 *    这里跟代码。
 * 9. `share`：整个叙事讲完之后的出口，放最后。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 本组件**不算任何数字**
 *
 * 所有投影结果都由宿主从 `@heyta/app-host#motivation` 取好再传进来
 * （`todayProgressFromState` / `weeklyReviewFromState` / `milestonesFromState` /
 * `identityTagsFromState` / `dailyActivityCountsFromState`），连续性走注入的
 * `growth: HabitGrowthFn`（`habitGrowth`）。本文件只回答"摆在哪里、摆哪些"。
 *
 * 🔴 文案一律由宿主注入（理由见 `TodayProgressCard`）；本文件不 import `@heyta/i18n`
 * 🔴 只用 RN 原语（`View` / `StyleSheet`）
 */

import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { HeytaNativeTokens } from '@heyta/design-system';
import type {
  Habit,
  HabitLog,
  IdentityTagProgress,
  LocalDate,
  MilestoneProgress,
  TodayProgress,
  WeeklyReview,
} from '@heyta/domain';
import type { HabitGrowthFn } from '../habits/model.js';
import { useHeytaText, useHeytaTokens } from '../theme.js';
import { ActivityHeatmap, type ActivityHeatmapLabels } from './ActivityHeatmap.js';
import { HabitStreakList, type HabitStreakLabels } from './HabitStreakList.js';
import { IdentityTagList, type IdentityTagListLabels } from './IdentityTagList.js';
import { MilestoneMap, type MilestoneMapLabels } from './MilestoneMap.js';
import { ShareSummarySection, type ShareSummaryLabels } from './ShareSummarySection.js';
import { TodayProgressCard, type TodayProgressLabels } from './TodayProgressCard.js';
import { WeeklyReviewCard, type WeeklyReviewLabels } from './WeeklyReviewCard.js';
import type { ActivityDayCount } from './model.js';

/**
 * 区块 id。`renderSectionHeader` 与测试用它指代"哪一块"。
 *
 * ⚠️ 刻意**不导出**每个区块自己的标题文案：标题是宿主的界面文案
 * （web 用 `<h2 style="section-title">`、mobile 用 kit 的 `SectionHeader`），
 * 共享层只给 id，不给句子。
 */
export type MotivationSectionId =
  | 'compareNote'
  | 'today'
  | 'week'
  | 'streaks'
  | 'heatmap'
  | 'category'
  | 'milestones'
  | 'tags'
  | 'share';

/** 成长板全部文案。各区块的 labels 原样透传（分组只为可读性）。 */
export interface GrowthBoardLabels {
  /** "只与自己比"那一句。省略 = 不渲染那条说明。 */
  readonly compareNote?: string;
  readonly today: TodayProgressLabels;
  readonly week: WeeklyReviewLabels;
  readonly streaks: HabitStreakLabels;
  readonly milestones: MilestoneMapLabels;
  readonly tags: IdentityTagListLabels;
  readonly heatmap: ActivityHeatmapLabels;
  readonly share: ShareSummaryLabels;
}

export interface GrowthBoardProps {
  /** 当前时间（epoch ms）。**所有投影必须由宿主用同一个 `now` 算出来**。 */
  readonly now: number;
  /** `@heyta/app-host#todayProgressFromState`。 */
  readonly todayProgress: TodayProgress;
  /** `@heyta/app-host#weeklyReviewFromState`。 */
  readonly weeklyReview: WeeklyReview;
  /** `@heyta/app-host#milestonesFromState`。 */
  readonly milestones: readonly MilestoneProgress[];
  /** `@heyta/app-host#identityTagsFromState`。 */
  readonly identityTags: readonly IdentityTagProgress[];
  /** 未删除的习惯（连续性区块用）。 */
  readonly habits: readonly Habit[];
  /** 未删除的打卡记录（连续性区块用）。 */
  readonly logs: readonly HabitLog[];
  /** 连续 + 韧性的配对。两端都传 `@heyta/app-host#habitGrowth`。 */
  readonly growth: HabitGrowthFn;
  /**
   * `@heyta/app-host#dailyActivityCountsFromState` 的输出。
   * **省略 = 不渲染热力图**（mobile 迁移前没有年度视图）。
   */
  readonly activityDays?: readonly ActivityDayCount[];
  readonly labels: GrowthBoardLabels;

  /** 各区块的开关。省略 = 渲染。 */
  readonly showToday?: boolean;
  readonly showWeek?: boolean;
  readonly showStreaks?: boolean;
  readonly showMilestones?: boolean;
  readonly showTags?: boolean;

  /**
   * 分类时长插槽。**由宿主注入现成组件**（web 是 `CategoryBreakdown`，
   * 它自己是一个共享组件 `CategoryReportView` 的接线层）——
   * 共享层不认识它，只给它一个位置（见文件头第 6 条）。
   */
  readonly renderCategoryBreakdown?: () => React.ReactNode;
  /**
   * 周小结复制。省略 = 不渲染分享块（mobile 没有剪贴板接线）。
   * `summary` 由宿主用 `t()` 拼好；`onCopy` 是宿主的剪贴板实现。
   */
  readonly share?: { readonly summary: string; readonly onCopy: () => Promise<void> };

  /** 补打卡 / 重新开始（连续性区块）。省略 = 那两块只显示提示文字。 */
  readonly onRepair?: (habitId: string, date: LocalDate) => void;
  readonly onFreshStart?: (habitId: string) => void;
  readonly busyHabitId?: string | null;

  /**
   * 区块标题插槽。在每个区块**之前**调用一次，返回宿主的标题节点
   * （web 的 `<h2>` / mobile 的 `SectionHeader`）。省略 = 不渲染任何标题。
   */
  readonly renderSectionHeader?: (id: MotivationSectionId) => React.ReactNode;

  readonly testID?: string;
}

/** 取一份 token 表，建出这套样式。**一个裸值都没有**（`check:design` 会拦）。 */
function makeStyles(tokens: HeytaNativeTokens) {
  return StyleSheet.create({
    board: {
      gap: tokens['space.4'],
    },
  });
}

export function GrowthBoard({
  now,
  todayProgress,
  weeklyReview,
  milestones,
  identityTags,
  habits,
  logs,
  growth,
  activityDays,
  labels,
  showToday = true,
  showWeek = true,
  showStreaks = true,
  showMilestones = true,
  showTags = true,
  renderCategoryBreakdown,
  share,
  onRepair,
  onFreshStart,
  busyHabitId,
  renderSectionHeader,
  testID,
}: GrowthBoardProps): React.JSX.Element {
  const tokens = useHeytaTokens();
  const text = useHeytaText();
  const styles = useMemo(() => makeStyles(tokens), [tokens]);

  /** 每个区块的标题（宿主给了才有）+ 内容。抽出来只为让下面那段 JSX 短。 */
  const section = (id: MotivationSectionId, node: React.ReactNode): React.ReactNode => (
    <View key={id}>
      {renderSectionHeader === undefined ? null : renderSectionHeader(id)}
      {node}
    </View>
  );

  return (
    <View style={styles.board} testID={testID}>
      {/*
        🔴 这句不是装饰：用户在其他 App 里被排行榜训练过，到这里会下意识找
        "我排第几"。主动说清楚，比让人找不到而困惑好。（mobile 迁移前的原文）
      */}
      {labels.compareNote === undefined
        ? null
        : section(
            'compareNote',
            <Text
              style={[text['row-meta'], { color: tokens['color.foreground-subtle'] }]}
              testID="growth-compare-note"
            >
              {labels.compareNote}
            </Text>,
          )}

      {showToday
        ? section(
            'today',
            <TodayProgressCard progress={todayProgress} labels={labels.today} />,
          )
        : null}

      {showWeek
        ? section('week', <WeeklyReviewCard review={weeklyReview} labels={labels.week} />)
        : null}

      {showStreaks
        ? section(
            'streaks',
            <HabitStreakList
              habits={habits}
              logs={logs}
              now={now}
              growth={growth}
              labels={labels.streaks}
              {...(onRepair === undefined ? {} : { onRepair })}
              {...(onFreshStart === undefined ? {} : { onFreshStart })}
              busyHabitId={busyHabitId ?? null}
            />,
          )
        : null}

      {activityDays === undefined
        ? null
        : section(
            'heatmap',
            <ActivityHeatmap days={activityDays} labels={labels.heatmap} />,
          )}

      {renderCategoryBreakdown === undefined
        ? null
        : section('category', renderCategoryBreakdown())}

      {showMilestones
        ? section('milestones', <MilestoneMap milestones={milestones} labels={labels.milestones} />)
        : null}

      {showTags
        ? section('tags', <IdentityTagList tags={identityTags} labels={labels.tags} />)
        : null}

      {share === undefined
        ? null
        : section(
            'share',
            <ShareSummarySection
              summary={share.summary}
              onCopy={share.onCopy}
              labels={labels.share}
            />,
          )}
    </View>
  );
}
