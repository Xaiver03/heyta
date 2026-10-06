#!/usr/bin/env node
/**
 * 把本线三把验证台接进 `pnpm check` 的那一步，做成一条**自闸命令**。
 *
 * 为什么要它（§4.05 (52) 的补丁文本、(53)⑥ 与 (54)⑥ 的等待项）：这一步一直卡在
 * `package.json` 上别人的两枚未提交 hunk，而那两枚里有一枚 `@@ -66 +67 @@`
 * **正压在我要改的那条 `check` 链行上** —— 同一条行的两处插入不是两枚可分 hunk，
 * 所以"按 hunk 摘出自己那半"在这枚文件上不可行，只能等它腾开。
 * 等待本身没有失败模式，于是把"腾开之后要做的事"固化成一条命令，并让它自己判断能不能做：
 *
 *   默认 **dry-run**（只打印会改哪两处，不碰盘）；`--confirm` 才写。
 *   工作树里 `package.json` 脏 ⇒ **exit 3 拒绝**（那是别人的字节，不替他们带、也不往上报纸里塞）。
 *   锚点数不是恰好 1 ⇒ **exit 4 拒绝**（改了形的链不猜插入点）。
 *   写之前先用仓库自己的 `check:gate-wiring.mjs --pkg <候选>` 验一遍 ⇒ 不绿就 **exit 6，不落盘**。
 *
 * 用法：
 *   node research/tools/calendar-line-wire-evidence-rigs.mjs              # 看会改哪两处
 *   node research/tools/calendar-line-wire-evidence-rigs.mjs --confirm    # 真改（仍需另行提交）
 *   node research/tools/calendar-line-wire-evidence-rigs.mjs --pkg <路径>  # 夹具/候选文件（注入验证用）
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const NAME = 'check:calendar-evidence-rigs';
const RIGS = 'bash research/tools/calendar-line-commit-only-arms.sh'
  + ' && bash research/tools/r17-reshoot-arms.sh'
  + ' && bash research/tools/r17-reshoot-stale.sh --selftest';
// 锚点是**逐字整行/整片段**，不是正则：本线这条门禁的全部意义在于"不猜"。
const DEF_ANCHOR = '    "check:md-tables": "node scripts/check-md-table-rows.mjs",\n';
const DEF_LINE = `    "${NAME}": "${RIGS}",\n`;
const CHAIN_FROM = 'pnpm check:md-tables && pnpm check:pricing';
// 🔴 链里必须是 `pnpm <名字>`。第一版这里拼成了裸名字
// （`… && check:calendar-evidence-rigs && …`），那样写进 package.json 是一条跑不起来的命令，
// 而**它自己那格门禁当场把这一版判红了**（`定义还在，但不在这次的 check 链里`）—— 见 (59)③。
const CHAIN_TO = 'pnpm check:md-tables && pnpm ' + NAME + ' && pnpm check:pricing';

const argv = process.argv.slice(2);
const CONFIRM = argv.includes('--confirm');
const pkgIdx = argv.indexOf('--pkg');
const REPO = (() => {
  try {
    return execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch { return process.cwd(); }   // 不在仓库里也要能跑（夹具与非仓库目标），只是对账门禁那一格要如实跳过
})();
const PKG_RAW = pkgIdx >= 0 ? path.resolve(argv[pkgIdx + 1]) : path.join(REPO, 'package.json');
// 🔴 必须 realpath 两侧再算相对路径（夹具那一腿撞出来的真缺陷）：macOS 上 `/tmp` 是 `/private/tmp` 的软链，
//    `git rev-parse --show-toplevel` 给的是解析后的 `/private/...`，而 `path.resolve` 给的是 `/tmp/...`，
//    两者的 `path.relative` 会算出 `../../../tmp/...`，git 直接报 "outside repository" ⇒ 工具崩在 rc=1，
//    而 rc=1 在这一族读数里长得和"正常拒绝"一模一样。
const PKG = (() => { try { return fs.realpathSync(PKG_RAW); } catch { return PKG_RAW; } })();
const PKG_ROOT = (() => {
  try {
    return fs.realpathSync(execFileSync('git', ['-C', path.dirname(PKG), 'rev-parse', '--show-toplevel'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim());
  } catch { return ''; }                                                    // 非仓库目标：下面那一格会如实报 notgit
})();

// 对账门禁**只认目标自己那棵树**里的实现：拿别的树的门禁来判这份候选，
// 读数就成了"另一棵树的规则"（同族：软链/linked worktree 里 `git check-ignore` 问到的是别的树）。
// 目标不在任何仓库里（夹具、临时候选）时如实报 skipped，而不是退回调用者的树。
const GATE = PKG_ROOT ? path.join(PKG_ROOT, 'scripts', 'check-gate-wiring.mjs') : '';

const die = (code, msg) => { console.log(`   ${msg}`); process.exit(code); };
const count = (hay, needle) => hay.split(needle).length - 1;

console.log(`== ${NAME} 接入自检（${CONFIRM ? '--confirm 会写盘' : 'dry-run 不写盘'}）==`);
console.log(`   目标文件：${PKG}`);

let src;
try { src = fs.readFileSync(PKG, 'utf8'); } catch (e) { die(2, `❌ 读不到目标文件：${e.message}`); }
try { JSON.parse(src); } catch (e) { die(5, `❌ 目标文件本身不是合法 JSON ⇒ 不在这上面做插入：${e.message}`); }

const hasDef = count(src, DEF_LINE) === 1;
const hasChain = count(src, CHAIN_TO) === 1;
if (hasDef && hasChain) {
  console.log(`   ✅ 两处都已在册（定义 + 链）⇒ 无事可做，退出 0（幂等：这一条可以被反复跑）`);
  process.exit(0);
}
if (hasChain && !hasDef) {
  die(4, `❌ 链里有 ${NAME} 而定义行不在 ⇒ 这是半截状态，正确的修法不是自动补定义，去查是谁摘的`);
}

const nDef = count(src, DEF_ANCHOR);
const nChain = count(src, CHAIN_FROM);
console.log(`   锚点现量：定义行 ${nDef} 次（要 1）、链片段 ${nChain} 次（要 1）`);
if (nDef !== 1 || nChain !== 1) {
  die(4, `❌ 锚点不是恰好各 1 枚 ⇒ 那条链已经改了形，本工具**不猜插入点**（猜错会把一道门禁接进别的位置或造出非法 JSON）`);
}

// 🔴 工作树脏 ⇒ 拒绝。这一格的存在理由见文件头：别人的 hunk 压在**同一行**上，
//    此刻写盘会让下一笔提交把两边的字节搅在一起（或被下一笔静默抹掉）。
let dirty = 'notgit';
if (PKG_ROOT) {
  const rel = path.relative(PKG_ROOT, PKG);
  try {
    dirty = execFileSync('git', ['-C', PKG_ROOT, 'status', '--porcelain', '--', rel], { encoding: 'utf8' }).trim();
  } catch (e) {
    die(3, `❌ 查不到目标的工作树状态（${String(e.message || e).split('\n')[0]}）⇒ **保守拒绝**：证明不了"没有别人的字节"就不能往这枚文件上写`);
  }
}
if (dirty !== '' && dirty !== 'notgit') {
  console.log(`   现量：\`${dirty.replace(/\n/g, ' / ')}\``);
  die(3, `❌ 目标文件在工作树里是脏的（上面那行）⇒ 里面有别人未提交的字节，本工具不替他们带、也不往同一行上插`);
}

// 只补缺的那一半：这里若**无条件**插两次，"定义已在、链被摘了"那种半截状态会被写成两份同名定义
// （JSON 重名不会报错，最后一份生效 ⇒ 造出一枚静默的重复键）。
let cand = src;
if (!hasDef) cand = cand.replace(DEF_ANCHOR, DEF_ANCHOR + DEF_LINE, 1);
if (!hasChain) cand = cand.replace(CHAIN_FROM, CHAIN_TO, 1);
try { JSON.parse(cand); } catch (e) { die(5, `❌ 造出来的候选不是合法 JSON（这属于本工具的缺陷，不该写盘）：${e.message}`); }
if (hasDef === hasChain) {
  console.log(`   会改的两处：`);
  console.log(`     ① 在 \`"check:md-tables"\` 那行之后加一行定义：${DEF_LINE.trim()}`);
  console.log(`     ② 把链里的 \`${CHAIN_FROM}\` 换成 \`${CHAIN_TO}\``);
} else {
  console.log(`   会改的一处：${hasDef ? '只有链（定义已在册）' : '只有定义（链已在册）'}`);
}


// 候选必须先过**仓库自己的**那条链对账门禁，才谈得上"接进常驻消费者"。
let gateRc = 'skipped';
if (fs.existsSync(GATE)) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ht-wire-'));
  const tmpPkg = path.join(tmp, 'package.json');
  fs.writeFileSync(tmpPkg, cand);
  try {
    execFileSync('node', [GATE, '--pkg', tmpPkg], { stdio: 'pipe' });
    gateRc = '0';
  } catch (e) {
    gateRc = String(e.status ?? 'crash');
    const out = `${e.stdout || ''}${e.stderr || ''}`.split('\n').filter((l) => l.includes(NAME)).slice(0, 3).join(' | ');
    console.log(`   门禁读数：${out}`);
  }
  fs.rmSync(tmp, { recursive: true, force: true });
}
console.log(`   check:gate-wiring --pkg <候选> rc=${gateRc}${gateRc === 'skipped' ? '（目标不在任何 git 树里 ⇒ 那一格如实跳过，不借别的树的门禁）' : ''}`);
if (gateRc !== '0' && gateRc !== 'skipped') {
  die(6, `❌ 候选会被仓库自己的链对账门禁判红 ⇒ 不落盘（先修候选，别把一个红着的接进去）`);
}

if (!CONFIRM) {
  console.log(`   · dry-run 结束（没写盘）。要写：node ${path.relative(REPO, new URL(import.meta.url).pathname)} --confirm`);
  process.exit(0);
}
const tmp = `${PKG}.ht-wire.tmp`;
fs.writeFileSync(tmp, cand);
fs.renameSync(tmp, PKG);
console.log(`   ✅ 已写入 ${PKG}（两处各一次）。🔴 本工具**不提交** —— 提交是另一笔授权动作。`);
process.exit(0);
