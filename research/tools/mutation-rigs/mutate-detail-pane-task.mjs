#!/usr/bin/env node
/**
 * 任务面单落进那一栏（工单 §8.138）的变异臂。
 *
 * 这台问的是 §8.138 那一句不变量的**每一档各由哪一层守着**："每个字段任何时刻只有一个
 * 编辑器所有者"，以及"那一格画的是选中的那一条"。八臂里三档只有真浏览器看得见、
 * 三档只有 jsdom 看得见 —— 两层不是重复，是互补。
 *
 *   A1 面单"没选中就猜第一条"        → jsdom 1 红 + e2e T1 红
 *   A2 栏里的正文框不跟着换 key       → jsdom 1 红 + e2e T2 红
 *      （上一条**没落盘的草稿**会跟着人走：标题换了而框里还是甲的内容。
 *       🔴 第一版 A2 **存活**：jsdom 那条用例在换选中时又 `mount()` 了一次，新建的 root
 *       本身就给一只新框 —— 探针把要测的坏抹掉了。改成"同一枚 root 里换 selection"之后
 *       它按预期红。这一档留在这里是因为它是本仓反复撞的那一族：**臂存活先查探针**。）
 *   A3 行尾那支换回 `<NoteEditor/>`   → jsdom 1 红（源码形状）+ e2e **T1/T2/T3 三条**红
 *      🔴 第一版只点名 T1，实测多红两条 ⇒ **改的是这一条主张，不是判据**：
 *       三只用例都按**整机**数那只正文框，而"两处可编辑"本身就是全局的坏
 *       （T3 还先撞 Playwright 的 strict mode）。这一臂顺手量到：坏在装配处时红集比坏
 *       在面单里宽。它是那条不变量的**阳性对照** —— 没有它，"两处可编辑"只活在注释里。）
 *   A4 落点布尔少一个视图             → jsdom 1 红 + **e2e 盲区**（e2e 只走列表视图）
 *   A5 徽标不判"有没有备注"           → jsdom 1 红 + **e2e 盲区**（没备注的行不画徽标，
 *       界面上没有反例可看 —— 这一档现在是**契约**不是**观感**）
 *   A6 撤掉 `deletedAt` 那道判断      → jsdom 1 红 + **e2e 盲区**（e2e 不删任务）
 *   B1 表里的落点串与生产者不同名      → jsdom 1 红（"三面同串"那条）+ e2e T3 红
 *      （🔴 jsdom 那 5 条 Enter 用例测的是自己插的假元素，它**永远看不见**真渲染里
 *       根本没有这个 testid —— 与 §8.137 的 A4 同一族）
 *   B2 栏内边距拿掉                   → **jsdom 全绿**（它没有布局）+ e2e T1 红
 *
 * ⚠️ 载体是 `vite preview` + `apps/web/dist`（`e2e/playwright.detail-pane.config.ts`，端口 4371），
 *    所以**每一臂都必须重打 `apps/web`**（§7 第 27 条那一族：改了源码没重建 ⇒ 被测的那一份
 *    里根本没有变异 ⇒ 判据会被读成"没有牙"）。jsdom 那层由 vitest 直接读源码，不需要构建。
 *
 * 跑法（仓库根）：
 *   node research/tools/mutation-rigs/mutate-detail-pane-task.mjs            # 全部八臂
 *   node research/tools/mutation-rigs/mutate-detail-pane-task.mjs A3 B1      # 只点名那两臂
 * ⚠️ 它会占 4371 端口、起 Chromium，且**原地改这五枚源文件**（收尾逐文件复原并核对 md5）：
 *    `apps/web/src/features/tasks/TaskDetailCard.tsx`、`.../NoteEditor.tsx`、`apps/web/src/App.tsx`、
 *    `apps/web/src/lib/keyboard-cursor.ts`、`apps/web/src/styles/app/base.css`。
 *    跑之前确认这五枚没有别人的在飞改动。
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const ROOT = process.cwd();
const CARD = 'apps/web/src/features/tasks/TaskDetailCard.tsx';
const NOTE = 'apps/web/src/features/tasks/NoteEditor.tsx';
const APP = 'apps/web/src/App.tsx';
const CURSOR = 'apps/web/src/lib/keyboard-cursor.ts';
const CSS = 'apps/web/src/styles/app/base.css';
const JSDOM_SPECS = ['tests/task-detail-card.spec.tsx', 'tests/keyboard-cursor.spec.tsx'];
const E2E_SPEC = 'tests/detail-pane-task.spec.ts';
const BIN = (rel) => path.join(ROOT, 'apps/web', 'node_modules', '.bin', rel);

const ARMS = [
  {
    name: 'A1 面单"没选中就猜第一条"',
    file: CARD,
    from: `  const selectedId = useSelected('task');`,
    to: `  const selectedId = useSelected('task') ?? Object.keys(store.entities.tasks)[0] ?? null;`,
    expectJs: ['未选中却画了面单'],
    expectE: ['T1'],
  },
  {
    name: 'A2 栏里的正文框不跟着换 key（上一条的未落盘草稿跟着人走）',
    file: CARD,
    from: `      <NoteField
        key={task.id}
        task={task}`,
    to: `      <NoteField
        task={task}`,
    expectJs: ['上一条的未落盘草稿'],
    expectE: ['T2'],
  },
  {
    name: 'A3 行尾那支换回 `<NoteEditor/>`（备注长出第二个编辑器）',
    file: APP,
    from: `<NoteBadge task={task} />`,
    to: `<NoteEditor task={task} onSetNote={() => undefined} />`,
    expectJs: ['栏里那一支与行尾那两支'],
    /* 🔴 第一版只点名 T1，实测红集是 T1/T2/T3 三条 ⇒ **改的是这一条主张，不是判据**：
       三只用例都用 `getByTestId('task-note-input')` 取整机计数，而"两处可编辑"这件事
       本身就是全局的（T3 那条 `toHaveValue` 还会先撞 Playwright 的 strict mode）。
       顺手量到的有用读数：这一臂的红集比 A1/A2 宽，因为坏在**装配处**而不是在面单里。 */
    expectE: ['T1', 'T2', 'T3'],
  },
  {
    name: 'A4 落点布尔少一个视图（时间线那一面按 Enter 落空）',
    file: APP,
    from: `(contentView === 'tasks' || contentView === 'quadrant' || contentView === 'timeline');`,
    to: `(contentView === 'tasks' || contentView === 'quadrant');`,
    expectJs: ['这枚布尔只有一个定义处'],
    expectE: [],
  },
  {
    name: 'A5 徽标不判"有没有备注"（record 档变成常驻）',
    file: NOTE,
    from: `  if (!hasNote) return null;`,
    to: `  if (!hasNote) return <span className="ht-chip ht-chip--on" data-testid={'task-note-badge-' + task.id} />;`,
    expectJs: ['没备注 ⇒ 不占位'],
    expectE: [],
  },
  {
    name: 'A6 撤掉 `deletedAt` 那道判断（任务删了、栏里还画着它）',
    file: CARD,
    from: `picked !== undefined && picked.deletedAt === undefined ? picked : undefined`,
    to: `picked`,
    expectJs: ['那条任务在别处被删掉'],
    expectE: [],
  },
  {
    name: 'B1 表里的落点串与生产者不同名（只有真渲染知道）',
    file: CURSOR,
    from: `    tasks: { kind: 'task', prefix: 'task-item', enterTarget: '[data-testid="task-note-input"]' },`,
    to: `    tasks: { kind: 'task', prefix: 'task-item', enterTarget: '[data-testid="task-note-box"]' },`,
    expectJs: ['表里五面', '任务那一族的落点是'],
    expectE: ['T3'],
  },
  {
    name: 'B2 栏内边距拿掉（控件贴住窗口边，圆角被裁）',
    file: CSS,
    append: `
/* 变异臂 B2（本文件跑完即复原）：把这一格的栏内间距抹掉。 */
.ht-app__detail-task {
  --dp-arm-b2: 1;
  padding: 0;
}
`,
    expectJs: [],
    expectE: ['T1'],
    cssMarker: '--dp-arm-b2:1',
  },
];

const FILES = [CARD, NOTE, APP, CURSOR, CSS];
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
 * vitest 与 Playwright 的汇总行**不能共用一个正则**（Playwright 打 `  5 passed (…)`，
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
  return {
    passed: grab('passed'),
    failed: grab('failed'),
    line: `passed=${String(grab('passed'))} failed=${String(grab('failed'))}`,
  };
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
  const r = run(BIN('vitest'), ['run', ...JSDOM_SPECS], 'apps/web');
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

/** Playwright 失败行的标题（`… › T1 选中一条 ⇒ …`）。
 *  ⚠️ 必须容得下用例名前面那枚 `🔴`（T3/T4/T5 的名字就以它开头）—— 第一版不容，
 *      于是 B1 那一趟明明 `failed=1` 却打印"红集=(无)"，红被读成了"没有红"。 */
const titlesOf = (out, prefix) => [
  ...new Set(
    [...out.matchAll(new RegExp(`✘[^\\n]*?›\\s*(?:[\\u{1F300}-\\u{1FAFF}✅⚠️]\\s*)?(${prefix}\\d[^\\n]*?)\\s*$`, 'gmu'))].map(
      (m) => (m[1] ?? '').trim().slice(0, 24),
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
if (bj.rc !== 0 || bj.passed < 41) fail(`干净态 jsdom 层不干净（要 >=41 passed）：${bj.line}`);
const be = e2e();
if (be.rc !== 0 || be.passed < 5 || be.failed > 0) {
  fail(
    `干净态 e2e 层不干净（要 >=5 passed / 0 failed）：${be.line}｜红集=${titlesOf(be.out, 'T').join(' ｜ ')}`,
  );
}
console.log(`基线：jsdom=${bj.line}｜e2e=${be.line}（T1..T5）｜dist=${cleanDigest}`);

/* 只跑点名的臂：`node … A3 B1`。存在的理由是**改完一条主张之后不必把八臂全部重跑** ——
   否则"改臂"这个动作的成本会把人推回去改判据（那才是真正要避免的）。
   基线与收尾复原**不受影响**：臂台照旧先验两层都绿、跑完照旧逐文件核 md5。 */
const ONLY = process.argv.slice(2).map((a) => a.toUpperCase());
const SELECTED =
  ONLY.length === 0
    ? ARMS
    : ARMS.filter((a) => ONLY.includes(a.name.split(' ')[0].toUpperCase()));
if (SELECTED.length === 0) {
  fail(
    `点名 ${ONLY.join(',')} 一枚都没匹配上（臂名=${ARMS.map((a) => a.name.split(' ')[0]).join('/')}）`,
  );
}
if (SELECTED.length !== ARMS.length) {
  console.log(
    `⚠️ 只跑 ${SELECTED.map((a) => a.name.split(' ')[0]).join('/')}（其余 ${String(ARMS.length - SELECTED.length)} 臂本轮没有读数，写进文档时不许当成全绿）`,
  );
}

let ok = 0;
const bad = [];
for (const arm of SELECTED) {
  const source = orig.get(arm.file);
  if (arm.append !== undefined) {
    writeFileSync(path.join(ROOT, arm.file), source + arm.append);
  } else {
    const hits = source.split(arm.from).length - 1;
    if (hits !== 1) {
      fail(
        `${arm.name}：源码里 \`from\` 那段命中 ${String(hits)} 次（要恰好 1 次）⇒ 0 次是臂打在不存在的地方，>1 次是 \`replace\` 只改第一处、可能改到的正是注释`,
      );
    }
    writeFileSync(path.join(ROOT, arm.file), source.replace(arm.from, arm.to));
  }

  const mb = build();
  if (mb.rc !== 0) {
    fail(`${arm.name}：变异态打不出包（注入不该导致构建失败）：\n${mb.out.slice(-1200)}`);
  }
  const mutated = distDigest();
  if (mutated === cleanDigest) {
    restore();
    fail(`${arm.name}：产物与干净态逐字节相同 ⇒ 注入没进 dist，两腿读数都无意义（§7 第 27 条那一族）`);
  }
  if (arm.cssMarker !== undefined && !builtCss().includes(arm.cssMarker.replace(/\s+/g, ''))) {
    restore();
    fail(
      `${arm.name}：产物 CSS 里找不到那枚标记 ⇒ 注入没有落到产物（被层叠吃掉 / 被压缩改写），这种臂会被读成"判据没牙"`,
    );
  }

  const mj = jsdom();
  const me = e2e();
  const jsBlind = mj.failed <= 0 && mj.passed === bj.passed;
  const eBlind = me.failed <= 0 && me.passed === be.passed;
  const jsOk =
    arm.expectJs.length === 0
      ? jsBlind
      : mj.rc !== 0 &&
        mj.failed === arm.expectJs.length &&
        arm.expectJs.every((p) => mj.out.includes(p));
  const eOk =
    arm.expectE.length === 0
      ? eBlind
      : me.rc !== 0 && redSetMatches(me.out, 'T', arm.expectE) && me.failed === arm.expectE.length;

  console.log(`── ${arm.name}`);
  console.log(
    `   jsdom：${mj.line} rc=${mj.rc} → ${arm.expectJs.length === 0 ? (jsBlind ? '盲区（成立）' : '也抓到了') : `应红 ${arm.expectJs.length} 条：${arm.expectJs.join('/')}`}`,
  );
  console.log(
    `   e2e ：${me.line} rc=${me.rc} 红集=${titlesOf(me.out, 'T').join(' ｜ ') || '(无)'} → ${arm.expectE.length === 0 ? (eBlind ? '盲区（成立）' : '也抓到了') : `应红=${arm.expectE.join('/')}`}`,
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
if (rb.rc !== 0) fail(`复原后打不出包：\n${rb.out.slice(-1500)}`);
if (distDigest() !== cleanDigest) fail('复原后产物摘要与基线不同 ⇒ 复原没落到产物上');
const rj = jsdom();
const re = e2e();
console.log(`复原：BACK_TO_CLEAN=${rj.rc === 0 && re.rc === 0} 复跑 jsdom=${rj.line}｜e2e=${re.line}`);

if (bad.length || rj.rc !== 0 || re.rc !== 0) {
  console.log(
    `RIG_RESULT=FAIL 未如预期=${bad.join(' | ') || '(无)'} 复原复跑绿=${rj.rc === 0 && re.rc === 0}`,
  );
  process.exit(1);
}
console.log(
  `RIG_RESULT=${ok}/${SELECTED.length}（每臂的红集**逐条等于**点名那几条；A4/A5/A6 只 jsdom 红=e2e 盲区，B2 只 e2e 红=jsdom 盲区）`,
);
