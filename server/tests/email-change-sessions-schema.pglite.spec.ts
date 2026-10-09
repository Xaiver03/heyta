import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { MINIMAL_USERS_DDL } from './pricing-ddl.helper';

/**
 * `20261018140000_add_email_change_and_access_sessions` 的**数据库层证据**（工单 W9）
 * ===============================================================================
 *
 * ## 为什么这一层必须单独有（应用层的 92 条一条都替不了它）
 *
 * `email-change.spec.ts` / `access-sessions.spec.ts` 跑的是**假 prisma**：那里的
 * `where`、`deleteMany`、主键都是本文件作者写的模拟。它们能证明"代码按我理解的语义走"，
 * 不能证明"库真的拦得住"。这条迁移把三件事交给数据库而不是交给某个函数记得去拦，
 * 而那三件事写错了 `prisma migrate deploy` **不会失败**：
 *
 * | 性质 | 写错成 | 症状 |
 * |---|---|---|
 * | `email_change_requests.user_id` 既是主键又是外键 | 普通列 + 唯一索引，或干脆没主键 | "一个账号同时两张活请求互相抢先"在库面上**写不出来**这件事变成一句祈祷；两侧点击各生效一次 |
 * | `pending_email` 上那条 UNIQUE | 漏掉 | 两个账号抢同一个待绑地址，最后落库的是**后点的那一个**，而前一个人的确认链接还活着 |
 * | 两条外键 `ON DELETE CASCADE` | 漏掉 / `SET NULL` | 注销账号后**待绑的新邮箱明文与会话行留在库里**，而《注销即真删除》那三处文案按级联条数对外承诺 |
 * | 四列时间是 `BIGINT` | `INTEGER` | 毫秒时间戳越过 2³¹ 那一刻（2038 那道坎在 int4 上是 2038-01-19）—— 到期判断直接变负数，"过期"与"没过期"反过来 |
 * | `access_sessions` **没有** `revoked_at` | 加一列软撤销 | 与"存在即有效"这条裁决相反，而"撤过的会话"会长期留在库里 —— 那是留存面，不是整洁度 |
 *
 * ## 纪律
 *
 * SQL 从**发布中的迁移文件**读出来，不手抄（`account-profile-schema.pglite.spec.ts` 同一口径）；
 * 锚点缺一个就在 setup 阶段炸，而不是变成一组测着不存在结构的绿灯。
 * 每条"非法被拒"都配一个**合法的对照行** —— 只测拒绝的话，一个把所有插入都拒掉的
 * 坏迁移会全绿。
 */

const MIGRATION_DIR = '20261018140000_add_email_change_and_access_sessions';
const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), '../prisma/migrations');

const migrationSqlFromFile = (): string => {
  const sql = readFileSync(join(migrationsDir, MIGRATION_DIR, 'migration.sql'), 'utf8');
  const missing = [
    'CREATE TABLE "email_change_requests"',
    'CREATE TABLE "access_sessions"',
    'UNIQUE INDEX "email_change_requests_pending_email_key"',
    'CONSTRAINT "email_change_requests_user_id_fkey"',
    'CONSTRAINT "access_sessions_user_id_fkey"',
  ].filter((needle) => !sql.includes(needle));
  if (missing.length > 0) {
    throw new Error(
      `${MIGRATION_DIR}/migration.sql 里缺这些锚点：${missing.join('、')}。\n` +
        '   🔴 迁移被改名/重构时请更新本文件的锚点，而不是把断言删掉 ——\n' +
        '      上面每一个锚点都是下面某一条判据的前提。',
    );
  }
  return sql;
};

const MIGRATION_SQL = migrationSqlFromFile();

let db: PGlite;

/** 每个用例拿一个新账号，避免"上一例留下的行"被读成"这一例的性质"。 */
let userSeq = 0;
const freshUser = async (email = `acct-${Date.now()}-${userSeq}@example.test`): Promise<number> => {
  userSeq += 1;
  const res = await db.query<{ id: number }>('INSERT INTO users (email) VALUES ($1) RETURNING id', [
    email,
  ]);
  return res.rows[0]!.id;
};

const insertRequest = (
  userId: number,
  pendingEmail: string,
  extra: Partial<Record<string, unknown>> = {},
): Promise<unknown> => {
  // 🔴 `??` 在这里是**探针的 bug**而不是被测物的：`extra.oldToken ?? 'a'.repeat(64)`
  // 会把"刻意传 null"读成"没传"，于是那条"从未签发"的合法对照行永远测不到 null。
  // 显式判 `undefined`，让 null 真的是 null。
  const pick = <T>(key: string, fallback: T): T | null =>
    (extra[key] as T | null | undefined) === undefined ? fallback : (extra[key] as T | null);
  return db.query(
    `INSERT INTO email_change_requests
       (user_id, pending_email, requested_at, old_token, new_token, old_expires_at, new_expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      userId,
      pendingEmail,
      pick('requestedAt', 1_700_000_000_000),
      pick('oldToken', 'a'.repeat(64)),
      pick('newToken', 'b'.repeat(64)),
      pick('oldExpiresAt', 1_700_008_640_000),
      pick('newExpiresAt', 1_700_008_640_000),
    ],
  );
};

const insertSession = (
  jtiHash: string,
  userId: number,
  tokenVersion = 0,
  createdAt = 1_700_000_000_000,
): Promise<unknown> =>
  db.query(
    `INSERT INTO access_sessions (jti_hash, user_id, token_version, created_at, last_seen_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [jtiHash, userId, tokenVersion, createdAt, createdAt],
  );

const count = async (table: 'email_change_requests' | 'access_sessions', userId: number) => {
  const res = await db.query<{ c: string }>(
    `SELECT count(*) AS c FROM ${table} WHERE user_id = $1`,
    [userId],
  );
  return Number(res.rows[0]?.c);
};

beforeAll(async () => {
  db = new PGlite();
  // 先建"迁移前"的 users 并插两行存量账号 —— "新表零行 ⇒ 存量账号一行都不受影响"这条
  // 性质需要一个**存在着的**存量行来证明，空库测它等于没测。
  await db.exec(MINIMAL_USERS_DDL);
  await db.query('INSERT INTO users (email) VALUES ($1)', ['existing@example.test']);
  await db.exec(MIGRATION_SQL);
});

afterAll(async () => {
  await db.close();
});

describe('前提：迁移真的应用了，而且没碰存量账号', () => {
  it('两张新表都在，且建出来是**零行**（这是"不动存量"那句的前提，不是结论）', async () => {
    for (const table of ['email_change_requests', 'access_sessions'] as const) {
      const res = await db.query<{ c: string }>(`SELECT count(*) AS c FROM ${table}`);
      expect(Number(res.rows[0]?.c), `${table} 建出来就该是空的`).toBe(0);
    }
  });

  it('存量那行账号还在原地（迁移里没有任何一句 ALTER "users"）', async () => {
    const res = await db.query<{ email: string }>('SELECT email FROM users WHERE email = $1', [
      'existing@example.test',
    ]);
    expect(res.rows).toHaveLength(1);
    expect(sqlWithoutComments()).not.toMatch(/ALTER\s+TABLE\s+"users"/i);
  });
});

const sqlWithoutComments = (): string => MIGRATION_SQL.replace(/--[^\n]*/g, '');

describe('一个账号同时最多一张活请求（1:1 由主键表达，不由某个函数记得去拦）', () => {
  it('🔴 同一个 user_id 插第二张 ⇒ 主键拒绝；对照：两个账号各插一张都成功', async () => {
    const a = await freshUser();
    const b = await freshUser();

    await insertRequest(a, 'first@example.test');
    await insertRequest(b, 'second@example.test');

    let rejected = false;
    try {
      await insertRequest(a, 'third@example.test');
    } catch {
      rejected = true;
    }
    expect(rejected, '第二张活请求写进去了 —— "互相抢先"这个状态在库面上又写得出来了').toBe(true);
    expect(await count('email_change_requests', a)).toBe(1);
    expect(await count('email_change_requests', b)).toBe(1);
  });

  it('两个账号抢同一个待绑地址 ⇒ 第二个被拒；第一个的请求行不受影响', async () => {
    const owner = await freshUser();
    const squatter = await freshUser();
    await insertRequest(owner, 'claimed@example.test');

    let rejected = false;
    try {
      await insertRequest(squatter, 'claimed@example.test');
    } catch {
      rejected = true;
    }
    expect(rejected, 'pending_email 那条 UNIQUE 没生效').toBe(true);
    // 被拒的一方**一行都没留下**（半个请求 = 一封永远点不开的邮件）。
    expect(await count('email_change_requests', squatter)).toBe(0);
    expect(await count('email_change_requests', owner)).toBe(1);
  });

  it('合法对照：两枚令牌都还没签发（null）那一行写得出来 —— 它是"从未签发"的形状，不是坏形状', async () => {
    const id = await freshUser();
    await insertRequest(id, 'unsigned@example.test', {
      oldToken: null,
      newToken: null,
      oldExpiresAt: null,
      newExpiresAt: null,
    });
    const res = await db.query<{ old_token: string | null; new_token: string | null }>(
      'SELECT old_token, new_token FROM email_change_requests WHERE user_id = $1',
      [id],
    );
    expect(res.rows[0]).toEqual({ old_token: null, new_token: null });
  });
});

describe('时间列是 BIGINT：毫秒要能原样回来', () => {
  it('越过 int4 上限（2³¹）与更高的毫秒值都逐字读回，不截断、不绕负', async () => {
    const id = await freshUser();
    const beyondInt4 = 2_147_483_648; // int4 上限 + 1：写成 INTEGER 会当场溢出
    const epochMs = 4_102_444_800_000; // 2100-01-01，"到期判断变负数"那一档
    await db.query(
      `INSERT INTO email_change_requests
         (user_id, pending_email, requested_at, old_expires_at, new_expires_at, last_sent_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [id, 'bigint@example.test', beyondInt4, epochMs, epochMs, epochMs],
    );
    const res = await db.query<{
      requested_at: string | number;
      old_expires_at: string | number;
      last_sent_at: string | number;
    }>(
      'SELECT requested_at, old_expires_at, last_sent_at FROM email_change_requests WHERE user_id = $1',
      [id],
    );
    expect(BigInt(res.rows[0]!.requested_at)).toBe(BigInt(beyondInt4));
    expect(BigInt(res.rows[0]!.old_expires_at)).toBe(BigInt(epochMs));
    expect(BigInt(res.rows[0]!.last_sent_at)).toBe(BigInt(epochMs));
  });

  it('会话的两个时间戳同理（撤销窗口与"最近使用"都靠它们比大小）', async () => {
    const id = await freshUser();
    const late = 4_102_444_800_000;
    await db.query(
      `INSERT INTO access_sessions (jti_hash, user_id, token_version, created_at, last_seen_at)
       VALUES ($1, $2, $3, $4, $5)`,
      ['c'.repeat(64), id, 0, late, late],
    );
    const res = await db.query<{ created_at: string | number }>(
      'SELECT created_at FROM access_sessions WHERE jti_hash = $1',
      ['c'.repeat(64)],
    );
    expect(BigInt(res.rows[0]!.created_at)).toBe(BigInt(late));
  });
});

describe('默认值那两格：发起那一步不写它们也必须有一个**说得通**的值', () => {
  it('不写 last_sent_at / resend_count ⇒ 读到 0 / 0（冷却与限流的起点，不是 null）', async () => {
    const id = await freshUser();
    await db.query(
      `INSERT INTO email_change_requests (user_id, pending_email, requested_at)
       VALUES ($1, $2, $3)`,
      [id, 'defaults@example.test', 1_700_000_000_000],
    );
    const res = await db.query<{ last_sent_at: string | number; resend_count: number }>(
      'SELECT last_sent_at, resend_count FROM email_change_requests WHERE user_id = $1',
      [id],
    );
    // 写成 null 的话，界面那句"还要等 N 秒"会算出 NaN —— 而它只在用户点第二次时现形。
    expect(Number(res.rows[0]!.last_sent_at)).toBe(0);
    expect(res.rows[0]!.resend_count).toBe(0);
  });

  it('必填那几格确实必填：没有 requested_at 的一行写不出来', async () => {
    const id = await freshUser();
    let rejected = false;
    try {
      await db.query('INSERT INTO email_change_requests (user_id, pending_email) VALUES ($1, $2)', [
        id,
        'no-requested-at@example.test',
      ]);
    } catch {
      rejected = true;
    }
    expect(rejected).toBe(true);
    expect(await count('email_change_requests', id)).toBe(0);
  });
});

describe('外键与 ON DELETE CASCADE —— 这是对外承诺，不是约束美观', () => {
  it('会话行引用不存在的账号 ⇒ 被拒（先证明这条外键**存在**，才谈得上它是不是 CASCADE）', async () => {
    let rejected = false;
    try {
      await insertSession('d'.repeat(64), 999_999);
    } catch {
      rejected = true;
    }
    expect(rejected).toBe(true);
  });

  it('🔴 注销账号 ⇒ 那张待绑请求与每一枚会话都随账号消失', async () => {
    const id = await freshUser();
    const other = await freshUser();
    await insertRequest(id, 'cascade-me@example.test');
    await insertSession('e'.repeat(64), id);
    await insertSession('f'.repeat(64), id, 1);
    await insertRequest(other, 'not-mine@example.test');
    await insertSession('a'.repeat(64), other);

    // 前提：这些行确实写进去了（否则"删完是 0"可以由"根本没写进去"通过）。
    expect(await count('email_change_requests', id)).toBe(1);
    expect(await count('access_sessions', id)).toBe(2);

    await db.query('DELETE FROM users WHERE id = $1', [id]);

    expect(await count('email_change_requests', id)).toBe(0);
    expect(await count('access_sessions', id)).toBe(0);
    // 🔴 反向：别人的不能跟着没（级联的对象是 user_id，不是整张表）。
    expect(await count('email_change_requests', other)).toBe(1);
    expect(await count('access_sessions', other)).toBe(1);
  });
});

describe('撤销 = 删行，所以库面上不该存在"已撤销的会话"这个状态', () => {
  it('`access_sessions` 没有 revoked_at / is_active 一类的软撤销列', async () => {
    const res = await db.query<{ column_name: string }>(
      'SELECT column_name FROM information_schema.columns WHERE table_name = $1',
      ['access_sessions'],
    );
    const soft = res.rows.map((r) => r.column_name).filter((c) => /revoked|active|invalid/i.test(c));
    // 加一列软撤销不是"更谨慎"，是把"撤过的会话"长期留在库里 —— 与 ADR-0063 §2.5 相反。
    expect(soft, `出现了软撤销列：${soft.join(', ')}`).toEqual([]);
    expect(res.rows.map((r) => r.column_name)).toContain('jti_hash');
  });

  it('同一枚 jti 摘要记两次 ⇒ 主键拒绝（重复铸点/重复落行在库层就是幂等的）；对照：不同摘要各留一行', async () => {
    const id = await freshUser();
    const hash = '9'.repeat(64);
    await insertSession(hash, id);
    let rejected = false;
    try {
      await insertSession(hash, id);
    } catch {
      rejected = true;
    }
    expect(rejected).toBe(true);
    await insertSession('8'.repeat(64), id, 1);
    expect(await count('access_sessions', id)).toBe(2);
  });

  it('🔴 令牌摘要那一列存的是 64 位十六进制形状的**摘要**：明文那枚（含点号的 JWT）写得进去就等于库里躺着可照抄的凭据', async () => {
    // 这一条钉的是调用方约定：`jti_hash` 必须来自 SHA-256 hex。库不认识"哈希"，
    // 但它认得**这一列今天实际长什么样** —— 所以这里查的是现存行的形状，而不是查 SQL 里的词频。
    const id = await freshUser();
    await insertSession('7'.repeat(64), id);
    const res = await db.query<{ jti_hash: string }>(
      'SELECT jti_hash FROM access_sessions WHERE user_id = $1',
      [id],
    );
    expect(res.rows[0]!.jti_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(res.rows[0]!.jti_hash).not.toContain('.');
  });
});
