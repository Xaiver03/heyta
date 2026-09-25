#!/usr/bin/env node
/**
 * 检查仓库内 Markdown 文档的相对链接是否有死链。
 *
 * 为什么需要它：文档一旦开始按目录分层，相对路径就会随文件移动而失效，
 * 而且失效是**静默**的 —— 没人点进去就不会发现。这个工具把它变成可验证的。
 *
 * 用法：
 *   node research/tools/docs-link-check.mjs           # 检查，死链则退出码 1
 *   node research/tools/docs-link-check.mjs --verbose  # 列出所有检查过的链接
 */

import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join, dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/** 不扫描的目录。 */
const SKIP_DIRS = new Set([
  'node_modules', '.git', '.pnpm-store', 'dist', 'build', 'coverage',
]);

/** 上游克隆与第三方资料不归我们维护，检查它们的死链没有意义。 */
const SKIP_PATHS = ['research/upstream', 'research/standalone', 'research/parts'];

const verbose = process.argv.includes('--verbose');

/** 递归收集 .md 文件。 */
function collect(dir, acc = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    const rel = relative(ROOT, full);
    if (SKIP_PATHS.some((p) => rel === p || rel.startsWith(p + '/'))) continue;
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      collect(full, acc);
    } else if (entry.name.endsWith('.md')) {
      acc.push(full);
    }
  }
  return acc;
}

// [text](target) 或 [text](<target>)；不含图片与引用式链接。
const LINK_RE = /\[[^\]]*\]\(\s*<?([^)>\s]+)>?\s*\)/g;

/**
 * 把围栏代码块与行内代码整体挖空（替换成同长度的空格，以保住行号）。
 *
 * 为什么必须这样做：文档里经常**故意展示**链接写法作为示例 ——
 * 比如「❌ 不要写 [架构](docs/reference/architecture.md)」或 ADR 模板里的
 * [ADR-0002](0002-xxx.md)。这些不是真链接，把它们报成死链是误报，
 * 而误报会让人开始忽略这个检查 —— 那比没有检查更糟。
 */
function blankOutCode(line) {
  let out = line;
  // 行内代码：先处理双反引号（可包含单个反引号），再处理单反引号
  out = out.replace(/``[\s\S]*?``/g, (m) => ' '.repeat(m.length));
  out = out.replace(/`[^`]*`/g, (m) => ' '.repeat(m.length));
  return out;
}

/** 外部链接、锚点、非文件协议一律跳过。 */
const isExternal = (t) =>
  /^(https?:|mailto:|tel:|data:|ftp:)/i.test(t) || t.startsWith('#');

const files = collect(ROOT);
const broken = [];
let checked = 0;
let skipped = 0;

for (const file of files) {
  const dir = dirname(file);
  const content = readFileSync(file, 'utf8');
  // 逐行扫，以便报行号
  let inFence = false;
  content.split('\n').forEach((rawLine, i) => {
    // 围栏代码块：进入/退出都要判断；块内整行跳过
    if (/^\s*(```|~~~)/.test(rawLine)) {
      inFence = !inFence;
      return;
    }
    if (inFence) return;

    const line = blankOutCode(rawLine);
    for (const m of line.matchAll(LINK_RE)) {
      const raw = m[1];
      if (isExternal(raw)) continue;
      // 去掉 #anchor 与 ?query
      const target = raw.split('#')[0].split('?')[0];
      if (!target) continue; // 纯锚点
      // 跳过模板/占位
      if (target.includes('<') || target.includes('{{') || target.includes('xxx')) continue;

      checked++;
      const resolved = resolve(dir, decodeURIComponent(target));
      if (existsSync(resolved)) {
        if (verbose) console.log(`  ok   ${relative(ROOT, file)}:${i + 1} -> ${raw}`);
      } else {
        broken.push({ file: relative(ROOT, file), line: i + 1, target: raw });
      }
    }
  });
}


// ── 章节号引用检查 ──────────────────────────────────────────────
//
// 为什么需要它：`CLAUDE.md` 里写着「跑测试 → AGENTS.md §5」，而实际是 §6 ——
// **整体错位了一格**（AGENTS.md 中途插入了 §5 设计系统）。死链检查抓不到它，
// 因为链接本身是活的、文件存在、只有 **§ 后面的数字**错了。
// 而 CLAUDE.md 自己就写着「漂移的规则比没有规则更危险」。
//
// 只检查**指名了目标文件**的引用（`AGENTS.md §5`）。裸 `§5` 不做跨文件推断，
// 因为那只能靠猜 —— 猜错就是误报，而误报会让人开始忽略这个检查。

/** `[`AGENTS.md` §5](...)` / `见 AGENTS.md §3.1–3.2` 这类引用。 */
const SECTION_REF_RE = /([A-Za-z0-9_./-]+\.md)`?\s*§\s*(\d+(?:\.\d+)?)([^\]\n]{0,24})/g;

/**
 * 从一个 Markdown 文本里抽出「编号 -> 标题」的映射（## 1. / ### 2.3 / #### 3.1.2）。
 *
 * 标题也要，因为**「§5 存在」不代表「§5 是对的那一节」**：
 * 我们真的踩过这个坑 —— CLAUDE.md 把「跑测试」指向了 §5，而 §5 是设计系统，
 * 正确的 §6 只是被整体挤后了一格。只查编号是否存在**抓不到这种错**，
 * 编号是对的、只是意思是错的。带上标题才查得动。
 */
function sectionNumbers(markdown) {
  const map = new Map();
  let inFence = false;
  for (const rawLine of markdown.split('\n')) {
    if (/^\s*(```|~~~)/.test(rawLine)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const m = /^#{2,6}\s+(\d+(?:\.\d+)*)[.、\s]+(.*)$/.exec(rawLine);
    if (m) map.set(m[1], m[2].replace(/[*`]/g, '').trim());
  }
  return map;
}

const badRefs = [];
let checkedRefs = 0;

for (const file of files) {
  const dir = dirname(file);
  const content = readFileSync(file, 'utf8');
  let inFence = false;
  content.split('\n').forEach((rawLine, i) => {
    if (/^\s*(```|~~~)/.test(rawLine)) {
      inFence = !inFence;
      return;
    }
    if (inFence) return;

    // 注意：这里用**原始行**，不能用 blankOutCode —— 反引号里的文件名
    // （`AGENTS.md` §5）会被挖成空格，文件名随之消失，于是什么都查不到。
    // 这个正则要求"文件名 + § + 数字"，足够具体，围栏代码块已在上面排除。
    for (const m of rawLine.matchAll(SECTION_REF_RE)) {
      const targetName = m[1];
      const refNum = m[2];

      const targetPath = resolve(dir, targetName);
      if (!existsSync(targetPath)) continue; // 死链检查那边会报，这里不重复

      const sections = sectionNumbers(readFileSync(targetPath, 'utf8'));
      checkedRefs++;

      const realTitle = sections.get(refNum);

      // `§3.1–3.2` 只抓到 3.1；只要 3.1 存在就算数（区间写法不展开）
      if (realTitle === undefined) {
        badRefs.push({
          file: relative(ROOT, file),
          line: i + 1,
          target: targetName,
          ref: refNum,
          reason: '该章节号不存在',
          available: [...sections.keys()].join(', '),
        });
        continue;
      }

      // 引用后面若跟了标题（`§2 仓库地图`），标题必须与真实标题对得上。
      // 只比较**前缀**：真实标题常带括号补充（`硬性约束（违反即打回）`），
      // 引用只写主干是合理的，不该报错。
      // 区间写法（`§3.1–3.2`、`§1-2`）不是标题，不参与比较，否则是误报。
      const rest = m[3].trim();
      if (/^[–—~〜-]\s*\d/.test(rest)) continue;
      const claimed = rest.replace(/^[\s，,、:：是]+/, '').replace(/[*`\]]+$/, '').trim();
      if (claimed.length >= 2 && !realTitle.startsWith(claimed)) {
        badRefs.push({
          file: relative(ROOT, file),
          line: i + 1,
          target: targetName,
          ref: refNum,
          reason: `章节号是 §${refNum}「${realTitle}」，但引用写的是「${claimed}」`,
        });
      }
    }
  });
}

console.log(`检查 ${checkedRefs} 处跨文档章节引用。`);

if (badRefs.length > 0) {
  console.log(`\n🔴 发现 ${badRefs.length} 处**失效的章节引用**（值是错的，但链接是活的）：\n`);
  for (const b of badRefs) {
    console.log(`   ${b.file}:${b.line}  ->  ${b.target} §${b.ref}`);
    console.log(`      ${b.reason}`);
    if (b.available) console.log(`      ${b.target} 实际有：§${b.available}`);
  }
  console.log('');
  process.exit(1);
}

console.log(`\n扫描 ${files.length} 个 Markdown 文件，检查 ${checked} 个相对链接。`);

if (broken.length === 0) {
  console.log('\n✅ 无死链。\n');
  process.exit(0);
}

console.log(`\n🔴 发现 ${broken.length} 个死链：\n`);
for (const b of broken) {
  console.log(`   ${b.file}:${b.line}`);
  console.log(`      -> ${b.target}`);
}
console.log('');
process.exit(1);
