#!/usr/bin/env node
/**
 * `research/tools/selfhost-merge-carrier.mjs` —— 把 `feat/self-host-distribution`
 * 合进 main 的那次合并**重算成一条命令**。
 *
 * ═══════════════════════════════════════════════════════════════════
 * 为什么是脚本，不是"文档里写清步骤"
 * ═══════════════════════════════════════════════════════════════════
 *
 * 落地那一刻要的是"main 前进到一个跑过完整链的载体"。而 main 在这台机器上**每两三分钟**
 * 前进一笔（2026-10-04 01:50→01:53→01:57 实测三笔），所以任何手算出来的载体在写完
 * 那一秒就过期。§8.29 记的第一次手算撞上的就是这个；本轮第二次手算（main=5d0b27b9，
 * 七条冲突逐个解完、五道纯 fs 门禁全绿）在**即将落笔的前一回合**又被
 * "main 已到 6afca90f" 顶回来 —— 那一回合什么都没做错，只是慢了一分钟。
 *
 * 更糟的是手算的**产出**也会漂：上一版提交说明里写 `.gitignore 213 行 = base 193 +
 * main 8 + 本批 13`，那个等式左右根本不相加（214≠213）。真相是 193+8+13=214 个
 * `split('\n')` 段 = `wc -l` 的 213 行（文件以换行结尾）。**手抄的数字连单位都会错**，
 * 所以这里的读数全部由脚本自己拼进提交说明，不由人复述。
 *
 * ## 九条冲突族与它们的解法（§8.22 预置 + 后续每次新增一族都写在这里，本文件是唯一执行者）
 *
 *  1. `package.json`：scripts 键并集 + `check` 链并集，带四条断言
 *     （两侧键不缺 / 两侧链段不缺 / 两侧各自相对顺序不颠倒 / 两侧相对 base 都不得摘段）。
 *     🔴 断言④是前提断言：并集脚本默认"只增不减"，谁摘了 base 的一段就必须停下来人判，
 *     否则摘掉的那段会被当成"另一边没有"而**静默消失**。
 *     第一版（手改）把冲突块按 main 侧收掉，症状是"合上了"而实际摘掉本批五道门禁。
 *     🔴 并集算出来还要**写回并 round-trip**（这段是 2026-10-04 现量补的，见下面第 1 族的注释：
 *     main 先吸收了整批 ⇒ tChain ⊆ oChain，"没写回"这个洞一直不被任何输入触发）。
 *  2. `.gitignore`：交给 `git merge-file --diff3`，只对**纯追加**的冲突块（base 段为空）
 *     做"两块都留"；base 段非空 ⇒ 那不是双方各自追加，退 2 交人判。
 *     ⚠️ 不要用"公共前缀 + 两条尾巴"：其前提是两侧都只在 EOF 追加，而本批在第 89 行
 *     中间插了 3 行 ⇒ 公共前缀只到第 88 行，两条尾巴各带后半份，拼出 318 段 = 后半份抄两遍。
 *  3. `apps/web/evidence/**.png`（binary）：取 **main** 侧。它们是产物不是源码，
 *     留 main 的不丢任何判据，留本批的会把 main 上另一批的现场覆盖掉。
 *  4. `docs/research/self-host-distribution-audit.md`（add/add）：取**本分支**侧，
 *     但不靠印象 —— 断言是**结构粒度**的：main 那份的每一个小节标题（`^#{2,6} `）和每一个
 *     `§8.NN` 编号都必须能在本分支那份里找到；缺任何一个 ⇒ 那是别人写的"一节"，退 2 交人判。
 *     🔴 为什么不是行粒度（本轮实测出来的）：第一版要求"main 那份的每一行都在本分支该文件的
 *     历史 blob 里出现过"，它在 main=59f0ab45 上**判红了两行**，而那两行确实是本批自己的话
 *     （一条讲 `apps/web/dist` 无人引用，一条是"缺的成本"表格行）。原因是并行会话
 *     （GDPR 那笔 `6e447033`）把**当时工作树里未提交的中间态**整文件带进了 main，
 *     而我随后又把那两句改写了一版 ⇒ 旧措辞在 git 历史里**从来没有过 blob**。
 *     行粒度挡不住这种漂，只会把"我自己改过措辞"误报成"别人有内容"；
 *     而"别人的内容"在这个文件里的真实形状是**一整节**（标题 + §编号），那一层挡得住。
 *     行级孤儿数量仍然打印并进提交说明，只是不作门禁。
 *
 *  5. `server/image-npm-tree.json`（镜像 npm 依赖树快照，派生物）：取**本分支**侧。
 *     这一族的取舍**不是偏好**：main 那份是 10-03 傍晚由**旧版联网生成器**解出来的，
 *     `inputs` 里根本没有 `packageLockSha256` 这一项；本批那份是**由提交物锁 `server/package-lock.json`
 *     派生**的。合并后的树里同时有那把锁和新生成器 ⇒ 取 main 侧一定红在
 *     `check:image-license` 的第一腿（`gen-image-npm-tree.mjs --check`）。
 *     🔴 但"取本分支侧就一定对"同样不成立 —— 合并后的锁可能不等于本分支那份的锁（两侧都碰过它
 *     而不冲突）。所以判据不写在解法里，而是把**生产那一道门禁原样挂进 GATES 在载体树上跑**：
 *     复制一遍哈希比较就等于制造下一个漂移点，而它只比 `inputs` 里的四枚哈希之一。
 *
 *  8. `scripts/screenshots/capture.mjs`（**第八族**，10-04 19:1x 出现）：取 **main 为底**，
 *     再把本批那四处改动**逐字面重放**上去（判据在 `selfhost-capture-replay.mjs`）。
 *     为什么不是行级并集：两侧改的是**同一段**（截图前的等待），并集会把
 *     "先等 600ms 再等揭示"这种**刚被摘掉的形状**装回去 —— 那是一种
 *     "什么都没丢"的错产出。重放要求每处 needle **恰好命中一次**，
 *     0 次（main 又改了形状）与 >1 次（needle 太宽）都当场退 2 交人判。
 *
 *  9. `server/Dockerfile`（**第九族**，10-04 23:0x 出现）：**两侧各修了同一个缺陷**，写法不同 ——
 *     main 用 `RUN node -e '…delete p.devDependencies…'`，本批用 `RUN npm pkg delete devDependencies`。
 *     命令形状取**本分支**：`PRUNE_DEV_DEPS_RE`（`image-install-shape.mjs`）只认后一种，取 main 侧会
 *     同时红在契约门禁第 5 步与快照新鲜度那一腿（`prunesDevDependencies=false` 会把 `devDependencies`
 *     从惰性档挪回被哈希的集合）。但**保留 main 独有的注释行**（那里头是它自己的取证理由）。
 *     🔴 这一族**不许**用 `checkout --theirs` 整文件解：main 对该文件改了 17 行、只有**一块**冲突，
 *     整文件取一侧会把 main 那些**没冲突的块**一行不留地丢掉，而归属检查抓不到（该路径本来就在写集里）。
 *     所以解法只**改写冲突块本身**，块外一个字节不动。判据与守卫在
 *     `research/tools/selfhost-dockerfile-merge.mjs`（`--selftest` 十七条：control 十条 + 七条拒绝臂，
 *     每条**按拒绝理由认领**；四道守卫各做过摘除变异，各自把自己的那条臂打红）。
 *
 * 任何不属于这九族的冲突路径 ⇒ 退 2 并点名，**不自动决定**；退 2 之前必须把进行中的合并**中止干净**
 * （`MERGE_HEAD=无` + 工作树 0 条脏），否则下一次重算会被第 0a 步那道闸门挡在门外。
 *
 * ## 落笔前的门禁（只跑纯文件系统的那几道，条数由 `GATES.length` 现量并打进读数）
 *
 * `check:gate-wiring`（并集有没有静默摘掉谁的门禁，这一族的裁判）、
 * `check:selfhost-entry-command`（入口命令抄件对账；顺带证明合并没把站内两份词条抄件并掉）、
 * `check:script-snapshot`、`check:docs`、`check:md-tables`、
 * `check:image-license` 的**三条腿**（第 1 腿 = 快照还代不代表当下那把锁，第五族的裁判；
 * 第 2 腿 = 提交物锁里每条依赖都在许可证登记表里有归属；第 3 腿 = 镜像安装合同，
 * 含"prune devDependencies 必须是第一条 install 之前的一步"与 prisma 三处同源）。
 * 唯一被排除的是 `--installed-tree` 那一**模式**（要从跑起来的镜像里取树）。
 * 完整 `pnpm check`（要 node_modules、要起栈、`check:ai-e2e` 会 SIGKILL 别人的 dev server，
 * §7 #87）**不在这里跑** —— 它是落地那一刻的判据，载体绿不绿不由本脚本主张。
 *
 * ## 落笔前的新鲜度守卫
 *
 * `git commit` 之前再取一次 `main`：与本次检出用的 SHA 不同 ⇒ 退 4 且不提交。
 * 没有这条守卫时会产出一笔"第一父已经不在 main 上"的载体，而它看起来和合法载体一模一样。
 * 重跑本脚本就是全部恢复动作。
 *
 * ## 落笔前的现场守卫（第 0a 步，在任何写动作之前）
 *
 * 载体目录**与并行那条线共用**（他们的启动器在这里做公证 + 远端打包，一趟 15–25 分钟），
 * 而本脚本第 0 步是 `worktree add` / `merge --abort` / `reset --hard`。所以先问一句
 * "这棵树此刻是不是别人的现场"：argv 腿（命令行里点了这个目录）+ cwd 腿（进程坐在里面）
 * + `MERGE_HEAD` 三条，任何一条命中 ⇒ **退 6 且一个字节都不写**；两条腿读不到 ⇒ **退 2**
 * （"判不了"不等于"没人用"）。判据本体在 `selfhost-carrier-busy.mjs`（九臂自检）。
 * `HEYTA_CARRIER_BUSY_FORCE` 只能把它**逼红**（`busy`/`blind`），没有让它放行的取值 ——
 * 那是给变异复现用的，不是给绕过用的：写错值本身按"判不了"退 2。
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { unionAudit, unionAuditVerdict, ownershipVerdict, pkgFieldVerdict } from './selfhost-audit-union.mjs';
import { replayCapture, replayVerdict, replayReading, selftestOutputVerdict, CAPTURE_PATH } from './selfhost-capture-replay.mjs';
import { resolveDockerfileConflict, dockerfileReading, selftestArms as dockSelftestArms, DOCKERFILE_PATH } from './selfhost-dockerfile-merge.mjs';
import { attributeRed, attributionVerdict, attributionArms } from './selfhost-red-attribution.mjs';
import { readImageInstallShape, readImageInstallShapeFromText } from './image-install-shape.mjs';
import { liveCarrierUsers } from './selfhost-carrier-busy.mjs';

const REPO = process.env.HEYTA_REPO_DIR || '/Users/rocalight/Desktop/All in one Data/01_PROJECTS/heyta';
const MAIN = process.env.HEYTA_MAIN_REF || 'main';
const BRANCH = process.env.HEYTA_CARRIER_BRANCH || 'feat/self-host-merge-main';
const SOURCE = process.env.HEYTA_SOURCE_REF || 'feat/self-host-distribution';
// 载体工作树是**一次性的**：每次跑都硬重置到 main tip，不复用旧索引。
const WT = process.env.HEYTA_CARRIER_WT || '/tmp/heyta-merge-carrier';
// 红集配对用的**干净 main** 检出（声明在这里而不是配对那一层：teardown 在文件头就要引用它，
// 而后置的 `const` 会被 die() 走早于声明的那条路读成 TDZ 崩）。
const PAIR_WT = process.env.HEYTA_CARRIER_PAIR_WT || '/tmp/heyta-merge-carrier-mainpair';

const git = (args, opts = {}) =>
  execFileSync('git', ['-C', REPO, ...args], { encoding: 'utf8', maxBuffer: 1 << 26, ...opts });

const notes = [];
const attribution = []; // 载体红逐条归属到非本批的读数（进提交说明，不只在终端闪过）

/* 🔴 退路必须擦现场（2026-10-04 23:1x 现量踩过）：第九族刚出现时那一趟**拒绝**了，
 *    但拒绝只做了"打印 + 退出"，把 `/tmp/heyta-merge-carrier` **留在半合状态**
 *    （MERGE_HEAD 有、61 条脏）。代价不是"脏"这么轻：第 0a 步那道闸门把 MERGE_HEAD 认成
 *    "别人的现场"⇒ 从这之后**连我自己都进不来**，而下一个人读到的报错是"载体在用"，
 *    不是"上一趟拒了没擦"。所以每一族解不下去、每一条门禁不绿、新鲜度守卫失败……
 *    所有 die 路径都要先把进行中的合并中止掉并**量一次它真的干净了**。
 *    没擦干净时不改退出码（原始失败才是归因对象），但把恢复命令印成一行可直接执行的话。 */
let mergeStarted = false;
const teardown = () => {
  const parts = [];
  if (!mergeStarted) parts.push('合并未开始 ⇒ 没有现场要擦');
  else {
    try {
      git(['-C', WT, 'merge', '--abort'], { stdio: 'ignore' });
    } catch (e) {
      parts.push(`merge --abort 本身失败：${String(e.stderr || e.message).split('\n')[0]}`);
    }
    let mh = '';
    // stdio ignore：这一条**期望失败**（干净树上没有 MERGE_HEAD），不压住就会在成功退出的那趟里
    // 留下一行 `fatal: Needed a single revision`（本文件第 0 步就为同一件事写过一条注释）。
    try { mh = git(['-C', WT, 'rev-parse', '--verify', 'MERGE_HEAD'], { stdio: 'ignore' }).trim(); } catch { /* 期望的就是这里抛 */ }
    const dirty = git(['-C', WT, 'status', '--porcelain']).split('\n').filter(Boolean).length;
    parts.push(`已 merge --abort ⇒ MERGE_HEAD=${mh || '无'} · 工作树脏 ${dirty} 条`);
    if (mh || dirty) parts.push(`未擦净`);
  }
  // 配对树也是现场：留着 = 下一读的人在 `git worktree list` 里看见一枚没人认领的 detached 检出。
  if (pairTreeCleanable()) {
    try { git(['worktree', 'remove', '--force', PAIR_WT], { stdio: 'ignore' }); parts.push('配对树已移除'); }
    catch { parts.push('配对树移除失败（留在 ' + PAIR_WT + '，可由 `git worktree remove --force` 收尾）'); }
  }
  return { ok: !parts.includes('未擦净'), line: parts.join(' · ') };
};
// `pairTree` 声明在文件后面的配对层，而 die() 在那之前就可能被调用 ⇒ 用 existsSync 判，不读未初始化的变量。
const pairTreeCleanable = () => existsSync(PAIR_WT);

const die = (code, msg) => {
  // 🔴 失败必须把**已经量到的读数**一起打出来。本轮就吃过这个亏：门禁红只打了门禁输出，
  //    而真正的问题是"合并根本没起来"——那个读数（冲突 0 条）当时只进了 notes。
  if (notes.length) console.error(`   已量到的读数：\n${notes.map((n) => `     · ${n}`).join('\n')}`);
  console.error(`❌ ${msg}`);
  const td = teardown();
  console.error(`   ${td.ok ? '现场：' : '🔴 现场没擦干净：'}${td.line}`);
  if (!td.ok) {
    console.error(`   恢复动作（由人确认这棵树此刻属于谁之后执行）：git -C ${WT} merge --abort && git -C ${WT} status --porcelain`);
  }
  process.exit(code);
};

// ── 0. 起点 ──────────────────────────────────────────────────────────
const mainSha = git(['rev-parse', MAIN]).trim();
const srcSha = git(['rev-parse', SOURCE]).trim();
const baseSha = git(['merge-base', mainSha, srcSha]).trim();
try {
  // rc 0 ⇒ 本批已全部在 main 上，没有合并要做。非 0 会 throw，正是我们要的"继续"。
  git(['merge-base', '--is-ancestor', srcSha, mainSha]);
  console.log(`载体：${SOURCE} 已是 ${MAIN} 的祖先（${mainSha.slice(0, 8)}），无需重算`);
  process.exit(0);
} catch { /* 不是祖先 ⇒ 要做合并，继续 */ }
notes.push(`main=${mainSha.slice(0, 8)} · ${SOURCE}=${srcSha.slice(0, 8)} · merge-base=${baseSha.slice(0, 8)}`);

/* ── 0a. 任何写动作之前：这棵载体树此刻是不是别人的现场 ─────────────────
 * 下面那段（`worktree add` / `merge --abort` / `checkout --force` / `reset --hard`）是**破坏性**的，
 * 而 `/tmp/heyta-merge-carrier` 不只我在用：并行那条线的启动器（main `f7e193e9` 升到 v11）
 * 在同一棵树上做公证 + 远端打包，一趟 15–25 分钟。撞进去毁掉的是**别人这段工作的全部现场**，
 * 而他们那侧的守卫拦的是"我的图是不是这一棵树的"，拦不住我这边把树换掉 ——
 * 那侧的读数会**句句真话**（`INNER_EXIT=0`/`FRESH=5/5`）而产出属于另一棵树。
 * 🔴 所以这条闸门必须挂在**第一个写动作之前**，而不是"跑之前检查一遍"那种口头约定；
 *    判据本体在 `selfhost-carrier-busy.mjs`（单一所有者 + 自带九臂自检），这里只消费。
 * 🔴 没有绕过取值：`HEYTA_CARRIER_BUSY_FORCE` 只能把它**逼红**（busy/blind），
 *    写别的值按"判不了"退 —— 有人打错字也过不去。 */
let mergeHeadBefore = false;
if (existsSync(WT)) {
  try {
    git(['-C', WT, 'rev-parse', '--verify', 'MERGE_HEAD'], { stdio: 'ignore' });
    mergeHeadBefore = true;
  } catch { /* 没有进行中的合并 */ }
}
const FORCE_BUSY = process.env.HEYTA_CARRIER_BUSY_FORCE;
if (FORCE_BUSY && FORCE_BUSY !== 'busy' && FORCE_BUSY !== 'blind') {
  die(2, `不认识 HEYTA_CARRIER_BUSY_FORCE=${FORCE_BUSY} ⇒ 这道闸门没有"绕过"取值，打错就当判不了`);
}
const busyProbe = FORCE_BUSY === 'blind'
  ? { error: `变异注入：强制判不了（HEYTA_CARRIER_BUSY_FORCE=blind）` }
  : FORCE_BUSY === 'busy'
    ? { users: [{ pid: 999999, via: 'argv', what: `变异注入：强制有人在用（HEYTA_CARRIER_BUSY_FORCE=busy）` }], psRows: 0, cwdRows: 0, exempt: [process.pid] }
    : liveCarrierUsers({ dir: WT, mergeHead: mergeHeadBefore });
if (busyProbe.error) {
  die(2, `载体在用者**判不了**：${busyProbe.error}\n` +
    `   不拿"读不到"当"没人用" —— 那正是 §8.122 端口探针那个假 0 的形状，代价是硬重置别人的现场。`);
}
if (busyProbe.users.length) {
  die(6, `载体 ${WT} 此刻有 ${busyProbe.users.length} 个**别人的**进程在用：\n` +
    busyProbe.users.map((u) => `     pid=${u.pid} [${u.via}] ${u.what}`).join('\n') +
    `\n   ⇒ 不重算、不硬重置、不动这棵树（本工具**不提供绕过开关**）。` +
    `   等那一趟跑完再重跑本脚本；要现在就落地，得由那个现场的所有者自己挪开，不是由我替他决定。`);
}
notes.push(`载体空闲（argv+cwd 两腿：ps ${busyProbe.psRows} 行 · cwd ${busyProbe.cwdRows} 行 · ` +
  `豁免自己链 ${busyProbe.exempt.join('←')} · MERGE_HEAD=${mergeHeadBefore ? '有' : '无'}）`);

if (!existsSync(WT)) {
  git(['worktree', 'add', '--detach', WT, mainSha]);
} else {
  // 🔴 先问"真的有一场合并在进行吗"，再 abort。无条件跑 `merge --abort` 会把
  //    `fatal: There is no merge to abort` 漏到 stderr —— **成功的那趟里印着一行 fatal**，
  //    而下一个人会先怀疑合并坏了（判"某个动作失败了"只能看退出码，不能看有没有红字）。
  try {
    git(['-C', WT, 'rev-parse', '--verify', 'MERGE_HEAD'], { stdio: 'ignore' });
    git(['-C', WT, 'merge', '--abort']);
  } catch { /* 没有进行中的合并：本来就不必 abort */ }
  git(['-C', WT, 'checkout', '--force', '--detach', mainSha]);
  git(['-C', WT, 'reset', '--hard', mainSha]);
}
notes.push(`载体检出 ${WT} @ ${mainSha.slice(0, 8)}`);

// ── 1. 合并 ──────────────────────────────────────────────────────────
// 🔴 从这一行动作开始，**这一棵树上任何进行中的合并都是我自己起的**（第 0 步已经 abort + reset --hard
//    过一遍）。所以 `mergeStarted` 必须挂在 merge 尝试**之前**，不能等 MERGE_HEAD 核对通过之后 ——
//    那个核对失败的那些趟（MERGE_HEAD 存在但不是 srcSha / 根本没有）同样要擦干净。
mergeStarted = true;
let mergeOut = '';
try {
  mergeOut = git(['-C', WT, 'merge', '--no-commit', '--no-ff', SOURCE], { stdio: ['ignore', 'pipe', 'pipe'] });
} catch (err) {
  mergeOut = `${err.stdout ?? ''}${err.stderr ?? ''}`;
}
// 🔴 合并**必须真的在进行中**（MERGE_HEAD 就是那一笔的来源 SHA）。
// 少了这道守卫时踩过一次：合并没起来（工作树里还有上一趟的残留），脚本却继续往下走，
// 分族读到"冲突 0 条"⇒ 四族一条都没解 ⇒ 门禁是拿**基本等于 main** 的树在跑，
// 症状是 check:gate-wiring 报"本批五道门禁不在链里" —— 那不是合并把门禁摘了，
// 是**根本没有合并**。这种红比不红好（它响了），但归因会指错地方。
let mergeHead = '';
try { mergeHead = git(['-C', WT, 'rev-parse', 'MERGE_HEAD']).trim(); } catch { /* 空 ⇒ 下面判红 */ }
if (mergeHead !== srcSha) {
  die(2, `合并没有真正开始：MERGE_HEAD=${mergeHead || '(不存在)'}，应当是 ${SOURCE}=${srcSha}。\n` +
    `   git merge 的输出：\n${mergeOut.split('\n').slice(0, 12).map((l) => `     ${l}`).join('\n')}`);
}
const conflicts = git(['-C', WT, 'diff', '--diff-filter=U', '--name-only']).split('\n').filter(Boolean);
mergeStarted = true; // 从这里起的每一条 die 路径都必须把这一场合并中止干净（见上面的 teardown）
notes.push(`MERGE_HEAD=${mergeHead.slice(0, 8)} 已确认 · 冲突 ${conflicts.length} 条：${conflicts.join(', ') || '（无）'}`);

// ── 2. 分族并逐个解 ─────────────────────────────────────────────────
const stage = (path, n) => git(['-C', WT, 'show', `:${n}:${path}`]);
const PNG = (p) => p.startsWith('apps/web/evidence/') && p.endsWith('.png');
const AUDIT = 'docs/research/self-host-distribution-audit.md';
// 镜像 npm 树快照（派生产物）。它现在是第五族：main 在 10-03 傍晚提交了一份
// **由旧版联网生成器解出来的**快照（`inputs` 里根本没有 `packageLockSha256` 这一项），
// 而本批带进去的是**由提交物锁派生**的那一份。合并后的树里同时有锁与新生成器，
// 所以"取哪一侧"不是偏好 —— 取 main 那份会在 `check:image-license` 的新鲜度那一腿直接判红。
const SNAPSHOT = 'server/image-npm-tree.json';
// 生成器本体（**第六族**，10-04 14:5x 才出现的）。main 在 `b60589de` 把新鲜度哈希从
// "整个 `server/package.json` 的字节"收窄到 7 个依赖字段；而本批那版**把这一档整体换掉了**：
// 键 `serverPackageJsonSha256` 在本分支已不存在，代之以 `image-install-shape.mjs` 的
// `readServerInstallInput` —— `TREE_AFFECTING` / `INERT` **显式分区 + 未分类即失败**，
// 且 `devDependencies` 的惰性是按"生产阶段那条 `npm pkg delete devDependencies` 还在不在"现读的。
// ⇒ 两侧的改动**不能并排放在一起**：main 那版钉的是本分支已经删掉的键，取 main 侧会让
// `--check` 直接读不到输入。所以这一族取**本分支侧**，并由 GATES 里那三条 `check:image-license`
// 的腿在载体树上现判（它们判的是"快照 == merged 树算出来的东西"，不是"取了对侧"）。
const GEN = 'research/tools/gen-image-npm-tree.mjs';
// 对账器本体（**第七族**，10-04 15:1x 出现）。main 在 `e374b142`（14:54）把新鲜度指纹
// 抽成新模块 `image-deps-fingerprint.mjs`，并把这里的一行改成
// `depsFingerprint(…)` **仍然去比 `snapshot.inputs.serverPackageJsonSha256`** ——
// 而那个键在本分支已由第六族同样的理由删掉（换成 `serverInstallInputSha256`，
// 分区指纹走 `image-install-shape.mjs` 的 `readServerInstallInput`）。
// ⇒ 取 main 侧 = 对账器读一枚**载体上再也不会有人写**的键 ⇒ `check:image-license` 必红；
//   取本分支侧 = 与第六族同一份口径（生成器与对账器共用一个实现这件事**仍然成立**，
//   只是共用的是 `image-install-shape.mjs` 而不是 `image-deps-fingerprint.mjs`）。
// ⚠️ 代价要如实打出来：两族都取本分支侧之后，main 那枚新文件 `image-deps-fingerprint.mjs`
//   在载体上**零引用者**。它是别人的文件、且删它要动本批写集之外的路径（会破"集外 0"），
//   所以这里**不删**，只把引用者计数打在读数里交给它的所有者。
const COV = 'research/tools/check-image-license-coverage.mjs';
const ORPHAN = 'research/tools/image-deps-fingerprint.mjs';
// 镜像构建的剪枝那一步（**第九族**，10-04 23:0x 出现）。理由与判据见文件头第 9 族那一段，
// 本体在 `selfhost-dockerfile-merge.mjs`（这一族特别不能"整文件取一侧"，所以解法在那里）。
const DOCK = DOCKERFILE_PATH;

const fam = { pkg: [], gi: [], png: [], audit: [], snap: [], gen: [], cov: [], cap: [], dock: [], other: [] };
for (const p of conflicts) {
  if (p === 'package.json') fam.pkg.push(p);
  else if (p === '.gitignore') fam.gi.push(p);
  else if (PNG(p)) fam.png.push(p);
  else if (p === AUDIT) fam.audit.push(p);
  else if (p === SNAPSHOT) fam.snap.push(p);
  else if (p === GEN) fam.gen.push(p);
  else if (p === COV) fam.cov.push(p);
  else if (p === CAPTURE_PATH) fam.cap.push(p);
  else if (p === DOCK) fam.dock.push(p);
  else fam.other.push(p);
}
if (fam.other.length) {
  die(2, `出现**预置九族之外**的冲突路径，不许自动决定：\n  - ${fam.other.join('\n  - ')}\n` +
    `   先把它加进本文件的分族与解法，再重跑。`);
}
notes.push(`分族：pkg=${fam.pkg.length} gi=${fam.gi.length} png=${fam.png.length} audit=${fam.audit.length} snap=${fam.snap.length} gen=${fam.gen.length} cov=${fam.cov.length} cap=${fam.cap.length} dock=${fam.dock.length} other=${fam.other.length}`);
if (fam.pkg.length > 1 || fam.gi.length > 1 || fam.audit.length > 1 || fam.snap.length > 1 || fam.gen.length > 1 || fam.cov.length > 1 || fam.cap.length > 1 || fam.dock.length > 1) {
  die(2, '同一族出现多于一份文件 —— 分族前提（各一处）不成立，交人判');
}

/* ── 第八族那条判据自己的牙 ───────────────────────────────────────────
 * 为什么挂在这里、而不是往 `pnpm check` 的链里加一段：这条判据唯一被用到的时刻
 * 就是载体解第八族，而**每次要落地都必须重算载体** ⇒ 挂在这里它就有"每次都被跑"的保证；
 * 加进链反而要再动 `"check"` 那一整行（= §8.41 那族冲突的成因：一侧改能自动并，两侧都改才冲突）。
 * 🔴 "手动跑过一次"不算消费方 —— 那是 G-48 收口时立下的口径：它不是"手动跑的那一条"，
 * 它是"没有人跑的那一条"。 */
const REPLAY = 'research/tools/selfhost-capture-replay.mjs';
let capSelftestReading = '';
if (!existsSync(join(WT, REPLAY))) {
  die(2, `第八族的判据文件不在载体树上（${REPLAY}）⇒ 没有它就不许解这一族，也不许当"没有这一族"混过去`);
}
try {
  const st = execFileSync('node', [join(WT, REPLAY), '--selftest'], { encoding: 'utf8', maxBuffer: 8 << 20 });
  const v = selftestOutputVerdict(st);
  if (v) die(2, `第八族的自检**退出码 0 却证明不了它有牙**：${v}`);
  capSelftestReading = '第八族判据自检：control 0 条 + 五臂各 ≥1 条 + 收尾复绿（按**输出内容**判，不是只看 rc）';
  notes.push(capSelftestReading);
} catch (e) {
  const arms = String(e.stdout || '').split('\n').filter((l) => l.includes('臂') || l.includes('自检')).slice(0, 8).join('\n');
  die(2, `第八族的重放判据**自检不过**（没牙了，或被改坏了）⇒ 不用它解冲突：\n${arms}`);
}

/* ── 第九族那条判据自己的牙（与第八族同一处挂法、同一个理由）─────────────
 * `selfhost-dockerfile-merge.mjs --selftest` 的十七条（control 十条 + 七条按理由认领的拒绝臂）
 * 在载体树上现跑：这一族的解法**只在这一次合并里被用到**，挂在落笔前才有"每次都被跑"的保证。
 * 🔴 判的是**输出内容**（红臂计数 + 收尾那两句），不是只看退出码 —— 第八族那条 `selftestOutputVerdict`
 *    立的就是这个口径：rc 0 而"一条臂都没跑"的输出长得和通过一模一样。 */
const DMERGE = 'research/tools/selfhost-dockerfile-merge.mjs';
let dockSelftestReading = '';
if (!existsSync(join(WT, DMERGE))) {
  die(2, `第九族的判据文件不在载体树上（${DMERGE}）⇒ 没有它就不许解这一族，也不许当"没有这一族"混过去`);
}
{
  let out = '';
  let rc = 0;
  try {
    out = execFileSync('node', [join(WT, DMERGE), '--selftest'], { encoding: 'utf8', maxBuffer: 8 << 20 });
  } catch (e) {
    rc = e.status ?? 1;
    out = `${e.stdout ?? ''}${e.stderr ?? ''}`;
  }
  const redArms = out.split('\n').filter((l) => /^RED\s/.test(l));
  const armLine = out.split('\n').find((l) => /臂数\s\d+/.test(l)) ?? '';
  const claimed = armLine.match(/臂数\s(\d+)（拒绝类\s(\d+)/);
  // 合成输入自检**不需要**第九族真的在冲突里 ⇒ 没冲突时也照跑（它验的是判据有没有牙）。
  if (rc !== 0) die(2, `第九族的自检退 ${rc}（有红臂或被改坏了）⇒ 不用它解冲突：\n${redArms.slice(0, 8).join('\n')}`);
  if (redArms.length) die(2, `第九族的自检**退出码 0 却带着红臂**（判据坏了）：${redArms[0]}`);
  if (!claimed || Number(claimed[1]) < 17 || Number(claimed[2]) < 7) {
    die(2, `第九族的自检读数对不上（臂数行：“${armLine || '（没有这一行）'}”，要求 臂数 ≥17 且拒绝类 ≥7）` +
      ` ⇒ 要么臂被删了，要么输出形状变了而这里没跟上 —— 不拿"rc 0"当通过。`);
  }
  // 正向对照：判据函数**当场**能吃真输入并给出可核对的形状（合成臂全过不等于真数据也走得到那条路）。
  const arms = dockSelftestArms();
  const refuseArms = arms.filter((a) => a.name.startsWith('A'));
  if (refuseArms.length < 7 || refuseArms.some((a) => a.got !== true)) {
    die(2, `第九族的拒绝臂从**函数**这一侧数出来对不上：拒绝类 ${refuseArms.length} 条、非真 ${refuseArms.filter((a) => a.got !== true).length} 条`);
  }
  dockSelftestReading = `第九族判据自检：${claimed[1]} 条臂（拒绝类 ${claimed[2]}，按理由认领）红 0 · 四道守卫各做过摘除变异、各打红自己那条臂`;
  notes.push(dockSelftestReading);
}

/* ── package.json ─────────────────────────────────────────────────── */
let pkgReading = '';
if (fam.pkg.length) {
  const base = JSON.parse(stage('package.json', 1));
  const ours = JSON.parse(stage('package.json', 2)); // main = 第一父
  const theirs = JSON.parse(stage('package.json', 3));
  const outPkg = JSON.parse(JSON.stringify(ours));
  for (const [k, v] of Object.entries(theirs.scripts)) {
    if (!(k in ours.scripts)) {
      outPkg.scripts = { ...outPkg.scripts, [k]: v };
      continue;
    }
    if (ours.scripts[k] === theirs.scripts[k] || k === 'check') continue;
    const oursIsBase = (base.scripts[k] ?? null) === ours.scripts[k];
    const theirsIsBase = (base.scripts[k] ?? null) === theirs.scripts[k];
    if (!oursIsBase && !theirsIsBase) {
      die(2, `package.json 的 scripts.${k} 两边都改且互不相同 —— 这条不许自动决定`);
    }
    outPkg.scripts[k] = oursIsBase ? theirs.scripts[k] : ours.scripts[k];
  }
  const seg = (s) => s.split(' && ').map((x) => x.replace(/^pnpm /, '').trim());
  const bChain = seg(base.scripts.check);
  const oChain = seg(ours.scripts.check);
  const tChain = seg(theirs.scripts.check);
  const result = [...oChain];
  for (let i = 0; i < tChain.length; i += 1) {
    const s = tChain[i];
    if (oChain.includes(s)) continue;
    let anchor = null;
    for (let j = i - 1; j >= 0; j -= 1) {
      if (oChain.includes(tChain[j])) { anchor = tChain[j]; break; }
    }
    result.splice(anchor === null ? 0 : result.indexOf(anchor) + 1, 0, s);
  }
  const missingKeys = [...new Set([...Object.keys(ours.scripts), ...Object.keys(theirs.scripts)])]
    .filter((k) => !(k in outPkg.scripts));
  const missingSegs = [...new Set([...oChain, ...tChain])].filter((s) => !result.includes(s));
  const keepOrder = (want) => result.filter((x) => want.includes(x)).join('|') === want.join('|');
  const dropped = { main: bChain.filter((s) => !oChain.includes(s)), src: bChain.filter((s) => !tChain.includes(s)) };
  const bad = [];
  if (missingKeys.length) bad.push(`缺 scripts 键 ${missingKeys.join(', ')}`);
  if (missingSegs.length) bad.push(`缺链段 ${missingSegs.join(', ')}`);
  if (!keepOrder(oChain)) bad.push('颠倒了 main 侧的相对顺序');
  if (!keepOrder(tChain)) bad.push('颠倒了本批侧的相对顺序');
  if (dropped.main.length) bad.push(`main 相对 base 摘掉 ${dropped.main.length} 段：${dropped.main.join(', ')}`);
  if (dropped.src.length) bad.push(`本批相对 base 摘掉 ${dropped.src.length} 段：${dropped.src.join(', ')}`);
  if (bad.length) die(2, `package.json 并集判定失败：${bad.join(' · ')}`);
  /**
   * 🔴 **把算出来的并集真的写回 `check` 这一条**（2026-10-04 现量补上的）。
   *
   * 上面那个逐键复制的循环里 `k === 'check'` 被 `continue` 跳过，因为它由链并集单独处理 ——
   * 但"单独处理"原先**只处理到内存里**：`result` 从来没有赋回 `outPkg.scripts.check`，
   * 于是写盘的永远是 main 那份链。下面那条"写完回读再验"的断言把它拦下来了
   * （`缺链段 1（check:image-build-args）· 磁盘 segs=74，应当=75`，exit 5）。
   *
   * 为什么这个洞一直没人看见：main 早先把整批都吸进去了（§8.32），所以 tChain ⊆ oChain，
   * `result` 恒等于 `oChain` ⇒ 不写回也没丢东西。**直到本批第一次往链里加一段
   * main 还没有的新门禁**，它才第一次真的少一段。这是"判据从没被需要的输入触发过"的形状 ——
   * 断言①②③④都成立，产出却是错的。
   *
   * 重建字符串时不凭"`pnpm ` 开头"这个印象：先用两侧的**原文**建映射，取不到再退回加前缀，
   * 最后断言"重建串 `seg()` 回去逐段等于 result"。少这一步的话，
   * 链里任何一段不带 `pnpm ` 前缀（例如直接 `node scripts/…`）都会被悄悄改成另一条命令。
   */
  const originalOf = new Map();
  for (const rawChain of [ours.scripts.check, theirs.scripts.check]) {
    for (const raw of rawChain.split(' && ')) {
      const key = raw.replace(/^pnpm /, '').trim();
      if (!originalOf.has(key)) originalOf.set(key, raw.trim());
    }
  }
  outPkg.scripts.check = result.map((s) => originalOf.get(s) ?? `pnpm ${s}`).join(' && ');
  const rebuilt = seg(outPkg.scripts.check);
  if (rebuilt.length !== result.length || rebuilt.some((s, i) => s !== result[i])) {
    die(5, '并集链序列化**不能 round-trip**：重建后再切段与内存里的并集不一致' +
      `\n  重建=${rebuilt.join(' | ')}\n  并集=${result.join(' | ')}`);
  }
  writeFileSync(join(WT, 'package.json'), `${JSON.stringify(outPkg, null, 2)}\n`);
  git(['-C', WT, 'add', '--', 'package.json']);
  pkgReading = `并集 scripts 键 ${Object.keys(outPkg.scripts).length} 个 · check 链段 main=${oChain.length} 本批=${tChain.length} base=${bChain.length} 并集=${result.length}（摘段 0/0）`;
  notes.push(`package.json ${pkgReading}`);
  // 🔴 写完**回读磁盘**再验一次并集。少这一步时踩过一次：脚本报告四族都解完了、门禁却红在
  //    "本批五道门禁不在链里" —— 磁盘上的 package.json 当时是 main 那份（63 段），
  //    而"我算出的并集"只在内存里被断言过。断言要落在**要提交的那个对象**上。
  const backPkg = JSON.parse(readFileSync(join(WT, 'package.json'), 'utf8'));
  const back = backPkg.scripts;
  const backSegs = seg(back.check);
  const lostSegs = [...new Set([...oChain, ...tChain])].filter((s) => !backSegs.includes(s));
  const lostKeys = [...new Set([...Object.keys(ours.scripts), ...Object.keys(theirs.scripts)])]
    .filter((k) => !(k in back));
  if (lostSegs.length || lostKeys.length) {
    die(5, `package.json 并集写回后回读**不含**完整并集：缺链段 ${lostSegs.length}（${lostSegs.slice(0, 6).join(', ')}）· 缺键 ${lostKeys.length}（${lostKeys.slice(0, 6).join(', ')}）` +
      ` —— 磁盘 segs=${backSegs.length}，应当=${result.length}`);
  }
  /* 非 `scripts` 那一档：并集是"深拷贝 main + 只加 scripts"，所以本批改过的任何依赖/overrides/
   * packageManager 都会在这里被**静默丢掉**，而上面四条 scripts 断言一条都不会响。
   * 判在**磁盘那个对象**上（理由见上面那条注释：断言要落在要提交的对象上）。
   * 它挡的是两件事：`pnpm install --frozen-lockfile` 在落地第一步红；
   * 以及更糟的"不红"那一支（只改 `pnpm.overrides` 这类不进口径的字段）从此没有任何一层知道。 */
  const fields = pkgFieldVerdict({ base, ours, theirs, out: backPkg });
  if (!fields.ok) {
    die(2, `package.json 并集把本批改过的**非 scripts 顶层字段**丢了 ${fields.dropped.length} 个：${fields.dropped.join(', ')}` +
      ` —— 依赖类字段不许自动决定（要么两侧同值、要么显式并），载体不落笔，交人判。` +
      `   比了 ${fields.counts.compared} 个两侧共有的顶层键。`);
  }
  pkgReading += ` · 非 scripts 顶层字段比了 ${fields.counts.compared} 个，两侧改动全落进磁盘对象（丢 0）`;
}

/* ── .gitignore ───────────────────────────────────────────────────── */
let giReading = '';
if (fam.gi.length) {
  const baseTxt = stage('.gitignore', 1);
  const oursTxt = stage('.gitignore', 2);
  const theirsTxt = stage('.gitignore', 3);
  const tmp = (name, text) => { writeFileSync(`/tmp/ht-${name}`, text); return `/tmp/ht-${name}`; };
  const [fO, fB, fT] = [tmp('gi-o', oursTxt), tmp('gi-b', baseTxt), tmp('gi-t', theirsTxt)];
  let raw = '';
  let gitBlocks = 0;
  try {
    raw = execFileSync('git', ['merge-file', '-p', '--diff3', fO, fB, fT], { encoding: 'utf8', maxBuffer: 1 << 26 });
  } catch (err) {
    raw = String(err.stdout ?? '');
    gitBlocks = (String(err.stdout ?? '').match(/^<{7}/gm) || []).length;
  }
  const lines = raw.split('\n');
  const out = [];
  let parsed = 0;
  for (let i = 0; i < lines.length; i += 1) {
    const l = lines[i];
    if (!l.startsWith('<<<<<<<')) { out.push(l); continue; }
    parsed += 1;
    const o = [];
    const b = [];
    const t = [];
    let mode = 'o';
    i += 1;
    for (; i < lines.length; i += 1) {
      const x = lines[i];
      if (x.startsWith('|||||||')) { mode = 'b'; continue; }
      if (x.startsWith('=======')) { mode = 't'; continue; }
      if (x.startsWith('>>>>>>>')) break;
      (mode === 'o' ? o : mode === 'b' ? b : t).push(x);
    }
    if (b.length !== 0) {
      die(2, `.gitignore 第 ${parsed} 个冲突块的 base 段非空（${b.length} 行）⇒ 同一处被两边改过，不自动决定：${b.slice(0, 3).join(' / ')}`);
    }
    out.push(...o, ...t);
  }
  if (parsed !== gitBlocks) die(2, `.gitignore 解析到 ${parsed} 个冲突块，git 报 ${gitBlocks} 个 —— 解析器与 git 不一致，产出不可信`);
  const miss = (want) => want.filter((x) => !out.includes(x));
  const oL = oursTxt.split('\n');
  const tL = theirsTxt.split('\n');
  const bL = baseTxt.split('\n');
  const bad = [];
  if (miss(oL).length) bad.push(`缺 main 的 ${miss(oL).length} 行`);
  if (miss(tL).length) bad.push(`缺本批的 ${miss(tL).length} 行`);
  const expect = bL.length + (oL.length - bL.length) + (tL.length - bL.length);
  if (out.length !== expect) bad.push(`产出 ${out.length} 段 ≠ base ${bL.length} + main ${oL.length - bL.length} + 本批 ${tL.length - bL.length} = ${expect} 段`);
  if (out.some((x) => /^(<{7}|>{7}|\|{7})/.test(x))) bad.push('残留冲突标记');
  if (bad.length) die(2, `.gitignore 合并判定失败：${bad.join(' · ')}`);
  writeFileSync(join(WT, '.gitignore'), out.join('\n'));
  git(['-C', WT, 'add', '--', '.gitignore']);
  const backGi = readFileSync(join(WT, '.gitignore'), 'utf8').split('\n');
  if (backGi.length !== out.length || tL.some((x) => !backGi.includes(x))) {
    die(5, `.gitignore 写回后回读与产出不可达一致（磁盘 ${backGi.length} 段 vs 产出 ${out.length} 段）`);
  }
  giReading = `产出 ${out.length} 个 split('\\n') 段（= wc -l ${out.length - 1} 行，文件以换行结尾）= base ${bL.length} + main ${oL.length - bL.length} + 本批 ${tL.length - bL.length}，纯追加块 ${parsed} 个两块都留`;
  notes.push(`.gitignore ${giReading}`);
}

/* ── evidence PNG：取 main 侧 ─────────────────────────────────────── */
if (fam.png.length) {
  git(['-C', WT, 'checkout', '--ours', '--', ...fam.png]);
  git(['-C', WT, 'add', '--', ...fam.png]);
  notes.push(`evidence PNG ${fam.png.length} 枚取 main 侧（产物，谁主张谁出图）：${fam.png.map((p) => p.split('/').pop()).join(', ')}`);
}

/* ── 截图流水线（第八族，10-04 19:1x 出现）─────────────────────────────
 * main 在 10-04 往 `scripts/screenshots/capture.mjs` 的**同一段**加了
 * `dismissOverlays` / `clearHoverAndFocus`，而本批把那一段里的固定 600ms 换成了
 * "等揭示落位"（G-57）。解法不是行级并集（那会把两条等待都留下，
 * 看起来什么都没丢、语义上却是刚摘掉的形状又装回去），而是
 * **取 main 为底 + 逐字面重放本批那四处**，判据与产出在
 * `research/tools/selfhost-capture-replay.mjs`（单一所有者，带 `--selftest` 六臂）。
 * 🔴 断言落在**磁盘那个对象**上（§8.34 那一族的教训：内存里算对、写盘写错）。 */
if (fam.cap.length) {
  const mainTxt = stage(CAPTURE_PATH, 2);
  const r = replayCapture(mainTxt);
  const verdict = replayVerdict(r);
  if (verdict) die(2, `${CAPTURE_PATH} 重放：${verdict} ⇒ 绝不提交，交人判`);
  writeFileSync(join(WT, CAPTURE_PATH), r.text);
  git(['-C', WT, 'add', '--', CAPTURE_PATH]);
  const onDisk = readFileSync(join(WT, CAPTURE_PATH), 'utf8');
  if (onDisk !== r.text) die(5, `${CAPTURE_PATH} 写回后回读与产出逐字节不同（磁盘 ${onDisk.length}B vs 产出 ${r.text.length}B）`);
  try {
    execFileSync('node', ['--check', join(WT, CAPTURE_PATH)], { encoding: 'utf8', stdio: 'pipe' });
  } catch (e) {
    die(5, `${CAPTURE_PATH} 在载体上**语法不过**：${String(e.stderr || e.message).split('\n').slice(0, 3).join(' / ')}`);
  }
  notes.push(`${CAPTURE_PATH} ${replayReading(r)}`);
}

/* ── 审计文档：两边都是"追加型台账" ⇒ 解法是**并集**，择一会静默删掉别人的节 ──
 * 判定与产出在 research/tools/selfhost-audit-union.mjs（单一所有者），这样四条断言
 * 能用合成样本离线变异，不必为验一条判据就在真载体里留一次半合状态。
 * 🔴 这条规则以前是「取本分支侧 + 若 main 有额外的节就 die」。die 是对的（2026-10-04 06:4x 现量：
 *   main 刚被另一条会话提交进一整节 `## 9. 交还一条现场…`，相对 merge-base +70/−0，本分支一份都没有），
 *   但它只做到"不背这个锅"，没做到"把这单落地"。落地路径上唯一不误删的解法是两份都留。 */
let auditReading = '';
if (fam.audit.length) {
  // base 那一版优先从合并的 stage 1 取；add/add（没有 stage 1）时退回 merge-base 提交里的 blob。
  // 🔴 两条路都取不到就**绝不**按"base 为空"去做并集 —— 产出虽无损但会把两份全文叠起来，
  //   而"没人敢读的产出"最后一定被人手工改成择一，那才是真正的丢内容。
  let baseTxt;
  try { baseTxt = stage(AUDIT, 1); } catch {
    try { baseTxt = git(['show', `${baseSha}:${AUDIT}`]); } catch {
      die(2, '审计文档是 add/add 且 merge-base 里也没有它 ⇒ 并集规则没有共同基线可用，' +
        '交人判（要么先让一侧的历史并进另一侧，要么这一路径手工解）。');
    }
  }
  const mainTxt = stage(AUDIT, 2);
  const srcTxt = stage(AUDIT, 3);
  const r = unionAudit({ base: baseTxt, main: mainTxt, src: srcTxt });
  const verdict = unionAuditVerdict(r);
  if (verdict) die(2, `审计文档并集：${verdict} ⇒ 绝不提交，交人判`);
  writeFileSync(join(WT, AUDIT), r.text);
  git(['-C', WT, 'add', '--', AUDIT]);
  auditReading = `并集：保留 main 侧 ${r.stats.mainOnly} 行（含 ${r.stats.extraMainHeadings} 个本分支没有的节标题）` +
    ` + 本分支独有 ${r.stats.srcOnly} 行；断言 main 零丢行 / 本分支零丢行 / 无两侧之外的新行 / 无冲突标记 全过`;
  notes.push(`审计文档并集：main 节 ${r.stats.mainHeadings}、本分支节 ${r.stats.srcHeadings}、` +
    `main 独有行 ${r.stats.mainOnly}、本分支独有行 ${r.stats.srcOnly}、产出非空行 ${r.text.split('\n').filter((l) => l.trim() !== '').length}`);
}

/* ── 镜像 npm 树快照：取本分支侧，但由**生产门禁**来判对错 ────────────────
 * 两类的取舍不一样：PNG 是"谁主张谁出图"的现场产物，这一份是**派生物** —— 它代不代表
 * 当下的锁，唯一裁判是 `gen-image-npm-tree.mjs --check`（它就是 `check:image-license`
 * 的第一腿）。所以这里不自己拼哈希比较（复制一遍判断=下一次漂移的起点，而且它比的是
 * `inputs` 里**四枚**哈希：server 安装输入 / 安装形状 / 工作区包 package.json / 锁），
 * 取本分支侧之后**把那道门禁挂进 GATES 在载体树上现跑**。
 * 为什么是本分支侧：main 那份的 `inputs` 里根本没有 `packageLockSha256`（旧版联网生成器
 * 的产出），新生成器一定判红；本分支那份才是"由提交物锁派生"的那一份。 */
let snapReading = '';
if (fam.snap.length) {
  git(['-C', WT, 'checkout', '--theirs', '--', ...fam.snap]);
  git(['-C', WT, 'add', '--', ...fam.snap]);
  const joined = JSON.parse(readFileSync(join(WT, SNAPSHOT), 'utf8'));
  snapReading = `${SNAPSHOT} 取本分支侧（locks 派生快照，inputs.packageLockSha256=${(joined.inputs?.packageLockSha256 ?? '缺失').slice(0, 12)}…）；` +
    '新鲜度由 GATES 里的 gen-image-npm-tree --check 在载体树上现判';
  notes.push(snapReading);
}

/* ── 生成器本体（第六族）──────────────────────────────────────────────
 * 取本分支侧的理由见上面 GEN 那段注释。这里额外**现量一句**两侧的差是不是就是那一个键：
 * main 侧那版还钉着 `serverPackageJsonSha256`，本分支侧那版已经换成 `readServerInstallInput`
 * 的分区指纹 —— 把这句判断打在载体上，"取本分支侧"才是一行可复核的读数而不是一句信念。 */
let genReading = '';
if (fam.gen.length) {
  const mainSide = stage(GEN, 2);
  const branchSide = stage(GEN, 3);
  git(['-C', WT, 'checkout', '--theirs', '--', ...fam.gen]);
  git(['-C', WT, 'add', '--', ...fam.gen]);
  const onCarrier = readFileSync(join(WT, GEN), 'utf8');
  genReading = `${GEN} 取本分支侧（main 侧仍钉 ${/serverPackageJsonSha256/.test(mainSide) ? '旧键 serverPackageJsonSha256' : '（无该键）'}` +
    `、本分支侧走 ${/readServerInstallInput/.test(branchSide) ? 'readServerInstallInput 分区指纹' : '（未见）'}` +
    `；载体上取到的这份含分区指纹=${/readServerInstallInput/.test(onCarrier)}，` +
    `两侧行数 ${mainSide.split('\n').length}/${branchSide.split('\n').length}）；` +
    '一致性由 GATES 里 check:image-license 三条腿现判';
  notes.push(genReading);
}

/* ── 对账器本体（第七族）──────────────────────────────────────────────
 * 与第六族同一条理由，且**必须与第六族取同一侧**：生成器写 `serverInstallInputSha256`
 * 而对账器读 `serverPackageJsonSha256`（或反过来）时，`check:image-license` 永远读不出
 * "快照代不代表当下"，那一腿会变成一个恒红的判据。所以这里除了取本分支侧，
 * 还**现量一条两侧键名**，把它钉成"两侧同族同口径"的可复核读数。
 * 顺带打 main 那枚新模块在载体上的引用者计数（零引用 ≠ 我来删；它写在别人的路径里）。 */
let covReading = '';
if (fam.cov.length) {
  const mainSide = stage(COV, 2);
  const branchSide = stage(COV, 3);
  git(['-C', WT, 'checkout', '--theirs', '--', ...fam.cov]);
  git(['-C', WT, 'add', '--', ...fam.cov]);
  const onCarrier = readFileSync(join(WT, COV), 'utf8');
  let orphanRef = 'NA';
  if (existsSync(join(WT, ORPHAN))) {
    try {
      orphanRef = git(['-C', WT, 'grep', '-l', 'image-deps-fingerprint', '--', '*.mjs'])
        .split('\n').filter(Boolean).length - 1; // 减掉它自己那一枚
    } catch {
      orphanRef = 0; // git grep 零命中 ⇒ 退出码 1 ⇒ 到这里就是"除自己外没人引"
    }
  }
  covReading = `${COV} 取本分支侧（main 侧读 ${/serverPackageJsonSha256/.test(mainSide) ? '旧键 serverPackageJsonSha256' : '（无该键）'}` +
    `、本分支侧读 ${/serverInstallInputSha256/.test(branchSide) ? 'serverInstallInputSha256 分区指纹' : '（未见）'}` +
    `；载体上这份含分区键=${/serverInstallInputSha256/.test(onCarrier)}，` +
    `与第六族同侧=${/serverInstallInputSha256/.test(onCarrier) && /readServerInstallInput/.test(readFileSync(join(WT, GEN), 'utf8'))}，` +
    `两侧行数 ${mainSide.split('\n').length}/${branchSide.split('\n').length}）；` +
    `⚠️ main 新模块 ${ORPHAN} 在载体上的引用者=${orphanRef} 枚（零引用**不删**，删它要动本批写集之外的路径）；` +
    '一致性仍由 GATES 里 check:image-license 三条腿现判';
  notes.push(covReading);
}

/* ── 镜像构建那一步（第九族，10-04 23:0x 出现）──────────────────────────
 * 两侧**各修了同一个缺陷**（devDependencies 里那三枚 `@heyta/*` 让 npm 在 `--omit=dev` 下照样去
 * registry 解析 ⇒ 404 ⇒ 镜像建不出来），只是写法不同。取舍由判据决定，不由印象决定：
 * `PRUNE_DEV_DEPS_RE` 只认 `npm pkg delete devDependencies` ⇒ 命令形状取本分支，
 * 但**只改写冲突块**（`checkout --theirs` 整文件会把 main 那些没冲突的块一行不留地丢掉，
 * 而归属检查抓不到这一条 —— 该路径本来就在写集里）。理由与守卫本体在 `selfhost-dockerfile-merge.mjs`。 */
let dockReading = '';
if (fam.dock.length) {
  const withMarkers = readFileSync(join(WT, DOCK), 'utf8');
  const branchSide = stage(DOCK, 3);
  const r = resolveDockerfileConflict(withMarkers);
  if (r.verdict) die(2, `${DOCK} 第九族：${r.verdict}\n   ⇒ 绝不提交，交人判（这一族没有"先合了再说"这条路）`);
  writeFileSync(join(WT, DOCK), r.text);
  git(['-C', WT, 'add', '--', DOCK]);
  const onDisk = readFileSync(join(WT, DOCK), 'utf8');
  if (onDisk !== r.text) {
    die(5, `${DOCK} 写回后回读与产出逐字节不同（磁盘 ${onDisk.length}B vs 产出 ${r.text.length}B）`);
  }
  // 🔴 磁盘上那一份**再判一次**：判内存里的产出只证明"算法对"，载体上跑门禁的是磁盘那一份。
  const shapeDisk = readImageInstallShape(join(WT, DOCK));
  const shapeBranch = readImageInstallShapeFromText(branchSide);
  const bad = [];
  if (!shapeDisk.prunesDevDependencies) bad.push('磁盘上那份的剪枝仍然不在第一条 install 之前');
  if (shapeDisk.normalizedShape !== shapeBranch.normalizedShape) {
    bad.push('磁盘上那份的**安装形状**与本分支侧不同 ⇒ 第五族取的那份快照会因此对不上');
  }
  if (!/npm\s+pkg\s+delete\s+devDependencies/.test(onDisk)) bad.push('磁盘上那份没有 `npm pkg delete devDependencies`');
  if (/node -e [^\n]*delete p\.devDependencies/.test(onDisk)) bad.push('磁盘上那份还留着 main 的 node -e 替代写法（取舍没落地）');
  if (bad.length) die(5, `${DOCK} 解完之后磁盘上的自检不过：${bad.join('；')}`);
  const mainCommit = git(['log', '-1', '--format=%h', mainSha, '--', DOCK]).trim();
  dockReading = `${dockerfileReading(r.reading)}；main 那一版的出处=${mainCommit}（同一缺陷的另一种写法：命令被替代、注释逐行保留）`;
  notes.push(dockReading);
}

const still = git(['-C', WT, 'diff', '--diff-filter=U', '--name-only']).split('\n').filter(Boolean);
if (still.length) die(2, `解完之后仍有未解决冲突：${still.join(', ')}`);
for (const [path, txt] of [['package.json', readFileSync(join(WT, 'package.json'), 'utf8')], ['.gitignore', readFileSync(join(WT, '.gitignore'), 'utf8')]]) {
  if (/^<{7}/m.test(txt)) die(2, `${path} 仍含冲突标记`);
}

/* ── 2b. 合并归属通式：diff(main, 载体树) ⊆ diff(merge-base, 本分支) ──────
 * 这是"这笔合并没有吞并行会话的改动、也没有静默回退 main"的**结构层**证据。
 * 它和上面审计文档那三条内容层断言互补：内容层管"别人那一节逐行在不在"，
 * 这条管"本批不该碰第 34 枚文件"。两边都过才叫落地。
 * 🔴 写集的基线只能在这里显式用 baseSha —— 用 merge-base(main, 载体) 会退化成 main 自己
 *   （载体第一父 = main），写集于是变成 820 条、`⊆` 空洞成立。§8.52 记过一次，06:4x 又复犯一次。 */
{
  const writeSet = git(['diff', '--name-only', baseSha, srcSha]).split('\n').filter(Boolean);
  const mergedSet = git(['-C', WT, 'diff', '--name-only', mainSha]).split('\n').filter(Boolean);
  const own = ownershipVerdict({ writeSet, mergedSet });
  if (!own.ok) {
    die(2, `合并动了本批从没写过的路径 ${own.outside.length} 枚（前 5：${own.outside.slice(0, 5).join(', ')}）` +
      ` —— 要么吞了并行会话的改动，要么把 main 的东西回退了。载体不落笔，交人判。`);
  }
  notes.push(`合并归属：写 ${own.counts.write} 枚 / 合并相对 ${MAIN} 改 ${own.counts.merged} 枚 / 集外 0 / 写集里未被改到 ${own.unfused.length} 枚`);
}

// ── 3. 纯 fs 门禁 + "红要逐条归属"的配对层 ────────────────────────────
/* 每条门禁可带第三个元素 = **缺陷行提取式**（那道门禁自己点名缺陷的输出形状）。
 * 载体红时，同一道门在**干净 main 检出**上再跑一次，逐条比"载体点名的缺陷 ⊆ main 点名的缺陷"：
 *   ·  ⊆ 成立 ⇒ 那条红**不是本批造成的**，放行落笔，并把配对读数打进提交说明（别人的债不由本批吸收，
 *     也不许由本批的"绿"掩埋 —— 它是 main 上仍然存在的真红，归属写清楚才有主）；
 *   · 多出来的那一条 ⇒ 本批带进去的 ⇒ 照旧 die(3)；
 *   · 这道门没有提取式 ⇒ **判不了** ⇒ die(3)。🔴 "没法归属"永远不许被读成"归属过了"——
 *     这一条就是 §8.122 那族假 0 的第四个面目（读不出 ⇒ 放行）。
 * 为什么必须做这一层：main 现在**自己就红**（2c69c57d 现量：`check:docs` 1 处，
 * `calendar-profile-handoff.md:1187` 指向 `trash-and-archive.md §10.87`，而 main 那份只到 §10.17），
 * 那两枚文件都不在本批写集里。少了配对层，载体脚本会把**别人的红**当成"解法没修好"而永远拒绝落笔 ——
 * 症状是"每次都退 3、每次都说要修解法"，而实际没有解法可修。 */
const DOC_DEFECT = /^   [^\s]+:\d+/; // docs-link-check 四类缺陷都以三空格 + `路径:行号` 开头
const GATES = [
  ['check:gate-wiring', ['scripts/check-gate-wiring.mjs']],
  ['check:selfhost-entry-command', ['scripts/check-selfhost-entry-command.mjs']],
  ['check:script-snapshot', ['scripts/check-script-snapshot.mjs']],
  ['check:docs', ['research/tools/docs-link-check.mjs'], DOC_DEFECT],
  ['check:md-tables', ['scripts/check-md-table-rows.mjs']],
  // 第五族的裁判：`check:image-license` 的**三条腿原样**挂进来（不是只挂第 1 腿）。
  // 🔴 排除的只有 `--installed-tree` 那一**模式**（它要真镜像里 dump 出来的树，消费者是
  //    `verify:selfhost-stack`），不是第 2/3 腿本身。10-04 13:5x 在载体上实测过：
  //    `--quiet` 的 coverage 与 install-contract 只读「提交物锁 / Dockerfile / 快照 / server/package.json」，
  //    里面的 `node_modules/<name>` 是**锁里的键形状**、不是磁盘路径 ⇒ 两条都 exit 0、不联网、不要 node_modules。
  //    这条为什么值得挂进落笔前：main 正在动 `server/`（一次重算就见到它往 devDependencies 里加了
  //    `@heyta/app-host` / `@heyta/storage` / `@heyta/sync-client`），而第 3 腿正是
  //    "prune 必须在第一条 install 之前 + prisma 三处同源"那一族的守门人。
  ['image-npm-tree 新鲜度（check:image-license 第 1 腿）', ['research/tools/gen-image-npm-tree.mjs', '--check']],
  ['镜像许可证覆盖（check:image-license 第 2 腿）', ['research/tools/check-image-license-coverage.mjs', '--quiet']],
  ['镜像安装合同（check:image-license 第 3 腿）', ['research/tools/check-image-install-contract.mjs']],
];
const runGate = (argv, cwd) => {
  try {
    return { rc: 0, out: execFileSync('node', argv, { cwd, encoding: 'utf8', maxBuffer: 1 << 26 }) };
  } catch (err) {
    return { rc: err.status ?? 1, out: `${err.stdout ?? ''}${err.stderr ?? ''}` };
  }
};
const brief = (out, rc) => out.trim().split('\n').filter((l) => l.trim() !== '')
  .slice(rc === 0 ? -2 : -8).join(' / ').replace(/\s+/g, ' ');

const gateReadings = [];
const reds = []; // {label, argv, re, rc, out}
for (const [label, argv, re] of GATES) {
  const g = runGate(argv, WT);
  if (g.rc === 0) {
    gateReadings.push(`${label} exit 0 —— ${brief(g.out, g.rc)}`);
    continue;
  }
  reds.push({ label, argv, re, rc: g.rc, out: g.out });
}

/* ── 红集配对：拿干净 main 的那棵树，逐条判"这条红 main 上有没有" ─────────
 * 判定本体在 `selfhost-red-attribution.mjs`（单一所有者，`--selftest` 12 条、
 * 五道守卫各做过摘除变异并各打红自己那条臂）。这里只做"取数 + 落笔前的接线"。 */
const ATTR = 'research/tools/selfhost-red-attribution.mjs';
let attrSelftestReading = '';
if (!existsSync(join(WT, ATTR))) {
  die(2, `红集归属的判据文件不在载体树上（${ATTR}）⇒ 载体红时没有任何东西能判"这条红是不是本批的"`);
}
{
  let out = '';
  let rc = 0;
  try {
    out = execFileSync('node', [join(WT, ATTR), '--selftest'], { encoding: 'utf8', maxBuffer: 8 << 20 });
  } catch (e) {
    rc = e.status ?? 1;
    out = `${e.stdout ?? ''}${e.stderr ?? ''}`;
  }
  const redArms = out.split('\n').filter((l) => /^RED\s/.test(l));
  const armLine = out.split('\n').find((l) => /臂数\s\d+/.test(l)) ?? '';
  const m = armLine.match(/臂数\s(\d+) · 红\s(\d+)/);
  if (rc !== 0) die(2, `红集归属判据的自检退 ${rc} ⇒ 不用它放行：\n${redArms.slice(0, 6).join('\n')}`);
  if (redArms.length) die(2, `红集归属判据自检**退出码 0 却带红臂**：${redArms[0]}`);
  if (!m || Number(m[1]) < 12 || Number(m[2]) !== 0) {
    die(2, `红集归属判据的自检读数对不上（臂数行："${armLine || '（没有这一行）'}"，要求 臂数 ≥12 且 红 = 0）`);
  }
  const a = attributionArms();
  if (a.length < 12 || a.some((x) => x.got !== x.expect)) {
    die(2, `红集归属判据从**函数**这一侧数出来对不上：${a.length} 条、不符 ${a.filter((x) => x.got !== x.expect).length} 条`);
  }
  attrSelftestReading = `红集归属判据自检：${m[1]} 条臂（含五条按理由认领的拒绝臂）红 0 · 五道守卫各做过摘除变异`;
  notes.push(attrSelftestReading);
}
let pairTree = false; // 供 teardown 收尾（这一层自己也是"现场"，拒了不留干净就等于给别人埋雷）
const ensurePairTree = () => {
  if (pairTree) return;
  if (existsSync(PAIR_WT)) git(['worktree', 'remove', '--force', PAIR_WT], { stdio: 'ignore' });
  git(['worktree', 'add', '--detach', PAIR_WT, mainSha]);
  // 🔴 配对树必须是**干净的 main**：脏了就说明它不是 main，那条"main 上也红"的读数便什么都不是。
  const dirty = git(['-C', PAIR_WT, 'status', '--porcelain']).split('\n').filter(Boolean).length;
  const at = git(['-C', PAIR_WT, 'rev-parse', 'HEAD']).trim();
  if (at !== mainSha || dirty > 0) {
    die(3, `配对树不是干净的 ${MAIN}（HEAD=${at} 应为 ${mainSha}，脏 ${dirty} 条）⇒ 没有可比的那一侧`);
  }
  pairTree = true;
  notes.push(`配对树就绪 ${PAIR_WT} @ ${mainSha.slice(0, 8)}（工作树脏 0 条）`);
};
if (reds.length) {
  ensurePairTree();
  const results = reds.map((g) => {
    const m2 = runGate(g.argv, PAIR_WT);
    return attributeRed({
      gate: g.label, carrierRc: g.rc, carrierOut: g.out,
      mainSha, mainRc: m2.rc, mainOut: m2.out, defectRe: g.re,
    });
  });
  const badVerdict = attributionVerdict(results);
  if (badVerdict) {
    die(3, `载体的纯 fs 门禁红了，而**逐条归属没有全部通过**（不提交）：\n  - ${badVerdict}\n` +
      `   ⇒ 归属不成立的那些必须先在解法侧修掉；本工具不拿"看起来差不多"当放行。`);
  }
  for (const r of results) {
    attribution.push(r.why);
    gateReadings.push(r.why);
  }
  notes.push(`红集归属：载体红 ${reds.length} 道，全部逐条归属到非本批（配对树 = 干净 main ${mainSha.slice(0, 8)}）`);
}

// ── 4. 新鲜度守卫 + 提交 + 移动分支 ──────────────────────────────────
const mainNow = git(['rev-parse', MAIN]).trim();
if (mainNow !== mainSha) {
  die(4, `main 在本次重算期间又前进了：${mainSha.slice(0, 8)} → ${mainNow.slice(0, 8)}。` +
    ` 载体不落笔（落了一笔"第一父不在 main 上"的对象比不落更坏）。重跑本脚本即可。`);
}
if (pairTree) { git(['worktree', 'remove', '--force', PAIR_WT], { stdio: 'ignore' }); pairTree = false; }
const msg = `merge(selfhost): 把 ${SOURCE} 合进 ${MAIN}（载体，第一父 = ${mainSha.slice(0, 8)}）

由 research/tools/selfhost-merge-carrier.mjs 产出，逐路径解法与断言记在该文件头部。
${notes.map((n) => `· ${n}`).join('\n')}

解法：${[pkgReading, giReading, auditReading, snapReading, genReading, covReading, dockReading].filter(Boolean).join('；')}
${fam.png.length ? `· evidence PNG ${fam.png.length} 枚取 main 侧` : ''}

载体的纯 fs 门禁读数（全部现量）
${gateReadings.map((r) => `· ${r}`).join('\n')}

🔴 完整 pnpm check（要 node_modules、要起栈、check:ai-e2e 会 SIGKILL 别人的 dev server）**不在这一笔的主张里**，
它是落地那一刻的判据；本笔只把"预置 ${Object.keys(fam).length - 1} 族冲突的解法"固化成一个可复核对象
（族数由分族表本身现量，不手抄）。
这一笔**不是** ${MAIN} 的推进。main 每前进一步或本批每多一笔，都要重跑本脚本（只认 ${BRANCH}，不认 SHA）。
`;
writeFileSync('/tmp/ht-carrier-msg.txt', msg);
git(['-C', WT, 'commit', '-q', '-F', '/tmp/ht-carrier-msg.txt']);
const carrierSha = git(['-C', WT, 'rev-parse', 'HEAD']).trim();
// 🔴 双亲要逐条取**完整 SHA**再比。`log --format=%p` 这一仓会打**缩写**（实测 `parents=ce6c1c98 b850b1c6`），
//    拿 40 位的 mainSha 去比必然不等 —— 那道断言就会把**合法**的载体判死，
//    而它已经在落笔之后了（本轮就是这么留下了一笔没被分支指向的载体对象）。
const p1 = git(['-C', WT, 'rev-parse', 'HEAD^1']).trim();
const p2 = git(['-C', WT, 'rev-parse', 'HEAD^2']).trim();
if (p1 !== mainSha || p2 !== srcSha) {
  die(5, `载体的双亲不对：p1=${p1} p2=${p2}，应当是 (${mainSha} ${srcSha})。载体 ${carrierSha} 已落笔但未指向分支`);
}
git(['branch', '-f', BRANCH, carrierSha]);
console.log(`✅ 载体 ${carrierSha.slice(0, 8)} = ${MAIN}(${mainSha.slice(0, 8)}) × ${SOURCE}(${srcSha.slice(0, 8)})，分支 ${BRANCH} 已指过去`);
console.log(`   ${pkgReading}`);
console.log(`   ${giReading}`);
// 🔴 自检这条必须在**成功路径**上也打出来：只进 notes（失败时才 dump）的判据，
//    在成功时是静默的，而"静默的通过"会被下一轮读成"没跑"或"跑了但没人看"。
console.log(`   ${capSelftestReading}`);
console.log(`   ${dockSelftestReading}`);
if (attribution.length) console.log(`   🔴 载体红 ${attribution.length} 道，已逐条归属到非本批（那条红仍在 main 上，不由本批修）：\n     ${attribution.join('\n     ')}`);
// 🔴 这句是**推导**出来的，不是写死的"全 exit 0"：归属过的红仍然是红（缺陷还躺在 main 上），
//    把它印成"8 道全 exit 0"就是本批一直在拦的那类对外错话，只不过读者是下一轮的我（§8.143 实测撞到的）。
console.log(`   门禁 ${GATES.length} 道：${GATES.length - attribution.length} 道 exit 0` +
  (attribution.length === 0
    ? '，全 exit 0'
    : ` + ${attribution.length} 道**红**已逐条归属到非本批（不吸收、不代改）`) +
  '；完整 pnpm check 留给落地那一刻');
console.log(`   main 若再前进 ⇒ 重跑：node research/tools/selfhost-merge-carrier.mjs`);
