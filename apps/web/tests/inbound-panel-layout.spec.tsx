import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { zhCN } from '@heyta/i18n';
import { defaultAiSettings } from '../src/features/settings/aiStore.js';

/**
 * 这一族钉的是**排版决定的结构**，不是"好不好看"：标题层级、危险动作的样式、
 * 一次性凭据与它所属规则的从属关系、错误行与提示行的区分。
 * 理由（AGENTS §5 + §7 第 195 条那一族）：这些格子错了以后**没有任何一层会失败** ——
 * 标题掉档只有人眼看得见，凭据卡挂错规则也只有人眼看得见。
 * 🔴 夹具里那枚 secret 是合成值，不是凭据。
 * 🔴 规则卡故意给**两枚**：只给一枚时"凭据卡挪到整块面板页尾"和"嵌在那枚卡里"
 *    在 DOM 上长得一模一样，那条从属判据会当场变成永远通过的判据（§7 第 33 条那一族）。
 */

const RULE_IDS = ['rule-a', 'rule-b'] as const;
const ruleRow = (id: string) => ({
  id, version: 3, keyId: `hook-${id}`, enabled: true, allowedFields: ['title'], maxItems: 50,
  createdAt: '2026-10-08T00:00:00Z', deletedAt: null, targetProjectId: null, timezone: null,
  parseVersion: 1, authorizationVersion: 1,
});

const mocks = vi.hoisted(() => ({
  sync: { baseUrl: 'https://sync.test', token: 'token', accountId: '1' },
  failRules: { value: false },
  fetch: vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (mocks.failRules.value) throw new Error('rules endpoint down');
    if (url.endsWith('/events')) return new Response(JSON.stringify({ events: [] }));
    if (url.endsWith('/recipient-key')) return new Response(JSON.stringify({ keyEpoch: 1, packageVersion: 1 }));
    // 凭据列表：GET 读它；签发那一发由用例自己用 mockImplementationOnce 给。
    if (url.endsWith('/sender-credentials') && init?.method === 'POST') return new Response('{}', { status: 500 });
    if (url.endsWith('/sender-credentials')) return new Response(JSON.stringify({ credentials: [] }));
    return new Response(JSON.stringify({ rules: ['rule-a', 'rule-b'].map((id) => ruleRow(id)) }));
  }),
}));
vi.mock('../src/features/sync/store.js', () => ({ useSyncStore: Object.assign(
  (select: (s: unknown) => unknown) => select(mocks.sync), { getState: () => mocks.sync },
) }));
vi.mock('../src/features/privacy/consent-gate.js', () => ({ consentFetch: mocks.fetch }));
vi.mock('../src/features/settings/inbound-runtime.js', () => ({
  hasWebInboundWorker: async () => true,
  processWebInboundOnce: vi.fn(),
  ensureWebInboundRecipientKey: vi.fn(), registerWebInboundWorker: vi.fn(), rotateWebInboundRecipientKey: vi.fn(),
}));

import { InboundAutomationSettings } from '../src/features/settings/InboundAutomationSettings.js';

async function openPanel(): Promise<{ container: HTMLElement; root: Root }> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<InboundAutomationSettings routing={{ ...defaultAiSettings().routing, enabled: true }} consents={[]} />);
  });
  return { container, root };
}

async function close(panel: { container: HTMLElement; root: Root }): Promise<void> {
  await act(async () => { panel.root.unmount(); });
  panel.container.remove();
}

// 运行时缺卡返回的是 null 而不是 undefined：分母自检那条用的正是 `not.toBeNull()`，
// 把类型写成 undefined 会让那条判据在缺卡时安静通过。
const card = (container: HTMLElement, id: string): HTMLElement | null =>
  container.querySelector<HTMLElement>(`[data-testid="inbound-rule-${id}"]`);
const tier = (node: Element | null): string | undefined =>
  [...(node?.classList ?? [])].find((name) => name.startsWith('ht-type-'));

afterEach(() => { mocks.failRules.value = false; vi.clearAllMocks(); });

it('分母自检：两枚规则卡都渲染出来了（否则从属判据是空转）', async () => {
  const panel = await openPanel();
  try {
    expect(panel.container.querySelector('[data-testid="inbound-automation-settings"]')).not.toBeNull();
    for (const id of RULE_IDS) expect(card(panel.container, id), `规则卡 ${id} 必须存在`).not.toBeNull();
  } finally { await close(panel); }
});

it('面板标题与事件区分节标题各自挂到语义档位，且两档不同', async () => {
  const panel = await openPanel();
  try {
    const title = panel.container.querySelector('h3');
    const eventsHeading = panel.container.querySelector('.ht-inbound__events h4');
    expect(title, '面板标题必须在 DOM 里').not.toBeNull();
    expect(eventsHeading, '事件区必须有它自己的分节标题').not.toBeNull();

    // 🔴 `.ht-settings__h3` 自己**不带**排版四件套（它只给 margin 与 flex），
    // 档位来自成对挂上的 `ht-type-*`。漏挂不报错，只是退回浏览器的默认 h3 尺寸 ——
    // 这正是"一页八个页标题"那类层级倒挂的来路。
    expect(tier(title), '面板标题没挂语义档位').toBeDefined();
    expect(tier(eventsHeading), '事件区标题没挂语义档位').toBeDefined();
    expect(tier(eventsHeading)).not.toBe(tier(title));
    expect(tier(eventsHeading)).toBe('ht-type-group-label');
  } finally { await close(panel); }
});

it('一次性凭据卡只在它那一枚规则卡里，另一枚没有它', async () => {
  const panel = await openPanel();
  try {
    const target = card(panel.container, 'rule-b');
    const rotate = [...(target?.querySelectorAll('button') ?? [])]
      .find((item) => item.textContent === zhCN['web.ai.inbound.credential.rotate']) as HTMLButtonElement | undefined;
    expect(rotate, '规则卡里的「轮换发送凭据」按钮必须存在').toBeDefined();
    mocks.fetch.mockImplementationOnce(async () => new Response(JSON.stringify(
      { credentialId: 'cred-1', keyId: 'hook-rule-b', secret: 'synthetic-once-code', ruleId: 'rule-b' },
    )));
    await act(async () => { rotate?.click(); });

    const secret = panel.container.querySelector('[data-testid="inbound-credential-secret"]');
    expect(secret, '签发后必须有一次性凭据卡').not.toBeNull();
    expect(target?.contains(secret ?? null), '凭据卡必须显示在它所属的那枚规则卡里').toBe(true);
    const other = card(panel.container, 'rule-a');
    expect(other?.contains(secret ?? null), '凭据卡不许出现在别的规则卡里').toBe(false);
    // 也不许挂在整块面板的页尾（那等于"动作在卡里、结果在页尾"，用户看不出它属于谁）。
    expect(secret?.parentElement?.closest('[data-testid^="inbound-rule-"]'), '凭据卡的直接容器就是那张规则卡').toBe(target);
  } finally { await close(panel); }
});

it('每一枚规则卡的「删除」都是危险动作样式，暂停/启用不是', async () => {
  const panel = await openPanel();
  try {
    const buttons = (id: string, copy: keyof typeof zhCN): HTMLButtonElement[] =>
      [...(card(panel.container, id)?.querySelectorAll('button') ?? [])]
        .filter((item) => item.textContent === zhCN[copy]) as HTMLButtonElement[];
    for (const id of RULE_IDS) {
      const remove = buttons(id, 'web.ai.inbound.remove');
      const pause = buttons(id, 'web.ai.inbound.pause');
      expect(remove, `规则卡 ${id} 的「删除」必须存在`).toHaveLength(1);
      expect(pause, `规则卡 ${id} 的「暂停」必须存在`).toHaveLength(1);
      expect(remove[0]?.classList.contains('ht-btn--danger'), `规则卡 ${id} 的删除要危险色`).toBe(true);
      expect(pause[0]?.classList.contains('ht-btn--danger'), '暂停不是不可逆动作，不许染成危险色').toBe(false);
    }
  } finally { await close(panel); }
});

it('加载失败那一行是错误样式且带 role=alert，不回成普通提示', async () => {
  mocks.failRules.value = true;
  const panel = await openPanel();
  try {
    const alert = panel.container.querySelector('[role="alert"]');
    expect(alert, '取规则失败必须有一条 role=alert 的回显').not.toBeNull();
    // 错误行与提示行必须**长得不一样**：同一条 `ht-settings__hint` 时，
    // "没取到数据"和"一句说明"在界面上无法区分。
    expect(alert?.classList.contains('ht-settings__danger')).toBe(true);
    expect(alert?.classList.contains('ht-settings__hint'), '错误行不许继续用提示行的类').toBe(false);
  } finally { await close(panel); }
});

it('每张卡的标识与计数行都走等宽数字', async () => {
  const panel = await openPanel();
  try {
    for (const id of RULE_IDS) {
      const own = card(panel.container, id);
      expect(own?.querySelector('strong')?.classList.contains('tabular-nums'), `规则卡 ${id} 的 keyId 要等宽数字`).toBe(true);
      expect(own?.querySelector('p')?.classList.contains('tabular-nums'), `规则卡 ${id} 的版本/状态行要等宽数字`).toBe(true);
    }
  } finally { await close(panel); }
});
