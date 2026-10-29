#!/usr/bin/env node
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

/** 注释与单/双引号字符串换成等长空格；模板串不动（里面的 `${}` 会跟着看不见，代价在探针头里各自写明）。 */
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
