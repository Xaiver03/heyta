/**
 * 长会话历史压缩（确定性）不变量。
 *
 * 把"撞 MAX_ASSISTANT_MESSAGES 就硬停"换成"先压缩再发"—— 这里钉住压缩本身的形状：
 * 阈值内不动、阈值外折成「一条摘要 + 最近 N 条原文」、最近原文逐字保留。
 */
import { describe, expect, it } from 'vitest';

import {
  ASSISTANT_COMPACT_KEEP_RECENT,
  ASSISTANT_COMPACT_TRIGGER,
  compactAssistantHistory,
} from '../src/index.js';

const msg = (i: number) => ({
  role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
  text: `第 ${String(i)} 条`,
});

describe('compactAssistantHistory', () => {
  it('未超过阈值 ⇒ 原样返回（同一引用），不压缩', () => {
    const history = Array.from({ length: ASSISTANT_COMPACT_TRIGGER }, (_u, i) => msg(i));
    const result = compactAssistantHistory(history);
    expect(result.compacted).toBe(false);
    expect(result.droppedCount).toBe(0);
    expect(result.history).toBe(history);
  });

  it('超过阈值 ⇒ 折成「一条摘要 + 最近 N 条」，最近原文逐字保留', () => {
    const len = ASSISTANT_COMPACT_TRIGGER + 18;
    const history = Array.from({ length: len }, (_u, i) => msg(i));
    const result = compactAssistantHistory(history);
    expect(result.compacted).toBe(true);
    expect(result.droppedCount).toBe(len - ASSISTANT_COMPACT_KEEP_RECENT);
    expect(result.history.length).toBe(1 + ASSISTANT_COMPACT_KEEP_RECENT);

    const [summary, ...recent] = result.history;
    expect(summary?.role).toBe('assistant');
    expect(summary?.text).toContain('已压缩');
    // 最后一条原文必须逐字在，且顺序不变。
    expect(recent[recent.length - 1]?.text).toBe(`第 ${String(len - 1)} 条`);
    expect(recent[0]?.text).toBe(`第 ${String(len - ASSISTANT_COMPACT_KEEP_RECENT)} 条`);
  });

  it('摘要里的"较早最后一句用户输入"会被截断，不整段原样塞回', () => {
    const long = 'x'.repeat(500);
    const history = [
      ...Array.from({ length: ASSISTANT_COMPACT_TRIGGER }, (_u, i) => msg(i)),
      { role: 'user' as const, text: long },
      ...Array.from({ length: ASSISTANT_COMPACT_KEEP_RECENT }, (_u, i) => msg(i + 100)),
    ];
    const result = compactAssistantHistory(history);
    const summary = result.history[0]?.text ?? '';
    expect(summary).toContain('较早最后一句用户输入');
    // 500 个 x 不应被整段塞进摘要（截断上限 160）。
    expect(summary.length).toBeLessThan(400);
  });
});
