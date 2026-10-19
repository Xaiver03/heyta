import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  bindCentralAccount,
  CENTRAL_ACCOUNT_BINDING_KEY,
  withCentralAccountBindingLock,
} from '../src/lib/central-account-binding.js';

const BASE_URL = 'https://heyta.example.test';

beforeEach(() => { localStorage.removeItem(CENTRAL_ACCOUNT_BINDING_KEY); });
afterEach(() => { vi.unstubAllGlobals(); });

describe('中央账号的跨标签绑定', () => {
  it('两个并发的不同 subject 只能有一个取得本地数据所有权', async () => {
    let tail = Promise.resolve();
    const request = vi.fn(async (_name: string, _options: unknown, work: () => unknown) => {
      const previous = tail;
      let release!: () => void;
      tail = new Promise<void>((resolve) => { release = resolve; });
      await previous;
      try { return await work(); } finally { release(); }
    });
    vi.stubGlobal('navigator', Object.assign(Object.create(navigator) as Navigator, {
      locks: { request },
    }));

    const results = await Promise.all([
      withCentralAccountBindingLock(() => bindCentralAccount(BASE_URL, '12')),
      withCentralAccountBindingLock(() => bindCentralAccount(BASE_URL, '13')),
    ]);

    expect(results).toEqual(['bound', 'mismatch']);
    expect(request).toHaveBeenCalledTimes(2);
    expect(localStorage.getItem(CENTRAL_ACCOUNT_BINDING_KEY)).toBe(JSON.stringify({ origin: BASE_URL, subject: '12' }));
  });
});
