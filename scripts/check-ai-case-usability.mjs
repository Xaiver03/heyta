#!/usr/bin/env node
/**
 * `check:ai-case-usability` —— 「AI 生成用例可用性清单」里能机械校验的那三条
 * =======================================================================
 *
 * ## 为什么要有这一条（不是"顺手多加一把尺"）
 *
 * 本仓用例两万+，AI 生成的用例正快速变多。AI 最容易写出四类"能跑但没用"的用例：
 *   ① 只测正常流（清单第 3 条，靠**人**勾，见 checklist）；
 *   ② **空断言**：`expect(x);`（没有匹配器）、`expect(true).toBe(true)`（恒真）；
 *   ③ **顺序依赖**：模块级可变状态被多个用例读写、`.only` 让套件不再隔离；
 *   ④ **硬编码环境值**：本机绝对路径、密钥、带口令的连接串。
 * ②③④ 能用一条机械判据判死 —— 这一枚尺就判这三条。① 要读意图，留给人工清单。
 *
 * ## 射程（刻意收窄，别把它当"全仓用例体检"）
 *
 * 只判**自我声明为 AI 生成**的用例文件 —— 文件里出现标记 `@ai-generated-case`。
 * 存量两万+人类用例里有大量合法的硬编码与共享状态，一把全扫进来会立刻整片全红，
 * 那把尺第二天就会被人为放宽（"狼来了"）。收窄到"声明过是 AI 生成的"，判据才有牙。
 * ⇒ 代价：一个坏 AI 用例只要**不写标记**就逃出射程。所以**检视规则**
 *   （docs/agents/ai-generated-code-review.md）要求：AI 生成的用例首行必须写
 *   `// @ai-generated-case`，检视者要确认它在。
 *
 * ## 为什么它不会"恒真"（这是本仓对每把尺的硬要求）
 *
 * 每次真跑先跑**内置阴阳性对照**：一段人造的合规样本必须零违规、一段人造的坏样本
 * 必须命中且分类正确；对照不过就 `exit 2`。这样即便此刻没有任何带标记的用例，
 * 引擎也**每趟都被证明能红**（与 `scripts/check-doc-citations.mjs` 的"内置对照"同一手法）。
 * `--self-test` 另外在磁盘夹具上跑 4 臂（合规 / 空断言 / 顺序依赖 / 硬编码）＋ 未知旗标 1 臂。
 *
 * ## 判据（只认这三类，每类都能单独命中）
 *
 *   EMPTY_ASSERTION   空断言：`expect(x);`（无匹配器）、`expect(true).toBe(true)` 这类
 *                     两侧同一字面量的恒真/恒假、`expect(true).toBeTruthy()`，以及
 *                     **整份用例一件断言都没有**（有 `it(`/`test(` 却无 `expect(`/`assert`）。
 *   ORDER_DEPENDENCY  顺序依赖：`.only`（套件不隔离）；模块级 `let/var` 被用例体内再赋值
 *                     （跨用例共享可变状态）。
 *   HARDCODED_ENV     硬编码环境值：本机绝对路径（`/Users/…`、`/home/…`、`C:\\Users\\…`）、
 *                     密钥（`sk-…`/`AKIA…`/`ghp_…`/私钥块）、带口令的连接串
 *                     （`scheme://user:pass@host`）。
 *
 * ## 用法
 *
 *   node scripts/check-ai-case-usability.mjs                       # 扫全仓带标记的用例（真跑）
 *   node scripts/check-ai-case-usability.mjs --self-test           # 5 臂自检
 *   node scripts/check-ai-case-usability.mjs --dir <path> --all    # 扫指定目录、忽略标记（调试/取证）
 *
 * 退出码：0 干净 · 1 有违规 · 2 装置自检失败 / 用法错误
 */
import { closeSync, existsSync, mkdtempSync, openSync, readFileSync, readSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MARKER = '@ai-generated-case';
const TEST_RE = /\.(test|spec)\.[cm]?[jt]sx?$/u;
const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'coverage', 'Pods', '.gradle', '.cxx',
  '.worktrees', '.local', 'tmp', '.run-logs', '.pnpm-store', 'test-results', '.turbo',
]);
const SCAN_ROOTS = ['apps', 'packages', 'server', 'e2e', 'scripts'];
const ALLOWED_FLAGS = ['--self-test', '--dir', '--all'];

/* ── 参数 ─────────────────────────────────────────────────────────────── */
function parseArgs(argv) {
  const out = { selfTest: false, all: false, dir: null };
  const unknown = [];
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--self-test') out.selfTest = true;
    else if (a === '--all') out.all = true;
    else if (a === '--dir') {
      const v = argv[++i];
      if (v === undefined || v.startsWith('-')) unknown.push('--dir 少一个路径');
      else out.dir = v;
    } else if (a.startsWith('-')) unknown.push(a);
    else unknown.push(`多余的位置参数 ${a}`);
  }
  return { ...out, unknown };
}

/* ── 去注释（保留字符串内容，因为硬编码值就藏在字符串里）──────────────── */
function stripComments(src) {
  let out = '';
  let i = 0;
  const n = src.length;
  let state = 'code'; // code | line | block | sq | dq | tmpl
  while (i < n) {
    const c = src[i];
    const c2 = src[i + 1];
    if (state === 'code') {
      if (c === '/' && c2 === '/') { state = 'line'; i += 2; continue; }
      if (c === '/' && c2 === '*') { state = 'block'; i += 2; continue; }
      if (c === "'") { state = 'sq'; out += c; i += 1; continue; }
      if (c === '"') { state = 'dq'; out += c; i += 1; continue; }
      if (c === '`') { state = 'tmpl'; out += c; i += 1; continue; }
      out += c; i += 1; continue;
    }
    if (state === 'line') { if (c === '\n') { state = 'code'; out += c; } i += 1; continue; }
    if (state === 'block') {
      if (c === '*' && c2 === '/') { state = 'code'; i += 2; continue; }
      if (c === '\n') out += c; // 保留换行，行号不乱
      i += 1; continue;
    }
    if (state === 'sq' || state === 'dq' || state === 'tmpl') {
      out += c;
      if (c === '\\') { out += src[i + 1] ?? ''; i += 2; continue; }
      if ((state === 'sq' && c === "'") || (state === 'dq' && c === '"') || (state === 'tmpl' && c === '`')) {
        state = 'code';
      }
      i += 1; continue;
    }
  }
  return out;
}

/* ── 三条判据 ─────────────────────────────────────────────────────────── */
const LITERAL = String.raw`(?:true|false|-?\d+(?:\.\d+)?|'[^'\n]*'|"[^"\n]*")`;

const HARD_PATTERNS = [
  { re: /\/Users\/[^/\s'"`]+/u, why: '本机绝对路径 /Users/…' },
  { re: /\/home\/[^/\s'"`]+/u, why: '本机绝对路径 /home/…' },
  { re: /[A-Za-z]:\\\\Users\\\\/u, why: '本机绝对路径 C:\\Users\\…' },
  { re: /\/private\/var\/folders\//u, why: '本机临时目录 /private/var/folders/…' },
  { re: /sk-[A-Za-z0-9]{16,}/u, why: '疑似 API Key sk-…' },
  { re: /AKIA[0-9A-Z]{16}/u, why: '疑似 AWS Access Key AKIA…' },
  { re: /ghp_[A-Za-z0-9]{20,}/u, why: '疑似 GitHub Token ghp_…' },
  { re: /xox[bap]-[A-Za-z0-9-]{10,}/u, why: '疑似 Slack Token xox*-…' },
  { re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/u, why: '内嵌私钥块' },
  { re: /\b[a-z][a-z0-9+.-]*:\/\/[^/\s:@]+:[^/\s@]+@/iu, why: '带口令的连接串 scheme://user:pass@host' },
];

function lineOf(src, index) {
  let line = 1;
  for (let i = 0; i < index && i < src.length; i += 1) if (src[i] === '\n') line += 1;
  return line;
}

/** 逐行判断 `expect(...)` 是否缺匹配器（闭合括号后下一个非空字符不是 `.`）。 */
function emptyExpectsOnLine(line) {
  const hits = [];
  let from = 0;
  for (;;) {
    const open = line.indexOf('expect(', from);
    if (open < 0) break;
    // 找与之配对的右括号
    let depth = 0;
    let j = open + 'expect'.length; // 指向 '('
    for (; j < line.length; j += 1) {
      const ch = line[j];
      if (ch === '(') depth += 1;
      else if (ch === ')') { depth -= 1; if (depth === 0) break; }
    }
    if (j >= line.length) break; // 跨行的 expect( —— 不在这里判，避免误伤
    const after = line.slice(j + 1).trimStart();
    if (after === '' || after.startsWith(';') || after.startsWith(')') || after.startsWith(',')) {
      hits.push(line.trim());
    }
    from = j + 1;
  }
  return hits;
}

function analyzeSource(raw) {
  const code = stripComments(raw);
  const lines = code.split('\n');
  const violations = [];
  const push = (rule, line, text) => violations.push({ rule, line, text: text.trim().slice(0, 200) });

  // 模块级可变绑定（顶层 let/var）
  const moduleMutable = new Map();
  for (const [idx, line] of lines.entries()) {
    const m = line.match(/^(?:export\s+)?(let|var)\s+([A-Za-z_$][\w$]*)/u);
    if (m) moduleMutable.set(m[2], idx + 1);
  }

  const tautTwin = new RegExp(`expect\\(\\s*(${LITERAL})\\s*\\)\\.(?:toBe|toEqual|toStrictEqual)\\(\\s*\\1\\s*\\)`, 'u');
  const tautTruthy = /expect\(\s*true\s*\)\.toBeTruthy\(\)/u;
  const tautFalsy = /expect\(\s*false\s*\)\.toBeFalsy\(\)/u;

  let assertionCount = 0;
  let testCount = 0;

  for (const [idx, line] of lines.entries()) {
    const ln = idx + 1;
    // —— 测试/套件计数 & .only ——
    if (/\b(?:it|test|describe)\s*\(/u.test(line)) testCount += 1;
    if (/\b(?:it|test|describe)\s*\.\s*only\s*\(/u.test(line)) {
      push('ORDER_DEPENDENCY', ln, `${line.trim()}  ← .only 让套件不再相互隔离`);
    }
    // —— 断言计数 ——
    if (/expect\s*\(/u.test(line) || /\bassert\b/u.test(line)) assertionCount += 1;
    // —— 空断言：无匹配器 ——
    for (const h of emptyExpectsOnLine(line)) push('EMPTY_ASSERTION', ln, `${h}  ← expect(...) 没有匹配器`);
    // —— 空断言：恒真/恒假 ——
    if (tautTwin.test(line)) push('EMPTY_ASSERTION', ln, `${line.trim()}  ← 两侧同一字面量，恒真`);
    if (tautTruthy.test(line) || tautFalsy.test(line)) push('EMPTY_ASSERTION', ln, `${line.trim()}  ← 对字面量断言恒真`);
    // —— 顺序依赖：模块级可变状态被再赋值 ——
    for (const [name, declLine] of moduleMutable) {
      if (ln === declLine) continue;
      const assign = new RegExp(`(^|[^\\w$.])${name}\\s*(?:=(?![=>])|\\+\\+|--|\\+=|-=|\\.push\\(|\\.pop\\(|\\.splice\\(|\\.shift\\(|\\.unshift\\()`);
      if (assign.test(line)) {
        push('ORDER_DEPENDENCY', ln, `${line.trim()}  ← 模块级可变量 ${name}（第 ${declLine} 行声明）在用例内被改，跨用例共享状态`);
      }
    }
    // —— 硬编码环境值 ——
    for (const p of HARD_PATTERNS) {
      if (p.re.test(line)) push('HARDCODED_ENV', ln, `${line.trim()}  ← ${p.why}`);
    }
  }

  // —— 空断言：整份无断言 ——
  if (testCount > 0 && assertionCount === 0) {
    push('EMPTY_ASSERTION', 1, '整份用例有 it/test 却没有任何 expect/assert —— 空断言');
  }
  return violations;
}

/* ── 文件发现 ─────────────────────────────────────────────────────────── */
function walk(dir, acc) {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      walk(full, acc);
    } else if (e.isFile() && TEST_RE.test(e.name)) {
      acc.push(full);
    }
  }
}

function readHead(path, bytes) {
  const fd = openSync(path, 'r');
  try {
    const buf = Buffer.alloc(bytes);
    const n = readSync(fd, buf, 0, bytes, 0);
    return buf.slice(0, n).toString('utf8');
  } finally {
    closeSync(fd);
  }
}

/** 收集要判的文件：--all 时不看标记；否则只收"头部含标记"的。 */
function collectFiles(dir, all) {
  const files = [];
  walk(dir, files);
  return files.filter((f) => {
    if (all) return true;
    let head;
    try { head = readHead(f, 8192); } catch { return false; }
    return head.includes(MARKER);
  });
}

function report(files) {
  let total = 0;
  for (const f of files.sort()) {
    const raw = readFileSync(f, 'utf8');
    const vs = analyzeSource(raw);
    if (vs.length === 0) continue;
    total += vs.length;
    console.error(`\n🔴 ${relative(ROOT, f)}`);
    for (const v of vs) console.error(`   [${v.rule}] 第 ${v.line} 行：${v.text}`);
  }
  return total;
}

/* ── 内置阴阳性对照（每趟真跑都证明引擎能红）────────────────────────────── */
const FAKE_KEY = 'sk-' + 'ABCDEFGHIJKLMNOPQRSTUVWX';
const FAKE_PATH = '/Users/' + 'rocalight' + '/private';

const SAMPLE_GOOD = [
  "import { test, expect } from 'vitest';",
  'function add(a: number, b: number) { return a + b; }',
  "test('正例：两数相加', () => {",
  '  expect(add(1, 2)).toBe(3);',
  '});',
  "test('负例：传入非数会抛错', () => {",
  "  expect(() => (add as any)('x', 1)).toThrow();",
  '});',
].join('\n');

const SAMPLE_EMPTY = [
  "import { test, expect } from 'vitest';",
  'function compute() { return 42; }',
  "test('空断言', () => {",
  '  const x = compute();',
  '  expect(x);',
  '  expect(true).toBe(true);',
  '});',
].join('\n');

const SAMPLE_ORDER = [
  "import { test, expect } from 'vitest';",
  'let counter = 0;',
  "test('a 先跑并把计数器加一', () => {",
  '  counter = counter + 1;',
  '  expect(counter).toBe(1);',
  '});',
  "test.only('b 依赖 a 留下的状态', () => {",
  '  expect(counter).toBe(2);',
  '});',
].join('\n');

const SAMPLE_HARD = [
  "import { test, expect } from 'vitest';",
  'function readP() { return 1; }',
  "test('硬编码', () => {",
  `  const p = '${FAKE_PATH}/secret';`,
  `  const k = '${FAKE_KEY}';`,
  '  expect(readP()).toBe(1);',
  '  expect(p.length + k.length).toBeGreaterThan(0);',
  '});',
].join('\n');

function hasRule(vs, rule) {
  return vs.some((v) => v.rule === rule);
}

function builtinControls() {
  const good = analyzeSource(SAMPLE_GOOD);
  const empty = analyzeSource(SAMPLE_EMPTY);
  const order = analyzeSource(SAMPLE_ORDER);
  const hard = analyzeSource(SAMPLE_HARD);
  const failures = [];
  if (good.length !== 0) failures.push(`合规样本被误判 ${good.length} 条：${good.map((v) => v.rule).join(',')}`);
  if (!hasRule(empty, 'EMPTY_ASSERTION')) failures.push('空断言样本没被 EMPTY_ASSERTION 抓到');
  if (!hasRule(order, 'ORDER_DEPENDENCY')) failures.push('顺序依赖样本没被 ORDER_DEPENDENCY 抓到');
  if (!hasRule(hard, 'HARDCODED_ENV')) failures.push('硬编码样本没被 HARDCODED_ENV 抓到');
  if (failures.length > 0) {
    console.error('🔴 内置阴阳性对照失败（装置坏了，不是代码干净）：');
    for (const f of failures) console.error(`   - ${f}`);
    process.exit(2);
  }
}

/* ── --self-test ──────────────────────────────────────────────────────── */
function selfTest() {
  const dir = mkdtempSync(join(tmpdir(), 'ai-case-usability-selftest-'));
  const arms = [];
  try {
    const write = (name, body) => {
      const p = join(dir, name);
      writeFileSync(p, `// @ai-generated-case\n${body}\n`);
      return p;
    };
    const good = write('good.spec.ts', SAMPLE_GOOD);
    const empty = write('empty.spec.ts', SAMPLE_EMPTY);
    const order = write('order.spec.ts', SAMPLE_ORDER);
    const hard = write('hard.spec.ts', SAMPLE_HARD);

    arms.push({ name: '① 合规用例 ⇒ 零违规（防恒红）', ok: analyzeSource(readFileSync(good, 'utf8')).length === 0 });
    arms.push({ name: '② 空断言用例 ⇒ 报 EMPTY_ASSERTION', ok: hasRule(analyzeSource(readFileSync(empty, 'utf8')), 'EMPTY_ASSERTION') });
    arms.push({ name: '③ 顺序依赖用例 ⇒ 报 ORDER_DEPENDENCY', ok: hasRule(analyzeSource(readFileSync(order, 'utf8')), 'ORDER_DEPENDENCY') });
    arms.push({ name: '④ 硬编码用例 ⇒ 报 HARDCODED_ENV', ok: hasRule(analyzeSource(readFileSync(hard, 'utf8')), 'HARDCODED_ENV') });

    // 目录级：--all 扫四枚，应恰有 3 枚违规（good 不违规）
    const found = collectFiles(dir, true);
    const offending = found.filter((f) => analyzeSource(readFileSync(f, 'utf8')).length > 0);
    arms.push({ name: '⑤ 目录级 --all：四枚里恰好 3 枚违规（合规那枚不误报）', ok: offending.length === 3, got: offending.length });

    // 未知旗标必须被拒
    arms.push({ name: '⑥ 未知旗标必须被拒', ok: parseArgs(['--bogus']).unknown.length === 1 });

    const bad = arms.filter((a) => !a.ok);
    for (const a of arms) {
      console.log(`${a.ok ? '✅' : '🔴'} ${a.name}${a.got === undefined ? '' : `  ｜ 得到 ${a.got}`}`);
    }
    console.log(`臂数 ${arms.length} ｜ 不符 ${bad.length}`);
    process.exit(bad.length === 0 ? 0 : 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/* ── 入口 ─────────────────────────────────────────────────────────────── */
const opts = parseArgs(process.argv.slice(2));
if (opts.unknown.length > 0) {
  console.error(`🔴 未知旗标：${opts.unknown.join(' ')}`);
  console.error(`   这枚尺只认：${ALLOWED_FLAGS.join(' / ')}`);
  process.exit(2);
}
if (opts.selfTest) selfTest();

// 真跑前先证明引擎能红（内置对照）
builtinControls();

const dir = opts.dir ? resolve(opts.dir) : ROOT;
if (!existsSync(dir) || !statSync(dir).isDirectory()) {
  console.error(`🔴 要扫的目录不在场：${dir}`);
  process.exit(2);
}
const files = collectFiles(dir, opts.all);
const violations = report(files);

const scope = opts.all ? '（--all：忽略标记）' : `（只收含 ${MARKER} 标记的用例）`;
if (violations > 0) {
  console.error(`\n🔴 AI 生成用例可用性：${violations} 条违规，分布在已声明的用例里 ${scope}`);
  console.error('   清单三条机械判据：有实质断言 / 无跨用例顺序依赖 / 无硬编码环境值。');
  console.error('   完整清单见 docs/agents/ai-generated-test-usability-checklist.md');
  process.exit(1);
}
console.log(
  `✅ AI 生成用例可用性：扫 ${files.length} 枚用例${scope} ｜ 违规 0（内置阴阳性对照已通过）`,
);
process.exit(0);
