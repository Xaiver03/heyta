/**
 * 移动端 Chatbot 使用 app-host 的本机历史实现。
 *
 * 这里注入内存 storage，所以不需要 React Native、op-sqlite 或 render 栈；
 * 测到的是跨挂载/跨 tab 仍会发生的真实持久化边界。账号隔离和未确认提案
 * 过期属于隐私/写入安全约束，不能只靠 UI snapshot 或源码字符串证明。
 */

import { describe, expect, it } from 'vitest';

import {
  clearAssistantHistory,
  loadAssistantHistory,
  saveAssistantHistory,
  type ChatItem,
  type HistoryStorage,
} from '@heyta/app-host';

function memoryStorage(seed?: string): HistoryStorage & { raw: () => string | null; removed: () => number } {
  let value = seed ?? null;
  let removeCount = 0;
  return {
    getItem: () => value,
    setItem: (_key, next) => {
      value = next;
    },
    removeItem: () => {
      removeCount += 1;
      value = null;
    },
    raw: () => value,
    removed: () => removeCount,
  };
}

function user(id: number, text: string): ChatItem {
  return { id, role: 'user', text };
}

function pendingProposal(id: number): ChatItem {
  return {
    id,
    role: 'proposal',
    text: '要创建任务：买牛奶',
    proposal: {
      ruleId: 'create-task-rule',
      tool: 'create_task',
      intent: { action: 'create-task', title: '买牛奶' },
    } as never,
    confirmed: undefined,
  };
}

describe('移动端 Chatbot 的共享本机历史', () => {
  it('同一个注入 storage 在重挂载读取时保留顺序和披露状态', () => {
    const storage = memoryStorage();
    expect(
      saveAssistantHistory(
        {
          account: 'alice@example.com',
          disclosed: true,
          items: [user(1, '今天有什么任务？'), user(2, '把第一项标为高优先级')],
        },
        storage,
      ),
    ).toBe(true);

    const remounted = loadAssistantHistory('alice@example.com', storage);
    const secondRead = loadAssistantHistory('alice@example.com', storage);
    expect(remounted?.items.map((item) => item.role === 'user' && item.text)).toEqual([
      '今天有什么任务？',
      '把第一项标为高优先级',
    ]);
    expect(secondRead?.disclosed).toBe(true);
  });

  it('换账号时返回空会话，但保留原账号记录供其再次登录恢复', () => {
    const storage = memoryStorage();
    saveAssistantHistory(
      { account: 'alice@example.com', disclosed: true, items: [user(1, 'Alice 的私密任务')] },
      storage,
    );

    expect(loadAssistantHistory('bob@example.com', storage)).toBeNull();
    expect(storage.removed()).toBe(0);
    expect(loadAssistantHistory('alice@example.com', storage)?.items[0]).toMatchObject({
      role: 'user',
      text: 'Alice 的私密任务',
    });
  });

  it('未确认提案跨重载后变成 expired，确认结果则可以保留', () => {
    const storage = memoryStorage();
    saveAssistantHistory(
      { account: 'alice@example.com', disclosed: true, items: [pendingProposal(1)] },
      storage,
    );
    const pending = loadAssistantHistory('alice@example.com', storage)?.items[0];
    expect(pending?.role).toBe('proposal');
    expect(pending?.role === 'proposal' && pending.expired).toBe(true);
    expect(pending?.role === 'proposal' && pending.confirmed).toBeUndefined();

    const confirmedStorage = memoryStorage();
    saveAssistantHistory(
      {
        account: 'alice@example.com',
        disclosed: true,
        items: [{ ...pendingProposal(1), confirmed: { ok: true } as never }],
      },
      confirmedStorage,
    );
    const confirmed = loadAssistantHistory('alice@example.com', confirmedStorage)?.items[0];
    expect(confirmed?.role === 'proposal' && confirmed.expired).toBeUndefined();
    expect(confirmed?.role === 'proposal' && confirmed.confirmed).toEqual({ ok: true });
  });

  it('新会话清除记录，之后的挂载读不到旧内容', () => {
    const storage = memoryStorage();
    saveAssistantHistory(
      { account: 'alice@example.com', disclosed: true, items: [user(1, '旧会话')] },
      storage,
    );
    clearAssistantHistory(storage);
    expect(loadAssistantHistory('alice@example.com', storage)).toBeNull();
    expect(storage.removed()).toBe(1);
  });
});
