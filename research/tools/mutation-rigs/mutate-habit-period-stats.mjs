#!/usr/bin/env node
// W8「习惯统计的读侧」判据的常驻变异载体。
//
// 为什么值得入仓：`packages/domain/tests/habit-period-stats.spec.ts` 的 11 条判据钉的是
// **已拍板的口径**（分母=已到期计划日 / 自然月非滚动 / 天 vs 次 / 求和走唯一算法 /
// 墓碑必须自滤）。这些恰恰是最容易被"顺手改回去"的形状 —— 把分母换成 `daysInMonth`
// 只有一行，界面照样画得出来，而所有其他测试全部保持绿。
// 四条臂各是一种独立的失效形状，红集**互不相同**（这正是"每条判据钉哪一件事"能答得出）。
//
// 三条纪律（缺一条这台账就只是装饰，与 `mutate-notes-selection-trace.mjs` 同）：
//  · 每条臂的 needle 必须在基线里**恰好命中 1 次**，否则整趟作废（"没改到但仍然绿"是最坏结果）；
//  · 基线先跑一趟做**阳性对照**，基线就红则拒绝读数；
//  · 每臂跑完立即还原并**复验 md5 逐字节相同**；还原用进程序读进来的内存副本，
//    **绝不用 `git checkout`**（会把工作树里未提交的实现整片打回 HEAD）。
// 红条数**与红集测试名**都钉：数量对上但红的不是预期的那几条，同样判 COUNT_DRIFT。
//
// ⚠️ 臂只改 `packages/domain/src/habit-streak.ts`，判据 spec 直接 import src
//    （`../src/habit-streak.js`，与本仓所有 domain spec 同形状）⇒ **不需要重建 dist**。
//    但 app-host/ui 的测试读的是 dist —— 这台**不跑**它们的 spec，互不相扰。
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const DOMAIN = join(ROOT, 'packages/domain');
const STREAK = join(DOMAIN, 'src/habit-streak.ts');
const SPEC = 'tests/habit-period-stats.spec.ts';

const ARMS = [
  {
    id: 'P1',
    file: STREAK,
    needle: '  const scheduledDays = dueScheduled.length;',
    rep: '  const scheduledDays = daysInMonth(Number(monthKey.slice(0, 4)), Number(monthKey.slice(5, 7)));',
    expect: 6,
    mustInclude: ['T1 ', 'T2 ', 'T3 ', 'T6 ', 'T7 ', 'T8 '],
    why: '分母改成"该月自然日数"（daysInMonth）',
  },
  {
    id: 'P2',
    file: STREAK,
    needle: '  const upper = today < last ? today : last;',
    rep: '  const upper = last;',
    expect: 5,
    mustInclude: ['T1 ', 'T2 ', 'T3 ', 'T6 ', 'T7 '],
    why: '摘掉"已到期"上界（整月当分母）—— T8 把 today 放在月末，此臂必须**不红**它',
  },
  {
    id: 'P3',
    file: STREAK,
    needle: '    const value = habitLogValue(habit, log);\n    totalValue += value;',
    rep: '    const value = log.value ?? 0;\n    totalValue += value;',
    expect: 1,
    mustInclude: ['T5 '],
    why: '求和从 `habitLogValue` 换成 `log.value ?? 0`（绕开 W6 的唯一算法）',
  },
  {
    id: 'P4',
    file: STREAK,
    needle: '    (l) => l.habitId === habit.id && l.deletedAt === undefined,',
    rep: '    (l) => l.habitId === habit.id,',
    expect: 1,
    mustInclude: ['T4b '],
    why: '摘掉墓碑过滤（已删的打卡会留在"本月完成量"里 —— 任务书点名的那个真 bug）',
  },
];

const md5 = (s) => createHash('md5').update(s).digest('hex');

// 负载门：复用仓里那把共享的（同 mutate-notes-selection-trace.mjs 的理由，traps #168）。
// 位置在**任何写盘之前**。
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
// vitest 默认 reporter 的失败行形状：`     × <title> 12ms`（从真实日志核对，不凭记忆写）。
// 红条数以 `Tests  N failed | …` 那行为准（与 mutate-notes-selection-trace.mjs 同一份解析）。
// ⚠️ 取不到数字时是 NaN —— "没读到"和"读到 0"是两回事（traps：探针读不到数字必须响亮地失败）。
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

// —— 阳性对照：基线必须先绿，且那份 spec 真的跑到了（分母 = 1 个文件 / 11 条用例）——
const base = sh(`./node_modules/.bin/vitest run ${SPEC}`, DOMAIN);
const bp = parseVitest(base.out);
console.log(`BASELINE vitest RC=${base.rc} Tests=${bp.sum ?? '?'} TestFiles=${bp.files ?? '?'}`);
if (base.rc !== 0 || !/^1 passed/.test(bp.files ?? '')) {
  console.log('🔴 基线就红，或那份 spec 没跑到（分母不是 1 个文件）—— 变异台拒绝读数');
  console.log('RIG_RESULT=PROBE_BROKEN');
  process.exit(2);
}

const results = [];
// 🔴 被 kill 在中途也不把工作树留在变异态：还原用**内存副本**，不是 `git checkout`。
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
  const run = sh(`./node_modules/.bin/vitest run ${SPEC}`, DOMAIN);
  const p = parseVitest(run.out);
  const survived = run.rc === 0;
  const countMatch = !survived && p.failed === a.expect;
  const missing = a.mustInclude.filter(
    (tag) => !p.titles.some((t) => t.includes(tag)),
  );
  const extra = p.titles.filter((t) => !a.mustInclude.some((tag) => t.includes(tag)));
  const setMatch = countMatch && missing.length === 0 && extra.length === 0;
  results.push({ ...a, rc: run.rc, failed: p.failed, survived, setMatch, titles: p.titles, sum: p.sum, missing, extra });
  console.log(
    `[${a.id}] ${a.why} → RC=${run.rc} 红 ${p.failed}/${a.expect} ${survived ? '🔴 存活（判据没牙）' : setMatch ? '红集匹配' : '⚠️ 红集/数量漂移'}`,
  );
  for (const n of p.titles.slice(0, 8)) console.log(`      · ${n}`);
  if (missing.length > 0) console.log(`      🔴 预期红的用例缺席: ${missing.join(', ')}`);
  if (extra.length > 0) console.log(`      ⚠️ 额外红的用例: ${extra.map((t) => t.slice(0, 24)).join(', ')}`);
  writeFileSync(a.file, BASE.get(a.file));
  if (md5(readFileSync(a.file, 'utf8')) !== BASE_MD5.get(a.file)) {
    console.log(`🔴 ${a.id} 还原后 md5 不符 —— 停在这里，后面的读数不可信`);
    process.exit(2);
  }
  dirty = null;
}

const recheck = sh(`./node_modules/.bin/vitest run ${SPEC}`, DOMAIN);
const rp = parseVitest(recheck.out);
console.log(`RECHECK（还原后复跑基线）RC=${recheck.rc} Tests=${rp.sum ?? '?'}`);

console.log('=== 汇总 ===');
for (const r of results) {
  console.log(`${r.id} ${r.why}: RC=${r.rc} 红=${r.failed} 预期=${r.expect} ${r.setMatch ? '✅' : '🔴'}`);
}
const survived = results.filter((r) => r.survived).map((r) => r.id);
const drifted = results.filter((r) => !r.survived && !r.setMatch).map((r) => r.id);
console.log('SURVIVED=' + (survived.join(',') || '无'));
console.log('COUNT_DRIFT=' + (drifted.join(',') || '无'));
console.log(`BACK_TO_CLEAN=${recheck.rc === 0}`);
const ok = survived.length === 0 && drifted.length === 0 && recheck.rc === 0;
console.log(`RIG_RESULT=${ok ? `臂 ${results.length}/${results.length} 红 + 对照干净` : 'FAIL'}`);
process.exit(ok ? 0 : 1);
