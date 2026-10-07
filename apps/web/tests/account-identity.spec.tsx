import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fetchDelegate = vi.hoisted(() => ({
  current: vi.fn<typeof fetch>(),
}));

// consentFetch intentionally captures the pristine fetch at module load. Install a
// delegating fetch before importing the hook so each test can control that pristine
// implementation without bypassing the privacy gate.
vi.stubGlobal('fetch', ((...args: Parameters<typeof fetch>) =>
  fetchDelegate.current(...args)) as typeof fetch);

const { privacyConsentActions } = await import('../src/features/privacy/consent-gate.js');
const { useAccountIdentity } = await import('../src/features/settings/useAccountIdentity.js');
const { useSyncStore } = await import('../src/features/sync/store.js');

let root: Root | undefined;
let container: HTMLDivElement | undefined;

function Probe(): React.JSX.Element {
  const identity = useAccountIdentity();
  return (
    <output
      data-status={identity.status}
      data-name={identity.displayName ?? ''}
      data-avatar-state={identity.avatarState ?? ''}
      data-avatar={identity.avatarDataUri ?? ''}
    />
  );
}

const flush = async (): Promise<void> => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
};

const mount = async (): Promise<void> => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(<Probe />);
  });
};

const output = (): HTMLOutputElement => {
  const element = container?.querySelector('output');
  if (!(element instanceof HTMLOutputElement)) throw new Error('identity probe missing');
  return element;
};

beforeEach(() => {
  localStorage.clear();
  privacyConsentActions.accept();
  fetchDelegate.current = vi.fn<typeof fetch>();
  useSyncStore.setState({
    baseUrl: 'https://sync.example.test',
    token: 'token-a',
    password: undefined,
    email: 'a@example.test',
  });
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = undefined;
  container = undefined;
  vi.unstubAllGlobals();
});

describe('useAccountIdentity', () => {
  it('读取服务端昵称，并在无头像时返回明确的 absent 状态', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      expect(new URL(String(input)).pathname).toBe('/api/account/profile');
      return Response.json({ displayName: '小鹿', avatarHash: null });
    });
    fetchDelegate.current = fetchMock;

    await mount();
    await flush();

    expect(output().dataset.status).toBe('ready');
    expect(output().dataset.name).toBe('小鹿');
    expect(output().dataset.avatarState).toBe('absent');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('隐私决定未通过时保持 idle 且零出站；同意改变后重新读取', async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({ displayName: '同意后读取', avatarHash: null }),
    );
    fetchDelegate.current = fetchMock;
    privacyConsentActions.revoke();

    await mount();
    await flush();
    expect(output().dataset.status).toBe('idle');
    expect(fetchMock).not.toHaveBeenCalled();

    privacyConsentActions.accept();
    await flush();
    await flush();
    expect(output().dataset.status).toBe('ready');
    expect(output().dataset.name).toBe('同意后读取');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('资料 GET 成功后先显示昵称，不等待头像解密', async () => {
    let resolveAvatar: ((response: Response) => void) | undefined;
    let call = 0;
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      call += 1;
      if (call === 1) return Promise.resolve(Response.json({ displayName: '先显示我', avatarHash: 'hash' }));
      return new Promise<Response>((resolve) => {
        resolveAvatar = resolve;
      });
    });
    fetchDelegate.current = fetchMock;
    useSyncStore.setState({ password: 'e2ee-passphrase' });

    await mount();
    await flush();
    expect(output().dataset.status).toBe('ready');
    expect(output().dataset.name).toBe('先显示我');
    expect(output().dataset.avatarState).toBe('');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    resolveAvatar?.(Response.json({ cipherBase64: 'invalid' }));
  });

  it('重新挂载后读取服务端当前昵称，而不是依赖旧组件 state', async () => {
    let displayName: string | null = '初始昵称';
    const fetchMock = vi.fn(async () => Response.json({ displayName, avatarHash: null }));
    fetchDelegate.current = fetchMock;

    await mount();
    await flush();
    expect(output().dataset.name).toBe('初始昵称');

    act(() => root?.unmount());
    container?.remove();
    root = undefined;
    container = undefined;
    displayName = '修改后的昵称';

    await mount();
    await flush();
    expect(output().dataset.name).toBe('修改后的昵称');
  });

  it('账号切换时终止旧请求，旧响应不能写回新账号', async () => {
    let resolveFirst: ((response: Response) => void) | undefined;
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const authorization = new Headers(init?.headers).get('authorization');
      if (authorization === 'Bearer token-a') {
        return new Promise<Response>((resolve) => {
          resolveFirst = resolve;
        });
      }
      return Promise.resolve(Response.json({ displayName: '新账号', avatarHash: null }));
    });
    fetchDelegate.current = fetchMock;

    await mount();
    await flush();
    expect(output().dataset.status).toBe('loading');
    expect(fetchMock).toHaveBeenCalled();
    const firstCall = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    expect(firstCall?.signal).toBeInstanceOf(AbortSignal);

    // Changing the token changes the request identity. The first request is held
    // deliberately; its eventual response must be ignored after cleanup.
    useSyncStore.setState({
      token: 'token-b',
      email: 'b@example.test',
    });
    await flush();

    expect(firstCall?.signal?.aborted).toBe(true);
    resolveFirst?.(Response.json({ displayName: '旧账号', avatarHash: null }));
    await flush();
    expect(output().dataset.name).not.toBe('旧账号');
  });
});
