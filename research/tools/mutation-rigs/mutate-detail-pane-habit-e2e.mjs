#!/usr/bin/env node
/**
 * 习惯面单落点（工单 §8.133）的**真浏览器层**变异臂。
 *
 * 这一台要回答的问题只有一个：`e2e/tests/detail-pane-habit.spec.ts` 那 8 条
 * 是不是 `apps/web/tests/habits-detail-card.spec.tsx` 那 13 条的**重复**？
 * 答案是"不是"，证明方式与便签那一台（`mutate-detail-pane-note-editor-e2e.mjs`）同形：
 * 造**只有浏览器能看见**的坏，看 jsdom 那一层红不红。
 * E1/E2 来自 §8.133（落点与溢出），E3/E4 来自 §8.134（头行），E5 来自 §8.136（清单行右侧空白）。
 *
 *   E1 往栏里那条 CSS 里把板子 `display:none` 藏掉 ——
 *      用户在宽屏点习惯会看到"右边那一栏什么都没有"，而选中态已经进了模型。
 *   E2 把栏里的板子撑到 40rem（比那一栏的 22rem 宽）——
 *      板子/热力图出栏、右边被窗口切掉。这一份在 DOM 上什么都不缺。
 *
 * ⚠️ **E2 的第一版是打空的，而臂台把它抓出来了**（这一点值得留下）：那一版注入的是
 *    `.ht-app__detail-habit { min-width: 40rem }`，结果 e2e **5 条全绿**。原因不是产品好，
 *    是层叠：`habits.css` 里 `.ht-habit__pane { min-width: 0 }` 特异性相同，而
 *    `app.css` 的 `@import` 顺序是 base 在前、habits 在**后** ⇒ 后者赢，注入等于没注入。
 *    所以这一台的判据必须是"**产物里有没有这条规则**"+"**e2e 有没有为它红**"两条一起看，
 *    只看 `dist/` 摘要变了是不够的 —— 摘要变了而规则被吃掉，两腿读数一样无意义。
 *    现在 E2 打在板子本身（`.ht-app__detail-habit [data-testid="habit-board"]`）：
 *    特异性更高、也没有人跟它抢 `min-width`，而它表达的恰好就是本单担心的那一格
 *    （90 天热力图压在 22rem 的栏里）。
 *
 * 两腿都要成立才算数：
 *   腿 A（盲区）：变异态下 jsdom 那 11 条**一条都不红** —— 证明它看不见这一份坏；
 *   腿 B（有牙）：变异态下 e2e 的红集**逐条等于**该臂点名的那几条（`expectTitles`）——
 *      多一条少一条都判臂台不干净。E1/E2 各点名 5 条与 2 条，E3/E4 点名 2 条与 1 条。
 *
 * ⚠️ 刻意**没有**第三条臂："面单走了、`.ht-habit` 留一根 5fr 空轨道"这一份坏
 *    两层都抓得到（jsdom 的 R4 读 CSS 源码形状，浏览器的 H1 读 CSSOM 计算值），
 *    把它放进来会得到"腿 A 不成立"，而那不是 e2e 层的问题。臂台只登记**能区分两层**的坏。
 *
 * 🔴 载体是 `vite preview` + `apps/web/dist`（见 `e2e/playwright.detail-pane.config.ts` 文件头），
 *    所以**每一臂都必须重打 `apps/web`** —— 上一轮 W1b 第一趟就是"改了源码没重建 ⇒
 *    被测的那一份里根本没有变异 ⇒ 判据被读成没有牙"（§7 第 27 条那一族）。
 *    这里用 `dist/` 的**内容摘要**而不是源文件 md5 来证明注入真的进了产物：
 *    源文件改了不等于产物变了（构建失败、缓存、打错目录都会）。
 *
 * 跑法（仓库根）：node research/tools/mutation-rigs/mutate-detail-pane-habit-e2e.mjs
 * ⚠️ 它会占 4371 端口、起 Chromium，且会**原地改工作树里的 base.css**（收尾复原并核对 md5）。
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const ROOT = process.cwd();
const CSS = 'apps/web/src/styles/app/base.css';
const JSDOM_SPEC = 'tests/habits-detail-card.spec.tsx';
const E2E_SPEC = 'tests/detail-pane-habit.spec.ts';
const BIN = (rel) => path.join(ROOT, 'apps/web', 'node_modules', '.bin', rel);

/** 两份注入都**只针对栏里那一支**，回落那一支一行字节都不动。 */
const ARMS = [
  {
    name: 'E1 栏里的板子被 CSS 藏掉（界面不说、模型已变）',
    // 🔴 每臂带一枚**只有自己会写进产物**的自定义属性当标记：产物摘要变了不等于
    //    "这一条规则活着到了产物里"（E2 的第一版就是被层叠吃掉的，见文件头）。
    marker: '--dp-arm-e1',
    css: `
/* MUTATION-ARM E1（临时，本脚本收尾会删）：只藏栏里那块板。 */
.ht-app__detail-habit [data-testid="habit-board"] {
  --dp-arm-e1: 1;
  display: none;
}
`,
    /* 🔴 这一臂的红集**本来就是 5 条**，不是 §8.134 加出来的：藏掉栏里那块板，凡是
       "栏里那块板要画得出来"的判据都得红（H1 落点、H3 跟随、H4 两支都真会走、H5 热力图、
       H7 头行与卡片的间隙量不到卡片）。旧版只要求 `some(H1)`，把这件事藏在了读数里；
       现在"红集逐条等于点名那几条"，多一条少一条都算臂台不干净。 */
    expectTitles: ['H1', 'H3', 'H4', 'H5', 'H7'],
  },
  {
    name: 'E2 栏里的板子被撑到比那一栏宽（板子出栏、右边被窗口切）',
    // 打在板子上而不是面单壳上：见文件头那条层叠事故。
    marker: '--dp-arm-e2',
    css: `
/* MUTATION-ARM E2（临时，本脚本收尾会删）：栏里那块板撑破 22rem 那一栏。 */
.ht-app__detail-habit [data-testid="habit-board"] {
  --dp-arm-e2: 1;
  min-width: 40rem;
}
`,
    // 两条：H1 量的是"板子里的控件不许贴住窗口边"，H5 量的是"每一枚热力图格子不许出栏"。
    expectTitles: ['H1', 'H5'],
  },
  /* ── E3/E4：头行（工单 §8.134）───────────────────────────────────
     两臂都打在**栏里那一支**（选择器带 `.ht-app__detail-habit`），回落那一支一行字节不动。
     🔴 选择器必须比 `habits.css` 里那条**更具体**：本台上一次事故（E2 第一版）就是
     注入被后导入的等特异性规则吃掉，臂打空却"看起来绿"。

     E3 = §8.133 看图那一处的**原形状**：工具浮出头行、跑到栏顶外面（那里正是页头的高度）。
     E4 = 只把工具挪到标题**下面一行**：它仍在头行盒子里、仍贴着卡片，
          所以只有"与名字同一行"那一条该红 —— 两臂红集不同，才证明 H6/H7 是两条判据而不是一条。 */
  {
    name: 'E3 工具浮出头行、跑到栏顶之外（读起来像页头的工具条）',
    marker: '--dp-arm-e3',
    css: `
/* MUTATION-ARM E3（临时，本脚本收尾会删）：让工具脱离头行、浮到栏顶之上。 */
.ht-app__detail-habit .ht-habit__pane-head {
  position: relative;
}
.ht-app__detail-habit .ht-habit__pane-tools {
  --dp-arm-e3: 1;
  position: absolute;
  top: -3rem;
  right: 0;
}
`,
    expectTitles: ['H6', 'H7'],
    expectMessage: /工具不在同一行|工具跑出头行盒子/,
  },
  {
    name: 'E4 工具掉到标题下面单独一行（有名字，但那一排又和名字脱开）',
    marker: '--dp-arm-e4',
    css: `
/* MUTATION-ARM E4（临时，本脚本收尾会删）：头行换行，工具自成一行。 */
.ht-app__detail-habit .ht-habit__pane-head {
  flex-wrap: wrap;
}
.ht-app__detail-habit .ht-habit__pane-tools {
  --dp-arm-e4: 1;
  width: 100%;
}
`,
    expectTitles: ['H6'],
    expectMessage: /工具不在同一行/,
  },
  /* E5 = §8.136 那一处（清单行拉宽到整列之后，三个数字全贴左、行右侧空出 690px）。
     注入的就是**改前的形状**：把数字挪回左列、点阵下面那一行。
     🔴 选择器带三枚类：`habits.css` 里那条只有 1 枚，而 `base.css`（本文件的宿主）在它**前面**
        被导入 —— 等特异性会被后导入的赢（E2 第一版就是这么打空的）。 */
  {
    name: 'E5 三个数字挪回左列（行右侧又空出一大片，§8.133 看图第 ② 条的形状）',
    marker: '--dp-arm-e5',
    css: `
/* MUTATION-ARM E5（临时，本脚本收尾会删）：数字回到左列、点阵下面那一行。 */
.ht-habit__list .ht-habit__row .ht-habit__chips {
  --dp-arm-e5: 1;
  grid-column: 1;
  grid-row: 3;
  justify-self: start;
}
`,
    expectTitles: ['H8'],
    expectMessage: /右侧空了|内容全贴左/,
  },
];

const orig = readFileSync(path.join(ROOT, CSS), 'utf8');
const origMd5 = createHash('md5').update(orig).digest('hex');
const md5 = () => createHash('md5').update(readFileSync(path.join(ROOT, CSS))).digest('hex');

const run = (cmd, args, cwd) => {
  const r = spawnSync(cmd, args, {
    cwd: path.join(ROOT, cwd),
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' },
    maxBuffer: 128 * 1024 * 1024,
  });
  return { rc: r.status ?? 1, out: `${r.stdout || ''}${r.stderr || ''}` };
};

/**
 * vitest 与 Playwright 的汇总行**不能共用一个正则**（第一版在这里踩过：
 * Playwright 打的是 `  5 passed (4.0s)`，行首没有 `Tests` 这个词 ⇒ 永远读到 -1，
 * 于是"基线不干净"这条检查恒不成立 = 一条永远通过的基线，§7 元规则 2）。
 */
const tallyVitest = (out) => {
  const line = (out.match(/^[ \t]*Tests[ \t].*$/m) || [''])[0];
  return {
    line: line.trim(),
    passed: Number(/(\d+) passed/.exec(line)?.[1] ?? -1),
    failed: Number(/(\d+) failed/.exec(line)?.[1] ?? -1),
  };
};

const tallyPlaywright = (out) => {
  const grab = (word) => {
    const hits = [...out.matchAll(new RegExp(`^[ \\t]*(\\d+) ${word}(?:[ \\t(]|$)`, 'gm'))];
    return hits.length === 0 ? -1 : Number(hits[hits.length - 1][1]);
  };
  const passed = grab('passed');
  const failed = grab('failed');
  return { passed, failed, line: `passed=${String(passed)} failed=${String(failed)}` };
};

/** `dist/` 的内容摘要：证明注入真的进了**产物**，而不只是进了源码。 */
const distDigest = () => {
  const root = path.join(ROOT, 'apps/web/dist');
  const walk = (dir, prefix = '') => {
    const acc = [];
    for (const name of readdirSync(dir).sort()) {
      const full = path.join(dir, name);
      const rel = `${prefix}/${name}`;
      if (statSync(full).isDirectory()) acc.push(...walk(full, rel));
      else acc.push(`${rel}:${createHash('md5').update(readFileSync(full)).digest('hex')}`);
    }
    return acc;
  };
  return createHash('sha256').update(walk(root).join('|')).digest('hex').slice(0, 16);
};

const build = () => {
  const t = run(BIN('tsc'), ['-b'], 'apps/web');
  if (t.rc !== 0) return { rc: t.rc, out: `tsc -b 失败：\n${t.out.slice(-1200)}` };
  const v = run(BIN('vite'), ['build'], 'apps/web');
  return { rc: v.rc, out: v.out };
};

const jsdom = () => {
  const r = run(BIN('vitest'), ['run', JSDOM_SPEC], 'apps/web');
  return { ...tallyVitest(r.out), rc: r.rc, out: r.out };
};

const e2e = () => {
  const r = run(
    path.join(ROOT, 'e2e', 'node_modules', '.bin', 'playwright'),
    ['test', '-c', 'playwright.detail-pane.config.ts', E2E_SPEC],
    'e2e',
  );
  return { ...tallyPlaywright(r.out), rc: r.rc, out: r.out };
};

/** 产物里所有 CSS 拼起来（去空白）：用来确认**这一臂那条规则**真的到了产物。 */
const builtCss = () => {
  const dir = path.join(ROOT, 'apps/web/dist/assets');
  return readdirSync(dir)
    .filter((f) => f.endsWith('.css'))
    .map((f) => readFileSync(path.join(dir, f), 'utf8'))
    .join('')
    .replace(/\s+/g, '');
};

const restore = () => writeFileSync(path.join(ROOT, CSS), orig);

const fail = (msg) => {
  restore();
  console.log(`VERDICT=PROBE_BROKEN ${msg}`);
  process.exit(2);
};

const redTitles = (out) => [
  ...new Set(
    [...out.matchAll(/✘[^\n]*?›\s*(H\d[^\n]*?)\s*$/gm)].map((m) => (m[1] ?? '').trim().slice(0, 46)),
  ),
];

// ── 基线：两层都必须绿，否则臂台没有资格判红 ─────────────────────────
const b = build();
if (b.rc !== 0) fail(`干净态打不出包：\n${b.out.slice(-1200)}`);
const cleanDigest = distDigest();
const bj = jsdom();
if (bj.rc !== 0 || bj.passed < 13) fail(`干净态 jsdom 层不干净（要 >=13 passed）：${bj.line}`);
const be = e2e();
if (be.rc !== 0 || be.passed < 8 || be.failed > 0) {
  fail(`干净态 e2e 层不干净（要 >=8 passed / 0 failed）：${be.line}`);
}
console.log(`基线：jsdom=${bj.line}｜e2e=${be.line}｜dist=${cleanDigest}`);

let ok = 0;
const bad = [];
for (const arm of ARMS) {
  writeFileSync(path.join(ROOT, CSS), orig + arm.css);
  const mb = build();
  if (mb.rc !== 0) fail(`${arm.name}：变异态打不出包（注入不该导致构建失败）：\n${mb.out.slice(-800)}`);
  const mutatedDigest = distDigest();
  if (mutatedDigest === cleanDigest) {
    restore();
    fail(`${arm.name}：产物与干净态逐字节相同 ⇒ 注入没进 dist，两腿读数都无意义（§7 第 27 条那一族）`);
  }
  // 🔴 摘要变了**还不够**：要看的是"这一臂那一条规则"在不在产物里。
  // 在而 e2e 不红 = 判据真的没牙；不在（或被层叠吃掉）= 臂打空，两腿读数都是假的。
  if (!builtCss().includes(`${arm.marker}:1`)) {
    restore();
    fail(
      `${arm.name}：产物 CSS 里找不到 ${arm.marker} ⇒ 注入没有落到产物（构建没带上这条 / 选择器被压缩改写）。` +
        ` 这种臂会被读成"判据没牙"，而实际问题在臂自己（E2 第一版被 .ht-habit__pane 的 min-width 赢过层叠）`,
    );
  }

  const mj = jsdom();
  const me = e2e();
  const titles = redTitles(me.out);
  // Playwright/vitest 全绿时**不打** failed 那一行 ⇒ 读数是 -1，不是 0。按"没有失败"判：
  const blind = mj.failed <= 0 && mj.passed === bj.passed;
  /* 🔴 红集要**恰好**等于点名那几条：少了 = 判据没牙，多了 = 这一臂的坏同时打到了别的判据，
     那一条的"这条臂证的是哪一档"就说不清了。E3/E4 就是按这个标准分开的 ——
     两臂红集不同（H6+H7 / 只有 H6），才说明 H6 与 H7 是两条判据而不是一条的两句话。 */
  const expected = arm.expectTitles;
  const teeth =
    me.rc !== 0 &&
    me.failed === expected.length &&
    expected.every((p) => titles.some((t) => t.startsWith(p))) &&
    titles.every((t) => expected.some((p) => t.startsWith(p))) &&
    // 红的必须是"落点/真实几何"这一族，而不是别的东西（比如载体没起来）。
    (arm.expectMessage ?? /expected: visible|toBeVisible|界面上找不到这个元素|面单不在|溢出|画不出来/i)
      .test(me.out);
  console.log(`── ${arm.name}`);
  console.log(`   腿 A 盲区（jsdom）：${mj.line} rc=${mj.rc} → ${blind ? '看不见（成立）' : '也抓到了（这一份坏不区分两层）'}`);
  console.log(
    `   腿 B 有牙（e2e）：${me.line} rc=${me.rc} 红集=${titles.join(' ｜ ') || '(解析不出标题 —— 先看 reporter 标记有没有变)'}`,
  );
  if (blind && teeth) ok += 1;
  else bad.push(arm.name);

  restore();
  if (md5() !== origMd5) fail(`${arm.name}：复原失败，base.css 与基线 md5 不同，必须手工核对`);
}

const rb = build();
if (rb.rc !== 0) fail(`复原后打不出包：\n${rb.out.slice(-800)}`);
if (distDigest() !== cleanDigest) fail('复原后产物摘要与基线不同 ⇒ 复原没落到产物上');
const rj = jsdom();
const re = e2e();
console.log(`复原：BACK_TO_CLEAN=true 复跑 jsdom=${rj.line}｜e2e=${re.line}`);

if (bad.length || rj.rc !== 0 || re.rc !== 0) {
  console.log(`RIG_RESULT=FAIL 未如预期=${bad.join(' | ') || '(无)'} 复原复跑绿=${rj.rc === 0 && re.rc === 0}`);
  process.exit(1);
}
console.log(
  `RIG_RESULT=${ok}/${ARMS.length}（每臂都是：jsdom 对这一份坏是盲的，e2e 层为它变红 ⇒ e2e 那一层不是重复）`,
);
