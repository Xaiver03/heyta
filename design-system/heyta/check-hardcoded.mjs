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
 *   6. 裸 rem 设计尺度    → 只查有 token 组的属性（间距/字号/圆角/字距）
 *   7. 裸 blur( 模糊半径  → 必须用 var(--ht-blur-*)
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
  /**
   * 🔴 共享 UI（M1）。**必须在写第一个组件的同时就加上**。
   *
   * 这一条比其他几条都关键：`packages/ui` 里的组件会被**四个端同时渲染**，
   * 所以一个裸色值/裸间距不是"错一次"，而是**一次错四个端**。
   *
   * 而它原本正好落在扫描范围之外 —— 上面四条 `apps/<应用>/src` 谁都不覆盖 `packages/`。
   * 这正是本文件反复吃亏的那类失效：范围缺口**不报错，只会静默失效**。
   * （`apps/desktop/src` 那条也是同样的理由提前加的，见上方注释。）
   */
  { label: 'packages/ui/src', path: join(ROOT, 'packages/ui/src') },
  // 落地页是**面向公众的界面**，裸色值/裸间距在这里的代价比在产品内部更高：
  // 它不受设计系统重构的保护，改一次 token 就会悄悄与产品界面脱节。
  { label: 'apps/landing/src', path: join(ROOT, 'apps/landing/src') },
  /**
   * 桌面壳（M2 Spike S2）。**今天就加上，而不是等它有 UI 再加** ——
   * 原因是上一轮 M0-4 实测出的教训：门禁的范围缺口**不会报错，只会静默失效**，
   * 而等到"有 UI 了再加"时，第一批 UI 代码已经写进去了。
   */
  { label: 'apps/desktop/src', path: join(ROOT, 'apps/desktop/src') },
  /**
   * 🔴 桌面端的**渲染层**（M2-2b）。它和上面的 `apps/desktop/src` 是**两个目录**，
   * 上面那条**盖不住它**。
   *
   * 这一条是"范围缺口只会静默失效"的**第二次**发生：
   * 原来这里写的是"渲染页是 `.html`，而 `SCAN_EXT` 不含 `.html`，所以覆盖基本是空的" ——
   * 那个说法**当时是对的**。但渲染层已经换成 `.tsx`（`renderer/main.tsx`），
   * 于是那句注释变成了一条**过期的免责说明**：
   * 它描述的前提没了，而缺的覆盖**没有任何东西会提醒你**。
   *
   * 教训：注释里"当前覆盖是空的，因为 X"这种话**自带保质期**，
   * 一旦 X 变了，它就从解释变成了伪装。
   */
  { label: 'apps/desktop/renderer', path: join(ROOT, 'apps/desktop/renderer') },
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
  {
    // JS 侧的 `matchMedia` 查询串（`apps/web/src/features/shell/detail-pane-visible.ts`）。
    // 上面那条只认 `@media`，而媒体查询的**特征值不接受 var()** —— 断点写进 JS 只能是字面量，
    // 没有"改成 token"这条路（`var(--ht-*)` 在 `min-width:` 位置是无效声明，整条查询会被丢弃）。
    // 🔴 这不是"放行一份抄件"：那一串与 `narrow.css` 三条隐藏规则的同源关系有常驻判据
    //    （`apps/web/tests/note-editor-placement.spec.tsx` 的 P1 第一条，变异臂 A5 改一个数就红）。
    re: /\((?:min|max)-(?:width|height):/,
    why: 'matchMedia 查询串里的断点：媒体特征值不能用 var()，同源由判据钉住',
  },
  { re: /(viewBox|points|transform)=/, why: 'SVG 图形数据不是样式' },
  { re: /--ht-/, why: 'token 定义/引用' },
  { re: /^\s*(\/\/|\*|\/\*)/, why: '纯注释行' },
  {
    re: /clamp\(/,
    why: '流式排版的插值上下限随视口策略变化，不是单一设计尺度',
  },
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
  {
    name: '裸 rem 设计尺度',
    /**
     * 🔴 rem 是 px 的替身（1rem = 16px），px 被拦之后 rem 就是下一个绕行口。
     * 实证（2026-10-01 UI 审计 G3）：`blur(0.25rem)` 从这条缝里漏过 ——
     * 4px 与 20px 是两种完全不同的模糊度，视觉 bug 级漂移。
     *
     * ⚠️ 属性集**刻意收窄**到「有 token 组的设计尺度」：间距（space.*）、
     * 字号（font-size.*）、圆角（radius.*）、字距（tracking.*）。
     * 被**有意排除**的属性（width/height/inline-size/block-size/网格列宽/
     * perspective/动效位移）是**布局尺寸**，设计系统没有对应 token 组，
     * 全禁会立刻制造约 40 处误报（2026-10-01 实测全仓命中分布）——
     * 与 RN 无单位规则排除 width/height 是同一条理由。
     * 收窄版上线时实测命中：**0 处**（零误报起步，只拦未来漂移）。
     *
     * `clamp(` 走 LINE_ALLOW：流式排版的插值上下限不是单一尺度。
     */
    re: /(?:padding|margin|gap|font-size|border-radius|letter-spacing)[\w-]*\s*:\s*[^;{}]*?[\d.]+rem/g,
    hint: '用 var(--ht-space-* / --ht-font-size-* / --ht-radius-* / --ht-tracking-*)；rem 与 px 同罪',
  },
  {
    name: '裸 blur( 模糊半径',
    /**
     * 模糊半径是设计系统里少数「单位即语义」的 token（--ht-blur-chrome 20px /
     * --ht-blur-sheet 30px），字面半径意味着出现第二套模糊档位 ——
     * 4px 与 20px 肉眼可辨，玻璃质感会从此对不齐（2026-10-01 P0-2 修掉的那处
     * `blur(0.25rem)` 就是实例）。只认字面数字；blur(var(...)) 不在本规则眼里。
     */
    re: /blur\(\s*[\d.]+[a-z%]*/g,
    hint: '用 var(--ht-blur-chrome / --ht-blur-sheet)；新档位先加进 tokens.css',
  },
  {
    name: '裸 icon size prop',
    /**
     * 🔴 lucide 的 `size` prop 走 SVG 的 width/height **属性**，属性值不解析
     * `var()` —— 所以 CSS 值规则管不到它，图标尺寸在 prop 上长出了第二套
     * 随手值。2026-10-01 UI 审计 G4 实测：全仓 **207 处**（web 157 + landing 49
     * + helper 自述 1），其中 85 处 12px **低于设计系统的图标下限 icon-xs=14**。
     *
     * 修法不是回 CSS 变量（做不到），而是**数值常量**：
     *   web    → `import { ICON_SIZE } from '<相对路径>/lib/icon-size'`
     *   landing → 同名助手（apps/landing/src/lib/icon-size.ts）
     * 两份都从 `lightTokens`（tokens.css 生成物）取值，不构成第二事实源。
     * 上线时全仓已收敛到阶梯（12/13→xs、15→sm、18→md、40→xl），命中 0。
     */
    re: /size=\{[\d.]+\}/g,
    hint: '用 ICON_SIZE.xs/sm/md/lg/xl（lib/icon-size）；12px 低于设计系统图标下限 14',
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

/**
 * 🔴 web 壳的「成对自拼排版」登记表（P0-5，2026-10-02）。
 *
 * 排版纪律（MASTER.md §13）：字号+字重+行高+字距应当**整条**消费语义档位
 * （`.ht-type-*`，由 TEXT_STYLES 生成）；在规则里单独拼 font-size + font-weight
 * 就是"有 token、无档位"——行高与字距不随行携带，漂移无判据。
 *
 * 但档位表**刻意只有 11 个**（"每多一个样式就多一个模糊地带"），而 web 壳的
 * 真实层级是它的超集（页标题 xl+semibold、按钮 sm+medium、品牌 lg+bold……）。
 * 逐点实测（2026-10-02）：27 个成对 CSS 规则里只有 5 个能**无损**映射到现有
 * 档位（已迁，见 ht-type-caption/panel-title/badge 的 JSX 成对用法）；其余的
 * 取值组合在档位表里**不存在**——强行迁移=改视觉（违反 P0"不动视觉风格"），
 * 给表加 22 档=摧毁"刻意不多"原则。
 *
 * ⇒ 裁决：现存组合**登记在册**（本表），新增组合即红。本表**只许删不许加**——
 *   哪天档位表扩了或元素改用了语义档位，就从这里删一行。
 * ⚠️ 只扫 web 壳（apps/web/src）：RN 侧经 useText() 已有档位纪律；
 *   landing 的 mockup 是静态复刻件，有自己的取值纪律。
 */
/**
 * 2026-10-02 起 app.css 拆成聚合器 + ./app/*.css 模块（规则逐字未动）。
 * 豁免表仍锚在聚合器路径上 —— 模块文件在比对前先归一化回去：
 * 组合数一个不多、一个不少，改的只是"同一份 CSS 换了个文件名"。
 */
const canonicalHostCss = (rel) =>
  rel.startsWith('apps/web/src/styles/app/') ? 'apps/web/src/styles/app.css' : rel;

const PAIRED_TYPOGRAPHY_ALLOW = [
  // app.css —— 档位表外的桌面层级（每个组合一条；说明写在行尾）
  { file: 'apps/web/src/styles/app.css', combo: 'lg+bold', why: '品牌字（ht-brand）：品牌资产，不套语义档位' },
  // `2xs+semibold` 这一行已于 2026-10-02 **删掉**：它是侧栏分组头
  // （`.ht-nav__section`）的三条手写排版值，理由是"档位表无 2xs 档"。
  // 现在档位表有了 `group-label`（sm+semibold），四件套搬进 JSX 的
  // `.ht-type-group-label` —— 这正是本表"只许删不许加"要的那个删。
  { file: 'apps/web/src/styles/app.css', combo: '2xs+medium', why: '日历迷你月的周次头（一二三四五六日）：2xs 微标签，档位表无 2xs 档' },
  { file: 'apps/web/src/styles/app.css', combo: 'xl+semibold', why: '页标题（AGENTS §5 层级表）：移动 screen-title 是 30/700，不等值' },
  { file: 'apps/web/src/styles/app.css', combo: 'sm+medium', why: '按钮/导航项/Tab 的桌面基准：档位表无 sm 档' },
  { file: 'apps/web/src/styles/app.css', combo: 'sm+semibold', why: '卡片内小标题（sm 级）：档位表无 sm 档' },
  { file: 'apps/web/src/styles/app.css', combo: 'base+medium', why: '空态标题/卡片标题：档位表无 base+medium（numeric-body 带 tabular 语义不合）' },
  { file: 'apps/web/src/styles/app.css', combo: 'base+semibold', why: '管理台 h4：与 headline 同值，元素是 CSS 类不是 JSX，暂留' },
  { file: 'apps/web/src/styles/app.css', combo: 'lg+semibold', why: '管理台统计值：语义上是数字档（numeric-display 为 4xl，不等值）' },
  { file: 'apps/web/src/styles/app.css', combo: 'xs+medium', why: 'ht-viewtab：全仓当前零消费者（疑似 IA 重构遗留），迁移无 JSX 可配' },
];

/** 从 CSS 规则体与 TSX 窗口里提取「取值组合」的 key。 */
function comboOfCss(body) {
  const size = /font-size:\s*var\(--ht-font-size-([a-z0-9]+)\)/.exec(body)?.[1];
  const weight = /font-weight:\s*var\(--ht-font-weight-(\w+)\)/.exec(body)?.[1];
  if (!size || !weight) return null;
  return `${size}+${weight}`;
}

function comboOfTsx(size, weight) {
  const s = /--ht-font-size-([a-z0-9]+)/.exec(size)?.[1];
  const w = /--ht-font-weight-(\w+)/.exec(weight)?.[1];
  if (!s || !w) return null;
  return `${s}+${w}`;
}

const pairedProblems = [];
const webFiles = files.filter((f) => relative(ROOT, f).replaceAll('\\', '/').startsWith('apps/web/src/'));

for (const file of webFiles) {
  const rel = relative(ROOT, file);
  if (rel.includes('tokens.css') || rel.includes('tokens.generated')) continue;
  const raw = readFileSync(file, 'utf8');
  const source = raw.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));

  if (file.endsWith('.css')) {
    // 规则级精确配对
    for (const m of source.matchAll(/(\.[a-zA-Z][^{\n]*)\{([^}]*)\}/g)) {
      const combo = comboOfCss(m[2]);
      if (!combo) continue;
      if (PAIRED_TYPOGRAPHY_ALLOW.some((a) => a.file === canonicalHostCss(rel) && a.combo === combo)) continue;
      pairedProblems.push({ file: rel, line: source.slice(0, m.index).split('\n').length, combo, text: m[1].trim().slice(0, 60) });
    }
  } else {
    // TSX：4 行窗口近似（同对象里 fontSize 与 fontWeight 相邻出现）
    const lines = source.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const win = lines.slice(i, i + 4).join('\n');
      const fsMatch = /fontSize:\s*[^,\n]+/.exec(win);
      const fwMatch = /fontWeight:\s*[^,\n]+/.exec(win);
      if (!fsMatch || !fwMatch) continue;
      const combo = comboOfTsx(fsMatch[0], fwMatch[0]);
      if (!combo) continue;
      if (PAIRED_TYPOGRAPHY_ALLOW.some((a) => a.file === canonicalHostCss(rel) && a.combo === combo)) continue;
      pairedProblems.push({ file: rel, line: i + 1, combo, text: `${fsMatch[0]} … ${fwMatch[0]}` });
      i += 3; // 同一窗口只报一次
    }
  }
}

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

if (pairedProblems.length > 0) {
  console.log(`\n🔴 web 壳出现 ${pairedProblems.length} 处**档位表外的成对自拼排版**（字号+字重同写）：\n`);
  for (const p of pairedProblems.slice(0, 12)) {
    console.log(`   ${p.file}:${p.line}  [${p.combo}]  ${p.text}`);
  }
  if (pairedProblems.length > 12) console.log(`   …还有 ${pairedProblems.length - 12} 处`);
  console.log(`
   规则：web 壳的排版应整条消费语义档位（JSX 加 .ht-type-*，与 .ht-* 类成对）。
   若取值确实与 11 个档位都不等值（桌面层级超集），把
   { file: '${pairedProblems[0].file}', combo: '${pairedProblems[0].combo}', why: '…' }
   加进本文件顶部 PAIRED_TYPOGRAPHY_ALLOW（必须写 why；**表只许删不许加** ——
   加行 = 档位表外的第二套排版又繁殖了一个）。`);
  process.exit(1);
}

console.log('\n✅ 无硬编码设计变量。\n');
