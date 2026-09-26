/**
 * 日期展示（纯函数）
 * ==================
 *
 * 🔴 这里只放**展示格式化**，"哪一天"的数学在 `@heyta/domain`。
 *
 * `startOfDay` / `daysBetween` / `DAY_MS` / `dayRange` 原本在这个文件里
 * 各实现了一份 —— 而 `packages/domain/src/date.ts` 早就有同一套本地日期语义。
 * 两份实现的危险不在于当下不一致，而在于**将来会不一致**：
 * 一端按本地时区切天、另一端哪天顺手改成 UTC，症状是
 * "手机说今天到期、网页说明天到期"，而且没有任何一处报错。
 *
 * 所以按 AGENTS.md §3.5 的收尾方式处理：**上移、删掉旧的那份、改调用方**，
 * 而不是在本文件里转发一层（转发会让下一个人以为这里还是定义处）。
 *
 * ⚠️ 本轮同理删掉了 `formatDue` / `isOverdue`：它们已经是**死代码**
 * （移动端唯一的使用者早已改走 `lib/due-display.ts`），却各自带着一份
 * 与领域层不同口径的中文文案（`已过期` vs `已逾期`、`N 天后` vs `还剩 N 天`）。
 * 留着它就是留着"第二份会漂移的实现"，而这次迁移正好要让
 * "剩余天数怎么说"只有一处定义。用例搬去了 `tests/date.spec.ts` 的
 * `remainingText`（边界改为与领域层同一套阈值）。
 *
 * 本文件**不用 `Intl.DateTimeFormat`**：
 * Hermes 上 Intl 是**可选编译进去的**，拿不到时 `new Intl.DateTimeFormat()`
 * 会在渲染中途抛异常 —— 表现为整屏白掉，且错误信息不会指向 Intl 缺失。
 * 这里用 `Date` 的基础 getter 手写，行为完全确定、无环境依赖。
 */

import { addDays, isoWeekday, parseLocalDate, toLocalDate, type LocalDate } from '@heyta/domain';
import type { MessageKey } from '@heyta/i18n';

import type { Translate } from '../i18n/translate';

/**
 * 绝对时刻，如 `9-26 00:31`。
 *
 * 用于"某某事发生在什么时候"这类**必须精确**的地方（上次同步、冲突双方的改动时间）。
 * 纯数字，不含语言，所以不走词条表。
 */
export function formatStamp(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${String(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * 周几 → 词条 key。
 *
 * 🔴 用 `switch` 而不是数组下标：`isoWeekday` 的返回类型是 `number`，
 * 而在 `noUncheckedIndexedAccess` 下数组下标访问永远是 `T | undefined` ——
 * 那会逼出一句"兜底到周一"的死代码（实际永远走不到）。
 * `switch` 的 `default` 覆盖的是 7（周日），不是"意外值"。
 */
function weekdayKey(weekday: number): MessageKey {
  switch (weekday) {
    case 1:
      return 'mobile.weekday.mon';
    case 2:
      return 'mobile.weekday.tue';
    case 3:
      return 'mobile.weekday.wed';
    case 4:
      return 'mobile.weekday.thu';
    case 5:
      return 'mobile.weekday.fri';
    case 6:
      return 'mobile.weekday.sat';
    default:
      return 'mobile.weekday.sun';
  }
}

/**
 * 一周列头（周一…周日）的词条 key，下标 0 = 周一。
 *
 * 与领域层的 `WEEKDAY_LABELS` **同序**：`monthGrid` 是周一开头，
 * 只要这里写成周日开头，整个日历会整体错位一格 —— 而错位后的界面
 * 看上去仍然像个正常日历。所以顺序由 `isoWeekday` 的 1..7 生成，
 * 不手写数组。
 */
export const WEEKDAY_MESSAGE_KEYS: readonly MessageKey[] = [1, 2, 3, 4, 5, 6, 7].map(
  weekdayKey,
);

/** 「2026年9月」——年份与月份由领域层的 `LocalDate` 解出，措辞走词条。 */
export function formatMonthTitleText(date: LocalDate, t: Translate): string {
  const d = parseLocalDate(date);
  return t('mobile.calendar.monthTitle', { year: d.getFullYear(), month: d.getMonth() + 1 });
}

/** 「9月26日 星期五」——某一天的标题只有这一个实现（与领域层同一份日期语义）。 */
export function formatDayTitleText(date: LocalDate, t: Translate): string {
  const d = parseLocalDate(date);
  return t('mobile.calendar.dayTitle', {
    month: d.getMonth() + 1,
    day: d.getDate(),
    weekday: t(weekdayKey(isoWeekday(date))),
  });
}

/** 定时器下限（毫秒）。设备时钟被回拨时下一个零点可能算到 `now` 之前。 */
const MIN_TICK_DELAY_MS = 1000;

/**
 * 距离下一个**本地零点**还有多少毫秒。
 *
 * 🔴 用 `addDays` + `parseLocalDate`，**不是**"当前时刻 + 24 小时"：
 * 夏令时切换的那两天，一个本地日不是 86400000 毫秒，
 * 直接加常数会让定时器落在零点**错误的一侧** —— 要么早一小时（那天少刷新一次），
 * 要么晚一小时（跨零点后界面还显示昨天）。
 * 跟着本地日界线走，夏令时自动正确。
 *
 * 时钟被回拨等异常情况下返回值可能 ≤ 0，用下限夹住，
 * 否则 `setTimeout(…, 0)` 会变成忙循环。
 */
export function msUntilNextMidnight(now: number): number {
  const next = parseLocalDate(addDays(toLocalDate(now), 1)).getTime();
  return Math.max(next - now, MIN_TICK_DELAY_MS);
}
