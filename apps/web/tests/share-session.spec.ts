/**
 * `share-session.ts` 的生命周期判据：这台浏览器会话里**只有一份**共享实例，
 * 而且换人/离场时那一份**已解密**的缓存不会留下。
 * ============================================================
 *
 * 这一枚为什么值得单独存在：M2 之后同一份缓存既是"界面读的合并视图"的数据源，
 * 又是"写路由问的 `stateFor`"。两处各建一份 ⇒ 两个答案（一处拉到、一处看不见），
 * 症状与 M2 之前那一格一模一样：别人的改动不出现、而且不报错。
 *
 * | 判据 | 坏法（症状） |
 * |---|---|
 * | 多处来问 ⇒ `createWebShareComments` 只被调一次 | 各建一份 ⇒ 拉回来的内容落进 A 那份缓存，界面读的是 B 那份 |
 * | 同一刻并发问也只建一份 | 两次 await 各建一份 ⇒ 后建的覆盖接线，前一份的写入进了没人读的对象 |
 * | 没登录 / 没配服务端 ⇒ 零构造、零 vault 调用 | 造一个"假装能用"的对象 ⇒ 用户点发送之后才失败，还说不清为什么 |
 * | 换账号 ⇒ **先摘后建**（顺序可判） | 先建后摘 ⇒ 那几毫秒里合并视图把上一个人的共享任务并进这个人的界面 |
 * | 令牌轮换 ⇒ 重建 | 实例里 capture 的是当时那枚 token ⇒ 之后的共享写一直带着过期令牌 |
 * | `resetWebShareSession()` ⇒ 摘掉并重问 | 只摘不重问 ⇒ 本机**别的**共享清单内容一并消失，直到有人恰好再问 |
 *
 * ⚠️ 每段用例都从"已退出登录"开始：登录态一变，`arm` 那条订阅会自己去建 ——
 *    不清这个基线的话 `built` 的数会带上订阅那一脚，判据就变成在数调度顺序。
 *
 * 变异验证（一次性臂，2026-10-22 实测后已还原，还原只从 `.mut-bak` 取并 `diff -q` 确认）：
 * ① 摘掉"先摘后建"那一句 ⇒ 恰好 1 枚具名红（换账号的顺序判据）；
 * ② 摘掉 `ensure()` 的在途并轨 ⇒ 6 枚具名红 —— 比预期宽，如实记下：没有并轨时
 *    订阅那一脚与用例里那一脚**并发跑到同一个 depKey 检查**，于是每次都多建一份，
 *    所有"只建一份/建了几份"的判据一起红。这正说明那一行守的不只是并发调用；
 * ③ 让 `currentDepKey()` 不读 token ⇒ 恰好 1 枚具名红（令牌轮换不重建）；
 * ④ `resetWebShareSession()` 只摘不重问 ⇒ 恰好 1 枚具名红（别的共享一直看不见）。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const rig = vi.hoisted(() => ({
  built: 0,
  vaultCalls: 0,
  /** 接线模块被调的顺序：`attach` / `detach` 必须排得出先后，不只是"都发生过"。 */
  wiring: [] as ('attach' | 'detach')[],
  vaultLocks: false,
}));

vi.mock('../src/features/share/comment-actions.js', () => ({
  createWebShareComments: () => {
    rig.built += 1;
    return {
      actions: {},
      channel: { dispatch: async () => undefined, stateFor: () => ({}) },
      commentsForTask: () => [],
      pullForTask: async () => undefined,
      pullShareOps: async () => ({ fetched: 0, added: 0, cursor: 0, pages: 1 }),
    };
  },
}));

vi.mock('../src/lib/vault-session.js', () => ({
  getWebVaultSession: async () => {
    rig.vaultCalls += 1;
    if (rig.vaultLocks) throw new Error('vault locked');
    return { getPayloadCipher: async () => ({ fake: 'cipher' }) };
  },
}));

vi.mock('../src/lib/oplog.js', () => ({
  hasEngine: () => true,
  requireEngine: () => ({ getClientId: () => 'device-web-test' }),
  attachShareWiring: (wiring: unknown) => {
    rig.wiring.push(wiring === undefined ? 'detach' : 'attach');
  },
}));

import { armWebShareSession, ensureWebShareSession, resetWebShareSession, webShareSession } from '../src/features/share/share-session.js';
import { useSyncStore } from '../src/features/sync/store.js';

function login(accountId: string, token: string): void {
  useSyncStore.setState({ accountId, baseUrl: 'https://srv.example', token, authTransport: 'bearer' });
}

function signOut(): void {
  useSyncStore.setState({ accountId: undefined, token: '', baseUrl: '' });
}

beforeEach(() => {
  rig.built = 0;
  rig.vaultCalls = 0;
  rig.wiring.length = 0;
  rig.vaultLocks = false;
  signOut();
  armWebShareSession();
  rig.built = 0;
  rig.vaultCalls = 0;
  rig.wiring.length = 0;
});

describe('一台会话里只有一份共享实例', () => {
  it('先后问两次 ⇒ 只构造一次，第二次拿到的是同一对象', async () => {
    login('acct-1', 'tok-1');
    const first = await ensureWebShareSession();
    const second = await ensureWebShareSession();
    expect(first).toBeDefined();
    expect(rig.built).toBe(1);
    expect(second).toBe(first);
  });

  it('同一刻并发问 ⇒ 仍只构造一次（两脚并轨，不是各建一份）', async () => {
    login('acct-1', 'tok-1');
    const [a, b] = await Promise.all([ensureWebShareSession(), ensureWebShareSession()]);
    expect(rig.built).toBe(1);
    expect(a).toBe(b);
  });

  it('同步读只拿已经建好的那一份，不自己建', async () => {
    login('acct-1', 'tok-1');
    expect(webShareSession()).toBeUndefined();
    await ensureWebShareSession();
    expect(webShareSession()).toBeDefined();
    expect(rig.built).toBe(1);
  });
});

describe('这一刻接不上 ⇒ 什么都不造', () => {
  it('没登录 ⇒ 零构造、零 vault 调用', async () => {
    expect(await ensureWebShareSession()).toBeUndefined();
    expect(rig.built).toBe(0);
    expect(rig.vaultCalls).toBe(0);
  });

  it('服务端地址为空 ⇒ 已有实例要摘掉，也不拿旧地址继续用', async () => {
    login('acct-1', 'tok-1');
    await ensureWebShareSession();
    expect(webShareSession()).toBeDefined();
    useSyncStore.setState({ baseUrl: '' });
    expect(await ensureWebShareSession()).toBeUndefined();
    expect(webShareSession()).toBeUndefined();
  });

  it('vault 没解锁 ⇒ 不构造；也不把这一次失败记成"已经试过"（解锁后下一次问就建得出来）', async () => {
    rig.vaultLocks = true;
    login('acct-1', 'tok-1');
    expect(await ensureWebShareSession()).toBeUndefined();
    expect(rig.built).toBe(0);
    rig.vaultLocks = false;
    expect(await ensureWebShareSession()).toBeDefined();
    expect(rig.built).toBe(1);
  });
});

describe('换人、换令牌、离场', () => {
  it('换账号 ⇒ 旧接线先摘、新实例后建（判的是顺序，不是"都发生过"）', async () => {
    login('acct-1', 'tok-1');
    await ensureWebShareSession();
    rig.wiring.length = 0;
    login('acct-2', 'tok-2');
    await ensureWebShareSession();
    expect(rig.wiring).toEqual(['detach', 'attach']);
    expect(rig.built).toBe(2);
  });

  it('同一账号的令牌轮换 ⇒ 重建（实例 capture 的是当时那一枚 token）', async () => {
    login('acct-1', 'tok-1');
    await ensureWebShareSession();
    login('acct-1', 'tok-rotated');
    await ensureWebShareSession();
    expect(rig.built).toBe(2);
  });

  it('`resetWebShareSession()` ⇒ 摘掉后自己重问，本机别的共享不至于一直看不见', async () => {
    login('acct-1', 'tok-1');
    await ensureWebShareSession();
    rig.wiring.length = 0;
    resetWebShareSession();
    expect(rig.wiring[0]).toBe('detach');
    await vi.waitFor(() => expect(rig.built).toBe(2));
    expect(webShareSession()).toBeDefined();
  });
});
