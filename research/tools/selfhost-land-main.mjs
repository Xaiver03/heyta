#!/usr/bin/env node
/**
 * 把 `feat/self-host-distribution` 落进 `main` —— **一条命令，但默认什么都不动**。
 *
 * 为什么要有它：落地那一步的四条禁令（不动主检出 / 不 `git branch -f main` / 不 push /
 * 不代改别人的文档）和三条前置（阻塞集归零 / 载体是**当前** main × 当前分支 / 双亲对得上）
 * 全靠人记，而 main 在 20 分钟里能前进两次（§8.111 ① 实测）。
 * 这里把它们变成**一次跑完的体检**：每条闸门都出读数，最后按最严重那一档退出。
 *
 * 用法：
 *   node research/tools/selfhost-land-main.mjs                 # 只体检，打印要跑的命令
 *   node research/tools/selfhost-land-main.mjs --confirm       # 真的落地（必须在主检出目录里跑）
 *   node research/tools/selfhost-land-main.mjs --carrier <ref> # 用现成的载体，不重算（测双亲闸门用）
 *   node research/tools/selfhost-land-main.mjs --attribute     # check 红时接着跑逐段归属
 *
 * 退出码（严重度 2 > 1 > 3，"等窗口"不该盖过"这一步本来就不该做"）：
 *   0 = 体检通过（dry-run）/ 已落地（--confirm）
 *   2 = 探针或用法问题（找不到工作树、--confirm 却不在主检出里跑、脚本没报出可读的数）
 *   1 = 前置不成立（双亲不对 / 阻塞集非空 / main 在算完之后又动了 / --confirm 但 check 没跑）
 *   3 = 环境无效（负载超阈值）—— 环境无效不等于产品失败
 *   4 = 载体上完整 `pnpm check` 红 ⇒ **不落地**，先逐段归属
 */
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const MAIN_REF = 'main';
const BRANCH_REF = process.env.HEYTA_LAND_BRANCH ?? 'feat/self-host-distribution';
const MERGE_REF = 'feat/self-host-merge-main';
const CARRIER_DIR = process.env.HEYTA_LAND_CARRIER_DIR ?? join(tmpdir(), 'heyta-merge-carrier');
const MAX_LOAD = Number(process.env.HEYTA_LAND_MAX_LOAD ?? 12);

const ARGS = process.argv.slice(2);
const FLAG = (n) => ARGS.includes(`--${n}`);
const OPT = (n) => {
  const i = ARGS.indexOf(`--${n}`);
  return i >= 0 ? ARGS[i + 1] : null;
};
const CONFIRM = FLAG('confirm');

const LOG = join(tmpdir(), 'heyta-land-main.log');
const say = (line) => {
  process.stdout.write(`${line}\n`);
  appendFileSync(LOG, `${new Date().toISOString().slice(11, 19)} ${line}\n`);
};
const git = (args, cwd) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
const run = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, encoding: 'utf8', maxBuffer: 64 << 20 });

/**
 * 闸门收集器：一次跑完把所有不成立的都打出来，再按严重度退。
 * 第一件事就 exit 的写法，会让人每修一条才看见下一条 —— 而落地这一步的窗口是分钟级的。
 */
const fails = [];
const gate = (severity, name, fn) => {
  try {
    const note = fn();
    say(`✅ ${name}${note ? ` —— ${note}` : ''}`);
  } catch (e) {
    if (e?.probe) {
      say(`🔴 ${name} —— ${e.message}`);
      process.exit(2);
    }
    if (e?.skipped) {
      say(`⏭️ ${name} —— ${e.message}`);
      return;
    }
    const sev = e?.sev ?? severity;
    fails.push({ sev, name, msg: e?.message ?? String(e) });
    say(`🔴 ${name} —— ${e?.message ?? String(e)}`);
  }
};
const refuse = (msg, sev = 1) => {
  const e = new Error(msg);
  e.sev = sev;
  throw e;
};
/** 跳过**必须响亮**，而且不能记成通过 —— 沉默跳过等于给后面的落地放行。 */
const skip = (msg) => {
  const e = new Error(msg);
  e.skipped = true;
  throw e;
};

/* ── 0. 现场 ──────────────────────────────────────────────────────── */
const trees = (() => {
  const out = [];
  let cur = {};
  const porcelain = execFileSync('git', ['worktree', 'list', '--porcelain'], { encoding: 'utf8' });
  for (const line of `${porcelain}\n`.split('\n')) {
    if (line.startsWith('worktree ')) cur = { path: line.slice(9).trim() };
    else if (line.startsWith('branch ')) cur.branch = line.slice(7).replace('refs/heads/', '').trim();
    else if (line.trim() === '') {
      if (cur.path) out.push(cur);
      cur = {};
    }
  }
  return out;
})();
const mainTree = trees.find((t) => t.branch === MAIN_REF);
const branchTree = trees.find((t) => t.branch === BRANCH_REF);
if (!mainTree || !branchTree) {
  say(`🔴 现场 —— 没找到签出 ${mainTree ? BRANCH_REF : MAIN_REF} 的工作树` +
    `（\`git worktree list\` 里的分支：${trees.map((t) => t.branch ?? '?').join(', ')}）`);
  process.exit(2);
}
const here = process.cwd();
say(`主检出=${mainTree.path} · 分支检出=${branchTree.path} · 当前目录=${here}`);

if (CONFIRM && here !== mainTree.path) {
  say('🔴 落地动作 —— --confirm 只能在主检出里跑');
  say(`   本脚本**故意不跨工作树**去 merge（那是"动主检出"，而主检出的工作树属于别人）。`);
  say(`   要真的落地：cd ${mainTree.path} && node research/tools/selfhost-land-main.mjs --confirm`);
  process.exit(2);
}

/* ── 1. 双亲与新鲜度：载体必须正好是 main × 分支 ──────────────────── */
const mainSha = git(['rev-parse', MAIN_REF], branchTree.path);
const branchSha = git(['rev-parse', BRANCH_REF], branchTree.path);
let carrierSha = OPT('carrier');
gate(1, '载体双亲对上', () => {
  if (!carrierSha) {
    const out = run('node', ['research/tools/selfhost-merge-carrier.mjs'], branchTree.path);
    const m = out.match(/✅ 载体 ([0-9a-f]{7,40}) = /);
    if (!m) {
      const e = new Error(`载体脚本没报出"✅ 载体 <sha>"：\n${out.slice(-600)}`);
      e.probe = true;
      throw e;
    }
    carrierSha = m[1];
    say(out.trim().split('\n').filter((l) => l.startsWith('✅') || l.trim().startsWith('并集') || l.includes('门禁')).join('\n'));
  } else {
    say(`⚠️ 用现成载体 ${carrierSha}（--carrier，没重算）`);
  }
  /* ⚠️ 双亲**不存在**和双亲**不对**是两件事：前者说明给的根本不是合并提交
     （`--carrier` 打错、或载体脚本没真造出 merge），把它报成 git 的原始错误会被读成探针坏了。 */
  const parent = (n) => {
    try {
      return git(['rev-parse', `${carrierSha}^${n}`], branchTree.path);
    } catch {
      return null;
    }
  };
  const p1 = parent(1);
  const p2 = parent(2);
  if (p1 === null || p2 === null) {
    refuse(`${carrierSha.slice(0, 8)} 不是双亲齐全的合并提交（^1=${p1?.slice(0, 8) ?? '无'} ^2=${p2?.slice(0, 8) ?? '无'}）` +
      ` ⇒ 它不是载体脚本的产物，别拿它落地`);
  }
  if (p1 !== mainSha) {
    refuse(`第一父 ${p1.slice(0, 8)} ≠ ${MAIN_REF} ${mainSha.slice(0, 8)} ⇒ 载体过期，落地会装一笔旧合并`);
  }
  if (p2 !== branchSha) {
    refuse(`第二父 ${p2.slice(0, 8)} ≠ ${BRANCH_REF} ${branchSha.slice(0, 8)} ⇒ 分支在算完载体后又动了`);
  }
  return `载体 ${carrierSha.slice(0, 8)} = ${mainSha.slice(0, 8)} × ${branchSha.slice(0, 8)}`;
});

/* ── 2. 阻塞集必须为空 ────────────────────────────────────────────── */
gate(1, '阻塞集为空', () => {
  const out = run('node', ['research/tools/selfhost-landing-blockers.mjs'], branchTree.path);
  const m = out.match(/阻塞集 (\d+) 枚/);
  if (!m) {
    const e = new Error(`阻塞集脚本没报出"阻塞集 N 枚"，读数不可信：\n${out.slice(-400)}`);
    e.probe = true;
    throw e;
  }
  const n = Number(m[1]);
  if (n !== 0) {
    const list = out.split('\n').filter((l) => l.trim().startsWith('BLOCK ')).map((l) => l.trim().slice(6));
    refuse(`${n} 枚未清空：${list.join(' · ')}\n` +
      '   这些是**别人未提交的工作树**，不是合并冲突（§8.111 ② 量过：提交态零冲突）⇒ 等他们提交。');
  }
  return '夹具绿 ⇒ 这个"空"是可信读数';
});

/* ── 3. 环境 ──────────────────────────────────────────────────────── */
gate(3, '负载可用', () => {
  const load1 = Number(
    execFileSync('sysctl', ['-n', 'vm.loadavg'], { encoding: 'utf8' })
      .replace(/[{}]/g, '').trim().split(/\s+/)[0],
  );
  if (load1 > MAX_LOAD) {
    refuse(`负载 ${load1} > ${MAX_LOAD} ⇒ 环境无效（不调阈值、不硬跑）。等窗口，或显式 HEYTA_LAND_MAX_LOAD=<n>`, 3);
  }
  return `1 分钟负载 ${load1} ≤ ${MAX_LOAD}`;
});

/* ── 4. 载体上跑完整 pnpm check ───────────────────────────────────── */
let checkRan = false;
let checkOk = false;
gate(4, '载体上完整 pnpm check', () => {
  if (fails.length) {
    skip(`没跑（前面已有 ${fails.length} 条不成立 ⇒ 这一趟本来就不该落地）。跳过不等于通过。`);
  }
  if (!existsSync(CARRIER_DIR)) {
    refuse(`载体目录 ${CARRIER_DIR} 不存在 ⇒ 完整 check 没跑（跳过不等于通过）`);
  }
  const checkLog = join(tmpdir(), 'heyta-land-check.log');
  checkRan = true;
  say(`   日志 → ${checkLog}`);
  try {
    const out = run('pnpm', ['check'], CARRIER_DIR);
    writeFileSync(checkLog, out);
  } catch (e) {
    writeFileSync(checkLog, `${e.stdout ?? ''}\n---STDERR---\n${e.stderr ?? ''}\n---\n${e.message}`);
    refuse(`rc=${e.status ?? 1} ⇒ **不落地**。关闭判据是"每一枚红仍可归属到非本批"，不是"全绿"。\n` +
      `   逐段归属：node research/tools/selfhost-check-segments.mjs --tree ${CARRIER_DIR} --as carrier --ref ${MERGE_REF} --out /tmp/attrib.tsv` +
      (FLAG('attribute') ? '' : '（或给本脚本加 --attribute）'), 4);
  }
  checkOk = true;
  return '全绿';
});

/* ── 5. 落地 ──────────────────────────────────────────────────────── */
gate(1, 'main 未被别人抢先', () => {
  const now = git(['rev-parse', MAIN_REF], branchTree.path);
  if (now !== mainSha) refuse(`main 在体检期间从 ${mainSha.slice(0, 8)} 动到 ${now.slice(0, 8)} ⇒ 重跑本脚本`);
  return `${mainSha.slice(0, 8)} 仍是当前值`;
});

/** 探针问题（sev 2）在 `gate` 里就地退出，所以这里只排"能出可信读数"的三档。 */
const RANK = { 4: 0, 1: 1, 3: 2 };
if (fails.length) {
  const top = fails.slice().sort((a, b) => RANK[a.sev] - RANK[b.sev])[0];
  say(`\n🔴 体检未过：${fails.length} 条不成立，按最严重那一档退（${top.name} ⇒ exit ${top.sev}）`);
  process.exit(top.sev);
}

if (!checkRan || !checkOk) {
  say('🔴 完整 check 没有真的跑过（跳过不等于通过）');
  process.exit(1);
}

const cmd = `git merge --ff-only ${MERGE_REF}`;
if (!CONFIRM) {
  say(`\n✅ 体检全过。要落地，在**主检出**里跑：\n   cd ${mainTree.path} && node research/tools/selfhost-land-main.mjs --confirm`);
  say(`   （等价的裸命令，仅供核对：${cmd}。本脚本不 push。）`);
  process.exit(0);
}
git(['merge', '--ff-only', MERGE_REF], mainTree.path);
const landed = git(['rev-parse', MAIN_REF], mainTree.path);
if (landed !== carrierSha) {
  say(`🔴 merge 之后 main=${landed.slice(0, 8)} ≠ 载体 ${carrierSha.slice(0, 8)} —— 立刻查`);
  process.exit(1);
}
say(`✅ main 已前进到 ${landed.slice(0, 8)}（ff-only，未 push）`);
