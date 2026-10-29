#!/usr/bin/env node
/**
 * server 读路径的索引覆盖探针（注册登录标准套件线，2026-10-29）
 * ============================================================
 *
 * 目标第 3 件第 ③ 维点名了"缺分页/缺索引的读路径"。这一台管**缺索引**那一半。
 * 判的是必要条件的违反，不是充分条件 —— 所以它报出来的是**候选**，删/加之前都要人开码看：
 *
 *   取每一处 `prisma.<model>.findMany|findFirst|findUnique|count|deleteMany|updateMany({ where: { … } })`
 *   里 where 的**顶层字段名**，再看 schema 里该 model 有没有任一
 *   `@@index` / `@@unique` / `@@id` 把其中**任一字段放在最左列**。
 *   一个都没有 ⇒ 🟠（B-tree 复合索引没有左前列就用不上，这是必要条件，不是我的猜测）。
 *
 * 🔴 三格必须显式落成"未判定"并**报条数**，静默跳过就等于把"没看到"记成"没有"：
 *   ① where 的值是变量/展开（`where`、`{ ...w }`、函数调用）；
 *   ② 嵌套对象条件（`author: { ... }` 这种关系过滤，左前列在另一张表上）；
 *   ③ `AND` / `OR` / `NOT` 包着的组合条件。
 * 另有一格它天生看不见：**排序与分页**走没走索引、有没有 `take` —— 那要执行计划，不是文本判据。
 *
 * 用法：node research/tools/audit-server-read-index-coverage.mjs [--strict] [--self-test] [--top N]
 * 退出：0 = 只报读数；1 = --strict 且有 🟠；2 = 分母为空 / 阳性对照不成立（"我没干活"，不许读成"都覆盖了"）
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const argv = process.argv.slice(2);
const strict = argv.includes('--strict');
const selfTest = argv.includes('--self-test');
const topIv = argv.indexOf('--top');
const TOP = topIv >= 0 && /^\d+$/.test(argv[topIv + 1] ?? '') ? Number(argv[topIv + 1]) : 30;
const unknown = argv.filter((a) => !['--strict', '--self-test'].includes(a) && a !== '--top' && !/^\d+$/.test(a));

const SCALAR_FILTERS = new Set(['equals','in','notIn','lt','lte','gt','gte','contains','startsWith','endsWith','not','mode'])
const QUERY_HEAD_RE = /\.([a-zA-Z][\w]*)\.(findMany|findFirst|findFirst|findUnique|findUniqueOrThrow|count|aggregate|groupBy|deleteMany|updateMany)\(\s*\{/g;

/** 从 `(` 后那枚 `{` 起做配对扫描 ⇒ 返回整个参数对象的体（配不上对返回 null，交回未判定）。 */
export function balancedFrom(text, start) {
  let depth = 0;
  let quote = null;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (quote) { if (ch === '\\') { i += 1; continue; } if (ch === quote) quote = null; continue; }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
    if (ch === '{' || ch === '[' || ch === '(') depth += 1;
    else if (ch === '}' || ch === ']' || ch === ')') { depth -= 1; if (depth === 0) return text.slice(start + 1, i); }
  }
  return null;
}
/** 从 `where:` 之后取**配对**的那一层 `{…}`。非贪婪 `\{[\s\S]*?\}` 会在 `{ gt: now }` 的内层括号处截断 ⇒ 键被吃掉、未判定虚高。 */


/** 从 schema.prisma 取每个 model 的"可作为索引左前列的字段集合"。 */
export function indexLeading(schemaText) {
  const map = new Map();
  const models = [...schemaText.matchAll(/^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm)];
  for (const [, name, body] of models) {
    const lead = new Set();
    const idm = /@@id\(\[([^\]]+)\]\)/.exec(body);
    if (idm) lead.add(idm[1].split(',')[0].trim().split(/\s+/)[0]);
    for (const m of body.matchAll(/@@(?:index|unique)\(\[([^\]]+)\]/g)) {
      const first = m[1].split(',')[0].trim().split(/\s+/)[0];
      if (first) lead.add(first);
    }
    // 单列 `@id` / `@unique` 自身就是可用左前列
    for (const m of body.matchAll(/^\s*(\w+)[^\n]*@(?:id|unique)/gm)) lead.add(m[1]);
    map.set(name, lead);
  }
  return map;
}

/**
 * 一处查询里能确定的顶层 where 字段。
 * 返回 `{ fields, unresolved }`：`unresolved` 非零意味着这处**没判**，不许算进"已覆盖"。
 */
/**
 * 把 `where: { … }` 的体切成**顶层**条目。
 * 🔴 不能按行切：本仓大量写成 `where: { eventId: a, userId: b, leaseWorkerId: c }`（一行三枚键），
 *   按行取键只会拿到第一枚 ⇒ 把"其实走了 userId 的复合索引"那类查询**误报成缺口**
 *   （2026-10-28 人工复核 `server/src/automation/events.ts:305` 时抓到这一格，它正是这么被冤枉的）。
 */
export function balancedAfter(text, key) {
  const at = new RegExp(key + '\\s*:\\s*\\{').exec(text);
  if (!at) return null;
  const open = text.indexOf('{', at.index);
  let depth = 0;
  let quote = null;
  for (let i = open; i < text.length; i += 1) {
    const ch = text[i];
    if (quote) { if (ch === '\\') { i += 1; continue; } if (ch === quote) quote = null; continue; }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
    if (ch === '{' || ch === '[' || ch === '(') depth += 1;
    else if (ch === '}' || ch === ']' || ch === ')') { depth -= 1; if (depth === 0) return text.slice(open + 1, i); }
  }
  return null; // 配不上对 ⇒ 交回未判定，不猜
}

export function splitTopLevel(body) {
  const parts = [];
  let depth = 0;
  let quote = null;
  let cur = '';
  for (const ch of body) {
    if (quote) {
      cur += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; cur += ch; continue; }
    if (ch === '{' || ch === '[' || ch === '(') depth += 1;
    else if (ch === '}' || ch === ']' || ch === ')') depth -= 1;
    if (ch === ',' && depth === 0) { parts.push(cur); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim() !== '') parts.push(cur);
  return parts;
}

export function whereFields(whereBody) {
  const fields = [];
  let unresolved = 0;
  for (const part of splitTopLevel(whereBody)) {
    const line = part.trim().replace(/\s+/g, ' ');
    if (line === '' || line.startsWith('//')) continue;
    const m = /^(\w+)\s*:\s*(.*)$/.exec(line);
    if (!m) {
      unresolved += 1;
      continue;
    }
    const key = m[1];
    const val = m[2];
    if (key === 'AND' || key === 'OR' || key === 'NOT' || val === '') {
      unresolved += 1;
      continue;
    }
    if (/^\{/.test(val)) {
      const inner = /^\{\s*(\w+)\s*:/.exec(val);
      if (inner && SCALAR_FILTERS.has(inner[1])) fields.push(key);
      else unresolved += 1;
      continue;
    }
    if (/^\[/.test(val) || /^\w+\s*\(/.test(val) || /^\.\.\./.test(val)) {
      unresolved += 1;
      continue;
    }
    fields.push(key);
  }
  return { fields, unresolved };
}

/** 判一处查询。lead 为空集（model 没有任何索引/唯一）时整处算未判定候选池，另报。 */
export function judge(model, fields, lead) {
  if (fields.length === 0) return 'none';
  if (lead.size === 0) return 'noindex';
  return fields.some((f) => lead.has(f)) ? 'covered' : 'missing';
}

const SELF_TEST_ARMS = () => {
  const arms = [];
  const push = (name, got, want) => arms.push({ name, ok: JSON.stringify(got) === JSON.stringify(want), got, want });
  const schema = [
    'model Task {',
    '  id       String  @id',
    '  listId   String',
    '  ownerId  String',
    '  title    String',
    '  @@index([listId, updatedAt])',
    '}',
    'model Bare {',
    '  id String @id',
    '  code String',
    '}',
    'model U {',
    '  a String @unique',
    '  b String',
    '}',
  ].join('\n');
  const idx = indexLeading(schema);
  push('I1 复合索引只登记**最左列**（把非左前列当成可用，就是把候选藏起来）', [...idx.get('Task')].sort(), ['id', 'listId']);
  push('I2 单列 @id / @unique 也是可用左前列', [idx.get('Bare').has('id'), idx.get('U').has('a'), idx.get('U').has('b')], [true, true, false]);
  push('I3 where 取顶层标量字段；关系过滤与 AND 要落成未判定，不许当成"已判过"', whereFields('  listId: l,\n  author: { id: u },\n  AND: [{ a: 1 }],\n  ownerId: o,'), { fields: ['listId', 'ownerId'], unresolved: 2 });
  push('I4 `in: [...]` 仍是该字段的条件（判成未判定会让整块索引缺口全隐身）', whereFields('  status: { in: ["a", "b"] },').fields, ['status']);
  push('I5 阳性对照：查左前列 ⇒ covered，**不许**进候选（进了这尺就在编造）', judge('Task', ['listId'], idx.get('Task')), 'covered');
  push('I6 非左前列 ⇒ missing（`@@index([listId, updatedAt])` 用不上 updatedAt 单列条件）', judge('Task', ['title'], idx.get('Task')), 'missing');
  // 注意：`Bare` 有 `id @id` ⇒ 它的左前列集合**非空**，查 `code` 该落 missing 而不是 noindex。
  // 我第一版把这条期望写成 covered，是 fixture 想当然；空集合那一档另立一枚臂。
  push('I7 有 @id 的表查非索引列 ⇒ missing（不是 noindex：这表有左前列，只是这次没用到）', judge('Bare', ['code'], idx.get('Bare')), 'missing');
  push('I7b 一枚左前列都没有的表 ⇒ noindex，不和"字段选错"混成一桶', judge('Bare', ['code'], new Set()), 'noindex');
  push('I7c 完全没写 @id/@unique/@@index 的 model，indexLeading 要给空集（否则 noindex 那一桶永远是空的）', indexLeading('model Z {\n  a String\n  b String\n}').get('Z').size, 0);
  push('I4b 一枚行里写三个键（本仓常见写法）⇒ 三枚都要取到，漏一枚就会把命中索引的查询误报成缺口', whereFields('  eventId: a, userId: b, leaseWorkerId: c, ').fields, ['eventId', 'userId', 'leaseWorkerId']);
  push('I8 where 里一个字段都提不出 ⇒ none（不报错，也不许算已覆盖）', judge('Task', [], idx.get('Task')), 'none');
  return arms;
};

const run = () => {
  if (unknown.length > 0) {
    console.error(`🔴 不认的旗标：${unknown.join(' ')} ｜ 只认 --strict / --self-test / --top N`);
    process.exit(1);
  }
  if (selfTest) {
    const arms = SELF_TEST_ARMS();
    const bad = arms.filter((a) => !a.ok);
    for (const a of arms) console.log(`${a.ok ? '✅' : '🔴'} ${a.name}${a.ok ? '' : ` ｜ 得到 ${JSON.stringify(a.got)} ｜ 期望 ${JSON.stringify(a.want)}`}`);
    console.log(`臂数 ${arms.length} ｜ 不符 ${bad.length}`);
    process.exit(bad.length === 0 ? 0 : 1);
  }
  const schemaPath = path.join(ROOT, 'server/prisma/schema.prisma');
  if (!existsSync(schemaPath)) {
    console.error('🔴 读不到 server/prisma/schema.prisma ⇒ 今天不许报"索引都覆盖了"');
    process.exit(2);
  }
  const lead = indexLeading(readFileSync(schemaPath, 'utf8'));
  if (lead.size === 0) {
    console.error('🔴 schema 里一枚 model 都没解析到 ⇒ 分母为空，这一趟不算读数');
    process.exit(2);
  }
  const files = execFileSync('git', ['ls-files', '--', 'server/src/**/*.ts'], { cwd: ROOT, encoding: 'utf8' }).split('\n').filter((l) => l !== '');
  const missing = [];
  const noindex = [];
  let covered = 0;
  let unresolved = 0;
  let sitesJudged = 0;
  let sitesPartial = 0;
  const nowhere = '无字面 where（全表读或 where 是变量）';
  const reasons = {};
  let sites = 0;
  for (const f of files) {
    const text = readFileSync(path.join(ROOT, f), 'utf8');
    for (const m of text.matchAll(QUERY_HEAD_RE)) {
      sites += 1;
      const model = m[1][0].toUpperCase() + m[1].slice(1);
      const args = balancedFrom(text, m.index + m[0].length - 1);
      if (args === null) {
        unresolved += 1;
        reasons.arg = (reasons.arg ?? 0) + 1;
        continue;
      }
      const body = balancedAfter(args, 'where');
      if (body === null) {
        unresolved += 1;
        // where 不是字面对象：`where: w`、`where: buildX(…)`、或干脆没有 where（全表读）—— 三种都不是本尺的料，也不能算"已覆盖"
        reasons[nowhere] = (reasons[nowhere] ?? 0) + 1;
        continue;
      }
      const { fields, unresolved: u } = whereFields(body);
      unresolved += u;
      // 🔴 单位要一致：站点级的账用「处」记，不能把条目数混进同一行读数里
      //   （第一版把 `未判定 241`（条目）与 `查询点 362`（处）印在同一行，读起来像 241 处没判）。
      if (u > 0) sitesPartial += 1;
      const j = judge(model, fields, lead.get(model) ?? new Set());
      if (j === 'covered') covered += 1;
      else if (j === 'missing') missing.push({ file: f, model, fields, line: text.slice(0, m.index).split('\n').length });
      else if (j === 'noindex') noindex.push({ file: f, model, fields, line: text.slice(0, m.index).split('\n').length });
      if (j !== 'none') sitesJudged += 1;
    }
  }
  if (sites === 0) {
    console.error('🔴 一处 prisma 查询都没枚举到 ⇒ 探针不合（写法变了？），不许读成"没有缺口"');
    process.exit(2);
  }
  console.log(`server 读路径索引对账 ｜ model ${lead.size} 枚 ｜ 查询点 ${sites} 处（其中 ${sitesJudged} 处判得出、${sitesPartial} 处含判不了的条目，条目级未判定 ${unresolved}）`);
  console.log(`   左前列命中 ${covered} ｜ 无一命中 ${missing.length} ｜ 该表零索引 ${noindex.length}`);
  const show = (title, rows) => {
    if (rows.length === 0) return;
    console.log(`\n${title}（${rows.length} 处，列前 ${Math.min(TOP, rows.length)}）`);
    for (const r of rows.slice(0, TOP)) console.log(`   ${r.file}:${r.line}  ${r.model}  where=[${r.fields.join(', ')}]`);
  };
  show('🟠 没有任何索引以这些 where 字段作最左列（候选：加索引、改查询、或确认它只在小表上跑）', missing);
  show('🟠 该 model 一枚索引/唯一都没有（全表扫的读路径）', noindex);
  if (missing.length === 0 && noindex.length === 0) console.log('   ⇒ 两桶都空。这一句只在上面那行"未判定"不显著时才当读数用。');
  console.log('   未判定分因：' + Object.entries(reasons).map(([k, v]) => `${k} ${v}`).join(' ｜ ') + ` ｜ 其余是 where 里取值判不了的条目（关系过滤 / AND·OR·NOT / 展开）${unresolved - (reasons[nowhere] ?? 0) - (reasons.arg ?? 0)}`);
  console.log('\n⚠️ 这一台判的是必要条件：它不看排序/分页走没走索引，也不看统计信息。逐处开码确认之前，一枚都不动。');
  process.exit(strict && missing.length + noindex.length > 0 ? 1 : 0);
};

run();
