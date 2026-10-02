/**
 * 移动端的**实时通道**接线
 * ==========================
 *
 * ## 🔴 它补的是什么
 *
 * `packages/sync-client/src/realtime.ts`（450 行：指数退避 + 抖动 + 上限 +
 * 令牌活取值，**自带一整套测试**）在很长一段时间里**没有任何宿主调用它**。
 * 2026-09-29 web 先接上；移动端这一边在此之前仍然只靠"前台 + 本地写入去抖"
 * 触发同步 —— 于是**另一台设备改了，这台要等很久才看到**，
 * 而界面上看不出任何异常（同步状态还是"已同步"）。
 *
 * ## 复用，不重写
 *
 * 客户端来自 `@heyta/app-host` 的 `createHostRealtimeClient` ——
 * 与 web 是**同一条**接线，`clientId` 也从**同一个** `engine.getClientId()` 来。
 * 那个文件头写着"接线只有一份，两套一定会漂移，只是时间问题"，
 * 实时通道没有理由例外。
 *
 * ## 与 `auto-sync` 的分工
 *
 * | | 触发时机 | 谁负责 |
 * |---|---|---|
 * | 自动同步 | 前台 / 本地写入去抖 / 回到前台 | `auto-sync.ts` |
 * | **实时通道** | 服务端说"有新 op" | 本文件 |
 *
 * 两者最终都调 `syncNow()`，而**并发由 `store.ts` 的 `busy` 挡住** ——
 * 所以这里不需要再排一次队（多一层队列只会让"为什么没同步"更难查）。
 *
 * ## ⚠️ 凭据是**内存态**，所以只可能在 `notifyConfigured()` 那条路上起来
 *
 * 移动端的同步凭据刻意不落盘（见 `sync/config.ts` 文件头：E2EE 口令落盘就等于
 * 把"服务端看不到明文"作废）。⇒ 冷启动时 `readSyncConfig()` 必然是 `undefined`，
 * 实时通道**起来不了**，要等用户填完凭据。这不是缺陷，是那条取舍的直接后果。
 */

import type { AppHost, SyncConfig } from '@heyta/app-host';
import type { RealtimeClient } from '@heyta/sync-client';

import { createHostRealtimeClient, type RealtimeWiringOptions } from '@heyta/app-host';

import { readSyncConfig } from './config';
import { privacyConsent } from '../privacy/consent-gate';
import { legalRecheck } from '../legal-recheck/gate';

/**
 * 可注入的依赖 —— **测试用假实现，生产调用点一个都不传**。
 *
 * 🔴 为什么这么写而不是 `vi.mock('../db/open-host')`：本仓的既有做法是
 * **依赖注入**（见 `tests/credential-wipe.spec.ts`）—— 模块级 mock 会连带
 * 影响同进程里别的用例，而"某个用例把 open-host 换掉了"引发的红
 * 指向的是 mock，不是被测的东西。
 *
 * ⚠️ 这一层**必须可测**：第 10 项幻觉的形态正是"纯函数写好了、
 * 测试齐全，而**没有任何调用点**"。只测纯逻辑的话那种状态**全绿**。
 */
export interface RealtimeDeps {
  openHost: () => Promise<AppHost>;
  readConfig: () => SyncConfig | undefined;
  makeClient: (options: RealtimeWiringOptions) => RealtimeClient;
  syncNow: () => Promise<unknown>;
  /**
   * 🔴 同意闸门（计划 **G-12**）。默认取进程里那一个闸门实例。
   *
   * 为什么把它做成**可注入的依赖**而不是在函数里直接读闸门：
   * 本文件的既有纪律是"测试用假实现、生产调用点一个都不传"（见上面那段），
   * 而"没同意时不建连"这条判据必须能在**没有 React、没有原生模块**的
   * 纯 node 进程里被验证 —— 直接读闸门就等于要求每个跑这条用例的人
   * 先有一套能打开 op-sqlite 的运行时。
   */
  networkAllowed: () => boolean;
  /**
   * 🔴 账号级补签闸门（计划 **G-27**）：这个账号同意的还是不是现在那一版文本。
   *
   * 为什么**两道**都要判，而不是把"没补签"并进 `networkAllowed` 里：
   * 两条问的不是同一件事（这台设备准不准对外说话 / 这个账号签的是哪一版），
   * 合成一个布尔就丢掉"设备同意了、账号要补签"这个真实存在的状态
   * （`packages/app-host/src/legal-recheck.ts` 文件头那张对照表）。
   *
   * 与 `networkAllowed` 同样的理由做成**可注入依赖**：这条判据必须能在
   * 没有 React、没有原生模块的纯 node 进程里被验证。
   */
  dataEgressAllowed: () => boolean;
}

/**
 * 🔴 默认实现走**动态 `import()`**，不是顶部的静态 import。
 *
 * 理由很具体：`../db/open-host` 会拖进 `@op-engineering/op-sqlite`
 *（原生模块）。静态 import 的话，**任何**想加载本模块的东西
 *（包括只测接线、根本不碰数据库的用例）都要先有一个原生运行时 ——
 * 实测症状是 `Cannot find module '…/op-sqlite/node/dist/database'`，
 * 而那条报错指向的是 op-sqlite，**不是被测的东西**。
 *
 * ⚠️ 这不是"为了测试而改生产代码"：真正被推迟的只是**加载时机**，
 * 而这两件事本来就只在真的要用（建连 / 收推送）时才发生。
 */
function resolveDeps(over: Partial<RealtimeDeps>): RealtimeDeps {
  return {
    openHost:
      over.openHost ??
      (async () => {
        const { openTaskHost } = await import('../db/open-host');
        return openTaskHost();
      }),
    readConfig: over.readConfig ?? readSyncConfig,
    makeClient: over.makeClient ?? createHostRealtimeClient,
    /**
     * 默认取**进程里那一道闸**（不是"同意与否的一个影子"）。
     *
     * ⚠️ 这里必须是**取值器**而不是快照：闸门会在会话中途被改变
     * （首启面板点「同意」、设置页「撤回」），传死值的那一份
     * 在第一次建连之后就再也不反映真实决定了 —— 与下面 `getToken` 同一条理由。
     */
    networkAllowed: over.networkAllowed ?? (() => privacyConsent.networkAllowed()),
    /**
     * 同样必须是**取值器**：补签状态会在会话中途变（问回来了、用户确认了、登出了），
     * 传死值的那一份在第一次建连之后就再也不反映真实裁决。
     */
    dataEgressAllowed: over.dataEgressAllowed ?? (() => legalRecheck.dataEgressAllowed()),
    syncNow:
      over.syncNow ??
      (async () => {
        const { syncNow } = await import('./store');
        return syncNow();
      }),
  };
}

let client: RealtimeClient | undefined;

/**
 * 正在同步标记。
 *
 * 🔴 `syncNow()` **没有**在途保护（它每次都会真的走一遍），而服务端可能连续推。
 * 所以在途时**直接丢掉这一次信号**而不是排队 —— 下一次推送会把状态带过来，
 * 排队只会把"几次变化"放大成"几次全量同步"。（与 web 侧同一处理。）
 */
let inFlight = false;

/** 停掉当前通道。**幂等**。 */
export function stopRealtime(): void {
  // `dispose()` 之后那个客户端**绝不再连**（realtime.ts 的既定语义），直接丢掉。
  client?.dispose();
  client = undefined;
}

/**
 * 按**当前**凭据重建并连接。**幂等**（每次都先停旧的）。
 *
 * ⚠️ `engine` 要 `await openTaskHost()` —— 所以它是异步的。
 * `notifyConfigured()` 是同步的，那边 `void startRealtime()` 即可：
 * 起不来的后果只是"暂时还是靠轮询同步"，不是功能坏掉。
 *
 * 🔴 **永不抛**：实时通道是**增强**（没有它同步照样会在前台/写入时发生），
 * 而它的调用点是"用户刚保存了凭据" —— 让一次连接问题把那个动作搞挂，
 * 是明确的错误优先级。
 */
export async function startRealtime(over: Partial<RealtimeDeps> = {}): Promise<void> {
  const deps = resolveDeps(over);
  stopRealtime();

  /**
   * 🔴 **没同意就不建连**（计划 **G-12**）。
   *
   * 位置在 `stopRealtime()` **之后**是刻意的：这个方法同时也是"撤回之后重建"的
   * 入口，先停旧的再判闸门，才能保证"调用过一次 startRealtime 之后
   * 手上没有连接"。放在前面会让撤回时留下一条带着旧令牌的 WebSocket，
   * 而界面上写着「已撤回」—— 那是两个方向都错的一种写法。
   *
   * ⚠️ 这条不是多余的：`WebSocket` **不走** `globalThis.fetch`，
   * 所以进程级那道 `consentFetch` 挡不住它。移动端没有实时通道的那个洞
   * 只能在这里补。
   */
  if (!deps.networkAllowed()) return;

  /**
   * 🔴 **账号没补签就不建连**（计划 **G-27**），排在 `networkAllowed` **之后**：
   * 设备级同意是更前置的事实（没同意时连"要不要补签"都问不出去）。
   *
   * WS 本身只传"有新 op 了"的信号、不传内容，但那个信号会触发 `syncNow()` ——
   * 而它会被 `reconfirmGate()` 拦下。留一条"连着但每次都不干活"的通道比不建更坏：
   * 界面上写着"实时同步已开启"，而每一次推送都静默地什么也不发生。
   * 补签完成后 `sync/auto-sync.ts` 里那个闸门订阅者会按新状态重建。
   */
  if (!deps.dataEgressAllowed()) return;

  const config = deps.readConfig();
  const token = config?.token;
  if (config === undefined || config.serverUrl === '' || token === undefined) return;

  try {
    // 🔴 必须等 `openTaskHost()` 走完 `recover()` 之后再建连 ——
    // 同一个理由在任务屏、日历屏都写着（AGENTS.md §7 第 9 条）。
    const host = await deps.openHost();

    client = deps.makeClient({
      engine: host.engine,
      baseUrl: config.serverUrl,
      // 🔴 **活取值器**：令牌可能在会话中途被换掉（重新登录），
      // 而静态传一次的结果是"换过令牌之后实时永远连不上"。
      getToken: async () => deps.readConfig()?.token,
      onNewOps: () => {
        if (inFlight) return;
        inFlight = true;
        void deps
          .syncNow()
          .catch(() => {
            // `syncNow()` 自己会把失败表达成 `SyncStatus`；能走到这里的是更外层的意外。
            // 不吞掉会变成一条未处理的 rejection，而那在 RN 上会崩整个应用。
          })
          .finally(() => {
            inFlight = false;
          });
      },
    });
    client.connect();
  } catch (error) {
    client = undefined;
    // 不留痕的话，将来排查时完全看不出这里跑过。
    console.warn('[heyta] 实时通道没能建立（不影响前台/写入触发的同步）：', error);
  }
}

/** 仅供测试。 */
export function __realtimeForTests(): RealtimeClient | undefined {
  return client;
}
