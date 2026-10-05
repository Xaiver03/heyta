#!/usr/bin/env node
/**
 * 落地前的第三道面：**别人手上那版**（主检出的未提交工作树）与本批那版合不合得上。
 *
 * 为什么现有两把尺都不答这一格：
 * - `selfhost-conflict-screen.mjs` 比的是**两侧提交态**（`main` tip × 分支 tip）。
 * - `selfhost-landing-blockers.mjs` 判的是"主检出在这些路径上有未提交改动"，它**不预测内容**。
 * 而载体那步真正的风险是：那几枚路径被其所有者**提交之后**与本批同段相撞 ⇒ 落在
 * 预置族外的话载体 `die(2)`，而没人写过解法。这一格只能拿工作树那份去喂合并器。
 *
 * 🔴 判"会不会撞"用的是 git 自己的三方合并（`git merge-file`），不是文本 diff 的印象。
 * 🔴 `git merge-file` 不带 `-p` 会把结果**写回第一个参数** —— 本工具每轮重新播种三份输入
 *    （台账 §8.241 记的正是"同一临时目录跑第二轮，输入已被上一轮污染"这个形状）。
 * 🔴 退出码 0 只在**阳性对照也成立**时才打印；一个自我证明不了的"全部无冲突"按 2 退。
 * 🔴 **只有"预置族覆盖不到"的冲突才让本工具退 1**：`package.json` 天天撞而载体自己会解，
 *    把它算进红就是狼来了，而狼来了的判据等于没有判据。
 *    "是否预置"不靠手抄表 —— 拿载体源文本 `includes(路径)` 判，判不到就按 hazard 报（**误差方向保守**：
 *    哪天那条族规则改成 glob/前缀，路径不再逐字出现 ⇒ 本工具多报一次 hazard，而不是漏报）。
 *
 * 用法：
 *   node research/tools/selfhost-blocker-worktree-conflict.mjs              # 阻塞集逐枚预测
 *   node research/tools/selfhost-blocker-worktree-conflict.mjs --paths a,b   # 指定路径
 *   node research/tools/selfhost-blocker-worktree-conflict.mjs --selftest    # 只验判据有没有牙
 * 退出码：0 = 逐枚无冲突（且对照成立）· 1 = 有内容冲突（要它的所有者或人先写解法）
 *        · 2 = 探针问题（阻塞集拿不到 / 对照不成立 / 播种被上一轮改写）
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
const git = (args, cwd = ROOT) => execFileSync('git', args, { cwd, encoding: 'utf8' });

function die(code, msg, notes = []) {
  process.stdout.write(msg + '\n');
  for (const n of notes) process.stdout.write(`   ${n}\n`);
  process.exit(code);
}

const SRC = process.env.HEYTA_SOURCE_REF || 'feat/self-host-distribution';
const MAIN = process.env.HEYTA_MAIN_REF || 'main';

/** 主检出路径：从 `git worktree list --porcelain` 里取挂着 `main` 分支的那一枚。 */
function mainCheckout() {
  const blob = git(['worktree', 'list', '--porcelain'], ROOT);
  let path = null;
  let cur = null;
  for (const line of `${blob}\n`.split('\n')) {
    if (line.startsWith('worktree ')) cur = { path: line.slice(9).trim() };
    else if (line.startsWith('branch ')) {
      if (line.slice(7).replace(/^refs\/heads\//, '') === MAIN && cur) path = cur.path;
    } else if (line === '') cur = null;
  }
  if (!path) return null;
  try {
    git(['rev-parse', '--git-dir'], path);
  } catch {
    return null;
  }
  return path;
}

/** 阻塞集来自 `selfhost-landing-blockers.mjs` 的 BLOCK 行 —— 只留一把尺（不重算第二份）。 */
function blockerPaths() {
  const tool = join(ROOT, 'research/tools/selfhost-landing-blockers.mjs');
  let out;
  try {
    out = spawnSync('node', [tool], { cwd: ROOT, encoding: 'utf8' });
  } catch (e) {
    die(2, `探针问题：阻塞集那把尺起不来（${e.message}）`);
  }
  if (out.status !== 0) {
    die(2, `探针问题：阻塞集那把尺退 ${out.status}，它没给出可用清单`,
      (out.stderr || '').split('\n').filter(Boolean).slice(0, 3).map((l) => `stderr: ${l}`));
  }
  const paths = [...out.stdout.matchAll(/^  BLOCK (\S+)$/gm)].map((m) => m[1]);
  if (!paths.length) {
    // 阻塞集为空是**好消息**，但本工具没东西可判 ⇒ 按"不适用"退 0 并点名。
    die(0, '阻塞集 0 枚 ⇒ 本工具不适用（没有需要预测的路径）。');
  }
  return { paths, ruler: out.stdout };
}

/**
 * 一次判定 = 三份输入**各自新播**，喂给 git 的三方合并，读退出码。
 * `mergeFileInto` 会改写第一个参数，所以绝不把上一轮的 `ours` 再拿来用。
 */
function predict(base, ours, theirs) {
  const dir = mkdtempSync(join(tmpdir(), 'htblk-'));
  try {
    const f = (n, s) => {
      const p = join(dir, n);
      writeFileSync(p, s);
      return p;
    };
    const pBase = f('base', base);
    const pOurs = f('ours', ours);
    const pTheirs = f('theirs', theirs);
    const before = pOurs;
    const r = spawnSync('git', ['merge-file', '-q', '--diff3', before, pBase, pTheirs], { encoding: 'utf8' });
    if (r.error) die(2, `探针问题：git merge-file 起不来（${r.error.message}）`);
    const conflicted = r.status !== 0 || /<{7}/.test(readFileSync(pOurs, 'utf8'));
    return { conflicted, status: r.status };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** 载体那枚工具的源文本 —— "这条路径有没有人写过解法"的唯一判据来源（不另抄一份表）。 */
let carrierText = null;
function carrierSource() {
  if (carrierText === null) {
    const f = join(ROOT, 'research/tools/selfhost-merge-carrier.mjs');
    try {
      carrierText = readFileSync(f, 'utf8');
    } catch {
      die(2, `探针问题：读不到载体那枚工具（${f}）⇒ 没法判"预置覆盖"，hazard 那一档答不了`);
    }
  }
  return carrierText;
}
const presetCovered = (p) => carrierSource().includes(p);

const blobOf = (rev, p) => {
  const r = spawnSync('git', ['show', `${rev}:${p}`], { cwd: ROOT, encoding: 'utf8' });
  if (r.error) die(2, `探针问题：git show 起不来（${r.error.message}）`);
  return r.status === 0 ? r.stdout : null;
};

/**
 * 自检：三臂。A1 是**阳性对照**（已知会撞的合成输入必须报"会撞"），
 * A2 是阴性对照（各改各的行必须报"无冲突"），A3 钉住"播种脏复用"那个缺陷本身。
 */
function selftest() {
  const errs = [];
  const base = ['a', 'b', 'c'].join('\n') + '\n';
  const oursBoth = ['A', 'b', 'c'].join('\n') + '\n';
  const theirsBoth = ['Z', 'b', 'c'].join('\n') + '\n';
  const p1 = predict(base, oursBoth, theirsBoth);
  if (!p1.conflicted) errs.push('A1 阳性对照没报冲突 ⇒ 这枚探针不会红，它的"无冲突"不算读数');
  const theirsOk = ['a', 'b', 'C'].join('\n') + '\n';
  const p2 = predict(base, oursBoth, theirsOk);
  if (p2.conflicted) errs.push('A2 阴性对照报了冲突 ⇒ 它把"各改各的行"也判成撞');
  // A3：同一份 ours 若被上一轮改写，本轮结论就会变 —— 用第一轮跑过的那份输入再跑一次，
  // 它**不该**与"新播种的同一对输入"给出相同结果（相同 ⇒ 说明改写根本没发生，探针假安全）。
  const dir = mkdtempSync(join(tmpdir(), 'htblk3-'));
  try {
    const f = (n, s) => {
      const p = join(dir, n);
      writeFileSync(p, s);
      return p;
    };
    const pBase = f('base', base);
    const pOurs = f('ours', oursBoth);
    const pTheirs = f('theirs', theirsBoth);
    const first = spawnSync('git', ['merge-file', '-q', '--diff3', pOurs, pBase, pTheirs], { encoding: 'utf8' });
    const after = readFileSync(pOurs, 'utf8');
    if (first.status === 0) {
      errs.push('A3 的输入没造出冲突 ⇒ 这一臂量的不是"写回行为"（阳性对照失效，与 A1 同因）');
    } else if (after === oursBoth) {
      errs.push('A3 报了冲突却没写回第一个参数 ⇒ git 行为变了（此时"每轮重新播种"在防一个不存在的缺陷，'
        + '而本工具对 merge-file 的用法假设要重读 man 再定）');
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  // A4/A5/A6：预置覆盖那格判据的牙（它决定退出码，所以它也得能红）
  const srcText = carrierSource();
  if (!presetCovered('package.json')) {
    errs.push('A4 预置覆盖判据在 package.json 上判"覆盖不到" ⇒ 它读的那枚文本/命名变了，hazard 那一档不可信');
  }
  if (presetCovered('definitely/not/a/real/path.ts')) {
    errs.push('A5 一枚不存在的路径被判成"预置覆盖" ⇒ includes 判据恒真，hazard 那一档永远不会红');
  }
  if (!/fam\.pkg\.push/.test(srcText)) {
    errs.push('A6 载体源文本里找不到 `fam.pkg.push` 那行 ⇒ 判"预置覆盖"的根据挪走了（改名或重构），'
      + 'A4 那条"通过"现在只是巧合');
  }
  const lines = [`臂 6：A1[阳性对照] A2[阴性对照] A3[写回行为] A4[预置覆盖为正] A5[预置覆盖为负] A6[判据的根据还在原处]`, ...errs];
  process.stdout.write(lines.join('\n') + '\n');
  process.exit(errs.length ? 1 : 0);
}

if (process.argv.includes('--selftest')) selftest();

const checkout = mainCheckout();
if (!checkout) die(2, `探针问题：找不到挂着 ${MAIN} 的主检出（或它已不在）`);
const { paths, ruler } = blockerPaths();
const baseRev = git(['merge-base', MAIN, SRC]).trim();
const changed = (p) => {
  const w = join(checkout, p);
  let content;
  try {
    content = readFileSync(w, 'utf8');
  } catch {
    return null;
  }
  return content;
};

const rows = [];
let workArmUsed = 0;
for (const p of paths) {
  const base = blobOf(baseRev, p) ?? '';
  const ours = blobOf(SRC, p);
  if (ours === null) {
    rows.push({ p, tip: '判不了', work: '判不了', why: `${SRC} 那侧没有这枚路径` });
    continue;
  }
  const tipText = blobOf(MAIN, p) ?? '';
  const workText = changed(p);
  const rTip = predict(base, ours, tipText);
  const rWork = workText === null ? null : predict(base, ours, workText);
  if (rWork) workArmUsed += 1;
  const name = (r) => (r ? (r.conflicted ? '内容冲突' : '无冲突') : '读不到');
  rows.push({
    p,
    tip: name(rTip),
    work: name(rWork),
    why: rWork?.conflicted ? '工作树那版与本批同段相撞' : rTip.conflicted ? '提交态就撞（预置族负责解）' : '',
  });
}

const out = [];
out.push(`主检出=${checkout} · base=${baseRev.slice(0, 8)} · ${MAIN} × ${SRC}`);
out.push(`阻塞集 ${paths.length} 枚（逐枚喂 git 三方合并；工作树腿 ${workArmUsed} 枚可用）`);
for (const r of rows) out.push(`  ${r.tip}/${r.work.padEnd(4)}  ${r.p}${r.why ? `   ← ${r.why}` : ''}`);
const conflicts = rows.filter((r) => r.tip === '内容冲突' || r.work === '内容冲突').map((r) => r.p);
const hazards = conflicts.filter((p) => !presetCovered(p));
const covered = conflicts.filter((p) => presetCovered(p));
out.push(`判定：会撞 ${conflicts.length} 枚 / 全部 ${paths.length} 枚 · 形态=<提交态/工作树> 两腿各量一次`);
out.push(`   其中载体预置族**已覆盖** ${covered.length} 枚（${covered.join(' / ') || '无'}）· `
  + `**hazard（没人写过解法）${hazards.length} 枚**（${hazards.join(' / ') || '无'}）`);
if (hazards.length) out.push('🔴 hazard 非空 ⇒ 落地那一刻载体在 fam.other 上 die(2)：要它的所有者先与本批对齐，或有人先写出那一族的解法。');
if (!rows.some((r) => r.tip === '内容冲突' || r.work === '内容冲突')) {
  out.push('⚠️ 这批全是"无冲突"。对照成立与否由 --selftest 回答，不由本行的字回答：'
    + '判据的牙见 `node research/tools/selfhost-blocker-worktree-conflict.mjs --selftest`');
}
out.push('射程边界：① 只看**内容**合并，mode/改名/新增未跟踪不判；'
  + '② 工作树那版随时会被它的主人改掉 ⇒ 这是一枚瞬时读数，落地那一刻要重取；'
  + '③ 无冲突 ≠ 语义对（两侧各加一条同键词条会合得干净而判据红，那是 check:ui-language 的活）。');
for (const l of ruler.split('\n')) if (l.startsWith('夹具')) out.push(`阻塞集那把尺：${l.trim()}`);
process.stdout.write(out.join('\n') + '\n');
// 退出码只由 hazard 决定；逐枚"会撞/无冲突"形态仍然全量打印（见文件头那条"狼来了"）。
process.exit(hazards.length ? 1 : 0);
