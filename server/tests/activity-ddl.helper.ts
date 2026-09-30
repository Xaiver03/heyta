import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { MINIMAL_USERS_DDL } from './pricing-ddl.helper';

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), '../prisma/migrations');

/**
 * 通知/邀请那一次迁移的目录名。
 *
 * ⚠️ 与 `pricing-ddl.helper.ts` 同一条纪律：这是**唯一**允许写死这个字符串的地方。
 * 任何测试都不许把这三张表的结构手抄一遍 —— 抄一份的测试只能证明抄本是对的，
 * 而迁移漂移时它会安静地继续通过。
 */
export const ACTIVITY_MIGRATION_DIR = '20261002000000_add_invites_and_notifications';

/** 三张表缺任何一张都说明锚点失效，而不是"这次测试不需要它"。 */
const REQUIRED_TABLES = ['invite_codes', 'referrals', 'account_notifications'] as const;

/**
 * 从**发布中的迁移文件**里读出这三张表的建表 SQL。
 *
 * 锚点检查：三张表少一张就 `throw`，让测试在 setup 阶段就炸，
 * 而不是变成一组测着不存在结构的绿灯。
 */
export const activityDdlFromMigration = (): string => {
  const sql = readFileSync(
    join(migrationsDir, ACTIVITY_MIGRATION_DIR, 'migration.sql'),
    'utf8',
  );
  const missing = REQUIRED_TABLES.filter((t) => !sql.includes(`CREATE TABLE "${t}"`));
  if (missing.length > 0) {
    throw new Error(
      `${ACTIVITY_MIGRATION_DIR}/migration.sql 里找不到这些表的建表语句：${missing.join(', ')}。\n` +
        '   🔴 这通常意味着迁移被改名/重构了 —— 请更新本 helper 的锚点，' +
        '而不是把检查删掉：这几条 CHECK 是"邀请奖励不被刷"的最后一道防线。',
    );
  }
  return sql;
};

/**
 * 在一个干净的 pglite 实例里建好这三张表与全部约束。
 *
 * ⚠️ `MINIMAL_USERS_DDL` 是**替身**而不是抄本：真实 `users` 表有三十多列、
 * 与本主题无关，而这里只需要主键（外键唯一需要的东西）—— 所以它不可能漂移。
 */
export const ACTIVITY_SCHEMA_DDL = `${MINIMAL_USERS_DDL}\n${activityDdlFromMigration()}`;
