/**
 * `createManagedTransport` —— 托管档宿主通道的唯一一份组装。
 *
 * 这一组钉的四件事都能各自出事，而且**都不会自己说话**：
 * 1. 空串被当成"配了" ⇒ 请求发到一个说不清的地方；
 * 2. 取令牌失败被当成"没登录"却**抛**出去 ⇒ 一次 AI 调用变成未捕获异常；
 * 3. 缓存住令牌 ⇒ 轮换之后一直用旧的，症状是"过一阵子忽然全 401"；
 * 4. 少检查一半（只有 token、没有地址）⇒ `not-configured` 不出现，
 *    而路由层会拿一个空 baseUrl 去发请求。
 */
import { describe, expect, it, vi } from 'vitest';

import { createManagedTransport } from '../src/ai-managed-transport.js';

const source = (overrides: Partial<Parameters<typeof createManagedTransport>[0]> = {}) => ({
  getServerUrl: () => 'https://heyta.waytofuture.cn',
  getToken: async () => 'T0K',
  ...overrides,
});

describe('createManagedTransport', () => {
  it('两者都在 ⇒ 给出 `{baseUrl, token}`，且地址被 trim', async () => {
    const transport = createManagedTransport(
      source({ getServerUrl: () => '  https://heyta.waytofuture.cn  ' }),
    );

    await expect(transport()).resolves.toEqual({
      baseUrl: 'https://heyta.waytofuture.cn',
      token: 'T0K',
    });
  });

  it('🔴 服务器地址是空串 / 全空白 ⇒ `undefined`（不是"配了"）', async () => {
    for (const url of ['', '   ']) {
      const transport = createManagedTransport(source({ getServerUrl: () => url }));
      await expect(transport(), `地址=${JSON.stringify(url)}`).resolves.toBeUndefined();
    }
  });

  it('🔴 令牌为空串 / `undefined` ⇒ `undefined`', async () => {
    for (const token of ['', '  ', undefined]) {
      const transport = createManagedTransport(source({ getToken: async () => token }));
      await expect(transport(), `令牌=${JSON.stringify(token)}`).resolves.toBeUndefined();
    }
  });

  it('🔴 取令牌**抛**出去 ⇒ 返回 `undefined`，不许抛穿调用栈', async () => {
    const transport = createManagedTransport(
      source({
        getToken: async () => {
          throw new Error('钥匙串锁着');
        },
      }),
    );

    // `rejects` 会红在这里 —— 这条判据的存在理由就是"一次 AI 调用不该变成未捕获异常"
    await expect(transport()).resolves.toBeUndefined();
  });

  it('🔴 令牌是**活取值器**，不缓存：两次调用拿到两次现取值', async () => {
    const getToken = vi.fn<() => Promise<string | undefined>>();
    getToken.mockResolvedValueOnce('OLD').mockResolvedValueOnce('NEW');
    const transport = createManagedTransport(source({ getToken }));

    await expect(transport()).resolves.toMatchObject({ token: 'OLD' });
    await expect(transport()).resolves.toMatchObject({ token: 'NEW' });
    expect(getToken).toHaveBeenCalledTimes(2);
  });
});
