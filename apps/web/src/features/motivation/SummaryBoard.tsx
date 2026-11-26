/**
 * 总结屏（覆盖图谱 #16：今天 / 本周的收尾总结 + 可复制的总结文本）
 * ================================================================
 *
 * 成长页（`GrowthView`）此前只有「周复盘 → 年度热力 → …」，**没有一个把
 * "今天/本周做了多少"收在一处、并能一键复制的总结面**。这一块补的就是它：
 *   · 今天 / 本周两段数字：完成任务数 · 专注时长 · 习惯打卡；
 *   · 一段可复制的纯文本总结（粘到日记/汇报里就是"今天的收尾"）。
 *
 * 🔴 数字全部来自 `@heyta/app-host#summaryFromState`（口径复用
 * `computeTodayProgress` / `computeWeeklyReview` + 今日打卡计数），
 * 这里一个数都不自己算。文本在这里用 `t()` 拼（表现层，宿主的事）。
 *
 * ⚠️ 复制走 `navigator.clipboard`：非安全上下文（http 访问局域网地址）里它是
 * `undefined`，必须 reject 而不是吞掉 —— 否则"点了没反应"会被读成按钮坏了。
 */
import { useState } from 'react';

import type { SummarySnapshot } from '@heyta/app-host';
import { useI18n } from '@heyta/i18n';

export interface SummaryBoardProps {
  readonly snapshot: SummarySnapshot;
}

export function SummaryBoard({ snapshot }: SummaryBoardProps): React.JSX.Element {
  const { t } = useI18n();
  const [status, setStatus] = useState<'idle' | 'copied' | 'failed'>('idle');

  const todayLine = t('web.summary.line.today', {
    tasks: snapshot.today.tasksDone,
    minutes: snapshot.today.focusMinutes,
    checkIns: snapshot.today.checkIns,
  });
  const weekLine = t('web.summary.line.week', {
    tasks: snapshot.week.tasksDone,
    minutes: snapshot.week.focusMinutes,
    checkIns: snapshot.week.checkIns,
  });
  const text = `${todayLine}\n${weekLine}`;

  const copy = async (): Promise<void> => {
    try {
      if (navigator.clipboard === undefined) throw new Error('no-clipboard');
      await navigator.clipboard.writeText(text);
      setStatus('copied');
    } catch {
      setStatus('failed');
    }
  };

  return (
    <section className="ht-summary" data-testid="growth-summary">
      <h2 className="ht-app__detail-heading">{t('web.summary.title')}</h2>
      <div className="ht-summary__periods">
        <div>
          <h3 className="ht-app__detail-heading">{t('web.summary.today')}</h3>
          <dl className="ht-app__detail-cards">
            <div className="ht-app__detail-card">
              <dt className="ht-app__detail-card-label ht-type-caption">{t('web.summary.tasks')}</dt>
              <dd className="ht-app__detail-card-value" data-testid="summary-today-tasks">
                {snapshot.today.tasksDone}
              </dd>
            </div>
            <div className="ht-app__detail-card">
              <dt className="ht-app__detail-card-label ht-type-caption">{t('web.summary.focus')}</dt>
              <dd className="ht-app__detail-card-value" data-testid="summary-today-focus">
                {t('web.summary.minutes', { minutes: snapshot.today.focusMinutes })}
              </dd>
            </div>
            <div className="ht-app__detail-card">
              <dt className="ht-app__detail-card-label ht-type-caption">{t('web.summary.checkIns')}</dt>
              <dd className="ht-app__detail-card-value" data-testid="summary-today-checkins">
                {snapshot.today.checkIns}
              </dd>
            </div>
          </dl>
        </div>
        <div>
          <h3 className="ht-app__detail-heading">{t('web.summary.week')}</h3>
          <dl className="ht-app__detail-cards">
            <div className="ht-app__detail-card">
              <dt className="ht-app__detail-card-label ht-type-caption">{t('web.summary.tasks')}</dt>
              <dd className="ht-app__detail-card-value" data-testid="summary-week-tasks">
                {snapshot.week.tasksDone}
              </dd>
            </div>
            <div className="ht-app__detail-card">
              <dt className="ht-app__detail-card-label ht-type-caption">{t('web.summary.focus')}</dt>
              <dd className="ht-app__detail-card-value" data-testid="summary-week-focus">
                {t('web.summary.minutes', { minutes: snapshot.week.focusMinutes })}
              </dd>
            </div>
            <div className="ht-app__detail-card">
              <dt className="ht-app__detail-card-label ht-type-caption">{t('web.summary.checkIns')}</dt>
              <dd className="ht-app__detail-card-value" data-testid="summary-week-checkins">
                {snapshot.week.checkIns}
              </dd>
            </div>
          </dl>
        </div>
      </div>

      <p className="ht-summary__text ht-type-row-meta" data-testid="summary-text">
        {text}
      </p>
      <div className="ht-summary__actions">
        <button type="button" className="ht-btn ht-btn--secondary" onClick={() => { void copy(); }}>
          {status === 'copied'
            ? t('web.summary.copied')
            : status === 'failed'
              ? t('web.summary.failed')
              : t('web.summary.copy')}
        </button>
      </div>
    </section>
  );
}
