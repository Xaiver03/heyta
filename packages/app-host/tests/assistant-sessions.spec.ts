import { describe, expect, it } from 'vitest';
import {
  ASSISTANT_SESSIONS_STORAGE_KEY,
  ASSISTANT_SESSIONS_VERSION,
  assistantSessionsStorageKey,
  clearAssistantSessions,
  loadAssistantSessions,
  newAssistantSessionId,
  saveAssistantSessions,
  type AssistantSessionInput,
  type HistoryStorage,
} from '../src/assistant-sessions.js';
import type { ChatItem } from '../src/assistant-local-transcript.js';

function memory(): HistoryStorage & { removed: () => number } {
  const values = new Map<string, string>();
  let removed = 0;
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
    removeItem: (key) => {
      removed += 1;
      values.delete(key);
    },
    removed: () => removed,
  };
}

function user(text: string): ChatItem {
  return { id: 1, role: 'user', text };
}

function session(id: string, title: string, items: ChatItem[], over: Partial<AssistantSessionInput> = {}): AssistantSessionInput {
  return { id, title, updatedAt: 100, disclosed: true, items, ...over };
}

describe('助手多会话存储（本机，按账号）', () => {
  it('存进去再读回来：标题 / 正文 / activeId 一致', () => {
    const storage = memory();
    const a = session('a', '第一段', [user('你好'), user('再说一句')]);
    const b = session('b', '第二段', [user('另一段')], { updatedAt: 200 });
    expect(saveAssistantSessions({ activeId: 'b', sessions: [a, b] }, 'me@x.io', storage)).toBe(true);
    const back = loadAssistantSessions('me@x.io', storage)!;
    expect(back.activeId).toBe('b');
    // 落盘按 updatedAt 倒序（保留最近），所以 b(200) 在前、a(100) 在后。
    expect(back.sessions.map((s) => [s.id, s.title, s.items.length])).toEqual([
      ['b', '第二段', 1],
      ['a', '第一段', 2],
    ]);
  });

  it('🔴 换账号读不到上一段；也不顺手删别人的', () => {
    const storage = memory();
    saveAssistantSessions({ activeId: 'a', sessions: [session('a', '老板', [user('老板的任务')])] }, 'boss@x.io', storage);
    const before = storage.removed();
    expect(loadAssistantSessions('me@x.io', storage)).toBeNull();
    expect(storage.removed()).toBe(before); // 账号不等 → 不删
    expect(loadAssistantSessions('boss@x.io', storage)?.sessions[0]!.items[0]).toMatchObject({ text: '老板的任务' });
  });

  it('未登录（null 账号）与登录账号互不可见', () => {
    const storage = memory();
    saveAssistantSessions({ activeId: 'g', sessions: [session('g', '离线', [user('离线草稿')])] }, null, storage);
    expect(loadAssistantSessions('me@x.io', storage)).toBeNull();
    expect(loadAssistantSessions(null, storage)?.sessions[0]!.items[0]).toMatchObject({ text: '离线草稿' });
  });

  it('版本对不上 / 不是 JSON ⇒ null 且那份被清', () => {
    const storage = memory();
    storage.setItem(assistantSessionsStorageKey(null), JSON.stringify({ version: ASSISTANT_SESSIONS_VERSION + 1, account: null, activeId: null, sessions: [] }));
    expect(loadAssistantSessions(null, storage)).toBeNull();
    expect(storage.removed()).toBe(1);

    const storage2 = memory();
    storage2.setItem(assistantSessionsStorageKey(null), '{坏 JSON');
    expect(loadAssistantSessions(null, storage2)).toBeNull();
    expect(storage2.removed()).toBe(1);
  });

  it('一段有内容的都没有 ⇒ 不落空信封（清掉键）', () => {
    const storage = memory();
    saveAssistantSessions({ activeId: 'x', sessions: [session('x', '空', [])] }, null, storage);
    expect(loadAssistantSessions(null, storage)).toBeNull();
  });

  it('🔴 未确认的提案跨重载变 expired（复用单槽层的复活逻辑）', () => {
    const storage = memory();
    const pending: ChatItem = {
      id: 1,
      role: 'proposal',
      text: '',
      proposal: { ruleId: 'r1', tool: 'create_task', intent: { action: 'create-task', title: '甲' } } as never,
      confirmed: undefined,
    };
    saveAssistantSessions({ activeId: 'a', sessions: [session('a', '带提案', [pending])] }, null, storage);
    const only = loadAssistantSessions(null, storage)!.sessions[0]!.items[0]!;
    expect(only.role).toBe('proposal');
    expect(only.role === 'proposal' && only.expired).toBe(true);
  });

  it('clearAssistantSessions 只清本账号', () => {
    const storage = memory();
    saveAssistantSessions({ activeId: 'a', sessions: [session('a', 'A', [user('a')])] }, 'a@x.io', storage);
    saveAssistantSessions({ activeId: 'b', sessions: [session('b', 'B', [user('b')])] }, 'b@x.io', storage);
    clearAssistantSessions('a@x.io', storage);
    expect(loadAssistantSessions('a@x.io', storage)).toBeNull();
    expect(loadAssistantSessions('b@x.io', storage)).not.toBeNull();
  });

  it('键名与 id 生成器', () => {
    expect(assistantSessionsStorageKey(null)).toBe(`${ASSISTANT_SESSIONS_STORAGE_KEY}:guest`);
    expect(assistantSessionsStorageKey('me@x.io')).toContain('account:');
    expect(newAssistantSessionId()).not.toBe(newAssistantSessionId());
  });
});
