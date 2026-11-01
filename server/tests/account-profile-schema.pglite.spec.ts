import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { MINIMAL_USERS_DDL } from './pricing-ddl.helper';

/**
 * `user_avatars` 的两条迁移的**数据库层证据**
 * ==========================================
 *
 * 1. `20261008000000_add_account_profile`（R10）：加 `display_name` 与 `user_avatars`；
 * 2. `20261101000000_avatar_is_plain_profile_data`（ADR-0079，2026-11-01）：
 *    头像从"密文 blob"改成"基础资料明文"—— `cipher` 改名 `data`、新增 `content_type`，
 *    并清掉无法换算的旧密文行。
 *
 * ## 为什么这条必须单独测（而不是"读了 SQL 觉得对"）
 *
 * | 性质 | 写错成 | 症状 |
 * |---|---|---|
 * | `display_name` 必须**可空** | `NOT NULL`（或 `DEFAULT ''`） | 存量行 ALTER 当场失败，或存量用户凭空多出一个"空昵称" |
 * | 外键必须 **ON DELETE CASCADE** | 漏掉，或 `SET NULL` | 「注销账号即真删除」那句政策变成假话 —— 用户行删了，头像留在库里 |
 * | `user_id` 必须是**主键** | 只建普通索引 | 一个用户多行头像；`upsert` 退化成越插越多 |
 * | `cipher` → `data` 的改名 | 只加新列、旧列留着 | 两列并存，读写各挑一列 —— 症状是"换个设备头像就没了" |
 * | 旧密文行必须在迁移里清掉 | 留着并给 `content_type` 填默认值 | 客户端把一段密文当 JPEG 渲染成坏图，而不是"没有头像" |
 *
 * ## 纪律
 *
 * SQL 从**发布中的迁移文件**读出来，不手抄。锚点缺失时在 setup 阶段就炸，
 * 而不是变成一组测着不存在结构的绿灯。
 */

const LEGACY_DIR = '20261008000000_add_account_profile';
const PLAINTEXT_DIR = '20261101000000_avatar_is_plain_profile_data';
const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), '../prisma/migrations');

const migrationSqlFromFile = (dir: string, needles: string[]): string => {
  const sql = readFileSync(join(migrationsDir, dir, 'migration.sql'), 'utf8');
  const missing = needles.filter((needle) => !sql.includes(needle));
  if (missing.length > 0) {
    throw new Error(
      `${dir}/migration.sql 里缺：${missing.join(', ')}。\n` +
        '   🔴 迁移被改名/重构时请更新本文件的锚点，而不是把断言删掉。',
    );
  }
  return sql;
};

const LEGACY_SQL = migrationSqlFromFile(LEGACY_DIR, [
  'ADD COLUMN',
  '"display_name"',
  'CREATE TABLE',
  '"user_avatars"',
  'FOREIGN KEY',
  '"user_id"',
]);
const PLAINTEXT_SQL = migrationSqlFromFile(PLAINTEXT_DIR, [
  'DELETE FROM "user_avatars"',
  'RENAME COLUMN "cipher" TO "data"',
  'ADD COLUMN "content_type"',
]);

let db: PGlite;

beforeAll(async () => {
  db = new PGlite();
  // 先建"迁移前"的 users 表，**并插入两行存量用户**。
  await db.exec(MINIMAL_USERS_DDL);
  await db.query('INSERT INTO users (email) VALUES ($1)', ['existing-a@example.test']);
  await db.query('INSERT INTO users (email) VALUES ($1)', ['existing-b@example.test']);
  await db.exec(LEGACY_SQL);

  // 在两条迁移之间插一行**旧密文头像**：新迁移必须把它清掉（服务端从来没有钥匙，
  // 这段密文换算不成图片；留着只会被当成坏图渲染）。
  const legacyUser = await db.query<{ id: string }>(
    'SELECT id FROM users WHERE email = $1',
    ['existing-a@example.test'],
  );
  await db.query(
    'INSERT INTO user_avatars (user_id, cipher, hash, updated_at) VALUES ($1, $2, $3, $4)',
    [Number(legacyUser.rows[0]?.id), Buffer.from([1, 2, 3]), 'legacy-hash', BigInt(1) as unknown as string],
  );

  await db.exec(PLAINTEXT_SQL);
});

afterAll(async () => {
  await db.close();
});

describe('存量数据（迁移之后不许被顺手写上一个值）', () => {
  it('两行存量用户的 display_name 都是 **NULL**，不是空串', async () => {
    const rows = await db.query<{ email: string; display_name: string | null }>(
      'SELECT email, display_name FROM users ORDER BY id',
    );
    expect(rows.rows).toHaveLength(2);
    for (const row of rows.rows) {
      // 🔴 `null` 与 `''` 是两件事：界面靠"是不是 null"决定要不要回落到
      // 邮箱派生名。给存量行填 `''` 的症状不是报错，是**每个人的昵称框凭空多一个空值**。
      expect(row.display_name, `${row.email} 的昵称不是 NULL ⇒ 存量行被写上了值`).toBeNull();
    }
  });

  it('新账号可以不填昵称就插入（这一列真的可选）', async () => {
    await expect(
      db.query('INSERT INTO users (email) VALUES ($1)', ['no-nickname@example.test']),
    ).resolves.toBeTruthy();
  });

  it('昵称能写、能清空（回到 NULL），且没有唯一约束', async () => {
    await db.query('UPDATE users SET display_name = $1 WHERE email = $2', [
      '小鹿',
      'existing-a@example.test',
    ]);
    const one = await db.query<{ display_name: string | null }>(
      'SELECT display_name FROM users WHERE email = $1',
      ['existing-a@example.test'],
    );
    expect(one.rows[0]?.display_name).toBe('小鹿');

    await db.query('UPDATE users SET display_name = $1 WHERE email = $2', [
      '小鹿',
      'existing-b@example.test',
    ]);
    const dupes = await db.query<{ c: string }>(
      'SELECT display_name AS c FROM users WHERE display_name = $1',
      ['小鹿'],
    );
    expect(dupes.rows).toHaveLength(2);

    await db.query('UPDATE users SET display_name = NULL WHERE email = $1', [
      'existing-a@example.test',
    ]);
    const cleared = await db.query<{ display_name: string | null }>(
      'SELECT display_name FROM users WHERE email = $1',
      ['existing-a@example.test'],
    );
    expect(cleared.rows[0]?.display_name).toBeNull();
  });
});

describe('🔴 头像迁移：cipher → data，旧密文行被清掉', () => {
  it('旧密文行**一行都不留**（服务端没有钥匙，换算不了）', async () => {
    const rows = await db.query<{ c: string }>('SELECT count(*) AS c FROM user_avatars');
    expect(Number(rows.rows[0]?.c)).toBe(0);
  });

  it('列形状就是明文那一套：`data` + `content_type`，`cipher` 已经不在', async () => {
    const columns = await db.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'user_avatars'`,
    );
    const names = columns.rows.map((row) => row.column_name).sort();
    expect(names).toEqual(['content_type', 'data', 'hash', 'updated_at', 'user_id']);
    expect(names).not.toContain('cipher');
  });
});

describe('user_avatars：一人一行、二进制原样往返', () => {
  const userId = async (email: string): Promise<number> => {
    const r = await db.query<{ id: string }>('SELECT id FROM users WHERE email = $1', [email]);
    return Number(r.rows[0]?.id);
  };

  it('data 是 bytea：含 0x00 的字节序列存进去能**逐字节**取回来，content_type 同行走', async () => {
    const id = await userId('existing-a@example.test');
    const bytes = new Uint8Array([0, 1, 2, 255, 254, 0, 65, 66, 0]);
    await db.query(
      'INSERT INTO user_avatars (user_id, data, content_type, hash, updated_at) VALUES ($1, $2, $3, $4, $5)',
      [id, Buffer.from(bytes), 'image/png', 'hash-a', BigInt(1) as unknown as string],
    );
    const back = await db.query<{ data: Uint8Array; content_type: string }>(
      'SELECT data, content_type FROM user_avatars WHERE user_id = $1',
      [id],
    );
    expect(Array.from(back.rows[0]?.data ?? [])).toEqual(Array.from(bytes));
    expect(back.rows[0]?.content_type).toBe('image/png');
  });

  it('content_type 是 NOT NULL：明文之后服务端就是格式的权威', async () => {
    const id = await userId('existing-b@example.test');
    await expect(
      db.query(
        'INSERT INTO user_avatars (user_id, data, hash, updated_at) VALUES ($1, $2, $3, $4)',
        [id, Buffer.from([1]), 'hash-x', BigInt(1) as unknown as string],
      ),
    ).rejects.toThrow();
  });

  it('user_id 是主键 ⇒ 同一个人插第二行会被拒', async () => {
    const id = await userId('existing-b@example.test');
    const insert = (hash: string): Promise<unknown> =>
      db.query(
        'INSERT INTO user_avatars (user_id, data, content_type, hash, updated_at) VALUES ($1, $2, $3, $4, $5)',
        [id, Buffer.from([1, 2, 3]), 'image/png', hash, BigInt(1) as unknown as string],
      );
    await insert('hash-first');
    // 🔴 这条不是洁癖：`upsert({where:{userId}})` 的前提就是"一人一行"。
    await expect(insert('hash-second')).rejects.toThrow();
    const count = await db.query<{ c: string }>(
      'SELECT count(*) AS c FROM user_avatars WHERE user_id = $1',
      [id],
    );
    expect(Number(count.rows[0]?.c)).toBe(1);
  });

  it('不是孤儿：给不存在的人插头像会被外键挡住', async () => {
    await expect(
      db.query(
        'INSERT INTO user_avatars (user_id, data, content_type, hash, updated_at) VALUES ($1, $2, $3, $4, $5)',
        [999_999, Buffer.from([9]), 'image/png', 'ghost', BigInt(1) as unknown as string],
      ),
    ).rejects.toThrow();
  });
});

describe('🔴 注销账号即真删除：头像必须跟着走', () => {
  it('删掉 users 那行，user_avatars 里那一行**同一次**就没了', async () => {
    const id = Number(
      (
        await db.query<{ id: string }>('SELECT id FROM users WHERE email = $1', [
          'existing-b@example.test',
        ])
      ).rows[0]?.id,
    );
    const before = await db.query<{ c: string }>(
      'SELECT count(*) AS c FROM user_avatars WHERE user_id = $1',
      [id],
    );
    expect(Number(before.rows[0]?.c)).toBeGreaterThan(0);

    await db.query('DELETE FROM users WHERE id = $1', [id]);

    const after = await db.query<{ c: string }>(
      'SELECT count(*) AS c FROM user_avatars WHERE user_id = $1',
      [id],
    );
    // 这一条兜的是**对外承诺**：`privacy.ts` 那句"注销是真删除：账号行连同名下的
    // ……昵称与头像按数据库外键级联删除"。
    // 🔴 这里**故意不写级联的条数**：那个数字由 `structure.spec.ts` 从迁移现量。
    expect(Number(after.rows[0]?.c)).toBe(0);
  });
});
