import { describe, expect, it } from 'vitest';

import {
  canInviteMembers,
  canManageMembers,
  decideRoleChange,
  MAX_SHARE_MEMBERS,
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
    expect(views[1].isSelf).toBe(true);
    expect(views[0].isSelf).toBe(false);
    expect(views[0].isOwner).toBe(true);
  });

  it('世代落后可视：memberKeyEpoch 落后 ⇒ keyEpochLag > 0（「等待所有者授权」的依据）', () => {
    const views = projectMembersFor(
      panel([member(2, 'editor', 100, { memberKeyEpoch: 1 })]),
      2,
    );
    expect(views[0].keyEpochLag).toBe(1);
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
