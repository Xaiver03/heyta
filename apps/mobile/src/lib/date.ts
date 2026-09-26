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
 * 本文件**不用 `Intl.DateTimeFormat`**：
 * Hermes 上 Intl 是**可选编译进去的**，拿不到时 `new Intl.DateTimeFormat()`
 * 会在渲染中途抛异常 —— 表现为整屏白掉，且错误信息不会指向 Intl 缺失。
 * 这里用 `Date` 的基础 getter 手写，行为完全确定、无环境依赖。
 */

import { addDays, daysBetween, parseLocalDate, startOfDay, toLocalDate } from '@heyta/domain';

/**
 * 相对"今天"的自然语言日期。用于任务行的次要信息。
 *
 * 🔴 过期用**负天数**表述（"已过期 3 天"）而不是日期 ——
 * 过期任务最关键的信息是"拖了多久"，不是"哪天到期"。
 */
export function formatDue(ms: number, now: number): string {
  const days = daysBetween(ms, now);
  if (days === 0) return '今天';
  if (days === 1) return '明天';
  if (days === -1) return '昨天';
  if (days < -1) return `已过期 ${-days} 天`;
  if (days <= 7) return `${days} 天后`;
  const d = new Date(ms);
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

/** 某个时间戳是否已经过期（严格早于今天 0 点）。 */
export function isOverdue(ms: number, now: number): boolean {
  return startOfDay(ms) < startOfDay(now);
}

/**
 * 绝对时刻，如 `9-26 00:31`。
 *
 * 用于"某某事发生在什么时候"这类**必须精确**的地方（上次同步、冲突双方的改动时间）。
 * 与 `formatDue` 的分工：那个回答"还有几天"，这个回答"具体哪一刻"。
 */
export function formatStamp(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${String(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
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
