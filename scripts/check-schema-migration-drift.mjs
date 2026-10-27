#!/usr/bin/env node
/**
 * schema 与迁移的对账尺（静态，不连数据库）。
 *
 * 为什么需要它：`server/prisma/schema.prisma` 与 `server/prisma/migrations/**` 是**同一份现实的两种写法**。
 * Prisma Client 按 schema 生成 SQL，而任何按迁移建出来的库（生产、自托管装机）按迁移建表 ——
 * 两边写得不一样时，症状不在构建里，在**运行期第一条查询**上。
 *
 * 2026-10-27 实测到的那一枚：`EmailLoginChallenge.userId` 漏了 `@map("user_id")`，
 * 而迁移建的列就叫 `user_id`（线上库现量同样是 `user_id`）⇒ Prisma 对着真库发 SELECT "userId"
 * ⇒ P2022，邮箱验证码登录整条路径在任何按迁移建出来的库上是死的；
 * `pnpm build`、`pnpm typecheck`、全部单测都读不到这件事（它们不连按迁移建出来的库）。
 * 同一次排查里 `automation_events_status_lease_idx` 也没登记在 schema 上，
 * `prisma migrate diff` 因此对线上提 `DROP INDEX`。
 *
 * 三条判据（红 = 真会出事，不是风格）：
 *  A 迁移里 CREATE INDEX 建出的名字，schema 必须认得 —— 显式 `map:` 或按 Prisma 的推导名规则算得出来。
 *    认不得 ⇒ migrate diff 提 DROP，下一次 `migrate dev` 真会把它删掉。
 *    Prisma 表达不了的形状（带 WHERE 的部分索引、非默认 USING、列位是函数/操作符类）按形状豁免，
 *    但**豁免的枚数要打出来** —— 静默的豁免等于没有豁免。
 *  B 迁移建出的每一枚列名，最终必须能被该表的 model 认得（`@map` 或字段名本身）。
 *    这一条抓的就是 P2022 那一族。
 *  C 反方向：schema 声明了、迁移从没建 ⇒ 库里没有它。已知的两格进 KNOWN_GAPS（带归属与登记日），
 *    新出现的没登记就红；登记了却已经不存在也要红（不许留一只不会红的哨兵）。
 *
 * 用法：
 *   node scripts/check-schema-migration-drift.mjs
 *   node scripts/check-schema-migration-drift.mjs --self-test
 */
import { readFileSync, readdirSync, existsSync, mkdirSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SELF_TEST = process.argv.includes('--self-test');

/**
 * C 方向的在册缺口：schema 认得、迁移没建 ⇒ 按迁移建出来的库（含生产）没有这个对象。
 * 每一枚都要有归属与登记日；补上迁移之后必须把这一行删掉，否则尺红在"登记了但已存在"上。
 */
const KNOWN_GAPS = [
  {
    name: 'automation_sender_credentials_user_id_rule_id_key_id_idx',
    owner: '自动收集线（收件密钥那一族）',
    registered: '2026-10-27',
    reason: 'schema 有 @@index([userId, ruleId, keyId])，而按迁移重放的库里只有同列集合的**部分唯一**索引 automation_sender_credentials_active_key（WHERE revoked_at IS NULL）与一枚 (user_id, rule_id, revoked_at) 普通索引 ⇒ 查"已撤销的凭据"（审计那条路）没有可用索引。',
  },
  {
    name: 'automation_commit_permits_op_id_key',
    owner: '自动收集线（自托管按操作一次性票据）',
    registered: '2026-10-27',
    reason: 'schema 里 opId 还挂着单列 @unique，而迁移 20261018080000 用 ALTER … DROP CONSTRAINT 有意撤掉了单列唯一、换成 (user_id, op_id) 唯一（它自己的注释写着 op id is unique within an account）。要么补回单列唯一，要么把 schema 那枚 @unique 去掉 —— 这是**不变量收窄**，归那条线判，本尺先登记不代改。',
  },
];

/* ── schema.prisma 侧 ───────────────────────────────────────────────── */
const stripPrismaComments = (body) => body.split('\n').map((l) => l.replace(/^\s*\/\/.*$/u, ''));

const splitFieldList = (raw) => raw
  .split(',')
  .map((s) => s.trim().replace(/\([^)]*\)$/u, '').replace(/^"/u, '').trim())
  .filter((s) => s !== '');

/** Prisma 的默认数据库索引名：表名_数据库列名…_idx；unique 用 _key。 */
const derivedIndexName = (table, cols, unique) => `${table}_${cols.join('_')}_${unique ? 'key' : 'idx'}`;

const parseModels = (src) => {
  const models = [];
  const re = /^model\s+([A-Za-z0-9_]+)\s*\{([\s\S]*?)^\}/gmu;
  let m;
  while ((m = re.exec(src)) !== null) {
    const body = m[2];
    const fields = [];
    for (const rawLine of stripPrismaComments(body)) {
      const line = rawLine.trim();
      if (line === '' || line.startsWith('@@')) continue;
      const f = /^([A-Za-z0-9_]+)\s+[A-Za-z0-9_]+/.exec(line);
      if (f === null) continue;
      const mapM = /@map\(\s*"([^"]+)"\s*\)/u.exec(line);
      fields.push({ name: f[1], column: mapM?.[1] ?? f[1], inlineUnique: /@unique/u.test(line) });
    }
    const table = /@@map\(\s*"([^"]+)"\s*\)/u.exec(body)?.[1] ?? m[1];
    const indexes = [];
    for (const rawLine of stripPrismaComments(body)) {
      const line = rawLine.trim();
      const idx = /^@@(index|unique)\(\[([^\]]*)\](?:,\s*map:\s*"([^"]+)")?\s*\)/u.exec(line);
      if (idx !== null) {
        indexes.push({ unique: idx[1] === 'unique', fields: splitFieldList(idx[2]), map: idx[3] });
      }
    }
    models.push({ name: m[1], table, fields, indexes });
  }
  return models;
};

const schemaSide = (models) => {
  const declared = [];
  const columnsPerTable = new Map();
  for (const model of models) {
    const byName = new Map(model.fields.map((f) => [f.name, f]));
    const dbCols = (list) => list.map((n) => byName.get(n)?.column ?? n);
    const shape = (cols, unique) => shapeKey(model.table, cols, unique);
    for (const idx of model.indexes) {
      const cols = dbCols(idx.fields);
      declared.push({ name: idx.map ?? derivedIndexName(model.table, cols, idx.unique), table: model.table, cols, shape: shape(cols, idx.unique) });
    }
    for (const f of model.fields) {
      if (f.inlineUnique) declared.push({ name: derivedIndexName(model.table, [f.column], true), table: model.table, cols: [f.column], shape: shape([f.column], true) });
    }
    columnsPerTable.set(model.table, new Set(model.fields.map((f) => f.column)));
  }
  return { declared, columnsPerTable };
};

/* ── 迁移侧：按顺序重放出最终的表、列与索引 ─────────────────────────── */
const MIGRATION_DIR_RE = /^(\d{14}_[a-z0-9_]+|0_init)$/u;

/**
 * 去掉整行 `--` 与块注释。
 * 为什么必须做：迁移文件的注释经常**提及**索引名来解释自己为什么这么写（本仓那一族 CONCURRENTLY 迁移就是这么写的），
 * 那是散文不是 DDL，把它当声明读就会造出假红。
 */
const stripSqlComments = (sql) => sql
  .replace(/--[^\n]*/gu, '')
  .replace(/\/\*[\s\S]*?\*\//gu, ' ');

const matchingParen = (sql, open) => {
  let depth = 0;
  for (let i = open; i < sql.length; i += 1) {
    const ch = sql[i];
    if (ch === '(') depth += 1;
    else if (ch === ')') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
};

/** 按**顶层逗号**切：`UNIQUE("a","b")` 用 split(',') 会被切成两半，约束就再也读不出来了。 */
const splitTopLevel = (text) => {
  const out = [];
  let depth = 0;
  let quoted = false;
  let current = '';
  for (const ch of text) {
    if (ch === '"') quoted = !quoted;
    if (!quoted) {
      if (ch === '(') depth += 1;
      else if (ch === ')') depth -= 1;
      else if (ch === ',' && depth === 0) {
        out.push(current);
        current = '';
        continue;
      }
    }
    current += ch;
  }
  out.push(current);
  return out.map((s) => s.trim()).filter((s) => s !== '');
};

/** 按顶层分号切成语句，并**保留文件里的先后顺序**（重放必须按顺序，见 replayMigrations 那条说明）。 */
const splitStatements = (sql) => {
  const out = [];
  let depth = 0;
  let quoted = false;
  let current = '';
  for (const ch of sql) {
    if (ch === '"') quoted = !quoted;
    if (!quoted) {
      if (ch === '(') depth += 1;
      else if (ch === ')') depth -= 1;
      else if (ch === ';' && depth <= 0) {
        if (current.trim() !== '') out.push(current.trim());
        current = '';
        continue;
      }
    }
    current += ch;
  }
  if (current.trim() !== '') out.push(current.trim());
  // plpgsql 的 DO 块里全是分号，切碎了也匹配不到任何锚点；整块剔掉免得造出半句话。
  return out.filter((s) => !/^DO\b/iu.test(s) && !/\$\$/u.test(s));
};

/** 索引/约束的列清单 → 数据库列名数组（剔掉 DESC、NULLS FIRST、操作符类等尾注）。 */
const columnList = (raw) => splitTopLevel(raw)
  .map((part) => {
    const token = part.trim();
    const name = /^"([^"]+)"/u.exec(token)?.[1] ?? /^([A-Za-z0-9_]+)/u.exec(token)?.[1] ?? '';
    return name;
  })
  .filter((s) => s !== '');

/** 形状带**唯一性**这一维：Prisma 的 @@unique 只认唯一索引，同列集合的普通索引不算它存在（第一版就把这两类混在一起，读成"库里有了"）。 */
const shapeKey = (table, cols, unique) => `${unique ? 'U' : 'I'}|${table}|${[...cols].sort().join(',')}`;

/** 这一枚索引是不是 Prisma 根本表达不了的形状（表达不了 ⇒ 不参与"schema 认不认得"的对账）。 */
const isRawShape = (cols, tail) =>
  /\bWHERE\b/iu.test(tail)
  || /\bUSING\b/iu.test(tail)
  || /\(/u.test(cols)
  || /_ops\b/iu.test(cols)
  || /\bCOLLATE\b/iu.test(tail);

const replayMigrations = (migrations) => {
  const tables = new Map();
  const indexes = new Map();
  /**
   * 迁移侧真实存在的"表 + 列集合"形状，按**计数**记（同一形状可能被两条迁移各建过一次，
   * 撤掉一条不能把它清空）。Prisma 的 introspect 是按形状配对索引的，不按名字 ——
   * 只比名字会造出假红：`automation_workers_credential_hash_key` 就是这么被误读成"迁移没建过"的。
   */
  const shapeCount = new Map();
  const putTable = (name) => {
    if (!tables.has(name)) tables.set(name, new Set());
    return tables.get(name);
  };
  const addShape = (table, cols, unique) => {
    if (cols.length === 0) return null;
    const key = shapeKey(table, cols, unique === true);
    shapeCount.set(key, (shapeCount.get(key) ?? 0) + 1);
    return key;
  };
  /** 建出一枚约束/索引时**同时登记它的名字**：后来的 `DROP CONSTRAINT "同名"` 才找得到这枚形状。 */
  const register = (name, table, cols, unique, source) => {
    indexes.set(name, { table, raw: false, unique, source, shape: addShape(table, cols, unique) });
  };
  /**
   * 🔴 按**语句在文件里的先后顺序**重放，不按"语句类别"分趟扫。
   * 分趟扫的那版把同一份文件里的 `DROP INDEX` 排在 `CREATE INDEX` 之后跑，
   * 于是 20260828000001 那种"先删旧的同名索引、再建新的"（本仓的可恢复形状）
   * 被读成"这枚索引不存在"，造出一枚假红。顺序错了，判据就反着说话。
   */
  for (const mig of migrations) {
    for (const stmt of splitStatements(stripSqlComments(mig.sql))) {
      applyStatement(stmt, mig.path, { tables, indexes, shapeCount, putTable, addShape, register });
    }
  }
  const shapes = new Set([...shapeCount].filter(([, n]) => n > 0).map(([k]) => k));
  return { tables, indexes, shapes };
};

const applyStatement = (text, source, state) => {
  const { tables, indexes, shapeCount, putTable, addShape, register } = state;
  const dropShape = (key) => {
    if (key === null || key === undefined) return;
    shapeCount.set(key, Math.max(0, (shapeCount.get(key) ?? 1) - 1));
  };
  let m;
  if ((m = /^CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?"([^"]+)"/iu.exec(text)) !== null) {
    const table = m[1];
    const cols = putTable(table);
    const open = text.indexOf('(', m.index);
    const close = open < 0 ? -1 : matchingParen(text, open);
    if (close < 0) return;
    for (const part of splitTopLevel(text.slice(open + 1, close))) {
      const line = part.replace(/^\(/u, '').trim();
      const constraintUnique = /^CONSTRAINT\s+"([^"]+)"\s+UNIQUE\s*\(([^)]*)\)/iu.exec(line);
      if (constraintUnique !== null) {
        register(constraintUnique[1], table, columnList(constraintUnique[2]), true, source);
        continue;
      }
      const inlineUnique = /^UNIQUE\s*\(([^)]*)\)/iu.exec(line);
      if (inlineUnique !== null) {
        const cols = columnList(inlineUnique[1]);
        register(derivedIndexName(table, cols, true), table, cols, true, source);
        continue;
      }
      if (/^(CONSTRAINT|PRIMARY|UNIQUE|FOREIGN|CHECK|INDEX|KEY)\b/iu.test(line)) continue;
      const col = /^"([^"]+)"/u.exec(line);
      if (col === null) continue;
      cols.add(col[1]);
      // 列内的 `UNIQUE`（如 `"op_id" TEXT NOT NULL UNIQUE`）由 Postgres 建成 <table>_<col>_key，
      // 与 Prisma 的推导名正好同名；后来的 `ALTER TABLE ... DROP CONSTRAINT "同名"` 要能找得到它，
      // 所以这里连名字一起登记（第一版只记形状，读成"库里还在"，漏掉一整枚被撤掉的约束）。
      if (/\bUNIQUE\b/iu.test(line)) register(derivedIndexName(table, [col[1]], true), table, [col[1]], true, source);
    }
    return;
  }
  if ((m = /^ALTER\s+TABLE\s+"([^"]+)"\s+RENAME\s+TO\s+"([^"]+)"/iu.exec(text)) !== null) {
    const set = tables.get(m[1]);
    tables.delete(m[1]);
    tables.set(m[2], set ?? new Set());
    for (const [name, info] of indexes) if (info.table === m[1]) indexes.set(name, { ...info, table: m[2] });
    return;
  }
  if ((m = /^DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?"([^"]+)"/iu.exec(text)) !== null) {
    tables.delete(m[1]);
    for (const [name, info] of indexes) if (info.table === m[1]) dropShape(info.shape);
    for (const [name, info] of indexes) if (info.table === m[1]) indexes.delete(name);
    return;
  }
  if ((m = /^DROP\s+INDEX\s+(?:CONCURRENTLY\s+)?(?:IF\s+EXISTS\s+)?"([^"]+)"/iu.exec(text)) !== null) {
    const info = indexes.get(m[1]);
    dropShape(info?.shape);
    indexes.delete(m[1]);
    return;
  }
  if (/^CREATE\s+(?:UNIQUE\s+)?INDEX/iu.test(text)) {
    for (const mm of text.matchAll(/CREATE\s+(UNIQUE\s+)?INDEX\s+(?:CONCURRENTLY\s+)?(?:IF\s+NOT\s+EXISTS\s+)?"([^"]+)"\s+ON\s+"([^"]+)"\s*\(([^)]*)\)([^;]*)/giu)) {
      const [, uniq, name, table, cols, tail] = mm;
      const raw = isRawShape(cols, tail);
      indexes.set(name, { table, raw, unique: uniq !== undefined, source, shape: raw ? null : addShape(table, columnList(cols), uniq !== undefined) });
    }
    return;
  }
  if (/^ALTER\s+TABLE/iu.test(text)) {
    const table = /^ALTER\s+TABLE\s+"([^"]+)"/iu.exec(text)?.[1];
    if (table === undefined) return;
    for (const mm of text.matchAll(/ADD\s+(?:COLUMN\s+)?"([^"]+)"/giu)) putTable(table).add(mm[1]);
    for (const mm of text.matchAll(/ADD\s+(?:CONSTRAINT\s+"([^"]+)"\s+)?UNIQUE\s*\(([^)]*)\)/giu)) {
      const cols = columnList(mm[2]);
      register(mm[1] ?? derivedIndexName(table, cols, true), table, cols, true, source);
    }
    for (const mm of text.matchAll(/DROP\s+COLUMN\s+(?:IF\s+EXISTS\s+)?"([^"]+)"/giu)) tables.get(table)?.delete(mm[1]);
    for (const mm of text.matchAll(/RENAME\s+(?:COLUMN\s+)?"([^"]+)"\s+TO\s+"([^"]+)"/giu)) {
      const set = tables.get(table);
      if (set !== undefined) {
        set.delete(mm[1]);
        set.add(mm[2]);
      }
    }
    for (const mm of text.matchAll(/DROP\s+CONSTRAINT\s+(?:IF\s+EXISTS\s+)?"([^"]+)"/giu)) {
      // 按**名字**撤：约束的形状早在建表那一句里登记过了，这里找得到就撤，找不到就不动。
      const info = indexes.get(mm[1]);
      dropShape(info?.shape);
      indexes.delete(mm[1]);
    }
  }
};

const readMigrations = (migrationsDir) => {
  if (!existsSync(migrationsDir)) throw new Error(`找不到迁移目录：${migrationsDir}`);
  return readdirSync(migrationsDir)
    .filter((n) => MIGRATION_DIR_RE.test(n))
    .sort()
    .map((name) => {
      const file = join(migrationsDir, name, 'migration.sql');
      return existsSync(file) ? { name, sql: readFileSync(file, 'utf8'), path: `server/prisma/migrations/${name}/migration.sql` } : null;
    })
    .filter((x) => x !== null);
};

/* ── 判据 ───────────────────────────────────────────────────────────── */
export function driftFindings({ schemaPath, migrationsDir, gaps = KNOWN_GAPS }) {
  const models = parseModels(readFileSync(schemaPath, 'utf8'));
  const { declared, columnsPerTable } = schemaSide(models);
  const { tables, indexes, shapes } = replayMigrations(readMigrations(migrationsDir));
  const declaredNames = new Set(declared.map((d) => d.name));
  const createdNames = new Set(indexes.keys());

  const reds = [];
  const exemptRaw = [];
  const exemptTables = [];

  for (const [name, info] of indexes) {
    if (info.raw) {
      exemptRaw.push(name);
      continue;
    }
    if (!declaredNames.has(name)) {
      reds.push(`A) 迁移建了索引「${name}」（${info.source}），而 schema.prisma 认不出这个名字。`
        + ` ⇒ prisma migrate diff 会对线上提 DROP INDEX，下一次 migrate dev 真会删掉它。`
        + ` 修法：在该 model 上补 @@index([...], map: "${name}")，列名按 @map 之后的数据库名写。`);
    }
  }

  for (const [table, cols] of tables) {
    const known = columnsPerTable.get(table);
    if (known === undefined) {
      exemptTables.push(table);
      continue;
    }
    for (const col of cols) {
      if (!known.has(col)) {
        reds.push(`B) 迁移给表「${table}」建的列「${col}」在 schema.prisma 里没有任何字段映射到它。`
          + ` ⇒ Prisma Client 会引用它自己推导出来的那个名字，在**按迁移建出来的库**（生产、自托管装机）上`
          + `第一条查询就 P2022。修法：字段上补 @map("${col}")。构建、typecheck、单测都不会告诉你这一条。`);
      }
    }
  }

  for (const gap of gaps) {
    if (!declaredNames.has(gap.name)) {
      reds.push(`C) 在册缺口「${gap.name}」现在 schema 里已经认不出了 —— 这条登记与本件事不符，`
        + `请把 KNOWN_GAPS 里那一行处理掉（改判据或删登记都行，别留一条对不上号的记录）。`);
    }
    if (createdNames.has(gap.name)) {
      reds.push(`C) 在册缺口「${gap.name}」已经被某条迁移建出来了 ⇒ KNOWN_GAPS 那一行要删`
        + `（留着它就是一只永远不会红的哨兵，而下一位会以为这个洞还在）。`);
    }
  }
  const gapHits = [];
  for (const d of declared) {
    if (createdNames.has(d.name) || shapes.has(d.shape)) continue;
    if (gaps.some((g) => g.name === d.name)) {
      gapHits.push(d.name);
      continue;
    }
    reds.push(`C) schema.prisma 声明了索引「${d.name}」（表「${d.table}」列 ${d.cols.join("、")}），`
      + `而按迁移重放出来的库里既没有这个名字、也没有同形状的索引 ⇒ 生产与自托管装机都缺它。`
      + `出路只有两条：补一条迁移（走 server/scripts/migrate-deploy.sh，别裸 prisma migrate deploy），`
      + `或者在本脚本的 KNOWN_GAPS 里登记归属与理由。`);
  }

  return {
    reds,
    readings: {
      models: models.length,
      tables: tables.size,
      indexes: indexes.size,
      declared: declared.length,
      exemptRaw: exemptRaw.length,
      exemptTables,
      knownGaps: gaps.length,
      gapHits: gapHits.length,
    },
  };
}

const REPO = {
  schemaPath: join(ROOT, 'server/prisma/schema.prisma'),
  migrationsDir: join(ROOT, 'server/prisma/migrations'),
};

/* ── 自检：每条判据都要能被单独打红，且形状豁免不许误红 ─────────────── */
const CLEAN_SCHEMA = [
  'model Thing {',
  '  id     String @id',
  '  userId Int    @map("user_id")',
  '',
  '  @@index([userId], map: "thing_user_id_idx")',
  '  @@map("thing")',
  '}',
  '',
].join('\n');

const CLEAN_INIT = [
  'CREATE TABLE "thing" (',
  '  "id" TEXT NOT NULL,',
  '  "user_id" INTEGER NOT NULL,',
  '  CONSTRAINT "thing_pkey" PRIMARY KEY ("id")',
  ');',
  'CREATE INDEX "thing_user_id_idx" ON "thing"("user_id");',
  '',
].join('\n');

const buildFixture = (mutate) => {
  const dir = mkdtempSync(join(tmpdir(), 'heyta-drift-fixture-'));
  try {
    const schemaPath = join(dir, 'server/prisma/schema.prisma');
    const migrationsDir = join(dir, 'server/prisma/migrations');
    mkdirSync(dirname(schemaPath), { recursive: true });
    mkdirSync(migrationsDir, { recursive: true });
    let schema = CLEAN_SCHEMA;
    const files = new Map([['0_init', CLEAN_INIT]]);
    mutate({ setSchema: (s) => { schema = s; }, addMigration: (name, sql) => files.set(name, sql) });
    writeFileSync(schemaPath, schema, 'utf8');
    for (const [name, sql] of files) {
      const one = join(migrationsDir, name);
      mkdirSync(one, { recursive: true });
      writeFileSync(join(one, 'migration.sql'), sql, 'utf8');
    }
    return driftFindings({ schemaPath, migrationsDir, gaps: [] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

const selfTest = () => {
  const arms = [];
  const push = (label, wantRed, found) => {
    const got = found.reds.length > 0;
    arms.push({ label, ok: got === wantRed, detail: got ? found.reds[0].slice(0, 110) : '（无红）' });
  };

  push('臂1 干净夹具必须过（这条不成立，下面几臂就是没有牙的）', false, buildFixture(() => {}));

  push('臂2 抹掉 @map("user_id") ⇒ 必须红（线上那一枚就是这个形状）', true,
    buildFixture(({ setSchema }) => setSchema(CLEAN_SCHEMA.replace('Int    @map("user_id")', 'Int'))));

  push('臂3 显式 map 换成 Prisma 推导名 ⇒ 仍要过（尺不能只认字面量，否则真库上白名单会越加越长）', false,
    buildFixture(({ setSchema }) => setSchema(CLEAN_SCHEMA.replace('@@index([userId], map: "thing_user_id_idx")', '@@index([userId])'))));

  push('臂4 迁移新建一枚 schema 不认的索引 ⇒ 必须红', true,
    buildFixture(({ addMigration }) => addMigration('20260101000000_extra', 'CREATE INDEX "thing_zzz_idx" ON "thing"("id");\n')));

  push('臂5 带 WHERE 的 raw 部分索引 ⇒ 按形状豁免，不许误红（误红的尺第二天就被人放宽）', false,
    buildFixture(({ addMigration }) => addMigration('20260101000001_partial',
      'CREATE UNIQUE INDEX "thing_one_live_per_user_idx" ON "thing"("user_id") WHERE "id" <> \'\';\n')));

  push('臂6 把 schema 里那条 @@index 整行删掉 ⇒ 必须红（删声明不许悄悄绿）', true,
    buildFixture(({ setSchema }) => setSchema(CLEAN_SCHEMA.replace('  @@index([userId], map: "thing_user_id_idx")\n', ''))));

  push('臂7 迁移后来把这枚索引 DROP 掉了：A 方向不再要求 schema 认得它，但 C 方向必须红（声明还在、库里已经没有了）', true,
    buildFixture(({ addMigration }) => addMigration('20260101000002_drop', 'DROP INDEX CONCURRENTLY "thing_user_id_idx";\n')));

  push('臂8 注释里提到一枚不存在的索引名 ⇒ 不许把它当 DDL 读（假红的经典形状）', false,
    buildFixture(({ addMigration }) => addMigration('20260101000003_comment', '-- 这里本来想建 "thing_ghost_idx"，后来没建\n')));

  push('臂9 schema 多声明一枚 @@unique 而库里只有同列集合的普通索引 ⇒ 必须红（唯一性那一维不许被形状匹配糊过去；把形状键退化成不看 unique 时这一臂会变绿）', true,
    buildFixture(({ setSchema }) => setSchema(CLEAN_SCHEMA.replace('  @@map("thing")', '  @@unique([userId])\n  @@map("thing")'))));

  push('臂10 表内 UNIQUE 建出来、后来被 ALTER … DROP CONSTRAINT 按名字撤掉 ⇒ 必须红（撤掉的约束不能还算在库里）', true,
    buildFixture(({ setSchema, addMigration }) => {
      setSchema(`${CLEAN_SCHEMA}model Widget {\n  id String @unique\n\n  @@map("widget")\n}\n`);
      addMigration('20260101000005_widget', [
        'CREATE TABLE "widget" (',
        '  "id" TEXT NOT NULL UNIQUE',
        ');',
        'ALTER TABLE "widget" DROP CONSTRAINT "widget_id_key";',
        '',
      ].join('\n'));
    }));

  push('臂11 同一条语句里先 DROP 同名索引、再 CREATE 回来（本仓的可恢复形状）⇒ 不许红', false,
    buildFixture(({ addMigration }) => addMigration('20260101000006_rebuild',
      'DROP INDEX CONCURRENTLY IF EXISTS "thing_user_id_idx";\nCREATE INDEX CONCURRENTLY "thing_user_id_idx" ON "thing"("user_id");\n')));

  let bad = 0;
  for (const arm of arms) {
    console.log(`  ${arm.ok ? 'ok ' : 'RED'} ${arm.label} ｜ ${arm.detail}`);
    if (!arm.ok) bad += 1;
  }
  console.log(`自检：臂数 ${String(arms.length)} ｜ 不符 ${String(bad)}`);
  if (bad > 0) process.exit(1);
};

if (SELF_TEST) {
  selfTest();
  process.exit(0);
}

/**
 * `--dump-indexes`：把"按迁移重放出来的最终索引名"逐行打到 stdout。
 * 它是这把尺**自己的对照臂** —— 拿去和一枚真按迁移建起来的库（pg_indexes）对，
 * 就能知道重放器漏没漏东西，而不是只信尺自己说"我算过了"。
 */
if (process.argv.includes('--dump-indexes')) {
  const { indexes } = replayMigrations(readMigrations(REPO.migrationsDir));
  for (const [name, info] of [...indexes].sort(([a], [b]) => (a < b ? -1 : 1))) {
    console.log(`${info.raw ? 'raw' : 'pln'} ${name}`);
  }
  process.exit(0);
}

const { reds, readings } = driftFindings(REPO);
console.log(`schema 与迁移对账：model ${String(readings.models)} 枚 ｜ 迁移侧最终表 ${String(readings.tables)} 枚、索引 ${String(readings.indexes)} 枚`
  + ` ｜ 形状豁免 ${String(readings.exemptRaw)} 枚（带 WHERE／USING／函数列／操作符类）`
  + ` ｜ schema 侧声明 ${String(readings.declared)} 枚 ｜ 在册缺口 ${String(readings.knownGaps)} 枚（命中 ${String(readings.gapHits)} 枚）`);
if (readings.exemptTables.length > 0) {
  console.log(`没有对应 model 的表（豁免，不静默）：${readings.exemptTables.join('、')}`);
}
if (reds.length > 0) {
  for (const r of reds) console.error(`🔴 ${r}`);
  console.error(`共 ${String(reds.length)} 条。`);
  process.exit(1);
}
console.log('✅ schema.prisma 与 migrations 对得上：没有被 migrate diff 提 DROP 的索引，也没有客户端取不到的列名。');
