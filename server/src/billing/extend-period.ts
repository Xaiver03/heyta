/**
 * 一次性支付的周期叠加 —— **服务端侧的落点**。
 *
 * ## 🔴 这不是"第二份实现"，格式上却是镜像。原因是一个硬约束冲突
 *
 * 语义的唯一来源是 `packages/domain/src/subscription.ts` 的
 * `extendSubscriptionPeriod`（有 7 条测试）。任务书要求**复用它、不要重写**。
 *
 * 但 `server` 包在 `package.json` 里**没有** `@heyta/domain` 依赖
 * （只有 `apps/web` / `apps/mobile` / `packages/app-host` / `packages/op-log` /
 * `apps/node-host` 有），而本次任务的硬约束又明确写了
 * **不许改 `server/package.json`、不许改 `pnpm-lock.yaml`、零新依赖**。
 *
 * 于是"复用"在服务端**物理上做不到**：
 * - `import { extendSubscriptionPeriod } from '@heyta/domain'` →
 *   `server/node_modules/@heyta/domain` 不存在（实测 `ls` 只有 shared-schema /
 *   sync-core 两个符号链接），`tsc --noEmit` 会 TS2307；
 * - 相对路径 import `packages/domain/src` → 在 `server/tsconfig.json` 的
 *   `rootDir: "."` 之外，TS6059，并且对方是 ESM 而这里是 CJS。
 *
 * ## 所以这里做的是：镜像 + 漂移守卫
 *
 * - `apply-event.ts` **不含任何周期算术**，算法以端口 `extendPeriod` 注入，
 *   这样通用层里没有第二份公式；
 * - 本文件是唯一的服务端实现；
 * - `server/tests/billing-extend-period.spec.ts` **直接 import
 *   `packages/domain/src/subscription.ts`**，把两份实现对**同一张用例表**
 *   （含抛异常的用例）逐一比对 —— 任何一边漂移都会立刻红。
 *   这是本仓库已有的手法（`packages/domain/tests/subscription.spec.ts` 里就有一条
 *   直接读服务端源文件的漂移守卫测试）。
 *
 * ⚠️ **正解是给 `server` 加上 `@heyta/domain` 依赖并删掉本文件**，
 * 但 `server/package.json` 与 lockfile 本轮不许动 —— 已写进交付报告顶回去。
 */

/**
 * 一次购买的默认时长：365 天。与 `packages/domain` 的
 * `SUBSCRIPTION_PERIOD_DAYS` 同值（漂移守卫会核对语义，但这是个常量，
 * 两边不一致时 `days` 默认值不同，用例表覆盖了默认值分支）。
 */
export const SUBSCRIPTION_PERIOD_DAYS = 365;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface ExtendSubscriptionPeriodInput {
  /** 当前时刻（epoch ms）。 */
  readonly now: number;
  /** 已记录的到期时刻（epoch ms）；从未购买过传 null。 */
  readonly currentPeriodEnd: number | null;
  /** 本次购买的时长，默认 365 天。 */
  readonly days?: number;
}

/**
 * `newEnd = max(now, currentPeriodEnd ?? now) + days`。
 *
 * 🔴 **`max` 是全部要点**：提前续费不许丢掉已付过钱的剩余时间；
 * 已过期的到期日必须从 `now` 起算，否则新买的时长会有一部分埋进过去。
 *
 * 非有限输入一律**抛异常**（与 domain 版逐字同行为）：这是收钱路径，
 * 算不出来时必须响，不能默默写一个错值进数据库。
 */
export const extendSubscriptionPeriod = (
  input: ExtendSubscriptionPeriodInput,
): number => {
  const { now, currentPeriodEnd, days = SUBSCRIPTION_PERIOD_DAYS } = input;

  if (!Number.isFinite(now)) {
    throw new Error(`extendSubscriptionPeriod: now 不是有限数（${String(now)}）`);
  }
  if (currentPeriodEnd !== null && !Number.isFinite(currentPeriodEnd)) {
    throw new Error(
      `extendSubscriptionPeriod: currentPeriodEnd 不是有限数（${String(currentPeriodEnd)}）`,
    );
  }
  if (!Number.isFinite(days) || days <= 0) {
    throw new Error(`extendSubscriptionPeriod: days 必须是正有限数（${String(days)}）`);
  }

  const base =
    currentPeriodEnd !== null && currentPeriodEnd > now ? currentPeriodEnd : now;

  return base + days * MS_PER_DAY;
};