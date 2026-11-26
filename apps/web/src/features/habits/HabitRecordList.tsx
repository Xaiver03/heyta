/**
 * 习惯打卡记录清单（覆盖图谱 #46：逐条打卡记录，带值 / 时间）
 * ==========================================================
 *
 * `HabitDetailCard` 此前只有「月/年网格 + 补打卡」，**没有把打卡记录逐条列出来** ——
 * 于是"这个习惯具体哪天打了几格、几点打的"无处可查。onboarding 这一格补的就是它。
 *
 * 🔴 “统计怎么算”全在 `@heyta/domain#habitCheckInRecords`（已单测），
 * 这里只做**渲染**：把记录排成一行行（日期 · 值 · 记录时刻），空态走共享 `EmptyState`。
 *
 * ⚠️ 这个组件挂在 `HabitDetailCard` 的 `<HeytaUiProvider>` 之内，
 * 所以 `EmptyState` 取得到 token；单独挂载时要自己包 Provider（见测试）。
 */
import { useMemo } from 'react';

import { habitCheckInRecords, type Habit, type HabitLog } from '@heyta/domain';
import { useI18n, type Locale } from '@heyta/i18n';
import { EmptyState, HeytaUiProvider } from '@heyta/ui';

/** 记录生成时刻（几点打的）。日期排布跟着语言走，与其它记录行同一条理由。 */
function formatRecordAt(ms: number, locale: Locale): string {
  return new Date(ms).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
}

export interface HabitRecordListProps {
  readonly habit: Habit;
  readonly logs: readonly HabitLog[];
}

export function HabitRecordList({ habit, logs }: HabitRecordListProps): React.JSX.Element {
  const { t, locale } = useI18n();
  const records = useMemo(() => habitCheckInRecords(habit, logs), [habit, logs]);

  return (
    <section className="ht-habit__records" data-testid="habit-records-section">
      <h3 className="ht-app__detail-heading">{t('web.habits.records.title')}</h3>
      {records.length === 0 ? (
        <HeytaUiProvider>
          <EmptyState
            size="section"
            title={t('web.habits.records.empty')}
            testID="habit-records-empty"
          />
        </HeytaUiProvider>
      ) : (
        <ul className="ht-app__detail-records" data-testid="habit-records">
          {records.map((record) => (
            <li
              className="ht-app__detail-record ht-type-row-meta"
              data-testid="habit-record"
              key={record.id}
            >
              <span className="ht-app__detail-record-time">{record.date}</span>
              <span className="ht-app__detail-record-duration">
                {t('web.habits.records.value', { value: record.value })}
              </span>
              <span className="ht-app__detail-record-task">{formatRecordAt(record.at, locale)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
