#!/usr/bin/env node
/**
 * 失败分支有没有回执的探针（注册登录标准套件线，2026-10-29）
 * ============================================================
 *
 * 目标第 3 件第 ④/⑤ 维交叉的那一格：**catch 到底做没做一件用户看得见的事**。
 * 仓里已有的两枚不覆盖这里：`check-safe-error-fallbacks.mjs` 管的是"服务端一句话被兜底句顶掉"，
 * `check-undo-receipt.mjs` 管的是"带撤销动作的回执计时器只许一份"（P3），都不是这个形状。
 *
 * 六桶（每一枚 catch 恰好落一桶，且**相加必须等于 catch 总数** —— 见下面的分母自证）：
 *   throw        重新抛出 ⇒ 处置在调用方，本尺不判
 *   receipt      写了用户可见的回执（`*Notice(`、`*Toast(`、`*Banner(`、`setFeedback`、`setError`、`setAlert`）
 *   consoleOnly  🟠 只 `console.*` —— 日志有人看得到，用户看不到
 *   empty        🔴 什么都不做
 *   commentOnly  只剩注释 ⇒ 落"要人看"那一档（作者可能正是有意吞，但文本尺读不出意图，不许算成"有处置"）
 *   otherState   设了一个 `setXxx` 状态却没碰回执词表 ⇒ 判不了（也许别处渲染这个 state）
 *   other        有别的语句 ⇒ 判不了
 *
 * 🔴 两格防"永远通过"：
 *   ① **视力检查**：回执词表在真代码里命中 0 处 ⇒ 这把尺是瞎的，退出 2，不许读成"没有静默失败"；
 *   ② 分母自证：六桶相加 ≠ catch 总数 ⇒ 有一档被静默吞掉，本趟读数作废退出 2。
 *
 * 用法：node research/tools/audit-silent-failure-branch.mjs [--strict] [--self-test] [--mutate] [--scope 前缀] [--top N]
 * 退出：0 = 只报读数；1 = --strict 且有 🔴/🟠 候选，或 --mutate 有形状打空；2 = 分母为空 / 瞎 / 对账不成立
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
const unknown = argv.filter(
  (a, i) =>
    !['--strict', '--self-test', '--mutate'].includes(a) &&
    a !== '--top' &&
    a !== '--scope' &&
    !(i > 0 && (argv[i - 1] === '--top' || argv[i - 1] === '--scope')),
);

// 只吃客户端外壳：服务端的错误形状另有两把尺管，混进来只会把候选冲成噪声。
const SCOPE_RE = /^apps\/[^/]+\/src\/.*\.(ts|tsx)$/;
const CATCH_RE = /\bcatch\b\s*(?:\([^)]*\))?\s*\{/g;
// 🔴 词表分两枚：带 g 的那枚只用于数命中（`.match`），判定必须用**不带 g** 的那枚 ——
//    带 g 的正则 `.test()` 会推进 lastIndex，第二枚 catch 就从中间开始找，读出一串假静默
//    （Q4 过而 Q5 红，就是这么现形的）。
// 🔴 词表里也不许留永不命中的死词目：`aria-live` 曾经在里面，但遮蔽把字符串整个挖掉，
//    属性**值**里的它永远看不见 ⇒ 一条永不红目的词表等于把这把尺关掉。
// 词表认的是**调用形状**：后面必须紧跟左括号。写成可选时一个裸标识符 `Notice`（类型名、变量名）也算回执
//   ⇒ 那一档会变成永远绿。前缀仍然放开（`setNotice` / `pushNotice` / `showNotice` 是同一族 API）。
const RECEIPT_SRC = '(?:Notice|Toast|Banner|Snackbar|setFeedback|setError|setFailure|setAlert)\\s*\\(';
const RECEIPT_TEST = new RegExp(RECEIPT_SRC);
const RECEIPT_RE = new RegExp(RECEIPT_SRC, 'g');
const CONSOLE_RE = /^[\s;]*(?:console\.\w+\s*\([\s\S]*?\)\s*;?[\s]*)+$/;
const THROW_RE = /(?<![\w$.])throw[\s(]/;
const SETSTATE_RE = /(?:^|[^.\w$])(?:set|patch)[A-Z]\w*\s*\(/;

/** 一份文件里每一枚 catch 的落桶结果。 */
export function scanFile(file, raw) {
  const masked = maskText(raw);
  const rows = [];
  CATCH_RE.lastIndex = 0;
  let m;
  while ((m = CATCH_RE.exec(masked)) !== null) {
    const body = balanced(masked, m.index + m[0].length - 1);
    if (body === null) { rows.push({ file, line: lineOf(masked, m.index), bucket: 'unbalanced' }); continue; }
    const b = body.inner;
    const rawBody = raw.slice(m.index + m[0].length, body.end);
    let bucket;
    if (THROW_RE.test(b)) bucket = 'throw';
    else if (b.trim() === '') bucket = rawBody.trim() === '' ? 'empty' : 'commentOnly';
    else if (RECEIPT_TEST.test(b)) bucket = 'receipt';
    else if (CONSOLE_RE.test(b)) bucket = 'consoleOnly';
    else if (SETSTATE_RE.test(b)) bucket = 'otherState';
    else bucket = 'other';
    rows.push({ file, line: lineOf(masked, m.index), bucket, at: m.index + m[0].length, to: body.end });
  }
  return rows;
}

const CANDIDATE = new Set(['empty', 'consoleOnly']);

export function summarize(rows) {
  const by = {};
  for (const r of rows) by[r.bucket] = (by[r.bucket] ?? 0) + 1;
  return {
    by,
    total: rows.length,
    cand: rows.filter((r) => CANDIDATE.has(r.bucket)),
    needEye: rows.filter((r) => r.bucket === 'commentOnly' || r.bucket === 'otherState' || r.bucket === 'other' || r.bucket === 'unbalanced'),
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
  const one = (t) => scanFile('x.tsx', t)[0]?.bucket;
  const C = (body) => `const h = async () => { try { await api(); } catch (e) { ${body} } };`;

  push('Q1 空 catch ⇒ empty（🔴 候选）', one(C('')), 'empty');
  push('Q2 只 console ⇒ consoleOnly（🟠 候选）', one(C('console.warn("x", e);')), 'consoleOnly');
  push('Q3 重新抛出 ⇒ throw，不算候选（处置在调用方）', one(C('throw e;')), 'throw');
  push('Q4 写了 Notice 类回执 ⇒ receipt', one(C('setNotice({ tone: "error" });')), 'receipt');
  push('Q5 setError 也算回执', one(C('setError("失败");')), 'receipt');
  push('Q6 词表每一条都必须真能命中（死词目等于给这把尺装瞎）',
    ['setNotice(', 'showToast(', 'setBanner(', 'pushSnackbar(', 'setFeedback(', 'setError(', 'setFailure(', 'setAlert(']
      .map((call) => one(C(`${call}x);`))),
    ['receipt', 'receipt', 'receipt', 'receipt', 'receipt', 'receipt', 'receipt', 'receipt']);
  push('Q7 只剩注释的 catch ⇒ commentOnly（要人看，不许算成有处置；注意闭括号必须换行，写在注释同一行会被遮蔽一起挖掉 —— 那是夹具的形状，不是尺的洞）',
    one(C('// setNotice(x)\n')), 'commentOnly');
  push('Q14 真正的空 catch 与只剩注释的那两档要分得开',
    [one(C('')), one(C('/* 有意吞掉 */\n'))], ['empty', 'commentOnly']);
  push('Q8 设了别的 state 但没碰词表 ⇒ otherState（判不了，不许算成有处置）', one(C('setBusy(false);')), 'otherState');
  push('Q9 catch 类型注解里带括号不许骗过配对', scanFile('y.ts', 'try { a(); } catch (e: unknown) { setNotice(1); }')[0].bucket, 'receipt');
  push('Q10 变异臂：把 Q4 那枚的回执调用换成一个词表外的名字 ⇒ 必须不再读成 receipt',
    // 抹的不是前缀而是整个 token —— 词表认的是子串 + 调用形状，只改前缀（`zzNotice(`）仍然会命中。
    [one(C('setNotice({ tone: "error" });')), one(C('zzTone({ tone: "error" });'))], ['receipt', 'other']);
  push('Q11 对账成立：各桶相加 = catch 总数',
    (() => { const rows = scanFile('z.tsx', C('') + '\n' + C('console.log(e);') + '\n' + C('throw e;')); const s = summarize(rows); return s.total === 3 && s.cand.length === 2; })(), true);
  push('Q12 空分母 ⇒ 聚合给全 0（主读数据此退 2）', summarize([]).total, 0);
  push('Q13 --scope 只吃目录前缀', applyScope(['apps/web/src/a.tsx', 'apps/webish/b.ts'], 'apps/web/src').length, 1);
  const nums = labels.map((l) => Number(/^Q(\d+)/.exec(l)?.[1] ?? 0));
  const seqOk = Math.max(...nums) === labels.length && new Set(nums).size === labels.length;
  console.log(`${seqOk ? '✅' : '🔴'} Q15 臂编号连续且不重号（判的是上面 ${labels.length} 枚：最大号 ${Math.max(...nums)} ｜ 去重 ${new Set(nums).size}）`);
  if (!seqOk) bad.push(`Q15 臂编号跳号或重号 ｜ 最大 ${Math.max(...nums)} ｜ 条数 ${labels.length}`);
  console.log(`\n臂数 ${labels.length + 1} ｜ 不符 ${bad.length}`);
  for (const b of bad) console.log(`🔴 ${b}`);
  process.exit(bad.length === 0 ? 0 : 1);
}

const scope = applyScope(scopeFiles(), SCOPE);
if (scope.length === 0) {
  console.error('🔴 分母为空：HEAD 里一枚射程内的客户端源文件都没列出 ⇒ 本尺没干活，不许读成"没有静默失败"');
  process.exit(2);
}
const rows = [];
let unreadable = 0;
let receiptHits = 0;
for (const f of scope) {
  try {
    const raw = readFileSync(path.join(ROOT, f), 'utf8');
    const masked = maskText(raw);
    RECEIPT_RE.lastIndex = 0;
    receiptHits += (masked.match(RECEIPT_RE) ?? []).length;
    rows.push(...scanFile(f, raw));
  } catch {
    unreadable += 1;
  }
}
const s = summarize(rows);
if (s.total === 0) {
  console.error('🔴 阳性对照不成立：射程内一枚 catch 都没找到 ⇒ 判法失效，不许读成"没有静默失败"');
  process.exit(2);
}
if (receiptHits === 0) {
  console.error('🔴 视力检查不成立：回执词表在真代码里命中 0 处 ⇒ 这把尺是瞎的，它的"0 候选"没有意义');
  process.exit(2);
}
const bucketSum = Object.values(s.by).reduce((a, b) => a + b, 0);
if (bucketSum !== s.total) {
  console.error(`🔴 分母自证不成立：各桶 ${bucketSum} ≠ catch 总数 ${s.total} ⇒ 有一档被静默吞掉，本趟读数作废`);
  process.exit(2);
}

if (mutate) {
  // 🔴 台架要证的是两件事，前一版一件都没证到（它比的是"候选数变了没"，而抹掉回执只会把那一枚
  //    从 receipt 挪到 other —— 候选数不动，于是报了个假的"没牙"）：
  //    S1 造一枚**空的** catch ⇒ 候选必须 +1（尺能认出静默吞）；
  //    S2 把一枚真回执的调用名换掉 ⇒ receipt 必须 -1（尺认的确实是回执）。
  const lines = [];
  let hit = 0;
  let miss = 0;
  const files = [];
  for (const f of scope) {
    try { files.push({ file: f, text: readFileSync(path.join(ROOT, f), 'utf8') }); } catch { /* 主读数那一路已计 */ }
  }
  const first = files.find((h) => /try\s*\{/.test(h.text));
  if (first) {
    const base = summarize(scanFile(first.file, first.text));
    const injected = `${first.text}\nasync function __probe_injection() { try { await doThing(); } catch (e) { }\n`;
    const after = summarize(scanFile(first.file, injected));
    if (after.cand.length === base.cand.length + 1) { hit += 1; lines.push(`  ✅ S1 在 ${first.file} 的副本里插一枚空 catch ⇒ 候选 ${base.cand.length} → ${after.cand.length}`); }
    else { miss += 1; lines.push(`  🔴 S1 插了空 catch 候选没动（${base.cand.length} → ${after.cand.length}）⇒ 这一档判据没牙`); }
  } else { miss += 1; lines.push('  🔴 S1 找不到含 try 的宿主文件'); }
  const hostRow = (() => {
    for (const h of files) {
      const r = scanFile(h.file, h.text).find((x) => x.bucket === 'receipt');
      if (r) return { ...r, text: h.text };
    }
    return null;
  })();
  if (hostRow) {
    const base = summarize(scanFile(hostRow.file, hostRow.text));
    const excised = hostRow.text.slice(0, hostRow.at) + ' void probe;' + hostRow.text.slice(hostRow.to);
    const after = summarize(scanFile(hostRow.file, excised));
    if ((after.by.receipt ?? 0) === base.by.receipt - 1) { hit += 1; lines.push(`  ✅ S2 把 ${hostRow.file}:${hostRow.line} 那枚回执整个换掉 ⇒ receipt ${base.by.receipt} → ${after.by.receipt ?? 0}`); }
    else { miss += 1; lines.push(`  🔴 S2 换掉回执后 receipt 桶没按预期降（${base.by.receipt} → ${after.by.receipt ?? 0}）⇒ 词表其实没在认回执`); }
  } else { miss += 1; lines.push('  🔴 S2 找不到有回执 catch 的宿主文件'); }
  console.log(`变异台架（只在内存副本上插/改，一个字节都不写盘）｜ 证到的形状 ${hit} / 2 ｜ 打空 ${miss}`);
  for (const l of lines) console.log(l);
  process.exit(miss > 0 || hit < 2 ? 1 : 0);
}

console.log(
  `失败分支回执探针 ｜ 分母 ${scope.length} 枚客户端文件${SCOPE ? `（已按 --scope ${SCOPE} 收窄）` : ''}` +
    `（工作树里脏的 ${dirtyScope(scope).length} 枚）｜ catch ${s.total} 枚（读不到正文 ${unreadable} 枚文件）｜ 回执词表命中 ${receiptHits} 处`,
);
console.log(
  `  各桶：${Object.entries(s.by).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(' ｜ ')}`,
);
console.log(`  🔴/🟠 候选 ${s.cand.length} 枚 ｜ 要人眼看的（判不了那一族）${s.needEye.length} 枚`);
if (s.cand.length > 0) {
  console.log(`\n候选（列前 ${Math.min(TOP, s.cand.length)} 枚）：`);
  for (const r of s.cand.slice(0, TOP)) console.log(`   ${r.bucket === 'empty' ? '🔴' : '🟠'} ${r.file}:${r.line}  ${r.bucket === 'empty' ? 'catch 里什么都不做' : 'catch 里只有 console.*'}`);
} else {
  console.log('\n✅ 没有 🔴/🟠 档候选');
}
if (strict && s.cand.length > 0) process.exit(1);
