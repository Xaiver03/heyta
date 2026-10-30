#!/usr/bin/env node
/**
 * ① 那一维里最后一格：同一批调用面、**控制流写得不一样**的复制。
 * =================================================================
 *
 * ## 为什么还要第三把尺
 *
 *   · `audit-duplicate-function-bodies.mjs`   按**文本**对账（改名就漏）
 *   · `audit-duplicate-logic-skeletons.mjs`   按**骨架**（控制流关键字序列）对账（控制流一改就漏）
 *   · 本尺                                   按**调用面**（调了哪些 API、各几次）对账
 *
 * 前两把都不看的正是"同样一圈读写，一处写成 `if/return`、另一处写成三元/循环"。
 * 目标那句"同一读路径在多处各写一遍"要的就是这个口径：**读路径 = 打过的调用序列**，不是它的排版。
 *
 * ## 判什么
 *
 * 分组键 = 调用面签名（每个被调名 + 出现次数，排序拼串）。一组要同时满足：
 *   ① 跨 ≥2 枚文件（只在同一枚文件里的另记一档）；
 *   ② 组内**骨架不全相同**且**至少有一对新面孔** ⇒ 本尺才报。两把尺各数各的才不会把同一笔重复计两次：
 *      一组里可能既混着"骨架尺已报过的对"也混着它看不见的新对，所以判的是**组有没有新东西可说**，
 *      不是"有没有重叠"（重叠只作信息打印；第一发我就把它错当成违规条件，臂 C9 钉住了正确形状）；
 *   ③ 调用次数 ≥ `--min-calls`（默认 6）且不同被调名 ≥ `--min-names`（默认 3）——
 *      不然 `log`/`map` 这种谁都打的会凑出成千上万组噪声；
 *   ④ 全员都在测试面 ⇒ 另记一档，不进生产那栏。
 *
 * ## **不**判什么
 *
 * ① 调用面相同**不等于**语义相同：两枚都打 `get/set/has`，一个做缓存一个做权限表完全可能。
 *    所以本尺产出的是**候选**，逐枚开码才成判词。
 * ② 被调名只看括号前最后一个标识符，**不看接收者**：`ctx.set` 与 `store.set` 都算 `set`。
 *    这是故意的（要抓的就是"同一圈 API"），代价是同名不同物的两枚会被并到一起 ⇒ 又是候选不是判词。
 * ③ 关键字与声明形状不算被调名（`if (`、`function (`、`for (`、`catch (`…）——臂 C4 钉的就是这条；
 *    少剔一个关键字，组数会系统性虚高。
 * ④ 比较吃**遮蔽过注释与字符串**的文本（共用 `maskText`）：注释里的 `foo()` 不许算一次调用。
 *
 * ## 用法与退出码
 *
 *   node research/tools/audit-duplicate-call-paths.mjs                # 诊断，恒退 0
 *   node research/tools/audit-duplicate-call-paths.mjs --strict       # 生产那栏有候选 ⇒ 退 1
 *   node research/tools/audit-duplicate-call-paths.mjs --self-test    # 臂全绿 ⇒ 0，有不符 ⇒ 1
 *   node research/tools/audit-duplicate-call-paths.mjs --mutate       # 阳性对照：注入必须被抓、改回同骨架必须不报
 *   分母为空 / 与骨架尺的重叠对不上 ⇒ 退 2（"我没干活"，不许读成"没有重复"）
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { collect } from './audit-duplicate-logic-skeletons.mjs';
import { applyScope } from './audit-duplicate-function-bodies.mjs';
import { maskText } from './lib/text-mask.mjs';

const IS_ENTRY = !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
const argv = IS_ENTRY ? process.argv.slice(2) : [];
const num = (flag, dflt) => {
  const i = argv.indexOf(flag);
  return i >= 0 && /^\d+$/.test(argv[i + 1] ?? '') ? Number(argv[i + 1]) : dflt;
};
const TOP = num('--top', 12);
const MIN_CALLS = num('--min-calls', 6);
const MIN_NAMES = num('--min-names', 3);

// 关键字/声明形状不是"被调名"。这一列漏一个，组数就系统性虚高（臂 C4）。
const NOT_A_CALL = new Set([
  'if', 'for', 'while', 'switch', 'catch', 'return', 'function', 'typeof', 'new', 'do',
  'else', 'await', 'yield', 'delete', 'void', 'in', 'of', 'case', 'with', 'throw', 'super',
]);
const CALL_RE = /([A-Za-z_$][\w$]*)\s*\(/g;
const TESTISH = /(^|\/)(tests?|e2e|__tests__)|\.spec\.[tm]sx?$/;

/** 调用面签名：`名字:次数` 排序拼串。`x.f(` 与 `f(` 都算 `f`。 */
export function callSignature(masked) {
  const counts = new Map();
  let total = 0;
  for (const m of masked.matchAll(CALL_RE)) {
    if (NOT_A_CALL.has(m[1])) continue;
    counts.set(m[1], (counts.get(m[1]) ?? 0) + 1);
    total += 1;
  }
  const sig = [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([k, v]) => `${k}:${v}`).join(',');
  return { sig, total, names: counts.size };
}

/**
 * 按调用面分桶。`read` 可注入（臂与变异台架都靠它，不碰真实文件）。
 * `overlapWithSkeleton` 是**对账**用的：本尺只该报骨架尺看不见的那批，重叠必须为 0。
 */
export function collectCallPaths(files, read = (f) => readFileSync(f, 'utf8'), minCalls = MIN_CALLS, minNames = MIN_NAMES) {
  const { fns, buckets: skeletonBuckets } = collect(files, read);
  const alreadySeen = new Set();
  for (const b of skeletonBuckets) {
    for (let i = 0; i < b.list.length; i += 1) {
      for (let j = i + 1; j < b.list.length; j += 1) {
        const a = b.list[i]; const c = b.list[j];
        alreadySeen.add(`${a.file}#${a.name}|${c.file}#${c.name}`);
        alreadySeen.add(`${c.file}#${c.name}|${a.file}#${a.name}`);
      }
    }
  }
  const groups = new Map();
  let tooSmall = 0;
  for (const fn of fns) {
    const c = callSignature(fn.masked);
    fn.calls = c.total;
    fn.callNames = c.names;
    fn.callSig = c.sig;
    if (c.total < minCalls || c.names < minNames) { tooSmall += 1; continue; }
    if (!groups.has(c.sig)) groups.set(c.sig, []);
    groups.get(c.sig).push(fn);
  }
  const buckets = [];
  let overlap = 0;
  let novelTotal = 0;
  let pairTotal = 0;
  for (const [sig, list] of groups) {
    if (list.length < 2) continue;
    // 🔴 骨架全同 ⇒ 已经归骨架尺，本尺跳过（不变量 ②）。
    if (new Set(list.map((x) => x.skeleton)).size < 2) continue;
    let novel = 0;
    let dup = 0;
    for (let i = 0; i < list.length; i += 1) {
      for (let j = i + 1; j < list.length; j += 1) {
        pairTotal += 1;
        if (alreadySeen.has(`${list[i].file}#${list[i].name}|${list[j].file}#${list[j].name}`)) dup += 1;
        else novel += 1;
      }
    }
    // 🔴 整组都对子是骨架尺报过的 ⇒ 本尺没有新东西可说，跳过（这才是"两把尺不重复计同一笔"的正确形状：
    //    判的是**组里有没有新面孔**，不是"一组里混了几对老的就不许报"）。
    if (novel === 0) continue;
    overlap += dup;
    novelTotal += novel;
    buckets.push({
      sig,
      list,
      crossFile: new Set(list.map((x) => x.file)).size > 1,
      testSide: list.every((x) => TESTISH.test(x.file)),
      skeletons: new Set(list.map((x) => x.skeleton)).size,
      novelPairs: novel,
      dupPairs: dup,
    });
  }
  buckets.sort((a, b) => (a.testSide - b.testSide) || (b.crossFile - a.crossFile) || (b.list.length - a.list.length) || a.sig.localeCompare(b.sig));
  return { buckets, fns, groups: groups.size, tooSmall, overlapPairs: overlap, novelPairs: novelTotal, pairTotal };
}

export const prodBuckets = (buckets) => buckets.filter((b) => !b.testSide && b.crossFile);

const git = (args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).split('\n').filter((l) => l.trim() !== '');
const PRODUCT_SCOPES = ['apps/', 'packages/', 'server/src/', 'scripts/', 'e2e/'];
const listTracked = () => git(['-c', 'core.quotepath=off', 'ls-files', '--', '*.ts', '*.tsx'])
  .filter((l) => !l.endsWith('.d.ts') && PRODUCT_SCOPES.some((p) => l.startsWith(p)) && !l.startsWith('research/'));

/* ---------------- 臂 ---------------- */

const A = {
  'p/src/one.ts': [
    'export function readRow(ctx: any, id: string) {\n',
    '  const hit = ctx.get(id);\n',
    '  if (hit === undefined) {\n',
    '    ctx.set(id, ctx.load(id));\n',
    '    ctx.touch(id);\n',
    '    return ctx.load(id);\n',
    '  }\n',
    '  ctx.touch(id);\n',
    '  return hit;\n',
    '}\n',
  ].join(''),
  'p/src/two.ts': [
    'export function fetchRow(store: any, key: string) {\n',
    '  const hit = store.get(key);\n',
    '  for (const k of [key]) {\n',
    '    store.set(k, store.load(k));\n',
    '    store.touch(k);\n',
    '  }\n',
    '  store.touch(key);\n',
    '  return store.load(key);\n',
    '}\n',
  ].join(''),
  // 与 one.ts 调用面相同、**骨架也相同**的那枚 ⇒ 该归骨架尺，本尺不许再报（臂 C2/C8）。
  'p/src/three.ts': [
    'export function peekRow(cache: any, k: string) {\n',
    '  const hit = cache.get(k);\n',
    '  if (hit === undefined) {\n',
    '    cache.set(k, cache.load(k));\n',
    '    cache.touch(k);\n',
    '    return cache.load(k);\n',
    '  }\n',
    '  cache.touch(k);\n',
    '  return hit;\n',
    '}\n',
  ].join(''),
  // 调用面不足（臂 C3）
  'p/src/small.ts': 'export function logIt(a: any) {\n  a.log(a.now());\n  return a.end();\n}\n',
  // 测试面（臂 C6）
  'p/tests/four.spec.ts': [
    'function readRowFix(ctx: any, id: string) {\n',
    '  const hit = ctx.get(id);\n',
    '  if (hit === undefined) {\n',
    '    ctx.set(id, ctx.load(id));\n',
    '    ctx.touch(id);\n',
    '    return ctx.load(id);\n',
    '  }\n',
    '  ctx.touch(id);\n',
    '  return hit;\n',
    '}\n',
  ].join(''),
};
const FIXTURES = Object.keys(A);
const reader = (map) => (f) => map[f] ?? '';

function selfTest() {
  const arms = [];
  const push = (name, got, want) => arms.push({ name, ok: JSON.stringify(got) === JSON.stringify(want), got, want });
  const base = () => collectCallPaths(FIXTURES, reader(A));

  push('C1 同一圈调用、控制流写得不一样 ⇒ 必须被抓（前两把尺都看不见这一族）',
    (() => {
      const r = base();
      const g = r.buckets.find((b) => b.list.some((x) => x.file === 'p/src/one.ts') && b.list.some((x) => x.file === 'p/src/two.ts'));
      return [!!g, g?.skeletons ?? 0];
    })(), [true, 2]);
  push('C2 调用面与骨架都相同 ⇒ 本尺**不报**（那是骨架尺的地盘，两把尺各数各的）',
    (() => {
      const r = collectCallPaths(['p/src/one.ts', 'p/src/three.ts'], reader(A));
      return r.buckets.length;
    })(), 0);
  push('C3 调用次数或不同名数不足 ⇒ 落"太小不比"，不进候选',
    (() => {
      const r = collectCallPaths(FIXTURES, reader(A));
      return r.buckets.every((b) => !b.list.some((x) => x.file === 'p/src/small.ts'));
    })(), true);
  push('C4 关键字不算被调名：`if (`/`for (`/`return (` 都不进签名（少剔一个，组数会系统性虚高）；括号后没跟 `(` 的名也不算',
    callSignature('if (a) { for (const x of y) { b(x); } } return c(d);'),
    { sig: 'b:1,c:1', total: 2, names: 2 });
  push('C5 接收者不参与：`ctx.set(` 与 `store.set(` 折成同一枚 `set`',
    [callSignature('ctx.set(1)').sig, callSignature('store.set(1)').sig], ['set:1', 'set:1']);
  push('C6 全员都在测试面的一组 ⇒ 另记一档，生产那栏读 0（夹具必须真构出"全员测试面"，否则这臂判的是别的东西）',
    (() => {
      const tmap = {
        'p/tests/a.spec.ts': A['p/src/one.ts'],
        'p/tests/b.spec.ts': A['p/src/two.ts'],
      };
      const r = collectCallPaths(Object.keys(tmap), reader(tmap));
      return [r.buckets.length, r.buckets.every((b) => b.testSide), prodBuckets(r.buckets).length];
    })(), [1, true, 0]);
  push('C7 只在同一枚文件里重复 ⇒ 单列 same-file 一档，不与跨文件混数',
    (() => {
      const dup = { 'p/src/dup.ts': A['p/src/one.ts'] + A['p/src/two.ts'] };
      const r = collectCallPaths(Object.keys(dup), reader(dup));
      return [r.buckets.every((b) => !b.crossFile), prodBuckets(r.buckets).length];
    })(), [true, 0]);
  push('C8 对账（两下属实必须相等）：组内对子总数 = 新面孔 + 骨架尺已报过的；组合数另按 C(n,2) 独立数一遍',
    (() => {
      const r = base();
      const comb = r.buckets.reduce((s, b) => s + (b.list.length * (b.list.length - 1)) / 2, 0);
      return [r.pairTotal, r.novelPairs + r.overlapPairs, comb];
    })(), [base().pairTotal, base().novelPairs + base().overlapPairs, base().buckets.reduce((s, b) => s + (b.list.length * (b.list.length - 1)) / 2, 0)]);
  push('C9 整组都对子都被骨架尺报过 ⇒ 本尺没有新东西可说，必须跳过（不靠"组里混一对新的"蒙过去）',
    (() => {
      // one 与 three 同骨架只换名（骨架尺的地盘）；把 two 换掉，组里就只剩老面孔
      const map = { 'p/src/one.ts': A['p/src/one.ts'], 'p/src/three.ts': A['p/src/three.ts'] };
      const r = collectCallPaths(Object.keys(map), reader(map));
      return [r.buckets.length, r.overlapPairs];
    })(), [0, 0]);
  push('C10 注释里的调用不算（臂自己必须先遮蔽：本尺吃的是遮蔽后的文本）',
    callSignature(maskText(' /* x(y()) */ // c(d)\n  e(f());')), { sig: 'e:1,f:1', total: 2, names: 2 });

  const nums = arms.map((a) => Number(/^C(\d+)/.exec(a.name)?.[1] ?? 0));
  const seqOk = Math.max(...nums) === new Set(nums).size;
  arms.push({ name: `C${Math.max(...nums) + 1} 臂编号连续且不重号（判的是上面 ${arms.length} 枚）`, ok: seqOk, got: seqOk, want: true });
  return arms;
}

/* ---------------- 阳性对照（不依赖树上恰好有什么） ---------------- */

function mutate() {
  const biggest = (bs) => Math.max(0, ...bs.map((b) => b.list.length));
  const base = prodBuckets(collectCallPaths(FIXTURES, reader(A)).buckets);
  // ① 注入一枚"调用面逐字相同、控制流写成三元"的 ⇒ 本尺必须把它并进原组（组规模 +1）
  const inject = 'export function grabRow(box: any, id: string) {\n  box.set(id, box.load(id));\n  box.touch(id);\n  const hit = box.get(id);\n  box.touch(id);\n  return hit ? box.load(id) : undefined;\n}\n';
  const withInject = { ...A, 'p/src/inject.ts': inject };
  const r2 = collectCallPaths(Object.keys(withInject), reader(withInject));
  const after = prodBuckets(r2.buckets);
  const joined = after.some((b) => b.list.some((x) => x.file === 'p/src/inject.ts') && b.list.some((x) => x.file === 'p/src/one.ts'));
  // ② 把同一枚改成与 one.ts **同骨架只换名** ⇒ 这一格归骨架尺，本尺必须不报它
  const twin = A['p/src/one.ts'].replace(/ctx/g, 'box').replace(/readRow/g, 'grabRow').replace(/\bid\b/g, 'id2');
  const asTwin = { 'p/src/one.ts': A['p/src/one.ts'], 'p/src/inject.ts': twin };
  const r3 = collectCallPaths(Object.keys(asTwin), reader(asTwin));
  const twinReported = prodBuckets(r3.buckets).some((b) => b.list.some((x) => x.file === 'p/src/inject.ts'));
  console.log(`基线最大一组 ${biggest(base)} 枚（生产栏 ${base.length} 组）｜ 注入一枚只改控制流的 ⇒ 最大一组 ${biggest(after)} 枚（期望 +1）｜ 它与原函数落进同一组：${joined ? '是' : '否'}`);
  console.log(`对照：改成**同骨架只换名**后本尺还报它吗：${twinReported ? '报（🔴 越界，那格归骨架尺）' : '不报（对）'} ｜ 注入后本栏新面孔 ${r2.novelPairs} 对（期望 ≥ 1）、骨架尺已报过的 ${r2.overlapPairs} 对（只作信息）`);
  const ok = biggest(after) === biggest(base) + 1 && joined && !twinReported && r2.novelPairs >= 1;
  console.log(ok ? '✅ 变异臂：同一圈调用换个控制流写法仍被抓；换成同骨架后这格交回骨架尺（两把尺不重复计同一笔）。' : '🔴 变异臂不成立 ⇒ 本尺的"新信息"过滤没牙。');
  return ok ? 0 : 1;
}

function main() {
  if (argv.includes('--self-test')) {
    const arms = selfTest();
    const bad = arms.filter((a) => !a.ok);
    for (const a of arms) console.log(`${a.ok ? '✅' : '🔴'} ${a.name}${a.ok ? '' : ` ｜ 得到 ${JSON.stringify(a.got)} ｜ 期望 ${JSON.stringify(a.want)}`}`);
    console.log(`\n臂数 ${arms.length} ｜ 不符 ${bad.length}`);
    process.exit(bad.length === 0 ? 0 : 1);
  }
  if (argv.includes('--mutate')) process.exit(mutate());

  // 参数序是 `applyScope(files, prefix)`（第一发我把它反着传，`prefix.endsWith` 当场炸——
  // 这种"接错就红"比静默跑偏好，但仍是自己写错的账）。
  const files = applyScope(listTracked(), argv.includes('--scope') ? argv[argv.indexOf('--scope') + 1] : '');
  if (files.length === 0) { console.error('🔴 分母为空：产品面一枚 .ts/.tsx 都没枚举到 ⇒ 这不算"没有重复"。'); process.exit(2); }
  const r = collectCallPaths(files);
  const prod = prodBuckets(r.buckets);
  const testSide = r.buckets.filter((b) => b.testSide);
  if (prod.length === 0 && testSide.length === 0 && r.tooSmall === 0) {
    console.error('🔴 两桶都空而"太小不比"也是 0 ⇒ 抽取器八成没干活，这不算"没有重复"。'); process.exit(2);
  }
  const comb = r.buckets.reduce((s, b) => s + (b.list.length * (b.list.length - 1)) / 2, 0);
  console.log(`作用域 产品面（apps/packages/server/src/scripts/e2e，剔 research/ 原料） ｜ 文件 ${files.length} 枚 ｜ 声明级函数 ${r.fns.length} 枚（调用面太小不比 ${r.tooSmall} ｜ 签名组 ${r.groups}）`);
  console.log(`🔴 同一圈调用、控制流写得不一样 ${prod.length} 组（跨文件）｜ 🟡 测试面夹具另计 ${testSide.length} 组`);
  console.log(`   对子账：新面孔 ${r.novelPairs} ｜ 骨架尺已报过（只作信息，不算本尺候选）${r.overlapPairs} ｜ 合计 ${r.pairTotal}`);
  // 🔴 第二把尺（换一种写法数同一件事）：组内对子按组合数独立数一遍，必须等于两栏之和。
  if (comb !== r.pairTotal || r.pairTotal !== r.novelPairs + r.overlapPairs) {
    console.log(`🔴 对账不成立：C(n,2) 合计 ${comb} ≠ 组内对子 ${r.pairTotal} ≠ 新面孔+已报 ${r.novelPairs + r.overlapPairs} ⇒ 分桶漏计，本趟读数不可信。`);
    process.exit(2);
  }
  for (const b of prod.slice(0, TOP)) {
    console.log(`   ${b.list.length} 枚 ｜ 骨架 ${b.skeletons} 种 ｜ 新面孔 ${b.novelPairs} 对 ｜ 调用面 ${b.sig}`);
    console.log(`      ${b.list.map((x) => `${x.file}:${x.line}(${x.name},${x.calls}调)`).join(' + ')}`);
  }
  if (prod.length > TOP) console.log(`   …生产那栏另有 ${prod.length - TOP} 组（--top 500 全列）`);
  console.log('\n· 调用面相同 ≠ 语义相同：每组都要逐枚开码才成判词（臂 C1/C2/C8 钉的是"抓得到、且不重复计"）。');
  console.log(`候选 ${prod.length} 组（生产）＋ ${testSide.length} 组（测试面另计）｜诊断尺默认退 0，加 --strict 只被生产那栏触发`);
  process.exit(argv.includes('--strict') && prod.length > 0 ? 1 : 0);
}

if (IS_ENTRY) main();
