/**
 * 提醒提前量的**夏令时**判据（W9 ③）
 * ====================================
 *
 * ## 为什么单独一个文件、而且自己钉时区
 *
 * 被测的算术是**本地日历**算术，它只在"这个进程所在的时区真的有夏令时"时
 * 才看得见差别。本仓库的开发机与 CI 大概率跑在 `Asia/Shanghai`（无夏令时），
 * 于是"提前 3 天"的日历算法与 `dueDate − 72h` 在那里**逐字相同** ——
 * 一条写在默认时区里的 DST 判据是**永远通过的判据**，而按本仓的元规则
 * （AGENTS.md §7 元规则 2）那比没有判据更糟。
 *
 * ⇒ 所以这里显式把时区钉成 `America/New_York`（2026 年 3 月 8 日拨快、
 * 11 月 1 日拨慢），并在断言结果之前**先断言夹具的前提成立**
 * （那两个时刻的 UTC 偏移确实不同）。前提不成立时立刻红，并说明是
 * 时区没生效 / ICU 不认这个时区，而不是让用户等到三月才发现。
 *
 * ## 🔴 夹具一律写成**函数**而不是模块级常量（实测踩过）
 *
 * `vi.stubEnv('TZ', …)` 在 `beforeAll` 里生效，而**模块顶层与 `describe` 体**
 * 都在收集阶段执行 —— 那时时区还没被钉住。第一版把 `SPRING_DUE` 写成模块常量、
 * `firstTrigger` 写成 describe 级常量，结果两条断言各差 13 小时（= 上海与纽约
 * 的时距 + 那 1 小时），而"夹具前提"那条**照样是绿的**。
 * 也就是说：常量夹具会在**错误的时区里**被求值，判据测的却不是那个时区。
 * 现在所有时刻都经 `at()` 在用例内部现算。
 *
 * ## 钉住的两条（各自对应一种真实失效）
 *
 *   1. **建提醒**（`reminderTriggerFromOffset`）：跨拨快/拨慢边界时，
 *      "提前 N 天"必须落在**同一套本地钟表时间**上。
 *   2. **重复任务顺延**（`nextTriggerAfterRepeat`）：第二条路径必须与第一条
 *      同一个实现 —— 只修建、不修顺延的话，第一次是对的、第二次开始漂一小时，
 *      而界面上完全看不出来。
 *
 * ⚠️ 变异怎么跑（这几条都能红，实测过）：把 `reminderTriggerFromOffset`
 * 换回 `return dueDate - offsetMs` ⇒ 本文件的钟表时间断言全部转红，
 * 失败信息里带着"差了一小时"那两个具体时刻。
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  MAX_REMINDER_LEAD_MS,
  REMINDER_LONG_OFFSET_PRESETS_MS,
  localDayBefore,
  nextTriggerAfterRepeat,
  reminderTriggerFromOffset,
  type Reminder,
} from '../src/index.js';
import { daysBetween } from '../src/date.js';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const DST_TZ = 'America/New_York';

/** 本地时刻（月份 0 起）—— 时区由下面的 `TZ` 决定，**必须在用例里现算**。 */
const at = (y: number, m: number, d: number, hh = 0, mm = 0): number =>
  new Date(y, m, d, hh, mm, 0, 0).getTime();

/** 春季夹具：2026-03-09（周一）09:30 EDT —— 它的"前 3 个日历日"在 EST 里。 */
const springDue = (): number => at(2026, 2, 9, 9, 30);

/** UTC 偏移（分钟，Date 的符号约定：越正越在西边）。 */
const utcOffset = (ms: number): number => new Date(ms).getTimezoneOffset();

beforeAll(() => {
  // `vi.stubEnv` 而不是直接写 `process.env`：它会在这份文件跑完后**自动还原**，
  // 不会把时区漏给同一个 worker 里的下一份测试文件。
  vi.stubEnv('TZ', DST_TZ);
});

afterAll(() => {
  vi.unstubAllEnvs();
});

describe('夹具前提（不成立就必须红，而不是静默变成一条永真的判据）', () => {
  it('🔴 本进程真的跑在 America/New_York，而且 2026-03-06 与 03-09 的 UTC 偏移不同', () => {
    const before = at(2026, 2, 6, 9, 30); // EST，UTC−5
    const after = at(2026, 2, 9, 9, 30); // EDT，UTC−4
    expect(
      utcOffset(before) !== utcOffset(after),
      `夹具没生效：${DST_TZ} 下这两天偏移相同（${String(utcOffset(before))}）。` +
        '要么进程时区没被钉住，要么这台机器的 ICU 不认这个时区。',
    ).toBe(true);
    expect(utcOffset(before)).toBe(300);
    expect(utcOffset(after)).toBe(240);
    // 这两个具体日子之间确实是 71 小时，不是 72 —— 这就是那条敞口的量级。
    expect(after - before).toBe(71 * HOUR);
  });
});

describe('「提前 N 天」跨拨快（春季）——同一套本地钟表时间', () => {
  it('🔴 提前 3 天 = 3 月 6 日 09:30 EST，不是 08:30', () => {
    const due = springDue();
    const trigger = reminderTriggerFromOffset(due, 3 * DAY);
    expect(new Date(trigger).toString()).toContain('09:30');
    expect(trigger).toBe(at(2026, 2, 6, 9, 30));
    // 反证：朴素的 epoch 减法给出的正是错的那一个。
    expect(due - 3 * DAY).not.toBe(trigger);
    expect(due - 3 * DAY).toBe(at(2026, 2, 6, 8, 30));
  });

  it('提前 1 天 / 2 天同样落在 09:30', () => {
    const due = springDue();
    expect(reminderTriggerFromOffset(due, DAY)).toBe(at(2026, 2, 8, 9, 30));
    expect(reminderTriggerFromOffset(due, 2 * DAY)).toBe(at(2026, 2, 7, 9, 30));
  });

  it('提前 1 周 = 3 月 2 日 09:30（这一档整段都在 EST 里，不该被"顺带"改坏）', () => {
    expect(reminderTriggerFromOffset(springDue(), 7 * DAY)).toBe(at(2026, 2, 2, 9, 30));
  });

  it('自然日距离正好是 N 天（走 date.ts 那个带 DST 判据的 daysBetween）', () => {
    const due = springDue();
    for (const [offset, n] of [
      [DAY, 1],
      [2 * DAY, 2],
      [3 * DAY, 3],
      [7 * DAY, 7],
    ] as const) {
      const trigger = reminderTriggerFromOffset(due, offset);
      expect(daysBetween(due, trigger), `提前 ${String(n)} 天`).toBe(n);
    }
  });

  it('不足一天的档位仍然按瞬时减（"提前 30 分钟"不是日历位置）', () => {
    const due = springDue();
    expect(reminderTriggerFromOffset(due, 30 * MINUTE)).toBe(due - 30 * MINUTE);
    expect(reminderTriggerFromOffset(due, 0)).toBe(due);
    expect(reminderTriggerFromOffset(due, HOUR)).toBe(due - HOUR);
  });

  it('整天 + 零头：先回退整天，再减零头（"提前 3 天又 30 分钟"= 06 日 09:00）', () => {
    expect(reminderTriggerFromOffset(springDue(), 3 * DAY + 30 * MINUTE)).toBe(
      at(2026, 2, 6, 9, 0),
    );
  });
});

describe('「提前 N 天」跨拨慢（秋季）——反方向同样不漂', () => {
  // 2026-11-01 02:00 EDT → 01:00 EST。要看见那多出来的一小时，钟点必须落在
  // 切换**之前**（11/1 的 00:30 有两次，取第一次 = EDT）：00:30 → 11/4 00:30
  // 相隔 73 小时而不是 72。用 21:15 之类"两边都已是 EST"的钟点做夹具，
  // 这条判据会与朴素减法逐字相同 —— 那就是一条永远不会红的判据（实测过）。
  it('🔴 提前 3 天 = 11 月 1 日 00:30 EDT，不是 01:30', () => {
    const due = at(2026, 10, 4, 0, 30); // 周三 00:30 EST
    const trigger = reminderTriggerFromOffset(due, 3 * DAY);
    expect(trigger).toBe(at(2026, 10, 1, 0, 30));
    expect(due - 3 * DAY).toBe(at(2026, 10, 1, 1, 30));
    expect(due - 3 * DAY).not.toBe(trigger);
    expect(daysBetween(due, trigger)).toBe(3);
  });

  it('被跳过的那一小时（目标日 02:30 不存在）由原生 Date 归一，不静默改日期', () => {
    // 春季 2026-03-08 02:30 在 America/New_York 不存在 → 归一到 03:30。
    const trigger = reminderTriggerFromOffset(at(2026, 2, 9, 2, 30), DAY);
    expect(new Date(trigger).getDate()).toBe(8); // 还是"前一天"，没有整日偏差
    expect(new Date(trigger).getHours()).toBe(3);
  });
});

describe('重复任务顺延走同一条算术（第二条路径不许漏）', () => {
  const offsetMs = 3 * DAY;

  const reminder = (over: Partial<Reminder> = {}): Reminder => {
    const triggerAt = reminderTriggerFromOffset(springDue(), offsetMs);
    return {
      id: 'r-dst',
      taskId: 't1',
      triggerAt,
      offsetMs,
      createdAt: triggerAt,
      updatedAt: triggerAt,
      ...over,
    };
  };

  it('🔴 下一个周期（同样跨拨快）顺延后仍是"截止前 3 天的同一套钟表时间"', () => {
    // 新截止 3 月 8 日 09:30（EDT，就是拨快那一天）→ 前 3 个日历日是 3 月 5 日
    // 09:30 EST；朴素减法会得到 08:30，而这一格必须是红的。
    const nextDue = at(2026, 2, 8, 9, 30);
    const rolled = nextTriggerAfterRepeat(reminder(), nextDue);
    expect(rolled).toBe(at(2026, 2, 5, 9, 30));
    expect(rolled).toBe(reminderTriggerFromOffset(nextDue, offsetMs));
    expect(rolled).not.toBe(nextDue - offsetMs);
    expect(daysBetween(nextDue, rolled!)).toBe(3);
  });

  it('下一个周期不跨边界时，两条算法同值（顺带钉住"没有多改任何东西"）', () => {
    const nextDue = at(2026, 2, 16, 9, 30); // 与 3 月 13 日都在 EDT 内
    expect(nextTriggerAfterRepeat(reminder(), nextDue)).toBe(nextDue - offsetMs);
  });

  it('时刻没变 → undefined（不产出空 op，同旧行为）', () => {
    expect(nextTriggerAfterRepeat(reminder(), springDue())).toBeUndefined();
  });

  it('病态提前量（NaN / 负数）→ 放弃顺延而不抛（那是坏数据，不是用户的错）', () => {
    expect(
      nextTriggerAfterRepeat(reminder({ offsetMs: Number.NaN }), at(2026, 3, 1)),
    ).toBeUndefined();
    expect(nextTriggerAfterRepeat(reminder({ offsetMs: -DAY }), at(2026, 3, 1))).toBeUndefined();
  });
});

describe('新档位与闸门自洽（W9 ①）', () => {
  it('日级以上档位全部落在闸门内，且都是整天', () => {
    for (const offset of REMINDER_LONG_OFFSET_PRESETS_MS) {
      expect(offset % DAY, String(offset)).toBe(0);
      expect(offset).toBeGreaterThanOrEqual(DAY);
      expect(offset).toBeLessThan(MAX_REMINDER_LEAD_MS);
    }
  });

  it('localDayBefore 拒绝负数/非整数天数与非法时刻（不发明兜底值）', () => {
    expect(() => localDayBefore(springDue(), -1)).toThrow();
    expect(() => localDayBefore(springDue(), 1.5)).toThrow();
    expect(() => localDayBefore(Number.NaN, 1)).toThrow();
    expect(localDayBefore(springDue(), 0)).toBe(springDue());
  });
});
