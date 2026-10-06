/**
 * 日历里的日期措辞（纯函数）
 * ============================
 *
 * 「2026年9月」与「9月26日 星期五」这两句话**只有这一个实现**。
 *
 * ## 🔴 为什么不是各端各写一份
 *
 * 在此之前移动端有一份（`apps/mobile/src/lib/date.ts`），而 web 要同日历时
 * 会写出第二份 —— 于是同一个日子在两处显示成「9月26日 星期五」和「9月26日 周五」。
 * 这种差异**不会有人报 bug**，它只会让应用显得不整齐。
 *
 * ⚠️ 而领域层的 `formatMonthTitle` / `formatDayTitle` **不能替代它**：
 * 那两个是**硬编码中文**的（`${yyyy}年${m}月`），没有 locale 参数，也刻意不用
 * `Intl`（Hermes 上 `Intl` 是可选依赖，拿不到时渲染中途抛异常 → 整屏白掉）。
 * 所以它们是"中文单语时代"的产物；双语之后，措辞必须走词条表。
 *
 * ## 🔴 本文件不 `import '@heyta/i18n'`，只声明 key 的**字面量联合**
 *
 * 这是本层的既定先例（见 `../auth/model.ts` 的 `AuthFailureMessageKey` 与
 * `../sync/model.ts` 的 `SyncFailureMessageKey`）：引 i18n 会拖进**第二份 React**，
 * 而两份 React 的 context 不共享 —— 症状是"语言切换在这个组件里不生效"。
 *
 * 类型上是安全的：`CalendarDateKey` 是 `MessageKey` 的**子集**，
 * 而函数参数是逆变的，所以宿主的 `t`（收 `MessageKey`）可以直接传进来。
 *
 * ## 为什么不用 `Intl.DateTimeFormat`
 *
 * 与领域层同一个理由：Hermes 上 `Intl` 是**可选编译进去的**，拿不到时
 * 构造它会在渲染中途抛异常 —— 表现为整屏白掉，且错误信息不会指向 Intl 缺失。
 * 这里用 `Date` 的基础 getter 手写，行为完全确定、无环境依赖。
 */

import {
  addDays,
  DAYS_PER_WEEK,
  isoWeekday,
  parseLocalDate,
  startOfWeek,
  type LocalDate,
} from '@heyta/domain';

/** 本模块用到的词条 key（`MessageKey` 的子集，见文件头）。 */
export type CalendarDateKey =
  | 'common.weekday.mon'
  | 'common.weekday.tue'
  | 'common.weekday.wed'
  | 'common.weekday.thu'
  | 'common.weekday.fri'
  | 'common.weekday.sat'
  | 'common.weekday.sun'
  | 'common.date.yearTitle'
  | 'common.date.monthTitle'
  | 'common.date.dayTitle'
  | 'common.date.weekRangeTitle'
  // 🔴 年档那 12 张月卡要的**短月份名**（zh「10月」/ en `Oct`）。
  //   它们**不是新抄件**：这一批 key 早已是仓里月份名的唯一一份，
  //   时间线（`TimelineViewLabels.monthNames`）与两个宿主都从它们建数组 ——
  //   移动端 `apps/mobile/src/lib/timeline-labels.ts:81` 读的也是 `web.board.month.*`。
  //   这里宁可让日历也读这批"名字带 web. 但两端都在用"的 key，
  //   也不给月份名开第三套（AGENTS §3.5 那条同形状的第二次）。
  //   ⚠️ 命名空间本身是个存量瑕疵（`web.*` 被 mobile 读），归并重排是另一步，
  //      已登记在 `docs/plans/calendar-year-time-and-mobile-profile.md` §5。
  | 'web.board.month.1'
  | 'web.board.month.2'
  | 'web.board.month.3'
  | 'web.board.month.4'
  | 'web.board.month.5'
  | 'web.board.month.6'
  | 'web.board.month.7'
  | 'web.board.month.8'
  | 'web.board.month.9'
  | 'web.board.month.10'
  | 'web.board.month.11'
  | 'web.board.month.12';

/**
 * 宿主注入的翻译函数。
 *
 * 🔴 形参类型是**本模块自己的 key 联合**，不是 `MessageKey` ——
 * 这一层不认识 i18n 包（见文件头）。宿主的 `t` 能直接传：它的形参更宽。
 */
export type CalendarTranslate = (
  key: CalendarDateKey,
  vars?: Record<string, string | number>,
) => string;

/**
 * 周几 → 词条 key。
 *
 * 🔴 用 `switch` 而不是数组下标：`isoWeekday` 的返回类型是 `number`，
 * 而在 `noUncheckedIndexedAccess` 下数组下标访问永远是 `T | undefined` ——
 * 那会逼出一句"兜底到周一"的死代码（实际永远走不到）。
 * `switch` 的 `default` 覆盖的是 7（周日），不是"意外值"。
 *
 * 导出它是因为**别处也要拼"周几"**（任务列表的日期分组头「今天, 周三」）——
 * 那边自己写一份 switch，迟早有一边改了措辞另一边没跟上。
 */
export function weekdayMessageKey(weekday: number): CalendarDateKey {
  switch (weekday) {
    case 1:
      return 'common.weekday.mon';
    case 2:
      return 'common.weekday.tue';
    case 3:
      return 'common.weekday.wed';
    case 4:
      return 'common.weekday.thu';
    case 5:
      return 'common.weekday.fri';
    case 6:
      return 'common.weekday.sat';
    default:
      return 'common.weekday.sun';
  }
}

/**
 * 一周列头（周一…周日）的词条 key，**下标 0 = 周一**。
 *
 * 🔴 与领域层的 `WEEKDAY_LABELS` **同序**：`monthGrid` 是周一开头，
 * 只要这里写成周日开头，整个日历会**整体错位一格** —— 而错位后的界面
 * 看上去仍然像个正常日历。所以顺序由 `isoWeekday` 的 1..7 生成，**不手写数组**。
 */
export const WEEKDAY_MESSAGE_KEYS: readonly CalendarDateKey[] = [1, 2, 3, 4, 5, 6, 7].map(
  weekdayMessageKey,
);

/** 「2026年9月」——年份与月份由领域层的 `LocalDate` 解出，措辞走词条。 */
export function formatMonthTitleText(date: LocalDate, t: CalendarTranslate): string {
  const d = parseLocalDate(date);
  return t('common.date.monthTitle', { year: d.getFullYear(), month: d.getMonth() + 1 });
}

/** 「9月26日 星期五」。 */
export function formatDayTitleText(date: LocalDate, t: CalendarTranslate): string {
  const d = parseLocalDate(date);
  return t('common.date.dayTitle', {
    month: d.getMonth() + 1,
    day: d.getDate(),
    weekday: t(weekdayMessageKey(isoWeekday(date))),
  });
}

/**
 * 月份（1..12）→ 词条 key。
 *
 * 🔴 与 `weekdayMessageKey` 同一个理由用 `switch`：在 `noUncheckedIndexedAccess` 下
 *   数组下标访问永远是 `T | undefined`，那会逼出一句永远走不到的兜底。
 *   入参是**人读的 1..12**（与 `daysInMonth` 同一条口径），不是 JS `Date` 的 0..11 ——
 *   差一格的症状是"每张月卡顶上写的月份都比实际早一个月"，而它看着仍是张日历。
 */
export function monthMessageKey(month: number): CalendarDateKey {
  switch (month) {
    case 1:
      return 'web.board.month.1';
    case 2:
      return 'web.board.month.2';
    case 3:
      return 'web.board.month.3';
    case 4:
      return 'web.board.month.4';
    case 5:
      return 'web.board.month.5';
    case 6:
      return 'web.board.month.6';
    case 7:
      return 'web.board.month.7';
    case 8:
      return 'web.board.month.8';
    case 9:
      return 'web.board.month.9';
    case 10:
      return 'web.board.month.10';
    case 11:
      return 'web.board.month.11';
    default:
      return 'web.board.month.12';
  }
}

/** 月卡顶上的短月份名（zh「10月」/ en `Oct`）。 */
export function formatMonthShortText(date: LocalDate, t: CalendarTranslate): string {
  return t(monthMessageKey(parseLocalDate(date).getMonth() + 1));
}

/**
 * 「2026年」—— 年档的标题。
 *
 * 🔴 不能拿 `formatMonthTitleText` 顶：年档摊开 12 个月，标题却指着一个月。
 *   措辞在词条里（`common.date.yearTitle`），英文那侧就是裸年份。
 */
export function formatYearTitleText(date: LocalDate, t: CalendarTranslate): string {
  return t('common.date.yearTitle', { year: parseLocalDate(date).getFullYear() });
}

/**
 * 周视图的标题：「2026年10月26日 – 11月1日」。
 *
 * 🔴 入参是**这一周里的任意一天**（与 `weekGrid` / 游标的约定一致），
 *   周一与周日由 `startOfWeek` + 6 天现算 —— 不在这里再定一次"周从哪天开始"。
 *   年份只出现一次（在开头），因为跨年那一周（12/29 – 1/4）里
 *   "12月29日"和"1月4日"属于两个年份，写两遍反而读不出哪个是"这一周的年"。
 */
export function formatWeekRangeText(date: LocalDate, t: CalendarTranslate): string {
  const start = startOfWeek(date);
  const end = addDays(start, DAYS_PER_WEEK - 1);
  const sd = parseLocalDate(start);
  const ed = parseLocalDate(end);
  return t('common.date.weekRangeTitle', {
    year: sd.getFullYear(),
    startMonth: sd.getMonth() + 1,
    startDay: sd.getDate(),
    endMonth: ed.getMonth() + 1,
    endDay: ed.getDate(),
  });
}
