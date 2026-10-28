#!/usr/bin/env node
/**
 * `pnpm check:chip-typing` —— 胶囊（chip）的**分型**判据（全局 UX 线 P7）
 * =====================================================================
 *
 * ## 这一枚治的是什么
 *
 * `.ht-chip` 这一族今天同时被两种东西用着，而它们的下限**不是一回事**：
 *
 *   · **可点的动作** —— 任务行里那排"截止 / 子任务 / 备注 / 提醒 / AI"，
 *     载体是 `<button>` 或 `<summary>`。它们要够到触控下限
 *     （`--ht-touch-target-min` = 44px，`ai-panels.css:363` 那句注释把它叫"可访问性硬下限"）。
 *   · **只读的徽标** —— "这一行写过东西 / 有 N 个子任务"那几颗，载体是 `<span>`。
 *     它们**不许**跟着长高，否则每一行都被一个不能点的东西撑开。
 *
 * 两种都吃 `.ht-chip` 那一份盒模型（11px 字 + `space-1` 上下内边距 ⇒ 实测 ~20px），
 * 于是"触控目标太小"与"徽标要保持紧凑"是**同一份样式在互相拉扯** ——
 * 谁去改它都会撞另一边。`ai-panels.css:57` 那段产品负责人的话记的就是这个：
 * "触控目标 ~20px"。分型之后各有下限：动作那一档 `--action`，徽标那一档不动。
 *
 * ## 四臂（每臂各治一种漏法）
 *
 *   C1 可点元素带 `ht-chip` 却没带 `--action` ⇒ 红（就是立项现量那五格）。
 *   C2 只读元素带 `--action` ⇒ 红。反向那一半治的是"为了过 C1 把整排都撑成 44px" ——
 *      那等于把缺陷换成另一种形状，而计划 §P7 明写"不能把所有 chip 都撑成 44px"。
 *   C3 `.ht-chip--action` 在 CSS 里不存在，或它的高不来自那枚 token ⇒ 红。
 *      这一臂治"类名贴对了但没人给它画样式"（幻影类）与"把 44 写成裸值"。
 *   C4 候选下限：扫到的 chip 落点数低于今天的现量 ⇒ 红。
 *      没有它，一次选择器写错会让门禁"什么都没看见"地绿过去。
 *
 * 🔴 元素种类是按 **JSX 树的开标签**判的（`scripts/lib/jsx-tree.mjs`），不是按"文件里
 * 出现过 button 字样"。理由与本仓反复吃过的那条亏同形：按子串判会把 CSS 选择器、
 * 注释、以及别的元素的属性读成这一件的形状（`check:menu-keyboard` 的装置缺陷 ① 就是它）。
 *
 * ## 已知边界（在册，不装作没有）
 *
 * 大写开头的组件（`<SomeChip className="ht-chip">`）**跳过**：门禁不知道它渲染成什么元素，
 * 硬判会把"传 className 给一个 `<span>` 组件"读成缺陷。今天全仓这类落点 0 处
 * （现量见 `--verbose` 的计数），将来若出现，它落在 C4 的分母之外 —— 那一格由看图负责。
 */

import { execFile } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { findTagEnd, lineAt, maskSource, scanJsxTree } from './lib/jsx-tree.mjs';

const run = promisify(execFile);
const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const here = dirname(fileURLToPath(import.meta.url));

/** 今天真实存在的可点/只读两种载体。自定义组件（首字母大写）刻意不在任何一边。 */
const INTERACTIVE = new Set(['button', 'a', 'summary']);
const READONLY = new Set(['span', 'div', 'p', 'li', 'td', 'th', 'label']);

const CSS_FILE = 'apps/web/src/styles/app/ai-panels.css';
const TOKEN = '--ht-touch-target-min';

/** 今天的现量（2026-10-28 那一趟逐枚数出来的）；只许当**下限**用，不许当期望值抄。 */
const FLOORS = { chipSites: 9, interactiveSites: 6 };

function sourceFiles(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const abs = join(dir, entry);
    const st = statSync(abs);
    if (st.isDirectory()) sourceFiles(abs, out);
    else if (entry.endsWith('.tsx')) out.push(abs);
  }
  return out;
}

/**
 * 取一个 JSX **开标签**的原文（`<button … >` 那一段），用来读它自己那格 className。
 *
 * 🔴 不能直接用 `node.end`：`scanJsxTree` 给开/闭标签配对的那个 `end` 是**整个元素子树的末尾**
 * （它靠 `stack.pop().end = gt + 1` 在闭标签处收口），拿它当"开标签结束"会把这一族的
 * **所有后代**都读进来 —— 于是一枚 `<div>` 会因为里面躺着一枚带 `--action` 的 button 而被
 * 判成"只读元素被撑高"。这一枚 self-test 臂 ① 第一次就是这么红的（干净夹具读成 C2），
 * 修的是探针自己，不是把期望改成"就该红"。开标签的终点用 `findTagEnd` 现算。
 */
function openTagOf(structural, text, node) {
  const gt = findTagEnd(structural, node.start);
  return text.slice(node.start, gt === -1 ? node.start + 1 : gt + 1);
}

/**
 * 扫一份源码里的 chip 落点。
 * @returns {{ tag: string, line: number, action: boolean, interactive: boolean }[]}
 */
export function scanChipSites(text) {
  const { structural } = maskSource(text);
  const { nodes } = scanJsxTree(text);
  const sites = [];
  for (const node of nodes) {
    const tag = openTagOf(structural, text, node);
    if (!tag.includes('ht-chip')) continue;
    // 注释与字符串已经被 maskSource 抹掉，所以这里读到的都是真代码。
    if (!/[A-Za-z]/.test(node.name[0] ?? '')) continue;
    if (node.name[0] === node.name[0].toUpperCase()) continue; // 自定义组件：跳过（见文件头边界）
    sites.push({
      tag: node.name,
      line: lineAt(text, node.start),
      action: /ht-chip--action/.test(tag),
      interactive: INTERACTIVE.has(node.name.toLowerCase()),
    });
  }
  return sites;
}

/** 剥掉 CSS 注释：注释里出现 `cursor: pointer` 是**在讲历史**，不是这一族今天还带着它。 */
function stripCssComments(css) {
  return css.replaceAll(/\/\*[\s\S]*?\*\//gu, '');
}

/** CSS 那一侧：`--action` 必须存在，且它的高来自那枚 token 而不是裸值。 */
export function cssProblems(rawCss) {
  const css = stripCssComments(rawCss);
  const problems = [];
  const rule = /\.ht-chip--action\s*\{([^}]*)\}/u.exec(css);
  if (rule === null) {
    problems.push('C3 CSS 里没有 .ht-chip--action 这一条规则 ⇒ 界面贴了类名也没人给它画样式（幻影类）');
    return problems;
  }
  const body = rule[1];
  if (!body.includes('min-block-size') || !body.includes(`var(${TOKEN})`)) {
    problems.push(`C3 .ht-chip--action 的高不来自 ${TOKEN}（要么写了裸值，要么根本没设下限）`);
  }
  const base = /\.ht-chip\s*\{([^}]*)\}/u.exec(css);
  if (base !== null && /cursor:\s*pointer/u.test(base[1])) {
    problems.push('C3 `.ht-chip` 基档上还留着 `cursor: pointer` ⇒ 只读徽标也在承诺"我可点"');
  }
  return problems;
}

/** 判决本体（纯函数：self-test 直接喂夹具，不碰真树）。 */
export function judge({ files, css, verbose = false }) {
  const problems = [];
  let chipSites = 0;
  let interactiveSites = 0;
  const report = [];
  for (const { path, text } of files) {
    for (const site of scanChipSites(text)) {
      chipSites += 1;
      if (site.interactive) interactiveSites += 1;
      report.push(`${path}:${String(site.line)} <${site.tag}>${site.action ? ' +action' : ''}`);
      if (site.interactive && !site.action) {
        problems.push(`C1 ${path}:${String(site.line)} 是 <${site.tag}>（可点）却只带 ht-chip ⇒ 触控目标停在 ~20px 那一档`);
      }
      if (!site.interactive && site.action) {
        problems.push(`C2 ${path}:${String(site.line)} 是 <${site.tag}>（只读）却带了 ht-chip--action ⇒ 徽标被撑高，每一行都跟着长`);
      }
    }
  }
  problems.push(...cssProblems(css));
  if (chipSites < FLOORS.chipSites) {
    problems.push(`C4 候选下限：只扫到 ${String(chipSites)} 处 chip 落点（< ${String(FLOORS.chipSites)}）—— 扫描面或写法变了，这把尺快瞎了`);
  }
  if (interactiveSites < FLOORS.interactiveSites) {
    problems.push(`C4 候选下限：只扫到 ${String(interactiveSites)} 处**可点** chip（< ${String(FLOORS.interactiveSites)}）—— 可点那一族没人判了`);
  }
  if (verbose) console.log(`   现量：chip 落点 ${String(chipSites)} 处 · 其中可点 ${String(interactiveSites)} 处`);
  return { problems, report, chipSites, interactiveSites };
}

/* ── self-test：每臂都要在违规夹具下真的红 ───────────────────────── */

const CLEAN = `<div>\n  <button type="button" className="ht-chip ht-chip--action">截止</button>\n  <span className="ht-chip">3</span>\n</div>\n`;
const MISSING_ACTION = `<div>\n  <button type="button" className="ht-chip">备注</button>\n  <span className="ht-chip">3</span>\n</div>\n`;
const BADGE_GROWN = `<div>\n  <button type="button" className="ht-chip ht-chip--action">截止</button>\n  <span className="ht-chip ht-chip--action">3</span>\n</div>\n`;
const SUMMARY_KIND = `<details>\n  <summary className="ht-chip">子任务</summary>\n</details>\n`;

function fixtureFiles(text) {
  // 夹具同时喂够 C4 的分母：把同一份源码重复计入 N 枚文件，
  // 这样 self-test 量的是"C1/C2 各自抓不抓得到"，而不是"下限顺带红了一条"。
  return Array.from({ length: FLOORS.chipSites }, (_, i) => ({ path: `f${String(i)}.tsx`, text }));
}

const GOOD_CSS = `.ht-chip {\n  font-size: var(--ht-font-size-2xs);\n}\n.ht-chip--action {\n  min-block-size: var(${TOKEN});\n  cursor: pointer;\n}\n`;

async function selfTest() {
  const arms = [
    { name: '① 干净树（可点带 --action、徽标不带）⇒ 绿', files: fixtureFiles(CLEAN), css: GOOD_CSS, expect: [] },
    { name: '② 可点 chip 没带 --action ⇒ 只红 C1', files: fixtureFiles(MISSING_ACTION), css: GOOD_CSS, expect: ['C1'] },
    { name: '③ 只读徽标带了 --action ⇒ 只红 C2（反向那一半）', files: fixtureFiles(BADGE_GROWN), css: GOOD_CSS, expect: ['C2'] },
    { name: '④ <summary> 也算可点载体 ⇒ C1 抓得到', files: fixtureFiles(SUMMARY_KIND), css: GOOD_CSS, expect: ['C1'] },
    { name: '⑤ CSS 里没有 --action 规则 ⇒ C3 红（幻影类）', files: fixtureFiles(CLEAN), css: '.ht-chip { font-size: 1px; }', expect: ['C3'] },
    { name: '⑥ --action 写裸值 44px ⇒ C3 红（下限要来自 token）', files: fixtureFiles(CLEAN), css: '.ht-chip--action { min-block-size: 44px; }', expect: ['C3'] },
    { name: '⑦ 基档还留 cursor:pointer ⇒ C3 红（徽标不许承诺可点）', files: fixtureFiles(CLEAN), css: `.ht-chip { cursor: pointer; }\n${GOOD_CSS}`, expect: ['C3'] },
    { name: '⑧ 空树 ⇒ C4 下限红（不许"什么都没看见"地绿）', files: [], css: GOOD_CSS, expect: ['C4'] },
  ];
  let bad = 0;
  for (const arm of arms) {
    const { problems } = judge({ files: arm.files, css: arm.css });
    const codes = [...new Set(problems.map((p) => p.slice(0, 2)))];
    const ok = arm.expect.length === 0 ? codes.length === 0 : arm.expect.every((c) => codes.includes(c));
    if (!ok) bad += 1;
    console.log(`${ok ? '  ✓' : '  ✘'} ${arm.name}${ok ? '' : `  实际 codes=${codes.join(',') || '（无）'}`}`);
  }
  // ⑨ 拼错的旗标必须非 0 退（否则"门禁自己从没跑过"这种绿没人发现）。
  let flagErr = '';
  try {
    await run(process.execPath, [join(here, 'check-chip-typing.mjs'), '--self-tset'], { encoding: 'utf8' });
  } catch (err) {
    flagErr = String(err?.stderr ?? err?.message ?? '');
  }
  const flagOk = flagErr !== '';
  if (!flagOk) bad += 1;
  console.log(`${flagOk ? '  ✓' : '  ✘'} ⑨ 拼错的旗标 ⇒ 非 0 退（实际 ${flagOk ? '非 0' : '0'}`);
  if (bad > 0) {
    console.error(`self-test：${String(bad)} 枚臂不过。`);
    process.exitCode = 1;
    return true;
  }
  console.log(`self-test：${String(arms.length + 1)} 枚臂全过。`);
  return false;
}

/* ── 入口 ───────────────────────────────────────────────────────── */

const args = process.argv.slice(2);
/*
 * 🔴 拼错的旗标必须**拒跑**，不许静默掉进"跑真树"那一支然后退出 0 ——
 * 那等于"门禁自己从没跑过"这种绿（下面第 ⑨ 枚自测臂钉的就是这一格，
 * 而它在这一版脚本里第一次读回来是不过的：臂先写了、闸门没补）。
 */
const KNOWN_FLAGS = ['--self-test', '--verbose'];
const unknownFlags = args.filter((a) => !KNOWN_FLAGS.includes(a));
if (unknownFlags.length > 0) {
  console.error(`不认识的旗标：${unknownFlags.join(' ')}（本门禁只吃 ${KNOWN_FLAGS.join(' / ')}）`);
  process.exit(2);
}
if (args.includes('--self-test')) {
  // 🔴 selfTest 是 async：不 await 就等于"九枚臂一条都没跑、一个字没打印、退出码 0"
  //（`check:menu-keyboard` 的装置缺陷 ② 就是这个形状，别再犯一次）。
  process.exitCode = (await selfTest()) ? 1 : 0;
} else {
  const { problems, chipSites, interactiveSites } = judge({
    files: sourceFiles(join(ROOT, 'apps/web/src')).map((abs) => ({
      path: relative(ROOT, abs),
      text: readFileSync(abs, 'utf8'),
    })),
    css: readFileSync(join(ROOT, CSS_FILE), 'utf8'),
    verbose: args.includes('--verbose'),
  });
  if (problems.length > 0) {
    for (const p of problems) console.log(`✘ ${p}`);
    console.error(`chip 分型门禁：${String(problems.length)} 条不过（现量 chip 落点 ${String(chipSites)} 处 · 可点 ${String(interactiveSites)} 处）。`);
    process.exitCode = 1;
  } else {
    console.log(`✅ chip 分型：可点那一族都带 --action，只读徽标没被撑高，下限来自 ${TOKEN}。`);
  }
}
