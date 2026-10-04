#!/usr/bin/env node
/**
 * 详情面合流**产物**的纯 fs 门禁预检（`docs/plans/detail-pane-alignment.md` §8.47 第 5 步的前半）。
 *
 * 为什么需要它：合流那一刻要跑的 `pnpm check` 里有一批**不依赖构建、只读源码**的门禁，
 * 而它们通常是合并之后才第一次跑 —— 那时候红起来分不清是"合并合错了"还是"本来就红"。
 * 本脚本在**不碰任何分支、不做任何 merge** 的前提下先把它们跑一遍：
 * 用 `git archive` 把 `merge-tree` 造出的候选树铺到临时目录，直接拿真门禁（不复刻逻辑）跑，
 * 再铺一份 **main 单独**作为对照载体 —— 只有"候选树红而 main 绿"的那些才是**合并造成的红**。
 *
 * 跑法（仓库根或任一检出都行；无需 node_modules）：
 *   node scripts/verify-detail-pane-merge-preflight.mjs              # 默认 main × HEAD
 *   node scripts/verify-detail-pane-merge-preflight.mjs --keep       # 跑完留着临时目录给人进去手动处置冲突
 *   node scripts/verify-detail-pane-merge-preflight.mjs --product <上一步留下的目录>   # 手工处置完冲突后复跑
 *
 * 读数分两块：
 *  ① **纯 fs 门禁**：同一批脚本在"候选树"与"main 单独"两个载体上各跑一遍，
 *     只有**候选红而 main 绿**的才算"合并造成的红"（两边都红 = 环境/载体所致，不含合并信息）。
 *  ② **静默合流对账**：两侧都改过、而 `merge-tree` 没登记为冲突的文件（零 marker 的那一档）。
 *     逐枚问"两侧各自新增的行，是否**都还在**产物里"，`.mjs` 另跑 `node --check`。
 *     这一档是 §8.42 那个形状（把 main 的函数抄进同一份脚本）唯一的抓手 —— 门禁那一块只能
 *     告诉你"结果红不红"，不能告诉你"哪一侧的改动被无声丢掉了"。
 *
 * 退出码：合并造成的红 + 静默合流丢行/删文件/语法不过 = 0 条 ⇒ 0；有 ⇒ 1；候选树都造不出来 ⇒ 2（响亮失败，不静默放行）。
 *
 * ⚠️ 三条边界，别读多：
 *  ① 候选树里**未解决的冲突 marker 还留在文本里**（本脚本不替人裁决），所以带 marker 的文件
 *     可能让某些门禁红 —— 那属于 §8.47 第 3 节的处置还没做，不是新问题。脚本会把带 marker 的
 *     文件名打在结论旁边，避免被读成"合并把门禁改坏了"。
 *  ② 只覆盖**纯 fs** 那一批：`pnpm check` 那条 `&&` 链里要 dist / node_modules / 服务端 / 浏览器的
 *     一段都不在这里（临时检出没有那些）。这里绿 **不等于** 合并后 `pnpm check` 绿。
 *     ⚠️ 那条链**有几段不写在这里**（本文件不抄计数，抄了就一定会漂）—— 要现量就读 root `package.json`。
 *  ③ `check:docs` 不在清单里：它要 `git ls-files`（判断"本机有、仓库里没"那一档），
 *     临时目录不是 git 检出，两个载体都会红成一样的 —— 那种红不含信息。
 *  ④ TS/TSX 的语法解析用的是**跑脚本这一侧**的 typescript（从本检出解析，产物树不需要依赖），
 *     且只到 `transpileModule` 的**语法层**：括号不闭合、块被截断会报，
 *     "两条同名声明"那种**语义**错它不报 —— 那一档仍然只有第 5 步的 `pnpm -r typecheck` 抓得住。
 *     拿不到 typescript 时**响亮地跳过并数出来**，不静默按通过处理。
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { tmpdir } from 'node:os';


const ROOT = process.cwd();
const git = (args, opts = {}) =>
  execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 28, ...opts });

// 纯 fs 门禁：全部是 `pnpm check` 已经消费的同一批脚本，一个都不新造判据。
const GATES = [
  'scripts/check-selection-single-source.mjs',
  'scripts/check-layering.mjs',
  'scripts/check-l4-no-style.mjs',
  'scripts/check-row-single-source.mjs',
  'scripts/check-ui-language.mjs',
  'scripts/check-migrations.mjs',
  'scripts/check-claims.mjs',
  'scripts/check-reachability.mjs',
  'scripts/check-script-snapshot.mjs',
  'scripts/check-empty-state.mjs',
  'scripts/check-rn-aria.mjs',
  'scripts/check-text-color.mjs',
  'scripts/check-token-hashing.mjs',
  'scripts/check-ui-provider.mjs',
  'scripts/check-theme-single-source.mjs',
  'design-system/heyta/check-hardcoded.mjs',
  'scripts/check-docs-voice.mjs',
];

const refA = process.argv.includes('--a') ? process.argv[process.argv.indexOf('--a') + 1] : 'main';
const refB = process.argv.includes('--b') ? process.argv[process.argv.indexOf('--b') + 1] : 'HEAD';
const keep = process.argv.includes('--keep');

// —— 1. 候选树
let tree = '';
try {
  tree = git(['merge-tree', '--write-tree', '--name-only', refA, refB]).split('\n')[0].trim();
} catch (e) {
  tree = String(e.stdout || '').split('\n')[0].trim(); // rc=1 = 有冲突，树号照样在第一行
}
if (!/^[0-9a-f]{40}$/.test(tree)) {
  console.error('🔴 拿不到候选树 —— 这一趟没有读数，不是"通过"。');
  process.exit(2);
}

// —— 2. 铺两个临时载体
const layDown = (rev) => {
  const dir = mkdtempSync(join(tmpdir(), 'dp-preflight-'));
  execFileSync('sh', ['-c', `git archive '${rev}' | tar -x -C '${dir}'`], { cwd: ROOT, stdio: 'inherit' });
  return dir;
};
// `--product <dir>`：拿一份**已经人手工处置过冲突**的目录来复跑（配合 `--keep` 用）。
// 不传就是每次都从候选树新铺 —— 所以手工改在临时目录里的那些行，下一趟默认会被铺掉。
const productArg = process.argv.includes('--product') ? process.argv[process.argv.indexOf('--product') + 1] : '';
if (productArg && !existsSync(join(productArg, 'scripts'))) {
  console.error(`🔴 --product 指过去的目录不像一份检出：${productArg}（没有 scripts/）—— 这一趟没有读数。`);
  process.exit(2);
}
const product = productArg || layDown(tree);
const baseline = layDown(refA);

// 自检：铺出来的产物里，哪些"被登记为冲突"的文件确实还带着 marker。
// 这一栏的作用是防止把"§8.47 第 3 节还没做"读成"合并把门禁改坏了"。
// merge-tree 的输出是：<树号>\n<冲突文件…>\n\n<stderr 形状的过程行…>
// ⇒ 冲突清单 = 树号之后、第一个空行之前的那些行（后面的过程行一律不算）。
const conflicted = (() => {
  let out = '';
  try {
    out = git(['merge-tree', '--write-tree', '--name-only', refA, refB]);
  } catch (e) {
    out = String(e.stdout || '');
  }
  const lines = out.split('\n').slice(1);
  const stop = lines.findIndex((l) => l.trim() === '');
  return (stop === -1 ? lines : lines.slice(0, stop)).filter(Boolean);
})();

const markersIn = (dir) =>
  conflicted
    .filter((rel) => existsSync(join(dir, rel)))
    .filter((rel) => {
      try {
        return /(^|\n)(<{7}|={7}|>{7})[^\n]*\n/.test(readFileSync(join(dir, rel), 'utf8'));
      } catch {
        return false;
      }
    });

// —— 3. 静默合流对账
// `git merge` 只在**同一处**两侧都动时才报冲突；两侧各改一段就静默拼接 —— 零 marker、文本层"看着没事"，
// 而 §8.42 那个形状（把 main 的函数抄进同一份脚本 ⇒ 两条同名声明）恰好藏在这一档里。
// 判据：两侧各自**新增**的那些行，必须**逐行**在产物里还在。缺一行就是有一侧被无声丢掉。
// ⚠️ 这一节只到"行还在不在"，不判"语义对不对"（两侧都往同一个函数里加语句，行都在也可能行为错）——
//    那种红归第 5 步的 `pnpm -r typecheck` 与全量测试。
const base = git(['merge-base', refA, refB]).trim();
const namesOf = (ref) =>
  new Set(
    git(['diff', '--name-only', `${base}`, `${ref}`])
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean),
  );
const setA = namesOf(refA);
const conflictedSet = new Set(conflicted);
const silent = [...namesOf(refB)].filter((f) => setA.has(f) && !conflictedSet.has(f));

/** 某侧相对 merge-base 在该文件上新增的行（`-U0` ⇒ 不带上下文，只取 `+` 行）。 */
const addedLines = (ref, rel) =>
  git(['diff', '-U0', `${base}`, `${ref}`, '--', rel])
    .split('\n')
    .filter((l) => l.startsWith('+') && !l.startsWith('+++'))
    .map((l) => l.slice(1).trim())
    .filter((l) => l.length > 3);

const silentRows = [];
// TS/TSX 语法解析器从**本检出**解析（产物树是 `git archive` 铺出来的，本来就没有 node_modules）。
// 找不到不算失败，算"这一档没跑"—— 计数打进结论，别让它静默变成通过。
let ts = null;
for (const c of [
  join(ROOT, 'node_modules/typescript'),
  join(ROOT, 'apps/web/node_modules/typescript'),
  join(ROOT, 'packages/app-host/node_modules/typescript'),
]) {
  if (!existsSync(c)) continue;
  try {
    ts = createRequire(join(ROOT, 'package.json'))(c);
    break;
  } catch {
    /* 换下一个候选 */
  }
}
const tsSyntaxOf = (file) => {
  const out = ts.transpileModule(readFileSync(file, 'utf8'), {
    reportDiagnostics: true,
    compilerOptions: {
      jsx: ts.JsxEmit.Preserve,
      target: ts.ScriptTarget.ESNext,
      module: ts.ModuleKind.ESNext,
    },
  });
  const d = (out.diagnostics || []).filter((x) => x && x.messageText);
  return d.length ? `${ts.flattenDiagnosticMessageText(d[0].messageText, ' ')}（共 ${d.length} 条）` : null;
};

for (const rel of silent) {
  const productFile = join(product, rel);
  const row = { rel, missingA: [], missingB: [], syntax: null, absent: false, nA: 0, nB: 0, parsed: false, unparsed: false };
  if (!existsSync(productFile)) {
    row.absent = true; // 两侧都改过、产物里却没有 ⇒ 一侧把它删了（这本身就是要知道的事）
    silentRows.push(row);
    continue;
  }
  const prod = new Set(
    readFileSync(productFile, 'utf8')
      .split('\n')
      .map((l) => l.trim()),
  );
  const a = addedLines(refA, rel);
  const b = addedLines(refB, rel);
  row.nA = a.length;
  row.nB = b.length;
  row.missingA = a.filter((l) => !prod.has(l));
  row.missingB = b.filter((l) => !prod.has(l));
  if (rel.endsWith('.mjs')) {
    try {
      execFileSync('node', ['--check', productFile], { encoding: 'utf8' });
    } catch (e) {
      row.syntax = `${e.stderr || e.stdout || ''}`.trim().split('\n').find((l) => l.trim()) || 'node --check 失败';
    }
    row.parsed = true;
  } else if (/\.tsx?$/.test(rel)) {
    if (ts) {
      row.syntax = tsSyntaxOf(productFile);
      row.parsed = true;
    } else {
      row.unparsed = true; // 拿不到解析器 ⇒ 这一枚没判过，不算通过
    }
  }
  silentRows.push(row);
}

const runOne = (dir, gate) => {
  if (!existsSync(join(dir, gate))) return { rc: 'MISS', line: '临时载体里没有这个脚本' };
  try {
    const out = execFileSync('node', [gate], { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { rc: 0, line: out.trim().split('\n').pop().slice(0, 58) };
  } catch (e) {
    const out = `${e.stdout || ''}${e.stderr || ''}`.trim().split('\n');
    return { rc: e.status ?? 1, line: (out.find((l) => l.trim()) || '').slice(0, 58) };
  }
};

const rows = [];
for (const gate of GATES) {
  const p = runOne(product, gate);
  const b = runOne(baseline, gate);
  const mergeCaused = p.rc !== 0 && b.rc === 0;
  rows.push({ gate, p, b, mergeCaused });
  console.log(
    `${p.rc === 0 ? '· ' : p.rc !== 0 && b.rc === 0 ? '🔴' : '⚠️'} ${gate.replace(/^scripts\//, '').padEnd(34)} 候选=${p.rc} ${refA}=${b.rc}  ${p.line}`,
  );
}

const bad = rows.filter((r) => r.mergeCaused);
const same = rows.filter((r) => r.p.rc !== 0 && r.b.rc !== 0);

const silentBad = silentRows.filter(
  (r) => r.absent || r.missingA.length || r.missingB.length || r.syntax || r.unparsed,
);
if (silentRows.length) {
  console.log(`\n静默合流（两侧都改过、merge-tree 没报冲突）= ${silentRows.length} 枚 —— 逐枚查"两侧新增的行是否都还在产物里"：`);
  for (const r of silentRows) {
    const badRow = r.absent || r.missingA.length || r.missingB.length || r.syntax || r.unparsed;
    const parseTag = r.parsed
      ? ` · 语法过（${r.rel.endsWith('.mjs') ? 'node --check' : 'ts transpile'}）`
      : r.unparsed
        ? ' · 🔴 语法**未判**（这一侧拿不到 typescript）'
        : '';
    const verdict = r.absent
      ? `🔴 产物里没有这个文件（有一侧把它删了）`
      : r.missingA.length || r.missingB.length
        ? `🔴 丢行：${refA} 侧缺 ${r.missingA.length} / ${refB} 侧缺 ${r.missingB.length}`
        : r.syntax
          ? `🔴 ${refA}+${r.nA} ${refB}+${r.nB} 行全在，但语法不过：${r.syntax}`
          : `✅ ${refA}+${r.nA} ${refB}+${r.nB} 行全在${parseTag}`;
    console.log(`${badRow ? '🔴' : '· '} ${r.rel.padEnd(46)} ${verdict}`);
    for (const [tag, list] of [[refA, r.missingA], [refB, r.missingB]]) {
      for (const l of list.slice(0, 4)) console.log(`      缺(${tag}) ${l.slice(0, 76)}`);
    }
  }
}

console.log(
  `\nTREE=${tree}  冲突=${conflicted.length} 枚（处置见工单 §8.47 第 3 节）  ` +
    `纯 fs 门禁=${GATES.length} 道：合并造成的红=${bad.length}  两边都红（环境/载体所致，不含合并信息）=${same.length}  ` +
    `静默合流=${silentRows.length} 枚，其中丢行/删文件/语法不过=${silentBad.length}`,
);
console.log(`候选树里带 marker 的门禁脚本=${markersIn(product).join('/') || '无'} —— 有就说明 §8.47 第 3 节还没做完`);
if (bad.length || silentBad.length) {
  console.log('  ⇒ 逐条按 §8.47 第 3–4 节处置后再跑一次；这里绿了才去动真分支。');
}

if (!keep) {
  if (!productArg) rmSync(product, { recursive: true, force: true });
  rmSync(baseline, { recursive: true, force: true });
} else {
  console.log(`--keep：临时载体留着 —— 产物=${product}  基线=${baseline}（看完请自行删）`);
}
process.exit(bad.length + silentBad.length ? 1 : 0);
