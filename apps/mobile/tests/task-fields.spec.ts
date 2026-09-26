/**
 * 任务截止显示与优先级文案的测试
 * ================================
 *
 * 🔴 这里防的是**两端漂移**，不是"函数算错了"。
 *
 * 移动端原本有自己的一份 `lib/date.ts#formatDue`，与 Web 端（以及
 * `@heyta/domain` 的 `formatRemaining`）**已经说了两种话**：
 *
 *   - 逾期：`已过期 3 天` vs `已逾期 3 天`
 *   - 2 天后：`2 天后` vs `后天`
 *   - 8 天后：`9月26日`（绝对日期） vs `还剩 8 天`
 *
 * 这类漂移**两端各自的测试都是绿的** —— 只有把"必须与共享实现逐字相同"
 * 写成断言，它才会变红。所以下面最重要的一条不是"文案是中文"，
 * 而是 `toBe(formatTaskRemaining(...))`：**同一个函数**。
 */

import { describe, expect, it } from 'vitest';
import { Priority, formatTaskRemaining, parseLocalDate, type Task } from '@heyta/domain';

import { dueTone, toDueDisplay } from '../src/lib/due-display';
import {
  PRIORITY_LABELS,
  PRIORITY_ORDER,
  priorityBadgeLabel,
  priorityColorToken,
} from '../src/lib/priority';

const NOW = parseLocalDate('2026-09-26').getTime();
const DAY = 24 * 60 * 60 * 1000;

function task(over: Partial<Task> = {}): Task {
  return {
    id: 't1',
    title: '测试任务',
    createdAt: NOW - 10 * DAY,
    updatedAt: NOW - 10 * DAY,
    ...over,
  };
}

/** 本地某天的零点，与 `dueDateToEpoch` 的约定一致。 */
function due(days: number): number {
  return NOW + days * DAY;
}

describe('toDueDisplay', () => {
  it('没有截止时间 → null（UI 据此不渲染徽标）', () => {
    expect(toDueDisplay(task(), 'countdown', NOW)).toBeNull();
    expect(toDueDisplay(task(), 'date', NOW)).toBeNull();
  });

  describe('date 模式（绝对日期）', () => {
    it('同年只给月日', () => {
      expect(toDueDisplay(task({ dueDate: parseLocalDate('2026-09-26').getTime() }), 'date', NOW)?.text).toBe(
        '09-26',
      );
    });

    it('跨年带上年份', () => {
      expect(toDueDisplay(task({ dueDate: parseLocalDate('2027-01-05').getTime() }), 'date', NOW)?.text).toBe(
        '2027-01-05',
      );
    });
  });

  describe('countdown 模式（相对时间）', () => {
    it('🔴 文案与共享实现 `formatTaskRemaining` **逐字相同**', () => {
      // 这是本文件存在的核心断言：不是"差不多是中文"，
      // 而是"和 Web 端调的是同一个函数、得到同一个字符串"。
      for (const days of [-3, -1, 0, 1, 2, 5, 8, 40]) {
        const t = task({ dueDate: due(days) });
        expect(toDueDisplay(t, 'countdown', NOW)?.text).toBe(formatTaskRemaining(t, { now: NOW }));
      }
    });

    it('具体文案是人话，不是"还剩 0 天"', () => {
      const text = (d: number): string => toDueDisplay(task({ dueDate: due(d) }), 'countdown', NOW)!.text;
      expect(text(0)).toBe('今天');
      expect(text(1)).toBe('明天');
      expect(text(2)).toBe('后天');
      expect(text(5)).toBe('还剩 5 天');
      expect(text(-3)).toBe('已逾期 3 天');
    });

    it('🔴 不出现移动端旧实现的说法（已过期 / N 天后 / 绝对日期）', () => {
      const text = (d: number): string => toDueDisplay(task({ dueDate: due(d) }), 'countdown', NOW)!.text;
      expect(text(-3)).not.toContain('已过期');
      expect(text(5)).not.toContain('天后');
      // 8 天后在旧实现里会变成 `9月26日` 这种绝对日期
      expect(text(8)).not.toContain('月');
    });
  });

  describe('档位', () => {
    it('逾期 / 今天 / 快到了 / 还早', () => {
      const urgency = (d: number): string =>
        toDueDisplay(task({ dueDate: due(d) }), 'countdown', NOW)!.urgency;
      expect(urgency(-1)).toBe('overdue');
      expect(urgency(0)).toBe('today');
      expect(urgency(1)).toBe('soon');
      expect(urgency(3)).toBe('soon');
      expect(urgency(4)).toBe('later');
    });

    it('🔴 已完成的任务不再报警（勾掉后不会还红着）', () => {
      const done = task({ dueDate: due(-5), completedAt: NOW });
      const display = toDueDisplay(done, 'countdown', NOW)!;
      expect(display.urgency).toBe('none');
      expect(display.overdue).toBe(false);
      // 文案仍然如实说明它是逾期完成的 —— 隐藏事实和"不报警"是两件事
      expect(display.text).toBe('已逾期 5 天');
    });

    it('`date` 模式的档位与 `countdown` 一致（同一个 dueDate，只是换说法）', () => {
      const t = task({ dueDate: due(-1) });
      expect(toDueDisplay(t, 'date', NOW)!.urgency).toBe(toDueDisplay(t, 'countdown', NOW)!.urgency);
    });
  });
});

describe('dueTone', () => {
  it('只有逾期和今天给颜色', () => {
    expect(dueTone('overdue')).toBe('danger');
    expect(dueTone('today')).toBe('primary');
    expect(dueTone('soon')).toBe('subtle');
    expect(dueTone('later')).toBe('subtle');
    expect(dueTone('none')).toBe('subtle');
  });
});

describe('优先级文案', () => {
  it('四个档位都有中文名，一个不漏', () => {
    for (const p of PRIORITY_ORDER) {
      expect(PRIORITY_LABELS[p]).toBeTruthy();
    }
    expect(PRIORITY_LABELS[Priority.None]).toBe('无');
    expect(PRIORITY_LABELS[Priority.Low]).toBe('低');
    expect(PRIORITY_LABELS[Priority.Medium]).toBe('中');
    expect(PRIORITY_LABELS[Priority.High]).toBe('高');
  });

  it('🔴 顺序是显式升序，不靠枚举反向映射', () => {
    expect([...PRIORITY_ORDER]).toEqual([0, 1, 2, 3]);
  });

  it('每个档位映射到一个语义色 token 名', () => {
    expect(priorityColorToken(Priority.High)).toBe('color.priority-high');
    expect(priorityColorToken(Priority.Medium)).toBe('color.priority-medium');
    expect(priorityColorToken(Priority.Low)).toBe('color.priority-low');
    expect(priorityColorToken(Priority.None)).toBe('color.priority-none');
  });

  it('🔴 数值枚举的比较：3 才是高优先级', () => {
    // 防止 `priority === 'high'` 那种"永远为假"的写法复活
    expect(priorityBadgeLabel(Priority.High)).toBe('高优先级');
    expect(priorityBadgeLabel(Priority.Medium)).toBe('中优先级');
    expect(priorityBadgeLabel(Priority.Low)).toBe('低优先级');
  });

  it('没有优先级不给徽标（"无优先级"不是信息）', () => {
    expect(priorityBadgeLabel(undefined)).toBeNull();
    expect(priorityBadgeLabel(Priority.None)).toBeNull();
  });
});
