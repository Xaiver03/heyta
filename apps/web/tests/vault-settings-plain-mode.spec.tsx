/**
 * ADR-0080：**明文模式（readable）下的设置面板**。
 *
 * 这条判据守的是一个我自己这次改动**引入**的风险：明文账号如果还能走
 * 「创建加密数据钥匙」那条老路，服务端在"历史非空 + 新建包"时会把上古世代留成
 * `null`，结果是**有包、但云上还是明文**。用户以为加密开了，而它没开。
 *
 * 所以这里断言的是"那条入口**不在**"——一个**否定**判据。否定判据必须能被反证：
 * 把面板里那个 `payloadMode === 'e2ee'` 条件删掉，这条就会红。
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { I18nProvider } from '@heyta/i18n';
import { setArgon2ParamsForTesting } from '@heyta/sync-core';

import { VaultSettingsPanel } from '../src/features/sync/VaultSettingsPanel.js';
import { useSyncStore } from '../src/features/sync/store.js';

const SERVER = 'https://sync.example.test';
const ACCOUNT = 'account-1';

let container: HTMLDivElement;
let root: Root;

const response = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const flush = async (): Promise<void> => {
  await act(async () => { await Promise.resolve(); });
};

beforeEach(async () => {
  setArgon2ParamsForTesting({ parallelism: 1, memorySize: 8, iterations: 1 });
  await new Promise<void>((resolve) => {
    const request = indexedDB.deleteDatabase('heyta-vault');
    request.onsuccess = request.onerror = request.onblocked = () => resolve();
  });

  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    // 🔴 这个账号在服务端是明文模式，且**没有**密钥包。
    if (url.includes('/api/sync/payload-mode')) return response(200, { mode: 'readable' });
    return response(404, { error: 'key_package_not_found' });
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
  act(() => { root.unmount(); });
  container.remove();
  vi.unstubAllGlobals();
});

describe('明文模式下的设置面板（ADR-0080）', () => {
  it('🔴 不出现「创建加密数据钥匙」那条入口（它会造出"有包但载荷仍明文"）', () => {
    expect(
      container.querySelector('[data-testid="vault-create-form"]'),
      '明文模式下仍然能走到只发包含、不迁移载荷的入口 —— 用户会以为加密开了',
    ).toBeNull();
  });

  it('加密开关那一格在，且读数是 plain', () => {
    const section = container.querySelector('[data-testid="encryption-mode-section"]');
    expect(section).not.toBeNull();
    expect(section?.getAttribute('data-mode')).toBe('plain');
  });
});
