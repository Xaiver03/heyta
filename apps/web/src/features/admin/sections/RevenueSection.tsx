import { useI18n } from '@heyta/i18n/provider';

import type { AdminStoreState } from '../store.js';

import { AdminEmpty, Stat, formatMoney, formatTime } from './shared.js';

/** `formatTime` 的前十个字符 = 本地日 `YYYY-MM-DD`。 */
function formatDay(ms: number): string {
  return formatTime(ms).slice(0, 10);
}

/** 分钟偏移 → `UTC+8` / `UTC-5` / `UTC+0`。界面要说的是"哪一天算一天"，不是符号学。 */
function utcOffsetLabel(offsetMinutes: number): string {
  const sign = offsetMinutes < 0 ? '-' : '+';
  return `UTC${sign}${String(Math.abs(offsetMinutes) / 60)}`;
}

/** 可选的聚合窗口。三档是刻意的窄集：再多一档就没人点了。 */
const REVENUE_WINDOWS: readonly number[] = [30, 90, 365];

/** 明细表最多列这么多天（有活动的那些）。 */
const REVENUE_DETAIL_ROWS = 14;

/**
 * 营收看板。
 *
 * 🔴 这里**一个数都不算**。逐日分桶、日界按哪个时区裁、净收入怎么折、
 * 币种能不能相加 —— 全部来自 `/api/admin/revenue` 的响应体
 * （`server/src/admin/admin.routes.ts`）。本组件只做两件事：把服务端给的
 * 数字画出来，以及把"窗口"这个参数发回去。
 *
 * ⚠️ **没有跨币种合计**，因为那不是一个合法的数（混币求和是"错得很像真的"
 * 那一类）。界面因此按币种各一段，而不是给一个大总数。
 */
export function RevenueSection({ store }: { store: AdminStoreState }): React.JSX.Element {
  const { t } = useI18n();
  const revenue = store.revenue;

  // `null` 是"还没问"，不是"没有营收" —— 这一格只可能出现在切过来的那一瞬。
  if (revenue === null) return <p className="ht-settings__hint">{t('web.admin.loading')}</p>;

  if (revenue.series.length === 0) {
    return <AdminEmpty titleKey="web.admin.revenue.noneFound" />;
  }

  return (
    <div data-testid="admin-revenue">
      <div className="ht-settings__admin-tabs" role="group" aria-label={t('web.admin.revenue.window')}>
        {REVENUE_WINDOWS.map((days) => (
          <button
            key={days}
            type="button"
            className={`ht-settings__admin-tab${store.revenueDays === days ? ' ht-settings__admin-tab--active' : ''}`}
            aria-pressed={store.revenueDays === days}
            onClick={() => void store.loadRevenue(days)}
          >
            {t('web.admin.revenue.days', { count: days })}
          </button>
        ))}
      </div>

      {/* 日界是按这台设备的时区裁的 —— 这句话必须写在图上，
          否则读图的人会默认它是服务器那个时区，而两者差几个小时。 */}
      <p className="ht-settings__hint">
        {t('web.admin.revenue.tzNote', { offset: utcOffsetLabel(revenue.window.offsetMinutes) })}
      </p>

      {revenue.series.map((series) => {
        const peak = Math.max(
          1,
          ...series.points.map((point) => Math.max(point.paidMinor, point.refundedMinor)),
        );
        const activeDays = series.points
          .filter((point) => point.paidMinor > 0 || point.refundedMinor > 0)
          .slice(-REVENUE_DETAIL_ROWS)
          .reverse();
        const barHeight = (value: number): number => (value / peak) * 100;

        return (
          <section
            key={series.currency}
            className="ht-settings__admin-revenueGroup"
            data-testid={`admin-revenue-${series.currency}`}
          >
            <h4 className="ht-settings__admin-h">{series.currency}</h4>

            <div className="ht-settings__admin-stats">
              <Stat
                labelKey="web.admin.revenue.paid"
                value={formatMoney(series.totalPaidMinor, series.currency)}
              />
              <Stat
                labelKey="web.admin.revenue.refunded"
                value={formatMoney(series.totalRefundedMinor, series.currency)}
              />
              <Stat
                labelKey="web.admin.revenue.net"
                value={formatMoney(series.totalNetMinor, series.currency)}
              />
              <Stat labelKey="web.admin.revenue.paidOrders" value={series.totalPaidOrders} />
              <Stat
                labelKey="web.admin.revenue.refundedOrders"
                value={series.totalRefundedOrders}
              />
            </div>

            <svg
              className="ht-settings__admin-revenueChart"
              viewBox={`0 0 ${String(series.points.length)} 100`}
              preserveAspectRatio="none"
              role="img"
              aria-label={t('web.admin.revenue.chartLabel', {
                currency: series.currency,
                days: String(revenue.window.days),
              })}
            >
              {series.points.map((point, index) => (
                // 一根柱子两窄条：左进账、右退款。不叠在一起 —— 叠加会把
                // "退了 30%"读成"收了 130%"，而这两件事的差才是净收入。
                <g key={point.dayMs}>
                  <rect
                    className="ht-settings__admin-revenueBarPaid"
                    x={index + 0.12}
                    y={100 - barHeight(point.paidMinor)}
                    width={0.36}
                    height={barHeight(point.paidMinor)}
                  >
                    <title>
                      {t('web.admin.revenue.day', {
                        day: formatDay(point.dayMs),
                        paid: formatMoney(point.paidMinor, series.currency),
                        refunded: formatMoney(point.refundedMinor, series.currency),
                      })}
                    </title>
                  </rect>
                  <rect
                    className="ht-settings__admin-revenueBarRefunded"
                    x={index + 0.52}
                    y={100 - barHeight(point.refundedMinor)}
                    width={0.36}
                    height={barHeight(point.refundedMinor)}
                  />
                </g>
              ))}
            </svg>

            {activeDays.length === 0 ? (
              <p className="ht-settings__hint">{t('web.admin.revenue.noneFound')}</p>
            ) : (
              <div className="ht-settings__admin-list" data-testid={`admin-revenue-rows-${series.currency}`}>
                {activeDays.map((point) => (
                  <div key={point.dayMs} className="ht-settings__admin-row">
                    <span className="ht-settings__admin-rowMain">{formatDay(point.dayMs)}</span>
                    <span className="ht-settings__admin-static">
                      {t('web.admin.revenue.rowPaid', {
                        paid: formatMoney(point.paidMinor, series.currency),
                        orders: String(point.paidOrders),
                      })}
                    </span>
                    <span className="ht-settings__admin-static">
                      {t('web.admin.revenue.rowRefunded', {
                        refunded: formatMoney(point.refundedMinor, series.currency),
                        orders: String(point.refundedOrders),
                      })}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
