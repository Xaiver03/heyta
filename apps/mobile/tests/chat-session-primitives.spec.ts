/**
 * 移动端单一 Chatbot 的无原生依赖行为基线。
 *
 * 移动端当前没有 React Native render/test 栈；这里测的是接线必须复用的
 * 纯状态边界，而不是把 AssistantScreen 的源码字符串抄进断言：发送/确认
 * 的同步闸门和本地会话存储都可以在 Node 里用注入依赖重放。
 *
 * 更高层的 disclose → running → error/proposal 状态机由
 * `chat-controller.spec.ts` 通过注入 request/confirm 覆盖。
 */

import { describe, expect, it } from 'vitest';
import { createExecutionGate } from '../src/ai/execution-gate';

describe('Chatbot 执行闸门', () => {
  it('同一轮连点只接受一次，异步完成释放后下一轮可重试', () => {
    const gate = createExecutionGate();
    const calls: string[] = [];

    if (gate.tryEnter()) calls.push('第一次');
    if (gate.tryEnter()) calls.push('重复点击');

    expect(calls).toEqual(['第一次']);
    expect(gate.isActive()).toBe(true);

    gate.leave();
    if (gate.tryEnter()) calls.push('重试');
    expect(calls).toEqual(['第一次', '重试']);
    expect(gate.isActive()).toBe(true);
  });

  it('重复释放不会把下一轮错误地锁死', () => {
    const gate = createExecutionGate();
    expect(gate.tryEnter()).toBe(true);
    gate.leave();
    gate.leave();
    expect(gate.tryEnter()).toBe(true);
  });
});
