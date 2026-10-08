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
 * | PATCH | `/shares/:id/members/:memberId` | owner | 改角色 |
 * | PUT  | `/shares/:id/members/:memberId/envelope` | owner | 下发/更新密钥信封（rekey 的服务端落点） |
 * | DELETE | `/shares/:id/members/:memberId` | owner | 移除成员（removedAt 置位；rekey 由 owner 客户端执行） |
 * | POST | `/shares/:id/leave` | 非 owner 成员 | 退出 |
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

// ── 请求 schema ────────────────────────────────────────────────────────────

const CreateShareSchema = z.object({}).strict();

const CreateInvitationSchema = z.object({
  invitedEmail: z.string().email().max(254).optional(),
  ttlDays: z.number().int().min(1).max(INVITATION_MAX_TTL_DAYS).optional(),
});

const AcceptInvitationSchema = z.object({
  token: z.string().min(20).max(128),
  /** 成员的 X25519 封装公钥（base64/base64url，解码后 32 字节）—— owner 封信封的唯一依据。 */
  identityPublicKey: z
    .string()
    .min(43)
    .max(44)
    .refine((value) => {
      try {
        const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
        return Buffer.from(normalized, 'base64').length === 32;
      } catch {
        return false;
      }
    }, 'identityPublicKey must decode to 32 bytes'),
});

const PatchMemberSchema = z.object({ role: z.string().min(1).max(16) });

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
  member: { id: string; role: string; userId: number };
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
    void reply.code(404).send({ error: 'Share not found', code: SHARE_ERROR_CODES.NOT_FOUND });
    return { ok: false, sent: true };
  }
  const member = await prisma.shareMember.findFirst({
    where: { shareId, userId, removedAt: null },
  });
  if (!member) {
    void reply.code(404).send({ error: 'Share not found', code: SHARE_ERROR_CODES.NOT_FOUND });
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
    member: { id: member.id, role: member.role, userId: Number(member.userId) },
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
    void reply.code(403).send({ error: 'Owner only', code: SHARE_ERROR_CODES.ROLE_FORBIDDEN });
    return { ok: false, sent: true };
  }
  return lookup;
};

/** 严格 schema 的推断类型 —— 别用 Record<string, unknown> 擦掉字段类型，
 * 那会让 createMany 变成一串 unknown（W2 当场踩过）。 */
type ValidatedShareOp = z.infer<typeof SuperSyncOperationSchema>;

/** 活跃成员计数（含 owner）—— 29 人上限（MAX_SHARE_MEMBERS 含 owner）的依据。 */
const countActiveMembers = async (shareId: string): Promise<number> =>
  prisma.shareMember.count({ where: { shareId, removedAt: null } });

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
        return reply.code(400).send({ error: 'Validation failed', details: parsed.error.issues });
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
        return reply.code(404).send({ error: 'Invitation not revocable', code: SHARE_ERROR_CODES.INVITATION_INVALID });
      }
      return reply.send({ revoked: true });
    },
  );

  // ── 邀请：接受（任何认证用户；29 人上限） ────────────────────────────────
  fastify.post('/shares/invitations/accept', { preHandler: authenticate }, async (req, reply) => {
    const { userId } = getAuthUser(req);
    const parsed = AcceptInvitationSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Validation failed', code: SHARE_ERROR_CODES.INVITATION_INVALID });
    }
    const tokenHash = sha256Hex(parsed.data.token);
    const invitation = await prisma.shareInvitation.findUnique({ where: { tokenHash } });
    if (!invitation) {
      return reply.code(404).send({ error: 'Invitation not found', code: SHARE_ERROR_CODES.INVITATION_INVALID });
    }
    if (invitation.revokedAt !== null) {
      return reply.code(410).send({ error: 'Invitation revoked', code: SHARE_ERROR_CODES.INVITATION_REVOKED });
    }
    if (Number(invitation.expiresAt) <= Date.now()) {
      return reply.code(410).send({ error: 'Invitation expired', code: SHARE_ERROR_CODES.INVITATION_EXPIRED });
    }
    const share = await prisma.share.findFirst({
      where: { id: invitation.shareId, deletedAt: null },
    });
    if (!share) {
      return reply.code(404).send({ error: 'Share not found', code: SHARE_ERROR_CODES.NOT_FOUND });
    }
    const existing = await prisma.shareMember.findFirst({
      where: { shareId: share.id, userId },
    });
    if (existing && existing.removedAt === null) {
      return reply.code(409).send({ error: 'Already a member', code: SHARE_ERROR_CODES.ALREADY_MEMBER });
    }
    const activeCount = await countActiveMembers(share.id);
    if (activeCount >= MAX_SHARE_MEMBERS) {
      return reply.code(403).send({ error: 'Share is full', code: SHARE_ERROR_CODES.MEMBER_LIMIT });
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
            memberKeyEpoch: share.keyEpoch,
            addedAt: now,
          },
        });
    await prisma.shareInvitation.update({
      where: { id: invitation.id },
      data: { acceptedByUserId: userId, acceptedAt: now },
    });
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
        // 信封本身对成员可见：它是封给**那一行成员**的密文（收方指纹绑进
        // AAD），发给任何人都解不开——成员由此拿到自己的清单密钥，
        // 不需要额外的"取信封"端点。
        keyEnvelope: m.keyEnvelope,
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
        return reply.code(400).send({ error: 'Invalid role', code: SHARE_ERROR_CODES.ROLE_FORBIDDEN });
      }
      const target = await prisma.shareMember.findFirst({
        where: { id: memberId, shareId, removedAt: null },
      });
      if (!target) {
        return reply.code(404).send({ error: 'Member not found', code: SHARE_ERROR_CODES.NOT_FOUND });
      }
      if (target.role === 'owner') {
        return reply.code(400).send({ error: 'Cannot change owner role', code: SHARE_ERROR_CODES.ROLE_FORBIDDEN });
      }
      await prisma.shareMember.update({ where: { id: target.id }, data: { role: parsed.data.role } });
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
        return reply.code(400).send({ error: 'Validation failed', details: parsed.error.issues });
      }
      const target = await prisma.shareMember.findFirst({
        where: { id: memberId, shareId, removedAt: null },
      });
      if (!target) {
        return reply.code(404).send({ error: 'Member not found', code: SHARE_ERROR_CODES.NOT_FOUND });
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
      return reply.send({ memberId, memberKeyEpoch: keyEpoch });
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
        return reply.code(404).send({ error: 'Member not found', code: SHARE_ERROR_CODES.NOT_FOUND });
      }
      if (target.role === 'owner') {
        return reply.code(400).send({ error: 'Cannot remove owner', code: SHARE_ERROR_CODES.ROLE_FORBIDDEN });
      }
      await prisma.shareMember.update({
        where: { id: target.id },
        data: { removedAt: BigInt(Date.now()) },
      });
      return reply.send({ removed: true });
    },
  );

  // ── 退出（非 owner；owner 要先转让 —— W6） ───────────────────────────────
  fastify.post('/shares/:shareId/leave', { preHandler: authenticate }, async (req, reply) => {
    const { shareId } = req.params as { shareId: string };
    const lookup = await requireShareMember(req, reply, shareId);
    if (!lookup.ok) return;
    if (lookup.member.role === 'owner') {
      return reply.code(400).send({ error: 'Owner cannot leave', code: SHARE_ERROR_CODES.OWNER_CANNOT_LEAVE });
    }
    await prisma.shareMember.update({
      where: { id: lookup.member.id },
      data: { removedAt: BigInt(Date.now()) },
    });
    return reply.send({ left: true });
  });

  // ── share op 上传（role 硬门在这里） ─────────────────────────────────────
  fastify.post('/shares/:shareId/ops', { preHandler: authenticate }, async (req, reply) => {
    const { shareId } = req.params as { shareId: string };
    const lookup = await requireShareMember(req, reply, shareId);
    if (!lookup.ok) return;
    const parsed = UploadShareOpsSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Validation failed', details: parsed.error.issues });
    }
    const role = lookup.member.role as ShareMemberRole;
    const accepted: ValidatedShareOp[] = [];
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
      accepted.push(op);
    }
    if (accepted.length > 0) {
      // 重复 id 预检：op id 是全局主键（客户端 UUID，跨 share 唯一）。同一 id
      // 再次上传 = 重复投递，按既有线协议语义逐 op 拒绝（DUPLICATE_OPERATION），
      // 绝不能落成 500——那是把"合法的重试"当成服务器故障。
      const acceptedIds = accepted.map((op) => op.id);
      const existing = acceptedIds.length
        ? await prisma.shareOperation.findMany({ where: { id: { in: acceptedIds } }, select: { id: true } })
        : [];
      const existingIds = new Set(existing.map((row) => row.id));
      const fresh: ValidatedShareOp[] = [];
      for (const op of accepted) {
        if (existingIds.has(op.id)) {
          rejected.push({ id: op.id, code: 'DUPLICATE_OPERATION' });
        } else {
          fresh.push(op);
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
        data: accepted.map((op, i) => ({
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
        accepted: accepted.map((op, i) => ({ id: op.id, serverSeq: baseSeq + i + 1 })),
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
        return reply.code(400).send({ error: 'Validation failed', details: parsed.error.issues });
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
        })),
        cursor: { latestServerSeq: lookup.share.lastServerSeq },
      });
    },
  );
}

const op0ClientId = (accepted: ValidatedShareOp[]): string | null =>
  accepted[0]?.clientId ?? null;
