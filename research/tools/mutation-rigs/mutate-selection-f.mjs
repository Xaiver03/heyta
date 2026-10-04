#!/usr/bin/env node
/**
 * 断言 F 的变异臂（`scripts/check-selection-single-source.mjs`）。
 *
 * F 判的是 §8.24 立项的那一条：**「选中态存续期间列表仍可见」的每一处渲染面必须把选中说出来**，
 * 通道按端择一（DOM 用 `aria-current`、RN 用 `aria-pressed`），覆盖面是 §8.26 现量的四处渲染。
 * §8.28 给它的两条约束都做成构造层的牙：
 *   ① 不许按 `active` 字样认选中 ⇒ 属性值必须来自"某个选中 id 的等值式"（臂 H4）；
 *   ② 豁免面必须带着它成立所依赖的可测事实 ⇒ 事实变了就红（臂 H6）。
 *
 * 跑法（仓库根；linked worktree 里不要 `pnpm run`，它会先做 deps-status 预检）：
 *   node research/tools/mutation-rigs/mutate-selection-f.mjs
 *
 * 九臂**各自带预期**（两条阴性对照的"不红"就是它们合格本身）：
 *   H1 摘掉 TaskRow 的 aria-current          → 红：那一面没说
 *   H2 把 RN 面的通道换成 aria-current        → 红：登记通道没用 + 挂错通道（RN 上它不生效）
 *   H3 web 习惯面属性值里去掉谓词             → 红：属性在、说的不是选中
 *   H4 把 TaskList 的谓词换成常量 true        → 红：值不来自选中 id（约束①的牙）
 *   H5 新造一个接 selectedId 的文件          → 红：闭合面表外多了一处接选中的
 *   H6 mobile 便签开始传 activeNoteId        → 红：豁免的可测基础失效
 *   H7 把某处面的路径指到不存在的文件        → 红：响亮失败，不静默跳过
 *   H8 把三元写法换成 `aria-current={selected}` → **必须不红**（改写法不改语义不该挨打）
 *   H9 词表里加一类而没有任何面对它说话      → 红：加一类选中就要留一处痕迹
 *
 * 判定按每臂预期走；九臂全 OK 且 `FINAL_SAME=true` 才 exit 0。
 * `FINAL_SAME` 覆盖**六枚**被改文件（门禁 + 五枚源码）—— 这台子真改源码，没有还原证明不算跑过。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const ROOT = process.cwd();
const GATE = 'scripts/check-selection-single-source.mjs';
const files = {
  gate: GATE,
  taskRow: 'packages/ui/src/task-list/TaskRow.tsx',
  taskList: 'packages/ui/src/task-list/TaskList.tsx',
  habitsList: 'apps/web/src/features/habits/HabitsList.tsx',
  habitProgress: 'packages/ui/src/habits/HabitProgressList.tsx',
  habitsView: 'apps/web/src/features/habits/HabitsView.tsx',
  notesSection: 'apps/mobile/src/screens/NotesSection.tsx',
  vocab: 'packages/app-host/src/selection.ts',
};
const md5 = (p) => createHash('md5').update(readFileSync(`${ROOT}/${p}`)).digest('hex');
const BASE = Object.fromEntries(Object.entries(files).map(([k, p]) => [k, md5(p)]));
const orig = Object.fromEntries(Object.entries(files).map(([k, p]) => [k, readFileSync(`${ROOT}/${p}`, 'utf8')]));

const run = () => {
  try {
    return { rc: 0, out: execFileSync('node', [GATE], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) };
  } catch (e) {
    return { rc: e.status ?? 1, out: `${e.stdout || ''}${e.stderr || ''}` };
  }
};
const restore = () => {
  for (const [k, p] of Object.entries(files)) writeFileSync(`${ROOT}/${p}`, orig[k]);
};

const ARMS = [
  {
    name: 'H1 摘掉 TaskRow 那条 aria-current',
    file: 'taskRow',
    expect: 'red',
    mutate: (s) => s.replace("      aria-current={active ? 'true' : undefined}\n", ''),
  },
  {
    name: 'H2 RN 面把通道换成 aria-current（在那一端不生效）',
    file: 'habitProgress',
    expect: 'red',
    minRed: 2,
    mutate: (s) => s.replace('aria-pressed={selected}', 'aria-current={selected}'),
  },
  {
    name: 'H3 web 习惯面的属性值里去掉谓词',
    file: 'habitsList',
    expect: 'red',
    mutate: (s) => s.replace("aria-current={selected ? 'true' : undefined}", "aria-current={'true'}"),
  },
  {
    name: 'H4 谓词换成常量（值不再来自选中 id）',
    file: 'taskList',
    expect: 'red',
    mutate: (s) => s.replace('{ active: activeTaskId === row.id }', '{ active: true }'),
  },
  {
    name: 'H5 新造一个接 selectedId 却没登记的面',
    file: 'habitsView',
    expect: 'red',
    mutate: (s) => s.replace('const ', 'interface __FProbeProps {\n  readonly selectedId?: string | null;\n}\n\nconst '),
  },
  {
    name: 'H6 mobile 便签开始传 activeNoteId（豁免基础失效）',
    file: 'notesSection',
    expect: 'red',
    mutate: (s) => s.replace('  const [host, setHost]', '  const __fProbe = <NotesBoard activeNoteId={null} />;\n  const [host, setHost]'),
  },
  {
    name: 'H7 把一处面的路径指到不存在的文件',
    file: 'gate',
    expect: 'red',
    mutate: (s) => s.replace("file: 'packages/ui/src/task-list/TaskRow.tsx'", "file: 'packages/ui/src/task-list/TaskRowGONE.tsx'"),
  },
  {
    name: 'H8 阴性对照：换写法不换语义',
    file: 'habitsList',
    expect: 'green',
    mutate: (s) => s.replace("aria-current={selected ? 'true' : undefined}", 'aria-current={selected}'),
  },
  {
    name: 'H9 词表加一类而没有任何面对它说话',
    file: 'vocab',
    expect: 'red',
    mutate: (s) => s.replace("= ['task', 'habit', 'note'];", "= ['task', 'habit', 'note', 'event'];"),
  },
];

const control = run();
if (control.rc !== 0) {
  console.log('CONTROL_NOT_GREEN — 台子自己是红的，后面所有读数都不作数');
  console.log(control.out);
  restore();
  process.exit(2);
}
console.log('CONTROL rc=0（未变异先全绿）');

const verdict = [];
for (const arm of ARMS) {
  restore();
  const needle = arm.mutate(orig[arm.file]);
  if (needle === orig[arm.file]) {
    verdict.push([arm.name, 'MUTATE-NO-OP', 'FAIL']);
    continue;
  }
  writeFileSync(`${ROOT}/${files[arm.file]}`, needle);
  const r = run();
  const f = r.out.split('\n').filter((l) => l.includes('断言 F')).length;
  const min = arm.minRed ?? 1;
  const ok = arm.expect === 'green' ? r.rc === 0 && f === 0 : r.rc !== 0 && f >= min;
  verdict.push([`${arm.name} [期望 ${arm.expect}${arm.minRed ? ` ≥${arm.minRed}` : ''}]`, `rc=${r.rc} 断言F行数=${f}`, ok ? 'OK' : 'FAIL']);
}
restore();
const same = Object.keys(BASE).every((k) => md5(files[k]) === BASE[k]);
for (const [n, d, v] of verdict) console.log(`${v.padEnd(5)} ${n}\n      ${d}`);
console.log(
  `ARMS=${ARMS.length} AS_EXPECTED=${verdict.filter(([, , v]) => v === 'OK').length} FAIL=${verdict.filter(([, , v]) => v === 'FAIL').length} FINAL_SAME=${same}`,
);
console.log(`POST_RESTORE rc=${run().rc}`);
process.exit(verdict.every(([, , v]) => v === 'OK') && same ? 0 : 1);
