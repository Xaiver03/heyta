// `selfhost-chain-preflight.mjs` —— 落地前把 `package.json` 那条 `check` 链的交叉**离线量一遍**。
//
// 为什么要有它（现量结论见 docs/research/self-host-distribution-audit.md §8.105）：
// 落地阻塞集被当布尔用了三个小时，而"等什么"必须先等于"等什么形状"——
// 主检出那两枚脏文件里，`.gitignore` 与本批零交叉，`package.json` 改的**正是本批也改的那一行**。
// 那一族在载体里本来就有自动解法（scripts 键并集 + 链段并集 + "只增不减"前提断言），
// 但"自动解法这次成不成立"要现场量：量出来摘段=0 才敢说窗口开了不会白烧。
//
// 三条读数（都是纯读盘，不写任何东西、不动主检出）：
//  ① 四股链的段数：merge-base / main HEAD / main **工作树未提交** / 本分支，以及 main∪分支 的并集；
//  ② 载体第 1 族的断言③④ 在离线三股上先跑一遍（任何方向出现摘段 ⇒ 落地会 die 要人拍，先知道）；
//  ③ 主检出未提交**新增**的链段逐条列出，并查它的实现在 main 里是"已提交"还是"未跟踪"——
//     未跟踪那一档就是"他们提交了链却忘了 add 实现"的风险面（§8.105 那张表）。
//
// 段切法与 `scripts/check-gate-wiring.mjs`、载体第 1 族**逐字一致**（按 `&&` 切、trim、去空）。
// 不一致的话这里量到的并集就不是载体要写回的那个对象。
//
// 用法：node research/tools/selfhost-chain-preflight.mjs        # 默认对 main
//       node research/tools/selfhost-chain-preflight.mjs <ref>  # 换一支（排障用）
// ⚠️ 换成**没被主检出签出**的那支 ref 时（落地前先看 `origin/main` 就是这种），
//    第 4 格与"未提交新增段"两格自动标成不适用：它们拿的是主检出那棵树的工作树字节，
//    而工作树签出的是别的一笔。判词（载体能不能自动解）只取前三格之和。
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const MAIN_REF = process.argv[2] ?? 'main';
const git = (a) => execFileSync('git', ['-C', REPO, ...a], { encoding: 'utf8' });

// 主检出 = `git worktree list` 的第一条（linked worktree 里 `main` 不等于"当前目录"，
// 而这里要的正是**别人那棵树的工作树字节**，不是我的）。
const worktreeLines = git(['worktree', 'list', '--porcelain'])
  .split('\n')
  .filter((l) => l.startsWith('worktree '))
  .map((l) => l.slice('worktree '.length));
const MAIN_DIR = worktreeLines[0];
if (!MAIN_DIR || !existsSync(join(MAIN_DIR, 'package.json'))) {
  console.error('❌ 取不到主检出目录（`git worktree list --porcelain` 第一条）。判红而不是跳过。');
  process.exit(2);
}

const segs = (chain) => chain.split('&&').map((s) => s.trim()).filter(Boolean);
const readChain = (text) => {
  const pkg = JSON.parse(text);
  return { chain: segs(pkg.scripts?.check ?? ''), keys: Object.keys(pkg.scripts ?? {}) };
};
const fromRef = (ref) => readChain(git(['show', `${ref}:package.json`]));
const fromDisk = (dir) => readChain(readFileSync(join(dir, 'package.json'), 'utf8'));

const baseSha = git(['merge-base', MAIN_REF, 'HEAD']).trim();
const B = fromRef(baseSha);
const M = fromRef(MAIN_REF);
const W = fromDisk(MAIN_DIR);
const T = fromRef('HEAD');
const onlyIn = (a, b) => a.filter((x) => !b.includes(x));
const union = [...new Set([...M.chain, ...T.chain])];

console.log(`主检出=${MAIN_DIR}`);
console.log(`base=${baseSha.slice(0, 8)} ${MAIN_REF}=${git(['rev-parse', '--short', MAIN_REF]).trim()} HEAD=${git(['rev-parse', '--short', 'HEAD']).trim()}`);
console.log(`段数：base=${B.chain.length} ${MAIN_REF}=${M.chain.length} ${MAIN_REF}工作树(未提交)=${W.chain.length} 本分支=${T.chain.length} ⇒ (${MAIN_REF}∪本分支)=${union.length}`);

const lostFromUnion = B.chain.filter((s) => !union.includes(s));
const dirs = {
  '并集 vs base': lostFromUnion,
  [`${MAIN_REF} vs base`]: B.chain.filter((s) => !M.chain.includes(s)),
  '本分支 vs base': B.chain.filter((s) => !T.chain.includes(s)),
};

/**
 * 第四格拿的是**主检出那棵树的工作树字节**，所以它只在"这一支 ref 就是那棵树签出的那一笔"时成立。
 * 把预检打在一支没被签出的 ref 上（例如落地前先看 `origin/main`）时，工作树比 ref 旧 ⇒
 * ref 自己新增的段会被这条读成"摘段"，于是判词喊一句**必然出现的假红**。
 * 2026-10-05 13:5x 实测：`origin/main` 那一趟的"摘段=5"里四条是 detail-pane 段、一条是
 * `check:image-build-args` —— 全是 origin/main 有而陈旧工作树没有的段，与载体的自动解能力无关。
 */
const treeHead = git(['-C', MAIN_DIR, 'rev-parse', 'HEAD']).trim();
const refSha = git(['rev-parse', MAIN_REF]).trim();
const diskComparable = treeHead === refSha;
console.log(`\n摘段四格（判词取**前三格之和**；第 4 格问的是别的事，单独报不进判词）：`);
for (const [name, lost] of Object.entries(dirs)) {
  console.log(`  摘段 ${name} = ${lost.length}${lost.length ? ` ⇒ ${lost.join(' | ')}` : ''}`);
}
const diskLost = diskComparable ? M.chain.filter((s) => !W.chain.includes(s)) : [];
console.log(`  ${diskComparable
  ? `摘段 ${MAIN_REF}工作树 vs ${MAIN_REF} = ${diskLost.length}${diskLost.length ? ` ⇒ ${diskLost.join(' | ')}` : ''}`
  : `第 4 格**不适用**：主检出签出的是 ${treeHead.slice(0, 8)}，不是 ${MAIN_REF}=${refSha.slice(0, 8)} ⇒ ` +
    `拿陈旧工作树比这支 ref 只会读到"这支 ref 新增的段"，那不是摘段`}`);

/**
 * 判词只取**前三格**（并集/main/本分支各自 vs base）之和 —— 它们才是"载体第 1 族会不会停下来要人拍"的等价物，
 * 而且每一格都能红：拿一支把某段摘掉的合成 ref 打，第 2 格就是 1（今天实测过）。
 * 第 4 格问的是另一件事（他们未提交的链里有没有没 add 的实现），已经单独报，不进判词。
 */
const erosion = Object.values(dirs).reduce((n, lost) => n + lost.length, 0);
const theirNew = diskComparable ? onlyIn(W.chain, M.chain) : [];
console.log(`\n主检出未提交**新增**的链段 = ${diskComparable ? `${theirNew.length}：${theirNew.map((s) => (s.match(/check:[a-z0-9:._-]+/i) ?? ['?'])[0]).join(', ') || '无'}` : '不适用（工作树签出的不是这支 ref ⇒ 这格读不出来，**不是 0**）'}`);
// 每一段去找它的实现文件在 main 里是已提交还是未跟踪 —— 未跟踪那一档是"提了链忘了 add 文件"的风险面。
const trackedList = new Set(git(['-C', MAIN_DIR, 'ls-files']).split('\n').filter(Boolean));
const risky = [];
for (const seg of theirNew) {
  const key = (seg.match(/check:[a-z0-9:._-]+/i) ?? [null])[0];
  if (!key) continue;
  const cmd = JSON.parse(readFileSync(join(MAIN_DIR, 'package.json'), 'utf8')).scripts?.[key];
  const file = cmd ? (cmd.match(/(?:node|bash|sh)\s+([\w./-]+\.(?:mjs|cjs|js|sh))/) ?? [])[1] : null;
  const state = !file ? '读不出实现路径' : trackedList.has(file) ? '已跟踪' : '未跟踪 🔴';
  if (state !== '已跟踪') risky.push(`${key} → ${file ?? '?'}（${state}）`);
  console.log(`  · ${key} → ${file ?? '?'}  ${state}`);
}

console.log(`\n结论：三格（并集/${MAIN_REF}/本分支 各自 vs base）摘段合计=${erosion} ${erosion === 0 ? '⇒ 载体第 1 族这次可以自动解（不会停下来要人拍）' : '⇒ 🔴 会 die，要人先判'}`);
if (!diskComparable) {
  console.log(`      ⚠️ 这一趟的第 4 格与"未提交新增段"两格**不适用**（工作树签出的不是 ${MAIN_REF}），` +
    `所以这趟只答"载体能不能自动解"，不答"他们未提交的链里有没有没 add 的实现"。`);
}
console.log(`      主检出那批新链段里实现未跟踪的 ${diskComparable ? `${risky.length} 枚${risky.length ? `：\n      ${risky.join('\n      ')}` : ''}` : '不适用'}`);
if (diskComparable) console.log('      （未跟踪不是本批的债：那一类红要逐条归属到非本批，不代改、不摘段 —— §8.105）');
/**
 * 判红就要**退出去挡**：这句结论印"🔴 会 die，要人先判"却仍以 0 结束，等于把红留在纸面上、
 * 链上没人接（`&&` 的下一段照跑）。未跟踪实现那一档**不进**出口码 —— 它不是本批的债，
 * 按 §8.105 走逐条归属，不是把预检变成别人的门禁。
 */
process.exit(erosion > 0 ? 1 : 0);
