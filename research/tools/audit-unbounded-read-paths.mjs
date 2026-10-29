#!/usr/bin/env node
/**
 * 无界列表读路（"缺分页"那一格）：`findMany` 有没有把行数钉住。
 * =================================================================
 *
 * ## 为什么这一格先前没有装置
 *
 * 第 ③ 维其余几格各有装置（循环里逐行查库/同步 IO、监听器与定时器、读路径索引覆盖），
 * "可避免的全量重渲染"住在 `docs/research/performance-hotpaths-audit.md` 那条线（P0/P1 各带会红的用例），
 * 唯独"**缺分页**"只剩散文。本尺补的就是这一格。
 *
 * ## 判什么（A 档，机械可判）
 *
 * Prisma 的 `findMany` 家族：参数对象在**顶层**没写 `take` / `skip` / `cursor` ⇒ 无界候选；
 * 一枚参数都没有（`findMany()`）⇒ 无界候选（那是整张表）。
 * 🔴 只认**深度 0** 的键：`{ select: { items: { take: 3 } } }` 里那个 `take` 限的是关联那一层，
 * 主查询照样无界 ⇒ 这一枚仍必须是候选（臂 N7 判的就是这条，把它读成"有界"就是假绿）。
 *
 * ## **不**判什么（照本仓规矩：宁可说不判，不许把"扫不到"写成"没有"）
 *
 * - `count` / `aggregate` / `groupBy`：返回的不是行列表 ⇒ 记 `notList`，不判。
 * - 参数是变量或展开（`findMany(args)`、`findMany({ ...opts })`）⇒ 记 `undecidable` 并逐枚带 `file:line`，
 *   有界与否由人开码；这一档**不许**折进"没有无界读"。
 * - `$queryRaw` / `$queryRawUnsafe`：判一条 SQL 有没有界要真解析 `WHERE` 谓词的形状
 *   （`SELECT id FROM users WHERE id = $1` 天然 ≤1 行，而 `SELECT * FROM ops` 不是），
 *   本尺**没有**那个能力 ⇒ 整族记 `rawOut` 只报条数与位置。
 * - 客户端与 HTTP 层的"列表有没有分页参数"：那是另一套写法（fetch 的 query string 与路由 handler 的返回形状），
 *   不在本尺射程 ⇒ 头一行就把这句打出来，别让读的人以为整条链都量过了。
 *
 * ## 用法与退出码
 *
 *   node research/tools/audit-unbounded-read-paths.mjs                 # 诊断，恒退 0
 *   node research/tools/audit-unbounded-read-paths.mjs --strict         # 有候选 ⇒ 退 1
 *   node research/tools/audit-unbounded-read-paths.mjs --top 500        # 全列
 *   node research/tools/audit-unbounded-read-paths.mjs --self-test      # 12 枚臂
 *   node research/tools/audit-unbounded-read-paths.mjs --mutate         # 真树上加/减 take，两个方向都要动
 *
 * 0 诊断 / 1 `--strict` 且确有候选 / 2 分母为空（瞎尺）。
 *
 * 🔴 **候选里有一族"不许照字面去加 take"**，下一位开码前先读这句：
 * 凡"这一列就是用户能撤销/能看见的全部"的读路，加 `take` 会把一部分**静默藏起来**，
 * 那是把安全面改坏，不是修性能。现量一枚这样的：`server/src/account/access-sessions.ts:189`
 * ——`listSessions` 的注释（`:178`）写着"退出登录撤销不了它们就变成一句界面上的谎"，
 * 所以它的正确边界是**行的生命周期**：撤销/清扫的路径自己就在删行
 * （`server/src/account/access-sessions.ts:218/239/274` 与 `server/src/central-auth/repository.ts:689/749`），
 * 而不是在查询上加一个把一部分会话藏起来的 `take`。
 * 判这一族只能开码读注释与调用方，尺不参与；尺只保证"没有一枚是被静默略过的"。
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { maskText, balanced, lineOf } from './lib/text-mask.mjs';

const SCOPE_RE = /^((apps|packages)\/[^/]+\/src\/.*\.(ts|tsx)|server\/src\/.*\.ts)$/;
// `findMany(` 之前那一段接受 `prisma.`、`client.`、`tx.`、`db.`、`xxxClient.` 这些仓储样子的头，
// 但不强求——本仓的真写法是 `prisma.user.findMany({` 与 `client.holidayAdjustmentYear.findMany({`。
const LIST_RE = /\.findMany\s*\(/g;
const NON_LIST_RE = /\.(?:count|aggregate|groupBy)\s*\(/g;
const RAW_RE = /\$(?:queryRaw|queryRawUnsafe|executeRaw|executeRawUnsafe)\b/g;
const BOUNDED_KEY_RE = /^(take|skip|cursor)$/;
const MAX_LIST = 30;

const git = (args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).trim();

/** 参数对象里**深度 0** 有没有 take/skip/cursor。返回 true=钉住了行数。
 *  🔴 `balanced` 交回来的是"括号之内"的整段，实参是对象字面量时**那一层 `{}` 也在里面** ⇒
 *  顶层键的 depth 是 1 而不是 0。这一格是被自己的臂 N3 抓出来的（按 0 比会永远比不中，
 *  于是每一枚有界的读都被报成候选——假红反过来也会掩盖真候选）。 */
export function hasTopLevelBound(inner) {
  let depth = 0;
  const base = inner.trim().startsWith('{') ? 1 : 0;
  // 🔴 括号类要写全：`[{[(\])]` 那种写法漏了 `}`，嵌套对象只加不减深度，
  //    于是 `{ where: {}, take: 50 }` 里的 `take` 落在"深度 2"上读不见（臂 N3 当场抓住）。
  const keyRe = /([{}[\]()]|\b[a-zA-Z_$][\w$]*\s*:)/g;
  let m;
  while ((m = keyRe.exec(inner)) !== null) {
    const tok = m[1];
    if (tok === '{' || tok === '[' || tok === '(') { depth += 1; continue; }
    if (tok === '}' || tok === ']' || tok === ')') { depth -= 1; continue; }
    if (depth === base) {
      const key = tok.split(':')[0].trim();
      // 展开 `{ ...opts }` 会让顶层键看不见 ⇒ 保守判成"钉不住"（另一半在 spreadArg 那一档）
      if (BOUNDED_KEY_RE.test(key)) return true;
    }
  }
  return false;
}

/** 一份文件里的每一枚列表读。返回 { rows, counts }。 */
export function scanText(file, text) {
  const masked = maskText(text);
  const rows = [];
  const counts = { list: 0, unbounded: 0, bounded: 0, spreadOrVar: 0, notList: 0, rawOut: 0, unbalanced: 0 };
  for (const [re, kind] of [[LIST_RE, 'list'], [NON_LIST_RE, 'notList'], [RAW_RE, 'raw']]) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(masked)) !== null) {
      if (kind === 'notList') { counts.notList += 1; continue; }
      if (kind === 'raw') {
        counts.rawOut += 1;
        rows.push({ file, line: lineOf(masked, m.index), bucket: 'rawOut', at: m.index });
        continue;
      }
      // kind === 'list'：找实参括号
      const open = m.index + m[0].length - 1;
      const arg = balanced(masked, open);
      counts.list += 1;
      if (arg === null) { counts.unbalanced += 1; rows.push({ file, line: lineOf(masked, m.index), bucket: 'unbalanced', at: m.index }); continue; }
      const inner = arg.inner.trim();
      if (inner === '') { counts.unbounded += 1; rows.push({ file, line: lineOf(masked, m.index), bucket: 'noArgs', at: m.index }); continue; }
      if (inner[0] !== '{') { counts.spreadOrVar += 1; rows.push({ file, line: lineOf(masked, m.index), bucket: 'dynamicArg', at: m.index }); continue; }
      if (/^\{\s*\.\.\./.test(inner)) { counts.spreadOrVar += 1; rows.push({ file, line: lineOf(masked, m.index), bucket: 'spreadArg', at: m.index }); continue; }
      if (hasTopLevelBound(arg.inner)) { counts.bounded += 1; rows.push({ file, line: lineOf(masked, m.index), bucket: 'bounded', at: m.index }); continue; }
      counts.unbounded += 1;
      rows.push({ file, line: lineOf(masked, m.index), bucket: 'objectNoBound', at: m.index });
    }
  }
  return { rows, counts };
}

export function scanFiles(files, read) {
  const rows = [];
  const counts = { files: files.length, unreadable: 0, list: 0, unbounded: 0, bounded: 0, spreadOrVar: 0, notList: 0, rawOut: 0, unbalanced: 0 };
  for (const f of files) {
    let text;
    try { text = read(f); } catch { counts.unreadable += 1; continue; }
    const r = scanText(f, text);
    rows.push(...r.rows);
    for (const k of ['list', 'unbounded', 'bounded', 'spreadOrVar', 'notList', 'rawOut', 'unbalanced']) counts[k] += r.counts[k];
  }
  return { rows, counts };
}

const candidates = (rows) => rows.filter((r) => ['noArgs', 'objectNoBound'].includes(r.bucket));

/** 站点级分母对账：每一枚列表读要么在某个桶里，要么被点名成配不上。 */
function reconcile(counts) {
  return counts.list === counts.unbounded + counts.bounded + counts.spreadOrVar + counts.unbalanced;
}

function selfTest() {
  const out = [];
  const push = (name, got, want) => out.push({ name, ok: JSON.stringify(got) === JSON.stringify(want), got, want });
  const run = (body) => scanText('x.ts', body);
  const F = (code) => `import { prisma } from './db';\nexport async function f(): Promise<void> {\n${code}\n}\n`;

  push('N1 `findMany()` 一枚参数都没有 ⇒ 候选（那是整张表）', run(F('await prisma.user.findMany();')).rows.map((r) => r.bucket), ['noArgs']);
  push('N2 `findMany({ where })` 顶层没有 take/skip/cursor ⇒ 候选', run(F("await prisma.task.findMany({ where: { ownerId: '1' } });")).rows.map((r) => r.bucket), ['objectNoBound']);
  push('N3 顶层 `take` ⇒ 有界，不判红', run(F("await prisma.task.findMany({ where: {}, take: 50 });")).rows.map((r) => r.bucket), ['bounded']);
  push('N4 游标分页（`cursor` + `take`）⇒ 有界', run(F("await prisma.op.findMany({ cursor: { id: x }, take: 20 });")).rows.map((r) => r.bucket), ['bounded']);
  push('N5 参数是变量/展开 ⇒ 记「判不了」，不许折进「没有无界读」', run(F('await prisma.task.findMany(args);')).rows.map((r) => r.bucket), ['dynamicArg']);
  push('N5b `{ ...opts }` 同上一档（顶层键看不见）', run(F('await prisma.task.findMany({ ...opts });')).rows.map((r) => r.bucket), ['spreadArg']);
  push('N6 count/aggregate/groupBy ⇒ 不是行列表，整族不判', run(F("await prisma.task.count({ where: {} });\nawait prisma.task.groupBy({ by: ['a'] });")).counts.notList, 2);
  push('N7 🔴 嵌套层的 take 不算数（`{ select: { items: { take: 3 } } }` 主查询仍无界）', run(F("await prisma.owner.findMany({ select: { items: { take: 3 } } });")).rows.map((r) => r.bucket), ['objectNoBound']);
  push('N8 `$queryRaw` 整族记「射程外」并带位置，不当候选也不当"没有"', run(F('await prisma.$queryRaw`SELECT * FROM ops`;')).rows.map((r) => r.bucket), ['rawOut']);
  push('N9 分母对账成立：列表读 = 候选 + 有界 + 判不了 + 配不上', (() => { const c = run(F("await prisma.a.findMany();\nawait prisma.b.findMany({ take: 1 });\nawait prisma.c.findMany(args);\nawait prisma.d.findMany({ where: {} });")).counts; return [reconcile(c), c.list]; })(), [true, 4]);
  push('N10 阳性对照：注入的一枚无界读必须被点名（尺不许永远通过）', candidates(run(F("await prisma.t.findMany({ where: { a: 1 }, orderBy: { b: 'x' } });")).rows).length, 1);
  push('N11 括号配不上的要落成计数，不许静默当没有', run('prisma.user.findMany({ ').counts.unbalanced, 1);
  push('N12 多枚混排：桶各归各，候选数只数真候选', (() => { const r = run(F("await prisma.a.findMany();\nawait prisma.b.findMany({ take: 5 });\nawait prisma.c.count();\nawait prisma.d.findMany({ where: {} });")); return [candidates(r.rows).length, r.counts.bounded, r.counts.notList]; })(), [2, 1, 1]);
  const nums = out.map((o) => Number(/^N(\d+)/.exec(o.name)?.[1] ?? 0));
  const seq = Math.max(...nums) === 12 && new Set(nums).size === 12;
  for (const o of out) console.log(`${o.ok ? '✅' : '🔴'} ${o.name}${o.ok ? '' : `  得到=${JSON.stringify(o.got)} 期望=${JSON.stringify(o.want)}`}`);
  console.log(`${seq ? '✅' : '🔴'} N12b 臂号连续（12 枚主臂：去重 ${new Set(nums).size}）`);
  const bad = out.filter((o) => !o.ok).length + (seq ? 0 : 1);
  console.log(`臂 ${out.length + 1} 枚，不符 ${bad}`);
  return bad === 0 ? 0 : 1;
}

/** 在内存里的真源码上加减 `take`，两个方向都必须动 ⇒ 证"这尺会红"。 */
function mutate(files, read) {
  // 每一枚命中都自带它的文件与文本：先前只把 file/text 存在闭包变量里，
  // 第二次 find() 把第一次的那对覆盖了 ⇒ 拿 A 文件的行号去 B 文件里找括号，必然打空。
  const find = (want) => {
    for (const f of files) {
      const t = safeRead(f, read);
      const hit = scanText(f, t).rows.find((x) => x.bucket === want);
      if (hit) return { file: f, text: t, hit };
    }
    return null;
  };
  const base = scanFiles(files, read);
  const n0 = candidates(base.rows).length;
  const c0 = find('objectNoBound');
  const b0 = find('bounded');
  if (!c0 || !b0) { console.log(`🔴 分母里缺形状（无界候选=${!!c0}，有界=${!!b0}）⇒ 变异臂打空，不判绿。`); return 1; }
  // 补/摘 take 都必须**落在被点名的那一枚调用上**：整份文件里正则替换会改到别的调用，
  // 那种"变化了"的读数证明不了本尺对这一格敏感（臂 N3 那一发就是插错位置造出 `({ take: 50, {` 的坏形状）。
  const callAt = (t, line) => {
    const p = t.indexOf('findMany(', lineOfOffset(t, line));
    if (p < 0) return -1;
    return t.indexOf('{', p + 'findMany('.length - 1);
  };
  const brace = callAt(c0.text, c0.hit.line);
  if (brace < 0) { console.log(`🔴 定位不到 ${c0.file}:${c0.hit.line} 那枚实参的对象开括号 ⇒ 变异臂打空，不判绿。`); return 1; }
  const plusTake = `${c0.text.slice(0, brace + 1)} take: 50,${c0.text.slice(brace + 1)}`;
  const d1 = candidates(scanFiles(files, (f) => (f === c0.file ? plusTake : safeRead(f, read))).rows).length - n0;
  const brace2 = callAt(b0.text, b0.hit.line);
  const end2 = brace2 < 0 ? null : balanced(b0.text, brace2);
  if (end2 === null) { console.log(`🔴 定位不到 ${b0.file}:${b0.hit.line} 的实参括号 ⇒ 变异臂打空，不判绿。`); return 1; }
  const span = b0.text.slice(brace2, end2.end + 1);
  const strippedSpan = span.replace(/,?\s*\btake:\s*[^,{}]+/, '');
  if (strippedSpan === span) { console.log(`🔴 摘 take 没摘掉任何东西（${b0.file}:${b0.hit.line} 的形状不认）⇒ 变异臂打空，不判绿。`); return 1; }
  const stripped = `${b0.text.slice(0, brace2)}${strippedSpan}${b0.text.slice(end2.end + 1)}`;
  const d2 = candidates(scanFiles(files, (f) => (f === b0.file ? stripped : safeRead(f, read))).rows).length - n0;
  console.log(`基线候选 ${n0} 枚｜给 ${c0.file}:${c0.hit.line} 补 take ⇒ 变化 ${d1}（期望 -1）｜从 ${b0.file}:${b0.hit.line} 摘 take ⇒ 变化 ${d2}（期望 +1）`);
  if (d1 !== -1 || d2 !== 1) { console.log('🔴 本尺对"行数有没有钉住"不敏感 ⇒ 拿它当门是假绿。'); return 1; }
  console.log('✅ 变异臂：两个方向都动，且各只动被点名的那一枚。');
  return 0;
}

const safeRead = (f, read) => { try { return read(f); } catch { return ''; } };
function lineOfOffset(text, line) {
  let n = 1; let i = 0;
  for (; i < text.length && n < line; i += 1) if (text[i] === '\n') n += 1;
  return i;
}

// 🔴 自测与主读都必须挂在"自己是入口文件"上：挂在模块顶层会被 import 触发，
//    消费方一 import 本尺就先跑一遍臂并 process.exit（同一族见过两次，教训在台账 §6.121）。
const isMain = (() => { try { return import.meta.url === pathToFileURL(process.argv[1] ?? '').href; } catch { return false; } })();
if (isMain) {
    const argv = process.argv.slice(2);
    if (argv.includes('--self-test')) process.exit(selfTest());
    const scopeI = argv.indexOf('--scope');
    const scope = scopeI < 0 ? '' : argv[scopeI + 1];
    const topI = argv.indexOf('--top');
    const top = topI < 0 ? MAX_LIST : Number(argv[topI + 1]);
    const strict = argv.includes('--strict');
    const useWorktree = argv.includes('--worktree');
    const files = git(['ls-tree', '-r', '--name-only', 'HEAD']).split('\n').filter((f) => SCOPE_RE.test(f)).filter((f) => !scope || f.startsWith(scope));
    const read = useWorktree ? (f) => readFileSync(f, 'utf8') : (f) => git(['show', `HEAD:${f}`]);
    if (argv.includes('--mutate')) process.exit(mutate(files, read));
    if (files.length === 0) { console.log('🔴 分母为空：HEAD 里一枚射程内的源文件都没列出 ⇒ 本尺没干活，不许读成"没有无界读"。'); process.exit(2); }
    const { rows, counts } = scanFiles(files, read);
    if (!reconcile(counts)) { console.log(`🔴 分母对不上账：列表读 ${counts.list} ≠ 各桶之和 ${counts.unbounded + counts.bounded + counts.spreadOrVar + counts.unbalanced} ⇒ 有桶在漏，读数不可信。`); process.exit(2); }
    const cand = candidates(rows);
    console.log(
      `无界列表读探针 ｜ 分母 ${counts.files} 枚文件（读不到 ${counts.unreadable}）｜ 列表读 ${counts.list} 枚` +
        `（候选 ${counts.unbounded} ｜ 有界 ${counts.bounded} ｜ 判不了 ${counts.spreadOrVar} ｜ 配不上 ${counts.unbalanced}）` +
        `｜ 非行列表 ${counts.notList} 枚不判 ｜ raw SQL ${counts.rawOut} 枚射程外`,
    );
    console.log(
      '  · 射程声明：A 档=Prisma 行列表读；raw SQL 要解析 WHERE 谓词才知有没有界（本尺没有那能力）、' +
        '客户端与 HTTP 层的分页参数是另一套写法 ⇒ **这两族都没量**，"没有无界读"这句不许由本尺的 0 候选得出。',
    );
    for (const c of cand.slice(0, top)) {
      console.log(`   ${c.bucket === 'noArgs' ? '🔴' : '🟠'} ${c.file}:${c.line} ${c.bucket === 'noArgs' ? 'findMany 一枚参数都没有（整张表）' : '参数对象顶层没有 take/skip/cursor'}`);
    }
    if (cand.length > top) console.log(`   …另有 ${cand.length - top} 枚（加 --top 500 全列）`);
    const und = rows.filter((r) => ['dynamicArg', 'spreadArg', 'unbalanced'].includes(r.bucket));
    if (und.length > 0) {
      console.log(`\n要人眼看的（判不了那一族，${und.length} 枚，逐枚带位置）：`);
      for (const u of und.slice(0, top)) console.log(`   ${u.file}:${u.line} ${u.bucket}`);
    }
    console.log(`\n候选 ${cand.length} 枚${strict ? '' : '｜诊断尺默认退 0，加 --strict 才判红'}`);
    process.exit(strict && cand.length > 0 ? 1 : 0);
}
