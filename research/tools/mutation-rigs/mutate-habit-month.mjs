#!/usr/bin/env node
/**
 * 习惯月历 + 补打卡的判据臂台（工单 H4）。
 *
 * 要回答的问题：`packages/domain/tests/habit-backfill.spec.ts`（B1–B9）、
 * `packages/ui/tests/habit-month-model.spec.ts`（U1–U8）、
 * `apps/web/tests/habit-month-board.spec.tsx`（V1–V11）、
 * `apps/mobile/tests/habit-month-entry.spec.ts`（X1–X7）这四族是不是仪式。
 *
 * 五份坏，按**层**注入（哪一层被改，只有吃得到那一层的判据会红 —— 这正是分层要证明的事）：
 *
 *   MA1 补白格变成可点（点它 = 在邻月写一条记录）    ⇒ U3 + V4
 *   MA2 补白格的读数改用状态句子（说"今天"却点不动）  ⇒ V4
 *   MA3 宿主按下时丢掉那一天（web+mobile 两端同时）    ⇒ V11 + X2
 *   MA4 默认窗口从推导改成拍死的 7 天                 ⇒ B1 B2 B3 B5 B9 + U7 + V6
 *   MA5 格子不再声明"不能按"                          ⇒ V4 + V5
 *
 * 🔴 期望红集是**逐臂点名**的，不是"有红就行"：少了 = 判据没牙，
 *    多了 = 这一臂同时打到了别的判据，"这条臂证的是哪一档"就说不清。
 *
 * ⚠️ **为什么要 rebuild**：`apps/web` 那一族吃的是 `@heyta/ui` / `@heyta/domain` 的
 *    **dist**（package exports）。改 src 不重打就是"注入根本没进产物"，读数会是**假绿**
 *    （§7 第 27 条同一个坑）。`packages/ui` 与 `packages/domain` 自己的 spec 吃 **src**，
 *    不需要重打。
 * ⚠️ "进没进产物"这里**不看臂注释**：构建会把注释剥掉（实测 `packages/ui/dist/*.js`
 *    里一个中文注释都没有），所以判据是**整包 dist 摘要变了没有** —— 只有真的进了代码才会变。
 *    一份只改注释的假注入会在这里被认成"没进产物"，那正是想要的读数。
 * ⚠️ 它会原地改源文件，每臂收尾复原并核对 md5；vitest 被宿主内存护栏挡住时报
 *    `PROBE_BROKEN` 并**不记成判据红**。
 *
 * 跑法（仓库根）：node research/tools/mutation-rigs/mutate-habit-month.mjs
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const ROOT = process.cwd();
const UI_MONTH_MODEL = 'packages/ui/src/habits/month-model.ts';
const UI_BOARD = 'packages/ui/src/habits/HabitMonthBoard.tsx';
const DOM_BACKFILL = 'packages/domain/src/habit-backfill.ts';
const WEB_CARD = 'apps/web/src/features/habits/HabitDetailCard.tsx';
const MOBILE_SCREEN = 'apps/mobile/src/screens/HabitsScreen.tsx';

const md5 = (s) => createHash('md5').update(s).digest('hex');
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');

/**
 * 整包 `dist/` 的摘要（路径 + 内容）。
 * 用来回答"注入到底进产物了没有"—— 见文件头那条：臂注释会被构建剥掉，所以不能拿注释当证据。
 */
function distDigest(pkg) {
  const dir = path.join(ROOT, 'packages', pkg, 'dist');
  if (!statSync(dir, { throwIfNoEntry: false })?.isDirectory()) return 'NO_DIST_DIR';
  const acc = [];
  const walk = (d) => {
    for (const name of readdirSync(d).sort()) {
      const full = path.join(d, name);
      if (statSync(full).isDirectory()) walk(full);
      else acc.push(`${path.relative(dir, full)}:${md5(readFileSync(full))}`);
    }
  };
  walk(dir);
  return acc.join('|');
}

const SPECS = [
  { key: 'domain', cwd: 'packages/domain', specs: ['tests/habit-backfill.spec.ts'] },
  { key: 'ui', cwd: 'packages/ui', specs: ['tests/habit-month-model.spec.ts'] },
  { key: 'web', cwd: 'apps/web', specs: ['tests/habit-month-board.spec.tsx'] },
  { key: 'mobile', cwd: 'apps/mobile', specs: ['tests/habit-month-entry.spec.ts'] },
];

function runVitest({ cwd, specs }) {
  const r = spawnSync(path.join(ROOT, cwd, 'node_modules', '.bin', 'vitest'), ['run', ...specs], {
    cwd: path.join(ROOT, cwd),
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' },
    maxBuffer: 128 * 1024 * 1024,
    timeout: 900_000,
  });
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  return {
    rc: r.status ?? 1,
    line: (out.match(/^[ \t]*Tests[ \t].*$/m) || [''])[0].trim(),
    out,
    bailed: /内存闸门拒绝启动/.test(out),
    titles: [...new Set([...out.matchAll(/^[ \t]*×\s+([BUVX]\d+)/gm)].map((x) => x[1]))],
  };
}

/** 四族各跑一遍，红集取**并集**（标题前缀 B/U/V/X 自带归属）。 */
function runAll() {
  const per = SPECS.map((s) => ({ key: s.key, res: runVitest(s) }));
  return {
    per,
    titles: [...new Set(per.flatMap((p) => p.res.titles))].sort(),
    bailed: per.some((p) => p.res.bailed),
  };
}

function rebuild(pkgs) {
  for (const p of pkgs) {
    const r = spawnSync('pnpm', ['--filter', `@heyta/${p}`, 'build'], {
      cwd: ROOT,
      encoding: 'utf8',
      env: { ...process.env, NO_COLOR: '1' },
      maxBuffer: 64 * 1024 * 1024,
      timeout: 900_000,
    });
    if ((r.status ?? 1) !== 0) {
      console.log(`REBUILD_FAIL ${p}`);
      console.log(`${r.stdout ?? ''}${r.stderr ?? ''}`.slice(-1200));
      return false;
    }
  }
  return true;
}

const ARMS = [
  {
    name: 'MA1 补白格变成可点（点它 = 在邻月写一条记录）',
    rebuild: ['ui'],
    edits: [
      {
        file: UI_MONTH_MODEL,
        from: '  return cell.inMonth && isHabitDayTappable(cell.state);',
        to: '  return isHabitDayTappable(cell.state);',
      },
    ],
    expectTitles: ['U3', 'V4'],
  },
  {
    name: 'MA2 补白格的读数改用状态句子（会说"今天"却点不动）',
    rebuild: ['ui'],
    edits: [
      {
        file: UI_BOARD,
        from: `    cell.inMonth
      ? labels.day({ date: cell.date, state: cell.state })
      : labels.outOfMonth({ date: cell.date });`,
        to: `    labels.day({ date: cell.date, state: cell.state });`,
      },
    ],
    expectTitles: ['V4'],
  },
  {
    name: 'MA3 宿主按下时丢掉那一天（两端同时；补的打卡会记到今天）',
    rebuild: [],
    edits: [
      {
        file: WEB_CARD,
        from: 'run(habitId, store.checkIn(habitId, date));',
        to: 'run(habitId, store.checkIn(habitId));',
      },
      {
        file: MOBILE_SCREEN,
        from: 'runFor(habitId, actions.checkIn(habitId, date));',
        to: 'runFor(habitId, actions.checkIn(habitId));',
      },
    ],
    expectTitles: ['V11', 'X2'],
  },
  {
    name: 'MA4 默认窗口从推导改成拍死的 7 天（"只能补昨天"那条既有语义被换掉）',
    rebuild: ['domain'],
    edits: [
      {
        file: DOM_BACKFILL,
        from: 'export const BACKFILL_DEFAULT_WINDOW_DAYS = REPAIR_WINDOW_DAYS;',
        to: 'export const BACKFILL_DEFAULT_WINDOW_DAYS = 7;',
      },
    ],
    expectTitles: ['B1', 'B2', 'B3', 'B5', 'B9', 'U7', 'V6'],
    /* 🔴 期望红集是**现量读出来的**（第一趟只登记了 B1/U7/V6，跑出来多出 B2/B3/B5/B9）。
       那四条不是噪声，是这份默认值**承重的地方**：B9 是六档词表（窗口一宽，
       "前天"那档从 `too-old` 变成 `backfillable`，词表就少一档），其余三条各自钉着
       "窗口外不许写"。把这种臂的红集写窄了，下一次它多红一条就会被读成"打歪了"。 */
  },
  {
    name: 'MA5 格子不再声明"不能按"（既挡不住按下，也说不出为什么不能点）',
    rebuild: ['ui'],
    edits: [
      {
        file: UI_BOARD,
        from: '                  disabled={!interactive || busy}',
        to: '                  data-ma5="no-disabled"',
      },
    ],
    // V5 钉"说得出不能点"，V4 钉"补白格那条声明在"—— 同一份坏两样都丢，所以两族都该红。
    expectTitles: ['V4', 'V5'],
  },
];

const FILES = [...new Set(ARMS.flatMap((a) => a.edits.map((e) => e.file)))];
const INITIAL = new Map(FILES.map((f) => [f, read(f)]));
const BASELINE = new Map(FILES.map((f) => [f, md5(read(f))]));

/** 复原到**最初**内容（不是"反向替换"：同一文件被两臂改过时，反向替换会留下残迹）。 */
function restore() {
  for (const f of FILES) {
    if (read(f) !== INITIAL.get(f)) writeFileSync(path.join(ROOT, f), INITIAL.get(f), 'utf8');
  }
}

const clean = () => FILES.every((f) => md5(read(f)) === BASELINE.get(f));

console.log(`ARMS=${ARMS.length}（臂数由本臂台自己打印，别抄进任何文档）`);
let survivors = 0;
let broken = 0;

for (const [index, arm] of ARMS.entries()) {
  console.log(`\n=== 臂 ${index + 1}/${ARMS.length}：${arm.name} ===`);
  const before = arm.rebuild.map((p) => distDigest(p));
  try {
    for (const edit of arm.edits) {
      const src = read(edit.file);
      if (!src.includes(edit.from)) {
        console.log(`PROBE_BROKEN 锚点没找到：${edit.file}\n  锚点：${edit.from.slice(0, 90)}`);
        broken += 1;
        throw new Error('anchor-missing');
      }
      writeFileSync(path.join(ROOT, edit.file), src.replace(edit.from, edit.to), 'utf8');
    }
    if (arm.rebuild.length > 0) {
      if (!rebuild(arm.rebuild)) {
        console.log('PROBE_BROKEN 重打失败 —— 这条臂的读数不作数');
        broken += 1;
        continue;
      }
      if (arm.rebuild.map((p) => distDigest(p)).join('|') === before.join('|')) {
        console.log('PROBE_BROKEN 注入没进产物（整包 dist 摘要没变）—— 这条臂的读数不作数');
        broken += 1;
        continue;
      }
    }
    const run = runAll();
    if (run.bailed) {
      console.log('PROBE_BROKEN 内存闸门拒绝了 vitest —— 不记成判据红');
      broken += 1;
      continue;
    }
    const got = run.titles;
    const want = arm.expectTitles.slice().sort();
    const missing = want.filter((x) => !got.includes(x));
    const extra = got.filter((x) => !want.includes(x));
    if (got.length === 0) {
      survivors += 1;
      console.log('存活（一条都没红）⇒ 这批判据对这份坏**没有牙**');
    } else if (missing.length > 0) {
      survivors += 1;
      console.log(`部分存活：少了 ${missing.join(' , ')}`);
    } else {
      console.log(`红：${got.join(' , ')}`);
    }
    if (extra.length > 0) {
      console.log(`（超期望的红：${extra.join(' , ')} —— 这一臂打到了别的判据）`);
    }
    for (const { key, res } of run.per) {
      console.log(`  ${key}: ${res.line || '(没有 Tests 汇总行)'} rc=${res.rc}`);
    }
  } catch {
    /* 锚点没找到：不记成判据红，也不跑这一臂。 */
  } finally {
    restore();
    if (arm.rebuild.length > 0) rebuild(arm.rebuild);
    if (!clean()) {
      console.log('RESTORE_FAIL —— 有源文件没回到原样，本臂台后续的读数不可信');
    }
  }
}

const ok = survivors === 0 && broken === 0 && clean();
console.log(
  `\n结论：臂 ${ARMS.length} 份，全红 ${ARMS.length - survivors - broken}，` +
    `存活 ${survivors}，探针无效 ${broken}`,
);
console.log(`BACK_TO_CLEAN=${clean()}`);
process.exit(ok ? 0 : 1);
