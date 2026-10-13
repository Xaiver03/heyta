import { describe, expect, it } from 'vitest';
import {
  ASSISTANT_HISTORY_STORAGE_KEY,
  assistantHistoryAccount,
  createAssistantHistoryAccountResolver,
  clearAssistantHistory,
  loadAssistantHistory,
  saveAssistantHistory,
  scopeAssistantHistoryStorage,
  type HistoryStorage,
} from '../src/assistant-local-history.js';

function memory(): HistoryStorage {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); },
    removeItem: (key) => { values.delete(key); },
  };
}

const conversation = (account: string | null, text: string) => ({
  account,
  disclosed: false,
  items: [{ id: 1, role: 'user' as const, text }],
});

describe('本机助手历史按账号保存', () => {
  it('相同邮箱在不同服务器或不同稳定账号下有独立身份', () => {
    const base = { serverUrl: 'https://one.example/', accountId: 'alice-1', email: 'alice@example.com' };
    expect(assistantHistoryAccount(base)).not.toBe(assistantHistoryAccount({ ...base, serverUrl: 'https://two.example' }));
    expect(assistantHistoryAccount(base)).not.toBe(assistantHistoryAccount({ ...base, accountId: 'alice-2' }));
    expect(assistantHistoryAccount(base)).toBe(assistantHistoryAccount({ ...base, email: 'renamed@example.com' }));
    expect(assistantHistoryAccount(undefined)).toBeNull();
  });
  it('不同账号及离线访客可分别保存，清空一个账号不影响其他账号', () => {
    const storage = memory();
    for (const account of ['alice@example.com', 'bob@example.com', null]) {
      saveAssistantHistory(conversation(account, account ?? '离线'), scopeAssistantHistoryStorage(storage, account));
    }
    clearAssistantHistory(scopeAssistantHistoryStorage(storage, 'bob@example.com'));
    expect(loadAssistantHistory('bob@example.com', scopeAssistantHistoryStorage(storage, 'bob@example.com'))).toBeNull();
    expect(loadAssistantHistory('alice@example.com', scopeAssistantHistoryStorage(storage, 'alice@example.com'))?.items[0]).toMatchObject({ role: 'user', text: 'alice@example.com' });
    expect(loadAssistantHistory(null, scopeAssistantHistoryStorage(storage, null))?.items[0]).toMatchObject({ role: 'user', text: '离线' });
  });

  it('同域不同路径的自托管实例隔离历史，规范化路径及尾斜杠等价', () => {
    const identity = { accountId: 'alice-1', email: 'alice@example.com' };
    const a = assistantHistoryAccount({ ...identity, serverUrl: 'https://selfhost.example/team-a' });
    const b = assistantHistoryAccount({ ...identity, serverUrl: 'https://selfhost.example/team-b/' });
    expect(a).not.toBe(b);
    expect(assistantHistoryAccount({ ...identity, serverUrl: 'https://SELFHOST.example:443/other/../team-a///' })).toBe(a);
    expect(assistantHistoryAccount({ ...identity, serverUrl: 'https://selfhost.example/' }))
      .toBe(assistantHistoryAccount({ ...identity, serverUrl: 'https://selfhost.example' }));
    const storage = memory();
    saveAssistantHistory(conversation(a, '仅属于路径 A 的私密会话'), scopeAssistantHistoryStorage(storage, a));
    expect(loadAssistantHistory(b, scopeAssistantHistoryStorage(storage, b))).toBeNull();
    saveAssistantHistory(conversation(b, '路径 B'), scopeAssistantHistoryStorage(storage, b));
    clearAssistantHistory(scopeAssistantHistoryStorage(storage, b));
    expect(loadAssistantHistory(a, scopeAssistantHistoryStorage(storage, a))?.items[0]).toMatchObject({ text: '仅属于路径 A 的私密会话' });
  });

  it('手动凭据缺少已核验身份时必须有独立会话域，不回落到共用账号', () => {
    const base = { serverUrl: 'https://selfhost.example' };
    expect(() => assistantHistoryAccount(base)).toThrow('identity');
    const alice = assistantHistoryAccount({ ...base, sessionId: 'session-a' });
    const bob = assistantHistoryAccount({ ...base, sessionId: 'session-b' });
    expect(alice).not.toBe(bob);
    const storage = memory();
    saveAssistantHistory(conversation(alice, '私有草稿'), scopeAssistantHistoryStorage(storage, alice));
    expect(loadAssistantHistory(bob, scopeAssistantHistoryStorage(storage, bob))).toBeNull();
  });

  it('手动会话跨页面重挂载保持身份，换令牌和登出后重新登录不会串历史', () => {
    const resolve = createAssistantHistoryAccountResolver();
    const alice = { serverUrl: 'https://selfhost.example', token: 'alice-secret' };
    const first = resolve(alice);
    expect(resolve({ ...alice })).toBe(first);
    expect(first).not.toContain(alice.token);
    expect(resolve({ ...alice, token: 'bob-secret' })).not.toBe(first);
    expect(resolve(undefined)).toBeNull();
    expect(resolve(alice)).not.toBe(first);
    const official = { ...alice, accountId: 'verified-alice' };
    expect(resolve(official)).toBe(resolve({ ...official, token: 'refreshed' }));
  });

  it('另一个账号读写或清空时保留旧单槽记录，原账号仍能恢复并迁入独立存储', () => {
    const storage = memory();
    saveAssistantHistory(conversation('alice@example.com', '旧记录'), storage);
    const bob = scopeAssistantHistoryStorage(storage, 'bob@example.com');
    clearAssistantHistory(bob);
    saveAssistantHistory(conversation('bob@example.com', '新记录'), bob);
    const alice = scopeAssistantHistoryStorage(storage, 'alice@example.com');
    expect(loadAssistantHistory('alice@example.com', alice)?.items[0]).toMatchObject({ role: 'user', text: '旧记录' });
    saveAssistantHistory(conversation('alice@example.com', '继续对话'), alice);
    expect(storage.getItem(ASSISTANT_HISTORY_STORAGE_KEY)).toBeNull();
    expect(loadAssistantHistory('bob@example.com', bob)?.items[0]).toMatchObject({ role: 'user', text: '新记录' });
    expect(loadAssistantHistory('alice@example.com', alice)?.items[0]).toMatchObject({ role: 'user', text: '继续对话' });
  });

  it('新槽写入失败时保留可恢复的旧记录', () => {
    const storage = memory();
    saveAssistantHistory(conversation('alice@example.com', '旧记录'), storage);
    const failing: HistoryStorage = { ...storage, setItem: () => { throw new Error('quota'); } };
    expect(saveAssistantHistory(conversation('alice@example.com', '新记录'), scopeAssistantHistoryStorage(failing, 'alice@example.com'))).toBe(false);
    expect(loadAssistantHistory('alice@example.com', scopeAssistantHistoryStorage(storage, 'alice@example.com'))?.items[0]).toMatchObject({ role: 'user', text: '旧记录' });
  });
});
