import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const central = vi.hoisted(() => ({ session: vi.fn(), erase: vi.fn() }));

vi.mock('@heyta/app-host', async (importOriginal) => ({
  ...await importOriginal<typeof import('@heyta/app-host')>(),
  getCentralAuthSession: central.session,
}));
vi.mock('../src/lib/local-data-destruction.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/lib/local-data-destruction.js')>(),
  eraseWebLocalData: central.erase,
}));

import { CENTRAL_ACCOUNT_BINDING_KEY } from '../src/lib/central-account-binding.js';
import { clearLocalDataForCentralAccountSwitch } from '../src/features/auth/central-account-switch.js';
import { useSyncStore } from '../src/features/sync/store.js';

const BASE_URL = 'https://heyta.example.test';
const OLD_BINDING = JSON.stringify({ origin: BASE_URL, subject: '12' });
const NEW_BINDING = JSON.stringify({ origin: BASE_URL, subject: '13' });
const completeReports = Array.from({ length: 9 }, (_, index) => ({
  target: `layer-${String(index)}`, containerRemoved: true, storesCleared: 0,
}));

beforeEach(() => {
  vi.stubGlobal('navigator', Object.assign(Object.create(navigator) as Navigator, {
    locks: { request: async (_name: string, _options: unknown, work: () => unknown) => work() },
  }));
  localStorage.setItem(CENTRAL_ACCOUNT_BINDING_KEY, OLD_BINDING);
  central.session.mockReset().mockResolvedValue({ ok: true, value: {
    authenticated: true, user: { id: 13, email: 'new@example.test' }, csrfToken: 'csrf',
  } });
  central.erase.mockReset();
  useSyncStore.setState({
    baseUrl: BASE_URL, token: undefined, authTransport: 'bearer',
    email: undefined, accountId: undefined, csrfToken: undefined,
    centralBindingConflict: 'mismatch',
    centralBindingTarget: { origin: BASE_URL, subject: '13' },
    centralAccountSwitching: false,
  });
});

afterEach(() => { vi.unstubAllGlobals(); });

describe('切换中央账号前的本地数据保护', () => {
  it('服务端会话变号时不开始清除', async () => {
    central.session.mockResolvedValue({ ok: true, value: {
      authenticated: true, user: { id: 14, email: 'third@example.test' }, csrfToken: 'csrf',
    } });

    expect(await clearLocalDataForCentralAccountSwitch(BASE_URL, OLD_BINDING)).toBe('session-changed');
    expect(central.erase).not.toHaveBeenCalled();
    expect(localStorage.getItem(CENTRAL_ACCOUNT_BINDING_KEY)).toBe(OLD_BINDING);
  });

  it('清除结果有一层失败时保留绑定并退出切换态', async () => {
    central.erase.mockResolvedValue([...completeReports.slice(0, 8), {
      target: 'main-db', containerRemoved: false, storesCleared: 0,
    }]);

    expect(await clearLocalDataForCentralAccountSwitch(BASE_URL, OLD_BINDING)).toBe('erasure-incomplete');
    expect(central.erase).toHaveBeenCalledWith(OLD_BINDING);
    expect(localStorage.getItem(CENTRAL_ACCOUNT_BINDING_KEY)).toBe(OLD_BINDING);
    expect(useSyncStore.getState().centralAccountSwitching).toBe(false);
  });

  it('全部清除后仅绑定用户确认的目标 subject', async () => {
    central.erase.mockImplementation(async () => {
      localStorage.removeItem(CENTRAL_ACCOUNT_BINDING_KEY);
      return completeReports;
    });

    expect(await clearLocalDataForCentralAccountSwitch(BASE_URL, OLD_BINDING)).toBe('cleared');
    expect(localStorage.getItem(CENTRAL_ACCOUNT_BINDING_KEY)).toBe(NEW_BINDING);
    expect(useSyncStore.getState().centralAccountSwitching).toBe(true);
  });
});
