/**
 * 专注详情面（工单 W7：番茄钟右栏的读侧）
 * ========================================
 *
 * 滴答的番茄钟右栏是**常驻**的，与选中了哪条任务无关。这一面此前不存在 ——
 * 一条专注记录都没被逐条渲染过（`listSessions()` 的唯一消费者只做当日汇总）。
 *
 * 🔴 这个组件里**一个数都不算**。所有读数来自 `@heyta/app-host#focusOverview`
 * （当日 → `focusStatsForDay`、累计 → `activityTotalsFromState`、
 * 列表 → `listSessions()`、七日脉搏与能量条档位 → `intensityLevel`），
 * 因为工单判据 ① 要的就是"卡上的数与领域函数逐字同源"，
 * 而判据 ③ 要的是"web 与 mobile 的今日专注时长来自同一个出口"。
 * 在这里 `reduce` 一遍，那两条就同时失效了 —— 而且是**静默**失效。
 *
 * ── 为什么不是四张一样的卡 ────────────────────────────────────────
 * 原来那版是 2×2 四个同款灰框：**今日实时**与**历史累计**拿到了一模一样的视觉权重。
 * 这两件事的阅读频率差一个量级 —— 今天做了多少是每次打开都要看的，
 * 累计是偶尔瞟一眼的账。所以现在分三层：
 *
 *   ① **今日 Hero**：今日番茄 + 今日专注时长，主色大号读数，卡片本身带色；
 *   ② **七日脉搏**：hero 底部一排强度格，今天在最右 —— 给"今天"一个参照系；
 *   ③ **累计账本**：一行紧凑的左右对齐，明确降级，与 hero 形成层级差。
 *
 * ⚠️ 时长走 `../categories/copy.js#formatDuration`：它是 web 这一侧
 * 唯一把 `durationParts` 的三档映射成词条的地方。在这里再写一个
 * `web.focus.duration.*` 就是给同一条口径配第二套词。
 */
import { useI18n, type I18nValue, type Locale } from '@heyta/i18n';
import { EmptyState, HeytaUiProvider, weekdayMessageKey } from '@heyta/ui';
import { isoWeekday, type LocalDate } from '@heyta/domain';

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

/**
 * 脉冲格的无障碍名。
 *
 * 🔴 格子本身是**颜色**，而"不许只用颜色表达信息"（AGENTS §5）的落点是：
 * 每一格都有一句能被读出来的文字事实。所以这里拼的是"周几 + 时长"，
 * 而不是"格子 3"。周几的词条复用 `common.weekday.*`（与日历列头同一份），
 * 不新开一套 —— 两套"周几"迟早有一边改了另一边没跟上。
 */
function pulseLabel(date: LocalDate, focusMs: number, t: I18nValue['t']): string {
  const weekday = t(weekdayMessageKey(isoWeekday(date)));
  return t('web.focus.detail.pulseDay', { weekday, duration: formatDuration(focusMs, t) });
}

export function FocusDetailPane(): React.JSX.Element {
  const { t, locale } = useI18n();
  const overview = useFocusStore((s) => s.overview);

  return (
    <div className="ht-app__detail-focus" data-testid="focus-detail-pane">
      <h2 className="ht-app__detail-heading">{t('web.focus.detail.title')}</h2>

      {/*
        ① 今日 Hero。两格并排但**不是**两张卡：同一块底色、同一条基线，
        只有一条细分隔线 —— 它们是同一个问题的两个面（做了几轮 / 做了多久）。
        `dl` 保留语义：这是"名称 → 值"的对，不是装饰性排版。
      */}
      <dl className="ht-app__detail-hero">
        <div className="ht-app__detail-hero-cell">
          <dt className="ht-app__detail-hero-label ht-type-caption">
            {t('web.focus.detail.todayCount')}
          </dt>
          <dd
            className="ht-app__detail-hero-value ht-type-numeric-summary"
            data-testid="focus-card-today-count"
          >
            {overview.todayCount}
          </dd>
        </div>
        <div className="ht-app__detail-hero-cell">
          <dt className="ht-app__detail-hero-label ht-type-caption">
            {t('web.focus.detail.todayDuration')}
          </dt>
          <dd
            className="ht-app__detail-hero-value ht-type-numeric-summary"
            data-testid="focus-card-today-duration"
          >
            {formatDuration(overview.todayFocusMs, t)}
          </dd>
        </div>
      </dl>

      {/*
        ② 七日脉搏。`days` 为空 = 引擎还没就绪（`EMPTY_OVERVIEW`），此时整条不画：
        七根空柱子会让人以为"这周什么都没做"，而真相是"还没读到"。
        🔴 强度走 `data-level` 属性而不是内联 style —— 颜色映射在 CSS 里
        （`--ht-color-heat-0..4`），内联样式有配额（`check:l4` 断言 C）。
      */}
      {overview.days.length === 0 ? null : (
        <ul className="ht-app__detail-pulse" data-testid="focus-pulse">
          {overview.days.map((day) => (
            <li
              className="ht-app__detail-pulse-day"
              data-level={day.level}
              data-testid="focus-pulse-day"
              key={day.date}
              // 今天那一格在视觉上要被认出来（不是靠多一个标签）：末位即今天。
              data-today={day.date === overview.days[overview.days.length - 1]?.date ? '' : undefined}
            >
              <span className="ht-app__detail-pulse-bar" aria-hidden="true" />
              <span className="ht-app__detail-pulse-legend">{pulseLabel(day.date, day.focusMs, t)}</span>
            </li>
          ))}
        </ul>
      )}

      {/*
        ③ 累计账本。刻意**不是**卡片：没有底色、没有边框、一行左右对齐，
        与上面的 hero 形成"实时 vs 账本"的层级差。这两个数不该跟今日抢注意力。
      */}
      <dl className="ht-app__detail-ledger">
        <div className="ht-app__detail-ledger-row">
          <dt className="ht-app__detail-ledger-label ht-type-row-meta">
            {t('web.focus.detail.totalCount')}
          </dt>
          <dd className="ht-app__detail-ledger-value" data-testid="focus-card-total-count">
            {overview.totalCount}
          </dd>
        </div>
        <div className="ht-app__detail-ledger-row">
          <dt className="ht-app__detail-ledger-label ht-type-row-meta">
            {t('web.focus.detail.totalDuration')}
          </dt>
          <dd className="ht-app__detail-ledger-value" data-testid="focus-card-total-duration">
            {formatDuration(overview.totalFocusMs, t)}
          </dd>
        </div>
      </dl>

      <h3 className="ht-app__detail-heading">{t('web.focus.detail.records')}</h3>

      {overview.records.length === 0 ? (
        // 空态走**共享那一个实现**（`packages/ui` 的 `EmptyState`），不在视图里手写
        // 骨架与文案 —— `scripts/check-empty-state.mjs` 断言 B 拦的就是手写。
        // `size="section"`：这是"卡片里的一行占位"，不是整页空态；沿用页面档会把
        // 详情面撑出一大块居中空白，那是视觉回归，也会画出页面档才有的插画
        //（`GRAPHICS_SIZES` 只含 `page`）。
        // ⚠️ `testID` 必须传：两端的既有钩子都写在空态根节点上，不传则 e2e 的
        //    `getByTestId('focus-records-empty')` 与 jsdom 用例**同时**失去定位点。
        // 🔴 `<HeytaUiProvider>` 包在这一处（同 `AdminPanel.tsx`）：共享 `EmptyState`
        //    从 context 取 token 与文字样式，缺了它在**运行时**抛「useHeytaUiTheme 必须在
        //    <HeytaUiProvider> 内使用」，而类型检查和单测都不会红。
        <HeytaUiProvider>
          <EmptyState
            size="section"
            title={t('web.focus.detail.recordsEmpty')}
            testID="focus-records-empty"
          />
        </HeytaUiProvider>
      ) : (
        /*
          ④ 记录 = 时间线，不是平铺的列表。
          每行左边一个状态节点（完成 = 实心，放弃 = 空心环），
          中间是任务名与时间，右边是时长 + 一条能量条。
          🔴 能量条让"25 分钟"和"50 分钟"一眼分得开 —— 原来两行字排在一起，
          差一倍时长得靠读数字才看得出来，而这一栏的作用正是"扫一眼就知道今天怎么过的"。
        */
        <ul className="ht-app__detail-records" data-testid="focus-records">
          {overview.records.map((record) => (
            <li
              className="ht-app__detail-record"
              data-testid="focus-record"
              data-completed={record.completed ? '' : undefined}
              key={record.id}
            >
              <span className="ht-app__detail-record-node" aria-hidden="true" />
              <div className="ht-app__detail-record-body">
                {/* 没关联任务时说的是"未关联"，不是留空 —— 留空读起来像数据丢了。 */}
                <span className="ht-app__detail-record-task ht-type-row-meta">
                  {record.taskTitle ?? t('web.focus.detail.unlinked')}
                </span>
                <span className="ht-app__detail-record-time ht-type-caption">
                  {formatRecordAt(record.at, locale)}
                </span>
              </div>
              <div className="ht-app__detail-record-tail">
                <span className="ht-app__detail-record-duration ht-type-row-meta">
                  {formatDuration(record.actualMs, t)}
                </span>
                {record.completed ? null : (
                  <span className="ht-app__detail-record-aborted ht-type-caption">
                    {t('web.focus.detail.aborted')}
                  </span>
                )}
                <span
                  className="ht-app__detail-record-energy"
                  data-level={record.energyLevel}
                  aria-hidden="true"
                >
                  <span className="ht-app__detail-record-energy-fill" />
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
