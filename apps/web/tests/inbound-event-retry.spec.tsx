import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { I18nProvider } from '@heyta/i18n';
import { defaultAiSettings } from '../src/features/settings/aiStore.js';
const fixture = vi.hoisted(() => ({ retries: 0, state: 'needs-confirmation', requests: [] as unknown[] }));
vi.mock('../src/features/sync/store.js', () => ({ useSyncStore: (select: (s: unknown) => unknown) => select({ baseUrl: 'https://sync.test', token: 'token', accountId: '1' }) }));
vi.mock('../src/features/privacy/consent-gate.js', () => ({ consentFetch: async (input: RequestInfo | URL, init?: RequestInit) => {
  const path = new URL(String(input)).pathname;
  if (path.endsWith('/retry')) {
    fixture.retries++;
    fixture.requests.push(JSON.parse(String(init?.body)));
    fixture.state = 'queued';
    return Response.json({ eventId: 'event', state: 'queued' });
  }
  if (path.endsWith('/events')) return Response.json({ events: [{ eventId: 'event', ruleId: 'rule', ruleVersion: 3, attempt: 2,
    receivedAt: 1_700_000_000_000, status: fixture.state, reasonCode: fixture.state === 'needs-confirmation' ? 'model-result-uncertain' : null }] });
  if (path.endsWith('/rules')) return Response.json({ rules: [] });
  return new Response('', { status: 404 });
} }));
vi.mock('../src/features/settings/inbound-runtime.js', () => ({
  hasWebInboundWorker: async () => false, processWebInboundOnce: vi.fn(),
  ensureWebInboundRecipientKey: vi.fn(), registerWebInboundWorker: vi.fn(), rotateWebInboundRecipientKey: vi.fn(),
}));
import { InboundAutomationSettings } from '../src/features/settings/InboundAutomationSettings.js';

afterEach(() => { fixture.retries = 0; fixture.state = 'needs-confirmation'; fixture.requests = []; });

it.each(['zh-CN', 'en'] as const)('requires a separate cost confirmation before retry (%s)', async (locale) => {
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  const labels = locale === 'en' ? ['Parse again', 'Confirm another attempt', 'Cancel'] : ['重新解析', '确认重新解析', '取消'];
  const click = async (label: string) => {
    const button = [...container.querySelectorAll('button')].find((b) => b.textContent === label);
    expect(button).toBeDefined();
    await act(async () => { button!.click(); });
  };
  try {
    await act(async () => { root.render(<I18nProvider locale={locale}><InboundAutomationSettings routing={defaultAiSettings().routing} consents={[]} /></I18nProvider>); });
    expect(fixture.retries).toBe(0);
    await click(labels[0]!);
    expect(fixture.retries).toBe(0);
    expect(container.textContent).toContain(locale === 'en' ? 'may already have been charged' : '可能已计费');
    await click(labels[2]!);
    expect(fixture.retries).toBe(0);
    await click(labels[0]!);
    await click(labels[1]!);
    expect(fixture.retries).toBe(1);
    expect(fixture.requests).toEqual([{ expectedAttempt: 2, expectedRuleVersion: 3 }]);
    expect(container.textContent).toContain(locale === 'en' ? 'Waiting for a processing device' : '等待处理设备');
    expect(container.textContent).not.toContain(labels[1]!);
  } finally { await act(async () => { root.unmount(); }); container.remove(); }
});
