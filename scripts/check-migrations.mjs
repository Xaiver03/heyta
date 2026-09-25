#!/usr/bin/env node
/**
 * 迁移文件规范校验器。
 *
 * 为什么需要它：迁移是**不可逆层**，而且失败方式很隐蔽 ——
 * 一个多语句的 CONCURRENTLY 迁移在开发机上可能碰巧过（如果它是首条迁移），
 * 却在生产上把整个部署卡死。这些规则是实测出来的，不是猜的。
 *
 * 依据（全部实测确认，见 docs/adr/0002-migration-tooling.md）：
 *   PostgreSQL 的**简单查询协议**中，多条语句合在一个查询字符串会形成**隐式事务**，
 *   单条不会。Prisma 把整个 migration.sql 当一个查询字符串发送，所以：
 *     单条 CREATE INDEX CONCURRENTLY            → ✅ 能过
 *     多条语句（含任何 CONCURRENTLY）           → ❌ 报 25001
 *
 * 用法：
 *   node scripts/check-migrations.mjs            # 校验，违规则退出码 1
 *   node scripts/check-migrations.mjs --verbose
 */

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MIGRATIONS_DIR = join(ROOT, 'server/prisma/migrations');
const verbose = process.argv.includes('--verbose');

if (!existsSync(MIGRATIONS_DIR)) {
  console.error(`找不到迁移目录：${MIGRATIONS_DIR}`);
  process.exit(1);
}

/** 目录名规范：<14 位时间戳>_<snake_case>，或上游历史遗留的 `0_init`。 */
const NAME_RE = /^(\d{14}_[a-z0-9_]+|0_init)$/;

/**
 * 去掉整行 `--` 注释，只留 SQL 本身。
 *
 * 为什么必须做：迁移文件里经常在注释中**提及** CONCURRENTLY 来解释自己
 * （例如 20260613000001 的注释写着 "Single-statement CREATE INDEX CONCURRENTLY"）。
 * 若不剥注释，这类文件会被误判成"多语句 CONCURRENTLY 迁移"而报假错。
 * 实测中我正因此数错过一次 10 vs 3，所以这里显式处理。
 */
function stripComments(sql) {
  return sql
    .split('\n')
    .filter((l) => !l.trim().startsWith('--'))
    .join('\n');
}

/**
 * 按 migrate-deploy.sh 的解析假设切分语句。
 * 脚本注释明确写了它的前提，这里校验这些前提：
 *   - 语句必须以 `;` 结尾且 `;` 在该行行尾
 *   - 注释必须是整行 `--`
 *   - `;` 不能出现在字符串字面量里
 */
function splitStatements(sql) {
  const lines = sql.split('\n');
  const out = [];
  let buf = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (line === '' || line.startsWith('--')) continue;
    buf.push(line);
    if (line.endsWith(';')) {
      out.push(buf.join('\n'));
      buf = [];
    }
  }
  if (buf.length) out.push(buf.join('\n'));
  return out;
}

const problems = [];
const warnings = [];
const names = readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => e.name)
  .sort();

let checkedFiles = 0;
let concurrentlyCount = 0;

for (const name of names) {
  if (!NAME_RE.test(name)) {
    problems.push({
      file: `server/prisma/migrations/${name}`,
      msg: `目录名不符合规范（应为 <14位时间戳>_<snake_case>）`,
    });
  }

  const sqlPath = join(MIGRATIONS_DIR, name, 'migration.sql');
  if (!existsSync(sqlPath)) {
    problems.push({
      file: `server/prisma/migrations/${name}`,
      msg: `缺少 migration.sql`,
    });
    continue;
  }

  const sql = readFileSync(sqlPath, 'utf8');
  checkedFiles++;

  // 内容检测一律基于剥离注释后的 SQL（见 stripComments 的说明）
  const sqlSql = stripComments(sql);

  // ── 校验解析前提 ────────────────────────────────────
  sql.split('\n').forEach((raw, i) => {
    const line = raw.trim();
    // 非整行注释里混了 `--`：脚本会把它当语句的一部分，可能切错
    if (line && !line.startsWith('--') && line.includes('--')) {
      warnings.push({
        file: `server/prisma/migrations/${name}/migration.sql:${i + 1}`,
        msg: `行内注释 \`--\`：迁移脚本按"整行 -- 才是注释"解析，行内注释可能被当作语句内容`,
      });
    }
  });

  // ── 规则：lock-bounded ALTER INDEX 形状 ──────────────
  // 依据 server/prisma/migrations/README.md「Rules for a lock-bounded ALTER INDEX migration」。
  // 这类迁移需要 ACCESS EXCLUSIVE 锁，必须自己限定等锁时间；等锁的请求会把
  // 该表上**所有新查询**排在后面（实测一个简单读从 79ms 涨到 8005ms）。
  // 安全性依赖 4 个性质，其中 3 个可以静态检查。
  const hasAlterIndex = /ALTER\s+INDEX\s+\S+\s+SET\s*\(/i.test(sqlSql);
  const lockTimeoutMatch = sqlSql.match(
    /SET\s+LOCAL\s+lock_timeout\s*=\s*'([^']+)'/i,
  );

  if (hasAlterIndex) {
    const stmts = splitStatements(sql);

    if (!lockTimeoutMatch) {
      problems.push({
        file: `server/prisma/migrations/${name}/migration.sql`,
        msg:
          `对索引做 ALTER INDEX ... SET(...) 但没有 SET LOCAL lock_timeout。\n` +
          `         获取 ACCESS EXCLUSIVE 锁却不设上限，会把该表上的所有新查询排在后面 —— 这就是事故形状。`,
      });
    } else {
      // 属性 1：时限必须是 1ms~5000ms 或 1s~5s；'0' 在 PostgreSQL 里表示**无限等**
      const v = lockTimeoutMatch[1].trim();
      const ok =
        /^([1-9]\d{0,3})ms$/.test(v) && Number.parseInt(v, 10) <= 5000
          ? true
          : /^([1-5])s$/.test(v);
      if (!ok) {
        problems.push({
          file: `server/prisma/migrations/${name}/migration.sql`,
          msg:
            `lock_timeout='${v}' 超出允许范围（1ms–5000ms 或 1s–5s）。\n` +
            `         注意 '0' 在 PostgreSQL 里表示**不超时**，即永远等待 —— 正是要避免的形状。`,
        });
      }
    }

    // 属性 2：恰好两条语句（SET LOCAL + ALTER），才能让锁超时整体回滚
    if (stmts.length !== 2) {
      problems.push({
        file: `server/prisma/migrations/${name}/migration.sql`,
        msg:
          `lock-bounded ALTER INDEX 迁移必须**恰好两条语句**（SET LOCAL lock_timeout + 一条 ALTER INDEX），当前 ${stmts.length} 条。\n` +
          `         两条语句才会被隐式事务包住，锁超时才能整体回滚、重试安全。`,
      });
    }

    // 属性 4：不得含 CONCURRENTLY
    if (/CONCURRENTLY/i.test(sql)) {
      problems.push({
        file: `server/prisma/migrations/${name}/migration.sql`,
        msg:
          `lock-bounded ALTER INDEX 迁移里不得出现 CONCURRENTLY。\n` +
          `         单语句迁移不获得隐式事务，锁超时会在建索引中途留下 INVALID 索引，重试清不掉。`,
      });
    }
  }

  const hasConcurrently = /CONCURRENTLY/i.test(sqlSql);
  if (!hasConcurrently) continue;
  concurrentlyCount++;

  const stmts = splitStatements(sql);
  const hasDrop = /DROP\s+INDEX\s+CONCURRENTLY/i.test(sqlSql);
  const hasCreate = /CREATE\s+INDEX\s+CONCURRENTLY/i.test(sqlSql);

  // ── 规则 1：单语句天然安全 ──────────────────────────
  if (stmts.length === 1) {
    if (verbose) {
      console.log(`  ok   ${name}  （单条 CONCURRENTLY 语句，Prisma 可直接执行）`);
    }
    continue;
  }

  // ── 规则 2：多语句 → 必须走可恢复形状 ──────────────
  const recoverableShape = hasDrop && hasCreate;

  if (!recoverableShape) {
    let reason;
    if (hasDrop && !hasCreate) {
      reason = '只有 DROP INDEX CONCURRENTLY，没有配套 CREATE，不满足可恢复形状';
    } else if (!hasDrop && hasCreate) {
      reason = '只有裸 CREATE INDEX CONCURRENTLY，没有配套 DROP —— 这是**故意不可恢复**的形状';
    } else {
      reason = '既不满足单语句，也不满足可恢复形状';
    }
    problems.push({
      file: `server/prisma/migrations/${name}/migration.sql`,
      msg:
        `${stmts.length} 条语句且含 CONCURRENTLY —— ${reason}。\n` +
        `         Prisma 会把它们作为一个查询字符串发送，形成隐式事务，报 SQLSTATE 25001。\n` +
        `         修法：拆成 `+
        `一个文件一条语句；或改成可恢复形状（DROP INDEX CONCURRENTLY IF EXISTS + CREATE INDEX CONCURRENTLY）。`,
    });
    continue;
  }

  // 可恢复形状：检查 DROP 是否用了 IF EXISTS（脚本注释要求它是幂等的）
  const dropLines = sql
    .split('\n')
    .filter((l) => /DROP\s+INDEX\s+CONCURRENTLY/i.test(l));
  for (const l of dropLines) {
    if (!/IF\s+EXISTS/i.test(l)) {
      warnings.push({
        file: `server/prisma/migrations/${name}/migration.sql`,
        msg: `可恢复迁移里的 DROP INDEX CONCURRENTLY 未加 IF EXISTS，重跑不幂等`,
      });
    }
  }

  if (verbose) {
    console.log(
      `  ok   ${name}  （${stmts.length} 条语句，可恢复形状，由 migrate-deploy.sh 事务外恢复）`,
    );
  }
}

// ── 汇总 ────────────────────────────────────────────────
console.log(
  `\n校验 ${checkedFiles} 个迁移文件，其中 ${concurrentlyCount} 个含 CONCURRENTLY。`,
);

if (warnings.length) {
  console.log(`\n⚠️  ${warnings.length} 个警告：\n`);
  for (const w of warnings) {
    console.log(`   ${relative(ROOT, w.file)}`);
    console.log(`      ${w.msg}`);
  }
}

if (problems.length) {
  console.log(`\n🔴 ${problems.length} 个违规：\n`);
  for (const p of problems) {
    console.log(`   ${p.file}`);
    console.log(`      ${p.msg}`);
  }
  console.log('');
  process.exit(1);
}

console.log('\n✅ 迁移文件全部符合规范。\n');
