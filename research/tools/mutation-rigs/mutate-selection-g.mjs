#!/usr/bin/env node
/**
 * 断言 G 的变异臂（`scripts/check-selection-single-source.mjs`）。
 *
 * G 判的是：**宿主里每一处"记住某一行的 id"的本地 `useState`，都必须带着语义类别逐处登记**。
 * 它存在的理由不是"再抓一次 B 抓过的东西"，而是 §8.28 那次人工审计的结论
 * （"这 15 处都不是选中"）**不会自己守住下一次** —— 换一个新名字，B 就看不见它。
 *
 * 跑法（仓库根，不要在 linked worktree 里用 `pnpm run`，它会先做 deps-status 预检）：
 *   node research/tools/mutation-rigs/mutate-selection-g.mjs
 *
 * 七臂的**预期**（G5/G6 是阴性对照，它们的"存活/只由 B 报"就是合格本身，不是漏洞）：
 *   G1 新增一处未登记的行 id 态        → 红：G 未登记
 *   G2 把已登记的一处改名（换个名字）  → 红：G 未登记 + G 过期豁免（一次改名同时命中两侧）
 *   G3 删掉一处已登记的声明          → 红：G 过期豁免
 *   G4 类别写成词表外的词            → 红：F 类别不在封闭词表
 *   G5 复数 `selectedIds`            → **必须不红**（复数是筛选范围，刻意不在射程）
 *   G6 真选中名 `detailNoteId`       → 红，且 **F=0 / B=1**（同一个人只报一次，两层不重复报）
 *   G7 把扫描模式改坏（`rowIdSeen` 归零）→ 红：分母自检（"全部已登记"与"没东西可登记"是两件事）
 *
 * 判定**按每臂的预期**走（不是"数红了几条"）：七臂全 OK 且 `FINAL_SAME=true` 才 exit 0。
 * `FINAL_SAME` 是四枚被改文件（门禁 + 三枚宿主源码）的 md5 与开工前逐字相同 ——
 * 这条台子会真改宿主源码，**没有还原证明的绿不算跑过**。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const ROOT = process.cwd();
const GATE = 'scripts/check-selection-single-source.mjs';
const files = {
  gate: GATE,
  webTrash: 'apps/web/src/features/trash/TrashView.tsx',
  mobHabits: 'apps/mobile/src/screens/HabitsScreen.tsx',
  webHabits: 'apps/web/src/features/habits/HabitsView.tsx',
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

const TRASH_ROW = "['apps/web/src/features/trash/TrashView.tsx', 'confirmingId', 'confirm-gate']";

/** 每臂带 `expect`：`red-F` / `green` / `red-B-only`。判定按预期走，不按"红了多少条"走。 */
const arms = [
  {
    name: 'G1 新增一处未登记的行 id 态',
    file: 'webTrash',
    expect: 'red-G',
    mutate: (s) => s.replace('  const [confirmingId', '  const [pickedId, setPickedId] = useState<string | null>(null);\n  const [confirmingId'),
  },
  {
    name: 'G2 把已登记的一处改名',
    file: 'mobHabits',
    expect: 'red-G',
    mutate: (s) => s.replaceAll('renamingId', 'rowRenameId').replaceAll('RenamingId', 'RowRenameId'),
  },
  {
    name: 'G3 删掉一处已登记的声明（过期豁免）',
    file: 'webTrash',
    expect: 'red-G',
    mutate: (s) => s.replace(/  const \[confirmingId[^\n]*\n/, ''),
  },
  {
    name: 'G4 登记类别写成词表外的词',
    file: 'gate',
    expect: 'red-G',
    mutate: (s) => s.replace(TRASH_ROW, TRASH_ROW.replace("'confirm-gate'", "'whatever'")),
  },
  {
    name: 'G5 复数 selectedIds（阴性对照）',
    file: 'webHabits',
    expect: 'green',
    mutate: (s) => s.replace('  const [busyId', '  const [selectedIds, setSelectedIds] = useState<string[]>([]);\n  const [busyId'),
  },
  {
    name: 'G6 真选中名 detailNoteId（只该由 B 报）',
    file: 'webTrash',
    expect: 'red-B-only',
    mutate: (s) => s.replace('  const [confirmingId', '  const [detailNoteId, setDetailNoteId] = useState<string | null>(null);\n  const [confirmingId'),
  },
  {
    name: 'G7 扫描模式改坏（分母自检）',
    file: 'gate',
    expect: 'red-G',
    mutate: (s) => s.replace('const ROW_ID_NAME = /^[A-Za-z0-9_$]*Id$/;', 'const ROW_ID_NAME = /^__never__Id$/;'),
  },
];

const control = run();
if (control.rc !== 0) {
  console.log('CONTROL_NOT_GREEN — 台子自己是红的，后面所有读数都不作数');
  console.log(control.out);
  restore();
  process.exit(2);
}
console.log('CONTROL rc=0（未变异先全绿，才允许信后面的红）');

const verdict = [];
for (const arm of arms) {
  restore();
  const next = arm.mutate(orig[arm.file]);
  if (next === orig[arm.file]) {
    verdict.push([arm.name, 'MUTATE-NO-OP', 'FAIL']);
    continue;
  }
  writeFileSync(`${ROOT}/${files[arm.file]}`, next);
  const r = run();
  const f = r.out.split('\n').filter((l) => l.includes('断言 G')).length;
  const b = r.out.split('\n').filter((l) => l.includes('断言 B')).length;
  const ok =
    (arm.expect === 'red-G' && r.rc !== 0 && f > 0) ||
    (arm.expect === 'green' && r.rc === 0 && f === 0) ||
    (arm.expect === 'red-B-only' && r.rc !== 0 && b > 0 && f === 0);
  verdict.push([`${arm.name} [期望 ${arm.expect}]`, `rc=${r.rc} G=${f} B=${b}`, ok ? 'OK' : 'FAIL']);
}
restore();
const same = Object.keys(BASE).every((k) => md5(files[k]) === BASE[k]);
for (const [n, d, v] of verdict) console.log(`${v.padEnd(5)} ${n}\n      ${d}`);
console.log(
  `ARMS=${arms.length} RED=${verdict.filter(([, d]) => d.startsWith('rc=1')).length} ` +
    `GREEN=${verdict.filter(([, d]) => d.startsWith('rc=0')).length} ` +
    `AS_EXPECTED=${verdict.filter(([, , v]) => v === 'OK').length} FAIL=${verdict.filter(([, , v]) => v === 'FAIL').length} FINAL_SAME=${same}`,
);
console.log(`POST_RESTORE rc=${run().rc}`);
process.exit(verdict.every(([, , v]) => v === 'OK') && same ? 0 : 1);
