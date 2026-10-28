#!/usr/bin/env node
/**
 * 控件语义门禁（全局 UX 线 P4）
 * =============================
 *
 * P4 立的命题是："一枚按钮长什么样"只有**一处**答案（共享表），各端只把那个答案
 * 翻译成自己的渲染语言。这句话能不能守住，不取决于注释写得多认真，取决于有没有
 * 一把尺**逐格**比两边。这里判七格：
 *
 * **A1 逐格对账（表 → CSS）**
 *   `packages/ui/src/control/states.ts` 的 `CONTROL_PALETTE` 每一档的
 *   `bg/fg/hoverBg/hoverFg/activeBg`，必须能在中央 `controls.css` 的
 *   `.ht-btn--<tone>` / `:hover` / `:active` 里读到**同一个 token**。
 *   红法有两种都算：值不同（一份被改了、另一份没跟上），以及 CSS 里根本没有那一档
 *   （"槽位建了、界面上没有"）。
 *
 * **A2 反向对账（CSS → 表）**
 *   中央 CSS 里出现表外色调 ⇒ 红。这条是 A1 的对偶：只查单向的话，
 *   "在 CSS 里私自加第五档"永远不会被发现 —— 而那正是本线的立项形状。
 *
 * **A3 重量档对账**
 *   `CONTROL_COMMIT_OVERRIDES` 与 `.ht-btn--danger.ht-btn--commit` 逐格比。
 *   只有 `danger` 该有独立配方；`commit` 是**修饰符**不是色调，不许混进 A2 的色调集。
 *
 * **A4 幻影类（界面写了、中央没有）**
 *   `apps/web/src` 里出现的 `.ht-btn--X` 若中央 CSS 没有声明它，界面拿到的就是
 *   **一条没有规则的类** —— 按钮退化成裸 `.ht-btn`（没有底、没有 hover 底），
 *   图上读起来就是说明文字。现量实例：`CloseAccountPanel.tsx` 的 `ht-btn--outline`
 *   在全仓**零条规则**（`--outline` 那档在"无描边交互"的裁决下根本不该存在）。
 *   ⇒ 这条有账本（别线名下的格子不代改），**只降不升**。
 *
 * **A5 零消费者档（中央声明了、界面没人用）**
 *   反方向：中央 CSS 声明了某一档而全仓没有任何使用点 ⇒ 直接红，不进账本。
 *   理由与 A4 不同：A4 是"界面上的东西画不出来"，A5 是"样式表里躺着没人要的槽位"，
 *   后者删掉就完事，留一条豁免行只会让下一位以为它有人用。
 *
 * **A6 功能 CSS 不许重声明交互控件外观**
 *   中央文件之外（`apps/web/src/styles/app/*.css`）的选择器里带交互控件族类名，
 *   且**声明了外观属性**（`background`/`color`/`border*`/`box-shadow`/`opacity`/
 *   `outline*`）⇒ 违规。按**结果**判不按**位置**判：布局（`flex`/`inline-size`/
 *   `align-self`/`white-space`/`padding`）是宿主的职责，一律放过 ——
 *   一把第一天就红十格的尺等于没有尺。现量 10 处表外引用里只有 `sheets.css`
 *   那两条（ghost 在设置页换底）落在外观上，已进账本，owner = P7/P8 设置面那一趟。
 *
 * **A7 推导出来的 CSS 变量名必须真存在**
 *   本脚本自己**不**映射 token 名 → 变量名之外的任何东西：唯一一条规则是
 *   `a.b` → `--ht-a-b`。这条映射如果哪天不再成立，A1 会拿着一个查不到的变量名红，
 *   而不是静默读成"没声明"。所以这里额外断言：每个期望变量都在 `tokens.css` 里。
 *
 * ⚠️ 本门禁**看不到**的形状（诚实登记，别当成整类已覆盖）：
 *   选择器里不写控件族类名、只写宿主自己那枚 class 的外观覆盖（现量 1 处：
 *   `sheets.css` 的 `.ht-settings__inline-action` 直接改 `color`）。
 *   源码文本这一层治不了它 —— 那正是计划 §9 判据 3「真实浏览器逐态读计算样式」
 *   负责的格子，不是这里可以宣称的覆盖面。
 *
 * 用法：`node scripts/check-control-semantics.mjs [--self-test]`
 * 🔴 未知旗标一律拒（§7 第 605 条：一把静默吞掉旗标的尺会照常打绿，而它判的是另一棵树）。
 */

import { execFile } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const runFile = promisify(execFile);
const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));

const ALLOWED_FLAGS = ['--self-test'];
const unknownFlags = process.argv.slice(2).filter((a) => a.startsWith('-') && !ALLOWED_FLAGS.includes(a));
if (unknownFlags.length > 0) {
  console.error(
    `❌ 未知旗标：${unknownFlags.join(' ')} —— 这枚尺不认它，会照常判默认那一份（§7 第 605 条）。`,
  );
  process.exit(1);
}
const WANT_SELFTEST = process.argv.includes('--self-test');

const TABLE_FILE = 'packages/ui/src/control/states.ts';
const CSS_FILE = 'apps/web/src/styles/app/controls.css';
const TOKENS_FILE = 'packages/design-system/src/tokens.css';
const STYLE_DIR = 'apps/web/src/styles/app';
/** A4/A6 的扫描面：Web 的类名层（移动端走 style 对象，归 A3 那趟）。 */
const USE_SCOPES = ['apps/web/src'];

/** 色调 → CSS 类名。 */
const BASE_CLASS = 'ht-btn';
/** 修饰符（不是色调）：中央 CSS 里允许存在的非色调类名。 */
const MODIFIER_CLASSES = ['commit'];
/** 表里必须齐的四个配方轴。 */
const AXES = ['bg', 'fg', 'hoverBg', 'hoverFg'];
/** 轴 → CSS 属性。 */
const AXIS_PROP = { bg: 'background', fg: 'color', hoverBg: 'background', hoverFg: 'color', activeBg: 'background' };
/** A6 认为"这是外观"的那批属性。布局类一律不在列（见文件头 A6）。 */
const APPEARANCE_PROPS = [
  'background',
  'background-color',
  'background-image',
  'color',
  'border',
  'border-color',
  'border-width',
  'border-style',
  'box-shadow',
  'opacity',
  'outline',
  'outline-color',
  'outline-width',
];
/**
 * A9 的落点：移动端的按钮壳。
 *
 * 判的是"这一端有没有又写回一份配方"——它**读**共享表（`controlPaletteOf`）就算合规，
 * 本地再出现一个 `Record<ButtonTone, { bg… }>` 字面量就是第二份答案。
 */
const MOBILE_SHELL_FILE = 'apps/mobile/src/ui/kit.tsx';
const MOBILE_SHELL_READ = 'controlPaletteOf';
/** 本地抄件的形状指纹：给每个色调各写一份 bg/fg（键是 `bg:` 且值是 `t['color.…']`）。 */
const MOBILE_LOCAL_PALETTE_RE = /Record<\s*ButtonTone\s*,[^>]*bg[^>]*>/;

/** 选择器里出现这些族名，就算"在碰交互控件"（本批只收按钮族，chip 归 P7）。 */
const CONTROL_FAMILIES = ['ht-btn'];

/**
 * A4 账本：**别线名下**的幻影类。
 * 每行都必须带「为什么现在不在这趟改」与翻案条件 —— 没有翻案条件的豁免行等于永久豁免。
 */
const PHANTOM_LEDGER = [
  {
    variant: 'outline',
    site: 'apps/web/src/features/settings/CloseAccountPanel.tsx',
    reason: '注销账号那一格归注册登录标准套件线；本趟只改类名会连带改到那一屏的外观与重量顺序（改别人界面的外观不归本线代改）。',
    reversal: '那条线自己把它定成四档之一（按危险动作的档位，这枚是行内档 `ht-btn--danger`），或本线 P7 设置面那一趟拿到他们的授权。',
  },
];

/**
 * A6 账本：**已知还在换底**的功能 CSS 行。
 * owner 与出路写在 reason 里；读数掉了必须同步改小，否则第七臂会红。
 */
const APPEARANCE_LEDGER = [
  {
    file: 'apps/web/src/styles/app/sheets.css',
    selector: '.ht-settings .ht-btn--ghost:not(.ht-settings__inline-action)',
    reason: '设置页把幽灵按钮换成凹陷底（"唯一的动作读成说明文字"那条老问题），当时选择在功能 CSS 里覆盖。',
    reversal: 'P7/P8 设置面那一趟给它显式 `ht-btn--secondary` 后删掉这两条；删完要把本行的读数改小。',
  },
  {
    file: 'apps/web/src/styles/app/sheets.css',
    selector: '.ht-settings .ht-btn--ghost:not(.ht-settings__inline-action):hover',
    reason: '上一条的 hover 对偶（只删静止态会让 hover 变成唯一来源）。',
    reversal: '与上一条一起删。',
  },
];

/**
 * 候选下限。
 * 🔴 这一条治的是"迁完之后门禁自己看不见东西"：表被删空、CSS 被删空，
 * 前面几臂会一起变成"零违规"的绿色。下限不是装饰，它是那几臂的可见性证明。
 */
const FLOORS = { tones: 4, cssRules: 8, usedVariants: 4 };

/* ── 解析 ──────────────────────────────────────────────── */

/** 去掉块注释与行注释；注释里的类名与属性不该被扫到（现量：trash.css 有一条讲旧抄件的注释）。 */
export function stripComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

/** token 名 → CSS 自定义属性名。唯一规则，见文件头 A7。 */
export function cssVarName(token) {
  return `--ht-${token.replaceAll('.', '-')}`;
}

/**
 * A8 的谓词：**一整枚字符串就是 `ht-btn`**（没有色调后缀）。
 * 立项现量是 18 处（AI 面板、隐私同意层、危险确认的「取消」），它们没有底也没有
 * hover 底，图上读起来就是说明文字 —— 那一格今天归零，所以要有一把尺守住归零。
 *
 * 🔴 原来这一枚只认 `className="ht-btn"` 那一种写法，并把"别的形状（模板串、三元）
 * 由 A4/A5 兜"当成理由写在注释里 —— 那句话是**错的**：A4/A5 比的是"引用的档在不在 CSS 里"，
 * 而 `ht-btn` 当然在，所以三元里写 `: 'ht-btn'` 的裸档**两边都不红**。
 * 实测抓到的一处就是这一枚（`features/sync/ConflictDialog.tsx` 的
 * `info.preferred ? 'ht-btn ht-btn--primary' : 'ht-btn'`），尺读 0、仓里躺着真裸档。
 * 现在谓词按**字符串整枚等于**判：`"ht-btn"`、`'ht-btn'`、`` `ht-btn` `` 都算，
 * 而 `"ht-btn ht-btn--primary"` 这种带后缀的不会误伤（它不是整枚等于）。
 */
const BARE_CLASS_RE = /["'`]ht-btn["'`]/g;

/**
 * A8 的判据本体（单独收成一枚函数，是为了让 self-test 能**直接喂两种写法**：
 * `className="ht-btn"` 与三元里的 `: 'ht-btn'`。挂在真实文件上做这一臂，
 * 今天只能证明"现在没有"，证明不了"这一种形状抓得到"。
 */
export function hasBareBtn(text) {
  BARE_CLASS_RE.lastIndex = 0;
  return BARE_CLASS_RE.test(text);
}

/** 取 `const NAME … = { … }` 的花括号配平体（表文件里只有这一处需要）。 */
function objectLiteral(text, name) {
  const start = text.indexOf(name);
  if (start === -1) return null;
  const brace = text.indexOf('{', text.indexOf('=', start));
  if (brace === -1) return null;
  let depth = 0;
  for (let i = brace; i < text.length; i += 1) {
    if (text[i] === '{') depth += 1;
    else if (text[i] === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(brace + 1, i);
    }
  }
  return null;
}

/** 从 `CONTROL_TONES` 那一行读色调词表（本脚本不第二次数一遍）。 */
export function parseTones(tsText) {
  const line = tsText.match(/export const CONTROL_TONES[^=]*=\s*\[([^\]]*)\]/);
  if (!line) throw new Error(`${TABLE_FILE} 里读不到 CONTROL_TONES —— 词表换了形状，先修探针（§6 第 2 条）。`);
  return [...line[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

/** 对象字面量 → `{ 档位: { 轴: token } }`。条目内不许有嵌套花括号（表就是那个形状）。 */
export function parsePalettes(body) {
  const out = new Map();
  if (body === null) return out;
  for (const m of body.matchAll(/(\w+):\s*\{([^{}]*)\}/g)) {
    const entry = {};
    for (const axis of [...AXES, 'activeBg']) {
      const found = m[2].match(new RegExp(`\\b${axis}:\\s*'([^']+)'`));
      if (found) entry[axis] = found[1];
    }
    out.set(m[1], entry);
  }
  return out;
}

/**
 * CSS → `[{ selector, decls: Map<prop, value> }]`。
 *
 * 🔴 为什么不是 `([^{}]+)\{([^{}]*)\}` 那种一遍正则：那条式子在 `@media (…) { .x { … } }`
 * 里只能匹配到"两个花括号之间的那段"，于是**媒体查询里的规则会被静默丢掉**
 * （现量：`profile.css:163` 那两条 `.ht-btn` 就在 `@media` 里）。
 * 一把会漏掉一整层的尺必须自己把那层也数到 —— 这里按花括号深度走一遍，
 * `@media`/`@supports` 只当分组（展平），里面的规则照样进分母。
 */
export function parseCss(cssText) {
  const clean = stripComments(cssText);
  const rules = [];
  const openStack = [];
  let pending = '';
  let atDepth = 0;
  const finalize = (selector, buf) => {
    const decls = new Map();
    for (const piece of buf.split(';')) {
      const idx = piece.indexOf(':');
      if (idx === -1) continue;
      const prop = piece.slice(0, idx).trim();
      const value = piece.slice(idx + 1).trim();
      if (prop && value) decls.set(prop, value);
    }
    return { selector, decls };
  };
  for (const ch of clean) {
    if (ch === '{') {
      const selector = pending.replace(/\s+/g, ' ').trim();
      pending = '';
      if (selector.startsWith('@')) {
        atDepth += 1;
        continue;
      }
      if (selector) openStack.push({ selector, buf: '' });
      else atDepth += 1; // 认不出选择器的块：当分组，别把里面的字符并进上一枚规则
      continue;
    }
    if (ch === '}') {
      const rule = openStack.pop();
      if (rule) {
        const done = finalize(rule.selector, rule.buf);
        if (done.selector.includes('.') && done.decls.size > 0) rules.push(done);
        continue;
      }
      if (atDepth > 0) atDepth -= 1;
      pending = '';
      continue;
    }
    if (openStack.length > 0) openStack[openStack.length - 1].buf += ch;
    else pending += ch;
  }
  return rules;
}

/** 类名集合（色调档 + 修饰符档），从 CSS 选择器里取。 */
export function declaredVariants(rules) {
  const set = new Set();
  for (const rule of rules) {
    for (const m of rule.selector.matchAll(new RegExp(`\\.${BASE_CLASS}--([a-z-]+)`, 'g'))) set.add(m[1]);
  }
  return set;
}

/** 选择器精确等于 `sel` 的第一条规则（伪类要分开比，`a:hover` 不是 `a`）。 */
function ruleFor(rules, sel) {
  return rules.find((r) => r.selector === sel) ?? null;
}

/** 递归列出 `USE_SCOPES` 下的源码文件（只认 .tsx，测试文件里造的类名不算界面在用）。 */
export function sourceFiles(scope) {
  const out = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      const st = statSync(full);
      if (st.isDirectory()) walk(full);
      else if (name.endsWith('.tsx')) out.push(full);
    }
  };
  walk(scope);
  return out;
}

/* ── 判断 ──────────────────────────────────────────────── */

/**
 * @returns 违规行数组（空数组＝绿）。每行首字是臂号，便于 self-test 逐枚比。
 */
export function check({ tones, palettes, commitPalettes, rules, tokensText, used, styleFiles }) {
  const bareSites = used.bare ?? [];
  const problems = [];
  const declared = declaredVariants(rules);
  const tokenTable = stripComments(tokensText);

  /** A7 的共用小尺：期望变量必须真存在，否则后面的"读不到"全是假的。 */
  const varExists = (token) => tokenTable.includes(`${cssVarName(token)}:`);

  for (const tone of tones) {
    const palette = palettes.get(tone);
    if (!palette) {
      problems.push(`A1 色调 ${tone} 在词表里而表内没有配方 —— 加一档不给配方。`);
      continue;
    }
    for (const axis of AXES) {
      if (!palette[axis]) {
        problems.push(`A1 ${tone} 缺 ${axis} 轴。`);
        continue;
      }
      if (palette[axis] !== 'transparent' && !varExists(palette[axis])) {
        problems.push(`A7 ${tone}.${axis} 指到 ${palette[axis]}，但 ${cssVarName(palette[axis])} 不在 ${TOKENS_FILE}。`);
      }
    }
    const base = ruleFor(rules, `.${BASE_CLASS}--${tone}`);
    const hover = ruleFor(rules, `.${BASE_CLASS}--${tone}:hover`);
    if (!base || !hover) {
      problems.push(`A1 ${tone} 在表里有配方，而 ${CSS_FILE} 里没有 .${BASE_CLASS}--${tone}${base ? ' 或它的 :hover' : ''} —— 槽位建了、界面上没有。`);
      continue;
    }
    for (const axis of ['bg', 'fg']) {
      const want = palette[axis] === 'transparent' ? 'transparent' : `var(${cssVarName(palette[axis])})`;
      const got = base.decls.get(AXIS_PROP[axis]);
      if (got !== want) problems.push(`A1 ${tone} 的 ${axis}：表=${want}，CSS=${got ?? '（未声明）'}`);
    }
    const wantHoverBg =
      palette.hoverBg === 'transparent' ? 'transparent' : `var(${cssVarName(palette.hoverBg)})`;
    const gotHoverBg = hover.decls.get('background');
    if (gotHoverBg !== wantHoverBg) {
      problems.push(`A1 ${tone} 的 hoverBg：表=${wantHoverBg}，CSS :hover=${gotHoverBg ?? '（未声明）'}`);
    }
    const gotHoverFg = hover.decls.get('color');
    if (gotHoverFg === undefined) {
      // CSS 不声明 hover 前景＝静止态那格继续生效；那只有表里 hoverFg 与 fg 同值才成立。
      if (palette.hoverFg !== palette.fg) {
        problems.push(`A1 ${tone} 的 hoverFg 在表里换了（${palette.fg}→${palette.hoverFg}）而 CSS 的 :hover 没声明 color。`);
      }
    } else {
      const want = `var(${cssVarName(palette.hoverFg)})`;
      if (gotHoverFg !== want) problems.push(`A1 ${tone} 的 hoverFg：表=${want}，CSS :hover=${gotHoverFg}`);
    }
    const active = ruleFor(rules, `.${BASE_CLASS}--${tone}:active`);
    if (palette.activeBg && !active) problems.push(`A3 ${tone} 表里有 activeBg 而 CSS 没有 :active 规则。`);
    if (!palette.activeBg && active) {
      problems.push(`A3 ${tone} 没有 activeBg（按下归缩放那一档）而 CSS 写了 :active 换底 —— 同一件事两种机制。`);
    }
  }

  for (const variant of declared) {
    if (!tones.includes(variant) && !MODIFIER_CLASSES.includes(variant)) {
      problems.push(`A2 ${CSS_FILE} 声明了 .${BASE_CLASS}--${variant}，而色调词表里没有它 —— 第五档。`);
    }
  }

  for (const [tone, palette] of commitPalettes) {
    const sel = `.${BASE_CLASS}--${tone}.${BASE_CLASS}--commit`;
    const base = ruleFor(rules, sel);
    const hover = ruleFor(rules, `${sel}:hover`);
    if (!base || !hover) {
      problems.push(`A3 ${tone} 有 commit 覆盖，而 ${CSS_FILE} 里缺 ${sel}${base ? ' 的 :hover' : ''}。`);
      continue;
    }
    for (const [axis, prop] of [['bg', 'background'], ['fg', 'color']]) {
      const want = `var(${cssVarName(palette[axis])})`;
      if (base.decls.get(prop) !== want) problems.push(`A3 commit/${tone} 的 ${axis}：表=${want}，CSS=${base.decls.get(prop) ?? '（未声明）'}`);
    }
    const wantHover = `var(${cssVarName(palette.hoverBg)})`;
    if (hover.decls.get('background') !== wantHover) problems.push(`A3 commit/${tone} 的 hoverBg：表=${wantHover}，CSS=${hover.decls.get('background') ?? '（未声明）'}`);
    const wantHoverFg = `var(${cssVarName(palette.hoverFg)})`;
    if (hover.decls.get('color') !== wantHoverFg) problems.push(`A3 commit/${tone} 的 hoverFg：表=${wantHoverFg}，CSS=${hover.decls.get('color') ?? '（未声明）'}`);
  }

  /* A4 幻影类：账本按 variant 名对，读数只降不升。 */
  const phantom = [...used.variants]
    .filter((v) => !declared.has(v))
    .filter((v) => !PHANTOM_LEDGER.some((row) => row.variant === v));
  for (const v of phantom) {
    const sites = [...used.sitesByVariant.get(v) ?? []].join('、');
    problems.push(`A4 界面用了 .${BASE_CLASS}--${v} 而中央 CSS 没有那一档（画出来就是裸按钮）：${sites}`);
  }
  for (const row of PHANTOM_LEDGER) {
    if (!used.variants.has(row.variant)) {
      problems.push(`A4 账本过期：.${BASE_CLASS}--${row.variant} 已经没有使用点，删掉这一行。`);
    }
  }

  /* A9 移动端必须读共享表，且不许留本地抄件。 */
  const shell = used.mobileShell;
  if (shell !== undefined) {
    if (!shell.includes(MOBILE_SHELL_READ)) {
      problems.push(`A9 ${MOBILE_SHELL_FILE} 不再引用 ${MOBILE_SHELL_READ} —— 这一端又回到自己写一份配方了。`);
    }
    if (MOBILE_LOCAL_PALETTE_RE.test(shell)) {
      problems.push(`A9 ${MOBILE_SHELL_FILE} 里有本地色调配方字面量（第二份答案），正解是 \`controlPaletteOf(tone, emphasis)\`。`);
    }
  }

  /* A8 裸档（没有色调后缀的 .ht-btn）：零容忍，不进账本。 */
  for (const site of bareSites) {
    problems.push(`A8 ${site} 里有不带色调的 className="ht-btn" —— 它没有底也没有 hover 底，图上读起来就是说明文字。`);
  }

  /* A5 零消费者：中央声明了、全仓没人用。 */
  for (const v of declared) {
    if (!used.variants.has(v)) problems.push(`A5 ${CSS_FILE} 声明了 .${BASE_CLASS}--${v} 而全仓没有使用点 —— 没人要的槽位。`);
  }

  /* A6 功能 CSS 重声明外观。 */
  for (const [file, rules2] of styleFiles) {
    if (file === CSS_FILE) continue;
    for (const rule of rules2) {
      if (!CONTROL_FAMILIES.some((fam) => rule.selector.includes(`.${fam}`))) continue;
      const hit = APPEARANCE_PROPS.filter((p) => rule.decls.has(p));
      if (hit.length === 0) continue;
      const inLedger = APPEARANCE_LEDGER.some((row) => row.file === file && row.selector === rule.selector);
      if (!inLedger) {
        problems.push(`A6 ${file} 的 ${rule.selector} 重声明了交互控件外观（${hit.join(', ')}）—— 配方只住 ${CSS_FILE}。`);
      }
    }
  }
  for (const row of APPEARANCE_LEDGER) {
    const stillThere = (styleFiles.get(row.file) ?? []).some((r) => r.selector === row.selector);
    if (!stillThere) problems.push(`A6 账本过期：${row.file} 里已经没有 ${row.selector}，删掉这一行。`);
  }

  return problems;
}

/** 可见性下限（见 FLOORS 那段）。 */
export function floorProblems({ tones, rules, used }) {
  const problems = [];
  if (tones.length < FLOORS.tones) problems.push(`候选下限：色调词表只剩 ${tones.length}（< ${FLOORS.tones}）—— 尺快瞎了。`);
  if (rules.length < FLOORS.cssRules) problems.push(`候选下限：${CSS_FILE} 只解析出 ${rules.length} 条规则（< ${FLOORS.cssRules}）—— 解析器或形状变了。`);
  if (used.variants.size < FLOORS.usedVariants) problems.push(`候选下限：界面只用到 ${used.variants.size} 个变体（< ${FLOORS.usedVariants}）—— 扫描面或类名写法变了。`);
  return problems;
}

/* ── 真树读数 ──────────────────────────────────────────── */

function read(rel) {
  return readFileSync(join(ROOT, rel), 'utf8');
}

function scan() {
  const tsText = stripComments(read(TABLE_FILE));
  const tones = parseTones(tsText);
  const palettes = parsePalettes(objectLiteral(tsText, 'const CONTROL_PALETTE'));
  const commitPalettes = parsePalettes(objectLiteral(tsText, 'const CONTROL_COMMIT_OVERRIDES'));
  const rules = parseCss(read(CSS_FILE));

  const variants = new Set();
  const sitesByVariant = new Map();
  const bare = [];
  for (const scope of USE_SCOPES) {
    for (const abs of sourceFiles(join(ROOT, scope))) {
      const text = stripComments(readFileSync(abs, 'utf8'));
      if (hasBareBtn(text)) bare.push(relative(ROOT, abs));
      for (const m of text.matchAll(new RegExp(`${BASE_CLASS}--([a-z-]+)`, 'g'))) {
        variants.add(m[1]);
        const site = relative(ROOT, abs);
        if (!sitesByVariant.has(m[1])) sitesByVariant.set(m[1], new Set());
        sitesByVariant.get(m[1]).add(site);
      }
    }
  }

  const styleFiles = new Map();
  for (const name of readdirSync(join(ROOT, STYLE_DIR))) {
    if (!name.endsWith('.css')) continue;
    styleFiles.set(`${STYLE_DIR}/${name}`, parseCss(read(`${STYLE_DIR}/${name}`)));
  }

  return {
    tones,
    palettes,
    commitPalettes,
    rules,
    tokensText: read(TOKENS_FILE),
    used: { variants, sitesByVariant, bare, mobileShell: read(MOBILE_SHELL_FILE)},
    styleFiles,
  };
}

/* ── self-test ─────────────────────────────────────────── */

/**
 * 夹具的使用点：必须**带着两本账的真身**（`outline` 那一处幻影使用、下面 `fixture()`
 * 里的 sheets.css 两条）。否则 ① 那枚"合规夹具 ⇒ 零违规"会被"账本过期"三行污染，
 * 而 A4/A6 的过期臂就成了 fixture 与账本互相矛盾的产物，测不到真树。
 */
const USED_BASE = ['primary', 'secondary', 'ghost', 'danger', 'commit', 'outline'];
const LEDGER_SITE = 'apps/web/src/features/settings/CloseAccountPanel.tsx';
const SHEETS_FILE = 'apps/web/src/styles/app/sheets.css';
const MOBILE_SHELL_FIXTURE = `export type ButtonTone = ControlTone;\nconst recipe = controlPaletteOf(tone, emphasis);`;

const SHEETS_GHOST_SEL = '.ht-settings .ht-btn--ghost:not(.ht-settings__inline-action)';

function usedWith(extra, bare = []) {
  const variants = new Set([...USED_BASE, ...extra]);
  const sitesByVariant = new Map([['outline', new Set([LEDGER_SITE])]]);
  for (const v of extra) sitesByVariant.set(v, new Set(['apps/web/src/features/x/Fixture.tsx']));
  return { variants, sitesByVariant, bare, mobileShell: MOBILE_SHELL_FIXTURE };
}

/** 一份最小合规树：A1/A3 全对、幻影与外观两本账都对得上、无新的违规。 */
function fixture() {
  const tones = ['primary', 'secondary', 'ghost', 'danger'];
  const palettes = new Map([
    ['primary', { bg: 'color.primary', fg: 'color.on-primary', hoverBg: 'color.primary-hover', hoverFg: 'color.on-primary', activeBg: 'color.primary-active' }],
    ['secondary', { bg: 'color.surface-sunken', fg: 'color.foreground', hoverBg: 'color.hover', hoverFg: 'color.foreground' }],
    ['ghost', { bg: 'transparent', fg: 'color.foreground-muted', hoverBg: 'color.hover', hoverFg: 'color.foreground' }],
    ['danger', { bg: 'transparent', fg: 'color.danger', hoverBg: 'color.danger-subtle', hoverFg: 'color.danger-strong' }],
  ]);
  const commitPalettes = new Map([
    ['danger', { bg: 'color.danger', fg: 'color.on-danger', hoverBg: 'color.danger-strong', hoverFg: 'color.on-danger' }],
  ]);
  const rules = parseCss(`
    .ht-btn--primary { background: var(--ht-color-primary); color: var(--ht-color-on-primary); }
    .ht-btn--primary:hover { background: var(--ht-color-primary-hover); }
    .ht-btn--primary:active { background: var(--ht-color-primary-active); }
    .ht-btn--secondary { background: var(--ht-color-surface-sunken); color: var(--ht-color-foreground); }
    .ht-btn--secondary:hover { background: var(--ht-color-hover); }
    .ht-btn--ghost { background: transparent; color: var(--ht-color-foreground-muted); }
    .ht-btn--ghost:hover { background: var(--ht-color-hover); color: var(--ht-color-foreground); }
    .ht-btn--danger { background: transparent; color: var(--ht-color-danger); }
    .ht-btn--danger:hover { background: var(--ht-color-danger-subtle); color: var(--ht-color-danger-strong); }
    .ht-btn--danger.ht-btn--commit { background: var(--ht-color-danger); color: var(--ht-color-on-danger); }
    .ht-btn--danger.ht-btn--commit:hover { background: var(--ht-color-danger-strong); color: var(--ht-color-on-danger); }
  `);
  const tokensText = [...palettes.values(), ...commitPalettes.values()].flatMap((p) => Object.values(p))
    .filter((v) => v !== 'transparent')
    .map((v) => `  ${cssVarName(v)}: #000000;`)
    .join('\n');
  const used = usedWith([]);

  const styleFiles = new Map([
    [CSS_FILE, rules],
    ['apps/web/src/styles/app/layout.css', parseCss('.ht-settings .ht-btn--ghost { inline-size: 100%; }')],
    [SHEETS_FILE, parseCss(`${SHEETS_GHOST_SEL} { background: var(--ht-color-surface-sunken); }\n${SHEETS_GHOST_SEL}:hover { background: var(--ht-color-hover); }`)],
  ]);
  return { tones, palettes, commitPalettes, rules, tokensText, used, styleFiles };
}

async function selftest(real) {
  const arms = [];
  const push = (name, pass, detail) => arms.push({ name, pass, detail });

  const clean = fixture();
  push('① 合规夹具 ⇒ 零违规', check(clean).length === 0, check(clean).join(' | '));

  const drift = fixture();
  drift.rules.find((r) => r.selector === '.ht-btn--danger:hover').decls.set('background', 'var(--ht-color-hover)');
  const driftRead = check(drift);
  push('② CSS 抄件漂一格 ⇒ A1 精确红一次', driftRead.length === 1 && driftRead[0].startsWith('A1'), driftRead.join(' | '));

  const fifth = fixture();
  fifth.rules.push(...parseCss('.ht-btn--accent { background: var(--ht-color-primary); color: var(--ht-color-on-primary); }'));
  const fifthRead = check(fifth);
  push('③ 中央 CSS 私加第五档 ⇒ A2 红', fifthRead.some((l) => l.startsWith('A2')), fifthRead.join(' | '));

  const noSlot = fixture();
  noSlot.rules = noSlot.rules.filter((r) => !r.selector.startsWith('.ht-btn--secondary'));
  const noSlotRead = check(noSlot);
  push('④ 表里有档而 CSS 没有 ⇒ A1 红（槽位建了、界面上没有）', noSlotRead.some((l) => l.startsWith('A1') && l.includes('secondary')), noSlotRead.join(' | '));

  const phantom = fixture();
  phantom.used = usedWith(['nope']);
  const phantomRead = check(phantom);
  push('⑤ 界面写了中央没有的类 ⇒ A4 红', phantomRead.length === 1 && phantomRead[0].startsWith('A4') && phantomRead[0].includes('nope'), phantomRead.join(' | '));

  const ledgerStale = fixture();
  ledgerStale.used = {
    variants: new Set(USED_BASE.filter((v) => v !== 'outline')),
    sitesByVariant: new Map(),
    bare: [],
  };
  const ledgerRead = check(ledgerStale);
  push('⑥ 账本里的幻影类已经没有使用点 ⇒ 必须红（不许留永久豁免）', ledgerRead.some((l) => l.startsWith('A4') && l.includes('过期')), ledgerRead.join(' | '));

  const redeclared = fixture();
  redeclared.styleFiles.set('apps/web/src/styles/app/feature.css', parseCss('.ht-toolbar .ht-btn--ghost { background: var(--ht-color-surface-sunken); }'));
  const redeclaredRead = check(redeclared);
  push('⑦ 功能 CSS 重声明外观 ⇒ A6 红', redeclaredRead.some((l) => l.startsWith('A6')), redeclaredRead.join(' | '));

  const layoutOnly = fixture();
  layoutOnly.styleFiles.set('apps/web/src/styles/app/feature.css', parseCss('.ht-toolbar .ht-btn--ghost { inline-size: 100%; flex: 0 0 auto; }'));
  push('⑧ 同一位置的**布局**声明不许算外观（否则 ⑦ 恒真）', check(layoutOnly).length === 0, check(layoutOnly).join(' | '));

  const badToken = fixture();
  badToken.palettes.get('danger').fg = 'color.danger-foreground';
  const badTokenRead = check(badToken);
  push('⑨ 编造的色名 ⇒ A7 红（两侧都读不到就不许静默）', badTokenRead.some((l) => l.startsWith('A7')), badTokenRead.join(' | '));

  const commentTrap = parseCss('/* .ht-btn--fake { color: red; } */\n.ht-btn--primary { background: var(--ht-color-primary); }');
  push('⑩ 注释里的类名与属性不许被扫到（现量：trash.css 留着旧抄件的说明）', commentTrap.length === 1 && !declaredVariants(commentTrap).has('fake'), JSON.stringify(commentTrap.map((r) => r.selector)));

  const mediaTrap = parseCss('@media (max-width: 768px) {\n  .ht-toolbar .ht-btn--ghost { background: var(--ht-color-surface-sunken); }\n}');
  push('⑬ 媒体查询里的规则必须进分母（一遍正则会把整层静默丢掉）', mediaTrap.length === 1 && mediaTrap[0].decls.has('background'), JSON.stringify(mediaTrap.map((r) => r.selector)));

  /**
   * 🔴 `promisify(execFile)` 在子进程非零退出时是**抛**的，而这一臂要的正是非零退出。
   * 不接住它，self-test 会在这里炸掉 —— 那比一条没有的臂更糟：整把尺读不出任何结论。
   */
  const noRead = fixture();
  noRead.used = { ...noRead.used, mobileShell: 'const palette = { danger: { bg: t[\'color.danger\'] } };' };
  const noReadOut = check(noRead);
  push('⑮ 移动端壳不再引用共享表 ⇒ A9 红', noReadOut.length === 1 && noReadOut[0].startsWith('A9'), noReadOut.join(' | '));

  const localCopy = fixture();
  localCopy.used = { ...localCopy.used, mobileShell: 'const recipe = controlPaletteOf(tone);\nconst palette: Record<ButtonTone, { bg: string; fg: string }> = {};' };
  const localCopyOut = check(localCopy);
  push('⑯ 移动端留着本地配方字面量 ⇒ A9 红（引用了表也不行，抄件要在）', localCopyOut.length === 1 && localCopyOut[0].startsWith('A9'), localCopyOut.join(' | '));

  const bareArm = fixture();
  bareArm.used = usedWith([], ['apps/web/src/features/x/Bare.tsx']);
  const bareRead = check(bareArm);
  push('⑭ 不带色调的 .ht-btn ⇒ A8 红（立项现量 18 处，今天归零要守得住）', bareRead.length === 1 && bareRead[0].startsWith('A8'), bareRead.join(' | '));

  /*
   * ⑰ A8 的**形状**那一维：裸档写成三元里的字符串也要抓得到。
   * 这一臂存在的原因不是"想多一条臂"：原来那句注释写着"别的形状由 A4/A5 兜"，
   * 而 A4/A5 比的是"引用的档在不在 CSS 里"——`ht-btn` 当然在，所以那种写法两边都不红，
   * 仓里就躺着一枚真的（`ConflictDialog` 的 `: 'ht-btn'`）。尺读 0 ≠ 没有。
   * 反向那一半同样要紧：带后缀的档不许被误伤，否则下一次归零会被"怕误伤"绕过去。
   */
  push(
    '⑰ 裸档写成三元字符串 ⇒ A8 的谓词抓得到，且带后缀的档不误伤',
    hasBareBtn(`className={info.preferred ? 'ht-btn ht-btn--primary' : 'ht-btn'}`)
      && !hasBareBtn('className="ht-btn ht-btn--primary"')
      && hasBareBtn('className="ht-btn"'),
    '三元里的 \'ht-btn\' 必须算裸档；"ht-btn ht-btn--primary" 必须不算',
  );

  let flagCode = 0;
  let flagErr = '';
  try {
    await runFile(process.execPath, [fileURLToPath(import.meta.url), '--self-tset'], { encoding: 'utf8' });
  } catch (err) {
    flagCode = err.code ?? 0;
    flagErr = String(err.stderr ?? '');
  }
  push(`⑪ 拼错的旗标 ⇒ rc=1（实际 rc=${flagCode}）`, flagCode === 1 && flagErr.includes('未知旗标'), flagErr.trim());

  const floorRead = floorProblems({ tones: ['primary'], rules: real.rules, used: real.used });
  const floorOk = floorProblems({ tones: real.tones, rules: real.rules, used: real.used });
  push(`⑫ 候选下限：词表缩到 1 枚 ⇒ 红；真树 ⇒ 绿（真树读数 ${real.tones.length}/${real.rules.length}/${real.used.variants.size}）`, floorRead.length === 1 && floorOk.length === 0, `${floorRead.join(' | ')} // ${floorOk.join(' | ')}`);

  let failed = 0;
  for (const arm of arms) {
    if (!arm.pass) failed += 1;
    console.log(`${arm.pass ? '✓' : '✗'} ${arm.name}${arm.pass ? '' : `\n    读数：${arm.detail}`}`);
  }
  console.log(`self-test：${arms.length} 枚臂，${failed} 枚不过。`);
  if (failed > 0) process.exit(1);
}

/* ── 主流程 ────────────────────────────────────────────── */

const real = scan();
if (WANT_SELFTEST) {
  await selftest(real);
  process.exit(0);
}

const problems = check(real).concat(floorProblems(real));
console.log(
  `控件语义门禁：色调 ${real.tones.length} 档、中央规则 ${real.rules.length} 条、界面变体 ${real.used.variants.size} 个、` +
    `账本（幻影 ${PHANTOM_LEDGER.length} / 外观 ${APPEARANCE_LEDGER.length}）。`,
);
if (problems.length > 0) {
  for (const p of problems) console.error(`❌ ${p}`);
  console.error(
    '\n判据正文：`packages/ui/src/control/states.ts` 的文件头 + `docs/agents/design-system.md`。\n' +
      '出路是把配方改回同一处（改表 ⇒ 同时改中央 CSS；界面 ⇒ 用既有四档），不是往账本里加一行。',
  );
  process.exit(1);
}
console.log('✅ 四档配方与中央 CSS 逐格相同，重量档两边都在，界面没有幻影类，功能 CSS 没有新的外观重声明。');
