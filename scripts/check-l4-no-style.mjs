#!/usr/bin/env node
/**
 * 「L4 不写样式」门禁 —— `features/**` 的视图不许自带样式字面量。
 * =================================================================
 *
 * 判据出处：`docs/research/dida-view-unification.md`
 *   · §4.1 视觉契约：「**允许端差异的只有 L3。** L4 里出现颜色/字号/间距字面量 = 违规」
 *   · §5   门禁表：「`apps/<端>/src/features/**` 不许出现颜色/字号/间距字面量与 `style={{…}}`」
 *   · §8.4 验收：`check:design` / `check:layering` / `check:ui-language` 全绿
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 为什么还需要一道，`check:design` 不是已经在管裸值了吗？
 * ─────────────────────────────────────────────────────────────────────────
 *
 * `check:design`（`design-system/heyta/check-hardcoded.mjs`）确实扫 `apps/web/src`，
 * 所以"features 里写裸 hex/px 完全没人管"这句话**不完全对**。但它有两个真实缺口，
 * 这道门禁补的正是这两个（其余部分**刻意不重复**，见下）：
 *
 *   1. **`check:design` 的 `LINE_ALLOW` 里有 `--ht-`，豁免的是整行。**
 *      于是 `style={{ background: 'var(--ht-bg)', color: '#FF0000' }}` 这样
 *      「一半 token 一半字面量」的行**整行放行**，裸 hex 从缝里过去。
 *      这道门禁**按匹配判定，不按行判定**，同样的写法会红。
 *   2. **规则挂在"是不是 L4"上，而不是"是不是裸值"上。** 同一份契约对
 *      L1/L2（`packages/ui`、mobile 的 `ui/kit`）是允许写样式的，对 L4 是不允许的。
 *      只说"不许裸值"没法告诉人**这个值应该搬去哪一层**；
 *      这道门禁的红会直接说"搬去 L1/L2 的模式组件"。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 允许什么、禁止什么（判据刻意窄 —— 这是设计，不是遗漏）
 * ─────────────────────────────────────────────────────────────────────────
 *
 * **扫描范围（L4 视图）**
 *
 *   · `apps/web/src/features/**`（**除** `features/shell/**`）
 *   · `apps/mobile/src/screens/**`
 *
 * ⚠️ 为什么豁免 `apps/web/src/features/shell/**`、`apps/mobile/src/ui/**`、
 * `apps/mobile/src/App.tsx`、`apps/mobile/src/nav/**`：
 * 契约说"**允许端差异的只有 L3**"。L3 外壳（rail / 顶栏 / 空态外壳）与 L1/L2
 * 原语（mobile 的 `ui/kit`）本来就是**定义样式**的地方。把外壳也收进来，
 * 会立刻产生一批"合规却被报"的噪音 —— 而本仓库的经验是
 * **一条会误报的门禁会教人忽略红色**（AGENTS.md #25）。所以豁免是显式的、
 * 写在代码里的，而不是靠正则碰巧不匹配。
 *
 * **禁止（断言 A：样式字面量）** —— 以下字面量在 L4 视图里出现即违规：
 *
 *   · 颜色：`#rgb` / `#rrggbb` / `#rrggbbaa`、`rgb()` / `rgba()` / `hsl()` / `hsla()`
 *   · 长度：`16px` 这类**带 px 的绝对值**（`0` 与发丝线 `1px` 例外，见下）
 *   · 尺度属性上的裸数字：`padding` / `margin` / `borderRadius` / `fontSize` /
 *     `gap` / `rowGap` / `columnGap` 的取值是数字字面量（RN 形态）或 `'16px'`（web 形态）
 *   · `z-index` / `zIndex` 的裸数字
 *
 * **允许（并且必须继续允许）**：
 *
 *   · **token 引用**：`cssVar('space.4')` → `var(--ht-space-4)`；
 *     RN 侧 `tokens['space.4']` / `useTokens()`。它们是**合规解**，不是违规。
 *   · **布局关键字与比例**：`display: 'flex'` / `flexDirection` / `alignItems` /
 *     `justifyContent` / `flex: 1` / `flexWrap` / `textAlign` / `listStyle` /
 *     `position` / `overflow` / `fontVariantNumeric`。这些**不是设计尺度**，
 *     它们决定的是"怎么排"，不是"多大多粗什么颜色"。把它们算进来，
 *     命中数会从"几处"涨到"上百处"，判据随即失去意义。
 *   · **相对单位与比例**：`'100%'` / `'auto'` / `'none'` / `em` / `rem` / `ch` /
 *     `vw` / `vh` —— 随上下文变化，不是固定设计尺度（与 `check:design` 同一取舍）。
 *   · **`0` 与 `1px`**：零值不需要单位；`1px` 发丝线是渲染细节（同上）。
 *   · **属性不在上面那张表里的数字**：`width` / `height` / `minWidth` /
 *     `top` / `bottom` / `left` / `right` / `opacity`。它们常由内容或屏幕驱动，
 *     或本来就是比例 —— `check:design` 当初**量过**（宽集 29 处命中里 16 处是
 *     `opacity`、8 处是定位偏移），结论是宽集大半是合法布局值，所以只收窄集。
 *     这道门禁沿用**同一份属性表**，不另发明一套。
 *   · **图标尺寸 prop**（`<Trash2 size={40} />`）：那是组件 prop 不是样式属性。
 *     它对不对属于 L1 的契约，不属于这道门禁。
 *
 * **禁止（断言 B：token 只许来自 `var(--ht-*)`）**
 *
 *   L4 视图里出现 `var(--<别的>)` 即违规。契约说"设计 token 只许来自
 *   `var(--ht-*)`（web）" —— 视图自己定义一个 CSS 变量，就是又长出一个
 *   不受 `tokens.css` 管理的取值，而它**不会报错**。
 *
 * **禁止（断言 C：内联样式只减不增）**
 *
 *   §5 原文把 `style={{…}}` 也列进了禁止项。但工作区今天有 **162 处**内联样式
 *   （web features）+ **121 处**（mobile screens），而且**此刻正被并行的 focus
 *   迁移改动**。一次性把它们全判红，等于让 `pnpm check` 长期全红 ——
 *   而 AGENTS.md #25 的结论是"**长期全红的门禁等于没有门禁**"。
 *
 *   所以这一条实现成 `check-row-single-source.mjs` 里 `HT_FAMILY_BASELINE`
 *   的同一个形状：**基线 + 只减不增**。值取自 **HEAD（`ea922b0`）的实测**，
 *   不是取自"当时工作区" —— 因为工作区里那 12/2 处是在途改动，
 *   按契约它们**是违规**，不该被基线悄悄收编。详见下面的 `INLINE_STYLE_BASELINE`。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 匹配不到就跳过，是禁止的
 * ─────────────────────────────────────────────────────────────────────────
 *
 * `check-pricing-consistency.mjs` 文件头那条纪律适用于这里：判据失效的典型症状
 * **不是报错，而是永远通过**。所以本脚本有三道自检：
 *
 *   1. **内置正控**（`CONTROL_SAMPLE`）：把 5 类违规样本喂给检测器，
 *      任何一类打不中 → 直接报错退出。这保证"正则被改坏"不会变成"永远绿"。
 *   2. **扫描文件数必须 > 0**：范围目录整个消失（改名/搬家）→ 报错，不是 ✅。
 *   3. **基线必须非零**：基线被改成 0 而代码里仍有内联样式 → 会被断言 C 抓住；
 *      但基线常量本身若被误改成 `0`，报告会指出"工作区有 N 处 > 基线 0"。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 故障注入（已实测，都能红；注入跑在 `HEYTA_CHECK_ROOT` 副本上，不动工作区）
 * ─────────────────────────────────────────────────────────────────────────
 *
 *   A1  在 `features/tasks/NoteEditor.tsx` 里加一行 `color: '#FF0000'`      → 断言 A 红
 *   A2  在 `features/habits/HabitsView.tsx` 里把 `gap: cssVar(...)` 改成 `gap: 16` → 断言 A 红
 *   A3  在 `features/trash/TrashView.tsx` 里加一个自定义变量 `var(--brand-x)` → 断言 B 红
 *   A4  把 `apps/mobile/src/screens/TasksScreen.tsx` 复制成 `ProbeDupScreen.tsx`
 *       （内联样式 114 → 128 > 基线 119）                              → 断言 C 红
 *
 * 用法：node scripts/check-l4-no-style.mjs
 *   非零退出 = 有违规。
 *
 * `HEYTA_CHECK_ROOT`：与 `check-pricing-consistency.mjs` 同一个约定 ——
 * 只给**故障注入探针**用（把门禁跑在 `/tmp` 的副本上，不动共享工作区）。
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT =
  process.env.HEYTA_CHECK_ROOT === undefined
    ? resolve(dirname(fileURLToPath(import.meta.url)), '..')
    : resolve(process.env.HEYTA_CHECK_ROOT);

/**
 * 扫描范围。每项：一个 L4 根 + 它的豁免子目录。
 *
 * `baseline` 是断言 C 的棘轮上限，单位是"含 `style={{` 的**行数**"。
 * 三个值都取自 **HEAD `ea922b0`（2026-09-28）的实测**，命令：
 *
 *   git grep -c 'style={{' HEAD -- apps/web/src/features | grep -v /shell/ | awk -F: '{s+=$NF} END {print s}'   # 150
 *   git grep -c 'style={{' HEAD -- apps/mobile/src/screens | awk -F: '{s+=$NF} END {print s}'                    # 119
 */
const SCOPES = [
  {
    label: 'apps/web/src/features（L4 视图）',
    root: 'apps/web/src/features',
    exemptDirs: ['shell'],
    /**
     * 🔴 **棘轮到实测值（2026-09-28 晚，产品决策 P1）。150 → 128。**
     *
     * 旧基线取自 `ea922b0`（M3 开工前）。M3 前五刀（tasks/focus/categories/sync/settings）
     * 把 web features 的内联样式从 150 降到 **128**。基线停在 150 意味着
     * **白白送掉 22 次回潮额度** —— 这道门禁的全部意义是"只减不增"，
     * 而留 15% 松量的基线做不到这件事（本文件 :457 自己就写着这句话）。
     *
     * ⚠️ 再降时必须先看**实测**，且只降到实测值；**不许**为了让某次改动通过而调高。
     */
    /** 🔴 P1 棘轮第五次：104 → **98**（Vault 设置迁入共享 settings 原语后实测，-6）。只降到实测值。 */
    baseline: 98,
  },
  {
    label: 'apps/mobile/src/screens（L4 视图）',
    root: 'apps/mobile/src/screens',
    exemptDirs: [],
    /** 🔴 棘轮第四次：93 → **90**（M3 第九刀 projects 落地后实测，-3）。 */
    baseline: 90,
  },
];

const SOURCE_EXTENSIONS = ['.ts', '.tsx'];
const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', 'coverage', '.expo', '.turbo']);

/* ========================================================================
 * 检测器
 * ====================================================================== */

/** 尺度属性表 —— 与 `check:design` 第 6 类**同一份**（见文件头「允许什么」）。 */
const SCALE_PROPS = [
  'padding',
  'paddingTop',
  'paddingBottom',
  'paddingLeft',
  'paddingRight',
  'paddingHorizontal',
  'paddingVertical',
  'margin',
  'marginTop',
  'marginBottom',
  'marginLeft',
  'marginRight',
  'marginHorizontal',
  'marginVertical',
  'borderRadius',
  'borderTopLeftRadius',
  'borderTopRightRadius',
  'borderBottomLeftRadius',
  'borderBottomRightRadius',
  'fontSize',
  'gap',
  'rowGap',
  'columnGap',
].join('|');

const CHECKS = [
  {
    key: '颜色字面量',
    // hex：排除 `#foo`（CSS id / URL 锚点）。长度校验与 check:design 一致。
    re: /(?<![\w&])#[0-9a-fA-F]{3,8}\b/g,
    validate: (m) => [4, 5, 7, 9].includes(m.length),
    hint: "用 cssVar('color.…')（web）或 tokens['color.…']（RN）。缺哪个 token 就先往 tokens.css 加。",
  },
  {
    key: '颜色函数',
    re: /\b(?:rgba?|hsla?)\(\s*[\d.]/g,
    hint: '半透明色也要登记为 token（如 --ht-color-overlay），不要在视图里现算。',
  },
  {
    key: 'px 长度字面量',
    re: /(?<![\w-])\d+(?:\.\d+)?px\b/g,
    validate: (m) => m !== '0px' && m !== '1px',
    hint: "用 cssVar('space.…' / 'font-size.…' / 'radius.…')。",
  },
  {
    // ⚠️ 尺度属性的**字符串形态**（`padding: '16px'`）刻意不单列一条规则：
    // 它已经被上面的「px 长度字面量」覆盖，单列只会让同一处报两遍
    // —— 而重复的报错会让人以为"问题比实际多"，进而放宽判据。
    key: '尺度属性上的裸数字（RN 形态）',
    // 数字后面必须紧跟收尾（引号 / 逗号 / 花括号 / 换行），否则 `16rem` 会被误报。
    re: new RegExp(
      `(?<![\\w.-])(?:${SCALE_PROPS})\\s*:\\s*(?!0(?![.\\d]))\\d+(?:\\.\\d+)?(?=\\s*['"\`]|[\\s,}\\n])`,
      'g',
    ),
    hint: "改成 tokens['space.…']（`useTokens()` 拿）。",
  },
  {
    key: 'z-index 字面量',
    re: /(?:z-index|zIndex)\s*:\s*-?\d+/g,
    hint: "用 cssVar('z.…')，阶梯已在 tokens.css 定义。",
  },
];

/** 断言 B：web 侧 token 只许 `var(--ht-*)`；RN 侧不许出现 `var(`（RN 没有 CSS 变量）。 */
const NON_HT_VAR = /var\(--(?!ht-)[A-Za-z0-9-]+/g;

/** 断言 C 的度量：含内联样式对象的行。 */
const INLINE_STYLE = /style=\{\{/;

/**
 * 🔴 内置正控。
 *
 * 这是本脚本对"匹配不到就跳过"的正面答案：**不依赖工作区**，
 * 把每一类违规样本喂给检测器，打不中就说明检测器坏了 —— 那时应当红，
 * 而不是"工作区很干净，✅"。
 */
const CONTROL_SAMPLE = [
  { key: '颜色字面量', text: "const x = { background: '#FF0000' };" },
  { key: '颜色函数', text: "const x = { color: 'rgba(0, 0, 0, 0.5)' };" },
  { key: 'px 长度字面量', text: "const x = { marginTop: '13px' };" },
  { key: '尺度属性上的裸数字（RN 形态）', text: 'const x = { gap: 12, marginBottom: 8 };' },
  { key: 'z-index 字面量', text: 'const x = { zIndex: 999 };' },
];

/* ========================================================================
 * 工具
 * ====================================================================== */

/**
 * 抹掉注释，**保留行数与列位置**（换行不动，其余字符换空格）。
 *
 * 🔴 不抹注释会有真实误报：实测 `features/**` 里有 4 处注释写着
 * `// ≥16px，否则 iOS 聚焦时自动放大页面`。把注释当代码，
 * 这 4 处会立刻变红 —— 而误报的代价是有人来放宽正则，然后真的违规也拦不住。
 */
function stripComments(src) {
  const out = src.split('');
  const n = src.length;
  let i = 0;
  while (i < n) {
    if (src[i] === '/' && src[i + 1] === '/') {
      let j = i;
      while (j < n && src[j] !== '\n') j++;
      for (let k = i; k < j; k++) out[k] = ' ';
      i = j;
      continue;
    }
    if (src[i] === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      const j = end === -1 ? n : end + 2;
      for (let k = i; k < j; k++) if (src[k] !== '\n') out[k] = ' ';
      i = j;
      continue;
    }
    i++;
  }
  return out.join('');
}

function lineAt(text, offset) {
  let line = 1;
  for (let i = 0; i < offset && i < text.length; i++) if (text[i] === '\n') line++;
  return line;
}

function* walk(dir, exemptAbs) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    if (exemptAbs.some((e) => full === e || full.startsWith(e + sep))) continue;
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      yield* walk(full, exemptAbs);
    } else if (SOURCE_EXTENSIONS.some((e) => name.endsWith(e))) {
      // 测试文件不算视图：它们可以断言选择器 / 造夹具，不渲染产品界面。
      if (/\.(spec|test)\.[cm]?tsx?$/.test(name)) continue;
      yield full;
    }
  }
}

/* ========================================================================
 * 正控：检测器先自证有效
 * ====================================================================== */

let controlFailed = false;
for (const sample of CONTROL_SAMPLE) {
  const check = CHECKS.find((c) => c.key === sample.key);
  const code = stripComments(sample.text);
  let hit = false;
  for (const m of code.matchAll(check.re)) {
    if (check.validate && !check.validate(m[0])) continue;
    hit = true;
    break;
  }
  if (!hit) {
    controlFailed = true;
    console.error(
      `🔴 内置正控失败：样本「${sample.text}」没有被「${sample.key}」检测器打中。\n` +
        `   ⇒ 检测器自己坏了。这时**不能**报"没有违规" —— 那道检查已经失效。\n` +
        `   修法：检查本脚本 CHECKS 里的正则（判据不许放宽）。\n`,
    );
  }
}
if (controlFailed) process.exit(1);

/* ========================================================================
 * 扫描
 * ====================================================================== */

const problems = []; // { rel, line, kind, text, hint }
const ratchet = []; // { label, count, baseline, files }
let scannedFiles = 0;

for (const scope of SCOPES) {
  const absRoot = join(ROOT, scope.root);
  if (!existsSync(absRoot)) {
    console.error(
      `🔴 找不到扫描根 ${scope.root}。\n` +
        `   ⇒ 判据锚在这个目录上；它改名/搬家之后本检查必须**报错**，\n` +
        `      而不是"0 个文件，✅"（那正是一个永远通过的门禁）。\n`,
    );
    process.exit(1);
  }
  const exemptAbs = scope.exemptDirs.map((d) => join(absRoot, d));

  let inlineLines = 0;
  const filesWithInline = new Set();

  for (const file of walk(absRoot, exemptAbs)) {
    scannedFiles += 1;
    const rel = relative(ROOT, file);
    const source = stripComments(readFileSync(file, 'utf8'));

    for (const check of CHECKS) {
      for (const m of source.matchAll(check.re)) {
        if (check.validate && !check.validate(m[0])) continue;
        problems.push({
          rel,
          line: lineAt(source, m.index),
          kind: check.key,
          text: m[0],
          hint: check.hint,
        });
      }
    }
    for (const m of source.matchAll(NON_HT_VAR)) {
      problems.push({
        rel,
        line: lineAt(source, m.index),
        kind: '非 --ht- 的 CSS 变量',
        text: m[0],
        hint:
          '设计 token 只许来自 tokens.css（`var(--ht-*)`）。' +
          '要在视图里定义自己的变量 = 又一份不受 token 管理的取值，而它不会报错。',
      });
    }

    for (const line of source.split('\n')) {
      if (!INLINE_STYLE.test(line)) continue;
      inlineLines += 1;
      filesWithInline.add(rel);
    }
  }

  ratchet.push({ ...scope, count: inlineLines, files: [...filesWithInline].sort() });
}

if (scannedFiles === 0) {
  console.error(
    '🔴 一个 L4 源文件都没扫到。\n' +
      '   ⇒ 范围缺口不会报错，只会静默失效（AGENTS.md M0-4 的实测教训）。\n',
  );
  process.exit(1);
}

/* ========================================================================
 * 报告
 * ====================================================================== */

let failed = false;

console.log('─'.repeat(72));
console.log('断言 A/B：L4 视图不许有样式字面量与自定义 CSS 变量');
console.log('─'.repeat(72));

if (problems.length > 0) {
  failed = true;
  console.error(`🔴 ${String(problems.length)} 处：\n`);
  for (const p of problems) {
    console.error(`   ${p.rel}:${String(p.line)}  [${p.kind}]  ${p.text}`);
  }
  console.error(`\n   修法：${problems[0].hint}`);
  console.error(
    `   ⇒ L4 的职责是"查询 + 组合"，不是"定样式"（dida-view-unification.md §4.1）。\n` +
      `      这个值该搬到 L1/L2：packages/ui 的 primitives/patterns（web 与 RN 共用）\n` +
      `      或 app 自己的 ui kit。**不要把判据放宽** —— 窄是刻意的（见文件头）。\n`,
  );
} else {
  console.log(`✅ 没有样式字面量、没有自定义 CSS 变量（扫描 ${String(scannedFiles)} 个文件）。`);
}

console.log('');
console.log('─'.repeat(72));
console.log('断言 C：内联样式 style={{…}} 只减不增');
console.log('─'.repeat(72));

for (const r of ratchet) {
  const delta = r.count - r.baseline;
  if (delta > 0) {
    failed = true;
    console.error(
      `🔴 ${r.label}：内联样式 ${String(r.count)} 处 > 基线 ${String(r.baseline)}（多了 ${String(delta)} 处）。`,
    );
    console.error(`   含内联样式的文件（共 ${String(r.files.length)} 个）：`);
    for (const f of r.files) console.error(`      ${f}`);
    console.error('');
  } else if (delta < 0) {
    console.log(
      `✅ ${r.label}：内联样式 ${String(r.count)} 处 ≤ 基线 ${String(r.baseline)}（已降 ${String(-delta)} 处）。`,
    );
    console.log(
      `   ⬇️ 建议把本脚本 SCOPES 里这个范围的 baseline 下调到 ${String(r.count)} ——\n` +
        `      基线不跟着降就会变成永久豁免，"只减不增"就只剩前半句。`,
    );
  } else {
    console.log(
      `✅ ${r.label}：内联样式 ${String(r.count)} 处，恰在基线 ${String(r.baseline)}（未新增）。`,
    );
  }
}

if (ratchet.some((r) => r.count > r.baseline)) {
  console.error(
    `   ⇒ §5 把 \`style={{…}}\` 列进了禁止项；M3 的方向是让视图改用共享模式组件\n` +
      `      （ListSurface / TaskRow / EmptyState…），而不是继续在 features 里写内联样式。\n` +
      `      ⚠️ **不要为了变绿直接把 baseline 调高**：先确认这批内联样式是不是\n` +
      `      迁移中间态；是的话让总数降回基线以下，不是让基线涨到总数。\n` +
      `      基线的来历（HEAD ea922b0 实测）写在脚本文件头。\n`,
  );
}

console.log('');
if (failed) {
  console.error('🔴 L4「不写样式」门禁未通过。\n');
  process.exit(1);
}
console.log('✅ L4 不写样式：三道断言都通过。\n');
