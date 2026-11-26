/**
 * 专注统计图表（覆盖图谱 #50：日 / 周 / 月 三档图表）
 * ====================================================
 *
 * 此前专注详情只有四格数字 + 一张逐条记录列表，**没有按日/周/月看趋势的图**。
 * 这里补一张手绘 SVG 柱状图，粒度用下拉切换（日 14 / 周 8 / 月 6）。
 *
 * 🔴 序列来自 `store.selectFocusSeries` → `@heyta/app-host#focusSeriesFromState`
 * → `@heyta/domain#focusSeries`（纯函数，已单测）。这里只画，不自己 reduce。
 */
import { useMemo, useState } from 'react';

import type { FocusSeriesBucket } from '@heyta/domain';
import { useI18n, type MessageKey } from '@heyta/i18n';
import { BarChart, HeytaUiProvider } from '@heyta/ui';

import { selectFocusSeries, useFocusStore } from './store.js';

/** 每个粒度显示多少格。单一常量：改窗长只改这里。 */
const BUCKET_COUNT: Record<FocusSeriesBucket, number> = { day: 14, week: 8, month: 6 };

const BUCKET_LABEL: Record<FocusSeriesBucket, MessageKey> = {
  day: 'web.focus.stats.day',
  week: 'web.focus.stats.week',
  month: 'web.focus.stats.month',
};

const BUCKETS: readonly FocusSeriesBucket[] = ['day', 'week', 'month'];

export function FocusStatsChart(): React.JSX.Element {
  const { t } = useI18n();
  const overview = useFocusStore((s) => s.overview);
  const [bucket, setBucket] = useState<FocusSeriesBucket>('day');

  // `overview` 只因引擎变化而换身份 ⇒ 它当依赖既能跟上最新记录，又不会凭空重算。
  const data = useMemo(() => {
    const series = selectFocusSeries(bucket, BUCKET_COUNT[bucket]);
    return series.map((point, i) => ({ key: `${bucket}-${String(i)}`, value: point.focusMs }));
  }, [overview, bucket]);

  return (
    <HeytaUiProvider>
      <div className="ht-app__focus-stats" data-testid="focus-stats">
        <h3 className="ht-app__detail-heading">{t('web.focus.stats.title')}</h3>
        <label className="ht-focus__manual-field">
          {t('web.focus.stats.granularity')}
          <select
            className="ht-input"
            value={bucket}
            onChange={(e) => {
              const next = e.target.value;
              setBucket(next === 'week' ? 'week' : next === 'month' ? 'month' : 'day');
            }}
          >
            {BUCKETS.map((option) => (
              <option key={option} value={option}>
                {t(BUCKET_LABEL[option])}
              </option>
            ))}
          </select>
        </label>
        <BarChart
          data={data}
          height={72}
          ariaLabel={t('web.focus.stats.aria', { bucket: t(BUCKET_LABEL[bucket]) })}
          testID="focus-stats-chart"
        />
      </div>
    </HeytaUiProvider>
  );
}
