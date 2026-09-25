/**
 * 日期工具（纯函数）
 * ==================
 *
 * 🔴 刻意**不用 `Intl.DateTimeFormat`**。
 * Hermes 上 Intl 是**可选编译进去的**：本机实测存在，但不同构建可能没有，
 * 而拿不到时 `new Intl.DateTimeFormat()` 会在**渲染中途抛异常** ——
 * 表现为整屏白掉，且错误信息不会指向"Intl 缺失"。
 * 这里用 `Date` 的基础 getter 手写，行为完全确定、无环境依赖。
 *
 * 抽成独立模块（而不是留在 TasksScreen.tsx 里）的理由：
 * 这些函数全是**纯输入输出**，日期边界（今天/明天/昨天/跨月）是最容易
 * 出错也最值得单测的部分，而组件文件里的函数没法脱离 React 测。
 */

export const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * 把时间戳归到**本地时区**当天的 0 点。
 *
 * ⚠️ 必须用 `setHours` 而不是 `ts - (ts % DAY_MS)`：
 * 后者按 UTC 切分，在东八区会把"今天 07:00"算成昨天，
 * 于是所有凌晨创建的任务都显示成"昨天到期"。
 */
export function startOfDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** 两个时间戳相差多少个**自然日**（按本地时区取整）。 */
export function daysBetween(fromMs: number, toMs: number): number {
  return Math.round((startOfDay(fromMs) - startOfDay(toMs)) / DAY_MS);
}

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

/** 顶部大标题下的日期，如「9月25日 星期五」。 */
export function formatToday(now: number): string {
  const d = new Date(now);
  const weekdays = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
  return `${d.getMonth() + 1}月${d.getDate()}日 ${weekdays[d.getDay()]}`;
}

/** 某个时间戳是否已经过期（严格早于今天 0 点）。 */
export function isOverdue(ms: number, now: number): boolean {
  return startOfDay(ms) < startOfDay(now);
}