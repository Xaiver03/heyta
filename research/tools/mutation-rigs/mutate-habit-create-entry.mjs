#!/usr/bin/env node
/**
 * 移动端「新建习惯」的判据臂台（工单 H2）。
 *
 * 它回答一个问题：`apps/mobile/tests/habit-create-entry.spec.ts` 那 11 条
 * 是不是**仪式**？证明方式是造三种"界面照样画得出来、按钮照样能点"的坏，
 * 看红的是不是**恰好**那几条。
 *
 * 这一族与其他臂台不同的一点，必须先说清楚：
 * 本文件里两条层**读的是不同的东西**，所以坏法分开打 ——
 *   · **行为层**（B1–B4）跑的是真 `OpLogEngine` + 真 SQLite，屏幕换了也不关它的事；
 *     它守的是"一条意图恰好一条 op""重放后仍在""另一台设备 `applyRemote` 读得到"。
 *   · **源码层**（J1–J7）守的是**接线**：`apps/mobile` 没有 RN 组件测试栈，
 *     "动作层有、界面点了没反应"这一族坏只有这一层看得见。
 * ⇒ 所以 M1（把写入换成本地数组）打红的是 J1/J3/J4/J5/J6 而**不是** B3：
 *   B3 的"另一台设备"是引擎层的钉子，界面层那份坏根本走不到引擎。
 *   这一格读数要如实留着，不要为了让臂台"好看"把它改成期望 B3 也红。
 *
 * ⚠️ 它**原地改工作树里的 `HabitsScreen.tsx`**（收尾复原并核对 md5）。
 *    同一时间不要并行跑别的 vitest（宿主的内存闸门也会把并行挡下来）。
 *
 * 跑法（仓库根）：node research/tools/mutation-rigs/mutate-habit-create-entry.mjs
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const ROOT = process.cwd();
const SCREEN = 'apps/mobile/src/screens/HabitsScreen.tsx';
const SPEC = 'tests/habit-create-entry.spec.ts';
// `vitest` 只装在需要它的那一层：根 `node_modules/.bin` 里**没有**这一枚（现量 `ls`）。
const BIN = path.join(ROOT, 'apps/mobile', 'node_modules', '.bin', 'vitest');

/** 每个 `from` 必须**恰好命中一次**（0 次 = 臂打空，2 次 = 改到了不该改的地方）。 */
const ARMS = [
  {
    name: 'M1 写入换成"本地拼一条塞进数组"（绕开 op-log，AGENTS §3.4）',
    from: `            void actions
              .createHabit(name)
              .then(() => {
                setError(null);
                refresh();
              })
              .catch((e: unknown) => {
                setError(e instanceof Error ? e.message : String(e));
              });`,
    to: `            setHabits([...habits, { name, id: 'local' } as unknown as Habit]);`,
    /* 界面不再走动作层 ⇒ 凡是**穿过这个调用点**去读的判据同时失去依据：
       J1(入口调的是动作层)、J2(它把"调用点存在"当作顺序判据的前提)、
       J3(失败接住)、J4(写完刷新)、J5(物化读唯一来源)、J6(全壳唯一调用点)。
       ⚠️ 第一版期望里漏了 J2，臂台把它报出来了 —— 少一条不是"判据更干净"，
       是我没读全那条判据自己的前提。J7 不红：文案没动。 */
    expectTitles: ['J1', 'J2', 'J3', 'J4', 'J5', 'J6'],
  },
  {
    name: 'M2 摘掉空名拦截（点一下按钮就落一条空白习惯）',
    from: `            if (name === '') return;\n`,
    to: `            // (mutation) 拦截摘掉\n`,
    expectTitles: ['J2'],
  },
  {
    name: 'M3 把 catch 换成空函数（失败被静默吞掉，用户只看到"点了没反应"）',
    from: `              .createHabit(name)
              .then(() => {
                setError(null);
                refresh();
              })
              .catch((e: unknown) => {
                setError(e instanceof Error ? e.message : String(e));
              });`,
    to: `              .createHabit(name)
              .then(() => {
                setError(null);
                refresh();
              })
              .catch(() => {});`,
    expectTitles: ['J3'],
  },
];

const orig = readFileSync(path.join(ROOT, SCREEN), 'utf8');
const md5 = (s) => createHash('md5').update(s).digest('hex');
const origMd5 = md5(orig);

const fail = (msg) => {
  writeFileSync(path.join(ROOT, SCREEN), orig);
  console.log(`RIG_RESULT=PROBE_BROKEN ${msg}`);
  process.exit(2);
};

const runSpec = (file = SPEC) => {
  const r = spawnSync(BIN, ['run', file], {
      cwd: path.join(ROOT, 'apps/mobile'),
      encoding: 'utf8',
      env: { ...process.env, NO_COLOR: '1' },
      maxBuffer: 128 * 1024 * 1024,
      timeout: 600_000,
    },
  );
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  const line = (out.match(/^[ \t]*Tests[ \t].*$/m) || [''])[0].trim();
  /* 内存闸门那一份不能读成"判据没牙"（同 `scripts/mutate-op-log-semantics.mjs`）。 */
  if (/内存闸门拒绝启动/.test(out)) {
    console.error('⏸ 载体被宿主内存护栏挡在外面 —— 这一轮**没跑成**，不是夹具坏了。');
    process.exit(2);
  }
  const failed = Number(/(\d+) failed/.exec(line)?.[1] ?? -1);
  const passed = Number(/(\d+) passed/.exec(line)?.[1] ?? -1);
  const titles = [...new Set([...out.matchAll(/^[ \t]*×\s+([BJ]\d)/gm)].map((m) => m[1]))];
  return { rc: r.status ?? 1, line, passed, failed, titles, out };
};

const b = runSpec();
if (b.rc !== 0 || b.failed > 0 || b.passed < 11) {
  fail(`干净态就不干净（要 11 passed / 0 failed）：${b.line}\n尾巴：\n${b.out.slice(-1500)}`);
}
console.log(`基线：${b.line}`);

let ok = 0;
const bad = [];
for (const arm of ARMS) {
  const hits = orig.split(arm.from).length - 1;
  if (hits !== 1) {
    fail(`${arm.name}：锚点命中 ${String(hits)} 次（必须恰好 1 次）—— 锚点漂了，注入会打空`);
  }
  writeFileSync(path.join(ROOT, SCREEN), orig.replace(arm.from, arm.to));
  const m = runSpec();
  const clean = m.failed === arm.expectTitles.length && m.passed + m.failed === b.passed;
  const exact =
    arm.expectTitles.every((t) => m.titles.includes(t)) &&
    m.titles.length === arm.expectTitles.length;
  console.log(`── ${arm.name}`);
  console.log(`   ${m.line} 红集=${m.titles.join(' ｜ ') || '(解析不到标题)'}`);
  /* 这一行是本臂台的**主要产出**（不是装饰）：界面级坏打不到行为层，
     说明 J 那几条不是 B 那几条的重复 —— 两层各守一份没人守的坏。 */
  console.log(
    `   行为层(B1–B4)=${m.titles.some((t) => t.startsWith('B')) ? '也有红（这一份坏两层都看得见）' : '全绿（这一份坏只有源码层看得见）'}`,
  );
  console.log(
    `   期望红集=${arm.expectTitles.join(' ｜ ')} ⇒ ${clean && exact ? '有牙' : '不干净'}`,
  );
  if (clean && exact) ok += 1;
  else bad.push(`${arm.name}（红集=${m.titles.join(',') || '空'}，期望=${arm.expectTitles.join(',')}）`);

  writeFileSync(path.join(ROOT, SCREEN), orig);
  if (md5(readFileSync(path.join(ROOT, SCREEN), 'utf8')) !== origMd5) {
    fail(`${arm.name}：复原失败，HabitsScreen.tsx 与基线 md5 不同，必须手工核对`);
  }
}

const r = runSpec();
console.log(`复原：BACK_TO_CLEAN=${String(r.rc === 0)} 复跑 ${r.line}`);

/* ── 行为层(B1–B4)的牙 ───────────────────────────────────────────────
 * 上面三臂打的都是**界面**，B 那四条全程不动 —— 这不是"B 没牙"，
 * 是"这一份坏只有 J 层看得见"（正是两层并存的理由）。
 * 但要给 B 取证据就不能去临时改 `packages/app-host/src/habit-actions.ts`：
 * 那份文件此刻正被另一条线写着（`git status` = M），臂台一旦崩在半路，
 * 收尾的"复原"会把**别人未提交的内容**写掉。
 * ⇒ 改成在**自己的** spec 副本里把动作层换成工单点名的那份坏（"只 push 进本地数组"），
 *   跑完立刻删除。这条探针回答的是"B 那四条对'写入没进 op-log'敏不敏感"。
 */
const PROBE = 'tests/habit-create-teeth.tmp.spec.ts';
const ANCHOR = '  habits = createHabitActions(engine, { newHabitId: () => nextHabitId(), now });';
const STUB = `${ANCHOR}
  // TEETH-PROBE（只在这份临时副本里）：动作层换成"本地拼一条塞进数组"。
  const localOnly: Habit[] = [];
  habits = {
    createHabit: async (name: string) => {
      const trimmed = name.trim();
      if (trimmed === '') throw new Error('习惯名称不能为空');
      const id = nextHabitId();
      localOnly.push({ id, name: trimmed } as unknown as Habit);
      return id;
    },
    listHabits: () => localOnly,
  } as unknown as HabitActions;`;

const specPath = path.join(ROOT, 'apps/mobile', SPEC);
const specOrig = readFileSync(specPath, 'utf8');
if (specOrig.split(ANCHOR).length - 1 !== 1) {
  fail(`B 层探针的锚点在 ${SPEC} 里不是恰好 1 次 ⇒ 桩会打空，读数为假`);
}
writeFileSync(path.join(ROOT, 'apps/mobile', PROBE), specOrig.replace(ANCHOR, STUB));
let probe;
try {
  probe = runSpec(PROBE);
} finally {
  // 残下一份 tmp spec 会被下一次全量 `pnpm -r test` 当成用例收进去 —— 必须删干净。
  try {
    rmSync(path.join(ROOT, 'apps/mobile', PROBE));
  } catch {
    /* 删不掉就在下面响亮失败 */
  }
}
const probeTitles = probe.titles;
const probeOk =
  probe.rc !== 0 &&
  ['B1', 'B2', 'B3'].every((t) => probeTitles.includes(t)) &&
  !probeTitles.some((t) => t.startsWith('J'));
console.log(`── B 层探针：动作层换成"只 push 本地数组"（工单 H2 点名的那条变异）`);
console.log(`   ${probe.line} 红集=${probeTitles.join(' ｜ ') || '(解析不到标题)'}`);
console.log(
  `   期望=B1,B2,B3 红且 J 层不红 ⇒ ${probeOk ? '成立' : '不成立'}（B4 允许红允许不红：桩照样对空名抛错）`,
);
if (!probeOk) {
  bad.push(`B 层探针（红集=${probeTitles.join(',') || '空'}）`);
} else {
  ok += 1;
}
const residue = spawnSync('ls', ['apps/mobile/tests'], { cwd: ROOT, encoding: 'utf8' }).stdout;
if (/tmp\.spec\.ts/.test(residue)) fail('临时副本没删干净 —— 它会被全量测试收进去');

if (bad.length || r.rc !== 0) {
  console.log(`RIG_RESULT=FAIL 未如预期=${bad.join(' | ') || '(无)'}`);
  process.exit(1);
}
console.log(
  `RIG_RESULT=${String(ok)}/${String(ARMS.length + 1)}（三臂界面层红集逐条等于点名那几条 + B 层对"写入不进 op-log"敏感 ⇒ 两层都不是仪式）`,
);
