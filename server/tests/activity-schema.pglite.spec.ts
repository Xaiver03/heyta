import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ACTIVITY_SCHEMA_DDL } from './activity-ddl.helper';

/**
 * 通知 / 邀请那三张表的**数据库层不变量证据**。
 *
 * 为什么这一层必须单独有测试：迁移里的五条 CHECK 是我在注释里**声称**的
 * "最后一道防线"（防自邀铸币、防半成品结算、防未归一化的码、防空 kind、
 * 防非对象载荷）。声称和证据是两件事 —— 而这几条约束的特殊之处在于
 * **应用层出错时它们才生效**，所以"应用层测试全绿"根本覆盖不到它们。
 *
 * 本文件跑的是**发布中的迁移 SQL**（`activity-ddl.helper.ts` 从
 * `prisma/migrations/.../migration.sql` 读出来），不是手抄的表结构。
 *
 * 🔴 每条约束都配一个**合法的对照行**：只测"非法被拒"的话，一个写坏了列名、
 * 把所有插入都拒绝的迁移会全绿。所以以下都是「合法的能进去 + 非法的进不去」成对出现。
 */

let db: PGlite;

let userSeq = 0;
/** 每个断言都要一个干净的邀请人，否则唯一约束会先于被测约束报错。 */
const freshUser = async (): Promise<number> => {
  userSeq += 1;
  const res = await db.query<{ id: number }>(
    'INSERT INTO users (email) VALUES ($1) RETURNING id',
    [`u${userSeq}@example.test`],
  );
  return res.rows[0]!.id;
};

const insertInviteCode = async (
  userId: number,
  code: string,
  disabled = false,
): Promise<void> => {
  await db.query(
    'INSERT INTO invite_codes (user_id, code, disabled, created_at) VALUES ($1, $2, $3, $4)',
    [userId, code, disabled, 1_800_000_000_000n],
  );
};

interface ReferralOverrides {
  activated_at?: bigint | null;
  reward_days?: number | null;
  rewarded_at?: bigint | null;
  code?: string;
  invitee_user_id?: number;
  inviter_user_id?: number;
}

const insertReferral = async (
  inviterUserId: number,
  inviteeUserId: number,
  overrides: ReferralOverrides = {},
): Promise<void> => {
  const row = {
    inviter_user_id: inviterUserId,
    invitee_user_id: inviteeUserId,
    code: 'ABCD2345',
    created_at: 1_800_000_000_000n,
    activated_at: null,
    reward_days: null,
    rewarded_at: null,
    ...overrides,
  };
  const cols = Object.keys(row);
  const placeholders = cols.map((_, i) => `$${i + 1}`).join(', ');
  await db.query(
    `INSERT INTO referrals (${cols.join(', ')}) VALUES (${placeholders})`,
    Object.values(row),
  );
};

const insertNotification = async (
  userId: number,
  kind: string,
  payload: string,
): Promise<void> => {
  await db.query(
    'INSERT INTO account_notifications (user_id, kind, payload, created_at) VALUES ($1, $2, $3::jsonb, $4)',
    [userId, kind, payload, 1_800_000_000_000n],
  );
};

beforeAll(async () => {
  db = new PGlite();
  await db.exec(ACTIVITY_SCHEMA_DDL);
});

afterAll(async () => {
  await db.close();
});

describe('迁移：发布物里真的带上了那五条 CHECK', () => {
  it('五条命名约束都在库里（而不是只写在注释里）', async () => {
    const res = await db.query<{ conname: string }>(
      `SELECT conname FROM pg_constraint WHERE contype = 'c' AND conname LIKE ANY($1::text[])`,
      [
        [
          'invite_codes_code_normalized',
          'referrals_no_self_invite',
          'referrals_settlement_all_or_nothing',
          'account_notifications_kind_nonempty',
          'account_notifications_payload_is_object',
        ],
      ],
    );
    expect(res.rows.map((r) => r.conname).sort()).toEqual(
      [
        'account_notifications_kind_nonempty',
        'account_notifications_payload_is_object',
        'invite_codes_code_normalized',
        'referrals_no_self_invite',
        'referrals_settlement_all_or_nothing',
      ].sort(),
    );
  });
});

describe('invite_codes：码必须是「归一化之后」的形状', () => {
  it('大写无空白的码能进去', async () => {
    const uid = await freshUser();
    await expect(insertInviteCode(uid, 'ABCD2345')).resolves.toBeUndefined();
  });

  it('小写码进不去（否则用户输对了也匹配不上）', async () => {
    const uid = await freshUser();
    await expect(insertInviteCode(uid, 'abcd2345')).rejects.toThrow();
  });

  it('带首尾空白的码进不去（空白肉眼看不见）', async () => {
    const uid = await freshUser();
    await expect(insertInviteCode(uid, ' ABCD2345 ')).rejects.toThrow();
  });

  it('空串进不去', async () => {
    const uid = await freshUser();
    await expect(insertInviteCode(uid, '')).rejects.toThrow();
  });

  it('一个用户只能有一张码（惰性生成的并发闸门）', async () => {
    const uid = await freshUser();
    await insertInviteCode(uid, 'AAAA2222');
    await expect(insertInviteCode(uid, 'BBBB3333')).rejects.toThrow();
  });

  it('码全局唯一', async () => {
    const a = await freshUser();
    const b = await freshUser();
    await insertInviteCode(a, 'CCCC4444');
    await expect(insertInviteCode(b, 'CCCC4444')).rejects.toThrow();
  });
});

describe('referrals：结算状态必须「全有或全无」', () => {
  it('未兑现（三个字段全 NULL）能进去', async () => {
    const inviter = await freshUser();
    const invitee = await freshUser();
    await expect(insertReferral(inviter, invitee)).resolves.toBeUndefined();
  });

  it('已兑现（三个字段齐、天数 > 0）能进去', async () => {
    const inviter = await freshUser();
    const invitee = await freshUser();
    await expect(
      insertReferral(inviter, invitee, {
        activated_at: 1_800_000_001_000n,
        reward_days: 5,
        rewarded_at: 1_800_000_001_000n,
      }),
    ).resolves.toBeUndefined();
  });

  it('🔴 激活了但没写天数 → 拒绝（否则界面成功邀请 +1、会员一天不涨）', async () => {
    const inviter = await freshUser();
    const invitee = await freshUser();
    await expect(
      insertReferral(inviter, invitee, { activated_at: 1_800_000_001_000n }),
    ).rejects.toThrow();
  });

  it('🔴 有天数但没有激活时刻 → 拒绝', async () => {
    const inviter = await freshUser();
    const invitee = await freshUser();
    await expect(insertReferral(inviter, invitee, { reward_days: 5 })).rejects.toThrow();
  });

  it('🔴 发了 0 天 → 拒绝（那是一次静默的空操作，且此后再也不会重发）', async () => {
    const inviter = await freshUser();
    const invitee = await freshUser();
    await expect(
      insertReferral(inviter, invitee, {
        activated_at: 1_800_000_001_000n,
        reward_days: 0,
        rewarded_at: 1_800_000_001_000n,
      }),
    ).rejects.toThrow();
  });

  it('🔴 负数天 → 拒绝', async () => {
    const inviter = await freshUser();
    const invitee = await freshUser();
    await expect(
      insertReferral(inviter, invitee, {
        activated_at: 1_800_000_001_000n,
        reward_days: -5,
        rewarded_at: 1_800_000_001_000n,
      }),
    ).rejects.toThrow();
  });

  it('🔴 自己邀请自己 → 拒绝（这是防铸币，不是整洁）', async () => {
    const uid = await freshUser();
    await expect(insertReferral(uid, uid)).rejects.toThrow();
  });

  it('一个被邀请人只能被算一次（防重复发奖的数据库级保证）', async () => {
    const inviterA = await freshUser();
    const inviterB = await freshUser();
    const invitee = await freshUser();
    await insertReferral(inviterA, invitee);
    await expect(insertReferral(inviterB, invitee)).rejects.toThrow();
  });

  it('同一个邀请人可以邀请多个人', async () => {
    const inviter = await freshUser();
    await expect(
      insertReferral(inviter, await freshUser()),
    ).resolves.toBeUndefined();
    await expect(
      insertReferral(inviter, await freshUser()),
    ).resolves.toBeUndefined();
  });
});

describe('account_notifications：kind 与 payload 的形状', () => {
  it('正常的一条能进去', async () => {
    const uid = await freshUser();
    await expect(
      insertNotification(uid, 'referral-activated', '{"displayName":"star","days":5}'),
    ).resolves.toBeUndefined();
  });

  it('空 kind → 拒绝（它渲染不出任何东西）', async () => {
    const uid = await freshUser();
    await expect(insertNotification(uid, '', '{}')).rejects.toThrow();
  });

  it('payload 是数组 → 拒绝（读取端会拿到一堆 undefined）', async () => {
    const uid = await freshUser();
    await expect(insertNotification(uid, 'referral-activated', '[]')).rejects.toThrow();
  });

  it('payload 是标量 → 拒绝', async () => {
    const uid = await freshUser();
    await expect(insertNotification(uid, 'referral-activated', '5')).rejects.toThrow();
  });
});

describe('外键：删账号会带走这三张表里的行', () => {
  it('删掉用户后，他的码 / 邀请 / 通知都不在了', async () => {
    const inviter = await freshUser();
    const invitee = await freshUser();
    await insertInviteCode(inviter, 'DDDD5555');
    await insertReferral(inviter, invitee);
    await insertNotification(inviter, 'referral-activated', '{"days":5}');

    await db.query('DELETE FROM users WHERE id = $1', [inviter]);

    const codes = await db.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM invite_codes WHERE user_id = $1',
      [inviter],
    );
    const referrals = await db.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM referrals WHERE inviter_user_id = $1',
      [inviter],
    );
    const notifications = await db.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM account_notifications WHERE user_id = $1',
      [inviter],
    );
    expect(codes.rows[0]!.n).toBe(0);
    expect(referrals.rows[0]!.n).toBe(0);
    expect(notifications.rows[0]!.n).toBe(0);
  });
});
