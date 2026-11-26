/**
 * 习惯统计图表（覆盖图谱 #48：完成率 / 连续天数趋势图）
 * ====================================================
 *
 * 此前习惯详情只有**四格数字**（本月打卡 / 总打卡 / 完成率 / 当前连续），
 * 看不出"最近在变好还是变差"。这里补两张手绘 SVG 图：
 *   · 完成率 —— 近 8 个 7 天窗口的完成率柱状图（0–100%）；
 *   · 连续天数 —— 近 8 周周末的当前连续天数折线图。
 *
 * 🔴 序列由 `@heyta/domain` 的纯函数算（`habitWeeklyRateSeries` /
 * `habitStreakSeries`，已单测）；这里只做**渲染**，一个数都不自己 reduce。
 * 图元是 `@heyta/ui` 的手写 SVG（`BarChart` / `LineChart`，无图表库、token 取色）。
 */
import { useMemo } from 'react';

import {
  habitStreakSeries,
  habitWeeklyRateSeries,
  type Habit,
  type HabitLog,
  type LocalDate,
} from '@heyta/domain';
import { useI18n } from '@heyta/i18n';
import { BarChart, LineChart } from '@heyta/ui';

export interface HabitStatsChartProps {
  readonly habit: Habit;
  readonly logs: readonly HabitLog[];
  readonly today: LocalDate;
}

/** 趋势窗口的周数。单一常量：改窗长只改这里（两块图共用，读法一致）。 */
const TREND_WEEKS = 8;

export function HabitStatsChart({ habit, logs, today }: HabitStatsChartProps): React.JSX.Element {
  const { t } = useI18n();

  const rateData = useMemo(() => {
    const series = habitWeeklyRateSeries(habit, logs, today, TREND_WEEKS);
    // 完成率换成 0–100 的整数（柱高按百分比归一，读起来是"百分之几十"）。
    return series.map((bucket, i) => ({ key: `week-${String(i)}`, value: Math.round(bucket.rate * 100) }));
  }, [habit, logs, today]);

  const streakData = useMemo(() => {
    const series = habitStreakSeries(habit, logs, today, TREND_WEEKS);
    return series.map((point, i) => ({ key: `point-${String(i)}`, value: point.streak }));
  }, [habit, logs, today]);

  return (
    <section className="ht-habit__stats" data-testid="habit-stats">
      <h3 className="ht-app__detail-heading">{t('web.habits.stats.title')}</h3>

      <figure className="ht-stats__figure">
        <figcaption className="ht-stats__caption">{t('web.habits.stats.rate')}</figcaption>
        <BarChart
          data={rateData}
          height={64}
          max={100}
          ariaLabel={t('web.habits.stats.rateAria', { weeks: TREND_WEEKS })}
          testID="habit-stats-rate"
        />
      </figure>

      <figure className="ht-stats__figure">
        <figcaption className="ht-stats__caption">{t('web.habits.stats.streak')}</figcaption>
        <LineChart
          data={streakData}
          height={64}
          ariaLabel={t('web.habits.stats.streakAria', { weeks: TREND_WEEKS })}
          testID="habit-stats-streak"
        />
      </figure>
    </section>
  );
}
