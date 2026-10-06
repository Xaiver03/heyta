import { describe, expect, it } from 'vitest';
import type { Reminder, Task } from '@heyta/domain';
import { planNativeReminders } from '../src/lib/native-reminder-plan';

const task = (id: string, title: string, extra: Partial<Task> = {}): Task =>
  ({ id, title, createdAt: 0, updatedAt: 0, ...extra }) as Task;
const reminder = (id: string, taskId: string, extra: Partial<Reminder> = {}): Reminder =>
  ({ id, taskId, triggerAt: 1_000, createdAt: 0, updatedAt: 0, ...extra }) as Reminder;

describe('native reminder plan', () => {
  it('补算已错过提醒为立即投递，并按确定顺序排列', () => {
    const plans = planNativeReminders(
      [reminder('b', 't'), reminder('a', 't', { triggerAt: 500 })],
      { t: task('t', '交周报') },
      2_000,
    );
    expect(plans.map(({ id, occurrenceId, atMs }) => [id, occurrenceId, atMs])).toEqual([
      ['a', 'a|500', 2_250], ['b', 'b|1000', 2_250],
    ]);
  });

  it('不为墓碑任务、关闭提醒或已投递事实创建系统通知', () => {
    const plans = planNativeReminders(
      [
        reminder('gone-task', 'gone'),
        reminder('dismissed', 't', { dismissedAt: 2 }),
        reminder('fired', 't', { firedAt: 2 }),
        reminder('live', 't'),
      ],
      { gone: task('gone', '删除', { deletedAt: 2 }), t: task('t', '保留') },
      2_000,
    );
    expect(plans.map((plan) => plan.id)).toEqual(['live']);
  });

  it('按确定顺序限制原生队列大小，剩余提醒留待下一次补算', () => {
    const plans = planNativeReminders(
      [reminder('c', 't', { triggerAt: 3 }), reminder('a', 't', { triggerAt: 1 }), reminder('b', 't', { triggerAt: 2 })],
      { t: task('t', '任务') },
      0,
      2,
    );
    expect(plans.map(({ id }) => id)).toEqual(['a', 'b']);
  });

  it('iOS 的 64 条窗口只保留最早的 64 个 occurrence，窗口外不会挤掉更早的提醒', () => {
    const reminders = Array.from({ length: 65 }, (_, index) => reminder(
      `r-${String(index + 1).padStart(2, '0')}`,
      't',
      { triggerAt: index + 1 },
    ));

    const plans = planNativeReminders(reminders, { t: task('t', '窗口') }, 0, 64);

    expect(plans).toHaveLength(64);
    expect(plans[0]?.occurrenceId).toBe('r-01|1');
    expect(plans.at(-1)?.occurrenceId).toBe('r-64|64');
    expect(plans.some(({ occurrenceId }) => occurrenceId === 'r-65|65')).toBe(false);

    const afterWindowMoves = planNativeReminders(
      reminders.map((item, index) => index < 64 ? { ...item, firedAt: 10_000 } : item),
      { t: task('t', '窗口') },
      0,
      64,
    );
    expect(afterWindowMoves).toHaveLength(1);
    expect(afterWindowMoves[0]?.occurrenceId).toBe('r-65|65');
  });
});
