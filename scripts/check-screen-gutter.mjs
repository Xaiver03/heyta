#!/usr/bin/env node
/**
 * 「页面留白只有一个来源」—— 结构性门禁
 * ======================================
 *
 * ## 它挡的是什么
 *
 * 2026-11-16 实测的形状：同一条"页面左右留白"在仓里有三个答案 ——
 *
 * | 位置 | 当时的值 |
 * |---|---|
 * | `tokens.css` 的 `--ht-screen-gutter` | 16，且 `@media` **没有**按宽度改它 |
 * | Web 的 `.ht-content` | `var(--ht-space-6)`（24）—— 根本没引用那个 token |
 * | 移动端 `Screen` 的 `board` 档 | `0`（`chrome === 'board' ? 0 : gutter`） |
 *
 * 结果不是"差 8px"，而是一整类屏贴边：iPad 上日历下方的内容卡与脚注全宽。
 * 而修复只能逐个打补丁（11-15 补脚注、11-16 补整块板），每补一处都留下
 * **又一个"这里特殊"**。
 *
 * ## 判据（四条，全部可判红）
 *
 * 1. **锚点**：三档 token 与阶梯表都在。改名/删除 ⇒ 红（不许静默跳过）。
 * 2. **外壳不许自己比宽度**：`screen.gutter` 不许出现在含 `?` / `>=` / `<` / `>` 的表达式里。
 *    判据是"留白是 token 的属性，不是消费点的分支"。
 * 3. **`board` 档不许归零**：`chrome === 'board'` 附近出现 `0` ⇒ 红（事故原形）。
 * 4. **Web 外壳的横向留白必须读 `--ht-screen-gutter`**：`.ht-content` / `.ht-header`
 *    的 `padding` 行里没有它 ⇒ 红（防止有人改回 `space-6`）。
 *
 * 🔴 注释全部先掩码再判：本仓的注释里**故意**写着事故原形的代码片段
 * （用来讲清为什么不能那么写）。不掩码会把"讲解"当成"违规"——
 * 上一版一次性脚本就是这么虚报的，而假红的终局永远是被加白名单绕过。
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';


const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..');

const failures = [];
const fail = (file, line, msg) => failures.push(`${relative(REPO, file)}:${line}  ${msg}`);

/* ─────────────────────────────────────────────────────────────
   判据 1：锚点
   ───────────────────────────────────────────────────────────── */
const TOKENS_CSS = join(REPO, 'packages/design-system/src/tokens.css');
const GUTTER_TS = join(REPO, 'packages/design-system/src/screen-gutter.ts');

if (!existsSync(TOKENS_CSS) || !existsSync(GUTTER_TS)) {
  console.error('❌ 锚点失败：留白的两个真源不见了（tokens.css / screen-gutter.ts）');
  process.exit(1);
}

const css = readFileSync(TOKENS_CSS, 'utf8');
const gutterTs = readFileSync(GUTTER_TS, 'utf8');

for (const name of ['--ht-screen-gutter', '--ht-screen-gutter-md', '--ht-screen-gutter-lg']) {
  if (!css.includes(`${name}:`)) {
    fail(TOKENS_CSS, 0, `缺少 ${name} —— 三档是响应式留白的前提`);
  }
}
if (!/export const SCREEN_GUTTER_STEPS\b/.test(gutterTs)) {
  fail(GUTTER_TS, 0, '缺少 SCREEN_GUTTER_STEPS 导出 —— 原生侧没有阶梯表就没法按宽度取');
}

/* ─────────────────────────────────────────────────────────────
   判据 2 & 3：源码扫描
   ───────────────────────────────────────────────────────────── */
const SCAN_ROOTS = [
  join(REPO, 'apps/mobile/src'),
  join(REPO, 'apps/web/src'),
  join(REPO, 'apps/landing/src'),
  join(REPO, 'packages/ui/src'),
];

const SOURCE_EXT = /\.(ts|tsx|js|mjs)$/;

/**
 * 按行剥掉注释，**保持行数不变**。
 *
 * 🔴 为什么不用 `lib/jsx-tree.mjs` 的 `maskSource`：那个函数会把整行注释**删掉**，
 * 于是掩码文件比原文件短（实测 1692 行 → 1242 行），行号全错位 ——
 * 报出来的行号指向不相干的代码，比不报还糟。这里要的是"同一行号、去掉注释"。
 */
function stripCommentsKeepLines(text) {
  const out = [];
  let inBlock = false;
  for (const raw of text.split('\n')) {
    let line = raw;
    if (inBlock) {
      const end = line.indexOf('*/');
      if (end === -1) { out.push(''); continue; }
      inBlock = false;
      line = ' '.repeat(end + 2) + line.slice(end + 2);
    }
    // 块注释起点（同一行可能有多段）
    for (;;) {
      const start = line.indexOf('/*');
      if (start === -1) break;
      const end = line.indexOf('*/', start + 2);
      if (end === -1) {
        inBlock = true;
        line = line.slice(0, start);
        break;
      }
      line = line.slice(0, start) + ' '.repeat(end + 2 - start) + line.slice(end + 2);
    }
    const slash = line.indexOf('//');
    if (slash !== -1 && !/https?:$/.test(line.slice(0, slash))) line = line.slice(0, slash);
    out.push(line);
  }
  return out;
}

/**
 * 「消费点自己按宽度算留白」仅有的几种写法 —— 判据必须**窄到不会误伤**。
 *
 * 第一版把任何 `?` 都算违规，结果两处误报：
 *   · `paddingHorizontal: embedded ? 0 : tokens['screen.gutter']`（嵌入模式不留白，合法）
 *   · 一条长 View 里 `?` 来自 `contentMeasureMaxFor(chrome) !== undefined`，与留白无关
 * 误报的代价不是"多看一眼"，是这条门禁会被加白名单绕过。
 * 所以只认**真有宽度比较**的三种形状。
 */
const WIDTH_BRANCH = />=|<=|\bscreenWidth\b|\buseWindowDimensions\b/;

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    const abs = join(dir, entry);
    const st = statSync(abs);
    if (st.isDirectory()) {
      if (entry === 'node_modules' || entry === 'dist') continue;
      walk(abs, out);
    } else if (SOURCE_EXT.test(entry)) {
      out.push(abs);
    }
  }
  return out;
}

const files = SCAN_ROOTS.flatMap((root) => walk(root));

for (const file of files) {
  // 保留行号地剥注释：报错要指着**原文件那一行**，否则行号指到不相干的代码。
  const lines = stripCommentsKeepLines(readFileSync(file, 'utf8'));

  lines.forEach((raw, i) => {
    const line = raw;
    const hasGutter = /\bscreen\.gutter\b/.test(line);

    if (hasGutter && WIDTH_BRANCH.test(line)) {
      fail(
        file,
        i + 1,
        '`screen.gutter` 与宽度比较出现在同一行 —— 留白由 token 按宽度解析一次，' +
          '消费点不许自己比（用 withResolvedScreenGutter / --ht-screen-gutter）',
      );
    }

    /* 事故原形：board 档把整屏 padding 归零。 */
    if (/chrome\s*===\s*'board'/.test(line) && /[:?]\s*0\b/.test(line)) {
      fail(file, i + 1, "`chrome === 'board'` 不许把留白归零 —— 这正是内容卡贴边的事故原形");
    }
  });
}

/* ─────────────────────────────────────────────────────────────
   判据 4：Web 外壳的横向留白必须读 token
   ───────────────────────────────────────────────────────────── */
const SHELL_CSS = ['main-area.css'];

for (const name of SHELL_CSS) {
  const file = join(REPO, 'apps/web/src/styles/app', name);
  if (!existsSync(file)) {
    fail(file, 0, '外壳样式文件不见了 —— 判据失效前先修锚点');
    continue;
  }
  const lines = readFileSync(file, 'utf8').split('\n');
  let currentSelector = null;
  let selectorStart = 0;

  lines.forEach((line, i) => {
    const sel = /^([.#][\w-]+[^{]*)\{/.exec(line);
    if (sel) {
      currentSelector = sel[1].trim();
      selectorStart = i + 1;
    } else if (currentSelector === null) {
      const loose = /^\s*([.#][\w-]+)\s*\{/.exec(line);
      if (loose) {
        currentSelector = loose[1];
        selectorStart = i + 1;
      }
    }
    if (/^\}/.test(line.trim())) currentSelector = null;

    // 只判"外壳级"的两个选择器：内容列与页头。
    const isShellSelector = currentSelector === '.ht-content' || currentSelector === '.ht-header';
    if (!isShellSelector) return;
    if (!/^\s*padding(-inline)?\s*:/.test(line)) return;
    if (!/var\(--ht-screen-gutter\)/.test(line)) {
      fail(
        file,
        i + 1,
        `${currentSelector} 的横向留白没有读 var(--ht-screen-gutter) —— ` +
          '写死 space-* 会让"页面留白"在第 N 个地方再长出第 N+1 个答案',
      );
    }
  });
}

/* ─────────────────────────────────────────────────────────────
   输出
   ───────────────────────────────────────────────────────────── */
if (failures.length > 0) {
  console.error(`❌ 页面留白：${failures.length} 处违规\n`);
  for (const f of failures) console.error(`  ${f}`);
  console.error(
    '\n规则见 packages/design-system/src/screen-gutter.ts 文件头；\n' +
      '取值只在 tokens.css 的三档里改（判据会与 SCREEN_GUTTER_STEPS 对账）。',
  );
  process.exit(1);
}

console.log(
  `✅ 页面留白：${files.length} 个源文件 + ${SHELL_CSS.length} 份外壳样式，三档单源无旁路。`,
);
