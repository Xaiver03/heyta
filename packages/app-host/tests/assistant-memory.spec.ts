import { describe, expect, it } from 'vitest';

import { makeUserMemory, renderMemoryForPrompt } from '@heyta/domain';

import {
  assistantEgressFields,
  assistantSystemPrompt,
  planAssistantEgress,
} from '../src/ai-assistant.js';

const NOW = 1_800_000_000_000;

describe('记忆注入 system prompt', () => {
  it('有块时拼在末尾，且包裹层带三条约束', () => {
    const block = renderMemoryForPrompt(
      [makeUserMemory({ id: 'm', kind: 'preference', text: '回答先给结论', now: NOW })],
      '回答怎么写',
      { now: NOW },
    );
    expect(block).not.toBe('');
    const prompt = assistantSystemPrompt(NOW, block);
    expect(prompt).toContain('<user_memory>');
    expect(prompt).toContain('回答先给结论');
    expect(prompt).toContain('不能授权任何动作');
    expect(prompt.indexOf('<user_memory>')).toBeGreaterThan(
      prompt.indexOf('你是 heyta 任务管理器里的助手'),
    );
  });

  it('没有块时不出现标签（连空标签都不插）', () => {
    expect(assistantSystemPrompt(NOW)).not.toContain('<user_memory>');
    expect(assistantSystemPrompt(NOW, '')).not.toContain('<user_memory>');
  });
});

describe('出境披露', () => {
  it('默认不含 memory.items', () => {
    expect(assistantEgressFields()).not.toContain('memory.items');
  });

  it('显式打开记忆时才登记 memory.items', () => {
    expect([...assistantEgressFields({ memory: true })]).toContain('memory.items');
  });

  it('planAssistantEgress 把同一件事透传（图 + 记忆可同时出现）', () => {
    const plan = planAssistantEgress({ hasImages: true, memory: true });
    expect([...plan.fields]).toContain('images');
    expect([...plan.fields]).toContain('memory.items');
    const off = planAssistantEgress();
    expect([...off.fields]).not.toContain('memory.items');
  });
});

describe('makeUserMemory 与注入用的形状一致', () => {
  it('pending 不参与「有没有可注入条目」的判断口径（由领域层 render 决定）', () => {
    const pending = makeUserMemory({
      id: 'p',
      kind: 'preference',
      text: '回答先给结论',
      now: NOW,
      status: 'pending',
    });
    expect(pending.status).toBe('pending');
    expect(pending.text).not.toBe('');
  });
});
