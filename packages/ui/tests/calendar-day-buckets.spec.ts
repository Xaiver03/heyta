/**
 * 日视图的分桶：**谁进全天带、谁挂小时格**（R11 批四，跑在 node，不 render 组件）
 * ==============================================================================
 *
 * 这一档的形状是产品负责人 2026-10-03 用一张滴答截图拍的：
 * **"日的定义就是这样子的，就是铺满整面的。"** 顶部一条「全天」+ 下面 24 小时轴。
 *
 * 🔴 这里钉的四条，每一条的失效形状都**不是崩溃**：
 *
 *   1. **没有时刻的进带、有时刻的进格** —— 判反了轴会画出一条"看起来对"的线，
 *      而那条任务在界面上从它自己的时刻挪到了 00:00；
 *   2. **不属于这一天的不进任何一边** —— 串日在月档会被"选中那天"掩盖，
 *      在日档就是"这条我明明排在周三，周六却出现在轴上"；
 *   3. `timedCount` **数的是占了几个小时格**，不是数任务 ——
 *      界面那句"这一天没有定到具体时刻的任务"由它决定，数错就会在该说的时候不说；
 *   4. 时刻刻度只有一个来源（`calendarHourMark` → 时间线那份 `formatClock`）。
 *
 * ⚠️ 与 `calendar-cell-bars.spec.ts` 同一条纪律：**几何与布局不在这里测**。
 *   "轴铺满整面"是 rect 上的事，jsdom 里全是 0，写在这儿就是一条恒真判据
 *   （§7 元规则 2）。那条在 `e2e/tests/calendar-day.spec.ts`。
 */

import { describe, expect, it } from 'vitest';

import type { Task } from '@heyta/domain';

import {
  calendarDayBuckets,
  calendarHourMark,
  HOURS_IN_DAY,
  stepCalendarCursor,
} from '../src/calendar/model.js';

function task(over: Partial<Task> & { id: string }): Task {
  return { title: over.id, createdAt: 0, updatedAt: 0, ...over };
}

const DAY = '2026-10-03';

/** 本地**零点整** = 当前全应用"这一天"的标准写法（`DueEditor` 与捕获都写这个）。 */
const MIDNIGHT = new Date(2026, 9, 3, 0, 0, 0, 0).getTime();
/** 同一天的 09:30 —— 只有 AI 提案面板那条手工时刻输入能产出这种值。 */
const NINE_THIRTY = new Date(2026, 9, 3, 9, 30, 0, 0).getTime();
const TEN_OCLOCK = new Date(2026, 9, 3, 10, 0, 0, 0).getTime();
/** 前一天 / 后一天，用来钉"串日"。 */
const DAY_BEFORE = new Date(2026, 9, 2, 15, 0, 0, 0).getTime();
const DAY_AFTER = new Date(2026, 9, 4, 9, 0, 0, 0).getTime();

describe('calendarDayBuckets', () => {
  it('🔴 本地零点 = 没有时刻 ⇒ 进「全天」带，**不挂 00:00 那一格**', () => {
    const buckets = calendarDayBuckets([task({ id: 'a', dueDate: MIDNIGHT })], DAY);
    expect(buckets.allDay.map((t) => t.id)).toEqual(['a']);
    expect(buckets.hours[0]).toHaveLength(0);
    expect(buckets.timedCount).toBe(0);
  });

  it('🔴 带时刻 ⇒ 挂到它自己的那一小时，且**不进**全天带', () => {
    const buckets = calendarDayBuckets(
      [task({ id: 'timed', dueDate: NINE_THIRTY }), task({ id: 'plain', dueDate: MIDNIGHT })],
      DAY,
    );
    expect(buckets.hours[9]?.map((t) => t.id)).toEqual(['timed']);
    expect(buckets.allDay.map((t) => t.id)).toEqual(['plain']);
  });

  it('不属于这一天的（前一天 15:00 / 后一天 09:00 / 没设截止）哪儿都不进', () => {
    const buckets = calendarDayBuckets(
      [
        task({ id: 'before', dueDate: DAY_BEFORE }),
        task({ id: 'after', dueDate: DAY_AFTER }),
        task({ id: 'none' }),
      ],
      DAY,
    );
    expect(buckets.allDay).toHaveLength(0);
    expect(buckets.timedCount).toBe(0);
    expect(buckets.hours.reduce((n, hour) => n + hour.length, 0)).toBe(0);
  });

  it('`timedCount` 数的是**占了几个小时格**，两条同小时的算一格', () => {
    const buckets = calendarDayBuckets(
      [
        task({ id: 'x', dueDate: NINE_THIRTY }),
        task({ id: 'y', dueDate: new Date(2026, 9, 3, 9, 5, 0, 0).getTime() }),
        task({ id: 'z', dueDate: TEN_OCLOCK }),
      ],
      DAY,
    );
    expect(buckets.timedCount).toBe(2);
  });

  it('小时数组长度恒等于 `HOURS_IN_DAY`（界面按它渲染 24 行，缺一项就少一行）', () => {
    expect(calendarDayBuckets([], DAY).hours).toHaveLength(HOURS_IN_DAY);
    expect(HOURS_IN_DAY).toBe(24);
  });

  it('🔴 带内保持**输入顺序**（日档不重排 —— 重排是月格那件事，另有理由）', () => {
    const buckets = calendarDayBuckets(
      [
        task({ id: 'first', dueDate: MIDNIGHT }),
        task({ id: 'done', dueDate: MIDNIGHT, completedAt: 1 }),
        task({ id: 'last', dueDate: MIDNIGHT }),
      ],
      DAY,
    );
    expect(buckets.allDay.map((t) => t.id)).toEqual(['first', 'done', 'last']);
  });
});

describe('游标走一步（日档）', () => {
  it('一段 = **一天**，跨月跨年都按天走（不是"进位到下一月"）', () => {
    expect(stepCalendarCursor('day', '2026-10-03', 1)).toBe('2026-10-04');
    expect(stepCalendarCursor('day', '2026-10-03', -1)).toBe('2026-10-02');
    expect(stepCalendarCursor('day', '2026-10-31', 1)).toBe('2026-11-01');
    expect(stepCalendarCursor('day', '2026-12-31', 1)).toBe('2027-01-01');
  });

  it('0 段原地不动（拖拽算出 0 时必须什么都不变）', () => {
    expect(stepCalendarCursor('day', '2026-10-03', 0)).toBe('2026-10-03');
  });
});

describe('时刻刻度只有一个来源', () => {
  it('与时间线那一份 `formatClock` 同形：小时**不补零**、分钟补零', () => {
    // 钉字面量而不是"两边相等"：两边都从同一个函数读的那条判据是恒真的（§7 元规则 2）。
    // ⚠️ `9:00` 而不是 `09:00` —— 这是**已有那根轴**的形状，日视图不许自创第二种。
    //    小时位数不齐（`0:00` vs `23:00`）由**列宽**解决（`space.8`，与月档周次列同一档位），
    //    不是靠补零把两种长度压成一种。
    expect(calendarHourMark(0)).toBe('0:00');
    expect(calendarHourMark(9)).toBe('9:00');
    expect(calendarHourMark(23)).toBe('23:00');
  });
});
