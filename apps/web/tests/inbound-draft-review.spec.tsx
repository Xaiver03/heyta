import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { I18nProvider } from '@heyta/i18n';
import { defaultAiSettings } from '../src/features/settings/aiStore.js';
const mocks = vi.hoisted(() => ({
  sync: { baseUrl: 'https://sync.test', token: 'token', accountId: '1' },
  state: 'needs-confirmation', confirm: vi.fn(), cancel: vi.fn(), dispose: vi.fn(), process: vi.fn(),
  invalidate: undefined as (() => void) | undefined,
}));
vi.mock('../src/features/sync/store.js', () => ({ useSyncStore: Object.assign(
  (select: (s: unknown) => unknown) => select(mocks.sync), { getState: () => mocks.sync },
) }));
vi.mock('../src/features/privacy/consent-gate.js', () => ({ consentFetch: async (input: RequestInfo | URL) => {
  const path = new URL(String(input)).pathname;
  if (path.endsWith('/events')) return Response.json({ events: [{ eventId: 'event', ruleId: 'rule', ruleVersion: 1, attempt: 1,
    receivedAt: 1_700_000_000_000, status: mocks.state, reasonCode: 'needs-confirmation' }] });
  if (path.endsWith('/rules')) return Response.json({ rules: [] });
  return new Response('', { status: 404 });
} }));
vi.mock('../src/features/settings/inbound-runtime.js', () => ({
  hasWebInboundWorker: async () => false, processWebInboundOnce: mocks.process,
  ensureWebInboundRecipientKey: vi.fn(), registerWebInboundWorker: vi.fn(), rotateWebInboundRecipientKey: vi.fn(),
  webInboundDraftReviewer: (input: { onInvalidated: () => void; assertCurrent: () => void }) => {
    mocks.invalidate = input.onInvalidated;
    return { dispose: mocks.dispose, cancel: mocks.cancel,
      open: async () => ({ eventId: 'event', timezone: 'Asia/Shanghai', tasks: [
        { id: 'inbound:event:0', title: 'Draft secret', priority: 0, dueDate: '2026-02-30' },
      ], confirm: mocks.confirm, cancel: mocks.cancel }),
    };
  },
}));
import { InboundAutomationSettings } from '../src/features/settings/InboundAutomationSettings.js';
afterEach(() => { vi.clearAllMocks(); mocks.state = 'needs-confirmation'; mocks.sync.token = 'token'; mocks.invalidate = undefined; });

it.each(['zh-CN', 'en'] as const)('lets the user correct a draft before confirming, then clears plaintext (%s)', async (locale) => {
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  const labels = locale === 'en' ? ['Review and edit draft', 'Confirm these tasks'] : ['查看并编辑草稿', '确认创建这些任务'];
  const click = async (label: string) => {
    const button = [...container.querySelectorAll('button')].find((b) => b.textContent === label);
    expect(button).toBeDefined(); await act(async () => { button!.click(); });
  };
  mocks.confirm.mockImplementation(async (tasks) => { expect(tasks[0].dueDate).toBe('2026-10-08'); mocks.state = 'prepared'; });
  try {
    await act(async () => { root.render(<I18nProvider locale={locale}><InboundAutomationSettings routing={defaultAiSettings().routing} consents={[]} /></I18nProvider>); });
    await click(labels[0]!);
    const editor = container.querySelector('[data-testid="inbound-draft-editor"]')!;
    expect(editor.textContent).toContain('Asia/Shanghai');
    expect(mocks.confirm).not.toHaveBeenCalled();
    const input = [...editor.querySelectorAll('input')].find((i) => i.value === '2026-02-30')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '2026-10-08');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await click(labels[1]!);
    expect(mocks.confirm).toHaveBeenCalledOnce();
    expect(container.querySelector('[data-testid="inbound-draft-editor"]')).toBeNull();
    expect(mocks.process).not.toHaveBeenCalled();
  } finally { await act(async () => { root.unmount(); }); container.remove(); }
});

it.each(['vault', 'account'])('clears decrypted inputs on %s invalidation', async (reason) => {
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  const render = () => root.render(<I18nProvider locale="en"><InboundAutomationSettings routing={defaultAiSettings().routing} consents={[]} /></I18nProvider>);
  try {
    await act(async () => { render(); });
    const button = [...container.querySelectorAll('button')].find((b) => b.textContent === 'Review and edit draft')!;
    await act(async () => { button.click(); });
    expect([...container.querySelectorAll('input')].some((input) => input.value === 'Draft secret')).toBe(true);
    await act(async () => {
      if (reason === 'vault') mocks.invalidate!();
      else { mocks.sync.token = 'another-session'; render(); }
    });
    expect([...container.querySelectorAll('input')].some((input) => input.value === 'Draft secret')).toBe(false);
    expect(mocks.confirm).not.toHaveBeenCalled();
    expect(mocks.dispose).toHaveBeenCalled();
  } finally { await act(async () => { root.unmount(); }); container.remove(); }
});
