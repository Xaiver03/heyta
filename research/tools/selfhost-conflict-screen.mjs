#!/usr/bin/env node
/**
 * `research/tools/selfhost-conflict-screen.mjs` —— **不建载体**就回答一个问题：
 * "现在合，载体脚本会不会退在 `预置十一族之外`（fam.other）上？"
 *
 * ═══════════════════════════════════════════════════════════════════
 * 为什么要它（这一格只有窗口前才能量到，而窗口是唯一贵的东西）
 * ═══════════════════════════════════════════════════════════════════
 *
 * 落地链第 1 道就是"重算载体"，而载体脚本对 `fam.other` 的处理是 **die(2)**
 * （`selfhost-merge-carrier.mjs:348`：出现预置族之外的冲突路径 ⇒ 不许自动决定）。
 * 哨兵等到的是"阻塞集=0 + 负载 + 端口 + 载体空闲 + main 不动"这五件同时成立，
 * 而**这五件里没有"冲突面还在十一族之内"** —— 于是完全可能出现：窗口开了 →
 * 重算载体 → 撞出一枚新族 → 退 2 → 这一趟窗口（以及它前面的十几分钟连静）白烧。
 * 本批的族数一夜从 8 涨到 11（第九族 10-04 23:0x、第十/十一族 10-05 01:1x），
 * 所以"不会新增"这个前提**不是**恒真的，它得量。
 *
 * 载体脚本本身量不到这件事之前有多贵：它要一棵 `/tmp/heyta-merge-carrier` 工作树、
 * 要过"别的进程正在用这棵树"闸门、还要真跑一遍 merge。**本工具一条都不碰**：
 * 它只用 `git diff --name-status` + `git merge-file` 在临时文件上试合，
 * 一次读盘、零写盘（除临时目录）、不动主检出、不动任何分支。
 *
 * ## 它判什么
 *
 *  1. 两侧都动过的同一枚路径 → 拿 base/main/src 三份 blob 跑 `git merge-file`，
 *     冲突块数 > 0 ⇒ 预测它进 unmerged 集；
 *  2. 一侧删、另一侧改（modify/delete）⇒ 预测 unmerged（git 在这里一定留冲突条目）；
 *  3. 把预测到的那批路径**按载体的族表分类**，报出每族几枚 + 集外是哪几枚。
 *
 * ## 它看不见什么（这几样明写，不折算成 0）
 *
 *  - **改名参与**（任一侧是 `R`）：git 的重命名跟随与本工具的近似判定会给不同答案，
 *    所以这类路径只进 `blind` 清单，不进"无冲突"；
 *  - 文件/目录同名碰撞、mode/symlink 位变化：`--name-status` 不报，看不见；
 *  - 载体里那些**取一侧之外还有专门解法**的族（第 1 族并集、第 9 族剪枝切块、
 *    第 10 族纯追加）在这里仍会被算成"内容冲突"—— 那是对的：载体确实要处理它们，
 *    只是处理得了。所以本工具的读数**不是**"会不会有冲突"，而是
 *    **"有冲突的那批里有没有一族没预置的"**。
 *
 * 🔴 结论的形状是"预测"，不是"判据"：`other=0` 只说"按这个近似看不到集外"，
 *    真正决定落地成不成仍是载体的 `分族：…other=0` 那一行。
 *    所以退 3（有 blind / 有读不到的 blob）时**不要**当成"可以落地"，
 *    而是"这一格只能靠跑载体拿"。
 *
 * ## 族表是抄件，抄件配了门
 *
 * 本文件里的族表是 `selfhost-merge-carrier.mjs` 的**第二份**。没有把它抽成共享模块
 * 是刻意的：那枚文件是落地路径上唯一执行者，为了让一个只读预测工具去改它，
 * 代价（改错一处 ⇒ 故障正好在落地那一刻现形）远大于养一条对账臂。
 * ⇒ `--selftest` 的 A2/A3 两臂**每次自检都读载体原文**：字面量对不上、
 *   或载体加了第 12 族而这里没跟着加 ⇒ 直接红（形状同哨兵 B11"判针有出处"）。
 *
 * 用法：
 *   node research/tools/selfhost-conflict-screen.mjs                     # 对 main
 *   node research/tools/selfhost-conflict-screen.mjs --main=<ref>        # 换 ref（排障）
 *   node research/tools/selfhost-conflict-screen.mjs --src=<ref>
 *   node research/tools/selfhost-conflict-screen.mjs --selftest          # 十臂，零 git 仓库依赖
 * 退出码：0 = 预测集外 0 且无盲点 · 2 = 预测有集外（落地会 die 2）·
 *         3 = 有盲点/读不到 blob（这一格只能靠载体实测）· 1 = 工具自身错。
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const TOOL = 'research/tools/selfhost-conflict-screen.mjs';
const CARRIER = 'research/tools/selfhost-merge-carrier.mjs';
const REPO = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

/* ── 族表（`selfhost-merge-carrier.mjs:290-345` 的抄件，A2/A3 钉住它）──── */
export const isPngEvidence = (p) => p.startsWith('apps/web/evidence/') && p.endsWith('.png');
export const FAMILY_TABLE = [
  ['pkg', (p) => p === 'package.json'],
  ['gi', (p) => p === '.gitignore'],
  ['png', isPngEvidence],
  ['audit', (p) => p === 'docs/research/self-host-distribution-audit.md'],
  ['snap', (p) => p === 'server/image-npm-tree.json'],
  ['gen', (p) => p === 'research/tools/gen-image-npm-tree.mjs'],
  ['cov', (p) => p === 'research/tools/check-image-license-coverage.mjs'],
  ['cap', (p) => p === 'scripts/screenshots/capture.mjs'],
  ['dock', (p) => p === 'server/Dockerfile'],
  ['deploy', (p) => p === 'docs/runbooks/deployment.md'],
  ['lspec', (p) => p === 'e2e/live-site/live-domain.spec.ts'],
];
export const FAMILY_KEYS = FAMILY_TABLE.map(([k]) => k);
export const FAMILY_LITERALS = {
  pkg: 'package.json',
  gi: '.gitignore',
  audit: 'docs/research/self-host-distribution-audit.md',
  snap: 'server/image-npm-tree.json',
  gen: 'research/tools/gen-image-npm-tree.mjs',
  cov: 'research/tools/check-image-license-coverage.mjs',
  cap: 'scripts/screenshots/capture.mjs',
  dock: 'server/Dockerfile',
  deploy: 'docs/runbooks/deployment.md',
  lspec: 'e2e/live-site/live-domain.spec.ts',
};

export const classifyConflict = (p) => {
  for (const [key, pred] of FAMILY_TABLE) if (pred(p)) return key;
  return 'other';
};

/** 与载体同形状的分族对象（含 other），顺序保持输入顺序。 */
export const groupConflicts = (paths) => {
  const fam = Object.fromEntries([...FAMILY_KEYS, 'other'].map((k) => [k, []]));
  for (const p of paths) fam[classifyConflict(p)].push(p);
  return fam;
};

/* ── 抄件对账（纯函数：喂载体原文 + 本表，返回漂移说明数组）──────────── */
export const familyTableDrift = (carrierSrc, keys = FAMILY_KEYS, literals = FAMILY_LITERALS) => {
  const bad = [];
  for (const k of keys) {
    if (k === 'png') {
      if (!carrierSrc.includes("p.startsWith('apps/web/evidence/')")) bad.push('png 谓词的前缀在载体原文里找不到');
      if (!carrierSrc.includes("p.endsWith('.png')")) bad.push('png 谓词的后缀在载体原文里找不到');
      continue;
    }
    const lit = literals[k];
    if (!carrierSrc.includes(lit)) bad.push(`族 ${k} 的字面量「${lit}」在载体原文里找不到`);
  }
  // 反向：载体里 `fam.X.push(p)` 出现过的族键，本表必须都认得（挡"载体加了第 12 族"）。
  const carrierKeys = [...new Set([...carrierSrc.matchAll(/fam\.([a-z]+)\.push\(p\)/g)].map((m) => m[1]))];
  const unknown = carrierKeys.filter((k) => k !== 'other' && !keys.includes(k));
  if (unknown.length) bad.push(`载体里出现了本表不认的族键：${unknown.join(', ')}`);
  return bad;
};

/* ── 预测（纯函数：喂两侧 name-status 映射 + blob 读取器）───────────────
 * map: Map<path, {st: 'A'|'M'|'D'|'R…', from?: string}>
 * readBlob: (ref, path) => Buffer | null（null = 该 ref 里读不到，例如新增文件的 base 侧）
 * 返回 { conflicts: [{path, kind, blocks}], blind: [{path, why}], unreadable: [path] }
 */
export const predictFromMaps = (oursMap, theirsMap, readBlob, tryMerge) => {
  const conflicts = [];
  const blind = [];
  const unreadable = [];
  for (const [path, ours] of oursMap) {
    if (!theirsMap.has(path)) continue;
    const theirs = theirsMap.get(path);
    if (ours.st === 'D' && theirs.st === 'D') continue;
    if (ours.st.startsWith('R') || theirs.st.startsWith('R')
      || ours.from || theirs.from) {
      blind.push({ path, why: '改名参与（本工具不判重命名跟随）' });
      continue;
    }
    if (ours.st === 'D' || theirs.st === 'D') {
      conflicts.push({ path, kind: 'modify/delete', blocks: 1 });
      continue;
    }
    let base; let oursBlob; let theirsBlob;
    try {
      base = readBlob('base', path);
      oursBlob = readBlob('ours', path);
      theirsBlob = readBlob('theirs', path);
    } catch {
      unreadable.push(path);
      continue;
    }
    if (oursBlob === null || theirsBlob === null) {
      unreadable.push(path);
      continue;
    }
    const blocks = tryMerge(base, oursBlob, theirsBlob);
    if (blocks === null) {
      unreadable.push(path);
      continue;
    }
    if (blocks > 0) conflicts.push({ path, kind: 'content', blocks });
  }
  return { conflicts, blind, unreadable };
};

/* ── 自检臂（不依赖仓库 ref：git merge-file 只吃临时文件）────────────── */
const FLAG = (name) => process.argv.find((a) => a === `--${name}`);
const OPT = (name) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
};

const selftest = () => {
  const arms = [];
  const push = (name, expect, got) => arms.push({ name, expect, got });
  const dir = mkdtempSync(join(tmpdir(), 'conflict-screen-'));
  const mergeFile = (base, ours, theirs) => {
    const b = join(dir, 'b'); const o = join(dir, 'o'); const t = join(dir, 't');
    writeFileSync(b, base ?? Buffer.from(''));
    writeFileSync(o, ours);
    writeFileSync(t, theirs);
    try {
      execFileSync('git', ['merge-file', '-q', '--diff3', '-L', 'main', '-L', 'base', '-L', 'src', o, b, t]);
      return 0;
    } catch (e) {
      if (typeof e.status !== 'number') return null; // 不是"有冲突"，是"跑不了"
      return e.status > 127 ? null : e.status;
    }
  };

  // A1 逐族认领 + 集外
  for (const [k, lit] of Object.entries(FAMILY_LITERALS)) {
    push(`A1 族 ${k} 认领它自己的路径`, k, classifyConflict(lit));
  }
  push('A1b png 走谓词而不是字面量', 'png', classifyConflict('apps/web/evidence/whatever.png'));
  push('A1c 一枚没预置的路径 ⇒ other', 'other', classifyConflict('research/tools/brand-new.mjs'));

  // A2 抄件对账：真原文必须无漂移，改一个字符必须报漂移（阳性对照）
  let carrierSrc = null;
  try {
    carrierSrc = readFileSync(join(REPO, CARRIER), 'utf8');
  } catch { /* 报告在下面 */ }
  if (carrierSrc) {
    push('A2 本表 vs 载体原文 ⇒ 无漂移', 0, familyTableDrift(carrierSrc).length);
    const mutated = { ...FAMILY_LITERALS, deploy: 'docs/runbooks/DEPLOYMENT-typo.md' };
    const drift = familyTableDrift(carrierSrc, FAMILY_KEYS, mutated);
    push('A2b 阳性对照：把 deploy 那枚字面量改错 ⇒ 必须报漂移', true, drift.some((m) => m.includes('DEPLOYMENT-typo')));
    const pngMutated = FAMILY_KEYS.filter((k) => k !== 'png');
    push('A2c 阳性对照：本表少一族（漏登记 png）⇒ 反向检查必须报"不认的族键 png"', true,
      familyTableDrift(carrierSrc, pngMutated, FAMILY_LITERALS).some((m) => m.includes('不认的族键：png')));
    push('A2d 阳性对照：载体多出第 12 族而本表不认 ⇒ 必须报漂移', true,
      familyTableDrift(`${carrierSrc}\n  else if (x) fam.twelfth.push(p);\n`).some((m) => m.includes('twelfth')));
  } else {
    push('A2 读不到载体原文 ⇒ 不许算通过', 'ok', '读不到');
  }

  // A4/A5/A6 merge-file 三臂（单位：冲突块）
  // 🔴 A4 的期望值本身是一条读数：**两侧各自在末尾纯追加，在 git 层就是未合并**（1 块）。
  //    这正是载体要有第 2/4/10 族（纯追加走并集）的原因 —— 若这里期望 0，
  //    本工具就会把"未合并但载体解得了"误报成"不该有冲突"。
  const baseTxt = Buffer.from('a\nb\nc\n');
  push('A4 两侧各自在末尾纯追加 ⇒ git 层 1 块（载体才把它并掉）', 1,
    mergeFile(baseTxt, Buffer.from('a\nb\nc\nmain\n'), Buffer.from('a\nb\nc\nsrc\n')));
  push('A5 两侧改同一行 ⇒ ≥1 块', true,
    mergeFile(baseTxt, Buffer.from('a\nMAIN\nc\n'), Buffer.from('a\nSRC\nc\n')) >= 1);
  push('A6 只有一侧改 ⇒ 0 块', 0, mergeFile(baseTxt, baseTxt, Buffer.from('a\nb\nc\nsrc\n')));

  // A7/A8/A9/A10 预测层的形状（喂合成 map，不碰仓库）
  const m = (entries) => new Map(entries.map(([p, st, from]) => [p, { st, from }]));
  const reader = (ref, path) => (path === 'gone.txt' && ref !== 'ours' ? null : Buffer.from('x\n'));
  const r7 = predictFromMaps(m([['a.txt', 'M'], ['b.txt', 'M'], ['c.txt', 'D']]),
    m([['a.txt', 'M'], ['b.txt', 'M'], ['c.txt', 'M']]), reader, () => 1);
  push('A7 modify/delete 进冲突集且 kind 对', 'modify/delete',
    r7.conflicts.find((c) => c.path === 'c.txt')?.kind);
  push('A7b 两枚同改由 tryMerge 决定（喂 1 ⇒ 两枚都算 content）', 2,
    r7.conflicts.filter((c) => c.kind === 'content').length);
  const r8 = predictFromMaps(m([['old.txt', 'R', 'pre.txt']]), m([['old.txt', 'M']]), reader, () => 0);
  push('A8 改名参与 ⇒ 进 blind，不进冲突集', true,
    r8.blind.length === 1 && r8.conflicts.length === 0);
  push('A8b 阳性对照：改名那枚没被算成"无冲突"', 0,
    r8.conflicts.filter((c) => c.path === 'old.txt').length);
  const r9 = predictFromMaps(m([['gone.txt', 'M']]), m([['gone.txt', 'M']]), reader, () => 0);
  push('A9 blob 读不到 ⇒ 进 unreadable，不许折算成 0 冲突', 1, r9.unreadable.length);
  const r10 = predictFromMaps(m([['gone.txt', 'D']]), m([['gone.txt', 'D']]), reader, () => 1);
  push('A10 两侧都删 ⇒ 不算冲突', 0, r10.conflicts.length);

  // A11 分族对象形状：other 保序、pkg/png 各归各处
  const fam = groupConflicts(['package.json', 'research/tools/brand-new.mjs', 'apps/web/evidence/x.png', 'zzz.txt']);
  push('A11 分族计数（pkg/png/other 各 1/1/2）', '1|1|2',
    `${fam.pkg.length}|${fam.png.length}|${fam.other.length}`);
  push('A11b other 保持输入顺序', 'research/tools/brand-new.mjs,zzz.txt', fam.other.join(','));

  rmSync(dir, { recursive: true, force: true });

  let bad = 0;
  for (const a of arms) {
    if (String(a.expect) !== String(a.got)) {
      bad += 1;
      process.stdout.write(`  🔴 ${a.name} · 期望=${JSON.stringify(a.expect)} 实到=${JSON.stringify(a.got)}\n`);
    }
  }
  process.stdout.write(`${TOOL} --selftest：臂数 ${arms.length} · 红 ${bad}\n`);
  if (arms.length < 20) {
    process.stdout.write(`🔴 臂数 ${arms.length} < 20 ⇒ 自检本身退化了（族表 11 条认领就该有 11 臂）\n`);
    return 1;
  }
  if (bad) return 1;
  process.stdout.write('✅ 全部臂符合预期（含四臂阳性对照：改错字面量／少一族／载体加第 12 族／改名被当成无冲突）\n');
  return 0;
};

if (FLAG('selftest')) process.exit(selftest());

/* ── 真跑 ─────────────────────────────────────────────────────────── */
const MAIN_REF = OPT('main') ?? 'main';
const SRC_REF = OPT('src') ?? 'feat/self-host-distribution';
const git = (args, enc = 'utf8') => execFileSync('git', ['-C', REPO, ...args], { encoding: enc, maxBuffer: 1 << 26 });
const sha = (ref) => git(['rev-parse', ref]).trim();

let mainSha; let srcSha; let baseSha;
try {
  mainSha = sha(MAIN_REF);
  srcSha = sha(SRC_REF);
  baseSha = git(['merge-base', mainSha, srcSha]).trim();
} catch (e) {
  process.stdout.write(`🔴 ref 解析失败（main=${MAIN_REF} src=${SRC_REF}）：${String(e.message).split('\n')[0]}\n`);
  process.exit(1);
}
if (baseSha === srcSha) {
  process.stdout.write(`ℹ️ ${SRC_REF} 已是 ${MAIN_REF} 的祖先（base==src）⇒ 本批已并进 main，这一屏没有东西可预测。\n`);
  process.exit(0);
}

/** `git diff -M --name-status base ref` → Map<path, {st, from}>（重命名记 from）。 */
const nameStatus = (base, ref) => {
  const out = new Map();
  for (const line of git(['diff', '-M', '--name-status', base, ref]).split('\n').filter(Boolean)) {
    const [st, ...rest] = line.split('\t');
    const code = st[0];
    if (code === 'R') {
      const [, to] = rest;
      out.set(to, { st: 'R', from: rest[0] });
    } else {
      out.set(rest[0], { st: code });
    }
  }
  return out;
};

const oursMap = nameStatus(baseSha, mainSha); // 载体里 "ours" = main（第一父）
const theirsMap = nameStatus(baseSha, srcSha);
const blob = (which, path) => {
  const ref = which === 'base' ? baseSha : which === 'ours' ? mainSha : srcSha;
  try {
    return git(['show', `${ref}:${path}`], 'buffer');
  } catch (e) {
    const msg = String(e.stderr ?? e.message);
    if (msg.includes('exists on disk, but not in') || msg.includes('does not exist in')
      || /fatal: path .* does not exist/.test(msg)) return null;
    throw e;
  }
};
const tryMerge = (base, ours, theirs) => {
  const dir = mkdtempSync(join(tmpdir(), 'conflict-screen-run-'));
  try {
    const b = join(dir, 'b'); const o = join(dir, 'o'); const t = join(dir, 't');
    writeFileSync(b, base ?? Buffer.from(''));
    writeFileSync(o, ours);
    writeFileSync(t, theirs);
    try {
      execFileSync('git', ['merge-file', '-q', '--diff3', '-L', 'main', '-L', 'base', '-L', 'src', o, b, t]);
      return 0;
    } catch (e) {
      if (typeof e.status !== 'number') return null;
      return e.status > 127 ? null : e.status;
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

const both = new Set([...oursMap.keys()].filter((p) => theirsMap.has(p)));
const { conflicts, blind, unreadable } = predictFromMaps(oursMap, theirsMap, blob, tryMerge);
const fam = groupConflicts(conflicts.map((c) => c.path));

process.stdout.write([
  `主检出仓库：${REPO}`,
  `main=${mainSha.slice(0, 8)}（${MAIN_REF}）· ${SRC_REF}=${srcSha.slice(0, 8)} · merge-base=${baseSha.slice(0, 8)}`,
  `两侧都动过的路径 ${both.size} 枚 · 其中 main 侧 ${oursMap.size} 枚 / 本批侧 ${theirsMap.size} 枚`,
  '',
  `预测 unmerged（枚）：内容冲突 ${conflicts.filter((c) => c.kind === 'content').length} · modify/delete ${conflicts.filter((c) => c.kind === 'modify/delete').length}`,
  `分族：${FAMILY_KEYS.map((k) => `${k}=${fam[k].length}`).join(' ')} other=${fam.other.length}`,
  ...(fam.other.length ? [`🔴 预测集外（落地会 die 2，要先把这枚加进载体的族表）：\n  - ${fam.other.join('\n  - ')}`] : []),
  ...(conflicts.length ? [`   逐枚：${conflicts.map((c) => `${c.path}(${c.kind}${c.kind === 'content' ? ` ${c.blocks} 块` : ''})`).join(' · ')}`] : []),
  '',
  `盲点（不许折算成 0）：改名参与 ${blind.length} 枚 · blob 读不到 ${unreadable.length} 枚`,
  ...(blind.length ? [`   - ${blind.map((b) => `${b.path}（${b.why}）`).join('\n   - ')}`] : []),
  ...(unreadable.length ? [`   读不到：${unreadable.join(' · ')}`] : []),
  '',
  '⚠️ 这是**预测**，不是判据：真正决定的是载体那行 `分族：…other=0`。',
  '   本工具看不见 文件/目录碰撞 与 mode/symbolic-link 位变化（`--name-status` 不报）。',
].join('\n') + '\n');

const rc = fam.other.length ? 2 : (blind.length || unreadable.length ? 3 : 0);
process.stdout.write(`SCREEN other=${fam.other.length} content=${conflicts.filter((c) => c.kind === 'content').length} `
  + `mdd=${conflicts.filter((c) => c.kind === 'modify/delete').length} blind=${blind.length} `
  + `unreadable=${unreadable.length} rc=${rc}\n`);
process.exit(rc);
