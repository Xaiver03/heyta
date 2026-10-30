#!/usr/bin/env node
/**
 * 「可避免的全量重渲染」——③ 那一维最后一格没装置的，本尺补它。
 * =================================================================
 *
 * ## 为什么要有它
 *
 * 目标点名的性能五格里，N+1、循环内同步 IO、无界监听器/定时器、缺分页/缺索引读路径
 * 本线都已各有尺（见 `audit-loop-io` / `audit-listener-timer-cleanup` /
 * `audit-server-read-index-coverage` / `audit-unbounded-read-paths`），
 * 唯独**"可避免的全量重渲染"只有散文**。这一族的麻烦在于：静态文本判不了"这次重渲染代价值不值"
 * （那要运行时读数），但**有两种形状是纯静态可判的**，而且它们正是让人整面重渲染的常见成因。
 * 所以正确拆法还是那条：能判的那半判掉，判不了的那半逐枚登记成射程。
 *
 * ## 判什么（两族，各有自己的分母）
 *
 * **A 族 · 下标当 key（列表重排会重挂载，输入框内容会跳到别的行）**
 *   判据是**绑定关系**而不是变量名：`key={X}` 里的 `X` 必须是**同一枚 `.map(` 回调的第二个形参**
 *   （`(item, index) => …` 的那个 `index`）。名字猜不得——本仓有人用 `key={i}` 也有人说 `key={row}`，
 *   按名字清单去扫会把稳定的写法读成缺陷。
 *   两档：
 *     🔴 `index-key`      回调第二形参被当 key，且被映射的那个数组**不是**文件顶层的字面量表
 *     🟠 `static-index`   同样按下标发 key，但源是顶层字面量数组（`const STEPS = [ … ]`）⇒ 顺序恒定，合法，只看
 *   `.map` 回调体是**表达式体**（`(x, i) => <li key={i} />`，没有花括号）也吃得到：
 *   取 `.map(` 那对**圆括号**的完整区间当回调范围，不依赖花括号（臂 K3 钉这条）。
 *
 * **B 族 · 内联字面量 props 打穿 `memo`（父组件每次渲染都把子组件拽回来）**
 *   先在全分母里收"被 `memo(...)` 包起来并具名导出的组件"，再找它们的 JSX 用法里
 *   写成 `prop={{…}}` / `prop={[…]}` 的那几枚——引用每渲染必变 ⇒ 那枚 `memo` 是白包的。
 *   档位 🟠 `memo-literal`：**这一族一律不判红**，因为代价随列表尺寸走，值不值归改的人判。
 *   ⚠️ 跨文件：`memo` 组件常在另一个文件里被用，所以 B 族必须两趟（先收名字，再找用法）。
 *
 * ## **不**判什么（三条射程，读 0 不等于"没有"）
 *
 * ① 该不该 `useMemo`、state 放在树顶会不会整面重渲染、高频事件触发的重渲染 ⇒ 全是**运行时**问题，
 *    静态文本判不了 ⇒ 本尺**没有**覆盖，也不许用"零候选"冒充"性能没问题"。
 * ② 内联**函数** props（`onPress={() => …}`）打在 `memo` 子件上：本仓几十处，绝大多数是无意的写法常态，
 *    进了分母就是噪声 ⇒ 不判，只数条数（打印出来给人看规模）。
 * ③ 匿名/未具名导出的 `memo`、`React.memo` 赋给变量后再转发、`forwardRef(memo(...))` 套两层 ⇒ 收不到名字，
 *    那一档 B 族看不见（尺自己打印"收到几枚 memo 名"，收 0 就明说这一族没有分母）。
 *
 * ## 用法与退出码
 *
 *   node research/tools/audit-avoidable-rerenders.mjs              # 诊断，恒退 0
 *   node research/tools/audit-avoidable-rerenders.mjs --strict     # 有 🔴 ⇒ 退 1
 *   node research/tools/audit-avoidable-rerenders.mjs --self-test  # 臂数由它自己打印
 *   node research/tools/audit-avoidable-rerenders.mjs --mutate     # 内存注入再摘掉，不碰工作树
 *   node research/tools/audit-avoidable-rerenders.mjs --scope packages/ui/src
 *
 * 0 诊断 ｜ 1 `--strict` 且有 🔴 ｜ 2 分母为空 / **两把尺对不上账**（抽取瞎了，读数不可信）。
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { maskText, balanced, lineOf } from './lib/text-mask.mjs';

const DEFAULT_SCOPES = ['apps/web/src/', 'apps/mobile/src/', 'apps/desktop/src/', 'packages/ui/src/', 'packages/app-host/src/'];
const MAX_LIST = 25;
const git = (args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).trim();

/** A 族：`key={X}` 与 `.map(` 的回调签名。都在**遮蔽后**的文本上找（注释与字符串里的不算代码）。 */
const KEY_RE = /\bkey=\{\s*([A-Za-z_$][\w$]*)\s*\}/g;
const MAP_RE = /\.map\s*\(/g;
/** B 族：具名导出的 `memo` 组件；以及用法里的内联对象/数组字面量 prop。 */
const MEMO_RE = /\bconst\s+([A-Z][\w$]*)\s*=\s*(?:React\.)?memo\s*\(/g;
const INLINE_PROP_RE = /\b([A-Za-z_$][\w$]*)=\{\s*[{[]/g;
const ARROW_INLINE_FUNC_RE = /=\{\s*(?:async\s*)?\(?[^}]{0,80}\)?\s*=>/g;

/** 一枚 `.map(` 的回调范围与形参名。取**圆括号**整段，所以表达式体（没有 `{`）也吃得到。 */
export function mapCallback(masked, openIdx) {
  const bal = balanced(masked, openIdx);
  if (!bal) return null;
  const inner = bal.inner;
  // 三种回调写法都要认：`(a, b) =>`、`a =>`、`function (a, b) {`。认不出的那种记成"另一种形式"，
  // 不许把它当成"这一枚 .map 里没有 key"（上一版就是这么把 13 枚 key 弄丢在对账之外的）。
  const head = /^\s*(?:async\s*)?\(([^)]*)\)\s*=>|^\s*([A-Za-z_$][\w$]*)\s*=>|^\s*(?:async\s+)?function\s*\*?\s*\(([^)]*)\)/.exec(inner);
  if (!head) return { from: openIdx, to: bal.end, second: null, other: true };
  const params = (head[1] ?? head[2] ?? head[3] ?? '').split(',').map((p) => p.trim().replace(/\s*=\s*.*$/, ''));
  if (params.length < 2) return { from: openIdx, to: bal.end, second: null, stableOnly: true };
  return { from: openIdx, to: bal.end, second: params[params.length - 1] };
  // 🔴 取**最后一个**形参而不是固定第二个：`(…, index, extra)` 这种带第三参的写法本仓有，
  //    按 `[1]` 取会抓到中间那个名字，key 就永远对不上（臂 K6 判这一条）。
}

/** 被映射的那个数组叫什么：`.map(` 往上最近的标识符；带下标取表的写法（`PATHS[kind].map(…`）
 *  取的是**表名** `PATHS`——判"顺序恒不恒定"要看的是那张表是不是顶层字面量，不是那个键。 */
export function mappedSource(masked, openIdx) {
  const before = masked.slice(0, openIdx).replace(/\s+$/, '');
  const indexed = /([A-Za-z_$][\w$]*)\s*(?:\[|\.)[^\]]{0,40}\]\s*\.map\s*$/.exec(before) ?? /([A-Za-z_$][\w$]*)\s*\.map\s*$/.exec(before);
  return indexed ? indexed[1] : '';
}

// 顶层字面量表认**两种** initializer：`[` 与 `{`（本仓的图标路径表是 `{ kind: […] }` 这种"表套表"，
//   只认 `[` 会把顺序恒定的写法读成 🔴 —— K13 那一发第一次就是这么红的）。
const TOPLEVEL_LITERAL_RE = (id) => new RegExp(`^(?:export\\s+)?const\\s+${id}\\s*(?::[^=]*)?=\\s*[\\[{]`, 'm');

export function scanText(file, text, memoNames = new Set()) {
  const masked = maskText(text);
  const rows = [];
  let maps = 0;
  let mapUnbalanced = 0;
  let keyTotal = 0;
  let keysOutsideMap = 0;
  let keysInMapStable = 0;
  let mapOtherForm = 0;
  let mapNoIndex = 0;
  const callbacks = [];
  MAP_RE.lastIndex = 0;
  let mm;
  while ((mm = MAP_RE.exec(masked)) !== null) {
    maps += 1;
    const cb = mapCallback(masked, mm.index + mm[0].length - 1);
    if (!cb) { mapUnbalanced += 1; continue; }
    if (cb.other) { mapOtherForm += 1; continue; }
    if (cb.stableOnly) { mapNoIndex += 1; }
    // 🔴 传**开括号**那个下标（`(` 的位置），不是 `.map` 那个点：`mappedSource` 找的是
    //    `…STEPS.map` 结尾，切在点上会一律读回空名 ⇒ 顶层字面量表那档永远判不出来（K4 第一发就是这么红的）。
    cb.source = mappedSource(masked, mm.index + mm[0].length - 1);
    callbacks.push(cb);
  }
  KEY_RE.lastIndex = 0;
  let kk;
  while ((kk = KEY_RE.exec(masked)) !== null) {
    keyTotal += 1;
    const at = kk.index;
    const owner = callbacks.filter((c) => c.from <= at && at <= c.to).sort((a, b) => b.from - a.from)[0];
    if (!owner) { keysOutsideMap += 1; continue; }
    if (owner.second !== kk[1]) { keysInMapStable += 1; continue; }
    const staticTable = TOPLEVEL_LITERAL_RE(owner.source).test(masked);
    rows.push({
      file, line: lineOf(masked, at), kind: staticTable ? 'static-index' : 'index-key',
      var: kk[1], source: owner.source, detail: `key={${kk[1]}} ← ${owner.source}.map(_, ${owner.second})`,
    });
  }
  const inlineFns = (masked.match(ARROW_INLINE_FUNC_RE) ?? []).length;
  const memoLiterals = [];
  if (memoNames.size > 0) {
    for (const name of memoNames) {
      const useRe = new RegExp(`<${name}\\b`, 'g');
      let u;
      while ((u = useRe.exec(masked)) !== null) {
        // 这枚元素的属性区：从标签名之后走到第一个顶层 `>`（内联字面量都在 `{…}` 里，balanced 整块跳过）
        let i = u.index + u[0].length;
        let depth = 0;
        let end = masked.length;
        for (; i < masked.length; i += 1) {
          const c = masked[i];
          if (c === '{' || c === '(' || c === '[') depth += 1;
          else if (c === '}' || c === ')' || c === ']') depth -= 1;
          else if (c === '>' && depth <= 0) { end = i; break; }
          else if (c === '<' && depth === 0) { end = i; break; }
        }
        INLINE_PROP_RE.lastIndex = 0;
        const span = masked.slice(u.index + u[0].length, end);
        let p;
        while ((p = INLINE_PROP_RE.exec(span)) !== null) {
          memoLiterals.push({
            file, line: lineOf(masked, u.index + u[0].length + p.index), kind: 'memo-literal',
            var: name, source: p[1], detail: `<${name} ${p[1]}={{…}}>`,
          });
        }
      }
    }
  }
  return { rows, memoLiterals, maps, mapUnbalanced, mapOtherForm, mapNoIndex, keyTotal, keysOutsideMap, keysInMapStable, inlineFns };
}

/** B 族要两趟：先把全分母的 `memo` 名字收齐（跨文件用法才认得出），再逐枚文件找用法。 */
export function memoNames(files, read) {
  const names = new Set();
  for (const f of files) {
    let t = '';
    try { t = read(f); } catch { continue; }
    const masked = maskText(t);
    MEMO_RE.lastIndex = 0;
    let m;
    while ((m = MEMO_RE.exec(masked)) !== null) names.add(m[1]);
  }
  return names;
}

export function scanFiles(files, read = (f) => readFileSync(f, 'utf8'), names = null) {
  const memo = names ?? memoNames(files, read);
  const rows = [];
  const memoLiterals = [];
  let maps = 0;
  let mapUnbalanced = 0;
  let keyTotal = 0;
  let keysOutsideMap = 0;
  let keysInMapStable = 0;
  let mapOtherForm = 0;
  let mapNoIndex = 0;
  let inlineFns = 0;
  for (const f of files) {
    let t = '';
    try { t = read(f); } catch { continue; }
    const r = scanText(f, t, memo);
    rows.push(...r.rows);
    memoLiterals.push(...r.memoLiterals);
    maps += r.maps;
    mapUnbalanced += r.mapUnbalanced;
    mapOtherForm += r.mapOtherForm;
    mapNoIndex += r.mapNoIndex;
    keyTotal += r.keyTotal;
    keysOutsideMap += r.keysOutsideMap;
    keysInMapStable += r.keysInMapStable;
    inlineFns += r.inlineFns;
  }
  return { rows, memoLiterals, maps, mapUnbalanced, mapOtherForm, mapNoIndex, keyTotal, keysOutsideMap, keysInMapStable, inlineFns, memo: memo.size };
}

export function candidates(rows) {
  return rows.filter((r) => r.kind === 'index-key').sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
}
export function applyScope(files, scope) {
  if (!scope) return files.filter((f) => DEFAULT_SCOPES.some((s) => f.startsWith(s)));
  const s = scope.endsWith('/') ? scope : `${scope}/`;
  return files.filter((f) => f.startsWith(s));
}
const listTracked = () => git(['ls-files', '--', '*.tsx', '*.jsx']).split('\n').filter((l) => l.trim() !== '');
const safeRead = (f, read) => { try { return read(f); } catch { return ''; } };
function lineStartOf(text, line) {
  const lines = text.split('\n');
  return lines.slice(0, Math.max(0, line - 1)).reduce((a, l) => a + l.length + 1, 0);
}

/** 变异：两发都**不依赖树上恰好有什么**，且只动被点名的那一处（全程只在内存，不落盘）。
 *  M1 注入一枚"对 props 列表按下标发 key"的写法 ⇒ 🔴 必须 +1（证明本尺认得这个形状）；
 *  M2 把一枚真存在的 🟠（顶层字面量表按下标）那张贴表**改名**，让它不再是顶层字面量 ⇒
 *      🔴 +1 且 🟠 -1（证明静态/动态那一档不是装饰，它是被贴表声明驱动的）。 */
function mutate(files, read) {
  const names = memoNames(files, read);
  const base = scanFiles(files, read, names);
  const n0 = candidates(base.rows).length;
  const s0 = base.rows.filter((r) => r.kind === 'static-index').length;
  const stat = base.rows.find((r) => r.kind === 'static-index');
  const any = base.rows.length ? base.rows[0] : null;
  if (!any || !stat) { console.log('🔴 分母里没有"顶层字面量表按下标"那一档 ⇒ 变异臂打空，不判绿（读数不可信）。'); return 1; }
  // M1
  const f1 = any.file;
  const t1 = safeRead(f1, read);
  const at1 = lineStartOf(t1, any.line);
  const inj = `${t1.slice(0, at1)}      {propsThings.map((row, rowIndex) => <li key={rowIndex} />)}\n${t1.slice(at1)}`;
  const m1 = candidates(scanFiles(files, (f) => (f === f1 ? inj : safeRead(f, read)), names).rows).length - n0;
  // M2
  const t2 = safeRead(stat.file, read);
  const re2 = new RegExp(`^(?:export\\s+)?const\\s+${stat.source}\\b`, 'm');
  if (!re2.test(t2)) { console.log(`🔴 摘臂：${stat.file} 里找不到顶层贴表声明 \`const ${stat.source}\` ⇒ 变异臂打空，不判绿。`); return 1; }
  const renamed = t2.replace(re2, `const ${stat.source}RenamedByMutationRig`);
  const after2 = scanFiles(files, (f) => (f === stat.file ? renamed : safeRead(f, read)), names);
  const m2c = candidates(after2.rows).length - n0;
  const m2s = after2.rows.filter((r) => r.kind === 'static-index').length - s0;
  console.log(`基线 🔴 ${n0} 枚 ｜ 🟠 ${s0} 枚`);
  console.log(`M1 在 ${f1}:${any.line} 上方注入一枚 props 列表的下标 key ⇒ 🔴 变化 ${m1}（期望 +1）`);
  console.log(`M2 把 ${stat.file} 的顶层贴表 \`const ${stat.source}\` 改名 ⇒ 🔴 变化 ${m2c}（期望 +1）｜ 🟠 变化 ${m2s}（期望 -1）`);
  if (m1 !== 1) { console.log('🔴 注入一枚按下标的 key 后 🔴 没动 ⇒ 本尺对这个形状不敏感，拿它当门是假绿。'); return 1; }
  if (m2c !== 1 || m2s !== -1) { console.log('🔴 改了贴表声明却没让那一枚从 🟠 翻到 🔴 ⇒ 静态/动态那一档是装饰。'); return 1; }
  console.log('✅ 变异臂：两发都动，且只动被点名的那一处。');
  return 0;
}

const memoOf = (files, read) => memoNames(files, read);

function selfTest() {
  const bad = [];
  const labels = [];
  const push = (label, got, want) => {
    labels.push(label);
    const ok = JSON.stringify(got) === JSON.stringify(want);
    if (!ok) bad.push(`${label} ｜ 期望 ${JSON.stringify(want)} ｜ 实读 ${JSON.stringify(got)}`);
    console.log(`${ok ? '✅' : '🔴'} ${label}`);
  };
  const A = 'packages/ui/src/Foo.tsx';
  const run = (pairs, names = new Set()) => {
    const rows = [];
    let keyTotal = 0;
    let keysOutsideMap = 0;
    let memoLiterals = [];
    for (const [f, t] of pairs) {
      const r = scanText(f, t, names);
      rows.push(...r.rows);
      keyTotal += r.keyTotal;
      keysOutsideMap += r.keysOutsideMap;
      memoLiterals = memoLiterals.concat(r.memoLiterals);
    }
    return { kinds: rows.map((x) => x.kind).sort(), cand: rows.filter((x) => x.kind === 'index-key').length, keyTotal, keysOutsideMap, memoLiterals };
  };
  const DYN = 'export function L({ items }) {\n  return <ul>{items.map((row, index) => <li key={index}>{row}</li>)}</ul>;\n}\n';
  const STABLE = 'export function L({ items }) {\n  return <ul>{items.map((row) => <li key={row.id}>{row}</li>)}</ul>;\n}\n';
  const TABLE = 'const STEPS = [1, 2, 3];\nexport function L() {\n  return <ol>{STEPS.map((s, i) => <li key={i}>{s}</li>)}</ol>;\n}\n';

  push('K1 下标当 key（源是会变的 props 列表）⇒ 1 枚 🔴', run([[A, DYN]]).cand, 1);
  push('K2 成员当 key ⇒ 0（阳性对照：K1 的红来自"下标"不是"来自 props"）', run([[A, STABLE]]).cand, 0);
  push('K3 回调是**表达式体**（没有花括号）也要吃得到', run([[A, 'export function L({ items }) {\n  return items.map((r, i) => <li key={i} />);\n}\n']]).cand, 1);
  push('K4 顶层字面量表按下标发 key ⇒ 落 🟠 不落 🔴（顺序恒定是合法用法）', (() => { const r = run([[A, TABLE]]); return [r.cand, r.kinds]; })(), [0, ['static-index']]);
  push('K5 内联对象字面量打在具名 memo 组件上 ⇒ B 族数到（🟠，不判红）',
    (() => { const r = run([['packages/ui/src/Bar.tsx', 'export const Bar = memo(function Bar(p) { return <div />; });\n'], [A, 'export function L() {\n  return <Bar style={{ color: "red" }} />;\n}\n']], new Set(['Bar'])); return r.memoLiterals.length; })(), 1);
  push('K6 三参回调取**最后一个**形参当名字（按 [1] 取会永远对不上 key）',
    run([[A, 'export function L({ items }) {\n  return items.map((row, _col, index) => <li key={index} />);\n}\n']]).cand, 1);
  push('K7 memo 组件但 prop 是变量（不是内联字面量）⇒ B 族 0',
    (() => { const r = run([['packages/ui/src/Bar.tsx', 'export const Bar = memo(function Bar(p) { return <div />; });\n'], [A, 'export function L({ box }) {\n  return <Bar style={box} />;\n}\n']], new Set(['Bar'])); return r.memoLiterals.length; })(), 0);
  push('K8 注释里那枚 key 不算（结构判断必须吃遮蔽后的文本）',
    run([[A, 'export function L({ items }) {\n  return <ul>{/* items.map((r, i) => <li key={i} />) */}{items.map((r, idx) => <li key={idx} />)}</ul>;\n}\n']]).cand, 1);
  push('K9 对账成立：key= 总数 = 落在 map 回调里的 + map 之外的',
    (() => { const r = run([[A, `${DYN}\nexport function M() {\n  return <li key={fixedKey} />;\n}\n`]]); return [r.keyTotal, r.cand + r.keysOutsideMap]; })(), [2, 2]);
  push('K10 一枚都没有 ⇒ 聚合给全 0（主读数据此退 2）',
    [scanText(A, 'export const x = 1;\n').rows.length, scanText(A, 'export const x = 1;\n').maps], [0, 0]);
  push('K11 `--scope` 只吃目录前缀：ui 不许把 uikit/ 算进来',
    [applyScope(['packages/ui/src/a.tsx', 'packages/uikit/src/a.tsx'], 'packages/ui/src').length, applyScope(['apps/landing/src/a.tsx'], '').length],
    [1, 0]);
  push('K12 同名列但不是同一枚名字（key={idx} vs 第二形参 index）⇒ 不许误报',
    run([[A, 'export function L({ items }) {\n  return items.map((row, index) => <li key={idx}>{row}</li>);\n}\n']]).cand, 0);
  push('K13 按下标取表再映射（PATHS[kind].map((d, index) => …)）⇒ 认的是**表名**，那档落 🟠 不落 🔴',
    run([[A, 'const PATHS = { a: [1, 2] };\nexport function L({ kind }) {\n  return <g>{PATHS[kind].map((d, index) => <Path key={index} d={d} />)}</g>;\n}\n']]).kinds, ['static-index']);
  const nums = labels.map((l) => Number(/^K(\d+)/.exec(l)?.[1] ?? 0));
  const uniq = new Set(nums);
  const seqOk = Math.max(...nums) === uniq.size;
  console.log(`${seqOk ? '✅' : '🔴'} K${Math.max(...nums) + 1} 臂编号连续且不重号（判的是上面 ${labels.length} 枚：最大号 ${Math.max(...nums)} ｜ 去重号数 ${uniq.size}）`);
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
  const ti = argv.indexOf('--top');
  const top = ti >= 0 ? Number(argv[ti + 1] ?? MAX_LIST) : MAX_LIST;
  const files = applyScope(listTracked(), scope);
  if (files.length === 0) { console.log(`🔴 分母为空（作用域"${scope || '默认五片'}"里一枚 .tsx/.jsx 都没数到）⇒ 尺瞎。`); process.exit(2); }
  const names = memoNames(files, (f) => readFileSync(f, 'utf8'));
  const base = scanFiles(files, (f) => readFileSync(f, 'utf8'), names);
  if (base.maps === 0) { console.log(`🔴 扫了 ${files.length} 枚，一枚带多参回调的 \`.map(\` 都没数到 ⇒ 抽取瞎了，不许读成"没有下标 key"。`); process.exit(2); }
  // 🔴 第二把尺：`key={` 的总数必须等于「落在 map 回调里的」+「map 之外的」。少一枚就是归属漏了，
  //    这一条抓过上一把尺三次（作用域按行找、属性区整段扫、词边界算错），所以新尺一上来就带着它。
  const attributed = base.rows.length + base.keysInMapStable + base.keysOutsideMap;
  console.log(`作用域 ${scope || '默认五片'} ｜ .tsx/.jsx ${files.length} 枚 ｜ .map 共 ${base.maps} 枚：多参回调 ${base.rows.length > 0 ? base.maps - base.mapUnbalanced - base.mapOtherForm - base.mapNoIndex : base.maps - base.mapUnbalanced - base.mapOtherForm - base.mapNoIndex} ｜ 只有单形参 ${base.mapNoIndex} ｜ 另一种写法(函数表达式外) ${base.mapOtherForm} ｜ 括号配不上 ${base.mapUnbalanced}`);
  console.log(`key 对账：\`key={…}\` 共 ${base.keyTotal} 处 ｜ 落进 map 回调按下标的 ${base.rows.length} + 回调里用成员名的 ${base.keysInMapStable} + 回调外的 ${base.keysOutsideMap} = ${attributed} ｜ 差 ${base.keyTotal - attributed} 枚`);
  if (base.keyTotal !== attributed) { console.log('🔴 两把尺数不相等 ⇒ key 归属漏了，本趟候选不可信。'); process.exit(2); }
  const cand = candidates(base.rows);
  const staticIdx = base.rows.filter((r) => r.kind === 'static-index');
  console.log(`A 族：🔴 下标 key ${cand.length} 枚 ｜ 🟠 顶层字面量表按下标 ${staticIdx.length} 枚`);
  console.log(`B 族：具名 memo 组件 ${base.memo} 枚（收 0 ⇒ 这一族没有分母，别说"没有内联字面量"）｜ 🟠 内联字面量 prop ${base.memoLiterals.length} 处 ｜ 内联函数 prop ${base.inlineFns} 处（射程外，只数规模）`);
  if (cand.length) {
    console.log('\n🔴 候选（逐枚开码才成判词：列表会不会重排、行里有没有输入态，只有看的人知道）：');
    for (const c of cand.slice(0, top)) console.log(`   ${c.file}:${c.line}  ${c.detail}`);
    if (cand.length > top) console.log(`   …另有 ${cand.length - top} 枚（加 --top 500 全列）`);
  }
  if (base.memoLiterals.length) {
    console.log('\n🟠 内联字面量打在 memo 组件上（那枚 memo 是白包的；代价随列表尺寸走，归改的人判）：');
    for (const c of base.memoLiterals.slice(0, top)) console.log(`   ${c.file}:${c.line}  ${c.detail}`);
  }
  console.log(`\n候选 ${cand.length} 枚${strict ? '' : '｜诊断尺默认退 0，加 --strict 才判红'}`);
  if (argv.includes('--mutate')) process.exit(mutate(files, (f) => readFileSync(f, 'utf8')));
  process.exit(strict && cand.length > 0 ? 1 : 0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
