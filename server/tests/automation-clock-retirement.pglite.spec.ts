import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PGlite } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';

import { purgeRetiredAutomationEntitlementClocks, type AutomationClockPurgeDatabase } from '../src/automation/entitlement-ticket';
import { MINIMAL_USERS_DDL } from './pricing-ddl.helper';

/**
 * `automation_entitlement_clocks` 的实例退役清扫（任务书 T2 最后一项）的**数据库层证据**
 * ============================================================================
 *
 * 判据是三条合取，每一条都对应一种"删了会出事"的形状，而这三条全部写在 SQL 里 ——
 * 拿假 client 去断言"函数发出了一条 DELETE"只能证明它调了驱动，证明不了谓词。
 * 所以这里用 PGlite（真 Postgres）跑**生产那条 SQL**：结构从发布中的两枚迁移文件读出来，
 * 不手抄（与 `admin-migration.pglite.spec.ts` 同一口径）。
 *
 * | 保留条件 | 少了它会删掉什么 |
 * |---|---|
 * | 还有绑定行（**含已过期的那条**） | 换回来的安装复用同一条绑定，而它的回滚记忆已经没了 |
 * | 还有票据消费行 | nonce 一次性栅栏还在服役，同一批票仍可能被重放 |
 * | 高水位落在 `REPLAY_RETENTION_MS` 之外 | 保留窗内的时间戳还可能被用来判一次回滚 |
 *
 * ⚠️ 阈值不新造旋钮：第三条约直接复用票据消费那条清扫用的同一枚 `REPLAY_RETENTION_MS`。
 */

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '../prisma/migrations');
const MIGRATIONS = [
  '20261018160000_add_automation_entitlement_tickets',
  '20261018170000_harden_automation_entitlement_ticket_scope',
];

const RETIRE = '11111111-1111-4111-8111-111111111111';
const LIVE_BINDING = '22222222-2222-4222-8222-222222222222';
const IN_FLIGHT = '33333333-3333-4333-8333-333333333333';
const RECENT = '44444444-4444-4444-8444-444444444444';
/** 与实现里那枚常量同源的旧/新读数：一边比保留窗更旧，一边落在窗内。 */
const WINDOW_MS = 5 * 60 * 1000;
const NOW = 1_700_000_000_000;
const OLD_MS = NOW - WINDOW_MS - 60_000;
const FRESH_MS = NOW - 1_000;

describe('automation clock retirement sweep on real Postgres SQL', () => {
  let db: PGlite;
  let client: AutomationClockPurgeDatabase;

  beforeAll(async () => {
    db = new PGlite();
    await db.exec(MINIMAL_USERS_DDL);
    for (const name of MIGRATIONS) {
      // 锚点缺失时在这里就炸，而不是让后面那组断言测一份不存在的结构。
      await db.exec(readFileSync(join(MIGRATIONS_DIR, name, 'migration.sql'), 'utf8'));
    }
    await db.exec(`INSERT INTO users (id, email) VALUES (1, 'a@example.invalid'), (2, 'b@example.invalid');`);
    for (const id of [RETIRE, LIVE_BINDING, IN_FLIGHT, RECENT]) {
      await db.query('INSERT INTO automation_entitlement_clocks (installation_id, max_seen_at_ms, updated_at) VALUES ($1, $2, $3)',
        [id, id === RECENT ? FRESH_MS : OLD_MS, new Date(NOW)]);
    }
    // 已过期的绑定**也算引用**，所以这一行故意把 expires_at 写成过去。
    await db.query(
      'INSERT INTO automation_entitlement_bindings (user_id, official_subject, installation_id, local_account_uuid, issuer, key_id, revocation_version, expires_at, checked_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
      [1, 'acct-1', LIVE_BINDING, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'https://official.example', 'k1', 1, new Date(NOW - 10 * 60_000), new Date(NOW), new Date(NOW)],
    );
    await db.query(
      'INSERT INTO automation_entitlement_ticket_uses (nonce, user_id, expires_at, action, installation_id) VALUES ($1,$2,$3,$4,$5)',
      ['bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 2, new Date(NOW + 30_000), 'rule-enable', IN_FLIGHT],
    );
    client = {
      // 生产的调用形状就是 tagged template，这里原样接住、按同样的顺序换成 $1..$n 交给真 PG。
      $executeRaw: async (query: unknown, ...values: unknown[]): Promise<number> => {
        const parts = Array.from(query as ArrayLike<string>);
        const sql = parts.reduce((acc, part, i) => acc + part + (i < values.length ? `$${i + 1}` : ''), '');
        const result = await db.query<{ affectedRows?: number }>(sql, values as never[]);
        return result.affectedRows ?? 0;
      },
    } as unknown as AutomationClockPurgeDatabase;
  });

  const survivors = async (): Promise<string[]> =>
    (await db.query<{ installation_id: string }>('SELECT installation_id FROM automation_entitlement_clocks ORDER BY installation_id')).rows
      .map((row) => row.installation_id);

  it('前置条件：四行时钟都在，且引用关系确实按四种形状铺开', async () => {
    expect(await survivors()).toEqual([IN_FLIGHT, LIVE_BINDING, RECENT, RETIRE].sort());
    const bindings = await db.query<{ n: number }>('SELECT count(*)::int AS n FROM automation_entitlement_bindings');
    const uses = await db.query<{ n: number }>('SELECT count(*)::int AS n FROM automation_entitlement_ticket_uses');
    expect(bindings.rows[0]?.n).toBe(1);
    expect(uses.rows[0]?.n).toBe(1);
  });

  it('只删掉"退役"那一行，其余三行按各自那条保留原因活着', async () => {
    const deleted = await purgeRetiredAutomationEntitlementClocks(new Date(NOW), client);
    // 🔴 恰好 1 行：把它写成 `>= 0` 或只断言"退役那行不在了"，都会让"一条都没删"读成绿。
    expect(deleted).toBe(1);
    expect(await survivors()).toEqual([IN_FLIGHT, LIVE_BINDING, RECENT].sort());
  });

  it('幂等：再扫一次没有东西可删', async () => {
    expect(await purgeRetiredAutomationEntitlementClocks(new Date(NOW), client)).toBe(0);
  });

  it('高水位低于保留窗，但引用刚出现 ⇒ 不许删（判据按当下引用，不按历史）', async () => {
    const LATE = '55555555-5555-4555-8555-555555555555';
    await db.query('INSERT INTO automation_entitlement_clocks (installation_id, max_seen_at_ms, updated_at) VALUES ($1, $2, $3)', [LATE, OLD_MS, new Date(NOW)]);
    await db.query(
      'INSERT INTO automation_entitlement_ticket_uses (nonce, user_id, expires_at, action, installation_id) VALUES ($1,$2,$3,$4,$5)',
      ['cccccccc-cccc-4ccc-8ccc-cccccccccccc', 1, new Date(NOW + 30_000), 'rule-enable', LATE],
    );
    expect(await purgeRetiredAutomationEntitlementClocks(new Date(NOW), client)).toBe(0);
    expect(await survivors()).toContain(LATE);
  });

  it('反向验证第三条约：把"现在"推到那行绑定/消费都过期之后再扫，退役集合就会扩大（阈值不是永真）', async () => {
    const LATE = '55555555-5555-4555-8555-555555555555';
    // 票据消费行的清扫按 expiresAt 走；这里模拟"很久以后"，此时消费行早该被清走，
    // 于是这台安装既无绑定又无消费行 ⇒ 必须被删。先手动删掉那条引用（清扫链里由上一步做）。
    await db.query('DELETE FROM automation_entitlement_ticket_uses WHERE installation_id = $1', [LATE]);
    expect(await purgeRetiredAutomationEntitlementClocks(new Date(NOW), client)).toBe(1);
    expect(await survivors()).not.toContain(LATE);
  });
});
