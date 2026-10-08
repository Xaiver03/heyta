import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { MINIMAL_USERS_DDL } from './pricing-ddl.helper';

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), '../prisma/migrations');

/**
 * 共享清单那次迁移的目录名。
 *
 * ⚠️ 与 `activity-ddl.helper.ts` 同一条纪律：这是**唯一**允许写死这个字符串
 * 的地方。任何测试都不许把四张表的结构手抄一遍 —— 抄本的测试只能证明抄本
 * 是对的，迁移漂移时它会安静地继续通过。
 */
export const SHARE_MIGRATION_DIR = '20261018120000_add_share_collaboration_tables';

/** 四张表缺任何一张都说明锚点失效，而不是"这次测试不需要它"。 */
const REQUIRED_TABLES = ['shares', 'share_members', 'share_invitations', 'share_operations'] as const;

/**
 * 从**发布中的迁移文件**里读出四张表的建表 SQL。
 * 锚点检查：少一张就 `throw`，让测试在 setup 阶段就炸。
 */
export const shareDdlFromMigration = (): string => {
  const sql = readFileSync(join(migrationsDir, SHARE_MIGRATION_DIR, 'migration.sql'), 'utf8');
  const missing = REQUIRED_TABLES.filter((t) => !sql.includes(`CREATE TABLE "${t}"`));
  if (missing.length > 0) {
    throw new Error(
      `${SHARE_MIGRATION_DIR}/migration.sql 里找不到这些表的建表语句：${missing.join(', ')}。\n` +
        '   🔴 这通常意味着迁移被改名/重构了 —— 请更新本 helper 的锚点，而不是把检查删掉。',
    );
  }
  return sql;
};

/**
 * 干净 PGlite 实例里的四张表 + 全部约束。
 * `MINIMAL_USERS_DDL` 是替身不是抄本（外键唯一需要的是 users 主键）。
 */
export const SHARE_SCHEMA_DDL = `${MINIMAL_USERS_DDL}\n${shareDdlFromMigration()}`;
