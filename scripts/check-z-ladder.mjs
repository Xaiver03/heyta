#!/usr/bin/env node
/**
 * `pnpm check:z-ladder` —— 浮层层级刻度的一条**序列**判据（全局 UX 线 P7）
 * ======================================================================
 *
 * ## 这一枚治的是什么
 *
 * 本仓为"谁压在谁上面"付过一次真学费（§7 第 607 条）：习惯新建那层占的是
 * `--ht-z-splash`(900) —— 那是**启动屏**那一档 —— 于是嵌在它里面的确认框
 * 永远压不住面板，"画得出来点不动"。当时的绕法是给确认框另开一档
 * `z.modal-commitment`(550)，也就是**再参加一次数字竞赛**，而不是把刻度立起来。
 *
 * 数字竞赛没有终点：谁遇到"被压住"，谁的下一个数就更大。所以这里把两件事变成尺：
 *
 *   Z1 **顺序**：刻度表必须严格按用途单调递增
 *        base < sticky < dropdown < overlay < modal < popover < modal-commitment
 *        < toast < tooltip < splash。
 *        加一档、改一个数、把两档写成同一个值 ⇒ 红。这一臂治的是"刻度自己漂"。
 *   Z2 **越级**：功能 CSS 里 `z.splash` 零消费者（它是启动屏专用档）。
 *        今天恰好把最后一枚（`.ht-habit-create-dialog`）拆回 `z.modal`，
 *        所以这一臂的账是 **0**，而不是"留几个例外"。
 *        ⚠️ 判之前先剥注释：注释里讲历史（"P7 之前这一枚占的是 `--ht-z-splash`"）
 *        不是声明。不剥的话，这一枚尺会把**记录自己**读成违规。
 *   Z3 **分母**：扫到的 `z-index: var(--ht-z-*)` 声明数只许涨不许塌 ——
 *        塌了说明扫描面或写法变了，那把尺正在"什么都没看见"地绿。
 *
 * ## 为什么允许 `popover(500) > modal(400)`
 *
 * 这不是漏改，是**成立的条件**：从对话框里开出去的锚定层（日期、重复规则）必须
 * 压住它所属的那枚面板，否则用户点开选择器却选择器在面板底下。
 * 真不变量是"**必须按下去的那一层**（`modal-commitment`）压过任何锚定层"，
 * 而不是"模态压过一切"。Z1 钉的就是这条顺序。
 */

import { execFile } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);
const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const here = dirnameOf(import.meta.url);
const TOKENS = 'packages/design-system/src/tokens.css';

function dirnameOf(url) {
  return resolve(new URL('.', url).pathname);
}

/** 刻度的**用途顺序**（不是数值顺序）—— 数值必须按这个次序严格变大。 */
const LADDER = [
  'z-base',
  'z-sticky',
  'z-dropdown',
  'z-overlay',
  'z-modal',
  'z-popover',
  'z-modal-commitment',
  'z-toast',
  'z-tooltip',
  'z-splash',
];

/** 启动屏专用：功能 CSS 里出现即红。 */
const RESERVED = new Set(['z-splash']);

/**
 * 下限取的是**这把尺自己扫出来的那一趟读数**（2026-10-28：32 个 CSS 文件里 33 条），
 * 不是我拿 grep 手数的那个 37 —— 手数的时候把注释行与 `.tsx` 里的内联
 * `cssVar('z.popover')` 也算进去了，写进代码当阈值就会当场红。
 * 它只当**下限**用：声明只许涨不许塌，塌了说明扫描面或写法变了。
 */
const FLOOR_DECLARATIONS = 33;

function stripComments(text) {
  return text.replaceAll(/\/\*[\s\S]*?\*\//gu, '').replaceAll(/(^|[^:\\])\/\/[^\n]*/gm, '$1');
}

function cssFiles(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist') continue;
    const abs = join(dir, entry);
    const st = statSync(abs);
    if (st.isDirectory()) cssFiles(abs, out);
    else if (entry.endsWith('.css')) out.push(abs);
  }
  return out;
}

/** 从 tokens.css 读出每一档的数值（只认 `--ht-z-xxx: 123;` 这一种形状）。 */
export function readLadder(tokensCss) {
  const values = new Map();
  for (const m of stripComments(tokensCss).matchAll(/--ht-(z-[a-z-]+)\s*:\s*(\d+)\s*;/gu)) {
    if (!values.has(m[1])) values.set(m[1], Number(m[2]));
  }
  return values;
}

/** 判决本体（纯函数，self-test 直接喂夹具）。 */
export function judge({ tokensCss, decls }) {
  const problems = [];
  const values = readLadder(tokensCss);

  // Z1 顺序
  let previous = -1;
  for (const rung of LADDER) {
    const value = values.get(rung);
    if (value === undefined) {
      problems.push(`Z1 刻度表里缺档 ${rung} —— 顺序判不下去，别把它当"没这一档所以不用判"`);
      previous = -1;
      continue;
    }
    if (value <= previous) {
      problems.push(`Z1 刻度不单调：${rung}=${String(value)} 不大于上一档（=${String(previous)}）`);
    }
    previous = value;
  }

  // Z2 越级
  for (const [file, text] of decls) {
    for (const m of stripComments(text).matchAll(/z-index:\s*var\(--ht-([a-z-]+)\)/gu)) {
      if (RESERVED.has(m[1])) {
        problems.push(`Z2 ${file} 用 ${m[1]}(启动屏专用档) 画浮层 ⇒ 嵌在它里面的确认框永远压不住面板`);
      }
    }
  }

  // Z3 分母
  const total = decls.reduce((sum, [, text]) => {
    return sum + [...stripComments(text).matchAll(/z-index:\s*var\(--ht-[a-z-]+\)/gu)].length;
  }, 0);
  if (total < FLOOR_DECLARATIONS) {
    problems.push(`Z3 候选下限：只扫到 ${String(total)} 条 z-index 声明（< ${String(FLOOR_DECLARATIONS)}）—— 这把尺快瞎了`);
  }
  return { problems, total, values };
}

/* ── self-test ─────────────────────────────────────────────────── */

const GOOD_TOKENS = LADDER.map((rung, i) => `  --ht-${rung}: ${String((i + 1) * 100)};`).join('\n');

async function selfTest() {
  const arms = [];
  const push = (name, ok, detail) => arms.push({ name, ok, detail });

  // ① 干净表 + 干净声明 ⇒ 绿
  const clean = judge({ tokensCss: GOOD_TOKENS, decls: [['a.css', '.x { z-index: var(--ht-z-modal); }']] });
  push('① 单调刻度 + 无越级 ⇒ 绿', clean.problems.length === 0 || clean.problems.every((p) => p.startsWith('Z3')), clean.problems.join(' | '));

  // ② 把 popover 调到 modal-commitment 之上 ⇒ Z1 红
  const broken = LADDER.map((rung, i) => `  --ht-${rung}: ${String((i + 1) * 100)};`)
    .join('\n')
    .replace('  --ht-z-popover: 600;', '  --ht-z-popover: 750;');
  const r2 = judge({ tokensCss: broken, decls: [] });
  push('② popover 越过 modal-commitment ⇒ Z1 红', r2.problems.some((p) => p.startsWith('Z1')), r2.problems.join(' | '));

  // ③ 注入一枚启动屏越级 ⇒ Z2 红
  const r3 = judge({ tokensCss: GOOD_TOKENS, decls: [['b.css', '.dialog { z-index: var(--ht-z-splash); }']] });
  push('③ 功能 CSS 用 z.splash ⇒ Z2 红', r3.problems.some((p) => p.startsWith('Z2')), r3.problems.join(' | '));

  // ④ 反向那一半：splash 只出现在**注释**里 ⇒ 不许红（记录自己不算违规）
  const r4 = judge({ tokensCss: GOOD_TOKENS, decls: [['c.css', '/* P7 之前这一枚占的是 var(--ht-z-splash) */\n.d { z-index: var(--ht-z-modal); }']] });
  push('④ 注释里提到 z.splash ⇒ 不误伤', !r4.problems.some((p) => p.startsWith('Z2')), r4.problems.join(' | '));

  // ⑤ 缺档 ⇒ Z1 红（不许"没这一档所以不用判"）
  const r5 = judge({ tokensCss: GOOD_TOKENS.replace('  --ht-z-modal-commitment: 700;\n', ''), decls: [] });
  push('⑤ 刻度表少一档 ⇒ Z1 红（不是静默跳过）', r5.problems.some((p) => p.startsWith('Z1') && p.includes('modal-commitment')), r5.problems.join(' | '));

  // ⑥ 空扫描面 ⇒ Z3 红
  const r6 = judge({ tokensCss: GOOD_TOKENS, decls: [] });
  push('⑥ 零声明 ⇒ Z3 下限红（"什么都没看见"不许算绿）', r6.problems.some((p) => p.startsWith('Z3')), r6.problems.join(' | '));

  // ⑦ 拼错的旗标必须非 0 退
  let flagErr = '';
  try {
    await run(process.execPath, [join(here, 'check-z-ladder.mjs'), '--self-tset'], { encoding: 'utf8' });
  } catch (err) {
    flagErr = String(err?.stderr ?? err?.message ?? '');
  }
  push('⑦ 拼错的旗标 ⇒ 非 0 退', flagErr !== '', flagErr === '' ? '退出码 0（这把尺可能根本没跑）' : '非 0');

  let bad = 0;
  for (const arm of arms) {
    if (!arm.ok) bad += 1;
    console.log(`${arm.ok ? '  ✓' : '  ✘'} ${arm.name}${arm.ok ? '' : `  实际：${arm.detail}`}`);
  }
  if (bad > 0) {
    console.error(`self-test：${String(bad)} 枚臂不过。`);
    return true;
  }
  console.log(`self-test：${String(arms.length)} 枚臂全过。`);
  return false;
}

/* ── 入口 ───────────────────────────────────────────────────────── */

const args = process.argv.slice(2);
if (args.includes('--self-test')) {
  // 🔴 async 必须 await：不 await 的话臂一条都没跑、一个字没打印、退出码 0
  //（`check:menu-keyboard` 的装置缺陷 ② 就是这个形状）。
  process.exitCode = (await selfTest()) ? 1 : 0;
} else {
  const decls = cssFiles(join(ROOT, 'apps/web/src')).map((abs) => [
    relative(ROOT, abs),
    readFileSync(abs, 'utf8'),
  ]);
  const { problems, total } = judge({
    tokensCss: readFileSync(join(ROOT, TOKENS), 'utf8'),
    decls,
  });
  if (args.includes('--verbose')) console.log(`   现量：${String(decls.length)} 个 CSS 文件 · ${String(total)} 条 z-index 声明`);
  if (problems.length > 0) {
    for (const p of problems) console.log(`✘ ${p}`);
    console.error(`浮层刻度门禁：${String(problems.length)} 条不过。`);
    process.exitCode = 1;
  } else {
    console.log(`✅ 浮层刻度：${String(LADDER.length)} 档严格单调，功能 CSS 没有越级用启动屏档（声明 ${String(total)} 条）。`);
  }
}
