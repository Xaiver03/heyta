#!/usr/bin/env node
/**
 * 习惯清单两列卡片（工单 H1）与图标选择器那一排（工单 H3）的**真浏览器层**变异臂。
 *
 * 这台臂台要回答的问题只有一个：`e2e/tests/habits-two-column.spec.ts` 那 7 条
 * 是不是 `apps/web/tests/habits-list-pane.spec.tsx` 那 8 组的**重复**？
 * 答案必须是"不是"，证明方式与 `mutate-detail-pane-habits-e2e` 那一台同形：
 * **造只有浏览器能看见的坏，看 jsdom 那一层红不红。**
 *
 * 四份坏都是"布局坏了而 DOM 一行没动"那一族，jsdom 结构上看不见（它不做布局，
 * `boundingBox()` 恒为 0）：
 *
 *   N1 摘掉 `.ht-habit__side` 的 `container-type` ⇒ `@container` 那条**永不命中**，
 *      两列规则整条变成死代码。界面照样画得出来、照样"能用"，只是退回一条纵列。
 *   N2 `@container` 里那句 `repeat(2, minmax(0, 1fr))` 换成单轨 ——
 *      "改了名字没改布局"那一版实现（本单点名要防的形状）。
 *   N3 把三个数字整组搬回**左轨并左对齐** ⇒ 卡片右半边空着一大片。
 *      DOM 上三个数一个都不少、点位一个都不少，只有几何把它们的位置改了 ——
 *      这一份坏 jsdom 结构上看不见（它不做布局，`boundingBox()` 恒为 0）。
 *      ⚠️ 它前两版的形状（让名字不肯收缩）**打不出这一份坏**，原因写在臂的注释里。
 *
 * 两腿都要成立才算数：
 *   腿 A（盲区）：变异态下 jsdom 那一层**一条都不红**；
 *   腿 B（有牙）：变异态下 e2e 的红集**逐条等于**该臂点名的那几条（多了少了都判不干净）。
 *
 * ⚠️ 载体是 `vite preview` + `apps/web/dist`（见 `e2e/playwright.detail-pane.config.ts` 文件头），
 *    所以**每一臂都必须重打 `apps/web`** —— 改了源码没重建 ⇒ 被测的那一份里根本没有变异，
 *    而判据会被读成"没牙"（§7 第 27 条那一族）。这里用 `dist/` 的**内容摘要** +
 *    **产物 CSS 里有没有这一臂那条标记属性**两条一起看：摘要变了不等于这条规则活着到了产物
 *    （同仓 E2 那一版就是被层叠吃掉、五条全绿的）。
 *
 * 跑法（仓库根）：node research/tools/mutation-rigs/mutate-habits-two-column.mjs
 * ⚠️ 它会占 detail-pane 那一族的端口、起 Chromium，且**原地改工作树里的 habits.css**
 *    （收尾复原并核对 md5）。同一时间不要并行跑别的 e2e，也**不要在它跑着的时候编辑
 *    `habits.css`** —— 收尾那次 `restore()` 写回的是**开跑前**那份快照，
 *    会把期间对同一个文件的任何编辑整个盖掉（同 §7 第 82 条"远端字节==本地工作树"那一族）。
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const ROOT = process.cwd();
const CSS = 'apps/web/src/styles/app/habits.css';
const JSDOM_SPEC = 'tests/habits-list-pane.spec.tsx';
/* 🔴 e2e 腿一次跑**两份** spec：这一族共用同一枚 `habits.css`、同一个
   `vite preview` 载体，而 N4 打的是图标选择器那一条几何判据。分开起两次载体
   要多花两倍的时间等端口，红集却不会因此更清楚 —— 判据的"恰好等于点名那几条"
   是拿标题前缀比的（`T*` = 两列那一族，`I*` = 图标那一族）。 */
const E2E_SPECS = ['tests/habits-two-column.spec.ts', 'tests/habit-icon-picker.spec.ts'];
const BIN = (rel) => path.join(ROOT, 'apps/web', 'node_modules', '.bin', rel);

/** `from` 必须**恰好命中一次**（命中 0 次 = 臂打空，命中 2 次 = 改到了不该改的地方）。 */
const ARMS = [
  {
    name: 'N1 摘掉容器声明（两列规则整条永不命中）',
    kind: 'append',
    marker: '--h1-arm-n1',
    css: `
/* MUTATION-ARM N1（临时，本脚本收尾会删）：把清单那一列的容器化关掉。 */
.ht-habit__side {
  --h1-arm-n1: 1;
  container-type: normal;
}
`,
    expectTitles: ['T2', 'T3', 'T7'],
    expectMessage: /列轨道不是两根|不在同一排|y 差了/,
  },
  {
    name: 'N2 只改名字不改布局（@container 里换成单轨）',
    kind: 'replace',
    from: 'grid-template-columns: repeat(2, minmax(0, 1fr));',
    to: 'grid-template-columns: minmax(0, 1fr);\n    --h1-arm-n2: 1;',
    marker: '--h1-arm-n2',
    expectTitles: ['T2', 'T3', 'T7'],
    expectMessage: /列轨道不是两根|不在同一排|y 差了/,
  },
  {
    name: 'N3 数字不再贴卡片右边界（两列把行的视觉重心推回左边）',
    kind: 'append',
    marker: '--h1-arm-n3',
    /* 🔴 这一臂**改过两次形状**，两次打空都是臂自己的错，不是 T5 没牙：
       ① 第一版注入 `.ht-habit__name { min-width: max-content }`：那一行是
          `grid-template-columns: minmax(0, 1fr) auto`，第一根被 `1fr` 封顶，
          名字撑开只会**盖到**数字上面，不会把 `auto` 那根推出去。
       ② 第二版改在轨道本身（`max-content auto`），仍然全绿 —— 因为 `auto` 轨道的
          **基数是 min-content**（growth limit 才是 max-content），轨道总宽超出容器时
          网格**不收缩**、而是让 `auto` 那根停在 min-content；于是三枚数字（min-content
          只有几十像素）照样落在卡片里，多的那份宽度从 `justify-self: end` 那侧**往左**溢出。
          也就是说"数字被挤出右边界"这个形状在当前 DOM 里**根本造不出来**。
       ⇒ 现在打的是这个 DOM 里真实存在的坏：把数字整组搬回左轨并左对齐。
          §8.133 看图第②条记录过它原来的形态（"选中那一行右侧空了 690px / 行的视觉重心
          跟着漂"），而 H1 把卡片砍成半宽，正是这份坏最容易重新长回来的时机 ——
          单列那版由 `mutate-detail-pane-habit-e2e.mjs` 的 E5 守着，这一臂守两列这版。 */
    css: `
/* MUTATION-ARM N3（临时，本脚本收尾会删）：把三个数字搬回左轨、左对齐。 */
.ht-habit__list .ht-habit__chips {
  --h1-arm-n3: 1;
  grid-column: 1;
  justify-self: start;
}
`,
    expectTitles: ['T5'],
    expectMessage: /卡片右侧空着一大片|溢出卡片右边界|压成 0 宽/,
  },
  {
    /* 🔴 这一臂是**看图看出来的那条缺陷**的牙（工单 H3，2026-10-06 02:0x）：
       图标选择器展开那一排原来按内容撑开，第 8 个字形被视口右边缘裁掉、
       「默认」那一格完全看不见，而 `toBeVisible()` 五条判据全绿。
       现在它是定宽 4 列网格，所以"撑开"这一份坏要**显式造**：把轨道数改成 9
       （= 八个字形 + 默认那一格全挤一排）—— 这正是修之前那个形状。
       它打的是 `I6` 那一条**几何**判据；同一排的存在性判据（`I1`：九格都在 DOM 里）
       对这一份坏**结构上不可能红**，因为格子一个都没少，只是看不见。 */
    name: 'N4 图标那一排不肯收缩（第 8 格与「默认」被推出视口）',
    kind: 'replace',
    from: 'grid-template-columns: repeat(4, var(--ht-touch-target-min));',
    to: 'grid-template-columns: repeat(9, var(--ht-touch-target-min));\n    --h1-arm-n4: 1;',
    marker: '--h1-arm-n4',
    expectTitles: ['I6'],
    expectMessage: /超出视口宽|超出窗格右边界|被推到视口左边外面/,
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
    timeout: 900_000,
  });
  return { rc: r.status ?? 1, out: `${r.stdout || ''}${r.stderr || ''}` };
};

/**
 * vitest 与 Playwright 的汇总行**不能共用一个正则**（同仓那一台第一版在这里踩过：
 * Playwright 打的行首没有 `Tests` 这个词 ⇒ 永远读到 -1，"基线不干净"恒不成立 =
 * 一条永远通过的基线，§7 元规则 2）。
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

/**
 * 等 4371 上那个 `vite preview` 自己退出。
 *
 * 🔴 为什么需要这一手（本轮实测撞了两次）：Playwright 的 `webServer` 是**异步拆**的 ——
 *    CLI 打完汇总、进程已经返回给调用方之后，它起的 `vite preview` 还会多活十几到几十秒。
 *    于是"上一臂刚跑完、下一臂立刻起跑"必然撞上 `--strictPort`，
 *    报出来的是 `Error: http://127.0.0.1:4371 is already used` 而**一行用例都没跑**，
 *    汇总读数是 `passed=-1 failed=-1` —— 长得和"干净态不干净"一模一样。
 *    （第一次就是这么读的：见下面基线那条报错里补上的尾巴。）
 * ⚠️ 这里刻意**不 kill 任何东西**：那是别人（哪怕是十秒前的自己）的进程，
 *    按名字清进程是本仓库明令禁止的做法。等它自己走，等不到就响亮失败并把持有者点名。
 */
function waitPortFree(port = 4371, budgetMs = 45_000) {
  const deadline = Date.now() + budgetMs;
  for (;;) {
    const r = spawnSync('lsof', ['-nP', `-iTCP:${String(port)}`, '-sTCP:LISTEN', '-t'], {
      encoding: 'utf8',
    });
    const pids = (r.stdout ?? '').trim().split('\n').filter(Boolean);
    if (pids.length === 0) return;
    if (Date.now() > deadline) {
      const who = spawnSync('ps', ['-o', 'command=', '-p', pids[0] ?? '0'], { encoding: 'utf8' })
        .stdout.trim();
      fail(
        `${String(port)} 端口在 ${String(budgetMs / 1000)}s 内没有释放，持有者 pid=${pids[0]}：${who.slice(0, 160)}\n` +
          '   —— 本臂台**不会去 kill 它**（按名字清进程是禁止的）。请先确认那是谁的载体，再重跑。',
      );
    }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000);
  }
}

const e2e = () => {
  waitPortFree();
  const r = run(
    path.join(ROOT, 'e2e', 'node_modules', '.bin', 'playwright'),
    ['test', '-c', 'playwright.detail-pane.config.ts', ...E2E_SPECS],
    'e2e',
  );
  return { ...tallyPlaywright(r.out), rc: r.rc, out: r.out };
};

/** 产物里所有 CSS 拼起来（去空白）：确认**这一臂那一条规则**真的到了产物。 */
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
  console.log(`RIG_RESULT=PROBE_BROKEN ${msg}`);
  process.exit(2);
};

const redTitles = (out) => [
  ...new Set(
    [...out.matchAll(/✘[^\n]*?›\s*([TI]\d[^\n]*?)\s*$/gm)].map((m) => (m[1] ?? '').trim().slice(0, 4)),
  ),
];

// ── 基线：两层都必须绿，否则臂台没有资格判红 ─────────────────────────
const b = build();
if (b.rc !== 0) fail(`干净态打不出包：\n${b.out.slice(-1200)}`);
const cleanDigest = distDigest();
const bj = jsdom();
if (bj.rc !== 0 || bj.passed < 1) fail(`干净态 jsdom 层不干净：${bj.line}`);
const be = e2e();
/* 🔴 基线的"至少多少条"是**两份 spec 之和**（两列那族 7 条 + 图标那族 6 条）。
   这个数字只用于"载体是不是根本没跑起来"这一档，不用于判红集 —— 红集永远逐条点名。 */
if (be.rc !== 0 || be.passed < 13 || be.failed > 0) {
  /* 🔴 报错必须带上原始尾巴：本轮第一次跑就是 `passed=-1 failed=-1`，
     那**不是**判据没牙，是 4371 被上一次运行留下的 `vite preview` 占着
     （Playwright 直接拒绝起 webServer，一行汇总都不打）。
     只看这两个 -1 会把它读成"干净态不干净 = 产品坏了"。 */
  fail(
    `干净态 e2e 层不干净（要 >=13 passed / 0 failed）：${be.line}\n` +
      `—— 尾巴：\n${be.out.slice(-1200)}`,
  );
}
console.log(`基线：jsdom=${bj.line}｜e2e=${be.line}｜dist=${cleanDigest}`);

let ok = 0;
const bad = [];
for (const arm of ARMS) {
  let mutated = orig;
  if (arm.kind === 'append') {
    mutated = orig + arm.css;
  } else {
    const hits = orig.split(arm.from).length - 1;
    if (hits !== 1) {
      restore();
      fail(`${arm.name}：锚点命中 ${String(hits)} 次（必须恰好 1 次）—— 锚点漂了，注入会打空`);
    }
    mutated = orig.replace(arm.from, arm.to);
  }
  writeFileSync(path.join(ROOT, CSS), mutated);
  const mb = build();
  if (mb.rc !== 0) {
    restore();
    fail(`${arm.name}：变异态打不出包（注入不该导致构建失败）：\n${mb.out.slice(-800)}`);
  }
  const mutatedDigest = distDigest();
  if (mutatedDigest === cleanDigest) {
    restore();
    fail(`${arm.name}：产物与干净态逐字节相同 ⇒ 注入没进 dist，两腿读数都无意义（§7 第 27 条那一族）`);
  }
  if (!builtCss().includes(`${arm.marker}:1`)) {
    restore();
    fail(
      `${arm.name}：产物 CSS 里找不到 ${arm.marker} ⇒ 注入没有落到产物（被压缩改写 / 被层叠吃掉 / 构建没带上）。` +
        ' 这种臂会被读成"判据没牙"，而实际问题在臂自己。',
    );
  }

  const mj = jsdom();
  const me = e2e();
  const titles = redTitles(me.out);
  const blind = mj.failed <= 0 && mj.passed === bj.passed;
  /* 🔴 红集要**恰好**等于点名那几条：少了 = 判据没牙，多了 = 这一臂同时打到了别的判据，
     那"这条臂证的是哪一档"就说不清了。 */
  const expected = arm.expectTitles;
  const teeth =
    me.rc !== 0 &&
    me.failed === expected.length &&
    expected.every((p) => titles.some((t) => t.startsWith(p))) &&
    titles.every((t) => expected.some((p) => t.startsWith(p))) &&
    (arm.expectMessage ?? /expected|找不到|溢出|画不出来/i).test(me.out);
  console.log(`── ${arm.name}`);
  console.log(
    `   腿 A 盲区（jsdom）：${mj.line} rc=${String(mj.rc)} → ${
      blind ? '看不见（成立）' : '也抓到了（这一份坏不区分两层）'
    }`,
  );
  console.log(
    `   腿 B 有牙（e2e）：${me.line} rc=${String(me.rc)} 红集=${titles.join(' ｜ ') || '(解析不出标题)'}`,
  );
  if (blind && teeth) ok += 1;
  else bad.push(`${arm.name}（红集=${titles.join(',') || '空'}，期望=${expected.join(',')}）`);

  restore();
  if (md5() !== origMd5) fail(`${arm.name}：复原失败，habits.css 与基线 md5 不同，必须手工核对`);
}

const rb = build();
if (rb.rc !== 0) fail(`复原后打不出包：\n${rb.out.slice(-800)}`);
if (distDigest() !== cleanDigest) fail('复原后产物摘要与基线不同 ⇒ 复原没落到产物上');
const rj = jsdom();
const re = e2e();
console.log(`复原：BACK_TO_CLEAN=true 复跑 jsdom=${rj.line}｜e2e=${re.line}`);

if (bad.length || rj.rc !== 0 || re.rc !== 0) {
  console.log(
    `RIG_RESULT=FAIL 未如预期=${bad.join(' | ') || '(无)'} 复原复跑绿=${String(
      rj.rc === 0 && re.rc === 0,
    )}`,
  );
  process.exit(1);
}
console.log(
  `RIG_RESULT=${String(ok)}/${String(ARMS.length)}（每臂都是：jsdom 对这一份坏是盲的，e2e 层为它变红 ⇒ e2e 那一层不是重复）`,
);
