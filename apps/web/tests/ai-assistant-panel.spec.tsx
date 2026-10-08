/**
 * 对话助手面板测试
 * ====================
 *
 * 🔴 本文件最要紧的**不是**"聊天能不能跑"，而是四条只能靠**数请求**证明的承诺：
 *
 *   1. 第一次点「发送」**一个字节都不发** —— 必须先见一次性披露。
 *      这条如果坏了，症状是"一切正常"，只有请求计数知道。
 *   2. 披露里说的字段与工具，必须**逐字等于** `planAssistantEgress(tier)` 给的集合 ——
 *      界面自己抄一份，就是替隐私承诺撒一个会过期的谎。
 *   3. 执行档低风险写入自动提交；高风险提案出现时 `host.submit` **必须是 0**，只有按下确认才变成 1。
 *   4. 「新会话」要重新要求披露（上界与出境集合是按"一段会话"承诺的）。
 *
 * ⚠️ 全程真实链路：真 `requestAssistantTurn` + 真 `confirmAiToolProposal`，
 * 只注入两个边界 —— 工具宿主（进程内端口）与 `fetch`（HTTP 边界）。
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { I18nProvider, en, zhCN } from '@heyta/i18n';
import { planAssistantEgress, type AssistantTier } from '@heyta/app-host';
import type { AiRoutingConfig } from '@heyta/ai';
import type { LocalApiHost, LocalApiItem } from '@heyta/local-api';

import { PanelEphemeralProvider } from '../src/features/ai/panel-ephemeral.js';
import { AssistantPanel } from '../src/features/ai/AssistantPanel.js';

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

const NO_ROUTE: AiRoutingConfig = { ...ROUTING, routes: {} };

const CONSENTS = [{ feature: 'tool-calling' as const, destination: 'user-endpoint' as const, grantedAt: 1 }];

const secrets = { get: () => Promise.resolve(undefined) };

/** 有备注的可读条目 —— 披露与越界判据都要它。 */
const ITEMS: readonly LocalApiItem[] = [{ id: 't1', title: '买牛奶', body: '两盒', readable: true }];

function fakeHost(items: readonly LocalApiItem[] = ITEMS): LocalApiHost & { submits: number } {
  const host = {
    submits: 0,
    listTasks: () => Promise.resolve(items),
    getTask: (taskId: string) => Promise.resolve(items.find((x) => x.id === taskId)),
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

/** 模型的一次回包。 */
type Reply =
  | { kind: 'text'; text: string }
  | { kind: 'call'; id: string; name: string; args: string };

function toMessage(reply: Reply): Record<string, unknown> {
  if (reply.kind === 'text') return { role: 'assistant', content: reply.text };
  return {
    role: 'assistant',
    content: null,
    tool_calls: [
      { id: reply.id, type: 'function', function: { name: reply.name, arguments: reply.args } },
    ],
  };
}

/** 只记录不拦截的假端点。脚本用完还在被调用 ⇒ 抛错（循环没停在它该停的地方）。 */
function scriptedFetch(replies: readonly Reply[]): { impl: typeof fetch; bodies: string[] } {
  const bodies: string[] = [];
  let index = 0;
  const impl = ((url: unknown, init?: { body?: unknown }) => {
    bodies.push(String(init?.body ?? '{}'));
    const reply = replies[index];
    index += 1;
    if (reply === undefined) {
      throw new Error(`假端点脚本只有 ${String(replies.length)} 条，第 ${String(index)} 次请求没有回包`);
    }
    return Promise.resolve({
      ok: true,
      status: 200,
      // 🔴 真实帧形状：`{ choices: [ { message: … } ] }`（少一层 `message` 是桩的 bug）。
      json: () => Promise.resolve({ choices: [{ message: toMessage(reply) }] }),
    });
  }) as unknown as typeof fetch;
  return { impl, bodies };
}

/** 延迟回包的 provider：用来把并发发送和切会话竞态固定在测试里。 */
function delayedFetch(): {
  impl: typeof fetch;
  bodies: string[];
  pending: number;
  resolve: (index: number, reply: Reply) => void;
} {
  const bodies: string[] = [];
  const resolvers: Array<(value: Response) => void> = [];
  const impl = ((url: unknown, init?: { body?: unknown }) => {
    bodies.push(String(init?.body ?? '{}'));
    return new Promise<Response>((resolve) => {
      resolvers.push(resolve);
    });
  }) as unknown as typeof fetch;
  return {
    impl,
    bodies,
    get pending() {
      return resolvers.length;
    },
    resolve: (index, reply) => {
      const resolve = resolvers[index];
      if (resolve === undefined) throw new Error(`没有第 ${String(index + 1)} 个延迟请求`);
      resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ choices: [{ message: toMessage(reply) }] }),
      } as Response);
    },
  };
}

let container: HTMLDivElement | undefined;
let root: Root | undefined;

async function render(props: {
  host: LocalApiHost;
  fetchImpl?: typeof fetch;
  tier?: AssistantTier;
  routing?: AiRoutingConfig;
  locale?: 'zh-CN' | 'en';
  consents?: typeof CONSENTS;
  historyStorage?: {
    getItem: (key: string) => string | null;
    setItem: (key: string, value: string) => void;
    removeItem: (key: string) => void;
  };
}): Promise<HTMLDivElement> {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(
      <I18nProvider locale={props.locale ?? 'zh-CN'}>
      <PanelEphemeralProvider>
        <AssistantPanel
          routing={props.routing ?? ROUTING}
          consents={props.consents ?? CONSENTS}
          tier={props.tier ?? 'read-only'}
          secrets={secrets}
          host={props.host}
          {...(props.fetchImpl === undefined ? {} : { fetchImpl: props.fetchImpl })}
          {...(props.historyStorage === undefined ? {} : { historyStorage: props.historyStorage })}
        />
      </PanelEphemeralProvider>
      </I18nProvider>,
    );
  });
  return container;
}

/** React 受控输入：必须走原生 setter，否则 onChange 收不到。 */
async function type(el: HTMLDivElement, text: string): Promise<void> {
  const input = el.querySelector<HTMLInputElement | HTMLTextAreaElement>('[data-testid="ai-assistant-input"]');
  if (input === null) throw new Error('找不到输入框');
  const prototype = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
  await act(async () => {
    setter?.call(input, text);
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

const CJK = /[㐀-䶿一-鿿]/;

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

// ─────────────────────────────────────────────────────────────────────────

describe('🔴 一次性披露在循环之前', () => {
  it('第一次点「发送」⇒ 出现披露，且**一个请求都没发**', async () => {
    const host = fakeHost();
    const { impl, bodies } = scriptedFetch([{ kind: 'text', text: '今天有一条任务。' }]);
    const el = await render({ host, fetchImpl: impl });

    await type(el, '随便说点什么吧');
    await click(el, 'ai-assistant-send-button');

    expect(el.querySelector('[data-testid="ai-assistant-disclosure"]')).not.toBeNull();
    expect(bodies).toHaveLength(0);
    expect(host.submits).toBe(0);
  });

  it('取消披露会恢复草稿，并移除未发送的乐观消息与本机历史', async () => {
    let saved: string | null = null;
    const historyStorage = {
      getItem: () => saved,
      setItem: (_key: string, value: string) => { saved = value; },
      removeItem: () => { saved = null; },
    };
    const host = fakeHost();
    const { impl, bodies } = scriptedFetch([{ kind: 'text', text: '不应发送' }]);
    const el = await render({ host, fetchImpl: impl, historyStorage });

    await type(el, '先看一下再决定');
    await click(el, 'ai-assistant-send-button');
    expect(el.querySelector('[data-testid="ai-chat-user"]')).not.toBeNull();
    expect(saved).toContain('先看一下再决定');

    await click(el, 'ai-assistant-disclosure-close');
    expect(el.querySelector('[data-testid="ai-assistant-disclosure"]')).toBeNull();
    expect(el.querySelector('[data-testid="ai-chat-user"]')).toBeNull();
    expect((el.querySelector('[data-testid="ai-assistant-input"]') as HTMLTextAreaElement).value).toBe('先看一下再决定');
    expect(saved).toBeNull();
    expect(bodies).toHaveLength(0);
  });

  it('按披露块里的「发送」才真的出境，回答渲染出来', async () => {
    const host = fakeHost();
    const { impl, bodies } = scriptedFetch([{ kind: 'text', text: '今天有一条任务。' }]);
    const el = await render({ host, fetchImpl: impl });

    await type(el, '随便说点什么吧');
    await click(el, 'ai-assistant-send-button');
    await click(el, 'ai-assistant-send');

    expect(bodies).toHaveLength(1);
    expect(el.querySelector('[data-testid="ai-chat-assistant"]')?.textContent).toContain(
      '今天有一条任务。',
    );
  });

  it('🔴 规则本机就能答的那一句**不弹披露**，而且零请求', async () => {
    const host = fakeHost();
    const { impl, bodies } = scriptedFetch([{ kind: 'text', text: '这一条不该被用到。' }]);
    const el = await render({ host, fetchImpl: impl });

    await type(el, '今天有什么任务');
    await click(el, 'ai-assistant-send-button');

    expect(
      el.querySelector('[data-testid="ai-assistant-disclosure"]'),
      '本机就答得出的一句话，界面却要求用户批准"内容离开本机" —— 那是一次不会发生的出境的承诺',
    ).toBeNull();
    expect(bodies).toHaveLength(0);
    expect(host.submits).toBe(0);
  });

  it('🔴 披露的字段与工具**逐字等于** `planAssistantEgress(tier)`，不是界面另抄的一份', async () => {
    const host = fakeHost();
    const { impl } = scriptedFetch([{ kind: 'text', text: '好。' }]);
    const el = await render({ host, fetchImpl: impl, tier: 'read-and-propose' });
    await type(el, '帮我建一条');
    await click(el, 'ai-assistant-send-button');

    const plan = planAssistantEgress('read-and-propose');
    await click(el, 'ai-assistant-fields-toggle');
    const disclosureText =
      el.querySelector('[data-testid="ai-assistant-disclosure"]')?.textContent ?? '';
    for (const field of plan.fields) {
      expect(disclosureText, `披露里缺字段 ${field}`).toContain(field);
    }
    const toolsText = el.querySelector('[data-testid="ai-assistant-disclosure-tools"]')?.textContent ?? '';
    for (const tool of plan.tools) {
      expect(toolsText, `披露里缺工具 ${tool}`).toContain(tool);
    }
    // 🔴 写工具**不该**出现在只读档的披露里 —— 档位决定可达集合。
    const readOnly = planAssistantEgress('read-only');
    expect(readOnly.tools).not.toContain('create_task');
    expect(plan.tools).toContain('create_task');
  });

  it('上界的三个数字在披露里说得出（都来自 `planAssistantEgress`）', async () => {
    const host = fakeHost();
    const { impl } = scriptedFetch([{ kind: 'text', text: '好。' }]);
    const el = await render({ host, fetchImpl: impl });
    await type(el, '看看');
    await click(el, 'ai-assistant-send-button');
    const limits = el.querySelector('[data-testid="ai-assistant-disclosure-limits"]')?.textContent ?? '';
    const plan = planAssistantEgress('read-only');
    expect(limits).toContain(String(plan.maxRequests));
    expect(limits).toContain(String(plan.maxMessages));
    expect(limits).toContain(String(plan.maxBytesPerRequest));
  });

  it('同一段会话**不重复拦**：第二句直接发（披露问一次就够）', async () => {
    const host = fakeHost();
    const { impl, bodies } = scriptedFetch([
      { kind: 'text', text: '第一条回答' },
      { kind: 'text', text: '第二条回答' },
    ]);
    const el = await render({ host, fetchImpl: impl });

    await type(el, '第一句');
    await click(el, 'ai-assistant-send-button');
    await click(el, 'ai-assistant-send');
    await type(el, '第二句');
    await click(el, 'ai-assistant-send-button');

    expect(bodies).toHaveLength(2);
    expect(el.querySelector('[data-testid="ai-assistant-disclosure"]')).toBeNull();
  });

  it('「新会话」清空历史，并**重新要求**披露（一次会话一次的承诺随之重来）', async () => {
    const host = fakeHost();
    const { impl, bodies } = scriptedFetch([
      { kind: 'text', text: '第一条回答' },
      { kind: 'text', text: '第二条回答' },
    ]);
    const el = await render({ host, fetchImpl: impl });

    await type(el, '第一句');
    await click(el, 'ai-assistant-send-button');
    await click(el, 'ai-assistant-send');
    await click(el, 'ai-assistant-new-session');
    expect(el.querySelector('[data-testid="ai-assistant-transcript"]')).toBeNull();

    await type(el, '第二句');
    await click(el, 'ai-assistant-send-button');
    expect(el.querySelector('[data-testid="ai-assistant-disclosure"]')).not.toBeNull();
    expect(bodies).toHaveLength(1);
  });

  it('🔴 没有可用端点时**没有**「发送」按钮，一个请求都发不出去', async () => {
    const host = fakeHost();
    const { impl, bodies } = scriptedFetch([{ kind: 'text', text: '不该发生' }]);
    const el = await render({ host, fetchImpl: impl, routing: NO_ROUTE });

    await type(el, '看看');
    await click(el, 'ai-assistant-send-button');

    expect(el.querySelector('[data-testid="ai-assistant-no-target"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="ai-assistant-send"]')).toBeNull();
    expect(bodies).toHaveLength(0);
  });
});

describe('🔴 助手请求竞态：一次发送、一次运行、一次会话', () => {
  it('待确认阶段重复点击发送不会追加第二条消息或覆盖披露', async () => {
    const host = fakeHost();
    const fetch = delayedFetch();
    const el = await render({ host, fetchImpl: fetch.impl });

    await type(el, '先确认这一句');
    const button = el.querySelector<HTMLElement>('[data-testid="ai-assistant-send-button"]');
    if (button === null) throw new Error('找不到发送按钮');
    await act(async () => {
      // 两次事件放在同一次 React flush 中，模拟用户快速双击/回车。
      button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(el.querySelectorAll('[data-testid="ai-chat-user"]')).toHaveLength(1);
    expect(el.querySelectorAll('[data-testid="ai-assistant-disclosure"]')).toHaveLength(1);
    expect(fetch.bodies).toHaveLength(0);
  });

  it('披露确认重复点击只启动一个请求', async () => {
    const host = fakeHost();
    const fetch = delayedFetch();
    const el = await render({ host, fetchImpl: fetch.impl });

    await type(el, '只发送一次');
    await click(el, 'ai-assistant-send-button');
    const confirm = el.querySelector<HTMLElement>('[data-testid="ai-assistant-send"]');
    if (confirm === null) throw new Error('找不到披露确认按钮');
    await act(async () => {
      confirm.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      confirm.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(fetch.bodies).toHaveLength(1);
    expect(el.querySelectorAll('[data-testid="ai-assistant-waiting"]')).toHaveLength(1);
    fetch.resolve(0, { kind: 'text', text: '只收到一次' });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(el.querySelector('[data-testid="ai-chat-assistant"]')?.textContent).toContain('只收到一次');
  });

  it('运行中的请求不会被回车再次提交', async () => {
    const host = fakeHost();
    const fetch = delayedFetch();
    const el = await render({ host, fetchImpl: fetch.impl });

    await type(el, '第一句');
    await click(el, 'ai-assistant-send-button');
    await click(el, 'ai-assistant-send');
    expect(fetch.bodies).toHaveLength(1);

    await type(el, '不应并发发送');
    const input = el.querySelector<HTMLTextAreaElement>('[data-testid="ai-assistant-input"]');
    if (input === null) throw new Error('找不到输入框');
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });

    expect(fetch.bodies).toHaveLength(1);
    expect(el.querySelectorAll('[data-testid="ai-chat-user"]')).toHaveLength(1);
    fetch.resolve(0, { kind: 'text', text: '第一句已完成' });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(el.querySelector('[data-testid="ai-chat-assistant"]')?.textContent).toContain('第一句已完成');
  });

  it('运行中不允许切换新会话；请求结束后才可开启新会话', async () => {
    const host = fakeHost();
    const fetch = delayedFetch();
    const el = await render({ host, fetchImpl: fetch.impl });

    await type(el, '旧会话问题');
    await click(el, 'ai-assistant-send-button');
    await click(el, 'ai-assistant-send');
    expect(fetch.bodies).toHaveLength(1);

    await click(el, 'ai-assistant-new-session');
    expect(el.querySelectorAll('[data-testid="ai-chat-user"]')).toHaveLength(1);
    expect(el.querySelector('[data-testid="ai-assistant-waiting"]')).not.toBeNull();
    expect(fetch.bodies).toHaveLength(1);

    fetch.resolve(0, { kind: 'text', text: '第一会话回答' });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(el.querySelector('[data-testid="ai-chat-assistant"]')?.textContent).toContain('第一会话回答');

    await click(el, 'ai-assistant-new-session');
    expect(el.querySelector('[data-testid="ai-chat-assistant"]')).toBeNull();
    await type(el, '新会话问题');
    await click(el, 'ai-assistant-send-button');
    await click(el, 'ai-assistant-send');
    expect(fetch.bodies).toHaveLength(2);

    fetch.resolve(1, { kind: 'text', text: '新会话回答' });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(el.querySelector('[data-testid="ai-chat-assistant"]')?.textContent).toContain('新会话回答');
  });

  it('运行中即使请求最终产生写入，也不能被新会话隐藏', async () => {
    const host = fakeHost();
    const fetch = delayedFetch();
    const el = await render({ host, fetchImpl: fetch.impl, tier: 'read-and-propose' });

    await type(el, '创建一条任务');
    await click(el, 'ai-assistant-send-button');
    await click(el, 'ai-assistant-send');
    expect(host.submits).toBe(0);

    await click(el, 'ai-assistant-new-session');
    expect(el.querySelector('[data-testid="ai-assistant-waiting"]')).not.toBeNull();
    expect(el.querySelectorAll('[data-testid="ai-chat-user"]')).toHaveLength(1);

    fetch.resolve(0, { kind: 'call', id: 'c1', name: 'create_task', args: '{"title":"写报告"}' });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(host.submits).toBe(1);
    expect(el.querySelector('[data-testid="ai-chat-assistant"]')?.textContent).toContain('已执行');
  });
});

describe('Chatbot IA：历史列与中央空态', () => {
  it('空会话把新会话、历史、问候和紧凑建议收进同一个 Chatbot', async () => {
    const el = await render({ host: fakeHost(), fetchImpl: scriptedFetch([{ kind: 'text', text: '好。' }]).impl });
    expect(el.querySelector('[data-testid="ai-assistant-history"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="ai-assistant-greeting"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="ai-assistant-new-session"]')).not.toBeNull();
    expect(el.querySelectorAll('[data-testid^="ai-assistant-suggestion-"]')).toHaveLength(3);
    expect(el.querySelector('[data-testid="ai-assistant-input"]')).not.toBeNull();
  });
});

describe('🔴 写：低风险自动执行，高风险提案确认', () => {
  it('执行档模型要建任务 ⇒ 自动执行并显示已执行，不出提案卡', async () => {
    const host = fakeHost();
    const { impl } = scriptedFetch([
      { kind: 'call', id: 'c1', name: 'create_task', args: '{"title":"买咖啡"}' },
    ]);
    const el = await render({ host, fetchImpl: impl, tier: 'read-and-propose' });
    await type(el, '记一下 买咖啡');
    await click(el, 'ai-assistant-send-button');
    await click(el, 'ai-assistant-send');

    expect(el.querySelector('[data-testid="ai-chat-proposal"]')).toBeNull();
    expect(el.querySelector('[data-testid="ai-chat-assistant"]')?.textContent).toContain('已执行');
    expect(host.submits).toBe(1);
  });

  it('高风险批量完成任务 ⇒ 按下确认才落库：submit 从 0 变 1', async () => {
    const host = fakeHost();
    const { impl } = scriptedFetch([
      { kind: 'call', id: 'c1', name: 'complete_task', args: '{"taskIds":["t1","t2"]}' },
    ]);
    const el = await render({ host, fetchImpl: impl, tier: 'read-and-propose' });
    await type(el, '记一下 买咖啡');
    await click(el, 'ai-assistant-send-button');
    await click(el, 'ai-assistant-send');
    await click(el, 'ai-chat-confirm');

    expect(host.submits).toBe(1);
    expect(el.querySelector('[data-testid="ai-chat-confirmed"]')).not.toBeNull();
  });

  it('🔴 提案之后**没有第二次模型调用**（模型看不到它被批准）', async () => {
    const host = fakeHost();
    const { impl, bodies } = scriptedFetch([
      { kind: 'call', id: 'c1', name: 'complete_task', args: '{"taskIds":["t1","t2"]}' },
      // 故意留一条：循环没停在提案上就会消费它、请求数变成 2。
      { kind: 'text', text: '我还想再问一句' },
    ]);
    const el = await render({ host, fetchImpl: impl, tier: 'read-and-propose' });
    await type(el, '记一下 买咖啡');
    await click(el, 'ai-assistant-send-button');
    await click(el, 'ai-assistant-send');
    await click(el, 'ai-chat-confirm');

    expect(bodies).toHaveLength(1);
  });
});

describe('过程可见与失败', () => {
  it('读循环的步数显示成「用了 N 步工具」', async () => {
    const host = fakeHost();
    const { impl } = scriptedFetch([
      { kind: 'call', id: 'c1', name: 'list_tasks', args: '{}' },
      { kind: 'text', text: '一条：买牛奶' },
    ]);
    const el = await render({ host, fetchImpl: impl });
    await type(el, '看看今天');
    await click(el, 'ai-assistant-send-button');
    await click(el, 'ai-assistant-send');

    const trace = el.querySelector('[data-testid="ai-chat-trace"]')?.textContent ?? '';
    expect(trace).toContain('1');
  });

  it('没调用工具时明说（不留一行空白让人以为坏了）', async () => {
    const host = fakeHost();
    const { impl } = scriptedFetch([{ kind: 'text', text: '你好' }]);
    const el = await render({ host, fetchImpl: impl });
    await type(el, '你好');
    await click(el, 'ai-assistant-send-button');
    await click(el, 'ai-assistant-send');
    expect(el.querySelector('[data-testid="ai-chat-trace"]')?.textContent).toContain('没有调用工具');
  });

  it('触顶 ⇒ 停下来并说明停在哪一个上界', async () => {
    const host = fakeHost();
    const replies: Reply[] = [];
    for (let i = 0; i < 8; i += 1) {
      replies.push({ kind: 'call', id: `c${String(i)}`, name: 'list_projects', args: '{}' });
    }
    const { impl } = scriptedFetch(replies);
    const el = await render({ host, fetchImpl: impl });
    await type(el, '一直查');
    await click(el, 'ai-assistant-send-button');
    await click(el, 'ai-assistant-send');

    expect(el.querySelector('[data-testid="ai-chat-stopped"]')?.textContent).toContain('tool-steps');
  });

  it('🔴 越界出境失败时，**未批准的字段名必须看得见**（那是唯一的证据）', async () => {
    // 走 `get_task` 而不是 `list_tasks`：列表那一侧是**白名单重建**，
    // 多出来的字段根本出不去（`packages/local-api` 的 `projectListForTool`），
    // 而详情对可读条目是原样返回 —— 所以越界只在详情这条路上发生。
    const leaky = {
      id: 't1',
      title: '买牛奶',
      body: '两盒',
      readable: true,
      ownerPhone: '13900000000',
    } as unknown as LocalApiItem;
    const host = fakeHost([leaky]);
    const { impl, bodies } = scriptedFetch([
      { kind: 'call', id: 'c1', name: 'get_task', args: '{"taskId":"t1"}' },
      { kind: 'text', text: '不该走到这里' },
    ]);
    const el = await render({ host, fetchImpl: impl });
    await type(el, '读一条');
    await click(el, 'ai-assistant-send-button');
    await click(el, 'ai-assistant-send');

    const outside = el.querySelector('[data-testid="ai-chat-outside-fields"]')?.textContent ?? '';
    expect(outside).toContain('ownerPhone');
    // 🔴 那一步没发出去：整轮只有第一次请求。
    expect(bodies).toHaveLength(1);
    // 越界的那个值**没有**出现在任何已发出的请求体里。
    expect(bodies[0]).not.toContain('13900000000');
  });

  it('🔴 英文界面的失败**主文案不露中文**（包给的原文只允许进折叠详情）', async () => {
    const host = fakeHost();
    const { impl } = scriptedFetch([{ kind: 'call', id: 'c1', name: 'get_task', args: '不是JSON' }]);
    const el = await render({ host, fetchImpl: impl, locale: 'en' });
    await type(el, 'read one');
    await click(el, 'ai-assistant-send-button');
    await click(el, 'ai-assistant-send');

    const message = el.querySelector('[data-testid="ai-chat-failure-message"]')?.textContent ?? '';
    expect(message).toBe(en['web.ai.assistant.failure.argumentsMalformed']);
    const panelText = el.querySelector('[data-testid="ai-assistant"]')?.textContent ?? '';
    expect(CJK.test(panelText)).toBe(false);
  });

  it('中文界面的失败主文案取词条（不是包那句拼好的中文原文被当界面话）', async () => {
    const host = fakeHost();
    const { impl } = scriptedFetch([{ kind: 'call', id: 'c1', name: 'get_task', args: 'not json' }]);
    const el = await render({ host, fetchImpl: impl });
    await type(el, '读一条');
    await click(el, 'ai-assistant-send-button');
    await click(el, 'ai-assistant-send');
    expect(el.querySelector('[data-testid="ai-chat-failure-message"]')?.textContent).toBe(
      zhCN['web.ai.assistant.failure.argumentsMalformed'],
    );
  });

  it('免责声明常驻，且当前档位写在界面上（用户知道自己在用哪一档）', async () => {
    const host = fakeHost();
    const { impl } = scriptedFetch([{ kind: 'text', text: '好' }]);
    const el = await render({ host, fetchImpl: impl, tier: 'read-and-propose' });
    expect(el.querySelector('[data-testid="ai-assistant-disclaimer"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="ai-assistant-tier"]')?.textContent).toContain('执行');
  });
});

/**
 * 🔴 「谁说的」必须看得出来 —— 这条是**看截图**看出来的缺陷。
 *
 * 第一版直接套 `.ht-ai__items`（工具结果列表：整行左对齐 + 项目符号），
 * 于是用户那句"今天有什么任务"和助手那句回答在界面上**长得一模一样**，
 * 唯一区别是助手行下面多了一句"用了 N 步工具"。功能断言全绿、真浏览器截图也拍了 ——
 * 是**人打开那张图**才看见的（AGENTS §6.2 规定一第 4 条）。
 *
 * 所以这里钉两件事，缺一不可：
 *   ① 两种角色各自带**不同的**修饰类（不是同一个 class 复制两遍）；
 *   ② 那两个 class 在样式表里**真的有规则**。
 * 只钉 ① 的话，删掉 CSS 里那两条规则界面照样退回"一列输出"而没人会红 ——
 * jsdom 不排版，class 在、规则不在，正是"看起来在保护一件事，其实保护的是另一件"。
 */
describe('对话记录里"谁说的"看得出来', () => {
  it('用户行与助手行带各自的角色修饰类，且两者不同', async () => {
    const host = fakeHost();
    const { impl } = scriptedFetch([{ kind: 'text', text: '今天有 1 条' }]);
    const el = await render({ host, fetchImpl: impl });
    await type(el, '随便说点什么吧');
    await click(el, 'ai-assistant-send-button');
    await click(el, 'ai-assistant-send');

    const user = el.querySelector('[data-testid="ai-chat-user"]');
    const assistant = el.querySelector('[data-testid="ai-chat-assistant"]');
    expect(user, '用户行没渲染出来').not.toBeNull();
    expect(assistant, '助手行没渲染出来').not.toBeNull();
    const userClass = user?.className ?? '';
    const assistantClass = assistant?.className ?? '';
    expect(userClass).toContain('ht-ai__item--user');
    expect(assistantClass).toContain('ht-ai__item--assistant');
    expect(
      userClass,
      '两行用的是同一套 class —— 那"谁说的"就没有视觉承载了',
    ).not.toEqual(assistantClass);
    expect(el.querySelector('[data-testid="ai-assistant-transcript"]')?.className).toContain(
      'ht-ai__items--chat',
    );
  });

  it('🔴 那两个角色 class 在样式表里**真的有规则**（class 存在但没人定义 = 静默退回一列输出）', () => {
    const css = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), '../src/styles/app/ai-panels.css'),
      'utf8',
    );
    /**
     * 取"这个选择器**自己那一块**的声明体"。
     *
     * ⚠️ 必须**锚在行首**：CSS 里的注释会写选择器本身（"别合并成 `.x { … }`"这种），
     * 用裸 `indexOf('.x {')` 会先撞上注释，于是判据读到的是一段中文 ——
     * 看起来在检查规则，其实检查的是注释。行首 + 到 `}` 为止才是那条规则本体。
     */
    const ruleBody = (cls: string): string =>
      new RegExp(`^\\.${cls} \\{([^}]*)\\}`, 'mu').exec(css)?.[1] ?? '';

    for (const cls of ['ht-ai__items--chat', 'ht-ai__item--user', 'ht-ai__item--assistant']) {
      expect(ruleBody(cls), `ai-panels.css 里没有 .${cls} 的规则块 —— 界面上那个 class 是空的`).not.toBe(
        '',
      );
    }
    // 规则还得**有牙齿**：承载"谁说的"的那两个属性必须在各自的块里。
    expect(ruleBody('ht-ai__item--user')).toContain('align-self');
    expect(ruleBody('ht-ai__item--assistant')).toContain('align-self');
    expect(ruleBody('ht-ai__items--chat')).toContain('list-style');
  });
});
