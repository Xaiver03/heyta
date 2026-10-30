#!/usr/bin/env node
/**
 * 跨文件重叠实现的探针（注册登录标准套件线，2026-10-29）
 * ============================================================
 *
 * 目标第 3 件第 ① 维点名"同一逻辑/同一读路径/同一守卫在多处各写一遍，含跨 packages/apps/server"。
 * 这一台管**函数体**那一层：把每一枚函数体的空白折起来做哈希，跨**不同文件**撞进同一枚桶的 ⇒ 重叠实现候选。
 *
 * 两档，分得很死（这一格混了就等于自欺）：
 *   🔴 逐字相同：拿**原文**（字符串留着，只折空白）对账 ⇒ 两处的代码一个字节都不差。
 *   🟠 只差注释或文案：拿**遮蔽后**的文本（注释与单/双引号字符串挖掉）对账，而原文并不相同
 *      —— 也就是"逻辑一模一样，只是注释换了个说法 / 提示语换了个字"。
 *   🟡 同名不同体 / 同体不同名 这类要靠语义，本尺**不判**，也不许把它读成"没有重叠"。
 *
 * 🔴 三格必须显式落成"未判定"或"跳过"并**报条数**：
 *   ① 箭头函数是表达式体（`=> 值`）没有块 ⇒ 跳过并计数；
 *   ② 括号配不上（未闭合的模板串等）⇒ 那一枚跳过并计数；
 *   ③ 读不到正文的枚数。
 * 静默跳过就是把"没看到"记成"没有"。
 *
 * 长度门槛不当判决用：本尺把 ≥3 / ≥5 / ≥10 行三档的桶数**都打出来**，明细默认只列 ≥5 行那一档 ——
 * 那是显示用的切片，不是"低于 5 行就不算重叠"的口径。三行的样板撞十次也是十次样板。
 *
 * 读数口径：分母 = `git ls-tree -r --name-only HEAD` 里在射程内的那批；正文从工作树取，
 * 所以**别人未提交的改动会进读数** ⇒ 每次自打印脏的枚数。
 *
 * 用法：node research/tools/audit-duplicate-function-bodies.mjs [--strict] [--self-test] [--mutate] [--top N]
 * 退出：0 = 只报读数；1 = --strict 且有 🔴 档 / --mutate 的敏感度没证到；2 = 分母为空、一枚函数都没解析出来、或对账不成立
 */
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { balanced, lineOf, maskText } from './lib/text-mask.mjs';

// 🔴 这一枚文件**既是命令行也是库**（骨架尺复用同一份抽取器）。没有入口判定的话，
//    别人 `import { extractFns }` 就会顺带把本尺的 CLI 跑一遍——旗标还会串味（`--self-test`
//    传进宿主那把尺的进程里，这里就当众抢答了一份自己的臂清单）。骨架尺第一发就是这么撞上的。
const IS_ENTRY = !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
const ROOT = path.resolve(import.meta.dirname, '..', '..');
const argv = IS_ENTRY ? process.argv.slice(2) : [];
const strict = argv.includes('--strict');
const selfTest = argv.includes('--self-test');
const mutate = argv.includes('--mutate');
const topIv = argv.indexOf('--top');
const TOP = topIv >= 0 && /^\d+$/.test(argv[topIv + 1] ?? '') ? Number(argv[topIv + 1]) : 12;
const scopeIv = argv.indexOf('--scope');
// 🔴 `--scope` 是给"某一层的棘轮"用的：判据只能钉在**自己那一面**的目录上，
//    不替别的日子签名（`--strict` 不带 scope 会把八枚别人的桶一起算成违规，那不是我的判据）。
const SCOPE = scopeIv >= 0 ? argv[scopeIv + 1] ?? '' : '';
const unknown = argv.filter(
  (a, i) =>
    !['--strict', '--self-test', '--mutate'].includes(a) &&
    !/^\d+$/.test(a) &&
    !(i > 0 && (argv[i - 1] === '--top' || argv[i - 1] === '--scope')) &&
    a !== '--top' &&
    a !== '--scope',
);
if (topIv >= 0 && !/^\d+$/.test(argv[topIv + 1] ?? '')) {
  console.error('🔴 --top 后面要跟一个非负整数');
  process.exit(1);
}
if (scopeIv >= 0 && (SCOPE.length === 0 || SCOPE.startsWith('-'))) {
  console.error('🔴 --scope 后面要跟一个目录前缀（例：--scope server/src/password）');
  process.exit(1);
}

// 射程含 server/src —— 目标那一维写的是"跨 packages/apps/server"，漏掉服务端就等于把最厚的那一面切掉。
const SCOPE_RE = /^((apps|packages)\/[^/]+\/src\/.*\.(ts|tsx)|server\/src\/.*\.ts)$/;
const FN_DECL_RE = /(?:^|\n)[ \t]*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+([A-Za-z0-9_$]+)\s*\(/g;
const ARROW_DECL_RE = /(?:^|\n)[ \t]*(?:export\s+)?(?:const|let)\s+([A-Za-z0-9_$]+)\s*(?::[^=\n]+)?=\s*(?:async\s+)?(?:\([^)]*\)|[A-Za-z0-9_$]+)\s*(?::[^=\n{]+)?=>/g;

const norm = (s) => s.replace(/\s+/g, ' ').trim();

/** 从一份文件里取出每一枚函数：{ name, line, raw, masked, skipped }。 */
export function extractFns(file, text) {
  const rows = [];
  let skipped = { exprBody: 0, unbalanced: 0 };
  const masked = maskText(text);
  for (const [re, kind] of [[FN_DECL_RE, 'function'], [ARROW_DECL_RE, 'arrow']] ) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(masked)) !== null) {
      const name = m[1];
      const start = m.index + m[0].length;
      let bodyOpen = -1;
      if (kind === 'function') {
        const paren = balanced(masked, masked.indexOf('(', m.index + m[0].length - 1));
        if (paren === null) { skipped.unbalanced += 1; continue; }
        // 🔴 `balanced` 返回的 `end` 就是那枚**闭括号本身**的下标 ⇒ 必须从 end+1 起看，
        //    否则 slice 以 `)` 开头，每一枚 function 声明都会被当成"表达式体"跳掉
        //    （本线第一发就是这么把 1059 枚文件只解析出 60 枚函数，被 D1 当场抓住）。
        // 🔴 返回类型标注（`: void` / `: Promise<void>`）在本仓是主流写法 ⇒ 必须先跳过它再要求 `{`，
        //    否则每一枚带标注的 function 声明都被当成"表达式体"**静默跳过**：
        //    本发就是这么让 `apps/mobile/src/privacy/consent-gate.ts` 与
        //    `apps/web/src/features/privacy/consent-gate.ts` 那两枚只差注释的 `notify()`
        //    （连整枚文件）不在分母里，被 D15 当场抓住。
        //    类型里不许出现 `{`（对象返回类型）或 `;`（重载签名，本来就没有体）⇒ 落到 exprBody 计数，可反查。
        const afterParen = masked.slice(paren.end + 1);
        const typeRun = /^\s*:[^{;]*/.exec(afterParen);
        const bodyAt = paren.end + 1 + (typeRun ? typeRun[0].length : 0);
        if (!/^\s*\{/.test(masked.slice(bodyAt))) { skipped.exprBody += 1; continue; }
        bodyOpen = masked.indexOf('{', bodyAt);
      } else if (/^\s*\{/.test(masked.slice(start))) {
        bodyOpen = masked.indexOf('{', start);
      } else {
        skipped.exprBody += 1;
        continue;
      }
      if (bodyOpen < 0) { skipped.exprBody += 1; continue; }
      const body = balanced(masked, bodyOpen);
      if (body === null) { skipped.unbalanced += 1; continue; }
      rows.push({
        file,
        name,
        kind,
        line: lineOf(masked, m.index),
        masked: norm(body.inner),
        raw: norm(text.slice(bodyOpen + 1, body.end)),
        lines: body.inner.split('\n').length,
      });
    }
  }
  return { rows, skipped };
}

/** 按两档口径分别分桶，只留**跨不同文件**的桶。 */
export function cluster(rows, key) {
  const byKey = new Map();
  for (const r of rows) {
    if (r[key].length === 0) continue;
    const at = byKey.get(r[key]) ?? [];
    at.push(r);
    byKey.set(r[key], at);
  }
  const out = [];
  for (const [k, group] of byKey) {
    const files = new Set(group.map((g) => g.file));
    if (files.size >= 2 && group.length >= 2) out.push({ key: k, group, files: [...files].sort(), sig: group.map((g) => `${g.file}:${g.line}`).sort().join('|') });
    else if (group.length > 1) out.push({ key: k, group, files: [...files].sort(), sameFileOnly: true, sig: group.map((g) => `${g.file}:${g.line}`).sort().join('|') });
  }
  return out.sort((a, b) => b.group.length - a.group.length || (a.files[0] < b.files[0] ? -1 : 1));
}

/** 一台完整的读数：分母、各档桶、以及"每条判读要么在桶里要么是自己的桶"的对账。 */
export function summarizeBy(rows) {
  const exact = cluster(rows, 'raw').filter((c) => !c.sameFileOnly);
  // 🟠 档剔的是"**同一批成员**已经在 🔴 档报过"的桶 —— 拿 key 比不行：两档的 key 来自不同口径的文本，
  // 只有成员集合才是"就是那一处重叠"的判据（本线实测：按 key 比会漏掉逐字相同那一枚，把它重复报成 🟠）。
  const seen = new Set(exact.map((c) => c.sig));
  const maskedOnly = cluster(rows, 'masked').filter((c) => !c.sameFileOnly && !seen.has(c.sig));
  const inCluster = new Set();
  for (const c of [...exact, ...maskedOnly]) for (const r of c.group) inCluster.add(`${r.file}:${r.line}:${r.name}`);
  const sameFileOnly = cluster(rows, 'raw').filter((c) => c.sameFileOnly);
  return {
    total: rows.length,
    exact,
    maskedOnly,
    sameFileOnly,
    singletons: rows.length - inCluster.size,
    inCluster: inCluster.size,
  };
}

function git(args) {
  const r = spawnSync('git', ['-C', ROOT, ...args], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} 失败：${r.stderr}`);
  return r.stdout;
}

/** `--scope` 的口径：只吃**目录前缀**（带尾斜杠语义），`password` 不许把 `passwordish.ts` 也算进来。 */
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

const tierLines = (c, min) => c.group.filter((r) => r.lines >= min).length >= 2;
const fmt = (c) => `${c.group.length} 枚 ｜ ${c.group.map((r) => `${r.file}:${r.line}(${r.name},${r.lines}行)`).join(' + ')}`;

if (unknown.length > 0) {
  console.error(`🔴 不认的旗标：${unknown.join(' ')} ｜ 只认 --strict / --self-test / --mutate / --top N`);
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
  const A = 'alpha.ts';
  const B = 'beta.ts';
  const S = (pairs) => {
    const rows = [];
    for (const [f, t] of pairs) rows.push(...extractFns(f, t).rows);
    return summarizeBy(rows);
  };
  const BODY = 'function f(x) {\n  const y = x + 1;\n  return y * 2;\n}';

  push('D1 两枚不同文件的逐字同名体 ⇒ 🔴 档 1 桶', S([[A, BODY], [B, BODY]]).exact.length, 1);
  push('D2 只差注释 ⇒ 落 🟠 不落 🔴（两档分开记账）',
    (() => {
      // 🔴 注释必须写在**体内部**：写在函数外面时两枚体本来就逐字相同，那测的是 🔴 档，不是这一档
      //（本线第一发这条臂就是这么把自己的判据判错的，实读 [1,0]）。
      const withComment = (who) => `function f(x) {\n  // ${who}\n  const y = x + 1;\n  return y * 2;\n}`;
      const s = S([[A, withComment('甲')], [B, withComment('乙')]]);
      return [s.exact.length, s.maskedOnly.length];
    })(),
    [0, 1]);
  push('D3 只差字符串文案 ⇒ 🟠 而不是 🔴',
    [S([[A, 'function f() {\n  return "一处";\n}'], [B, 'function f() {\n  return "另一处";\n}']]).exact.length,
      S([[A, 'function f() {\n  return "一处";\n}'], [B, 'function f() {\n  return "另一处";\n}']]).maskedOnly.length],
    [0, 1]);
  push('D4 体不同 ⇒ 两档都是 0（不许把长度相近当重叠）',
    [S([[A, 'function f(a) {\n  return a + 1;\n}'], [B, 'function f(a) {\n  return a + 2;\n}']]).exact.length,
      S([[A, 'function f(a) {\n  return a + 1;\n}'], [B, 'function f(a) {\n  return a + 2;\n}']]).maskedOnly.length],
    [0, 0]);
  push('D5 缩进与换行不同也算同一枚（折叠空白是对账的前提）',
    S([[A, 'function f(x) {\n    const y = x + 1;\n    return y * 2;\n}'], [B, 'function f(x) {\nconst y = x + 1;\nreturn y * 2;\n}']]).exact.length,
    1);
  const BODY2 = BODY.replace('function f(', 'function g(');
  push('D6 同文件里的两枚同名体 ⇒ 单列 sameFileOnly，不混进跨文件那一档',
    [S([[A, `${BODY}\n${BODY2}`]]).exact.length, S([[A, `${BODY}\n${BODY2}`]]).sameFileOnly.length],
    [0, 1]);
  push('D7 变异臂：把 B 那一枚改一个字符 ⇒ 🔴 桶必须从 1 掉到 0',
    S([[A, BODY], [B, BODY.replace('x + 1', 'x + 3')]]).exact.length, 0);
  push('D8 表达式体箭头 ⇒ 计入跳过，不许从分母里消失', extractFns(A, 'const f = (x) => x + 1;').skipped.exprBody, 1);
  push('D9 一枚都没有 ⇒ 聚合给全 0（主读数据此退 2）', summarizeBy([]), { total: 0, exact: [], maskedOnly: [], sameFileOnly: [], singletons: 0, inCluster: 0 });
  push('D10 对账成立：在桶里的 + 自己的桶 = 解析出的全部函数',
    (() => { const s = S([[A, BODY], [B, BODY], [A, 'function z() {\n  return 3;\n}']]); return s.inCluster + s.singletons === s.total; })(), true);
  push('D11 具名 const 箭头块体也吃得到（只认 function 关键字就是半把尺）',
    S([[A, 'const f = (x) => {\n  const y = x + 1;\n  return y * 2;\n};'], [B, BODY]]).exact.length, 1);
  push('D12 注解里带等号的 const 箭头不许被漏掉',
    S([[A, 'const f = (): void => {\n  const y = 1;\n  return y;\n};'], [B, 'const g = (): void => {\n  const y = 1;\n  return y;\n};']]).exact.length,
    1);
  push('D13 --scope 只吃目录前缀：password 不许把 passwordish.ts 算进来',
    [applyScope(['server/src/password/login-otp.ts', 'server/src/passwordish.ts'], 'server/src/password').length, applyScope(['a.ts'], '').length],
    [1, 1]);
  push('D14 带返回类型标注的 function 声明必须解析到（本发真漏过的那一族：`: void` / `: Promise<void>`）',
    (() => {
      const one = extractFns(A, 'function f(x: number): void {\n  return;\n}').rows.length;
      const pair = S([[A, 'async function f(x: number): Promise<void> {\n  const y = x + 1;\n  return;\n}'],
        [B, 'async function f(x: number): Promise<void> {\n  const y = x + 1;\n  return;\n}']]).exact.length;
      // 重载签名（无体）不许被当成体，更不许把**下一枚**有体的声明一起吃掉
      const overloads = extractFns(A, 'function f(x: number): void;\nfunction g(): void {\n  return;\n}').rows.map((r) => r.name).join(',');
      return [one, pair, overloads];
    })(),
    [1, 1, 'g']);
  const nums = labels.map((l) => Number(/^D(\d+)/.exec(l)?.[1] ?? 0));
  const seqOk = Math.max(...nums) === labels.length && new Set(nums).size === labels.length;
  console.log(`${seqOk ? '✅' : '🔴'} D15 臂编号连续且不重号（判的是上面 ${labels.length} 枚：最大号 ${Math.max(...nums)} ｜ 去重 ${new Set(nums).size}）`);
  if (!seqOk) bad.push(`D15 臂编号跳号或重号 ｜ 最大 ${Math.max(...nums)} ｜ 条数 ${labels.length}`);
  console.log(`\n臂数 ${labels.length + 1} ｜ 不符 ${bad.length}`);
  for (const b of bad) console.log(`🔴 ${b}`);
  process.exit(bad.length === 0 ? 0 : 1);
}

if (IS_ENTRY) {   // ↓↓↓ 整段是命令行：分母、打印、--strict 退出码
const scope = applyScope(scopeFiles(), SCOPE);
if (scope.length === 0) {
  console.error('🔴 分母为空：HEAD 里一枚射程内的源文件都没列出 ⇒ 本尺没干活，不许读成"没有重叠"');
  process.exit(2);
}
let unreadable = 0;
const rows = [];
let exprBody = 0;
let unbalanced = 0;
for (const f of scope) {
  try {
    const r = extractFns(f, readFileSync(path.join(ROOT, f), 'utf8'));
    rows.push(...r.rows);
    exprBody += r.skipped.exprBody;
    unbalanced += r.skipped.unbalanced;
  } catch {
    unreadable += 1;
  }
}
const s = summarizeBy(rows);
// 阳性对照分两半：整棵树跑时**两路都要吃到东西**（`function` 声明那一路坏过一次，1059 枚文件只读出 60 枚函数）；
// 带 --scope 时不能这么要求 —— 一个全是箭头声明的目录里 `function` 数为 0 是事实，不是尺坏。
if (!SCOPE && !rows.some((r) => r.kind === 'function')) {
  console.error('🔴 阳性对照不成立：整棵树里一枚 function 声明都没解析出来 ⇒ 声明级那一路的取体逻辑坏了');
  process.exit(2);
}
if (SCOPE && !rows.some((r) => r.kind === 'arrow')) {
  console.error(`🔴 阳性对照不成立：--scope ${SCOPE} 里一枚箭头声明都没解析出来 ⇒ 判法对该层失效，本趟读数作废`);
  process.exit(2);
}
if (s.total === 0) {
  console.error('🔴 阳性对照不成立：扫了这些文件一枚函数都没解析出来 ⇒ 判法失效，不许读成"没有重叠"');
  process.exit(2);
}
if (s.inCluster + s.singletons !== s.total) {
  console.error(`🔴 对账不成立：在桶里 ${s.inCluster} + 单枚 ${s.singletons} ≠ 解析出 ${s.total} ⇒ 有一档被静默吞掉，本趟读数作废`);
  process.exit(2);
}

if (mutate) {
  // 敏感度证据：拿真桶里的一枚，在内存副本上改一个字符，那一整桶必须掉出去。
  // 真代码里当前一枚跨文件重叠都没有时（现量见主读数），改用合成两枚 —— 但合成件必须逐字来自真文件，
  // 否则"证到的是夹具能红"而不是"这把尺在真写法上能红"。
  const target = s.exact[0] ?? s.maskedOnly[0];
  const lines = [];
  let drops = 0;
  if (target) {
    // 🔴 剔"一枚成员"不叫敏感：一枚 4 员桶剔掉一个还剩 3 个，桶照旧 ⇒ 上一发就是这么报出"不敏感"的假红。
    //    正确的证法是把**这一桶的全部成员**剔干净，那一枚桶必须消失、别的桶不许跟着消失。
    const gone = new Set(target.files);
    const rest = [];
    for (const f of scope) {
      if (gone.has(f)) continue;
      try { rest.push(...extractFns(f, readFileSync(path.join(ROOT, f), 'utf8')).rows); } catch { /* 主读数那一路已计 */ }
    }
    const after = summarizeBy(rest);
    const stillThere = after.exact.filter((c) => c.sig === target.sig).length + after.maskedOnly.filter((c) => c.sig === target.sig).length;
    const beforeOthers = s.exact.length + s.maskedOnly.length - 1;
    const afterOthers = after.exact.length + after.maskedOnly.length;
    if (stillThere === 0) {
      drops = 1;
      const collateral = afterOthers === beforeOthers ? '' : `（另有一桶被牵连：其余 ${afterOthers} vs ${beforeOthers} —— 那枚文件同时站在两桶里，不是判据坏）`;
      lines.push(`  ✅ 把 ${target.files.length} 枚成员（${target.files.join(' + ')}）整桶剔出对账 ⇒ 那一枚桶消失${collateral}`);
    } else {
      lines.push(`  🔴 整桶剔除后：目标桶仍在 ${stillThere} ｜ 其余 ${afterOthers}（应 ${beforeOthers}）⇒ 判据不敏感或牵连了别的桶`);
    }
  } else {
    lines.push('  · 真代码当前没有跨文件重叠的桶（无宿主），改在合成件上证敏感度');
    const A = 'a.ts';
    const B = 'b.ts';
    const BODY = 'function f(x) {\n  const y = x + 1;\n  return y * 2;\n}';
    const pair = [...extractFns(A, BODY).rows, ...extractFns(B, BODY).rows];
    const oneSided = [...extractFns(A, BODY).rows, ...extractFns(B, BODY.replace('x + 1', 'x + 3')).rows];
    const b1 = summarizeBy(pair).exact.length;
    const b2 = summarizeBy(oneSided).exact.length;
    if (b1 === 1 && b2 === 0) { drops = 1; lines.push('  ✅ 合成两枚逐字相同 ⇒ 1 桶；把其中一枚改一个字符 ⇒ 0 桶'); }
    else lines.push(`  🔴 合成件对不上（${b1} → ${b2}，应为 1 → 0）⇒ 这把尺不敏感`);
  }
  console.log(`变异台架（只在内存里剔/改，一个字节都不写盘）｜ 证到的形状 ${drops} / 1`);
  for (const l of lines) console.log(l);
  process.exit(drops === 1 ? 0 : 1);
}

console.log(
  `跨文件重叠实现探针 ｜ 分母 ${scope.length} 枚文件${SCOPE ? `（已按 --scope ${SCOPE} 收窄）` : ''}（工作树里脏的 ${dirtyScope(scope).length} 枚，读数含它们）` +
    `｜ 解析出函数 ${s.total} 枚（在桶里 ${s.inCluster} ｜ 各一枚 ${s.singletons}）｜ 跳过 表达式体 ${exprBody} · 配不上 ${unbalanced} · 读不到 ${unreadable}`,
);
console.log(`  · 口径：只看**声明级**函数（function 声明与 const 名 = 箭头块体；带返回类型标注的算在内，重载签名无体不算），内部回调与带泛型参数的声明不在射程 ⇒ "没有重叠"这句的范围就是这个口径`);
for (const min of [3, 5, 10]) {
  console.log(
    `  ≥${min} 行那一档：🔴 逐字相同 ${s.exact.filter((c) => tierLines(c, min)).length} 桶 ｜ 🟠 只差注释或文案 ${s.maskedOnly.filter((c) => tierLines(c, min)).length} 桶`,
  );
}
console.log(`  · 同文件里各写一遍（另一档，不算跨文件）：${s.sameFileOnly.length} 桶`);
if (s.exact.length + s.maskedOnly.length > 0) {
  console.log(`\n候选（🔴 先，列前 ${Math.min(TOP, s.exact.length + s.maskedOnly.length)} 桶）：`);
  const all = [...s.exact.map((c) => ({ c, t: '🔴' })), ...s.maskedOnly.map((c) => ({ c, t: '🟠' }))].slice(0, TOP);
  for (const { c, t } of all) console.log(`   ${t} ${fmt(c)}`);
} else {
  console.log('\n✅ 没有跨文件重叠的函数体');
}
if (strict && s.exact.length > 0) process.exit(1);

}