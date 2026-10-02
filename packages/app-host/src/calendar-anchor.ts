/**
 * 日历锚点：「今天是 …」那一行的**唯一生产者**
 * ==============================================
 *
 * ## 为什么单独一个文件（而不是在两条链路里各写一行）
 *
 * `ai-capture.ts` 早就往提示词里注入「今天是」，但**只有它一条**有 ——
 * 拆解 / 排序 / 估时 / 工具链四条都没有（`docs/plans/ai-assistant-closure.md` W4）。
 * 对对话助手来说这不是"少一句礼貌话"，是**功能上坏的**：用户问"今天有什么任务"，
 * 模型不知道今天是哪天，就只能把"今天"原样塞进日期参数，或者**自己编一个**。
 * 而它编日期是有前科的：`packages/ai/src/index.ts` 文件头记着实测 ——
 * 模型曾把"明天"算错**四个半月**。
 *
 * 🔴 所以锚点只许有一个生产者。抄进第二个 prompt 就会有第三份，
 * 然后某一天它们开始互相不一致 —— 而"哪条链路里的今天是哪天"这种漂移
 * 没有任何测试会红（本仓库对这件事有一整页账：抄件一定会漂）。
 *
 * ## 为什么时区是 `UTC±HH:MM`，不是 IANA 名
 *
 * `packages/domain/src/date.ts` 文件头记着实测：**Hermes 上 `Intl` 是可选的**，
 * `new Intl.DateTimeFormat()` 可能直接抛。所以偏移量走 `getTimezoneOffset()`
 * 的纯算术。而且给模型的也正好是它需要的那件事 —— "这里比 UTC 早 8 小时"，
 * 不是一个它还得再查一遍的地名。
 *
 * ## 为什么 `now` 是注入的
 *
 * 与 `ai-capture.ts` 同一条理由：本文件的输出**依赖"今天是几号"**，
 * 用真实时钟写测试会得到一个过几天就变红的用例。
 */

import { WEEKDAY_LABELS, isoWeekday, today, type LocalDate } from '@heyta/domain';

export interface CalendarAnchor {
  /** 本地日历日 `YYYY-MM-DD`（不是 UTC —— 用户问的"今天"是他手机上的今天）。 */
  readonly day: LocalDate;
  /** 中文星期，取自 `WEEKDAY_LABELS`（一…日）。 */
  readonly weekday: string;
  /** 形如 `UTC+08:00` / `UTC-03:30` / `UTC+00:00`。 */
  readonly utcOffset: string;
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

/**
 * 本地时区的 UTC 偏移，写成 `UTC±HH:MM`。
 *
 * ⚠️ `getTimezoneOffset()` 返回的是"**UTC 减本地**"的分钟数（东八区 = `-480`），
 * 符号与直觉相反 —— 这里先取反。判据里"把时区写死成 UTC ⇒ 至少一条红"
 * 抓的就是这类符号/来源错误。
 */
export function utcOffsetLabel(now: number): string {
  const minutes = -new Date(now).getTimezoneOffset();
  const sign = minutes < 0 ? '-' : '+';
  const abs = Math.abs(minutes);
  return `UTC${sign}${pad2(Math.floor(abs / 60))}:${pad2(abs % 60)}`;
}

export function calendarAnchor(now: number = Date.now()): CalendarAnchor {
  const day = today(now);
  // `WEEKDAY_LABELS` 是 1..7（ISO 星期几）顺序；`noUncheckedIndexedAccess` 下
  // 下标访问可能是 undefined，所以宁可少写星期，也不要写出 `undefined`。
  return { day, weekday: WEEKDAY_LABELS[isoWeekday(day) - 1] ?? '', utcOffset: utcOffsetLabel(now) };
}

/**
 * 进提示词的那一行。🔴 只有这一个形状。
 *
 * 措辞与 `ai-capture.ts` 原来那句保持同一个前缀「今天是：」—— 那不是巧合，
 * 是它的 `fields ↔ user` 对照表用的标记（`today: '今天是：'`）。改了前缀，
 * 那条"声明了却没出去"的判据就会静默失效。
 */
export function calendarAnchorLine(anchor: CalendarAnchor): string {
  return `今天是：${anchor.day}（周${anchor.weekday}，${anchor.utcOffset}）`;
}

/**
 * 紧跟锚点那句的**硬规则**。
 *
 * 与 capture 的 `关于 dueDate 的硬规则` 同源（那里实测过：不写这条，
 * 模型会凭训练语料里的"今天"写一个日期）。对助手更要写，因为它要把日期
 * **填进工具参数**（`list_tasks` 的 `dueOn`），错一天就是给用户看错一天的清单。
 */
export const CALENDAR_ANCHOR_RULES = [
  '关于日期的硬规则：',
  '- 只能依据上面给出的「今天是」来推算相对日期（今天 / 明天 / 下周三 / 14 号），不许凭印象写一个日期。',
  '- 日期一律写成 `YYYY-MM-DD`，按**本地**日历日；不确定时宁可不说日期。',
].join('\n');
