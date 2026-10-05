#!/usr/bin/env node
/**
 * 便签面单落点（**真浏览器那一层**）的变异臂（工单 §8.130）。
 *
 * 这一臂要回答的问题只有一个：`e2e/tests/detail-pane-note-editor.spec.ts` 那五条
 * 是不是 `apps/web/tests/note-editor-placement.spec.tsx` 那十条的**重复**？
 * 答案是"不是"，而证明方式是造一份**只有浏览器能看见**的坏：
 * 往 `base.css` 追加一条规则，把详情列里的编辑器 `display:none` 藏掉 ——
 * jsdom 那十条**一条都不会红**（它不加载应用的 CSS bundle、也不跑布局），
 * 而用户在宽屏上点便签会看到"右边那一栏什么都没有"（选中却已经进了模型）。
 *
 * ⇒ 两腿都要成立才算数：
 *   腿 A（盲区）：变异态下 jsdom 仍然 10 passed —— 证明 jsdom 看不见这一份坏；
 *   腿 B（有牙）：变异态下 e2e 至少一条红，且红的必须是 N1（落点那一帧）。
 * 只跑腿 B 会高估这一层（也许 jsdom 也抓得到）；只跑腿 A 会低估它。
 *
 * 🔴 载体是 `vite preview` + `apps/web/dist`（见 `e2e/playwright.detail-pane.config.ts` 文件头），
 * 所以**每一臂都必须重打 `apps/web`** —— 上一轮 W1b 第一趟就是"改了源码没重建 ⇒
 * 被测的那一份里根本没有变异 ⇒ 判据被读成没有牙"（§7 第 27 条那一族）。
 *
 * 跑法（仓库根）：node research/tools/mutation-rigs/mutate-detail-pane-note-editor-e2e.mjs
 * ⚠️ 它会占 4371 端口、起一次 Chromium，且会**原地改工作树里的 base.css**（收尾复原并核对 md5）。
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const ROOT = process.cwd();
const CSS = 'apps/web/src/styles/app/base.css';
const JSDOM_SPEC = 'tests/note-editor-placement.spec.tsx';
const E2E_SPEC = 'tests/detail-pane-note-editor.spec.ts';
const BIN = (rel) => path.join(ROOT, 'apps/web', 'node_modules', '.bin', rel);

/** 注入的那一条：只在详情列里藏编辑器，别处一行字节都不动。 */
const INJECT = `
/* MUTATION-ARM（临时，本脚本收尾会删）：把栏里的便签编辑器藏掉。 */
.ht-app__detail-note [data-testid="notes-editor"] {
  display: none;
}
`;

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
 * vitest 的汇总行（缩进 + 词序随结果变两个坑见 `mutate-habit-rate-label.mjs` 的注释）。
 * 🔴 与 Playwright 的**不能共用一个正则**：Playwright 打的是 `  5 passed (4.0s)` / `  1 failed`，
 * 行首没有 `Tests` 这个词。第一版这里用同一个正则去读两边，e2e 那侧永远拿到 `passed=-1`、
 * `failed=0` ⇒ 基线检查 `failed !== 0` 恒不成立 —— **一条永远通过的基线**（§7 元规则 2）。
 */
const tallyVitest = (out) => {
  const line = (out.match(/^[ \t]*Tests[ \t].*$/m) || [''])[0];
  return {
    line: line.trim(),
    passed: Number(/(\d+) passed/.exec(line)?.[1] ?? -1),
    failed: Number(/(\d+) failed/.exec(line)?.[1] ?? -1),
  };
};

/** Playwright 的汇总：取**最后一次**出现的那个计数（列表里每条用例也可能带数字）。 */
const tallyPlaywright = (out) => {
  const grab = (word) => {
    const hits = [...out.matchAll(new RegExp(`^[ \\t]*(\\d+) ${word}(?:[ \\t(]|$)`, 'gm'))];
    return hits.length === 0 ? -1 : Number(hits[hits.length - 1][1]);
  };
  const passed = grab('passed');
  const failed = grab('failed');
  return { passed, failed, line: `passed=${String(passed)} failed=${String(failed)}` };
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

const restore = () => writeFileSync(path.join(ROOT, CSS), orig);

const fail = (msg) => {
  restore();
  console.log(`VERDICT=PROBE_BROKEN ${msg}`);
  process.exit(2);
};

// ── 基线：干净态必须两边都绿，否则臂台没有资格判红 ────────────────────
const b = build();
if (b.rc !== 0) fail(`干净态打不出包：\n${b.out.slice(-1200)}`);
const bj = jsdom();
if (bj.rc !== 0 || bj.passed < 10) fail(`干净态 jsdom 层不干净（要 >=10 passed）：${bj.line}`);
const be = e2e();
if (be.rc !== 0 || be.passed < 5 || be.failed > 0) fail(`干净态 e2e 层不干净（要 5 passed / 0 failed）：${be.line}`);
console.log(`基线：jsdom=${bj.line}｜e2e=${be.line}`);

// ── 注入 ──────────────────────────────────────────────────────────────
writeFileSync(path.join(ROOT, CSS), orig + INJECT);
const mb = build();
if (mb.rc !== 0) fail(`变异态打不出包（注入的那条 CSS 不该导致构建失败）：\n${mb.out.slice(-800)}`);
if (md5() === origMd5) fail('注入没有落盘：base.css 与干净态逐字节相同，两腿读数都无意义');

const mj = jsdom();
const me = e2e();
console.log(`腿 A 盲区（jsdom）：${mj.line} rc=${mj.rc}`);
console.log(`腿 B 有牙（e2e）：${me.line} rc=${me.rc}`);

// Playwright/vitest 全绿时**不打** failed 那一行 ⇒ 读数是 -1，不是 0。按"没有失败"判：
const blind = mj.failed <= 0 && mj.passed === bj.passed;
/* 🔴 红集要**点名**，不能只报个数（工单 §4 的"变异臂红集"那一栏要的就是这个）。
   列表 reporter 用 `✘` 标失败用例，取标题里最后一个 `›` 之后那一段。
   ⚠️ 这一条自己也可能是空解析（Playwright 改了标记 ⇒ `redTitles.length===0` ⇒ 臂被读成"没牙"）,
   所以下面把"解析不出标题"单独打出来，不混进"解析出来但不含 N1"那一档。 */
const redTitles = [
  ...new Set(
    [...me.out.matchAll(/✘[^\n]*?›\s*(N\d[^\n]*?)\s*$/gm)].map((m) =>
      (m[1] ?? '').trim().slice(0, 46),
    ),
  ),
];
console.log(
  `腿 B 红集：${redTitles.length ? redTitles.join(' ｜ ') : '(解析不出标题 —— 先看 reporter 标记有没有变)'}`,
);
const teeth =
  me.rc !== 0 &&
  me.failed >= 1 &&
  redTitles.some((t) => t.startsWith('N1')) &&
  // 红的必须是"看不见那一枚"这一族，而不是别的东西（比如载体没起来）。
  /expected: visible|toBeVisible|界面上找不到这个元素|详情列里没有面单|面单不在/i.test(me.out);

restore();
if (md5() !== origMd5) fail('复原失败：base.css 与基线 md5 不同，必须手工核对');
const rb = build();
if (rb.rc !== 0) fail(`复原后打不出包：\n${rb.out.slice(-800)}`);
const rj = jsdom();
const re = e2e();
console.log(`复原：BACK_TO_CLEAN=true 复跑 jsdom=${rj.line}｜e2e=${re.line}`);

if (!blind || !teeth || rj.rc !== 0 || re.rc !== 0) {
  console.log(
    `RIG_RESULT=FAIL 盲区腿=${blind ? '成立' : '不成立（jsdom 也抓得到 ⇒ 这一层不是唯一载体）'} ` +
      `有牙腿=${teeth ? '成立' : '不成立（e2e 没为这一份坏变红）'} 复原复跑绿=${rj.rc === 0 && re.rc === 0}`,
  );
  process.exit(1);
}
console.log('RIG_RESULT=1/1（jsdom 对这一份坏是盲的，e2e 层为它变红 ⇒ 那一层不是重复）');
