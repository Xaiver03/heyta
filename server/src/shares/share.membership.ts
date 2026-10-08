/**
 * 共享成员的**纯裁决逻辑**（ADR-0062 决策 6 的服务端硬门）。
 *
 * 从路由里拆出来的理由：role 门是整个 W2 最重要的一条安全判据，
 * 把它做成 (role, entityType) => decision 的纯函数，变异测试才能
 * 精确地红在"拿掉这一条判断"上，而不是"路由写错了"这种噪音上。
 *
 * 词表纪律：`SHARE_WRITABLE_ENTITY_TYPES` 的每一项都必须在
 * `ENTITY_TYPES`（@heyta/shared-schema）里 —— 用下面的编译期断言钉住，
 * shared-schema 删项时这里编译失败，而不是运行时放出一个幽灵实体。
 */

import { ENTITY_TYPES } from '@heyta/shared-schema';

/** 成员角色词表（与迁移 CHECK `share_members_role_vocabulary` 同源同序）。 */
export const SHARE_MEMBER_ROLES = ['owner', 'editor', 'commenter', 'viewer'] as const;
export type ShareMemberRole = (typeof SHARE_MEMBER_ROLES)[number];

export const isShareMemberRole = (value: unknown): value is ShareMemberRole =>
  typeof value === 'string' && (SHARE_MEMBER_ROLES as readonly string[]).includes(value);

/**
 * 允许写进 share op-log 的实体词表。
 *
 * 🔴 `COMMENT`（W3 起）：`commenter` 角色**唯一**可写的实体——服务端白名单
 * （从 `ENTITY_TYPES` 派生）已先行认识它，客户端域模型随后跟进
 * （ADR-0044 ② 的部署顺序：服务端先上线，客户端才可能写）。
 */
const SHARE_WRITABLE_ENTITY_TYPES = new Set<string>(['TASK', 'PROJECT', 'TAG', 'NOTE', 'COMMENT']);

/** 每个角色可写的实体集合（owner 与 editor 同权 —— owner 是"不 能被移除的 editor"）。 */
const ROLE_WRITABLE: Record<ShareMemberRole, readonly string[] | 'all' | 'none'> = {
  owner: 'all',
  editor: 'all',
  commenter: ['COMMENT'],
  viewer: 'none',
};

export type ShareOpWriteDecision =
  | { allowed: true }
  | { allowed: false; reason: 'UNKNOWN_ENTITY_TYPE' | 'ENTITY_TYPE_NOT_SHAREABLE' | 'ROLE_FORBIDDEN' };

/**
 * 一条 op 能否由该角色的成员写进 share log。
 *
 * 判定顺序是有意的：先实体词表（400 语义：这条 op 本身不合法），
 * 再可共享性（403：合法实体但不属于共享域，比如 REMINDER 是每成员
 * 自己的），最后 role（403：实体可共享但你的身份不够）。
 * 顺序错了会把"协议错误"报成"权限不足"，客户端的失败文案会指错方向。
 */
export const decideShareOpWrite = (
  role: ShareMemberRole,
  entityType: string,
): ShareOpWriteDecision => {
  if (!(ENTITY_TYPES as readonly string[]).includes(entityType)) {
    return { allowed: false, reason: 'UNKNOWN_ENTITY_TYPE' };
  }
  if (!SHARE_WRITABLE_ENTITY_TYPES.has(entityType)) {
    return { allowed: false, reason: 'ENTITY_TYPE_NOT_SHAREABLE' };
  }
  const writable = ROLE_WRITABLE[role];
  if (writable === 'all') return { allowed: true };
  if (writable === 'none' || !writable.includes(entityType)) {
    return { allowed: false, reason: 'ROLE_FORBIDDEN' };
  }
  return { allowed: true };
};

/** 共享清单成员上限（含 owner）—— 对齐滴答「所有者为会员可共享给 29 个成员」。 */
export const MAX_SHARE_MEMBERS = 30;

/** 邀请默认有效期（天）。 */
export const INVITATION_DEFAULT_TTL_DAYS = 7;
export const INVITATION_MAX_TTL_DAYS = 30;
