#!/usr/bin/env node
/**
 * 「共享层的每一段文字都必须有颜色」—— 结构性门禁
 * =================================================
 *
 * 2026-09-30 暗色审计实测：日历的月份标题「2026年9月」与分组头「无截止时间」
 * 在暗色下是**近黑字压近黑底**（1.04:1 / 1.15:1）。人眼看到的是"字没了"，
 * 而全仓没有任何一层会为此报错。
 *
 * 根因不是某个组件写错了，是一条**平台事实**：
 * RN 与 react-native-web 的 `Text` 默认色是**纯黑**，不是"继承容器色"。
 * RNW 的 `css-text-*` 基类里就写着 `color: rgb(0,0,0)`
 * （排除法证据：`reset.css` 给 `body` 设了 `color: var(--ht-color-foreground)`，
 * 而 `color` 是可继承属性 —— 实测仍算出纯黑，说明 RNW 显式覆盖了它）。
 *
 * 主修在 `packages/design-system/src/typography.ts`：**每条语义文字样式
 * 自带默认前景色**，所以 `<Text style={text['row-title']} />` 结构上不可能没色。
 *
 * 这道门禁钉的是**剩下的那条缝**：一个 `<Text>` 既没用任何语义样式、
 * 自己也没写颜色 —— 那它就是在替 RN 的默认色说话。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 判据
 * ─────────────────────────────────────────────────────────────────────────
 *
 * 对 `packages/ui/src/**` 的每个 `<Text>`，下面四条**满足任一**即合规：
 *
 *   1. 开标签里直接写了 `color`（`color:` 或 `color={`）；
 *   2. 引用了本文件 `StyleSheet.create` 里**含 color** 的样式键；
 *   3. 引用了语义文字样式（`text['x']` / `text.x`）—— 默认色由 typography 供；
 *   4. 它嵌在另一个**已判定有色**的 `<Text>` 里（RN 的 Text 嵌套继承父色）。
 *
 * 🔴 注释一律先掩码（`maskSource`）。不掩码会把注释里的示例 JSX 数进来 ——
 * 上一版一次性脚本就是这么虚报了 5 处，而"门禁有一堆假红"的终局永远是
 * 被人加白名单绕过。
 *
 * 🔴 锚点（匹配不到时不许跳过）：扫描必须真的看到 `> 0` 个 `<Text>`，
 * 且 `packages/ui/src/theme.tsx` 真的导出 `useHeytaText`。
 * 任何一条不成立 ⇒ 红。一道在改名之后永远通过的检查比没有更坏。
 */

import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

import { scanJsxTree, lineAt } from './lib/jsx-tree.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..');
const SCAN_ROOT = join(REPO, 'packages/ui/src');

const failures = [];
const notes = [];

/* ── 锚点：先证明"我要查的东西还在原地" ───────────────────────────── */
const themeFile = join(SCAN_ROOT, 'theme.tsx');
if (!existsSync(themeFile) || !/export function useHeytaText\b/.test(readFileSync(themeFile, 'utf8'))) {
  console.error(
    '❌ 锚点失败：packages/ui/src/theme.tsx 不再导出 useHeytaText。\n' +
      '   本门禁依赖"语义文字样式"这一判据（第 3 条），它改名后这里会**静默全绿**。\n' +
      '   改名的话请同步更新本脚本，不要删掉它。',
  );
  process.exit(1);
}

/** 本文件 `StyleSheet.create` / 对象字面量里**含 color** 的样式键。 */
function coloredStyleKeys(code) {
  const keys = new Set();
  for (const m of code.matchAll(/([A-Za-z_$][\w$]*)\s*:\s*\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}/g)) {
    if (/\bcolor\s*[:(]/.test(m[2])) keys.add(m[1]);
  }
  return keys;
}

/**
 * 开标签的结束位置。
 *
 * 🔴 不能直接用 `node.end` —— `scanJsxTree` 在闭合时把它**改成了闭标签的末尾**，
 * 于是 `slice(start, end)` 是整个元素。拿它判色会让**子元素的 color 替父元素交卷**，
 * 而继承这件事判据 4 已经在管了（且管得比字符串切片准）。
 */
function openTagEnd(code, node) {
  let depth = 0;
  for (let i = node.start; i < node.end; i++) {
    const ch = code[i];
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
    else if (ch === '>' && depth === 0) return i + 1;
  }
  return node.end;
}

const files = [];
(function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.tsx$/.test(entry)) files.push(p);
  }
})(SCAN_ROOT);

let totalText = 0;

for (const file of files) {
  const src = readFileSync(file, 'utf8');
  const { nodes, code } = scanJsxTree(src);
  const colored = coloredStyleKeys(code);
  const texts = nodes.filter((n) => n.name === 'Text');
  totalText += texts.length;

  /** 第 1-3 条判据：这个开标签自己有没有色。 */
  function selfColored(node) {
    const tag = code.slice(node.start, openTagEnd(code, node)).replace(/\s+/g, ' ');
    if (/\bcolor\s*[:(=]/.test(tag) || /\btextColor\b/.test(tag)) return true;
    for (const r of tag.matchAll(/styles\s*[.[]\s*['"]?([A-Za-z_$][\w$]*)/g)) {
      if (colored.has(r[1])) return true;
    }
    return /\btext\s*[.[]/.test(tag);
  }

  const selfOk = new Map(texts.map((t) => [t, selfColored(t)]));
  for (const t of texts) {
    if (selfOk.get(t)) continue;
    // 第 4 条：父 <Text> 有色 ⇒ 继承。range 包含关系就是祖先关系。
    const parentOk = texts.some(
      (p) => p !== t && p.start <= t.start && t.end <= p.end && selfOk.get(p),
    );
    if (parentOk) continue;
    failures.push(
      `${relative(REPO, file)}:${String(lineAt(src, t.start))}  ${code
        .slice(t.start, openTagEnd(code, t))
        .replace(/\s+/g, ' ')
        .slice(0, 120)}`,
    );
  }
}

if (totalText === 0) {
  console.error(
    '❌ 锚点失败：一个 <Text> 都没扫到。要么扫描根目录变了，要么共享层不再用 Text ——\n' +
      '   两种都说明这道门禁已经不再检查任何东西了。',
  );
  process.exit(1);
}
notes.push(`扫到 ${String(totalText)} 个 <Text>（${String(files.length)} 个文件）`);

console.log(notes.join('\n'));
if (failures.length === 0) {
  console.log('✅ 共享层每个 <Text> 都有颜色（语义样式自带，或自己写了色）');
  process.exit(0);
}
console.error(
  `\n🔴 ${String(failures.length)} 个 <Text> 既没有语义文字样式、也没有颜色 ——` +
    `它会在暗色下画成**纯黑**：\n` +
    failures.map((f) => `   ${f}`).join('\n') +
    `\n\n   修法：用 <Text style={text['row-meta']}>（语义样式自带默认前景色），\n` +
    `   或显式给 color: tokens['color.foreground-muted']。\n` +
    `   不要给 StyleSheet 常量补一个裸 hex —— 那只是把缺陷换个位置。`,
);
process.exit(1);
