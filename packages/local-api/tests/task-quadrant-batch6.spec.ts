/**
 * 任务四象限整格 / 推迟今天（批次 6-2）的**形状**判据
 * =====================================================
 * 工具：`set_task_quadrant` / `postpone_task_to_today`。只驱动 `toWriteIntent`（纯函数）。
 */
import { describe, expect, it } from 'vitest';
import { LOCAL_API_TOOLS, findTool, toWriteIntent } from '../src/index.js';

function intentOf(name: string, args: Record<string, unknown>): Record<string, unknown> & { action: string } {
  const outcome = toWriteIntent(name, args);
  expect(outcome.ok, `期望 ${name} 合法：${JSON.stringify({ args, outcome })}`).toBe(true);
  if (!outcome.ok) throw new Error(outcome.message);
  return outcome.intent as Record<string, unknown> & { action: string };
}
function expectRejected(name: string, args: Record<string, unknown>, mustMention?: string): void {
  const outcome = toWriteIntent(name, args);
  expect(outcome.ok, `期望 ${name} 拒绝：${JSON.stringify(args)}`).toBe(false);
  if (outcome.ok) return;
  expect(outcome.message).not.toContain('注册不齐');
  if (mustMention !== undefined) expect(outcome.message).toContain(mustMention);
}

describe('set_task_quadrant', () => {
  it('1–4 产出 set-task-quadrant', () => {
    for (const q of [1, 2, 3, 4]) {
      expect(intentOf('set_task_quadrant', { taskId: 't1', quadrant: q })).toEqual({
        action: 'set-task-quadrant', taskId: 't1', quadrant: q,
      });
    }
  });
  it('未知参数拒绝', () => expectRejected('set_task_quadrant', { taskId: 't1', quadrant: 1, x: 1 }, 'x'));
  it('quadrant 非 1–4 整数 / taskId 缺失 ⇒ 拒', () => {
    for (const q of [0, 5, 3.5, -1]) expectRejected('set_task_quadrant', { taskId: 't1', quadrant: q }, 'quadrant');
    expectRejected('set_task_quadrant', { taskId: 't1', quadrant: '1' }, 'quadrant');
    expectRejected('set_task_quadrant', { quadrant: 1 }, 'taskId');
    expectRejected('set_task_quadrant', { taskId: '', quadrant: 1 }, 'taskId');
  });
});

describe('postpone_task_to_today', () => {
  it('产出 postpone-task-to-today', () => {
    expect(intentOf('postpone_task_to_today', { taskId: 't1' })).toEqual({
      action: 'postpone-task-to-today', taskId: 't1',
    });
  });
  it('未知参数 / taskId 缺失 ⇒ 拒', () => {
    expectRejected('postpone_task_to_today', { taskId: 't1', z: 1 }, 'z');
    expectRejected('postpone_task_to_today', {}, 'taskId');
  });
});

describe('目录声明', () => {
  for (const name of ['set_task_quadrant', 'postpone_task_to_today']) {
    it(name, () => {
      const tool = findTool(name);
      expect(tool).toBeDefined();
      expect(tool?.kind).toBe('write');
      expect(tool?.risk).toBe('write');
      expect(tool?.egressFields).toEqual([]);
      expect(tool?.defaultEnabled).toBe(false);
      expect(LOCAL_API_TOOLS.map((t) => t.name)).toContain(name);
    });
  }
});
