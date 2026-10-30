#!/usr/bin/env node
import { pathToFileURL } from 'node:url';

/**
 * 文本级探针共用的四枚小工具（注册登录标准套件线，2026-10-29）
 * ============================================================
 *
 * 为什么单独一枚文件：这三把探针（监听器清理、函数体重叠、以及后面任何按文本判的尺）
 * 都要"先把注释与字符串挖掉再正则"。各写一遍 ⇒ 遮蔽的规则会在某一枚里修、另一枚里留着旧规则，
 * 那正是本仓第 ① 维点名的形状（同一守卫多处各写一遍）。所以只这一份。
 *
 * 🔴 遮蔽的铁律：**等长**。注释与字符串换成同数量空格（换行原样留着），
 *    否则后面所有 `lineOf` 与偏移对账都会漂 —— 有臂（A15）判的就是这一条。
 */

const REGEX_OK_BEFORE = /[([{,;:=!?&|+*%~^<>-]|\n$/;

/** 注释与单/双引号字符串换成等长空格；模板串不动（里面的 `${}` 会跟着看不见，代价在探针头里各自写明）。 */
export function maskText(text) {
  const out = text.split('');
  const blank = (from, to) => {
    for (let i = from; i < to && i < out.length; i += 1) if (out[i] !== '\n') out[i] = ' ';
  };
  let i = 0;
  // 🔴 这里不要写 `text.slice(0, i)`：那把整趟遮蔽变成 O(n²)，三把消费方一起挂住
  //    （本线实测：一次读数超时到被移到后台）。只维护一个"上一个非空白字符"的游标，
  //    关键字那一次判断只看最后 14 个字符的窗口。
  let prevNonWs = '';
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
    // 正则字面量：`/` 前一个非空白字符是运算符/括号/冒号等 ⇒ 这是正则，不是除法。
    // 不挖掉它，`/[/]}]/` 这一类字符类里的花括号就会把后面的配对全搅乱
    //（现量两处「循环体配不上」都是这个原因：`packages/inbound-core/src/webhook.ts` 与
    //  `packages/design-system/src/generate.ts`）。
    const tail14 = text.slice(Math.max(0, i - 14), i);
    const isRegexHere =
      prevNonWs === '' ||
      REGEX_OK_BEFORE.test(prevNonWs) ||
      /(?:return|typeof|instanceof|\bcase|\bin|\bof|new|delete|void|\bdo|else)[\s]*$/.test(tail14);
    // 🔴 JSX 的两枚斜杠**不是**正则开头（2026-10-30 实测：`</li>` 与 `<Foo />` 都会被上面那个
    //    启发式当成正则起点，于是从那里一路挖到下一个 `/`——**整行真代码被抹掉**，
    //    含 `value={x}` 这类结构。两把新尺的对账臂（key 归属 / 属性计数）就是这么把 `.map(` 的
    //    闭括号读成"配不上"抓出来的。判据：`/` 紧跟 `>`（自闭合 `/>` 与片段收尾 `</>`），
    //    或 `/` 直接挨在 `<` 之后（`</Tag>` 闭标签）。`a </b` 这种没空格的比较写法本仓没有，
    //    prettier 也不许它存在；真出现了，代价是那一枚正则不再被挖——比抹掉整行代码小一个量级。
    const jsxClosing = text[i + 1] === '>' || (prevNonWs === '<' && i > 0 && text[i - 1] === '<');
    if (text[i] === '/' && isRegexHere && !jsxClosing) {
      let j = i + 1;
      let cls = false;
      let closed = false;
      while (j < text.length) {
        const c = text[j];
        if (c === '\\') { j += 2; continue; }
        if (c === '\n') break;
        if (cls) { if (c === ']') cls = false; }
        else if (c === '[') cls = true;
        else if (c === '/') { closed = true; break; }
        j += 1;
      }
      if (closed) {
        let k = j + 1;
        while (k < text.length && /[a-z]/.test(text[k])) k += 1; // 跳过 flags
        blank(i, k);
        i = k;
        continue;
      }
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
    if (!/\s/.test(text[i])) prevNonWs = text[i];
    i += 1;
  }
  return out.join('');
}

/** 从 openIdx 那枚开括号起配对，返回**内部**原文与结束下标；配不上 ⇒ null（交回"判不了"那一档）。 */
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

/** 偏移 → 1 起的行号（判据要带 file:line 才交得出去）。 */
export function lineOf(text, idx) {
  let n = 1;
  for (let i = 0; i < idx && i < text.length; i += 1) if (text[i] === '\n') n += 1;
  return n;
}

/** 取 body 里每一处**深度 0** 的 `return` 及其后那段表达式的首行文本（嵌套回调里的 return 不算）。 */
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

/* ------------------------------------------------------------------
 * 这份共用工具自己的臂（四把尺都吃它，所以它必须能失败）：
 *   node research/tools/lib/text-mask.mjs --self-test
 * 🔴 两个必须同时成立才跑：旗标 + **它就是被直接执行的那一枚**。
 *    第一发我只写了旗标判断，于是三把 import 它的尺一跑 `--self-test` 就先执行这段、
 *    在这里 `process.exit` —— 症状是四把尺打印出同一个臂数（14），也就是**它们的自检根本没跑**。
 *    "几台仪器报出同一个数"本身就是信号，别当成巧合。
 * ------------------------------------------------------------------ */
const isMain = (() => {
  try {
    return import.meta.url === pathToFileURL(process.argv[1] ?? '').href;
  } catch {
    return false;
  }
})();
if (isMain && process.argv.slice(2).includes('--self-test')) {
  const labels = [];
  const bad = [];
  const push = (label, got, want) => {
    labels.push(label);
    const ok = JSON.stringify(got) === JSON.stringify(want);
    if (!ok) bad.push(`${label} ｜ 期望 ${JSON.stringify(want)} ｜ 实读 ${JSON.stringify(got)}`);
    console.log(`${ok ? '✅' : '🔴'} ${label}`);
  };
  const MIX = 'const a = 1; // 注 }\n/* 块 {\n 释 */ const s = "x}y"; const re = /[}\]]/.test(a) ? 1 : 2;\nconst b = a / b;';
  push('T1 遮蔽必须等长且不许动换行 ⇒ 后面所有行号对账才可信',
    [maskText(MIX).length === MIX.length, (maskText(MIX).match(/\n/g) ?? []).length === (MIX.match(/\n/g) ?? []).length],
    [true, true]);
  push('T2 行注释里的花括号被挖，代码里的留着',
    [maskText('// }\nconst a = {b:1};').includes('}'), maskText('// }\nconst a = {b:1};').endsWith('{b:1};')],
    [true, true]);
  push('T3 跨行块注释被挖但换行一条不许少（样本里就是两条）',
    (maskText('/*\n}\n*/ const a = 1;').match(/\n/g) ?? []).length, 2);
  push('T4 字符串整段（连引号）被挖成等长空格 ⇒ 里面的花括号与关键字都不许被正则吃到',
    // 🔴 期望里的长度必须从样本自己算，不许写字面量数字（第一发就写了个 15，样本其实是 16 字符）。
    (() => { const src = 'const s = "x}y";'; return [maskText(src), maskText(src).length === src.length]; })(),
    ['const s =      ;', true]);
  push('T5 未闭合的撇号不许把后面整行吞掉（缩写里那种）',
    maskText("const s = don't; const a = {b:1};").endsWith('{b:1};'), true);
  push('T6 正则字面量连同 flags 一起挖（字符类里的花括号正是配对的杀手）',
    maskText('const re = /[}\\]]/g; const a = {b:1};').includes('/['), false);
  push('T7 除法不许被认成正则（认错了会把后半行挖没）',
    maskText('const r = a / b / c;'), 'const r = a / b / c;');
  push('T8 关键字后面接的正则要认出来（`return /x{/` 这一类）',
    maskText('const f = () => { return /x{2/.test(s); };').includes('x{2'), false);
  push('T9 字符串里的 URL 不许被当行注释（旧坑，留一条牙）',
    maskText('const u = "https://a.test/b"; const c = 1;').includes('https'), false);
  push('T10 balanced 的 end 就是那枚闭括号本身（消费者必须从 +1 起看，两把尺各踩过一次）',
    balanced('{ a }', 0).end, 4);
  push('T11 lineOf 从 1 起算，首行偏移读回 1',
    [lineOf('a\nb', 0), lineOf('a\nb', 2)], [1, 2]);
  push('T12 嵌套回调里的 return 不许当顶层 return（深度判据）',
    topLevelReturns('const x = f(() => { return 1; }); return 2;').map((r) => r.expr), ['2']);
  push('T13 空串与纯空白输入不许抛',
    [maskText('').length, balanced('', 0), topLevelReturns('').length], [0, null, 0]);
  const nums = labels.map((l) => Number(/^T(\d+)/.exec(l)?.[1] ?? 0));
  const seqOk = Math.max(...nums) === labels.length && new Set(nums).size === labels.length;
  console.log(`${seqOk ? '✅' : '🔴'} T14 臂编号连续且不重号（判的是上面 ${labels.length} 枚：最大号 ${Math.max(...nums)} ｜ 去重 ${new Set(nums).size}）`);
  if (!seqOk) bad.push(`T14 臂编号跳号或重号 ｜ 最大 ${Math.max(...nums)} ｜ 条数 ${labels.length}`);
  console.log(`\n臂数 ${labels.length + 1} ｜ 不符 ${bad.length}`);
  for (const b of bad) console.log(`🔴 ${b}`);
  process.exit(bad.length === 0 ? 0 : 1);
}
