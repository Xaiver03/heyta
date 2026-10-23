/**
 * 共享清单（多人协作）的 HTTP 面：`/api/shares/*`。
 * ============================================
 *
 * 依据：[ADR-0062](../../../docs/adr/0062-shared-list-key-distribution.md)、
 * [计划 §2.4/§3-W2](../../../docs/plans/collaboration-shared-lists.md)。
 *
 * ## 路由总表
 *
 * | 方法 | 路径 | 谁 | 用途 |
 * |---|---|---|---|
 * | POST | `/shares` | 认证 + hosting 闸门 | 创建共享（share + owner 成员行） |
 * | GET  | `/shares` | 认证 | 我的共享列表 + removedMemberships（Etebase 形状） |
 * | GET  | `/shares/:id` | 成员 | 清单详情 |
 * | POST | `/shares/:id/invitations` | owner + hosting 闸门 | 发邀请（返回一次性裸 token，仅此一次） |
 * | GET  | `/shares/:id/invitations` | owner | 邀请列表（白名单投影，无 tokenHash） |
 * | DELETE | `/shares/:id/invitations/:invId` | owner | 吊销邀请 |
 * | POST | `/shares/invitations/accept` | 认证 | 凭 token 入群（带封装公钥；29 人上限） |
 * | GET  | `/shares/:id/members` | 成员 | 成员列表（含 identityPublicKey，owner 封信封要用） |
 * | GET  | `/shares/:id/signing-keys` | 成员 | 签名名册（**含已移除的人**；读侧验签的唯一依据，面板不用它） |
 * | PATCH | `/shares/:id/members/:memberId` | owner | 改角色 |
 * | PUT | `/shares/:id/members/:memberId/envelope` | owner | 下发/更新密钥信封（rekey 的服务端落点） |
 * | PUT | `/shares/:id/members/:memberId/signing-key` | 成员**本人** | 发布逐 op 签名公钥（ADR-0069 裁决二：只补公钥，不动信封、不换世代、不产生 op） |
 * | DELETE | `/shares/:id/members/:memberId` | owner | 移除成员（`removedAt` 置位 + 信封作废；rekey 由 owner 客户端执行） |
 * | POST | `/shares/:id/transfer` | owner | 转让所有权（换 owner + 原 owner 降 editor，一个事务） |
 * | POST | `/shares/:id/leave` | 非 owner 成员 | 退出（自己的信封当场作废） |
 * | POST | `/shares/:id/ops` | 成员 + role 硬门 | share op 上传（独立发号） |
 * | GET  | `/shares/:id/ops/causal` | 成员 | share op 下载（seq 游标） |
 *
 * ## 🔴 服务端是权限的唯一裁决者
 *
 * role 硬门在 `decideShareOpWrite`（纯函数，见 share.membership.ts），
 * 每条 op 单独裁决；`owner` 之外的一切管理动作都要过 `requireShareOwner`。
 * 非成员看到的**一切**都是 404（清单的存在性本身不向外人泄露）。
 *
 * ## BigInt 与白名单投影
 *
 * Prisma 的时间戳列是 `BigInt`，直接 `JSON.stringify` 会 500 —— 出参一律过
 * `toMs()`。响应投影显式列字段（`tokenHash` / `keyEnvelope` 原样不出现在
 * 列表响应里），与 admin.routes 的纪律同源。
 *
 * ## 🔴 entitlement 闸门只拦「创建」
 *
 * 付费墙的规则是「owner 的 hosting 有效即可共享，成员免费」（ADR-0062 决策 8）：
 * 创建共享与发邀请是 owner 的付费动作，挂 `createEntitlementGuard()`（默认
 * hosting）；成员的接受 / 上传 / 下载只认证 —— 拦它们等于向免费成员收钱。
 * 🔴 实现注记：**没有**在 `ENTITLEMENT_CAPABILITIES` 里加 `'sharing'` 词 ——
 * 该词表四处同源（定价文档 / `check-pricing-consistency` / schema 注释 /
 * 迁移 CHECK），而 D7 的规则用既有 `hosting` 就能精确表达；加一个没有
 * grant 映射的词 = 为零行为跑一次 CHECK 迁移 + 养第二处真值。偏差已登记
 * 计划 §2.6；将来「共享独立计价」的那天再加词，成本不变。
 */

import { createHash, randomBytes, randomUUID } from 'node:crypto';

import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import {
  SuperSyncOperationSchema,
  SuperSyncUploadOperationSchema,
} from '@heyta/shared-schema';

// 🔴 判定本体在 `@heyta/sync-core`，服务端只做"结局 → 错误码"的映射（ADR-0069 裁决三/四）。
// 自己在这儿拼一份签名域 = 第二份"签哪些字节"的定义，而两份迟早漂一点：
// 漂的那一点在协议上是**每台非签名者的设备把自己人的合法签名读成失败**。
import {
  classifyShareOpSignature,
  type ShareOpSignatureOutcome,
  type ShareOpWireForSignature,
} from '@heyta/sync-core';

import { Prisma } from '@prisma/client';

import { createEntitlementGuard } from '../entitlement';
import { Logger } from '../logger';
import { authenticate, getAuthUser } from '../middleware';
import { prisma } from '../db';
import { getWsConnectionService } from '../sync/services/websocket-connection.service';
import {
  decideShareOpWrite,
  INVITATION_DEFAULT_TTL_DAYS,
  INVITATION_MAX_TTL_DAYS,
  isShareMemberRole,
  MAX_SHARE_MEMBERS,
  ShareMemberRole,
} from './share.membership';

/** 共享域专用错误码。独立于 `SUPER_SYNC_ERROR_CODES`（那是同步线协议词表，
 * 别把权限语义塞进去 —— 与 entitlement.ts 不污染线协议码是同一条纪律）。 */
export const SHARE_ERROR_CODES = {
  NOT_FOUND: 'SHARE_NOT_FOUND',
  ROLE_FORBIDDEN: 'SHARE_ROLE_FORBIDDEN',
  ENTITY_TYPE_NOT_SHAREABLE: 'SHARE_ENTITY_TYPE_NOT_SHAREABLE',
  MEMBER_LIMIT: 'SHARE_MEMBER_LIMIT',
  INVITATION_INVALID: 'SHARE_INVITATION_INVALID',
  INVITATION_EXPIRED: 'SHARE_INVITATION_EXPIRED',
  INVITATION_REVOKED: 'SHARE_INVITATION_REVOKED',
  ALREADY_MEMBER: 'SHARE_ALREADY_MEMBER',
  OWNER_CANNOT_LEAVE: 'SHARE_OWNER_CANNOT_LEAVE',
  /** B-10：转让的接收方手里没有**当前世代**的清单钥（信封为空，或世代落后）。
   * 单独一枚码而不是 `ROLE_FORBIDDEN` —— 那是"你没资格操作"，这是"对方现在解不开"。 */
  TRANSFER_TARGET_UNSEALED: 'SHARE_TRANSFER_TARGET_UNSEALED',
  /** ADR-0069 裁决二：签名公钥只有「首次发布」这一种写法。已在册且不同 ⇒ 冲突。
   * 不换签名钥不是偷懒：换钥会让读侧**再也分不出**这个人前后的 op 各是谁的钥验的，
   * 而"补发公钥"这一格只需要"从没有到有"。 */
  SIGNING_KEY_CONFLICT: 'SHARE_SIGNING_KEY_CONFLICT',
  /**
   * ADR-0069 裁决四：上传边界的逐 op 签名判定。三枚各自一格，不许互相顶包 ——
   * `UNSIGNED`（没签）与 `SIGNATURE_INVALID`（签了但对不上）是两种完全不同的事：
   * 前者通常是"这台设备的公钥还没补发"，后者意味着**有人在改数据**。
   * 折叠成一枚，界面就只能报一句"同步失败"，而这两种情况的出路完全不同。
   */
  OP_UNSIGNED: 'SHARE_OP_UNSIGNED',
  OP_SIGNATURE_INVALID: 'SHARE_OP_SIGNATURE_INVALID',
  OP_SIGNING_KEY_UNREGISTERED: 'SHARE_OP_SIGNING_KEY_UNREGISTERED',
} as const;

const toMs = (value: unknown): number | null => {
  if (typeof value !== 'bigint') return null;
  // 与 entitlement.toEpochMillis 同一条规则：超出安全整数就不硬转。
  return value <= BigInt(Number.MAX_SAFE_INTEGER) && value >= 0n ? Number(value) : null;
};

const sha256Hex = (value: string): string =>
  createHash('sha256').update(value).digest('hex');

const isBase64Url32Bytes = (value: unknown): value is string =>
  typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value);

/** Curve25519 的两把钥都是 32 字节（X25519 封装钥 / Ed25519 签名钥），编码同为 base64(url)。 */
const decodesTo32Bytes = (value: string): boolean => {
  try {
    const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
    return Buffer.from(normalized, 'base64').length === 32;
  } catch {
    return false;
  }
};

const publicKey32Schema = (label: string) =>
  z
    .string()
    .min(43)
    .max(44)
    .refine(decodesTo32Bytes, `${label} must decode to 32 bytes`);

// ── 请求 schema ────────────────────────────────────────────────────────────

const CreateShareSchema = z.object({}).strict();

const CreateInvitationSchema = z.object({
  invitedEmail: z.string().email().max(254).optional(),
  ttlDays: z.number().int().min(1).max(INVITATION_MAX_TTL_DAYS).optional(),
});

const AcceptInvitationSchema = z.object({
  token: z.string().min(20).max(128),
  /** 成员的 X25519 封装公钥（base64/base64url，解码后 32 字节）—— owner 封信封的唯一依据。 */
  identityPublicKey: publicKey32Schema('identityPublicKey'),
  /**
   * 同一个人的 Ed25519 **签名**公钥（ADR-0069 裁决二）。
   *
   * 🔴 可选，因为它是**新加的那一维**：老客户端不带它入群照旧能用，只是它的 op
   * 从此会被上传边界的验签拒掉（裁决六：不追签、新写入无签 ⇒ 永久拒绝）。
   * 服务端不许"顺手代填"——公钥只能由持有私钥的那一方发出来。
   */
  signingPublicKey: publicKey32Schema('signingPublicKey').optional(),
});

/** 成员自证发布签名公钥（本人、幂等、只写这一格）。 */
const PutSigningKeySchema = z.object({
  signingPublicKey: publicKey32Schema('signingPublicKey'),
});

const PatchMemberSchema = z.object({ role: z.string().min(1).max(16) });

/** 转让所有权（W6）：目标必须是本共享的活跃成员且不是当前 owner 本人。 */
const TransferOwnershipSchema = z.object({ memberId: z.string().min(1).max(64) });

const PutEnvelopeSchema = z.object({
  keyEpoch: z.number().int().min(1),
  keyEnvelope: z.object({}).passthrough(),
});

const UploadShareOpsSchema = z.object({
  // 🔴 只用**自己的** zod 做信封形状；逐条 op 的校验在循环里直接调
  // `SuperSyncUploadOperationSchema.safeParse`（shared-schema 的实例）。
  // 跨包组合（`z.array(他们的schema)`）会踩 zod 双实例的 `_zod` 内部字段
  // —— 实测 500，这是 W2 当场踩到并修掉的坑。
  ops: z.array(z.object({}).passthrough()).min(1).max(200),
});

const DownloadShareOpsQuerySchema = z.object({
  after: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(500).default(200),
});

// ── 成员/所有者判定（认证与判权同一个函数 —— requireAdmin 的教训） ──────────

interface ShareMemberContext {
  share: { id: string; ownerUserId: number; keyEpoch: number; lastServerSeq: number };
  member: { id: string; role: string; userId: number; signingPublicKey: string | null };
}

type MemberLookup =
  | { ok: true; share: ShareMemberContext['share']; member: ShareMemberContext['member'] }
  | { ok: false; sent: true };

const requireShareMember = async (
  req: FastifyRequest,
  reply: FastifyReply,
  shareId: string,
): Promise<MemberLookup> => {
  const denied = await authenticate(req, reply);
  if (denied !== undefined) return { ok: false, sent: true };
  const { userId } = getAuthUser(req);
  const share = await prisma.share.findFirst({ where: { id: shareId, deletedAt: null } });
  // 非成员与不存在同形：404。share 的存在性本身不向外人泄露。
  if (!share) {
    void reply.code(404).send({ code: SHARE_ERROR_CODES.NOT_FOUND, message: 'Share not found' });
    return { ok: false, sent: true };
  }
  const member = await prisma.shareMember.findFirst({
    where: { shareId, userId, removedAt: null },
  });
  if (!member) {
    void reply.code(404).send({ code: SHARE_ERROR_CODES.NOT_FOUND, message: 'Share not found' });
    return { ok: false, sent: true };
  }
  return {
    ok: true,
    share: {
      id: share.id,
      ownerUserId: Number(share.ownerUserId),
      keyEpoch: share.keyEpoch,
      lastServerSeq: share.lastServerSeq,
    },
    member: { id: member.id, role: member.role, userId: Number(member.userId), signingPublicKey: member.signingPublicKey },
  };
};

const requireShareOwner = async (
  req: FastifyRequest,
  reply: FastifyReply,
  shareId: string,
): Promise<MemberLookup> => {
  const lookup = await requireShareMember(req, reply, shareId);
  if (!lookup.ok) return lookup;
  if (lookup.member.role !== 'owner') {
    void reply.code(403).send({ code: SHARE_ERROR_CODES.ROLE_FORBIDDEN, message: 'Owner only' });
    return { ok: false, sent: true };
  }
  return lookup;
};

/** 严格 schema 的推断类型 —— 别用 Record<string, unknown> 擦掉字段类型，
 * 那会让 createMany 变成一串 unknown（W2 当场踩过）。 */
type ValidatedShareOp = z.infer<typeof SuperSyncOperationSchema>;

/**
 * 签名结局 → 错误码（ADR-0069 裁决四的封闭词表）。
 *
 * 🔴 这一张表是 `Record<Exclude<..., 'verified'>, ...>`：词表**多一枚结局就编译不过**。
 * 折叠任何一格（把"没登记公钥"报成"没签"、把"验不过"报成"没签"）都会让界面只能报一句
 * 通用的"同步失败"，而那三格的出路完全不同 —— 只有编译期拦住才不会某天被顺手合并。
 */
const SHARE_OP_SIGNATURE_CODES: Record<Exclude<ShareOpSignatureOutcome, 'verified'>, string> = {
  unsigned: SHARE_ERROR_CODES.OP_UNSIGNED,
  invalid: SHARE_ERROR_CODES.OP_SIGNATURE_INVALID,
  'signer-unregistered': SHARE_ERROR_CODES.OP_SIGNING_KEY_UNREGISTERED,
};

/** 活跃成员计数（含 owner）—— 29 人上限（MAX_SHARE_MEMBERS 含 owner）的依据。 */
const countActiveMembers = async (shareId: string): Promise<number> =>
  prisma.shareMember.count({ where: { shareId, removedAt: null } });

/**
 * 签名公钥只有一个合法写法：**从「没有」到「有」**（ADR-0069 裁决二）。
 *
 * 已在册且不同 ⇒ 冲突，而不是覆盖。理由不是"谨慎"：读侧拿成员名册里当前那枚公钥
 * 去验这个人**过去**的每一条 op，静默换钥会把历史全部翻成"验不过"，
 * 而"这个人换了把钥"这件事在协议上没有任何地方能说出来。
 * 真到了要换签名钥的那天，得先给读侧一个可判定的世代（翻案条件见 ADR-0069 §六）。
 * 相同 ⇒ 幂等成功（补发重试是同一条路径）。
 */
const writeSigningKey = (
  current: string | null | undefined,
  incoming: string,
): { ok: true; value: string } | { ok: false } => {
  if (current === null || current === undefined || current === incoming) return { ok: true, value: incoming };
  return { ok: false };
};

export async function shareRoutes(fastify: FastifyInstance): Promise<void> {
  // ── 创建共享 ────────────────────────────────────────────────────────────
  fastify.post(
    '/shares',
    { preHandler: [authenticate, createEntitlementGuard()] },
    async (req, reply) => {
      const { userId } = getAuthUser(req);
      const shareId = randomUUID();
      const now = Date.now();
      const share = await prisma.share.create({
        data: { id: shareId, ownerUserId: userId, keyEpoch: 1, lastServerSeq: 0, createdAt: BigInt(now) },
      });
      const member = await prisma.shareMember.create({
        data: {
          id: randomUUID(),
          shareId,
          userId,
          role: 'owner',
          memberKeyEpoch: 1,
          addedAt: BigInt(now),
        },
      });
      return reply.code(201).send({
        shareId: share.id,
        keyEpoch: share.keyEpoch,
        memberId: member.id,
        role: 'owner',
        createdAt: now,
      });
    },
  );

  // ── 我的共享列表 ────────────────────────────────────────────────────────
  fastify.get('/shares', { preHandler: authenticate }, async (req, reply) => {
    const { userId } = getAuthUser(req);
    const memberships = await prisma.shareMember.findMany({
      where: { userId, removedAt: null },
      include: { share: { select: { id: true, ownerUserId: true, keyEpoch: true, deletedAt: true } } },
    });
    const removed = await prisma.shareMember.findMany({
      where: { userId, removedAt: { not: null } },
      orderBy: { removedAt: 'desc' },
      take: 50,
    });
    return reply.send({
      shares: memberships
        .filter((m) => m.share.deletedAt === null)
        .map((m) => ({
          shareId: m.share.id,
          ownerId: Number(m.share.ownerUserId),
          keyEpoch: m.share.keyEpoch,
          role: m.role,
          memberKeyEpoch: m.memberKeyEpoch,
          hasEnvelope: m.keyEnvelope !== null,
        })),
      // Etebase 形状：你失去了访问权、但清单还在 —— 客户端据此本地清数据。
      removedMemberships: removed.map((m) => ({
        shareId: m.shareId,
        removedAt: toMs(m.removedAt),
      })),
    });
  });

  // ── 清单详情 ────────────────────────────────────────────────────────────
  fastify.get('/shares/:shareId', { preHandler: authenticate }, async (req, reply) => {
    const { shareId } = req.params as { shareId: string };
    const lookup = await requireShareMember(req, reply, shareId);
    if (!lookup.ok) return;
    return reply.send({
      shareId: lookup.share.id,
      ownerId: lookup.share.ownerUserId,
      keyEpoch: lookup.share.keyEpoch,
      yourRole: lookup.member.role,
    });
  });

  // ── 邀请：创建 ──────────────────────────────────────────────────────────
  fastify.post(
    '/shares/:shareId/invitations',
    { preHandler: [authenticate, createEntitlementGuard()] },
    async (req, reply) => {
      const { shareId } = req.params as { shareId: string };
      const lookup = await requireShareOwner(req, reply, shareId);
      if (!lookup.ok) return;
      const parsed = CreateInvitationSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        return reply.code(400).send({ code: 'validation_failed', message: 'Validation failed', details: parsed.error.issues });
      }
      const ttlDays = parsed.data.ttlDays ?? INVITATION_DEFAULT_TTL_DAYS;
      const token = randomBytes(32).toString('base64url');
      const now = Date.now();
      const invitation = await prisma.shareInvitation.create({
        data: {
          id: randomUUID(),
          shareId,
          tokenHash: sha256Hex(token),
          invitedByEmail: parsed.data.invitedEmail ?? null,
          createdById: lookup.member.userId,
          createdAt: BigInt(now),
          expiresAt: BigInt(now + ttlDays * 24 * 60 * 60 * 1000),
        },
      });
      // 裸 token 只在这一次响应里出现；库里只有它的 sha256。
      await notifyShareRoster(shareId);
      return reply.code(201).send({
        invitationId: invitation.id,
        token,
        expiresAt: toMs(invitation.expiresAt),
      });
    },
  );

  // ── 邀请：列表（owner；白名单投影） ─────────────────────────────────────
  fastify.get('/shares/:shareId/invitations', { preHandler: authenticate }, async (req, reply) => {
    const { shareId } = req.params as { shareId: string };
    const lookup = await requireShareOwner(req, reply, shareId);
    if (!lookup.ok) return;
    const invitations = await prisma.shareInvitation.findMany({
      where: { shareId },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return reply.send({
      invitations: invitations.map((inv) => ({
        invitationId: inv.id,
        invitedByEmail: inv.invitedByEmail,
        createdAt: toMs(inv.createdAt),
        expiresAt: toMs(inv.expiresAt),
        revokedAt: toMs(inv.revokedAt),
        acceptedAt: toMs(inv.acceptedAt),
      })),
    });
  });

  // ── 邀请：吊销 ──────────────────────────────────────────────────────────
  fastify.delete(
    '/shares/:shareId/invitations/:invitationId',
    { preHandler: authenticate },
    async (req, reply) => {
      const { shareId, invitationId } = req.params as { shareId: string; invitationId: string };
      const lookup = await requireShareOwner(req, reply, shareId);
      if (!lookup.ok) return;
      const result = await prisma.shareInvitation.updateMany({
        where: { id: invitationId, shareId, revokedAt: null, acceptedAt: null },
        data: { revokedAt: BigInt(Date.now()) },
      });
      if (result.count === 0) {
        return reply.code(404).send({ code: SHARE_ERROR_CODES.INVITATION_INVALID, message: 'Invitation not revocable' });
      }
      await notifyShareRoster(shareId);
      return reply.send({ revoked: true });
    },
  );

  // ── 邀请：接受（任何认证用户；29 人上限） ────────────────────────────────
  fastify.post('/shares/invitations/accept', { preHandler: authenticate }, async (req, reply) => {
    const { userId } = getAuthUser(req);
    const parsed = AcceptInvitationSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ code: SHARE_ERROR_CODES.INVITATION_INVALID, message: 'Validation failed' });
    }
    const tokenHash = sha256Hex(parsed.data.token);
    const invitation = await prisma.shareInvitation.findUnique({ where: { tokenHash } });
    if (!invitation) {
      return reply.code(404).send({ code: SHARE_ERROR_CODES.INVITATION_INVALID, message: 'Invitation not found' });
    }
    if (invitation.revokedAt !== null) {
      return reply.code(410).send({ code: SHARE_ERROR_CODES.INVITATION_REVOKED, message: 'Invitation revoked' });
    }
    if (Number(invitation.expiresAt) <= Date.now()) {
      return reply.code(410).send({ code: SHARE_ERROR_CODES.INVITATION_EXPIRED, message: 'Invitation expired' });
    }
    const share = await prisma.share.findFirst({
      where: { id: invitation.shareId, deletedAt: null },
    });
    if (!share) {
      return reply.code(404).send({ code: SHARE_ERROR_CODES.NOT_FOUND, message: 'Share not found' });
    }
    const existing = await prisma.shareMember.findFirst({
      where: { shareId: share.id, userId },
    });
    if (existing && existing.removedAt === null) {
      return reply.code(409).send({ code: SHARE_ERROR_CODES.ALREADY_MEMBER, message: 'Already a member' });
    }
    const activeCount = await countActiveMembers(share.id);
    if (activeCount >= MAX_SHARE_MEMBERS) {
      return reply.code(403).send({ code: SHARE_ERROR_CODES.MEMBER_LIMIT, message: 'Share is full' });
    }
    // 复用同一行的老成员带来自证公钥时，走的是「补发」那条规则：已在册且不同 ⇒ 冲突。
    // 检查放在任何写之前 —— 半写入的成员行比一次 409 难查得多。
    if (existing && parsed.data.signingPublicKey !== undefined &&
        !writeSigningKey(existing.signingPublicKey, parsed.data.signingPublicKey).ok) {
      return reply.code(409).send({ code: SHARE_ERROR_CODES.SIGNING_KEY_CONFLICT, message: 'Signing key already registered' });
    }
    const now = BigInt(Date.now());
    // 曾经被移除的人经新邀请回来：复用同一行（唯一约束 [shareId,userId]），
    // 清掉移除标记、更新公钥与角色 —— 移除历史保留在 removedAt 之前的值里
    // 没有审计价值会丢失，所以入群这件事有自己的账（accepted_by）。
    const member = existing
      ? await prisma.shareMember.update({
          where: { id: existing.id },
          data: {
            removedAt: null,
            role: 'editor',
            identityPublicKey: parsed.data.identityPublicKey,
            // 没带签名公钥时**不清空**已有值：这一格是「补发」（裁决二），
            // 而清空会让读侧再也验不了这个人此前所有 op 的签名。
            ...(parsed.data.signingPublicKey !== undefined
              ? { signingPublicKey: parsed.data.signingPublicKey }
              : {}),
            memberKeyEpoch: share.keyEpoch,
            addedAt: now,
          },
        })
      : await prisma.shareMember.create({
          data: {
            id: randomUUID(),
            shareId: share.id,
            userId,
            role: 'editor',
            identityPublicKey: parsed.data.identityPublicKey,
            signingPublicKey: parsed.data.signingPublicKey ?? null,
            memberKeyEpoch: share.keyEpoch,
            addedAt: now,
          },
        });
    await prisma.shareInvitation.update({
      where: { id: invitation.id },
      data: { acceptedByUserId: userId, acceptedAt: now },
    });
    // 名册在这一刻真的多了一个人 —— owner 那台（以及他**另一台**设备）的面板等着这条。
    await notifyShareRoster(share.id);
    return reply.send({
      shareId: share.id,
      memberId: member.id,
      role: member.role,
      keyEpoch: share.keyEpoch,
    });
  });

  // ── 成员列表 ────────────────────────────────────────────────────────────
  fastify.get('/shares/:shareId/members', { preHandler: authenticate }, async (req, reply) => {
    const { shareId } = req.params as { shareId: string };
    const lookup = await requireShareMember(req, reply, shareId);
    if (!lookup.ok) return;
    const members = await prisma.shareMember.findMany({
      where: { shareId, removedAt: null },
      orderBy: { addedAt: 'asc' },
    });
    return reply.send({
      members: members.map((m) => ({
        memberId: m.id,
        userId: Number(m.userId),
        role: m.role,
        addedAt: toMs(m.addedAt),
        hasEnvelope: m.keyEnvelope !== null,
        memberKeyEpoch: m.memberKeyEpoch,
        // 公钥本来就是公开的；owner 需要它来封信封。
        identityPublicKey: m.identityPublicKey,
        /**
         * Ed25519 签名公钥 —— 读侧靠它把「这条 op 是谁写的」钉死（ADR-0069 裁决三/五）。
         * `null` 是**如实**的形状：这个人还没自证，他此前的 op 一律读成「未签名」，
         * 不许在这里填个看起来能用的东西把三态压成两态。
         */
        signingPublicKey: m.signingPublicKey,
        // 信封本身对成员可见：它是封给**那一行成员**的密文（收方指纹绑进
        // AAD），发给任何人都解不开——成员由此拿到自己的清单密钥，
        // 不需要额外的"取信封"端点。
        keyEnvelope: m.keyEnvelope,
      })),
    });
  });

  /*
   * ── 签名名册（成员可见；**含已移除的人**） ────────────────────────────────
   *
   * 🔴 为什么不复用 `GET /members`：那两个问题的答案不是一张表。
   * 面板问的是"现在谁在这份清单里"（`removedAt: null`），读侧问的是"这份日志里那些署名的
   * op **可能**是谁写的" —— 后者必须包含已经被移除的人：日志是追加式的，他写过的每一条
   * 还在那本 log 里，而签名唯一能证明的正是"这条没被改过、是那一位写的"。
   * 拿前一张表去答后一个问题，症状是**把人移出清单之后，他写过的东西连同他之后所有人的
   * 改动一起读不出来**（游标停在第一条验不过的那格之前，界面上报"查不到作者登记的签名"），
   * 而这条错误会被当成"有人在改我的数据"。判据在第 13 步的 `verify:collab-sync`。
   *
   * ⚠️ 这一枚只回公钥，不回信封、不回角色、也不回 userId：名册唯一该外溢的就是"这一行认哪把钥"。
   * 公钥本来就是公开的（`/members` 早就把 `identityPublicKey` 发给成员了），而没自证的人回 `null`
   * 是如实的形状 —— 不许拿别人的钥顶上（`share-verify.ts` 纪律 3）。
   */
  fastify.get('/shares/:shareId/signing-keys', { preHandler: authenticate }, async (req, reply) => {
    const { shareId } = req.params as { shareId: string };
    const lookup = await requireShareMember(req, reply, shareId);
    if (!lookup.ok) return;
    const members = await prisma.shareMember.findMany({
      where: { shareId },
      select: { id: true, signingPublicKey: true, removedAt: true },
      orderBy: { addedAt: 'asc' },
    });
    return reply.send({
      members: members.map((m) => ({
        memberId: m.id,
        signingPublicKey: m.signingPublicKey,
        // 界面不画这一列，但诊断要能分清"这个人是现役成员还是已经退出的人"。
        removed: m.removedAt !== null,
      })),
    });
  });

  // ── 改角色（owner；owner 的角色不可改 —— 转让是 W6 的独立动作） ──────────
  fastify.patch(
    '/shares/:shareId/members/:memberId',
    { preHandler: authenticate },
    async (req, reply) => {
      const { shareId, memberId } = req.params as { shareId: string; memberId: string };
      const lookup = await requireShareOwner(req, reply, shareId);
      if (!lookup.ok) return;
      const parsed = PatchMemberSchema.safeParse(req.body);
      if (!parsed.success || !isShareMemberRole(parsed.data.role) || parsed.data.role === 'owner') {
        return reply.code(400).send({ code: SHARE_ERROR_CODES.ROLE_FORBIDDEN, message: 'Invalid role' });
      }
      const target = await prisma.shareMember.findFirst({
        where: { id: memberId, shareId, removedAt: null },
      });
      if (!target) {
        return reply.code(404).send({ code: SHARE_ERROR_CODES.NOT_FOUND, message: 'Member not found' });
      }
      if (target.role === 'owner') {
        return reply.code(400).send({ code: SHARE_ERROR_CODES.ROLE_FORBIDDEN, message: 'Cannot change owner role' });
      }
      await prisma.shareMember.update({ where: { id: target.id }, data: { role: parsed.data.role } });
      await notifyShareRoster(shareId);
      return reply.send({ memberId, role: parsed.data.role });
    },
  );

  // ── 信封下发（owner；rekey 的服务端落点） ────────────────────────────────
  fastify.put(
    '/shares/:shareId/members/:memberId/envelope',
    { preHandler: authenticate },
    async (req, reply) => {
      const { shareId, memberId } = req.params as { shareId: string; memberId: string };
      const lookup = await requireShareOwner(req, reply, shareId);
      if (!lookup.ok) return;
      const parsed = PutEnvelopeSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ code: 'validation_failed', message: 'Validation failed', details: parsed.error.issues });
      }
      const target = await prisma.shareMember.findFirst({
        where: { id: memberId, shareId, removedAt: null },
      });
      if (!target) {
        return reply.code(404).send({ code: SHARE_ERROR_CODES.NOT_FOUND, message: 'Member not found' });
      }
      const { keyEpoch, keyEnvelope } = parsed.data;
      await prisma.shareMember.update({
        where: { id: target.id },
        data: {
          keyEnvelope: keyEnvelope as Prisma.InputJsonValue,
          memberKeyEpoch: keyEpoch,
        },
      });
      // share 的世代跟着走到最高已分发的世代 —— 其余成员还没拿到新信封时，
      // 他们的 memberKeyEpoch 落后于 share.keyEpoch，客户端据此如实显示。
      if (keyEpoch > lookup.share.keyEpoch) {
        await prisma.share.update({ where: { id: shareId }, data: { keyEpoch } });
      }
      // 🔴 这条必须有：入群对话框那枚"等 owner 把信封发过来"的 3s 轮询就是为它写的
      // （ADR-0070 撤的是轮询，撤完就靠这一发信号）。少了它，新成员永远停在"等待所有者授权"。
      await notifyShareRoster(shareId);
      return reply.send({ memberId, memberKeyEpoch: keyEpoch });
    },
  );

  // ── 签名公钥自证发布（成员**本人**；ADR-0069 裁决二） ──────────────────────
  fastify.put(
    '/shares/:shareId/members/:memberId/signing-key',
    { preHandler: authenticate },
    async (req, reply) => {
      const { shareId, memberId } = req.params as { shareId: string; memberId: string };
      const lookup = await requireShareMember(req, reply, shareId);
      if (!lookup.ok) return;
      /*
       * 🔴 只能写自己那一行，且**不是** owner 的管理腿。
       * `PATCH role` / `PUT envelope` 是 owner 的（他替别人持信封），但签名公钥代表
       * "这把私钥的主人是谁" —— 由别人代填等于把「这条 op 是谁写的」的判定权交给第三方，
       * 而这一枚签名恰恰是用来对抗第三方的（对抗的就是服务端）。
       * 别人的 memberId 一律 404：与"非成员看不到清单"同形，不泄露这一行存在。
       */
      if (memberId !== lookup.member.id) {
        return reply.code(404).send({ code: SHARE_ERROR_CODES.NOT_FOUND, message: 'Member not found' });
      }
      const parsed = PutSigningKeySchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ code: 'validation_failed', message: 'Validation failed', details: parsed.error.issues });
      }
      const write = writeSigningKey(lookup.member.signingPublicKey, parsed.data.signingPublicKey);
      if (!write.ok) {
        return reply.code(409).send({ code: SHARE_ERROR_CODES.SIGNING_KEY_CONFLICT, message: 'Signing key already registered' });
      }
      await prisma.shareMember.update({
        where: { id: lookup.member.id },
        data: { signingPublicKey: write.value },
      });
      // 幂等重试走同一条路径（重发同一枚公钥 ⇒ 同一次 update ⇒ 同一个响应），
      // 所以这里不需要"已发布就直接返回"的分支——两个分支会各自漂移。
      // 别人手里的那份**验签名名册**要靠这条信号才不是死的（ADR-0070）。
      await notifyShareRoster(shareId);
      return reply.send({ memberId: lookup.member.id, signingPublicKey: write.value });
    },
  );

  // ── 移除成员（owner；rekey 由 owner 客户端随后执行） ─────────────────────
  fastify.delete(
    '/shares/:shareId/members/:memberId',
    { preHandler: authenticate },
    async (req, reply) => {
      const { shareId, memberId } = req.params as { shareId: string; memberId: string };
      const lookup = await requireShareOwner(req, reply, shareId);
      if (!lookup.ok) return;
      const target = await prisma.shareMember.findFirst({
        where: { id: memberId, shareId, removedAt: null },
      });
      if (!target) {
        return reply.code(404).send({ code: SHARE_ERROR_CODES.NOT_FOUND, message: 'Member not found' });
      }
      if (target.role === 'owner') {
        return reply.code(400).send({ code: SHARE_ERROR_CODES.ROLE_FORBIDDEN, message: 'Cannot remove owner' });
      }
      // 🔴 移除必须**同时作废那枚信封**（M3）。留着它有两个后果：
      // ① 服务端还替一个已被踢的人保管着他的钥匙，"移除"就只是关了一扇门；
      // ② 重新邀请复用同一行（下面 accept 那条路径），它会把 `memberKeyEpoch`
      //    抬到当前世代而信封还是旧那一把 ⇒ owner 的补封逻辑
      //    （`memberKeyEpoch >= keyEpoch` 就跳过）会**永远跳过他**，
      //    界面显示"密钥已下发"而他解不开任何东西。
      // 只清信封、不把 `memberKeyEpoch` 归零：库里有 CHECK `share_members_key_epoch_positive`
      // (`member_key_epoch >= 1`)，写 0 是 500 而不是"没钥"；`keyEnvelope = null`
      // 已经是"没有钥"的权威形状（`hasEnvelope` 与补封判据都读它）。
      await prisma.shareMember.update({
        where: { id: target.id },
        data: { removedAt: BigInt(Date.now()), keyEnvelope: Prisma.DbNull },
      });
      // 名单查询在写之后 ⇒ 被移除的人不在扇出里（他知道自己是走查到的，不是推到的）。
      await notifyShareRoster(shareId);
      return reply.send({ removed: true });
    },
  );

  // ── 退出（非 owner；owner 要先转让 —— W6） ───────────────────────────────
  fastify.post('/shares/:shareId/leave', { preHandler: authenticate }, async (req, reply) => {
    const { shareId } = req.params as { shareId: string };
    const lookup = await requireShareMember(req, reply, shareId);
    if (!lookup.ok) return;
    if (lookup.member.role === 'owner') {
      return reply.code(400).send({ code: SHARE_ERROR_CODES.OWNER_CANNOT_LEAVE, message: 'Owner cannot leave' });
    }
    // 退出与移除同一件事：他那枚信封当场作废（理由见上面 DELETE 成员那段）。
    await prisma.shareMember.update({
      where: { id: lookup.member.id },
      data: { removedAt: BigInt(Date.now()), keyEnvelope: Prisma.DbNull },
    });
    await notifyShareRoster(shareId);
    return reply.send({ left: true });
  });

  // ── 转让所有权（owner；W6。语义拍板见计划 §W6：转让 = 换 owner + 原 owner 降 editor）──
  fastify.post('/shares/:shareId/transfer', { preHandler: authenticate }, async (req, reply) => {
    const { shareId } = req.params as { shareId: string };
    const lookup = await requireShareOwner(req, reply, shareId);
    if (!lookup.ok) return;
    const parsed = TransferOwnershipSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ code: 'validation_failed', message: 'Validation failed' });
    }
    const target = await prisma.shareMember.findFirst({
      where: { id: parsed.data.memberId, shareId, removedAt: null },
    });
    if (!target) {
      return reply.code(404).send({ code: SHARE_ERROR_CODES.NOT_FOUND, message: 'Member not found' });
    }
    if (target.id === lookup.member.id) {
      return reply.code(400).send({ code: SHARE_ERROR_CODES.ROLE_FORBIDDEN, message: 'Cannot transfer to yourself' });
    }
    if (target.role === 'owner') {
      return reply.code(400).send({ code: SHARE_ERROR_CODES.ROLE_FORBIDDEN, message: 'Target is already the owner' });
    }
    // 🔴 B-10 资格门，**两半都要过**：信封非空 且 其世代 == 当前 `Share.keyEpoch`。
    // 只比世代挡不住最常见的那一格：`memberKeyEpoch` 默认是 1 而不是 0，而"接受邀请"
    // 那条写路径建成员时带的是 `memberKeyEpoch: share.keyEpoch`、**不带 `keyEnvelope`**
    // ⇒ 刚进来的成员正是"世代对齐 + 信封为空"。放过去就得到一个解不开自己刚接手清单的
    // owner，而补发信封是 owner 专属写路径（`requireShareOwner`）⇒ 刚被降成 editor 的
    // 旧 owner 也修不了，服务端不报错、客户端无人能修。
    if (target.keyEnvelope === null || target.memberKeyEpoch !== lookup.share.keyEpoch) {
      return reply.code(409).send({
        code: SHARE_ERROR_CODES.TRANSFER_TARGET_UNSEALED,
        message: 'Target member does not hold the current share key',
      });
    }
    // 🔴 三处写必须原子：share.ownerUserId（详情/列表的 ownerId 事实源）、新 owner
    // 角色、旧 owner 降 editor。中途断电留下「双 owner」或「零 owner」都会让
    // requireShareOwner 的单 owner 假设失效。
    const targetUserId = target.userId;
    await prisma.$transaction([
      prisma.share.update({ where: { id: shareId }, data: { ownerUserId: targetUserId } }),
      prisma.shareMember.update({ where: { id: target.id }, data: { role: 'owner' } }),
      prisma.shareMember.update({ where: { id: lookup.member.id }, data: { role: 'editor' } }),
    ]);
    // 事务提交之后才发 —— 半途发出去，别人会重取到一份"双 owner"的中间态。
    await notifyShareRoster(shareId);
    return reply.send({
      shareId,
      ownerId: Number(targetUserId),
      newOwnerMemberId: target.id,
      demotedMemberId: lookup.member.id,
      demotedRole: 'editor',
    });
  });

  // ── share op 上传（role 硬门在这里） ─────────────────────────────────────
  fastify.post('/shares/:shareId/ops', { preHandler: authenticate }, async (req, reply) => {
    const { shareId } = req.params as { shareId: string };
    const lookup = await requireShareMember(req, reply, shareId);
    if (!lookup.ok) return;
    const parsed = UploadShareOpsSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ code: 'validation_failed', message: 'Validation failed', details: parsed.error.issues });
    }
    const role = lookup.member.role as ShareMemberRole;
    /**
     * 过了全部闸门的那几条。
     *
     * 🔴 op 与**它自己那枚签名**成对走，不是两份并行数组：并行数组迟早错配一位，
     * 错配的那一条会把 A 的签名落到 B 的行上 —— 那正是这一整个功能在防的事。
     */
    const accepted: Array<{ op: ValidatedShareOp; signature: string }> = [];
    const rejected: Array<{ id: string; code: string }> = [];
    for (const raw of parsed.data.ops) {
      // 先传输形状（宽松，坏字段不至于把整批拖死），再严格形状。
      const transport = SuperSyncUploadOperationSchema.safeParse(raw);
      if (!transport.success) {
        rejected.push({ id: String(raw.id ?? ''), code: 'VALIDATION_FAILED' });
        continue;
      }
      const structural = SuperSyncOperationSchema.safeParse(raw);
      if (!structural.success) {
        rejected.push({ id: String(raw.id ?? ''), code: 'VALIDATION_FAILED' });
        continue;
      }
      const op = structural.data;
      const decision = decideShareOpWrite(role, op.entityType);
      if (!decision.allowed) {
        rejected.push({
          id: op.id,
          // 未知实体 = 线协议语义（沿用同步词表）；权限语义 = share 域词表。
          code:
            decision.reason === 'UNKNOWN_ENTITY_TYPE'
              ? 'INVALID_ENTITY_TYPE'
              : decision.reason === 'ENTITY_TYPE_NOT_SHAREABLE'
                ? SHARE_ERROR_CODES.ENTITY_TYPE_NOT_SHAREABLE
                : SHARE_ERROR_CODES.ROLE_FORBIDDEN,
        });
        continue;
      }

      /*
       * 🔴 逐 op 签名闸门（ADR-0069 裁决四）。三格顺序都有理由，缺一条就留下要堵的那一格：
       *
       * 1. **`signature` 必须从 `raw` 读**。`SuperSyncOperationSchema` 是 `z.object`（strip，
       *    不是 strict），严格校验会把这一格**静默剥掉** —— 从 `op` 读永远读到 undefined，
       *    于是每一道合法上传都被判成"没签"，而服务端还一句错都不报。
       * 2. **验的是将要落库的那一份值**（`op.*`，不是 `raw.*`）。校验器会补默认值
       *    （`entityIds ?? []`、`vectorClock ?? {}`），签名必须覆盖读侧以后拿到的字节，
       *    否则"验过的那一份"与"存下来的那一份"可以不同 —— 那一格是假的完整性。
       * 3. `signerMemberId` 用 `lookup.member.id`（**认证**出来的上传者），不是客户端声明的任何字段。
       *    「不许代签」不是靠一句规矩成立的：别人的成员行 id 进了域，签名就对不上。
       *
       * 失败一律**逐 op 拒**且**不落库**：不许记一笔然后收下（那是把伪造通道改成
       * "带日志的伪造通道"），也不许整批 400（一条坏 op 拖死同批合法的 199 条）。
       */
      const outcome = classifyShareOpSignature({
        signingPublicKey: lookup.member.signingPublicKey,
        shareId,
        signerMemberId: lookup.member.id,
        wire: {
          id: op.id,
          clientId: op.clientId,
          actionType: op.actionType,
          opType: op.opType,
          entityType: op.entityType,
          entityId: op.entityId ?? null,
          entityIds: op.entityIds ?? null,
          payload: op.payload,
          vectorClock: op.vectorClock ?? null,
          vectorClockEncoding: op.vectorClockEncoding ?? null,
          isPayloadEncrypted: op.isPayloadEncrypted ?? null,
          schemaVersion: op.schemaVersion,
          // 与下面那次 `BigInt(Math.trunc(op.timestamp))` 同一份截断值：签的必须等于存的。
          clientTimestamp: Math.trunc(op.timestamp),
        } satisfies ShareOpWireForSignature,
        signature: (raw as { signature?: unknown }).signature,
      });
      if (outcome !== 'verified') {
        rejected.push({ id: op.id, code: SHARE_OP_SIGNATURE_CODES[outcome] });
        continue;
      }
      accepted.push({ op, signature: (raw as { signature: string }).signature });
    }
    if (accepted.length > 0) {
      // 重复 id 预检：op id 是全局主键（客户端 UUID，跨 share 唯一）。同一 id
      // 再次上传 = 重复投递，按既有线协议语义逐 op 拒绝（DUPLICATE_OPERATION），
      // 绝不能落成 500——那是把"合法的重试"当成服务器故障。
      const acceptedIds = accepted.map((entry) => entry.op.id);
      const existing = acceptedIds.length
        ? await prisma.shareOperation.findMany({ where: { id: { in: acceptedIds } }, select: { id: true } })
        : [];
      const existingIds = new Set(existing.map((row) => row.id));
      const fresh: Array<{ op: ValidatedShareOp; signature: string }> = [];
      for (const entry of accepted) {
        if (existingIds.has(entry.op.id)) {
          rejected.push({ id: entry.op.id, code: 'DUPLICATE_OPERATION' });
        } else {
          fresh.push(entry);
        }
      }
      accepted.length = 0;
      accepted.push(...fresh);
    }
    if (accepted.length > 0) {
      const now = BigInt(Date.now());
      // 块状发号：一次 increment 预留 accepted.length 个序号，事务内原子。
      // 并发上传各自成块，块内连续 —— 唯一约束 [shareId, serverSeq] 兜底。
      const updated = await prisma.share.update({
        where: { id: shareId },
        data: { lastServerSeq: { increment: accepted.length } },
        select: { lastServerSeq: true },
      });
      const baseSeq = updated.lastServerSeq - accepted.length;
      await prisma.shareOperation.createMany({
        data: accepted.map(({ op, signature }, i) => ({
          id: op.id,
          shareId,
          clientId: op.clientId,
          serverSeq: baseSeq + i + 1,
          actionType: op.actionType,
          opType: op.opType,
          entityType: op.entityType,
          entityId: op.entityId ?? null,
          entityIds: op.entityIds ?? [],
          payload: (op.payload ?? {}) as Prisma.InputJsonValue,
          payloadBytes: BigInt(JSON.stringify(op.payload ?? {}).length),
          vectorClock: (op.vectorClock ?? {}) as Prisma.InputJsonValue,
          schemaVersion: op.schemaVersion,
          clientTimestamp: BigInt(Math.trunc(op.timestamp)),
          receivedAt: now,
          isPayloadEncrypted: op.isPayloadEncrypted ?? false,
          // 🔴 作者是**认证上传者**那一行，不是载荷里任何自称的字段（ADR-0069 事实基线 3）。
          // 这一格与上面验签用的那一格必须是同一个值 —— 不同就变成"验的是 A、记的是 B"。
          signerMemberId: lookup.member.id,
          signature,
        })),
      });
      // WS 信号：只说「有新 op」，永远不带内容 —— 与个人 log 的
      // notifyNewOps 是同一条安全契约。任何失败都不影响上传结果。
      try {
        const members = await prisma.shareMember.findMany({
          where: { shareId, removedAt: null },
          select: { userId: true },
        });
        getWsConnectionService().notifyShareOps(
          members.map((m) => Number(m.userId)),
          shareId,
          op0ClientId(accepted),
          updated.lastServerSeq,
        );
      } catch (err) {
        Logger.warn(`share ws notify failed: ${err instanceof Error ? err.message : 'unknown'}`);
      }
      return reply.send({
        accepted: accepted.map((entry, i) => ({ id: entry.op.id, serverSeq: baseSeq + i + 1 })),
        rejected,
        latestServerSeq: updated.lastServerSeq,
      });
    }
    return reply.send({ accepted: [], rejected, latestServerSeq: lookup.share.lastServerSeq });
  });

  // ── share op 下载（seq 游标） ────────────────────────────────────────────
  fastify.get(
    '/shares/:shareId/ops/causal',
    { preHandler: authenticate },
    async (req, reply) => {
      const { shareId } = req.params as { shareId: string };
      const lookup = await requireShareMember(req, reply, shareId);
      if (!lookup.ok) return;
      const parsed = DownloadShareOpsQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        return reply.code(400).send({ code: 'validation_failed', message: 'Validation failed', details: parsed.error.issues });
      }
      const { after, limit } = parsed.data;
      const ops = await prisma.shareOperation.findMany({
        where: { shareId, serverSeq: { gt: after } },
        orderBy: { serverSeq: 'asc' },
        take: limit,
      });
      return reply.send({
        ops: ops.map((op) => ({
          id: op.id,
          clientId: op.clientId,
          serverSeq: op.serverSeq,
          actionType: op.actionType,
          opType: op.opType,
          entityType: op.entityType,
          entityId: op.entityId,
          entityIds: op.entityIds,
          payload: op.payload,
          vectorClock: op.vectorClock,
          schemaVersion: op.schemaVersion,
          clientTimestamp: toMs(op.clientTimestamp),
          isPayloadEncrypted: op.isPayloadEncrypted,
          /*
           * 🔴 M4 第三批把这两格带出来：读侧（ADR-0069 裁决五）要分「验得过 / 未签名 /
           * 验不过」三态，靠的就是"库里那枚签名"加"这条记在谁名下"。
           * 存量无签 op 这里是 `null` —— 读侧必须把它读成"未签名"，不许读成"已验证"。
           */
          signerMemberId: op.signerMemberId,
          signature: op.signature,
        })),
        cursor: { latestServerSeq: lookup.share.lastServerSeq },
      });
    },
  );
}

const op0ClientId = (accepted: Array<{ op: ValidatedShareOp }>): string | null =>
  accepted[0]?.op.clientId ?? null;

/**
 * 成员可见状态变了 ⇒ 给这份清单**当前全部成员**发一条 `share_roster_changed`（ADR-0070）。
 *
 * 🔴 只带 `shareId`，不带名单、不带内容 —— 与 `notifyShareOps` 同一条安全契约。
 * 写失败不许影响写结果（信号是提示不是数据通道，丢了的后果只是"对端晚一点才看到"），
 * 所以这里整块吞掉异常、只留一条 warn，与 share log 追加路径那一块逐字同形。
 *
 * 名单在**写之后**查 ⇒ 刚被移除/退出的人收不到（他已不在 `removedAt: null` 那一集里），
 * 他会从下一次真实读取那里知道自己没了资格 —— 那是 ADR-0068 的既有形状，不是漏发。
 */
const notifyShareRoster = async (shareId: string): Promise<void> => {
  try {
    const members = await prisma.shareMember.findMany({
      where: { shareId, removedAt: null },
      select: { userId: true },
    });
    getWsConnectionService().notifyShareRosterChanged(
      members.map((m) => Number(m.userId)),
      shareId,
    );
  } catch (err) {
    Logger.warn(`share roster ws notify failed: ${err instanceof Error ? err.message : 'unknown'}`);
  }
};
