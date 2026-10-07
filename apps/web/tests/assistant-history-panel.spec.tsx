/**
 * 会话历史恢复 —— 面板侧（D-4 (i) 的用户可见那一半）
 * ======================================================
 *
 * 落盘层的判据在 `assistant-history.spec.ts`；这个文件只判**界面**：
 *
 *   1. 恢复出来的对话看得见，而恢复这件事**一个字节都不发**；
 *   2. 未确认的提案恢复后**没有确认按钮**（一次隔着刷新都没有依据的写入）；
 *   3. 「新会话」把盘上那份一起删掉 —— 只清状态的话，刷新会把它捞回来，
 *      而用户点的是"新会话"；
 *   4. 历史存在哪儿，界面上要说得出（`web.ai.chat.historyLocalOnly`）；
 *   5. 真·刷新模拟：挂载 → 说话 → 卸载 → 用同一份存储再挂载 ⇒ 那句话还在。
 *
 * ⚠️ 与 `ai-assistant-panel.spec.tsx` 同一套约定：真 `requestAssistantTurn`，
 * 只注入工具宿主与 `fetch`，再加上这一层新开的 `historyStorage` 缝。
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { I18nProvider } from '@heyta/i18n';
import type { AiRoutingConfig } from '@heyta/ai';
import type { LocalApiHost, LocalApiItem } from '@heyta/local-api';

import { PanelEphemeralProvider } from '../src/features/ai/panel-ephemeral.js';
import { AssistantPanel } from '../src/features/ai/AssistantPanel.js';
import {
  ASSISTANT_HISTORY_STORAGE_KEY,
  ASSISTANT_HISTORY_VERSION,
  type HistoryStorage,
} from '../src/features/ai/assistant-history.js';

const ROUTING: AiRoutingConfig = {
  enabled: true,
  allowRemote: false,
  endpoints: [
    {
      id: 'local-asst',
      label: '本机（支持工具调用）',
      endpoint: 'http://localhost:11434/v1',
      model: 'qwen3:8b',
      capabilities: ['structured_output', 'tool_calling'],
    },
  ],
  routes: { 'tool-calling': [{ endpointId: 'local-asst' }] },
};

const CONSENTS = [{ feature: 'tool-calling' as const, destination: 'user-endpoint' as const, grantedAt: 1 }];

const secrets = { get: () => Promise.resolve(undefined) };

const ITEMS: readonly LocalApiItem[] = [{ id: 't1', title: '买牛奶', body: '两盒', readable: true }];

function fakeHost(): LocalApiHost & { submits: number } {
  // ⚠️ 成员清单以 `ai-assistant-panel.spec.tsx` 的 `fakeHost` 为准。
  // 这里少一个就会在**合并态**才炸：`LocalApiHost` 从 3 个读方法扩到 9 个之后，
  // 单跑本文件照样绿（运行时没人调那些方法），`tsc` 才判得出类型不完整。
  const host = {
    submits: 0,
    listTasks: () => Promise.resolve(ITEMS),
    getTask: (taskId: string) => Promise.resolve(ITEMS.find((x) => x.id === taskId)),
    listProjects: () => Promise.resolve([{ id: 'p1', name: '工作', taskCount: 1 }]),
    listHabits: () => Promise.resolve([{ id: 'h1', name: '喝水', target: 8 }]),
    listTags: () => Promise.resolve([]),
    listNotes: () => Promise.resolve([]),
    getNote: () => Promise.resolve(undefined),
    listHabitLogs: () => Promise.resolve([]),
    listFocusSessions: () => Promise.resolve([]),
    listEvents: () => Promise.resolve([]),
    getEvent: () => Promise.resolve(undefined),
    listReminders: () => Promise.resolve([]),
    submit: () => {
      host.submits += 1;
      return Promise.resolve({ ok: true as const, taskId: 'created-1' });
    },
  };
  return host;
}

/** 一个可预置、可观察的假存储（三条操作各自计数）。 */
function memoryStorage(seed?: unknown): {
  storage: HistoryStorage;
  removes: () => number;
  writes: () => readonly string[];
  raw: () => string | null;
} {
  let value = seed === undefined ? null : JSON.stringify(seed);
  let removes = 0;
  const written: string[] = [];
  return {
    storage: {
      getItem: () => value,
      setItem: (_key, next) => {
        value = next;
        written.push(next);
      },
      removeItem: () => {
        removes += 1;
        value = null;
      },
    },
    removes: () => removes,
    writes: () => written,
    raw: () => value,
  };
}

/** 预置一段已经看过披露的对话。账号标签 = `null`（测试环境里没有凭据）。 */
function seedTranscript(items: ReadonlyArray<Record<string, unknown>>): Record<string, unknown> {
  return { version: ASSISTANT_HISTORY_VERSION, account: null, disclosed: true, items };
}

const USER_TURN: Record<string, unknown> = { role: 'user', text: '明天有什么安排' };
const ASSISTANT_TURN: Record<string, unknown> = { role: 'assistant', text: '三件事', steps: [] };
const PENDING_PROPOSAL: Record<string, unknown> = {
  role: 'proposal',
  text: '',
  proposal: { ruleId: 'r1', tool: 'create_task', intent: { action: 'create-task', title: '交周报' } },
};

let container: HTMLDivElement | undefined;
let root: Root | undefined;

async function render(storage: HistoryStorage, fetchImpl?: typeof fetch): Promise<HTMLDivElement> {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(
      <I18nProvider locale="zh-CN">
      <PanelEphemeralProvider>
        <AssistantPanel
          routing={ROUTING}
          consents={CONSENTS}
          tier="read-only"
          secrets={secrets}
          host={fakeHost()}
          historyStorage={storage}
          {...(fetchImpl === undefined ? {} : { fetchImpl })}
        />
      </PanelEphemeralProvider>
      </I18nProvider>,
    );
  });
  return container;
}

function text(el: Element): string {
  return el.textContent ?? '';
}

async function type(el: HTMLDivElement, value: string): Promise<void> {
  const input = el.querySelector<HTMLInputElement | HTMLTextAreaElement>('[data-testid="ai-assistant-input"]');
  if (input === null) throw new Error('找不到输入框');
  const prototype = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
  await act(async () => {
    setter?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function click(el: HTMLDivElement, testId: string): Promise<void> {
  const button = el.querySelector<HTMLElement>(`[data-testid="${testId}"]`);
  if (button === null) throw new Error(`找不到 ${testId}`);
  await act(async () => {
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await Promise.resolve();
    await Promise.resolve();
  });
}

/** 只记录被调用次数的假端点（回答一条纯文本）。 */
function countingFetch(): { impl: typeof fetch; calls: () => number } {
  let calls = 0;
  const impl = (() => {
    calls += 1;
    return Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ choices: [{ message: { role: 'assistant', content: '好的' } }] }),
    });
  }) as unknown as typeof fetch;
  return { impl, calls: () => calls };
}

beforeEach(() => {
  container = undefined;
  root = undefined;
});

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  container?.remove();
  container = undefined;
  root = undefined;
});

describe('助手面板 —— 恢复出来的对话', () => {
  it('看得见，而且恢复本身一个请求都不发', async () => {
    const f = memoryStorage(seedTranscript([USER_TURN, ASSISTANT_TURN]));
    const fetcher = countingFetch();
    const el = await render(f.storage, fetcher.impl);

    const transcript = el.querySelector('[data-testid="ai-assistant-transcript"]');
    expect(transcript).not.toBeNull();
    expect(text(transcript!)).toContain('明天有什么安排');
    expect(text(transcript!)).toContain('三件事');
    // 🔴 判据的阳性对照就在同一趟里：挂载不发出请求（否则"恢复顺手发了一次"
    // 这种毛病会让历史越恢复越脏，而界面看不出来）。
    expect(fetcher.calls()).toBe(0);
  });

  it('空盘 ⇒ 没有转录，也没有那句"只存在本机"的声明（没历史时它是噪音）', async () => {
    const f = memoryStorage();
    const el = await render(f.storage);
    expect(el.querySelector('[data-testid="ai-assistant-transcript"]')).toBeNull();
    expect(el.querySelector('[data-testid="ai-assistant-local-only"]')).toBeNull();
  });

  it('🔴 有对话时，界面说得出这段历史存在哪儿', async () => {
    const f = memoryStorage(seedTranscript([USER_TURN]));
    const el = await render(f.storage);
    const note = el.querySelector('[data-testid="ai-assistant-local-only"]');
    expect(note).not.toBeNull();
    expect(text(note!)).toContain('只保存在这台设备');
    expect(text(note!)).toContain('不同步');
  });

  it('未确认的提案恢复后没有确认按钮，只留一条"已经失效"', async () => {
    // 阳性对照在 `ai-assistant-panel.spec.tsx`：同一条 `ai-chat-confirm`
    // 在**当场产生的**提案上是存在、可点的（那边判的是"按下它 submit 才从 0 变 1"）。
    // 两边合起来才说明"这里没有按钮"是因为**恢复**，而不是因为按钮本来就画不出来。
    const f = memoryStorage(seedTranscript([USER_TURN, PENDING_PROPOSAL]));
    const el = await render(f.storage);
    expect(el.querySelector('[data-testid="ai-chat-confirm"]')).toBeNull();
    const expired = el.querySelector('[data-testid="ai-chat-expired"]');
    expect(expired).not.toBeNull();
    expect(text(expired!)).toContain('失效');
    // 卡片本身仍在（对话为什么断在这儿要看得懂）
    expect(text(el.querySelector('[data-testid="ai-assistant-transcript"]')!)).toContain('明天有什么安排');
  });
});

describe('助手面板 —— 「新会话」与写入', () => {
  it('🔴 「新会话」把盘上那份一起删掉（只清状态的话，刷新会把它捞回来）', async () => {
    const f = memoryStorage(seedTranscript([USER_TURN, ASSISTANT_TURN]));
    const el = await render(f.storage);
    await click(el, 'ai-assistant-new-session');

    expect(el.querySelector('[data-testid="ai-assistant-transcript"]')).toBeNull();
    expect(f.removes()).toBeGreaterThan(0);
    expect(f.raw()).toBeNull();
  });

  it('说一句话就落一次盘，内容就是界面显示的那句', async () => {
    const f = memoryStorage(seedTranscript([USER_TURN, ASSISTANT_TURN]));
    const fetcher = countingFetch();
    const el = await render(f.storage, fetcher.impl);

    await type(el, '交周报');
    await click(el, 'ai-assistant-send-button');

    const saved = f.writes().at(-1);
    expect(saved).toBeDefined();
    const envelope = JSON.parse(saved!) as { items: readonly { role: string; text?: string }[] };
    expect(envelope.items.map((x) => [x.role, x.text])).toEqual([
      ['user', '明天有什么安排'],
      ['assistant', '三件事'],
      ['user', '交周报'],
      ['assistant', '好的'],
    ]);
  });

  it('🔴 真·刷新模拟：挂载 → 说话 → 卸载 → 用同一份存储再挂载 ⇒ 那句话还在', async () => {
    const f = memoryStorage();
    const first = countingFetch();
    const el1 = await render(f.storage, first.impl);
    await type(el1, '买牛奶');
    // 空盘 ⇒ 本段会话还没见过一次性披露：第一次点发送**只进披露**，
    // 真正的请求发生在披露上按「发送」之后（这条顺序是隐私不变量，不是流程细节）。
    await click(el1, 'ai-assistant-send-button');
    expect(first.calls()).toBe(0);
    await click(el1, 'ai-assistant-send');
    expect(first.calls()).toBe(1);

    act(() => {
      root?.unmount();
    });
    container?.remove();
    root = undefined;
    container = undefined;

    const second = countingFetch();
    const el2 = await render(f.storage, second.impl);
    expect(text(el2.querySelector('[data-testid="ai-assistant-transcript"]')!)).toContain('买牛奶');
    expect(second.calls()).toBe(0);
  });
});

/** 键名只有一处定义：面板与测试都不该自己拼这个串。 */
it('落盘键名是 `heyta.ai.assistant.history`', () => {
  expect(ASSISTANT_HISTORY_STORAGE_KEY).toBe('heyta.ai.assistant.history');
});
