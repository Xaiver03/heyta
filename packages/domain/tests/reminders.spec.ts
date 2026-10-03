/**
 * 提醒领域规则的测试（B1-1 的领域层）
 * ======================================
 *
 * 重点盯**判定顺序**这一类静默失效：把 `fired`/`dismissed` 排在"到点"之后，
 * 症状是"用户关掉的提醒到点又弹一次"，而且只在跨端时出现 —— 本机状态明明是对的。
 *
 * 时间全部由测试注入，**不读真实时钟**（`reminderRejection` 的第二个参数
 * 就是为此存在的）。
 */

import { describe, expect, it } from 'vitest';

import {
  ALL_REMINDER_OFFSET_PRESETS_MS,
  MAX_REMINDERS_PER_TASK,
  MAX_REMINDER_LEAD_MS,
  MAX_SNOOZE_MS,
  REMINDER_LONG_OFFSET_PRESETS_MS,
  REMINDER_OFFSET_PRESETS_MS,
  REMINDER_PAST_GRACE_MS,
  aliveReminders,
  daysBetween,
  dueReminders,
  isReminderPending,
  localDayBefore,
  nextTriggerAfterRepeat,
  reminderEffectiveAt,
  reminderPhase,
  reminderRejection,
  reminderTriggerFromOffset,
  snoozeDeadline,
  type Reminder,
} from '../src/index.js';

const NOW = 1_700_000_000_000;
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const reminder = (over: Partial<Reminder> = {}): Reminder => ({
  id: 'r1',
  taskId: 't1',
  triggerAt: NOW + HOUR,
  createdAt: NOW,
  updatedAt: NOW,
  ...over,
});

describe('到期判定（reminderPhase / dueReminders）', () => {
  it('没到点 = scheduled，到点 = due', () => {
    const r = reminder();
    expect(reminderPhase(r, r.triggerAt - 1)).toBe('scheduled');
    expect(reminderPhase(r, r.triggerAt)).toBe('due');
    expect(isReminderPending(r, r.triggerAt)).toBe(true);
    expect(isReminderPending(r, r.triggerAt - 1)).toBe(false);
  });

  it('🔴 fired 优先于 due —— 投递过就不再是"到点"', () => {
    const r = reminder({ firedAt: NOW + HOUR + 1 });
    expect(reminderPhase(r, r.triggerAt + MINUTE)).toBe('fired');
    expect(dueReminders([r], r.triggerAt + MINUTE)).toEqual([]);
  });

  it('🔴 dismissed 优先于一切 —— 关闭后到点也不弹', () => {
    const r = reminder({ firedAt: NOW + HOUR + 1, dismissedAt: NOW + HOUR + 2 });
    expect(reminderPhase(r, r.triggerAt + MINUTE)).toBe('dismissed');
    expect(dueReminders([r], r.triggerAt + MINUTE)).toEqual([]);
  });

  it('snooze 让"已过原触发点"的提醒回到未到期', () => {
    const r = reminder({ snoozedUntil: NOW + HOUR + 30 * MINUTE });
    expect(reminderEffectiveAt(r)).toBe(NOW + HOUR + 30 * MINUTE);
    // 原触发点已过，但 snooze 到未来 → 不是 due
    expect(reminderPhase(r, NOW + HOUR + MINUTE)).toBe('snoozed');
    // snooze 到点 → due
    expect(reminderPhase(r, NOW + HOUR + 30 * MINUTE)).toBe('due');
  });

  it('墓碑（deletedAt）不出现在到点集合里，即使状态是 due', () => {
    const r = reminder({ deletedAt: NOW });
    expect(reminderPhase(r, r.triggerAt)).toBe('due');
    expect(dueReminders([r], r.triggerAt)).toEqual([]);
  });

  it('顺序确定：先按有效触发时刻，同刻按 id 字典序', () => {
    const late = reminder({ id: 'b', triggerAt: NOW + 2 * HOUR });
    const sameTimeB = reminder({ id: 'b2', triggerAt: NOW + HOUR });
    const sameTimeA = reminder({ id: 'a1', triggerAt: NOW + HOUR });
    const sorted = dueReminders([late, sameTimeB, sameTimeA], NOW + 3 * HOUR);
    expect(sorted.map((r) => r.id)).toEqual(['a1', 'b2', 'b']);
  });

  it('aliveReminders 过滤墓碑并按 id 排序', () => {
    const a = reminder({ id: 'z' });
    const b = reminder({ id: 'a' });
    const dead = reminder({ id: 'm', deletedAt: NOW });
    expect(aliveReminders([a, b, dead]).map((r) => r.id)).toEqual(['a', 'z']);
  });
});

describe('建/改时间的校验（reminderRejection）', () => {
  it('合法时间戳通过', () => {
    expect(reminderRejection(NOW, NOW)).toBeUndefined();
    expect(reminderRejection(NOW + MAX_REMINDER_LEAD_MS, NOW)).toBeUndefined();
  });

  it('非整数 / 非正 / 非有限 → not-a-time', () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, 0, -1, NOW + 0.5]) {
      expect(reminderRejection(bad, NOW), String(bad)).toBe('not-a-time');
    }
  });

  it('🔴 过去超过宽限窗口 → in-the-past；宽限窗口内接受', () => {
    expect(reminderRejection(NOW - REMINDER_PAST_GRACE_MS - 1, NOW)).toBe('in-the-past');
    expect(reminderRejection(NOW - REMINDER_PAST_GRACE_MS / 2, NOW)).toBeUndefined();
  });

  it('超过一年 → too-far（挡"秒当毫秒"的手滑）', () => {
    expect(reminderRejection(NOW + MAX_REMINDER_LEAD_MS + 1, NOW)).toBe('too-far');
  });
});

describe('提前量与重复顺延', () => {
  it('由截止时间与提前量算出触发时刻', () => {
    const due = NOW + DAY;
    expect(reminderTriggerFromOffset(due, 30 * MINUTE)).toBe(due - 30 * MINUTE);
    expect(reminderTriggerFromOffset(due, 0)).toBe(due);
  });

  it('负提前量抛错（"截止之后提醒"不是一条规则）', () => {
    expect(() => reminderTriggerFromOffset(NOW, -1)).toThrow();
    expect(() => reminderTriggerFromOffset(Number.NaN, 0)).toThrow();
  });

  it('🔴 带提前量的提醒跟着新截止走', () => {
    const r = reminder({ triggerAt: NOW + DAY - 30 * MINUTE, offsetMs: 30 * MINUTE });
    const nextDue = NOW + 2 * DAY;
    expect(nextTriggerAfterRepeat(r, nextDue)).toBe(nextDue - 30 * MINUTE);
  });

  it('🔴 不带提前量的是绝对时刻，重复顺延不动它', () => {
    const r = reminder({ triggerAt: NOW + DAY });
    expect(nextTriggerAfterRepeat(r, NOW + 2 * DAY)).toBeUndefined();
  });

  it('没有新截止时间 / 时刻没变 → undefined（不产出空 op）', () => {
    const r = reminder({ triggerAt: NOW + DAY - 30 * MINUTE, offsetMs: 30 * MINUTE });
    expect(nextTriggerAfterRepeat(r, undefined)).toBeUndefined();
    expect(nextTriggerAfterRepeat(r, r.triggerAt + 30 * MINUTE)).toBeUndefined();
  });
});

describe('稍后提醒（snoozeDeadline）', () => {
  it('缺省 10 分钟', () => {
    expect(snoozeDeadline(NOW)).toBe(NOW + 10 * MINUTE);
  });

  it('超过上限时钳制到 7 天（交互动作钳制，不让点击失败）', () => {
    expect(snoozeDeadline(NOW, 60 * 24 * 30)).toBe(NOW + MAX_SNOOZE_MS);
  });

  it('0 / 负 / 非有限分钟数抛错（那是调用方算错了，不是用户操作）', () => {
    for (const bad of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => snoozeDeadline(NOW, bad), String(bad)).toThrow();
    }
  });
});

describe('常量自检（界面预设与上限必须自洽）', () => {
  it('预设升序、首项为 0（= 到点提醒）、都小于一年上限', () => {
    const presets = [...REMINDER_OFFSET_PRESETS_MS];
    expect(presets[0]).toBe(0);
    expect([...presets].sort((a, b) => a - b)).toEqual(presets);
    expect(Math.max(...presets)).toBeLessThan(MAX_REMINDER_LEAD_MS);
  });

  /**
   * 🔴 这条钉的是**下标契约**的左半边。
   *
   * `packages/ui` 的 `ReminderList` 按 `labels.offsets[i] ↔ offsetPresets()[i]`
   * 取文案，而两端各自写了一份 key 数组（web 的 `REMINDER_OFFSET_KEYS`、
   * mobile 的 `offsetMessageKey`）。往这个数组里**追加**一项就等于同时改
   * 那两个宿主 + 两份词条，而移动端那份缺 key 会**在打开面板时抛**。
   * ⇒ 更长的档位走 `REMINDER_LONG_OFFSET_PRESETS_MS`（新增一档 = 改一处），
   *   这条断言就是"没人顺手把长档位抄回短数组"的兜底。
   */
  it('🔴 短档位数组一字未动（6 档、逐项 —— `as const` 的下标契约）', () => {
    expect([...REMINDER_OFFSET_PRESETS_MS]).toEqual([
      0, 5 * MINUTE, 15 * MINUTE, 30 * MINUTE, HOUR, DAY,
    ]);
  });

  it('🔴 W9 ①：日级以上档位是**纯可加**的，合起来仍是升序无重复', () => {
    expect([...REMINDER_LONG_OFFSET_PRESETS_MS]).toEqual([2 * DAY, 3 * DAY, 7 * DAY, 30 * DAY]);
    expect([...ALL_REMINDER_OFFSET_PRESETS_MS]).toEqual([
      ...REMINDER_OFFSET_PRESETS_MS,
      ...REMINDER_LONG_OFFSET_PRESETS_MS,
    ]);
    const sorted = [...ALL_REMINDER_OFFSET_PRESETS_MS].sort((a, b) => a - b);
    // 两档同值 = 两端的下标会错位（共享组件按下标取文案）。
    expect(sorted).toEqual([...new Set(sorted)]);
    expect(sorted).toEqual([...ALL_REMINDER_OFFSET_PRESETS_MS]);
    // 闸门：最大档也必须落在 `MAX_REMINDER_LEAD_MS` 之内（提前 30 天在一年内）。
    expect(Math.max(...ALL_REMINDER_OFFSET_PRESETS_MS)).toBeLessThan(MAX_REMINDER_LEAD_MS);
    // 短档 ⊂ 全集：老的提前量在新档位表里仍解析到同一个数字。
    for (const preset of REMINDER_OFFSET_PRESETS_MS) {
      expect(ALL_REMINDER_OFFSET_PRESETS_MS).toContain(preset);
    }
  });

  it('每任务上限是正整数', () => {
    expect(Number.isInteger(MAX_REMINDERS_PER_TASK)).toBe(true);
    expect(MAX_REMINDERS_PER_TASK).toBeGreaterThan(0);
  });
});

describe('日级提前量按**本地日历日**算（不假设本机有夏令时的那部分判据）', () => {
  /**
   * ⚠️ 这一组刻意**不假设**本机时区有夏令时 —— 完整版在
   * `reminders-dst.spec.ts`（那里显式钉了 `America/New_York`）。
   * 这里只钉"在任何时区都必须成立"的三条：自然日距离、同一套钟表时间、
   * 亚日档位仍是瞬时减法。
   */
  const due = NOW + 10 * DAY + 9 * HOUR + 30 * MINUTE;

  it('提前 N 天 = 自然日距离正好 N，且时分秒不变', () => {
    for (const [offset, n] of [
      [DAY, 1],
      [2 * DAY, 2],
      [3 * DAY, 3],
      [7 * DAY, 7],
      [30 * DAY, 30],
    ] as const) {
      const trigger = reminderTriggerFromOffset(due, offset);
      expect(daysBetween(due, trigger), `提前 ${String(n)} 天`).toBe(n);
      const src = new Date(due);
      const got = new Date(trigger);
      expect(
        [got.getHours(), got.getMinutes(), got.getSeconds()],
        `提前 ${String(n)} 天漂了钟表时间`,
      ).toEqual([src.getHours(), src.getMinutes(), src.getSeconds()]);
    }
  });

  it('localDayBefore(0 天) 原样返回；跨年由原生 Date 负责', () => {
    expect(localDayBefore(due, 0)).toBe(due);
    expect(daysBetween(due, localDayBefore(due, 365))).toBe(365);
  });

  it('🔴 亚日档位仍是逐字相减（要改这一档得显式改判据，不许顺手"也按天算"）', () => {
    for (const offset of [0, 5 * MINUTE, 15 * MINUTE, 30 * MINUTE, HOUR]) {
      expect(reminderTriggerFromOffset(due, offset)).toBe(due - offset);
    }
  });

  it('提前量与截止时间的形状校验不变（负数 / 非有限数抛错）', () => {
    expect(() => reminderTriggerFromOffset(due, -DAY)).toThrow();
    expect(() => reminderTriggerFromOffset(Number.NaN, DAY)).toThrow();
    expect(() => reminderTriggerFromOffset(due, Number.POSITIVE_INFINITY)).toThrow();
  });
});
