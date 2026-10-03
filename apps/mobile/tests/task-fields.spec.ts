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
 * 写成断言，它才会变红。
 *
 * ⚠️ i18n 迁移后"说法"搬到了壳里（`remainingText` 读词条表），
 * 阈值语义仍是 `@heyta/domain` 那一份。所以下面最重要的一条改成
 * **中文输出与 `formatTaskRemaining` 逐字相同**：不是"差不多是中文"，
 * 而是"迁移没有顺手改掉共享实现定下的措辞"。
 * 英文则单独钉住 —— 词条表漏 key 时它最先露馅。
 */

import { describe, expect, it } from 'vitest';
import { Priority, formatTaskRemaining, parseLocalDate, type Task } from '@heyta/domain';
import { translate } from '@heyta/i18n';

import { dueTone, toDueDisplay } from '../src/lib/due-display';
import { PRIORITY_ORDER, priorityBadgeLabel, priorityLabel } from '../src/lib/priority';
// ⚠️ 档位 → 语义色 token 名的判据**不在这里了**（W5，2026-10-04）：
// 那份映射的唯一所有者是 `packages/ui/src/task-list/priority-color.ts`，
// 判据跟着它进了 `packages/ui/tests/task-row-priority.spec.ts`。
// 在本文件再抄四行只是把同一个判断放进第三个包。

const zh = translate.bind(null, 'zh-CN');
const en = translate.bind(null, 'en');

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
    expect(toDueDisplay(task(), 'countdown', NOW, zh)).toBeNull();
    expect(toDueDisplay(task(), 'date', NOW, zh)).toBeNull();
    expect(toDueDisplay(task(), 'countdown', NOW, en)).toBeNull();
  });

  describe('date 模式（绝对日期，纯数字、语言无关）', () => {
    it('同年只给月日；两种语言一致', () => {
      const t = task({ dueDate: parseLocalDate('2026-09-26').getTime() });
      expect(toDueDisplay(t, 'date', NOW, zh)?.text).toBe('09-26');
      expect(toDueDisplay(t, 'date', NOW, en)?.text).toBe('09-26');
    });

    it('跨年带上年份', () => {
      const t = task({ dueDate: parseLocalDate('2027-01-05').getTime() });
      expect(toDueDisplay(t, 'date', NOW, zh)?.text).toBe('2027-01-05');
      expect(toDueDisplay(t, 'date', NOW, en)?.text).toBe('2027-01-05');
    });
  });

  describe('countdown 模式（相对时间）', () => {
    it('🔴 中文文案与共享实现 `formatTaskRemaining` **逐字相同**', () => {
      // 这是本文件存在的核心断言：迁移成词条后，"今天/明天/后天/还剩 N 天"
      // 的措辞必须仍然等于 Web 端与领域层的那一份。
      for (const days of [-3, -1, 0, 1, 2, 5, 8, 40]) {
        const t = task({ dueDate: due(days) });
        expect(toDueDisplay(t, 'countdown', NOW, zh)?.text).toBe(formatTaskRemaining(t, { now: NOW }));
      }
    });

    it('中文具体文案是人话，不是"还剩 0 天"', () => {
      const text = (d: number): string =>
        toDueDisplay(task({ dueDate: due(d) }), 'countdown', NOW, zh)!.text;
      expect(text(0)).toBe('今天');
      expect(text(1)).toBe('明天');
      expect(text(2)).toBe('后天');
      expect(text(5)).toBe('还剩 5 天');
      expect(text(-3)).toBe('已逾期 3 天');
    });

    it('英文文案逐条钉住（zh/en 走同一批 key）', () => {
      const text = (d: number): string =>
        toDueDisplay(task({ dueDate: due(d) }), 'countdown', NOW, en)!.text;
      expect(text(0)).toBe('Today');
      expect(text(1)).toBe('Tomorrow');
      expect(text(2)).toBe('Day after tomorrow');
      expect(text(5)).toBe('5 days left');
      expect(text(-3)).toBe('3 days overdue');
    });

    it('🔴 不出现移动端旧实现的说法（已过期 / N 天后 / 绝对日期）', () => {
      const text = (d: number): string =>
        toDueDisplay(task({ dueDate: due(d) }), 'countdown', NOW, zh)!.text;
      expect(text(-3)).not.toContain('已过期');
      expect(text(5)).not.toContain('天后');
      // 8 天后在旧实现里会变成 `9月26日` 这种绝对日期
      expect(text(8)).not.toContain('月');
    });
  });

  describe('档位', () => {
    it('逾期 / 今天 / 快到了 / 还早', () => {
      const urgency = (d: number): string =>
        toDueDisplay(task({ dueDate: due(d) }), 'countdown', NOW, zh)!.urgency;
      expect(urgency(-1)).toBe('overdue');
      expect(urgency(0)).toBe('today');
      expect(urgency(1)).toBe('soon');
      expect(urgency(3)).toBe('soon');
      expect(urgency(4)).toBe('later');
    });

    it('🔴 已完成的任务不再报警（勾掉后不会还红着）', () => {
      const done = task({ dueDate: due(-5), completedAt: NOW });
      const display = toDueDisplay(done, 'countdown', NOW, zh)!;
      expect(display.urgency).toBe('none');
      expect(display.overdue).toBe(false);
      // 文案仍然如实说明它是逾期完成的 —— 隐藏事实和"不报警"是两件事
      expect(display.text).toBe('已逾期 5 天');
      // 英文同一件事。
      expect(toDueDisplay(done, 'countdown', NOW, en)!.text).toBe('5 days overdue');
    });

    it('`date` 模式的档位与 `countdown` 一致（同一个 dueDate，只是换说法）', () => {
      const t = task({ dueDate: due(-1) });
      expect(toDueDisplay(t, 'date', NOW, zh)!.urgency).toBe(
        toDueDisplay(t, 'countdown', NOW, zh)!.urgency,
      );
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
  it('四个档位在两种语言里都有名字，一个不漏', () => {
    for (const p of PRIORITY_ORDER) {
      expect(priorityLabel(p, zh)).toBeTruthy();
      expect(priorityLabel(p, en)).toBeTruthy();
    }
    expect(priorityLabel(Priority.None, zh)).toBe('无');
    expect(priorityLabel(Priority.Low, zh)).toBe('低');
    expect(priorityLabel(Priority.Medium, zh)).toBe('中');
    expect(priorityLabel(Priority.High, zh)).toBe('高');
    expect(priorityLabel(Priority.None, en)).toBe('None');
    expect(priorityLabel(Priority.Low, en)).toBe('Low');
    expect(priorityLabel(Priority.Medium, en)).toBe('Medium');
    expect(priorityLabel(Priority.High, en)).toBe('High');
  });

  it('🔴 顺序是显式升序，不靠枚举反向映射', () => {
    expect([...PRIORITY_ORDER]).toEqual([0, 1, 2, 3]);
  });

  it('🔴 数值枚举的比较：3 才是高优先级', () => {
    // 防止 `priority === 'high'` 那种"永远为假"的写法复活
    expect(priorityBadgeLabel(Priority.High, zh)).toBe('高优先级');
    expect(priorityBadgeLabel(Priority.Medium, zh)).toBe('中优先级');
    expect(priorityBadgeLabel(Priority.Low, zh)).toBe('低优先级');
    expect(priorityBadgeLabel(Priority.High, en)).toBe('High priority');
  });

  it('没有优先级不给徽标（"无优先级"不是信息）', () => {
    expect(priorityBadgeLabel(undefined, zh)).toBeNull();
    expect(priorityBadgeLabel(Priority.None, zh)).toBeNull();
    expect(priorityBadgeLabel(undefined, en)).toBeNull();
    expect(priorityBadgeLabel(Priority.None, en)).toBeNull();
  });
});
