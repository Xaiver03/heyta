import { beforeEach, describe, expect, it, vi } from 'vitest';

const central = vi.hoisted(() => ({
  config: vi.fn(),
  session: vi.fn(),
}));

vi.mock('@heyta/app-host', async (importOriginal) => ({
  ...await importOriginal<typeof import('@heyta/app-host')>(),
  getCentralAuthConfig: central.config,
  getCentralAuthSession: central.session,
}));

import { CENTRAL_COOKIE_SESSION_MARKER } from '@heyta/app-host';
import { installCentralSessionRecheck } from '../src/features/sync/central-session-recheck.js';
import { useSyncStore } from '../src/features/sync/store.js';

const BASE_URL = 'https://heyta.example.test';
const oidcConfig = { ok: true, value: { mode: 'oidc', loginPath: '/api/auth/oidc/start', documentVersion: null } };
const authenticated = { ok: true, value: {
  authenticated: true, user: { id: 12, email: 'alice@example.test' }, csrfToken: 'csrf-new',
} };

beforeEach(() => {
  central.config.mockReset().mockResolvedValue(oidcConfig);
  central.session.mockReset();
  useSyncStore.setState({
    baseUrl: BASE_URL, token: undefined, authTransport: 'bearer', csrfToken: undefined,
    email: undefined, accountId: undefined, password: undefined,
    syncDraft: { baseUrl: BASE_URL, token: '', password: '' },
  });
});

describe('中央浏览器会话复查', () => {
  it('服务端确认会话已失效后，清除旧 Cookie 身份标签并保留新 CSRF', async () => {
    useSyncStore.setState({
      token: CENTRAL_COOKIE_SESSION_MARKER, authTransport: 'cookie',
      email: 'alice@example.test', accountId: '12', csrfToken: 'csrf-old',
    });
    central.session.mockResolvedValue({ ok: true, value: { authenticated: false, csrfToken: 'csrf-anonymous' } });

    await useSyncStore.getState().resumeCentralSession();

    expect(useSyncStore.getState()).toMatchObject({
      token: undefined, authTransport: 'bearer', email: undefined,
      accountId: undefined, csrfToken: 'csrf-anonymous',
    });
  });

  it('OIDC 服务端不再接受迁移前本地令牌时，不继续展示旧身份', async () => {
    useSyncStore.setState({ token: 'old-local-token', email: 'old@example.test', accountId: '9' });
    central.session.mockResolvedValue({ ok: true, value: { authenticated: false, csrfToken: 'csrf-anonymous' } });

    await useSyncStore.getState().resumeCentralSession();

    expect(useSyncStore.getState()).toMatchObject({
      token: undefined, email: undefined, accountId: undefined, csrfToken: 'csrf-anonymous',
    });
  });

  it('网络结果未知时保留会话，不把暂时故障当作退出', async () => {
    useSyncStore.setState({ token: CENTRAL_COOKIE_SESSION_MARKER, authTransport: 'cookie', email: 'alice@example.test' });
    central.session.mockResolvedValue({ ok: false, reason: 'network' });

    await useSyncStore.getState().resumeCentralSession();

    expect(useSyncStore.getState()).toMatchObject({
      token: CENTRAL_COOKIE_SESSION_MARKER, authTransport: 'cookie', email: 'alice@example.test',
    });
  });

  it('服务端明确切回本地模式时移除旧 Cookie 身份', async () => {
    useSyncStore.setState({ token: CENTRAL_COOKIE_SESSION_MARKER, authTransport: 'cookie', email: 'alice@example.test' });
    central.config.mockResolvedValue({ ok: true, value: { mode: 'local', loginPath: '/api/auth/oidc/start', documentVersion: null } });

    await useSyncStore.getState().resumeCentralSession();

    expect(central.session).not.toHaveBeenCalled();
    expect(useSyncStore.getState()).toMatchObject({ token: undefined, authTransport: 'bearer', email: undefined });
  });

  it('自托管本地模式继续保留它自己的 bearer 会话', async () => {
    useSyncStore.setState({ token: 'self-hosted-token', email: 'owner@example.test' });
    central.config.mockResolvedValue({ ok: true, value: { mode: 'local', loginPath: '/api/auth/oidc/start', documentVersion: null } });

    await useSyncStore.getState().resumeCentralSession();

    expect(central.session).not.toHaveBeenCalled();
    expect(useSyncStore.getState()).toMatchObject({ token: 'self-hosted-token', email: 'owner@example.test' });
  });

  it('退出后晚到的旧会话结果不能重新签入', async () => {
    let resolveSession!: (result: typeof authenticated) => void;
    central.session.mockReturnValue(new Promise((resolve) => { resolveSession = resolve; }));
    const pending = useSyncStore.getState().resumeCentralSession();
    await vi.waitFor(() => expect(central.session).toHaveBeenCalledOnce());

    useSyncStore.getState().clearCredentials();
    resolveSession(authenticated);
    await pending;

    expect(useSyncStore.getState()).toMatchObject({ token: undefined, email: undefined, accountId: undefined });
  });

  it('退出后晚到的配置结果也不能继续探测或重签入', async () => {
    let resolveConfig!: (result: typeof oidcConfig) => void;
    central.config.mockReturnValue(new Promise((resolve) => { resolveConfig = resolve; }));
    const pending = useSyncStore.getState().resumeCentralSession();
    useSyncStore.getState().clearCredentials();
    resolveConfig(oidcConfig);
    await pending;

    expect(central.session).not.toHaveBeenCalled();
    expect(useSyncStore.getState().token).toBeUndefined();
  });

  it('另一标签页换成不同 subject 时不自动把本地数据接到新账号', async () => {
    useSyncStore.setState({
      token: CENTRAL_COOKIE_SESSION_MARKER, authTransport: 'cookie',
      email: 'old@example.test', accountId: '9',
    });
    central.session.mockResolvedValue(authenticated);

    await useSyncStore.getState().resumeCentralSession();

    expect(useSyncStore.getState()).toMatchObject({ token: undefined, email: undefined, accountId: undefined });
  });

});

describe('后台标签页恢复时复查', () => {
  it('只在隐私闸已开且当前是 Cookie 会话时复查；卸载后停止监听', async () => {
    let networkAllowed = false;
    let hasCookieSession = true;
    const recheck = vi.fn().mockResolvedValue(undefined);
    const remove = installCentralSessionRecheck({
      networkAllowed: () => networkAllowed,
      hasCookieSession: () => hasCookieSession,
      recheck,
    });
    try {
      window.dispatchEvent(new Event('focus'));
      networkAllowed = true;
      hasCookieSession = false;
      window.dispatchEvent(new Event('focus'));
      expect(recheck).not.toHaveBeenCalled();

      hasCookieSession = true;
      window.dispatchEvent(new Event('focus'));
      await vi.waitFor(() => expect(recheck).toHaveBeenCalledOnce());
    } finally {
      remove();
    }
    window.dispatchEvent(new Event('focus'));
    expect(recheck).toHaveBeenCalledOnce();
  });

  it('一次复查仍在等待时，不重复发起会话请求', async () => {
    let finish!: () => void;
    const recheck = vi.fn().mockReturnValue(new Promise<void>((resolve) => { finish = resolve; }));
    const remove = installCentralSessionRecheck({
      networkAllowed: () => true,
      hasCookieSession: () => true,
      recheck,
    });
    try {
      window.dispatchEvent(new Event('focus'));
      window.dispatchEvent(new Event('focus'));
      await vi.waitFor(() => expect(recheck).toHaveBeenCalledOnce());
      finish();
    } finally {
      remove();
    }
  });
});
