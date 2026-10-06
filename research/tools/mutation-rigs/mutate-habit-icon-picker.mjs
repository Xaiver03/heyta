#!/usr/bin/env node
/**
 * 移动端图标选择器的判据臂台（工单 H3）。
 *
 * 要回答的问题：`apps/mobile/tests/habit-icon-picker.spec.ts` 那 10 条是不是仪式？
 * 五份坏，各自点名该红的判据：
 *
 *   A1 宿主里手抄一份字形表（**第三份事实源**）      ⇒ S2
 *   A2 web 长回那份手抄的词条表                    ⇒ S3
 *   A3 「再点同一个 = 退回派生」变成"永远设上"       ⇒ S4
 *   A4 磁盘值不做解析、直接 `as HabitIcon`          ⇒ S4
 *   P1 行为层探针：`setHabitIcon` 换成宿主自己拼 op ⇒ K1..K4
 *
 * 🔴 P1 为什么在自己的**副本**里做：这一族的真身住在
 *    `packages/app-host/src/habit-actions.ts`，而那份文件此刻正被另一条线写着
 *    （`git status` = `M`）。臂台临时改别人的未提交文件，一旦崩在半路，
 *    收尾的"复原"会把**别人写的内容**覆盖掉 —— 那不是风险，是事故。
 *    副本里桩掉动作层同样能回答"K 那四条对'写入形状'敏不敏感"。
 *
 * ⚠️ A1/A3/A4 原地改 `apps/mobile/src/ui/habit-icon-slot.tsx`，A2 改
 *    `apps/web/src/features/habits/habit-glyphs.ts`；每臂收尾复原并核对 md5。
 *    同一时间不要并行跑别的 vitest。
 *
 * 跑法（仓库根）：node research/tools/mutation-rigs/mutate-habit-icon-picker.mjs
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const ROOT = process.cwd();
const SLOT = 'apps/mobile/src/ui/habit-icon-slot.tsx';
const WEB_GLYPHS = 'apps/web/src/features/habits/habit-glyphs.ts';
const SPEC = 'tests/habit-icon-picker.spec.ts';
const BIN = path.join(ROOT, 'apps/mobile', 'node_modules', '.bin', 'vitest');

const ARMS = [
  {
    file: SLOT,
    name: 'A1 宿主里手抄一份「key → 字形」表（第三份事实源）',
    from: `import { HABIT_GLYPHS, HABIT_ICON_LABEL_KEYS, HeytaIcon } from '@heyta/ui';`,
    to: `import { HABIT_ICON_LABEL_KEYS, HeytaIcon } from '@heyta/ui';
// MUTATION-ARM A1（临时）：宿主自己抄一份字形表 —— 正是本单最该挡的形状。
const HABIT_GLYPHS: Record<string, unknown> = { drop: 'a-copy', moon: 'a-copy' };`,
    expectTitles: ['S2'],
  },
  {
    file: WEB_GLYPHS,
    name: 'A2 web 长回那份手抄的词条表',
    from: `export { HABIT_ICON_LABEL_KEYS } from '@heyta/ui';`,
    to: `export const HABIT_ICON_LABEL_KEYS = {
  drop: 'web.habits.icon.drop',
  activity: 'web.habits.icon.activity',
  book: 'web.habits.icon.book',
  moon: 'web.habits.icon.moon',
  leaf: 'web.habits.icon.leaf',
  pencil: 'web.habits.icon.pencil',
  sun: 'web.habits.icon.sun',
  music: 'web.habits.icon.music',
} as const;`,
    expectTitles: ['S3'],
  },
  {
    file: SLOT,
    name: 'A3 「再点同一个字形」不再退回派生（变成永远设上）',
    from: `                onChoose(effective === icon && value === icon ? undefined : icon);`,
    to: `                onChoose(icon);`,
    expectTitles: ['S4'],
  },
  {
    file: SLOT,
    name: 'A4 磁盘上的值不过解析器，直接当类型用',
    from: `  const value = parseHabitIcon(habit.icon);`,
    to: `  const value = habit.icon as HabitIcon;`,
    expectTitles: ['S4'],
  },
];

const md5 = (s) => createHash('md5').update(s).digest('hex');
const originals = new Map(
  [SLOT, WEB_GLYPHS].map((rel) => [rel, readFileSync(path.join(ROOT, rel), 'utf8')]),
);
const restoreAll = () => {
  for (const [rel, text] of originals) writeFileSync(path.join(ROOT, rel), text);
};

const fail = (msg) => {
  restoreAll();
  try {
    rmSync(path.join(ROOT, 'apps/mobile', 'tests', 'habit-icon-teeth.tmp.spec.ts'));
  } catch {
    /* 还没生成 */
  }
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
  });
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  if (/内存闸门拒绝启动/.test(out)) {
    restoreAll();
    console.error('⏸ 载体被宿主内存护栏挡在外面 —— 这一轮**没跑成**，不是夹具坏了。');
    process.exit(2);
  }
  const line = (out.match(/^[ \t]*Tests[ \t].*$/m) || [''])[0].trim();
  return {
    rc: r.status ?? 1,
    line,
    passed: Number(/(\d+) passed/.exec(line)?.[1] ?? -1),
    failed: Number(/(\d+) failed/.exec(line)?.[1] ?? -1),
    titles: [...new Set([...out.matchAll(/^[ \t]*×\s+([KS]\d)/gm)].map((m) => m[1]))],
    out,
  };
};

const baseline = runSpec();
if (baseline.rc !== 0 || baseline.failed > 0 || baseline.passed < 10) {
  fail(`干净态就不干净（要 >=10 passed / 0 failed）：${baseline.line}\n尾巴：\n${baseline.out.slice(-1500)}`);
}
console.log(`基线：${baseline.line}`);

let ok = 0;
const bad = [];
for (const arm of ARMS) {
  const text = originals.get(arm.file);
  const hits = text.split(arm.from).length - 1;
  if (hits !== 1) fail(`${arm.name}：锚点在 ${arm.file} 里命中 ${String(hits)} 次（必须恰好 1 次）`);
  writeFileSync(path.join(ROOT, arm.file), text.replace(arm.from, arm.to));
  const m = runSpec();
  const exact =
    m.failed === arm.expectTitles.length &&
    m.titles.length === arm.expectTitles.length &&
    arm.expectTitles.every((t) => m.titles.includes(t));
  console.log(`── ${arm.name}`);
  console.log(`   ${m.line} 红集=${m.titles.join(' ｜ ') || '(解析不到标题)'}`);
  console.log(
    `   层=${m.titles.some((t) => t.startsWith('K')) ? 'K 行为层也有红' : '只有源码层红（这一份坏走不到引擎）'}`,
  );
  console.log(`   期望红集=${arm.expectTitles.join(' ｜ ')} ⇒ ${exact ? '有牙' : '不干净'}`);
  if (exact) ok += 1;
  else bad.push(`${arm.name}（红集=${m.titles.join(',') || '空'}，期望=${arm.expectTitles.join(',')}）`);
  restoreAll();
  for (const [rel, text0] of originals) {
    if (md5(readFileSync(path.join(ROOT, rel), 'utf8')) !== md5(text0)) {
      fail(`${arm.name}：复原失败，${rel} 与基线 md5 不同，必须手工核对`);
    }
  }
}

/* ── P1：K 行为层的牙（在自己的 spec 副本里桩掉动作层）──────────────── */
const PROBE = 'tests/habit-icon-teeth.tmp.spec.ts';
const ANCHOR = '  habits = createHabitActions(engine, { newHabitId: () => nextHabitId(), now });';
const specText = readFileSync(path.join(ROOT, 'apps/mobile', SPEC), 'utf8');
if (specText.split(ANCHOR).length - 1 !== 1) {
  fail(`P1 的锚点在 ${SPEC} 里不是恰好 1 次 ⇒ 桩会打空，读数为假`);
}
const STUB = `${ANCHOR}
  // TEETH-PROBE（只在这份临时副本里）：把"选图标"换成宿主自己拼 op ——
  // 一次意图发两条（fan-out）、清除写成少一个键、闭集之外的值照收。
  const real = habits;
  habits = {
    ...real,
    setHabitIcon: async (entityId: string, icon: unknown) => {
      await engine.dispatch({
        entityType: 'HABIT' as never,
        entityId,
        opType: OpType.Update as never,
        payload: { icon: icon ?? undefined, touchedAt: 1 } as never,
      });
      await engine.dispatch({
        entityType: 'HABIT' as never,
        entityId,
        opType: OpType.Update as never,
        payload: { extraOp: true } as never,
      });
    },
  } as HabitActions;`;
writeFileSync(
  path.join(ROOT, 'apps/mobile', PROBE),
  specText.replace(ANCHOR, STUB),
);
let probe;
try {
  probe = runSpec(PROBE);
} finally {
  try {
    rmSync(path.join(ROOT, 'apps/mobile', PROBE));
  } catch {
    /* 下面响亮检查 */
  }
}
const probeExpect = ['K1', 'K2', 'K3'];
const probeExact =
  probe.rc !== 0 &&
  probeExpect.every((t) => probe.titles.includes(t)) &&
  !probe.titles.some((t) => t.startsWith('S'));
console.log('── P1 行为层探针：`setHabitIcon` 换成宿主自己拼 op（两条 + 无校验 + 清除丢键）');
console.log(`   ${probe.line} 红集=${probe.titles.join(' ｜ ') || '(解析不到标题)'}`);
console.log(
  `   期望至少 K1,K2,K3 红（K4 允许红：清除不生效它就会红），且 S 层不红 ⇒ ${probeExact ? '成立' : '不成立'}`,
);
if (probeExact) ok += 1;
else bad.push(`P1（红集=${probe.titles.join(',') || '空'}）`);

if (/tmp\.spec\.ts/.test(spawnSync('ls', ['apps/mobile/tests'], { cwd: ROOT, encoding: 'utf8' }).stdout)) {
  fail('临时副本没删干净 —— 它会被全量测试收进去');
}

const after = runSpec();
console.log(`复原：BACK_TO_CLEAN=${String(after.rc === 0)} 复跑 ${after.line}`);
if (bad.length || after.rc !== 0) {
  console.log(`RIG_RESULT=FAIL 未如预期=${bad.join(' | ') || '(无)'}`);
  process.exit(1);
}
console.log(
  `RIG_RESULT=${String(ok)}/${String(ARMS.length + 1)}（四臂源码层红集逐条等于点名那几条 + K 层对"写入形状"敏感 ⇒ 两层都不是仪式）`,
);
