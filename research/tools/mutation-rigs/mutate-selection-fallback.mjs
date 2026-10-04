#!/usr/bin/env node
/**
 * 回落（prune）接线判据的变异臂（`apps/mobile/tests/selection-single-owner.spec.ts`）。
 *
 * 这一族钉的是 Goal 第②条里"同一套**回落规则**"那一半：规则本身在共享层
 * （`packages/app-host/src/selection.ts` 的 `pruneSelection`，那边有 16 条单测），
 * 但共享层证不了**宿主喂进去的是什么** —— 少喂一类、或喂成筛后的一截，
 * 界面都不报错，症状是"另一台设备删了那条，编辑层不自己关"。
 * 本批 §8.43 就是按"谁在读这一类"枚举出**第三个**该喂的屏（任务屏自己挂着便签编辑层）。
 *
 * 跑法（仓库根；linked worktree 里不要 `pnpm run`，它会先做 deps-status 预检）：
 *   node research/tools/mutation-rigs/mutate-selection-fallback.mjs
 *
 * 四臂**按用例名点名**预期（只数红了几条不够：两条判据若红在同一条用例上，
 * 实际只有一条在守着 —— 这正是把反向断言从正向那条里拆出来的理由）：
 *   R1 任务屏摘掉 `note:` 那一项            → 红：正向那条；反向那条**必须不红**
 *   R2 任务屏把来源换成 `visibleNotes`       → 两条都红（反向那条不许只在纸上）
 *   R3 习惯屏摘掉 `habit` 回落              → 红：习惯那条
 *   R4 阴性对照：同样的字样只写进注释        → **必须不红**（判据读的是剥过注释的源码）
 *
 * 每臂跑完复原；四臂全按预期且 `FINAL_SAME=true` 才 exit 0。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const ROOT = process.cwd();
const JSON_OUT = '/tmp/dp_selection_fallback.json';
const files = {
  tasks: 'apps/mobile/src/screens/TasksScreen.tsx',
  habits: 'apps/mobile/src/screens/HabitsScreen.tsx',
};
const md5 = (p) => createHash('md5').update(readFileSync(`${ROOT}/${p}`)).digest('hex');
const BASE = Object.fromEntries(Object.entries(files).map(([k, p]) => [k, md5(p)]));
const orig = Object.fromEntries(Object.entries(files).map(([k, p]) => [k, readFileSync(`${ROOT}/${p}`, 'utf8')]));

const POSITIVE = '便签：三个持有全集的屏都跑了回落，且喂的是 `listNotes()` 的结果';
const NEGATIVE = '便签：回落谓词不许来自筛完 / 排过序的那一截（反向）';
const HABIT = '习惯屏：同一件事，同样来自全集';

const runSpec = () => {
  let stderr = '';
  try {
    execFileSync(
      './node_modules/.bin/vitest',
      ['run', 'tests/selection-single-owner.spec.ts', '--reporter=json', `--outputFile=${JSON_OUT}`],
      { cwd: `${ROOT}/apps/mobile`, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    );
  } catch (e) {
    stderr = `${e.stdout || ''}${e.stderr || ''}`.slice(-400);
  }
  let report;
  try {
    report = JSON.parse(readFileSync(JSON_OUT, 'utf8'));
  } catch {
    // 🔴 分母读空**不许**当成"零条红 = 绿"。
    return { total: -1, failed: -1, redTitles: [`JSON_READ_FAILED ${stderr}`] };
  }
  const assertions = (report.testResults ?? []).flatMap((r) => r.assertionResults ?? []);
  return {
    total: assertions.length,
    failed: assertions.filter((a) => a.status === 'failed').length,
    redTitles: assertions.filter((a) => a.status === 'failed').map((a) => a.title),
  };
};

const restore = () => {
  for (const [k, p] of Object.entries(files)) writeFileSync(`${ROOT}/${p}`, orig[k]);
};

const ARMS = [
  {
    name: 'R1 任务屏摘掉 prune 实参里的 note 那一项',
    file: 'tasks',
    mutate: (s) =>
      s.replace(
        '      ...(aliveNotes === undefined ? {} : { note: aliveNotes.map((note) => note.id) }),\n',
        '',
      ),
    expectRed: [POSITIVE],
    expectGreen: [NEGATIVE],
  },
  {
    name: 'R2 任务屏把便签来源换成筛后的一截',
    file: 'tasks',
    mutate: (s) => s.replace('{ note: aliveNotes.map((note) => note.id) }', '{ note: visibleNotes.map((note) => note.id) }'),
    expectRed: [POSITIVE, NEGATIVE],
    expectGreen: [HABIT],
  },
  {
    name: 'R3 习惯屏摘掉 habit 回落',
    file: 'habits',
    mutate: (s) => s.replace('    pruneSelectionAgainst({ habit: aliveHabits.map((habit) => habit.id) });\n', ''),
    expectRed: [HABIT],
    expectGreen: [POSITIVE, NEGATIVE],
  },
  {
    name: 'R4 阴性对照：同样的字样只写进注释',
    file: 'tasks',
    mutate: (s) =>
      s.replace(
        '    const aliveNotes = noteActions === null ? undefined : noteActions.listNotes();',
        '    // 反例长这样：pruneSelectionAgainst({ note: visible.map((n) => n.id) });\n' +
          '    const aliveNotes = noteActions === null ? undefined : noteActions.listNotes();',
      ),
    expectRed: [],
    expectGreen: [POSITIVE, NEGATIVE, HABIT],
  },
];

const control = runSpec();
if (control.total !== 14 || control.failed !== 0) {
  console.log(`CONTROL_NOT_GREEN total=${control.total} 红=${control.failed} —— 台子自己是红的，后面读数都不作数`);
  restore();
  process.exit(2);
}
console.log(`CONTROL rc=0（未变异 14 条全绿，分母现量 total=${control.total}）`);

const verdict = [];
for (const arm of ARMS) {
  restore();
  const mutated = arm.mutate(orig[arm.file]);
  if (mutated === orig[arm.file]) {
    verdict.push([arm.name, 'MUTATE-NO-OP', 'FAIL']);
    continue;
  }
  writeFileSync(`${ROOT}/${files[arm.file]}`, mutated);
  const r = runSpec();
  const missingRed = arm.expectRed.filter((t) => !r.redTitles.includes(t));
  const leakedGreen = arm.expectGreen.filter((t) => r.redTitles.includes(t));
  const extraRed = r.redTitles.filter((t) => !arm.expectRed.includes(t));
  const ok = r.total === 14 && missingRed.length === 0 && leakedGreen.length === 0 && extraRed.length === 0;
  verdict.push([
    `${arm.name} [应红 ${arm.expectRed.length} 条 / 应绿 ${arm.expectGreen.length} 条]`,
    `红 ${r.failed}/${r.total}：${r.redTitles.map((t) => t.slice(0, 26)).join(' ｜ ') || '（无）'}` +
      (missingRed.length ? ` || 缺的红：${missingRed.join(',')}` : '') +
      (extraRed.length ? ` || 多红的：${extraRed.join(',')}` : ''),
    ok ? 'OK' : 'FAIL',
  ]);
}
restore();
const same = Object.keys(BASE).every((k) => md5(files[k]) === BASE[k]);
for (const [n, d, v] of verdict) console.log(`${v.padEnd(5)} ${n}\n      ${d}`);
const after = runSpec();
console.log(
  `ARMS=${ARMS.length} AS_EXPECTED=${verdict.filter(([, , v]) => v === 'OK').length} FAIL=${verdict.filter(([, , v]) => v === 'FAIL').length} FINAL_SAME=${same}`,
);
console.log(`POST_RESTORE 红=${after.failed}/${after.total}`);
process.exit(verdict.every(([, , v]) => v === 'OK') && same && after.failed === 0 && after.total === 14 ? 0 : 1);
