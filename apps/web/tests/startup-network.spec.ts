/**
 * 启动序列那三步：同意之前**一步都不许做**（G-12）
 * ================================================
 *
 * ## 为什么测的是这个闭包而不是 `main.tsx`
 *
 * `main.tsx` 是入口：它有顶层副作用、要 `#root`、会拉起 op-log 与 React，
 * 在 jsdom 里 import 它等于跑半个应用。所以那三步被抽成了
 * `features/privacy/startup-network.ts` 里一个**端口注入**的闭包，
 * 这里把三个端口换成计数器 —— 于是"注册 SW 被推迟到同意之后"这句话
 * 第一次变成了一条会失败的断言。
 *
 * 🔴 抽出去之前，这条纪律**完全没有判据**：任何人在 `main.tsx` 里把
 * `registerWidgetServiceWorker()` 搬回顶部，全仓没有任何一层会红，
 * 症状只是"同意前多发了一次请求"。那正是本仓库反复记过的
 * "看起来在保护一件事，其实保护的是另一件"。
 *
 * ## 四条各钉一件事
 *
 *   1. 闸门关闭 ⇒ **三个计数器全是 0**（SW 注册会向 `scope` 发一次请求，
 *      采用待消费的登录**本身就是一个请求**，实时通道是一条带令牌的 WS 握手）；
 *   2. 点了同意 ⇒ 三步**当场**补跑，不需要刷新（少了这条就是"这次好了下次又坏了"）；
 *   3. 已经同意过（冷启动那条路）⇒ 同一段代码一次跑齐 ——
 *      这条和上一条必须是**同一个函数**，否则"点同意"与"刷新"行为不同；
 *   4. 反复 `arm()` 时 SW 只注册一次（不可逆），而登录只采用一次、实时可以重建。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { HeldPendingLogin } from '../src/features/auth/pending-login.js';
import { createStartupNetwork } from '../src/features/privacy/startup-network.js';

const HELD = { kind: 'fragment' } as unknown as HeldPendingLogin;
const HELD_AGAIN = { kind: 'storage' } as unknown as HeldPendingLogin;

function setup(initialAllowed = false) {
  let allowed = initialAllowed;
  const calls = {
    registerServiceWorker: 0,
    askLegalRecheck: 0,
    startRealtime: 0,
    /** 调用顺序。G-27 要的判据不是"问没问"，而是**问在建连之前**（见文件头那条注释）。 */
    order: [] as string[],
    adopted: [] as HeldPendingLogin[],
  };
  const network = createStartupNetwork({
    networkAllowed: () => allowed,
    registerServiceWorker: () => {
      calls.registerServiceWorker += 1;
    },
    askLegalRecheck: () => {
      calls.askLegalRecheck += 1;
      calls.order.push('ask');
    },
    startRealtime: () => {
      calls.startRealtime += 1;
      calls.order.push('realtime');
    },
    adoptPendingLogin: (held) => {
      calls.adopted.push(held);
    },
  });
  return {
    network,
    calls,
    consent: () => {
      allowed = true;
    },
    block: () => {
      allowed = false;
    },
  };
}

describe('startup-network：三步都排在同意之后', () => {
  let f: ReturnType<typeof setup>;

  beforeEach(() => {
    f = setup(false);
    // 反证的前提要真的成立：闸门这里必须是关的。
    expect(f.calls.registerServiceWorker).toBe(0);
  });

  it('🔴 没同意 ⇒ 注册 SW / 采用登录 / 建实时连接**一次都没发生**', () => {
    f.network.hold(HELD);
    f.network.arm();

    expect(f.calls.registerServiceWorker, 'SW 注册会向 scope 发一次请求，同意前不许发').toBe(0);
    expect(f.calls.adopted, '采用待消费的登录**本身就是**一个请求').toEqual([]);
    expect(f.calls.startRealtime, '实时通道是带令牌的 WS 握手').toBe(0);
    // 🔴 G-27：那一步询问**本身也是一个请求**，所以它同样在射程里。
    expect(f.calls.askLegalRecheck, '"这个账号要不要补签"这一问也是出站请求').toBe(0);
  });

  it('🔴 问补签必须排在**建实时连接之前**（顺序反了 = 冷启动先把数据推出去）', () => {
    // 变异：把 `arm()` 里那两行换个顺序 ⇒ 这一条红。
    // 红的是"闸门在拿到答案前是拦的，但连接已经建起来了"这一整类启动竞态。
    f.network.hold(null);
    f.consent();
    f.network.arm();
    expect(f.calls.order).toEqual(['ask', 'realtime']);
  });

  it('每次 arm 都重问一次（与实时通道同理：换令牌之后旧答案不作数）', () => {
    f.consent();
    f.network.arm();
    f.network.arm();
    expect(f.calls.askLegalRecheck).toBe(2);
    expect(f.calls.order).toEqual(['ask', 'realtime', 'ask', 'realtime']);
  });

  it('撤回同意之后再 arm：不许问（那一问本身就是被撤回的那类请求）', () => {
    f.consent();
    f.network.arm();
    f.block();
    f.network.arm();
    expect(f.calls.askLegalRecheck, '闸门关了还发询问').toBe(1);
    expect(f.calls.startRealtime).toBe(1);
  });

  it('🔴 点了「同意」当场补跑三步，不需要刷新', () => {
    f.network.hold(HELD);
    f.network.arm();
    f.consent();
    // 面板不是唯一能改变决定的地方，所以这里模拟订阅者再 arm 一次（真实接线在 main.tsx）。
    f.network.arm();

    expect(f.calls.registerServiceWorker).toBe(1);
    expect(f.calls.adopted).toEqual([HELD]);
    expect(f.calls.startRealtime).toBe(1);
  });

  it('🔴 已经同意过（冷启动那条路）走的是**同一个函数**，一次跑齐', () => {
    const warm = setup(true);
    warm.network.hold(HELD);
    warm.network.arm();

    expect(warm.calls.registerServiceWorker).toBe(1);
    expect(warm.calls.adopted).toEqual([HELD]);
    expect(warm.calls.startRealtime).toBe(1);
  });

  it('🔴 反复 arm：SW 只注册一次（不可逆），登录只采用一次，实时每次都重建', () => {
    f.network.hold(HELD);
    f.consent();
    f.network.arm();
    f.network.arm();
    f.network.arm();

    expect(f.calls.registerServiceWorker, 'SW 被注册了多次').toBe(1);
    expect(f.calls.adopted, '同一枚登录被采用了多次').toEqual([HELD]);
    // 令牌可能已经换过 —— 实时通道**该**重建（见 store.ts 的 restartRealtime）。
    expect(f.calls.startRealtime).toBe(3);
  });

  it('没有待消费的登录时 arm() 也要照常注册 SW 并连实时（不能被那一步挡住）', () => {
    f.network.hold(null);
    f.consent();
    f.network.arm();

    expect(f.calls.adopted).toEqual([]);
    expect(f.calls.registerServiceWorker).toBe(1);
    expect(f.calls.startRealtime).toBe(1);
  });

  it('🔴 被拦下时那枚登录必须**留着**：同意后要采用到它，而不是悄悄丢掉一次登录', () => {
    f.network.hold(HELD);
    f.network.arm();
    expect(f.calls.adopted).toEqual([]);

    f.consent();
    f.network.arm();
    expect(f.calls.adopted, '拦下时把登录丢了 —— 用户点了同意仍然未登录').toEqual([HELD]);

    // 采用之后要**清空**，否则下一次 arm（比如换了令牌）会把同一枚一次性凭据再花一次。
    f.network.arm();
    expect(f.calls.adopted).toEqual([HELD]);
  });

  it('撤回之后再次 arm：不重新注册 SW，但也不再建实时连接', () => {
    f.network.hold(HELD);
    f.consent();
    f.network.arm();
    f.block();
    f.network.arm();

    expect(f.calls.registerServiceWorker).toBe(1);
    expect(f.calls.startRealtime, '闸门关闭后 arm() 又建了一条连接').toBe(1);
    // 撤回时把一枚新收下的登录放进去，它必须**不被采用**。
    f.network.hold(HELD_AGAIN);
    f.network.arm();
    expect(f.calls.adopted).toEqual([HELD]);
  });

  it('🔴 端口里的 `networkAllowed` 必须是**活取值**，不是启动时的一次快照', () => {
    // 变异：把 createStartupNetwork 内部改成"构造时读一次 allowed 并存成常量"，
    // 这一条会红 —— 而那正是一切"点了同意但没生效"的根形状。
    f.network.arm();
    expect(f.calls.registerServiceWorker).toBe(0);
    f.consent();
    f.network.arm();
    expect(f.calls.registerServiceWorker).toBe(1);
  });

  it('🔴 `arm()` 里没有 try/catch，是因为三个端口按契约都不抛 —— 抛了要响', () => {
    // `registerWidgetServiceWorker()`（`src/pwa/register.ts`）把注册挂在 `load` 监听里
    // 并 `.catch()` 掉失败，环境不支持时**早退**；`releasePendingLogin` 是 async；
    // `startRealtime` 的失败走 store 自己的结构化原因。
    // 所以这里**故意**不兜异常：在这里加 try/catch 等于把"某个端口坏了"
    // 变成静默降级（本仓库反复记过的那一类）。
    // 这条用例钉的是**形状**：某个端口当场抛错时，异常必须原样冒出来。
    const calls = vi.fn();
    const asked = vi.fn();
    const throwing = createStartupNetwork({
      networkAllowed: () => true,
      registerServiceWorker: () => {
        throw new Error('端口违约：这个函数按契约不抛');
      },
      askLegalRecheck: asked,
      startRealtime: calls,
      adoptPendingLogin: () => undefined,
    });
    expect(() => throwing.arm()).toThrow('端口违约');
    expect(calls).not.toHaveBeenCalled();
    // 排在 `startRealtime` 之前的那一步也一样不许跑（异常之后的端口都不该被叫到，
    // 否则"闸门置成 checking 却没人回答"这种半截状态会被留在进程里）。
    expect(asked).not.toHaveBeenCalled();
  });
});
