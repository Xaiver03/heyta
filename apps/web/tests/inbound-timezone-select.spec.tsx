import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { HeytaUiProvider } from '@heyta/ui';
import { defaultAiSettings } from '../src/features/settings/aiStore.js';

const mocks = vi.hoisted(() => ({
  sync: { baseUrl: 'https://sync.test', token: 'token', accountId: '1' },
  fetch: vi.fn(async () =>
    new Response(JSON.stringify(
      { rules: [{ id: 'rule', version: 1, keyId: 'hook', enabled: true, allowedFields: ['title'], maxItems: 50, createdAt: '2026-10-08T00:00:00Z', deletedAt: null, targetProjectId: null, timezone: 'Asia/Shanghai', parseVersion: 1, authorizationVersion: 1 }] },
    )),
  ),
}));
vi.mock('../src/features/sync/store.js', () => ({
  useSyncStore: Object.assign((select: (s: unknown) => unknown) => select(mocks.sync), { getState: () => mocks.sync }),
}));
vi.mock('../src/features/privacy/consent-gate.js', () => ({ consentFetch: mocks.fetch }));
vi.mock('../src/features/settings/inbound-runtime.js', () => ({
  hasWebInboundWorker: async () => false,
  processWebInboundOnce: vi.fn(),
  ensureWebInboundRecipientKey: vi.fn(),
  registerWebInboundWorker: vi.fn(),
  rotateWebInboundRecipientKey: vi.fn(),
}));
import { InboundAutomationSettings, timezoneOptions } from '../src/features/settings/InboundAutomationSettings.js';

afterEach(() => { vi.clearAllMocks(); });

it('规则时区是**选择器**，不是自由输入框', async () => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const routing = { ...defaultAiSettings().routing, enabled: true };
  try {
    await act(async () => { root.render(<HeytaUiProvider><InboundAutomationSettings active={false} routing={routing} consents={[]} /></HeytaUiProvider>); });
    await act(async () => { await Promise.resolve(); });

    // 🔴 这枚用例的牙：改前这里是 `<input>`（占位符「例如 Asia/Shanghai」），
    // 用户得自己拼 IANA 名字，拼错也不报错。改回 input ⇒ 这一行立刻红。
    const select = container.querySelector('[data-testid="inbound-timezone-select"]');
    expect(select, '时区必须是 select').not.toBeNull();
    expect(select!.tagName).toBe('SELECT');
    expect(container.querySelector('input#inbound-timezone')).toBeNull();

    const options = [...select!.querySelectorAll('option')];
    // 第一项是「跟随本机」，以空串作为值 —— 与 `timezone.trim() === '' → null` 那条落库语义对齐。
    expect(options[0]!.value).toBe('');
    expect(options.length).toBeGreaterThan(20);
  } finally {
    await act(async () => { root.unmount(); });
    container.remove();
  }
});

it('已存的、不在 IANA 枚举里的旧值必须仍被选中，不能被悄悄改掉', () => {
  const zones = timezoneOptions('UTC+8');
  // ⚠️ 这是 `<select>` 换成自由输入后最容易踩的坑：找不到匹配项 ⇒ 显示空白 ⇒ 保存时改值。
  expect(zones[0]).toBe('UTC+8');
  expect(zones.filter((zone) => zone === 'UTC+8')).toHaveLength(1);
  // 正常值不重复、也不该被顶到第一位
  const plain = timezoneOptions('UTC');
  expect(plain.filter((zone) => zone === 'UTC')).toHaveLength(1);
});
