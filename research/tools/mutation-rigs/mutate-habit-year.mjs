#!/usr/bin/env node
/**
 * 习惯年视图（工单 H7）的判据臂台。
 *
 * 要回答的问题：`packages/domain/tests/habit-year.spec.ts`（Y1–Y8）、
 * `apps/web/tests/habit-trend-board.spec.tsx`（Z1–Z8）、
 * `apps/web/tests/habit-month-board.spec.tsx`（V 组，作为"这一臂有没有打歪"的对照）、
 * `apps/mobile/tests/habit-trend-entry.spec.ts`（N 组）这四族是不是仪式。
 *
 * 六份坏，按**层**注入：
 *
 *   YA1 年率拿 `ΣachievedDays / ΣscheduledDays`（档期外那天进了分子）  ⇒ Y5
 *   YA2 未来那几个月不再短路，直接算（界面把"还没到"说成"这个月的数"）  ⇒ Y2 Y5 Y7 + Z5 Z7
 *   YA3 点一张年卡只翻游标、不换档                                    ⇒ Z2
 *   YA4 月历拿到的是 `today` 而不是容器那枚游标（两档各一枚）           ⇒ V12 Z2 Z3
 *   YA5 未来那张卡画 0%（不说"还没到"）                                ⇒ Z5 Z7
 *   YA6 年那一档忽略 `year`、自己按 `today` 取年（标题与卡各讲一个故事）⇒ Z8
 *
 * 🔴 期望红集是**逐臂点名**的，不是"有红就行"：少了 = 判据没牙，
 *    多了 = 这一臂同时打到了别的判据，"这条臂证的是哪一档"就说不清。
 *
 * ⚠️ **为什么要 rebuild**：`apps/web` 那一族吃的是 `@heyta/ui` / `@heyta/domain` 的
 *    **dist**（package exports）。改 src 不重打就是"注入根本没进产物"，读数是**假绿**
 *    （§7 第 27 条）。`packages/*` 自己的 spec 吃 **src**，不需要重打。
 * ⚠️ "进没进产物"不看臂注释：构建会把注释剥掉，所以判据是**整包 dist 摘要变了没有**。
 * ⚠️ 注入用**分文件累加 + 落盘后逐字节复核**那套（§7 第 322 条：同一文件被一条臂改两处时，
 *    各自从"最初那份"起算整写会让除最后一条外全部静默失效，而读数长得像"判据没牙"）。
 *
 * 跑法（仓库根）：node research/tools/mutation-rigs/mutate-habit-year.mjs
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const ROOT = process.cwd();
const DOM_YEAR = 'packages/domain/src/habit-year.ts';
const UI_YEAR_BOARD = 'packages/ui/src/habits/HabitYearBoard.tsx';
const UI_TREND = 'packages/ui/src/habits/HabitTrendBoard.tsx';

const md5 = (s) => createHash('md5').update(s).digest('hex');
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');

/** 整包 `dist/` 的摘要（路径 + 内容）—— 用来回答"注入到底进产物了没有"。 */
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
  { key: 'domain', cwd: 'packages/domain', specs: ['tests/habit-year.spec.ts'] },
  { key: 'ui', cwd: 'packages/ui', specs: ['tests/habit-month-model.spec.ts'] },
  { key: 'web', cwd: 'apps/web', specs: ['tests/habit-trend-board.spec.tsx', 'tests/habit-month-board.spec.tsx'] },
  { key: 'mobile', cwd: 'apps/mobile', specs: ['tests/habit-trend-entry.spec.ts'] },
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
    titles: [...new Set([...out.matchAll(/^[ \t]*×\s+([UZVYN]\d+)/gm)].map((x) => x[1]))],
    excerpt: out
      .split('\n')
      .filter((l) => /FAIL |AssertionError/.test(l))
      .slice(0, 8)
      .join('\n'),
  };
}

/** 四族各跑一遍，红集取**并集**（标题前缀 U/V/Y/Z/N 自带归属）。 */
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
    name: 'YA1 年率拿 ΣachievedDays / ΣscheduledDays（档期外那天进了分子）',
    rebuild: ['domain', 'ui'],
    edits: [
      {
        file: DOM_YEAR,
        from: '    rate: scheduledDays === 0 ? 0 : achievedDue / scheduledDays,',
        to: '    rate: scheduledDays === 0 ? 0 : achievedDays / scheduledDays,',
      },
    ],
    /* 🔴 只有 Y5 会红，而这不是巧合：Y6 那份合成行的 `achievedDays` 与它的分子**本来就相等**
       （1/1 与 0/29），所以 Y6 挡不住这一份坏。能把它们分开的只有"档期外还打了一天"那个形状，
       也就是 Y5。少一条 Y6 不算漏 —— 两族钉的是两把不同的尺。 */
    expectTitles: ['Y5'],
  },
  {
    name: 'YA2 未来那几个月不再短路（把"还没到"算成"这个月的数"）',
    rebuild: ['domain', 'ui'],
    edits: [
      {
        file: DOM_YEAR,
        from: '    if (monthKey > today.slice(0, 7)) {',
        to: "    if (monthKey > '9999-99') {",
      },
    ],
    expectTitles: ['Y2', 'Y5', 'Y7', 'Z5', 'Z7'],
  },
  {
    name: 'YA3 点一张年卡只翻游标、不换档（去了没去处）',
    rebuild: ['ui'],
    edits: [
      {
        file: UI_TREND,
        from: "            setState({ id: habit.id, view: 'month', cursor: firstOfMonthKey(monthKey) });",
        to: '            setState({ id: habit.id, view, cursor: firstOfMonthKey(monthKey) });',
      },
    ],
    expectTitles: ['Z2'],
  },
  {
    name: 'YA4 月历拿到的是 `today` 而不是容器那枚游标（等于两档各存一枚）',
    rebuild: ['ui'],
    edits: [
      { file: UI_TREND, from: '          month={cursor}', to: '          month={today}' },
    ],
    expectTitles: ['V12', 'Z2', 'Z3'],
    /* 🔴 `V12` 是**现量读出来的**，不是事后放宽（与 `mutate-habit-month.mjs` 的 MA4 同一条理由）：
       这一臂改的正是 `month={cursor}` 那一行，而 V12 钉的就是容器把**自己那枚游标**交给月历
       （`month={cursor}` + `onMonthChange={` + `year={year}`，见 `habit-month-board.spec.tsx` V12）。
       把它写窄了，下一次它多红一条就会被读成"这一臂打歪了"。 */
  },
  {
    name: 'YA5 未来那张卡画 0%（"还没到"被说成"一次都没打"）',
    rebuild: ['ui'],
    edits: [
      {
        file: UI_YEAR_BOARD,
        from: '          const rateText = row.inFuture\n            ? labels.future',
        to: '          const rateText = row.inFuture\n            ? labels.rate(0)',
      },
    ],
    expectTitles: ['Z5', 'Z7'],
  },
  {
    name: 'YA6 年那一档忽略 `year`、自己按 `today` 取年（标题换了而卡没换）',
    rebuild: ['ui'],
    edits: [
      {
        file: UI_YEAR_BOARD,
        from: '    () => habitYearRows(habit, logs, today, year),',
        to: '    () => habitYearRows(habit, logs, today),',
      },
    ],
    /* 🔴 这一臂是 Z8 的**来处**：第一趟跑它的时候一条判据都没红 —— 标题走 `labels.yearTitle(year)`
       而卡走 `today` 那年，Z3/Z5 只查标题与禁用态，全都绿。那份坏（"标题写着 2025、卡还是 2026"）
       当时没有任何一层在守，于是把 Z8 按存在性补上（十二张卡一张一张点名）。 */
    expectTitles: ['Z8'],
  },
];

const FILES = [...new Set(ARMS.flatMap((a) => a.edits.map((e) => e.file)))];
const INITIAL = new Map(FILES.map((f) => [f, read(f)]));
const BASELINE = new Map(FILES.map((f) => [f, md5(read(f))]));

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
    // 分文件**累加**注入：同一文件被一条臂改两处时，后一处的锚点在"已落了前一处"的那份上数。
    const staged = new Map();
    for (const edit of arm.edits) {
      const text = staged.get(edit.file) ?? INITIAL.get(edit.file);
      const hits = text.split(edit.from).length - 1;
      if (hits !== 1) {
        console.log(
          `PROBE_BROKEN 锚点在 ${edit.file} 里命中 ${String(hits)} 次（必须恰好 1 次）—— 锚点漂了，注入会打空`,
        );
        broken += 1;
        throw new Error('anchor-missing');
      }
      staged.set(edit.file, text.replace(edit.from, edit.to));
    }
    for (const [rel, mutated] of staged) writeFileSync(path.join(ROOT, rel), mutated);
    // 落盘后**再核一次**：打空在这里就报，不留给读数去猜。
    for (const [rel, mutated] of staged) {
      if (read(rel) !== mutated) {
        console.log(`PROBE_BROKEN ${rel} 落盘后与注入文本不一致 —— 这一臂的读数不作数`);
        broken += 1;
        throw new Error('write-mismatch');
      }
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
      if (res.rc !== 0 && extra.length + missing.length > 0) {
        console.log(res.excerpt.split('\n').map((l) => `    ${l}`).join('\n'));
      }
    }
  } catch {
    /* 锚点/落盘问题：不记成判据红，也不跑这一臂。 */
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
