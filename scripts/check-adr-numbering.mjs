#!/usr/bin/env node
/**
 * ADR **编号唯一性 + 裸引用可判别性**（常驻门禁，不占设备，纯读盘）。
 *
 * ## 为什么要有这条
 *
 * 2026-10-05 实测撞号：两条会话在同一天各自写下 `ADR-0053`（一枚讲退款域收窄，一枚讲出境目的地的地址类别）。
 * **文件名不同 ⇒ git 连冲突都不报**；`check:docs` 的死链检查也不报（每条链接都指向真实存在的文件）。
 * 于是仓库里同时躺着两枚 0053，而正文里大量出现**裸写**的 `ADR-0053 §5 第 11 条` ——
 * 那句话从此有两种读法，而"两种读法都不会让任何东西失败"才是问题：
 * 读者会挑错那一枚去执行。修法分两层：先把后来那一枚改号（0056），再让这种形状**下次必然红**。
 *
 * ## 判据（三条，逐条可失败）
 *
 *  ① **同号唯一**：`docs/adr/NNNN-*.md` 的数字前缀不许出现两次。
 *  ② **裸引用可判别**：不带链接的 `ADR-NNNN` 必须唯一解析到一枚文件；
 *     解析到 0 枚（悬空）或 ≥2 枚（歧义）都算红。
 *     markdown 链接的文字部分（`[ADR-0099](../adr/0099-one.md)`）**不算裸引用** —— 它自己带路径消歧。
 *  ③ **阳性对照**：必须真的读到 ADR 文件与裸引用；读到 0 枚就 `exit 2` 报探针，
 *     而不是报"全部合规"（这一条挡的是"目录形状换了 ⇒ 门禁永远绿"）。
 *
 * `--self-test` 用夹具逐臂证明 ①② 真会红、假缺陷真不红（臂数由它自己打印，文档里不许抄）。
 * 其中一臂钉的是**计数本身**（`裸引用=1` 而夹具里有 1 条裸写 + 2 条链接）——
 * 只有"链接被误当裸引用"时那个数会变成 3，所以这条臂挡得住假缺陷那一侧。
 */
import { existsSync, readFileSync, readdirSync, mkdirSync, rmSync, writeFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = process.cwd();
const ADR_NAME = /^\d{4}-.*\.md$/;
const BARE = /ADR-(\d{4})/g;
const SCAN_ROOTS = ['docs', 'packages', 'apps', 'server', 'scripts', 'research', 'AGENTS.md', 'CONTRIBUTING.md'];
// 🔴 本文件自己不扫：它的夹具里写着 `ADR-0099` 这种**故意不存在**的号（臂 C 靠它证明"悬空会红"）。
// 把它算进射程 ⇒ 门禁自己制造红，而这正是它要抓的形状。
const SELF = 'scripts/check-adr-numbering.mjs';
const SKIP_DIRS = new Set([
  'node_modules', 'dist', 'build', 'test-results', 'generated', 'dist-types', 'coverage',
  'android', 'ios', 'hooks', 'Pods', 'DerivedData', '.next', 'vendor',
]);

function die(msg, code = 2) {
  console.error(msg);
  process.exit(code);
}

function walk(dir, acc = []) {
  let names;
  try {
    names = readdirSync(dir);
  } catch {
    return acc;
  }
  for (const name of names) {
    if (SKIP_DIRS.has(name)) continue;
    const p = join(dir, name);
    let st;
    try {
      st = statSync(p);
    } catch {
      continue;
    }
    if (st.isDirectory()) walk(p, acc);
    else if (/\.(md|ts|tsx|mjs|cjs|js|swift|kt|ets|c|h|cs|java)$/.test(name)) acc.push(p);
  }
  return acc;
}

function listFiles(root) {
  const out = [];
  for (const r of SCAN_ROOTS) {
    const abs = join(root, r);
    if (!existsSync(abs)) continue;
    const st = statSync(abs);
    if (st.isFile()) out.push(abs);
    else for (const p of walk(abs)) out.push(p);
  }
  return out;
}

/**
 * 取裸引用。
 *
 * 🔴 链接文字要跳过，而判据是**左邻字符**：markdown 链接写成 `[ADR-0099](…)`，
 * 前一枚字符是 `[`。第一版在这里数过右邻、也想过解析整条链接，两种都比这更容易漏 ——
 * 漏的方向是把消歧过的引用也算成裸写（假缺陷），或把真裸写放过（假绿）。
 */
function bareRefs(root, files) {
  const hits = [];
  for (const abs of files) {
    let text;
    try {
      text = readFileSync(abs, 'utf8');
    } catch {
      continue;
    }
    for (const m of text.matchAll(BARE)) {
      if (text[m.index - 1] === '[') continue;
      const line = text.slice(0, m.index).split('\n').length;
      hits.push({ num: m[1], at: `${abs.slice(root.length + 1)}:${String(line)}` });
    }
  }
  return hits;
}

function check(root) {
  const adrDir = join(root, 'docs', 'adr');
  if (!existsSync(adrDir)) {
    die(`🔴 读不到 ${adrDir} —— ADR 目录换了名字要先改这条门禁，不然它会把"没有 ADR"读成"编号都合规"。`);
  }
  const files = readdirSync(adrDir).filter((n) => ADR_NAME.test(n));
  const byNum = new Map();
  for (const name of files) {
    const num = name.slice(0, 4);
    byNum.set(num, [...(byNum.get(num) ?? []), name]);
  }
  const dup = [...byNum].filter(([, names]) => names.length > 1).map(([num, names]) => ({ num, names }));
  const selfAbs = join(root, SELF);
  const bare = bareRefs(root, listFiles(root).filter((p) => p !== selfAbs));
  const ambiguous = [];
  const dangling = [];
  for (const h of bare) {
    const names = byNum.get(h.num) ?? [];
    if (names.length === 0) dangling.push(h);
    else if (names.length > 1) ambiguous.push({ ...h, count: names.length });
  }
  return { fileCount: files.length, bareCount: bare.length, dup, ambiguous, dangling };
}

function report(r, label) {
  for (const d of r.dup) console.log(`同号\t${d.num}\t${d.names.join(' | ')}`);
  for (const a of r.ambiguous) console.log(`歧义引用\t${a.at}\tADR-${a.num}\t这个号有 ${String(a.count)} 枚文件`);
  for (const d of r.dangling) console.log(`悬空引用\t${d.at}\tADR-${d.num}\t没有对应文件`);
  console.log(
    `SUMMARY ADR文件=${String(r.fileCount)} 裸引用=${String(r.bareCount)} 同号=${String(r.dup.length)} ` +
      `歧义=${String(r.ambiguous.length)} 悬空=${String(r.dangling.length)}（${label}）`,
  );
}

function main() {
  const args = process.argv.slice(2);
  const i = args.indexOf('--root');
  const root = i >= 0 ? args[i + 1] : ROOT;
  const r = check(root);
  report(r, i >= 0 ? '夹具' : '真仓库');
  // 判据 ③：阳性对照。读到 0 就是探针坏了 —— 那时长得最像"全部合规"。
  if (r.fileCount === 0 || r.bareCount === 0) {
    die('🔴 一枚 ADR 或一条裸引用都没读到 —— 目录形状或引用写法换了，本次"编号唯一"不可信（报探针，不报合规）');
  }
  if (r.dup.length + r.ambiguous.length + r.dangling.length > 0) {
    console.log('🔴 ADR 编号或裸引用不可判别 —— 同号让"ADR-NNNN §x"有两种读法，而挑错那一种不会有任何东西失败。');
    return 1;
  }
  console.log('✅ ADR 号唯一，每条裸引用都只指向一枚文件');
  return 0;
}

if (process.argv.includes('--self-test')) {
  const dir = join(ROOT, 'tmp/adr-numbering-selftest');
  const two = {
    'docs/adr/0099-one.md': '# ADR-0099：一\n',
    'docs/adr/0099-two.md': '# ADR-0099：二\n',
    'docs/plans/x.md': '判据见 ADR-0099 §5。\n',
  };
  const fixtures = [
    { name: '臂 A 两枚同号 ⇒ 红，理由是"同号"', files: two, wantRed: true, want: '同号' },
    { name: '臂 B 同号 + 裸引用 ⇒ 红，理由是"歧义引用"', files: two, wantRed: true, want: '歧义引用' },
    {
      name: '臂 C 引用一个不存在的号 ⇒ 红，理由是"悬空引用"',
      files: { 'docs/adr/0099-one.md': '# ADR-0099：一\n', 'docs/plans/x.md': '判据见 ADR-0099 §5，另见 ADR-0098 §2。\n' },
      wantRed: true,
      want: '悬空引用',
    },
    {
      name: '臂 D 号唯一且裸引用可判别 ⇒ 绿',
      files: { 'docs/adr/0099-one.md': '# ADR-0099：一\n', 'docs/plans/x.md': '判据见 ADR-0099 §5。\n' },
      wantRed: false,
      want: null,
    },
    {
      // 这一臂钉的是**计数**：夹具里 2 枚 ADR 的标题行各算 1 条裸写（号唯一 ⇒ 绿），
      // plans 那行有 1 条裸写 + 2 条 markdown 链接。所以正确读数是 3，
      // 而"把链接文字也算成裸引用"会读成 5 —— 这条臂挡的正是门禁自己制造假缺陷那一侧。
      name: '臂 E 链接文字不算裸引用 ⇒ 绿，且 SUMMARY 必须写 裸引用=3',
      files: {
        'docs/adr/0099-one.md': '# ADR-0099：一\n',
        'docs/adr/0098-two.md': '# ADR-0098：二\n',
        'docs/plans/x.md': '见 [ADR-0099](../adr/0099-one.md) 与 [ADR-0098 §2](../adr/0098-two.md)；裸写一处：ADR-0099。\n',
      },
      wantRed: false,
      want: '裸引用=3',
    },
  ];
  let fail = 0;
  for (const fx of fixtures) {
    rmSync(dir, { recursive: true, force: true });
    for (const [rel, content] of Object.entries(fx.files)) {
      const abs = join(dir, rel);
      mkdirSync(join(abs, '..'), { recursive: true });
      writeFileSync(abs, content);
    }
    const kid = spawnSync(process.execPath, [join(ROOT, 'scripts/check-adr-numbering.mjs'), '--root', dir], {
      encoding: 'utf8',
      cwd: ROOT,
    });
    const out = `${kid.stdout ?? ''}${kid.stderr ?? ''}`;
    const red = kid.status !== 0;
    const hasReason = fx.want === null || out.includes(fx.want);
    const ok = red === fx.wantRed && hasReason;
    console.log(`${fx.name}：${ok ? 'OK' : 'FAIL'}（red=${String(red)} want=${String(fx.wantRed)} 理由在场=${String(hasReason)}）`);
    if (!ok) {
      console.log(out.split('\n').slice(0, 5).join('\n'));
      fail += 1;
    }
  }
  rmSync(dir, { recursive: true, force: true });
  console.log(`ARMS=${String(fixtures.length)} FAIL=${String(fail)}`);
  process.exit(fail === 0 ? 0 : 1);
}

process.exit(main());
