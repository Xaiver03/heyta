/**
 * 过期凭据的清扫（ADR-0063 §3 落到实处的这一半）。
 *
 * ## 为什么必须有这一枚
 *
 * `users` 上四对「令牌 + 过期时刻」列（验证邮箱 / 重置口令 / 找回通行密钥 / 魔法登录）
 * 在**消费之前**没人清：过期之后 `verify` 那一步会拒它，所以它不再危险，但那一串
 * SHA-256 hex 与它的过期时刻会**永久留在库里**。`email_change_requests` 同理，而且更重 ——
 * 那一行还带着**新邮箱的明文**（`pending_email`）。`access_sessions` 带的是设备名与 UA。
 *
 * 这三样都写在对外政策里（"一次性、消费即失效""留存 N 天"）。**没有清扫的留存期
 * 就是一句没有主人执行的话** —— 这个仓库已经有过一模一样的教训：`Cleanup [ai-usage-counters]`
 * 那一节的文件头写的就是"这是唯一让那句'保留 N 天'成真的东西"。
 *
 * ## 三条形状
 *
 * 1. 🔴 **只清已过期的**。未到期的那一格是**用户随时会点的那枚链接**，清掉等于把人
 *    关在邮件里（"点进去说链接已过期"就是这个函数写错时的症状）。
 * 2. 🔴 **不碰没值的行**（`token: { not: null }` 在 `where` 里）。给一百万行没令牌的账号
 *    各写一次 null 是一次纯粹的自残。
 * 3. 一次 `updateMany`/`deleteMany` 一列，**不在事务里**：这是数据最小化，不是原子性关键；
 *    中途挂掉下一次还会扫到同一批（幂等：条件里带着"已过期"）。
 *
 * ⚠️ 边界：这是**单副本**的清扫。多副本部署时每枚副本都会跑一次，`updateMany` 的
 *    条件写让第二次数是 0 —— 结果是重复的日志行，不是重复的工作。
 */
import { prisma } from '../db';
import { deleteSessionsOlderThan } from './access-sessions';

/** JWT 的有效期，与 `auth.ts` 的 `JWT_EXPIRY` 同值（那边是 '365d'）。 */
export const SESSION_ROW_RETENTION_MS = 365 * 24 * 60 * 60 * 1000;

/** 清扫之后的计数：每一格都是"这一趟真的动了几行"。 */
export interface SweepReport {
  readonly verificationTokens: number;
  readonly resetTokens: number;
  readonly recoveryTokens: number;
  readonly loginTokens: number;
  readonly changeRequests: number;
  readonly sessions: number;
}

/** 一列 = 一次 `updateMany`。`expiresAtColumn` / `tokenColumn` 是 Prisma 的 camelCase 名。 */
const clearExpiredColumn = async (
  tokenColumn: 'verificationToken' | 'resetPasswordToken' | 'passkeyRecoveryToken' | 'loginToken',
  expiresColumn:
    | 'verificationTokenExpiresAt'
    | 'resetPasswordTokenExpiresAt'
    | 'passkeyRecoveryTokenExpiresAt'
    | 'loginTokenExpiresAt',
  nowMs: number,
): Promise<number> => {
  const updated = await prisma.user.updateMany({
    where: { [expiresColumn]: { not: null, lt: BigInt(nowMs) } },
    data: { [tokenColumn]: null, [expiresColumn]: null },
  });
  return updated.count;
};

/**
 * 扫一遍：过期的邮箱验证码列、过期的换绑请求行、以及过了 JWT 生命周期的会话行。
 *
 * 调用方是 `sync/cleanup.ts` 的第 9 步。**计数为 0 也要记日志**（那一节写的同一条理由：
 * "跑了但没活干"必须与"根本没跑到"分得开）。
 */
export const sweepExpiredAccountCredentials = async (
  nowMs: number,
): Promise<SweepReport> => {
  const verificationTokens = await clearExpiredColumn(
    'verificationToken',
    'verificationTokenExpiresAt',
    nowMs,
  );
  const resetTokens = await clearExpiredColumn(
    'resetPasswordToken',
    'resetPasswordTokenExpiresAt',
    nowMs,
  );
  const recoveryTokens = await clearExpiredColumn(
    'passkeyRecoveryToken',
    'passkeyRecoveryTokenExpiresAt',
    nowMs,
  );
  const loginTokens = await clearExpiredColumn('loginToken', 'loginTokenExpiresAt', nowMs);

  // 换绑请求那一行：**两个**令牌都过期（或从未签发）才算"没有任何人在等它"。
  // 只清 old 那一侧会让用户"重发一次新邮箱的链接"变成不可能 —— 那一行还得留着，
  // 因为它记着"谁在等谁点"，界面与那两封邮件都读它。
  const expired = await prisma.emailChangeRequest.deleteMany({
    where: {
      AND: [
        {
          OR: [
            { oldExpiresAt: null },
            { oldExpiresAt: { lt: BigInt(nowMs) } },
            { oldToken: null },
          ],
        },
        {
          OR: [
            { newExpiresAt: null },
            { newExpiresAt: { lt: BigInt(nowMs) } },
            { newToken: null },
          ],
        },
      ],
    },
  });

  const sessions = await deleteSessionsOlderThan(nowMs - SESSION_ROW_RETENTION_MS);

  return {
    verificationTokens,
    resetTokens,
    recoveryTokens,
    loginTokens,
    changeRequests: expired.count,
    sessions,
  };
};
