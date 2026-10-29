#!/usr/bin/env node
/**
 * `packages/<pkg>/src` 的导出面有没有"没人用的实现"（注册登录标准套件线，2026-10-29）
 * ==============================================================================
 *
 * 这是目标第 3 件第 ② 维的尺：**枚举分母**，不是"grep 一两个名字看着没人用"。
 * 默认只报候选，**一个字节都不删** —— 判死代码要人拍板，而"看着没人用"从来不是证据。
 *
 * ## 为什么不能只看"仓库里搜不到名字"
 *
 * 本仓的包边界是 `index.ts` 再导出 + 各壳按名 import。所以一枚导出有三种活法，必须分开：
 *
 *   · **有消费者** —— 除自己那枚文件、除 barrel 之外还有别处出现这名字；
 *   · **只被 barrel 再导出** —— 除自己之外**只有** `packages/<pkg>/src/index.ts` 提到它。
 *     这既可能是"公共面，给壳用而壳此刻没用到"，也可能是**再导出链断在半路**（barrel 导出了，
 *     没有任何壳 import 那一枚）⇒ 这一档必须单独报出来，混进"活着"就是把死码藏起来；
 *   · **零引用** —— 除自己那枚文件外全仓不出现 ⇒ 真候选。
 *
 * 🔴 三桶之外还有一格不能省：**本尺看不见动态引用**（按字符串名取、`export *` 通配再导出后
 * 被别的包整体转发）。所以每一条候选都要人开码确认；这也是它默认退 0、`--strict` 才退 1 的原因。
 * 分母自检与两枚阳性对照臂（一枚"活着的不许进候选"、一枚"注入的死码必须进候选"）
 * 在下面 `--self-test` 里 —— **没有这两枚，这台尺生下来就没有牙**。
 *
 * 用法：node research/tools/audit-unused-package-exports.mjs [--strict] [--self-test] [--top N]
 * 退出：0 = 只报读数；1 = --strict 且有候选；2 = 分母为空或阳性对照不成立（"我没干活"，不许读成"没有死码"）
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const argv = process.argv.slice(2);
const strict = argv.includes('--strict');
const selfTest = argv.includes('--self-test');
const unknown = argv.filter((a) => !['--strict', '--self-test'].includes(a) && a !== '--top' && !/^\d+$/.test(a));
const topIv = argv.indexOf('--top');
const TOP = topIv >= 0 && /^\d+$/.test(argv[topIv + 1] ?? '') ? Number(argv[topIv + 1]) : 40;

const DECL_RE = /^[ \t]*export[ \t]+(?:declare[ \t]+)?(?:async[ \t]+)?(function|const|let|var|class|type|interface|enum)[ \t]+([A-Za-z_$][\w$]*)/gm;
const BAREL_RE = /^[ \t]*export(?:[ \t]+type)?[ \t]*\{([^}]*)\}[ \t]*(?:from[ \t]*[^;]+)?[ \t]*;?[ \t]*$/gm;
const IDENT_RE = /[A-Za-z_$][\w$]+/g;

/** 一枚文件里声明了哪些导出名。返回 [{ name, line }]。 */
export function declaredExports(text) {
  const out = [];
  for (const m of text.matchAll(DECL_RE)) {
    out.push({ name: m[2], line: text.slice(0, m.index).split('\n').length });
  }
  for (const m of text.matchAll(BAREL_RE)) {
    for (const raw of m[1].split(',')) {
      const t = raw.trim();
      if (t === '' || t.startsWith('//')) continue;
      // `export { a as b }` 里对外可见的是 **b**；`export type { x }` 也走这条
      const as = /\bas\b/i.exec(t);
      const name = as ? t.slice(as.index + as[0].length).trim() : t;
      if (/^[A-Za-z_$][\w$]*$/.test(name)) out.push({ name, line: text.slice(0, m.index).split('\n').length });
    }
  }
  return out;
}

function gitLines(args) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 28 }).split('\n').filter((l) => l !== '');
}

const isBarrel = (f) => /(^|\/)packages\/[^/]+\/src\/index\.ts$/.test(f);

/** 全仓（含 apps/server/e2e/scripts/research/docs）按标识符建"名字 → 出现在哪些文件"。 */
function buildIndex(files) {
  const uses = new Map();
  for (const f of files) {
    if (!/\.(ts|tsx|mts|js|mjs|cjs)$/.test(f)) continue;
    let text;
    try {
      text = readFileSync(path.join(ROOT, f), 'utf8');
    } catch {
      continue;
    }
    if (f.includes('/dist/') || f.includes('/node_modules/')) continue; // 🔴 产物不是消费者：把 dist 里的名字算成"有人用"会直接藏住死码
    for (const m of text.matchAll(IDENT_RE)) {
      let set = uses.get(m[0]);
      if (!set) uses.set(m[0], (set = new Set()));
      set.add(f);
    }
  }
  return uses;
}

/**
 * 分桶。`declFiles`：`packages/<pkg>/src/**` 里带导出的文件；`uses`：全仓标识符索引。
 * 🔴 只看标识符出现在**哪些文件**，不做语义解析 —— 所以这是"候选清单"，不是判词。
 */
export function bucket(declFiles, uses) {
  const live = [];
  const barrelOnly = [];
  const zero = [];
  for (const entry of declFiles) {
    const [f, text0] = Array.isArray(entry) ? entry : [entry, null];
    let text = text0;
    if (text === null || text === undefined) {
      try {
        text = readFileSync(path.join(ROOT, f), 'utf8');
      } catch {
        continue;
      }
    }
    for (const d of declaredExports(text)) {
      const where = uses.get(d.name);
      const others = where ? [...where].filter((x) => x !== f) : [];
      if (others.length === 0) zero.push({ file: f, ...d });
      else if (others.every(isBarrel)) barrelOnly.push({ file: f, ...d, via: others });
      else live.push({ file: f, ...d, n: others.length });
    }
  }
  return { live, barrelOnly, zero };
}

const SELF_TEST_ARMS = () => {
  const arms = [];
  const push = (name, got, want) => arms.push({ name, ok: JSON.stringify(got) === JSON.stringify(want), got, want });
  const A = "export const usedEverywhere = 1;\nexport function onlyReexported() {}\nexport const nobodyAtAll = 2;\nexport type { Renamed as ExposedName } from './x';\n";

  push('U1 `export { a as b }` 对外可见的是 b，不是 a', declaredExports("export { internal as publicFace } from './i';").map((d) => d.name), ['publicFace']);
  push('U2 `export type { x }` 也要进分母（漏了它就会把整条类型面当成不存在）', declaredExports("export type { Foo } from './f';").map((d) => d.name), ['Foo']);
  push('U3 常量/函数/类型/接口/枚举五种声明 + `export type { R as E }` 都要数到（U2 那处解析修正一改，这一臂的期望就得跟着改——它盯着的是"别漏类型面"）', declaredExports(A).map((d) => d.name).filter((n) => ['usedEverywhere', 'onlyReexported', 'nobodyAtAll', 'ExposedName', 'Foo'].includes(n)), ['usedEverywhere', 'onlyReexported', 'nobodyAtAll', 'ExposedName']);
  push(
    'U4 阳性对照：真被别处用的名字**不许**进候选（进了就是尺在编造死码）',
    bucket(
      [['p/src/a.ts', "export const usedEverywhere = 1;\nexport const onlyReexported = 2;\nexport const nobodyAtAll = 3;\n"]],
      new Map([
        ['usedEverywhere', new Set(['p/src/a.ts', 'apps/web/src/App.tsx'])],
        ['onlyReexported', new Set(['p/src/a.ts', 'p/src/index.ts'])],
        ['nobodyAtAll', new Set(['p/src/a.ts'])],
      ]),
    ).zero.map((r) => r.name),
    ['nobodyAtAll'],
  );
  push(
    'U5 只被 barrel 再导出的那一档必须单独成桶（混进"活着"等于把断掉的转发链藏起来）',
    bucket(
      [['p/src/a.ts', "export const onlyReexported = 2;\n"]],
      new Map([['onlyReexported', new Set(['p/src/a.ts', 'packages/ui/src/index.ts'])]]),
    ).barrelOnly.map((r) => [r.name, r.via.join(',')]),
    [['onlyReexported', 'packages/ui/src/index.ts']],
  );
  push('U6 注入的死码必须被点名（这台尺至少要说真话）', bucket([['p/src/a.ts', 'export const ghost = 1;\n']], new Map()).zero.map((r) => r.name), ['ghost']);
  push('U7 标识符边界：`ghost` 不许因为别处有 `ghostToken` 就算被用（按词元相等，不是子串）', bucket([['p/src/a.ts', 'export const ghost = 1;\n']], new Map([['ghostToken', new Set(['p/src/b.ts'])]])).zero.map((r) => r.name), ['ghost']);
  return arms;
};

const run = () => {
  if (unknown.length > 0) {
    console.error(`🔴 不认的旗标：${unknown.join(' ')} ｜ 只认 --strict / --self-test / --top N`);
    process.exit(1);
  }
  if (selfTest) {
    const arms = SELF_TEST_ARMS();
    const bad = arms.filter((a) => !a.ok);
    for (const a of arms) console.log(`${a.ok ? '✅' : '🔴'} ${a.name}${a.ok ? '' : ` ｜ 得到 ${JSON.stringify(a.got)} ｜ 期望 ${JSON.stringify(a.want)}`}`);
    console.log(`臂数 ${arms.length} ｜ 不符 ${bad.length}`);
    process.exit(bad.length === 0 ? 0 : 1);
  }
  if (!existsSync(path.join(ROOT, 'packages'))) {
    console.error('🔴 读不到 packages/ ⇒ 探针不合，今天不许报"没有死码"');
    process.exit(2);
  }
  const all = gitLines(['-c', 'core.quotepath=off', 'ls-files', '--', '*.ts', '*.tsx', '*.mts', '*.js', '*.mjs', '*.cjs']);
  const declFiles = all.filter((f) => f.startsWith('packages/') && f.includes('/src/'));
  if (declFiles.length === 0) {
    console.error('🔴 `packages/<pkg>/src` 一枚都没枚举到 ⇒ 分母为空，这一趟不算"没有死码"');
    process.exit(2);
  }
  const uses = buildIndex(all);
  const { live, barrelOnly, zero } = bucket(declFiles.map((f) => [f, null]), uses);
  // 视力臂：拿一枚本仓一定活着的公共面做阳性对照，不成立就退 2（尺不许把"我搜法坏了"读成"没有候选"）
  const control = 'AUTO_DISMISS_RECEIPTS';
  if (!uses.has(control) && !existsSync(path.join(ROOT, 'packages/ui/src/index.ts'))) {
    console.error(`🔴 对照名 ${control} 与 barrel 都读不到 ⇒ 索引没建起来，这一趟作废`);
    process.exit(2);
  }
  console.log(`包导出面审计 ｜ 分母：${declFiles.length} 枚 packages/<pkg>/src 文件里的全部 export 声明`);
  console.log(`   有消费者 ${live.length} ｜ 只被 barrel 再导出 ${barrelOnly.length} ｜ 全仓零引用 ${zero.length}`);
  const show = (title, rows) => {
    if (rows.length === 0) return;
    console.log(`\n${title}（${rows.length} 枚，列前 ${Math.min(TOP, rows.length)}）`);
    for (const r of rows.slice(0, TOP)) console.log(`   ${r.file}:${r.line}  ${r.name}${r.via ? `   ← 只出现在 ${r.via.join(' / ')}` : ''}`);
  };
  show('🟠 全仓零引用（真候选：删之前必须逐枚开码确认动态引用与通配转发）', zero);
  show('🟡 只被 barrel 再导出（要么壳还没用上，要么转发链断在半路）', barrelOnly);
  if (zero.length + barrelOnly.length === 0) console.log('\n   ⇒ 两桶都空。这一句只有在本尺的分母与对照都成立时才算读数。');
  process.exit(strict && zero.length > 0 ? 1 : 0);
};

run();
