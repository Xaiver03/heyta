#!/usr/bin/env node
/**
 * 循环内查库与同步 IO 的探针（注册登录标准套件线，2026-10-29）
 * ============================================================
 *
 * 目标第 3 件第 ③ 维点名的"实际性能问题"里，"N+1"与"循环里同步 IO"这两半此前只有散文结论、
 * 没有整树分母。这一台把它们变成可复量的候选清单。它报**候选**，一字节不改：
 * 循环里的第几行查库、包的那层循环是不是真按行跑，都要人开码看第二遍。
 *
 * 两档形状：
 *   🟠 A 档「循环里逐行查库」：`for (…) {{ … prisma.<model>.findX … }}`、`while`、`for await`、
 *      以及 `.forEach(` / `.map(` 这类**每行调一次回调**的写法里出现查库。
 *   🟠 B 档「异步路径里的同步 IO」：`async` 函数体（或任意循环体）里出现 `*Sync(` 系列的
 *      fs / crypto / child_process 调用 —— 它会把整个进程的事件循环钉住，同一次请求里的
 *      其它连接只能排队。
 *
 * 🔴 四格必须显式落成"未判定"或"跳过"并**报条数**，静默跳过就是把"没看到"记成"没有"：
 *   ① 动态模型名（`prisma[name].findMany`）—— 文本尺不知道那是什么表；
 *   ② 循环体括号配不上（未闭合模板串等）；
 *   ③ 查库调用是**批量形状**（`where: { id: { in: … } }`、`createMany`、`updateMany`、`deleteMany`）
 *      —— 那本来就该写在循环外，出现 `in:` 说明作者已经收过一遍，不算 N+1，单列计数；
 *   ④ 同步 IO 落在**非 async、非循环**的位置（模块顶层、CLI 脚本里）—— 那里阻塞的是启动过程，
 *      与"把在线请求的事件循环钉住"不是同一件事 ⇒ 单列计数、不进候选。
 *
 * 分母自证（这台尺自己的牙）：每一枚目标调用点要么在循环里、要么不在，两半相加必须等于
 * 正则在这一趟文本里命中的总数 —— 对不上就整趟作废退出 2。本线在同一天里被"静默少一档"
 * 咬过两次（监听器那把尺把 275 处 effect 读成 77 处），所以这一条写在主读数量而不只写在臂里。
 *
 * 用法：node research/tools/audit-loop-io.mjs [--strict] [--self-test] [--mutate] [--scope 前缀] [--top N]
 * 退出：0 = 只报读数；1 = --strict 且有候选 / --mutate 有形状打空；2 = 分母为空、一枚都没判成、或对账不成立
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { balanced, lineOf, maskText } from './lib/text-mask.mjs';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const argv = process.argv.slice(2);
const strict = argv.includes('--strict');
const selfTest = argv.includes('--self-test');
const mutate = argv.includes('--mutate');
const topIv = argv.indexOf('--top');
const TOP = topIv >= 0 && /^\d+$/.test(argv[topIv + 1] ?? '') ? Number(argv[topIv + 1]) : 20;
const scopeIv = argv.indexOf('--scope');
const SCOPE = scopeIv >= 0 ? argv[scopeIv + 1] ?? '' : '';
if (topIv >= 0 && !/^\d+$/.test(argv[topIv + 1] ?? '')) {
  console.error('🔴 --top 后面要跟一个非负整数');
  process.exit(1);
}
if (scopeIv >= 0 && (SCOPE.length === 0 || SCOPE.startsWith('-'))) {
  console.error('🔴 --scope 后面要跟一个目录前缀（例：--scope server/src/password）');
  process.exit(1);
}
const unknown = argv.filter(
  (a, i) =>
    !['--strict', '--self-test', '--mutate'].includes(a) &&
    a !== '--top' &&
    a !== '--scope' &&
    !(i > 0 && (argv[i - 1] === '--top' || argv[i - 1] === '--scope')),
);

const SCOPE_RE = /^((apps|packages)\/[^/]+\/src\/.*\.(ts|tsx)|server\/src\/.*\.ts)$/;
// 循环与"每行调一次回调"的写法。`for await` 也在这一族：逐条 await 就是逐行查库。
const LOOP_RE = /\b(?:for\s+(?:await\s+)?\(?|while\s*\(|do\s*\{)|\.(?:forEach|map|filter|some|every|flatMap)\s*\(/g;
// 查库的形状：prisma 与仓里自定义的 db/repo 句柄上的读类方法。`in:` 这类批量形状单独认。
const DB_VERBS = 'findMany|findFirst|findFirstOrThrow|findUnique|findUniqueOrThrow|count|aggregate|groupBy|create|createMany|update|updateMany|delete|deleteMany';
const QUERY_RE = new RegExp(`\\b(?:prisma\\s*\\.\\s*(?:[a-zA-Z_$][\\w$]*\\s*\\.\\s*)?(${DB_VERBS})|[a-zA-Z_$][\\w$]*(?:Repo|Store|Dao)\\s*\\.\\s*(${DB_VERBS}))\\s*\\(`, 'g');
// 句柄名像仓储、方法名却是通用取物（Map、密钥库、内存缓存）⇒ 这一类判不了，单列计数：
// 既不算候选，也不许静默当成「没有」。第一发就是把「ai/routing.ts 里的 secretStore.get」当成了查库。
const AMBIGUOUS_RE = /\b[a-zA-Z_$][\w$]*(?:Repo|Store|Dao)\s*\.\s*(?:query|get|all)\s*\(/g;
const BULK_RE = /\b(?:createMany|updateMany|deleteMany|upsert)\s*\(|\{\s*in\s*:/g;
const SYNC_IO_RE = /\b(?:readFileSync|writeFileSync|appendFileSync|copyFileSync|existsSync|readdirSync|statSync|lstatSync|mkdirSync|rmSync|unlinkSync|renameSync|chmodSync|execSync|execFileSync|spawnSync|fork)\s*\(/g;
const DYNAMIC_MODEL_RE = /\bprisma\s*\[/g;

/** 认循环与"每行调一次回调"。返回每一层的**归属区间** [start,end]：
 *  · `for` / `while` / `do` ⇒ 取它的花括号体（循环头里的调用只求值一次，不算逐行）；
 *  · `.forEach(` / `.map(` 这类 ⇒ 取整个实参区间（回调体在里面，表达式体也在里面）。 */
export function findLoops(text) {
  const loops = [];
  const unmatched = [];
  LOOP_RE.lastIndex = 0;
  let m;
  while ((m = LOOP_RE.exec(text)) !== null) {
    const tok = m[0].trim();
    if (tok.startsWith('do')) {
      const bodyStart = text.indexOf('{', m.index);
      if (bodyStart < 0) continue;
      const body = balanced(text, bodyStart);
      if (body === null) { unmatched.push({ at: m.index }); continue; }
      loops.push({ kind: 'do', start: bodyStart, end: body.end, inner: body.inner, head: '' });
      continue;
    }
    const open = text.indexOf('(', m.index + tok.length - 1);
    if (open < 0) continue;
    const head = balanced(text, open);
    if (head === null) { unmatched.push({ at: m.index }); continue; }
    if (tok.startsWith('.')) {
      loops.push({ kind: tok, start: open, end: head.end, inner: head.inner, head: head.inner });
      continue;
    }
    // 🔴 head.end 就是那枚 `)" 本身 ⇒ 必须从 +1 起看（同一枚 off-by-one 在另一把尺上刚踩过一次）
    const bodyStart = /^\s*\{/.test(text.slice(head.end + 1)) ? text.indexOf('{', head.end + 1) : -1;
    if (bodyStart < 0) continue;
    const body = balanced(text, bodyStart);
    if (body === null) { unmatched.push({ at: m.index }); continue; }
    loops.push({ kind: tok, start: bodyStart, end: body.end, inner: body.inner, head: head.inner });
  }
  return { loops, unmatched };
}

const inWhich = (loops, idx) => loops.filter((l) => idx > l.start && idx < l.end).map((l) => l.kind);

/** 一份文件的两档候选 + 各档"跳过/未判定"计数。 */
export function scanFile(file, raw) {
  const text = maskText(raw);
  const { loops, unmatched: unmatchedLoops } = findLoops(text);
  const unmatched = unmatchedLoops.map((u) => ({ file, line: lineOf(text, u.at) }));
  const out = {
    file,
    loopCount: loops.length,
    unmatched: unmatched.length,
    unmatchedAt: unmatched,
    dynamicModel: (text.match(DYNAMIC_MODEL_RE) ?? []).length,
    bulk: 0,
    queriesTotal: 0,
    queriesInLoop: 0,
    queriesOutside: 0,
    syncTotal: 0,
    syncInLoop: 0,
    syncOutsidePlain: 0,
    ambiguous: 0,
    boundedRetry: 0,
    rows: [],
  };
  QUERY_RE.lastIndex = 0;
  let m;
  while ((m = QUERY_RE.exec(text)) !== null) {
    out.queriesTotal += 1;
    const hit = inWhich(loops, m.index);
    // 有界计数重试（for (let i = 0; i < 5; i += 1)）不是「每一行跑一次」，是「最多跑 N 次」。
    // server/src/activity/invite.ts 的 get-or-create 就是这个形状：混进候选只会让人把这把尺关掉。
    if (hit.length > 0 && loops.some((l) => l.kind.startsWith('for') && /\w\s*<\s*\d+\s*;/.test(l.head ?? ''))) { out.boundedRetry += 1; continue; }
    BULK_RE.lastIndex = 0;
    const nearBulk = BULK_RE.test(text.slice(m.index, m.index + 160));
    if (hit.length === 0) { out.queriesOutside += 1; continue; }
    if (nearBulk) { out.bulk += 1; continue; }
    out.queriesInLoop += 1;
    out.rows.push({ kind: 'A', file, line: lineOf(text, m.index), method: m[1], loop: hit.join('|') });
  }
  out.ambiguous = (text.match(AMBIGUOUS_RE) ?? []).length;
  SYNC_IO_RE.lastIndex = 0;
  while ((m = SYNC_IO_RE.exec(text)) !== null) {
    out.syncTotal += 1;
    const hit = inWhich(loops, m.index);
    if (hit.length > 0) {
      out.syncInLoop += 1;
      out.rows.push({ kind: 'B', file, line: lineOf(text, m.index), method: '循环内同步 IO', loop: hit.join('|') });
      continue;
    }
    // 不在循环里：只有落在 async 函数体里才算候选（模块顶层与 CLI 那一档另列）。
    const before = text.slice(0, m.index);
    const lastAsync = before.lastIndexOf('async');
    const openBrace = before.lastIndexOf('{');
    const inAsync = lastAsync >= 0 && before.slice(lastAsync, lastAsync + 40).includes('=>');
    if (inAsync && openBrace > lastAsync) {
      out.syncInLoop += 1;
      out.rows.push({ kind: 'B', file, line: lineOf(text, m.index), method: 'async 路径内同步 IO', loop: 'async' });
    } else {
      out.syncOutsidePlain += 1;
    }
  }
  return out;
}

export function summarize(scans) {
  const a = scans.flatMap((s) => s.rows.filter((r) => r.kind === 'A'));
  const b = scans.flatMap((s) => s.rows.filter((r) => r.kind === 'B'));
  const n = (k) => scans.reduce((t, s) => t + s[k], 0);
  return {
    a,
    b,
    loops: n('loopCount'),
    unmatched: n('unmatched'),
    unmatchedAt: scans.flatMap((s) => s.unmatchedAt),
    dynamicModel: n('dynamicModel'),
    bulk: n('bulk'),
    boundedRetry: n('boundedRetry'),
    ambiguous: n('ambiguous'),
    queriesTotal: n('queriesTotal'),
    queriesOutside: n('queriesOutside'),
    syncTotal: n('syncTotal'),
    syncOutsidePlain: n('syncOutsidePlain'),
  };
}

function git(args) {
  const r = spawnSync('git', ['-C', ROOT, ...args], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} 失败：${r.stderr}`);
  return r.stdout;
}

export function applyScope(files, prefix) {
  if (prefix === '') return [...files];
  const p = prefix.endsWith('/') ? prefix : `${prefix}/`;
  return files.filter((f) => f.startsWith(p));
}

export function scopeFiles() {
  return git(['ls-tree', '-r', '--name-only', 'HEAD']).split('\n').filter((f) => SCOPE_RE.test(f)).sort();
}

export function dirtyScope(scope) {
  const inScope = new Set(scope);
  return git(['status', '--porcelain']).split('\n').map((l) => l.slice(3).trim()).filter((f) => inScope.has(f));
}

if (unknown.length > 0) {
  console.error(`🔴 不认的旗标：${unknown.join(' ')} ｜ 只认 --strict / --self-test / --mutate / --scope 前缀 / --top N`);
  process.exit(1);
}

if (selfTest) {
  const bad = [];
  const labels = [];
  const push = (label, got, want) => {
    labels.push(label);
    const ok = JSON.stringify(got) === JSON.stringify(want);
    if (!ok) bad.push(`${label} ｜ 期望 ${JSON.stringify(want)} ｜ 实读 ${JSON.stringify(got)}`);
    console.log(`${ok ? '✅' : '🔴'} ${label}`);
  };
  const S = (t) => scanFile('x.ts', t);

  push('P1 for 里逐行 findUnique ⇒ A 档 1 枚', S('for (const id of ids) { const u = await prisma.user.findUnique({ where: { id } }); }').rows.length, 1);
  push('P2 变异臂：把 P1 那行拆出循环 ⇒ A 档必须归 0',
    S('const us = await prisma.user.findMany({ where: { id: { in: ids } } });').rows.length, 0);
  push('P3 批量形状在循环里 ⇒ 落 bulk 计数、不进候选（作者已经收过一遍）',
    [S('for (const c of chunks) { await prisma.user.createMany({ data: c }); }').rows.length, S('for (const c of chunks) { await prisma.user.createMany({ data: c }); }').bulk],
    [0, 1]);
  push('P4 forEach 这种每行调一次回调也要吃到（只认 for 就是半把尺）', S('rows.forEach((r) => { prisma.user.update({ where: { id: r.id } }); });').rows.length, 1);
  push('P5 while 里查库 ⇒ A 档', S('while (more) { const x = await prisma.job.findFirst({}); }').rows.length, 1);
  push('P6 async 函数里的同步 readFileSync ⇒ B 档', S('const h = async () => { const b = readFileSync(p); return b; };').rows.filter((r) => r.kind === 'B').length, 1);
  push('P7 模块顶层的同步 IO ⇒ 算"另一档"，不许混进 B 候选',
    [S('const cfg = JSON.parse(readFileSync("c.json"));').rows.filter((r) => r.kind === 'B').length, S('const cfg = JSON.parse(readFileSync("c.json"));').syncOutsidePlain],
    [0, 1]);
  push('P8 注释与字符串里的 prisma 调用不算（遮蔽没做就会把文档字符串数成分母）',
    S('// await prisma.user.findUnique({})\nconst s = "prisma.job.count(";\n').queriesTotal, 0);
  push('P9 动态模型名 ⇒ 落成未判定计数，不许静默当没有', S('for (const k of keys) { await prisma[k].findMany({}); }').dynamicModel, 1);
  push('P10 对账成立：循环内 + 循环外 + 批量 = 命中的查库调用总数',
    (() => { const s = S('for (const id of ids) { await prisma.user.findUnique({ where: { id } }); }\nconst y = await prisma.user.count({});'); return s.queriesInLoop + s.queriesOutside + s.bulk === s.queriesTotal; })(),
    true);
  push('P11 嵌套回调里的 prisma 调用不许被外层 forEach 认领两次', S('a.map((x) => b.map((y) => prisma.user.findUnique({ where: { y } })));').rows.length, 1);
  push('P12 空分母 ⇒ 聚合给全 0（主读数据此退 2）', summarize([]).a.length + summarize([]).b.length, 0);
  push('P13 --scope 只吃目录前缀（server 不许把 serverish 算进来）',
    applyScope(['server/src/a.ts', 'serverish/b.ts'], 'server/src').length, 1);
  push('P14 仓储句柄配通用取物（Map、密钥库）⇒ 落「判不了」计数，不许冒充查库候选',
    [S('for (const k of keys) { await secretStore.get(k); }').rows.length, S('for (const k of keys) { await secretStore.get(k); }').ambiguous],
    [0, 1]);
  push('P15 有界计数重试里的查库 ⇒ 落 boundedRetry，不进候选（最多跑 N 次不是每行一次）',
    [S('for (let attempt = 0; attempt < 5; attempt += 1) { await prisma.inviteCode.create({ data: d }); }').rows.length,
      S('for (let attempt = 0; attempt < 5; attempt += 1) { await prisma.inviteCode.create({ data: d }); }').boundedRetry],
    [0, 1]);
  const nums = labels.map((l) => Number(/^P(\d+)/.exec(l)?.[1] ?? 0));
  const seqOk = Math.max(...nums) === labels.length && new Set(nums).size === labels.length;
  console.log(`${seqOk ? '✅' : '🔴'} P16 臂编号连续且不重号（判的是上面 ${labels.length} 枚：最大号 ${Math.max(...nums)} ｜ 去重 ${new Set(nums).size}）`);
  if (!seqOk) bad.push(`P16 臂编号跳号或重号 ｜ 最大 ${Math.max(...nums)} ｜ 条数 ${labels.length}`);
  console.log(`\n臂数 ${labels.length + 1} ｜ 不符 ${bad.length}`);
  for (const b of bad) console.log(`🔴 ${b}`);
  process.exit(bad.length === 0 ? 0 : 1);
}

const scope = applyScope(scopeFiles(), SCOPE);
if (scope.length === 0) {
  console.error('🔴 分母为空：HEAD 里一枚射程内的源文件都没列出 ⇒ 本尺没干活，不许读成"没有 N+1"');
  process.exit(2);
}
const scans = [];
let unreadable = 0;
let naiveQueries = 0;
let naiveSync = 0;
for (const f of scope) {
  try {
    const raw = readFileSync(path.join(ROOT, f), 'utf8');
    const masked = maskText(raw);
    naiveQueries += (masked.match(QUERY_RE) ?? []).length;
    naiveSync += (masked.match(SYNC_IO_RE) ?? []).length;
    scans.push(scanFile(f, raw));
  } catch {
    unreadable += 1;
  }
}
const s = summarize(scans);
if (s.loops === 0) {
  console.error('🔴 阳性对照不成立：射程内一枚循环都没认出来 ⇒ 判法失效，不许读成"循环里没有查库"');
  process.exit(2);
}
// 🔴 站点级分母自证（P10 那一枚的整树版本）：漏掉任何一档都会在这里现形，而不是读成"干净"。
if (s.queriesTotal !== naiveQueries || s.syncTotal !== naiveSync) {
  console.error(`🔴 分母自证不成立：查库 ${s.queriesTotal} vs 命中 ${naiveQueries} ｜ 同步 IO ${s.syncTotal} vs 命中 ${naiveSync} ⇒ 有一档被静默吞掉，本趟读数作废`);
  process.exit(2);
}

if (mutate) {
  // 敏感度：在**内存副本**上把一枚独立语句包进循环 ⇒ A 档候选必须 +1；再拆回来 ⇒ 必须回到基线。
  // 只在真文件的真实文本上做，一个字节都不写盘（共享检出里不做原地变异）。
  const host = scans.length > 0 ? scope.find((f) => {
    const t = maskText(readFileSync(path.join(ROOT, f), 'utf8'));
    return /\bawait\s+[\w$.]+\.(?:findMany|findFirst|findUnique|count)\s*\(/.test(t) && !/\bfor\s*\(/.test(t);
  }) : null;
  const lines = [];
  let hit = 0;
  let miss = 0;
  let noHost = 0;
  if (!host) {
    noHost += 1;
    lines.push('  · 无宿主：没找到"外面没有 for、里面有 await 查库"的真文件，改在合成件上证');
    const base = scanFile('m.ts', 'const y = await prisma.user.count({});').rows.length;
    const wrapped = scanFile('m.ts', 'for (const id of ids) { const y = await prisma.user.count({}); }').rows.length;
    if (base === 0 && wrapped === 1) { hit += 1; lines.push('  ✅ 合成件：同一句包进 for ⇒ 候选从 0 变 1'); }
    else lines.push(`  🔴 合成件对不上（${base} → ${wrapped}，应为 0 → 1）`);
  } else {
    const t = readFileSync(path.join(ROOT, host), 'utf8');
    const base = summarize([scanFile(host, t)]).a.length;
    const at = maskText(t).search(/\b(?:const|let)\s+[\w$]+\s*=\s*await\s/);
    if (at < 0) { noHost += 1; lines.push(`  · ${host} 里取不到可包的那枚语句起点，本趟没证这一档`); }
    else {
      const stmtEnd = t.indexOf(';', at);
      const stmt = t.slice(at, stmtEnd + 1);
      const wrapped = t.slice(0, at) + `for (const __m of [1]) { ${stmt} }` + t.slice(stmtEnd + 1);
      const after = summarize([scanFile(host, wrapped)]).a.length;
      const unwrapped = summarize([scanFile(host, t)]).a.length;
      if (after > base && unwrapped === base) { hit += 1; lines.push(`  ✅ ${host}：把 "${stmt.slice(0, 42)}…" 包进一层 for ⇒ A 档候选从 ${base} 变 ${after}；拆回来仍是 ${unwrapped}`); }
      else { miss += 1; lines.push(`  🔴 ${host}：包进 for 后候选没变（${base} → ${after}）⇒ 这一档的判据不敏感`); }
    }
  }
  console.log(`变异台架（只在内存副本上包/拆，一个字节都不写盘）｜ 证到的形状 ${hit} ｜ 打空 ${miss} ｜ 无宿主 ${noHost}`);
  for (const l of lines) console.log(l);
  process.exit(miss > 0 || hit === 0 ? 1 : 0);
}

console.log(
  `循环内查库与同步 IO 探针 ｜ 分母 ${scope.length} 枚文件${SCOPE ? `（已按 --scope ${SCOPE} 收窄）` : ''}` +
    `（工作树里脏的 ${dirtyScope(scope).length} 枚，读数含它们）｜ 循环 ${s.loops} 层 ｜ 目标调用点 查库 ${s.queriesTotal} · 同步 IO ${s.syncTotal}`,
);
console.log(
  `  🟠 A 档（循环里逐行查库）${s.a.length} 处 ｜ 🟠 B 档（循环内或 async 路径里同步 IO）${s.b.length} 处` +
    ` ｜ 批量形状 ${s.bulk} 处（不判）｜ 有界计数重试 ${s.boundedRetry} 处（不判）｜ 循环外查库 ${s.queriesOutside} 处（不判）｜ 非 async 且不在循环里的同步 IO ${s.syncOutsidePlain} 处（不判）`,
);
console.log(`  · 判不了：动态模型名 ${s.dynamicModel} 处 ｜ 仓储句柄配通用取物 ${s.ambiguous} 处 ｜ 循环体配不上 ${s.unmatched} 处（${s.unmatchedAt.map((u) => u.file + ':' + u.line).join(' ')}） ｜ 读不到正文 ${unreadable} 枚文件`);
const byFile = new Map();
for (const r of [...s.a, ...s.b]) byFile.set(r.file, (byFile.get(r.file) ?? 0) + 1);
if (byFile.size > 0) {
  console.log(`\n候选（按文件聚合，列前 ${Math.min(TOP, byFile.size)} 枚文件）：`);
  for (const [f, n] of [...byFile].sort((x, y) => y[1] - x[1] || (x[0] < y[0] ? -1 : 1)).slice(0, TOP)) {
    const rows = [...s.a, ...s.b].filter((r) => r.file === f).slice(0, 3);
    console.log(`   🟠 ${f}  ${n} 处 ｜ ${rows.map((r) => `${r.line}行(${r.method},${r.loop})`).join(' ')}`);
  }
} else {
  console.log('\n✅ 没有候选');
}
if (strict && (s.a.length > 0 || s.b.length > 0)) process.exit(1);
