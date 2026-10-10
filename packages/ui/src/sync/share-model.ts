/**
 * 共享清单面板的**纯逻辑**（ADR-0062，落地计划 W4）。
 * =====================================================
 *
 * 形状照 `auth/model.ts` 的收编先例：纯函数 + 字面量 key 联合，
 * **不 import `@heyta/i18n`**（会拖第二份 React）；宿主 `t()` 的参数是
 * `MessageKey`，字面量传错编译不过。
 *
 * 服务端事实的来源：`GET /api/shares/:id/members` 的行投影
 * （memberId / userId / role / addedAt / hasEnvelope / memberKeyEpoch /
 *   identityPublicKey / keyEnvelope）——与本文件之间是**调用方**关系。
 * role 词表与 30 人上限**不是这里的第二份真源**：服务端硬门
 * （`server/src/shares/share.membership.ts`）与迁移 CHECK 才是；
 * 这里只是把同一词表镜像给界面做展示与软约束（服务端是唯一裁决者，
 * 客户端 UI 约束只是软门——ADR-0062 决策 6）。
 */

/** 成员角色词表（与服务端/迁移 CHECK 同源同序）。 */
export const SHARE_MEMBER_ROLES = ['owner', 'editor', 'commenter', 'viewer'] as const;
export type ShareRole = (typeof SHARE_MEMBER_ROLES)[number];

/** 成员上限（含 owner）——对齐滴答「所有者为会员可共享给 29 个成员」。 */
export const MAX_SHARE_MEMBERS = 30;

export interface ShareMemberRow {
  memberId: string;
  userId: number;
  role: string;
  addedAt: number | null;
  hasEnvelope: boolean;
  memberKeyEpoch: number;
  identityPublicKey?: string | null;
}

export interface ShareMemberView {
  memberId: string;
  userId: number;
  role: ShareRole;
  isSelf: boolean;
  isOwner: boolean;
  /** per-share 名片（清单密钥域）落地前是 undefined——界面显示兜底 key。 */
  displayName: undefined;
  hasEnvelope: boolean;
  /** > 0 = 该成员还没拿到当前世代的信封（界面如实显示「等待所有者授权」）。 */
  keyEpochLag: number;
}

export interface SharePanelData {
  shareId: string;
  ownerId: number;
  keyEpoch: number;
  myRole: ShareRole;
  members: readonly ShareMemberRow[];
  /**
   * 自己的成员行 id（`POST /shares` / `accept` 响应里回给本人，宿主持久化）。
   * 有它时 `isSelf` 按 memberId 判 —— web 宿主拿不到自己的**数字 userId**
   * （服务端没有 `/me` 端点），但自己的 memberId 在建共享/接受邀请的那一刻
   * 是明确知道的。
   */
  selfMemberId?: string;
}

export const isShareRole = (value: unknown): value is ShareRole =>
  typeof value === 'string' && (SHARE_MEMBER_ROLES as readonly string[]).includes(value);

/**
 * 成员展示投影（唯一入口）：owner 最先、其余按加入时间。
 * `isSelf` 优先按 `selfMemberId` 判（见 `SharePanelData.selfMemberId`），
 * 宿主没传时回落按 `selfUserId` 判。
 */
export function projectMembersFor(data: SharePanelData, selfUserId?: number): ShareMemberView[] {
  // addedAt 理论上必有（服务端 DEFAULT 0）；null 视为最早（排后段不破坏 owner 优先）。
  const at = (v: (typeof data.members)[number]): number => v.addedAt ?? Number.MAX_SAFE_INTEGER;
  const sorted = [...data.members].sort((a, b) => {
    if (a.role === 'owner') return -1;
    if (b.role === 'owner') return 1;
    return at(a) - at(b);
  });
  return sorted.map((m) => ({
    memberId: m.memberId,
    userId: m.userId,
    role: (isShareRole(m.role) ? m.role : 'viewer') as ShareRole,
    isSelf: data.selfMemberId !== undefined
      ? m.memberId === data.selfMemberId
      : selfUserId !== undefined && m.userId === selfUserId,
    isOwner: m.role === 'owner',
    displayName: undefined,
    hasEnvelope: m.hasEnvelope,
    keyEpochLag: Math.max(0, data.keyEpoch - m.memberKeyEpoch),
  }));
}

/** 管理动作（移除/改角色/重发信封）只属于 owner；owner 自己的行不可管理。 */
export const canManageMembers = (role: ShareRole): boolean => role === 'owner';

/** 邀请同属 owner 付费动作（服务端有 entitlement 硬门；UI 只是提前挡）。 */
export const canInviteMembers = (role: ShareRole): boolean => role === 'owner';

/** 名额文案 key：满员时界面给「已达上限」而不是一个点了没反应的「邀请」按钮。 */
export type ShareMemberLimitKey = 'common.share.member.slotsLeft' | 'common.share.member.limitReached';

export const memberLimitState = (activeCount: number): {
  full: boolean;
  slotsLeft: number;
  messageKey: ShareMemberLimitKey;
} => ({
  full: activeCount >= MAX_SHARE_MEMBERS,
  slotsLeft: Math.max(0, MAX_SHARE_MEMBERS - activeCount),
  messageKey: activeCount >= MAX_SHARE_MEMBERS
    ? 'common.share.member.limitReached'
    : 'common.share.member.slotsLeft',
});

/** 角色可改判定的纯函数：目标角色合法、非 owner 行、且角色真的变了才放行。 */
export type RoleChangeDecision =
  | { allowed: true }
  | { allowed: false; reason: 'NOT_OWNER' | 'TARGET_IS_OWNER' | 'INVALID_ROLE' | 'ROLE_UNCHANGED' };

export const decideRoleChange = (args: {
  myRole: ShareRole;
  targetCurrentRole: ShareRole;
  nextRole: string;
}): RoleChangeDecision => {
  if (args.myRole !== 'owner') return { allowed: false, reason: 'NOT_OWNER' };
  if (args.targetCurrentRole === 'owner') return { allowed: false, reason: 'TARGET_IS_OWNER' };
  if (!isShareRole(args.nextRole) || args.nextRole === 'owner') {
    return { allowed: false, reason: 'INVALID_ROLE' };
  }
  if (args.nextRole === args.targetCurrentRole) {
    return { allowed: false, reason: 'ROLE_UNCHANGED' };
  }
  return { allowed: true };
};

/** 成员展示名兜底：per-share 名片落地前显示“成员 + id 前缀”，不显示裸数字。 */
export const memberFallbackLabel = (userId: number): string => `成员 ${String(userId).slice(0, 6)}`;
