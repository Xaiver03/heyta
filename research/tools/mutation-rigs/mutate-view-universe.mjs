#!/usr/bin/env node
/**
 * 「视图全集必须每个都选了边站」那两条判据的变异臂（工单 W1b / W1 的跨视图那一半）。
 *
 * 判据本体在 `apps/web/tests/keyboard-cursor.spec.tsx`：
 *   ① 分区那条 —— `view-tabs.ts` 的 `ViewKey` 全集 = `keyboard-cursor.ts` 表里的 ∪ 登记过名单的表外视图；
 *   ② 行为那条 —— 表外视图逐个挂上光标钩子按 ↓，选中不许动（正向对照在同一趟里）。
 * 它把 `keyboard-cursor.ts:71` 那句"这张表的正确性取决于**缺席都有理由**"从注释变成能红的东西。
 *
 * 跑法（仓库根；linked worktree 里不要 `pnpm run`，它先做 deps-status 预检）：
 *   node research/tools/mutation-rigs/mutate-view-universe.mjs
 *
 * 每臂的**预期**（判定按预期走，不按"红了几条"走；V5 是阴性对照，它的"不红"就是合格本身）：
 *   V1 `ViewKey` 多一个视图而两处都没交代   → 红：分区那条（行为腿仍绿 —— 它挂上钩子后确实不绑）
 *   V2 名单里删掉 `focus`                    → 红：分区那条（名单比推出的集合少一项）
 *   V3 表里给 `trash` 加一行、名单没跟着改   → 红：**只有**分区那条。
 *      🟡 这一臂的"行为腿仍绿"是**设计出来的**，不是漏洞：行为腿循环的就是"推出来的表外集"，
 *      trash 进了表就不在循环里了。要抓住"接错了的视图"靠的是上面那圈 `cases` 字面清单
 *      （它故意**不**从表里派生 —— 派生就等于让被检者自己出卷），见工单 §8.41 第 3 条。
 *   V4 把 `const CURSOR_VIEWS` 改名          → 红：两条都抛（解析器读空不许当读通）
 *   V5 在类型块**外面**加一个 `'foo'` 字样   → **必须不红**（证明解析器锚的是那块，不是整个文件）
 *
 * 🔴 这台子会真改三份源文件（含测试文件自己），**没有还原证明的绿不算跑过**：
 * `FINAL_SAME` = 三枚文件的 md5 与开工前逐字相同；收尾再跑一次未变异确认回到 25 passed。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const ROOT = process.cwd();
const files = {
  tabs: 'apps/web/src/features/shell/view-tabs.ts',
  cursor: 'apps/web/src/lib/keyboard-cursor.ts',
  spec: 'apps/web/tests/keyboard-cursor.spec.tsx',
};
const md5 = (p) => createHash('md5').update(readFileSync(`${ROOT}/${p}`)).digest('hex');
const BASE = Object.fromEntries(Object.entries(files).map(([k, p]) => [k, md5(p)]));
const orig = Object.fromEntries(Object.entries(files).map(([k, p]) => [k, readFileSync(`${ROOT}/${p}`, 'utf8')]));

const JSON_OUT = '/tmp/dp_view_universe.json';
const run = () => {
  let out = '';
  let rc = 0;
  try {
    out = execFileSync(
      './node_modules/.bin/vitest',
      ['run', 'tests/keyboard-cursor.spec.tsx', '--reporter=json', `--outputFile=${JSON_OUT}`],
      {
        cwd: `${ROOT}/apps/web`,
        encoding: 'utf8',
        env: { ...process.env, NO_COLOR: '1' },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
  } catch (e) {
    rc = e.status ?? 1;
    out = `${e.stdout || ''}${e.stderr || ''}`;
  }
  // 🔴 第一版这里用默认 reporter 的文本抓失败用例名，**四臂全 FAIL 而产品没坏**：
  //    vitest 的汇总行在有用例失败时是 `Tests  1 failed | 24 passed (25)`，
  //    我的 `/Tests\s+(\d+) passed/` 匹配不上 ⇒ `passed=0`；用例名那行的形状也不是我猜的那个。
  //    ⇒ 改成 JSON reporter：状态与 `fullName` 是机器可读的，不靠文本形状。
  let res;
  try {
    res = JSON.parse(readFileSync(JSON_OUT, 'utf8'));
  } catch {
    return { rc, passed: -1, failed: -1, partition: -1, behavior: -1, names: [], out };
  }
  const all = (res.testResults || []).flatMap((f) => f.assertionResults || []);
  const failedList = all.filter((a) => a.status === 'failed');
  const names = failedList.map((a) => a.fullName || a.title || '');
  return {
    rc,
    passed: all.filter((a) => a.status === 'passed').length,
    failed: failedList.length,
    total: all.length,
    partition: names.filter((n) => n.includes('每个都选了边站')).length,
    behavior: names.filter((n) => n.includes('不绑光标')).length,
    names,
    out,
  };
};
const restore = () => {
  for (const [k, p] of Object.entries(files)) writeFileSync(`${ROOT}/${p}`, orig[k]);
};

const arms = [
  {
    name: 'V1 ViewKey 多一个视图，两处都没交代',
    file: 'tabs',
    expect: 'partition',
    mutate: (s) => s.replace("  | 'settings';", "  | 'settings'\n  | 'archive';"),
  },
  {
    name: 'V2 登记表里删掉 focus',
    file: 'spec',
    expect: 'partition',
    mutate: (s) => s.replace("const ACCOUNTED_OUT = ['calendar', 'focus', 'growth',", "const ACCOUNTED_OUT = ['calendar', 'growth',"),
  },
  {
    name: 'V3 表里给 trash 加一行，登记表没跟着改',
    file: 'cursor',
    expect: 'partition',
    mutate: (s) => s.replace("    habits: { kind: 'habit', prefix: 'habit-row' },", "    trash: { kind: 'task', prefix: 'task-item' },\n    habits: { kind: 'habit', prefix: 'habit-row' },"),
  },
  {
    name: 'V4 把 const CURSOR_VIEWS 改名（解析器该抛，不该读空通过）',
    file: 'cursor',
    expect: 'both',
    mutate: (s) => s.replace('const CURSOR_VIEWS:', 'const CURSOR_VIEWZ:'),
  },
  {
    name: 'V5 类型块外面出现一个 foo 字样（阴性对照，必须不红）',
    file: 'tabs',
    expect: 'green',
    mutate: (s) => `${s}\n// 这条注释里有 'foo' 与 'bar' 两个引号词，不该被 ViewKey 解析器读到\n`,
  },
];

restore();
const control = run();
if (!(control.rc === 0 && control.passed === 25 && control.total === 25)) {
  console.log(
    `CONTROL_NOT_GREEN — 未变异就不是"25 passed"（passed=${control.passed} total=${control.total} rc=${control.rc}），后面所有读数都不作数`,
  );
  console.log(String(control.out).split('\n').slice(-25).join('\n'));
  process.exit(2);
}
console.log('CONTROL rc=0，25/25 passed（未变异先全绿，才允许信后面的红）');

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
  if (r.total !== 25) {
    verdict.push([`${arm.name} [期望 ${arm.expect}]`, `台子自己没跑出 25 条（total=${r.total} rc=${r.rc}）`, 'FAIL']);
    continue;
  }
  const ok =
    (arm.expect === 'partition' && r.rc !== 0 && r.partition >= 1 && r.behavior === 0) ||
    (arm.expect === 'both' && r.rc !== 0 && r.partition >= 1 && r.behavior >= 1) ||
    (arm.expect === 'green' && r.rc === 0 && r.failed === 0);
  verdict.push([
    `${arm.name} [期望 ${arm.expect}]`,
    `rc=${r.rc} passed=${r.passed} failed=${r.failed} 分区红=${r.partition} 行为红=${r.behavior}｜红集: ${r.names.join(' / ') || '（无）'}`,
    ok ? 'OK' : 'FAIL',
  ]);
}
restore();
const same = Object.keys(BASE).every((k) => md5(files[k]) === BASE[k]);
for (const [n, d, v] of verdict) console.log(`${v.padEnd(5)} ${n}\n      ${d}`);
const post = run();
console.log(
  `ARMS=${arms.length} AS_EXPECTED=${verdict.filter(([, , v]) => v === 'OK').length} ` +
    `FAIL=${verdict.filter(([, , v]) => v === 'FAIL').length} FINAL_SAME=${same} ` +
    `POST_RESTORE rc=${post.rc} passed=${post.passed}`,
);
process.exit(verdict.every(([, , v]) => v === 'OK') && same && post.rc === 0 && post.passed === 25 ? 0 : 1);
