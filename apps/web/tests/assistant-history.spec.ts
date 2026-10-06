/**
 * 会话历史落盘层测试（D-4 (i)）
 * ================================
 *
 * 这个文件判的**不是**"存了能读回来"，而是四条只有落盘层才拦得住的事：
 *
 *   1. 换账号必须看不见上一段的对话（绑 `account`）；
 *   2. 未确认的改动提案恢复后**不许还能点确认**（`expired`）；
 *   3. 存的条数上界是从出境上界**推导**的，不是另抄一个数；
 *   4. 存储坏了（隐私模式 / 配额满）不许把面板带崩。
 *
 * ⚠️ 全程注入假存储，不碰 jsdom 的 `localStorage` —— 真实读写各测一次就够，
 * 而这三条判据都需要"能控制它回什么"。
 */

import { describe, expect, it } from 'vitest';

import { MAX_ASSISTANT_MESSAGES } from '@heyta/ai';
import type { ChatItem } from '../src/features/ai/assistant-transcript.js';
import {
  ASSISTANT_HISTORY_STORAGE_KEY,
  ASSISTANT_HISTORY_VERSION,
  MAX_PERSISTED_ITEMS,
  clearAssistantHistory,
  loadAssistantHistory,
  saveAssistantHistory,
  truncateForPersistence,
  type HistoryStorage,
  type StoredChatItem,
} from '../src/features/ai/assistant-history.js';

/** 可控假存储：三条操作各自能单独变坏，判据才分得开是哪一个坏了。 */
function fakeStorage(seed?: string): {
  storage: HistoryStorage;
  reads: () => number;
  writes: () => readonly string[];
  removes: () => number;
} {
  let value = seed ?? null;
  let reads = 0;
  let removes = 0;
  const written: string[] = [];
  return {
    storage: {
      getItem: () => {
        reads += 1;
        return value;
      },
      setItem: (_key, next) => {
        value = next;
        written.push(next);
      },
      removeItem: () => {
        removes += 1;
        value = null;
      },
    },
    reads: () => reads,
    writes: () => written,
    removes: () => removes,
  };
}

function item(id: number, over: Partial<ChatItem> & { role: ChatItem['role'] }): ChatItem {
  return { id, text: `第${String(id)}条`, ...over } as ChatItem;
}

/**
 * 取一条落盘记录的正文。
 *
 * 判别联合里只有 `error` 那一支没有 `text`（它带的是 `message`），
 * 所以断言正文必须先过 `role` —— 直接 `.text` 在类型层面就不成立。
 */
function bodyOf(entry: StoredChatItem): string {
  return entry.role === 'error' ? entry.message : entry.text;
}

describe('assistant-history —— 上界是从哪来的', () => {
  it('🔴 存的条数上界必须等于出境消息上界（抄一个固定数字就是等它漂）', () => {
    expect(MAX_PERSISTED_ITEMS).toBe(MAX_ASSISTANT_MESSAGES);
  });

  it('超上界时丢最老的，不丢最近的', () => {
    const many = Array.from({ length: MAX_ASSISTANT_MESSAGES + 5 }, (_u, i) =>
      item(i + 1, { role: 'user', text: `m${String(i + 1)}` }),
    );
    const kept = truncateForPersistence(many);
    expect(kept).toHaveLength(MAX_PERSISTED_ITEMS);
    expect(bodyOf(kept[0]!)).toBe(`m${String(many.length - MAX_PERSISTED_ITEMS + 1)}`);
    expect(bodyOf(kept.at(-1)!)).toBe(`m${String(many.length)}`);
  });
});

describe('assistant-history —— 账号绑定', () => {
  it('存进去再读回来，同账号才恢复', () => {
    const f = fakeStorage();
    const ok = saveAssistantHistory(
      { items: [item(1, { role: 'user', text: '列出我的任务' })], disclosed: true, account: 'me@x.io' },
      f.storage,
    );
    expect(ok).toBe(true);
    const back = loadAssistantHistory('me@x.io', f.storage);
    expect(back).not.toBeNull();
    expect(back!.items.map((x) => x.role)).toEqual(['user']);
    // 一次性披露的"已经看过"必须跟着会话走 —— 不然恢复出来的会话会再拦一遍披露。
    expect(back!.disclosed).toBe(true);
  });

  it('🔴 换一个账号读不到上一段的对话', () => {
    const f = fakeStorage();
    saveAssistantHistory(
      { items: [item(1, { role: 'user', text: '老板的任务' })], disclosed: true, account: 'boss@x.io' },
      f.storage,
    );
    expect(loadAssistantHistory('me@x.io', f.storage)).toBeNull();
    // 不相等时**不能顺手删**别人的那份：用户可能只是这次没登录。
    expect(f.removes()).toBe(0);
  });

  it('未登录（account 为 null）产生的对话，登录后不自动出现', () => {
    const f = fakeStorage();
    saveAssistantHistory({ items: [item(1, { role: 'user' })], disclosed: false, account: null }, f.storage);
    expect(loadAssistantHistory('me@x.io', f.storage)).toBeNull();
    expect(loadAssistantHistory(null, f.storage)).not.toBeNull();
  });
});

describe('assistant-history —— 读不懂就清掉，别每次启动再失败一次', () => {
  it('版本对不上 ⇒ null 且那份被删', () => {
    const f = fakeStorage(
      JSON.stringify({ version: ASSISTANT_HISTORY_VERSION + 1, account: null, disclosed: false, items: [] }),
    );
    expect(loadAssistantHistory(null, f.storage)).toBeNull();
    expect(f.removes()).toBe(1);
  });

  it('不是 JSON ⇒ null 且被删', () => {
    const f = fakeStorage('{这不是 JSON');
    expect(loadAssistantHistory(null, f.storage)).toBeNull();
    expect(f.removes()).toBe(1);
  });

  it('items 不是数组 ⇒ null 且被删', () => {
    const f = fakeStorage(JSON.stringify({ version: ASSISTANT_HISTORY_VERSION, account: null, items: 'x' }));
    expect(loadAssistantHistory(null, f.storage)).toBeNull();
    expect(f.removes()).toBe(1);
  });

  it('🔴 一条都恢复不出来 ⇒ 当作没有，不给界面一段空白历史', () => {
    const f = fakeStorage(
      JSON.stringify({ version: ASSISTANT_HISTORY_VERSION, account: null, disclosed: true, items: [{ role: '???' }] }),
    );
    expect(loadAssistantHistory(null, f.storage)).toBeNull();
    expect(f.removes()).toBe(1);
  });

  it('混着一条认不出的记录：丢那一条，其余照旧恢复', () => {
    const f = fakeStorage(
      JSON.stringify({
        version: ASSISTANT_HISTORY_VERSION,
        account: null,
        disclosed: false,
        items: [{ role: 'user', text: '甲' }, { role: '未来某天的形状' }, { role: 'user', text: '乙' }],
      }),
    );
    const back = loadAssistantHistory(null, f.storage);
    expect(back).not.toBeNull();
    expect(back!.items.map((x) => x.role)).toEqual(['user', 'user']);
    expect(f.removes()).toBe(0);
  });
});

describe('assistant-history —— 🔴 未确认的提案不许复活成"可确认"', () => {
  const proposal = { ruleId: 'r1', tool: 'create_task', intent: { action: 'create-task', title: '甲' } };

  it('confirmed 缺失 ⇒ expired:true', () => {
    const f = fakeStorage();
    saveAssistantHistory(
      {
        items: [item(1, { role: 'proposal', text: '', proposal: proposal as never, confirmed: undefined })],
        disclosed: true,
        account: null,
      },
      f.storage,
    );
    const back = loadAssistantHistory(null, f.storage)!;
    const only = back.items[0]!;
    expect(only.role).toBe('proposal');
    expect(only.role === 'proposal' && only.expired).toBe(true);
    expect(only.role === 'proposal' && only.confirmed).toBeUndefined();
  });

  it('已确认过的提案原样恢复，且**不带** expired', () => {
    const f = fakeStorage();
    saveAssistantHistory(
      {
        items: [
          item(1, {
            role: 'proposal',
            text: '',
            proposal: proposal as never,
            confirmed: { ok: true, taskId: 't1' } as never,
          }),
        ],
        disclosed: true,
        account: null,
      },
      f.storage,
    );
    const only = loadAssistantHistory(null, f.storage)!.items[0]!;
    expect(only.role === 'proposal' && only.expired).toBeUndefined();
    expect(only.role === 'proposal' && only.confirmed?.ok).toBe(true);
  });
});

describe('assistant-history —— 存储坏了不许崩', () => {
  const broken: HistoryStorage = {
    // 隐私模式下连**访问**都抛；配额满时 `setItem` 抛。
    getItem: () => {
      throw new Error('SecurityError');
    },
    setItem: () => {
      throw new Error('QuotaExceededError');
    },
    removeItem: () => {
      throw new Error('SecurityError');
    },
  };

  it('写失败 ⇒ false，不抛', () => {
    expect(() =>
      saveAssistantHistory({ items: [item(1, { role: 'user' })], disclosed: false, account: null }, broken),
    ).not.toThrow();
    expect(
      saveAssistantHistory({ items: [item(1, { role: 'user' })], disclosed: false, account: null }, broken),
    ).toBe(false);
  });

  it('读失败 ⇒ null，不抛', () => {
    expect(() => loadAssistantHistory(null, broken)).not.toThrow();
    expect(loadAssistantHistory(null, broken)).toBeNull();
  });

  it('清除失败 ⇒ 不抛', () => {
    expect(() => clearAssistantHistory(broken)).not.toThrow();
  });

  it('没有存储（返回 null 的环境）⇒ 写 false / 读 null / 清不抛', () => {
    expect(saveAssistantHistory({ items: [item(1, { role: 'user' })], disclosed: false, account: null }, null)).toBe(
      false,
    );
    expect(loadAssistantHistory(null, null)).toBeNull();
    expect(() => clearAssistantHistory(null)).not.toThrow();
  });
});

describe('assistant-history —— 落盘的就是界面画的那一份（可序列化）', () => {
  it('四类记录各存一条，逐字段往返相同', () => {
    const items: ChatItem[] = [
      item(1, { role: 'user', text: '明天有什么安排' }),
      item(2, {
        role: 'assistant',
        text: '两件',
        steps: [{ tool: 'list_tasks', kind: 'read', ok: true }],
        stoppedAt: undefined,
      }),
      item(3, {
        role: 'error',
        reason: 'routing-failed',
        message: 'no-endpoint',
        cause: 'network',
        endpointUrl: 'http://localhost:11434/v1',
        outsideFields: ['title'],
      }),
    ];
    const f = fakeStorage();
    saveAssistantHistory({ items, disclosed: false, account: null }, f.storage);
    const envelope = JSON.parse(f.writes().at(-1)!) as Record<string, unknown>;
    expect(envelope['version']).toBe(ASSISTANT_HISTORY_VERSION);
    expect(Object.keys(envelope)).toContain('items');
    const back = loadAssistantHistory(null, f.storage)!;
    // `id` 不存（它是渲染计数），恢复后按顺序重编号 ⇒ 顺序与内容必须一致。
    expect(back.items.map((x) => [x.role, 'text' in x ? x.text : x.message])).toEqual([
      ['user', '明天有什么安排'],
      ['assistant', '两件'],
      ['error', 'no-endpoint'],
    ]);
    expect(back.items[1]!.role === 'assistant' && back.items[1]!.steps).toEqual([
      { tool: 'list_tasks', kind: 'read', ok: true },
    ]);
    expect(back.items[2]!.role === 'error' && back.items[2]!.outsideFields).toEqual(['title']);
  });

  it('键名只有一处定义（面板不许自己拼字符串）', () => {
    expect(ASSISTANT_HISTORY_STORAGE_KEY).toBe('heyta.ai.assistant.history');
  });
});
