/**
 * 本周复盘（共享视图，L3 短周期）
 * ==================================
 *
 * 「最近发生了什么」的出口：回答"我这周在干什么"。三个数字 = 打卡 / 完成任务 /
 * 专注分钟，每个都带**上周同类数字**做参照。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 差值只用中性色 —— 这是本组件最重要的一条
 *
 * 迁移前 web 的 `GrowthView.tsx` 文件头第 2 条写得很直白：**"不显示比上周少"**。
 * 周复盘里带差值，但**不给下降配红色、不给上升配庆祝** —— 一个正常的一周
 * 不需要被判分。这是损失厌恶的反用：我们不用"你在退步"来驱动用户回来。
 * mobile 的 `WeekStat` 逐字遵守同一条。
 *
 * 所以这个组件里**没有 tone 参数**、没有箭头、没有涨跌色。谁要加，先改文件头。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 领域规则一条都不在这里
 *
 * 周窗口怎么切（ISO 周一 → 周日）、上周窗口、`headline` 怎么选（本周最活跃的
 * 维度）、`bestFocusDay` 怎么取 —— 全在 `@heyta/domain#computeWeeklyReview`；
 * 摊平 / 滤墓碑 / 注入 `now` 在 `@heyta/app-host#weeklyReviewFromState`。
 * 本组件只消费宿主传进来的 {@link WeeklyReview}。
 *
 * ⚠️ 三个数字的顺序由 `model.ts#WEEK_STAT_IDS` 固定（打卡 → 任务 → 专注），
 * **不按数值大小重排** —— 那是排行榜的形状，而这一屏的红线是"只与自己比"。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 文案一律由宿主注入，本文件不 import `@heyta/i18n`（理由见 `TodayProgressCard`）
 *
 * 🔴 只用 RN 原语（`View` / `Text` / `StyleSheet`）
 */

import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { HeytaNativeTokens } from '@heyta/design-system';
import type { LocalDate, WeeklyReview } from '@heyta/domain';
import { useHeytaText, useHeytaTokens } from '../theme.js';
import { weekHeadlineCount, weekStatRows, type HeadlineKind, type WeekStatId } from './model.js';

/** 面板全部文案，**每一项都由宿主注入**（见文件头）。 */
export interface WeeklyReviewLabels {
  readonly range: (info: { readonly start: LocalDate; readonly end: LocalDate }) => string;
  /** `headline === 'none'` 时那一句（"这一周还没有记录"）。 */
  readonly empty: string;
  /**
   * 本周主标题。
   *
   * ⚠️ 句子（含量词）在词条里，`count` 才是数字 —— 英文的语序与量词都在
   * 句子里，拿"数字 + 单位"两段拼是拼不出正确英文的。
   */
  readonly headline: (info: {
    readonly headline: HeadlineKind;
    readonly count: number;
  }) => string;
  readonly stat: (id: WeekStatId) => string;
  /** 单位（"次""件""分钟"）。省略 = 不渲染单位（mobile 迁移前就不渲染）。 */
  readonly statUnit?: (id: WeekStatId) => string;
  readonly previous: (count: number) => string;
  readonly bestDay: (info: { readonly date: LocalDate; readonly minutes: number }) => string;
}

export interface WeeklyReviewCardProps {
  /** `@heyta/app-host#weeklyReviewFromState` 的输出。 */
  readonly review: WeeklyReview;
  readonly labels: WeeklyReviewLabels;
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
    statRow: {
      flex: 1,
      minWidth: 0,
      flexDirection: 'column',
      alignItems: 'flex-start',
      gap: tokens['space.2'],
    },
    statValue: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      minWidth: 0,
      alignItems: 'baseline',
      gap: tokens['space.2'],
    },
    stats: {
      flexDirection: 'row',
      gap: tokens['space.4'],
    },
    numeric: {
      fontVariant: ['tabular-nums'],
    },
  });
}

export function WeeklyReviewCard({
  review,
  labels,
  testID,
}: WeeklyReviewCardProps): React.JSX.Element {
  const tokens = useHeytaTokens();
  const text = useHeytaText();
  const styles = useMemo(() => makeStyles(tokens), [tokens]);

  const rows = weekStatRows(review);

  return (
    <View style={styles.card} testID={testID}>
      <Text style={[text['row-meta'], { color: tokens['color.foreground-subtle'] }]}>
        {labels.range({ start: review.weekStart, end: review.weekEnd })}
      </Text>

      {review.headline === 'none' ? (
        <Text style={[text['row-meta'], { color: tokens['color.foreground-subtle'] }]}>
          {labels.empty}
        </Text>
      ) : (
        <Text style={[text['row-title'], { color: tokens['color.foreground'] }]}>
          {labels.headline({ headline: review.headline, count: weekHeadlineCount(review) })}
        </Text>
      )}

      <View style={styles.stats} testID="growth-week-stats">
        {rows.map((row) => (
          <View key={row.id} style={styles.statRow} testID={`growth-week-stat-${row.id}`}>
            <Text style={[text['row-meta'], { color: tokens['color.foreground-muted'] }]}>
              {labels.stat(row.id)}
            </Text>
            <View style={styles.statValue}>
              <Text style={[text['numeric-summary'], styles.numeric, { color: tokens['color.foreground'] }]}>
                {String(row.value)}
              </Text>
              {/*
                单位与数字**分开**：web 迁移前就是两个元素（数字用 numeric-display、
                单位用 caption）。合成一段会让单位跟着数字的字号走，而"专注小时"
                那类单位在数字很大时会被放大到不协调。
              */}
              {labels.statUnit === undefined ? null : (
                <Text style={[text.caption, { color: tokens['color.foreground-muted'] }]}>
                  {labels.statUnit(row.id)}
                </Text>
              )}
              {/*
                🔴 上周那个数字**只有中性色**（`foreground-subtle`），
                没有箭头、没有红绿。见文件头。
              */}
              <Text
                style={[text.caption, styles.numeric, { color: tokens['color.foreground-subtle'] }]}
              >
                {labels.previous(row.previous)}
              </Text>
            </View>
          </View>
        ))}
      </View>

      {review.bestFocusDay === undefined ? null : (
        <Text style={[text.caption, { color: tokens['color.foreground-muted'] }]}>
          {labels.bestDay({
            date: review.bestFocusDay.date,
            minutes: review.bestFocusDay.minutes,
          })}
        </Text>
      )}
    </View>
  );
}
