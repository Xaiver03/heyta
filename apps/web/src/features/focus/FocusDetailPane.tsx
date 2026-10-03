/**
 * 专注详情面（工单 W7：番茄钟右栏的读侧）
 * ========================================
 *
 * 滴答的番茄钟右栏是**常驻**的：四张概览卡 + 一张"专注记录"列表，
 * 与选中了哪条任务无关。这一面此前不存在 —— 一条专注记录都没被逐条渲染过
 * （`listSessions()` 的唯一消费者只做当日汇总）。
 *
 * 🔴 这个组件里**一个数都不算**。四张卡的值全部来自
 * `@heyta/app-host#focusOverview`（当日 → `focusStatsForDay`、
 * 累计 → `activityTotalsFromState`、列表 → `listSessions()`），
 * 因为工单判据 ① 要的就是"卡上的数与领域函数逐字同源"，
 * 而判据 ③ 要的是"web 与 mobile 的今日专注时长来自同一个出口"。
 * 在这里 `reduce` 一遍，那两条就同时失效了 —— 而且是**静默**失效：
 * 界面看着对，两端的数在某个口径上已经开始分叉（AGENTS §3.5 记的就是这个症状）。
 *
 * ⚠️ 时长走 `../categories/copy.js#formatDuration`：它是 web 这一侧
 * 唯一把 `durationParts` 的三档映射成词条的地方。在这里再写一个
 * `web.focus.duration.*` 就是给同一条口径配第二套词，
 * 而那两条词此后必须永远同步改 —— 已登记在 §8 的边界里。
 */
import { useI18n, type Locale } from '@heyta/i18n';

import { formatDuration } from '../categories/copy.js';
import { useFocusStore } from './store.js';

/**
 * 记录行的时间戳。
 *
 * 与 `TrashView` / `ConflictDialog` / `ReminderPanel` 同一条理由：
 * 日期排布跟着语言走，写死 `'zh-CN'` 会让英文界面用中文习惯排日期。
 */
function formatRecordAt(ms: number, locale: Locale): string {
  return new Date(ms).toLocaleString(locale, {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function FocusDetailPane(): React.JSX.Element {
  const { t, locale } = useI18n();
  const overview = useFocusStore((s) => s.overview);

  return (
    <div className="ht-app__detail-focus" data-testid="focus-detail-pane">
      <h2 className="ht-app__detail-heading">{t('web.focus.detail.title')}</h2>

      <dl className="ht-app__detail-cards">
        <div className="ht-app__detail-card">
          <dt className="ht-app__detail-card-label ht-type-caption">{t('web.focus.detail.todayCount')}</dt>
          <dd className="ht-app__detail-card-value" data-testid="focus-card-today-count">
            {overview.todayCount}
          </dd>
        </div>
        <div className="ht-app__detail-card">
          <dt className="ht-app__detail-card-label ht-type-caption">{t('web.focus.detail.todayDuration')}</dt>
          <dd className="ht-app__detail-card-value" data-testid="focus-card-today-duration">
            {formatDuration(overview.todayFocusMs, t)}
          </dd>
        </div>
        <div className="ht-app__detail-card">
          <dt className="ht-app__detail-card-label ht-type-caption">{t('web.focus.detail.totalCount')}</dt>
          <dd className="ht-app__detail-card-value" data-testid="focus-card-total-count">
            {overview.totalCount}
          </dd>
        </div>
        <div className="ht-app__detail-card">
          <dt className="ht-app__detail-card-label ht-type-caption">{t('web.focus.detail.totalDuration')}</dt>
          <dd className="ht-app__detail-card-value" data-testid="focus-card-total-duration">
            {formatDuration(overview.totalFocusMs, t)}
          </dd>
        </div>
      </dl>

      <h3 className="ht-app__detail-heading">
        {t('web.focus.detail.records')}
      </h3>

      {overview.records.length === 0 ? (
        <p className="ht-app__detail-empty ht-type-row-meta" data-testid="focus-records-empty">
          {t('web.focus.detail.recordsEmpty')}
        </p>
      ) : (
        <ul className="ht-app__detail-records" data-testid="focus-records">
          {overview.records.map((record) => (
            <li className="ht-app__detail-record ht-type-row-meta" data-testid="focus-record" key={record.id}>
              <span className="ht-app__detail-record-time">
                {formatRecordAt(record.at, locale)}
              </span>
              <span className="ht-app__detail-record-duration">
                {formatDuration(record.actualMs, t)}
              </span>
              {/* 没关联任务时说的是"未关联"，不是留空 —— 留空读起来像数据丢了。 */}
              <span className="ht-app__detail-record-task">
                {record.taskTitle ?? t('web.focus.detail.unlinked')}
              </span>
              {record.completed ? null : (
                <span className="ht-app__detail-record-aborted ht-type-caption">
                  {t('web.focus.detail.aborted')}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
