/**
 * `FeishuAccountRepository` 的 Prisma 实现（唯一的数据库落点）。
 *
 * 账号归属判定全在 `feishu-auth-service.ts`；这里只负责"把判定翻译成一次查询/写入"。
 * 🔴 `select` 一律白名单 —— 绝不把 `passwordHash` / 各类一次性令牌读进登录路径。
 */

import { createHash } from 'crypto';

import { prisma } from '../db';
import type {
  FeishuAccountBinding,
  FeishuAccountRepository,
  FeishuAccountRow,
} from './feishu-auth-service';

const SELECT = {
  id: true,
  email: true,
  isAdmin: true,
  feishuOpenId: true,
  feishuUnionId: true,
} as const;

type UserRow = {
  id: number;
  email: string;
  isAdmin: boolean;
  feishuOpenId: string | null;
  feishuUnionId: string | null;
};

function toRow(user: UserRow | null): FeishuAccountRow | null {
  if (user === null) return null;
  return {
    id: user.id,
    email: user.email,
    isAdmin: user.isAdmin,
    feishuOpenId: user.feishuOpenId,
    feishuUnionId: user.feishuUnionId,
  };
}

/** open_id → 占位邮箱的摘要（生产实现；测试注入恒等函数）。 */
export function digestOpenId(openId: string): string {
  return createHash('sha256').update(openId, 'utf8').digest('base64url');
}

export function createFeishuPrismaRepository(): FeishuAccountRepository {
  return {
    async findByOpenId(openId) {
      return toRow(await prisma.user.findFirst({ where: { feishuOpenId: openId }, select: SELECT }));
    },
    async findByUnionId(unionId) {
      return toRow(await prisma.user.findFirst({ where: { feishuUnionId: unionId }, select: SELECT }));
    },
    async findByEmail(email) {
      return toRow(await prisma.user.findUnique({ where: { email }, select: SELECT }));
    },
    async findSoleAdmin() {
      const count = await prisma.user.count({ where: { isAdmin: true } });
      if (count !== 1) return null;
      return toRow(await prisma.user.findFirst({ where: { isAdmin: true }, select: SELECT }));
    },
    async bindFeishu(userId: number, binding: FeishuAccountBinding) {
      // 只写非空字段：某次 user_info 没带 union_id/tenant_key 时不要把已有绑定抹成 null。
      const data: {
        feishuOpenId: string;
        feishuUnionId?: string;
        feishuTenantKey?: string;
      } = { feishuOpenId: binding.openId };
      if (binding.unionId) data.feishuUnionId = binding.unionId;
      if (binding.tenantKey) data.feishuTenantKey = binding.tenantKey;
      await prisma.user.update({ where: { id: userId }, data });
    },
    async createFromFeishu(input) {
      const created = await prisma.user.create({
        data: {
          email: input.email,
          displayName: input.displayName,
          // 飞书 OAuth 已验证身份 ⇒ 会话可用（`verifyToken` 要求 isVerified）。
          isVerified: 1,
          // Feishu 用户没有本地口令（纯外部身份登录）。
          passwordHash: null,
          feishuOpenId: input.openId,
          feishuUnionId: input.unionId,
          feishuTenantKey: input.tenantKey,
          // 🔴 不发明同意：飞书 OAuth 里没有条款勾选这一步，termsAcceptedAt 留 null。
          // 需要条款留痕的实例应在登录后由产品层补一次显式同意（不在这里替用户勾）。
        },
        select: SELECT,
      });
      return toRow(created) as FeishuAccountRow;
    },
    async touchLogin(userId) {
      // users 表没有 last_login_at 列；成功 OAuth 登录顺手清掉本地失败计数与锁定
      // （与口令登录成功那一支同口径），让"被锁的账号也能用飞书正常登录"。
      await prisma.user.update({
        where: { id: userId },
        data: { failedLoginAttempts: 0, lockedUntil: null },
      });
    },
  };
}
