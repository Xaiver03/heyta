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
 * 同一个文件后来还收了一类**本不该存在**的行：2026-10-24 那次事故里"在事务外铸会话"
 * 留下的孤儿 `access_sessions`（判据与全部理由见 `purgeOrphanSessions` 上面那段，
 * 以及 `docs/reference/environment-traps.md` §7 #544）。它与上面那几趟不是同一件事 ——
 * 上面几趟清的是**过期**，它清的是**从未合法存在过**。
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
  /**
   * 这一趟按"孤儿会话"判据（未激活 + 无口令的账号身上的旧会话行）删掉的行数。
   *
   * 🔴 **正常永远应当是 0**：泄漏那条路已经修好了（会话与激活同事务，见
   * `password/registration-otp.ts` 里 `issueSession` 上方那段）。所以这一格非 0
   * 不是"清扫在正常工作"，而是**该被看见的信号** —— 说明又有一条路在事务外铸会话，
   * 或者修复之前的历史残渣还没清完。它进日志就是为了让人能看见它。
   */
  readonly orphanSessions: number;
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
 * 一趟里最多看多少个"未激活 + 无口令"的账号。
 *
 * 有界是刻意的：这一趟是**清残渣**的兜底，不是审计。正常状态下这个集合是空的
 * （见 `purgeOrphanSessions` 第 ② 段），所以真实代价通常是**一条 `LIMIT 500` 的空查**；
 * 而没有上界时，一个"注册了几十万次但从不激活"的灌库脚本会让这趟日扫
 * 扫一遍整张 `users` 加一次大 `IN`。
 */
export const ORPHAN_SESSION_USER_SCAN_LIMIT = 500;

/**
 * 孤儿会话的年龄下限：`createdAt` 早于 `now - 这个数` 才可能被删。
 *
 * 为什么是 24 小时（而不是"随手拍一个保守的数"）：
 *
 * - 一条"未激活账号的会话"的时间戳就是它被铸出来的那一刻（`recordSession` 里
 *   `createdAt = Date.now()`），所以这个判据量的就是"这枚会话活了多久"。
 * - 验证码 TTL 是 **10 分钟**（`EMAIL_PASSWORD_REGISTRATION_CODE_TTL_MS`），重发冷却
 *   **60 秒**（`EMAIL_PASSWORD_REGISTRATION_RESEND_COOLDOWN_MS`）⇒ 一次正常的注册
 *   从发码到激活是**分钟级**；把连续重发五次、每次都用满冷却全算上也只有五分钟量级。
 *   所以"1 小时"就已经把"用户在填码、界面还在转圈"整个包住了。
 * - 取 24 小时换的是三件与 TTL 无关的事：跨时区/跨机器的**时钟偏差**
 *   （`created_at` 来自服务端 `Date.now()`，但 NTP 回跳是真的会发生）、
 *   用户**开着注册页过夜**第二天才回来填码、以及日扫自己 `MS_PER_DAY` 的抖动 ——
 *   一条行至少要完整活过一趟日扫，才可能在第二趟被重新看见。
 * - 🔴 反过来**不许再大**：这个数每多一分钟，"本不该存在的行"就在库里多躺一分钟。
 *   它不是留存策略（那由 `SESSION_ROW_RETENTION_MS` 负责），是**兜底清理的滞后量**。
 */
export const ORPHAN_SESSION_MIN_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * 清掉**孤儿会话**：从未激活、也从未有过口令的账号身上那些早就该不存在的会话行。
 *
 * ## ① 这条判据为什么安全（它不可能删到一条真会话）
 *
 * 本仓**没有任何合法路径**会给"`isVerified === 0` 且 `passwordHash === null`"的账号发会话：
 *
 * - **口令登录**（`password/service.ts:228`）与**魔法链接登录**（`password/login-otp.ts:122`
 *   与 `:287`）都要求 `isVerified === 1`；
 * - **注册验证码**那条路是**先激活再铸会话**，而且两件事在**同一笔事务**里
 *   （`registration-otp.ts` 的 `verifyRegistrationCode`：`user.updateMany` 把
 *   `passwordHash` 与 `isVerified=1` 一起写上，随后 `issueSession(..., { tx })`）——
 *   事务回滚时会话一起没有；
 * - **通行密钥登录**要求库里先有一条 `passkey` 行，而那条行只能在**已登录**（因此已激活）
 *   的会话里注册；
 * - **中央登录**在本地建/升账号时直接写 `isVerified: 1`（`central-auth/repository.ts:488`），
 *   随后才发本地会话。
 *
 * 换句话说：这个 `where` 里的两个条件各自意味着"这条账号根本还没有能登录的东西"，
 * 合起来是"连登录的入口都还不存在"。删它身上的会话，删的是**不可能被签发的行**。
 *
 * 🔴 所以两个条件**缺一不可**，而且各自都有一条贵得离谱的反例：
 * `passwordHash: null` 单独成立时命中的是**通行密钥专用账号**（schema 上那句
 * "Nullable for passkey-only users" 就是这个形状）—— 那是**已验证**的用户，而且他
 * 连口令都没有，删掉会话等于把唯一那台能登进来的设备踢出去；
 * `isVerified: 0` 单独成立时命中的是**老邮件链接注册路**里"口令已落、还没点链接"的账号，
 * 那是正在注册的人，不是残渣。
 *
 * ## ② 它只是兜底，不是解法
 *
 * 真正的解法是"会话与激活同事务"（2026-10-24 那次事故的修复，已落在
 * `registration-otp.ts` / `login-otp.ts`）。这条函数清理的是**修复之前**已经提交进库的
 * 历史残渣，以及万一将来又有人在事务外铸会话时留下的新残渣。
 *
 * 🔴 所以 **`orphanSessions > 0` 是一个该被看见的信号，不是"清扫在正常工作"**：
 * 正常应当永远是 0。看到非 0 的正确反应是去查"谁在事务外签了会话"，而不是
 * 把这条日志当成一项会一直跳动的常规计数量。它进 `sync/cleanup.ts` 第 9 步的同一行日志，
 * 就是为了即便 0 也在场（"跑了但没活干"必须与"根本没跑到"分得开），让"一直是 0"这件事
 * 本身成为可核对的读数。
 *
 * ## ③ 边界
 *
 * - **单副本**语义，与这个文件其余几趟一致。多副本部署时每枚副本都会跑一遍，
 *   两枚副本的 `deleteMany` 撞在同一批行上时后到的那个删到 0，结果是重复的日志行、
 *   不是重复的工作 ⇒ **幂等**。
 * - 候选账号集**有界**（`ORPHAN_SESSION_USER_SCAN_LIMIT`）。代价见那个常量的注释：
 *   若"未激活 + 无口令"的账号一度超过上界，超出的那些本轮不会被扫到 —— 那一天的
 *   `orphanSessions` 读数也就看不到它们，这是这个上界换来的、必须承认的盲区。
 * - `orderBy: { id: 'asc' }` 让"前 500 个"是**确定的**那 500 个，而不是 Postgres
 *   每次随便给的 500 个：不确定的话，同一批账号可能永远排在前面，而后面那些
 *   一条也扫不到。
 *
 * 为什么不用 raw SQL：这一族清扫的判据本来就是靠 fake prisma 做逐字段对账的
 * （`tests/credential-sweep.spec.ts`），一句 `$queryRaw` 会让那套假实现失效，
 * 于是"会删错"这件事再没有东西挡得住。而这里的查询形状普通 Prisma 完全够用。
 *
 * @param nowMs 这一趟的"现在"。显式传入而不是内部取 `Date.now()`，是为了让
 *   阈值可被判定（真库/单测都能把时间钉死）。
 * @returns **真正删掉**的行数（不是候选行数、不是账号数）。
 */
export const purgeOrphanSessions = async (nowMs: number): Promise<number> => {
  const cutoff = BigInt(nowMs - ORPHAN_SESSION_MIN_AGE_MS);
  const unactivated = await prisma.user.findMany({
    where: { isVerified: 0, passwordHash: null },
    select: { id: true },
    orderBy: { id: 'asc' },
    take: ORPHAN_SESSION_USER_SCAN_LIMIT,
  });
  // 没有候选账号就**不要**发那条 `deleteMany`：正常状态下每天都会走到这一句，
  // 而 `userId: { in: [] }` 是一次没有意义的写往返。
  if (unactivated.length === 0) return 0;

  const deleted = await prisma.accessSession.deleteMany({
    where: {
      userId: { in: unactivated.map((user) => user.id) },
      createdAt: { lt: cutoff },
    },
  });
  return deleted.count;
};

/**
 * 扫一遍：过期的邮箱验证码列、过期的换绑请求行、过了 JWT 生命周期的会话行，
 * 以及孤儿会话（见 `purgeOrphanSessions`）。
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
  // 孤儿会话放在 365 天那一刀**之后**：任何超过 365 天的行同时也满足 24 小时的年龄判据，
  // 先跑那一刀，两格的归属才是确定的（`sessions` 继续只表示"按 JWT 生命周期到期"的那些），
  // 留给孤儿判据的就真的是"本不该存在、且没被留存上界收走"的残渣。
  const orphanSessions = await purgeOrphanSessions(nowMs);

  return {
    verificationTokens,
    resetTokens,
    recoveryTokens,
    loginTokens,
    changeRequests: expired.count,
    sessions,
    orphanSessions,
  };
};
