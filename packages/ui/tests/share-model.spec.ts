import { describe, expect, it } from 'vitest';

import {
  canInviteMembers,
  canManageMembers,
  decideRoleChange,
  MAX_SHARE_MEMBERS,
  memberCanHoldOwnership,
  memberFallbackLabel,
  memberLimitState,
  projectMembersFor,
  SHARE_MEMBER_ROLES,
} from '../src/sync/share-model';

const member = (userId: number, role: string, addedAt: number, overrides = {}) => ({
  memberId: `m-${userId}`,
  userId,
  role,
  addedAt,
  hasEnvelope: true,
  memberKeyEpoch: 1,
  ...overrides,
});

const panel = (members: Parameters<typeof projectMembersFor>[0]['members']) => ({
  shareId: 'share-1',
  ownerId: 1,
  keyEpoch: 2,
  myRole: 'owner' as const,
  members,
});

describe('projectMembersFor · selfMemberId 优先（W4 web 接线）', () => {
  it('有 selfMemberId 时按成员行 id 判 isSelf —— web 宿主拿不到自己的数字 userId', () => {
    const views = projectMembersFor(
      { ...panel([member(1, 'owner', 100), member(2, 'editor', 200)]), selfMemberId: 'm-2' },
    );
    expect(views[1]!.isSelf).toBe(true);
    expect(views[0]!.isSelf).toBe(false);
  });

  it('selfMemberId 与 userId 都在 ⇒ memberId 赢（userId 与别人的撞上也不误判）', () => {
    const views = projectMembersFor(
      { ...panel([member(7, 'viewer', 100)]), selfMemberId: 'm-7' },
      999, // 一个恰好不匹配任何成员的 userId —— 不许它否掉 memberId 的判定。
    );
    expect(views[0]!.isSelf).toBe(true);
  });

  it('没传 selfMemberId 时回落按 userId 判（既有调用点行为不变）', () => {
    const views = projectMembersFor(panel([member(2, 'editor', 100)]), 2);
    expect(views[0]!.isSelf).toBe(true);
  });
});

describe('projectMembersFor', () => {
  it('owner 排最先、其余按加入时间；isSelf 精确按 userId', () => {
    const views = projectMembersFor(
      panel([
        member(3, 'editor', 300),
        member(1, 'owner', 100),
        member(2, 'viewer', 200),
      ]),
      2,
    );
    expect(views.map((v) => v.userId)).toEqual([1, 2, 3]);
    expect(views[1]!.isSelf).toBe(true);
    expect(views[0]!.isSelf).toBe(false);
    expect(views[0]!.isOwner).toBe(true);
  });

  it('世代落后可视：memberKeyEpoch 落后 ⇒ keyEpochLag > 0（「等待所有者授权」的依据）', () => {
    const views = projectMembersFor(
      panel([member(2, 'editor', 100, { memberKeyEpoch: 1 })]),
      2,
    );
    expect(views[0]!.keyEpochLag).toBe(1);
  });
});

describe('memberCanHoldOwnership（B-10：能不能接手所有权）', () => {
  // 面板拿它决定「转让」这颗按钮给不给。两半各挡一种失法，少一半就有一条假路。
  const viewOf = (overrides = {}) =>
    projectMembersFor(panel([member(2, 'editor', 100, overrides)]), 1)[0]!;

  it('信封非空 + 世代对齐 ⇒ 合格（这是唯一该给按钮的形状）', () => {
    expect(memberCanHoldOwnership(viewOf({ memberKeyEpoch: 2 }))).toBe(true);
  });

  it('🔴 世代对齐但手里没信封 ⇒ 不合格 —— 这正是刚接受邀请的人的默认形状', () => {
    expect(memberCanHoldOwnership(viewOf({ memberKeyEpoch: 2, hasEnvelope: false }))).toBe(false);
  });

  it('🔴 有信封但世代落后 ⇒ 不合格（那是上一把钥，接手后读不到当前内容）', () => {
    expect(memberCanHoldOwnership(viewOf({ memberKeyEpoch: 1, hasEnvelope: true }))).toBe(false);
  });
});

describe('memberLimitState（29 名额 + owner）', () => {
  it('29 人 = 还有 1 个名额；30 人 = 满员', () => {
    const near = memberLimitState(MAX_SHARE_MEMBERS - 1);
    expect(near.full).toBe(false);
    expect(near.slotsLeft).toBe(1);
    const full = memberLimitState(MAX_SHARE_MEMBERS);
    expect(full.full).toBe(true);
    expect(full.slotsLeft).toBe(0);
  });

  it('词表只有四角色（与服务端同源同序的镜像）', () => {
    expect(SHARE_MEMBER_ROLES).toEqual(['owner', 'editor', 'commenter', 'viewer']);
  });
});

describe('decideRoleChange', () => {
  const base = { myRole: 'owner' as const, targetCurrentRole: 'editor' as const };

  it('owner 把 editor 改成 viewer：放行', () => {
    expect(decideRoleChange({ ...base, nextRole: 'viewer' })).toEqual({ allowed: true });
  });

  it('非 owner 想改任何角色：拒（NOT_OWNER）', () => {
    expect(decideRoleChange({ myRole: 'editor', targetCurrentRole: 'viewer', nextRole: 'editor' }))
      .toEqual({ allowed: false, reason: 'NOT_OWNER' });
  });

  it('目标是 owner 行：拒（转让是独立动作，W6）', () => {
    expect(decideRoleChange({
      myRole: 'owner', targetCurrentRole: 'owner', nextRole: 'viewer',
    })).toEqual({ allowed: false, reason: 'TARGET_IS_OWNER' });
  });

  it('改成 owner 或改成当前角色：拒', () => {
    expect(decideRoleChange({ myRole: 'owner', targetCurrentRole: 'editor', nextRole: 'owner' }))
      .toEqual({ allowed: false, reason: 'INVALID_ROLE' });
    expect(decideRoleChange({ myRole: 'owner', targetCurrentRole: 'editor', nextRole: 'editor' }))
      .toEqual({ allowed: false, reason: 'ROLE_UNCHANGED' });
  });

  it('词表外角色：拒', () => {
    expect(decideRoleChange({ myRole: 'owner', targetCurrentRole: 'editor', nextRole: 'admin' }))
      .toEqual({ allowed: false, reason: 'INVALID_ROLE' });
  });
});

describe('管理动作与兜底名', () => {
  it('只有 owner 能管理/邀请', () => {
    expect(canManageMembers('owner')).toBe(true);
    expect(canManageMembers('editor')).toBe(false);
    expect(canInviteMembers('owner')).toBe(true);
    expect(canInviteMembers('viewer')).toBe(false);
  });

  it('兜底名不显示裸数字 id', () => {
    const label = memberFallbackLabel(123456789);
    expect(label).not.toMatch(/^\d+$/);
    expect(label).toContain('123456');
  });
});
