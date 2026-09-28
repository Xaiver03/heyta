/**
 * Web Push 订阅的持久化与生命周期。
 * ==================================
 *
 * 这是 `server/` 里**唯一**知道"推送该发给谁"的地方。它把三件本来分散的东西
 * 收在一处：
 *
 * 1. **注册 / 注销**（浏览器给的 endpoint + 两个密钥）；
 * 2. **取某个用户的全部订阅**（推送时唯一的热路径）；
 * 3. **失败记账**（决定一行该不该删）。
 *
 * ## 🔴 为什么把"取"和"记账"分开成两个函数，而不是一个 `sendToUser(userId)`
 *
 * 因为这两件事的**事务边界完全不同**：取订阅是一次只读查询，
 * 而发送是**几十次网络往返**（每个订阅一次 ECDH + AES + POST）。
 * 把它们塞进一个函数就意味着"发送期间持有某个东西" —— 而发送要几秒，
 * 那几秒里不应该有任何锁。所以这里只提供原料与账本，发送在 `sender.ts` 里，
 * 由调用方（同步流程）串起来。
 *
 * ## 🔴 一个刻意的取舍：`endpoint` 进不进日志
 *
 * **不进。** 它是能力 URL —— 拿到它就能给那台设备发推送。所以
 * `PushSubscriptionStore` 的读写都**不**提供"按 endpoint 打日志"的便利，
 * 而下面 `recordPushFailure` 的返回值里也只有计数、没有 endpoint。
 */

import { prisma } from '../db';

/** 一条订阅，**发送所需的最小集合**（与 `sender.ts` 的入参同形）。 */
export interface StoredPushSubscription {
  id: number;
  endpoint: string;
  p256dh: string;
  auth: string;
}

/** 注册入参。 */
export interface RegisterPushSubscriptionInput {
  userId: number;
  endpoint: string;
  p256dh: string;
  auth: string;
  /** 当前时间（epoch 毫秒）。不传就用 `Date.now()`；测试里必须传。 */
  nowMs?: number;
}

/**
 * 存储层接口。
 *
 * ⚠️ 抽成接口不是为了"以后换数据库"，而是为了**能测**：
 * 这个文件的判定（去重、记账、阈值删除）全部是纯逻辑，
 * 而它们最容易错的地方（阈值边界、重复注册、负计数）都不需要真库就能验。
 * 用真库测这些会让它们变成集成测试，然后就不会在每次 `pnpm test` 里跑。
 */
export interface PushSubscriptionStore {
  upsert(input: {
    userId: number;
    endpoint: string;
    p256dh: string;
    auth: string;
    nowMs: number;
  }): Promise<{ id: number }>;
  listForUser(userId: number): Promise<StoredPushSubscription[]>;
  deleteById(id: number): Promise<void>;
  recordSuccess(id: number, nowMs: number): Promise<void>;
  /** 返回**自增之后**的失败次数。 */
  incrementFailure(id: number): Promise<number>;
  deleteByEndpoint(endpoint: string): Promise<number>;
}

/**
 * 连续失败到这个次数就删掉这一行。
 *
 * 🔴 **5 次，而且只统计"确定指向这一行有问题"的结果。**
 *
 * 阈值定小了会误删活跃订阅（用户偶尔断网两次就被注销），
 * 定大了则泄漏得久。但比数值更重要的是**它统计什么**：
 * `429` / `5xx` 是推送服务自己的问题（那是 `retryable`，见 `sender.ts`），
 * **不该**进这个计数 —— 否则一次大规模 5xx 会把所有用户订阅清空。
 */
export const PUSH_FAILURE_THRESHOLD = 5;

/** 用 Prisma 实现。 */
export function createPrismaPushSubscriptionStore(): PushSubscriptionStore {
  return {
    async upsert({ userId, endpoint, p256dh, auth, nowMs }) {
      const row = await prisma.widgetPushSubscription.upsert({
        where: { endpoint },
        create: { userId, endpoint, p256dh, auth, createdAt: BigInt(nowMs) },
        // ⚠️ 重新注册时**重置失败计数**：这是用户主动做的一次操作，
        //    它意味着"这台设备现在确实在等着收推送"。不重置的话，
        //    一个曾经失败 4 次的订阅会在下次失败（第 5 次）就被删 ——
        //    而用户刚刚才重新订阅过。
        update: { userId, p256dh, auth, failureCount: 0, lastUsedAt: null },
        select: { id: true },
      });
      return row;
    },

    async listForUser(userId) {
      return prisma.widgetPushSubscription.findMany({
        where: { userId },
        // ⚠️ **不 select `endpoint` 之外的东西**，也**不**在别处 log 它。
        //    这里返回它是因为发送必须要它；它只应该走到 `fetch` 的 URL 参数上。
        select: { id: true, endpoint: true, p256dh: true, auth: true },
      });
    },

    async deleteById(id) {
      // ⚠️ `deleteMany` 而不是 `delete`：`delete` 在行不存在时抛 P2025，
      //    而"删一个已经被删掉的订阅"是完全正常的（两个流程同时发现它死了）。
      await prisma.widgetPushSubscription.deleteMany({ where: { id } });
    },

    async recordSuccess(id, nowMs) {
      await prisma.widgetPushSubscription.updateMany({
        where: { id },
        data: { lastUsedAt: BigInt(nowMs), failureCount: 0 },
      });
    },

    async incrementFailure(id) {
      const row = await prisma.widgetPushSubscription.update({
        where: { id },
        data: { failureCount: { increment: 1 } },
        select: { failureCount: true },
      });
      return row.failureCount;
    },

    async deleteByEndpoint(endpoint) {
      const result = await prisma.widgetPushSubscription.deleteMany({ where: { endpoint } });
      return result.count;
    },
  };
}

// ---------------------------------------------------------------------------
// 编排：把"取订阅 → 逐条发 → 记账"串起来
// ---------------------------------------------------------------------------

/** 一条订阅的处置结果。**没有 endpoint** —— 见文件头那条纪律。 */
export interface PushDeliveryOutcome {
  id: number;
  kind: 'sent' | 'gone' | 'retryable' | 'rejected' | 'failed';
  /** `failed` 才有；`sent` 时为 undefined。 */
  reason?: string;
  /** 本次之后累计的失败次数（只有计入失败的结果才有）。 */
  failureCount?: number;
  /** 是否因为到达阈值被删掉。 */
  removed: boolean;
}

export interface DeliverySummary {
  attempted: number;
  sent: number;
  removed: number;
  outcomes: PushDeliveryOutcome[];
}

export interface DeliverInput {
  userId: number;
  /** 已经密封好的快照信封（明文，加密由 `sender.ts` 做）。 */
  plaintext: string;
  vapid: VapidKeysLike;
  subject: string;
  nowMs?: number;
}

/** 只用到 VAPID 的密钥对，避免这里 import 整个 vapid 模块。 */
export interface VapidKeysLike {
  privateKey: Buffer;
  publicKey: Buffer;
}

/**
 * 给一个用户的**所有**订阅各发一条，并逐条记账。
 *
 * ## 🔴 哪些结果才计入失败 —— 这是本函数最核心的判定
 *
 * | 结果 | 处置 | 计入失败？ | 为什么 |
 * |---|---|---|---|
 * | `sent` | 记成功、清零 | — | |
 * | `gone`（404/410） | **立刻删掉** | — | 订阅确定已经死了，留着只会反复重跑密码学 |
 * | `retryable`（429/5xx） | 不动 | ❌ | 这是**推送服务**的问题。计入的话，一次大规模 5xx 会把**所有**用户的订阅清空 |
 * | `rejected`（400/401/403） | 不动 | ❌ | 这是**我们自己的 bug**（VAPID / Content-Encoding 写错）。计入的话，一次配置错误同样会清空全表 —— 而那时我们最需要的是"订阅还在，改完配置就能恢复" |
 * | `failed`（抛异常） | 计数，到阈值删 | ✅ | **只有这一种是"这一行的数据本身不能用"**（比如 p256dh 不是 65 字节）。它永远不会自愈，所以需要收尾 |
 *
 * ⚠️ 阈值只对最后一行生效，这条区分是**承重的**：
 * 失败计数器的用途是清理"永远不可能成功"的死行，而不是统计"最近推送不顺"。
 * 把 `retryable` / `rejected` 计进去，等于让一个**外部**故障或我们**自己的**故障
 * 去删除**用户**的数据 —— 而那是最不该发生的事。
 */
export async function deliverWidgetPushToUser(
  deps: {
    store: PushSubscriptionStore;
    /** 注入发送函数，测试里不真的发网络请求。 */
    send: (sub: StoredPushSubscription) => Promise<
      | { kind: 'sent' }
      | { kind: 'gone' }
      | { kind: 'retryable'; reason?: string }
      | { kind: 'rejected'; reason?: string }
    >;
    onRejected?: (id: number, reason: string) => void;
    onGone?: (id: number) => void;
  },
  input: DeliverInput,
): Promise<DeliverySummary> {
  const nowMs = input.nowMs ?? Date.now();
  const subs = await deps.store.listForUser(input.userId);
  const outcomes: PushDeliveryOutcome[] = [];

  // ⚠️ 串行而不是 `Promise.all`：台账的写入（自增 / 删除）之间没有冲突，
  //    但并发写同一批行会让"失败次数"的顺序变得不可预测 ——
  //    而我们要能说清"第几次失败触发了删除"。
  //    代价是 N 个订阅会慢 N 倍；N 在真实用户上是 1–3，可以接受。
  for (const sub of subs) {
    let outcome: PushDeliveryOutcome;
    try {
      const result = await deps.send(sub);
      if (result.kind === 'sent') {
        await deps.store.recordSuccess(sub.id, nowMs);
        outcome = { id: sub.id, kind: 'sent', removed: false };
      } else if (result.kind === 'gone') {
        await deps.store.deleteById(sub.id);
        deps.onGone?.(sub.id);
        outcome = { id: sub.id, kind: 'gone', removed: true };
      } else if (result.kind === 'rejected') {
        // 🔴 **不计数、不删除。** 见上面那张表。
        deps.onRejected?.(sub.id, result.reason ?? '推送服务拒绝');
        outcome = { id: sub.id, kind: 'rejected', removed: false };
      } else {
        // retryable：**不计数**，交给推送服务自己重试。
        outcome = { id: sub.id, kind: 'retryable', removed: false };
      }
    } catch (error) {
      // 只有走到这里才是"这一行的数据不能用"。
      const reason = error instanceof Error ? error.message : String(error);
      const failureCount = await deps.store.incrementFailure(sub.id);
      let removed = false;
      if (failureCount >= PUSH_FAILURE_THRESHOLD) {
        await deps.store.deleteById(sub.id);
        removed = true;
      }
      outcome = { id: sub.id, kind: 'failed', reason, failureCount, removed };
    }
    outcomes.push(outcome);
  }

  return {
    attempted: subs.length,
    sent: outcomes.filter((o) => o.kind === 'sent').length,
    removed: outcomes.filter((o) => o.removed).length,
    outcomes,
  };
}
