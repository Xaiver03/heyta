import { useI18n } from '@heyta/i18n/provider';

import type { AdminStoreState } from '../store.js';

import { DataTable, MetricGrid, StatCard, Tabs } from '../../../components/hta/index.js';

import { AdminEmpty, formatMoney, formatTime } from './shared.js';

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
      <Tabs
        tabs={REVENUE_WINDOWS.map((days) => ({
          key: String(days),
          label: t('web.admin.revenue.days', { count: days }),
        }))}
        value={String(store.revenueDays)}
        onChange={(key) => {
          void store.loadRevenue(Number(key));
        }}
        label={t('web.admin.revenue.window')}
        panelId="admin-revenue-panel"
        testID="admin-revenue-window"
      />

      {/* 日界是按这台设备的时区裁的 —— 这句话必须写在图上，
          否则读图的人会默认它是服务器那个时区，而两者差几个小时。 */}
      <p className="ht-settings__hint">
        {t('web.admin.revenue.tzNote', { offset: utcOffsetLabel(revenue.window.offsetMinutes) })}
      </p>

      <div id="admin-revenue-panel" role="tabpanel" aria-label={t('web.admin.revenue.window')}>
        {revenue.series.map((series) => {
          const peak = Math.max(
            1,
            ...series.points.map((point) => Math.max(point.paidMinor, point.refundedMinor)),
          );
          // 🔴 明细就是"后端给的每一天"：不过滤、不截断。零日必须留在表里 ——
          //    "这一天有 0 笔"与"这一天不在窗口里"是两件事，吞掉零日等于改写了
          //    后端特意逐日铺满的意图。最新的一天放最上面，读起来顺。
          const detailRows = [...series.points].reverse();
          const barHeight = (value: number): number => (value / peak) * 100;

          return (
            <section
              key={series.currency}
              className="ht-settings__admin-revenueGroup"
              data-testid={`admin-revenue-${series.currency}`}
            >
              <h4 className="ht-settings__admin-h">{series.currency}</h4>

              <MetricGrid>
                <StatCard
                  label={t('web.admin.revenue.paid')}
                  value={formatMoney(series.totalPaidMinor, series.currency)}
                />
                <StatCard
                  label={t('web.admin.revenue.refunded')}
                  value={formatMoney(series.totalRefundedMinor, series.currency)}
                />
                <StatCard
                  label={t('web.admin.revenue.net')}
                  value={formatMoney(series.totalNetMinor, series.currency)}
                  tone={series.totalNetMinor < 0 ? 'danger' : 'default'}
                />
                <StatCard
                  label={t('web.admin.revenue.paidOrders')}
                  value={series.totalPaidOrders}
                />
                <StatCard
                  label={t('web.admin.revenue.refundedOrders')}
                  value={series.totalRefundedOrders}
                />
              </MetricGrid>

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
                    >
                      {/* 两根柱都得能单独读出来：退款柱原来没有 <title>，
                          指针落上去只剩沉默，等于图上少了一半信息。 */}
                      <title>
                        {t('web.admin.revenue.day', {
                          day: formatDay(point.dayMs),
                          paid: formatMoney(point.paidMinor, series.currency),
                          refunded: formatMoney(point.refundedMinor, series.currency),
                        })}
                      </title>
                    </rect>
                  </g>
                ))}
              </svg>

              {/* 图的时间刻度：起止两天。图上不画轴，这一行给出"横轴覆盖哪一段"。 */}
              <p className="ht-settings__hint">
                {formatDay(revenue.window.fromMs)} – {formatDay(revenue.window.toMs)}
              </p>

              {/* 🔴 这张表同时是图的**可降级数值表**：图读不出来（窄屏/读屏/色弱）时，
                  每一天的进账、退款、单数都在这里，逐日不缺零日。 */}
              <DataTable
                columns={[
                  {
                    key: 'day',
                    header: t('web.admin.revenue.col.day'),
                    render: (point) => formatDay(point.dayMs),
                  },
                  {
                    key: 'paid',
                    header: t('web.admin.revenue.paid'),
                    align: 'end',
                    render: (point) => formatMoney(point.paidMinor, series.currency),
                  },
                  {
                    key: 'paidOrders',
                    header: t('web.admin.revenue.paidOrders'),
                    align: 'end',
                    render: (point) => point.paidOrders,
                  },
                  {
                    key: 'refunded',
                    header: t('web.admin.revenue.refunded'),
                    align: 'end',
                    render: (point) => formatMoney(point.refundedMinor, series.currency),
                  },
                  {
                    key: 'refundedOrders',
                    header: t('web.admin.revenue.refundedOrders'),
                    align: 'end',
                    render: (point) => point.refundedOrders,
                  },
                ]}
                rows={detailRows}
                rowKey={(point) => String(point.dayMs)}
                emptyTitle={t('web.admin.revenue.noneFound')}
                caption={t('web.admin.revenue.chartLabel', {
                  currency: series.currency,
                  days: String(revenue.window.days),
                })}
                testID={`admin-revenue-rows-${series.currency}`}
              />
            </section>
          );
        })}
      </div>
    </div>
  );
}
