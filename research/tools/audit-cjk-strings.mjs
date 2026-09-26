#!/usr/bin/env node
/**
 * 中文**字符串字面量**清单
 * ========================
 *
 * 为什么要专门写一个工具：`grep -c '[一-鿿]'` 数的是"含汉字的**行**"，
 * 而在这些包里，含汉字的行**绝大多数是文档注释**。
 *
 * 实测教训：`packages/domain/src/ai-feedback.ts` 用行数统计是"143 处"，
 * 而里面真正会被渲染的字符串**是零**（全是文件头那段设计说明）。
 * 拿行数去排批次，排出来的是"注释最多的文件优先"，而不是"用户最常看到的中文优先"。
 *
 * 所以这个工具只做一件事：**把注释剥掉，只列字符串字面量里的汉字**。
 * 它不判断"这个字符串会不会被渲染"（那需要人看），但它把候选范围缩到可人工过一遍的量级。
 *
 * ⚠️ 它**不是门禁**（跑不进 `pnpm check`）：它不判断对错，只列清单。
 * 位置在 `research/tools/` 与 `docs-link-check.mjs` 一致。
 *
 * 用法：
 *   node research/tools/audit-cjk-strings.mjs                    # 全部（packages/* + apps/*）
 *   node research/tools/audit-cjk-strings.mjs packages/domain     # 只看一个包
 *   node research/tools/audit-cjk-strings.mjs --json             # 机器可读
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const HAN = /[\u4e00-\u9fff]/;
const CODE_EXT = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs']);
const SKIP_DIR = new Set(['node_modules', 'dist', 'build', 'coverage', '.git', '.gradle', 'android', 'ios', '.cxx']);
/**
 * 默认**跳过测试目录**：测试里的中文是**夹具**（`明天交`、`交周报 !1`），
 * 不是待迁文案。把它们算进来会让"哪个包最该先做"完全失真
 * —— 实测：不过滤时 `packages/domain` 排第一的是 `tests/capture.spec.ts`（195 处）。
 * 需要看夹具时加 `--include-tests`。
 */
const SKIP_DIR_WITH_TESTS = new Set([...SKIP_DIR, 'tests', '__tests__']);

/**
 * 剥掉注释、只留字符串字面量。
 *
 * 手写扫描而不是上 parser：这里只关心"这段汉字在不在字符串里"，
 * 而 TypeScript 的 parser 会带来一个比它解决的问题更大的依赖。
 * 状态机只认 5 种状态，足够覆盖这些源码。
 */
function extractStringLiterals(source) {
  const out = [];
  let line = 1;
  let i = 0;
  // 状态：code | line-comment | block-comment | single | double | template
  let state = 'code';
  let start = 0;
  let startLine = 1;
  let quote = '';

  while (i < source.length) {
    const c = source[i];
    const next = source[i + 1];

    if (c === '\n') line += 1;

    switch (state) {
      case 'code':
        if (c === '/' && next === '/') {
          state = 'line-comment';
          i += 2;
          continue;
        }
        if (c === '/' && next === '*') {
          state = 'block-comment';
          i += 2;
          continue;
        }
        if (c === "'" || c === '"' || c === '`') {
          state = c === "'" ? 'single' : c === '"' ? 'double' : 'template';
          quote = c;
          start = i + 1;
          startLine = line;
          i += 1;
          continue;
        }
        i += 1;
        break;

      case 'line-comment':
        if (c === '\n') state = 'code';
        i += 1;
        break;

      case 'block-comment':
        if (c === '*' && next === '/') {
          state = 'code';
          i += 2;
          continue;
        }
        i += 1;
        break;

      default: {
        // 字符串内部：处理转义
        if (c === '\\') {
          i += 2;
          continue;
        }
        if (c === quote) {
          const text = source.slice(start, i);
          if (HAN.test(text)) out.push({ line: startLine, text });
          state = 'code';
          i += 1;
          continue;
        }
        // 模板串里的 ${...}：粗略跳过（里面的表达式可能又含字符串，
        // 那部分会漏 —— 已知边界，写在这里而不是假装覆盖了）
        i += 1;
        break;
      }
    }
  }
  return out;
}

/** 递归收集要扫的文件。 */
function walk(dir, acc = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return acc;
  }
  const skip = INCLUDE_TESTS ? SKIP_DIR : SKIP_DIR_WITH_TESTS;
  for (const e of entries) {
    if (e.name.startsWith('.') || skip.has(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, acc);
    else if (CODE_EXT.has(path.extname(e.name))) acc.push(full);
  }
  return acc;
}

/** 默认扫 `packages/<pkg>/src` 与 `apps/<app>/src`；给了参数就只扫那些路径。 */
function targets(argv) {
  const given = argv.filter((a) => !a.startsWith('--'));
  if (given.length > 0) return given.map((p) => path.resolve(ROOT, p));
  const roots = [];
  for (const group of ['packages', 'apps']) {
    let entries = [];
    try {
      entries = readdirSync(path.join(ROOT, group), { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const src = path.join(ROOT, group, e.name, 'src');
      try {
        if (statSync(src).isDirectory()) roots.push(src);
      } catch {
        // 没有 src 的包（纯脚本包）跳过
      }
    }
  }
  return roots;
}

const json = process.argv.includes('--json');
const INCLUDE_TESTS = process.argv.includes('--include-tests');
const files = targets(process.argv.slice(2)).flatMap((t) => walk(t));
const report = [];
for (const file of files) {
  const hits = extractStringLiterals(readFileSync(file, 'utf8'));
  if (hits.length > 0) report.push({ file: path.relative(ROOT, file), hits });
}
report.sort((a, b) => b.hits.length - a.hits.length || a.file.localeCompare(b.file));

if (json) {
  console.log(JSON.stringify(report, null, 2));
} else {
  const total = report.reduce((n, r) => n + r.hits.length, 0);
  console.log(`含汉字的字符串字面量：**${String(total)}** 处，分布在 ${String(report.length)} 个文件。`);
  console.log('（⚠️ 行数统计会把文档注释算进来，那个数字不能用来排批次。）\n');
  for (const r of report) {
    console.log(`${String(r.hits.length).padStart(3)}  ${r.file}`);
    for (const h of r.hits.slice(0, 4)) {
      const t = h.text.length > 58 ? `${h.text.slice(0, 58)}…` : h.text;
      console.log(`       :${String(h.line)}  ${t.replace(/\n/g, '\\n')}`);
    }
    if (r.hits.length > 4) console.log(`       … 还有 ${String(r.hits.length - 4)} 处`);
  }
}
