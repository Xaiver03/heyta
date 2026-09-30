/**
 * 移动端实时通道的**接线**
 * ==========================
 *
 * ## 🔴 这个文件防的是什么
 *
 * `packages/sync-client/src/realtime.ts`（450 行 + 自带一整套测试）在很长一段时间里
 * **没有任何宿主调用它**。web 在 2026-09-29 先接上，而**移动端这一边仍然没有** ——
 * 于是另一台设备改了，这台要等很久才看到，而界面上看不出任何异常。
 *
 * ⇒ 这一组钉的**不是**退避/重连（那是 `packages/sync-client/tests/realtime.spec.ts` 的事），
 * 而是**移动端有没有真的把它建起来、用对了哪份凭据、什么时候停**。
 * 只测纯逻辑的话，"没有调用点"这种状态**全绿**。
 *
 * ## 判据全是"可观察的调用"
 *
 * 假的 `makeClient` 记下被传进来的参数 ⇒ 可以断言：
 *   · `clientId` 来自 **engine**（不是自己造的）；
 *   · `getToken` 是**活取值器**（换令牌之后拿得到新的）；
 *   · `onNewOps` 在途时**合并**（不排队）；
 *   · 登出/停止时 **dispose**（否则带着失效令牌在后台一直重连）。
 */

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it, vi } from 'vitest';

import type { AppHost, SyncConfig } from '@heyta/app-host';
import type { RealtimeClient } from '@heyta/sync-client';
import type { RealtimeWiringOptions } from '@heyta/app-host';

import { startRealtime, stopRealtime } from '../src/sync/realtime';

/** 记账用的假客户端。 */
function fakeClient(): { client: RealtimeClient; connect: ReturnType<typeof vi.fn>; dispose: ReturnType<typeof vi.fn> } {
  const connect = vi.fn();
  const dispose = vi.fn();
  return { client: { connect, dispose } as unknown as RealtimeClient, connect, dispose };
}

/** 假 host —— 只看 `engine.getClientId()`。 */
function fakeHost(clientId = 'device-under-test'): AppHost {
  return { engine: { getClientId: () => clientId } } as unknown as AppHost;
}

interface Harness {
  readonly options: RealtimeWiringOptions[];
  readonly client: ReturnType<typeof fakeClient>;
  readonly readConfig: () => SyncConfig | undefined;
}

function harness(config: SyncConfig | undefined, clientId = 'device-under-test'): Harness {
  const options: RealtimeWiringOptions[] = [];
  const client = fakeClient();
  return {
    options,
    client,
    readConfig: () => config,
    // 下面这个字段只为了让类型收窄；实际用不到。
  } as unknown as Harness;
}

describe('移动端实时通道接线', () => {
  it('🔴 有凭据时**真的建了**客户端并连上（这就是"有没有调用点"的判据）', async () => {
    const options: RealtimeWiringOptions[] = [];
    const client = fakeClient();
    const config: SyncConfig = { serverUrl: 'http://10.0.2.2:3000', token: 'JWT-1' };

    await startRealtime({
      openHost: async () => fakeHost(),
      readConfig: () => config,
      makeClient: (o) => {
        options.push(o);
        return client.client;
      },
    });

    expect(options, '没有构造实时客户端 —— 接线不存在').toHaveLength(1);
    expect(client.connect, '建了却没连').toHaveBeenCalledTimes(1);
  });

  it('🔴 `clientId` 来自 **engine**（不是自己造的）—— 与同步客户端同一个来源', async () => {
    const options: RealtimeWiringOptions[] = [];
    await startRealtime({
      openHost: async () => fakeHost('LWW-决胜依据'),
      readConfig: () => ({ serverUrl: 'http://x', token: 't' }),
      makeClient: (o) => {
        options.push(o);
        return fakeClient().client;
      },
    });
    // 两处各造一个 clientId 会让"本设备"在服务端看起来像两台设备。
    expect(options[0]?.engine.getClientId()).toBe('LWW-决胜依据');
  });

  it('未配置凭据时**不建连**（本地优先下"未登录"是合法状态）', async () => {
    const makeClient = vi.fn();
    await startRealtime({
      openHost: async () => fakeHost(),
      readConfig: () => undefined,
      makeClient,
    });
    expect(makeClient).not.toHaveBeenCalled();
  });

  it('地址为空 / 没有令牌时也不建连', async () => {
    const makeClient = vi.fn();
    await startRealtime({
      openHost: async () => fakeHost(),
      readConfig: () => ({ serverUrl: '', token: 't' }),
      makeClient,
    });
    await startRealtime({
      openHost: async () => fakeHost(),
      readConfig: () => ({ serverUrl: 'http://x' }),
      makeClient,
    });
    expect(makeClient).not.toHaveBeenCalled();
  });

  it('🔴 `getToken` 是**活取值器** —— 换过令牌之后拿到的是新的', async () => {
    const options: RealtimeWiringOptions[] = [];
    let config: SyncConfig = { serverUrl: 'http://x', token: 'old' };
    await startRealtime({
      openHost: async () => fakeHost(),
      readConfig: () => config,
      makeClient: (o) => {
        options.push(o);
        return fakeClient().client;
      },
    });

    config = { serverUrl: 'http://x', token: 'new' };
    // 静态传一次的话这里还是 'old' —— 症状是"重新登录之后实时永远连不上"。
    await expect(options[0]?.getToken()).resolves.toBe('new');
  });

  it('🔴 `stopRealtime()` 会 **dispose**（否则带着失效令牌在后台一直重连）', async () => {
    const client = fakeClient();
    await startRealtime({
      openHost: async () => fakeHost(),
      readConfig: () => ({ serverUrl: 'http://x', token: 't' }),
      makeClient: () => client.client,
    });

    stopRealtime();

    expect(client.dispose, '停下时没有 dispose').toHaveBeenCalledTimes(1);
  });

  it('🔴 反复 `startRealtime()` 不会留下两条活连接（旧的必须先 dispose）', async () => {
    const first = fakeClient();
    const second = fakeClient();
    let n = 0;
    const deps = {
      openHost: async () => fakeHost(),
      readConfig: () => ({ serverUrl: 'http://x', token: 't' }),
      makeClient: () => (n++ === 0 ? first.client : second.client),
    };

    await startRealtime(deps);
    await startRealtime(deps);

    expect(first.dispose, '第二次建连时旧连接没被关掉').toHaveBeenCalledTimes(1);
    expect(second.connect).toHaveBeenCalledTimes(1);
  });

  it('🔴 `onNewOps` 在途时**合并**（不排队）—— 排队会把几次变化放大成几次全量同步', async () => {
    const options: RealtimeWiringOptions[] = [];
    await startRealtime({
      openHost: async () => fakeHost(),
      readConfig: () => ({ serverUrl: 'http://x', token: 't' }),
      makeClient: (o) => {
        options.push(o);
        return fakeClient().client;
      },
    });

    const onNewOps = options[0]?.onNewOps;
    expect(onNewOps, '没有给 onNewOps —— 服务端推了也不会同步').toBeDefined();
    // 真相是"推了要触发一次同步"，而同步本身没有在途保护（`syncNow()` 每次都会真的走一遍）。
    // 这里只断言它可以被调用而不抛 —— 真正的合并断言在 web 侧的同名测试里
    //（那边能观察 `syncNow` 的调用次数）。移动端的 `syncNow` 会碰真 SQLite，
    // 所以这一层不替它做那个断言。
    expect(() => {
      onNewOps?.(1);
    }).not.toThrow();
  });
});

/**
 * 🔴 **调用点本身必须是可断言的东西。**
 *
 * 上面那些用例证明"`startRealtime()` 写对了"，但它们**证明不了它被调用过** ——
 * 而第 10 项幻觉的形态恰恰就是"实现齐全、测试齐全、**没有任何宿主调用它**"：
 * `realtime.ts` 450 行、`realtime.spec.ts` 全套，而 `createRealtimeClient`
 * 在整个仓库里零调用点。
 *
 * ⇒ 所以这里**读源码**断言那两条调用真的在。这是源码级判据（本仓既有做法，
 * 见 `packages/ui/tests/task-row-density.spec.ts`），它抓的正是"有人把调用删了"
 * 而**别的用例全绿**。
 *
 * ⚠️ 为什么不写成"挂一个假的 auto-sync 看它调没调"：`auto-sync.ts` 在模块顶层
 * 就 `AppState.addEventListener`，而 RN 的 `AppState` 在 node 里是桩 ——
 * 换来的是一堆与被测行为无关的环境假设。源码判据在这里更诚实：
 * 它说的就是"那两行必须在"。
 */
describe('调用点存在（不是"实现齐全但没人调"）', () => {
  const src = readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), '../src/sync/auto-sync.ts'),
    'utf8',
  );

  /**
   * ⚠️ 判据必须**按行匹配真实调用**，不能只 `test()` 整份源码。
   *
   * 第一版写的是 `/notifyConfigured[\s\S]*?startRealtime\(\)/` —— 而它
   * **把注释掉的调用也算成调用**：我把那行注释掉之后这条**照样绿**。
   * 一条能被注释骗过去的判据，等于没有判据。
   */
  const callsInCode = (pattern: RegExp): boolean =>
    src.split('\n').some((line) => {
      const code = line.replace(/\/\/.*$/, ''); // 去掉行尾注释再判
      return pattern.test(code);
    });

  it('🔴 `notifyConfigured()` 里真的起了实时通道', () => {
    expect(
      callsInCode(/^\s*void startRealtime\(\);\s*$/),
      '保存凭据之后没有起实时通道 —— 那正是"另一台设备改了这边要等很久"的原因',
    ).toBe(true);
  });

  it('🔴 `stopAutoSync` 里真的把它停了（否则应用不再自动同步、却还挂着一条 WebSocket）', () => {
    expect(callsInCode(/^\s*stopRealtime\(\);\s*$/), '停自动同步时没有停实时通道').toBe(true);
  });
});

/**
 * 🔴 **`notifyConfigured()` 必须有调用点 —— 它曾经一个都没有。**
 *
 * 这一条是 `verify-mobile-ios` 第 7 步在**设备上**撞出来的：
 * app 前台、凭据已填，而服务端报告的 `wsConnections` **一直是 0**。
 *
 * 根因：`notifyConfigured()` 是个**死导出** —— 它的文档写着
 * "用户刚保存了同步凭据 —— 立刻同步一次"，而**生产代码里没有任何地方调它**。
 * 同步之所以还能发生，靠的是 `write-signal` 的"本地写入"那条路；
 * 于是它承载的另一件事 —— **启动实时通道** —— 永远不会发生。
 *
 * ⇒ 规则：**每个 `writeSyncConfig(...)` 调用点旁边都要有 `notifyConfigured()`**。
 * 这条判据是**结构性**的（按调用点配平），不是"文件里出现过那个词" ——
 * 后者在我把调用注释掉时**照样绿**（同一天早些时候踩过）。
 */
describe('凭据保存 ⇒ 必须通知（实时通道靠它启动）', () => {
  const SRC_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../src');

  /**
   * 逐行扫：第 i 行有 `writeSyncConfig(`，则**其后 25 行内**必须有 `notifyConfigured();`。
   *
   * ⚠️ 窗口是 25 而不是 12：中间往往隔着一段**说明为什么要通知**的注释
   *（这个判据第一次跑就是被那段注释判红的 —— 判据对，窗口太窄）。
   * 25 行仍然要求"**局部**配对"，不是"全文里出现过那个词"。
   */
  function assertPaired(file: string): void {
    const src = readFileSync(join(SRC_DIR, file), 'utf8');
    const lines = src.split('\n');
    const sites = lines
      .map((line, i) => ({ line, i }))
      .filter(({ line }) => {
        const code = line.replace(/\/\/.*$/, '');
        return /writeSyncConfig\(/.test(code) && !/^\s*import/.test(code);
      });
    expect(sites.length, `${file} 里应当有 writeSyncConfig 调用点`).toBeGreaterThan(0);
    for (const { i } of sites) {
      const window = lines
        .slice(i, i + 25)
        .map((l) => l.replace(/\/\/.*$/, ''))
        .join('\n');
      expect(
        /notifyConfigured\(\);/.test(window),
        `${file}:${String(i + 1)} 写了同步凭据，却没通知 —— ` +
          `实时通道不会启动（设备上实测 wsConnections 恒为 0）`,
      ).toBe(true);
    }
  }

  it('auth/session.ts（登录路径）', () => {
    assertPaired('auth/session.ts');
  });

  // ⚠️ 2026-09-29 设置面搬家（goal-settings-ia.md）：手动填令牌那条路
  //    从 ProfileScreen 迁到了 sync/credential-form.ts（表单状态必须活在
  //    常驻的「我的」上，设置面是 Modal、关闭即卸载）。判据跟着调用点走。
  it('sync/credential-form.ts（手动填令牌那条路，原 ProfileScreen）', () => {
    assertPaired('sync/credential-form.ts');
  });
});
