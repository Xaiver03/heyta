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
  | 'common.date.monthTitle'
  | 'common.date.dayTitle'
  | 'common.date.weekRangeTitle';

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
