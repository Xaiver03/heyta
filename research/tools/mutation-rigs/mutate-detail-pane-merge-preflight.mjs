#!/usr/bin/env node
/**
 * `scripts/verify-detail-pane-merge-preflight.mjs` 的**分档**回归臂（工单 §8.68）。
 *
 * 守的是一件事：预检把红分成三档 ——
 *   合并造成的红 / 候选红但对照组没有这道脚本 / 两边都红（不含合并信息）。
 * 2026-10-04 17:0x 实测到的缺陷是第二档曾经不存在：`'MISS' !== 0` 为真，于是**只在新分支有的门禁**
 * 在产物里变红时被并进第三档（那句"不含合并信息"恰好说反）、只打 ⚠️、且不计入退出码。
 * 判据本身有装置（`mutate-detail-pane-status-table.mjs`），**载体没有** —— 本装置补的就是载体那一层。
 *
 * 跑法（linked worktree 里别用 `pnpm run`）：
 *   node research/tools/mutation-rigs/mutate-detail-pane-merge-preflight.mjs
 * 前提：`main` 与本检出可见，且 §8 落地记录表**已修好**（否则第一档的靶会换，脚本会响亮报错而不是猜）。
 *
 * 三条臂：
 *   P1 未处置的候选树（对面那 13 行旧抄件还在）⇒ 第二档 = 1、那一行打 🔴、退出码里数着它
 *   P2 把对面那 13 行丢掉（= §8.16 §4 的 ⑦ 那一步处置）⇒ 第二档 = 0
 *      🔴 P1 与 P2 必须**成对**：只有 P1 就不知道这一档是不是恒红（装饰），只有 P2 就不知道它会不会响。
 *   P3 对照 `--a main --b main` ⇒ 不该有"合并造成的红"、不该有"候选红但缺对照"，而**必须**有
 *      "产物里没这些脚本" ≥ 1（main 还没有本线那三枚判据 —— 这一条就是第四档存在的理由）
 * 另外 P1 还断言那枚红带着门禁全文（不是 `not a git repository` 那一类探针故障）。
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const repoRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
const CARRIER = join(repoRoot, 'scripts', 'verify-detail-pane-merge-preflight.mjs');
const DOC = 'docs/plans/detail-pane-alignment.md';
const notes = [];
const fail = [];
const check = (arm, cond, detail) => (cond ? notes : fail).push(`  ${cond ? '✅' : '🔴'} ${arm}${detail ? ` —— ${detail}` : ''}`);

const git = (args) => execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8', maxBuffer: 1 << 28 }).trim();

// —— 候选树号（不改动任何分支）
let tree = '';
try {
  tree = git(['merge-tree', '--write-tree', '--name-only', 'main', 'HEAD']).split('\n')[0].trim();
} catch (e) {
  tree = String(e.stdout || '').split('\n')[0].trim();
}
if (!/^[0-9a-f]{40}$/.test(tree)) {
  console.error('🔴 拿不到候选树 —— 本装置没有读数。');
  process.exit(2);
}

const layDown = (rev, where) => {
  mkdirSync(where, { recursive: true });
  execFileSync('sh', ['-c', `git archive '${rev}' | tar -x -C '${where}'`], { cwd: repoRoot, stdio: 'inherit' });
  return where;
};
const scratch = mkdtempSync(join(tmpdir(), 'dp-carrier-'));
const raw = layDown(tree, join(scratch, 'raw'));
const resolved = layDown(tree, join(scratch, 'resolved'));

// —— P2 的处置：把表外那段旧抄件整段丢掉（形状与 §8.16 §4 ⑦ 一致）
// 🔴 段的定位**从判据的读数来**，不自己猜形状：第一版写成"找第一段连续三行 `| W…`"，
// 命中的却是修好的那张表自己（表体本来就是连续 16 行）—— 于是删掉 16 行**合法**行，
// P2 报"处置后仍是 1"，看起来像判据坏了，其实是处置没处置到靶。
// 判据在**未处置**的候选树上按预期就是红的（那 13 枚孤儿行就是本装置的靶），
// 所以这一趟必须收 e.stdout —— 直接 execFileSync 会在非零退出时抛出来，装置以崩代读。
let gateRaw = '';
try {
  gateRaw = execFileSync(
    process.execPath,
    [join(repoRoot, 'scripts/check-detail-pane-status-table.mjs'), '--root', raw],
    { cwd: repoRoot, encoding: 'utf8', maxBuffer: 1 << 28 },
  );
} catch (e) {
  gateRaw = `${e.stdout || ''}${e.stderr || ''}`;
}
const reg = gateRaw.match(/表区间：第 (\d+) 行起，连续 (\d+) 枚/);
if (!reg) {
  console.error('🔴 读不到判据的"表区间"那行 —— 输出格式变了，本装置不知道怎么定位旧抄件，拒绝猜。');
  rmSync(scratch, { recursive: true, force: true });
  process.exit(2);
}
const UNITROW = /^\|\s*W[0-9]+[a-z]?/;
const docPath = join(resolved, DOC);
const lines = readFileSync(docPath, 'utf8').split('\n');
const regionLast = Number(reg[1]) + Number(reg[2]); // 1-based：表区间最后一行所在行号
let staleStart = -1;
for (let i = regionLast; i < lines.length; i += 1) {
  if (UNITROW.test(lines[i]) && UNITROW.test(lines[i + 1] || '')) {
    staleStart = i;
    break;
  }
}
if (staleStart === -1) {
  console.error(`🔴 表区间（到第 ${regionLast} 行）之外找不到连续的旧抄件行 —— 合流面变了，本装置没有靶。`);
  rmSync(scratch, { recursive: true, force: true });
  process.exit(2);
}
let staleEnd = staleStart;
while (UNITROW.test(lines[staleEnd + 1] || '')) staleEnd += 1;
const dropped = staleEnd - staleStart + 1;
lines.splice(staleStart, dropped);
writeFileSync(docPath, lines.join('\n'), 'utf8');

const runCarrier = (productDir) => {
  try {
    const out = execFileSync(process.execPath, [CARRIER, '--product', productDir], {
      cwd: repoRoot,
      encoding: 'utf8',
      maxBuffer: 1 << 28,
    });
    return { rc: 0, out };
  } catch (e) {
    return { rc: e.status ?? 1, out: `${e.stdout || ''}${e.stderr || ''}` };
  }
};
const tally = (out) => {
  const line = out.split('\n').find((l) => l.startsWith('TREE='));
  const num = (re) => Number((line.match(re) || [])[1] ?? -1);
  return {
    mergeRed: num(/合并造成的红=(\d+)/),
    noControl: num(/没有这道脚本（本分支新增，只能拿本分支读数定性）=(\d+)/),
    missing: num(/产物里根本没有这道脚本（这一道没跑）=(\d+)/),
    both: num(/不含合并信息）=(\d+)/),
  };
};

const p1 = runCarrier(raw);
const t1 = tally(p1.out);
check(
  'P1 未处置候选树 → 红落进"没有对照组"那一档，且不许落进"不含合并信息"，产物里也不许缺脚本',
  t1.noControl >= 1 && t1.both === 0 && t1.missing === 0 && /🔴 check-detail-pane-status-table/.test(p1.out),
  `没有对照组=${t1.noControl} 两边都红=${t1.both} 产物缺脚本=${t1.missing}`,
);

const p2 = runCarrier(resolved);
const t2 = tally(p2.out);
check(
  'P2 丢掉对面那批旧抄件 → 那一档归零（证明它会归零，不是恒红装饰）',
  t2.noControl === 0 && t2.missing === 0 && t1.noControl >= 1,
  `处置前 ${t1.noControl} → 处置后 ${t2.noControl}（丢掉 ${dropped} 行，从第 ${staleStart + 1} 行起）`,
);

let p3;
try {
  p3 = { rc: 0, out: execFileSync(process.execPath, [CARRIER, '--a', 'main', '--b', 'main'], { cwd: repoRoot, encoding: 'utf8', maxBuffer: 1 << 28 }) };
} catch (e) {
  p3 = { rc: e.status ?? 1, out: `${e.stdout || ''}${e.stderr || ''}` };
}
const t3 = tally(p3.out);
// 🔴 P3 断的是**第四档**：`--a main --b main` 时产物与对照都是 main，那三枚本线判据压根不在树里。
// 修之前那一版把"没跑"当成"候选红但缺对照"（`'MISS' !== 0` 为真，与它要修的缺陷同一个形状，
// 只是换了一侧），于是这一趟会报"无对照=3"。现在这两档必须分开，而且分得看得见。
check(
  'P3 对照 main×main → 不该有"合并造成的红"，也不该有"候选红但缺对照"；只许报"产物里没这些脚本"',
  t3.mergeRed === 0 && t3.noControl === 0 && t3.missing >= 1,
  `合并=${t3.mergeRed} 无对照=${t3.noControl} 产物缺脚本=${t3.missing}（>0 才是这一趟的正确说法）`,
);

// 载体自己的门禁必须还在（P1 的红来自真门禁，不是来自崩栈）
check(
  'P1 的输出里那枚红带着门禁全文（不是 "not a git repository" 那一类探针故障）',
  p1.out.includes('表外的孤儿工单行') && !p1.out.includes('not a git repository'),
  `全文命中 表外的孤儿工单行=${p1.out.includes('表外的孤儿工单行')}`,
);

rmSync(scratch, { recursive: true, force: true });
if (!existsSync(CARRIER)) console.error('🔴 载体脚本不在了');

console.log(`\n读数：载体 ${CARRIER.split('/').pop()}｜候选树 ${tree.slice(0, 8)}｜旧抄件段 ${dropped} 行`);
console.log(`\n${[...notes, ...fail].join('\n')}`);
if (fail.length) {
  console.log(`\n🔴 ${fail.length}/${notes.length + fail.length} 臂不合格`);
  process.exit(1);
}
console.log('\n结论：预检的门禁分档本身有回归臂（成对的"会响 / 会归零" + 那一趟只许报缺脚本的对照）✅');
