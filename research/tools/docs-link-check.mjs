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
