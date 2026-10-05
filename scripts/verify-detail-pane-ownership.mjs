#!/usr/bin/env node
/**
 * 详情面那一批的**归属门**判据（工单 §1 前置闸门第 1 道）。
 *
 * 它回答的是一句在**提交之前**问的话：
 *   "我现在要点名提交的这些文件，此刻有没有别人未提交的改动正落在上面？"
 *
 * 🔴 为什么现存的合流窗口判据（`verify-detail-pane-merge-window.mjs` Q1）不够：
 *   它那份"本批触及的文件"集合是从 `merge-base..HEAD` 取的 —— 只含**已提交**的路径。
 *   所以"这个文件我现在能不能动"这个问题，它在动手前**答不了**，只能事后确认。
 *   本批两次都是手查（`git -C 主检出 status --porcelain -- <路径>` 为空才动），
 *   查法稳定、重复出现、且判错一次的代价是把别人的未提交改动吸进我这一笔 ⇒ 该有常驻载体。
 *
 * 判据本体（三条，逐条都有臂）：
 *   1. 点名的每一条路径必须**在主检出里干净**（`git status --porcelain` 里没有它）。
 *   2. 点名的每一条路径必须**在本地检出里存在或被跟踪** —— "读不到"不许当成"没人占着"
 *      （写错路径名会让第 1 条在空集合上恒真，那是最像绿的一种红）。
 *   3. 两边根路径与分母都打出来：`主检出=<路径> 未提交=N 枚｜点名=M 条`。
 *      没有这行，"0 枚交叠"与"探针没跑到"在输出里长得一样。
 *
 * 跑法：
 *   node scripts/check-detail-pane-ownership.mjs <路径> [<路径>…] [--main <主检出>] [--self <本地检出>]
 * 退出码：
 *   0 = 点名的路径全部干净（可以动）
 *   1 = 有别人未提交的改动落在点名的路径上（`BLOCKED=` 逐条列出，附 porcelain 状态码）
 *   2 = **探针自己不可用**：没点名路径 / 找不到主检出 / 主检出不是 git 仓库 / 点名的路径本地也没有
 *       —— 坏探针不许报"可以动"，也不许报"被挡住"。
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const argv = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? dflt : argv[i + 1];
};
const paths = argv.filter((a, i) => !a.startsWith('--') && !(argv[i - 1] === '--main') && !(argv[i - 1] === '--self'));

const SELF = opt('self', process.cwd());
const broken = (msg) => {
  console.log(`VERDICT=PROBE_BROKEN ${msg}`);
  process.exit(2);
};
if (paths.length === 0) {
  broken('没有点名任何路径 —— 空清单上"全都在主检出干净"是永真的，拒绝报绿。');
}

const git = (cwd, args) => execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });

let main = opt('main', '');
if (!main) {
  let list = '';
  try {
    list = git(SELF, ['worktree', 'list', '--porcelain']);
  } catch (e) {
    broken(`本地检出不是 git 仓库（${SELF}）：${String(e.message).split('\n')[0]}`);
  }
  const trees = list
    .split('\n')
    .filter((l) => l.startsWith('worktree '))
    .map((l) => l.slice('worktree '.length));
  main = trees.find((p) => !p.includes('/.worktrees/') && !p.startsWith('/private/tmp') && !p.startsWith('/tmp'));
}
if (!main) broken('worktree 清单里没有非临时条目 ⇒ 找不到主检出');
try {
  git(main, ['rev-parse', '--git-dir']);
} catch {
  broken(`主检出不是 git 仓库：${main}`);
}

// 主检出的未提交集合：路径 → porcelain 状态码（X=暂存位，Y=工作树位；`??` = 未跟踪）。
const dirty = new Map();
for (const line of git(main, ['status', '--porcelain']).split('\n')) {
  if (!line.trim()) continue;
  const code = line.slice(0, 2);
  let p = line.slice(3);
  if (p.includes(' -> ')) p = p.split(' -> ').pop();
  dirty.set(p.trim(), code);
}

// 点名路径在本地检出的在场性：文件在，或被 git 跟踪着（删除类改动走后者）。
let trackedList = null;
const presentLocally = (p) => {
  if (existsSync(join(SELF, p))) return true;
  if (trackedList === null) {
    trackedList = new Set(git(SELF, ['ls-files']).split('\n').filter((l) => l.length > 0));
  }
  return trackedList.has(p);
};

const missing = paths.filter((p) => !presentLocally(p));
const blocked = paths.filter((p) => dirty.has(p));

console.log(`本地检出=${SELF}`);
console.log(`主检出=${main}`);
console.log(
  `承重：主检出未提交 ${dirty.size} 枚｜点名 ${paths.length} 条｜本地不在场 ${missing.length} 条｜被占 ${blocked.length} 条`,
);
for (const p of blocked) {
  console.log(`  🔴 ${p}  主检出状态码 ${JSON.stringify(dirty.get(p))}${dirty.get(p) === '??' ? '（未跟踪）' : ''}`);
}
for (const p of missing) {
  console.log(`  🔴 ${p}  本地检出里既不存在也没被跟踪 ⇒ 这条是**点错名**，不是"没人占着"`);
}

if (missing.length > 0) {
  console.log('VERDICT=PROBE_BROKEN 点名的路径有本地不在场的 —— 空集合上"全部干净"是永真的，拒绝报绿。');
  process.exit(2);
}
if (blocked.length > 0) {
  console.log(`BLOCKED=${blocked.length} 现在动这些文件 = 把别人未提交的改动吸进本笔。等对方提交，或另挑一个干净落点。`);
  process.exit(1);
}
console.log('VERDICT=CLEAN 点名的每一条在主检出都没有未提交改动 ⇒ 归属门放开。');
process.exit(0);
