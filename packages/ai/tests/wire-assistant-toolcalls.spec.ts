/** assistant.tool_calls 的线格式：有则发、无则逐字不变（多步工具调用第二步的要求）。 */
import { describe, expect, it } from 'vitest';
import { buildChatRequestBody } from '../src/wire.js';

const inv = (messages: unknown[]) =>
  ({ system: 's', user: 'u', fields: [], messages } as never);

describe('wire：assistant.tool_calls', () => {
  it('带 toolCalls 的 assistant 帧发出 tool_calls（OpenAI 兼容形状）', () => {
    const body = buildChatRequestBody('m', inv([
      { role: 'user', content: 'u' },
      { role: 'assistant', content: '', toolCalls: [{ id: 'c1', name: 'list_tasks', arguments: '{}' }] },
      { role: 'tool', content: '[]', toolCallId: 'c1' },
    ]));
    expect(body.messages[1]).toMatchObject({
      role: 'assistant',
      tool_calls: [{ id: 'c1', type: 'function', function: { name: 'list_tasks', arguments: '{}' } }],
    });
    expect(body.messages[2]).toMatchObject({ role: 'tool', tool_call_id: 'c1' });
  });

  it('不带 toolCalls 的 assistant 帧没有 tool_calls 键（逐字不变）', () => {
    const body = buildChatRequestBody('m', inv([
      { role: 'user', content: 'u' },
      { role: 'assistant', content: 'hi' },
    ]));
    expect('tool_calls' in body.messages[1]!).toBe(false);
  });
});
