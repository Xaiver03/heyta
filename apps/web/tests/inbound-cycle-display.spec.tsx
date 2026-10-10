import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import type { InboundAutomationCycleState } from '@heyta/app-host';
import { en, zhCN, type MessageKey } from '@heyta/i18n';
import { defaultAiSettings } from '../src/features/settings/aiStore.js';

const mocks = vi.hoisted(() => ({
  sync: { baseUrl: 'https://sync.test', token: 'token', accountId: '1' },
  process: vi.fn(),
  fetch: vi.fn(async (input: RequestInfo | URL) => new Response(JSON.stringify(
    String(input).endsWith('/events') ? { events: [] } : String(input).endsWith('/recipient-key') ? { keyEpoch: 1, packageVersion: 1 } : {
      rules: [{ id: 'rule', version: 1, keyId: 'hook', enabled: true, allowedFields: ['title'], maxItems: 50, createdAt: '2026-10-08T00:00:00Z', deletedAt: null, targetProjectId: null, timezone: null, parseVersion: 1, authorizationVersion: 1 }],
    },
  ))),
}));
vi.mock('../src/features/sync/store.js', () => ({ useSyncStore: Object.assign(
  (select: (s: unknown) => unknown) => select(mocks.sync), { getState: () => mocks.sync },
) }));
vi.mock('../src/features/privacy/consent-gate.js', () => ({ consentFetch: mocks.fetch }));
vi.mock('../src/features/settings/inbound-runtime.js', () => ({
  hasWebInboundWorker: async () => true,
  processWebInboundOnce: mocks.process,
  ensureWebInboundRecipientKey: vi.fn(), registerWebInboundWorker: vi.fn(), rotateWebInboundRecipientKey: vi.fn(),
}));

import { InboundAutomationSettings, PROCESS_COPY } from '../src/features/settings/InboundAutomationSettings.js';

const PREFIX = 'web.ai.inbound.process.';
type Catalog = Record<string, string>;
const processKeys = (catalog: Catalog): readonly string[] =>
  Object.keys(catalog).filter((key) => key.startsWith(PREFIX)).map((key) => key.slice(PREFIX.length));

afterEach(() => { vi.clearAllMocks(); });

/** 面板挂起来，回到「处理一条待收件」可点、一次处理正悬在途的状态。 */
async function openPanel(): Promise<{ container: HTMLElement; root: Root; settle: (value: { state: InboundAutomationCycleState }) => void; fail: (error: Error) => void }> {
  // 同一笔用例里会挂两次面板，而 spy 是模块级共享的：不先归零，"这一次点击发出了一次处理"
  // 就会读成两次（本用例第一次真跑就是这么红的，不是产品发了一遍）。
  mocks.process.mockClear();
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const held: { settle: (value: unknown) => void; fail: (error: unknown) => void } = { settle: () => {}, fail: () => {} };
  mocks.process.mockImplementation(() => new Promise((resolve, reject) => { held.settle = resolve; held.fail = reject; }));
  await act(async () => {
    root.render(<InboundAutomationSettings routing={{ ...defaultAiSettings().routing, enabled: true }} consents={[]} />);
  });
  const button = [...container.querySelectorAll('button')].find((item) => item.textContent === zhCN['web.ai.inbound.processOne']) as HTMLButtonElement | undefined;
  expect(button, '处理设备已注册时「处理一条待收件」必须出现且可点').toBeDefined();
  expect(button?.disabled, '该按钮不该是禁用态').toBe(false);
  await act(async () => { button?.click(); });
  expect(mocks.process).toHaveBeenCalledTimes(1);
  return {
    container, root,
    settle: (value) => { held.settle(value); },
    fail: (error) => { held.fail(error); },
  };
}

it('状态回显表与词条表 web.ai.inbound.process.* 双向对账（指空键会把整块面板当场崩）', () => {
  const zh = processKeys(zhCN);
  const mapped = Object.values(PROCESS_COPY).filter((key): key is keyof typeof zhCN => key !== undefined);

  // 分母自检：两侧都真扫到 process.* 那一族，且条数不是零 —— 否则下面两头的断言都是空转。
  expect(zh.length).toBeGreaterThanOrEqual(4);
  expect(new Set(processKeys(en))).toEqual(new Set(zh));
  expect(mapped.length).toBeGreaterThanOrEqual(4);

  // 正头：表里每一行都必须**两侧都存在**的键。`translateIn` 对缺键是抛，
  // 所以这一行红的时候不是"文案不好看"，是那个状态一出现整块设置面板就崩。
  expect(mapped.filter((key) => !(key in zhCN) || !(key in en))).toEqual([]);

  // 反头：词条表里每一个 process.* 后缀都必须有人接。B110 那颗 `waiting-entitlement`
  // 词条进去而这里没加映射 ⇒ 这一条红，而不是悄悄继续显示空句子。
  expect(mapped.map((key) => key.slice(PREFIX.length)).sort()).toEqual([...zh].sort());
});

it('权益等待（waiting-entitlement）不回成「处理失败」那句，面板也不崩', async () => {
  const panel = await openPanel();
  try {
    await act(async () => { panel.settle({ state: 'waiting-entitlement' }); });
    const node = panel.container.querySelector('[data-inbound-cycle-state]');
    expect(node, '处理之后必须有一条带状态属性的回显').not.toBeNull();
    expect(node?.getAttribute('data-inbound-cycle-state')).toBe('waiting-entitlement');

    // 四句已存在的句子逐句比对：这一格不许等于其中任何一句。
    // 尤其不许等于 `failed` 那句 —— 把"这台实例还没买到资格"说成"处理失败"就是缺陷本体。
    // `satisfies readonly MessageKey[]` 让这四枚键本身在编译期就必须存在，不用 cast。
    const controlKeys = ['web.ai.inbound.process.submitted', 'web.ai.inbound.process.empty',
      'web.ai.inbound.process.needs-confirmation', 'web.ai.inbound.process.failed'] as const satisfies readonly MessageKey[];
    const sentences = controlKeys.map((key) => zhCN[key]);
    expect(new Set(sentences).size, '作对照的四句必须互不相同').toBe(controlKeys.length);
    const shown = node?.textContent ?? null;
    for (const sentence of sentences) expect(shown).not.toBe(sentence);

    // 面板整体还活着：`t()` 抛的话 React 会在上面那次 act 里就把错误顶出来。
    expect(panel.container.querySelector('[data-testid="inbound-automation-settings"]')).not.toBeNull();
  } finally {
    await act(async () => { panel.root.unmount(); });
    panel.container.remove();
  }
});

it('有词条可接的两个状态（submitted / failed）各自回成自己的那一句', async () => {
  const done = await openPanel();
  try {
    await act(async () => { done.settle({ state: 'submitted' }); });
    expect(done.container.querySelector('[data-inbound-cycle-state]')?.textContent)
      .toBe(zhCN['web.ai.inbound.process.submitted']);
  } finally {
    await act(async () => { done.root.unmount(); });
    done.container.remove();
  }

  const broken = await openPanel();
  try {
    await act(async () => { broken.fail(new Error('processing rejected')); });
    const node = broken.container.querySelector('[data-inbound-cycle-state]');
    expect(node?.getAttribute('data-inbound-cycle-state')).toBe('failed');
    expect(node?.textContent).toBe(zhCN['web.ai.inbound.process.failed']);
  } finally {
    await act(async () => { broken.root.unmount(); });
    broken.container.remove();
  }
});
