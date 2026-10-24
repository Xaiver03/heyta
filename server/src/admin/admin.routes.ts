import { centralRuntime } from '../central-auth/runtime';
/**
 * 运营管理后台的 HTTP 面：`/api/admin/*`。
 * ============================================
 *
 * 依据：[`docs/adr/0038-admin-console-scope.md`](../../../docs/adr/0038-admin-console-scope.md)。
 *
 * ## 只读为主 + 三个不碰钱的动作
 *
 * | 方法 | 路径 | 用途 |
 * |---|---|---|
 * | GET  | `/overview`              | 概览统计（用户 / 订阅 / 订单 / 优惠码 / 邀请） |
 * | GET  | `/users`                 | 用户列表（搜索 + 分页） |
 * | GET  | `/users/:id`             | 用户详情（订阅 / 订单 / 设备 / 配额） |
 * | POST | `/users/:id/unlock`      | 解锁被锁账号（清 `lockedUntil` + `failedLoginAttempts`） |
 * | POST | `/users/:id/quota`       | 调整存储配额 |
 * | POST | `/users/:id/logout`      | 强制登出（`tokenVersion++`，撤销该账号全部令牌） |
 * | GET  | `/subscriptions`         | 订阅列表 |
 * | GET  | `/orders`                | 订单列表 |
 * | GET  | `/coupons`               | 优惠码 + 核销数 |
 * | GET  | `/invites`               | 邀请码 + 推荐关系 |
 * | GET  | `/revenue`               | 营收看板：逐日 × 逐币种的进账与退款（只读聚合，日界由调用方时区裁） |
 * | GET  | `/announcements`         | 运营公告全量（含未生效与已过期；后台要看现状）—— ADR-0075 |
 * | POST | `/announcements`         | 发一条公告（`level` 词表 + 有效期由服务端判） |
 * | DELETE | `/announcements/:id`     | 下架 = 删掉那一行（0 行 ⇒ 404，不折成"已完成"） |
 * | GET  | `/holiday-adjustments`   | 调休/补班已录入的年度（含 `papers` 出处回显） |
 * | PUT  | `/holiday-adjustments/years` | **整年替换**某一年（公共事实的唯一写入口，判据③的载体） |
 * | DELETE | `/holiday-adjustments/years?year=` | 撤销某一年（退回随包表，不是"下发空的一年"） |
 *
 * **不做**：改订阅、退款、发券、群发通知。理由见 ADR-0038 §2 三 / §3.4 ——
 * 前三个动到钱与权益，各自需要幂等键、审计与回滚；群发自由文本会破坏
 * "通知只存语义 + 参数、文案归 i18n"这条既有立场（`activity/notifications.ts` 文件头）。
 *
 * ## 🔴 响应一律走**白名单投影**
 *
 * `passwordHash`、`verificationToken` / `resetPasswordToken` / `passkeyRecoveryToken` /
 * `loginToken`、`Passkey.credentialId` 与公钥 —— **一个都不出现在响应里**。
 * 不靠"记得别 select"，而是每个投影函数显式列出要哪些字段。
 * 这与 `packages/local-api` 的 `projectForTool`（可列举、不可读）是同一条纪律。
 *
 * ## `BigInt` 的序列化
 *
 * Prisma 的时间戳列都是 `BigInt`，而 `JSON.stringify` **不能**序列化 BigInt
 * （会抛 `TypeError: Do not know how to serialize a BigInt`）。所以每个出参都
 * 显式过 `toMs()` / `toMinor()`。漏一个的症状是整个端点 500 —— 响亮，但很浪费时间。
 */

import { FastifyInstance } from 'fastify';
import { z } from 'zod';

import {
  HOLIDAY_ADJUSTMENT_PATHS,
  holidayAdjustmentAdminDeleteQuerySchema,
} from '@heyta/shared-schema';

import { DEFAULT_ENTITLEMENT_POLICY } from '../entitlement';
import { getAuthUser } from '../middleware';
import { Logger } from '../logger';
import { revokeAllTokens } from '../auth';
import { revokeAllDeviceSessions } from '../account/access-sessions';
import {
  deleteHolidayAdjustmentYear,
  listHolidayAdjustmentYearsForAdmin,
  parseHolidayYearPut,
  replaceHolidayAdjustmentYear,
} from '../holidays/holiday-adjustment-store';
import { requireAdmin } from './admin.middleware';
import { createBillingAdapterRegistry } from '../billing/registry';
import type { BillingAdapter } from '../billing/types';
import {
  decideRefund,
  listRefunds,
  refundChannelOf,
  requestRefund,
  submitRefundToChannel,
} from '../billing/refund-store';
import { createPrismaSqlExecutor } from '../billing/pricing-store';
import {
  ANNOUNCEMENT_LEVELS,
  announcementStateAt,
  listAllAnnouncements,
  publishAnnouncement,
  withdrawAnnouncement,
} from '../announcements/announcement-store';
import { prisma } from '../db';

/** epoch 毫秒。`null` 原样返回（"未知"与 0 是两件事）。 */
const toMs = (value: bigint | null): number | null => (value === null ? null : Number(value));

/** epoch 毫秒，必填列。 */
const toMsRequired = (value: bigint): number => Number(value);

/**
 * 金额（最小货币单位）。
 *
 * 用 `Number` 是安全的：分单位金额远低于 `Number.MAX_SAFE_INTEGER`（2^53-1）。
 * 真正会溢出的是纳秒时间戳那一类，这里没有。
 */
const toMinor = (value: bigint | number): number => Number(value);

/** 分页参数。上限刻意比通知列表宽（后台是宽屏表格），但仍有上限。 */
const PageQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});
const DEFAULT_LIMIT = 50;

/** 用户列表的搜索词。空串等同于不搜索。 */
const UserListQuerySchema = PageQuerySchema.extend({
  q: z.string().trim().max(200).optional(),
});

const QuotaBodySchema = z.object({
  // 1 MiB 下限：把配额设成 0 会让那台设备**立刻**同步不了，且用户看不懂为什么。
  // 要停用一个人应该是停用账号，不是把配额调到 0 制造一个"神秘故障"。
  quotaBytes: z.coerce
    .number()
    .int()
    .min(1024 * 1024)
    .max(1024 * 1024 * 1024 * 1024),
});

const IdParamSchema = z.object({ id: z.coerce.number().int().positive() });

/** 分页信封。统一形状 ⇒ 前端一个表格组件能吃所有列表。 */
interface Page<T> {
  readonly items: T[];
  readonly total: number;
  readonly limit: number;
  readonly offset: number;
}

function pageParams(query: { limit?: number; offset?: number }): { take: number; skip: number } {
  return { take: query.limit ?? DEFAULT_LIMIT, skip: query.offset ?? 0 };
}

// ─────────────────────────────────────────────────────────────────────
// 投影（白名单）
// ─────────────────────────────────────────────────────────────────────

/** 列表里的用户行。**刻意不含**任何 token / 密码哈希。 */
const USER_LIST_SELECT = {
  id: true,
  email: true,
  isVerified: true,
  isAdmin: true,
  lockedUntil: true,
  createdAt: true,
  storageUsedBytes: true,
  storageQuotaBytes: true,
} as const;

type UserListRow = {
  id: number;
  email: string;
  isVerified: number;
  isAdmin: boolean;
  lockedUntil: bigint | null;
  createdAt: Date;
  storageUsedBytes: bigint;
  storageQuotaBytes: bigint;
};

function projectUserListRow(row: UserListRow, now: number) {
  return {
    id: row.id,
    email: row.email,
    isVerified: row.isVerified === 1,
    isAdmin: row.isAdmin,
    // 🔴 `locked` 是**算出来的**，不是把 `lockedUntil` 原样给出去 ——
    // 一个过去的时间戳在前端看是"已锁定"，而它其实早就自动解锁了。
    locked: row.lockedUntil !== null && Number(row.lockedUntil) > now,
    lockedUntil: toMs(row.lockedUntil),
    createdAt: row.createdAt.getTime(),
    storageUsedBytes: toMinor(row.storageUsedBytes),
    storageQuotaBytes: toMinor(row.storageQuotaBytes),
  };
}

// ─────────────────────────────────────────────────────────────────────
// 路由
// ─────────────────────────────────────────────────────────────────────

/**
 * 后台路由的可选注入。**只有退款那三条需要它**：
 * 发起退款要挑一个支付通道 adapter，而"挑哪个"是配置事实，不是路由能猜的。
 *
 * ⚠️ 不传 = 这台实例没有配任何通道 ⇒ 批准会落到 `channel-failed`
 * （`noop.adapter.ts#refund` 抛 `BILLING_PROVIDER_NOT_CONFIGURED`），
 * 而**权益一格不动**。这不是降级路径，它就是"没有通道"的如实结果。
 */
export interface AdminRoutesOptions {
  readonly adapters?: readonly BillingAdapter[];
}

export const adminRoutes = async (
  fastify: FastifyInstance,
  options: AdminRoutesOptions = {},
): Promise<void> => {
  // 🔴 一个**路由级**的闸门：下面每条路由都继承它。
  //    用插件级 `addHook` 而不是给每条路由重复写 `preHandler` —— 漏写一条就是一个洞，
  //    而漏写是**静默**的。认证与判权都在 `requireAdmin` 内部按代码顺序完成。
  fastify.addHook('preHandler', requireAdmin);

  // ── 概览 ──────────────────────────────────────────────────────────
  fastify.get('/overview', async (_req, reply) => {
    try {
      const now = Date.now();
      const entitledStatuses = [...DEFAULT_ENTITLEMENT_POLICY.entitledStatuses];

      const [
        usersTotal,
        usersVerified,
        usersAdmins,
        usersLocked,
        subscriptionGroups,
        orderGroups,
        paidOrders,
        couponsTotal,
        couponsEnabled,
        redemptionsSettled,
        inviteCodes,
        inviteCodesDisabled,
        referralsTotal,
        referralsActivated,
        referralsRewarded,
      ] = await Promise.all([
        prisma.user.count(),
        prisma.user.count({ where: { isVerified: 1 } }),
        prisma.user.count({ where: { isAdmin: true } }),
        prisma.user.count({ where: { lockedUntil: { gt: BigInt(now) } } }),
        // 不写死状态词表：按状态分组返回，词表变了这里自动跟着变。
        prisma.subscription.groupBy({ by: ['status'], _count: { _all: true } }),
        prisma.checkoutOrder.groupBy({ by: ['status'], _count: { _all: true } }),
        // 营收按币种分组 —— 混币求和是一个**错得很像真的**数字。
        prisma.checkoutOrder.groupBy({
          by: ['currency'],
          where: { paidAt: { not: null } },
          _sum: { finalAmountMinor: true },
          _count: { _all: true },
        }),
        prisma.coupon.count(),
        prisma.coupon.count({ where: { enabled: true } }),
        // 🔴 「已结算」是 `settledAt` 这一列，不是 `state` 的一个取值 ——
        //   `REDEMPTION_STATES` 只有 reserved/applied/expired/reversed，写 `state: 'settled'`
        //   会命中一个**存在的索引**从而又快又错地恒返回 0。
        prisma.couponRedemption.count({ where: { settledAt: { not: null } } }),
        prisma.inviteCode.count(),
        prisma.inviteCode.count({ where: { disabled: true } }),
        prisma.referral.count(),
        prisma.referral.count({ where: { activatedAt: { not: null } } }),
        prisma.referral.count({ where: { rewardedAt: { not: null } } }),
      ]);

      const activeSubscriptions = subscriptionGroups
        .filter((group) => group.status !== null && entitledStatuses.includes(group.status))
        .reduce((sum, group) => sum + group._count._all, 0);

      return reply.send({
        users: {
          total: usersTotal,
          verified: usersVerified,
          admins: usersAdmins,
          locked: usersLocked,
        },
        subscriptions: {
          total: subscriptionGroups.reduce((sum, group) => sum + group._count._all, 0),
          active: activeSubscriptions,
          entitledStatuses,
          byStatus: subscriptionGroups.map((group) => ({
            status: group.status,
            count: group._count._all,
          })),
        },
        orders: {
          total: orderGroups.reduce((sum, group) => sum + group._count._all, 0),
          byStatus: orderGroups.map((group) => ({
            status: group.status,
            count: group._count._all,
          })),
          paidByCurrency: paidOrders.map((group) => ({
            currency: group.currency,
            paidOrders: group._count._all,
            revenueMinor: toMinor(group._sum.finalAmountMinor ?? 0),
          })),
        },
        coupons: {
          total: couponsTotal,
          enabled: couponsEnabled,
          settledRedemptions: redemptionsSettled,
        },
        invites: {
          codes: inviteCodes,
          codesDisabled: inviteCodesDisabled,
          referrals: referralsTotal,
          referralsActivated,
          referralsRewarded,
        },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      Logger.error(`Admin overview error: ${message}`);
      return reply.status(500).send({ code: 'failed_to_load_admin_overview', message: 'Failed to load admin overview.' });
    }
  });

  // ── 用户 ──────────────────────────────────────────────────────────
  fastify.get('/users', async (req, reply) => {
    const parsed = UserListQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return reply.status(400).send({ code: 'invalid_query_parameters', message: 'Invalid query parameters.' });
    }
    const { take, skip } = pageParams(parsed.data);
    const q = parsed.data.q;

    // 🔴 搜索是 `contains` + `insensitive`：后台最常用的动作就是
    // "拿一个用户报的邮箱去搜"，而人报邮箱时大小写与空格都不确定。
    const where =
      q === undefined || q === ''
        ? {}
        : { email: { contains: q, mode: 'insensitive' as const } };

    try {
      const now = Date.now();
      const [total, rows] = await Promise.all([
        prisma.user.count({ where }),
        prisma.user.findMany({
          where,
          select: USER_LIST_SELECT,
          orderBy: { id: 'desc' },
          take,
          skip,
        }),
      ]);

      const page: Page<ReturnType<typeof projectUserListRow>> = {
        items: rows.map((row) => projectUserListRow(row, now)),
        total,
        limit: take,
        offset: skip,
      };
      return reply.send(page);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      Logger.error(`Admin user list error: ${message}`);
      return reply.status(500).send({ code: 'failed_to_load_users', message: 'Failed to load users.' });
    }
  });

  fastify.get('/users/:id', async (req, reply) => {
    const parsed = IdParamSchema.safeParse(req.params);
    if (!parsed.success) return reply.status(400).send({ code: 'invalid_user_id', message: 'Invalid user id.' });

    try {
      const now = Date.now();
      const user = await prisma.user.findUnique({
        where: { id: parsed.data.id },
        select: {
          ...USER_LIST_SELECT,
          failedLoginAttempts: true,
          termsAcceptedAt: true,
          termsDocumentVersion: true,
          tokenVersion: true,
          subscriptions: {
            select: {
              id: true,
              provider: true,
              priceId: true,
              status: true,
              grants: true,
              currentPeriodEnd: true,
              createdAt: true,
              updatedAt: true,
            },
            orderBy: { id: 'desc' },
          },
          checkoutOrders: {
            select: {
              id: true,
              outTradeNo: true,
              provider: true,
              priceId: true,
              currency: true,
              finalAmountMinor: true,
              discountMinor: true,
              status: true,
              createdAt: true,
              paidAt: true,
            },
            orderBy: { id: 'desc' },
            take: 50,
          },
          devices: {
            select: {
              clientId: true,
              deviceName: true,
              appVersion: true,
              lastSeenAt: true,
            },
            orderBy: { lastSeenAt: 'desc' },
            take: 50,
          },
          // 🔴 只数个数，**不取** `credentialId` / 公钥 —— 那是指纹类标识，
          // 后台不需要它，"顺手带上"只会扩大泄漏面。
          _count: { select: { passkeys: true, operations: true, notifications: true } },
        },
      });

      if (user === null) return reply.status(404).send({ code: 'user_not_found', message: 'User not found.' });

      return reply.send({
        user: {
          ...projectUserListRow(user, now),
          failedLoginAttempts: user.failedLoginAttempts,
          termsAcceptedAt: toMs(user.termsAcceptedAt),
          // 同意留痕的版本指针。`null` 不是"没同意"，是"这条记录证明不了哪一版"
          //（老账号，或运营者自托管实例上的账号）—— 后台要能把这两种情况分开说。
          termsDocumentVersion: user.termsDocumentVersion,
          tokenVersion: user.tokenVersion,
        },
        counts: {
          passkeys: user._count.passkeys,
          operations: user._count.operations,
          notifications: user._count.notifications,
        },
        subscriptions: user.subscriptions.map((s) => ({
          id: s.id,
          provider: s.provider,
          priceId: s.priceId,
          status: s.status,
          grants: s.grants,
          currentPeriodEnd: toMs(s.currentPeriodEnd),
          createdAt: toMsRequired(s.createdAt),
          updatedAt: toMsRequired(s.updatedAt),
        })),
        orders: user.checkoutOrders.map((o) => ({
          id: o.id,
          outTradeNo: o.outTradeNo,
          provider: o.provider,
          priceId: o.priceId,
          currency: o.currency,
          finalAmountMinor: o.finalAmountMinor,
          discountMinor: o.discountMinor,
          status: o.status,
          createdAt: toMsRequired(o.createdAt),
          paidAt: toMs(o.paidAt),
        })),
        devices: user.devices.map((d) => ({
          clientId: d.clientId,
          deviceName: d.deviceName,
          appVersion: d.appVersion,
          lastSeenAt: toMsRequired(d.lastSeenAt),
        })),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      Logger.error(`Admin user detail error: ${message}`);
      return reply.status(500).send({ code: 'failed_to_load_user', message: 'Failed to load user.' });
    }
  });

  // ── 三个支持动作（都不碰钱，都可逆）────────────────────────────────

  /**
   * 解锁账号。
   *
   * 清 `lockedUntil` **并且**清 `failedLoginAttempts` —— 只清前者会让用户
   * 再输错一次就**立刻**又被锁上（计数还在阈值附近），而工单会再回来一次。
   */
  fastify.post('/users/:id/unlock', async (req, reply) => {
    const parsed = IdParamSchema.safeParse(req.params);
    if (!parsed.success) return reply.status(400).send({ code: 'invalid_user_id', message: 'Invalid user id.' });

    try {
      const user = await prisma.user.update({
        where: { id: parsed.data.id },
        data: { lockedUntil: null, failedLoginAttempts: 0 },
        select: { id: true, email: true },
      });
      // 日志里不落邮箱：GDPR 下这是可识别个人信息，而日志既没有脱敏也没有到期删除机制
      // （隐私政策自己就写着这句）。审计要的是"谁被解锁了"，userId 足够定位。
      Logger.info(`Admin unlocked user #${String(user.id)}`);
      return reply.send({ ok: true, user });
    } catch (err) {
      // Prisma 的 P2025 = 记录不存在。这是预期结果（并发删除 / 手输错 id），
      // 不该报 500。
      if (typeof err === 'object' && err !== null && (err as { code?: string }).code === 'P2025') {
        return reply.status(404).send({ code: 'user_not_found', message: 'User not found.' });
      }
      const message = err instanceof Error ? err.message : 'Unknown error';
      Logger.error(`Admin unlock error: ${message}`);
      return reply.status(500).send({ code: 'failed_to_unlock_user', message: 'Failed to unlock user.' });
    }
  });

  fastify.post('/users/:id/quota', async (req, reply) => {
    const params = IdParamSchema.safeParse(req.params);
    if (!params.success) return reply.status(400).send({ code: 'invalid_user_id', message: 'Invalid user id.' });
    const body = QuotaBodySchema.safeParse(req.body);
    if (!body.success) {
      return reply.status(400).send({
        code: 'invalid_quota',
        message: 'Invalid quota.',
        details: body.error.issues.map((issue) => issue.message),
      });
    }

    try {
      const user = await prisma.user.update({
        where: { id: params.data.id },
        data: { storageQuotaBytes: BigInt(body.data.quotaBytes) },
        select: { id: true, email: true, storageQuotaBytes: true, storageUsedBytes: true },
      });
      Logger.info(
        `Admin set quota of user #${String(user.id)} to ${String(body.data.quotaBytes)} bytes`,
      );
      return reply.send({
        ok: true,
        user: {
          id: user.id,
          email: user.email,
          storageQuotaBytes: toMinor(user.storageQuotaBytes),
          storageUsedBytes: toMinor(user.storageUsedBytes),
        },
      });
    } catch (err) {
      if (typeof err === 'object' && err !== null && (err as { code?: string }).code === 'P2025') {
        return reply.status(404).send({ code: 'user_not_found', message: 'User not found.' });
      }
      const message = err instanceof Error ? err.message : 'Unknown error';
      Logger.error(`Admin quota error: ${message}`);
      return reply.status(500).send({ code: 'failed_to_update_quota', message: 'Failed to update quota.' });
    }
  });

  /**
   * 强制登出：让该账号**已签发**的全部 JWT 立刻失效。
   *
   * 🔴 这里原来只写了一行 `tokenVersion: { increment: 1 }` 的 `user.update` ——
   * 那个形状**看起来**是止血，实际三件事都没做，而 ADR-0063 之后每一处撤销都必须同时做完三件：
   *
   * | 缺的那一件 | 不做的后果 |
   *|---|---|
   *| `authCache.invalidate(userId)` | 缓存命中那条路**整段跳过 DB 读**，而 `verifyToken` 是拿令牌里的 `tokenVersion` 与**缓存里那一格**比 —— 两边都是旧值，于是照样放行。一台正在同步的设备可以让这次强制登出**永远不生效**（`get()` 每次命中都把有效期往后推）。 |
   *| 会话行没删（`revokeAllSessions`） | `access_sessions` 的行留着，界面上那些会话仍然显示"活着"。 |
   *| `closeForUser(userId)` | 实时通道是在**升级时**鉴权的：不关掉，旧令牌继续收 op 通知。 |
   *
   * 三条都不是假设：第一条是本批次在 `account-security.routes.ts` 里逐处补的那条纪律，
   * 后台这一处是它的**同一个类的最后一个成员**（`grep 'tokenVersion: { increment'` 能数全）。
   *
   * ⚠️ 它**不撤销 passkey**：通行密钥是设备本地的，撤销要用户自己在设置里删（ADR-0029）。
   */
  fastify.post('/users/:id/logout', async (req, reply) => {
    const parsed = IdParamSchema.safeParse(req.params);
    if (!parsed.success) return reply.status(400).send({ code: 'invalid_user_id', message: 'Invalid user id.' });

    try {
      // 收口函数：抬版本 + 抬完/抬前各失效一次缓存（那一对 invalidate 是承重的，
      // 不在这里重新抄一遍 —— 抄一份就是给下一次漏一条留位置）。
      const central = centralRuntime();
      if (central) await central.coordinator.logoutProduct(parsed.data.id);
      else await revokeAllTokens(parsed.data.id);
      // 上面那张表的后两件事是一个助手（`revokeAllDeviceSessions` = 删会话行 + 关实时通道）：
      // 两半分开写正是这一族漏掉东西的形状 —— 漏掉的那一半没有任何界面会报出来。
      if (!central) await revokeAllDeviceSessions(parsed.data.id);

      const user = await prisma.user.findUniqueOrThrow({
        where: { id: parsed.data.id },
        select: { id: true, email: true, tokenVersion: true },
      });
      // 同上：强制登出的审计行不落邮箱明文（`admin-log-pii` 门禁会红，见
      // `server/tests/admin-log-pii.spec.ts`）。
      Logger.info(`Admin forced logout of user #${String(user.id)}`);
      return reply.send({ ok: true, user });
    } catch (err) {
      if (typeof err === 'object' && err !== null && (err as { code?: string }).code === 'P2025') {
        return reply.status(404).send({ code: 'user_not_found', message: 'User not found.' });
      }
      const message = err instanceof Error ? err.message : 'Unknown error';
      Logger.error(`Admin logout error: ${message}`);
      return reply.status(500).send({ code: 'failed_to_force_logout', message: 'Failed to force logout.' });
    }
  });

  // ── 订阅 / 订单 / 优惠码 / 邀请 ────────────────────────────────────
  fastify.get('/subscriptions', async (req, reply) => {
    const parsed = PageQuerySchema.safeParse(req.query);
    if (!parsed.success) return reply.status(400).send({ code: 'invalid_query_parameters', message: 'Invalid query parameters.' });
    const { take, skip } = pageParams(parsed.data);

    try {
      const [total, rows] = await Promise.all([
        prisma.subscription.count(),
        prisma.subscription.findMany({
          select: {
            id: true,
            userId: true,
            provider: true,
            priceId: true,
            status: true,
            grants: true,
            currentPeriodEnd: true,
            createdAt: true,
            user: { select: { email: true } },
          },
          orderBy: { id: 'desc' },
          take,
          skip,
        }),
      ]);

      return reply.send({
        items: rows.map((s) => ({
          id: s.id,
          userId: s.userId,
          email: s.user.email,
          provider: s.provider,
          priceId: s.priceId,
          status: s.status,
          grants: s.grants,
          currentPeriodEnd: toMs(s.currentPeriodEnd),
          createdAt: toMsRequired(s.createdAt),
        })),
        total,
        limit: take,
        offset: skip,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      Logger.error(`Admin subscriptions error: ${message}`);
      return reply.status(500).send({ code: 'failed_to_load_subscriptions', message: 'Failed to load subscriptions.' });
    }
  });

  fastify.get('/orders', async (req, reply) => {
    const parsed = PageQuerySchema.safeParse(req.query);
    if (!parsed.success) return reply.status(400).send({ code: 'invalid_query_parameters', message: 'Invalid query parameters.' });
    const { take, skip } = pageParams(parsed.data);

    try {
      const [total, rows] = await Promise.all([
        prisma.checkoutOrder.count(),
        prisma.checkoutOrder.findMany({
          select: {
            id: true,
            outTradeNo: true,
            userId: true,
            provider: true,
            priceId: true,
            currency: true,
            region: true,
            originalAmountMinor: true,
            discountMinor: true,
            finalAmountMinor: true,
            status: true,
            createdAt: true,
            paidAt: true,
            user: { select: { email: true } },
          },
          orderBy: { id: 'desc' },
          take,
          skip,
        }),
      ]);

      return reply.send({
        items: rows.map((o) => ({
          id: o.id,
          outTradeNo: o.outTradeNo,
          userId: o.userId,
          email: o.user.email,
          provider: o.provider,
          priceId: o.priceId,
          currency: o.currency,
          region: o.region,
          originalAmountMinor: o.originalAmountMinor,
          discountMinor: o.discountMinor,
          finalAmountMinor: o.finalAmountMinor,
          status: o.status,
          createdAt: toMsRequired(o.createdAt),
          paidAt: toMs(o.paidAt),
        })),
        total,
        limit: take,
        offset: skip,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      Logger.error(`Admin orders error: ${message}`);
      return reply.status(500).send({ code: 'failed_to_load_orders', message: 'Failed to load orders.' });
    }
  });

  fastify.get('/coupons', async (req, reply) => {
    const parsed = PageQuerySchema.safeParse(req.query);
    if (!parsed.success) return reply.status(400).send({ code: 'invalid_query_parameters', message: 'Invalid query parameters.' });
    const { take, skip } = pageParams(parsed.data);

    try {
      const [total, rows] = await Promise.all([
        prisma.coupon.count(),
        prisma.coupon.findMany({
          select: {
            id: true,
            code: true,
            name: true,
            kind: true,
            percentOffBp: true,
            amountOffMinor: true,
            currency: true,
            enabled: true,
            validFrom: true,
            validUntil: true,
            maxRedemptions: true,
            // 核销数用 `_count` 数，不把核销行本身拉出来（那是另一张会长的表）。
            _count: { select: { redemptions: true } },
          },
          orderBy: { createdAt: 'desc' },
          take,
          skip,
        }),
      ]);

      return reply.send({
        items: rows.map((c) => ({
          id: c.id,
          code: c.code,
          name: c.name,
          kind: c.kind,
          percentOffBp: c.percentOffBp,
          amountOffMinor: c.amountOffMinor,
          currency: c.currency,
          enabled: c.enabled,
          validFrom: toMsRequired(c.validFrom),
          validUntil: toMs(c.validUntil),
          maxRedemptions: c.maxRedemptions,
          redemptions: c._count.redemptions,
        })),
        total,
        limit: take,
        offset: skip,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      Logger.error(`Admin coupons error: ${message}`);
      return reply.status(500).send({ code: 'failed_to_load_coupons', message: 'Failed to load coupons.' });
    }
  });

  fastify.get('/invites', async (req, reply) => {
    const parsed = PageQuerySchema.safeParse(req.query);
    if (!parsed.success) return reply.status(400).send({ code: 'invalid_query_parameters', message: 'Invalid query parameters.' });
    const { take, skip } = pageParams(parsed.data);

    try {
      const [referralsTotal, codesTotal, codes, referrals] = await Promise.all([
        prisma.referral.count(),
        prisma.inviteCode.count(),
        prisma.inviteCode.findMany({
          select: {
            id: true,
            code: true,
            disabled: true,
            createdAt: true,
            userId: true,
            user: { select: { email: true } },
          },
          orderBy: { id: 'desc' },
          take,
          skip,
        }),
        prisma.referral.findMany({
          select: {
            id: true,
            code: true,
            createdAt: true,
            activatedAt: true,
            rewardDays: true,
            rewardedAt: true,
            inviter: { select: { id: true, email: true } },
            invitee: { select: { id: true, email: true } },
          },
          orderBy: { id: 'desc' },
          take,
          skip,
        }),
      ]);

      return reply.send({
        codes: {
          items: codes.map((c) => ({
            id: c.id,
            code: c.code,
            disabled: c.disabled,
            createdAt: toMsRequired(c.createdAt),
            userId: c.userId,
            email: c.user.email,
          })),
          total: codesTotal,
          limit: take,
          offset: skip,
        },
        referrals: {
          items: referrals.map((r) => ({
            id: r.id,
            code: r.code,
            createdAt: toMsRequired(r.createdAt),
            activatedAt: toMs(r.activatedAt),
            rewardDays: r.rewardDays,
            rewardedAt: toMs(r.rewardedAt),
            inviter: r.inviter,
            invitee: r.invitee,
          })),
          total: referralsTotal,
          limit: take,
          offset: skip,
        },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      Logger.error(`Admin invites error: ${message}`);
      return reply.status(500).send({ code: 'failed_to_load_invites', message: 'Failed to load invites.' });
    }
  });

  // ── 调休/补班（公共事实的唯一写入口）。W4b，定性见 ADR-0052 ─────────
  //
  // 🔴 这三条路由是这个服务端上**唯一**能写"会下发给所有人的内容"的地方，
  //    所以它们继承上面那个插件级闸门（`addHook('preHandler', requireAdmin)`）。
  //    闸门挂在这个文件里而不是 `admin.middleware.ts` —— 那个文件只有 `requireAdmin`
  //    的**定义**；把注册当挂载等于没挂（工单原句就是这么写的，实测纠正过）。
  //
  //    为什么这件事值得单独一句：公共事实的**读**面是匿名的
  //   （`GET /api/holiday-adjustments`），而**写**面是全后台权限最高的一组。
  //    两者路径只差一个前缀（`/api/` vs `/api/admin/`），一个漏掉鉴权的复制粘贴
  //    就会把"任何人可改国务院公告"变成一个 200。
  fastify.get('/holiday-adjustments', async (_req, reply) => {
    try {
      // 🔴 与公开那条读**同一次换算**（`fetchYearRows`），只是出参多了元信息。
      return reply.send(await listHolidayAdjustmentYearsForAdmin());
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      Logger.error(`Admin holiday adjustments error: ${message}`);
      return reply.status(500).send({ code: 'failed_to_load_holiday_adjustments', message: 'Failed to load holiday adjustments.' });
    }
  });

  fastify.put('/holiday-adjustments/years', async (req, reply) => {
    // 判据③的**实际载体**：非法日期 / `isOffDay` 不是布尔 ⇒ 400 + 逐字段原因。
    // ⚠️ 校验入口只有 `parseHolidayYearPut` 这一个（它包着契约里那份
    //    `holidayYearPutSchema`）。在 handler 里另写一份 zod 就是 §3.5 那条
    //    "同一个判断抄两遍"，而两遍的区别会表现为"HTTP 收了、CLI 拒了"。
    const parsed = parseHolidayYearPut(req.body);
    if (!parsed.success) {
      return reply.status(400).send({
        code: 'invalid_holiday_adjustment_year',
        message: 'Invalid holiday adjustment year.',
        // 逐字段回给运营看。**不含**任何用户数据 —— 这里根本没有用户数据可泄，
        // 而把 `issues` 原样返回是 zod 的默认形状，改写成"人类可读"要一套映射、
        // 一套映射就会漂。
        issues: parsed.error.issues.map((i) => ({
          path: i.path.join('.'),
          message: i.message,
        })),
      });
    }

    // 操作者邮箱：`updatedBy` 是审计事实。`requireAdmin` 只查了 `isAdmin`
    //（它不必读 email），所以这里补一次按主键的 `findUnique` ——
    // 写一年一次，这次查询不是热路径。
    const actor = await prisma.user.findUnique({
      where: { id: getAuthUser(req).userId },
      select: { email: true },
    });

    try {
      await replaceHolidayAdjustmentYear({
        year: parsed.data.year,
        papers: parsed.data.papers,
        note: parsed.data.note ?? null,
        days: parsed.data.days,
        updatedAt: Date.now(),
        updatedBy: actor?.email ?? null,
      });
    } catch (err) {
      // 🔴 走到了这里说明**契约层放过、库层拒了** —— 两层校验的并集漏了一格。
      // 不能报 500 就当没事：500 会让运营以为"服务坏了，等等再试"，
      // 而那一条数据永远进不去。报 400 + 把原始信息记进日志（日志是唯一能
      // 指出"哪一层该补一条 CHECK"的地方）。
      const message = err instanceof Error ? err.message : 'Unknown error';
      Logger.error(
        `Admin holiday adjustment PUT rejected by the database (zod accepted it): ${message}`,
      );
      return reply.status(400).send({ code: 'rejected_by_database_constraints', message: 'Rejected by database constraints.', rejectedBy: 'database' });
    }

    // 🔴 判据②：`papers` 随数据入库且**能回显**。回显在 PUT 的响应里也给一份，
    //    是为了让"提交了 3 条出处、界面只显示 2 条"这种丢法当场可见 ——
    //    只让运营去刷列表的话，丢一行与列表坏了分不开。
    return reply.send({
      ok: true,
      year: parsed.data.year,
      papers: parsed.data.papers,
      dayCount: parsed.data.days.length,
    });
  });

  fastify.delete('/holiday-adjustments/years', async (req, reply) => {
    // 年份走查询串而不是 `/years/:year` —— 与 PUT 同一口径，理由见契约里
    // `HOLIDAY_ADJUSTMENT_PATHS.adminDelete` 那段（两个来源 = 一条必须额外写的守卫）。
    const parsed = holidayAdjustmentAdminDeleteQuerySchema.safeParse(req.query);
    if (!parsed.success) return reply.status(400).send({ code: 'invalid_query_parameters', message: 'Invalid query parameters.' });

    const deleted = await deleteHolidayAdjustmentYear(parsed.data.year);
    // 0 = 那一年本来就没录过。**这是幂等成功**，不是 404：
    // "撤销一次录入"重复执行一次没有副作用，而把它报成错误会让运营以为没撤销掉。
    return reply.send({ ok: true, year: parsed.data.year, deleted });
  });

  // ── 退款（ADR-0053） ─────────────────────────────────────────────
  //
  // 🔴 这三条是**动钱**的入口，所以它们的设计前提与上面那些"改配置"的路由不同：
  // 每一个失败模式都必须留下一个**可举证的状态**，而不是一个 HTTP 码。
  // 具体说：批准之后如果通道拒了，响应是 200 + `status:'failed'`，
  // 不是 500 —— 因为"批准"这个决定**已经成立并落库**了，报 500 会让运营
  // 以为什么都没发生而再点一次，而那一次点下去是**第二次向通道发起退款**。
  //
  // ⚠️ ADR-0038 当年把"退款"列在后台范围**之外**，理由是那时没有任何支付通道。
  // 通道接通之后这一项由 ADR-0053 修订；本文件不重述那份理由。

  const refundRequestSchema = z.object({
    orderId: z.number().int().positive(),
    note: z.string().trim().min(1).max(500).optional(),
    // 🔴 跳过时间窗的唯一开关。它**必须**配一句理由（下面的 refine），
    // 因为一次没有理由的例外批准在事后与"运营手滑"无法区分。
    operatorApproved: z.boolean().optional(),
  }).refine(
    (value) => value.operatorApproved !== true || (value.note !== undefined && value.note.length > 0),
    { message: 'operatorApproved requires a non-empty note', path: ['note'] },
  );

  const refundDecisionSchema = z.object({
    note: z.string().trim().min(1).max(500),
  });

  const adminActor = async (userId: number): Promise<string> => `admin:${userId}`;

  fastify.get('/refunds', async (req, reply) => {
    const query = z
      .object({
        userId: z.coerce.number().int().positive().optional(),
        limit: z.coerce.number().int().positive().max(200).optional(),
      })
      .safeParse(req.query);
    if (!query.success) return reply.status(400).send({ code: 'invalid_query_parameters', message: 'Invalid query parameters.' });

    try {
      const refunds = await listRefunds(createPrismaSqlExecutor(prisma), {
        userId: query.data.userId,
        limit: query.data.limit,
      });
      return reply.send({ refunds });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      Logger.error(`Admin refunds list error: ${message}`);
      return reply.status(500).send({ code: 'failed_to_load_refunds', message: 'Failed to load refunds.' });
    }
  });

  fastify.post('/refunds', async (req, reply) => {
    const parsed = refundRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({
        code: 'invalid_refund_request',
        message: 'Invalid refund request.',
        issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      });
    }
    const actor = await adminActor(getAuthUser(req).userId);

    try {
      const result = await requestRefund(createPrismaSqlExecutor(prisma), {
        orderId: parsed.data.orderId,
        actor,
        note: parsed.data.note,
        operatorApproved: parsed.data.operatorApproved,
        now: Date.now(),
      });

      if (result.outcome === 'not-found') {
        return reply.status(404).send({ code: 'order_not_found', message: 'Order not found.' });
      }
      if (result.outcome === 'denied') {
        // 🔴 409 而不是 400：请求本身是**合法的**，被拒的是那一单当前的状态
        // （过期、已退过、不是收银台的单）。把状态冲突报成"你传错了"，
        // 运营会去改参数重试，而改参数永远改不动"这笔已经过了 7 天"。
        return reply.status(409).send({ code: 'refund_not_allowed', message: 'Refund not allowed.', reason: result.reason });
      }
      return reply.status(201).send({ ok: true, ...result });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      Logger.error(`Admin refund request error: ${message}`);
      return reply.status(500).send({ code: 'failed_to_create_refund', message: 'Failed to create refund.' });
    }
  });

  fastify.post('/refunds/:id/approve', async (req, reply) => {
    const params = req.params as { id?: string };
    const id = z.coerce.number().int().positive().safeParse(params.id);
    const body = refundDecisionSchema.safeParse(req.body);
    if (!id.success || !body.success) {
      return reply.status(400).send({ code: 'invalid_refund_approval', message: 'Invalid refund approval.' });
    }
    const actor = await adminActor(getAuthUser(req).userId);
    const sql = createPrismaSqlExecutor(prisma);

    const decided = await decideRefund(sql, {
      refundId: id.data,
      decision: 'approve',
      actor,
      note: body.data.note,
      now: Date.now(),
    });
    if (decided.outcome === 'not-found') return reply.status(404).send({ code: 'refund_not_found', message: 'Refund not found.' });
    if (decided.outcome === 'not-decidable') {
      // 🔴 409 一律带 `reason` 这个**机器码**：`error` 是给人读的散文，而界面要按码选措辞。
      // 后台那一片拿不到码就只能说"状态冲突"，运营分不清"这条已经决定过了"与"这一单过期了"
      // （ADR-0053 §5 第 11 条）。
      return reply.status(409).send({
        code: 'refund_already_decided_or_finished',
        message: 'Refund already decided or finished.',
        reason: 'NOT_DECIDABLE',
      });
    }

    const channel = await refundChannelOf(sql, id.data);
    if (channel === null) return reply.status(404).send({ code: 'refund_not_found', message: 'Refund not found.' });
    const adapter = createBillingAdapterRegistry(options.adapters ?? []).get(channel.provider);
    if (adapter === undefined) {
      // 订单写着某个 provider，而这台实例**没有**注册它 —— 换过支付商的形状。
      // 如实报 409：批准已经落库，钱没动，等运营把旧通道接回来或改走人工。
      return reply.status(409).send({
        ok: true,
        status: 'approved',
        channel: 'unavailable',
        error: 'Refund provider is not registered on this instance.',
        reason: 'REFUND_PROVIDER_NOT_REGISTERED',
      });
    }

    const submitted = await submitRefundToChannel(sql, {
      refundId: id.data,
      adapter,
      now: Date.now(),
    });
    // 🔴 200 而不是 502：`approved` 这个决定已经成立，通道失败是**下一步**的事实，
    // 它已经如实落在 `refunds.status='failed'` + 审计里。
    return reply.send({ ok: true, ...submitted });
  });

  fastify.post('/refunds/:id/reject', async (req, reply) => {
    const params = req.params as { id?: string };
    const id = z.coerce.number().int().positive().safeParse(params.id);
    const body = refundDecisionSchema.safeParse(req.body);
    if (!id.success || !body.success) {
      return reply.status(400).send({ code: 'invalid_refund_rejection', message: 'Invalid refund rejection.' });
    }

    const decided = await decideRefund(createPrismaSqlExecutor(prisma), {
      refundId: id.data,
      decision: 'reject',
      actor: await adminActor(getAuthUser(req).userId),
      note: body.data.note,
      now: Date.now(),
    });
    if (decided.outcome === 'not-found') return reply.status(404).send({ code: 'refund_not_found', message: 'Refund not found.' });
    if (decided.outcome === 'not-decidable') {
      // 与 approve 那条同一码、同一理由：界面要能区分"这条已经决定过了"与别的状态冲突。
      return reply.status(409).send({
        code: 'refund_already_decided_or_finished',
        message: 'Refund already decided or finished.',
        reason: 'NOT_DECIDABLE',
      });
    }
    // 拒绝**不碰钱也不碰权益** —— 它是这条流程里唯一"什么都不发生"的出口，
    // 所以响应里如实只带状态，不带任何金额或到期日字段。
    return reply.send({ ok: true, ...decided });
  });

  /* ── 营收看板（只读聚合）───────────────────────────────────────
   *
   * 这是后台里**唯一一处把订单行折成数字**的地方，所以它服务的领域就是
   * "这台部署上收了多少、退了多少"。它**不新造任何事实**：
   *
   *   · 进账 = `checkout_orders.paid_at` 非空的那些行，金额取 `final_amount_minor`
   *     （实付，不是标价 —— 用券的那一单按标价计会让看板与对账差一张券）；
   *   · 退款 = `refunds.refunded_at` 非空的那些行。
   *
   * 🔴 退款那一格用的谓词是 `refunded_at IS NOT NULL`，**不是** `status='success'`。
   *   schema 上那条双向 CHECK 让两者此刻等价，但"钱真的出去了"这个事实的载体
   *   是那一列（见 `billing/refund-store.ts` 文件头对 `refunds_success_needs_refunded_at`
   *   的说明）。按状态取，是在读一个**关于**事实的字段，而不是事实本身。
   *
   * 🔴 混币求和是一个"错得很像真的"数字，所以**逐币种各算各的**，
   *   响应里没有任何一个"总计金额"。要跨币种只能比数量，不能比钱。
   *
   * ⚠️ 日界由调用方给的 `offsetMinutes` 裁。这台服务器跑 UTC，而"今天收了多少"
   *   是运营者本地那个日子的问题：不裁的话，北京时间凌晨 0–8 点的进账会算到昨天。
   *   默认 0（UTC）而不是猜一个 —— 界面把自己那个时区的偏移传进来。
   */
  const DAY_MS = 86_400_000;

  const RevenueQuerySchema = z.object({
    days: z.coerce.number().int().min(7).max(365).default(90),
    offsetMinutes: z.coerce.number().int().min(-14 * 60).max(14 * 60).default(0),
  });

  fastify.get('/revenue', async (req, reply) => {
    const query = RevenueQuerySchema.safeParse(req.query);
    if (!query.success) {
      return reply.status(400).send({ code: 'bad_request', message: 'Invalid revenue query.' });
    }
    const { days, offsetMinutes } = query.data;
    const offsetMs = offsetMinutes * 60_000;

    // 先在"运营者的本地时间轴"上取整日边界，再减回偏移换成本机 epoch 毫秒。
    // 反过来做（先裁 UTC 再挪）会在负偏移上取错格子。
    const localNow = Date.now() + offsetMs;
    const localTodayStart = Math.floor(localNow / DAY_MS) * DAY_MS;
    const localWindowStart = localTodayStart - (days - 1) * DAY_MS;
    const fromMs = localWindowStart - offsetMs;
    // 右开边界 = 本地"明天零点"，于是今天这一格是完整的一天（含此刻之后的进账）。
    const toMs = localTodayStart + DAY_MS - offsetMs;

    const [paidRows, refundRows] = await Promise.all([
      prisma.checkoutOrder.findMany({
        where: { paidAt: { not: null, gte: BigInt(fromMs), lt: BigInt(toMs) } },
        select: { paidAt: true, currency: true, finalAmountMinor: true },
      }),
      prisma.refund.findMany({
        where: { refundedAt: { not: null, gte: BigInt(fromMs), lt: BigInt(toMs) } },
        select: { refundedAt: true, currency: true, amountMinor: true },
      }),
    ]);

    /** 一条 epoch 毫秒 → 它所在那个**本地日**的 dayMs（值仍是本机 epoch 毫秒）。 */
    const dayBucket = (valueMs: number): number =>
      Math.floor((valueMs + offsetMs) / DAY_MS) * DAY_MS - offsetMs;

    interface Cell {
      dayMs: number;
      currency: string;
      paidMinor: number;
      refundedMinor: number;
      paidOrders: number;
      refundedOrders: number;
    }
    const cells = new Map<string, Cell>();
    const cellAt = (dayMs: number, currency: string): Cell => {
      const key = `${String(dayMs)}|${currency}`;
      const existing = cells.get(key);
      if (existing !== undefined) return existing;
      const created: Cell = {
        dayMs,
        currency,
        paidMinor: 0,
        refundedMinor: 0,
        paidOrders: 0,
        refundedOrders: 0,
      };
      cells.set(key, created);
      return created;
    };

    for (const row of paidRows) {
      if (row.paidAt === null) continue; // `where` 已经排除，这一格是给类型的那个 null。
      const cell = cellAt(dayBucket(Number(row.paidAt)), row.currency);
      cell.paidMinor += row.finalAmountMinor;
      cell.paidOrders += 1;
    }
    for (const row of refundRows) {
      if (row.refundedAt === null) continue;
      const cell = cellAt(dayBucket(Number(row.refundedAt)), row.currency);
      cell.refundedMinor += row.amountMinor;
      cell.refundedOrders += 1;
    }

    // 出现过的币种（按字母序，响应要可重放）。
    // ⚠️ `[...cells.values()].map(...)` 而不是 `cells.values().map(...)`：后者是
    //    **迭代器助手**（Node 22 运行时支持），但本仓 server 的 `tsc` 目标/lib 不含它
    //    ⇒ `pnpm -r build` 在 `Property 'map' does not exist on type 'MapIterator<Cell>'`
    //    上停住，连带挡住 `reinstall:all` 的第 0 步（2026-10-24 实测）。展开成数组语义等价。
    const currencies = [...new Set([...cells.values()].map((cell) => cell.currency))].sort();

    // 🔴 **每一天都发一个点**，包括零。只发非零日的话，界面上"3 月 5 日"和
    // "3 月 6 日"之间那根没画出来的柱子会被读成"那天没人付钱"，而它其实
    // 只是**没被列出来** —— 零与缺席在两处界面上长得一样，含义完全不同。
    const series = currencies.map((currency) => {
      const points: { dayMs: number; paidMinor: number; refundedMinor: number; paidOrders: number; refundedOrders: number }[] = [];
      for (let i = 0; i < days; i += 1) {
        const dayMs = localWindowStart + i * DAY_MS - offsetMs;
        const cell = cells.get(`${String(dayMs)}|${currency}`);
        points.push({
          dayMs,
          paidMinor: cell?.paidMinor ?? 0,
          refundedMinor: cell?.refundedMinor ?? 0,
          paidOrders: cell?.paidOrders ?? 0,
          refundedOrders: cell?.refundedOrders ?? 0,
        });
      }
      return {
        currency,
        totalPaidMinor: points.reduce((sum, point) => sum + point.paidMinor, 0),
        totalRefundedMinor: points.reduce((sum, point) => sum + point.refundedMinor, 0),
        // 🔴 净收入在**这里**折，不在界面折。"哪些退款算进这一格"是一个业务判定
        // （只有 `refunded_at` 非空的算），让界面自己减一次就是第二套标准 ——
        // 两处的差会表现为"看板与对账差一笔"，而没人知道是哪一侧错了。
        totalNetMinor: points.reduce(
          (sum, point) => sum + point.paidMinor - point.refundedMinor,
          0,
        ),
        totalPaidOrders: points.reduce((sum, point) => sum + point.paidOrders, 0),
        totalRefundedOrders: points.reduce((sum, point) => sum + point.refundedOrders, 0),
        points,
      };
    });

    return reply.send({
      window: { days, offsetMinutes, fromMs, toMs },
      series,
    });
  });

  /* ── 运营公告（写面）──────────────────────────────────────────
   *
   * 定性见 [`docs/adr/0075`](../../../docs/adr/0075-announcements-are-a-content-channel.md)。
   * 三条路由都**不写 `preHandler`** —— 它们继承上面那个插件级 `requireAdmin`
   * （那一条结构性保证：新增路由忘了鉴权是不可能的）。
   *
   * 🔴 时刻是**浏览器算好的 epoch 毫秒**，不是服务端解析的日期串。
   *   `datetime-local` 那个控件给的是"运营者墙上时钟的 10:00"，而这台服务器在 UTC。
   *   服务端 `Date.parse` 一个不带时区的串会按服务器时区解释 ⇒ 差几个小时，
   *   表现是"我说今晚 10 点挂出来，结果 2 点才出现"。换算属于设备本地事实，
   *   所以它住在客户端；这里只收一个数。
   *
   * ⚠️ 这里**不判**"这条该不该发"。有效期、词表、长度都在下面那一道 `safeParse`
   *   与 store 里；界面那一侧多判一次就是第二套标准。
   */
  const AnnouncementPublishSchema = z.object({
    title: z.string().trim().min(1).max(120),
    body: z.string().trim().min(1).max(2_000),
    level: z.enum(ANNOUNCEMENT_LEVELS),
    publishedAtMs: z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    // 不给 = 不过期。给的话必须晚于生效时刻（一条"已经结束了"的公告是一个操作失误，
    // 而不是一个合法状态 —— 那种情况该做的是不发）。
    expiresAtMs: z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
  });

  fastify.get('/announcements', async (_req, reply) => {
    const now = Date.now();
    const announcements = await listAllAnnouncements();
    // 后台这一侧**多给一格 `createdBy`**：运营要知道是谁发的。
    // 用户侧那条读面故意不给（见 `announcements/announcement.routes.ts` 的投影注释）。
    //
    // 🔴 `state` 是**服务端算的**（`announcementStateAt`），界面不许自己比时间戳 ——
    // 那会造出第二个裁决者，而它的症状是"运营以为已经下架了，用户还看得见"。
    return reply.send({
      now,
      announcements: announcements.map((item) => ({
        ...item,
        state: announcementStateAt(item, now),
      })),
    });
  });

  fastify.post('/announcements', async (req, reply) => {
    const body = AnnouncementPublishSchema.safeParse(req.body);
    if (!body.success) {
      return reply.status(400).send({ code: 'bad_request', message: 'Invalid announcement payload.' });
    }
    const publishedAt = body.data.publishedAtMs;
    const expiresAt = body.data.expiresAtMs;
    if (expiresAt !== undefined && expiresAt <= publishedAt) {
      return reply.status(400).send({
        code: 'bad_request',
        message: 'Invalid announcement payload.',
        reason: 'EXPIRES_BEFORE_PUBLISH',
      });
    }
    const created = await publishAnnouncement(
      {
        title: body.data.title,
        body: body.data.body,
        level: body.data.level,
        publishedAt,
        expiresAt: expiresAt ?? null,
      },
      getAuthUser(req).userId,
      Date.now(),
    );
    return reply.send({ ok: true, announcement: created });
  });

  const AnnouncementIdParam = z.object({ id: z.coerce.number().int().positive() });

  fastify.delete('/announcements/:id', async (req, reply) => {
    const id = AnnouncementIdParam.safeParse(req.params);
    if (!id.success) return reply.status(400).send({ code: 'bad_request', message: 'Invalid announcement id.' });
    const withdrawn = await withdrawAnnouncement(id.data.id);
    if (!withdrawn) {
      // 与退款那几条同一立场：**"它已经不在了"不是一句"已完成"**。
      // 把 0 行折成成功，界面就会对一个没发生过的动作点头。
      return reply.status(404).send({ code: 'announcement_not_found', message: 'Announcement not found.' });
    }
    return reply.send({ ok: true, withdrawn: true });
  });
};
