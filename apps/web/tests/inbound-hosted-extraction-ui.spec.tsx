/**
 * 「抽取归谁」那一格在 web 面板上的判据（ADR-0077）
 * ==============================================
 *
 * 这一格是整条链上唯一一次**用户主动同意"我们这一次要读明文"**的地方，
 * 所以它值得单独一组尺，而不是混在布局那几枚里：
 *
 * · 默认不许是开的（库里那一列可空 = 从没被问过，界面于是必须落在"这台设备"那一档）；
 * · 勾选与保存是**双向**的：关掉再存，服务端收到的就是 false（一条只能开不能关的开关
 *   等于把用户的同意变成了不可撤回的东西）；
 * · 列表与编辑态都读**服务端那一行**，不许用本地状态乐观顶上 —— 保存失败时界面
 *   说"由服务器抽取"而库里没开，是最难被发现的一类谎；
 * · 那两句话说的是数据流向，属于 `packages/i18n` 那唯一事实源，面板里不许有第二份字面量。
 *
 * 装置照 `inbound-section-active.spec.tsx`：真 `createInboundRulesRemote` + 假 fetch，
 * 所以断言读的是**真的 PUT 请求体**，不是组件内部的一个 state。
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { translate } from '@heyta/i18n';
import { defaultAiSettings } from '../src/features/settings/aiStore.js';

const HOSTED_STATE_ID = 'inbound-hosted-state-rule';

const mocks = vi.hoisted(() => ({
  sync: { baseUrl: 'https://sync.test', token: 'token', accountId: '1' },
  /** 服务端那一行 `hosted_extraction` 的现量，逐用例改它 ⇒ 界面跟着翻。 */
  hosted: false,
  /** 每一次带请求体的写：`{ method, body }`，供"PUT 里到底发了什么"那两枚断言读。 */
  writes: [] as { method: string; body: Record<string, unknown> }[],
  fetch: vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (init?.body !== undefined) mocks.writes.push({ method: String(init.method), body: JSON.parse(String(init.body)) as Record<string, unknown> });
    return new Response(JSON.stringify(
      url.endsWith('/events') ? { events: [] }
        : url.endsWith('/recipient-key') ? { keyEpoch: 1, packageVersion: 1 }
          : { rules: [{ id: 'rule', version: 1, keyId: 'hook', enabled: true, allowedFields: ['title'], maxItems: 50,
            createdAt: '2026-10-08T00:00:00.000Z', deletedAt: null, targetProjectId: null, timezone: null,
            parseVersion: 1, authorizationVersion: 1, hostedExtraction: mocks.hosted }] }
    ));
  }),
}));
vi.mock('../src/features/sync/store.js', () => ({ useSyncStore: Object.assign(
  (select: (s: unknown) => unknown) => select(mocks.sync), { getState: () => mocks.sync },
) }));
vi.mock('../src/features/privacy/consent-gate.js', () => ({ consentFetch: mocks.fetch }));
vi.mock('../src/features/settings/inbound-runtime.js', () => ({
  hasWebInboundWorker: async () => true,
  getWebInboundRecipientKey: async () => ({ keyEpoch: 1, packageVersion: 1 }),
  processWebInboundOnce: vi.fn(async () => ({ state: 'empty' as const })),
  ensureWebInboundRecipientKey: vi.fn(), registerWebInboundWorker: vi.fn(), rotateWebInboundRecipientKey: vi.fn(),
}));
import { InboundAutomationSettings } from '../src/features/settings/InboundAutomationSettings.js';

let container: HTMLElement | undefined;
let root: ReturnType<typeof createRoot> | undefined;
const routing = { ...defaultAiSettings().routing, enabled: true };

const open = async (): Promise<void> => {
  await act(async () => { root!.render(<InboundAutomationSettings active routing={routing} consents={[]} />); });
  await act(async () => { await new Promise((resolve) => { setTimeout(resolve, 0); }); });
};

const check = (): HTMLInputElement => document.querySelector('[data-testid="inbound-hosted-extraction"] input') as HTMLInputElement;
const stateLine = (): string => (document.querySelector(`[data-testid="${HOSTED_STATE_ID}"]`) as HTMLElement).textContent ?? '';
const buttonByLabel = (key: 'web.ai.inbound.edit' | 'web.ai.inbound.saveEdit'): HTMLButtonElement => {
  const label = translate('zh-CN', key);
  const found = Array.from(document.querySelectorAll('button')).find((button) => button.textContent === label);
  // 找不到按钮时先红在这里：否则下面每一枚断言都退化成"没点到东西所以什么都没发生"。
  expect(found, `界面上没有文案等于「${label}」的那枚按钮`).toBeDefined();
  return found as HTMLButtonElement;
};

/** 进入编辑态 —— 保存那一笔 PUT 只在编辑态发得出去。 */
const startEdit = async (): Promise<void> => { await act(async () => { buttonByLabel('web.ai.inbound.edit').click(); }); };

afterEach(async () => {
  if (root !== undefined) await act(async () => { root.unmount(); });
  container?.remove();
  container = undefined; root = undefined;
  mocks.writes.length = 0;
  mocks.hosted = false;
  vi.clearAllMocks();
});

const mount = async (): Promise<void> => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await open();
};

it('🔴 默认不开：那一格是未勾选的，而列表说的是"这台设备"', async () => {
  await mount();
  expect(check().checked, '默认值翻成"我们读明文"是在替用户做同意').toBe(false);
  expect(stateLine()).toBe(translate('zh-CN', 'web.ai.inbound.hosted.stateDevice'));
});

it('🔴 勾上再保存 ⇒ 真的把 hostedExtraction: true 发进那笔 PUT（不是只改本地状态）', async () => {
  await mount();
  await startEdit();
  await act(async () => { check().click(); });
  await act(async () => { buttonByLabel('web.ai.inbound.saveEdit').click(); });
  const config = mocks.writes.find((write) => write.method === 'PUT' && write.body.hostedExtraction !== undefined);
  expect(config, `这一格里一次 PUT 都没发，写的是：${JSON.stringify(mocks.writes)}`).toBeDefined();
  expect(config!.body.hostedExtraction).toBe(true);
  // 其余那一格带的字段不许被顺手改掉（保存的是一次完整配置，不是差集）。
  expect(config!.body.allowedFields).toEqual(['title']);
  expect(config!.body.maxItems).toBe(50);
});

it('🔴 反向也要成立：开着再取消勾选，发出去的是 false（同意必须可撤回）', async () => {
  mocks.hosted = true;
  await mount();
  await startEdit();
  await act(async () => { check().click(); });
  await act(async () => { buttonByLabel('web.ai.inbound.saveEdit').click(); });
  const config = mocks.writes.find((write) => write.method === 'PUT' && write.body.hostedExtraction !== undefined);
  expect(config!.body.hostedExtraction).toBe(false);
});

it('🔴 列表与编辑态读的是服务端那一行，不是本地猜的默认值', async () => {
  mocks.hosted = true;
  await mount();
  expect(stateLine()).toBe(translate('zh-CN', 'web.ai.inbound.hosted.stateHosted'));
  await startEdit();
  expect(check().checked, '服务端说开着，编辑器却是关的 —— 一保存就把用户的选择抹掉了').toBe(true);
});

it('那两句话说的是数据流向：面板里不许有第二份中文/英文正文', async () => {
  // vitest 按包跑，cwd 就是 `apps/web`（`import.meta.url` 在 jsdom 里拼不出 file: 方案，
  // 那条坑本轮踩过一次）⇒ 这里按 cwd 相对路径读源码。
  const source = readFileSync(resolve('src/features/settings/InboundAutomationSettings.tsx'), 'utf8');
  // 阳性对照：先证明读到的确实是那枚面板，而不是一个空串把下面每一枚断言都喂成假绿。
  expect(source).toContain("t('web.ai.inbound.hosted.label')");
  for (const key of ['web.ai.inbound.hosted.label', 'web.ai.inbound.hosted.notice'] as const) {
    for (const locale of ['zh-CN', 'en'] as const) {
      const sentence = translate(locale, key);
      expect(source.includes(sentence), `${locale} 档那句正文被抄进了面板源码`).toBe(false);
    }
  }
});
