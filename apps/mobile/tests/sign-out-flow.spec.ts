/**
 * 「退出登录」编排的判据
 * ======================
 *
 * 🔴 这一族断言的存在理由只有一句话：**"退出"以前什么都不撤销**。
 * 移动端此前只有设置面那颗「清除本机保存的凭据」，它删本机、不碰服务端，
 * 而那枚访问令牌在服务端**还能用一整年**
 * （`packages/shared-schema/src/session-contract.ts` 文件头记的就是这件事）。
 * 于是"退出登录"这四个字在共享电脑上是一句谎。
 *
 * 这里钉住的是两件**互相冲突**的事，做对一件很容易做错另一件：
 *   · 本机凭据**一定**要清（把那枚令牌留在本机是更坏的结果）；
 *   · 而"服务器上那一枚还没撤成"这句实话**一定**要说，并留一个重试入口。
 * 只测其中一条，另一条就会在以后"为了修这条"被悄悄牺牲掉 ——
 * 而那两种症状在界面上都**不报错**。
 */

import { describe, expect, it, vi } from 'vitest';
import type { HostedAuthOutcome } from '@heyta/app-host';

import {
  hasSessionToRevoke,
  revocationStillPending,
  retryServerRevocation,
  signOutCurrentDevice,
} from '../src/auth/sign-out-flow';

type Outcome = HostedAuthOutcome<{ message: string }>;

const ok: Outcome = { ok: true, message: 'Logged out' };
const failed = (reason: string): Outcome => ({ ok: false, reason } as Outcome);

describe('退出登录：本机凭据一定清', () => {
  it('撤销成功 ⇒ 清一次，且不说"服务器上还有事没做完"', async () => {
    const clearLocal = vi.fn();
    const logout = vi.fn(async (): Promise<Outcome> => ok);
    const plan = await signOutCurrentDevice({
      options: { baseUrl: 'https://srv.test' },
      token: 't-1',
      clearLocal,
      logout,
    });
    expect(plan).toEqual({ clearLocalCredentials: true, serverRevocationPending: false });
    expect(clearLocal).toHaveBeenCalledTimes(1);
    expect(logout).toHaveBeenCalledTimes(1);
  });

  it('🔴 撤销**失败** ⇒ 照样清一次，并说出"服务器上那一枚还没撤成"', async () => {
    // 变异：把 `planSignOut` 之后那句 `deps.clearLocal()` 挪进 `if (outcome.ok)` 里
    // ⇒ 本条红。而那正是"因为网络没成，所以先不清凭据免得用户丢东西"那种
    //    听着稳妥、实际让设备继续以用户身份活着的错法。
    const clearLocal = vi.fn();
    const logout = vi.fn(async (): Promise<Outcome> => failed('network'));
    const plan = await signOutCurrentDevice({
      options: { baseUrl: 'https://srv.test' },
      token: 't-1',
      clearLocal,
      logout,
    });
    expect(clearLocal).toHaveBeenCalledTimes(1);
    expect(plan.serverRevocationPending).toBe(true);
    expect(plan.clearLocalCredentials).toBe(true);
  });

  it('连 `logout` 自己抛异常也清（异常不能变成"退出没发生"）', async () => {
    const clearLocal = vi.fn();
    const plan = await signOutCurrentDevice({
      options: { baseUrl: 'https://srv.test' },
      token: 't-1',
      clearLocal,
      logout: async () => {
        throw new Error('boom');
      },
    });
    expect(clearLocal).toHaveBeenCalledTimes(1);
    expect(plan.serverRevocationPending).toBe(true);
  });

  it('清本机发生在请求**之后**（不能让原生清理与在途请求抢同一份配置）', async () => {
    const order: string[] = [];
    await signOutCurrentDevice({
      options: { baseUrl: 'https://srv.test' },
      token: 't-1',
      clearLocal: () => {
        order.push('clear');
      },
      logout: async () => {
        order.push('logout');
        return ok;
      },
    });
    expect(order).toEqual(['logout', 'clear']);
  });

  it('没有会话时**一个请求都不发**，但仍然清一次、也不欠一句"还没撤成"', async () => {
    // 空令牌 / 空地址 ⇒ 服务端本来就没有可撤销的东西。
    // 把 `serverRevocationPending` 置成 true 会让界面挂着一句永久的谎，
    // 并给出一个永远不可能成功的重试按钮。
    const logout = vi.fn(async (): Promise<Outcome> => ok);
    const clearLocal = vi.fn();
    for (const [token, baseUrl] of [
      ['', 'https://srv.test'],
      ['t-1', ''],
      ['   ', 'https://srv.test'],
    ] as const) {
      const plan = await signOutCurrentDevice({ options: { baseUrl }, token, clearLocal, logout });
      expect(plan.serverRevocationPending).toBe(false);
    }
    expect(logout).not.toHaveBeenCalled();
    expect(clearLocal).toHaveBeenCalledTimes(3);
  });
});

describe('重试那一发', () => {
  it('只有"真的撤成了"或"服务端已经不认这枚令牌"才摘掉那句待撤销', () => {
    expect(revocationStillPending(ok)).toBe(false);
    // 🔴 `unauthorized` 的契约是"令牌/链接无效或已过期"。既然服务端已经不认它，
    //    它就不可能被拿来做任何事 —— 继续挂着那句话等于承诺一个不可能的动作。
    expect(revocationStillPending(failed('unauthorized'))).toBe(false);
    for (const reason of ['network', 'server-error', 'rate-limited', 'malformed-response', 'consent-required'] as const) {
      expect(revocationStillPending(failed(reason)), reason).toBe(true);
    }
  });

  it('重试**不再清本机**（早就清了），并且失败时把实话继续挂着', async () => {
    const clearLocal = vi.fn();
    await signOutCurrentDevice({
      options: { baseUrl: 'https://srv.test' },
      token: 't-1',
      clearLocal,
      logout: async () => failed('network'),
    });
    expect(clearLocal).toHaveBeenCalledTimes(1);

    const stillPending = await retryServerRevocation({
      options: { baseUrl: 'https://srv.test' },
      token: 't-1',
      logout: async () => failed('network'),
    });
    expect(stillPending).toBe(true);
    expect(clearLocal).toHaveBeenCalledTimes(1);
  });

  it('重试成功 ⇒ 那句待撤销可以摘掉', async () => {
    const stillPending = await retryServerRevocation({
      options: { baseUrl: 'https://srv.test' },
      token: 't-1',
      logout: async () => ok,
    });
    expect(stillPending).toBe(false);
  });

  it('重试时地址/令牌已经没了 ⇒ 判"仍然待撤销"，**不发请求**也不当成功', async () => {
    // 这一档不能反过来判成"已经撤了"：调用方是从**发起时捕获的那一份**三元组里重试的，
    // 它空了说明状态被弄丢了，那件事本身还没做完。
    const logout = vi.fn(async (): Promise<Outcome> => ok);
    expect(await retryServerRevocation({ options: { baseUrl: '' }, token: '', logout })).toBe(true);
    expect(logout).not.toHaveBeenCalled();
  });
});

describe('有没有值得发的那一发', () => {
  it('地址与令牌**同时**齐了才算有（与 `ready()` 那条既有纪律同形）', () => {
    expect(hasSessionToRevoke('t', 'https://a')).toBe(true);
    expect(hasSessionToRevoke('', 'https://a')).toBe(false);
    expect(hasSessionToRevoke('t', '  ')).toBe(false);
    expect(hasSessionToRevoke('t', 'not a url')).toBe(true);
    // ↑ 形状**不在这里判**：那是 `endpoint-url` 与 `classifyTransportSecurity` 的事，
    //   这里只判"有没有东西可发"。在这里再判一遍 URL 就是第二套裁决。
  });
});
