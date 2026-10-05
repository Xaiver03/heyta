#!/usr/bin/env node
/**
 * 键盘光标「Enter 把焦点交给这一格」（工单 W1b 第 3 条腿，§8.137）的变异臂。
 *
 * 这台要回答的问题与 `mutate-detail-pane-habit-e2e.mjs` **不是同一个**：那一台问
 * "e2e 是不是 jsdom 的重复"，这一台问的是**这一条腿上的每一档承诺各由哪一层守着**。
 * 两层各有对方看不见的坏，所以臂台必须**双向**都造：
 *
 *   A1 落点没登记（habit 那一行）      → jsdom 1 红 + e2e K9 红
 *   A2 撤掉"焦点行 == 选中行"那道闸门   → jsdom 1 红 + e2e K11 红
 *   A3 `openPane` 只吞键不聚焦          → jsdom 1 红 + e2e **K9 与 K10 两条**红
 *      （🔴 第一版只点名 K9，实测多红一条 K10 ⇒ **改的是这一条主张，不是判据**：
 *       `openPane` 是两面共用的那一只，摘掉它的 `focus()` 同时打掉习惯与便签两个落点。
 *       这一臂顺手量到了一件有价值的事：**e2e 的红集能告诉你一枚函数被几面共用** ——
 *       写臂之前我只记得"便签也走 openPane"，但没有读数；红集把它打出来了。）
 *   A4 面单根没有 `tabIndex={-1}`       → **jsdom 全绿**（它测的是自己插的假面单，
 *      那一只有 `tabIndex`）+ e2e K9 红 ⇒ 这一份坏只有真渲染看得见
 *   A5 这一格的环换成非品牌那一套        → **jsdom 全绿**（它不读 CSS）+ e2e K9 红
 *      🔴 A5 的第一版（撤掉本单自己加的那条环规则）**存活** —— 照出那条 CSS 是冗余的第二份
 *      所有者，已删；三步现量在臂的注释里
 *   A6 落点没登记（便签）                → **jsdom 全绿** + e2e K10 红
 *   A7 撤掉 Enter 那支的 `preventDefault` → jsdom 1 红 + **e2e 全绿**（反向盲区）
 *   A8 环改回往外画（改前的形状）        → **jsdom 全绿**（它没有视口）+ e2e K9 红
 *
 * 🔴 A7 那条盲区要照实登记，不许当成"判据没牙"混过去：吞掉 Enter 在**今天的界面上
 * 没有可观察后果** —— 行本来就是按钮，Enter 落上去是"再选一次同一条"，而
 * `selection.select()` 对重复选同一条不通知。钉住它的只有 jsdom 那句 `defaultPrevented`。
 * 换句话说：这一档现在是"**契约**"而不是"**观感**"（光标接管了一次按键，就不该让宿主控件
 * 再处理一遍）。哪个视图把"再点已选中那一行"改成开关（例如便签改成"点了收起"），
 * e2e 层就必须补一条对应的判据 —— 那时 A7 才有浏览器层的读数。
 *
 * ⚠️ A4/A5/A6 三臂的"注入到了产物"不能只看摘要：CSS 那一条（A5）还额外要求
 *    变异用的**那个类名**出现在打出来的 CSS 里。理由是本仓库的上一次事故
 *    （`mutate-detail-pane-habit-e2e.mjs` 的 E2 第一版）：注入的规则被后导入的等特异性
 *    规则吃掉，摘要变了而规则是死的，两腿读数一样无意义。
 *
 * 🔴 载体是 `vite preview` + `apps/web/dist`（`e2e/playwright.detail-pane.config.ts`，端口 4371），
 *    所以**每一臂都必须重打 `apps/web`**（§7 第 27 条那一族：改了源码没重建 ⇒ 被测的那一份
 *    里根本没有变异 ⇒ 判据会被读成"没有牙"）。jsdom 那层由 vitest 直接读源码，不需要构建。
 *
 * 跑法（仓库根）：node research/tools/mutation-rigs/mutate-keyboard-enter.mjs
 * ⚠️ 它会占 4371 端口、起 Chromium，且会**原地改这三枚源文件**（收尾逐文件复原并核对 md5）：
 *    `apps/web/src/lib/keyboard-cursor.ts`、`.../habits/HabitDetailCard.tsx`、
 *    `apps/web/src/styles/app/habits.css`。跑之前确认这三枚没有别人的在飞改动。
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const ROOT = process.cwd();
const CURSOR = 'apps/web/src/lib/keyboard-cursor.ts';
const CARD = 'apps/web/src/features/habits/HabitDetailCard.tsx';
const CSS = 'apps/web/src/styles/app/habits.css';
const JSDOM_SPEC = 'tests/keyboard-cursor.spec.tsx';
const E2E_SPEC = 'tests/keyboard-cursor.spec.ts';
const BIN = (rel) => path.join(ROOT, 'apps/web', 'node_modules', '.bin', rel);

/** 两条 jsdom 用例的名字片段（不带 markdown 星号，避免与用例名里的 `**` 对不上）。 */
const JS_MARKED = '吞掉按键，且选中一个字都没动';
const JS_UNMARKED = '那一下，不是';

const ARMS = [
  {
    name: 'A1 habit 那一行的落点没登记（Enter 走不到任何地方）',
    file: CURSOR,
    from: `    habits: { kind: 'habit', prefix: 'habit-row', enterTarget: '[data-testid="habit-pane"]' },`,
    to: `    habits: { kind: 'habit', prefix: 'habit-row' },`,
    expectJs: [JS_MARKED],
    expectE: ['K9'],
  },
  {
    name: 'A2 撤掉"焦点行 == 选中行"那道闸门（Enter 把没按的那一行也接管了）',
    file: CURSOR,
    from: `        if (id === '' || id !== selection.get(target.kind)) return;`,
    to: `        if (id === '') return;`,
    expectJs: [JS_UNMARKED],
    expectE: ['K11'],
  },
  {
    name: 'A3 `openPane` 只吞键不聚焦（静默跳焦点的反面：静默不跳）',
    file: CURSOR,
    from: `  if (pane === null) return false;
  pane.focus();
  return true;`,
    to: `  if (pane === null) return false;
  return true;`,
    expectJs: [JS_MARKED],
    // 两面共用同一只 openPane ⇒ 两条都该红（第一版只点名 K9，见文件头）。
    expectE: ['K9', 'K10'],
  },
  {
    name: 'A4 面单根没有 tabIndex（真渲染里 focus() 是空操作，jsdom 看不见）',
    file: CARD,
    /* 🔴 带前导换行 + 缩进：`tabIndex={-1}` 这个字面串在本文件里出现**两次** —— 另一次在
       上面那四行注释里（注释讲的是"这枚 -1 是给键盘光标用的落点"）。不锚住换行的话臂打在
       注释上，产物逐字节不变，于是这一臂会得到"两层都绿"的读数，而真相是臂自己没落地。 */
    from: `\n      tabIndex={-1}`,
    to: '',
    expectJs: [],
    expectE: ['K9'],
  },
  {
    /* 🔴 A5 的第一版**存活了，而那一趟是本臂台最值钱的读数**：注入的是"撤掉本单新加的那条
       `.ht-habit__pane:focus-visible`"，结果 e2e 全绿。现量三步定位（臂台之外的一次运行时探针）：
         ① 产物 CSS 里那条规则确实没了（`grep -c ht-habit__pane:focus-visible` ⇒ **0**）；
         ② 把规则从 CSSOM 里 `deleteRule` 掉之后，那一格计算出来仍是 `solid 2px rgb(37,99,235)`；
         ③ 枚举行上所有"会设 outline 且匹配这一格"的规则 ⇒ 只剩一枚：`:focus-visible`
            （设计系统 `packages/design-system/src/reset.css:119`，它给的就是
            `--ht-focus-ring-width` + `--ht-color-ring`）。
       结论不是"判据没牙"，而是**本单那条 CSS 是第二份所有者、纯冗余** ⇒ 已删
       （AGENTS §5：焦点样式由设计系统单点给，组件不许自己发明）。顺带把判据的尺子从
       `--ht-border-width-thick` 换成环真正用的 `--ht-focus-ring-width` —— 两枚今天都是 2px，
       拿错的那枚量会**恰好绿**，谁改其中一枚就变成假红/假绿（§7 第 83 条同族：
       "默认值恰好像我们的品牌色"不构成判据）。
       现在 A5 打在**活着的那一条**上：把这一格的环换成非品牌的一份（`1px dotted rgb(1,2,3)`），
       特异性 (0,2,0) 高于全局那枚 (0,1,0) ⇒ 判据必须红，否则它量的根本不是环。 */
    name: 'A5 这一格的焦点环被换成非品牌那一套（证明判据量的确实是环）',
    file: CSS,
    append: `
/* MUTATION-ARM A5（临时，本脚本收尾会删）：把这一格的环换成"不是设计系统那一套"的一份。 */
.ht-habit__pane:focus-visible {
  --dp-arm-a5: 1;
  outline: 1px dotted rgb(1, 2, 3);
}
`,
    expectJs: [],
    expectE: ['K9'],
    cssMarker: '--dp-arm-a5:1',
  },
  {
    name: 'A6 便签那一族的落点没登记（jsdom 那套只用 habit 前缀，看不见这一族）',
    file: CURSOR,
    from: `    notes: { kind: 'note', prefix: 'note-row', enterTarget: '[data-testid="notes-editor-input"]' },`,
    to: `    notes: { kind: 'note', prefix: 'note-row' },`,
    expectJs: [],
    expectE: ['K10'],
  },
  /* A8 = §8.137 第 5.5 节那一处（看图照出来的"环有四条边被视口裁掉"）。
     注入的就是**改前的形状**：把这一格的 `outline-offset` 换回全局那条给的外扩 2px。
     🔴 这一臂**只有真浏览器能看见**：jsdom 没有视口，`getBoundingClientRect` 全 0，
     那条"四条边都落在视口里"的判据在它里面根本走不到（不是判据弱，是这一档的事实
     本来就只在有视口的地方存在）。 */
  {
    name: 'A8 环改回往外画（上边与右边被视口裁掉，图上只剩一条线）',
    file: CSS,
    append: `
/* MUTATION-ARM A8（临时，本脚本收尾会删）：把这一格的环换回外扩 —— 改前的形状。 */
.ht-habit__pane:focus-visible {
  --dp-arm-a8: 1;
  outline-offset: 2px;
}
`,
    expectJs: [],
    expectE: ['K9'],
    cssMarker: '--dp-arm-a8:1',
  },
  {
    name: 'A7 撤掉 Enter 那支的 preventDefault（e2e 层今天是盲的，见文件头）',
    file: CURSOR,
    from: `        if (openPane(target)) event.preventDefault();`,
    to: `        openPane(target);`,
    expectJs: [JS_MARKED],
    expectE: [],
  },
];

const FILES = [CURSOR, CARD, CSS];
const orig = new Map(FILES.map((f) => [f, readFileSync(path.join(ROOT, f), 'utf8')]));
const md5 = (s) => createHash('md5').update(s).digest('hex');
const origMd5 = new Map([...orig].map(([f, s]) => [f, md5(s)]));

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
 * vitest 与 Playwright 的汇总行**不能共用一个正则**（Playwright 打 `  11 passed (…)`，
 * 行首没有 `Tests` ⇒ 永远读到 -1，于是"基线不干净"那条恒不成立 = 一条永远通过的基线）。
 */
const tallyVitest = (out) => {
  const line = (out.match(/^[ \t]*Tests[ \t].*$/m) || [''])[0].trim();
  return {
    line,
    passed: Number(/(\d+) passed/.exec(line)?.[1] ?? -1),
    failed: Number(/(\d+) failed/.exec(line)?.[1] ?? -1),
  };
};

const tallyPlaywright = (out) => {
  const grab = (word) => {
    const hits = [...out.matchAll(new RegExp(`^[ \\t]*(\\d+) ${word}(?:[ \\t(]|$)`, 'gm'))];
    return hits.length === 0 ? -1 : Number(hits[hits.length - 1][1]);
  };
  return { passed: grab('passed'), failed: grab('failed'), line: `passed=${String(grab('passed'))} failed=${String(grab('failed'))}` };
};

/** 产物摘要：证明注入真的进了 `dist`，而不只是进了源码。 */
const distDigest = () => {
  const root = path.join(ROOT, 'apps/web/dist');
  const walk = (dir, prefix = '') => {
    const acc = [];
    for (const name of readdirSync(dir).sort()) {
      const full = path.join(dir, name);
      const rel = `${prefix}/${name}`;
      if (statSync(full).isDirectory()) acc.push(...walk(full, rel));
      else acc.push(`${rel}:${md5(readFileSync(full))}`);
    }
    return acc;
  };
  return createHash('sha256').update(walk(root).join('|')).digest('hex').slice(0, 16);
};

const builtCss = () => {
  const dir = path.join(ROOT, 'apps/web/dist/assets');
  return readdirSync(dir)
    .filter((f) => f.endsWith('.css'))
    .map((f) => readFileSync(path.join(dir, f), 'utf8'))
    .join('')
    .replace(/\s+/g, '');
};

const build = () => {
  const t = run(BIN('tsc'), ['-b'], 'apps/web');
  if (t.rc !== 0) return { rc: t.rc, out: `tsc -b 失败：\n${t.out.slice(-1500)}` };
  return { rc: 0, out: run(BIN('vite'), ['build'], 'apps/web').out };
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

const restore = () => {
  for (const [f, s] of orig) writeFileSync(path.join(ROOT, f), s);
};

const fail = (msg) => {
  restore();
  console.log(`VERDICT=PROBE_BROKEN ${msg}`);
  process.exit(2);
};

/** Playwright 失败行的标题（`… › K9 习惯：…`）。 */
const titlesOf = (out, prefix) => [
  ...new Set(
    [...out.matchAll(new RegExp(`✘[^\\n]*?›\\s*(${prefix}\\d[^\\n]*?)\\s*$`, 'gm'))].map((m) =>
      (m[1] ?? '').trim().slice(0, 40),
    ),
  ),
];
/** 一条"该红几条"的对账：红的标题集合必须**逐条等于**点名那几条。 */
const redSetMatches = (out, prefix, expected) => {
  const titles = titlesOf(out, prefix);
  return (
    titles.length === expected.length &&
    expected.every((p) => titles.some((t) => t.startsWith(p))) &&
    titles.every((t) => expected.some((p) => t.startsWith(p)))
  );
};

// ── 基线：两层都必须绿，否则臂台没有资格判红 ─────────────────────────
for (const [f, s] of orig) {
  if (md5(s) !== origMd5.get(f)) fail(`基线读取时 ${f} 就变了`);
}
const b = build();
if (b.rc !== 0) fail(`干净态打不出包：\n${b.out.slice(-1500)}`);
const cleanDigest = distDigest();
const bj = jsdom();
if (bj.rc !== 0 || bj.passed < 30) fail(`干净态 jsdom 层不干净（要 >=30 passed）：${bj.line}`);
const be = e2e();
if (be.rc !== 0 || be.passed < 11 || be.failed > 0) {
  fail(`干净态 e2e 层不干净（要 >=11 passed / 0 failed）：${be.line}｜红集=${titlesOf(be.out, 'K').join(' ｜ ')}`);
}
console.log(`基线：jsdom=${bj.line}｜e2e=${be.line}（K1..K11）｜dist=${cleanDigest}`);

/* 只跑点名的臂：`node …mutate-keyboard-enter.mjs A3 A5`。
   存在的理由不是省时间，是**改完一条主张之后不必把七臂全部重跑** ——
   否则"改臂"这个动作的成本会把人推回去改判据（那才是真正要避免的）。
   基线与收尾复原**不受影响**：臂台照旧先验两层都绿、跑完照旧逐文件核 md5。 */
const ONLY = process.argv.slice(2).map((a) => a.toUpperCase());
const SELECTED = ONLY.length === 0 ? ARMS : ARMS.filter((a) => ONLY.includes(a.name.split(' ')[0].toUpperCase()));
if (SELECTED.length === 0) fail(`--arms 点名 ${ONLY.join(',')} 一枚都没匹配上（臂名=${ARMS.map((a) => a.name.split(' ')[0]).join('/')}）`);
if (SELECTED.length !== ARMS.length) {
  console.log(`⚠️ 只跑 ${SELECTED.map((a) => a.name.split(' ')[0]).join('/')}（其余 ${String(ARMS.length - SELECTED.length)} 臂本轮没有读数，写进文档时不许当成全绿）`);
}

let ok = 0;
const bad = [];
for (const arm of SELECTED) {
  const source = orig.get(arm.file);
  if (arm.append !== undefined) {
    /* append 型臂：注入不要求源码里有某个锚（本单要的就是"文件末尾多一条规则"）。 */
    writeFileSync(path.join(ROOT, arm.file), source + arm.append);
  } else {
  const hits = source.split(arm.from).length - 1;
  if (hits !== 1) {
    fail(
      `${arm.name}：源码里 \`from\` 那段命中 ${String(hits)} 次（要恰好 1 次）⇒ 0 次是臂打在不存在的地方，` +
        `>1 次是 ` + '`replace` ' + `只会改第一处、可能改到的正是注释（A4 就这么差点打空）`,
    );
  }
    writeFileSync(path.join(ROOT, arm.file), source.replace(arm.from, arm.to));
  }

  const mb = build();
  if (mb.rc !== 0) fail(`${arm.name}：变异态打不出包（注入不该导致构建失败）：\n${mb.out.slice(-1200)}`);
  const mutated = distDigest();
  if (mutated === cleanDigest) {
    restore();
    fail(`${arm.name}：产物与干净态逐字节相同 ⇒ 注入没进 dist，两腿读数都无意义（§7 第 27 条那一族）`);
  }
  if (arm.cssMarker !== undefined && !builtCss().includes(arm.cssMarker.replace(/\s+/g, ''))) {
    restore();
    fail(`${arm.name}：产物 CSS 里找不到那枚标记 ⇒ 注入没有落到产物（被层叠吃掉 / 被压缩改写），这种臂会被读成"判据没牙"`);
  }

  const mj = jsdom();
  const me = e2e();
  const jsBlind = mj.failed <= 0 && mj.passed === bj.passed;
  const eBlind = me.failed <= 0 && me.passed === be.passed;
  const jsOk =
    arm.expectJs.length === 0
      ? jsBlind
      : mj.rc !== 0 && mj.failed === arm.expectJs.length && arm.expectJs.every((p) => mj.out.includes(p));
  const eOk =
    arm.expectE.length === 0 ? eBlind : me.rc !== 0 && redSetMatches(me.out, 'K', arm.expectE) && me.failed === arm.expectE.length;

  console.log(`── ${arm.name}`);
  console.log(
    `   jsdom：${mj.line} rc=${mj.rc} → ${arm.expectJs.length === 0 ? (jsBlind ? '盲区（成立）' : '也抓到了（这一份坏不区分两层）') : `应红 1 条：${arm.expectJs.join('/')}`}`,
  );
  console.log(
    `   e2e ：${me.line} rc=${me.rc} 红集=${titlesOf(me.out, 'K').join(' ｜ ') || '(无)'} → ${arm.expectE.length === 0 ? (eBlind ? '盲区（成立）' : '也抓到了') : `应红=${arm.expectE.join('/')}`}`,
  );
  if (jsOk && eOk) ok += 1;
  else bad.push(`${arm.name}（jsdom ${jsOk ? 'ok' : 'NOT_AS_EXPECTED'} / e2e ${eOk ? 'ok' : 'NOT_AS_EXPECTED'}）`);

  restore();
  for (const f of FILES) {
    if (md5(readFileSync(path.join(ROOT, f))) !== origMd5.get(f)) {
      fail(`${arm.name}：复原失败，${f} 与基线 md5 不同，必须手工核对`);
    }
  }
}

const rb = build();
if (rb.rc !== 0) fail(`复原后打不出包：\n${rb.out.slice(-1200)}`);
if (distDigest() !== cleanDigest) fail('复原后产物摘要与基线不同 ⇒ 复原没落到产物上');
const rj = jsdom();
const re = e2e();
console.log(`复原：BACK_TO_CLEAN=true 复跑 jsdom=${rj.line}｜e2e=${re.line}`);

if (bad.length || rj.rc !== 0 || re.rc !== 0) {
  console.log(`RIG_RESULT=FAIL 未如预期=${bad.join(' | ') || '(无)'} 复原复跑绿=${rj.rc === 0 && re.rc === 0}`);
  process.exit(1);
}
console.log(
  `RIG_RESULT=${ok}/${SELECTED.length}（每臂的读数集合**逐条等于**点名那几条；A4/A5/A6 只 e2e 红=jsdom 盲区，A7 只 jsdom 红=e2e 盲区）`,
);
