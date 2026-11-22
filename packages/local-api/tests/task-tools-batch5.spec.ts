import { describe, expect, it } from 'vitest';
import { LOCAL_API_TOOLS, toWriteIntent } from '../src/index.js';

const intentOf = (tool: string, args: Record<string, unknown>) => {
  const r = toWriteIntent(tool, args);
  if (r === undefined || r.ok === false) throw new Error(`${tool} 没产出意图：${r?.ok === false ? r.message : 'undefined'}`);
  return r.intent;
};
const rejected = (tool: string, args: Record<string, unknown>) => {
  const r = toWriteIntent(tool, args);
  return r !== undefined && r.ok === false;
};

describe('批次5 重复任务控制工具', () => {
  it('两个工具都登记为 write / egressFields:[] / 默认关', () => {
    for (const name of ['skip_task_occurrence', 'set_task_repeat_after_completion']) {
      const t = LOCAL_API_TOOLS.find((x) => x.name === name);
      expect(t, name).toBeDefined();
      expect(t!.kind).toBe('write');
      expect(t!.risk).toBe('write');
      expect(t!.egressFields).toEqual([]);
      expect(t!.defaultEnabled).toBe(false);
    }
  });
  it('skip_task_occurrence 产出', () => {
    expect(intentOf('skip_task_occurrence', { taskId: ' t1 ' })).toEqual({ action: 'skip-task-occurrence', taskId: 't1' });
    expect(rejected('skip_task_occurrence', { taskId: 't1', extra: 1 })).toBe(true);
    expect(rejected('skip_task_occurrence', {})).toBe(true);
  });
  it('set_task_repeat_after_completion 产出 + 拒绝非布尔/缺必填', () => {
    expect(intentOf('set_task_repeat_after_completion', { taskId: 't1', on: true })).toEqual({ action: 'set-task-repeat-after-completion', taskId: 't1', on: true });
    expect(rejected('set_task_repeat_after_completion', { taskId: 't1', on: 'yes' })).toBe(true);
    expect(rejected('set_task_repeat_after_completion', { taskId: 't1' })).toBe(true);
    expect(rejected('set_task_repeat_after_completion', { taskId: 't1', on: true, extra: 1 })).toBe(true);
  });
});
