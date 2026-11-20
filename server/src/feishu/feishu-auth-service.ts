/**
 * 飞书登录的**落地逻辑**（账号归属 + 建号/绑定）—— 不依赖 Prisma，可单元测试。
 * ============================================================================
 *
 * 用「注入仓储接口」的形状（与 x-c 的 `createStorefrontAuth` 同一手法）：
 * 真实的仓储由 `feishu-prisma-repository.ts` 用 Prisma 实现，测试用内存实现，
 * 于是"谁是管理员 / 邮箱撞车 / 未绑定"这些**分支**可以被逐条钉住，而不必起数据库。
 *
 * ## 账号归属规则（每一种都写清楚，别靠注释之外的口口相传）
 *
 * - **管理面（admin）**：只放行**已经是管理员**的账号。
 *   1. 先按 open_id（再 union_id）找已绑定的账号；找到且是管理员 ⇒ 登录。
 *   2. 没找到 ⇒ **只有当这台实例恰好只有一位管理员、且这位管理员还没绑过任何飞书身份**
 *      时，才把这枚飞书身份**直接关联到他**（产品负责人原话：管理员账号唯一，直接关联）。
 *      配了 `adminOpenIds` 白名单时，只有名单里的 open_id 能走这条自动关联。
 *   3. 其余（多管理员 / 唯一管理员已绑了别的飞书身份 / 白名单不含这枚 open_id）⇒
 *      `not_bound`。**管理面永远不自动建号、不自动提权。**
 *
 * - **普通面（app）**：
 *   1. 已绑定（open_id / union_id）⇒ 登录。
 *   2. 未绑定、但飞书带了邮箱且该邮箱已有账号 ⇒ `email_taken`（**不认领**：
 *      飞书邮箱是管理员导入、未经本人实时验证，拿它当所有权凭证会让任何人抢走同邮箱账号）。
 *   3. 未绑定、邮箱没撞车 ⇒ 自动建一个普通账号（`autoProvision` 开启时）。
 */

import type { FeishuAuthErrorCode, FeishuAuthScope } from '@heyta/shared-schema';

import type { FeishuProfile } from './feishu-oauth-client';

/** 仓储读出来的账号（只含归属判定需要的字段，不含 passwordHash 等）。 */
export interface FeishuAccountRow {
  readonly id: number;
  readonly email: string;
  readonly isAdmin: boolean;
  readonly feishuOpenId: string | null;
  readonly feishuUnionId: string | null;
}

export interface FeishuAccountBinding {
  readonly openId: string;
  readonly unionId: string | null;
  readonly tenantKey: string | null;
}

export interface FeishuAccountRepository {
  findByOpenId(openId: string): Promise<FeishuAccountRow | null>;
  findByUnionId(unionId: string): Promise<FeishuAccountRow | null>;
  findByEmail(email: string): Promise<FeishuAccountRow | null>;
  /** 恰好存在一位管理员时返回它；0 位或多位都返回 null。 */
  findSoleAdmin(): Promise<FeishuAccountRow | null>;
  bindFeishu(userId: number, binding: FeishuAccountBinding): Promise<void>;
  createFromFeishu(input: {
    email: string;
    displayName: string;
    openId: string;
    unionId: string | null;
    tenantKey: string | null;
  }): Promise<FeishuAccountRow>;
  touchLogin(userId: number): Promise<void>;
}

export interface FeishuLoginPolicy {
  readonly adminOpenIds: readonly string[];
  readonly tenantKey: string | null;
  readonly autoProvision: boolean;
}

export type FeishuLoginOutcome =
  | { readonly ok: true; readonly userId: number; readonly created: boolean }
  | { readonly ok: false; readonly code: FeishuAuthErrorCode };

export function isValidEmail(value: string): boolean {
  if (!value || value.length > 255) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value);
}

/**
 * 飞书用户没有可用邮箱时给一个占位邮箱。`email` 是 NOT NULL + UNIQUE，
 * 占位必须对**完整 open_id** 单射：用 sha256 摘要，不做有损裁剪拼接。
 */
export function feishuPlaceholderEmail(openId: string, digest: (value: string) => string): string {
  return `feishu-${digest(String(openId))}@feishu.local`;
}

function adminOpenIdAllowed(policy: FeishuLoginPolicy, openId: string): boolean {
  if (policy.adminOpenIds.length === 0) return true;
  return policy.adminOpenIds.includes(openId);
}

export async function resolveFeishuLogin(args: {
  profile: FeishuProfile;
  scope: FeishuAuthScope;
  repo: FeishuAccountRepository;
  policy: FeishuLoginPolicy;
  /** open_id → 占位邮箱本地部分用的摘要函数（生产传 sha256 base64url，测试传恒等）。 */
  digest: (value: string) => string;
}): Promise<FeishuLoginOutcome> {
  const { profile, scope, repo, policy, digest } = args;
  const openId = String(profile.openId || '').trim();
  if (!openId) return { ok: false, code: 'login_failed' };
  const unionId = profile.unionId ? String(profile.unionId).trim() : null;

  // 租户限制（配置了才生效）。
  if (policy.tenantKey !== null && profile.tenantKey !== policy.tenantKey) {
    return { ok: false, code: 'tenant_denied' };
  }

  // 1) 已绑定的身份。
  let account = await repo.findByOpenId(openId);
  if (!account && unionId) account = await repo.findByUnionId(unionId);

  if (account) {
    if (scope === 'admin' && !account.isAdmin) {
      return { ok: false, code: 'not_admin' };
    }
    // 通过鉴权后刷新（可能变化的）open_id/union_id/tenant_key。
    await repo.bindFeishu(account.id, { openId, unionId, tenantKey: profile.tenantKey });
    await repo.touchLogin(account.id);
    return { ok: true, userId: account.id, created: false };
  }

  // 2) 管理面：只允许"唯一管理员 + 该管理员尚未绑任何飞书身份"时自动关联。
  if (scope === 'admin') {
    if (!adminOpenIdAllowed(policy, openId)) return { ok: false, code: 'not_bound' };
    const sole = await repo.findSoleAdmin();
    if (sole === null) return { ok: false, code: 'not_bound' };
    // 唯一管理员已经绑了**另一枚**飞书身份：不覆盖，避免把旧绑定挤掉（也许另一个人在用）。
    if (sole.feishuOpenId !== null && sole.feishuOpenId !== openId) {
      return { ok: false, code: 'not_bound' };
    }
    await repo.bindFeishu(sole.id, { openId, unionId, tenantKey: profile.tenantKey });
    await repo.touchLogin(sole.id);
    return { ok: true, userId: sole.id, created: false };
  }

  // 3) 普通面：邮箱撞车不认领。
  const feishuEmail = profile.email ? profile.email.trim().toLowerCase() : '';
  if (feishuEmail && isValidEmail(feishuEmail)) {
    const byEmail = await repo.findByEmail(feishuEmail);
    if (byEmail) return { ok: false, code: 'email_taken' };
  }
  if (!policy.autoProvision) return { ok: false, code: 'not_bound' };

  const email = feishuEmail && isValidEmail(feishuEmail) ? feishuEmail : feishuPlaceholderEmail(openId, digest);
  const displayName = (profile.name && profile.name.trim().slice(0, 255)) || '飞书用户';

  try {
    const created = await repo.createFromFeishu({
      email,
      displayName,
      openId,
      unionId,
      tenantKey: profile.tenantKey,
    });
    await repo.touchLogin(created.id);
    return { ok: true, userId: created.id, created: true };
  } catch (error) {
    // 同一 open_id 的并发首登：唯一索引会挡住第二笔建号，回收已建的那条继续登录。
    const raced = await repo.findByOpenId(openId);
    if (raced) {
      await repo.touchLogin(raced.id);
      return { ok: true, userId: raced.id, created: false };
    }
    throw error;
  }
}
