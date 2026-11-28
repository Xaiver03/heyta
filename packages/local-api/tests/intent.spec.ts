/**
 * 确定性意图分类（域级）的不变量。
 *
 * 目的：把"收错域 ⇒ 挡掉对的工具"这类静默错误变成会红的判据。
 * - 高精度词命中单域 ⇒ 高置信，应收敛；
 * - 没有信号 / 信号发散 ⇒ 低置信，应原样全量；
 * - 按实体域过滤时只留该 pack 的工具，不得串域。
 */
import { describe, expect, it } from 'vitest';

import {
  INTENT_SCOPE_CONFIDENCE_THRESHOLD,
  LOCAL_API_TOOLS,
  classifyIntentDomains,
  filterToolsByEntity,
  scopeToolsByIntent,
} from '../src/index.js';

describe('确定性意图分类（域级）', () => {
  it('单域高精度词 → 高置信、命中该域', () => {
    const task = classifyIntentDomains('帮我建一个任务，明天截止');
    expect(task.entityTypes).toContain('TASK');
    expect(task.confidence).toBeGreaterThanOrEqual(INTENT_SCOPE_CONFIDENCE_THRESHOLD);

    const note = classifyIntentDomains('记一条笔记');
    expect(note.entityTypes).toContain('NOTE');
    expect(note.confidence).toBeGreaterThanOrEqual(INTENT_SCOPE_CONFIDENCE_THRESHOLD);
  });

  it('跨域一句话 → 命中多域（取并集，不误判成单域）', () => {
    const mixed = classifyIntentDomains('把今天的任务整理到笔记里');
    expect(mixed.entityTypes).toContain('TASK');
    expect(mixed.entityTypes).toContain('NOTE');
  });

  it('没有信号 → 空域、零置信（调用方应回退全量）', () => {
    const none = classifyIntentDomains('你好呀');
    expect(none.entityTypes).toEqual([]);
    expect(none.confidence).toBe(0);
  });

  it('按实体域过滤：只留该 pack 的工具，不串域', () => {
    const taskTools = filterToolsByEntity(LOCAL_API_TOOLS, ['TASK']);
    const names = taskTools.map((tool) => tool.name);
    expect(names).toContain('create_task');
    expect(names).toContain('list_tasks');
    expect(names).not.toContain('list_notes');
    expect(names).not.toContain('list_habits');
  });

  it('scopeToolsByIntent：高置信收敛候选集，无信号原样全量', () => {
    const tools = [
      { name: 'create_task' },
      { name: 'list_notes' },
      { name: 'list_habits' },
    ] as const;

    const scoped = scopeToolsByIntent(tools, '帮我建一个任务');
    expect(scoped.scoped).toBe(true);
    expect(scoped.tools.map((t) => t.name)).toContain('create_task');
    expect(scoped.tools.map((t) => t.name)).not.toContain('list_notes');

    const passthrough = scopeToolsByIntent(tools, '你好呀');
    expect(passthrough.scoped).toBe(false);
    expect(passthrough.tools.length).toBe(tools.length);
  });
});
