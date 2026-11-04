/**
 * 后台那面登录写的是"**替谁**要凭据"，而主应用那面不许跟着变。
 * （产品负责人 2026-11-04：「做得跟用户登录界面差不多，加上管理后台几个字就行了」）
 *
 * 🔴 两支各钉一条，因为同一枚 `brandLabel` 落在**两处不同的渲染**上：
 * 官方地址那一支的标题层是 central 面板的 `h2`，自带端点那一支是共享表单的 `title`。
 * 只钉其中一支的表现是：另一支哪天改了形状，界面上"管理后台"那三个字就没了，而门还是绿的。
 *
 * 第二组是反向对照：不传 `brandLabel`（主应用、深链那几路就是这么调的）⇒ 标题逐字照旧。
 * 少了这一条，"给后台加一行字"很容易顺手把所有人的登录面都换成后台口径。
 *
 * 全程零联网：`fetch` 一律 stub；同意闸门在这里直接放行（`consentFetch` 走 `globalThis.fetch`），
 * 因为本文件判的是**标题层**，不是闸门 —— 闸门那侧的判据在 `auth-panel.spec.tsx` 与
 * `admin-console-route.spec.tsx` 里。
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/features/privacy/consent-gate.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/features/privacy/consent-gate.js')>(),
  consentFetch: (input: RequestInfo | URL, init?: RequestInit) => globalThis.fetch(input, init),
}));

import { I18nProvider, translate } from '@heyta/i18n';

import { AuthPanel } from '../src/features/auth/AuthPanel.js';
import { __resetAuthForTests } from '../src/features/auth/store.js';
import { useSyncStore } from '../src/features/sync/store.js';

/** 中央配置回这一枚 ⇒ `centralMode` 成立（判据是 `mode:'oidc'` 且 `documentVersion` 非空）。 */
const CENTRAL_CONFIG = { mode: 'oidc', loginPath: '/api/auth/oidc/start', documentVersion: 'v1' };

const BRAND = 'heyta 管理后台';

let root: Root | undefined;
let container: HTMLDivElement | undefined;

const renderPanel = async (props: { baseUrl: string; brandLabel?: string }): Promise<HTMLDivElement> => {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL) =>
      Promise.resolve(
        String(input).endsWith('/api/auth/central/config')
          ? ({ status: 200, ok: true, json: () => Promise.resolve(CENTRAL_CONFIG) } as unknown as Response)
          : ({ status: 200, ok: true, json: () => Promise.resolve({}) } as unknown as Response),
      )),
  );
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(
      <I18nProvider locale="zh-CN">
        <AuthPanel
          baseUrl={props.baseUrl}
          onClose={() => undefined}
          {...(props.brandLabel === undefined ? {} : { brandLabel: props.brandLabel })}
        />
      </I18nProvider>,
    );
    await Promise.resolve();
  });
  return container;
};

beforeEach(() => {
  __resetAuthForTests();
  useSyncStore.setState({
    baseUrl: '',
    token: undefined,
    password: undefined,
    status: { kind: 'idle' },
    syncSettingsRequested: false,
  });
});

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  container?.remove();
  root = undefined;
  container = undefined;
  vi.unstubAllGlobals();
});

describe('官方地址那一支（线上那台就是这个形状）', () => {
  it('大标题挂上「管理后台」，而 eyebrow 那句"发去哪台服务端"没被顶掉', async () => {
    const el = await renderPanel({ baseUrl: '', brandLabel: BRAND });

    const panel = el.querySelector<HTMLElement>('[data-testid="central-auth-panel"]');
    expect(panel, '这一支没挂起来 ⇒ 本文件判的东西不存在').not.toBeNull();
    expect(panel!.querySelector('h2')?.textContent).toContain('管理后台');
    // 🔴 eyebrow 答的是目的地，不是品牌位：拿品牌去擦它就等于把透明度换成门面。
    expect(panel!.textContent).toContain(translate('zh-CN', 'web.auth.central.kicker'));
  });

  it('反向对照：不传 brandLabel ⇒ 标题逐字是主应用那句，也没混进"管理后台"', async () => {
    const el = await renderPanel({ baseUrl: '' });

    const panel = el.querySelector<HTMLElement>('[data-testid="central-auth-panel"]');
    expect(panel).not.toBeNull();
    expect(panel!.querySelector('h2')?.textContent).toBe(translate('zh-CN', 'web.auth.central.title'));
    expect(panel!.textContent).not.toContain('管理后台');
  });
});

describe('自带端点那一支', () => {
  it('同一枚 brandLabel 也出现在共享表单的标题位，副标题照旧（表单没被换成第二套）', async () => {
    const el = await renderPanel({ baseUrl: 'https://self-hosted.test', brandLabel: BRAND });

    const dialog = el.querySelector<HTMLElement>('[role="dialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog?.textContent).toContain('管理后台');
    expect(dialog?.textContent).toContain(translate('zh-CN', 'web.auth.subtitle'));
    // aria-label 也跟着这一面走：读屏用户同样要知道这是后台的登录。
    expect(dialog?.getAttribute('aria-label')).toContain('管理后台');
  });

  it('反向对照：这一支不传 brandLabel 时，标题与 aria-label 都是主应用那句', async () => {
    const el = await renderPanel({ baseUrl: 'https://self-hosted.test' });

    const dialog = el.querySelector<HTMLElement>('[role="dialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog?.textContent).not.toContain('管理后台');
    expect(dialog?.getAttribute('aria-label')).toBe(translate('zh-CN', 'web.auth.title'));
  });
});
