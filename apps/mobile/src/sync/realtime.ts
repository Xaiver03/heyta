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
