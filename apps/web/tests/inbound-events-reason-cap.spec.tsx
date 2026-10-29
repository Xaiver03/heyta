import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { I18nProvider } from '@heyta/i18n';
import { INBOUND_EVENT_LIST_LIMIT } from '@heyta/app-host';
import { defaultAiSettings } from '../src/features/settings/aiStore.js';

/**
 * 两件事同一枚用例钉住（`inbound-automation-work-brief.md` §3 A9 的前两项）：
 * ① 服务端一页只回 `INBOUND_EVENT_LIST_LIMIT` 条时，界面必须说"这是最近 N 条"，
 *    而不是把截断当全量；② 事件行要渲染**人话原因**（`reasonCode`），表外码不编句。
 * 两臂都挂 `data-testid`：摘掉渲染或摘掉词条，这一条会红。
 */
const fixture = vi.hoisted(() => ({ events: [] as unknown[], cap: 50 }));
vi.mock('../src/features/sync/store.js', () => ({ useSyncStore: (select: (s: unknown) => unknown) => select({ baseUrl: 'https://sync.test', token: 'token', accountId: '1' }) }));
vi.mock('../src/features/privacy/consent-gate.js', () => ({ consentFetch: async (input: RequestInfo | URL) => {
  const path = new URL(String(input)).pathname;
  if (path.endsWith('/events')) return Response.json({ events: fixture.events });
  if (path.endsWith('/rules')) return Response.json({ rules: [] });
  return new Response('', { status: 404 });
} }));
vi.mock('../src/features/settings/inbound-runtime.js', () => ({
  hasWebInboundWorker: async () => false, processWebInboundOnce: vi.fn(),
  ensureWebInboundRecipientKey: vi.fn(), registerWebInboundWorker: vi.fn(), rotateWebInboundRecipientKey: vi.fn(),
}));
vi.mock('../src/features/settings/inbound-lifecycle.js', () => ({
  configureWebInboundDeps: vi.fn(), refreshWebInboundReadiness: vi.fn(), triggerWebInboundPass: vi.fn(),
  useWebInboundWorker: () => ({ keyEpoch: 1, workerRegistered: true, processing: false, cycle: 'idle', failure: undefined }),
}));
import { InboundAutomationSettings } from '../src/features/settings/InboundAutomationSettings.js';

const event = (eventId: string, status: string, reasonCode: string | null) => ({
  eventId, ruleId: 'rule', ruleVersion: 3, attempt: 1, receivedAt: 1_700_000_000_000, status, reasonCode,
});

afterEach(() => { fixture.events = []; });

it.each(['zh-CN', 'en'] as const)('renders the cap hint and the human-readable reason (%s)', async (locale) => {
  fixture.events = [
    event('e1', 'needs-confirmation', 'needs-confirmation'),
    event('e2', 'expired', 'retention-expired'),
    event('e3', 'cancelled', 'worker-revoked'),
    ...Array.from({ length: INBOUND_EVENT_LIST_LIMIT - 3 }, (_, index) => event(`f${index}`, 'queued', null)),
  ];
  expect(fixture.events.length).toBe(INBOUND_EVENT_LIST_LIMIT);
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  try {
    await act(async () => { root.render(<I18nProvider locale={locale}><InboundAutomationSettings routing={defaultAiSettings().routing} consents={[]} /></I18nProvider>); });
    const text = container.textContent ?? '';
    // ① 上限提示：两个数字都来自同一枚常量，换档位这句话要跟着变。
    expect(container.querySelector('[data-testid="inbound-events-capped"]')).not.toBeNull();
    expect(text).toContain(locale === 'en' ? `Showing the ${INBOUND_EVENT_LIST_LIMIT} most recent events` : `只显示最近 ${INBOUND_EVENT_LIST_LIMIT} 条`);
    // ② 已知原因 → 人话。
    expect(container.querySelector('[data-testid="inbound-event-reason-e1"]')?.textContent).toBe(locale === 'en'
      ? 'The model result needs your review before tasks are created.'
      : '模型给出的结果需要你核对后才会创建任务。');
    expect(container.querySelector('[data-testid="inbound-event-reason-e2"]')?.textContent).toBe(locale === 'en'
      ? 'The retention window passed and the content was cleared.'
      : '内容保留期已过，原文已被清除。');
    // 表外码不编句：状态行已经说了"已取消"，再补一句猜的原因就是替服务端说话。
    expect(container.querySelector('[data-testid="inbound-event-reason-e3"]')).toBeNull();
  } finally { await act(async () => { root.unmount(); }); container.remove(); }
});

it('does not claim a cap when the list is shorter than the limit', async () => {
  fixture.events = [event('e1', 'queued', null)];
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  try {
    await act(async () => { root.render(<I18nProvider locale="en"><InboundAutomationSettings routing={defaultAiSettings().routing} consents={[]} /></I18nProvider>); });
    expect(container.querySelector('[data-testid="inbound-events-capped"]')).toBeNull();
  } finally { await act(async () => { root.unmount(); }); container.remove(); }
});
