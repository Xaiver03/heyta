#!/usr/bin/env node
// W1c「选中痕迹统一」那六臂的常驻载体（工单 §8.22；原来的 `/tmp/dp_w1c_mutate.py` 已由此件取代）。
//
// 为什么值得入仓：这六臂钉的是**便签面与任务面的选中痕迹有没有牙**，而那两处选中今天仍是一个
// 默认值等于原行为的可选 prop（`activeNoteId`）+ 共享层 `aria-current`。§8.22 记的那次事故 ——
// H1 头一趟**存活**（摘掉宿主接线，A/B/C 三组照样全绿，因为它们根本不经过宿主）—— 是这一族
// 最容易被重新犯回来的形状：共享组件加可选 prop 会把"宿主没接"伪装成"做完了"。
// 臂跑在源码 + dist 上，所以 D 组（读宿主源文件）那三条也要有人能复跑。
//
// 三条纪律（缺一条这台账就只是装饰）：
//  · 每条臂的 needle 必须在基线里**恰好命中 1 次**，否则整趟作废（"没改到但仍然绿"是最坏结果）；
//  · 基线先跑一趟做**阳性对照**，基线就红则拒绝读数；
//  · 每臂跑完立即还原并**复验 md5 逐字节相同**，全部跑完再重建一次 dist 回到未变异态。
// 红条数按 §8.22 那张表逐臂钉住：数量对不上报 COUNT_DRIFT（要么判据变了要么臂失效了，两种都要人看）。
//
// ⚠️ 这台会改源码并重建 `packages/ui/dist` —— **同一时间不要并行跑别的验 dist 的东西**
// （收尾电池、全门禁扫描都读那枚 dist）。独占验收，见 AGENTS §8 第 9 条。
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const UI = join(ROOT, 'packages/ui');
const WEB = join(ROOT, 'apps/web');
const NOTES = join(UI, 'src/notes/NotesBoard.tsx');
const TASKROW = join(UI, 'src/task-list/TaskRow.tsx');
const NOTESVIEW = join(WEB, 'src/features/notes/NotesView.tsx');
const SPECS = 'tests/notes-selection-trace.spec.tsx tests/task-selection.spec.tsx';

const ARIA_NOTES = "                aria-current={active ? 'true' : undefined}\n";
const ARIA_TASK = "      aria-current={active ? 'true' : undefined}\n";
const STYLE_ROW = 'style={active ? [styles.row, styles.rowActive] : styles.row}';
const ACT_LINE = 'const active = row.id === activeNoteId;';
const HOST_LINE = '        activeNoteId={activeNoteId}\n';

const ARMS = [
  { id: 'N1', file: NOTES, needle: ARIA_NOTES, rep: '', expect: 2, why: '摘掉便签行的 aria-current' },
  { id: 'N2', file: NOTES, needle: STYLE_ROW, rep: 'style={[styles.row, styles.rowActive]}', expect: 4, why: '恒亮（没选中也画底色）' },
  { id: 'N3', file: NOTES, needle: STYLE_ROW, rep: 'style={styles.row}', expect: 2, why: '恒不亮' },
  { id: 'N4', file: NOTES, needle: ACT_LINE, rep: 'const active = activeNoteId !== undefined;', expect: 4, why: '整列表一起标' },
  { id: 'T1', file: TASKROW, needle: ARIA_TASK, rep: '', expect: 1, why: '摘掉任务行的 aria-current' },
  { id: 'H1', file: NOTESVIEW, needle: HOST_LINE, rep: '', expect: 1, why: '宿主不接这个 prop（§8.22：头一趟存活，D 组补上才红）' },
];

const md5 = (s) => createHash('md5').update(s).digest('hex');
// 负载门：**复用仓里那把共享的**（`scripts/lib/wait-for-quiet-host.sh`，阈值 = hw.ncpu × 3/4，
// 等满 `HEYTA_LOAD_GATE_WAIT` 秒以"环境无效"结束）。不自己写第二把 —— 那正是该 helper 被抽出来的理由
// （traps #168），而且这台臂的红集一旦由负载抖动产生，读起来和"判据没牙"一模一样。
// 位置在**任何写盘之前**（helper 文件头那条纪律）。
const gate = spawnSync(
  '. scripts/lib/wait-for-quiet-host.sh && wait_for_quiet_host',
  { cwd: ROOT, shell: '/bin/bash', encoding: 'utf8' },
);
if (gate.status !== 0) {
  console.log(`LOAD_GATE=invalid-environment rc=${gate.status} ${(gate.stdout ?? '') + (gate.stderr ?? '')}`.slice(0, 400));
  console.log('RIG_RESULT=ENV_INVALID（环境无效 ≠ 产品失败，也没动过任何源码）');
  process.exit(3);
}
console.log(`LOAD_GATE=${(gate.stdout ?? '').trim().split('\n').at(-1)}`);

const sh = (cmd, cwd) => {
  const r = spawnSync(cmd, { cwd, shell: '/bin/sh', encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' }, maxBuffer: 1 << 28 });
  return { rc: r.status ?? -1, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
};
// vitest 默认 reporter 的失败行是 `     × <title> 12ms`（形状从真实日志核对，不是凭记忆写）。
// 红条数以 `Tests  N failed | …` 那行为准；标题只用来点名。
const parseVitest = (out) => {
  const sum = /^\s*Tests\s+(.*)$/m.exec(out)?.[1]?.trim() ?? null;
  const failed = Number(/(\d+) failed/.exec(sum ?? '')?.[1] ?? NaN);
  const titles = [...out.matchAll(/^\s*×\s+(.+?)\s+\d+ms\s*$/gm)].map((m) => m[1]);
  const files = /^\s*Test Files\s+(.*)$/m.exec(out)?.[1]?.trim() ?? null;
  return { sum, failed, titles, files };
};

const BASE = new Map(ARMS.map((a) => [a.file, readFileSync(a.file, 'utf8')]));
const BASE_MD5 = new Map([...BASE].map(([f, s]) => [f, md5(s)]));

// —— 前提守卫：needle 命中数 ——
let guardBad = 0;
for (const a of ARMS) {
  const n = BASE.get(a.file).split(a.needle).length - 1;
  if (n !== 1) {
    console.log(`🔴 GUARD ${a.id} 的 needle 在 ${a.file.replace(ROOT + '/', '')} 里命中 ${n} 次（期望 1）：${a.why}`);
    guardBad += 1;
  }
}
if (guardBad) {
  console.log('RIG_RESULT=GUARD_FAILED —— 源码形状已经和臂不符，先修臂再谈读数');
  process.exit(1);
}
console.log(`GUARD ✅ ${ARMS.length} 条臂的 needle 各命中 1 次`);

// —— 阳性对照：基线必须先绿，且两份 spec 真的跑到了 ——
let b = sh('./node_modules/.bin/tsup', UI);
if (b.rc !== 0) {
  console.log(`🔴 基线重建 @heyta/ui 失败 RC=${b.rc}：${b.out.slice(-400)}`);
  console.log('RIG_RESULT=PROBE_BROKEN');
  process.exit(2);
}
const base = sh(`./node_modules/.bin/vitest run ${SPECS}`, WEB);
const bp = parseVitest(base.out);
console.log(`BASELINE build RC=${b.rc} vitest RC=${base.rc} Tests=${bp.sum ?? '?'} TestFiles=${bp.files ?? '?'}`);
if (base.rc !== 0 || !/^2 passed/.test(bp.files ?? '')) {
  console.log('🔴 基线就红，或那两份 spec 没都跑到（分母不是 2 个文件）—— 变异台拒绝读数');
  console.log('RIG_RESULT=PROBE_BROKEN');
  process.exit(2);
}

const results = [];
// 🔴 被 kill 在中途就把别人的工作树留在变异态（这台改的是**源码**，而工作树里可能正躺着别人
// 未提交的实现）。记住"现在哪一枚文件是脏的"，exit 钩子里无条件还原 —— 还原用的是进程序
// 读进来的那份内存副本，**不是 `git checkout`**（那会把未提交的实现整片打回 HEAD）。
let dirty = null;
const restoreAll = () => {
  for (const [f, s] of BASE) writeFileSync(f, s);
  dirty = null;
};
process.on('exit', restoreAll);
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    console.log(`🔴 收到 ${sig}${dirty ? `（正在变异 ${dirty.replace(ROOT + '/', '')}）` : ''} —— 先还原再退出`);
    restoreAll();
    process.exit(130);
  });
}

for (const a of ARMS) {
  dirty = a.file;
  writeFileSync(a.file, BASE.get(a.file).replace(a.needle, a.rep));
  const build = sh('./node_modules/.bin/tsup', UI);
  if (build.rc !== 0) {
    writeFileSync(a.file, BASE.get(a.file));
    console.log(`🔴 ${a.id} 重建失败 RC=${build.rc}：${build.out.slice(-400)} —— 整趟作废`);
    console.log('RIG_RESULT=PROBE_BROKEN');
    process.exit(2);
  }
  const run = sh(`./node_modules/.bin/vitest run ${SPECS}`, WEB);
  const p = parseVitest(run.out);
  const names = p.titles.slice(0, 6);
  const match = run.rc !== 0 && p.failed === a.expect;
  const survived = run.rc === 0;
  results.push({ ...a, rc: run.rc, failed: p.failed, survived, match, names, sum: p.sum });
  console.log(
    `[${a.id}] ${a.why} → RC=${run.rc} 红 ${p.failed}/${a.expect} ${survived ? '🔴 存活（判据没牙）' : match ? '匹配' : '⚠️ 数量漂移'} Tests=${p.sum ?? '?'}`,
  );
  for (const n of names) console.log(`      · ${n}`);
  writeFileSync(a.file, BASE.get(a.file));
  if (md5(readFileSync(a.file, 'utf8')) !== BASE_MD5.get(a.file)) {
    console.log(`🔴 ${a.id} 还原后 md5 不符 —— 停在这里，后面的读数不可信`);
    process.exit(2);
  }
  dirty = null;
}

const back = sh('./node_modules/.bin/tsup', UI);
console.log(`RESTORE ✅ 三份文件与基线 md5 逐字节相同；重建 dist RC=${back.rc}`);
const recheck = sh(`./node_modules/.bin/vitest run ${SPECS}`, WEB);
const rp = parseVitest(recheck.out);
console.log(`RECHECK（还原后复跑基线）RC=${recheck.rc} Tests=${rp.sum ?? '?'}`);

console.log('=== 汇总 ===');
for (const r of results) console.log(`${r.id} ${r.why}: RC=${r.rc} 红=${r.failed} 预期=${r.expect} ${r.match ? '✅' : '🔴'}`);
const survived = results.filter((r) => r.survived).map((r) => r.id);
const drifted = results.filter((r) => !r.survived && !r.match).map((r) => r.id);
console.log('SURVIVED=' + (survived.join(',') || '无'));
console.log('COUNT_DRIFT=' + (drifted.join(',') || '无'));
console.log(`BACK_TO_CLEAN=${recheck.rc === 0 && back.rc === 0}`);
const ok = survived.length === 0 && drifted.length === 0 && recheck.rc === 0;
console.log(`RIG_RESULT=${ok ? `${results.length}/${results.length}` : 'FAIL'}`);
process.exit(ok ? 0 : 1);
