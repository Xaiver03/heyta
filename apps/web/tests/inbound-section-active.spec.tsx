import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { defaultAiSettings } from '../src/features/settings/aiStore.js';

const mocks = vi.hoisted(() => ({
  sync: { baseUrl: 'https://sync.test', token: 'token', accountId: '1' },
  process: vi.fn(async () => ({ state: 'empty' as const })),
  requested: [] as string[],
  fetch: vi.fn(async (input: RequestInfo | URL) => {
    mocks.requested.push(String(input));
    return new Response(JSON.stringify(
      String(input).endsWith('/events') ? { events: [] }
        : String(input).endsWith('/recipient-key') ? { keyEpoch: 1, packageVersion: 1 }
          : { rules: [{ id: 'rule', version: 1, keyId: 'hook', enabled: true, allowedFields: ['title'], maxItems: 50, createdAt: '2026-10-08T00:00:00Z', deletedAt: null, targetProjectId: null, timezone: null, parseVersion: 1, authorizationVersion: 1, hostedExtraction: false }] },
    ));
  }),
}));
vi.mock('../src/features/sync/store.js', () => ({ useSyncStore: Object.assign(
  (select: (s: unknown) => unknown) => select(mocks.sync), { getState: () => mocks.sync },
) }));
vi.mock('../src/features/privacy/consent-gate.js', () => ({ consentFetch: mocks.fetch }));
vi.mock('../src/features/settings/inbound-runtime.js', () => ({
  hasWebInboundWorker: async () => true,
  // 收件包那枚只读事实由循环与面板共用（`inbound-lifecycle.ts`）；不 mock 上，
  // 循环会因为拿不到 epoch 而直接跳过这一趟 —— 那这条用例就变成恒绿。
  getWebInboundRecipientKey: async () => ({ keyEpoch: 1, packageVersion: 1 }),
  processWebInboundOnce: mocks.process,
  ensureWebInboundRecipientKey: vi.fn(), registerWebInboundWorker: vi.fn(), rotateWebInboundRecipientKey: vi.fn(),
}));
import { InboundAutomationSettings } from '../src/features/settings/InboundAutomationSettings.js';
import { configureWebInboundDeps, startWebInboundWorker } from '../src/features/settings/inbound-lifecycle.js';

let stopWorker: (() => void) | undefined;
afterEach(async () => {
  vi.useRealTimers();
  vi.clearAllMocks();
  await act(async () => { stopWorker?.(); stopWorker = undefined; });
  mocks.requested.length = 0;
});

const eventsCalls = (): number => mocks.requested.filter((url) => url.endsWith('/events')).length;

it('离开这一节只让事件列表停显示，不让后台收集停摆；切回来时重新对账', async () => {
  vi.useFakeTimers();
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const routing = { ...defaultAiSettings().routing, enabled: true };
  try {
    await act(async () => { root.render(<InboundAutomationSettings active={false} routing={routing} consents={[]} />); });
    // 🔴 这一条是这枚用例的牙：把 `active` 当成收集闸门就等于"打开设置·AI 节才收"。
    // 循环现在由应用级挂载点起（生产里是 `App.tsx` 那两行），这里就照生产那样交出去。
    await act(async () => {
      configureWebInboundDeps({ routing, consents: [] });
      stopWorker = startWebInboundWorker();
    });
    expect(mocks.process, '这一节没显示，但收集照跑 —— 页内那条循环不再由这一节起').toHaveBeenCalledTimes(1);
    expect(eventsCalls(), '而事件列表确实没拉（它才是 `active` 唯一该管的东西）').toBe(0);

    await act(async () => { root.render(<InboundAutomationSettings active routing={routing} consents={[]} />); });
    expect(eventsCalls()).toBe(1);
  } finally {
    await act(async () => { root.unmount(); });
    container.remove();
  }
});
