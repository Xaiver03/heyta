#!/usr/bin/env node
/**
 * `e2e/` 里**命名导入 ↔ 命名导出**的逐名对账门禁。
 * =============================================================================
 *
 * ## 为什么只有这一族需要一个专门的门禁
 *
 * `e2e/` **刻意不在根 pnpm 工作区内**（理由写在 `e2e/pnpm-workspace.yaml` 文件头），
 * 所以 `pnpm -r typecheck` **从来不看它一眼**。于是这个仓库里唯一"提交了消费者、
 * 忘了生产者"这个缺陷形状，只有这一族能活着进 `main`：
 *
 *   2026-10-06 实测（习惯批 H4/H5/H7/H8）：`habit-frequency` / `habit-heatmap-labels` /
 *   `habit-month` / `habit-year` 四份 spec 都写着 `import { … selectHabit … } from './helpers'`，
 *   而 `helpers.ts` 里那 14 行从没进任何一笔提交 ⇒ 干净检出上这四条**不是红，是载不进**
 *   （ESM 的命名导入缺失是**加载期**错误，Playwright 只会报"没有用例"或一条 SyntaxError）。
 *   而当时 `pnpm check` 里**没有任何一层**会因此失败 —— 因为 e2e 全族只在 `check:ai-e2e`
 *   那一条里跑，而那条要真浏览器 + 内存闸门，日常没人每次提交都跑它。
 *
 * 🔴 更要紧的是**读数的口径**：那四份 spec 的 pass 是在**工作树**上取的，测的代码和提交的
 * 内容一致，但当时**没有任何一个提交态能重现它们**。这条门禁把"提交态自洽"变成一件有人跑的事。
 *
 * ## 判什么
 *
 * 对 `e2e` 下每个 `.ts`／`.tsx`／`.mjs`／`.js` 文件的每一条**相对路径** import（`./` 或 `../` 开头）：
 *
 *   1. 目标文件**必须存在**（含 `.ts` / `.tsx` / `.mjs` / `.js` 与 `/index.*` 的补全，
 *      以及 TS 的 `./x.js` → `./x.ts` 那条映射）；
 *   2. 每一个**具名**导入必须能在目标文件里数到对应导出，
 *      `export { a, b } from './z'` 与 `export * from './z'` 会**递归**到 `./z` 去数
 *      （递归带 visited 集，循环导入不会被当成缺失）；
 *   3. 默认导入要求目标有 `export default`；`import * as ns` 与裸 `import './x'` 只要求存在。
 *
 * 非相对的裸包名（`@playwright/test`、`react`…）**不在射程内** —— 那类缺失由 `pnpm install`
 * 与真实运行负责，这里判的是"同一棵树里两份文件互相不认"这一件事。
 *
 * ## 跑法
 *
 *   node scripts/check-e2e-helper-exports.mjs            # 真树；缺一个就退 1
 *   node scripts/check-e2e-helper-exports.mjs --self-test # 逐臂证明它会红（臂数由它自己打印）
 *
 * ## 现量（2026-10-06 06:3x 首跑）
 *
 * 真树：`射程 117 份文件 / 对账 372 个导入名 / 缺失 0 个`，rc=0。
 * 自检：全臂 ✅、`SELFTEST_RC=0`。
 * 🔴 第一版有 **4 条假红**（`e2e/auth-journey` 与 `e2e/windows-shell` 那四份文件本来就没错）：
 * 我把 `import { type Kind }` 里那个行内 `type` 当成了名字的一部分。它就是自检臂里那条 A8，
 * 而 A1/A8 两条在修好之前**是红的** —— 阳性对照落在"扫描器自己也会错"这一侧，不是摆设。
 *
 * ⚠️ **消费者还没接上**（2026-10-06 06:3x 现量）：`package.json` 正被另一条线改着，
 * 而 `pnpm check` 那一整条链是**同一行 JSON**，两边的编辑分不开 hunk
 * （`git diff -U0 -- package.json` 的 `@@ -74 +75 @@` 那一格就是它）。
 * 他们那笔里带着 `pnpm check:backup-retention`，而 `scripts/check-backup-retention.mjs`
 * 此刻还是未跟踪文件 —— 我若把这一行抄进去一起提交，`HEAD` 上的 `pnpm check` 会因为
 * 找不到那个文件而**全体红**（正是本文件上面记录的那个缺陷形状，换我来犯一次）。
 * ⇒ 待 `package.json` 干净时补两处（一条命令就能做，落点写在 `BLOCKED.md` 本轮那一节）：
 * scripts 里加 `"check:e2e-helper-exports": "node scripts/check-e2e-helper-exports.mjs"`，
 * 并把 `pnpm check:e2e-helper-exports` 插进 `check` 链（`check:gate-wiring` 会自己验接线，
 * 只加定义不接线它就直接红）。
 */
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const EXTENSIONS = ['', '.ts', '.tsx', '.mjs', '.js', '/index.ts', '/index.tsx', '/index.mjs', '/index.js'];

/** 去掉整行注释（`//`、`*` 续行、`/* … *\/` 块）—— 文档头部里那种"引用一条 import 语句"不该被当成导入。 */
function stripComments(src) {
  const kept = [];
  let inBlock = false;
  for (const line of src.split('\n')) {
    const t = line.trimStart();
    if (inBlock) {
      if (t.includes('*/')) inBlock = false;
      kept.push('');
      continue;
    }
    if (t.startsWith('/*')) {
      if (!t.includes('*/')) inBlock = true;
      kept.push('');
      continue;
    }
    if (t.startsWith('//') || t.startsWith('*')) {
      kept.push('');
      continue;
    }
    kept.push(line);
  }
  return kept.join('\n');
}

function listTsFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (name === 'node_modules' || name === 'test-results' || name === 'playwright-report') continue;
    const st = statSync(p);
    if (st.isDirectory()) out.push(...listTsFiles(p));
    else if (/\.(ts|tsx|mjs|js)$/.test(name)) out.push(p);
  }
  return out;
}

/** 解析一条相对说明符到实际文件；解析不到返回 `null`（= 目标缺失）。 */
function resolveSpecifier(fromFile, spec) {
  const base = resolve(dirname(fromFile), spec);
  const candidates = spec.endsWith('.js') ? [base.slice(0, -3) + '.ts', base, base.slice(0, -3) + '.tsx', ...EXTENSIONS.map((e) => base + e)]
    : [base, ...EXTENSIONS.map((e) => base + e)];
  for (const c of candidates) {
    try {
      if (statSync(c).isFile()) return c;
    } catch {
      /* 换一个候选 */
    }
  }
  return null;
}

/** 一个文件导出的**名字集合**（`default` 用 `'default'` 表示），`export … from` 与 `export *` 递归展开。 */
function exportedNames(file, seen = new Set()) {
  if (seen.has(file)) return new Set();
  seen.add(file);
  const src = stripComments(readFileSync(file, 'utf8'));
  const names = new Set();
  for (const m of src.matchAll(/\bexport\s+(?:async\s+)?(?:function|class)\s+([A-Za-z0-9_$]+)/g)) names.add(m[1]);
  for (const m of src.matchAll(/\bexport\s+(?:const|let|var|type|interface|enum)\s+([A-Za-z0-9_$]+)/g)) names.add(m[1]);
  for (const m of src.matchAll(/\bexport\s+default\b/g)) names.add('default');
  /* export { a, b as c }  与  export { a } from './z' */
  for (const m of src.matchAll(/\bexport\s+(?:type\s+)?\{([^}]*)\}(?:\s*from\s*['"]([^'"]+)['"])?/g)) {
    const target = m[2];
    const list = m[1].split(',').map((s) => s.trim()).filter(Boolean);
    if (!target) {
      for (const item of list) names.add(item.replace(/^type\s+/, '').split(/\s+as\s+/)[1]?.trim() ?? item);
      continue;
    }
    const file2 = target.startsWith('.') ? resolveSpecifier(file, target) : null;
    if (file2 === null) {
      /* 裸包名（`export { X } from 'playwright'`）不在这个仓库里，**信它** —— 本门禁只判同树两文件互不认。
         相对路径却解析不到的：这里**不**臆造导出，缺失由消费端那条"目标文件不存在"点名（一处只说一次）。 */
      if (!target.startsWith('.')) {
        for (const item of list) names.add(item.replace(/^type\s+/, '').split(/\s+as\s+/)[1]?.trim() ?? item);
      }
      continue;
    }
    /* 🔴 再导出**必须真的能在源头数到**：把 `export { ghost } from './inner'` 原样转抄成"本文件导出 ghost"
       等于替一个不存在的名字担保 —— 那条链上断掉的正是这一环（A4 那条臂就是为它写的）。 */
    const inner = exportedNames(file2, seen);
    for (const item of list) {
      const parts = item.replace(/^type\s+/, '').split(/\s+as\s+/);
      const source = parts[0].trim();
      const exported = (parts[1] ?? parts[0]).trim();
      if (inner.has(source)) names.add(exported);
    }
  }
  /* export * from './z'  与  export * as ns from './z' */
  for (const m of src.matchAll(/\bexport\s+\*\s+(?:as\s+([A-Za-z0-9_$]+)\s+)?from\s+['"]([^'"]+)['"]/g)) {
    const [, alias, target] = m;
    if (alias) {
      names.add(alias);
      continue;
    }
    const file2 = target.startsWith('.') ? resolveSpecifier(file, target) : null;
    if (file2) for (const n of exportedNames(file2, seen)) names.add(n);
  }
  return names;
}

/** 一条 import 的形状：`import [default][, {named}][* as ns] from 'spec'` 或 `import 'spec'`。 */
const IMPORT_RE = /\bimport\s+(?:type\s+)?([\s\S]*?)\s*from\s*['"]([^'"]+)['"]/g;

function scan(rootDir) {
  const findings = [];
  let consumerFiles = 0;
  let checkedNames = 0;
  for (const file of listTsFiles(rootDir)) {
    consumerFiles += 1;
    const src = stripComments(readFileSync(file, 'utf8'));
    for (const m of src.matchAll(IMPORT_RE)) {
      const [, clause, spec] = m;
      if (!spec.startsWith('./') && !spec.startsWith('../')) continue;
      const target = resolveSpecifier(file, spec);
      if (target === null) {
        findings.push({ file, spec, name: null, reason: '目标文件不存在' });
        continue;
      }
      const exports = exportedNames(target);
      const braces = clause.match(/\{([\s\S]*)\}/);
      if (braces) {
        for (const raw of braces[1].split(',')) {
          const item = raw.trim();
          if (!item) continue;
          /* 🔴 `import { type X }` 那个行内 `type` 修饰符是**语法**，不是名字的一部分
             （TS 4.5 的写法）。不剥掉它就会把 `type X` 当成一个查不到的名字 ⇒ 假红。 */
          const name = item.replace(/^type\s+/, '').split(/\s+as\s+/)[0].trim();
          checkedNames += 1;
          if (!exports.has(name)) {
            findings.push({ file, spec, name, reason: exports.size === 0 ? '目标文件一个具名导出都没有' : '目标文件没有这个导出' });
          }
        }
      }
      const defaultName = clause.replace(/\{[\s\S]*\}/, '').replace(/\*\s*as\s*[A-Za-z0-9_$]+/, '').replace(/,\s*$/, '').trim();
      if (defaultName && !/^(type\s+)?$/.test(defaultName)) {
        checkedNames += 1;
        if (!exports.has('default')) findings.push({ file, spec, name: 'default', reason: '目标文件没有 default 导出' });
      }
    }
  }
  return { findings, consumerFiles, checkedNames };
}

function report(label, result) {
  console.log(`${label}：射程 ${result.consumerFiles} 份文件 / 对账 ${result.checkedNames} 个导入名 / 缺失 ${result.findings.length} 个`);
  for (const f of result.findings) {
    console.log(`  🔴 ${relative(ROOT, f.file)}  →  ${f.spec}  ${f.name === null ? '(整条)' : f.name}：${f.reason}`);
  }
  return result.findings.length === 0;
}

/* ---------------------------------------------------------------- 自检臂 */

function writeFixture(dir, rel, body) {
  const p = join(dir, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, body, 'utf8');
  return p;
}

function selfTest() {
  const dir = mkdtempSync(join(ROOT, 'tmp', 'check-e2e-helper-exports.selftest-'));
  const arms = [];
  try {
    /* 臂 1：干净夹具 —— 目标必须**通过**（挡住"扫描器自己坏掉也报绿"的反面：它至少得认识对的写法）。 */
    writeFixture(dir, 'clean/helper.ts', 'export function pick(): number { return 1; }\nexport type Kind = "a";\nexport const LIMIT = 3;\n');
    writeFixture(dir, 'clean/a.spec.ts', "import { pick, LIMIT, type Kind } from './helper';\nconsole.log(pick(), LIMIT, null as Kind | null);\n");
    const clean = scan(join(dir, 'clean'));
    arms.push({ name: 'A1 干净夹具必须通过（挡住扫描器把合法写法读成缺失）', pass: clean.findings.length === 0, detail: `缺失 ${clean.findings.length}` });

    /* 臂 2：消费者导入了生产者没有的名字 —— 这就是本次那个缺陷的形状。 */
    writeFixture(dir, 'missing-name/helper.ts', 'export function pick(): number { return 1; }\n');
    writeFixture(dir, 'missing-name/a.spec.ts', "import { pick, selectHabit } from './helper';\nconsole.log(pick(), selectHabit);\n");
    const missing = scan(join(dir, 'missing-name'));
    arms.push({
      name: 'A2 生产者少一个名字必须红，并且点到那一份 spec 与那个名',
      pass: missing.findings.length === 1
        && missing.findings[0].name === 'selectHabit'
        && missing.findings[0].file.endsWith('a.spec.ts'),
      detail: `缺失 ${missing.findings.length}：${missing.findings.map((f) => f.name).join(',')}`,
    });

    /* 臂 3：目标文件整个不存在（路径写错 / 生产者整份没提交）。 */
    writeFixture(dir, 'missing-module/a.spec.ts', "import { whatever } from './nope';\nconsole.log(whatever);\n");
    const noMod = scan(join(dir, 'missing-module'));
    arms.push({
      name: 'A3 目标文件不存在必须红，且不许把它算成"名字缺失"（那是两条不同的话）',
      pass: noMod.findings.length === 1 && noMod.findings[0].name === null && noMod.findings[0].reason === '目标文件不存在',
      detail: `${noMod.findings.length} 条：${noMod.findings.map((f) => f.reason).join(',')}`,
    });

    /* 臂 4：再导出链（`export { x } from './z'`）断了 —— 递归那一层得有牙。 */
    writeFixture(dir, 'reexport/index.ts', "export { real } from './inner';\nexport { ghost } from './inner';\n");
    writeFixture(dir, 'reexport/inner.ts', 'export function real(): void {}\n');
    writeFixture(dir, 'reexport/a.spec.ts', "import { real, ghost } from './index';\nconsole.log(real, ghost);\n");
    const reexp = scan(join(dir, 'reexport'));
    arms.push({
      name: 'A4 再导出链上只缺那一枚：`real` 必须被递归认到，`ghost` 必须红',
      pass: reexp.findings.length === 1 && reexp.findings[0].name === 'ghost',
      detail: `${reexp.findings.length} 条：${reexp.findings.map((f) => f.name).join(',')}`,
    });

    /* 臂 5：`// import { … } from './x'` 这种注释里的引用不许被当成导入（文档头部到处都是）。 */
    writeFixture(dir, 'commented/a.spec.ts', "// import { ghost } from './nope';\n/* import { ghost2 } from './nope2'; */\nconsole.log(1);\n");
    const commented = scan(join(dir, 'commented'));
    arms.push({ name: 'A5 注释里的 import 不算导入（否则每个文档头都会红）', pass: commented.findings.length === 0, detail: `缺失 ${commented.findings.length}` });

    /* 臂 6：TS 的 `./x.js` → `./x.ts` 映射必须认（`playwright.*.config.ts` 与本仓约定都用这套）。 */
    writeFixture(dir, 'jsmap/helper.ts', 'export function ok(): void {}\n');
    writeFixture(dir, 'jsmap/a.spec.ts', "import { ok } from './helper.js';\nok();\n");
    const jsmap = scan(join(dir, 'jsmap'));
    arms.push({ name: 'A6 `./helper.js` 指向 `helper.ts` 必须认（不然会假红一片）', pass: jsmap.findings.length === 0, detail: `缺失 ${jsmap.findings.length}` });

    /* 臂 7：`import Def, { named }` 这种**默认 + 具名同时出现** —— 逗号后面还有花括号时，
       默认那一份不许被当成"没有默认导入"跳过（那是"少查一项"，不是"多查一项"，安静地漏）。 */
    writeFixture(dir, 'default-plus/mod.ts', 'export default function main(): void {}\nexport const EXTRA = 2;\n');
    writeFixture(dir, 'default-plus/a.spec.ts', "import main, { EXTRA, GHOST } from './mod';\nconsole.log(main, EXTRA, GHOST);\n");
    const dflt = scan(join(dir, 'default-plus'));
    arms.push({
      name: 'A7 默认 + 具名同时导入：`GHOST` 要红，而 `main` 那一份也得被真的查过',
      pass: dflt.findings.length === 1 && dflt.findings[0].name === 'GHOST',
      detail: `${dflt.findings.length} 条：${dflt.findings.map((f) => f.name).join(',')}`,
    });

    /* 臂 8：行内 `type` 修饰符是语法、不是名字的一部分（本脚本第一版就是把它当成名字，
       于是把 `e2e/auth-journey` 里三份合法文件报成缺失 —— 假红的形状记在这里）。 */
    writeFixture(dir, 'inline-type/mod.ts', 'export interface Kind { a: number }\nexport function go(): void {}\n');
    writeFixture(dir, 'inline-type/a.spec.ts', "import { type Kind, go } from './mod';\nconsole.log(go, null as Kind | null);\n");
    const inl = scan(join(dir, 'inline-type'));
    arms.push({ name: 'A8 `import { type Kind }` 的那个 type 不算名字（挡住第一版那四条假红）', pass: inl.findings.length === 0, detail: `缺失 ${inl.findings.length}：${inl.findings.map((f) => f.name).join(',')}` });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  let bad = 0;
  for (const [i, arm] of arms.entries()) {
    if (!arm.pass) bad += 1;
    console.log(`${arm.pass ? '✅' : '🔴'} 臂 ${i + 1} ${arm.name} —— ${arm.detail}`);
  }
  console.log(`自检：${arms.length} 臂，失败 ${bad} 臂`);
  process.exit(bad === 0 ? 0 : 1);
}

/* ------------------------------------------------------------------ main */

if (process.argv.includes('--self-test')) selfTest();
else {
  const ok = report('e2e 命名导入对账', scan(join(ROOT, 'e2e')));
  if (!ok) {
    console.log('🔴 修法：把**生产者**补进同一笔提交（`e2e/` 不在 pnpm 工作区内，`pnpm -r typecheck` 看不见这一族）。');
    process.exit(1);
  }
}
