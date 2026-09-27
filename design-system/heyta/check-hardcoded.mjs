#!/usr/bin/env node
/**
 * 设计变量硬编码检查器
 * =====================
 *
 * 为什么必须有它：规范写在文档里 = 没有规范。三个月后没人记得，
 * 组件里会重新长出 #2563EB 和 13px。这个检查让规范**可执行**。
 *
 * 检查项（apps/web 下的组件代码）：
 *   1. 裸 hex 颜色        → 必须用 var(--ht-color-*)
 *   2. 裸 px 尺寸         → 必须用 var(--ht-space-* / --ht-font-size-* / ...)
 *   3. 裸 ms/s 时长       → 必须用 var(--ht-duration-*)
 *   4. 裸 z-index 数字    → 必须用 var(--ht-z-*)
 *   5. 裸 rgb()/rgba()    → 例外见 ALLOW
 *
 * 设计原则：**宁可少报，不可误报。**
 * 上一轮我写死链检查器时，因误报（把文档里作为示例的链接当真链接）
 * 差点让人开始忽略它 —— 误报比漏报更致命。所以这里白名单是显式的、
 * 有注释说明的，而不是靠正则碰运气。
 *
 * 用法：
 *   node design-system/heyta/check-hardcoded.mjs
 *   node design-system/heyta/check-hardcoded.mjs --verbose
 */

import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join, dirname, resolve, relative, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const verbose = process.argv.includes('--verbose');

/**
 * 扫描范围。
 *
 * 🔴 这里是**全部客户端外壳**，不只是 Web。
 * 之前只有 `apps/web/src`，于是移动端（用户实际在用的那个 App）
 * 完全不受"组件禁止裸值"约束 —— 规则写了，但没在那个 App 上生效。
 * 新增平台壳时必须同步加进来。
 */
const SCAN_ROOTS = [
  { label: 'apps/web/src', path: join(ROOT, 'apps/web/src') },
  { label: 'apps/mobile/src', path: join(ROOT, 'apps/mobile/src') },
  // 落地页是**面向公众的界面**，裸色值/裸间距在这里的代价比在产品内部更高：
  // 它不受设计系统重构的保护，改一次 token 就会悄悄与产品界面脱节。
  { label: 'apps/landing/src', path: join(ROOT, 'apps/landing/src') },
  /**
   * 桌面壳（M2 Spike S2）。**今天就加上，而不是等它有 UI 再加** ——
   * 原因是上一轮 M0-4 实测出的教训：门禁的范围缺口**不会报错，只会静默失效**，
   * 而等到"有 UI 了再加"时，第一批 UI 代码已经写进去了。
   *
   * ⚠️ 如实说明当前覆盖：桌面壳现在只有 `main.ts` / `preload.ts` / `ipc-contract.ts`
   * 与一个**临时占位页** `renderer/index.html`。前者没有样式值；
   * 后者是 HTML，而 `SCAN_EXT` 不含 `.html`（见下方注释），所以**目前这一条基本是空的**。
   * 它的价值在于：M1 往这里放共享组件时，**覆盖从第一天就成立**。
   */
  { label: 'apps/desktop/src', path: join(ROOT, 'apps/desktop/src') },
].filter((r) => {
  if (existsSync(r.path)) return true;
  if (verbose) console.log(`⏭  ${r.label} 尚不存在，跳过。`);
  return false;
});

if (SCAN_ROOTS.length === 0) {
  console.log('⏭  没有任何客户端源码目录，跳过设计变量检查。');
  process.exit(0);
}

/**
 * 允许的例外，分两级。
 *
 * ⚠️ **区分这两级很重要**，我第一版只有行级豁免，结果"零值"规则
 * `\b0\b` 匹配到了 `rgba(0,0,0,0.5)` 里的 0，把**整行**都豁免了，
 * 于是裸 rgba 溜了过去。行级豁免必须只用于真正依赖上下文的场景。
 *
 * 每条都必须写 why —— 没有理由的例外会繁殖。
 */

/** 只对**匹配到的那段文本**生效。 */
const MATCH_ALLOW = [
  { re: /^0(px|rem|ms|s)?$/, why: '零值不需要单位' },
  { re: /^1px$/, why: '1px 发丝线是渲染细节，不是设计尺度' },
  { re: /^-\d+px$/, why: '负偏移微调（图标对齐）' },
  { re: /^[\d.]+(%|vw|vh|dvh|svh|ch|em)$/, why: '相对单位随上下文变化，不属于设计尺度' },
];

/** 需要对**整行**取上下文才能判断的。 */
const LINE_ALLOW = [
  { re: /@media[^;]*(min|max)-width/, why: '断点是固定设备宽度，不是设计尺度' },
  { re: /(viewBox|points|transform)=/, why: 'SVG 图形数据不是样式' },
  { re: /--ht-/, why: 'token 定义/引用' },
  { re: /^\s*(\/\/|\*|\/\*)/, why: '纯注释行' },
];

const CHECKS = [
  {
    name: '裸 hex 颜色',
    // #rgb / #rrggbb / #rrggbbaa，排除 CSS 选择器里的 id（#foo）与 URL 锚点
    re: /#[0-9a-fA-F]{3,8}\b/g,
    hint: '用 var(--ht-color-*)，缺哪个就往 tokens.css 加',
    // 只匹配合法的 hex 长度
    validate: (m) => [4, 5, 7, 9].includes(m.length),
  },
  {
    name: '裸 px 尺寸',
    re: /(?<![\w-])\d+(?:\.\d+)?px\b/g,
    hint: '用 var(--ht-space-* / --ht-font-size-* / --ht-radius-* / --ht-icon-*)',
  },
  {
    name: '裸 RN 尺度数字',
    /**
     * RN **没有 `px`，也没有 `var()`** —— 间距 / 圆角 / 字号写的是**无单位数字**。
     * 于是上面那条 `px` 规则在移动端**完全失效**。
     *
     * 🔴 实测（2026-09-27，探针文件含 `color:'#2563EB'` + `padding:16` +
     * `borderRadius:12` + `fontSize:15`）：**4 处硬编码只报出 1 处** ——
     * 裸 hex 被拦住，三个无单位数字全部漏过。补的就是这个缺口。
     *
     * ⚠️ 属性集**刻意收窄**，这是量出来的取舍，不是随手挑的：
     *
     *   | 属性集 | 命中 | 性质 |
     *   |---|---|---|
     *   | 窄集（本规则）：padding/margin/borderRadius/fontSize/gap | **6 处 / 1 文件** | **全部是真违规，零误报** |
     *   | 宽集（再加 opacity/width/height/top…） | 29 处 / 9 文件 | 16 处是 `opacity`、5 处 `minWidth`、8 处 `top`/`bottom` —— **大多是合法布局值** |
     *
     * 本文件头写着"**宁可少报，不可误报**"，所以只收窄集。
     * 被**有意排除**的属性及理由：`opacity` 是比例不是尺度；
     * `width`/`height`/`minWidth` 常由内容或屏幕驱动；`top`/`bottom`/`left`/`right`
     * 是定位偏移；`borderWidth` 是发丝细节（与 CSS 侧 `1px` 例外同理）。
     *
     * `\b` 顺带排除了 `16px` / `12rem`（数字后紧跟字母处没有词边界），
     * 所以**不会与上面的 `px` 规则重复报同一处**。
     *
     * ⚠️ **零值必须在正则里排除，不能靠 ALLOW**：本规则的 `m[0]` 包含
     * **属性名**（`"padding: 0"`），而 `MATCH_ALLOW` 的
     * `/^0(px|rem|ms|s)?$/` 是针对**值**写的 —— 拿 `"padding: 0"` 去比
     * 永远比不中。我第一版就是这样，结果 `apps/web/src/styles/app.css` 里
     * 35 处 `padding: 0` / `margin: 0` **全部误报**。
     * `(?!0(?![.\d]))` 精确排除「孤立的 0」，但**保留 `0.5` 之类的小数**。
     */
    re: /(?<![\w.-])(?:padding|paddingTop|paddingBottom|paddingLeft|paddingRight|paddingHorizontal|paddingVertical|margin|marginTop|marginBottom|marginLeft|marginRight|marginHorizontal|marginVertical|borderRadius|borderTopLeftRadius|borderTopRightRadius|borderBottomLeftRadius|borderBottomRightRadius|fontSize|gap|rowGap|columnGap)\s*:\s*(?!0(?![.\d]))\d+(?:\.\d+)?\b/g,
    hint: "RN 侧用 tokens['space.*'] / tokens['radius.*'] / tokens['font-size.*']（`useTokens()` 拿）",
  },
  {
    name: '裸动效时长',
    re: /(?<![\w-])\d+(?:\.\d+)?m?s\b/g,
    hint: '用 var(--ht-duration-*)，并配 var(--ht-ease-*)',
  },
  {
    name: '裸 z-index',
    // 同时匹配 CSS 的 `z-index:` 与 JSX 的驼峰 `zIndex:` —— 只认前者会漏掉
    // 全部 React 行内样式，而那正是最容易写裸值的地方（实测漏过 zIndex: 999）。
    re: /(?:z-index|zIndex)\s*:\s*-?\d+/g,
    hint: '用 var(--ht-z-*)，阶梯已在 tokens.css 定义',
  },
  {
    name: '裸颜色函数',
    // rgba(0,0,0,0.5) 这类；若确需要，应进 tokens.css（如 --ht-color-overlay）
    re: /rgba?\(\s*\d+\s*[\s,]\s*\d+\s*[\s,]\s*\d+/g,
    hint: '用 var(--ht-color-*)，半透明色也要登记为 token',
  },
];

const SCAN_EXT = new Set(['.ts', '.tsx', '.js', '.jsx', '.css']);

/**
 * ⚠️ `.html` **刻意不在扫描范围内**，理由是风险不对称：
 *
 * 打开它会让 web / landing / desktop 三处的 HTML 一次性进入检查，
 * 而 HTML 里合法存在大量非设计尺度的值（`width="1100"`、`viewBox`、邮件模板内联样式等），
 * 很可能**先制造一批误报**。而本文件头的原则是"误报比漏报更致命"。
 *
 * 所以这条留在"想做但要先量"的清单上 —— 与 M0-4 补 RN 规则时同样的做法：
 * **先量命中数，再决定严格度**，不要直接开。
 */

function collect(dir) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (['node_modules', 'dist', '.git', 'coverage'].includes(e.name)) continue;
      out.push(...collect(p));
    } else if (SCAN_EXT.has(extname(e.name))) {
      out.push(p);
    }
  }
  return out;
}

function allowed(line, match) {
  if (MATCH_ALLOW.some((a) => a.re.test(match))) return true;
  return LINE_ALLOW.some((a) => a.re.test(line));
}

const files = SCAN_ROOTS.flatMap((r) => collect(r.path));
const problems = [];
let checked = 0;

for (const file of files) {
  // token 定义文件是产地，不检查；生成的类型文件同理
  const rel = relative(ROOT, file);
  if (rel.includes('tokens.css') || rel.includes('tokens.generated')) continue;

  checked++;
  const raw = readFileSync(file, 'utf8');

  // 🔴 先剥掉跨行的 /* ... */ 块注释，**保留行数**（用换行填充）。
  //
  // 为什么必须做：只跳"行首注释"时，块注释的**中间行**（以空格+文字开头）
  // 不会被识别，里面的 `1ms` 会被当成裸值报出来。
  // 我实际踩到了这个误报。误报的危害不是烦人 —— 是它会训练人去放宽
  // ALLOW 列表，而放宽之后真正的违规就再也拦不住了。
  //
  // 用等量换行替换，保证后面报出的行号仍然准确。
  const source = raw.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
  const lines = source.split('\n');

  lines.forEach((line, i) => {
    // 整行注释跳过（但行尾注释仍检查，因为代码部分可能违规）
    const code = line.replace(/^\s*(\/\/|\*|\/\*).*$/, '');
    if (!code.trim()) return;

    for (const check of CHECKS) {
      for (const m of code.matchAll(check.re)) {
        const text = m[0];
        if (check.validate && !check.validate(text)) continue;
        if (allowed(line, text)) continue;
        problems.push({
          file: rel,
          line: i + 1,
          text,
          kind: check.name,
          hint: check.hint,
        });
      }
    }
  });
}

console.log(
  `\n扫描 ${checked} 个源文件（${SCAN_ROOTS.map((r) => r.label).join(' + ')}），检查 ${CHECKS.length} 类硬编码。`,
);

if (verbose) {
  console.log(`跳过 ${files.length - checked} 个 token 定义文件。`);
}

if (problems.length) {
  // 按文件分组，便于修
  const byFile = new Map();
  for (const p of problems) {
    if (!byFile.has(p.file)) byFile.set(p.file, []);
    byFile.get(p.file).push(p);
  }

  console.log(`\n🔴 ${problems.length} 处硬编码设计变量：\n`);
  for (const [file, list] of byFile) {
    console.log(`   ${file}`);
    for (const p of list.slice(0, 8)) {
      console.log(`      ${p.line}: ${p.text}  ← ${p.kind}`);
    }
    if (list.length > 8) console.log(`      …还有 ${list.length - 8} 处`);
  }
  console.log(`\n   修法：${CHECKS[0].hint}`);
  console.log(`   若确属合理例外，把理由加进 check-hardcoded.mjs 的 ALLOW（必须写 why）。\n`);
  process.exit(1);
}

console.log('\n✅ 无硬编码设计变量。\n');
