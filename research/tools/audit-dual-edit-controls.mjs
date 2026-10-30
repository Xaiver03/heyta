#!/usr/bin/env node
/**
 * 「同一件事有没有两处都能编辑」——产品视角那一维最后一格没装置的，本尺补它。
 * =================================================================
 *
 * ## 为什么要有它
 *
 * 目标点名三种产品缺陷形状：「两处都能编辑 / 同一个目的地两个入口 / 失败后没有回执」。
 * 后两格本线已各有尺（`audit-duplicate-destinations.mjs`、`audit-silent-failure-branch.mjs`），
 * 唯独**第一格只有散文**。`audit-duplicate-destinations.mjs` 的头里明写着它**不覆盖**这一族，
 * 理由是"要跨组件对账 state 的语义来源，静态文本分不清 `setTitle` 与 `setTitleDraft` 是不是同一件事"。
 * 那句**只对了一半**：跨组件确实判不了，但**同一枚组件内**两个控件绑**同一枚 `useState` 变量**
 * 是纯本地可对账的——变量名在同一个作用域里就是同一个存储，不需要猜语义。
 * 所以这一族的正确拆法是：**能判的那半判掉，判不了的那半逐枚登记成"未判定"**，
 * 而不是因为整族判不了就留一句"没装置"。本尺就是那一半。
 *
 * ## 判什么
 *
 * 在**一枚组件内**：一枚 `const [x, setX] = useState(...)` 变量被 **≥2 枚"可编辑控件"**绑上
 * ⇒ 🔴 `dual-edit`。"可编辑"= 该元素同时有 ① 一枚值绑定（`value|checked|defaultValue|defaultChecked`
 * 的表达式**整段就是那枚变量名**）与 ② 一改变处理器（`onChange|onInput|onChangeText|onValueChange|onSelectionChange`）。
 * 档位（只有 🔴 会让 `--strict` 退 1）：
 *   🔴 `dual-edit`      同一作用域里 ≥2 枚可编辑控件写同一枚 state
 *   🟠 `edit+echo`      1 枚可编辑 + 其余只绑值不回写 ⇒ 多半是预览/回显，**要人看**，不是缺陷
 *   🟡 `echo-only`      全部只绑值没有处理器 ⇒ 只数条数（纯展示，判不了也不该判）
 *   ⚪ 单点              一枚绑定 ⇒ 常态，不报
 * 🔴 的键**含组件名**：不同组件里同名的 `useState` 变量是**两个不同的存储**，
 * 把它们并成一档就会把"两屏各有一个标题输入框"读成缺陷（臂 F4 钉这一条）。
 *
 * ## **不**判什么（这三条是射程，不是我的懒）
 *
 * ① **跨组件/跨文件**写同一个字段（父把 `title` 传下去，子有两枚 input 都 `onChange` 回同一个 prop）
 *    ⇒ 本尺**判不了**，逐枚计入「未判定」并给位置。这是上一把尺那句话里对的那一半。
 * ② 不是 `useState` 的状态（`zustand`/context/`useReducer`/类组件 `this.state`/表单库的 `register`）
 *    ⇒ 分母里没有它们，读 0 **不等于**"没有两处都能编辑"。
 * ③ 值绑定写成表达式（`value={t.trim()}`、`value={items[0].name}`）⇒ 记「判不了」，不猜它指哪枚变量。
 *
 * ## 用法与退出码
 *
 *   node research/tools/audit-dual-edit-controls.mjs               # 诊断，恒退 0
 *   node research/tools/audit-dual-edit-controls.mjs --strict      # 有 🔴 ⇒ 退 1
 *   node research/tools/audit-dual-edit-controls.mjs --self-test   # 臂数由它自己打印
 *   node research/tools/audit-dual-edit-controls.mjs --mutate      # 内存里注入一枚再拆掉，不碰工作树
 *   node research/tools/audit-dual-edit-controls.mjs --scope apps/web/src/features/auth
 *
 * 0 诊断 ｜ 1 `--strict` 且有 🔴 ｜ 2 **分母为空**（没数到 `useState` 或没数到任何绑定 ⇒ 尺瞎了，不许读成"没有缺陷"）。
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { maskText, balanced, lineOf } from './lib/text-mask.mjs';

const VALUE_ATTRS = ['value', 'checked', 'defaultValue', 'defaultChecked'];
const EDIT_HANDLERS = ['onChange', 'onInput', 'onChangeText', 'onValueChange', 'onSelectionChange'];
/** 控件名里带这些词的算"看得出没打算只读"；认不出的标签不丢，降到 `未知标签` 那一档给人看。 */
const KNOWN_EDITABLE = /(?:input|textarea|select|checkbox|radio|switch|slider|picker|editor|combo|search|mention)/i;
const DEFAULT_SCOPES = ['apps/web/src/', 'apps/mobile/src/', 'apps/desktop/src/', 'packages/ui/src/', 'packages/app-host/src/'];
const MAX_LIST = 25;

const git = (args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).trim();

/** 作用域范围：一枚函数/箭头体的 `{ … }`。
 *  🔴 这里**不能**用"往上找最近的声明行"那种写法：本仓组件体里普遍先写
 *    `const onSubmit = async () => {…}` 再写 JSX，那种写法会把 JSX 里那枚控件归到 `onSubmit` 上去，
 *    与 `useState` 归到的组件名对不上 ⇒ 真·本地状态被读成"非本地"（我第一发就在真树上踩到：
 *    678 枚 useState 只剩 1 组本地绑定参与对账，那把尺几乎瞎）。
 *    改成**区间包含**：控件偏移落在哪一枚函数体里，作用域就是它（同偏移多层嵌套取最内层）。 */
const DECL_RE = [
  /\bfunction\s+([\w$]+)\s*\((?:[^()]|\([^()]*\))*\)\s*(?::[^{;]*)?\{/g,
  /\bconst\s+([\w$]+)\s*=\s*(?:async\s*)?\((?:[^()]|\([^()]*\))*\)\s*(?::[^=;]*)?=>\s*\{/g,
];

export function scopes(masked) {
  const ranges = [];
  for (const re of DECL_RE) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(masked)) !== null) {
      const brace = m.index + m[0].length - 1;
      const bal = balanced(masked, brace);
      if (!bal) continue;
      ranges.push({ name: m[1], start: brace, end: bal.end });
    }
  }
  ranges.sort((a, b) => a.start - b.start);
  return {
    ranges,
    /** 偏移所在的最内层作用域名。 */
    /** 该偏移所在最内层作用域的**起始行号**（分支提示只往上看这么远，不看整份文件）。 */
    startAt(offset) {
      let best = null;
      for (const r of ranges) {
        if (r.start <= offset && offset <= r.end && (!best || r.start > best.start)) best = r;
      }
      return best ? masked.slice(0, best.start).split('\n').length - 1 : 0;
    },
    nameAt(offset) {
      let best = null;
      for (const r of ranges) {
        if (r.start <= offset && offset <= r.end && (!best || r.start > best.start)) best = r;
      }
      return best ? best.name : '(顶层)';
    },
  };
}

/** 元素开标签里**顶层**的属性表。
 *  🔴 三条来自踩过的坑：
 *  ① 不能"把整段属性区拿正则扫一遍"——本仓大量写法是 `trailing={<> … <select value={x}/> … </> }`，
 *     那一段里既有这枚元素自己的属性、也有**嵌套元素**的属性。整段扫会把嵌套控件算到这枚元素头上
 *     （真树第一发就是这么把 3 枚属性数成 6 枚）。按 `balanced` 整块跳过 `{…}` 之后，
 *     嵌套控件自然归它自己的元素（那一枚也会被 `<Tag` 那趟单独扫到）。
 *  ② 闭括号只认**顶层**的 `>`：处理器里的 `(e) => e.target.value > 2 && …` 那个 `>` 在 `{…}` 内，
 *     被 ① 的整块跳过自然越过，不用再手写深度计数器。
 *  ③ 循环里不许 `masked.slice(i)` 再匹配（那是 O(n²)，本仓明文禁过）⇒ 用**粘性正则**从 `i` 处起一次。
 */
const NAME_EQ = /([A-Za-z_$][\w$.-]*)\s*=\s*/y;
export function parseAttrs(masked, from, hardTo) {
  const out = [];
  let i = from;
  let truncated = false;
  while (i < hardTo) {
    const ch = masked[i];
    if (/\s/.test(ch) || ch === '/') { i += 1; continue; }
    if (ch === '>') break;
    if (ch === '<') { truncated = true; break; }
    NAME_EQ.lastIndex = i;
    const mm = NAME_EQ.exec(masked);
    if (!mm || mm.index !== i) { i += 1; continue; }
    const name = mm[1];
    const vStart = i + mm[0].length;
    if (masked[vStart] === '{') {
      const bal = balanced(masked, vStart);
      if (!bal) { out.push({ name, expr: null, unbalanced: true }); truncated = true; break; }
      out.push({ name, expr: masked.slice(vStart + 1, bal.end).trim(), unbalanced: false });
      i = bal.end + 1;
      continue;
    }
    if (masked[vStart] === '"' || masked[vStart] === "'" || masked[vStart] === '`') {
      const close = masked.slice(vStart + 1, hardTo + 1).search(masked[vStart]);
      const len = close < 0 ? 0 : close + 2;
      out.push({ name, expr: '', unbalanced: close < 0, quoted: true });
      i = vStart + (len || 1);
      continue;
    }
    i = vStart;
  }
  return { attrs: out, end: i, truncated };
}

/** 从这枚元素的属性表里挑出「值绑定」与「有没有改变处理器」。 */
function bindingsOf(attrs, file, line, tag) {
  const editable = attrs.some((a) => EDIT_HANDLERS.includes(a.name));
  const rows = [];
  for (const a of attrs) {
    if (!VALUE_ATTRS.includes(a.name)) continue;
    rows.push({ file, line, tag, attr: a.name, expr: a.expr, unbalanced: a.unbalanced, editable });
  }
  return { rows, editable };
}

/** 这枚控件"往上最近的分支标记"——**启发式提示**，不是判据。
 *  本仓的互斥渲染几乎都写成 `{cond ? (` / `{cond && (` / `) : (` 这一族行首形状，
 *  所以拿它给候选分个"看着像同支路 / 看着像不同支路"，能让人一 glance 判完；
 *  🔴 它**不参与判红**：分支嵌套写法千变万化，把启发式焊进退出码就是造假绿。 */
const BRANCH_RE = /(?:[?&|]\s*\()|(?:\)\s*:\s*\()|(?:^\s*\{[^{}]*\?\s*\()|(?:if\s*\()/;
export function branchHint(lines, line, from) {
  // 先看**这一行自己**（`{cond ? (<input …` 挤在一行时也看得见分支），再往上找
  if (BRANCH_RE.test(lines[line - 1] ?? '')) return { at: line, text: (lines[line - 1] ?? '').trim().slice(0, 46) };
  for (let i = line - 2; i >= Math.max(0, from); i -= 1) {
    if (BRANCH_RE.test(lines[i])) return { at: i + 1, text: lines[i].trim().slice(0, 46) };
  }
  return { at: 0, text: '(往上没找到分支标记)' };
}

/** **独立**数一遍属性出现次数（不看元素结构），用来对账元素解析有没有瞎。
 *  元素解析数到的 == 属性总数 才算两把尺互证；差一枚就说明有属性没被归到任何元素上
 *  （或被归了两遍）⇒ 本趟候选不可信，退 2 拒答。 */
export function attrTotal(masked) {
  // 🔴 边界必须是"**整枚属性名**"而不是 `\\b`：`aria-checked={…}` 里 `-` 与 `c` 之间是词边界，
  //    按 `\\bchecked=` 数会把 ARIA 状态数成值绑定（真树第一发就是这么差出 13 枚）。
  //    元素解析那侧用 `VALUE_ATTRS.includes(name)` 比的是全名，两边口径必须一致，否则对账尺自己就是错的。
  let n = 0;
  // `=` 两边**不许有空格**：`const value = { … }` 是一枚普通对象字面量赋值，不是 JSX 属性
  //   （真树上就有一枚：`apps/web/src/features/ai/panel-ephemeral.tsx` 那行 `const value = { … }`，
  //   允许空格时对账会多出一枚"元素之外"的属性）。代价反着说一遍：写法是 `value = {x}` 的 JSX 属性
  //   本对账尺看不见——prettier 在本仓不会这么印，而看不见的是**对账那一侧**，判据那一侧仍按属性名比。
  const re = /(?<![\w$.-])(?:value|checked|defaultValue|defaultChecked)=\{/g;
  let m;
  while ((m = re.exec(masked)) !== null) n += 1;
  return n;
}

export function scanText(file, text, opts = {}) {
  // 🔴 结构一律在**遮蔽文本**上找（注释与字符串里的 `<Input value={x} />` 不算控件），
  //    但行号回原文取——`maskText` 是等长的，两边同行号。
  const masked = maskText(text);
  const sc = scopes(masked);
  const masks = { lines: masked.split('\n') };
  const br = (lines, line, from) => (opts.hints ? branchHint(lines, line, from) : null);
  const states = [];
  const stateRe = /\bconst\s*\[\s*([A-Za-z_$][\w$]*)\s*,\s*([A-Za-z_$][\w$]*)\s*\]\s*=\s*useState\b/g;
  let sm;
  while ((sm = stateRe.exec(masked)) !== null) {
    states.push({ var: sm[1], setter: sm[2], line: lineOf(masked, sm.index), scope: sc.nameAt(sm.index) });
  }
  const byScope = new Map();
  for (const s of states) {
    const k = `${file} § ${s.scope}`;
    if (!byScope.has(k)) byScope.set(k, new Set());
    byScope.get(k).add(s.var);
  }

  const bindings = [];
  let unknownExpr = 0;
  let cmpSkipped = 0;
  const tagRe = /<([A-Za-z][\w$.]*)/g;
  let tm;
  while ((tm = tagRe.exec(masked)) !== null) {
    // 🔴 `<` 也可能是**比较运算符**。前面（跳过空白）挨着标识符字符 / `)` / 引号 ⇒ 那是 `a < b`，
    //    不是元素开括号。不剔它，那一枚"假元素"的属性区会一路吃到后面真元素的 `>`，
    //    把后面的属性**数第二遍**——对账臂 F13 第一次就在真树上读出"解析比独立数多 4 枚"抓到这一点。
    let j = tm.index - 1;
    while (j >= 0 && /\s/.test(masked[j])) j -= 1;
    let isCmp = false;
    if (j >= 0 && /[\w$)\]'"`]/.test(masked[j])) {
      // 标识符结尾要放行 `return <X>` 这一类关键字；其余 `a < b` / `f(x) < y` 都算比较
      let g = j;
      while (g >= 0 && /[\w$]/.test(masked[g])) g -= 1;
      const word = masked.slice(g + 1, j + 1);
      isCmp = !/^(?:return|case|default|do|else|yield|await)$/.test(word);
    }
    if (isCmp) { cmpSkipped += 1; continue; }
    const tag = tm[1];
    const start = tm.index + tm[0].length;
    const { attrs } = parseAttrs(masked, start, masked.length);
    const line = lineOf(masked, tm.index);
    const scope = sc.nameAt(tm.index);
    const { rows } = bindingsOf(attrs, file, line, tag);
    for (const b of rows) {
      if (b.unbalanced) { unknownExpr += 1; continue; }
      const one = /^[A-Za-z_$][\w$]*$/.exec(b.expr ?? '');
      if (!one) { unknownExpr += 1; continue; }
      // 这枚变量在同一作用域里是不是有一枚 `useState` 声明。
      // 🔴 看的是**作用域**不是行号：控件与声明几乎不在同一行，同一作用域就是同一个存储。
      const known = byScope.get(`${file} § ${scope}`)?.has(one[0]) ?? false;
      bindings.push({
        file, line, tag, scope, attr: b.attr, var: one[0], known, editable: b.editable,
        branch: br(masks.lines, line, sc.startAt(tm.index)),
        tier: known ? (b.editable ? '可编辑' : '只回显') : '非本地状态',
      });
    }
  }
  return { bindings, states, unknownExpr, cmpSkipped, ranges: sc.ranges.length, attrs: attrTotal(masked) };
}

export function scanFiles(files, read = (f) => readFileSync(f, 'utf8'), opts = {}) {
  const bindings = [];
  const states = [];
  let unknownExpr = 0;
  let cmpSkipped = 0;
  let ranges = 0;
  let attrs = 0;
  for (const f of files) {
    let t = '';
    try { t = read(f); } catch { continue; }
    const r = scanText(f, t, opts);
    bindings.push(...r.bindings);
    states.push(...r.states);
    unknownExpr += r.unknownExpr;
    cmpSkipped += r.cmpSkipped;
    ranges += r.ranges;
    attrs += r.attrs;
  }
  return { bindings, states, unknownExpr, cmpSkipped, ranges, attrs };
}

/** 只有 `known`（该作用域确实有一枚同名 `useState`）的绑定参与分组。 */
export function groupBindings(bindings) {
  const g = new Map();
  let nonLocal = 0;
  for (const b of bindings) {
    if (!b.known) { nonLocal += 1; continue; }
    const k = `${b.file} § ${b.scope} § ${b.var}`;
    if (!g.has(k)) g.set(k, []);
    g.get(k).push(b);
  }
  const rows = [...g.entries()].map(([key, list]) => {
    const editable = list.filter((x) => x.editable);
    const echo = list.filter((x) => !x.editable);
    let tier = 'single';
    if (editable.length >= 2) tier = 'dual-edit';
    else if (editable.length === 1 && echo.length >= 1) tier = 'edit+echo';
    else if (editable.length === 0 && list.length >= 2) tier = 'echo-only';
    return { key, tier, list, editable: editable.length, echo: echo.length, detail: list.map((x) => `${x.tag}:${x.attr}:${x.line}${x.editable ? '+改' : ''}`) };
  });
  return { groups: rows, nonLocal };
}

export function candidates(groups) {
  return groups.filter((g) => g.tier === 'dual-edit').sort((a, b) => b.editable - a.editable || a.key.localeCompare(b.key));
}

export function applyScope(files, scope) {
  if (!scope) return files.filter((f) => DEFAULT_SCOPES.some((s) => f.startsWith(s)));
  const s = scope.endsWith('/') ? scope : `${scope}/`;
  return files.filter((f) => f.startsWith(s));
}

function listTracked() {
  return git(['ls-files', '--', '*.tsx']).split('\n').filter((l) => l.trim() !== '');
}
const safeRead = (f, read) => { try { return read(f); } catch { return ''; } };

/** `line`（1 基）在那段文本里的起始下标。⚠️ 与 `lineOf`（下标→行号）方向相反，别混用。 */
function lineStartOf(text, line) {
  const lines = text.split('\n');
  return lines.slice(0, Math.max(0, line - 1)).reduce((a, l) => a + l.length + 1, 0);
}

/** 内存变异：给**真实文件**里某一枚"单点可编辑"控件后面原样再插一枚同绑定的元素 ⇒ 🔴 必须 +1；
 *  反向从 🔴 组里摘掉一枚 ⇒ 必须回到基线。全程不落盘（本仓纪律：变异只在内存，还原只从 .mut-bak）。 */
function mutate(files, read) {
  const base = scanFiles(files, read);
  const g0 = groupBindings(base.bindings);
  const n0 = candidates(g0.groups).length;
  // 找一枚"某作用域里只有一枚可编辑绑定"的控件做注入点：注入后它必然成 🔴
  const single = g0.groups.find((x) => x.tier === 'single' && x.editable === 1);
  if (!single) { console.log('🔴 分母里没有"单点可编辑"那形 ⇒ 变异臂打空，不判绿。'); return 1; }
  const hit = single.list.find((b) => b.editable);
  const file = hit.file;
  const text = safeRead(file, read);
  // 注入点**钉在被打名那一枚控件所在那一行之前**（不是文件里第一枚同名标签、也不是任意位置）：
  //   插错位置造出来的形状证明不了本尺对这一格敏感。
  const lineStart = lineStartOf(text, hit.line);
  if (!text.slice(lineStart, lineStart + 200).includes(`<${hit.tag}`)) {
    console.log(`🔴 ${file}:${hit.line} 那一行里没有 <${hit.tag} ⇒ 变异臂定位失败，不判绿。`);
    return 1;
  }
  const inject = `${text.slice(0, lineStart)}      <${hit.tag} ${hit.attr}={${hit.var}} onChange={() => {}} />\n${text.slice(lineStart)}`;
  const d1 = candidates(groupBindings(scanFiles(files, (f) => (f === file ? inject : safeRead(f, read))).bindings).groups).length - n0;
  // 反向：从一枚真 🔴 组里把其中一枚的 `value=` 换成不相干的表达式 ⇒ 该组必须掉出 🔴
  const dup = candidates(g0.groups);
  if (!dup.length) { console.log('ℹ️ 基线里没有 🔴 组 ⇒ 反向那一发只在"有 🔴"时判；本轮只判注入臂。'); return d1 === 1 ? 0 : 1; }
  const d = dup[0];
  const b = d.list.find((x) => x.editable);
  const t2 = safeRead(b.file, read);
  const s2 = lineStartOf(t2, b.line);
  const p2 = t2.indexOf(`${b.attr}={${b.var}}`, s2);
  if (p2 < 0) { console.log(`🔴 定位不到 ${b.file}:${b.line} 的 ${b.attr}={${b.var}} ⇒ 反向臂打空，不判绿。`); return 1; }
  const swapped = `${t2.slice(0, p2)}${b.attr}={__NOT_A_LOCAL_STATE__}${t2.slice(p2 + `${b.attr}={${b.var}}`.length)}`;
  const d2 = candidates(groupBindings(scanFiles(files, (f) => (f === b.file ? swapped : safeRead(f, read))).bindings).groups).length - n0;
  console.log(`基线 🔴 ${n0} 组｜给 ${file}:${hit.line} 那枚 ${hit.tag} 再插一枚同绑定 ⇒ 变化 ${d1}（期望 +1）｜从 ${d.key.split(' § ')[2]} 摘掉值绑定 ⇒ 变化 ${d2}（期望 ≤0，且该组退出 🔴）`);
  if (d1 !== 1) { console.log('🔴 注入一枚同绑定控件后 🔴 组数没动 ⇒ 本尺对"两处都能编辑"不敏感，拿它当门是假绿。'); return 1; }
  if (d2 > 0) { console.log('🔴 摘掉一枚值绑定反而多出 🔴 ⇒ 分组键有问题。'); return 1; }
  console.log('✅ 变异臂：注入 ⇒ +1 组；摘掉 ⇒ 该组退出 🔴（只动被点名的那一枚）。');
  return 0;
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
  const A = 'apps/web/src/Foo.tsx';
  const T = (body) => `export function Foo() {\n  const [title, setTitle] = useState('');\n${body}\n}\n`;
  const tiersOf = (pairs) => {
    const rows = [];
    for (const [f, t] of pairs) rows.push(...scanText(f, t).bindings);
    const g = groupBindings(rows);
    return { dual: g.groups.filter((x) => x.tier === 'dual-edit').length, all: g.groups.map((x) => x.tier), nonLocal: g.nonLocal };
  };

  push('F1 同一组件里两枚可编辑控件绑同一枚 state ⇒ 1 组 🔴',
    tiersOf([[A, T('  return <><input value={title} onChange={e => setTitle(e.target.value)} /><TextInput value={title} onChangeText={setTitle} /></>;')]]).dual, 1);
  // 🔴 这一发的夹具第一版写错了，错得很值得留：它原本拿 `<Text>{title}</Text>` 当"回显"，
  //    读回来却是 `single` —— 子节点插值 `{title}` **不是值绑定**，本尺只认 `value=`/`checked=` 那四枚属性。
  //    所以这里用 `<input value={title} disabled />`（绑了值但不给改变处理器）当回显，
  //    另发 F2b 把"纯插值不算绑定"这条边界钉住。
  push('F2 一枚可编辑 + 一枚"绑了值但没有改变处理器" ⇒ 落 🟠 不落 🔴',
    (() => { const r = tiersOf([[A, T('  return <><input value={title} onChange={e => setTitle(e.target.value)} /><input value={title} disabled /></>;')]]); return [r.dual, r.all]; })(),
    [0, ['edit+echo']]);
  push('F2b 子节点插值 `{title}` 不算值绑定（尺只认 value/checked 那四枚属性，这是**射程**不是漏）',
    tiersOf([[A, T('  return <><input value={title} onChange={() => {}} /><Text>{title}</Text></>;')]]).all, ['single']);
  push('F3 两枚可编辑控件但绑**不同** state ⇒ 两档都是 0',
    tiersOf([[A, 'export function Foo() {\n  const [a, setA] = useState(1);\n  const [b, setB] = useState(2);\n  return <><input value={a} onChange={() => {}} /><input value={b} onChange={() => {}} /></>;\n}\n']]).dual, 0);
  push('F4 不同组件里同名 state 变量是两个存储 ⇒ 不许并成一档（这一条决定分组键含组件名）',
    tiersOf([[A, 'export function A1() {\n  const [t, setT] = useState(1);\n  return <input value={t} onChange={() => {}} />;\n}\nexport function A2() {\n  const [t, setT] = useState(1);\n  return <input value={t} onChange={() => {}} />;\n}\n']]).dual, 0);
  push('F5 注释里的那枚控件不算（遮蔽在结构判断上必须参与）',
    tiersOf([[A, T('  return <> {/* <input value={title} onChange={() => {}} /> */}<input value={title} onChange={() => {}} /></>;')]]).dual, 0);
  push('F6 处理器表达式里带 `>` 不许把元素属性区截断（`value > 2 &&` 那一形）',
    tiersOf([[A, T('  return <><input value={title} onChange={(e) => e.target.value.length > 2 && setTitle(e.target.value)} /><input value={title} onChange={() => setTitle("x")} /></>;')]]).dual, 1);
  push('F7 值绑定是表达式（`title.trim()`）⇒ 记「判不了」，不许猜它指哪枚变量',
    (() => { const r = scanText(A, T('  return <input value={title.trim()} onChange={() => {}} />;')); return [r.bindings.filter((b) => !b.known).length, r.unknownExpr]; })(),
    [0, 1]);
  push('F8 非本地状态（prop 传进来的名字）单独一档，不参与 🔴',
    (() => { const r = tiersOf([[A, 'export function B({ title }) {\n  return <><input value={title} onChange={() => {}} /><input value={title} onChange={() => {}} /></>;\n}\n']]); return [r.dual, r.nonLocal]; })(),
    [0, 2]);
  push('F9 一枚都没有 ⇒ 聚合给全 0（主读数据此退 2）',
    [scanText(A, 'export const x = 1;\n').bindings.length, groupBindings([]).groups.length], [0, 0]);
  push('F10 对账成立：参与分组的 + 「非本地」的 = 数到的全部绑定',
    (() => { const r = tiersOf([[A, T('  return <><input value={title} onChange={() => {}} /><Text>{title}</Text><input value={other} onChange={() => {}} /></>;')]]); const b = scanText(A, T('  return <><input value={title} onChange={() => {}} /><Text>{title}</Text><input value={other} onChange={() => {}} /></>;')); const g = groupBindings(b.bindings); return g.groups.length + g.nonLocal === b.bindings.length; })(), true);
  push('F11 `--scope` 只吃目录前缀；默认作用域不含 `apps/landing`（营销站没有编辑面，这一条是**选择**不是漏）',
    [applyScope(['apps/web/src/features/auth/x.tsx', 'apps/web/src/features/authish/x.tsx'], 'apps/web/src/features/auth').length,
      applyScope(['apps/landing/src/x.tsx'], '').length], [1, 0]);
  push('F12 处理器名三种写法（web onChange / RN onChangeText / RN onValueChange）都算"能改"',
    tiersOf([[A, T('  return <><input value={title} onChange={() => {}} /><Slider value={title} onValueChange={() => {}} /></>;')]]).dual, 1);
  push('F13 对账第二把尺：属性出现总数 == 进档绑定 + 判不了（元素解析漏一枚就当场红）',
    (() => {
      // `aria-checked={x}` 那一枚是**故意加的**：`checked` 在 `-` 与 `c` 之间也算词边界，
      //   独立计数器要是按 `\b` 数就会多数一枚（真树第一发就是这么差出 13 枚）。
      const t = T('  return <><input value={title} onChange={() => {}} /><input value={title.trim()} onChange={() => {}} /><Text role="checkbox" aria-checked={x} checked={y} /></>;');
      const r = scanText(A, t);
      return [attrTotal(maskText(t)) === r.bindings.length + r.unknownExpr, r.bindings.length, r.unknownExpr];
    })(),
    [true, 2, 1]);
  push('F14 作用域按**区间**认不按"往上最近的声明行"认：组件体里先写了 const onSubmit 再写 JSX，控件仍须归到组件（第一发拿行去找，真树上 678 枚 useState 只剩 1 组进档——那是尺瞎不是代码干净）',
    tiersOf([[A, 'export function Foo() {\n  const [title, setTitle] = useState(\'\');\n  const onSubmit = async () => {\n    setTitle(\'x\');\n  };\n  return <><input value={title} onChange={() => {}} /><input value={title} onChangeText={() => {}} /></>;\n}\n']]).dual, 1);
  push('F16 属性表达式里嵌着别的元素时，嵌套控件归它自己那枚元素，不许算到这枚头上（真树第一发把 3 枚属性数成 6 枚）',
    (() => {
      const t = 'export function Foo() {\n  const [a, setA] = useState(0);\n  const [b, setB] = useState(0);\n  return <Wrap value={a} onChange={() => {}} trailing={<><Inner value={b} onChange={() => {}} /><Inner2 value={b} onChangeText={() => {}} /></>} />;\n}\n';
      const r = scanText(A, t);
      const g = groupBindings(r.bindings);
      return [attrTotal(maskText(t)) === r.bindings.length + r.unknownExpr,
        g.groups.filter((x) => x.tier === 'dual-edit').map((x) => x.key.split(' § ')[2]),
        r.bindings.filter((x) => x.tag === 'Wrap').map((x) => x.var)];
    })(), [true, ['b'], ['a']]);
  push('F15 比较运算符 `<` 不许当元素开括号：不剔就会把后面真属性数第二遍（对账靠它兜住）',
    (() => {
      const t = 'export function Foo() {\n  const [n, setN] = useState(0);\n  const count = 3;\n  if (n<count) { return null; }\n  return <input value={n} onChange={() => {}} />;\n}\n';
      const r = scanText(A, t);
      return [attrTotal(maskText(t)) === r.bindings.length + r.unknownExpr, r.cmpSkipped >= 1];
    })(), [true, true]);
  push('F17 分支提示分得开"同一支路两枚控件"与"各在一支"（它只是给人看的启发式，不参与判红）',
    (() => {
      const same = scanText(A, T('  return <><input value={title} onChange={() => {}} /><input value={title} onChangeText={() => {}} /></>;'), { hints: true });
      // 夹具照本仓真实写法分了三行；挤成一行的那一形由上面"先看自己这一行"那条分支兜住
      const both = scanText(A, 'export function Foo() {\n  const [title, setTitle] = useState(\'\');\n  return <>\n    {ok ? (\n      <input value={title} onChange={() => {}} />\n    ) : (\n      <input value={title} onChangeText={() => {}} />\n    )}\n  </>;\n}\n', { hints: true });
      return [same.bindings.every((b) => b.branch !== null),
        both.bindings.filter((b) => b.branch.at > 0).length === 2,
        new Set(both.bindings.map((b) => b.branch.at)).size];
    })(), [true, true, 2]);
  const nums = labels.map((l) => Number(/^F(\d+)/.exec(l)?.[1] ?? 0));
  // 带字母后缀的子臂（F2b）共用号段，所以"连续"判的是**去重后的号数 == 最大号**，不是条数 == 最大号。
  const uniq = new Set(nums);
  const seqOk = Math.max(...nums) === uniq.size && nums.length === labels.length;
  console.log(`${seqOk ? '✅' : '🔴'} F${Math.max(...nums) + 1} 臂编号连续且不重号（判的是上面 ${labels.length} 枚，含带字母后缀的子臂：最大号 ${Math.max(...nums)} ｜ 去重号数 ${uniq.size} ｜ 条数 ${nums.length}）`);
  if (!seqOk) bad.push(`编号臂跳号或重号 ｜ 最大 ${Math.max(...nums)} ｜ 去重 ${uniq.size} ｜ 条数 ${labels.length}`);
  console.log(`\n臂数 ${labels.length + 1} ｜ 不符 ${bad.length}`);
  for (const b of bad) console.log(`🔴 ${b}`);
  return bad.length === 0 ? 0 : 1;
}

function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--self-test')) process.exit(selfTest());
  const strict = argv.includes('--strict');
  const scopeArg = argv.indexOf('--scope');
  const scope = scopeArg >= 0 ? argv[scopeArg + 1] ?? '' : '';
  const topArg = argv.indexOf('--top');
  const top = topArg >= 0 ? Number(argv[topArg + 1] ?? MAX_LIST) : MAX_LIST;
  const files = applyScope(listTracked(), scope);
  if (files.length === 0) { console.log(`🔴 分母为空（作用域"${scope || '默认五片'}"里一枚 .tsx 都没数到）⇒ 尺瞎，不判绿。`); process.exit(2); }
  const base = scanFiles(files, (f) => readFileSync(f, 'utf8'), { hints: argv.includes('--hints') });
  if (base.states.length === 0) { console.log(`🔴 扫了 ${files.length} 枚 .tsx，一枚 \`useState\` 都没数到 ⇒ 抽取瞎了，读 0 不等于"没有两处都能编辑"。`); process.exit(2); }
  const g = groupBindings(base.bindings);
  if (base.bindings.length === 0) { console.log(`🔴 数到 ${base.states.length} 枚 useState，却一枚值绑定都没数到 ⇒ 元素解析瞎了。`); process.exit(2); }
  const cand = candidates(g.groups);
  const echoOnly = g.groups.filter((x) => x.tier === 'echo-only');
  const editEcho = g.groups.filter((x) => x.tier === 'edit+echo');
  // 对账：属性出现总数（独立正则）必须等于「进档的绑定 + 判不了的表达式」两笔之和。
  // 差一枚就是元素解析瞎了 ⇒ 这一趟读数不可信，退 2 拒答（臂 F13 钉的就是这条相等式）。
  const seen = base.bindings.length + base.unknownExpr;
  console.log(`作用域 ${scope || '默认五片'} ｜ .tsx ${files.length} 枚 ｜ useState ${base.states.length} 枚 ｜ 函数作用域区间 ${base.ranges} 枚`);
  console.log(`属性对账：独立数 ${base.attrs} 处 ｜ 元素解析看到 ${seen} 处（进档 ${base.bindings.length} + 判不了 ${base.unknownExpr}）｜ 差 ${base.attrs - seen} 枚 ｜ 剔掉的比较运算符 ${base.cmpSkipped} 处`);
  if (base.attrs !== seen) { console.log('🔴 两把尺数不相等 ⇒ 元素解析漏了属性（或有属性写在元素之外），本趟候选不可信。'); process.exit(2); }
  console.log(`档位：🔴 两处都能编辑 ${cand.length} ｜ 🟠 一改一显 ${editEcho.length} ｜ 🟡 全回显 ${echoOnly.length} ｜ 单点 ${g.groups.length - cand.length - editEcho.length - echoOnly.length}`);
  console.log(`判不了：值写成表达式 ${base.unknownExpr} 处 ｜ 非本地状态（prop/外部）${g.nonLocal} 处 —— 这两族本尺**没覆盖**，跨组件那一族尤其别读成"没有"`);
  if (cand.length) {
    console.log(`\n🔴 候选（同一组件里 ≥2 枚可编辑控件写同一枚 state；逐枚带标签与行号）：`);
    for (const c of cand.slice(0, top)) {
      const hints = c.list.filter((x) => x.branch).map((x) => `:${x.line}→[${x.branch.text}]`);
      const same = hints.length >= 2 && new Set(c.list.filter((x) => x.branch).map((x) => x.branch.at)).size === 1;
      console.log(`   ${c.key}\n      ${c.detail.join('  ')}`);
      if (hints.length) console.log(`      分支提示（${same ? '两枚看着在**同一**支路——更像真缺陷' : '两枚各自有分支标记——多半互斥渲染'}；启发式，不参与判红）：${hints.join('  ')}`);
    }
    if (cand.length > top) console.log(`   …另有 ${cand.length - top} 组（加 --top 500 全列）`);
  }
  if (editEcho.length) {
    console.log(`\n🟠 一改一显（多半是回显/预览，逐组人看）：`);
    for (const c of editEcho.slice(0, Math.min(top, 10))) console.log(`   ${c.key} → ${c.detail.join('  ')}`);
  }
  console.log(`\n候选 ${cand.length} 组${strict ? '' : '｜诊断尺默认退 0，加 --strict 才判红'}`);
  if (argv.includes('--mutate')) process.exit(mutate(files, (f) => readFileSync(f, 'utf8')));
  process.exit(strict && cand.length > 0 ? 1 : 0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
