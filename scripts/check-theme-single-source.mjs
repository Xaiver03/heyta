#!/usr/bin/env node
/**
 * 「theme 只有一份」—— 结构性门禁
 * ================================
 *
 * 判据出处：`docs/research/dida-view-unification.md` §5（门禁表）与 §8.4（怎么验收）：
 *
 *   | **theme 只有一份** | 只允许 `packages/ui` 提供 `useTokens`；
 *   |                    | `apps/mobile/src/theme.tsx` 变转发或删除 | ❌ 待建 |
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 为什么需要这一道（不是风格检查）
 * ─────────────────────────────────────────────────────────────────────────
 *
 * 收敛之前，`apps/mobile/src/theme.tsx` 是主题的**第二份实现**：它自己调
 * `resolveNativeTokens` / `resolveAllTextStyles` 建 token 表与文字样式表，
 * 再由 `app.tsx` 的 `UiThemeBridge` 把值回灌给 `HeytaUiProvider`。
 *
 * 于是同一份主题被解析两遍：
 *
 *   1. 两张表各有一份"谁是权威"的答案 —— 改了一处、另一处不跟，**不报错**；
 *   2. `AccessibilityInfo` 的 `reduceMotionChanged` 被订阅两次；
 *   3. "哪份主题才是权威"这个问题在每个宿主里重新出现一次。
 *
 * 这个形状和 `check-pricing-consistency.mjs` 要防的是同一类：**同一个东西
 * 住在两处、类型系统看不见两者之间的关系、漂移时不报错**。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 它查什么（刻意窄 —— 判据只有"第二处**定义**"）
 * ─────────────────────────────────────────────────────────────────────────
 *
 * 唯一真相在 `packages/ui`（它从 L0 的 `packages/design-system` 派生）。
 * 除这两个包以外，任何源码文件**不得**：
 *
 *   R1 **建表**   调用 `resolveNativeTokens(` 或 `resolveAllTextStyles(`
 *   R2 **定义 hook**   `export function/const useTokens|useText|useHeytaTokens|
 *                       useHeytaText|useHeytaUiTheme`（**转发** re-export 不算）
 *   R3 **引用原始数据表** `lightTokens` / `darkTokens` / `reducedMotionTokens`
 *
 * 🔴 **刻意不把 `tokensForTheme()` / `TEXT_STYLES` 算进来**：它们是 L0 的
 * *读取*入口，不是"第二份定义"。`packages/widget-core/src/selectors.ts` 必须在
 * 没有 React 的地方读 token 十六进制值（小组件快照），那是合法消费；
 * `apps/web/src/lib/text.ts` 也合法地读 `TEXT_STYLES` 派生 CSS。
 * 把它们算进来只会制造噪音，然后被人用注释绕过。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 匹配不到时**不许跳过**（本仓库反复吃过的亏）
 * ─────────────────────────────────────────────────────────────────────────
 *
 * `check-pricing-consistency.mjs` 文件头把这条纪律写得很清楚：一道在重构改名
 * 之后**永远通过**的检查，比没有更坏。所以本脚本除了"查违规"，还必须先证明
 * 自己**查对了地方**：
 *
 *   锚点 A：`packages/ui/src/theme.tsx` 存在，且真的 `export function useHeytaTokens`
 *           并调用 `resolveNativeTokens(`（唯一那份表的建表点）。
 *   锚点 B：扫描范围内至少有一个**消费者**提到 `useTokens` / `useText` /
 *           `useHeytaTokens` / `useHeytaText` / `useTheme`。
 *   锚点 C：`apps/mobile/src/theme.tsx` 若存在，必须是从 `@heyta/ui` 的**转发**
 *           （以 "删除" 为合法终态 —— §5 允许"转发**或**删除"，所以缺文件不算违规，
 *            但文件名/导出被改坏而既不在、又不转发时，锚点 B 会先红）。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 显式豁免：`apps/landing/`（**判决，不是遗漏**）
 * ─────────────────────────────────────────────────────────────────────────
 *
 * `apps/landing/src/lib/theme.ts` 有一个自己的 `useTheme()`，那是**营销页自己的
 * 明暗切换**（DOM 站点的外观），不是应用 token 主题。而 §9.1 已经裁定
 * landing **不得**静态引入 `@heyta/ui`（首屏 +61.9 kB gzip）。
 * 两者相撞，所以 landing 整目录从本门禁的扫描范围里**显式**排除。
 * 代价要如实说：landing 若真的长出了第二张应用 token 表，这道门禁不会红 ——
 * 那时该先撤销 §9.1 的豁免，再把它并进来。
 *
 * 用法：node scripts/check-theme-single-source.mjs
 *   非零退出 = 有违规，或锚点缺失（门禁没查到它该查的地方）。
 *   `HEYTA_CHECK_ROOT` 可指向一份**副本**（只给故障注入探针用，
 *   见 `check-pricing-consistency.mjs` 对同一开关的说明）。
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT =
  process.env.HEYTA_CHECK_ROOT === undefined
    ? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
    : path.resolve(process.env.HEYTA_CHECK_ROOT);

/** 唯一真相所在的两个包。L0 是 `design-system`，`ui` 是它面向 React 的唯一出口。 */
const ALLOWED_PREFIXES = ['packages/ui/', 'packages/design-system/'];

/** 🔴 显式豁免（理由见文件头）。别把这里当成"随便加白名单"的地方。 */
const EXEMPT_PREFIXES = ['apps/landing/'];

/** 扫描范围内的源码。 */
const SCAN_DIRS = ['apps', 'packages'];

const SKIP_DIRS = new Set(['node_modules', 'dist', 'dist-types', 'build', '.git']);

const RULES = [
  {
    id: 'R1 建表',
    re: /\b(?:resolveNativeTokens|resolveAllTextStyles)\s*\(/,
    why:
      '自己调用解析函数建 token 表 / 文字样式表 = 第二份真相。' +
      '宿主应当从 `@heyta/ui` 的 `useHeytaTokens()` / `useHeytaText()` 取（或转发）。',
  },
  {
    id: 'R2 定义 hook',
    re: /export\s+(?:async\s+)?(?:function|const|let|var)\s+(useTokens|useText|useHeytaTokens|useHeytaText|useHeytaUiTheme)\b/,
    why:
      '自己定义主题 hook。允许**转发**（`export { useHeytaTokens as useTokens } from "@heyta/ui"`），' +
      '不允许再实现一遍 context。',
  },
  {
    id: 'R3 原始数据表',
    re: /\b(lightTokens|darkTokens|reducedMotionTokens)\b/,
    why:
      '直接引用 L0 的原始 token 数据表。读取请走 `tokensForTheme()` / `cssVar()` / `useHeytaTokens()`；' +
      '只有 `packages/design-system` 内部与 `packages/ui` 的建表点可以直接拿表。',
  },
];

/**
 * 去掉注释与字符串字面量，避免"注释里提到某个名字"把门禁变红。
 *
 * 这不是完整的 TS 词法分析，但足以覆盖本仓库的用法；**保留换行**，
 * 这样报告里的行号仍然对得上原文件。
 *
 * 🔴 为什么必须做这一步：移动端转发文件的文件头就写着"它以前自己调
 * `resolveNativeTokens` / `resolveAllTextStyles`" —— 不剥注释的话，
 * 那句**说明它已经改好**的话本身会让门禁变红。
 */
function stripCommentsAndStrings(text) {
  let out = '';
  let i = 0;
  const n = text.length;
  while (i < n) {
    const c = text[i];
    const next = text[i + 1];
    if (c === '/' && next === '/') {
      while (i < n && text[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && next === '*') {
      i += 2;
      while (i < n && !(text[i] === '*' && text[i + 1] === '/')) {
        if (text[i] === '\n') out += '\n';
        i++;
      }
      i += 2;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      const quote = c;
      i++;
      while (i < n) {
        if (text[i] === '\\') {
          i += 2;
          continue;
        }
        if (text[i] === quote) {
          i++;
          break;
        }
        if (text[i] === '\n') out += '\n';
        i++;
      }
      out += ' ';
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

/** 递归收集 `.ts` / `.tsx`（跳过构建产物、依赖与豁免目录）。 */
function collectSourceFiles(dir) {
  const out = [];
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      const rel = path.relative(ROOT, full).split(path.sep).join('/') + '/';
      if (EXEMPT_PREFIXES.some((p) => rel === p || rel.startsWith(p))) continue;
      out.push(...collectSourceFiles(full));
    } else if (/\.tsx?$/.test(entry) && !/\.d\.ts$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

const relOf = (file) => path.relative(ROOT, file).split(path.sep).join('/');
const isAllowed = (rel) => ALLOWED_PREFIXES.some((p) => rel === p || rel.startsWith(p));

const DEFAULTS = {
  /** 唯一建表点。改名/搬家会让这里红 —— 那正是"门禁永远变绿"要防的时刻。 */
  SINGLE_SOURCE: 'packages/ui/src/theme.tsx',
  /** 移动端宿主层：§5 允许它"转发或删除"。 */
  MOBILE_FORWARDER: 'apps/mobile/src/theme.tsx',
};

const CONSUMER_RE =
  /\buseTokens\b|\buseText\b|\buseHeytaTokens\b|\buseHeytaText\b|\buseHeytaUiTheme\b|\buseTheme\b/;

const problems = [];
const anchorProblems = [];

// ── 锚点 A：唯一建表点真的存在，且真的在建表 ────────────────────────────────
const singleSourcePath = path.join(ROOT, DEFAULTS.SINGLE_SOURCE);
let singleSourceText = null;
try {
  singleSourceText = readFileSync(singleSourcePath, 'utf8');
} catch {
  anchorProblems.push(
    `找不到唯一建表点 ${DEFAULTS.SINGLE_SOURCE}。` +
      `门禁的判据钉在这个文件上；它搬家/改名了 ⇒ 请同步改 DEFAULTS.SINGLE_SOURCE，` +
      `**不要**让门禁因为找不到锚点而静默通过。`,
  );
}
if (singleSourceText !== null) {
  const code = stripCommentsAndStrings(singleSourceText);
  if (!/export\s+function\s+useHeytaTokens\b/.test(code)) {
    anchorProblems.push(
      `${DEFAULTS.SINGLE_SOURCE} 里没有 \`export function useHeytaTokens\`。` +
        `若它被改名/搬走了，请同步本脚本 —— 锚点缺失必须是红，不是跳过。`,
    );
  }
  if (!/\bresolveNativeTokens\s*\(/.test(code)) {
    anchorProblems.push(
      `${DEFAULTS.SINGLE_SOURCE} 里没有调用 \`resolveNativeTokens(\` —— ` +
        `也就是说唯一建表点已经不再建表了，判据落空。`,
    );
  }
}

// ── 收集并逐条匹配 ───────────────────────────────────────────────────────────
const files = SCAN_DIRS.flatMap((d) => collectSourceFiles(path.join(ROOT, d)));
const scanned = files.filter((f) => !isAllowed(relOf(f)));

let consumerHits = 0;

for (const file of scanned) {
  const rel = relOf(file);
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    continue;
  }
  const code = stripCommentsAndStrings(text);
  if (CONSUMER_RE.test(code)) consumerHits++;

  const codeLines = code.split('\n');
  // 报告里贴**原文**那一行（剥注释/字符串只用于匹配，不用于显示 ——
  // 否则 `resolveNativeTokens({ theme: 'light' })` 会显示成 `theme:  `）。
  const rawLines = text.split('\n');
  for (const rule of RULES) {
    for (let i = 0; i < codeLines.length; i++) {
      if (rule.re.test(codeLines[i])) {
        problems.push({
          rel,
          line: i + 1,
          rule: rule.id,
          hit: (rawLines[i] ?? codeLines[i]).trim().slice(0, 120),
          why: rule.why,
        });
      }
    }
  }
}

// ── 锚点 B：扫描范围内真的有人在消费主题 ────────────────────────────────────
if (consumerHits === 0) {
  anchorProblems.push(
    `扫描范围内（${scanned.length} 个文件）没有任何文件提到 useTokens / useText / useTheme。` +
      `要么根目录指错了（HEYTA_CHECK_ROOT？），要么宿主全被改了名 —— ` +
      `无论哪种，这道门禁此刻都没有在保护任何东西。`,
  );
}

// ── 锚点 C：移动端主题层必须只剩转发（或被合法删除） ────────────────────────
const mobilePath = path.join(ROOT, DEFAULTS.MOBILE_FORWARDER);
let mobileState;
try {
  // ⚠️ 这里用**原文**而不是剥注释后的文本：`stripCommentsAndStrings` 会把字符串
  //    的内容也抹掉，于是 `from '@heyta/ui'` 不再可辨。移动端文件头的说明文字里
  //    并不包含这个完整片段，所以直接在原文上匹配是安全的。
  const mobileRaw = readFileSync(mobilePath, 'utf8');
  const forwards = /from\s*['"]@heyta\/ui['"]/.test(mobileRaw);
  mobileState = forwards
    ? `${DEFAULTS.MOBILE_FORWARDER} 是转发 ✅`
    : `${DEFAULTS.MOBILE_FORWARDER} 存在但没有从 '@heyta/ui' 转发 ❌`;
  if (!forwards) {
    problems.push({
      rel: DEFAULTS.MOBILE_FORWARDER,
      line: 1,
      rule: '锚点 C 不是转发',
      hit: '（整个文件）',
      why:
        '§5 允许移动端主题层"转发或删除"，但**不允许**它是第二份实现。' +
        '请把 token / 文本样式改为 re-export `@heyta/ui`（见该文件头）。',
    });
  }
} catch {
  mobileState = `${DEFAULTS.MOBILE_FORWARDER} 不存在（视为"删除"这一合法终态）；调用点应直接 import '@heyta/ui'`;
}

// ── 报告 ─────────────────────────────────────────────────────────────────────
if (anchorProblems.length > 0) {
  console.error('🔴 theme 门禁的锚点缺失 —— 它没有在保护它该保护的东西：\n');
  for (const p of anchorProblems) console.error(`  · ${p}\n`);
  console.error('  （锚点缺失必须报错。一道在重构改名后会永远通过的门禁，比没有更坏。）');
  process.exit(1);
}

if (problems.length > 0) {
  console.error('🔴 theme 不是只有一份 —— 出现了第二处定义：\n');
  for (const p of problems) {
    console.error(`  · [${p.rule}] ${p.rel}:${String(p.line)}`);
    console.error(`      ${p.hit}`);
    console.error(`      ⇒ ${p.why}\n`);
  }
  console.error(
    `  唯一真相在 ${DEFAULTS.SINGLE_SOURCE}（L0 是 packages/design-system）。` +
      `宿主只允许取用或转发，不允许重新建表。`,
  );
  process.exit(1);
}

console.log(
  `✅ theme 只有一份：唯一建表点 ${DEFAULTS.SINGLE_SOURCE}；扫描 ${String(scanned.length)} 个文件，` +
    `无第二处建表 / hook 定义 / 原始表引用。${mobileState}。`,
);
