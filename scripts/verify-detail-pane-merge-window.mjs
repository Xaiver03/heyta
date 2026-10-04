#!/usr/bin/env node
/**
 * 详情面那一批（`feat/detail-pane`）的**合流窗口判据**。
 *
 * 它回答三个机械可答的问题，把"要不要人"留给文档裁决：
 *   Q1 主检出里有没有**未提交改动**正落在本批触及的文件上（有 ⇒ 现在合会吞别人的活）
 *   Q2 与 main 合并有几枚冲突、各自是什么类（二进制/台账/代码）
 *   Q3 🔴 **合并产物能不能解析** —— 这是本批自己踩出来的那条：文本层干净（rc=0、零 marker）
 *      的合并可以留下一个 `SyntaxError: Identifier 'x' has already been declared`，
 *      而 `git merge-tree`、门禁、typecheck 谁都不会替你看这一眼。
 *
 * 全程**只读**：用 `git merge-tree --write-tree` 拿候选树，用 `git show <tree>:<path>` 取内容，
 * 不建工作树、不动任何检出。
 *
 * 跑法（仓库根或任一 linked worktree 皆可）：
 *   node scripts/verify-detail-pane-merge-window.mjs [--base main] [--head HEAD]
 * 退出码：0 = 三条全绿；1 = 被挡住（`REASONS=` 逐条列出）；2 = **探针自己坏了**
 * （解析器不可用 / 候选树读不出分母 / 自检臂没过 —— 坏探针不许报"绿"，也不许报"要人"）。
 *
 * 🔴 `REASONS=` 里 **OWNED 与 NEED_HUMAN 是两件事**，故意不并成一个"窗口未开"：
 *   §8.40 纠正的正是把它们混着数（交叠枚数衡量的是"文件名撞上没有"，冲突衡量的是"有几处要判断"）。
 *   OWNED 要的是"等对方提交 / 或在干净检出里合"，不是找人拍板。
 */
import { execFileSync } from 'node:child_process';
import { readdirSync, existsSync, writeFileSync, mkdtempSync } from 'node:fs';
import { createRequire } from 'node:module';
import { extname, join } from 'node:path';
import { tmpdir } from 'node:os';

const ROOT = process.cwd();
const argv = process.argv.slice(2);
const arg = (name, dflt) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? dflt : argv[i + 1];
};
const BASE = arg('base', 'main');
const HEAD = arg('head', 'HEAD');

const git = (args, opts = {}) =>
  execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...opts });

/** TypeScript 只用来做解析；解析器拿不到 ⇒ 探针坏，不能降级成"跳过"。 */
const loadTs = () => {
  const req = createRequire(join(ROOT, 'noop.js'));
  try {
    return req('typescript');
  } catch {
    /* 走 .pnpm 兜底 */
  }
  const pnpmDir = join(ROOT, 'node_modules', '.pnpm');
  if (!existsSync(pnpmDir)) return null;
  const hit = readdirSync(pnpmDir).find((d) => d.startsWith('typescript@'));
  if (!hit) return null;
  const file = join(pnpmDir, hit, 'node_modules', 'typescript', 'lib', 'typescript.js');
  return existsSync(file) ? req(file) : null;
};

const DUP_CODES = new Set([2300, 2451]);
const MARKER = /^(<{7}|>{7}|={7})(?: |$)/m;

const bad = [];

// ── 0. 载体自检 ────────────────────────────────────────────────────────────
const topLevel = git(['rev-parse', '--show-toplevel']).trim();
if (!existsSync(join(topLevel, 'package.json'))) {
  console.log('VERDICT=PROBE_BROKEN 不在仓库根/工作树根跑');
  process.exit(2);
}
const ts = loadTs();
if (ts === null || typeof ts.createProgram !== 'function') {
  console.log('VERDICT=PROBE_BROKEN 解析器（typescript）不可用 ⇒ Q3 无法回答，拒绝降级为跳过');
  process.exit(2);
}

/** Q3 的两条腿：.mjs 走 V8（重复声明是 early error），.ts/.tsx 走 TS（语法 + 重复标识符）。 */
const tmpDir = mkdtempSync(join(tmpdir(), 'dp-merge-parse-'));
const parseJs = (name, text) => {
  const file = join(tmpDir, name.replace(/[^\w.-]/g, '_'));
  writeFileSync(file, text);
  try {
    execFileSync(process.execPath, ['--check', file], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return [];
  } catch (e) {
    return [`node --check: ${`${e.stderr || e.message}`.split('\n')[0]}`];
  }
};
const parseTs = (ext, text) => {
  const virtual = `mem${ext}`;
  const host = {
    getSourceFile: (fn, lv) =>
      fn === virtual
        ? ts.createSourceFile(fn, text, lv, true, ext === '.tsx' ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
        : undefined,
    getDefaultLibFileName: () => 'lib.none.d.ts',
    writeFile: () => {},
    getCurrentDirectory: () => '/',
    getDirectories: () => [],
    getCanonicalFileName: (f) => f,
    useCaseSensitiveFileNames: () => true,
    getNewLine: () => '\n',
    fileExists: (f) => f === virtual,
    readFile: () => undefined,
    realpath: (f) => f,
  };
  const program = ts.createProgram([virtual], { noLib: true, target: ts.ScriptTarget.Latest, jsx: ts.JsxEmit.ReactJSX }, host);
  // 语法诊断整片收（它们是文件本体的问题，noLib 造不出假阳性）；语义只收重复标识符两类，
  // 其余（noLib 下"找不到名字"那类）不参与裁决 —— 否则每一枚真文件都会红。
  const syn = program.getSyntacticDiagnostics();
  const sem = program.getSemanticDiagnostics().filter((d) => DUP_CODES.has(d.code));
  return syn
    .concat(sem)
    .filter((d) => d.category === ts.DiagnosticCategory.Error)
    .map((d) => `TS${d.code}: ${ts.flattenDiagnosticMessageText(d.messageText, ' ')}`);
};
const parseOf = (path, text) => {
  const ext = extname(path);
  if (ext === '.ts' || ext === '.tsx') return parseTs(ext, text);
  if (ext === '.mjs' || ext === '.cjs' || ext === '.js') return parseJs(`mem${ext}`, text);
  if (ext === '.css') {
    // 🔴 必须先剥注释：本批自己的注释里带 `}`（"…源序后者胜 */"那类），
    //    裸数会把一枚完全合法的文件报成失衡 —— 第一次跑就是这样。
    const body = text.replace(/\/\*[\s\S]*?\*\//g, '');
    const open = (body.match(/\{/g) ?? []).length;
    const close = (body.match(/\}/g) ?? []).length;
    return open === close ? [] : [`CSS 花括号不平衡（已剥注释）：${open} vs ${close}`];
  }
  return [];
};

// ── 1. 自检臂：Q3 必须能红 ────────────────────────────────────────────────
const CONTROLS = [
  { name: 'C1 TS 重复声明（本批踩过的形状）', path: 'mem.ts', text: 'export const a = 1;\nexport const a = 2;\n', expect: 'bad' },
  { name: 'C2 mjs 重复声明', path: 'mem.mjs', text: 'const q = 1;\nconst q = 2;\nexport { q };\n', expect: 'bad' },
  { name: 'C3 CSS 括号失衡', path: 'mem.css', text: '.a { color: red;\n', expect: 'bad' },
  { name: 'C5 TS 语法坏（半截表达式）', path: 'mem5.ts', text: 'export const a = ;\n', expect: 'bad' },
  { name: 'C6 marker 文本', path: 'mem6.ts', text: 'export const a = 1;\n<<<<<<< HEAD\nexport const b = 2;\n', expect: 'bad' },
  { name: 'C4 干净样本', path: 'mem2.ts', text: 'export const a = 1;\nexport function f(): number {\n  return a;\n}\n', expect: 'ok' },
];
for (const c of CONTROLS) {
  const errs = parseOf(c.path, c.text);
  const flagged = errs.length > 0 || (c.expect === 'bad' && MARKER.test(c.text));
  const want = c.expect === 'bad';
  if (flagged !== want) {
    console.log(`CONTROL_FAIL ${c.name}: 期望 ${want ? '红' : '绿'}，实得 ${flagged ? `红 ${JSON.stringify(errs)}` : '绿'}`);
    console.log('VERDICT=PROBE_BROKEN 解析臂不能失败 ⇒ 它报什么都不是证据');
    process.exit(2);
  }
  console.log(`CONTROL_OK ${c.name} → ${want ? `红：${errs[0] ?? 'marker'}` : '绿'}`);
}

// ── 2. Q1：主检出的未提交改动 ∩ 本批文件 ──────────────────────────────────
const mergeBase = git(['merge-base', BASE, HEAD]).trim();
const batch = new Set(
  git(['diff', '--name-only', `${mergeBase}..${HEAD}`])
    .split('\n')
    .filter((l) => l.length > 0),
);
const worktrees = git(['worktree', 'list', '--porcelain'])
  .split('\n')
  .filter((l) => l.startsWith('worktree '))
  .map((l) => l.slice('worktree '.length));
const mainCheckout = worktrees.find((p) => !p.includes('/.worktrees/') && !p.startsWith('/private/tmp') && !p.startsWith('/tmp'));
if (!mainCheckout) {
  console.log('VERDICT=PROBE_BROKEN 找不到主检出（worktree list 里没有非临时条目）');
  process.exit(2);
}
const dirtyMain = git(['-C', mainCheckout, 'status', '--porcelain'])
  .split('\n')
  .filter((l) => l.trim().length > 0)
  .map((l) => l.slice(3).replace(/^.*-> /, '').trim());
const overlap = dirtyMain.filter((p) => batch.has(p));
console.log(
  `Q1 载体=${mainCheckout} 主检出未提交=${dirtyMain.length} 枚；本批触及=${batch.size} 枚；` +
    `**交叠=${overlap.length} 枚**${overlap.length > 0 ? `\n  ${overlap.join('\n  ')}` : ''}`,
);
if (overlap.length > 0) bad.push(`Q1 有 ${overlap.length} 枚本批文件正被主检出的未提交改动占着`);

// ── 3. Q2：merge-tree 的冲突清单 ──────────────────────────────────────────
let tree = '';
let conflicted = [];
try {
  const out = git(['merge-tree', '--write-tree', '--name-only', BASE, HEAD], { stdio: ['ignore', 'pipe', 'pipe'] });
  const lines = out.split('\n');
  tree = lines[0].trim();
} catch (e) {
  const out = `${e.stdout || ''}`;
  const lines = out.split('\n');
  if (!lines[0] || !/^[0-9a-f]{40}$/.test(lines[0].trim())) {
    console.log(`VERDICT=PROBE_BROKEN merge-tree 没给出候选树：${out.slice(0, 200)}`);
    process.exit(2);
  }
  tree = lines[0].trim();
  conflicted = lines.slice(1).filter((l) => l.trim().length > 0 && /^[ \w./-]+$/.test(l) && !l.startsWith('Auto-merging'));
}
console.log(`Q2 候选树=${tree} 冲突=${conflicted.length} 枚`);
const groups = { 二进制: [], 文档台账: [], 代码: [], 其他: [] };
for (const p of conflicted) {
  const e = extname(p);
  if (['.png', '.jpg', '.jpeg', '.webp', '.gif'].includes(e)) groups['二进制'].push(p);
  else if (e === '.md') groups['文档台账'].push(p);
  else if (['.ts', '.tsx', '.mjs', '.js', '.css', '.json'].includes(e)) groups['代码'].push(p);
  else groups['其他'].push(p);
}
for (const [k, list] of Object.entries(groups)) {
  if (list.length > 0) console.log(`   ${k} ${list.length} 枚：${list.join(', ')}`);
}
if (conflicted.length > 0) console.log(`   （Q2 只分类不裁决："要人的枚数"是判断，归 §8.40/§8.44 的文档）`);

// ── 4. Q3：候选树里每枚本批文件的内容 ────────────────────────────────────
let markerHits = [];
let parseHits = [];
let readSkipped = [];
let read = 0;
for (const p of batch) {
  let text;
  try {
    text = git(['show', `${tree}:${p}`]);
  } catch {
    readSkipped.push(p);
    continue;
  }
  read += 1;
  if (MARKER.test(text)) markerHits.push(p);
  const errs = parseOf(p, text);
  if (errs.length > 0) {
    /** 立刻分辨"合并造成的"与"本来就坏"—— 不分辨就得手工查，而手工查的那次我查错了方向。 */
    const side = (ref) => {
      try {
        const t = git(['show', `${ref}:${p}`]);
        return MARKER.test(t) || parseOf(p, t).length > 0;
      } catch {
        return null;
      }
    };
    parseHits.push([p, errs[0], { head: side(HEAD), base: side(BASE) }]);
  }
}
console.log(
  `Q3 候选树读到=${read} 枚 / 读不到=${readSkipped.length} 枚（合并里被删/改名）；` +
    `marker=${markerHits.length} 枚；解析坏=${parseHits.length} 枚`,
);
for (const p of markerHits) console.log(`   MARKER ${p}`);
for (const [p, e, side] of parseHits) {
  console.log(`   PARSE_BAD ${p}\n      ${e}`);
  console.log(
    `      归属：合并前 HEAD 侧=${side.head} / ${BASE} 侧=${side.base} / 带 marker=${markerHits.includes(p)}` +
      (side.head === false && side.base === false
        ? markerHits.includes(p)
          ? ' ⇒ 两侧都不坏，但这就是 marker 造成的（记 NEED_HUMAN，不重复记 BROKEN）'
          : ' ⇒ 🔴 两侧都不坏、也没有 marker —— **文本层全干净的合并把产物弄坏了**（§8.42 第 15 节那个形状）'
        : ' ⇒ 本来就坏，不由本批吸收'),
  );
}
if (read === 0) {
  console.log('VERDICT=PROBE_BROKEN 候选树里一枚本批文件都读不出来 —— 分母为空不算绿');
  process.exit(2);
}
if (readSkipped.length > 0 && readSkipped.length !== batch.size) {
  console.log(`   （读不到的那些：${readSkipped.slice(0, 6).join(', ')}${readSkipped.length > 6 ? ' …' : ''}）`);
}
if (markerHits.length > 0) bad.push(`Q3 有 ${markerHits.length} 枚合并产物带冲突 marker`);
if (parseHits.length > 0) bad.push(`Q3 有 ${parseHits.length} 枚合并产物**解析不过**（文本层可能全干净）`);

// ── 5. 结论 ───────────────────────────────────────────────────────────────
/**
 * 三个理由**分开列**，不并成一个"窗口未开"：
 *   OWNED     = Q1，别人有未提交改动落在本批文件上 ⇒ 该在**他们提交之后**、或在干净检出里合，
 *               这不是"要人裁决"（§8.40 纠正的正是把这两件事并成一句）。
 *   NEED_HUMAN= Q2/Q3，有冲突或有 marker ⇒ 每处都要做一次判断。
 *   BROKEN    = Q3，**没有 marker、两侧都不坏、而合并产物解析不过** ⇒ 就是 §8.42 第 15 节那次
 *               的形状（文本层全干净、`node --check` 才看得见）。带 marker 的那几枚已经算进
 *               NEED_HUMAN/MARKER，不再重复计入，否则同一个现象会被数两遍。
 */
const reasons = [];
if (overlap.length > 0) reasons.push(`OWNED(${overlap.length})`);
if (conflicted.length > 0) reasons.push(`NEED_HUMAN(${conflicted.length})`);
if (markerHits.length > 0) reasons.push(`MARKER(${markerHits.length})`);
const mergeOnlyBad = parseHits.filter(([p, , side]) => !markerHits.includes(p) && side.head === false && side.base === false);
if (mergeOnlyBad.length > 0) reasons.push(`BROKEN(${mergeOnlyBad.length})`);
const inheritedBad = parseHits.length - parseHits.filter(([, , side]) => side.head === false && side.base === false).length;
console.log(
  `CONFLICTED=${conflicted.length} OVERLAP=${overlap.length} MARKERS=${markerHits.length} ` +
    `PARSE_BAD=${parseHits.length}（只由 marker 解释=${parseHits.filter(([p]) => markerHits.includes(p)).length} / ` +
    `合并新造成且无 marker=${mergeOnlyBad.length} / 本来就坏=${inheritedBad}）PARSED=${read}`,
);
if (reasons.length === 0) {
  console.log('VERDICT=MERGE_WINDOW_OPEN 三条判据全绿（本批文件无人占用 / 零冲突零 marker / 合并产物全部可解析）');
  process.exit(0);
}
for (const r of bad) console.log(`🔴 ${r}`);
console.log(`REASONS=${reasons.join(' ')}`);
console.log('VERDICT=BLOCKED 逐条理由见上（OWNED 不等于"要人"，它要的是"等对方提交或在干净检出里合"）');
process.exit(1);
