#!/usr/bin/env node
/**
 * 监听器 / 定时器 / 观察器的清理探针（注册登录标准套件线，2026-10-29）
 * ============================================================
 *
 * 目标第 3 件第 ③ 维点名了"无界增长/无清理的监听器与定时器"，这一台管那一半的**文本可判部分**。
 * 它报的是**候选**，不是判决 —— 清理可能走一个封装好的辅助函数、可能挂在外层作用域的变量上，
 * 文本尺看不到，所以每一枚候选都要人开码看第二遍。本尺一个字节都不改。
 *
 * 判的形状（只判 useEffect / useLayoutEffect 的块体，别处一律不判）：
 *   注册 = `addEventListener(`、`setInterval(`、`new *Observer(`、`.observe(`
 *   拆除 = `removeEventListener(`、`clearInterval(`、`disconnect(`、`unobserve(`、`.abort()`
 *   effect 里有注册，而它自己那段 `return () => …` 里一个拆除都没有 ⇒ 🟠 候选
 *   连 `return () =>` 都没有（effect 不返回清理函数）⇒ 🔴 更强的那一档候选
 *
 * 🔴 四格必须显式落成"未判定"或"不判"并**报条数**，静默跳过就是把"没看到"记成"没有"：
 *   ① effect 传的是具名函数（`useEffect(subscribe, [])`）—— 函数体在别处，本尺不跨函数追；
 *   ② 注册写在 effect 之外（事件处理器、模块顶层、普通函数里）—— 那里没有"卸载时机"可比；
 *   ③ `setTimeout` 这种一次性定时器：不回来第二次，与"无界增长"不是同一件事 ⇒ 单列计数、不进候选
 *      （进候选就是噪声，噪声会让人把整把尺关掉）；
 *   ④ 括号配不上（未闭合的模板串等）⇒ 那一处不判，落 undetermined。
 *
 * 读数口径：分母 = `git ls-tree -r --name-only HEAD` 里在射程内的那批（判的是仓库，不是"这台机器上恰好有什么"）；
 * 正文从工作树取，所以**工作树里别人未提交的改动会进读数** ⇒ 每次自打印脏的枚数，不假装看的是 HEAD。
 *
 * 用法：node research/tools/audit-listener-timer-cleanup.mjs [--strict] [--self-test] [--mutate] [--top N]
 * 退出：0 = 只报读数；1 = --strict 且有候选 / --mutate 有形状打空；2 = 分母为空 / 一台都没判成（"我没干活"，不许读成"都干净"）
 *
 * 🔴 `--mutate` 是这把手的牙：读数"0 候选"本身不构成证据 —— 它把拆除的那一手在**内存副本**上抹掉
 *   （一个字节都不写盘，共享检出里不许做原地变异），同一趟里必须看见候选从 0 变出来；抹不动就是尺坏了。
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const argv = process.argv.slice(2);
const strict = argv.includes('--strict');
const selfTest = argv.includes('--self-test');
const mutate = argv.includes('--mutate');
const topIv = argv.indexOf('--top');
const TOP = topIv >= 0 && /^\d+$/.test(argv[topIv + 1] ?? '') ? Number(argv[topIv + 1]) : 30;
const unknown = argv.filter((a) => !['--strict', '--self-test', '--mutate'].includes(a) && a !== '--top' && !/^\d+$/.test(a));
if (topIv >= 0 && !/^\d+$/.test(argv[topIv + 1] ?? '')) {
  console.error('🔴 --top 后面要跟一个非负整数');
  process.exit(1);
}

const SCOPE_RE = /^(apps|packages)\/[^/]+\/src\/.*\.(ts|tsx)$/;
const EFFECT_RE = /\b(?:useEffect|useLayoutEffect)\s*\(/g;
const REGISTER_RES = [
  { kind: 'listener', re: /\.addEventListener\s*\(/g, teardown: ['removeEventListener', 'abort'] },
  { kind: 'interval', re: /\bsetInterval\s*\(/g, teardown: ['clearInterval'] },
  { kind: 'observer', re: /\bnew\s+\w*Observer\s*\(/g, teardown: ['disconnect', 'unobserve'] },
  { kind: 'observe', re: /\.observe\s*\(/g, teardown: ['disconnect', 'unobserve'] },
  // 仓里另一整套写法：`subscribe*(cb)` 返回一枚退订函数。它的"拆除名"不固定，只能靠变量名认（见 judgeEffect）。
  { kind: 'subscribe', re: /[\w$.]*\bsubscribe[A-Z]\w*\s*\(/g, teardown: [] },
];
const ONESHOT_RE = /\bsetTimeout\s*\(/g;

/** 注释与单/双引号字符串换成等长空格 ⇒ 后面所有正则只看真代码。 */
export function maskText(text) {
  const out = text.split('');
  const blank = (from, to) => {
    for (let i = from; i < to && i < out.length; i += 1) if (out[i] !== '\n') out[i] = ' ';
  };
  let i = 0;
  while (i < text.length) {
    const two = text.slice(i, i + 2);
    if (two === '//' || two === '/*') {
      const term = two === '//' ? '\n' : '*/';
      const at = text.indexOf(term, i + 2);
      const end = at < 0 ? text.length : at + term.length;
      blank(i, end);
      i = end;
      continue;
    }
    if (text[i] === "'" || text[i] === '"') {
      const q = text[i];
      let j = i + 1;
      let closed = false;
      while (j < text.length) {
        if (text[j] === '\\') { j += 2; continue; }
        if (text[j] === q) { closed = true; break; }
        if (text[j] === '\n') break;
        j += 1;
      }
      if (closed) { blank(i, j + 1); i = j + 1; continue; }
    }
    i += 1;
  }
  return out.join('');
}

/** 从 openIdx 那枚开括号起配对，返回**内部**原文与结束下标；配不上 ⇒ null。 */
export function balanced(text, openIdx) {
  const openCh = text[openIdx];
  const closeCh = openCh === '(' ? ')' : openCh === '{' ? '}' : ']';
  let depth = 0;
  for (let i = openIdx; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '(' || ch === '{' || ch === '[') depth += 1;
    else if (ch === ')' || ch === '}' || ch === ']') {
      depth -= 1;
      if (depth === 0) return text[i] === closeCh ? { inner: text.slice(openIdx + 1, i), end: i } : null;
    }
  }
  return null;
}

export function lineOf(text, idx) {
  let n = 1;
  for (let i = 0; i < idx && i < text.length; i += 1) if (text[i] === '\n') n += 1;
  return n;
}

/** 取 text 里每一处**顶层**（深度 0）的 `return` 关键字下标，以及它后面那串表达式的首个非空字符。 */
export function topLevelReturns(body) {
  const out = [];
  let depth = 0;
  const re = /(?<![\w$.])return(?![\w$])|\(|\{|\[|\)|\}|\]/g;
  let m;
  while ((m = re.exec(body)) !== null) {
    const tok = m[0];
    if (tok === 'return') {
      if (depth === 0) {
        const rest = body.slice(m.index + 6);
        const nl = rest.search(/[;\n]/);
        out.push({ idx: m.index, expr: (nl < 0 ? rest : rest.slice(0, nl)).trim() });
      }
      continue;
    }
    if (tok === '(' || tok === '{' || tok === '[') depth += 1;
    else depth -= 1;
  }
  return out;
}

/** 一个 effect 的判读。verdict ∈ none / clean / leaky / noCleanup / undetermined */
export function judgeEffect(argsText) {
  if (!/^\s*(\(\s*[^)]*\)\s*=>|\(\s*\)\s*=>|async\s*\(|function\b)/.test(argsText)) {
    return { verdict: 'undetermined', reason: 'effect 传的是具名函数或表达式，函数体不在这里（①）' };
  }
  const arrow = argsText.indexOf('=>');
  const brace = argsText.indexOf('{', arrow >= 0 ? arrow : 0);
  if (brace < 0) return { verdict: 'undetermined', reason: '没有块体：单表达式 effect 的返回值就是清理函数，本尺不判（①）' };
  const bodyEnd = balanced(argsText, brace);
  if (bodyEnd === null) return { verdict: 'undetermined', reason: '函数体括号配不上（④）' };
  const body = bodyEnd.inner;
  const regs = [];
  for (const r of REGISTER_RES) {
    r.re.lastIndex = 0;
    while (r.re.exec(body) !== null) regs.push(r.kind);
  }
  // 🔴 变量名限定的拆除写法（RN 的 `subscription.remove()`、以及 `subscribe*()` 返回的退订函数）：
  //    只认"这个名字确实是从本 effect 里的注册调用赋来的"，否则一句毫不相干的 `node.remove()`
  //    就能替一整个漏掉的监听器买单（那是把尺自己造绿）。
  const subNames = [...body.matchAll(/(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*[\w$.]*\.addEventListener\s*\(/g)].map((x) => x[1]);
  const unsubNames = [...body.matchAll(/(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:await\s+)?[\w$.]*subscribe[A-Z]\w*\s*\(/g)].map((x) => x[1]);
  const oneshot = (body.match(ONESHOT_RE) ?? []).length;
  if (regs.length === 0) return { verdict: 'none', oneshot };
  const rets = topLevelReturns(body);
  const isArrowReturn = (e) => /^(?:async\s*)?\(\s*\)\s*=>/.test(e) || /^(?:async\s*)?\([^)]*\)\s*=>/.test(e) || /^function\b/.test(e);
  const cleanupRet = rets.find((r) => isArrowReturn(r.expr));
  // 收尾直接把退订函数交给 React（`return subscribeX(cb)`）：那一档的拆除就是 React 拿走的返回值。
  const returnsUnsubscribe = rets.some((r) => /^[\w$.]*subscribe[A-Z]\w*\s*\(/.test(r.expr));
  const returnsOpaque = rets.some((r) => r.expr !== '' && !/^(?:undefined|null|void)\b/.test(r.expr) && !isArrowReturn(r.expr));
  if (!cleanupRet) {
    const onlySubscribe = regs.every((k) => k === 'subscribe');
    if (returnsUnsubscribe && onlySubscribe) return { verdict: 'clean', regs, leaky: [], tds: ['returned-unsubscribe'], oneshot };
    if (returnsUnsubscribe) {
      return { verdict: 'leaky', regs, leaky: [...new Set(regs.filter((k) => k !== 'subscribe'))], oneshot, note: '收尾只把 subscribe 的返回值交了出去，别的注册没人拆' };
    }
    if (returnsOpaque) {
      return { verdict: 'undetermined', reason: '收尾 return 的是一个本尺看不懂的表达式（它可能就是退订函数）（②）', regs, oneshot };
    }
    return { verdict: 'noCleanup', regs, oneshot };
  }
  const cleanup = body.slice(cleanupRet.idx);
  const tds = new Set();
  const torn = (kind) => {
    const need = REGISTER_RES.find((r) => r.kind === kind).teardown;
    const hit = need.find((t) => cleanup.includes(t));
    if (hit) { tds.add(hit); return true; }
    if (kind === 'listener' && subNames.some((n) => cleanup.includes(`${n}.remove(`))) { tds.add('.remove('); return true; }
    if (kind === 'subscribe' && (unsubNames.some((n) => new RegExp(`\\b${n}\\s*\\(`).test(cleanup)) || returnsUnsubscribe)) {
      tds.add(returnsUnsubscribe ? 'returned-unsubscribe' : 'unsub-call');
      return true;
    }
    return false;
  };
  const leaky = regs.filter((kind) => !torn(kind));
  return {
    verdict: leaky.length === 0 ? 'clean' : 'leaky',
    regs,
    leaky: [...new Set(leaky)],
    tds: [...tds],
    oneshot,
  };
}

/** 一份文件 ⇒ 每个 effect 一行判读 + effect 之外的注册数（不判，只报条数）。 */
export function scanFile(file, raw) {
  const text = maskText(raw);
  const rows = [];
  const spans = [];
  let oneshot = 0;
  EFFECT_RE.lastIndex = 0;
  let m;
  while ((m = EFFECT_RE.exec(text)) !== null) {
    const args = balanced(text, text.indexOf('(', m.index));
    if (args === null) { rows.push({ file, line: lineOf(text, m.index), verdict: 'undetermined', reason: '参数括号配不上（④）' }); continue; }
    spans.push([m.index, args.end]);
    const r = judgeEffect(args.inner);
    oneshot += r.oneshot ?? 0;
    rows.push({ file, line: lineOf(text, m.index), ...r });
  }
  const chars = text.split('');
  for (const [a, b] of spans) for (let i = a; i <= b && i < chars.length; i += 1) if (chars[i] !== '\n') chars[i] = ' ';
  const rest = chars.join('');
  let outside = 0;
  for (const r of REGISTER_RES) {
    r.re.lastIndex = 0;
    while (r.re.exec(rest) !== null) outside += 1;
  }
  oneshot += (rest.match(ONESHOT_RE) ?? []).length;
  return { rows, outside, oneshot };
}

export function summarize(scans) {
  const c = { clean: 0, leaky: 0, noCleanup: 0, undetermined: 0, none: 0 };
  const cand = [];
  const und = [];
  let outside = 0;
  let oneshot = 0;
  for (const s of scans) {
    outside += s.outside;
    oneshot += s.oneshot;
    for (const r of s.rows) {
      c[r.verdict] += 1;
      if (r.verdict === 'leaky' || r.verdict === 'noCleanup') cand.push(r);
      if (r.verdict === 'undetermined') und.push(r);
    }
  }
  return { c, cand, und, outside, oneshot };
}

function git(args) {
  const r = spawnSync('git', ['-C', ROOT, ...args], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} 失败：${r.stderr}`);
  return r.stdout;
}

/** 分母 = HEAD 里在射程内的源文件（判的是仓库，不是"这台机器上恰好有什么"）。 */
export function scopeFiles() {
  return git(['ls-tree', '-r', '--name-only', 'HEAD'])
    .split('\n')
    .filter((f) => SCOPE_RE.test(f))
    .sort();
}

/** 工作树里脏的那几枚（别人在飞的改动会进读数）⇒ 必须报出来，不能假装看的是 HEAD。 */
export function dirtyScope(scope) {
  const inScope = new Set(scope);
  return git(['status', '--porcelain'])
    .split('\n')
    .map((l) => l.slice(3).trim())
    .filter((f) => inScope.has(f));
}

if (unknown.length > 0) {
  console.error(`🔴 不认的旗标：${unknown.join(' ')} ｜ 只认 --strict / --self-test / --mutate / --top N`);
  process.exit(1);
}

if (selfTest) {
  const bad = [];
  const labels = [];
  const push = (label, got, want) => {
    labels.push(label);
    const ok = JSON.stringify(got) === JSON.stringify(want);
    if (!ok) bad.push(`${label} ｜ 期望 ${JSON.stringify(want)} ｜ 实读 ${JSON.stringify(got)}`);
    console.log(`${ok ? '✅' : '🔴'} ${label}`);
  };
  const v = (t) => judgeEffect(balanced(maskText(t), maskText(t).indexOf('('))?.inner ?? '').verdict;
  const j = (t) => {
    const mt = maskText(t);
    const m = /\b(?:useEffect|useLayoutEffect)\s*\(/.exec(mt);
    const args = balanced(mt, mt.indexOf('(', m.index));
    return judgeEffect(args.inner);
  };
  const F = (t) => scanFile('x.tsx', t);

  push('A1 定时器配 clearInterval ⇒ clean', v('useEffect(() => { const t = setInterval(tick, 1000); return () => clearInterval(t); }, []);'), 'clean');
  push('A2 变异臂：把 A1 那行的 clearInterval 抹掉 ⇒ 必须翻成 leaky',
    v('useEffect(() => { const t = setInterval(tick, 1000); return () => { void t; }; }, []);'), 'leaky');
  push('A3 监听器配 removeEventListener ⇒ clean',
    v('useEffect(() => { window.addEventListener("resize", onR); return () => window.removeEventListener("resize", onR); }, []);'), 'clean');
  push('A4 AbortController 的 signal + abort ⇒ clean（这一档不写 remove 也算拆了）',
    v('useEffect(() => { const ac = new AbortController(); el.addEventListener("click", h, { signal: ac.signal }); return () => ac.abort(); }, []);'), 'clean');
  push('A5 注释里的 addEventListener ⇒ 一条判读都不该有', F('// window.addEventListener("x", y)\nconst z = 1;').rows.length, 0);
  push('A6 字符串里的 "addEventListener" ⇒ 不算注册（那一枚 effect 必须读成 none、outside 必须是 0）',
    [F('const s = "window.addEventListener";\nuseEffect(() => { const q = s; }, []);').rows.map((r) => r.verdict), F('const s = "window.addEventListener";').outside],
    [['none'], 0]);
  push('A7 两个 effect（一干净一漏）⇒ 恰 1 枚候选（按 effect 判，不按文件判）',
    F('useEffect(() => { window.addEventListener("a", h); return () => window.removeEventListener("a", h); }, []);\nuseEffect(() => { document.addEventListener("b", h); }, []);').rows
      .filter((r) => r.verdict === 'leaky' || r.verdict === 'noCleanup').length, 1);
  push('A8 useEffect(subscribe, []) ⇒ undetermined 有条数（不许当成干净）', j('useEffect(subscribe, []);').verdict, 'undetermined');
  push('A9 只有 setTimeout ⇒ 不进候选，单列计数',
    [j('useEffect(() => { setTimeout(fl, 300); }, []);').verdict, j('useEffect(() => { setTimeout(fl, 300); }, []);').oneshot],
    ['none', 1]);
  push('A10 有注册但没有 return 清理 ⇒ noCleanup', j('useEffect(() => { window.addEventListener("k", h); }, []);').verdict, 'noCleanup');
  push('A11 分母为空 ⇒ 聚合给出全 0（主函数据此退 2，不许读成"都干净"）',
    summarize([]), { c: { clean: 0, leaky: 0, noCleanup: 0, undetermined: 0, none: 0 }, cand: [], und: [], outside: 0, oneshot: 0 });
  push('A12 字符串遮蔽不许把 URL 之后的代码吞掉 ⇒ clean',
    v('useEffect(() => { fetch("https://x.test/a"); window.addEventListener("m", h); return () => window.removeEventListener("m", h); }, []);'),
    'clean');
  push('A13 effect 之外的注册 ⇒ 计入 outside，不许混进候选',
    F('function boot() { window.addEventListener("n", h); }\nuseEffect(() => { const a = 1; }, []);').outside, 1);
  push('A14 块注释吞掉的是注释，不是后面的代码 ⇒ clean',
    v('/*\n * window.addEventListener("gone", h);\n */\nuseEffect(() => { window.addEventListener("p", h); return () => window.removeEventListener("p", h); }, []);'),
    'clean');
  const mx = 'a\nb\n// c\nd\n/* 两行\n注释 */\nconst s = "x.addEventListener";\nconst u = "https://a.test/b";';
  push('A15 遮蔽必须等长 ⇒ 行号与偏移不许漂', [maskText(mx).length === mx.length, (maskText(mx).match(/\n/g) ?? []).length === (mx.match(/\n/g) ?? []).length], [true, true]);
  push('A16 遮蔽后：字符串里的注册名不许被数到；URL 里的 // 不许被当注释吞掉后半行',
    [F('const s = "x.addEventListener";').outside, v('useEffect(() => { const q = "https://a.test/b"; window.addEventListener("r", h); return () => window.removeEventListener("r", h); }, []);')],
    [0, 'clean']);
  push('A17 没有注册的 effect 也必须留一行（verdict=none），不许从分母里消失',
    F('useEffect(() => { const a = 1; }, []);').rows.map((r) => r.verdict), ['none']);
  // 🔴 这一枚就是本尺第一发的真 bug：判读只 push 有注册的，于是"射程内 275 处 effect"读成 77 处。
  push('A18 分母自证：scanFile 的判读行数必须等于遮蔽后认得的 effect 调用数',
    F('useEffect(() => { const a = 1; }, []);\nuseEffect(() => { window.addEventListener("z", h); }, []);\nuseEffect(sub, []);').rows.length, 3);
  // 🔴 A19/A20 是这把手第一发的 7 枚全假阳性的教训：仓里主用的 RN 写法是 `X.addEventListener(…)` 返回一枚
  //    subscription，收尾是 `sub.remove()`。词表里没有它 ⇒ 7 枚候选，逐枚开码看下来一枚真缺陷都没有。
  push('A19 RN 那味：subscription.remove() 必须认成拆除 ⇒ clean',
    v('useEffect(() => { const sub = AppState.addEventListener("change", h); return () => sub.remove(); }, []);'), 'clean');
  push('A20 反 masking：与注册变量不同名的 `node.remove()` ⇒ 不许替监听器买单，仍须 leaky',
    v('useEffect(() => { AppState.addEventListener("change", h); const node = document.createElement("i"); return () => node.remove(); }, []);'), 'leaky');
  push('A21 subscribe* 返回的退订函数被调用了 ⇒ clean',
    v('useEffect(() => { const un = subscribeToWidgetPush(cb); return () => un(); }, []);'), 'clean');
  push('A22 subscribe* 没接住、effect 也不返回清理 ⇒ 落在更强的那一档 noCleanup',
    j('useEffect(() => { subscribeToWidgetPush(cb); }, []);').verdict, 'noCleanup');
  push('A23 subscribe* 没接住但写了收尾 ⇒ leaky（收尾里没有拆它的那一手）',
    v('useEffect(() => { subscribeToWidgetPush(cb); return () => { setX(false); }; }, []);'), 'leaky');
  push('A24 subscribe* 接住了、收尾里没调用 ⇒ leaky',
    v('useEffect(() => { const un = subscribeToWidgetPush(cb); return () => { void un; }; }, []);'), 'leaky');
  // 🔴 A25~A27 是第二发假阳性的教训：仓里另一味合法写法是**收尾直接把退订函数交出去**
  //    （`return subscribeX(cb)`，见 ProfileScreen 与 PrivacyPanel 各一枚）。当"不返回清理"判 ⇒ 又是候选全假。
  push('A25 收尾 `return subscribeX(cb)`（退订函数交给 React）⇒ clean',
    v('useEffect(() => { void load(); return subscribePrivacyConsent(cb); }, []);'), 'clean');
  push('A26 收尾只交了 subscribe 的返回值，但同一 effect 里还有监听器 ⇒ leaky 且点名 listener',
    [j('useEffect(() => { if (!active) return undefined; window.addEventListener("x", h); return subscribePrivacyConsent(cb); }, []);').verdict,
      j('useEffect(() => { if (!active) return undefined; window.addEventListener("x", h); return subscribePrivacyConsent(cb); }, []);').leaky],
    ['leaky', ['listener']]);
  push('A27 收尾 return 一个看不懂的表达式 ⇒ undetermined，不许读成 noCleanup',
    j('useEffect(() => { window.addEventListener("y", h); return makeDisposer(); }, []);').verdict, 'undetermined');
  push('A28 `return (a || b)` 不许被当成清理箭头（括号不等于箭头）⇒ undetermined',
    j('useEffect(() => { window.addEventListener("z2", h); return (x || y); }, []);').verdict, 'undetermined');
  // 🔴 最后一枚防的是"删了一条臂但打印的臂数还在自夸"：编号跳号/重号必须当场红。
  //    它不走 push —— 走 push 就数不到它自己（本线实测被自己这条咬过一次）。
  const nums = labels.map((l) => Number(/^A(\d+)/.exec(l)?.[1] ?? 0));
  const seqOk = Math.max(...nums) === labels.length && new Set(nums).size === labels.length;
  console.log(`${seqOk ? '✅' : '🔴'} A29 臂编号连续且不重号（判的是上面 ${labels.length} 枚：最大号 ${Math.max(...nums)} ｜ 去重 ${new Set(nums).size}）`);
  if (!seqOk) bad.push(`A29 臂编号跳号或重号 ｜ 最大 ${Math.max(...nums)} ｜ 条数 ${labels.length} ｜ 去重 ${new Set(nums).size}`);
  console.log(`\n臂数 ${labels.length + 1} ｜ 不符 ${bad.length}`);
  for (const b of bad) console.log(`🔴 ${b}`);
  process.exit(bad.length === 0 ? 0 : 1);
}

/** 变异台架要抹的那几手（每一手都是某一档注册的"拆除"证据本体）。`sole` 判的是"这一枚 effect 只靠它"。 */
export const MUT_SHAPES = [
  { tok: 'removeEventListener', repl: 'zzRemoveEvt', match: (tds) => tds.includes('removeEventListener'), sole: (tds) => tds.length === 1 },
  { tok: 'clearInterval', repl: 'zzClearItv', match: (tds) => tds.includes('clearInterval'), sole: (tds) => tds.length === 1 },
  { tok: '.remove(', repl: '.zzRemove(', match: (tds) => tds.includes('.remove('), sole: (tds) => tds.length === 1 },
  { tok: 'disconnect', repl: 'zzDisconnect', match: (tds) => tds.includes('disconnect'), sole: (tds) => tds.length === 1 },
  { tok: 'abort', repl: 'zzAbort', match: (tds) => tds.includes('abort'), sole: (tds) => tds.length === 1 },
  // 最后一手抹的不是拆除词，而是**交清理函数**这一手本身（`return () =>` ⇒ `return void`）：
  // 抹掉后那一枚 effect 就该落进"不返回清理"那一档。反例（写的时候按机制否掉的，没跑过）：
  // 抹 `subscribe` 这个 token 是把**注册**一起抹没，候选只会归 0 ⇒ 一条永远打空的假臂。
  { tok: 'return () =>', repl: 'return void', match: (tds) => tds.length > 0, sole: (tds) => tds.length > 0 },
];

const rowsOf = (file, text) => scanFile(file, text).rows;
const candOf = (file, text) => summarize([scanFile(file, text)]).cand.length;

if (mutate) {
  const ms = scopeFiles();
  if (ms.length === 0) {
    console.error('🔴 分母为空，变异台架没法证');
    process.exit(2);
  }
  const hosts = [];
  for (const f of ms) {
    try {
      const text = readFileSync(path.join(ROOT, f), 'utf8');
      const rows = rowsOf(f, text);
      const clean = rows.filter((r) => r.verdict === 'clean');
      if (clean.length > 0 && summarize([scanFile(f, text)]).cand.length === 0) hosts.push({ file: f, text, clean });
    } catch { /* 读不到正文的枚数由主读数那一路点名，这里不重复算 */ }
  }
  const lines = [];
  let hit = 0;
  let miss = 0;
  let noHost = 0;
  for (const s of MUT_SHAPES) {
    const users = hosts.reduce((n, h) => n + h.clean.filter((r) => s.match(r.tds ?? [])).length, 0);
    const soleUsers = hosts.reduce((n, h) => n + h.clean.filter((r) => s.match(r.tds ?? []) && s.sole(r.tds ?? [])).length, 0);
    const pool = hosts.filter((h) => h.clean.some((r) => s.match(r.tds ?? [])));
    if (users === 0) {
      noHost += 1;
      lines.push(`  · ${s.tok} ⇒ 无宿主（现量：射程内没有一枚判成干净的 effect 靠这一手拆除）。这一档只有自检里的合成臂证过（A4 / A19 / A21），本趟在真代码上证不了`);
      continue;
    }
    let flipped = null;
    for (const h of pool) {
      const mutated = h.text.split(s.tok).join(s.repl);
      if (candOf(h.file, mutated) > 0) { flipped = { file: h.file, tried: pool.indexOf(h) }; break; }
    }
    if (flipped) {
      hit += 1;
      lines.push(`  ✅ ${s.tok} ⇒ 使用者 ${users} 枚（只靠它的 ${soleUsers} 枚）｜在内存副本里把 ${flipped.file} 的这一手整片抹掉，候选从 0 变出来（试到第 ${flipped.tried + 1} / ${pool.length} 枚宿主）`);
    } else {
      miss += 1;
      lines.push(`  🔴 ${s.tok} ⇒ 使用者 ${users} 枚，把每一枚宿主的这一手全抹掉都不翻 ⇒ 这一档的拆除写法本尺没牙`);
    }
  }
  console.log(`变异台架（只在内存副本上抹，一个字节都不写盘）｜ 形状 ${MUT_SHAPES.length} 种 ｜ 翻出候选 ${hit} ｜ 打空 ${miss} ｜ 无宿主 ${noHost}`);
  for (const l of lines) console.log(l);
  process.exit(miss > 0 || hit === 0 ? 1 : 0);
}

const scope = scopeFiles();
if (scope.length === 0) {
  console.error('🔴 分母为空：HEAD 里一枚射程内的源文件都没列出 ⇒ 这台探针没干活，不许读成"没有泄漏"');
  process.exit(2);
}
const dirty = dirtyScope(scope);
const scans = [];
const texts = [];
let unreadable = 0;
for (const f of scope) {
  try {
    const raw = readFileSync(path.join(ROOT, f), 'utf8');
    texts.push(raw);
    scans.push(scanFile(f, raw));
  } catch {
    unreadable += 1;
  }
}
const { c, cand, und, outside, oneshot } = summarize(scans);
const withReg = c.clean + c.leaky + c.noCleanup;
const effects = withReg + c.none + c.undetermined;
// 🔴 站点级的分母自证（A18 那一枚的整树版本）：判读行数对不上"遮蔽后认得的 effect 调用数"就是漏了哪一档。
const naiveEffects = texts.reduce((n, t) => n + (maskText(t).match(EFFECT_RE) ?? []).length, 0);
if (effects === 0 || effects !== naiveEffects) {
  console.error(`🔴 分母自证不成立：判读 ${effects} 行 vs 认得的 effect 调用 ${naiveEffects} 处 ⇒ 有一档被静默吞掉，本趟读数作废`);
  process.exit(2);
}

console.log(
  `监听器/定时器清理探针 ｜ 分母 ${scope.length} 枚文件（工作树里脏的 ${dirty.length} 枚，读数含它们）` +
    `｜ effect ${effects} 处（含本尺认得的注册 ${withReg} ｜ 没有注册 ${c.none}）｜ 判不了 ${c.undetermined + unreadable}`,
);
console.log(
  `  注册配了拆除 ${c.clean} ｜ 🟠 有注册没拆除 ${c.leaky} ｜ 🔴 effect 不返回清理 ${c.noCleanup}` +
    ` ｜ 一次性 setTimeout ${oneshot}（不判）｜ effect 之外的注册 ${outside}（不判）`,
);
if (und.length > 0 || unreadable > 0) {
  const reasons = new Map();
  for (const r of und) reasons.set(r.reason ?? '?', (reasons.get(r.reason ?? '?') ?? 0) + 1);
  console.log(`  · 判不了的形状：${[...reasons].map(([k, n]) => `${k} ${n}`).join(' ｜ ') || '（无 effect 层的，全是读不到正文）'}`);
}
const byKind = new Map();
for (const r of cand) {
  const k = (r.leaky ?? r.regs).join('+');
  byKind.set(k, (byKind.get(k) ?? 0) + 1);
}
if (byKind.size > 0) {
  console.log('  · 候选按注册的形状分档：' + [...byKind].map(([k, n]) => `${k} ${n}`).join(' ｜ '));
}
if (cand.length > 0) {
  console.log(`\n🟠 候选 ${cand.length} 枚（🔴 优先，取前 ${Math.min(TOP, cand.length)} 枚；每一枚都要人开码看第二遍）：`);
  const ordered = [...cand].sort((a, b) => (a.verdict === b.verdict ? (a.file < b.file ? -1 : 1) : a.verdict === 'noCleanup' ? -1 : 1));
  for (const r of ordered.slice(0, TOP)) {
    console.log(`   ${r.verdict === 'noCleanup' ? '🔴' : '🟠'} ${r.file}:${r.line}  注册 ${(r.leaky ?? r.regs).join('+')}${r.verdict === 'noCleanup' ? '（这个 effect 根本不返回清理函数）' : '（拆除没出现在它自己的 return () => 里）'}`);
  }
} else {
  console.log('\n✅ 无候选');
}
if (strict && cand.length > 0) process.exit(1);

