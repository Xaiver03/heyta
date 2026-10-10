/**
 * AI 面**跨挂载点**时，未决状态到底掉不掉
 * =========================================
 *
 * ## 这 file 判的是一件事，而且是用户会遇到的那一件
 *
 * AI 面住在右栏（`.ht-app__detail`）。`App.tsx` 量它**实际有没有宽度**来决定
 * 面板挂右栏还是退回中间列 —— 于是"换挂载点 = 换 DOM 父节点 = 子树重挂载"。
 * 触发它不需要人拖窗口：`e2e/tests/ai-assistant.spec.ts` 里那张 `fullPage`
 * 截图就会让 Chromium 在捕获期间把右栏算成 `display:none`。
 *
 * 改造前重挂载会做两件对用户有害的事：
 *   · 把**已经摆在他眼前的出境披露**连同一句还没发出去的话一起收回初始态
 *     —— 等于替他悄悄取消了一次同意请求；
 *   · 把"正在跑"的指示归零，他可以再点一次发送。
 *
 * ## 为什么这几条必须在 jsdom 里也有一条（e2e 已经有一条了）
 *
 * e2e 那条（`ai-assistant.spec.ts` 截图后断"披露还在"）判的是**真浏览器真断点**，
 * 它要起 vite + Chromium，一次跑几分钟，而且是整条 `check:ai-e2e` 的一部分。
 * 这里这三条判的是**同一条不变量的机制**（状态住在挂载点之上），几十毫秒就能跑完，
 * 于是它能在每次 `pnpm -r test` 里守着 —— 而不是等到有人在浏览器套件里撞见。
 *
 * 🔴 第四条判的是**另一件事**：那份状态必须由"一次挂载"拥有，**不许住在模块上**。
 * 模块级 ephemeral 是两条被读数否证的修法之一（同一进程里反复挂载的用例互相
 * 串状态 ⇒ 四个套件 16 failed）。这第四条就是那 16 个失败的**替身判据**：
 * 摘掉 Provider、把状态改回模块变量，它必须变红。
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { I18nProvider } from '@heyta/i18n';
import { HeytaUiProvider } from '@heyta/ui';
import type { AiRoutingConfig } from '@heyta/ai';
import type { LocalApiHost, LocalApiItem } from '@heyta/local-api';

import { currentAccount, PanelEphemeralProvider } from '../src/features/ai/panel-ephemeral.js';
import { AssistantPanel } from '../src/features/ai/AssistantPanel.js';
import { useSyncStore } from '../src/features/sync/store.js';
import { AiToolRun } from '../src/features/ai/AiToolRun.js';

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

const CONSENTS = [
  { feature: 'tool-calling' as const, destination: 'user-endpoint' as const, grantedAt: 1 },
];

const secrets = { get: () => Promise.resolve(undefined) };

const ITEMS: readonly LocalApiItem[] = [
  { id: 't1', title: '买牛奶', body: '两盒', readable: true },
];

function fakeHost(): LocalApiHost {
  return {
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
    submit: () => Promise.resolve({ ok: true as const, taskId: 'created-1' }),
  } as unknown as LocalApiHost;
}

/** 记下每一次真实请求体，好在"换挂载点之后"问它发出去的到底是哪一句。 */
function recordingFetch(): { impl: typeof fetch; bodies: string[] } {
  const bodies: string[] = [];
  const impl = ((url: unknown, init?: { body?: unknown }) => {
    bodies.push(String(init?.body ?? '{}'));
    return Promise.resolve({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({ choices: [{ message: { role: 'assistant', content: '三件事' } }] }),
    });
  }) as unknown as typeof fetch;
  return { impl, bodies };
}

/** 锁住响应，并在视图重挂载后才放行，覆盖完整请求生命周期。 */
function deferredFetch(): { impl: typeof fetch; bodies: string[]; resolve: (text: string) => void } {
  const bodies: string[] = [];
  let finish: ((response: Response) => void) | undefined;
  return {
    bodies,
    impl: ((_url: unknown, init?: { body?: unknown }) => {
      bodies.push(String(init?.body ?? '{}'));
      return new Promise<Response>((resolve) => { finish = resolve; });
    }) as typeof fetch,
    resolve: (text) => {
      if (finish === undefined) throw new Error('请求尚未发出');
      finish(new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content: text } }] }), {
        status: 200, headers: { 'content-type': 'application/json' },
      }));
    },
  };
}

/** 凭据只用来给会话打账号标签（`credential-storage.ts` 明确写着它不是秘密）。 */
function setAccount(email: string | null): void {
  act(() => {
    if (email === null) localStorage.removeItem('heyta.sync.credentials');
    else localStorage.setItem('heyta.sync.credentials', JSON.stringify({ baseUrl: 'http://localhost:11434', token: 't', email }));
    useSyncStore.setState({
      baseUrl: 'http://localhost:11434', token: email === null ? undefined : 't',
      email: email ?? undefined, accountId: undefined,
    });
  });
}

type Slot = 'detail' | 'main';

let container: HTMLDivElement | undefined;
let root: Root | undefined;

/**
 * 两个挂载点 + 一个 Provider —— `App.tsx` 那棵树在这件事上的最小形状。
 *
 * ⚠️ Provider 必须在 `slot` 这一层**之上**：它要是跟着面板一起换位置，
 * 就还是每次挂载一份，这条判据会退化成"什么都没测"。
 */
function tree(props: { slot: Slot; fetchImpl?: typeof fetch; host?: LocalApiHost; tier?: 'read-only' | 'read-and-propose' }): React.JSX.Element {
  const panel = (
    <AssistantPanel
      routing={ROUTING}
      consents={CONSENTS}
      tier={props.tier ?? 'read-only'}
      secrets={secrets}
      host={props.host ?? fakeHost()}
      historyStorage={null}
      {...(props.fetchImpl === undefined ? {} : { fetchImpl: props.fetchImpl })}
    />
  );
  return (
    <I18nProvider locale="zh-CN">
      <PanelEphemeralProvider>
        {/* 真机上这两个面板都住在 `App.tsx` 根部那层 `<HeytaUiProvider>` 里
            （面板内的法定显式标识经它取 token）；单独挂载时补上同一条前置条件。 */}
        <HeytaUiProvider>
        <div data-testid="col-detail">{props.slot === 'detail' ? panel : null}</div>
        <div data-testid="col-main">{props.slot === 'main' ? panel : null}</div>
        </HeytaUiProvider>
      </PanelEphemeralProvider>
    </I18nProvider>
  );
}

async function mount(props: { slot: Slot; fetchImpl?: typeof fetch; host?: LocalApiHost; tier?: 'read-only' | 'read-and-propose' }): Promise<HTMLDivElement> {
  if (root === undefined) {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  }
  await act(async () => {
    root!.render(tree(props));
  });
  return container as HTMLDivElement;
}

/**
 * 单步工具面板的同一形状 —— 它和助手面板**共用那份 Provider**，
 * 而它自己的四样（输入 / 阶段 / 结果 / 提案确认）原来也住在组件里。
 */
function toolTree(props: { slot: Slot; fetchImpl?: typeof fetch; host?: LocalApiHost; tier?: 'read-only' | 'read-and-propose' }): React.JSX.Element {
  const panel = (
    <AiToolRun
      routing={ROUTING}
      consents={[]}
      grants={{ list_tasks: true, create_task: true } as never}
      secrets={secrets}
      host={fakeHost() as never}
      {...(props.fetchImpl === undefined ? {} : { fetchImpl: props.fetchImpl })}
    />
  );
  return (
    <I18nProvider locale="zh-CN">
      <PanelEphemeralProvider>
        <HeytaUiProvider>
        <div data-testid="col-detail">{props.slot === 'detail' ? panel : null}</div>
        <div data-testid="col-main">{props.slot === 'main' ? panel : null}</div>
        </HeytaUiProvider>
      </PanelEphemeralProvider>
    </I18nProvider>
  );
}

async function mountToolRun(props: { slot: Slot; fetchImpl?: typeof fetch; host?: LocalApiHost; tier?: 'read-only' | 'read-and-propose' }): Promise<HTMLDivElement> {
  if (root === undefined) {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  }
  await act(async () => {
    root!.render(toolTree(props));
  });
  return container as HTMLDivElement;
}

async function typeInto(el: HTMLDivElement, testId: string, text: string): Promise<void> {
  const input = el.querySelector<HTMLInputElement>(`[data-testid="${testId}"]`);
  if (input === null) throw new Error(`找不到 ${testId}`);
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, text);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

/** React 受控输入：必须走原生 setter，否则 onChange 收不到。 */
async function type(el: HTMLDivElement, text: string): Promise<void> {
  const input = el.querySelector<HTMLInputElement | HTMLTextAreaElement>('[data-testid="ai-assistant-input"]');
  if (input === null) throw new Error('找不到输入框');
  await act(async () => {
    const prototype = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value')?.set?.call(input, text);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function inputValue(el: HTMLDivElement): string {
  const input = el.querySelector<HTMLInputElement | HTMLTextAreaElement>('[data-testid="ai-assistant-input"]');
  if (input === null) throw new Error('找不到输入框');
  return input.value;
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

function disclosureCount(el: HTMLDivElement): number {
  return el.querySelectorAll('[data-testid="ai-assistant-disclosure"]').length;
}

beforeEach(() => {
  localStorage.clear();
  container = undefined;
  root = undefined;
  setAccount(null);
});

afterEach(() => {
  vi.restoreAllMocks();
  act(() => {
    root?.unmount();
  });
  container?.remove();
  container = undefined;
  root = undefined;
  setAccount(null);
});

describe('跨挂载点（右栏 ⇄ 中间列）不掉未决状态', () => {
  it('🔴 披露已经摆在眼前，换挂载点之后它还在，而且发出去的**还是那一句**', async () => {
    const fetch = recordingFetch();
    const el = await mount({ slot: 'detail', fetchImpl: fetch.impl });

    await type(el, '随便说点什么吧');
    await click(el, 'ai-assistant-send-button');
    // 第一次发送只披露，不出境。
    expect(disclosureCount(el), '点发送后应该出现一次性披露').toBe(1);
    expect(fetch.bodies.length, '披露之前一个请求都不许发').toBe(0);

    // 换挂载点 = 面板换 DOM 父节点 = 子树重挂载。
    await mount({ slot: 'main', fetchImpl: fetch.impl });

    expect(
      disclosureCount(el),
      '换挂载点把未决的出境披露吃掉了 —— 等于替用户取消了一次同意请求',
    ).toBe(1);

    // 🔴 光"披露还在"不够：还要证明它等的是**用户当初那一句**。
    await click(el, 'ai-assistant-send');
    expect(fetch.bodies.length, '按下披露上的发送之后必须真出境').toBe(1);
    expect(
      fetch.bodies[0],
      '发出去的必须是换挂载点之前那一句，不是空串、也不是输入框里的别的',
    ).toContain('随便说点什么吧');
  });

  it('还没发出去的那句草稿，换挂载点之后仍在输入框里', async () => {
    const el = await mount({ slot: 'detail' });
    await type(el, '帮我把这周的任务排个优先级');
    await mount({ slot: 'main' });
    expect(inputValue(el), '草稿被重挂载抹掉了 —— 用户打了一半的话没有了').toBe(
      '帮我把这周的任务排个优先级',
    );
  });

  it('重挂载后收到回答，下一句保留上下文且不会重新披露或重复发请求', async () => {
    const fetch = deferredFetch();
    const el = await mount({ slot: 'detail', fetchImpl: fetch.impl });
    await type(el, '第一句的问题');
    await click(el, 'ai-assistant-send-button');
    await click(el, 'ai-assistant-send');
    await mount({ slot: 'main', fetchImpl: fetch.impl });
    expect(fetch.bodies).toHaveLength(1);
    await act(async () => { fetch.resolve('第一句的回答'); });
    expect(el.querySelector('[data-testid="ai-assistant-waiting"]')).toBeNull();
    expect(el.querySelectorAll('[data-testid="ai-chat-assistant"]')).toHaveLength(1);
    expect(el.textContent).toContain('第一句的回答');
    expect(Object.keys(localStorage).filter((key) => key.startsWith('heyta.ai.assistant.history'))).toHaveLength(0);
    await type(el, '第二句的问题');
    await click(el, 'ai-assistant-send-button');
    expect(disclosureCount(el)).toBe(0);
    expect(fetch.bodies).toHaveLength(2);
    expect(fetch.bodies[1]).toContain('第一句的问题');
    expect(fetch.bodies[1]).toContain('第一句的回答');
    await act(async () => { fetch.resolve('第二句的回答'); });
    expect(el.querySelectorAll('[data-testid="ai-chat-assistant"]')).toHaveLength(2);
  });

  it('披露重挂载后取消，恢复原草稿并移除乐观消息，零请求', async () => {
    const fetch = recordingFetch();
    const el = await mount({ slot: 'detail', fetchImpl: fetch.impl });
    await type(el, '暂时不要发送这句');
    await click(el, 'ai-assistant-send-button');
    await mount({ slot: 'main', fetchImpl: fetch.impl });
    await click(el, 'ai-assistant-disclosure-close');
    expect(inputValue(el)).toBe('暂时不要发送这句');
    expect(disclosureCount(el)).toBe(0);
    expect(el.querySelectorAll('[data-testid="ai-chat-user"]')).toHaveLength(0);
    expect(fetch.bodies).toHaveLength(0);
  });

  it('请求正在飞时换挂载点，不许把"正在跑"归零（防二次发送）', async () => {
    // 🔴 故意用**永不 resolve** 的 fetch：回包一进来阶段就自己回 idle，
    //    那条判据就测不到了（探针现量：用一次性回包时，换挂载点前后都读不到差别）。
    const hanging = (() => {
      const impl = (() => new Promise<never>(() => undefined)) as unknown as typeof fetch;
      return impl;
    })();
    const el = await mount({ slot: 'detail', fetchImpl: hanging });
    await type(el, '第一句');
    await click(el, 'ai-assistant-send-button');
    await click(el, 'ai-assistant-send'); // 真出境，阶段进入 running
    expect(
      el.querySelectorAll('[data-testid="ai-assistant-waiting"]').length,
      '前置：发出请求后必须有"正在等回包"的指示（没有它，下面那条测不到东西）',
    ).toBe(1);

    await mount({ slot: 'main', fetchImpl: hanging });

    expect(
      el.querySelectorAll('[data-testid="ai-assistant-waiting"]').length,
      '请求还在飞，换挂载点却把阶段指示归零了 —— 用户可以再点一次发送',
    ).toBe(1);
  });
});

describe('账号绑定：换账号不许带一个字', () => {
  it('真实手填令牌替换不复用旧邮箱会话；仅改口令保留草稿', async () => {
    act(() => { useSyncStore.getState().applyAuthToken('https://selfhost.example', 'token-a', 'a@example.com'); });
    const el = await mount({ slot: 'detail' });
    const oldAccount = currentAccount();
    await type(el, '原邮箱账号的未发送草稿');
    act(() => { useSyncStore.getState().configure('https://selfhost.example', 'token-a', 'new-password'); });
    expect(currentAccount()).toBe(oldAccount);
    expect(inputValue(el)).toBe('原邮箱账号的未发送草稿');
    act(() => { useSyncStore.getState().configure('https://selfhost.example', 'token-b', 'new-password'); });
    const manualAccount = currentAccount();
    expect(manualAccount).not.toBe(oldAccount);
    expect(inputValue(el)).toBe('');
    expect(useSyncStore.getState().email).toBeUndefined();
    await type(el, '手填令牌 B 的草稿');
    act(() => { useSyncStore.getState().configure('https://selfhost.example', 'token-c', 'new-password'); });
    const manualC = currentAccount();
    expect(manualC).not.toBe(manualAccount);
    expect(inputValue(el)).toBe('');
    await type(el, '手填令牌 C 的草稿');
    act(() => { useSyncStore.getState().clearCredentials(); });
    expect(currentAccount()).toBeNull();
    act(() => { useSyncStore.getState().configure('https://selfhost.example', 'token-c', 'new-password'); });
    expect(currentAccount()).not.toBe(manualC);
    expect(inputValue(el)).toBe('');
  });
  it('真实登录凭据落盘因配额失败时，当前会话仍可收到助手回答', async () => {
    const fetch = recordingFetch();
    const el = await mount({ slot: 'detail', fetchImpl: fetch.impl });
    const quota = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota-full'); });
    act(() => { useSyncStore.getState().applyAuthToken('https://quota.example', 'test-token', 'quota@example.com', 'quota-account'); });
    expect(quota).toHaveBeenCalled();
    expect(localStorage.getItem('heyta.sync.credentials')).toBeNull();
    expect(useSyncStore.getState().accountId).toBe('quota-account');
    await type(el, '存储写满后仍能回答的问题');
    await click(el, 'ai-assistant-send-button');
    await click(el, 'ai-assistant-send');
    expect(fetch.bodies).toHaveLength(1);
    expect(el.querySelectorAll('[data-testid="ai-chat-assistant"]')).toHaveLength(1);
    expect(el.textContent).toContain('三件事');
    expect(el.querySelector('[data-testid="ai-assistant-waiting"]')).toBeNull();
  });
  it('同挂载点退出或换号立即移除旧聊天和草稿，不依赖导航', async () => {
    setAccount('a@example.com');
    const el = await mount({ slot: 'detail' });
    await type(el, 'A 还没发送的私事');
    setAccount('b@example.com');
    expect(inputValue(el)).toBe('');
    await type(el, 'B 草稿');
    setAccount(null);
    expect(inputValue(el)).toBe('');
    expect(el.textContent).not.toContain('A 还没发送');
    expect(el.textContent).not.toContain('B 草稿');
  });

  it('A → B → A 后旧 A 的异步回答不能进入 A 的新会话', async () => {
    const fetch = deferredFetch();
    setAccount('a@example.com');
    const el = await mount({ slot: 'detail', fetchImpl: fetch.impl });
    await type(el, '旧 A 会话');
    await click(el, 'ai-assistant-send-button');
    await click(el, 'ai-assistant-send');
    setAccount('b@example.com');
    setAccount('a@example.com');
    await type(el, '新 A 草稿');
    await act(async () => { fetch.resolve('旧 A 回答'); });
    expect(inputValue(el)).toBe('新 A 草稿');
    expect(el.querySelectorAll('[data-testid="ai-chat-assistant"]')).toHaveLength(0);
    expect(el.textContent).not.toContain('旧 A 回答');
  });

  it('A 的提案确认晚返回不能覆盖 B 的草稿和会话', async () => {
    let finish: ((result: { ok: true; taskId: string }) => void) | undefined;
    const host = { ...fakeHost(), submit: () => new Promise<{ ok: true; taskId: string }>((resolve) => { finish = resolve; }) } as LocalApiHost;
    const fetchImpl = (() => Promise.resolve(new Response(JSON.stringify({ choices: [{ message: {
      role: 'assistant', content: '', tool_calls: [{ id: 'checklist', type: 'function', function: {
        name: 'append_task_checklist', arguments: JSON.stringify({ taskId: 't1', items: ['待确认清单'] }),
      } }],
    } }] }), { status: 200, headers: { 'content-type': 'application/json' } }))) as typeof fetch;
    setAccount('a@example.com');
    const el = await mount({ slot: 'detail', host, fetchImpl, tier: 'read-and-propose' });
    await type(el, '帮任务增加清单');
    await click(el, 'ai-assistant-send-button');
    await click(el, 'ai-assistant-send');
    await click(el, 'ai-chat-confirm');
    expect(finish).toBeDefined();
    setAccount('b@example.com');
    await type(el, 'B 不可丢失的草稿');
    await act(async () => { finish!({ ok: true, taskId: 't1' }); });
    expect(inputValue(el)).toBe('B 不可丢失的草稿');
    expect(el.querySelectorAll('[data-testid="ai-chat-proposal"]')).toHaveLength(0);
    expect(el.querySelectorAll('[data-testid="ai-chat-confirmed"]')).toHaveLength(0);
  });

  it('旧账号运行中切换账号，旧响应不能写入新账号的活会话', async () => {
    const fetch = deferredFetch();
    setAccount('a@example.com');
    const el = await mount({ slot: 'detail', fetchImpl: fetch.impl });
    await type(el, 'A 的私密问题');
    await click(el, 'ai-assistant-send-button');
    await click(el, 'ai-assistant-send');
    setAccount('b@example.com');
    await mount({ slot: 'main', fetchImpl: fetch.impl });
    await type(el, 'B 尚未发送的草稿');
    await act(async () => { fetch.resolve('A 的私密回答'); });
    expect(inputValue(el)).toBe('B 尚未发送的草稿');
    expect(el.textContent).not.toContain('A 的私密');
    expect(el.querySelectorAll('[data-testid="ai-chat-assistant"]')).toHaveLength(0);
  });

  it('🔴 上一个人的草稿与未决披露，对下一个人一个字节都不许渲染', async () => {
    setAccount('a@example.com');
    const el = await mount({ slot: 'detail' });
    await type(el, 'A 的私事');
    await click(el, 'ai-assistant-send-button');
    expect(disclosureCount(el)).toBe(1);

    // 登出/换号**不重新加载页面**：凭据换了，Provider 还活着。
    setAccount('b@example.com');
    await mount({ slot: 'main' });

    expect(inputValue(el), 'B 不该看见 A 还没发出去的那句').toBe('');
    expect(disclosureCount(el), 'B 不该继承 A 的未决披露').toBe(0);
  });
});

describe('单步工具面板跨挂载点（同一条不变量的另一半）', () => {
  it('🔴 换挂载点之后披露还在（单步面板的未决披露）', async () => {
    const el = await mountToolRun({ slot: 'detail' });
    await typeInto(el, 'ai-tool-input', '帮我看看下周三评审要准备什么');
    await click(el, 'ai-tool-run-button');
    expect(
      el.querySelectorAll('[data-testid="ai-tool-disclosure"]').length,
      '前置：走模型那条必须先出披露，且此时一个请求都不发',
    ).toBe(1);

    await mountToolRun({ slot: 'main' });

    expect(
      el.querySelectorAll('[data-testid="ai-tool-disclosure"]').length,
      '换挂载点把单步面板的未决披露吃掉了 —— 与助手那条是同一个缺陷的另一半',
    ).toBe(1);
  });

  it('换挂载点之后那句输入仍在输入框里（单步面板的草稿）', async () => {
    const el = await mountToolRun({ slot: 'detail' });
    await typeInto(el, 'ai-tool-input', '把逾期任务列出来');
    await mountToolRun({ slot: 'main' });
    const input = el.querySelector<HTMLInputElement>('[data-testid="ai-tool-input"]');
    expect(input?.value, '单步面板的草稿被重挂载抹掉了').toBe('把逾期任务列出来');
  });

  it('🔴 换账号之后一个字节都不许渲染（单步面板的账号绑定）', async () => {
    setAccount('a@example.com');
    const el = await mountToolRun({ slot: 'detail' });
    await typeInto(el, 'ai-tool-input', 'A 的私事');
    await click(el, 'ai-tool-run-button');
    expect(el.querySelectorAll('[data-testid="ai-tool-disclosure"]').length).toBe(1);

    setAccount('b@example.com');
    await mountToolRun({ slot: 'main' });

    const input = el.querySelector<HTMLInputElement>('[data-testid="ai-tool-input"]');
    expect(input?.value ?? '', 'B 不该看见 A 还没发出去的那句').toBe('');
    expect(el.querySelectorAll('[data-testid="ai-tool-disclosure"]').length, 'B 不该继承 A 的未决披露').toBe(0);
  });
});

describe('这份状态由一次挂载拥有，不是模块变量', () => {
  it('🔴 整棵树卸载重装（新 Provider）之后回到初始态', async () => {
    const el = await mount({ slot: 'detail' });
    await type(el, '留在旧挂载里的那句');
    await click(el, 'ai-assistant-send-button');
    expect(disclosureCount(el)).toBe(1);

    // 与上面三条的差别只在这里：整棵子树连 Provider 一起拆掉再装一遍。
    act(() => {
      root?.unmount();
    });
    container?.remove();
    container = undefined;
    root = undefined;

    const fresh = await mount({ slot: 'detail' });
    expect(
      inputValue(fresh),
      '新一次挂载读到了上一次的草稿 ⇒ 状态住在模块上，不在 Provider 里（那就是被否证的第二条修法）',
    ).toBe('');
    expect(disclosureCount(fresh)).toBe(0);
  });
});
