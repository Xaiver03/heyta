import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '@heyta/i18n';
import { setArgon2ParamsForTesting } from '@heyta/sync-core';
import { VaultSettingsPanel } from '../src/features/sync/VaultSettingsPanel.js';
import { invalidateWebVaultSession } from '../src/lib/vault-session.js';
import { useSyncStore } from '../src/features/sync/store.js';

const SERVER = 'https://sync.example.test';
const ACCOUNT = `vault-ui-${Date.now()}`;

let container: HTMLDivElement;
let root: Root;
let published: Record<string, unknown> | undefined;

function response(status: number, body: unknown): Response {
  return { status, ok: status >= 200 && status < 300, json: async () => body } as Response;
}

async function typeInto(testId: string, value: string): Promise<void> {
  const input = container.querySelector<HTMLInputElement>(`[data-testid="${testId}"]`);
  if (!input) throw new Error(`missing ${testId}`);
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  if (setter === undefined) throw new Error('HTMLInputElement.value setter unavailable');
  await act(async () => {
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await Promise.resolve();
  });
}

async function flush(): Promise<void> {
  await act(async () => undefined);
}

async function waitForSelector(selector: string): Promise<Element> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const found = container.querySelector(selector);
    if (found) return found;
    await act(async () => new Promise((resolve) => setTimeout(resolve, 10)));
  }
  throw new Error(`Timed out waiting for ${selector}`);
}

beforeEach(async () => {
  setArgon2ParamsForTesting({ parallelism: 1, memorySize: 8, iterations: 1 });
  await new Promise<void>((resolve) => {
    const request = indexedDB.deleteDatabase('heyta-vault');
    request.onsuccess = request.onerror = request.onblocked = () => resolve();
  });
  published = undefined;
  // 每个用例都要干净：上一条用例把 root 记进了 sessionStorage，下一条会被它自动解锁。
  localStorage.clear();
  sessionStorage.clear();
  // 会话是模块级单例：不显式作废，上一条用例解锁过的会话会被下一条沿用。
  invalidateWebVaultSession();
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === 'PUT') {
      published = JSON.parse(String(init.body)).package as Record<string, unknown>;
      return response(200, { package: published, payloadKeyVersion: null });
    }
    if (published === undefined) return response(404, { error: 'key_package_not_found' });
    return response(200, { package: published, payloadKeyVersion: null });
  }));
  useSyncStore.setState({
    baseUrl: SERVER,
    token: 'jwt',
    accountId: ACCOUNT,
    password: undefined,
    status: { kind: 'idle' },
    syncNow: async () => ({ kind: 'idle' }),
  });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  act(() => {
    root.render(<I18nProvider locale="en"><VaultSettingsPanel /></I18nProvider>);
  });
  await flush();
  await flush();
  await new Promise((resolve) => setTimeout(resolve, 50));
  await flush();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe('web encrypted data key settings', () => {
  it('creates a key only after recovery confirmation and never sends the plaintext code', async () => {
    await waitForSelector('[data-testid="vault-create-form"]');
    await typeInto('vault-create-passphrase', 'correct horse battery staple');
    await act(async () => container.querySelector<HTMLButtonElement>('[data-testid="vault-create"]')!.click());
    await waitForSelector('[data-testid="vault-recovery-display"]');

    const code = container.querySelector('[data-testid="vault-recovery-display"]')?.textContent;
    expect(code).toMatch(/^[0-9A-Z-]{40,}$/);
    expect(container.querySelector('[data-testid="vault-publish"]')).not.toBeNull();
    await typeInto('vault-recovery-confirm', code!);
    await act(async () => container.querySelector<HTMLButtonElement>('[data-testid="vault-publish"]')!.click());
    await waitForSelector('[data-testid="vault-ready"]');

    expect(container.querySelector('[data-testid="vault-ready"]')).not.toBeNull();
    expect(JSON.stringify(published)).not.toContain(code!.replaceAll('-', ''));
    expect(JSON.stringify(published)).not.toContain('recoveryCode');

    await act(async () => container.querySelector<HTMLButtonElement>('[data-testid="vault-lock"]')!.click());
    await waitForSelector('[data-testid="vault-unlock-form"]');
    await typeInto('vault-recovery-code', code!);
    await act(async () => container.querySelector<HTMLButtonElement>('[data-testid="vault-unlock-recovery"]')!.click());
    await waitForSelector('[data-testid="vault-recovery-rotation"]');
    expect(container.querySelector('[data-testid="vault-ready"]')).toBeNull();

    await typeInto('vault-new-passphrase', 'a different passphrase');
    await act(async () => container.querySelector<HTMLButtonElement>('[data-testid="vault-change-passphrase"]')!.click());
    await waitForSelector('[data-testid="vault-recovery-display"]');
    const rotatedCode = container.querySelector('[data-testid="vault-recovery-display"]')?.textContent;
    expect(rotatedCode).toMatch(/^[0-9A-Z-]{40,}$/);
    await typeInto('vault-recovery-confirm', rotatedCode!);
    await act(async () => container.querySelector<HTMLButtonElement>('[data-testid="vault-publish"]')!.click());
    await waitForSelector('[data-testid="vault-ready"]');
  });
});

/**
 * ADR-0081 之后新暴露的一条真缺陷的判据：
 *
 * `session.keyPackage === undefined` 只说明**本机还没加载到**，不等于**服务端没有**。
 * 拿前者当后者用，就会在本机尚未加载时画出「创建加密数据钥匙」—— 对着已有的密文
 * 再发一把新钥匙。这里让服务端**已经有包**，断言面板给的是解锁框、不是创建表单。
 */
it('服务端已有包但本机还没加载 ⇒ 给解锁框，不给"创建"', async () => {
  const serverPackage = {
    version: 1,
    keyVersion: 1,
    rootKeyFingerprint: 'b'.repeat(64),
    passphrase: {
      kdf: 'argon2id', salt: Buffer.alloc(16, 1).toString('base64'),
      iv: Buffer.alloc(12, 2).toString('base64'), ciphertext: Buffer.alloc(48, 3).toString('base64'),
    },
    recovery: {
      kdf: 'argon2id', salt: Buffer.alloc(16, 4).toString('base64'),
      iv: Buffer.alloc(12, 5).toString('base64'), ciphertext: Buffer.alloc(48, 6).toString('base64'),
    },
  };
  vi.stubGlobal('fetch', vi.fn(async () => response(200, { package: serverPackage, payloadKeyVersion: 1 })));

  act(() => root.unmount());
  container.remove();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  act(() => {
    root.render(<I18nProvider locale="en"><VaultSettingsPanel /></I18nProvider>);
  });
  await flush();
  await new Promise((resolve) => setTimeout(resolve, 50));
  await flush();
  await flush();

  try {
    await waitForSelector('[data-testid="vault-unlock-form"]');
  } catch (error) {
    const ids = Array.from(container.querySelectorAll('[data-testid]')).map((n) => n.getAttribute('data-testid'));
    console.log('PANEL_IDS', JSON.stringify(ids));
    throw error;
  }
  expect(
    container.querySelector('[data-testid="vault-create-form"]'),
    '服务端已经有包了，还给"创建"入口 = 让用户对着已有密文再造一把钥匙',
  ).toBeNull();
});
