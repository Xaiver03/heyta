#!/usr/bin/env node
/**
 * 同一个目的地有没有被做成"两个入口"——产品视角那一维的可复跑装置。
 * =================================================================
 *
 * ## 为什么要有它
 *
 * 全局 UX 线已经有 `check:row-single-source` / `check:selection-single-source` /
 * `check:focus-single-source` 这几枚"单一事实源"的门，管的是**行、选择、焦点**；
 * 而「同一个目的地在同一个面上有两个控件」这一格只有散文（计划里写过"一个目的地只允许一个控件"），
 * 没有尺。本尺补这一格。**它是诊断尺，不挂在 `pnpm check` 上**——挂哪道门、判据口径归 UX 那条线，
 * 本线只出装置与候选（`package.json` 那枚文件现在别人正在改，本尺不去动它）。
 *
 * ## 判什么（只认**字面量**目的地）
 *
 * 认四族写法，各带自己的名字，读数以"族"分开印：
 *   `view`     `setView('x')` / `switchView('x')` / `setActiveView('x')`
 *   `section`  `setSection('x')` / `setTab('x')` / `openPanel('x')` / `setPanel('x')`
 *   `path`     `href="/x"`、`href={'/x'}`
 *   `router`   `navigate('/x')` / `push('/x')` / `replace('/x')`
 * 分组键是 **壳 + 族 + 目的地**（不是只看目的地）：web 与 mobile 各有"设置"是平台差异，合法。
 *
 * 四档判决（🔴 之外都不判红——一面上有多个入口是产品常态，只有"同一件仪式被抄了两遍"才是缺陷形状）：
 *   🔴 `ritual-dup` 同组里存在两枚入口，**周围 5 行的调用集合逐字相同** ⇒ 同一件事被原样做了两遍
 *   🟠 `same-file` 同一枚文件里多枚入口，但各自参数不同 ⇒ 要人看，多半是有意的
 *   🟡 `cross-file` 同一壳跨文件多枚、仪式不同 ⇒ 要人看
 *   ⚪ 跨壳同目的地 ⇒ **不判**（平台差异合法），只报条数
 * 🔴 这一档不看文件边界：跨文件抄同一件仪式同样是重复实现（臂 E14 钉住这条阶梯）。
 *
 * ## **不**判什么
 *
 * 动态目的地（`setView(key)`）⇒ 记「判不了」并逐枚给位置；本仓这种写法不少（导航表 `.map` 里就是一次），
 * 所以"两个入口"这一族**不可能**纯靠静态文本判全 ⇒ 尺不许把"字面量里没有"读成"没有重复入口"。
 * 🔴 「两处都能编辑」这一族本尺**没有覆盖**：要知道"哪两个控件写的是同一个业务字段"得跨组件对账
 * state 的语义来源，静态文本分不清 `setTitle` 与 `setTitleDraft` 是不是同一件事。
 * 这一格现在是**未判定**，不是"查过没有"。
 *
 * ## 用法与退出码
 *
 *   node research/tools/audit-duplicate-destinations.mjs            # 诊断，恒退 0
 *   node research/tools/audit-duplicate-destinations.mjs --strict   # 有 🔴 档 ⇒ 退 1
 *   node research/tools/audit-duplicate-destinations.mjs --self-test
 *   node research/tools/audit-duplicate-destinations.mjs --mutate
 *   node research/tools/audit-duplicate-destinations.mjs --scope apps/web/src
 *
 * 0 诊断 / 1 `--strict` 且有 🔴 / 2 分母为空（瞎尺）。
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { maskText, lineOf } from './lib/text-mask.mjs';

const SHELL_RE = /^(apps\/[^/]+)\/src\//;
const SCAN_EXT = /\.(ts|tsx)$/;
const MAX_LIST = 25;

const FAMILIES = [
  { kind: 'view', re: /\b(?:setView|switchView|setActiveView)\s*\(\s*(['"])([^'"]+)\1\s*\)/g },
  { kind: 'section', re: /\b(?:setSection|setTab|openPanel|setPanel|setActiveSection)\s*\(\s*(['"])([^'"]+)\1\s*\)/g },
  { kind: 'path', re: /\bhref=\{?\s*(['"])(\/[^'"]+)\1/g },
  { kind: 'router', re: /\b(?:navigate|push|replace)\s*\(\s*(['"])(\/[^'"]*)\1/g },
];
// 动态写法单独数一枚：它证明"这一族确实还有别的入口写法在分母里"，不是"只剩字面量这一种"
const DYNAMIC_RE = /\b(?:setView|switchView|setActiveView|setSection|setTab|openPanel|setPanel)\s*\(\s*[^'")][^)]{0,40}\)/g;

const git = (args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).trim();

/** 取这一行往上**最近**的组件名（`function X(` / `const X = (` / `export function X(`）；取不到给 `(顶层)`。
 *  ⚠️ 一路看到文件头，不设窗口：本仓的壳入口是一枚几千行的巨型 `App`（现量 `apps/web/src/App.tsx`
 *  那批入口往上超过 400 行才碰到声明），窗口一收窄就读成 `(顶层)`，人拿着候选找不到是哪一面。 */
export function enclosingName(lines, idx) {
  for (let i = idx; i >= 0; i -= 1) {
    const m = /^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:function\s+([A-Z][\w$]*)|const\s+([A-Z][\w$]*)\s*=)/.exec(lines[i]);
    if (m) return m[1] ?? m[2] ?? '(顶层)';
  }
  return '(顶层)';
}

/** `line`（1 基）在那段文本里的起始下标。 */
function lineOffset(text, line) {
  const lines = text.split('\n');
  return lines.slice(0, Math.max(0, line - 1)).reduce((a, l) => a + l.length + 1, 0);
}

/** 一枚入口"周围在做什么"的形状：上下各 5 行里出现的调用名集合（遮蔽后取，注释与字符串不参与）。
 *  两枚入口目的地相同 **且这个集合相同** ⇒ 同一件事被原样做了两遍（这才是强候选）；
 *  目的地相同但集合不同 ⇒ 多半是不同菜单项打开同一面的不同节，属"要人看"不是"判红"。 */
function sigAt(maskedLines, line) {
  const from = Math.max(0, line - 6);
  const to = Math.min(maskedLines.length, line + 5);
  const names = new Set();
  for (let i = from; i < to; i += 1) {
    const re = /([A-Za-z_$][\w$]*)\s*\(/g;
    let m;
    while ((m = re.exec(maskedLines[i])) !== null) names.add(m[1]);
  }
  return [...names].sort().join(',');
}

export function scanText(file, text) {
  const shell = (SHELL_RE.exec(file) ?? [])[1] ?? '(非壳)';
  // 🔴 字面量必须扫**原文**：`maskText` 会把引号里的内容挖成空格，在遮蔽文本上找
  //    `setView('settings')` 永远找不到（臂 E8 就是当场抓到这一点：入口枚数静默变 0，
  //    整把尺"看起来全绿"）。遮蔽只用来做一件事——**判这一段是不是代码**：
  //    写法本体（`setView(` 那截）在遮蔽后仍逐字相同 ⇒ 是真代码；被挖成空格 ⇒ 在注释或字符串里，不算入口。
  const masked = maskText(text);
  const lines = masked.split('\n');
  const isCode = (start, len) => text.slice(start, start + len) === masked.slice(start, start + len);
  const entries = [];
  for (const fam of FAMILIES) {
    fam.re.lastIndex = 0;
    let m;
    while ((m = fam.re.exec(text)) !== null) {
      const head = m[0].indexOf(m[1]);
      if (head < 0 || !isCode(m.index, head)) continue;
      const line = lineOf(text, m.index);
      entries.push({ file, shell, kind: fam.kind, dest: m[2], call: m[0], line, at: m.index, comp: enclosingName(lines, line - 1), sig: sigAt(lines, line) });
    }
  }
  let dynamic = 0;
  const dynAt = [];
  DYNAMIC_RE.lastIndex = 0;
  let d;
  while ((d = DYNAMIC_RE.exec(text)) !== null) {
    if (!isCode(d.index, d[0].length)) continue;
    dynamic += 1;
    dynAt.push({ file, line: lineOf(text, d.index) });
  }
  return { entries, dynamic, dynAt };
}

/** `--strict` 的判红面：只有 🔴（仪式重复）这一档参与——🟠/🟡 是"要人看"，判红会逼着人把门禁改松。 */
export const strictFails = (groups) => groups.filter((g) => g.tier === 'ritual-dup').length;

/** 按"壳 + 族 + 目的地"分组并分档。 */
export function judge(entries) {
  const groups = new Map();
  for (const e of entries) {
    const key = `${e.shell} § ${e.kind} § ${e.dest}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(e);
  }
  const out = [];
  for (const [key, list] of groups) {
    const files = new Set(list.map((x) => x.file));
    const perFile = new Map();
    for (const x of list) perFile.set(x.file, (perFile.get(x.file) ?? 0) + 1);
    const dupInOne = [...perFile.entries()].filter(([, n]) => n >= 2);
    // 仪式重复 = 同组里存在两枚入口，其"周围在做什么"的调用集合逐字相同
    const sigCount = new Map();
    for (const x of list) sigCount.set(x.sig, (sigCount.get(x.sig) ?? 0) + 1);
    const ritual = list.filter((x) => (sigCount.get(x.sig) ?? 0) >= 2);
    let tier = 'single';
    if (ritual.length >= 2) tier = 'ritual-dup';
    else if (dupInOne.length > 0) tier = 'same-file';
    else if (files.size >= 2) tier = 'cross-file';
    out.push({ key, list, files: [...files], tier, dupInOne, ritual });
  }
  // ⚪ 跨壳同目的地（族 + 目的地相同、壳不同）单列，不当候选
  const byDest = new Map();
  for (const g of out) {
    const k = `${g.list[0].kind} § ${g.list[0].dest}`;
    if (!byDest.has(k)) byDest.set(k, new Set());
    for (const e of g.list) byDest.get(k).add(e.shell);
  }
  const crossShell = [...byDest.entries()].filter(([, set]) => set.size >= 2).map(([k]) => k);
  return { groups: out, crossShell };
}

function readWorktree(file) {
  return readFileSync(file, 'utf8');
}

function selfTest() {
  const out = [];
  const push = (name, got, want) => out.push({ name, ok: JSON.stringify(got) === JSON.stringify(want), got, want });
  const A = 'apps/web/src/App.tsx';
  const B = 'apps/web/src/features/settings/Panel.tsx';
  const C = 'apps/mobile/src/screens/Home.tsx';
  const run = (pairs) => {
    const entries = [];
    let dynamic = 0;
    const dynAt = [];
    for (const [f, t] of pairs) { const r = scanText(f, t); entries.push(...r.entries); dynamic += r.dynamic; dynAt.push(...r.dynAt); }
    return { ...judge(entries), entries, dynamic, dynAt };
  };
  const one = (body) => `export function Shell() {\n  return <nav>\n${body}\n  </nav>;\n}\n`;

  push('E1 同一枚文件里两枚控件、做同一件仪式去同一目的地 ⇒ 🔴 ritual-dup',
    (() => { const r = run([[A, one(`    <button onClick={() => setView('settings')}>A</button>\n    <a onClick={() => setView('settings')}>B</a>`)]]); return r.groups.map((g) => g.tier); })(),
    ['ritual-dup']);
  push('E2 跨文件但**仪式相同** ⇒ 仍升 🔴（重复实现不因分了文件就降级）',
    (() => { const r = run([[A, one(`    <button onClick={() => setView('settings')}>A</button>`)], [B, one(`    <button onClick={() => setView('settings')}>B</button>`)]]); return r.groups.map((g) => `${g.tier}/${g.files.length}枚文件`); })(),
    ['ritual-dup/2枚文件']);
  push('E3 跨壳同一目的地 ⇒ 不判（平台差异合法），只报条数',
    (() => { const r = run([[A, one(`    <button onClick={() => setView('settings')}>A</button>`)], [C, one(`    <button onClick={() => setView('settings')}>B</button>`)]]); return [r.groups.every((g) => g.tier !== 'same-file'), r.crossShell.length]; })(),
    [true, 1]);
  push('E4 一枚入口 ⇒ 根本不出现（同时钉住"入口枚数必须是 1"——`every` 在空数组上恒真，光判档位就是枚永远绿的臂）',
    (() => { const r = run([[A, one(`    <button onClick={() => setView('tasks')}>A</button>`)]].slice(0)); return [r.entries.length, r.groups.every((g) => g.tier === 'single')]; })(),
    [1, true]);
  push('E5 动态目的地 ⇒ 记「判不了」并给位置，不许折进「没有重复入口」',
    (() => { const r = run([[A, one(`    {NAV.map((k) => <button onClick={() => setView(k)}>x</button>)}`)]]); return [r.dynamic, r.entries.length, r.dynAt[0].line]; })(),
    [1, 0, 3]);
  push('E6 注释里的 setView 不算入口（遮蔽要先于找写法）',
    run([[A, one(`    {/* 这里以前是 setView('settings') 两个入口，后来并成一个 */}`)]].slice(0)).entries.length,
    0);
  push('E7 href 字面量也算目的地（只管 onClick 会漏掉整族链接入口）',
    run([[A, one(`    <a href="/legal/terms">条款</a>\n    <a href="/legal/terms">条款</a>`)]].slice(0)).groups.map((g) => `${g.tier}/${g.list[0].kind}`),
    ['ritual-dup/path']);
  push('E8 组件名要取得到（人读候选时要知道是哪一面）',
    (() => { const r = run([[A, one(`    <button onClick={() => setView('space')}>A</button>`)]]); return r.groups[0].list[0].comp; })(),
    'Shell');
  push('E9 分母对账：入口点枚数 = 各组枚数之和',
    (() => { const r = run([[A, one(`    <button onClick={() => setView('settings')}>A</button>\n    <button onClick={() => setView('tasks')}>B</button>`)], [B, one(`    <button onClick={() => setView('settings')}>C</button>`)]]); return [r.entries.length, r.groups.reduce((a, g) => a + g.list.length, 0)]; })(),
    [3, 3]);
  push('E10 阳性对照：多写一枚同面同仪式控件 ⇒ 必须从 single 变 ritual-dup',
    (() => { const before = run([[A, one(`    <button onClick={() => setView('growth')}>A</button>`)]].slice(0)).groups[0].tier; const after = run([[A, one(`    <button onClick={() => setView('growth')}>A</button>\n    <button onClick={() => setView('growth')}>B</button>`)]].slice(0)).groups[0].tier; return [before, after]; })(),
    ['single', 'ritual-dup']);
  push('E11 section 族与 view 族**不互相合并**（目的地同名但族不同是两回事）',
    run([[A, one(`    <button onClick={() => setView('settings')}>A</button>\n    <button onClick={() => setTab('settings')}>B</button>`)]].slice(0)).groups.length,
    2);
  push('E12 非壳路径（如 packages/*）不参与"壳"分组，也不许制造候选',
    run([['packages/ui/src/x.tsx', one(`    <button onClick={() => setView('settings')}>A</button>\n    <button onClick={() => setView('settings')}>B</button>`)]].slice(0)).groups[0].list[0].shell,
    '(非壳)');
  push('E13 同文件两枚但**仪式不同**（一枚多设了 anchor）⇒ 只到 🟠 same-file，不判红',
    (() => {
      const body = `    <button onClick={() => { setSettingsAnchor('profile'); setView('growth'); }}>A</button>\n\n\n\n\n\n\n    <button onClick={() => setView('growth')}>B</button>`;
      return run([[A, one(body)]]).groups.map((g) => g.tier);
    })(),
    ['same-file']);
  push('E14 档位阶梯本身：🔴 只由"仪式相同"决定，与同不同文件无关（防止把跨文件的重复实现读成低风险）',
    (() => {
      const only = one(`    <button onClick={() => setView('notes')}>A</button>`);
      const pairSame = one(`    <button onClick={() => setView('notes')}>A</button>`);
      const pairDiff = one(`    <button onClick={() => { setSettingsAnchor('p'); setView('notes'); }}>A</button>\n\n\n\n\n\n\n    <button onClick={() => setView('notes')}>B</button>`);
      const single = run([[A, only]]).groups[0].tier;
      const acrossFiles = run([[A, pairSame], [B, pairSame]]).groups[0].tier;
      const sameFileDifferent = run([[A, pairDiff]]).groups[0].tier;
      return [single, acrossFiles, sameFileDifferent];
    })(),
    ['single', 'ritual-dup', 'same-file']);
  push('E15 `--strict` 只认 🔴 那一档：只有 🟠 时判红函数必须给 0（否则整仓壳文件会被误判红）',
    (() => {
      const diff = one(`    <button onClick={() => { setSettingsAnchor('profile'); setView('space'); }}>A</button>\n\n\n\n\n\n\n    <button onClick={() => setView('space')}>B</button>`);
      return strictFails(run([[A, diff]]).groups);
    })(),
    0);
  const nums = out.map((o) => Number(/^E(\d+)/.exec(o.name)?.[1] ?? 0));
  const seq = Math.max(...nums) === 15 && new Set(nums).size === 15;
  for (const o of out) console.log(`${o.ok ? '✅' : '🔴'} ${o.name}${o.ok ? '' : `  得到=${JSON.stringify(o.got)} 期望=${JSON.stringify(o.want)}`}`);
  console.log(`${seq ? '✅' : '🔴'} E15b 臂号连续（判的是上面 ${out.length} 枚：最大 ${Math.max(...nums)} ｜ 去重 ${new Set(nums).size}）`);
  const bad = out.filter((o) => !o.ok).length + (seq ? 0 : 1);
  console.log(`臂 ${out.length + 1} 枚，不符 ${bad}`);
  return bad === 0 ? 0 : 1;
}

/** 在真文件的内存副本上"多一个入口 / 少一个入口"，两个方向都必须动 ⇒ 证这尺会红。
 *  ⚠️ 两发都盯"重复入口组"（≥2 枚入口的组），不盯 🔴 那一档：🔴 要**仪式逐字相同**，
 *  而插入行的 ±5 行窗口与被模仿那一枚的窗口通常差几行 ⇒ 会落成 🟠，那不算本尺失灵。
 *  先注入再拆除（拆的就是刚注入那一枚）⇒ 两步都不依赖"树上恰好有没有两枚一组"这种会漂的形状。 */
function mutate(files, read) {
  const multi = (groups) => groups.filter((g) => g.list.length >= 2).length;
  const base = multi(scanFilesOnce(files, read).groups);
  const singles = scanFilesOnce(files, read).groups.filter((g) => g.tier === 'single');
  if (singles.length === 0) { console.log('🔴 分母里没有单入口的目的地 ⇒ 注入没地方落，变异臂打空，不判绿。'); return 1; }
  const pick = singles.find((g) => ['view', 'section'].includes(g.list[0].kind)) ?? singles[0];
  const e = pick.list[0];
  const t = read(e.file);
  if (!e.call.includes('setView') && !e.call.includes('setTab') && !e.call.includes('setSection') && !e.call.includes('openPanel') && !e.call.includes('setPanel') && !e.call.includes('setActiveView') && !e.call.includes('setActiveSection')) {
    console.log(`🔴 挑中的那一枚不是可复制的调用形状（${e.call}）⇒ 变异臂打空，不判绿。`);
    return 1;
  }
  const lineText = t.split('\n')[e.line - 1] ?? '';
  const insertAt = lineOffset(t, e.line) + lineText.length;
  const injected = `${t.slice(0, insertAt)}\n  const __MUTANT_ENTRY__ = () => { ${e.call}; };${t.slice(insertAt)}`;
  if (injected === t) { console.log('🔴 注入没写进文本 ⇒ 变异臂打空，不判绿。'); return 1; }
  const afterInject = multi(scanFilesOnce(files, (f) => (f === e.file ? injected : read(f))).groups);
  // 拆除：把刚注入那一枚的目的地改掉 ⇒ 该组回到单入口
  const strippedText = injected.replace("__MUTANT_ENTRY__ = () => { " + e.call, "__MUTANT_ENTRY__ = () => { setView('__MUTANT_OTHER__')");
  const afterStrip = multi(scanFilesOnce(files, (f) => (f === e.file ? strippedText : read(f))).groups);
  const d1 = afterInject - base;
  const d2 = afterStrip - afterInject;
  console.log(`基线重复入口组 ${base} 枚｜给 ${e.file}:${e.line} 那个目的地补一枚同文件入口 ⇒ 变化 ${d1}（期望 +1）` +
    `｜再把刚补的那枚改成别的目的地 ⇒ 变化 ${d2}（期望 -1）`);
  console.log(`  注入的形状：${e.call}`);
  if (d1 !== 1 || d2 !== -1) { console.log('🔴 本尺对"同一个目的地多一个入口"不敏感 ⇒ 拿它当门是假绿。'); return 1; }
  console.log('✅ 变异臂：两个方向都动，且各只动被点名的那一枚。');
  return 0;
}

function scanFilesOnce(files, read) {
  const entries = [];
  let dynamic = 0;
  const dynAt = [];
  for (const f of files) {
    let t;
    try { t = read(f); } catch { continue; }
    const r = scanText(f, t);
    entries.push(...r.entries);
    dynamic += r.dynamic;
    dynAt.push(...r.dynAt);
  }
  return { ...judge(entries), entries, dynamic, dynAt };
}

const isMain = (() => { try { return import.meta.url === pathToFileURL(process.argv[1] ?? '').href; } catch { return false; } })();
if (isMain) {
    const argv = process.argv.slice(2);
    if (argv.includes('--self-test')) process.exit(selfTest());
    const scopeI = argv.indexOf('--scope');
    const scope = scopeI < 0 ? '' : argv[scopeI + 1];
    const topI = argv.indexOf('--top');
    const top = topI < 0 ? MAX_LIST : Number(argv[topI + 1]);
    const strict = argv.includes('--strict');
    const useHead = argv.includes('--head');
    const files = git(['ls-tree', '-r', '--name-only', 'HEAD']).split('\n')
      .filter((f) => SHELL_RE.test(f) && SCAN_EXT.test(f))
      .filter((f) => !scope || f.startsWith(scope));
    const read = useHead ? (f) => git(['show', `HEAD:${f}`]) : readWorktree;
    if (argv.includes('--mutate')) process.exit(mutate(files, read));
    if (files.length === 0) { console.log('🔴 分母为空：HEAD 里一枚壳内源码都没列出 ⇒ 本尺没干活，不许读成"没有重复入口"。'); process.exit(2); }
    const r = scanFilesOnce(files, read);
    const ritual = r.groups.filter((g) => g.tier === 'ritual-dup');
    const same = r.groups.filter((g) => g.tier === 'same-file');
    const cross = r.groups.filter((g) => g.tier === 'cross-file');
    console.log(
      `重复入口探针 ｜ 分母 ${files.length} 枚壳内源码｜ 字面量入口 ${r.entries.length} 枚` +
      `｜ 目的地组 ${r.groups.length}（🔴 仪式重复 ${ritual.length} ｜ 🟠 同文件多入口但仪式不同 ${same.length} ｜ 🟡 同壳跨文件 ${cross.length} ｜ 单入口 ${r.groups.length - ritual.length - same.length - cross.length}）` +
      `｜ 动态写法 ${r.dynamic} 枚判不了｜ ⚪ 跨壳同目的地 ${r.crossShell.length} 组不判`,
    );
    console.log('  · 射程声明：只认**字面量**目的地；动态写法（导航表 `.map` 里那种）静态判不了 ⇒ "没有重复入口"这句不许由本尺的 0 候选得出；' +
      '「两处都能编辑」这一族**没覆盖**（要跨组件对账 state 的语义），是未判定不是查过没有。');
    if (ritual.length + same.length + cross.length > 0) {
      console.log('\n候选（🔴 仪式重复先，🟠 同文件多入口、🟡 跨文件都要人看但本尺不判红）：');
      for (const g of [...ritual, ...same, ...cross].slice(0, top)) {
        const mark = g.tier === 'ritual-dup' ? '🔴' : g.tier === 'same-file' ? '🟠' : '🟡';
        console.log(`   ${mark} ${g.key} ｜ ${g.list.length} 枚入口`);
        for (const e of g.list) console.log(`        ${e.file}:${e.line} 组件 ${e.comp}`);
      }
      const n = ritual.length + same.length + cross.length;
      if (n > top) console.log(`   …另有 ${n - top} 组（加 --top 500 全列）`);
    } else {
      console.log('\n✅ 字面量这一族里没有重复入口（动态那一族仍未判定）');
    }
    if (r.dynAt.length > 0) {
      console.log(`\n要人眼看的（动态目的地 ${r.dynAt.length} 处，列前 ${Math.min(top, r.dynAt.length)}）：`);
      for (const d of r.dynAt.slice(0, top)) console.log(`   ${d.file}:${d.line}`);
    }
    console.log(`\n🔴 仪式重复 ${ritual.length} 组（🟠/🟡 两档只列不判红）${strict ? '' : '｜诊断尺默认退 0，加 --strict 才判红'}`);
    process.exit(strict && ritual.length > 0 ? 1 : 0);
}
