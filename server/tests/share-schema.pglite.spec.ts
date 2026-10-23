import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { SHARE_SCHEMA_DDL } from './share-ddl.helper';

/**
 * 共享清单四张表的**数据库层不变量证据**（W2 判据，照 activity-schema 先例）。
 *
 * 为什么这一层必须单独有测试：迁移里的 CHECK 是计划 §2.4 里**声称**的
 * "最后一道防线"（role 词表、世代 ≥1、token 散列形状、接受的全有或全无、
 * 移除时间的因果顺序）。应用层测试全绿根本覆盖不到它们 —— 它们只在
 * 应用层写错时才生效。
 *
 * 本文件跑的是**发布中的迁移 SQL**（share-ddl.helper 从 migration.sql 读出），
 * 不是手抄的表结构。
 *
 * 🔴 每条约束都配一个**合法的对照行**：只测"非法被拒"的话，一个写坏了
 * 列名、把所有插入都拒绝的迁移会全绿。
 */

let db: PGlite;

let userSeq = 0;
const freshUser = async (): Promise<number> => {
  userSeq += 1;
  const res = await db.query<{ id: number }>(
    'INSERT INTO users (email) VALUES ($1) RETURNING id',
    [`u${userSeq}@example.test`],
  );
  return res.rows[0]!.id;
};

let shareSeq = 0;
const freshShare = async (ownerId?: number): Promise<string> => {
  shareSeq += 1;
  const id = `share-${shareSeq}`;
  const owner = ownerId ?? (await freshUser());
  await db.query(
    'INSERT INTO shares (id, owner_user_id, key_epoch, created_at) VALUES ($1, $2, 1, 1)',
    [id, owner],
  );
  return id;
};

/** 合法的成员行（测试非法变体时的对照基线）。 */
const insertMember = async (
  shareId: string,
  userId: number,
  overrides: Record<string, unknown> = {},
): Promise<void> => {
  const row = {
    id: `m-${Math.random().toString(36).slice(2)}`,
    share_id: shareId,
    user_id: userId,
    role: 'editor',
    member_key_epoch: 1,
    added_at: 1_000n,
    removed_at: null,
    ...overrides,
  };
  const cols = Object.keys(row);
  const placeholders = cols.map((_, i) => `$${i + 1}`).join(', ');
  await db.query(
    `INSERT INTO share_members (${cols.join(', ')}) VALUES (${placeholders})`,
    Object.values(row),
  );
};

const insertInvitation = async (
  shareId: string,
  creatorId: number,
  overrides: Record<string, unknown> = {},
): Promise<void> => {
  const row = {
    id: `inv-${Math.random().toString(36).slice(2)}`,
    share_id: shareId,
    token_hash: 'a'.repeat(64),
    created_by_id: creatorId,
    created_at: 1_000n,
    expires_at: 2_000n,
    revoked_at: null,
    accepted_by_user_id: null,
    accepted_at: null,
    ...overrides,
  };
  const cols = Object.keys(row);
  const placeholders = cols.map((_, i) => `$${i + 1}`).join(', ');
  await db.query(
    `INSERT INTO share_invitations (${cols.join(', ')}) VALUES (${placeholders})`,
    Object.values(row),
  );
};

const expectReject = async (sql: string, params: unknown[], why: string): Promise<void> => {
  try {
    await db.query(sql, params);
    throw new Error(`应当被数据库拒绝（${why}）却被接受了`);
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('应当被数据库拒绝')) throw err;
    // PGlite 抛错 = 约束生效 ✅
  }
};

beforeAll(async () => {
  db = new PGlite();
  await db.exec(SHARE_SCHEMA_DDL);
});

afterAll(async () => {
  await db.close();
});

describe('迁移：四张表与五组 CHECK 真的在库里', () => {
  it('五条命名 CHECK 全部存在（而不是只写在迁移注释里）', async () => {
    const res = await db.query<{ conname: string }>(
      `SELECT conname FROM pg_constraint WHERE contype = 'c'
       AND conname = ANY($1::text[])`,
      [[
        'share_members_role_vocabulary',
        'shares_key_epoch_positive',
        'share_members_key_epoch_positive',
        'share_invitations_token_hash_shape',
        'share_invitations_acceptance_all_or_nothing',
        'share_members_removed_after_added',
      ]],
    );
    expect(res.rows.length).toBe(6);
  });

  it('role 词表：四个合法角色进得去，词表外/大小写变体进不去', async () => {
    const owner = await freshUser();
    for (const role of ['owner', 'editor', 'commenter', 'viewer']) {
      const shareId = await freshShare(owner);
      // 合法对照：每个角色都有一条能进去的行
      await insertMember(shareId, await freshUser(), { role });
    }
    const shareId = await freshShare(owner);
    await expectReject(
      'INSERT INTO share_members (id, share_id, user_id, role, member_key_epoch, added_at) VALUES ($1,$2,$3,$4,1,1)',
      ['m-bad-role', shareId, await freshUser(), 'admin'],
      "role='admin' 不在词表",
    );
    await expectReject(
      'INSERT INTO share_members (id, share_id, user_id, role, member_key_epoch, added_at) VALUES ($1,$2,$3,$4,1,1)',
      ['m-bad-case', shareId, await freshUser(), 'Owner'],
      'role 大小写变体',
    );
  });

  it('密钥世代 ≥ 1：0 进不去，1 进得去（shares 与 share_members 都钉）', async () => {
    const owner = await freshUser();
    // 合法对照：epoch=1 的 share 能建
    const okId = await freshShare(owner);
    expect(okId).toBeTruthy();
    await expectReject(
      'INSERT INTO shares (id, owner_user_id, key_epoch, created_at) VALUES ($1,$2,0,1)',
      ['share-epoch0', owner],
      'shares.key_epoch=0',
    );
    const shareId = await freshShare(owner);
    await insertMember(shareId, await freshUser()); // 合法对照
    await expectReject(
      'INSERT INTO share_members (id, share_id, user_id, role, member_key_epoch, added_at) VALUES ($1,$2,$3,$4,0,1)',
      ['m-epoch0', shareId, await freshUser(), 'editor'],
      'member_key_epoch=0',
    );
  });

  it('邀请 token 散列形状：64 位小写 hex 进得去，裸 token / 大写进不去', async () => {
    const owner = await freshUser();
    const shareId = await freshShare(owner);
    await insertInvitation(shareId, owner, { token_hash: '0123456789abcdef'.repeat(4) }); // 合法对照
    await expectReject(
      'INSERT INTO share_invitations (id, share_id, token_hash, created_by_id, created_at, expires_at) VALUES ($1,$2,$3,$4,1,2)',
      [`inv-${Math.random().toString(36).slice(2)}`, shareId, 'raw-token-not-hash', owner],
      '裸 token 落库',
    );
    await expectReject(
      'INSERT INTO share_invitations (id, share_id, token_hash, created_by_id, created_at, expires_at) VALUES ($1,$2,$3,$4,1,2)',
      [`inv-${Math.random().toString(36).slice(2)}`, shareId, 'A'.repeat(64), owner],
      '大写 hex',
    );
  });

  it('邀请接受的全有或全无：两列全空/全有进得去，半成品进不去', async () => {
    const owner = await freshUser();
    const shareId = await freshShare(owner);
    await insertInvitation(shareId, owner, {
      id: 'inv-ok-both-null',
    });
    const invitee = await freshUser();
    await insertInvitation(shareId, owner, {
      id: 'inv-ok-both-set',
      token_hash: 'b'.repeat(64),
      accepted_by_user_id: invitee,
      accepted_at: 1_500n,
    });
    await expectReject(
      'INSERT INTO share_invitations (id, share_id, token_hash, created_by_id, created_at, expires_at, accepted_by_user_id, accepted_at) VALUES ($1,$2,$3,$4,1,2,$5,NULL)',
      ['inv-half-1', shareId, 'c'.repeat(64), owner, invitee],
      '只写了 accepted_by 没写 accepted_at',
    );
    await expectReject(
      'INSERT INTO share_invitations (id, share_id, token_hash, created_by_id, created_at, expires_at, accepted_by_user_id, accepted_at) VALUES ($1,$2,$3,$4,1,2,NULL,$5)',
      ['inv-half-2', shareId, 'd'.repeat(64), owner, 1_500n],
      '只写了 accepted_at 没写 accepted_by',
    );
  });

  it('成员移除时间：removed_at ≥ added_at；"先移除后加入"进不去', async () => {
    const owner = await freshUser();
    const shareId = await freshShare(owner);
    await insertMember(shareId, await freshUser(), { added_at: 1_000n, removed_at: null }); // 合法对照：未移除
    await insertMember(shareId, await freshUser(), { added_at: 1_000n, removed_at: 2_000n }); // 合法对照：后移除
    await expectReject(
      'INSERT INTO share_members (id, share_id, user_id, role, member_key_epoch, added_at, removed_at) VALUES ($1,$2,$3,$4,1,2000,1000)',
      ['m-time-travel', shareId, await freshUser(), 'editor'],
      'removed_at 早于 added_at',
    );
  });

  it('唯一约束：一人一清单一行；一清单一序号一枚', async () => {
    const owner = await freshUser();
    const shareId = await freshShare(owner);
    const member = await freshUser();
    await insertMember(shareId, member); // 合法对照
    try {
      await insertMember(shareId, member);
      throw new Error('同一人重复入群应当被唯一约束拒绝');
    } catch (err) {
      if (err instanceof Error && err.message.startsWith('同一人重复')) throw err;
    }
    // share_operations 的 (share_id, server_seq)
    const op = {
      id: 'op-1',
      share_id: shareId,
      client_id: 'client-a',
      server_seq: 1,
      action_type: 'add',
      op_type: 'create',
      entity_type: 'TASK',
      payload: {},
      vector_clock: {},
      schema_version: 1,
      client_timestamp: 1n,
      received_at: 1n,
    };
    const cols = Object.keys(op);
    const placeholders = cols.map((_, i) => `$${i + 1}`).join(', ');
    await db.query(
      `INSERT INTO share_operations (${cols.join(', ')}) VALUES (${placeholders})`,
      Object.values(op),
    );
    await expectReject(
      `INSERT INTO share_operations (${cols.join(', ')}) VALUES (${placeholders})`,
      Object.values({ ...op, id: 'op-2' }),
      '同清单同序号的第二条 op',
    );
  });

  it('级联删除：删用户带走他拥有的 share 与全部成员行（先有合法对照）', async () => {
    const owner = await freshUser();
    const shareId = await freshShare(owner);
    const member = await freshUser();
    await insertMember(shareId, member);
    const before = await db.query('SELECT count(*)::int AS n FROM shares WHERE id = $1', [shareId]);
    expect(before.rows[0]!.n).toBe(1);
    await db.query('DELETE FROM users WHERE id = $1', [owner]);
    const after = await db.query('SELECT count(*)::int AS n FROM shares WHERE id = $1', [shareId]);
    expect(after.rows[0]!.n).toBe(0);
    const members = await db.query('SELECT count(*)::int AS n FROM share_members WHERE share_id = $1', [shareId]);
    expect(members.rows[0]!.n).toBe(0);
  });
});

/**
 * M4 逐 op 签名（ADR-0069）那三枚列**在库里**的证据。
 *
 * 为什么这一层不能只靠 `schema.prisma`：Prisma 的模型与库里的列是两件事。
 * 生成器跑过（`prisma generate`）而迁移没落地时，服务端每次 `SELECT` 都会带上
 * 一条不存在的列 ⇒ 500，而 HTTP 层的契约测试全绿（它们 mock 了 prisma）。
 * 这里读的是**发布中的那份 migration.sql**，所以"注释里说加了"不算。
 */
describe('迁移：逐 op 签名的三枚可空列（ADR-0069）', () => {
  const insertOp = async (shareId: string, extra: Record<string, unknown> = {}): Promise<void> => {
    const row = {
      id: `op-${Math.random().toString(36).slice(2)}`,
      share_id: shareId,
      client_id: 'client-a',
      server_seq: Math.floor(Math.random() * 1_000_000),
      action_type: 'add task',
      op_type: 'CRT',
      entity_type: 'TASK',
      payload: {},
      vector_clock: {},
      schema_version: 1,
      client_timestamp: 1n,
      received_at: 1n,
      ...extra,
    };
    const cols = Object.keys(row);
    const placeholders = cols.map((_, i) => `$${String(i + 1)}`).join(', ');
    await db.query(
      `INSERT INTO share_operations (${cols.join(', ')}) VALUES (${placeholders})`,
      Object.values(row),
    );
  };

  it('三枚列都存在，且都是可空列 —— 「未签名」是一个表示得出来的状态', async () => {
    const res = await db.query<{ table_name: string; column_name: string; is_nullable: string }>(
      `SELECT table_name, column_name, is_nullable FROM information_schema.columns
        WHERE (table_name = 'share_members'    AND column_name = 'signing_public_key')
           OR (table_name = 'share_operations' AND column_name = ANY($1::text[]))`,
      [['signer_member_id', 'signature']],
    );
    expect(res.rows.map((r) => `${r.table_name}.${r.column_name}`).sort()).toEqual([
      'share_members.signing_public_key',
      'share_operations.signature',
      'share_operations.signer_member_id',
    ]);
    // 🔴 可空是裁决六的形状：签名启用之前的历史 op 不追签，所以"空"必须能存；
    // 加 NOT NULL 会把它变成"必须回填"，而回填等于伪造作者时点。
    for (const r of res.rows) expect(r.is_nullable).toBe('YES');
  });

  it('成员行与 op 行不带签名也进得去（历史行 / 未自证的人）', async () => {
    const owner = await freshUser();
    const shareId = await freshShare(owner);
    await insertMember(shareId, await freshUser());
    await insertOp(shareId);
    const rows = await db.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM share_operations WHERE share_id = $1 AND signature IS NULL',
      [shareId],
    );
    expect(rows.rows[0]!.n).toBe(1);
  });

  it('公钥与签名逐字节存得进去、也读得出来（不被截断或改写）', async () => {
    const owner = await freshUser();
    const shareId = await freshShare(owner);
    const signingKey = 'K3pGx0vJm1uXb9wQz2rTn4sLc5dHe8fA6gI0jK2mN4o';
    await insertMember(shareId, await freshUser(), { signing_public_key: signingKey });
    const member = await db.query<{ signing_public_key: string | null }>(
      'SELECT signing_public_key FROM share_members WHERE share_id = $1 AND signing_public_key IS NOT NULL',
      [shareId],
    );
    expect(member.rows[0]!.signing_public_key).toBe(signingKey);

    const signature = `${signingKey}+5Z3x7Vm9qL2wN4rT6yU8iO0pAsDfGhJkLZxcT5Y=`;
    await insertOp(shareId, { signature, signer_member_id: 'member-1' });
    const op = await db.query<{ signature: string | null; signer_member_id: string | null }>(
      'SELECT signature, signer_member_id FROM share_operations WHERE share_id = $1 AND signature IS NOT NULL',
      [shareId],
    );
    expect(op.rows[0]).toEqual({ signature, signer_member_id: 'member-1' });
  });
});
