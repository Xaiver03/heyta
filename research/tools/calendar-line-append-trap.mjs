#!/usr/bin/env node
/**
 * 把"往 `docs/reference/environment-traps.md` 追加一条环境陷阱"做成一条**自闸命令**（§4.05 (54)⑦ 的文本、(59) 同形）。
 *
 * 为什么不是"等文件干净了我再来写"：这一条已经等了三轮，而等待期间**没有任何东西会失败** ——
 * 编号对不对、有没有跟人撞号、文件此刻是不是脏，全靠下一位自己记得。
 * 所以这里把三个判断固化成退出码（默认 dry-run，`--confirm` 才动盘；缺 `--text` 直接 exit 1）：
 *
 *   ① 目标在工作树里脏 ⇒ `exit 3`。那本册子是并行会话的取证账本，别人正在写的 hunk 不替他们带。
 *   ② 远端跟踪分支（`origin/main`，以**上次 fetch 到的那份**为准）与本检出的**编号集合对不上号** ⇒ `exit 3`。
 *      两种形状各自会红：算出来的 N 已被远端占用；以及 N 不撞、但远端有本检出没有的号 / 同号写着两条不同的坑
 *      （§4.05 (61)③ 在真字节上量到的是后者：`origin/main` 末号 283、本检出 HEAD 278，`#279`–`#283` 同号不同文）。
 *      这一条不是仪式：本检出此刻 `ahead 8 / behind 594`，"没拉下来的条目"是真实存在的一批编号。
 *      没有该 ref 时**如实打印** `REMOTE=absent`，不假装验过；对得上时打印"对得上号"（阳性对照，臂 35）。
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
const N = maxOf(src) + 1;
let headMax = 'nogit';
if (ROOT) {
  try { headMax = maxOf(execFileSync('git', ['-C', ROOT, 'show', `HEAD:${rel}`], { encoding: 'utf8' })); } catch { headMax = 'nohead'; }
}
console.log(`   现量末号：工作树 ${maxOf(src)}（HEAD ${headMax}）⇒ 这一枚取 ${N}`);
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
    if (new RegExp(`^${N}\\. `, 'm').test(out)) {
      die(3, `❌ 上次 fetch 到的 \`origin/main\` 里号 ${N} 已被占用 ⇒ 本检出落后远端时"没拉下来的条目"是真实存在的一批编号；先让同步那一头收号，本工具不猜下一个空号`);
    }
    // 🔴 上面那一格只挡"N 恰好撞远端已用的号"，而 §4.05 (61)③ 在**真数据**上量到的形状比它宽：
    //    `origin/main` 末号 283、本检出 HEAD 278，`#277`/`#278` 两边同文而 `#279`–`#283` **同号写着两条不同的坑**。
    //    那种状态下等本地未提交那 14 条一落地，N 会算成 293 —— 不与远端撞，于是这一枚被追加进一本
    //    **已经重号**的册子，把歧义从 5 枚加到 6 枚，而输出看着完全正常。
    //    ⇒ 这一格判的是"这本册子当前与远端对得上号吗"，跟 N 撞不撞无关。
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
    const missing = [...RMAP.keys()].filter((k) => !LMAP.has(k));
    const clash = [...RMAP.keys()].filter((k) => LMAP.has(k) && LMAP.get(k) !== RMAP.get(k));
    if (missing.length || clash.length) {
      const show = (xs) => xs.slice(0, 6).join(', ') + (xs.length > 6 ? ` …（共 ${xs.length} 枚）` : '');
      die(3, `❌ 这本册子与上次 fetch 到的 \`origin/main\` **已经对不上号**：`
        + (missing.length ? ` 远端有 ${missing.length} 枚号在本检出里不存在（${show(missing)}）；` : '')
        + (clash.length ? ` 同号不同文 ${clash.length} 枚（${show(clash)}）；` : '')
        + `⇒ 先让同步那一头把两边收进同一份，本工具不往一本重号的册子尾部再加一枚`);
    }
    console.log('   · 远端对照：本检出的编号集合与 origin/main **对得上号**（号同、首行文本同）');
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

console.log(`   会追加的一行（首行，其余 ${body.split('\n').length - 1} 行随后）：`);
console.log(`     ${N}. ${body.split('\n')[0].slice(0, 72)}`);
if (!CONFIRM) {
  console.log(`   · dry-run 结束（没写盘）。要写：node research/tools/calendar-line-append-trap.mjs --text <同一份> --confirm`);
  process.exit(0);
}
fs.writeFileSync(TARGET, `${src.replace(/\s+$/, '')}\n\n${N}. ${body}\n`);
console.log(`   ✅ 已追加号 ${N}。🔴 本工具**不提交**，也不改 AGENTS §7 那张索引表（那里写着"新条目追加到 traps 末尾，不要写回本文件"）。`);
process.exit(0);
