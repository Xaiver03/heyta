/**
 * 口令哈希的**并发闸门**。
 *
 * ## 为什么必须有它
 *
 * Argon2id 按 OWASP 最低参数跑一次是 ~19 MiB 内存 + ~35 ms CPU（实测：musl 容器 37 ms，
 * glibc 27 ms）。这个代价是**故意的** —— 它就是让离线爆破跑不起来的东西。
 * 但它同时意味着：**登录洪水会打成自我 DoS**。500 个并发登录尝试 = 500 × 19 MiB ≈ 9.5 GB,
 * 进程不是变慢而是被 OOM 杀掉，而杀掉它连本地已登录的会话一起带走。
 *
 * OWASP 对这一段的答案就是"限制并发的哈希数"。所以：
 *
 * - **槽位数**从核数推导（不是拍一个数）：这些调用是 CPU 密集的，超过核数只会互相抢，
 *   并且**多留一个核**给事件循环与 Postgres 客户端 —— 一个把机器占满的认证路径
 *   会让健康检查超时，那是比拒绝服务更糟的失败模式。
 * - **等待队列有上限**：槽位满了以后让请求**等**，但只等到 `MAX_WAITING`。
 *   超过就当场 503（带 `Retry-After`），而不是把连接挂在一条没有尽头的队列上。
 * - 🔴 **过载时的处置是"拒绝"，不是"降低工作因子"**。少算几遍内存/轮次是**把安全性
 *   在攻击最密集的时刻降到最低** —— 那正好是给攻击者的奖励，而且会让落库的哈希
 *   与策略不一致。宁可这个端点暂时不可用。
 */
import { cpus } from 'os';

/** 一个哈希占用的核之外，留给事件循环/DB 的核数。 */
const RESERVED_CORES = 1;
const MIN_SLOTS = 1;
const MAX_SLOTS = 4;

/**
 * 队列上限。32 = 8 倍于最大槽位数，覆盖"一小波人同时点登录"的正常抖动，
 * 又足以让一次洪水在这里断掉而不是把内存吃光。
 */
const MAX_WAITING = 32;

export const hashSlots = (): number => {
  const cores = Math.max(1, cpus().length);
  return Math.min(MAX_SLOTS, Math.max(MIN_SLOTS, cores - RESERVED_CORES));
};

/** 单次哈希耗时用于推导等待时间的**保守上界**（ms）。实测 27–37 ms，取 3 倍余量。 */
const HASH_DURATION_BUDGET_MS = 100;

/**
 * 过载时给客户端的 `Retry-After`（秒）。**从队列数学推出来，不是拍的**：
 *
 * 最坏情况是被拒的请求要等**整条队列**排空，而队列在最少槽位（1）下串行 ——
 * `MAX_WAITING × HASH_DURATION_BUDGET_MS = 32 × 100 ms = 3.2 s` ⇒ 向上取整 **4 s**。
 *
 * ⚠️ 这个数字不能随手写，两个方向都贵：短于真实排队时间 ⇒ 客户端按约定回来时
 * 正撞上下一次洪水，闸门在"满 / 空"之间振荡；长于它 ⇒ 用户在一次本可成功的
 * 登录前白等。改 `MAX_WAITING` 或槽位策略时这条会跟着动，正是它该有的行为。
 */
export const PASSWORD_BACKEND_RETRY_AFTER_SECONDS = Math.ceil(
  (MAX_WAITING * HASH_DURATION_BUDGET_MS) / 1000,
);

export class PasswordBackendBusy extends Error {
  readonly code = 'password_backend_busy' as const;
  readonly retryAfterSeconds = PASSWORD_BACKEND_RETRY_AFTER_SECONDS;

  constructor() {
    super('Password hashing backend is saturated; please retry shortly.');
    this.name = 'PasswordBackendBusy';
  }
}

let active = 0;
const waiting: Array<() => void> = [];

const acquire = (): Promise<void> =>
  new Promise((resolve) => {
    if (active < hashSlots()) {
      active += 1;
      resolve();
      return;
    }
    waiting.push(() => {
      active += 1;
      resolve();
    });
  });

const release = (): void => {
  active -= 1;
  const next = waiting.shift();
  if (next) next();
};

/**
 * 占一个槽跑一次口令哈希/校验。
 *
 * 用 `try/finally` 归还：抛错的哈希（参数不对、内存分配失败）**必须**放槽,
 * 否则泄漏一次就少一格，几次之后这条认证路径永久 503 —— 一种极难归因的坏法。
 */
export const withHashSlot = async <T>(task: () => Promise<T>): Promise<T> => {
  if (active >= hashSlots() && waiting.length >= MAX_WAITING) {
    throw new PasswordBackendBusy();
  }
  await acquire();
  try {
    return await task();
  } finally {
    release();
  }
};

/** 仅供测试：把闸门内部状态清零，避免用例之间互相看到对方的排队。 */
export const resetHashGateForTests = (): void => {
  active = 0;
  waiting.length = 0;
};

/** 仅供测试与诊断：当前占用/排队数。 */
export const hashGateStats = (): { active: number; waiting: number; slots: number } => ({
  active,
  waiting: waiting.length,
  slots: hashSlots(),
});
