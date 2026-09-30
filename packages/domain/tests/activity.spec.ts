import { describe, expect, it } from 'vitest';

import {
  CAMPAIGN_CATALOG,
  INVITE_CAP_PER_WINDOW,
  INVITE_CODE_ALPHABET,
  INVITE_CODE_LENGTH,
  INVITE_REWARD_DAYS,
  decideInviteAttach,
  displayNameFromEmail,
  findCampaign,
  inspectInviteCodeShape,
  isInviteCodeShape,
  isNotificationKind,
  normalizeInviteCode,
  parseNotificationPayload,
  parseReferralActivatedPayload,
} from '../src/activity.js';

/**
 * 活动/邀请的纯逻辑。
 *
 * 这一层值得单独测的理由很具体：**它是服务端与客户端共用的同一份规则**。
 * 归一化写错一个字，服务端的查找与客户端的预校验就会各说各话 ——
 * 而那种漂移在两端各自的测试里都是绿的。
 */

describe('邀请码字母表', () => {
  it('剔除了易混字符（0/O、1/I/L）', () => {
    for (const ch of ['0', 'O', '1', 'I', 'L']) {
      expect(
        INVITE_CODE_ALPHABET.includes(ch),
        `字母表里不该有 ${ch} —— 这个码要被人手抄和口述`,
      ).toBe(false);
    }
  });

  it('字母表本身没有重复字符', () => {
    expect(new Set(INVITE_CODE_ALPHABET).size).toBe(INVITE_CODE_ALPHABET.length);
  });

  it('长度是一个可手抄的值', () => {
    expect(INVITE_CODE_LENGTH).toBeGreaterThanOrEqual(6);
    expect(INVITE_CODE_LENGTH).toBeLessThanOrEqual(12);
  });
});

describe('normalizeInviteCode', () => {
  it('转大写', () => {
    expect(normalizeInviteCode('abcd2345')).toBe('ABCD2345');
  });

  it('丢掉首尾空白', () => {
    expect(normalizeInviteCode('  abcd2345  ')).toBe('ABCD2345');
  });

  it('丢掉用户粘贴进来的分隔符（他们并没有做错什么）', () => {
    expect(normalizeInviteCode('ABCD-2345')).toBe('ABCD2345');
    expect(normalizeInviteCode('ABCD 2345')).toBe('ABCD2345');
    expect(normalizeInviteCode('ABCD_2345')).toBe('ABCD2345');
  });

  it('丢掉了零宽字符之类的不可见内容', () => {
    expect(normalizeInviteCode('ABCD\u200b2345')).toBe('ABCD2345');
  });

  it('幂等：归一化两次与一次相同', () => {
    for (const raw of ['abcd-2345', ' ABCD2345 ', 'ABCD2345']) {
      const once = normalizeInviteCode(raw);
      expect(normalizeInviteCode(once)).toBe(once);
    }
  });

  it('🔴 归一化的产出总是满足库里的 CHECK（大写 + 无空白）', () => {
    // 迁移 `invite_codes_code_normalized` 钉住 "code = upper(btrim(code))"。
    // 这条断言把"函数产出"与"数据库约束"这两端绑在一起：
    // 谁改了归一化规则而没改 CHECK（或反过来），这里会红。
    for (const raw of [' abcd-2345 ', 'AbCd 2345', 'abcd2345']) {
      const normalized = normalizeInviteCode(raw);
      expect(normalized).toBe(normalized.toUpperCase());
      expect(normalized).toBe(normalized.trim());
    }
  });
});

describe('isInviteCodeShape / inspectInviteCodeShape', () => {
  it('长度与字符都对的码形状正确', () => {
    const code = 'ABCD2345';
    expect(code.length).toBe(INVITE_CODE_LENGTH);
    expect(isInviteCodeShape(code)).toBe(true);
    expect(inspectInviteCodeShape(code)).toBeNull();
  });

  it('空串 → empty', () => {
    expect(isInviteCodeShape('')).toBe(false);
    expect(inspectInviteCodeShape('')).toBe('empty');
  });

  it('长度不对 → length（措辞要说"少一位"，不是"有非法字符"）', () => {
    expect(isInviteCodeShape('ABCD234')).toBe(false);
    expect(inspectInviteCodeShape('ABCD234')).toBe('length');
    expect(inspectInviteCodeShape('ABCD23456')).toBe('length');
  });

  it('长度对但含字母表外的字符（如 O）→ characters', () => {
    expect(isInviteCodeShape('ABCD234O')).toBe(false);
    expect(inspectInviteCodeShape('ABCD234O')).toBe('characters');
  });
});

describe('decideInviteAttach', () => {
  const base = {
    inviterUserId: 1,
    inviteeUserId: 2,
    codeDisabled: false,
    inviteeAlreadyReferred: false,
    invitesInWindow: 0,
  } as const;

  it('一切正常 → 绑定', () => {
    expect(decideInviteAttach(base)).toEqual({ attached: true });
  });

  it('自己邀请自己 → SELF_INVITE', () => {
    expect(decideInviteAttach({ ...base, inviteeUserId: 1 })).toEqual({
      attached: false,
      reason: 'SELF_INVITE',
    });
  });

  it('🔴 判定顺序：自邀优先于"额度用完"（否则会说出关于额度的假话）', () => {
    expect(
      decideInviteAttach({
        ...base,
        inviteeUserId: 1,
        invitesInWindow: INVITE_CAP_PER_WINDOW,
      }),
    ).toEqual({ attached: false, reason: 'SELF_INVITE' });
  });

  it('码被停用 → CODE_DISABLED', () => {
    expect(decideInviteAttach({ ...base, codeDisabled: true })).toEqual({
      attached: false,
      reason: 'CODE_DISABLED',
    });
  });

  it('被邀请人已经被算过 → INVITEE_ALREADY_REFERRED', () => {
    expect(decideInviteAttach({ ...base, inviteeAlreadyReferred: true })).toEqual({
      attached: false,
      reason: 'INVITEE_ALREADY_REFERRED',
    });
  });

  it('窗口内刚好到上限 → CAP_REACHED', () => {
    expect(
      decideInviteAttach({ ...base, invitesInWindow: INVITE_CAP_PER_WINDOW }),
    ).toEqual({ attached: false, reason: 'CAP_REACHED' });
  });

  it('窗口内差一条到上限 → 还能绑（边界是 >= 不是 >）', () => {
    expect(
      decideInviteAttach({ ...base, invitesInWindow: INVITE_CAP_PER_WINDOW - 1 }),
    ).toEqual({ attached: true });
  });

  it('上限可注入，便于把边界测成确定场景', () => {
    expect(decideInviteAttach({ ...base, invitesInWindow: 1, cap: 1 })).toEqual({
      attached: false,
      reason: 'CAP_REACHED',
    });
    expect(decideInviteAttach({ ...base, invitesInWindow: 1, cap: 2 })).toEqual({
      attached: true,
    });
  });
});

describe('活动目录', () => {
  it('邀请活动是唯一在架的活动', () => {
    expect(CAMPAIGN_CATALOG.map((c) => c.id)).toEqual(['invite-friends']);
  });

  it('邀请活动的奖励天数来自单一常量', () => {
    expect(CAMPAIGN_CATALOG[0]!.rewardDays).toBe(INVITE_REWARD_DAYS);
  });

  it('findCampaign 命中已知 id', () => {
    expect(findCampaign('invite-friends')?.kind).toBe('invite');
  });

  it('🔴 未知 id 返回 null 而不是抛（老客户端会遇到新 id）', () => {
    expect(findCampaign('spring-festival-2027')).toBeNull();
  });
});

describe('displayNameFromEmail', () => {
  it('取邮箱用户名部分', () => {
    expect(displayNameFromEmail('star@example.com')).toBe('star');
  });

  it('没有 @ 时整串都算用户名', () => {
    expect(displayNameFromEmail('star')).toBe('star');
  });

  it('🔴 拿不到就返回 null —— 兜底由渲染层按读者语言决定，不在这里编一个名字', () => {
    expect(displayNameFromEmail('@example.com')).toBeNull();
    expect(displayNameFromEmail('   @example.com')).toBeNull();
  });
});

describe('通知载荷校验（数据边界，不做类型信任）', () => {
  const good = { displayName: 'star', days: 5 };

  it('正常载荷能解析', () => {
    expect(parseReferralActivatedPayload(good)).toEqual({ displayName: 'star', days: 5 });
  });

  it('displayName 为 null 是合法的（读不出名字，不是坏数据）', () => {
    expect(parseReferralActivatedPayload({ displayName: null, days: 5 })).toEqual({
      displayName: null,
      days: 5,
    });
  });

  it('载荷是数组 → null（`Json` 列能装数组）', () => {
    expect(parseReferralActivatedPayload([])).toBeNull();
  });

  it('载荷是标量 → null', () => {
    expect(parseReferralActivatedPayload(5)).toBeNull();
    expect(parseReferralActivatedPayload(null)).toBeNull();
    expect(parseReferralActivatedPayload('{"days":5}')).toBeNull();
  });

  it('days 是字符串 → null（文案里会少一个数字）', () => {
    expect(parseReferralActivatedPayload({ displayName: 'star', days: '5' })).toBeNull();
  });

  it('days 不是正数 → null', () => {
    expect(parseReferralActivatedPayload({ displayName: 'star', days: 0 })).toBeNull();
    expect(parseReferralActivatedPayload({ displayName: 'star', days: -1 })).toBeNull();
    expect(parseReferralActivatedPayload({ displayName: 'star', days: NaN })).toBeNull();
  });

  it('displayName 是空串 → null（会渲染出「 成功激活」）', () => {
    expect(parseReferralActivatedPayload({ displayName: '  ', days: 5 })).toBeNull();
  });

  it('缺字段 → null', () => {
    expect(parseReferralActivatedPayload({ days: 5 })).toBeNull();
    expect(parseReferralActivatedPayload({ displayName: 'star' })).toBeNull();
  });
});

describe('isNotificationKind / parseNotificationPayload', () => {
  it('已知 kind 认出自己', () => {
    expect(isNotificationKind('referral-activated')).toBe(true);
  });

  it('未知 kind 不被认（客户端要优雅跳过）', () => {
    expect(isNotificationKind('task-overdue')).toBe(false);
    expect(isNotificationKind('')).toBe(false);
    expect(isNotificationKind(undefined)).toBe(false);
    expect(isNotificationKind(7)).toBe(false);
  });

  it('未知 kind 的载荷 → null（跳过，而不是渲染半条）', () => {
    expect(
      parseNotificationPayload('task-overdue', { displayName: 'a', days: 1 }),
    ).toBeNull();
  });

  it('已知 kind 但载荷坏了 → null', () => {
    expect(parseNotificationPayload('referral-activated', {})).toBeNull();
  });

  it('已知 kind + 好载荷 → 解析出来', () => {
    expect(parseNotificationPayload('referral-activated', { displayName: 'a', days: 1 })).toEqual(
      { displayName: 'a', days: 1 },
    );
  });
});
