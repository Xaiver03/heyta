#!/usr/bin/env node
/**
 * 热力图月份标签跨列的判据臂台（工单 H8）。
 *
 * 要回答的问题：`packages/ui/tests/habits-model.spec.ts` 的 L1–L3（恒等式那一层）与
 * `e2e/tests/habit-heatmap-labels.spec.ts` 的 HL1–HL3（几何那一层）是不是重复。
 * 答案必须是"不是"，证明方式与 `mutate-habits-two-column.mjs` 同形：
 * **同一份坏，jsdom 那三条全绿、只有真浏览器那一条会红**。
 *
 * 三份坏，按"标签排布能被改坏的三个地方"注入：
 *
 *   HA1 去掉"至少两列宽"的下界（末列那枚退回一列宽）      ⇒ L3 + HL1
 *   HA2 组件把 `gap` 传成 0（宽度与实际排布脱钩）           ⇒ HL2 ｜🔴 jsdom **全盲**
 *   HA3 每一列都打月份标签（不再只在"月份变了"那一列打）    ⇒ L4 + HL2
 *
 * 🔴 期望红集逐臂点名，三臂互不相同。**HA2 是这台臂台存在的理由**：
 *   它让 jsdom 那四条（L1–L4）一条都不红，而真浏览器那条红 —— 这一族不是恒等式那一层的重复。
 *   HA1/HA3 两层都红，说明"下界"与"只在月份变那一列打"这两条承诺**同时**被两层守着，
 *   少一层另一层还在，不是冗余。
 *
 * ⚠️ **为什么要 rebuild**：e2e 那一腿吃的是 `apps/web/dist`（`vite preview` 的载体），
 *    而 `HabitBoard.tsx` / `model.ts` 在 `@heyta/ui` 里 ⇒ 不重打 ui 与 web 就是"注入根本没进产物"，
 *    读数是**假绿**（§7 第 27 条）。判据用**整包 dist 摘要变了没有**，不看臂注释
 *    （构建会把注释剥掉，§7 第 273 条同一族）。
 * ⚠️ 注入用**分文件累加 + 落盘后逐字节复核**（§7 第 322 条：同一文件被一条臂改两处时，
 *    各自从"最初那份"整写会让除最后一条外全部静默失效，而读数长得像"判据没牙"）。
 * ⚠️ 它会原地改源文件，每臂收尾复原并核对 md5；4371 端口没空出来时**响亮失败且不去 kill**。
 *
 * 跑法（仓库根）：node research/tools/mutation-rigs/mutate-habit-heatmap-labels.mjs
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const ROOT = process.cwd();
const BOARD = 'packages/ui/src/habits/HabitBoard.tsx';
const MODEL = 'packages/ui/src/habits/model.ts';
/** jsdom 那一腿跑的是 `@heyta/ui` **自己的** spec（吃 src，不需要重打）。 */
const JSDOM_SPEC = 'tests/habits-model.spec.ts';
const E2E_SPEC = 'tests/habit-heatmap-labels.spec.ts';
const BIN = (pkg, rel) => path.join(ROOT, pkg, 'node_modules', '.bin', rel);
const md5 = (s) => createHash('md5').update(s).digest('hex');
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');

/** 跨列宽度的那一行（三份坏都从这里或它的上游动手）。 */
const WIDTH_FLOOR_ANCHOR = '    span === 0 ? 0 : Math.max(floor, span * cell + (span - 1) * gap),';
const GAP_ARG_ANCHOR = "const labelWidths = heatMonthLabelWidths(weeks, tokens['icon.xs'], tokens['space.1']);";
const MONTH_MARK_ANCHOR = "    if (month === lastMonth) return { days: column, month: undefined };";

const ARMS = [
  {
    name: 'HA1 去掉"至少两列宽"的下界（窗口末列那枚标签退回一列宽 = 折行）',
    edits: [
      {
        file: MODEL,
        from: WIDTH_FLOOR_ANCHOR,
        to: '    span === 0 ? 0 : span * cell + (span - 1) * gap,',
      },
    ],
    expectTitles: ['L3', 'HL1'],
  },
  {
    name: 'HA2 🔴 组件传 gap=0（宽度算得对、排布走的是另一套）⇒ 只有真浏览器看得见',
    edits: [
      {
        file: BOARD,
        from: GAP_ARG_ANCHOR,
        to: "const labelWidths = heatMonthLabelWidths(weeks, tokens['icon.xs'], 0);",
      },
    ],
    expectTitles: ['HL2'],
  },
  {
    name: 'HA3 每一列都打月份标签（不再只在"月份变了"那一列打）',
    edits: [{ file: MODEL, from: MONTH_MARK_ANCHOR, to: '    // MUTATION-ARM HA3：一列都不落' }],
    expectTitles: ['L4', 'HL2'],
  },
];

const FILES = [...new Set(ARMS.flatMap((a) => a.edits.map((e) => e.file)))];
const INITIAL = new Map(FILES.map((f) => [f, read(f)]));
const BASELINE = new Map(FILES.map((f) => [f, md5(read(f))]));

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

function run(cmd, args, cwd) {
  const r = spawnSync(cmd, args, {
    cwd: path.join(ROOT, cwd),
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' },
    maxBuffer: 128 * 1024 * 1024,
    timeout: 900_000,
  });
  return { rc: r.status ?? 1, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

const tallyVitest = (out) => {
  const line = (out.match(/^[ \t]*Tests[ \t].*$/m) || [''])[0];
  const passed = Number(/(\d+) passed/.exec(line)?.[1] ?? -1);
  const failedHit = /(\d+) failed/.exec(line);
  return {
    line: line.trim(),
    passed,
    /* 🔴 汇总行里**没有** `failed` 有两种情况，必须分开：
       ① 数到了 `passed` 却没有 `failed` —— vitest 全过时就是不印那一截，这是**真的 0**；
       ② 连 `passed` 都没有 —— 汇总行没解析到，那是**探针读不到**，不许当成 0
          （读不到会被下游误播成"零失败"，这条教训就写在本仓 i18n 那张表的注释里）。 */
    failed: failedHit ? Number(failedHit[1]) : passed >= 0 ? 0 : -1,
  };
};

/** Playwright 的汇总行行首没有 `Tests` 这个词 ⇒ 不能与 vitest 共用一个正则。 */
const tallyPlaywright = (out) => {
  const grab = (word) => {
    const hits = [...out.matchAll(new RegExp(`^[ \\t]*(\\d+) ${word}(?:[ \\t(]|$)`, 'gm'))];
    return hits.length === 0 ? -1 : Number(hits[hits.length - 1][1]);
  };
  const passed = grab('passed');
  const failedHit = grab('failed');
  /* 与上面 vitest 那条同一分工：数到 passed 而没有 failed 段 = 全过 = 0；
     两个都数不到 = 探针读不到，保持 -1 让它响亮地失败。 */
  const failed = failedHit >= 0 ? failedHit : passed >= 0 ? 0 : -1;
  return { passed, failed, line: `passed=${String(passed)} failed=${String(failed)}` };
};

/** 红集：`HL1 …` / `L1 …` 这样的标题前缀（两条腿共用一张前缀表）。 */
const titles = (out) =>
  [...new Set(
    out
      .split('\n')
      .filter((line) => /^[ \t]*[×✕]/.test(line))
      .map((line) => /(?:^|[\s>›])(HL\d+|L\d+)(?![\w-])/.exec(line)?.[1])
      .filter(Boolean),
  )];
/* 🔴 第三枚探针 bug（前两枚见 `waitPortFree` 与两个 tally）：原来那条正则要求
   `[×✕]` 后面**紧跟**"文件名(行:列)"，而 Playwright 真实打出来的是
   `  ✘  1 [chromium] › tests/x.spec.ts:90:3 › … › HL1 …` —— 中间那截 `[chromium] › 路径` 它不认，
   于是 e2e 腿的红集**永远为空**，臂台把"HL1 真的红了"读成"部分存活：少了 HL1"。
   这是最坏的一种假信号：它指控的是"判据没牙"，而判据其实正在生效。
   现在改成"在失败行里找第一个 `HL?\d+` 词元"，两条腿共用一套，不再猜前缀的形状。 */

function rebuild() {
  for (const pkg of ['ui', 'web']) {
    const r = run('pnpm', ['--filter', `@heyta/${pkg}`, 'build'], '.');
    if (r.rc !== 0) {
      console.log(`REBUILD_FAIL ${pkg}\n${r.out.slice(-1200)}`);
      return false;
    }
  }
  return true;
}

function waitPortFree(port = 4371, budgetMs = 60_000) {
  const deadline = Date.now() + budgetMs;
  for (;;) {
    const r = spawnSync('lsof', ['-nP', `-iTCP:${String(port)}`, '-sTCP:LISTEN', '-t'], { encoding: 'utf8' });
    const pids = (r.stdout ?? '').trim().split('\n').filter(Boolean);
    /* 🔴 `return;`（undefined）会被调用方那句 `if (!waitPortFree()) return null` 读成"端口没释放"，
       于是**干净态永远跑不成**，臂台每一臂都停在 `BASELINE_BROKEN` —— 探针坏得恰好伪装成"环境不配合"。
       §7 元规则 1（先怀疑探针）在这一臂上是指我自己写的这台装置。 */
    if (pids.length === 0) return true;
    if (Date.now() > deadline) {
      const who = spawnSync('ps', ['-o', 'command=', '-p', pids[0] ?? '0'], { encoding: 'utf8' }).stdout.trim();
      console.log(
        `PROBE_BROKEN ${String(port)} 端口在 ${String(budgetMs / 1000)}s 内没释放，持有者 pid=${pids[0]}：${who.slice(0, 160)}`,
      );
      return false;
    }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000);
  }
}

function runBothLegs() {
  const jsdom = run(BIN('packages/ui', 'vitest'), ['run', JSDOM_SPEC], 'packages/ui');
  if (!waitPortFree()) return null;
  const e2e = run(BIN('e2e', 'playwright'), ['test', '-c', 'playwright.detail-pane.config.ts', E2E_SPEC], 'e2e');
  return {
    jsdom: { ...tallyVitest(jsdom.out), rc: jsdom.rc, out: jsdom.out, titles: titles(jsdom.out) },
    e2e: { ...tallyPlaywright(e2e.out), rc: e2e.rc, out: e2e.out, titles: titles(e2e.out) },
  };
}

const restore = () => {
  for (const f of FILES) {
    if (read(f) !== INITIAL.get(f)) writeFileSync(path.join(ROOT, f), INITIAL.get(f), 'utf8');
  }
};
const clean = () => FILES.every((f) => md5(read(f)) === BASELINE.get(f));

console.log(`ARMS=${ARMS.length}（臂数由本臂台自己打印，别抄进任何文档）`);

/* 基线：干净态必须两腿都绿，否则后面所有"红集"都无从归属。 */
if (!rebuild()) process.exit(1);
const base = runBothLegs();
if (base === null) {
  console.log('BASELINE_BROKEN 干净态没跑成（端口/构建），不记成判据红');
  process.exit(1);
}
if (base.jsdom.failed !== 0 || base.e2e.failed !== 0 || base.e2e.passed < 3) {
  console.log(`BASELINE_DIRTY jsdom=${base.jsdom.line}｜e2e=${base.e2e.line}`);
  process.exit(1);
}
console.log(`基线：jsdom=${base.jsdom.line}｜e2e=${base.e2e.line}`);

let survivors = 0;
let broken = 0;
for (const [index, arm] of ARMS.entries()) {
  console.log(`\n=== 臂 ${index + 1}/${ARMS.length}：${arm.name} ===`);
  const before = ['ui', 'web'].map((p) => distDigest(p)).join('|');
  try {
    for (const edit of arm.edits) {
      const src = read(edit.file);
      const hits = src.split(edit.from).length - 1;
      if (hits !== 1) {
        console.log(`PROBE_BROKEN 锚点在 ${edit.file} 命中 ${String(hits)} 次（必须恰好 1 次）`);
        broken += 1;
        throw new Error('anchor');
      }
      writeFileSync(path.join(ROOT, edit.file), src.replace(edit.from, edit.to), 'utf8');
      if (!read(edit.file).includes(edit.to)) {
        console.log(`PROBE_BROKEN 落盘后逐字节复核失败：${edit.file}`);
        broken += 1;
        throw new Error('verify');
      }
    }
    if (!rebuild()) {
      console.log('PROBE_BROKEN 变异态打不出包');
      broken += 1;
      continue;
    }
    if (['ui', 'web'].map((p) => distDigest(p)).join('|') === before) {
      console.log('PROBE_BROKEN 注入没进产物（dist 摘要没变）');
      broken += 1;
      continue;
    }
    const run_ = runBothLegs();
    if (run_ === null) {
      console.log('PROBE_BROKEN 载体没空出来');
      broken += 1;
      continue;
    }
    const got = [...new Set([...run_.jsdom.titles, ...run_.e2e.titles])].sort();
    const want = arm.expectTitles.slice().sort();
    const missing = want.filter((x) => !got.includes(x));
    const extra = got.filter((x) => !want.includes(x));
    if (got.length === 0) {
      survivors += 1;
      console.log('存活（一条都没红）⇒ 这批判据对这份坏没有牙');
    } else if (missing.length > 0) {
      survivors += 1;
      console.log(`部分存活：少了 ${missing.join(' , ')}`);
    } else {
      console.log(`红：${got.join(' , ')}`);
    }
    if (extra.length > 0) console.log(`（超期望的红：${extra.join(' , ')}）`);
    console.log(`  jsdom: ${run_.jsdom.line} rc=${run_.jsdom.rc} 红集=${run_.jsdom.titles.join(',') || '(空)'}`);
    console.log(`  e2e  : ${run_.e2e.line} rc=${run_.e2e.rc} 红集=${run_.e2e.titles.join(',') || '(空)'}`);
  } catch {
    /* 锚点/复核失败：不记成判据红，也不跑这一臂。 */
  } finally {
    restore();
    rebuild();
    if (!clean()) console.log('RESTORE_FAIL —— 有源文件没回到原样，后续读数不可信');
  }
}

const ok = survivors === 0 && broken === 0 && clean();
console.log(
  `\n结论：臂 ${ARMS.length} 份，全红 ${ARMS.length - survivors - broken}，存活 ${survivors}，探针无效 ${broken}`,
);
console.log(`BACK_TO_CLEAN=${clean()}`);
process.exit(ok ? 0 : 1);
