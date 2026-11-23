#!/usr/bin/env node
/**
 * CSS 静态规范门禁（stylelint 封装）
 * ==================================
 *
 * 与既有门禁的分工（见 `.stylelintrc.cjs` 文件头）：`check:design` /
 * `check:control-semantics` / `check:row-single-source` / `check:l4-no-style` 管的是
 * **设计纪律**；这一道管 **CSS 本身对不对** —— 重复选择器、重复声明、非法色值、
 * 零值带单位、空块。2026-11-23 立项时实测：**15 个文件**里同一个选择器写了两遍
 * 甚至三遍，后一条静默覆盖前一条，而此前没有任何一层会报。
 *
 * ## 为什么要一层封装而不是直接 `stylelint ...`
 *
 * 1. **可失败的自检**（AGENTS §7 元规则 2：不能失败的检查没有价值）。`--self-test`
 *    会往临时目录写三份夹具：一份重复选择器、一份零值带单位 + 非法 hex + 空块、
 *    一份干净文件；断言前两份**必红**、第三份**必绿**，再对真实树跑一次。
 *    这样"门禁变绿"有两种可能（真干净 / 判据失效）时，这一臂能分开它们。
 * 2. **汇总口径统一**：本仓门禁都打一句可复读的读数（扫描多少文件、几条），
 *    直接裸跑 stylelint 的输出形状随版本变化。
 *
 * ## 两批规则
 *
 * · **第一批**（六条，判据唯一、与格式无关）：重复选择器 / 重复声明 / 冗余简写 /
 *   非法 hex / 零值带单位 / 空块。立项时 27 处重复选择器，已全部修掉。
 * · **第二批**（正确性，加进来时实测存量全 0，只为防回潮）：`//` 注释、
 *   longhand 被 shorthand 覆盖、重复 @import、font-family 重名、keyframes 里的
 *   !important、未知单位/属性/@规则/媒体特性/伪类/函数。
 * · **第三批**（语义/取值合法性，实测存量全 0）：`declaration-property-value-no-unknown`
 *   （抓 `display: flexx` 这类拼错即静默失效）、媒体查询语法、伪元素/元素选择器、
 *   `var()` 缺失、空注释、空文件。**格式类规则（空行/缩进）一律不进**，理由见上。
 * · **颜色 token 判据**由本脚本内置（`scanRawColors`），**不用**
 *   `stylelint-declaration-strict-value`：那个插件 1.13.0 在 stylelint 18 上每条
 *   声明都报 `Unknown rule declaration-strict-value`（API 不匹配，已卸载）。
 *
 * ## 扫描面与豁免
 *
 * 含：`apps/web/src`、`packages/design-system/src`、`apps/landing/src`。
 * 豁免：`packages/design-system/generated`（生成物）、`tokens.css` 的
 * `no-duplicate-selectors`/`length-zero-no-unit`（它是 token 产地）、
 * `apps/landing/pitch`（一次性路演幻灯片，不属于产品 token 体系）。
 */

import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import stylelint from 'stylelint';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.HEYTA_CHECK_ROOT === undefined ? resolve(HERE, '..') : resolve(process.env.HEYTA_CHECK_ROOT);

/** 与 `.stylelintrc.cjs` 的 `rules` 保持同一份（自检用内联 config，避免受 ignoreFiles 影响）。 */
const RULES = {
  'no-duplicate-selectors': true,
  'declaration-block-no-duplicate-properties': [true, { ignore: ['consecutive-duplicates-with-different-syntaxes'] }],
  'shorthand-property-no-redundant-values': true,
  'color-no-invalid-hex': true,
  'length-zero-no-unit': true,
  'block-no-empty': true,
};

const GLOBS = [
  'apps/web/src/**/*.css',
  'packages/design-system/src/**/*.css',
  'apps/landing/src/**/*.css',
  // ⚠️ 刻意**不含** `apps/landing/pitch/**`：它是**一次性的路演幻灯片**
  // （`pitch/pitch.css`），配色属于幻灯片视觉稿、不属于产品 token 体系；
  // 把它拉进来只会逼人给幻灯片硬套 token，或在 allow 里写一堆理由。
];

async function lintFiles(files, { config } = {}) {
  const options = { files, allowEmptyInput: true };
  if (config !== undefined) options.config = config;
  return stylelint.lint(options);
}

/**
 * 「颜色必须走 token」—— 本脚本内置，**不用 stylelint-declaration-strict-value**。
 *
 * 为什么不用那个插件：`stylelint-declaration-strict-value@1.13.0` 的 peer 写着
 * `>=16 <=18`，但在 stylelint 18 上实测每条声明都报 `Unknown rule
 * declaration-strict-value`（插件 API 已经不匹配）。换成自己 20 行的判据更稳，
 * 而且与 `check:design` 的 token 纪律同向：`check:design` 拦裸 hex/px，
 * 这一条额外拦 `rgb()/hsl()` 以及 `background/box-shadow/border-color` 这类
 * **不叫 color 但吃颜色**的属性。
 *
 * 判据：颜色类属性（color / background(-color) / border-*-color / fill / stroke /
 * outline-color / box-shadow / text-shadow / caret-color / text-decoration-color /
 * column-rule-color）的值，在**剥掉 `var(...)` 之后**，不得残留
 * `#rgb` / `rgb(` / `rgba(` / `hsl(` / `hsla(`。
 * 允许：CSS 全局关键字（transparent / currentColor / inherit / none / initial /
 * unset / auto）与一切 `var(--ht-*)`。
 */
const COLOR_PROPS = new Set([
  'color','background','background-color','fill','stroke','outline-color','box-shadow',
  'text-shadow','caret-color','text-decoration-color','column-rule-color',
  'border-color','border-top-color','border-right-color','border-bottom-color','border-left-color',
  'border-inline-color','border-block-color','border-inline-start-color','border-inline-end-color',
  'border-block-start-color','border-block-end-color',
]);
/** 任意位置的声明（不要求行首 —— 本仓大量 `.a { color: #fff; }` 单行规则）。 */
const DECL_RE = /([-a-zA-Z]+)\s*:\s*([^;{}]+);/g;
const RAW_COLOR_RE = /(#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\()/;

function walkCss(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (name === 'node_modules' || name === 'dist' || name === 'build') continue;
      walkCss(full, out);
    } else if (name.endsWith('.css')) out.push(full);
  }
  return out;
}

/** 返回 [{file,line,text}]；`root` 参数是为自检夹具服务的。 */
export function scanRawColors(root = ROOT) {
  const files = [
    ...walkCss(join(root, 'apps/web/src')),
    ...walkCss(join(root, 'packages/design-system/src')),
    ...walkCss(join(root, 'apps/landing/src')),
  ].filter((f) => !f.includes('/generated/') && !f.endsWith('/tokens.css'));
  const hits = [];
  for (const f of files) {
    const src = readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    for (const m of src.matchAll(DECL_RE)) {
      const prop = m[1].toLowerCase();
      if (!COLOR_PROPS.has(prop)) continue;
      const bare = m[2].replace(/var\([^)]*\)/g, '');
      if (!RAW_COLOR_RE.test(bare)) continue;
      const line = src.slice(0, m.index).split('\n').length;
      hits.push({ file: f, line, text: `${prop}: ${m[2].trim()}` });
    }
  }
  return hits;
}

/* ── 死规则 / display 失效声明：两条结构性判据（2026-11-23 第三批收尾）───────
 *
 * 死规则：CSS 里定义了、但**全仓源码一次都没引用的类**所在的规则整条删掉。
 *   实测本仓只有 1 条（`sync-settings__field-hint`，随共享 FormField 收编后遗留），
 *   已删；这条判据的价值是**防新增**——删组件时不删 CSS 是常态。
 *   匹配规则（避免误报，见文件头「为什么能准确」）：
 *     · 类名出现在任何 `.ts/.tsx/.html` 源码标识符里 ⇒ 活；
 *     · 或存在模板前缀 `${...}`（如 `` `hta-badge--${tone}` ``）使该类以该前缀开头
 *       且余下部分是修饰词 ⇒ 活。
 *
 * display 失效声明：同一规则块里 `display:block` 却写 `grid-template-*` /
 *   `align-items` / `gap`，或 `display:flex` 却写 `grid-template-*` ——
 *   这些声明**永远不会生效**（规范如此），是"改了没反应"的经典来源。
 *   （`grid-row/column` 属于**子项**属性，对任意 display 都有效，不在其列。）
 */
function walkFiles(dir, pred, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (name === 'node_modules' || name === 'dist' || name === 'build' || name === 'generated') continue;
      walkFiles(full, pred, out);
    } else if (pred(full)) out.push(full);
  }
  return out;
}

const isCss = (f) => f.endsWith('.css');
const isSrc = (f) => /\.(tsx?|html)$/.test(f);

function ruleBodies(src) {
  const out = [];
  const nc = src.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const m of nc.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const sel = m[1].trim();
    if (sel === '' || sel.startsWith('@')) continue;
    out.push({ sel, body: m[2], line: nc.slice(0, m.index).split('\n').length });
  }
  return out;
}

export function scanDeadRules(root = ROOT) {
  const cssFiles = [
    ...walkFiles(join(root, 'apps/web/src'), isCss),
    ...walkFiles(join(root, 'apps/landing/src'), isCss),
  ];
  const srcFiles = [
    ...walkFiles(join(root, 'apps'), isSrc),
    ...walkFiles(join(root, 'packages'), isSrc),
  ];
  let text = '';
  for (const f of srcFiles) {
    try {
      text += readFileSync(f, 'utf8') + '\n';
    } catch {
      /* 读不到就跳过：不影响判据方向（少读 = 更可能误报为"死"，这里不静默兜底） */
    }
  }
  const ids = new Set(text.match(/[A-Za-z][A-Za-z0-9_-]+/g) ?? []);
  const prefixes = new Set([...text.matchAll(/([A-Za-z][A-Za-z0-9_-]*)\$\{/g)].map((m) => m[1]));
  const alive = (c) =>
    ids.has(c) || [...prefixes].some((p) => c.startsWith(p) && (p.endsWith('-') || c.slice(p.length).startsWith('-')));
  const hits = [];
  for (const f of cssFiles) {
    for (const r of ruleBodies(readFileSync(f, 'utf8'))) {
      const classes = [...r.sel.matchAll(/\.([A-Za-z][\w-]*)/g)].map((m) => m[1]);
      if (classes.length === 0) continue;
      if (classes.every((c) => !alive(c))) hits.push({ file: f, line: r.line, text: r.sel.slice(0, 80) });
    }
  }
  return hits;
}

export function scanDisplayInert(root = ROOT) {
  const cssFiles = [
    ...walkFiles(join(root, 'apps/web/src'), isCss),
    ...walkFiles(join(root, 'apps/landing/src'), isCss),
  ];
  const hits = [];
  for (const f of cssFiles) {
    for (const r of ruleBodies(readFileSync(f, 'utf8'))) {
      const decls = {};
      for (const m of r.body.matchAll(/([-a-zA-Z]+)\s*:\s*([^;{}]+);/g)) decls[m[1].toLowerCase()] = m[2].trim();
      const disp = (decls.display ?? '').toLowerCase();
      const dead = [];
      const has = (k) => Object.prototype.hasOwnProperty.call(decls, k);
      if (['block', 'inline-block', 'inline'].includes(disp)) {
        for (const k of Object.keys(decls)) {
          if (k.startsWith('grid-template') || k.startsWith('grid-auto') || ['align-items', 'justify-items', 'gap', 'row-gap', 'column-gap'].includes(k)) dead.push(k);
        }
      } else if (['flex', 'inline-flex'].includes(disp)) {
        for (const k of Object.keys(decls)) if (k.startsWith('grid-template') || k.startsWith('grid-auto')) dead.push(k);
      }
      if (dead.length > 0) hits.push({ file: f, line: r.line, text: `${r.sel.slice(0, 60)} → ${dead.join(', ')}` });
    }
  }
  return hits;
}

function summarize(results, errored) {
  let warnings = 0;
  let files = 0;
  for (const r of results) {
    if (r.warnings.length > 0) files += 1;
    for (const w of r.warnings) {
      warnings += 1;
      if (!errored) break;
      console.error(`  ${r.source.replace(ROOT + '/', '')}:${w.line}:${w.column}  ${w.text}  (${w.rule})`);
    }
  }
  return { warnings, files };
}

async function selfTest() {
  const tmp = mkdtempSync(join(tmpdir(), 'heyta-css-norms-'));
  const config = { rules: RULES };
  let failed = 0;
  let total = 0;
  const arm = (name, ok) => {
    total += 1;
    console.log(`${ok ? '✓' : '🔴'} ${name}`);
    if (!ok) failed += 1;
  };
  try {
    mkdirSync(join(tmp, 'bad-dup'), { recursive: true });
    writeFileSync(join(tmp, 'bad-dup/a.css'), '.x { color: red; }\n.x { color: blue; }\n');
    const r1 = await lintFiles([join(tmp, 'bad-dup/*.css')], { config });
    arm('重复选择器 ⇒ 必须红', r1.errored === true);

    mkdirSync(join(tmp, 'bad-vals'), { recursive: true });
    writeFileSync(
      join(tmp, 'bad-vals/b.css'),
      '.y { margin: 0px; color: #GGG; }\n.z {}\n',
    );
    const r2 = await lintFiles([join(tmp, 'bad-vals/*.css')], { config });
    arm('零值带单位 / 非法 hex / 空块 ⇒ 必须红', r2.errored === true);

    mkdirSync(join(tmp, 'good'), { recursive: true });
    writeFileSync(join(tmp, 'good/c.css'), '.a { margin: 0; color: #ffffff; }\n.b { padding: 0 0 0 0; }\n');
    const r3 = await lintFiles([join(tmp, 'good/*.css')], { config });
    // `.b` 的 `0 0 0 0` 是冗余简写 ⇒ 这条也该红；换成真正干净的：
    writeFileSync(join(tmp, 'good/c.css'), '.a { margin: 0; color: #ffffff; }\n.b { padding: 0; }\n');
    const r4 = await lintFiles([join(tmp, 'good/*.css')], { config });
    arm('干净文件 ⇒ 必须绿（否则判据过严）', r3.errored === true && r4.errored === false);

    // 第二批规则：`//` 注释、longhand 被 shorthand 覆盖、重复 @import、keyframes 里的 !important
    mkdirSync(join(tmp, 'bad-b2'), { recursive: true });
    writeFileSync(
      join(tmp, 'bad-b2/d.css'),
      [
        '.p { color: red; // 这行后面的声明会被吃掉',
        '}',
        '.q { border-inline-end: 0; border: 0; }',
        '@keyframes k { from { opacity: 0 !important; } to { opacity: 1; } }',
        '.r { padding: 0px; }',
      ].join('\n'),
    );
    const r5 = await lintFiles([join(tmp, 'bad-b2/*.css')], {
      config: {
        rules: {
          'no-invalid-double-slash-comments': true,
          'declaration-block-no-shorthand-property-overrides': true,
          'keyframe-declaration-no-important': true,
        },
      },
    });
    arm('第二批规则（// 注释 / shorthand 覆盖 / keyframes !important）⇒ 必须红', r5.errored === true);

    // 颜色 token 判据：裸 rgba 必红、var(--ht-*) 必绿
    mkdirSync(join(tmp, 'color-bad/apps/web/src'), { recursive: true });
    writeFileSync(join(tmp, 'color-bad/apps/web/src/x.css'), '.m { background: rgba(0, 0, 0, 0.4); }\n');
    mkdirSync(join(tmp, 'color-good/apps/web/src'), { recursive: true });
    writeFileSync(
      join(tmp, 'color-good/apps/web/src/x.css'),
      '.n { background: var(--ht-color-overlay); color: transparent; }\n',
    );
    // 第三批：取值合法性 —— 拼错的属性值必须红（最典型：display: flexx）
    mkdirSync(join(tmp, 'bad-b3'), { recursive: true });
    writeFileSync(
      join(tmp, 'bad-b3/e.css'),
      '.s { display: flexx; }\n.t { align-items: centerr; }\n.u { gap: 4; }\n',
    );
    const r6 = await lintFiles([join(tmp, 'bad-b3/*.css')], {
      config: { rules: { 'declaration-property-value-no-unknown': true } },
    });
    arm('第三批规则（非法属性值 display:flexx / align-items:centerr / gap:4）⇒ 必须红', r6.errored === true);

    arm('颜色裸值 ⇒ 必须红', scanRawColors(join(tmp, 'color-bad')).length === 1);
    arm('颜色走 token / 关键字 ⇒ 必须绿', scanRawColors(join(tmp, 'color-good')).length === 0);

    // 死规则 / display 失效
    mkdirSync(join(tmp, 'dead/apps/web/src'), { recursive: true });
    writeFileSync(join(tmp, 'dead/apps/web/src/x.css'), '.nobody__uses-this { color: var(--ht-color-foreground); }\n.used-class { color: var(--ht-color-foreground); }\n');
    writeFileSync(join(tmp, 'dead/apps/web/src/x.tsx'), 'export const A = <div className="used-class" />;\n');
    arm('死规则（无人引用的类）⇒ 必须红', scanDeadRules(join(tmp, 'dead')).length === 1);

    mkdirSync(join(tmp, 'inert/apps/web/src'), { recursive: true });
    writeFileSync(join(tmp, 'inert/apps/web/src/y.css'), '.p { display: block; align-items: center; }\n.q { display: flex; align-items: center; }\n');
    arm('display 失效声明 ⇒ 必须红（flex+align-items 不算）', scanDisplayInert(join(tmp, 'inert')).length === 1);

    // 真实树：自检里也跑，读数是"当前仓库状态"，不是夹具状态。
    const real = await lintFiles(GLOBS);
    const { warnings } = summarize(real.results, true);
    arm(`真实树当前 ${String(warnings)} 条违规（自检不判红，只看能否读到）`, typeof warnings === 'number');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  console.log(`self-test：${String(total - failed)}/${String(total)} 臂通过。`);
  return failed === 0;
}

async function main() {
  if (process.argv.includes('--self-test')) {
    const ok = await selfTest();
    process.exit(ok ? 0 : 1);
  }
  const res = await lintFiles(GLOBS);
  const { warnings, files } = summarize(res.results, res.errored === true);
  const colorHits = scanRawColors();
  const deadHits = scanDeadRules();
  const inertHits = scanDisplayInert();
  for (const h of deadHits) console.error(`  ${h.file.replace(ROOT + '/', '')}:${String(h.line)}  ${h.text}  (死规则：无任何源码引用)`);
  for (const h of inertHits) console.error(`  ${h.file.replace(ROOT + '/', '')}:${String(h.line)}  ${h.text}  (display 失效声明)`);
  for (const h of colorHits) {
    console.error(`  ${h.file.replace(ROOT + '/', '')}:${String(h.line)}  ${h.text}  (color 必须走 token)`);
  }
  console.log(
    `CSS 规范（stylelint）：${String(files)} 个文件有违规，共 ${String(warnings)} 条；` +
      `颜色 token：${String(colorHits.length)} 条；死规则：${String(deadHits.length)} 条；display 失效：${String(inertHits.length)} 条。`,
  );
  if (res.errored || colorHits.length + deadHits.length + inertHits.length > 0) {
    console.error('\n🔴 CSS 规范门禁未通过。修法见 `.stylelintrc.cjs` 文件头；');
    console.error('   ⚠️ 不许加 ignore/放宽规则来变绿 —— 那是把红色关掉，不是修问题。');
    process.exit(1);
  }
  console.log('✅ 没有重复选择器 / 重复声明 / 冗余简写 / 非法色值 / 零值带单位 / 空块。');
}

await main();
