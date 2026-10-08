import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { defaultAiSettings } from '../src/features/settings/aiStore.js';

const mocks = vi.hoisted(() => ({
  process: vi.fn(),
  fetch: vi.fn(async (input: RequestInfo | URL) => new Response(JSON.stringify(
    String(input).endsWith('/recipient-key') ? { keyEpoch: 1, packageVersion: 1 } : {
      rules: [{ id: 'rule', version: 1, keyId: 'hook', enabled: true, allowedFields: ['title'], maxItems: 50, createdAt: '2026-10-08T00:00:00Z', deletedAt: null, targetProjectId: null, timezone: null, parseVersion: 1, authorizationVersion: 1 }],
    },
  ))),
}));
vi.mock('../src/features/sync/store.js', () => ({ useSyncStore: (select: (s: unknown) => unknown) => select({ baseUrl: 'https://sync.test', token: 'token', accountId: '1' }) }));
vi.mock('../src/features/privacy/consent-gate.js', () => ({ consentFetch: mocks.fetch }));
vi.mock('../src/features/settings/inbound-runtime.js', () => ({
  hasWebInboundWorker: async () => true,
  processWebInboundOnce: mocks.process,
  ensureWebInboundRecipientKey: vi.fn(), registerWebInboundWorker: vi.fn(), rotateWebInboundRecipientKey: vi.fn(),
}));
import { InboundAutomationSettings } from '../src/features/settings/InboundAutomationSettings.js';

afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); });

it('does not immediately reprocess on a state refresh and serializes focus/manual triggers', async () => {
  vi.useFakeTimers();
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  let release!: (value: { state: 'empty' }) => void;
  mocks.process.mockImplementation(() => new Promise((resolve) => { release = resolve; }));
  try {
    await act(async () => {
      root.render(<InboundAutomationSettings routing={{ ...defaultAiSettings().routing, enabled: true }} consents={[]} />);
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(mocks.process).toHaveBeenCalledTimes(1);
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
      document.dispatchEvent(new Event('visibilitychange'));
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(mocks.process).toHaveBeenCalledTimes(1);
    await act(async () => { release({ state: 'empty' }); });
    expect(mocks.process).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(29_999); });
    expect(mocks.process).toHaveBeenCalledTimes(1);
    await act(async () => { window.dispatchEvent(new Event('focus')); });
    expect(mocks.process).toHaveBeenCalledTimes(2);
    await act(async () => { release({ state: 'empty' }); });
  } finally {
    await act(async () => { root.unmount(); });
    container.remove();
  }
  await vi.advanceTimersByTimeAsync(60_000);
  window.dispatchEvent(new Event('focus'));
  expect(mocks.process).toHaveBeenCalledTimes(2);
});
