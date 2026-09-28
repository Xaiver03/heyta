/**
 * 同步之后通知小组件刷新。
 * ==========================
 *
 * 这是整条 Web Push 链的**触发点**。在此之前 `push-crypto` / `vapid` / `sender` /
 * `subscriptions` / `push.routes` 全部就绪，但**没有任何东西会发起推送** ——
 * 也就是"能力齐全、用户收不到"。
 *
 * ## 🔴 载荷是一个**极小信号**，不是快照
 *
 * 这是本文件最重要的一个决定。直觉上"组件要显示今日任务，那推送就把任务带过去"，
 * 但这里做不到，而且**不该**做到：
 *
 * - 快照是 **E2EE 信封**，服务端**没有密钥**，造不出来；
 * - 就算造得出来，那也会让服务端持有一份"用户的任务列表"—— 与 heyta 的
 *   local-first / 端到端加密姿态直接冲突。
 *
 * 而 SW 侧本来就不解密：它的 `push` 处理器只做一件事 —— **把活着的页面叫起来**，
 * 页面读本地库、解密、算出 Adaptive Card 数据、再推回组件宿主
 *（见 `apps/web/src/pwa/sw.ts` 的 `push` 监听器）。所以推送只需要说
 * "有变化了，醒一醒"。
 *
 * 于是载荷是一个固定的小 JSON。**它不含任何用户数据** —— 所以即使推送服务
 * （或任何中间人）读到了它，也只知道"这台设备装着 heyta"。
 *
 * ## 🔴 三个"绝不能" 
 *
 * 1. **绝不能让它拖慢或影响上传。** 调用方是同步热路径，推送是几十毫秒到几秒的
 *    网络往返。所以这里整体是 fire-and-forget，且**从不抛异常**
 *    （`notifyWidgetSubscribers` 把一切都吞掉并记日志）。
 * 2. **绝不能因为推送失败而让用户的上传失败。** 同一条纪律的另一面。
 * 3. **绝不能在没有配 VAPID 时做任何事** —— 包括**一次数据库查询**。
 *    自托管实例是默认形态，而同步热路径上的每一次多余查询都会被乘以
 *    每一个用户、每一次上传。
 */

import { Logger } from '../logger';
import { deliverWidgetPushToUser, type PushSubscriptionStore } from './subscriptions';
import { sendWidgetPush } from './sender';
import type { VapidKeys } from './vapid';

/** 载荷。**刻意不含任何用户数据** —— 见文件头。 */
export const WIDGET_REFRESH_PAYLOAD = JSON.stringify({ type: 'heyta:widget-refresh' });

export interface WidgetPushRuntimeConfig {
  vapidKeys: VapidKeys;
  subject: string;
}

/**
 * 同一个用户在这个窗口内最多推一次。
 *
 * 🔴 为什么需要它：客户端上传是**分批**的（一次拉不完就再拉一批），
 * 而且用户连续勾选几个任务会触发多次上传。没有合并的话，勾 5 个任务
 * 会给这台设备发 5 条推送 —— 每条都要重跑一遍 ECDH + AES + 一个网络往返。
 *
 * ⚠️ **这是进程内的**（不是分布式锁）。多副本部署时每个副本各有一份，
 * 所以最坏情况是"每个副本各推一次" —— 那比"漏推"好得多（漏推的症状是
 * 组件不更新，而过量推送只是多耗一点电）。刻意不做成共享状态：
 * 在同步热路径上为了省几条推送去读写 Redis，是把一个小问题换成一个大问题。
 */
export const PUSH_COALESCE_WINDOW_MS = 30_000;

/** 进程内的合并窗口。`userId -> 上次推送时刻`。 */
const lastPushedAt = new Map<number, number>();

/** 运行期配置。**未配置时是 `null`** —— 那意味着这个能力不存在。 */
let runtime: WidgetPushRuntimeConfig | null = null;
let storeOverride: PushSubscriptionStore | null = null;

/**
 * 启动时调用一次。没配 Web Push 时**不要调用**（或传 `null`）。
 *
 * ⚠️ 用模块级的可写状态而不是每次都 `loadConfigFromEnv()`：
 * 后者的返回类型里 `webPush` 是**可选**的，所以每个调用点都要判一次 null ——
 * 而那种判断会被漏掉一处，症状是"某个入口静默不推送"。
 * 这里只在启动时判**一次**，之后所有调用点看到的都是确定的。
 */
export function configureWidgetPush(
  config: WidgetPushRuntimeConfig | null,
  store: PushSubscriptionStore | null = null,
): void {
  runtime = config;
  storeOverride = store;
  if (config === null) lastPushedAt.clear();
}

/** 测试用：清掉合并窗口。 */
export function resetWidgetPushCoalesce(): void {
  lastPushedAt.clear();
}

/** 这个能力现在是否可用。**给测试与排查用**，不要在热路径上判断它再调用。 */
export function isWidgetPushConfigured(): boolean {
  return runtime !== null;
}

export interface NotifyDeps {
  store: PushSubscriptionStore;
  /** 注入发送，测试里不真的发网络请求。 */
  send?: typeof sendWidgetPush;
  nowMs?: number;
}

/**
 * 给一个用户的所有订阅发一条"醒一醒"。
 *
 * **从不抛异常。** 调用方在同步热路径上，那里任何一次抛出都会让用户的上传失败 ——
 * 而"推送没发出去"与"用户的任务没同步"完全不是一个量级的后果。
 */
export async function notifyWidgetSubscribers(
  userId: number,
  deps?: Partial<NotifyDeps>,
): Promise<void> {
  const active = runtime;
  // ⚠️ 未配置时**立刻返回**，连一次 store 查询都不做 —— 见文件头纪律（3）。
  if (active === null) return;

  const store = deps?.store ?? storeOverride;
  if (store === null || store === undefined) {
    // 这是**启动配置错了**，不是运行时故障。记一次警告，不抛。
    Logger.warn('[widget-push] 已配置 VAPID 但没有注入 store，推送被跳过');
    return;
  }

  const nowMs = deps?.nowMs ?? Date.now();
  const last = lastPushedAt.get(userId);
  if (last !== undefined && nowMs - last < PUSH_COALESCE_WINDOW_MS) {
    // 🔴 **先记时间戳再发送**：反过来的话，发送期间来的第二次上传会看到
    //    一个"还没更新"的时间戳，于是又发一条 —— 合并窗口形同虚设。
    return;
  }
  lastPushedAt.set(userId, nowMs);

  const send = deps?.send ?? sendWidgetPush;

  try {
    const summary = await deliverWidgetPushToUser(
      {
        store,
        send: async (sub) => {
          const result = await send({
            subscription: { endpoint: sub.endpoint, p256dh: sub.p256dh, auth: sub.auth },
            plaintext: WIDGET_REFRESH_PAYLOAD,
            vapid: active.vapidKeys,
            subject: active.subject,
            nowSeconds: Math.floor(nowMs / 1000),
          });
          return result.kind === 'sent'
            ? { kind: 'sent' as const }
            : result.kind === 'gone'
              ? { kind: 'gone' as const }
              : result.kind === 'retryable'
                ? { kind: 'retryable' as const, reason: result.reason }
                : { kind: 'rejected' as const, reason: result.reason };
        },
        onGone: () => {
          Logger.info('[widget-push] 一条订阅已被推送服务判定失效，已删除');
        },
        onRejected: (_id, reason) => {
          // 🔴 **这是我们的 bug**（VAPID / Content-Encoding 写错），
          //    但它**不能**让同步请求失败 —— 所以只记日志。
          Logger.error(`[widget-push] 推送被拒绝（多半是 VAPID 配置错）：${reason}`);
        },
      },
      {
        userId,
        plaintext: WIDGET_REFRESH_PAYLOAD,
        vapid: active.vapidKeys,
        subject: active.subject,
        nowMs,
      },
    );

    if (summary.attempted > 0) {
      Logger.info(
        `[widget-push] user:${userId} 推送 ${summary.attempted} 条，成功 ${summary.sent}，清理 ${summary.removed}`,
      );
    }
  } catch (error) {
    // 🔴 兜底：`deliverWidgetPushToUser` 内部已经逐条 try 过了，能走到这里
    //    只有 store 本身的故障（比如数据库连不上）。它**必须**被吞掉。
    Logger.error(
      `[widget-push] 推送流程出错（不影响同步）：${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
