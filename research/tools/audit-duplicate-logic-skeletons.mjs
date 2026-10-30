#!/usr/bin/env node
/**
 * ① 那一维里"语义相同、写法不同"的那半——上一把尺明写做不到的那一格。
 * =================================================================
 *
 * ## 为什么要有它
 *
 * `audit-duplicate-function-bodies.mjs` 按**文本**对账：逐字相同 ⇒ 🔴，只差注释/文案 ⇒ 🟠。
 * 它的头里明写着一条射程：**把局部变量与形参改个名字的复制，它读不出来**。
 * 那一族恰是"同一守卫/同一读路径在多处各写一遍"最常见的形态（本仓证据：
 * `subscribe*` 家族、`infer*` 家族、`build*Invocation` 家族、`weekStartOf/mondayOf/startOfWeek`——
 * 文本尺能抓到它们是因为**连名字都没改**；改了名就漏）。
 * 本尺把比较从"文本"换成"**骨架**"：把函数体切成 token 类序列（标识符一律折成 `ID`、
 * 关键字/括号/运算符原样留着），于是换名、改空白、挪注释都不再影响比较，
 * 而控制流与调用形状仍然参与。
 *
 * ## 判什么
 *
 * 先按骨架聚类；骨架相同的一组里，若存在两枚**标识符序列不同**的函数 ⇒ 🔴 `renamed-copy`
 * （= 同一套逻辑被改了名字再抄一遍）。同时：
 *   · 骨架相同、标识符也相同 ⇒ **本尺不报**（那是文本尺的 🔴/🟠 地盘，两把尺各数各的才不会重复计同一笔）
 *   · 骨架 token 数 < `--min` ⇒ 落进"太小不比"，逐组给条数（默认 12 枚 token）
 *   · 骨架只在同一枚文件内重复 ⇒ 单列 `same-file` 一档（多半是内部小重复，与跨文件分开记账）
 * 跨 packages / apps / server 都算（目标点名要覆盖跨栈），分组键带**文件**不带壳。
 *
 * ## **不**判什么
 *
 * ① 骨架相同**不等于**语义相同：两枚都是"`ID(ID)` 一行返回"的骨架，可能一个读缓存一个读库。
 *    所以 🔴 是**候选**，必须逐枚开码——本尺的产出是"把该看一眼的成对摆出来"，不是判词。
 * ② 字面量不参与骨架：`maskText` 连引号一起挖（等长遮蔽），所以 `f("a")` 与 `f("b")` 骨架相同——
 *    这是**故意的**（文案不同正是改名复制的常见伴随物），代价是"只差文案"那一档两把尺都会看见，
 *    所以那一档本尺跳过（见上面第二条）。
 * ③ 声明级函数以外（内部回调、泛型声明）沿用抽取器的口径：**复用同一份抽取器**，
 *    不再自己写一遍 `function` 识别——那正是 ① 这一维要点名的形状。
 *
 * ## 用法与退出码
 *
 *   node research/tools/audit-duplicate-logic-skeletons.mjs             # 诊断，恒退 0
 *   node research/tools/audit-duplicate-logic-skeletons.mjs --strict    # 有 🔴 ⇒ 退 1
 *   node research/tools/audit-duplicate-logic-skeletons.mjs --self-test
 *   node research/tools/audit-duplicate-logic-skeletons.mjs --mutate    # 真数据上"改名"必须被抓
 *   node research/tools/audit-duplicate-logic-skeletons.mjs --min 20 --top 40
 *
 * 0 诊断 ｜ 1 `--strict` 且有 🔴 ｜ 2 分母为空（骨架数到 0 ⇒ 抽取瞎了，不许读成"没有改名复制"）。
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { extractFns, applyScope } from './audit-duplicate-function-bodies.mjs';

const git = (args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).trim();
const TESTISH = /(^|\/)(tests?|e2e|__tests__)\/|\.spec\.[tm]sx?$/;
const KW = new Set(['if', 'else', 'for', 'while', 'do', 'return', 'const', 'let', 'var', 'new', 'typeof',
  'instanceof', 'await', 'async', 'function', 'class', 'throw', 'try', 'catch', 'finally', 'switch', 'case',
  'default', 'of', 'in', 'yield', 'delete', 'void', 'null', 'true', 'false', 'this', 'super', 'export',
  'import', 'from', 'as', 'satisfies', 'keyof', 'extends', 'implements', 'interface', 'type', 'enum',
  'readonly', 'public', 'private', 'abstract', 'declare', 'override', 'get', 'set', 'static']);
const TOK_RE = /=>|\.{3}|===|!==|==|!=|<=|>=|&&|\|\||\?\?|\?\.|[A-Za-z_$][\w$]*|[{}()[\];,.:?+\-*/%!&|^~<>=]/g;

/** 函数体 → { skeleton, names, tokens }。标识符折成 `ID` 并收集名字序列；关键字与标点原样进骨架。 */
/** 函数体 → { skeleton, names, tokens }。标识符折成 `ID` 并收集名字序列；关键字与标点原样进骨架。
 *  🔴 关键字要**带上下文**才作数（两遍扫，先切 token 再分类）：
 *    · 点号后面那一段永远是成员名（`x.set(...)` 里的 `set`）；
 *    · 后面紧跟 `.` / `?.` 的那一段永远是**接收者**（`set.add((cb) => …)` 里的 `set` 是个变量名）。
 *    两条都是臂 S1 第一发抓出来的：少了第二条，`listeners.add(…)` 与 `set.add(…)` 骨架就对不上，
 *    改名复制整族读成 0 组——**假绿**，比假红更难发现。 */
const WORD = /^[A-Za-z_$]/;
export function skeletonOf(maskedBody) {
  const raw = [];
  TOK_RE.lastIndex = 0;
  let m;
  while ((m = TOK_RE.exec(maskedBody)) !== null) raw.push(m[0]);
  const sk = [];
  const names = [];
  for (let i = 0; i < raw.length; i += 1) {
    const t = raw[i];
    const prev = sk.length ? raw[i - 1] : '';
    const next = i + 1 < raw.length ? raw[i + 1] : '';
    if (!WORD.test(t)) { sk.push(t); continue; }
    const member = prev === '.' || prev === '?.' || next === '.' || next === '?.';
    if (KW.has(t) && !member) sk.push(t);
    else { sk.push('ID'); names.push(t); }
  }
  return { skeleton: sk.join(' '), names, tokens: sk.length };
}

export function collect(files, read = (f) => readFileSync(f, 'utf8'), min = 12) {
  const fns = [];
  let skipped = { exprBody: 0, unbalanced: 0 };
  for (const f of files) {
    let t = '';
    try { t = read(f); } catch { continue; }
    const r = extractFns(f, t);
    skipped.exprBody += r.skipped.exprBody;
    skipped.unbalanced += r.skipped.unbalanced;
    for (const row of r.rows) {
      const s = skeletonOf(row.masked);
      fns.push({ ...row, ...s, norm: row.masked.replace(/\s+/g, ' ').trim() });
    }
  }
  const groups = new Map();
  let tooSmall = 0;
  for (const fn of fns) {
    if (fn.tokens < min) { tooSmall += 1; continue; }
    if (!groups.has(fn.skeleton)) groups.set(fn.skeleton, []);
    groups.get(fn.skeleton).push(fn);
  }
  const buckets = [];
  for (const [skeleton, list] of groups) {
    if (list.length < 2) continue;
    const distinctNorm = new Set(list.map((x) => x.norm));
    const distinctNames = new Set(list.map((x) => x.names.join(',')));
    // 🔴 只有"骨架同、标识符不同"才是本尺的新信息；标识符也相同的那一组已经归文本尺。
    if (distinctNames.size < 2) continue;
    const crossFile = new Set(list.map((x) => x.file)).size > 1;
    // 🔴 测试面那批（`flush`、`makeId`、`watchErrors` 这些夹具）是真重复，但**账不该记在生产代码那一栏**：
    //    它们的归属是各条线自己的用例，混在一张表里就会把该拍板的那几组淹掉（159 组里大多数是测试夹具）。
    const testSide = list.every((x) => TESTISH.test(x.file));
    buckets.push({
      skeleton, list, crossFile, testSide, distinctNorm: distinctNorm.size,
      renamed: list.filter((x) => x.names.join(',') !== list[0].names.join(',')),
    });
  }
  buckets.sort((a, b) => (a.testSide - b.testSide) || (b.crossFile - a.crossFile) || (b.list.length - a.list.length) || a.skeleton.localeCompare(b.skeleton));
  return { buckets, fns, groups: groups.size, tooSmall, skipped };
}

const PRODUCT_SCOPES = ['apps/', 'packages/', 'server/src/', 'scripts/', 'e2e/'];
function listTracked() {
  // 🔴 分母按产品面收：`research/` 是调研原料目录（AGENTS §2 明写它不属于产品文档），
  //    里面躺着一整棵 `standalone/sync-core` 的上游克隆——不剔它，读数会把 vendored 副本算成"仓库里的重复实现"。
  return git(['ls-files', '--', '*.ts', '*.tsx']).split('\n')
    .filter((l) => l.trim() !== '' && !l.endsWith('.d.ts') && PRODUCT_SCOPES.some((p) => l.startsWith(p)));
}
const safeRead = (f, read) => { try { return read(f); } catch { return ''; } };

/** 变异：从**真树**里取一枚生产函数，只把它的标识符加后缀（骨架一字不动），
 *  当作一枚新文件塞进分母 ⇒ 它必须落进同一骨架组、并让"改名复制"那一栏 +1。
 *  这一步证的是本尺存在的理由：文本尺在这一发上读 0（体已经不同），骨架尺必须读 1。
 *  全程只在内存（不落盘、不碰工作树）。 */
function mutate(files, read, min) {
  const base = collect(files, read, min);
  const n0 = prodBuckets(base.buckets).length;
  // 必须挑"已经有一枚逐字同体的双胞胎"那一对里的其中一枚：给它的复制改了名，
  // 那一组才会从"标识符也相同"（本尺不报）翻成"标识符不同"（本尺报）。
  // 🔴 第一发这里挑的是**最大**的那枚函数（apiRoutes，四万来 token）——它独一无二，
  //    改一万次名也不会多出一组，于是变异臂读"变化 0"。臂本身错，不是判据错。
  const byNorm = new Map();
  for (const f of base.fns) {
    if (TESTISH.test(f.file) || f.tokens < Math.max(min, 8) || f.tokens > 120 || f.names.length < 4) continue;
    if (!byNorm.has(f.norm)) byNorm.set(f.norm, []);
    byNorm.get(f.norm).push(f);
  }
  const pair = [...byNorm.values()].find((l) => l.length >= 2 && new Set(l.map((x) => x.file)).size > 1);
  const target = pair ? pair[0] : null;
  if (!target) { console.log('🔴 分母里没有"生产代码里跨文件逐字同体"那一对 ⇒ 变异臂打空，不判绿（这读数不可信）。'); return 1; }
  let body = target.masked;
  for (const nm of [...new Set(target.names)].sort((a, b) => b.length - a.length)) {
    body = body.replace(new RegExp(`\\b${nm}\\b`, 'g'), `${nm}Renamed`);
  }
  if (body === target.masked) { console.log(`🔴 ${target.file}:${target.line} 改名没动到任何标识符 ⇒ 变异臂打空，不判绿。`); return 1; }
  const V = 'mutate://renamed-copy.ts';
  const src = `export function mutatedCopy(): void {\n${body}\n}\n`;
  const withTarget = collect([...files, V], (f) => (f === V ? src : safeRead(f, read)), min);
  const d = prodBuckets(withTarget.buckets).length - n0;
  const skeletonMatched = withTarget.buckets.some((b) => b.list.some((x) => x.file === V) && b.list.some((x) => x.file === target.file && x.line === target.line));
  console.log(`基线「生产改名复制」${n0} 组 ｜ 取 ${target.file}:${target.line}(${target.name}, ${target.tokens}t) 只改标识符名 ⇒ 组数变化 ${d}（期望 ≥ +1）｜ 它与原函数落进同一骨架组：${skeletonMatched ? '是' : '否'}`);
  const sameText = collect(files, read, 1).fns.filter((f) => f.norm === target.norm).length;
  console.log(`· 对照：文本尺眼里这一枚本来与 ${sameText - 1} 枚逐字同体（那一档归文本尺）；改完名之后**没有任何**新的逐字同体 ⇒ 只有按骨架比才追得回来（这正是文本尺读不到的那一族）`);
  if (d < 1 || !skeletonMatched) { console.log('🔴 改了名就抓不到 ⇒ 本尺没测到它声称测的东西。'); return 1; }
  console.log('✅ 变异臂：只改标识符名的复制仍被抓，且与原函数同骨架。');
  return 0;
}

/** 只有生产代码那一栏参与 `--strict`（测试面夹具另计，见 collect 里那条注释）。 */
export function prodBuckets(buckets) {
  return buckets.filter((b) => !b.testSide);
}

function selfTest() {
  const bad = [];
  const labels = [];
  const push = (label, got, want) => {
    labels.push(label);
    const ok = JSON.stringify(got) === JSON.stringify(want);
    if (!ok) bad.push(`${label} ｜ 期望 ${JSON.stringify(want)} ｜ 实读 ${JSON.stringify(got)}`);
    console.log(`${ok ? '✅' : '🔴'} ${label}`);
  };
  const A = 'apps/web/src/a.ts';
  const B = 'packages/domain/src/b.ts';
  const run = (pairs, min = 6) => {
    const files = [];
    const store = new Map();
    for (const [f, src] of pairs) { if (!store.has(f)) { store.set(f, ''); files.push(f); } store.set(f, store.get(f) + '\n' + src); }
    const r = collect(files, (f) => store.get(f), min);
    return { n: r.buckets.length, cross: r.buckets.filter((x) => x.crossFile).length, fns: r.fns.length, tooSmall: r.tooSmall };
  };
  const SUB = (name, arg, store) => `export function ${name}(${arg}: any) {\n  let n = 0;\n  const list = [] as any[];\n  ${store}.add((${arg}: any) => { list.push(${arg}); if (++n > 1) { ${arg} = 0; } });\n  return () => list;\n}\n`;

  push('S1 同骨架、形参与局部名都换了 ⇒ 1 组 🔴（这就是文本尺读不到的那一族）',
    run([[A, SUB('subscribeAi', 'fn', 'listeners')], [B, SUB('subscribeRules', 'cb', 'set')]]).n, 1);
  push('S2 标识符也一样（逐字同体）⇒ 本尺**不报**，让文本尺那把去数（两把尺不重复计同一笔）',
    run([[A, SUB('one', 'fn', 'listeners')], [B, SUB('two', 'fn', 'listeners')]]).n, 0);
  push('S3 骨架不同（少一层括号与一句 return）⇒ 不许靠"长度相近"算重叠',
    run([[A, 'export function one(x: any) {\n  let n = 0;\n  const list = [] as any[];\n  list.push(x); if (++n > 1) { x = 0; }\n  return () => list;\n}\n'],
      [B, 'export function two(x: any) {\n  const arr: any[] = [];\n  arr.push(x);\n  return arr;\n}\n']]).n, 0);
  push('S4 骨架相同但 token 数不足门槛 ⇒ 落"太小不比"，不进候选',
    run([[A, 'export function one(x: any) {\n  return x + 1;\n}\n'], [B, 'export function two(y: any) {\n  return y + 1;\n}\n']], 20).n, 0);
  push('S5 跨文件那组要标 crossFile（分组键带文件不带壳，server 与 packages 同框算）',
    run([[A, SUB('a1', 'fn', 'listeners')], [B, SUB('b2', 'cb', 'set')]]).cross, 1);
  push('S6 注释与空白不参与骨架（遮蔽在结构判断上必须参与）',
    run([[A, `export function one(fn: any) {\n  let n = 0;\n  const list = [] as any[];\n  // 说明文字\n  listeners.add((fn: any) => { list.push(fn); if (++n > 1) { fn = 0; } });\n  return () => list;\n}\n`],
      [B, SUB('two', 'cb', 'set')]]).n, 1);
  push('S7 一枚都没有 ⇒ 聚合给全 0（主读数据此退 2）',
    run([[A, 'export const x = 1;\n']], 1), { n: 0, cross: 0, fns: 0, tooSmall: 0 });
  push('S8 对账成立：参与分组的 + 太小不比的 = 解析出的函数',
    (() => { const files = [A, B]; const store = new Map([[A, SUB('one', 'fn', 'listeners')], [B, SUB('two', 'cb', 'set')]]);
      const r = collect(files, (f) => store.get(f), 6);
      return r.groups >= 1 && r.tooSmall + r.fns.filter((x) => x.tokens >= 6).length === r.fns.length; })(), true);
  push('S9 `--scope` 只吃目录前缀（与文本尺共用同一枚 applyScope，不另写一份）',
    applyScope(['server/src/password/a.ts', 'server/src/passwordish/b.ts'], 'server/src/password').length, 1);
  push('S10 骨架对**关键字敏感**：if 换成三元就不算同一骨架（不是只看括号数量）',
    run([[A, 'export function one(x: any) {\n  let n = 0;\n  const list = [] as any[];\n  list.push(x); if (x) { n = 1; }\n  return () => list;\n}\n'],
      [B, 'export function two(y: any) {\n  let m = 0;\n  const arr = [] as any[];\n  arr.push(y); const z = y ? 1 : 0; return () => arr;\n}\n']], 6).n, 0);
  const nums = labels.map((l) => Number(/^S(\d+)/.exec(l)?.[1] ?? 0));
  const uniq = new Set(nums);
  const seqOk = Math.max(...nums) === uniq.size;
  console.log(`${seqOk ? '✅' : '🔴'} S${Math.max(...nums) + 1} 臂编号连续且不重号（判的是上面 ${labels.length} 枚：最大号 ${Math.max(...nums)} ｜ 去重号数 ${uniq.size}）`);
  if (!seqOk) bad.push(`编号臂跳号或重号 ｜ 最大 ${Math.max(...nums)} ｜ 去重 ${uniq.size}`);
  console.log(`\n臂数 ${labels.length + 1} ｜ 不符 ${bad.length}`);
  for (const b of bad) console.log(`🔴 ${b}`);
  return bad.length === 0 ? 0 : 1;
}

function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--self-test')) process.exit(selfTest());
  const strict = argv.includes('--strict');
  const si = argv.indexOf('--scope');
  const scope = si >= 0 ? argv[si + 1] ?? '' : '';
  const mi = argv.indexOf('--min');
  const min = mi >= 0 ? Number(argv[mi + 1] ?? 12) : 12;
  const ti = argv.indexOf('--top');
  const top = ti >= 0 ? Number(argv[ti + 1] ?? 25) : 25;
  const files = applyScope(listTracked(), scope);
  if (files.length === 0) { console.log(`🔴 分母为空（作用域"${scope || '产品面五片'}"里一枚 .ts/.tsx 都没数到）⇒ 尺瞎。`); process.exit(2); }
  const read = (f) => readFileSync(f, 'utf8');
  const r = collect(files, read, min);
  if (r.fns.length === 0) { console.log(`🔴 扫了 ${files.length} 枚，一枚声明级函数都没解析出来 ⇒ 抽取瞎了。`); process.exit(2); }
  console.log(`作用域 ${scope || '产品面（apps/packages/server/src/scripts/e2e，剔 research/ 原料）'} ｜ 文件 ${files.length} 枚 ｜ 声明级函数 ${r.fns.length} 枚（太小不比 ${r.tooSmall} ｜ 骨架组 ${r.groups}）｜ 跳过 表达式体 ${r.skipped.exprBody} · 配不上 ${r.skipped.unbalanced}`);
  const prod = r.buckets.filter((b) => !b.testSide);
  const test = r.buckets.filter((b) => b.testSide);
  console.log(`🔴 生产代码里的改名复制 ${prod.length} 组（跨文件 ${prod.filter((b) => b.crossFile).length} ｜ 同文件 ${prod.filter((b) => !b.crossFile).length}）｜ 🟡 测试面夹具另计 ${test.length} 组`);
  for (const b of prod.slice(0, top)) {
    console.log(`   ${b.crossFile ? '跨文件' : '同文件'} ${b.list.length} 枚 ｜ ${b.list.map((x) => `${x.file}:${x.line}(${x.name},${x.tokens}t)`).join(' + ')}`);
  }
  if (prod.length > top) console.log(`   …生产那栏另有 ${prod.length - top} 组（--top 500 全列）`);

  console.log('\n· 骨架相同 ≠ 语义相同：上面每组的"改名"都要逐枚开码才成判词（臂 S3/S10 钉住"骨架真的敏感"）。');
  console.log(`\n候选 ${prod.length} 组（生产）＋ ${test.length} 组（测试面另计）${strict ? '' : '｜诊断尺默认退 0，加 --strict 只被生产那栏触发'}`);
  if (argv.includes('--mutate')) process.exit(mutate(files, read, min));
  process.exit(strict && r.buckets.some((b) => !b.testSide) ? 1 : 0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
