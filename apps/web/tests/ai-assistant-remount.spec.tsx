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
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { I18nProvider } from '@heyta/i18n';
import type { AiRoutingConfig } from '@heyta/ai';
import type { LocalApiHost, LocalApiItem } from '@heyta/local-api';

import { AssistantEphemeralProvider } from '../src/features/ai/assistant-ephemeral.js';
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

/** 凭据只用来给会话打账号标签（`credential-storage.ts` 明确写着它不是秘密）。 */
function setAccount(email: string | null): void {
  if (email === null) {
    localStorage.removeItem('heyta.sync.credentials');
    return;
  }
  localStorage.setItem(
    'heyta.sync.credentials',
    JSON.stringify({ baseUrl: 'http://localhost:11434', token: 't', email }),
  );
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
function tree(props: { slot: Slot; fetchImpl?: typeof fetch }): React.JSX.Element {
  const panel = (
    <AssistantPanel
      routing={ROUTING}
      consents={CONSENTS}
      tier="read-only"
      secrets={secrets}
      host={fakeHost()}
      {...(props.fetchImpl === undefined ? {} : { fetchImpl: props.fetchImpl })}
    />
  );
  return (
    <I18nProvider locale="zh-CN">
      <AssistantEphemeralProvider>
        <div data-testid="col-detail">{props.slot === 'detail' ? panel : null}</div>
        <div data-testid="col-main">{props.slot === 'main' ? panel : null}</div>
      </AssistantEphemeralProvider>
    </I18nProvider>
  );
}

async function mount(props: { slot: Slot; fetchImpl?: typeof fetch }): Promise<HTMLDivElement> {
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

/** React 受控输入：必须走原生 setter，否则 onChange 收不到。 */
async function type(el: HTMLDivElement, text: string): Promise<void> {
  const input = el.querySelector<HTMLInputElement>('[data-testid="ai-assistant-input"]');
  if (input === null) throw new Error('找不到输入框');
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, text);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function inputValue(el: HTMLDivElement): string {
  const input = el.querySelector<HTMLInputElement>('[data-testid="ai-assistant-input"]');
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
  container = undefined;
  root = undefined;
  setAccount(null);
});

afterEach(() => {
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

    await type(el, '今天有什么任务');
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
    ).toContain('今天有什么任务');
  });

  it('还没发出去的那句草稿，换挂载点之后仍在输入框里', async () => {
    const el = await mount({ slot: 'detail' });
    await type(el, '帮我把这周的任务排个优先级');
    await mount({ slot: 'main' });
    expect(inputValue(el), '草稿被重挂载抹掉了 —— 用户打了一半的话没有了').toBe(
      '帮我把这周的任务排个优先级',
    );
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
