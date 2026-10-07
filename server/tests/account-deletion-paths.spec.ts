import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const currentDir = dirname(fileURLToPath(import.meta.url));
const serverRoot = join(currentDir, '..');

/**
 * 账号硬删的**分母**对账（P-12 / ADR-0055）。
 *
 * 要挡的不是某个函数写错了，而是"第五条删账号的路"：墓碑是在
 * `deleteAccountWithTombstone` 里写的，而任何一处绕过它的 `prisma.user.delete()`
 * 都会造出一个"库面上删干净了、恢复时没有任何一层记得该拒绝谁"的账号。
 * 那种删除**不会有任何测试变红** —— 除了这一条。
 *
 * 🔴 判据写成**集合相等**而不是"不包含"：
 * - 多一条 = 有人新增了不写墓碑的删除路径（正题）；
 * - 少一条 = 白名单里那条路径已经不存在了，而这条门禁正在守一个已经没有了的东西
 *   （这正是 §10.226 那条"文件名枚举型门禁"的反面教材要防的形状）。
 */

const RAW_USER_DELETE = /\.user\.delete(?:Many)?\s*\(/g;

const tsFiles = (dir: string): string[] => {
  const out: string[] = [];
  for (const name of readdirSync(join(serverRoot, dir))) {
    const full = join(serverRoot, dir, name);
    if (statSync(full).isDirectory()) {
      out.push(...tsFiles(join(dir, name)));
    } else if (name.endsWith('.ts')) {
      out.push(full);
    }
  }
  return out;
};

/**
 * 允许**不写墓碑**的硬删点，逐条给理由。
 * 新增一条要连理由一起新增，否则本用例红。
 */
const ALLOWED = {
  // 唯一的实现点：墓碑与删除在同一个事务里。
  'src/account/account-tombstones.ts': 1,
  // 只挂在 /api/test 下（server.ts:622），清的是测试自己造的数据，不是用户注销。
  'src/test-routes.ts': 2,
  // 到期清扫：未验证、无数据、也登不进去的注册残骸。
  // ⚠️ 这一条是**已知的不写墓碑路径**：它删掉的账号若出现在旧备份里，恢复闸不会拒绝。
  // 记在这里而不是"顺手也写个墓碑"，是因为那张表的语义是"这个人注销过"，
  // 而清扫残骸不是注销 —— 要改先改语义（ADR-0055 §5）。
  'src/sync/sync.service.ts': 1,
} as Record<string, number>;

const filesWithCounts = (): Record<string, number> => {
  const found: Record<string, number> = {};
  for (const file of [...tsFiles('src'), ...tsFiles('scripts')]) {
    const text = readFileSync(file, 'utf8');
    const n = (text.match(RAW_USER_DELETE) ?? []).length;
    if (n > 0) {
      found[relative(serverRoot, file).split(/[\\/]/).join('/')] = n;
    }
  }
  return found;
};

describe('账号硬删路径的分母：绕过墓碑的那一条会在这里现形', () => {
  it('prisma.user.delete* 的出现点与条数，逐文件等于白名单', () => {
    expect(filesWithCounts()).toEqual(ALLOWED);
  });

  it('两条面向用户的注销路径都必须走同一个函数', () => {
    for (const file of ['src/api.ts', 'scripts/delete-user.ts']) {
      const text = readFileSync(join(serverRoot, file), 'utf8');
      expect(
        text.includes('deleteAccountWithTombstone('),
        `${file} 不再经过 deleteAccountWithTombstone ⇒ 它删掉的账号没有墓碑`,
      ).toBe(true);
    }
  });

  it('恢复闸必须按墓碑删，而不是按邮箱删（明文邮箱这时候已经不在库里了）', () => {
    const text = readFileSync(join(currentDir, '../scripts/restore.sh'), 'utf8');
    const gate = text
      .split('\n')
      .find((l) => l.startsWith('# GATE_DELETE_SQL: '))
      ?.slice('# GATE_DELETE_SQL: '.length);
    expect(gate).toBeDefined();
    expect(gate).toContain('SELECT "user_id" FROM "account_tombstones"');
    expect(gate).not.toContain('email');
  });
});
