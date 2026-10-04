#!/usr/bin/env node
/**
 * 门禁：shell 脚本里不许出现 `$var` **紧跟非 ASCII 字符**。
 *
 * ═══════════════════════════════════════════════════════════════════
 * 为什么这是一道门禁，而不是一条风格建议
 * ═══════════════════════════════════════════════════════════════════
 *
 * bash 解析 `$name` 时，**会把紧跟其后的非 ASCII 字节算进变量名**：
 *
 *     email="a@b.com"
 *     echo "A: $email（括号）"      # → A: ��括号）        ← 值丢了，变成乱码
 *     echo "B: ${email}（括号）"    # → B: a@b.com（括号）  ← 对的
 *
 * 开了 `set -u` 则直接 `email�: unbound variable`。
 *
 * 🔴 **真正的危害不是崩溃，是"证据在说谎"。**
 *
 * 这些出现几乎全在 `echo` 的消息里。没有 `set -u` 时**退出码不受影响** ——
 * 脚本照常"通过"，只是打印出来的实测证据是乱码。对一个
 * 「以实测输出为证据」的验收脚本来说，这比崩溃更糟：
 * **崩溃你看得见，乱码你不看。**
 *
 * 2026-09-28 实测：`scripts/verify-multi-end-sync.sh`（三端真同步验收）
 * 因为 `set -u` 在建号那一步直接硬失败 —— 也就是说**它一直没有真正跑起来过**，
 * 而全仓当时有 **172 处**这类写法，散布在 18 个验收脚本里。
 *
 * ## 判据
 *
 * 扫 `**\/*.sh`，但**跳过不该展开的地方**，否则改它们会改变要显示的文字：
 *
 * - 单引号字符串内（`'…'`）—— 不展开，`$var` 是字面量
 * - 带引号的 heredoc（`<<'EOF'`）—— 同上
 * - 转义的 `\$var` —— 字面量
 * - 已经写成 `${var}` 的 —— 本来就对
 *
 * 修法：`$var` → `${var}`。两者在会展开的地方**完全等价**。
 *
 *     python3 research/tools/fix-shell-unicode-vars.py --write
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** 跳过这些目录 —— 里面不是我们的 shell 脚本。 */
const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  '.worktrees',
  'dist',
  'build',
  '.pnpm-store',
  'release',
  // 各并行线 agent 的 scratch（`.gitignore` 的 `tmp/`）。与 docs-link-check
  // 跳过它同一条理由：实测 4 个 `tmp/*.sh` 的红全部来自草稿，被跟踪脚本
  // 贡献 0 条——那种红不可归因给任何脚本作者，也永远不会在 CI 出现。
  // 草稿被正式收进 `scripts/` 的那一刻起就在扫描面里（那正是该挡的时刻）。
  'tmp',
]);

/** 与 Python 修复器**同一套判定**，避免"门禁说没问题、修复器却改了"这种不一致。 */
const isNameStart = (c) => /[A-Za-z_]/.test(c);
const isNameChar = (c) => /[A-Za-z0-9_]/.test(c);
const isNonAscii = (c) => c.codePointAt(0) > 0x7f;

/** @returns {{line: number, snippet: string}[]} */
export function findOffenders(text) {
  const found = [];
  const n = text.length;
  let i = 0;
  let inSingle = false;
  let inDouble = false;
  /** @type {{delim: string, quoted: boolean} | null} */
  let heredoc = null;
  let line = 1;

  const push = (start, end) => {
    const before = text.slice(0, start);
    const ln = before.split('\n').length;
    const lineStart = before.lastIndexOf('\n') + 1;
    let lineEnd = text.indexOf('\n', start);
    if (lineEnd === -1) lineEnd = n;
    found.push({ line: ln, snippet: text.slice(lineStart, lineEnd).trim() });
    void end;
  };

  while (i < n) {
    const ch = text[i];

    if (ch === '\n') {
      if (heredoc && !inSingle && !inDouble) {
        const end = text.indexOf('\n', i + 1);
        const body = text.slice(i + 1, end === -1 ? n : end).trim();
        if (body === heredoc.delim) heredoc = null;
      }
      line += 1;
      i += 1;
      continue;
    }

    if (!inDouble && !inSingle && heredoc === null && text.startsWith('<<', i)) {
      let j = i + 2;
      let quoted = false;
      if (text[j] === '-') j += 1;
      if (text[j] === "'" || text[j] === '"') {
        quoted = true;
        j += 1;
      }
      let k = j;
      while (k < n && isNameChar(text[k])) k += 1;
      if (k > j) {
        heredoc = { delim: text.slice(j, k), quoted };
        i = k;
        continue;
      }
    }

    // 带引号的 heredoc 不展开 → 原样跳过
    if (heredoc !== null && !inSingle && heredoc.quoted) {
      i += 1;
      continue;
    }

    if (ch === '\\' && !inSingle) {
      i += 2;
      continue;
    }
    if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
      i += 1;
      continue;
    }
    if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
      i += 1;
      continue;
    }

    if (inSingle) {
      i += 1;
      continue;
    }

    if (ch === '$' && i + 1 < n && isNameStart(text[i + 1])) {
      let j = i + 1;
      while (j < n && isNameChar(text[j])) j += 1;
      if (j < n && isNonAscii(text[j])) {
        push(i, j);
        i = j;
        continue;
      }
    }

    i += 1;
  }

  return found;
}

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.isFile() && entry.name.endsWith('.sh')) out.push(full);
  }
  return out;
}

// ── 只在**直接运行**时执行扫描；被 import（自测）时不执行 ──────────────
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  const files = walk(ROOT);
  /** @type {string[]} */
  const problems = [];

  for (const file of files) {
    const hits = findOffenders(readFileSync(file, 'utf8'));
    if (hits.length === 0) continue;
    const rel = path.relative(ROOT, file);
    problems.push(`   ❌ ${rel}`);
    for (const h of hits.slice(0, 5)) problems.push(`        :${h.line}  ${h.snippet}`);
    if (hits.length > 5) problems.push(`        …还有 ${hits.length - 5} 处`);
  }

  if (problems.length > 0) {
    console.error('🔴 shell 脚本里有 `$var` 紧跟非 ASCII 字符 —— 变量名会被吞：');
    console.error('');
    for (const p of problems) console.error(p);
    console.error('');
    console.error('   症状：`echo "x $var（括号）"` 打印出 `x ��括号）` —— **值丢了**；');
    console.error('         开了 `set -u` 则直接 `var�: unbound variable`。');
    console.error('   ⚠️ 退出码通常不受影响，所以脚本"照常通过"、**只是证据是乱码**。');
    console.error('   修法：`$var` → `${var}`（会展开的地方两者完全等价）。');
    console.error('         自动修：python3 research/tools/fix-shell-unicode-vars.py --write');
    console.error('');
    process.exit(1);
  }

  console.log(`   ✅ shell 脚本没有「变量名被非 ASCII 吞掉」的写法（扫了 ${files.length} 个 .sh）`);
}
