#!/usr/bin/env node
/**
 * `scripts/verify-detail-pane-ownership.mjs`（归属门判据）的变异装置。
 *
 * 载体是**临时真 git 仓库**（`git init` + 提交 + 手工制造脏状态），不是仓库真身 ——
 * 这条判据读的是"主检出此刻的未提交集合"，那是活树瞬时状态，拿真仓当夹具的读数第二天就不成立，
 * 而且会在别人的工作树上制造脏状态（绝对不行）。
 *
 * 臂集（每条都断"红在哪一档"，不只断退出码 —— 载体没跑起来与判据查到红在这类脚本上同形）：
 *   R1 别人脏着 1 枚、点名的正好不重合        → RC=0，且 `被占 0 条` 与 `未提交 1 枚` 两个数都在场
 *                                                🔴 这条是本装置的核心对照：它证明"绿"是**读到了**别人的脏
 *                                                改动再判不重合，不是"没读到东西所以没重合"。
 *   R2 点名的那一枚正被工作树改动占着          → RC=1、BLOCKED=1、点名路径出现
 *   R3 点名的那一枚在主检出是**未跟踪**新文件   → 同样 RC=1 且状态码 ??（挡"?? 不算占"这一族误判）
 *   R4 点名的路径本地不存在也没被跟踪（写错名）  → RC=2 PROBE_BROKEN，绝不许报 CLEAN
 *   R5 一条路径都不点                          → RC=2（空清单上"全部干净"是永真的）
 *   R6 --main 指到一个不是 git 仓库的目录        → RC=2（"读不到"不许当成"没人占着"）
 *   R7 两侧根路径都打进输出                     → 断 `本地检出=` 与 `主检出=` 两行都在（跨树比较的显式根）
 *   脱牙 摘掉 blocked 的命中集合                → R2/R3 两臂必须全部失能
 *   脱牙 摘掉 missing 的命中集合                → R4 必须失能
 *
 * 跑法：node research/tools/mutation-rigs/mutate-detail-pane-ownership.mjs [--gate <脚本路径>]
 * 退出码：0 = 全部臂符合预期；1 = 有臂不符（逐条列出）。
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const repoRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
const GATE = process.argv[2] ?? join(repoRoot, 'scripts/verify-detail-pane-ownership.mjs');

const notes = [];
const fail = [];
const check = (arm, cond, detail) =>
  (cond ? notes : fail).push(`  ${cond ? '✅' : '🔴'} ${arm}${detail ? ` —— ${detail}` : ''}`);

/** 造一个真 git 仓库：提交 a/b/c 三个文件，返回路径。 */
const makeRepo = (dir) => {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'a.txt'), 'a\n');
  writeFileSync(join(dir, 'b.txt'), 'b\n');
  writeFileSync(join(dir, 'c.txt'), 'c\n');
  const g = (args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' });
  g(['init', '-q']);
  g(['config', 'user.email', 'rig@localhost']);
  g(['config', 'user.name', 'rig']);
  g(['add', 'a.txt', 'b.txt', 'c.txt']);
  g(['commit', '-qm', 'fixture']);
  return dir;
};
const run = (args) => {
  const r = spawnSync(process.execPath, [GATE, ...args], { encoding: 'utf8' });
  return { rc: r.status, out: `${r.stdout}${r.stderr}` };
};
/** 分母读数：承重那一行里抓三个数，用来区分"干净"与"没扫到"。 */
const nums = (out) => {
  const m = out.match(/主检出未提交 (\d+) 枚｜点名 (\d+) 条｜本地不在场 (\d+) 条｜被占 (\d+) 条/);
  return m ? { dirty: +m[1], asked: +m[2], missing: +m[3], blocked: +m[4] } : null;
};

const scratch = mkdtempSync(join(tmpdir(), 'dp-own-'));
const main = makeRepo(join(scratch, 'main'));

// ── R1：别人脏着一枚（b.txt），点名的是不重合的那枚（a.txt）
writeFileSync(join(main, 'b.txt'), 'b 被别人改了\n');
{
  const r = run(['a.txt', '--main', main, '--self', main]);
  const n = nums(r.out);
  check(
    'R1 别人脏着 1 枚、点名不重合 → RC=0 且分母都在场（"绿"是读到了别人的脏再判不重合，不是没读到）',
    r.rc === 0 && n !== null && n.dirty === 1 && n.blocked === 0 && n.asked === 1,
    `RC=${r.rc}｜${JSON.stringify(n)}｜${r.out.split('\n').pop().slice(0, 40)}`,
  );
  check(
    'R7 两侧根路径都打进输出（跨树比较不许隐式取同一棵树）',
    r.out.includes(`本地检出=${main}`) && r.out.includes(`主检出=${main}`),
    r.out.split('\n').filter((l) => /检出=/.test(l)).join(' ‖ ').slice(0, 90),
  );
}

// ── R2：点名的那一枚正被工作树改动占着
{
  const r = run(['b.txt', '--main', main, '--self', main]);
  const n = nums(r.out);
  check(
    'R2 点名被占的那枚 → RC=1、BLOCKED=1、路径出现、状态码打出来',
    r.rc === 1 && n !== null && n.blocked === 1 && r.out.includes('b.txt') && /" M"/.test(r.out),
    `RC=${r.rc}｜${JSON.stringify(n)}`,
  );
}

// ── R3：未跟踪的新文件也算"被占"
writeFileSync(join(main, 'd.txt'), 'd 别人新建的\n');
{
  const r = run(['d.txt', '--main', main, '--self', main]);
  const n = nums(r.out);
  check(
    'R3 主检出里未跟踪的同名文件 → 同样 RC=1 且状态码 ??（挡"?? 不算占"）',
    r.rc === 1 && n !== null && n.blocked === 1 && r.out.includes('??'),
    `RC=${r.rc}｜${JSON.stringify(n)}`,
  );
}

// ── R4：点错名（本地不存在也没被跟踪）
{
  const r = run(['nope.txt', '--main', main, '--self', main]);
  const n = nums(r.out);
  check(
    'R4 点名的路径本地不在场 → RC=2 PROBE_BROKEN，且不许出现 VERDICT=CLEAN',
    r.rc === 2 && r.out.includes('PROBE_BROKEN') && n !== null && n.missing === 1 && !r.out.includes('VERDICT=CLEAN'),
    `RC=${r.rc}｜${JSON.stringify(n)}`,
  );
}

// ── R5：一条都不点
{
  const r = run(['--main', main, '--self', main]);
  check(
    'R5 空清单 → RC=2（"全部干净"在空集合上是永真的）',
    r.rc === 2 && r.out.includes('PROBE_BROKEN'),
    `RC=${r.rc}`,
  );
}

// ── R6：--main 指向不是 git 仓库的目录
{
  const notRepo = join(scratch, 'not-a-repo');
  mkdirSync(notRepo, { recursive: true });
  const r = run(['a.txt', '--main', notRepo, '--self', main]);
  check(
    'R6 主检出不是 git 仓库 → RC=2（"读不到别人的状态"不许当成"没人占着"）',
    r.rc === 2 && r.out.includes('PROBE_BROKEN'),
    `RC=${r.rc}｜${r.out.split('\n').pop().slice(0, 60)}`,
  );
}

// ── 脱牙：摘掉 blocked / missing 的命中集合，对应臂必须失能
{
  const src = readFileSync(GATE, 'utf8');
  const ANCHOR = "console.log(`本地检出=";
  if (!src.includes(ANCHOR)) throw new Error('判据里找不到插入点，脱牙脚本拒绝猜。');
  const cases = [
    ['blocked.length = 0;', ['R2 b.txt', 'R3 d.txt']],
    ['missing.length = 0;', ['R4 nope.txt']],
  ];
  const survived = [];
  for (const [inject, asks] of cases) {
    const neutered = join(scratch, `gate-neutered-${inject.slice(0, 8)}.mjs`);
    writeFileSync(neutered, src.replace(ANCHOR, `${inject}\n${ANCHOR}`), 'utf8');
    for (const ask of asks) {
      const p = ask.split(' ')[1];
      const r = spawnSync(process.execPath, [neutered, p, '--main', main, '--self', main], { encoding: 'utf8' });
      if (r.status === 1 || r.status === 2) survived.push(`${inject.slice(0, 8)}→${p}`);
    }
  }
  check(
    '脱牙 摘掉 blocked 后 R2/R3 失能、摘掉 missing 后 R4 失能（三臂全部落到判据本体上）',
    survived.length === 0,
    survived.length ? `摘牙后仍响：${survived.join('/')}` : '三臂全部失能',
  );
}

rmSync(scratch, { recursive: true, force: true });
console.log(`\n读数：判据 ${GATE.split('/').pop()}｜夹具=临时真 git 仓库（不碰任何真检出）`);
console.log(`\n${[...notes, ...fail].join('\n')}`);
if (fail.length) {
  console.log(`\n🔴 ${fail.length}/${notes.length + fail.length} 臂不合格`);
  process.exit(1);
}
console.log(`\n结论：${notes.length} 臂全部符合预期（条数在这里现算，不落进判据本体）✅`);
