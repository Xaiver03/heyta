import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { defaultAiSettings } from '../src/features/settings/aiStore.js';

const mocks = vi.hoisted(() => ({
  sync: { baseUrl: 'https://sync.test', token: 'token', accountId: '1' },
  process: vi.fn(),
  readiness: vi.fn(),
  fetch: vi.fn(async (input: RequestInfo | URL) => new Response(JSON.stringify(
    String(input).endsWith('/events') ? { events: [] } : String(input).endsWith('/recipient-key')
      ? { keyEpoch: 1, packageVersion: 1 }
      : { rules: [{ id: 'rule', version: 1, keyId: 'hook', enabled: true, allowedFields: ['title'], maxItems: 50, createdAt: '2026-10-08T00:00:00Z', deletedAt: null, targetProjectId: null, timezone: null, parseVersion: 1, authorizationVersion: 1 }] },
  ))),
}));
vi.mock('../src/features/sync/store.js', () => ({ useSyncStore: Object.assign(
  (select: (s: unknown) => unknown) => select(mocks.sync), { getState: () => mocks.sync },
) }));
vi.mock('../src/features/privacy/consent-gate.js', () => ({ consentFetch: mocks.fetch }));
vi.mock('../src/features/settings/inbound-runtime.js', () => ({
  hasWebInboundWorker: async () => true,
  getWebInboundRecipientKey: mocks.readiness,
  processWebInboundOnce: mocks.process,
  ensureWebInboundRecipientKey: vi.fn(), registerWebInboundWorker: vi.fn(), rotateWebInboundRecipientKey: vi.fn(),
}));
import { InboundAutomationSettings } from '../src/features/settings/InboundAutomationSettings.js';
import { configureWebInboundDeps, startWebInboundWorker, triggerWebInboundPass } from '../src/features/settings/inbound-lifecycle.js';

const routingOn = { ...defaultAiSettings().routing, enabled: true };

/**
 * 这一族用例钉的是**那条循环归谁起**。
 *
 * 🔴 它原先钉的是"面板挂载即起循环、面板卸载即停" —— 而那句话本身就是缺陷本体：
 * 用户理解的是"开着 heyta 就会收"，实际是"得守着设置那一屏"。现在钉的是产品承诺的那条边界：
 * 应用级挂载点起循环（摘掉它必须红），标签页不可见才停。
 * 计数一律按**增量**读：`startInboundWorkerLoop` 构造时就发第一趟唤醒，写死绝对次数会把它读成多跑。
 */

let panelRoot: Root | undefined;
let stopWorker: (() => void) | undefined;
let visibility: 'visible' | 'hidden' = 'visible';
Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });

const calls = (): number => mocks.process.mock.calls.length;

afterEach(async () => {
  vi.useRealTimers();
  vi.clearAllMocks();
  // 卸载要在 act 里：面板订阅了那枚 store，卸载时的一次状态更新落在 act 外会警告，
  // 而那警告会被下一位读成"这条判据不可信"。
  await act(async () => { panelRoot?.unmount(); panelRoot = undefined; });
  await act(async () => { stopWorker?.(); stopWorker = undefined; });
  visibility = 'visible';
  mocks.readiness.mockReset();
  mocks.process.mockReset();
});

/** 应用级那两行（`App.tsx`）在这台测试里做的事：登记闸门 + 起循环（构造即唤醒，所以要包在 act 里）。 */
async function startWorker(deps = { routing: routingOn, consents: [] as const }): Promise<void> {
  configureWebInboundDeps(deps);
  await act(async () => {
    stopWorker = startWebInboundWorker();
    // 构造即唤醒：那一趟的 await（读收件包 → 处理）要留在同一个 act 里，否则面板收到
    // 状态更新时落在 act 之外，React 会警告（而警告会被读成"这条判据不可信"）。
    await vi.advanceTimersByTimeAsync(0);
  });
}

async function mountPanel(): Promise<void> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  panelRoot = createRoot(container);
  await act(async () => { panelRoot?.render(<InboundAutomationSettings routing={routingOn} consents={[]} />); });
}

function heldPass(): { settle: (value: { state: 'empty' }) => void } {
  let settle!: (value: { state: 'empty' }) => void;
  mocks.process.mockImplementation(() => new Promise((resolve) => { settle = resolve; }));
  return { settle: (value) => settle(value) };
}

it('🔴 摘掉应用级挂载点 ⇒ 设置面板挂着也不收（这条红就是"循环不再由面板自己起"的证据）', async () => {
  vi.useFakeTimers();
  mocks.readiness.mockResolvedValue({ keyEpoch: 1, packageVersion: 1 });
  mocks.process.mockResolvedValue({ state: 'empty' });
  await mountPanel();
  await act(async () => { await vi.advanceTimersByTimeAsync(90_000); });
  expect(calls(), '设置面板不该再自己起循环：它挂了 90 秒而挂载点没人交 ⇒ 必须一趟都没跑').toBe(0);
  // 阳性对照：同一趟里把起点交出去就跑得起来，否则上面那个 0 是探针坏了，不是判据红。
  await startWorker();
  await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
  expect(calls(), '交了挂载点却仍然不跑 ⇒ 上一条的 0 次没有意义').toBeGreaterThan(0);
});

it('🔴 离开设置视图（面板卸载）之后，那条循环仍在收', async () => {
  vi.useFakeTimers();
  mocks.readiness.mockResolvedValue({ keyEpoch: 1, packageVersion: 1 });
  mocks.process.mockResolvedValue({ state: 'empty' });
  await startWorker();
  await mountPanel();
  await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
  const before = calls();
  expect(before, '面板在挂着的时候必须正在收').toBeGreaterThan(0);
  await act(async () => { panelRoot?.unmount(); panelRoot = undefined; });
  await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
  expect(calls() - before, '面板卸载就把收集停了 ⇒ 那是"得守着那一屏"这句假话的本体').toBe(1);
});

it('🔴 标签页不可见 ⇒ 不领新任务；重新可见才补一趟（协议 §8 那条前台边界没被放宽）', async () => {
  vi.useFakeTimers();
  mocks.readiness.mockResolvedValue({ keyEpoch: 1, packageVersion: 1 });
  mocks.process.mockResolvedValue({ state: 'empty' });
  visibility = 'hidden';
  await startWorker();
  await act(async () => { await vi.advanceTimersByTimeAsync(90_000); });
  expect(calls(), '后台标签页还在领任务 ⇒ 这句越过了协议承诺的边界').toBe(0);
  visibility = 'visible';
  await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
  expect(calls(), '重新可见却不补一趟 ⇒ 这道闸把自己关死了').toBe(1);
});

it('🔴 换了会话就不许拿旧会话提交：在途那一趟的 assertCurrent 必须抛', async () => {
  vi.useFakeTimers();
  mocks.readiness.mockResolvedValue({ keyEpoch: 1, packageVersion: 1 });
  const pass = heldPass();
  await startWorker();
  await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
  expect(calls()).toBe(1);
  const assertCurrent = mocks.process.mock.calls[0]![0].assertCurrent as () => void;
  expect(assertCurrent).not.toThrow();
  mocks.sync.token = 'another-session';
  expect(() => assertCurrent()).toThrow('Inbound processing session changed');
  mocks.sync.token = 'token';
  visibility = 'hidden';
  expect(() => assertCurrent()).toThrow('Inbound processing session changed');
  visibility = 'visible';
  await act(async () => { pass.settle({ state: 'empty' }); });
});

it('🔴 手动那一眼与后台那一趟共用一枚在途闸门：不许并发领同一条事件', async () => {
  vi.useFakeTimers();
  mocks.readiness.mockResolvedValue({ keyEpoch: 1, packageVersion: 1 });
  const pass = heldPass();
  await startWorker();
  await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
  expect(calls(), '第一趟还在途，后面的唤醒就该被 fence 掉').toBe(1);
  await act(async () => { triggerWebInboundPass(); });
  expect(calls(), '手动那一趟在途时又领了一次 ⇒ 两条并发 claim').toBe(1);
  await act(async () => { pass.settle({ state: 'empty' }); });
  await act(async () => { triggerWebInboundPass(); });
  expect(calls(), '闸门放开后手动那一趟该跑得起来').toBe(2);
  await act(async () => { pass.settle({ state: 'empty' }); });
});

it('🔴 那句"应用级挂载"必须真的写在 App 里（这条是上面那枚反向臂的反向臂）', async () => {
  // 这台测试里没有真的 `App`：上面六条钉的是"循环归挂载点起"，而挂载点本身住在那枚 3700 行的
  // 外壳里。有人把那两行删掉时，本文件六条**全绿**（它们自己交的就是挂载点）—— 所以这一条
  // 直接读源码，并且先证明读到的不是空文件（读空文件时 `toContain` 也会红，但那不是判据红）。
  // ⚠️ 路径按 cwd 解（这枚包跑在 jsdom 里，`import.meta.url` 不是 file: 协议，
  // `new URL('../src/…', import.meta.url)` 会当场抛 `The URL must be of scheme file`）；
  // vitest 逐包起跑 ⇒ cwd 就是 `apps/web`，与移动壳那枚对账尺的写法不同是环境差，不是笔误。
  const app = readFileSync(resolve('src/App.tsx'), 'utf8');
  expect(app.length, '读到的 App.tsx 是空的 ⇒ 这条臂等于没臂').toBeGreaterThan(1000);
  expect(app).toContain('startWebInboundWorker(');
  expect(app).toContain('configureWebInboundDeps(');
});

it('🔴 路由那道闸关着 ⇒ 循环不跑（关掉总开关不该还在后台调模型）', async () => {
  vi.useFakeTimers();
  mocks.readiness.mockResolvedValue({ keyEpoch: 1, packageVersion: 1 });
  mocks.process.mockResolvedValue({ state: 'empty' });
  await startWorker({ routing: { ...routingOn, enabled: false }, consents: [] });
  await act(async () => { await vi.advanceTimersByTimeAsync(90_000); });
  expect(calls(), 'AI 总开关关着还在后台调模型 ⇒ 这道闸没接上').toBe(0);
  configureWebInboundDeps({ routing: routingOn, consents: [] });
  await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
  expect(calls(), '闸门放开后不跑 ⇒ 上面那个 0 次是探针坏了').toBe(1);
});
