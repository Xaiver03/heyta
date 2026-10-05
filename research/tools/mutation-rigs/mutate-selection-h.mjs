#!/usr/bin/env node
/**
 * 断言 H（"谁读某一类的选中，谁就得把那一类喂进回落"）的变异臂。
 *
 * H 是工单 §8.43 那节课的常驻形态：那一节是靠人按"谁在读这一类"去数屏幕，
 * 数出来任务屏是第三个持有便签全集的宿主；**数**这件事本身会漂，
 * 新加一个读 `useSelected('habit')` 的屏而没接回落时，原来没有任何一层会提醒。
 *
 * 🔴 两端规则不同，臂也就得分开（这是现量出来的差别，不是偏好）：
 *  - `apps/mobile` 回落**按屏**跑 ⇒ 判据是"同文件配对"（H1/H2/H7）
 *  - `apps/web` 是一份**中央**回落挂在 store 上 ⇒ 判据是"覆盖本宿主读到的每一类 + 真的被调用过"（H3/H4）
 * 把两端写成一条会要么整片假红、要么假绿 —— §8.43 第 7 节那次自我否证
 * 正是因为"别的文件也在喂"被当成了"这一屏有人负责"。
 *
 * 跑法（仓库根；linked worktree 里不要 `pnpm run`，它会先做 deps-status 预检）：
 *   node research/tools/mutation-rigs/mutate-selection-h.mjs
 * 判定按**预期**走而不是数红了几条：H5/H7 两条阴性对照必须绿才算合格，
 * H6 是"扫描层坏了必须响亮红"的分母自检。每臂跑完复原，终态按 md5 逐字节比。
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const ROOT = process.cwd();
const files = {
  calendar: 'apps/mobile/src/screens/CalendarScreen.tsx',
  tasks: 'apps/mobile/src/screens/TasksScreen.tsx',
  webGlue: 'apps/web/src/lib/selection.ts',
  app: 'apps/web/src/App.tsx',
  gate: 'scripts/check-selection-single-source.mjs',
};
const md5 = (p) => createHash('md5').update(readFileSync(`${ROOT}/${p}`)).digest('hex');
const orig = Object.fromEntries(Object.entries(files).map(([k, p]) => [k, readFileSync(`${ROOT}/${p}`, 'utf8')]));
const BASE_HASH = Object.fromEntries(Object.entries(files).map(([k, p]) => [k, md5(p)]));

const restore = () => {
  for (const [k, p] of Object.entries(files)) writeFileSync(`${ROOT}/${p}`, orig[k]);
};

/** 替换必须逐字命中一次；命中 0 次或多次都算臂坏了，而不是"产品没问题"。 */
const sub1 = (key, from, to) => {
  const src = orig[key];
  const n = src.split(from).length - 1;
  if (n !== 1) throw new Error(`${files[key]} 里的锚点命中 ${n} 次（要 1 次）：${JSON.stringify(from).slice(0, 90)}`);
  writeFileSync(`${ROOT}/${files[key]}`, src.replace(from, to));
};
const append = (key, text) => writeFileSync(`${ROOT}/${files[key]}`, orig[key] + text);

const runGate = () => {
  let out = '';
  let rc = 0;
  try {
    out = execFileSync('node', ['scripts/check-selection-single-source.mjs'], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (e) {
    rc = e.status ?? 1;
    out = `${e.stdout || ''}${e.stderr || ''}`;
  }
  const fired = [...new Set([...out.matchAll(/断言 ([A-Z0-9]+)/g)].map((m) => m[1]))];
  return { rc, fired, out };
};

const ARMS = [
  {
    name: 'H1 触屏端新加一个读 note 的屏而不接回落',
    apply: () =>
      append(
        'calendar',
        '\n// 变异臂 H1：模拟"新加一处读便签选中的屏"。本臂只验门禁的文本判据，\n// 不验类型（import 没补是该臂的边界，不是门禁的漏洞）。\nexport const __probeNoteReader = () => useSelected(\'note\');\n',
      ),
    expectRed: ['CalendarScreen.tsx', "'note'"],
  },
  {
    name: 'H2 任务屏摘掉 prune 实参里的 note 那一项（它仍然读 note）',
    apply: () =>
      sub1(
        'tasks',
        '      ...(aliveNotes === undefined ? {} : { note: aliveNotes.map((note) => note.id) }),\n',
        '',
      ),
    expectRed: ['TasksScreen.tsx', "'note'"],
  },
  {
    name: 'H3 Web 中央回落少一类（摘掉 habit 的谓词）',
    apply: () => sub1('webGlue', '    habit: existsIn(aliveIds(entities.habits)),\n', ''),
    expectRed: ['apps/web/src/lib/selection.ts', "'habit'"],
  },
  {
    name: 'H4 Web 中央回落存在但没人调用',
    apply: () => sub1('app', '    pruneSelectionFromEntities(store.entities);', '    // 变异臂 H4：接线没了'),
    expectRed: ['没有任何文件调用', 'pruneSelectionFromEntities('],
  },
  {
    name: 'H5 阴性对照：同样的字样只写进注释',
    apply: () =>
      append(
        'calendar',
        '\n/* 变异臂 H5：`useSelected(\'note\')` 在这里只是注释里的举例，不该被当成读方。 */\n',
      ),
    expectGreen: true,
  },
  {
    name: 'H6 分母自检：把扫描用的正则改坏到恒不匹配（但仍是合法正则）',
    // ⚠️ 第一版这里写成把 `useSelected\(` 换成 `useSelectedZZZ(`（连反斜杠一起摘掉），
    //    结果正则变成 `…['"]task['"]\)` —— 未闭合的分组，`new RegExp` 直接抛，
    //    门禁**崩**在扫描之前，rc=1 来自崩溃而不是分母自检。本臂要的是后者。
    // ⚠️ 第二版（2026-10-05 修）：锚点 `useSelected\\(` 在门禁里涨到**三处**（`readKindRe`
    //    的构造处、名册 live 判定两处），`sub1` 当场拒绝 —— 臂台红在"锚点不唯一"上，
    //    而不是红在判据上。
    // 🔴 第三版才找对靶：第二版换成 `const re = new RegExp(...` 那个"唯一锚点"之后 rc=0，
    //    看着像"分母自检没牙"。实际是那一行属于**名册 live 判定**（失败串是「断言 I：…」），
    //    而 `readsSeen` 由 `readKindRe` 喂 —— 我改坏的是另一把尺子，不是这条判据的输入。
    //    第一反应会是"放宽 expectRed"或"宣布这条分母自检是假的"，两条都搞反了：
    //    判据本体就写着 `if (readsSeen.length === 0)`，在的。
    //    📌 变异臂不红时，先确认改的那一行是不是这条判据的**输入**，再谈判据的强度。
    apply: () =>
      sub1(
        'gate',
        'const readKindRe = (kind) => new RegExp(`useSelected\\\\(',
        'const readKindRe = (kind) => new RegExp(`useSelectedZZZ\\\\(',
      ),
    expectRed: ['没扫到任何'],
  },
  {
    name: 'H7 阴性对照：同一文件里两处 prune 调用，note 只在其中一处（要聚合，不能只看第一处）',
    apply: () =>
      sub1(
        'tasks',
        '    const aliveNotes = noteActions === null ? undefined : noteActions.listNotes();',
        '    pruneSelectionAgainst({ task: aliveTasks.map((task) => task.id) });\n    const aliveNotes = noteActions === null ? undefined : noteActions.listNotes();',
      ),
    expectGreen: true,
  },
];

let fail = 0;
let asExpected = 0;
for (const arm of ARMS) {
  restore();
  try {
    arm.apply();
  } catch (e) {
    console.log(`BROKEN  ${arm.name}\n      ${e.message}`);
    fail += 1;
    restore();
    continue;
  }
  const { rc, fired, out } = runGate();
  const hLines = out.split('\n').filter((l) => l.includes('断言 H'));
  if (arm.expectGreen) {
    const ok = rc === 0;
    console.log(`${ok ? 'OK   ' : 'BAD  '}${arm.name} → rc=${rc}  firing=[${fired.join(',')}]`);
    if (!ok) fail += 1;
    else asExpected += 1;
  } else {
    const missingNeedles = arm.expectRed.filter((n) => !out.includes(n));
    const ok = rc !== 0 && fired.includes('H') && missingNeedles.length === 0;
    console.log(
      `${ok ? 'OK   ' : 'BAD  '}${arm.name} → rc=${rc}  firing=[${fired.join(',')}]` +
        (missingNeedles.length > 0 ? `\n      报错里找不到：${JSON.stringify(missingNeedles)}` : ''),
    );
    if (!ok) {
      fail += 1;
      console.log(hLines.slice(0, 3).map((l) => `      ${l.trim()}`).join('\n'));
    } else asExpected += 1;
  }
  restore();
}

const AFTER_HASH = Object.fromEntries(Object.entries(files).map(([k, p]) => [k, md5(p)]));
const same = Object.entries(BASE_HASH).every(([k, h]) => AFTER_HASH[k] === h);
const control = runGate();
console.log(
  `ARMS=${ARMS.length} AS_EXPECTED=${asExpected} FAIL=${fail} FINAL_SAME=${same} ` +
    `CONTROL rc=${control.rc} firing=[${control.fired.join(',')}]`,
);
process.exit(fail === 0 && same && control.rc === 0 ? 0 : 1);
