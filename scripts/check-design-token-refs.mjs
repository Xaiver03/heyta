#!/usr/bin/env node
/**
 * 门禁：设计 token 的**引用**必须都能解析到定义
 * ================================================
 *
 * ## 它钉的判断
 *
 * `var(--ht-does-not-exist)` 在浏览器里**不会报错** —— 它静默回退成继承值（或空）。
 * 于是"字号写错了"的表现不是红，而是**那一处字号看起来跟别处不一样**，
 * 而没有任何一层会说话。实测过一次：`var(--ht-font-size-caption)` 被用了 4 处，
 * 而这个 token 从来没定义过 ⇒ 那 4 处全都在放大字号。
 *
 * | 格 | 判据 | 红形 |
 * |---|---|---|
 * | 1 | 每个 `var(--ht-*)` 都能在样式表或下面的白名单里找到来源 | 有人写了拼错的 / 想当然的 token 名 |
 * | 2 | 白名单里的每个条目必须写明**注入点**，且那个文件仍然存在 | 运行时注入的变量被删了，白名单却留着（于是它悄悄变成死白名单） |
 * | 3 | 白名单**不许**长得比真实需要更长 | 有人为了消红把新 token 往白名单里一塞 —— 那等于关掉这道闸 |
 *
 * ## 为什么是源码层
 *
 * `check:tokens` 对的是**生成产物**（tokens.css → 各端常量）一致，它不读使用点；
 * 样式门禁（`check:design` / `check:l4`）管的是"不许裸值"，也不管名字对不对。
 * 中间这一格一直是空的 —— 而它恰好是"整套 UI 看起来坏了"最常见的成因。
 *
 * ## 用法
 *
 * ```bash
 * node scripts/check-design-token-refs.mjs            # 查真仓
 * node scripts/check-design-token-refs.mjs --self-test # 先证明这把尺会红
 * ```
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import process from 'node:process';

const ROOT = process.cwd();

/** 扫哪些地方。**只扫产品代码**：测试里造夹具是允许写假 token 的。 */
const SCAN_ROOTS = ['apps/web/src', 'apps/mobile/src', 'packages/ui/src'];
const SCAN_EXT = ['.css', '.tsx', '.ts'];

/** 定义从哪来。`tokens.css` 是唯一事实源；其余 CSS 里局部定义的也算数。 */
const DEFINITION_ROOTS = ['packages/design-system/src', 'apps/web/src', 'apps/mobile/src', 'packages/ui/src'];

/**
 * 运行时注入 / 可选覆盖 —— **每条必须写清注入点或 fallback 依据**。
 *
 * 🔴 这张表是本门禁的**唯一豁免**。往里加东西之前先问：这个变量真的没有静态定义吗？
 * 如果只是"我懒得写 token"，那是往闸门上开口子。
 */
const ALLOWED = [
  { token: '--ht-detail-width', reason: '列宽由 ColumnResizer 按用户拖动写入', injectedAt: 'apps/web/src/features/shell/ColumnResizer.tsx' },
  { token: '--ht-sidebar-width', reason: '侧栏宽度同样由拖动写入', injectedAt: 'apps/web/src/features/shell/ColumnResizer.tsx' },
  { token: '--ht-rail-label-left', reason: 'rail 标签位置按测量写入', injectedAt: 'apps/web/src/features/shell/view-tabs.ts' },
  { token: '--ht-rail-label-top', reason: '同上', injectedAt: 'apps/web/src/features/shell/view-tabs.ts' },
  { token: '--ht-shell-caption-height', reason: '可选覆盖：调用点自带 fallback（`var(--x, var(--ht-space-8))`）', injectedAt: null },
  { token: '--ht-shell-caption-right', reason: '可选覆盖：调用点自带 fallback', injectedAt: null },
];

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (SCAN_EXT.some((ext) => name.endsWith(ext))) out.push(full);
  }
  return out;
}

/** 收集定义：任意被扫到的 CSS 里 `--ht-x:` 都算。 */
export function collectDefinitions(roots = DEFINITION_ROOTS, base = ROOT) {
  const defined = new Set();
  for (const root of roots) {
    for (const file of walk(join(base, root))) {
      if (!file.endsWith('.css')) continue;
      const text = readFileSync(file, 'utf8');
      for (const match of text.matchAll(/(--ht-[a-z0-9-]+)\s*:/g)) defined.add(match[1]);
    }
  }
  return defined;
}

/**
 * 去掉注释再扫。
 *
 * 🔴 注释里**写 token 名当例子**是常态（`/** 槽位号 → `var(--ht-color-category-N)` *\/`），
 * 而它们不是引用。不剥注释的版本会被自己的文档绊倒 —— 那种假红最后总是以
 * "把门禁关掉"收场，比没有门禁更糟。
 */
function stripComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

/** 收集引用：`var(--ht-x` 与 `var(--ht-x,` 都算（后者只是带 fallback，仍然要求定义）。 */
export function collectReferences(roots = SCAN_ROOTS, base = ROOT) {
  const refs = new Map();
  for (const root of roots) {
    for (const file of walk(join(base, root))) {
      const text = stripComments(readFileSync(file, 'utf8'));
      for (const match of text.matchAll(/var\(\s*(--ht-[a-z0-9-]+)/g)) {
        /**
         * ⚠️ **模板前缀不是 token。** `category-colors.ts` 里是
         * ``var(--ht-color-category-${key})`` —— 正则只能看到 `--ht-color-category-`，
         * 而它并不是一个名字。判据是：紧跟 `${` 的匹配一律跳过。
         * 不跳过的后果是这道闸长期报三条假红，然后有人把它关掉。
         */
        const after = text.slice(match.index + match[0].length, match.index + match[0].length + 2);
        if (after === '${') continue;
        if (!refs.has(match[1])) refs.set(match[1], new Set());
        refs.get(match[1]).add(relative(base, file));
      }
    }
  }
  return refs;
}

/** 纯函数：给定定义集与引用集，返回未解析的引用。**自检直接调它。** */
export function unresolvedRefs(defined, refs, allowed = ALLOWED) {
  const allowedTokens = new Set(allowed.map((entry) => entry.token));
  const out = [];
  for (const [token, files] of refs) {
    if (defined.has(token) || allowedTokens.has(token)) continue;
    out.push({ token, files: [...files].sort() });
  }
  return out.sort((a, b) => a.token.localeCompare(b.token));
}

function selfTest() {
  const defined = new Set(['--ht-space-2']);
  const refs = new Map([
    ['--ht-space-2', new Set(['a.css'])],
    ['--ht-font-size-caption', new Set(['b.css', 'c.css'])],
  ]);
  const bad = unresolvedRefs(defined, refs, []);
  if (bad.length !== 1 || bad[0].token !== '--ht-font-size-caption') {
    console.error('❌ 自检失败：拼错的 token 没有被抓出来（这把尺是钝的）');
    process.exit(1);
  }
  const ok = unresolvedRefs(defined, new Map([['--ht-space-2', new Set(['a.css'])]]), []);
  if (ok.length !== 0) {
    console.error('❌ 自检失败：合法的引用被误报');
    process.exit(1);
  }
  console.log('✅ 自检通过：拼错的 token 会红，合法引用不误报');
}

function main() {
  if (process.argv.includes('--self-test')) {
    selfTest();
    return;
  }

  // 白名单本身也要能红：注入点写了的，文件必须还在。
  const staleAllowed = ALLOWED.filter(
    (entry) => entry.injectedAt !== null && !existsSync(join(ROOT, entry.injectedAt)),
  );
  if (staleAllowed.length > 0) {
    console.error('🔴 白名单里的注入点已不存在（死白名单）：');
    for (const entry of staleAllowed) console.error(`   ${entry.token} → ${entry.injectedAt}`);
    process.exit(1);
  }

  const defined = collectDefinitions();
  const refs = collectReferences();
  const missing = unresolvedRefs(defined, refs);

  if (missing.length > 0) {
    console.error(`🔴 ${missing.length} 个设计 token 被引用但从未定义 —— 浏览器会静默回退，界面只是"看起来不对"：`);
    for (const item of missing) {
      console.error(`   ${item.token}`);
      for (const file of item.files.slice(0, 4)) console.error(`      ← ${file}`);
    }
    console.error('');
    console.error('三条出路（别为了让门禁绿而往白名单里塞）：');
    console.error('  ① 拼错了 ⇒ 改成真实存在的 token');
    console.error('  ② 该有这个 token ⇒ 在 packages/design-system/src/tokens.css 里定义它');
    console.error('  ③ 确实是运行时注入 ⇒ 往本脚本的 ALLOWED 加一条，并写明注入点');
    process.exit(1);
  }

  console.log(`✅ ${refs.size} 个 token 引用全部可解析（定义 ${defined.size} 个，白名单 ${ALLOWED.length} 条）`);
}

main();
