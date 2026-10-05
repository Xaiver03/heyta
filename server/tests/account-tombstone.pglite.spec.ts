import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PGlite } from '@electric-sql/pglite';
import { afterEach, describe, expect, it } from 'vitest';

import { hashAccountEmail } from '../src/account/account-tombstones';
import { MINIMAL_USERS_DDL } from './pricing-ddl.helper';

const currentDir = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(currentDir, '../prisma/migrations');
const TOMBSTONE_MIGRATION_DIR = '20261015000000_add_account_tombstones';

/**
 * 账号墓碑（P-12 / ADR-0055）的**数据库层**证据。
 *
 * 这一层要证的不是"函数写得对不对"，而是三件**只有库能回答**的事：
 * ① 删掉账号之后墓碑还在（这条是整个设计的承重墙 —— 表一旦带上指向 users 的
 *    级联外键，注销就会把自己的判据删掉，而**没有任何应用层测试会红**）；
 * ② `email_hash` 那条 CHECK 真的拦得住明文邮箱（对外口径是"不存明文邮箱"）；
 * ③ `restore.sh` 里那两条恢复闸语句在真库上真的会**拒绝**一个复活账号。
 *
 * 表结构从**发布中的迁移文件**读，不抄（与 activity/pricing 那两个 helper 同纪律）：
 * 抄一份的测试只能证明抄本是对的，迁移漂移时它会安静地继续通过。
 *
 * 🔴 每条用例**自己开一个库**：上一版共用一个实例，于是"断言返回空"那条被
 * 前一条用例留下的墓碑污染成 `[2, 5]` —— 闸是对的、判据是错的。
 * 精确集合断言只有在没有别人写过的库上才有意义。
 */

const migrationSql = readFileSync(
  join(migrationsDir, TOMBSTONE_MIGRATION_DIR, 'migration.sql'),
  'utf8',
);
if (!migrationSql.includes('CREATE TABLE "account_tombstones"')) {
  throw new Error(
    `${TOMBSTONE_MIGRATION_DIR}/migration.sql 里找不到 account_tombstones 的建表语句 —— ` +
      '迁移被改名/重构时请更新本文件的锚点，而不是删掉检查。',
  );
}

/** 闸语句只有一份作者：`scripts/restore.sh`。这里现读它，不重打一遍。 */
const gateSqlFromScript = (marker: string): string => {
  const text = readFileSync(join(currentDir, '../scripts/restore.sh'), 'utf8');
  const line = text.split('\n').find((l) => l.startsWith(`# ${marker}: `));
  if (line === undefined) {
    throw new Error(
      `scripts/restore.sh 里找不到 "# ${marker}: " 那一行。\n` +
        '   🔴 这通常意味着闸语句被改写或搬走了 —— 请同步这里的标记，而不是把本用例删掉：' +
        '本用例是"脚本里那条 SQL 在真库上确实会拒绝复活账号"的唯一证据。',
    );
  }
  return line.slice(`# ${marker}: `.length).trim();
};

const GATE_DELETE_SQL = gateSqlFromScript('GATE_DELETE_SQL');
const GATE_ASSERT_SQL = gateSqlFromScript('GATE_ASSERT_SQL');

/**
 * 用的是**产品代码里那一个** `hashAccountEmail`，不是测试自己另算一份：
 * 这样这一组用例同时也在对账"代码算出的形状 = 迁移 CHECK 接受的形状"。
 */
const sha256HexOf = (email: string): string => hashAccountEmail(email);

interface Fixture {
  readonly db: PGlite;
  readonly newUser: (email: string) => Promise<number>;
  readonly tombstone: (userId: number, email: string) => Promise<void>;
  readonly ids: (sql?: string) => Promise<number[]>;
}

let open: PGlite | undefined;

/** 每条用例一个干净的库。 */
const freshDb = async (): Promise<Fixture> => {
  const db = new PGlite();
  open = db;
  await db.exec(`${MINIMAL_USERS_DDL}\n${migrationSql}`);
  return {
    db,
    async newUser(email) {
      const res = await db.query<{ id: number }>(
        'INSERT INTO users (email) VALUES ($1) RETURNING id',
        [email],
      );
      return res.rows[0]!.id;
    },
    async tombstone(userId, email) {
      await db.query(
        'INSERT INTO account_tombstones (user_id, email_hash, closed_at) VALUES ($1, $2, $3)',
        [userId, sha256HexOf(email), new Date('2026-10-05T00:00:00Z')],
      );
    },
    async ids(sql = GATE_ASSERT_SQL) {
      const res = await db.query<{ user_id: number }>(sql);
      return res.rows.map((r) => r.user_id);
    },
  };
};

afterEach(async () => {
  await open?.close();
  open = undefined;
});

describe('account_tombstones：墓碑必须活过它记录的那次删除', () => {
  it('删掉账号之后墓碑还在（这一条挡的是"迁移顺手加个级联外键"）', async () => {
    const f = await freshDb();
    const userId = await f.newUser('close-me-1@example.test');
    await f.tombstone(userId, 'close-me-1@example.test');

    await f.db.query('DELETE FROM users WHERE id = $1', [userId]);

    const survivors = await f.db.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM account_tombstones WHERE user_id = $1',
      [userId],
    );
    expect(survivors.rows[0]!.n, '账号删掉后墓碑也没了 ⇒ 恢复闸从此无判据可读').toBe(1);

    // 阳性对照：那一行确实被删了（否则"墓碑还在"可能只是在测一个没删成功的库）。
    const goneUser = await f.db.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM users WHERE id = $1',
      [userId],
    );
    expect(goneUser.rows[0]!.n).toBe(0);
  });

  it('email_hash 只收 SHA-256 小写 hex：明文邮箱与大写 hex 都进不去，而合法值进得去', async () => {
    const f = await freshDb();
    const a = await f.newUser('hash-a@example.test');
    const b = await f.newUser('hash-b@example.test');
    const c = await f.newUser('hash-c@example.test');

    // 对照：合法的 64 位小写 hex 必须能写进去。
    await f.tombstone(a, 'hash-a@example.test');

    await expect(
      f.db.query(
        'INSERT INTO account_tombstones (user_id, email_hash, closed_at) VALUES ($1, $2, $3)',
        [b, 'hash-b@example.test', new Date()],
      ),
    ).rejects.toThrow(/account_tombstones_email_hash_hex|violates check constraint/i);

    await expect(
      f.db.query(
        'INSERT INTO account_tombstones (user_id, email_hash, closed_at) VALUES ($1, $2, $3)',
        [c, sha256HexOf('hash-c@example.test').toUpperCase(), new Date()],
      ),
    ).rejects.toThrow(/account_tombstones_email_hash_hex|violates check constraint/i);
  });
});

describe('恢复闸：脚本里那两条 SQL 在真库上会拒绝一个复活的账号', () => {
  it('先证"复活时断言会红"，再证跑完闸之后它不红、而墓碑自己没被删', async () => {
    const f = await freshDb();
    const closedId = await f.newUser('restored-1@example.test');
    await f.tombstone(closedId, 'restored-1@example.test');

    // 注销：账号行从活库里消失（墓碑留着 —— 上一节刚证过它不会跟着走）。
    await f.db.query('DELETE FROM users WHERE id = $1', [closedId]);
    // "恢复"把这一行带回来了（这就是旧备份导回库的形状）。
    await f.db.query('INSERT INTO users (id, email) VALUES ($1, $2)', [
      closedId,
      'restored-1@example.test',
    ]);

    // 🔴 阳性对照：没有这一腿，"断言返回空"可能只是在测一条永远为空的查询。
    expect(
      await f.ids(),
      '账号带着墓碑复活了，断言却没抓到 ⇒ 这条闸是装饰',
    ).toEqual([closedId]);

    const removed = await f.db.query<{ id: number }>(GATE_DELETE_SQL);
    expect(removed.rows.map((r) => r.id)).toEqual([closedId]);

    expect(await f.ids()).toEqual([]);

    // 闸不会把自己的判据删掉（这是"没有级联覆盖本表"那条设计的运行时兑现）。
    const tombstoneStill = await f.db.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM account_tombstones WHERE user_id = $1',
      [closedId],
    );
    expect(tombstoneStill.rows[0]!.n).toBe(1);
  });

  it('没有墓碑的库：断言返回空，而活账号一条都不许被闸删掉', async () => {
    const f = await freshDb();
    const aliveId = await f.newUser('never-closed@example.test');

    expect(await f.ids()).toEqual([]);

    const removed = await f.db.query<{ id: number }>(GATE_DELETE_SQL);
    expect(removed.rows).toEqual([]);

    const users = await f.db.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM users WHERE id = $1',
      [aliveId],
    );
    expect(users.rows[0]!.n, '空墓碑表不许删掉任何活账号').toBe(1);
  });

  it('复活的不止一个时，断言要把它们**全部**列出来（不是只报第一个）', async () => {
    const f = await freshDb();
    const ids: number[] = [];
    for (const email of ['r-1@example.test', 'r-2@example.test', 'r-3@example.test']) {
      const id = await f.newUser(email);
      await f.tombstone(id, email);
      await f.db.query('DELETE FROM users WHERE id = $1', [id]);
      // 旧备份把它们全带回来。
      await f.db.query('INSERT INTO users (id, email) VALUES ($1, $2)', [id, email]);
      ids.push(id);
    }

    expect((await f.ids()).sort((a, b) => a - b)).toEqual(ids);

    const removed = await f.db.query<{ id: number }>(GATE_DELETE_SQL);
    expect(removed.rows.map((r) => r.id).sort((a, b) => a - b)).toEqual(ids);
    expect(await f.ids()).toEqual([]);
  });
});
