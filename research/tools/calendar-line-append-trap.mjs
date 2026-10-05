#!/usr/bin/env node
/**
 * 把"往 `docs/reference/environment-traps.md` 追加一条环境陷阱"做成一条**自闸命令**（§4.05 (54)⑦ 的文本、(59) 同形）。
 *
 * 为什么不是"等文件干净了我再来写"：这一条已经等了三轮，而等待期间**没有任何东西会失败** ——
 * 编号对不对、有没有跟人撞号、文件此刻是不是脏，全靠下一位自己记得。
 * 所以这里把三个判断固化成退出码（默认 dry-run，`--confirm` 才动盘；缺 `--text` 直接 exit 1）：
 *
 *   ① 目标在工作树里脏 ⇒ `exit 3`。那本册子是并行会话的取证账本，别人正在写的 hunk 不替他们带。
 *   ② 与上次 fetch 到的 `origin/main` 相比，分两种形状两种处置（裁决见 §4.05 (65)）：
 *      · **同号不同文** ⇒ `exit 3`。同一枚号下有两种主张，留哪条是**内容判断**，工具不代拍。
 *      · **远端领先本检出** ⇒ **不拒绝**，按「号只增不改、两边各追加时后落地的一方顺延」把号抬到
 *        两边最大号之后（臂32/34 是这两腿）。旧版在这里直接拒绝，于是凭空多出一枚前置
 *        ——「等远端被收进本检出」根本不必等，中间那段空号在远端有定义，是诚实的；重号才是假的。
 *      没有该 ref 时**如实打印** `REMOTE=absent`，不假装验过；两边对得上时打印"对得上号"（臂35 阳性对照）。
 *   ③ 正文首行已在册 ⇒ 报"已在册（现量号 X）"并 `exit 0`（幂等**按正文判**，见下面那腿）。
 *
 * 编号**只在写的那一刻现量**（`grep -oE '^[0-9]+\. ' | sort -n | tail -1`），
 * 所以 (54)⑦ 那句"279 是占位、要现量"永远不会被抄成答案。
 *
 * 用法：
 *   node research/tools/calendar-line-append-trap.mjs --text <条目正文文件>            # dry-run
 *   node research/tools/calendar-line-append-trap.mjs --text <条目正文文件> --confirm  # 真追加
 *   node … --text … --pkg-file <路径>                                                  # 夹具/注入验证用
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const argv = process.argv.slice(2);
const CONFIRM = argv.includes('--confirm');
const getFlag = (f) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : ''; };
const TEXT = getFlag('--text');
const REPO = (() => {
  try {
    return execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch { return process.cwd(); }
})();
const REL = 'docs/reference/environment-traps.md';
const TARGET_RAW = getFlag('--pkg-file') ? path.resolve(getFlag('--pkg-file')) : path.join(REPO, REL);
// 与 (59)D2 同族：`/tmp` 在 macOS 上是 `/private/tmp` 的软链，两侧不同源会让 git 报 outside repository。
const TARGET = (() => { try { return fs.realpathSync(TARGET_RAW); } catch { return TARGET_RAW; } })();
const ROOT = (() => {
  try {
    return fs.realpathSync(execFileSync('git', ['-C', path.dirname(TARGET), 'rev-parse', '--show-toplevel'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim());
  } catch { return ''; }
})();

const die = (code, msg) => { console.log(`   ${msg}`); process.exit(code); };
if (!TEXT) die(1, `❌ 缺 --text <条目正文文件> ⇒ 不猜要写什么（也不接受在命令行里内联正文：那会绕开"文本先过人"那一步）`);

let body;
try { body = fs.readFileSync(path.resolve(TEXT), 'utf8').replace(/\s+$/, ''); }
catch (e) { die(1, `❌ 读不到 --text 指的文件：${e.message}`); }
if (!body) die(1, '❌ 条目正文是空的');
if (/^\s*[0-9]+\.\s/.test(body)) die(1, '❌ 正文里已经自带了编号 ⇒ 编号只能由本工具现量给（自带号会跟现量号相加变成双号）');

console.log(`== 追加一枚环境陷阱（${CONFIRM ? '--confirm 会写盘' : 'dry-run 不写盘'}）⇒ ${TARGET}`);
const rel = ROOT ? path.relative(ROOT, TARGET) : '';
if (ROOT) {
  let dirty;
  try { dirty = execFileSync('git', ['-C', ROOT, 'status', '--porcelain', '--', rel], { encoding: 'utf8' }).trim(); }
  catch (e) { die(3, `❌ 查不到目标的工作树状态（${String(e.message || e).split('\n')[0]}）⇒ 保守拒绝`); }
  if (dirty) die(3, `❌ 目标脏（\`${dirty.replace(/\n/g, ' / ')}\`）⇒ 那本册子是并行会话的取证账本，别人未提交的 hunk 不替他们带`);
} else {
  console.log('   · 目标不在 git 树里 ⇒ 脏检查那一格如实跳过（夹具注入验证用）');
}

const src = fs.readFileSync(TARGET, 'utf8');
const maxOf = (s) => (s.match(/^\d+\. /gm) || []).map((x) => parseInt(x, 10)).sort((a, b) => a - b).pop() ?? 0;
const N0 = maxOf(src) + 1;
let N = N0;
let headMax = 'nogit';
if (ROOT) {
  try { headMax = maxOf(execFileSync('git', ['-C', ROOT, 'show', `HEAD:${rel}`], { encoding: 'utf8' })); } catch { headMax = 'nohead'; }
}
console.log(`   现量末号：工作树 ${maxOf(src)}（HEAD ${headMax}）⇒ 初算 ${N}（远端对照那一格可能把它顺延）`);
// 🔴 原本这里还有一档"N 是否已被占用"，它是**永远不会红的判据**：N 就是同一份文本里的最大号 +1，
//    按定义 `^N\. ` 在那份文本里不可能存在。一条不能失败的检查比没有检查更糟（AGENTS §7 元规则 2），
//    所以这里删掉它，把"撞号"这件事交给下面那一格**真的会红**的远端对照。

// 🔴 "ref 不存在"与"读 ref 时出了别的错"**必须是两种读数**。第一版这里只有一个 `try/catch + continue`，
//    而 `rel` 是块级作用域、在下面那格已经看不见 ⇒ 抛的是 ReferenceError ⇒ 被同一个 catch 咽掉
//    ⇒ 打印成 `REMOTE=absent（不假装验过）` —— 一句读起来很诚实的话，实际是探针自己坏了。
//    现场指认它的是同一行里的 `HEAD nohead`（那格用的是同一个越界变量）。
let remote = 'absent';
if (ROOT) {
  const refExists = (r) => {
    try {
      execFileSync('git', ['-C', ROOT, 'rev-parse', '--verify', '--quiet', r], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
      return true;
    } catch { return false; }
  };
  if (refExists('origin/main')) {
    let out = null;
    try { out = execFileSync('git', ['-C', ROOT, 'show', `origin/main:${rel}`], { encoding: 'utf8' }); }
    catch (e) { die(3, `❌ 读不到 origin/main 里那份册子（${String(e.message || e).split('\n')[0]}）⇒ 保守拒绝，不把"读不到"当成"没占用"`); }
    remote = 'checked';
    const numMap = (s) => {
      const m = new Map();
      for (const line of s.split('\n')) {
        const hit = line.match(/^(\d+)\.\s(.*)$/);
        if (hit) m.set(parseInt(hit[1], 10), hit[2]);
      }
      return m;
    };
    const LMAP = numMap(src);
    const RMAP = numMap(out);
    const show = (xs) => xs.slice(0, 6).join(', ') + (xs.length > 6 ? ` …（共 ${xs.length} 枚）` : '');
    const clash = [...RMAP.keys()].filter((k) => LMAP.has(k) && LMAP.get(k) !== RMAP.get(k));
    const missing = [...RMAP.keys()].filter((k) => !LMAP.has(k));
    // 🔴 同号不同文要**再分一档**才知道需不需要人：
    //    · 位移 = 这一枚号下两边写的不一样，但**各自那句话在对方那边另有其号** ⇒ 没有"两种主张"，
    //      只是号被对方占去了；这是机械事实，pull 之后自然对齐，工具不必拦（真数据就是这一形：
    //      HEAD `#269` 那句话在 `origin/main` 里落在 **282**）。
    //    · 真分叉 = 某一侧的那句话在对方**任何号下都不存在** ⇒ 同一枚号下有两种主张，留哪条是内容判断，
    //      工具不许猜 ⇒ `exit 3`。
    //    ⚠️ 形状以现量为准（§4.05 (65)）：(61)③ 曾把「origin 独有 279–283」与「同号不同文」混写成一句。
    const RV = new Set(RMAP.values());
    const LV = new Set(LMAP.values());
    const shifted = clash.filter((k) => RV.has(LMAP.get(k)) || LV.has(RMAP.get(k)));
    const realClash = clash.filter((k) => !RV.has(LMAP.get(k)) && !LV.has(RMAP.get(k)));
    if (realClash.length) {
      die(3, `❌ 与上次 fetch 到的 \`origin/main\` **同号不同文且互不相容 ${realClash.length} 枚**（${show(realClash)}）`
        + `⇒ 同一枚号下有两种主张、各自在对方任何号下都不存在，留哪条是内容判断；本工具不代拍`);
    }
    // 而"远端领先本检出"这一形**不是拒绝的理由**：按 10-05 拍下的收号裁决——
    // **号只增不改，两边各追加时后落地的一方顺延**——把号抬到两边最大号之后再写，
    // 中间那段空号是诚实的（它在远端有定义），而重复号不是。
    // 旧版在这里直接拒绝，于是第 5 项凭空多出一枚前置（"等远端被收进本检出"），而它根本不必等。
    if (shifted.length) {
      console.log(`   · 同号不同文 ${shifted.length} 枚（${show(shifted)}）经对账是**位移**（各自那句话在对方另有其号）⇒ 不是两种主张，不需要人裁决`);
    }
    if (missing.length || shifted.length) {
      const RMAX = Math.max(...RMAP.keys());
      if (RMAX + 1 > N) {
        console.log(`   · 本检出落后远端（远端多 ${missing.length} 枚号${missing.length ? '：' + show(missing.sort((a, b) => a - b)) : ''}）`
          + `⇒ 按「后落地的一方顺延」把号从 ${N} 抬到 ${RMAX + 1}（中间空号在远端有定义，不回收、不复用）`);
        N = RMAX + 1;
      } else {
        console.log('   · 本检出落后远端，但取号已在两边最大号之后 ⇒ 不必抬高');
      }
    } else {
      console.log('   · 远端对照：本检出的编号集合与 origin/main **对得上号**（号同、首行文本同）');
    }
  }
}
console.log(`   远端那一格：REMOTE=${remote}${remote === 'absent' ? '（这个仓库没有可读的 origin/main ref ⇒ 那一格真的没验，不是验过说没问题）' : ''}`);

// 🔴 幂等要按**正文**判，不能按"算出来的号"判：号是现量 max+1，追加一次之后 max 就变了，
//    于是"再跑一次报已在册"那一格永远不会命中 —— 第二次会心满意足地再追加一份**内容相同、编号不同**的条目。
//    （这是我自己刚造的一枚"永远通过的判据"，靠下面那腿配对测试才现形。）
const already = src.split('\n').findIndex((l) => l.replace(/^\d+\.\s+/, '') === body.split('\n')[0]);
if (already >= 0) {
  const gotNo = (src.split('\n')[already].match(/^(\d+)\./) || [])[1] || '?';
  console.log(`   ✅ 这一枚已在册（现量号 ${gotNo}）⇒ 无事可做，退出 0（幂等按正文判，不按号判）`);
  process.exit(0);
}

console.log(`   ⇒ 这一枚取 ${N}${N !== N0 ? `（由初算 ${N0} 顺延而来）` : ''}`);
console.log(`   会追加的一行（首行，其余 ${body.split('\n').length - 1} 行随后）：`);
console.log(`     ${N}. ${body.split('\n')[0].slice(0, 72)}`);
if (!CONFIRM) {
  console.log(`   · dry-run 结束（没写盘）。要写：node research/tools/calendar-line-append-trap.mjs --text <同一份> --confirm`);
  process.exit(0);
}
fs.writeFileSync(TARGET, `${src.replace(/\s+$/, '')}\n\n${N}. ${body}\n`);
console.log(`   ✅ 已追加号 ${N}。🔴 本工具**不提交**，也不改 AGENTS §7 那张索引表（那里写着"新条目追加到 traps 末尾，不要写回本文件"）。`);
process.exit(0);
