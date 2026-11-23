/**
 * 批量打卡工具 `record_habit_checkins`（批次 6-3）的**形状**判据
 * =============================================================
 * 只驱动 `toWriteIntent`（纯函数）。
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

describe('record_habit_checkins', () => {
  it('habitIds 数组 → record-habit-checkins（去重）', () => {
    expect(intentOf('record_habit_checkins', { habitIds: ['h1', 'h2'] })).toEqual({
      action: 'record-habit-checkins', habitIds: ['h1', 'h2'],
    });
    expect(intentOf('record_habit_checkins', { habitIds: ['h1', 'h1', 'h2'] })).toEqual({
      action: 'record-habit-checkins', habitIds: ['h1', 'h2'],
    });
  });
  it('带 date / value', () => {
    expect(intentOf('record_habit_checkins', { habitIds: ['h1'], date: '2026-10-05', value: 3 })).toEqual({
      action: 'record-habit-checkins', habitIds: ['h1'], date: '2026-10-05', value: 3,
    });
  });
  it('未知参数 / habitIds 非数组或空 / 元素非串 / date 非法 / value 负 ⇒ 拒', () => {
    expectRejected('record_habit_checkins', { habitIds: ['h1'], x: 1 }, 'x');
    expectRejected('record_habit_checkins', { habitIds: [] }, 'habitIds');
    expectRejected('record_habit_checkins', { habitIds: 'h1' }, 'habitIds');
    expectRejected('record_habit_checkins', { habitIds: ['h1', ''] }, 'habitIds');
    expectRejected('record_habit_checkins', { habitIds: ['h1', 7] }, 'habitIds');
    expectRejected('record_habit_checkins', { habitIds: ['h1'], date: '2026-02-30' }, 'date');
    expectRejected('record_habit_checkins', { habitIds: ['h1'], value: -1 }, 'value');
  });
});

describe('目录声明', () => {
  it('record_habit_checkins 是 write / risk write / egress [] / 默认关 / 在全局目录', () => {
    const tool = findTool('record_habit_checkins');
    expect(tool).toBeDefined();
    expect(tool?.kind).toBe('write');
    expect(tool?.risk).toBe('write');
    expect(tool?.egressFields).toEqual([]);
    expect(tool?.defaultEnabled).toBe(false);
    expect(LOCAL_API_TOOLS.map((t) => t.name)).toContain('record_habit_checkins');
  });
});
