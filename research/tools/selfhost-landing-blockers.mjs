#!/usr/bin/env node
// 落地阻塞集现量（一次性命令算错过一次：`awk '{print substr($0,3)}'` 少跳一格 ⇒ 每条脏路径
// 带一个前导空格 ⇒ 与写集的交集恒为 0 ⇒ 读成"阻塞集已清空"，而真相是还有 3 枚没被所有者提交。
// **那次假读数长得比真相更好看**，所以这里把解析钉在一个带夹具的函数上，而不是再写一条 shell。）
//
// 不是门禁（刻意不带 check- 前缀，不挂进 pnpm check 链）；它只回答一个问题：
// "现在能不能落地，卡在谁手里"。
//
// 用法：node research/tools/selfhost-landing-blockers.mjs [--main=main] [--branch=REF]
//       --selftest-buggy-offset = 变异臂，把解析偏移改回那个错的 ⇒ 夹具必须红、退出码必须是 2
import { execFileSync } from 'node:child_process';
import process from 'node:process';

const argv = process.argv.slice(2);
const flag = (name, def) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : def;
};
const die = (msg, code = 1) => { console.error(`❌ ${msg}`); process.exit(code); };
const git = (args, cwd) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

if (argv.includes('--help')) {
  console.log('用法：node research/tools/selfhost-landing-blockers.mjs [--main=REF] [--branch=REF]');
  console.log('脏集合必须取自**签出 main 的那棵工作树**（别人未提交的东西在那儿）；本脚本按 worktree 列表自己找并打印出来。');
  process.exit(0);
}

const mainRef = flag('main', 'main');
const branchRef = flag('branch', 'feat/self-host-distribution');
const PATH_OFFSET = argv.includes('--selftest-buggy-offset') ? 2 : 3;

/* ── status -z 记录解析（单一函数 + 夹具） ───────────────────────────
 * 记录形状：`XY<SP>path`；rename/copy 时 git 再单独发一条**没有状态前缀**的旧路径。
 * `-z` 保证路径不被八进制引号改写，所以这里唯一的自由度就是那个偏移量。 */
function parseStatusRecords(recs) {
  const paths = new Set();
  for (let i = 0; i < recs.length; i++) {
    const rec = recs[i];
    const xy = rec.slice(0, 2);
    if (xy === '!!') continue;
    if (/^[RC]/.test(xy) && i + 1 < recs.length) { paths.add(recs[i + 1]); i++; }
    const p = rec.slice(PATH_OFFSET);
    if (p) paths.add(p);
  }
  return paths;
}

// 🔴 夹具先跑：解析层坏了就**不许**输出任何"阻塞集"读数。
const FIXTURE = [' M package.json', '?? docs/new.md', 'R  a.md', 'b.md', 'A  staged.ts'];
const fixtureOut = parseStatusRecords(FIXTURE);
const fixtureWanted = ['package.json', 'docs/new.md', 'a.md', 'b.md', 'staged.ts'];
const fixtureMiss = fixtureWanted.filter((p) => !fixtureOut.has(p));
if (fixtureMiss.length) {
  die(`解析层坏了：夹具里 ${fixtureMiss.length}/${fixtureWanted.length} 条路径没被解析成裸路径` +
    `（实际得到：${[...fixtureOut].map((p) => JSON.stringify(p)).join(' , ')}）` +
    ` ⇒ 本次**没有**可信的阻塞集读数，"为空"尤其不能当成放行。`, 2);
}

/* ── 找到"签出 main 的那棵工作树" ───────────────────────────────────── */
const wt = git(['worktree', 'list', '--porcelain']).split('\n\n').filter(Boolean).map((blk) => {
  const l = {};
  for (const line of blk.split('\n')) {
    if (line.startsWith('worktree ')) l.path = line.slice(9);
    if (line.startsWith('branch ')) l.branch = line.slice(7).replace('refs/heads/', '');
  }
  return l;
});
const mainWt = wt.find((w) => w.branch === mainRef);
if (!mainWt) die(`没找到签出 ${mainRef} 的工作树（worktree list 里有：${wt.map((w) => w.branch ?? '?').join(', ')}）`);

const base = git(['merge-base', mainRef, branchRef]).trim();
// 🔴 枚举源只能是 merge-base..分支：那才是合并**真会写进** main 的路径。
//    用 `git diff --name-only main 分支` 会得到几百条 main 自己新增、合并不写的文件（§8.52 记过）。
const writeSet = git(['diff', '--name-only', base, branchRef]).split('\n').filter(Boolean);
if (!writeSet.length) die(`写集为空（${base.slice(0, 8)}..${branchRef}）—— 分支相对 merge-base 一个字没改？先怀疑参数`);

const st = git(['status', '--porcelain=v1', '-z', '--untracked-files=all'], mainWt.path);
const dirty = parseStatusRecords(st.split('\0').filter(Boolean));
const blockers = writeSet.filter((p) => dirty.has(p));

const RESOLVE = {
  'package.json': '取并集（载体脚本已实现：写回 + 两侧原文建映射 + round-trip 断言）',
  'research/tools/check-image-license-coverage.mjs': '取本分支（我们的登记是他们那条的超集）',
  'server/image-npm-tree.json': '取本分支（旧载体的产物在新判据下自证失真）',
};

console.log(`主检出（脏集合来源）：${mainWt.path}`);
console.log(`${mainRef} = ${git(['rev-parse', '--short', mainRef], mainWt.path).trim()} · ${branchRef} = ${git(['rev-parse', '--short', branchRef], mainWt.path).trim()} · merge-base = ${base.slice(0, 8)}`);
console.log(`夹具：${fixtureWanted.length}/${fixtureWanted.length} 条通过 · 写集 ${writeSet.length} 枚 · 脏条目 ${dirty.size} 枚 · **阻塞集 ${blockers.length} 枚**`);
for (const p of blockers) console.log(`  BLOCK ${p}\n        落地解法：${RESOLVE[p] ?? '未预置 ⇒ 交人判（不要猜）'}`);
if (!blockers.length) console.log('  阻塞集为空（夹具已绿 ⇒ 这个"空"是可信读数）。');
