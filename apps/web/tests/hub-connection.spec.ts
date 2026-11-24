/**
 * Hub 连接的读写在 Web 端真的落到 META 上了吗
 * ==========================================
 *
 * 这一条挡的是"配置了但没存下来"：`saveHubConnection` 写错键名 / 忘了 trim /
 * 把数字当字符串读，界面上都只会表现为**下次打开又变成未配置**，
 * 而用户会以为是 Hub 挂了。所以断言全部落在**键名与值**上，不落在"函数没抛"。
 *
 * 假 store 只有 `getMetaValue` / `setMetaValue` 两个方法 —— 与 `HubMetaPort` 同形，
 * 于是这条用例不需要 SQLite/IndexedDB，也不碰 op-log。
 */

import { META_KEYS } from '@heyta/storage';
import { describe, expect, it } from 'vitest';

import { loadHubConnection, saveHubConnection, type HubMetaPort } from '../src/features/calendar/hub-connection.js';

function fakeStore(initial: Record<string, string | number> = {}): {
  readonly port: HubMetaPort;
  readonly values: Map<string, string | number>;
} {
  const values = new Map(Object.entries(initial));
  return {
    values,
    port: {
      getMetaValue: async (key: string) => values.get(key),
      setMetaValue: async (key: string, value: string | number) => {
        values.set(key, value);
      },
    },
  };
}

describe('Hub 连接（META 读写）', () => {
  it('没配过 ⇒ 地址与 token 都是空串（不是 undefined，也不是"已配置"）', async () => {
    const { port } = fakeStore();
    await expect(loadHubConnection(port)).resolves.toEqual({ baseUrl: '', token: '' });
  });

  it('保存后能原样读回来，且落在约定的两个键上', async () => {
    const { port, values } = fakeStore();
    const saved = await saveHubConnection('http://127.0.0.1:8787', 'hub-token', port);

    expect(saved).toEqual({ baseUrl: 'http://127.0.0.1:8787', token: 'hub-token' });
    expect(values.get(META_KEYS.CALENDAR_MIRROR_BASE_URL)).toBe('http://127.0.0.1:8787');
    expect(values.get(META_KEYS.CALENDAR_MIRROR_TOKEN)).toBe('hub-token');
    await expect(loadHubConnection(port)).resolves.toEqual({ baseUrl: 'http://127.0.0.1:8787', token: 'hub-token' });
  });

  it('保存时去掉首尾空白（与管道 trim 后"未配置 ⇒ 零请求"同一口径）', async () => {
    const { port } = fakeStore();
    await saveHubConnection('  http://hub.local:8787  ', '  token-1  ', port);
    await expect(loadHubConnection(port)).resolves.toEqual({
      baseUrl: 'http://hub.local:8787',
      token: 'token-1',
    });
  });

  it('META 里是数字时按"没配"读（旧版本/手写值不许冒充连接）', async () => {
    const { port } = fakeStore({
      [META_KEYS.CALENDAR_MIRROR_BASE_URL]: 42,
      [META_KEYS.CALENDAR_MIRROR_TOKEN]: 43,
    });
    await expect(loadHubConnection(port)).resolves.toEqual({ baseUrl: '', token: '' });
  });
});
