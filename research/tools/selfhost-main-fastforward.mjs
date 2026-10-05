#!/usr/bin/env node
/**
 * 主检出的「基线快进」看守 —— 把 §8.207 那条授权固化成代码，而不是留在记忆里。
 *
 * 授权（产品负责人 2026-10-05 13:3x，原话「授权我在主检出干净时跑那一条 ff-only」）：
 *   前提 = 主检出 `git status --porcelain` **0 行**；
 *   动作 = 只有那一条 `git merge --ff-only origin/main`；
 *   仍然不做 = 编辑别人的文件 / 代提交 / push / 动别的分支 / 在非快进时硬来。
 *
 * 为什么值得写成脚本而不是手敲：这条前提与三个拒绝分支一旦被写进 prose 就会漂，
 * 而"手敲一次 ff"没有任何一层会替你检查 porcelain 当下是不是 0 行。
 *
 * 出口码（与 selfhost-land-main.mjs 的严重度口径对齐）：
 *   0 = 快进做完了，或本来就不落后
 *   1 = 不该继续等的失败：非快进（本地有独有提交）/ ff 命令本身失败 / 现场读不到
 *   2 = 前提不成立（--once / --check 下一次就退；watch 模式把它当"还没到"继续等）
 *   3 = 窗口等满（CAP 轮之后前提仍未成立 ⇒ 环境无效，不是产品失败）
 *
 * 用法：
 *   node research/tools/selfhost-main-fastforward.mjs --check        # 只判不动（现在就能跑）
 *   node research/tools/selfhost-main-fastforward.mjs --once         # 判一次，成立就动
 *   node research/tools/selfhost-main-fastforward.mjs                # 看守：等前提成立
 *   node research/tools/selfhost-main-fastforward.mjs --selftest     # 三臂自证（合成仓库，不碰主检出）
 *   旋钮：--step=180 --cap=200 --no-fetch  HEYTA_FF_REMOTE_MAIN  HEYTA_FF_FETCH_URL  HEYTA_FF_TARGET（夹具专用）
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const args = process.argv.slice(2);
const FLAG = (n) => args.includes(`--${n}`);
const OPT = (n) => {
  const hit = args.find((x) => x.startsWith(`--${n}=`));
  return hit ? hit.slice(n.length + 3) : undefined;
};
const say = (m) => process.stdout.write(`${m}\n`);
const stamp = () => new Date().toTimeString().slice(0, 8);

const MAIN_REF = 'main';
const REMOTE_MAIN = process.env.HEYTA_FF_REMOTE_MAIN || 'origin/main';
const STEP = Number(OPT('step') ?? 180);
const CAP = Number(OPT('cap') ?? 200);
if (!Number.isInteger(STEP) || STEP < 1 || !Number.isInteger(CAP) || CAP < 1) {
  say(`🔴 现场 —— --step/--cap 要正整数，读到 step=${OPT('step')} cap=${OPT('cap')}`);
  process.exit(1);
}

const gitOut = (a, cwd) => execFileSync('git', a, { cwd, encoding: 'utf8' }).trim();
const gitRun = (a, cwd) => {
  try {
    return { rc: 0, out: execFileSync('git', a, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim() };
  } catch (e) {
    return { rc: e.status ?? -1, out: `${e.stdout ?? ''}`.trim(), err: `${e.stderr ?? ''}`.trim() };
  }
};

/** origin 是 SSH 而这台机器今天走不通；HTTPS 同址是唯一可用的只读通道。转换只做一次，不抄 URL。 */
const httpsForm = (url) =>
  url.replace(/^ssh:\/\/git@/, 'https://').replace(/^git@([^:]+):/, 'https://$1/');

/** 主检出的路径由 `git worktree list` 现取，不写死 —— 与 lander 同一个来源，不抄第二份。 */
const mainTreeOf = (from) => {
  const out = gitOut(['worktree', 'list', '--porcelain'], from);
  let cur = {};
  for (const line of `${out}\n`.split('\n')) {
    if (line.startsWith('worktree ')) cur = { path: line.slice(9).trim() };
    else if (line.startsWith('branch ')) cur.branch = line.slice(7).replace('refs/heads/', '').trim();
    else if (line.trim() === '') {
      if (cur.path && cur.branch === MAIN_REF) return cur.path;
      cur = {};
    }
  }
  return '';
};

/**
 * 一轮判定。返回的 `kind` 是**这一格的全部信息**，调用方只按 kind 决定退不退，
 * 不在外面重算 porcelain —— 判据只有一处。
 */
const evaluate = (tree, { act, fetch }) => {
  const beforeFull = gitOut(['rev-parse', MAIN_REF], tree);
  const before = gitOut(['rev-parse', '--short', MAIN_REF], tree);
  const dirty = gitOut(['status', '--porcelain'], tree).split('\n').filter(Boolean);
  if (dirty.length) return { kind: 'dirty', before, beforeFull, lines: dirty.length };

  if (fetch) {
    const url = process.env.HEYTA_FF_FETCH_URL || httpsForm(gitOut(['remote', 'get-url', 'origin'], tree));
    const refspec = `+refs/heads/${MAIN_REF}:refs/remotes/${REMOTE_MAIN}`;
    const f = gitRun(['fetch', '--no-tags', url, refspec], tree);
    if (f.rc !== 0) return { kind: 'fetch-fail', before, beforeFull, msg: f.err || f.out || `rc=${f.rc}` };
  }

  let behind, ahead;
  try {
    behind = Number(gitOut(['rev-list', '--count', `${MAIN_REF}..${REMOTE_MAIN}`], tree));
    ahead = Number(gitOut(['rev-list', '--count', `${REMOTE_MAIN}..${MAIN_REF}`], tree));
  } catch {
    return { kind: 'no-remote-ref', before, beforeFull, ref: REMOTE_MAIN };
  }
  if (ahead > 0) return { kind: 'divergent', before, beforeFull, behind, ahead };
  if (behind === 0) return { kind: 'current', before, beforeFull, behind, ahead };
  if (!act) return { kind: 'would-ff', before, beforeFull, behind, ahead };

  const m = gitRun(['merge', '--ff-only', REMOTE_MAIN], tree);
  if (m.rc !== 0) return { kind: 'ff-fail', before, beforeFull, msg: `${m.out}\n${m.err}`.trim() };
  const afterFull = gitOut(['rev-parse', MAIN_REF], tree);
  const after = gitOut(['rev-parse', '--short', MAIN_REF], tree);
  const stillClean = gitOut(['status', '--porcelain'], tree).split('\n').filter(Boolean).length === 0;
  return { kind: 'ffed', before, after, afterFull, behind, ahead, stillClean, firstLine: m.out.split('\n')[0] };
};

/* ── 自证三臂：合成仓库，一个字节都不碰主检出 ─────────────────────────── */
if (FLAG('selftest')) {
  const dir = mkdtempSync(join(tmpdir(), 'heyta-ff-fixture-'));
  const src = join(dir, 'src');
  const work = join(dir, 'work');
  const setup = () => {
    gitRun(['init', '-q', '-b', 'main', src]);
    gitRun(['config', 'user.name', 'fixture'], src);
    gitRun(['config', 'user.email', 'fixture@example.invalid'], src);
    writeFileSync(join(src, 'a.txt'), '1\n');
    gitRun(['add', 'a.txt'], src);
    gitRun(['commit', '-q', '-m', 'c1'], src);
    gitRun(['commit', '-q', '--allow-empty', '-m', 'c2'], src);
    gitRun(['clone', '-q', src, work], dir);
    gitRun(['commit', '-q', '--allow-empty', '-m', 'c3'], src);
    gitRun(['fetch', '-q', 'origin'], work);
  };
  setup();

  const arms = [];
  const claim = (name, expect, got) => arms.push({ name, expect, got, red: expect !== got });

  // 臂 1：主检出脏 ⇒ 拒绝，且 main 一滴不动
  const sha0 = gitOut(['rev-parse', MAIN_REF], work);
  writeFileSync(join(work, 'someone-elses-work.txt'), 'dirty\n');
  const a1 = evaluate(work, { act: true, fetch: false });
  claim('脏 ⇒ kind=dirty 且 main 未动', 'dirty|same', `${a1.kind}|${gitOut(['rev-parse', MAIN_REF], work) === sha0 ? 'same' : 'MOVED'}`);
  rmSync(join(work, 'someone-elses-work.txt'));

  // 臂 2：本地有独有提交 ⇒ 不是快进，那条授权不覆盖它
  gitRun(['commit', '-q', '--allow-empty', '-m', 'local-only'], work);
  const a2 = evaluate(work, { act: true, fetch: false });
  const sha2 = gitOut(['rev-parse', MAIN_REF], work);
  claim('非快进 ⇒ kind=divergent 且 main 未动', 'divergent|same', `${a2.kind}|${sha2 === a2.beforeFull ? 'same' : 'MOVED'}`);
  gitRun(['reset', '-q', '--hard', `${REMOTE_MAIN}~1`], work);

  // 臂 3：干净 + 只落后 ⇒ 真快进，落点必须等于公开那一笔
  const a3 = evaluate(work, { act: true, fetch: false });
  const landedTo = gitOut(['rev-parse', MAIN_REF], work);
  const expectTo = gitOut(['rev-parse', MAIN_REF], src);
  claim('干净且只落后 ⇒ 快进到公开那一笔', 'ffed|same|true', `${a3.kind}|${landedTo === expectTo ? 'same' : `GOT ${landedTo}≠${expectTo}`}|${a3.stillClean}`);

  const reds = arms.filter((a) => a.red);
  for (const a of arms) say(`${a.red ? '🔴' : '✅'} ${a.name} —— 期望 ${a.expect} / 实读 ${a.got}`);
  rmSync(dir, { recursive: true, force: true });
  say(`臂 ${arms.length} 条：红 ${reds.length} 条`);
  process.exit(reds.length ? 8 : 0);
}

/* ── 现场 ─────────────────────────────────────────────────────────────── */
const anchor = process.env.HEYTA_FF_TARGET || mainTreeOf(process.cwd());
if (!anchor) {
  say(`🔴 现场 —— 没找到签出 ${MAIN_REF} 的工作树（现量分支：${
    gitOut(['worktree', 'list', '--porcelain'], process.cwd())
      .split('\n').filter((l) => l.startsWith('branch ')).map((l) => l.slice(7).replace('refs/heads/', '')).join(', ')
  }）`);
  process.exit(1);
}

const ACT = !FLAG('check');
const FETCH = !FLAG('no-fetch');
const label = `${anchor} · ${REMOTE_MAIN} · ${ACT ? '会动手' : '只判不动'}`;

if (FLAG('once') || FLAG('check')) {
  const r = evaluate(anchor, { act: ACT, fetch: FETCH });
  say(JSON.stringify(r));
  process.exit(
    r.kind === 'ffed' || r.kind === 'current' ? 0
      : r.kind === 'dirty' || r.kind === 'would-ff' ? 2
        : 1,
  );
}

say(`${stamp()} 看守起步 ${label}`);
for (let i = 1; i <= CAP; i++) {
  const r = evaluate(anchor, { act: ACT, fetch: FETCH });
  const reading = r.kind === 'dirty' ? `脏 ${r.lines} 行`
    : `${r.kind} main=${r.before}${r.after ? `→${r.after}` : ''}${r.behind !== undefined ? ` 落后${r.behind}/独有${r.ahead}` : ''}`;
  say(`${stamp()} [${i}/${CAP}] ${reading}`);
  if (r.kind === 'ffed') {
    say(`✅ 快进完成：${r.before} → ${r.after}（${r.behind} 笔），工作树仍干净=${r.stillClean}`);
    say(`   首行原文：${r.firstLine}`);
    process.exit(0);
  }
  if (r.kind === 'current') { say(`✅ 本来就不落后（${REMOTE_MAIN}=${r.before}）⇒ 无事可做`); process.exit(0); }
  if (r.kind === 'dirty' || r.kind === 'would-ff') { await new Promise((s) => setTimeout(s, STEP * 1000)); continue; }
  if (r.kind === 'no-remote-ref') {
    say(`🔴 拿不到 ${REMOTE_MAIN} ⇒ 基线新不新鲜**判不了**（判了 ≠ 没问题）。先只读取一次现量再重跑看守。`);
    process.exit(1);
  }
  say(`🔴 ${r.kind} —— 原样报，不重试、不解释成环境：\n${r.msg ?? `本地独有 ${r.ahead} 笔 ⇒ 这不是快进，那条授权不覆盖它（main=${r.before}）`}`);
  process.exit(1);
}
say(`🔴 窗口等满 ${CAP} 轮（前提从未成立）⇒ 环境无效，不是产品失败`);
process.exit(3);
