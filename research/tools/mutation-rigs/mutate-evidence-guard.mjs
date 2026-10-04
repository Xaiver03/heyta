#!/usr/bin/env node
/**
 * 证据图守卫（`scripts/verify-detail-pane-evidence-guard.mjs`）的四臂台。工单 #40 的落地件配套。
 *
 * 这四条各自挡一种复发形状：
 *   A 主路径        ：这一趟改写的图必须回到提交态（否则"我提交的是我看过的那版"是句空话）。
 *   B **不许误伤**  ：跑之前就已经脏着的图，守卫一格都不许动 —— 这一条才是"逐枚点名"而不是
 *                     `git restore -- <目录>` 的全部理由；摘掉它，装置就从"清理"变成"删别人的证据"。
 *   C 探针不可用    ：没有快照时必须 exit 2 响亮报 `PROBE_BROKEN`，不许打印"没东西要还原"（那是把
 *                     探针坏读成产品干净 —— 本文件线记过无数次的那个形状）。
 *   D 逃生门        ：`--keep` 要真的把字节留下（否则它就不是逃生门，而是一个会骗人的开关）。
 *
 * 全程只在**一枚**在册图上做手脚，并在每一臂结束时 `git restore` 它；跑完工作树必须回到干净态。
 * 跑法（仓库根）：node research/tools/mutation-rigs/mutate-evidence-guard.mjs
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';

const ROOT = process.cwd();
const GUARD = 'scripts/verify-detail-pane-evidence-guard.mjs';
const DIR = 'apps/web/evidence';
const TARGET = 'apps/web/evidence/selection-projections/01-list.png';

const git = (args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
// 🔴 取 blob 必须按**字节**取：`encoding: 'utf8'` 会把 PNG 当文本解码，md5 立刻对不上，
//    而症状是"守卫没还原"—— 那是探针坏，不是装置坏。
const gitRaw = (args) => execFileSync('git', args, { cwd: ROOT, maxBuffer: 32 * 1024 * 1024 });
const headBytes = () => gitRaw(['show', `HEAD:${TARGET}`]);
const bytes = () => readFileSync(path.join(ROOT, TARGET));
const md5 = (buf) => createHash('md5').update(buf).digest('hex');
const clean = () => {
  spawnSync('git', ['restore', '--', TARGET], { cwd: ROOT });
};
const writeTarget = (buf) => writeFileSync(path.join(ROOT, TARGET), buf);
const runGuard = (args) => {
  const r = spawnSync('node', [GUARD, ...args], { cwd: ROOT, encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' } });
  return { rc: r.status ?? 1, out: `${r.stdout || ''}${r.stderr || ''}` };
};

if (git(['status', '--porcelain', '--', DIR]).trim()) {
  console.log(`SETUP=ABORT ${DIR} 里有未提交的改动（不是本臂台造的），先让它的作者处理完再跑`);
  process.exit(2);
}

const tmp = mkdtempSync(path.join(tmpdir(), 'heyta-evg-'));
const snap = (name) => path.join(tmp, `${name}.json`);
const results = [];
const check = (name, ok, detail) => {
  console.log(`${ok ? 'OK  ' : 'BAD '} ${name} —— ${detail}`);
  results.push(ok);
};

// —— A 主路径
{
  const h = md5(headBytes());
  check('A 起跑时盘上字节 = HEAD', md5(bytes()) === h, `HEAD=${h.slice(0, 8)} 盘上=${md5(bytes()).slice(0, 8)}`);
  runGuard(['--snapshot', snap('a')]);
  writeTarget(Buffer.concat([bytes(), Buffer.from('\x89PNG-sig')]));
  const t = runGuard(['--reconcile', snap('a')]);
  const restored = md5(bytes()) === h;
  check('A 这一趟改写的图被还原', /EVIDENCE_GUARD=RESTORED 1 枚/.test(t.out) && restored && t.rc === 0, `rc=${t.rc} 还原回 HEAD=${restored}`);
  clean();
}

// —— B 不许误伤跑前就脏的
{
  writeTarget(Buffer.concat([bytes(), Buffer.from('before-')]));
  const s = runGuard(['--snapshot', snap('b')]);
  const seenDirty = /跑前就脏的 1 枚/.test(s.out);
  const v1 = Buffer.concat([bytes(), Buffer.from('mine-')]);
  writeTarget(v1);
  const t = runGuard(['--reconcile', snap('b')]);
  const notTouched = md5(bytes()) === md5(v1);
  check(
    'B 跑前就脏的那一枚：登记 + 一格不动',
    seenDirty && /本趟重写=0 枚/.test(t.out) && /跑前就脏（不动）=1 枚/.test(t.out) && notTouched,
    `snapshot 认出脏=${seenDirty} 本趟重写=0=${/本趟重写=0 枚/.test(t.out)} 字节仍是第二次写的=${notTouched}`,
  );
  clean();
}

// —— C 没有快照必须响亮失败
{
  const t = runGuard(['--reconcile', path.join(tmp, 'nope.json')]);
  check(
    'C 缺快照 ⇒ PROBE_BROKEN（不许读成"没东西要还原"）',
    t.rc === 2 && /VERDICT=PROBE_BROKEN/.test(t.out) && !/NO_REWRITE/.test(t.out),
    `rc=${t.rc} 报了 PROBE_BROKEN=${/VERDICT=PROBE_BROKEN/.test(t.out)}`,
  );
}

// —— D --keep 是真的逃生门
{
  runGuard(['--snapshot', snap('d')]);
  const broken = Buffer.concat([bytes(), Buffer.from('\x89PNG-sig')]);
  writeTarget(broken);
  const t = runGuard(['--reconcile', snap('d'), '--keep']);
  const kept = md5(bytes()) === md5(broken);
  check('D --keep：字节留在盘上、不还原', /EVIDENCE_GUARD=KEEP/.test(t.out) && kept && t.rc === 0, `rc=${t.rc} 盘上仍是这趟的字节=${kept}`);
  clean();
}

const residue = git(['status', '--porcelain', '--', DIR]).trim();
check('收尾 工作树回到干净态', residue === '', residue ? `残留：${residue.split('\n').length} 枚` : '0 枚');
rmSync(tmp, { recursive: true, force: true });
const passed = results.filter(Boolean).length;
console.log(`RIG_RESULT=${passed}/${results.length} 期望=${results.length}/${results.length}`);
process.exit(passed === results.length ? 0 : 1);
