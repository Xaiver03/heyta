/**
 * 轻量 JSX 元素树 —— 门禁共用的只读工具
 * ======================================
 *
 * 这一层**不做语法分析，也不做类型检查**。它只回答一个问题：
 * **「这段 JSX 里，哪个元素的 range 是 `start..end`，它包住了谁？」**
 *
 * 它从 `scripts/check-row-single-source.mjs` 里抽出来（原来是那个脚本的私有实现），
 * 由 `scripts/check-ui-provider.mjs` 复用 —— 目的是让"JSX 子树"这件事
 * **只有一份定义**。本仓库反复吃过的亏就是同一件事写两遍，然后两份漂移。
 *
 * 用到的门禁：
 *   - `check-row-single-source.mjs`：断言「任务行的实现只有一份」，
 *     取**最内层**同时含三种信号的那个元素当"任务行"；
 *   - `check-ui-provider.mjs`：断言「需要主题 Provider 的消费者必须在
 *     `<HeytaUiProvider>` 的 JSX 子树**之内**」，按配对的开/闭标签算 Provider 的 range。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 为什么必须自己搭这一棵（而不是正则找 `<X>`）
 * ─────────────────────────────────────────────────────────────────────────
 *
 * 「在 provider 的子树之内」与「文本里出现过 provider」是两件不同的事 ——
 * 后者正是 2026-09-28 放跑那次真实崩溃的判据（provider 只包了 `tasks` 一棵树，
 * focus 是它的兄弟节点，打开专注页运行时抛
 * 「useHeytaUiTheme 必须在 <HeytaUiProvider> 内使用」）。
 * 要判"之内"，就必须有配对的 range。
 *
 * 只认**配对的开/闭标签**，不认缩进、不认注释；所以它便宜、也不会因为
 * 格式化（prettier 重排）而失效。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 已知边界（实测过，写下来免得起重蹈）
 * ─────────────────────────────────────────────────────────────────────────
 *
 * 1. **`maskSource` 不解析正则字面量**：`/a<b/` 这类 regex 里的 `<` 可能被
 *    当标签开头。本仓库的 JSX 文件里没有这种写法，所以不值得为它加一个
 *    真正的词法器。真出现时症状是"range 错位"而不是崩溃。
 * 2. **未闭合的标签**用文件末尾收口（`stack` 清空），避免 range 悬空。
 *    调用方若需要"解析失败要报错"，应自己检查扫出的元素是否齐 ——
 *    `check-ui-provider.mjs` 就为 Provider 做了这件事（看起来有 Provider
 *    但扫不出它的 range = 报错，而不是跳过）。
 * 3. **不做组件边界分析**：一个 range 里可能同时含多个组件的 JSX。
 *    本工具只回答"这个元素包住了哪些字符"，组件语义由调用方自己解析。
 */

/**
 * 生成两份**等长**的掩码文本：
 *
 *   - `structural`：注释与字符串内容都抹成空格 —— 用来找标签边界。
 *     字符串里的 `<` 不会把标签扫描带偏，`//` 注释里的 `<div>` 也不会。
 *   - `code`：只抹注释，**保留字符串** —— 用来匹配信号。
 *     `accessibilityRole="checkbox"` 的值在字符串里，抹掉就永远匹配不到了。
 *
 * 掩码不改变长度，所以两边的 offset 一一对应。
 */
export function maskSource(text) {
  const structural = text.split('');
  const code = text.split('');
  const n = text.length;
  const blank = (from, to) => {
    for (let k = from; k < to && k < n; k++) {
      if (text[k] !== '\n') structural[k] = ' ';
    }
  };

  let i = 0;
  while (i < n) {
    const c = text[i];
    // 行注释
    if (c === '/' && text[i + 1] === '/') {
      let j = i;
      while (j < n && text[j] !== '\n') j++;
      blank(i, j);
      for (let k = i; k < j; k++) code[k] = ' ';
      i = j;
      continue;
    }
    // 块注释
    if (c === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      const j = end === -1 ? n : end + 2;
      blank(i, j);
      for (let k = i; k < j; k++) code[k] = ' ';
      i = j;
      continue;
    }
    // 字符串 / 模板串：内容抹进 structural，保留在 code
    if (c === '"' || c === "'" || c === '`') {
      let j = i + 1;
      while (j < n) {
        if (text[j] === '\\') {
          j += 2;
          continue;
        }
        if (text[j] === c) {
          j += 1;
          break;
        }
        j += 1;
      }
      blank(i + 1, j);
      i = j;
      continue;
    }
    i++;
  }
  return { structural: structural.join(''), code: code.join('') };
}

/**
 * `<` 是不是一个 JSX 标签的开头？
 *
 * 🔴 必须排除 TS 泛型：`useState<Foo>()` 里的 `<` 后面是 `F`，
 * 不排除的话会被当成 `<Foo>` 标签，栈立刻失衡，整棵树的 range 全错，
 * 于是门禁要么漏报要么乱报 —— 而它**不会崩**，那才是最坏的一种失效。
 * 判据：前一个非空字符不能是标识符字符（`a<B>` 是泛型，`= <B>` 是 JSX）。
 */
export function isTagOpen(structural, i) {
  const next = structural[i + 1];
  if (next !== '/' && next !== '>' && !/[A-Za-z]/.test(next ?? '')) return false;
  let p = i - 1;
  while (p >= 0 && (structural[p] === ' ' || structural[p] === '\t')) {
    // 空格两边都合法（`return <div>` 是 JSX；`a < b` 已被 next 的判据挡掉）。
    p--;
  }
  if (p < 0) return true;
  const prev = structural[p];
  return !/[A-Za-z0-9_$)\]]/.test(prev);
}

/** 找到标签的 `>`，跳过 `{…}` 里的对象字面量（`style={{…}}`）。 */
export function findTagEnd(structural, from) {
  let depth = 0;
  for (let j = from; j < structural.length; j++) {
    const c = structural[j];
    if (c === '{') depth++;
    else if (c === '}') depth = Math.max(0, depth - 1);
    else if (c === '>' && depth === 0) return j;
  }
  return -1;
}

/**
 * 扫出一棵树。返回每个 JSX 元素的 `{ start, end }`（在原文里的 range）。
 * 只用配对的开/闭标签定 range，不做语法分析 —— 目标是"同一棵子树"这件事，
 * 不是编译。
 *
 * 返回 `{ nodes, code }`；`code` 是"只抹了注释"的掩码文本，调用方拿它匹配信号。
 */
export function scanJsxTree(text) {
  const { structural, code } = maskSource(text);
  const nodes = [];
  const stack = [];
  const n = structural.length;

  let i = 0;
  while (i < n) {
    if (structural[i] !== '<' || !isTagOpen(structural, i)) {
      i++;
      continue;
    }
    const next = structural[i + 1];

    // 片段 `<>` / `</>`
    if (next === '>') {
      const node = { name: 'Fragment', start: i, end: i + 2 };
      nodes.push(node);
      stack.push(node);
      i += 2;
      continue;
    }
    if (next === '/') {
      const gt = structural.indexOf('>', i);
      if (gt === -1) break;
      const raw = structural.slice(i + 2, gt).trim();
      // 🔴 `</>` 的 name 是空串，必须映射回打开片段时的 `'Fragment'`，
      // 否则片段永远不被闭合，它的 range 会一路吃到文件尾。
      const name = raw === '' ? 'Fragment' : raw;
      // 从栈顶往下找同名开标签；找不到就丢弃（可能来自泛型误判）。
      for (let s = stack.length - 1; s >= 0; s--) {
        if (stack[s].name === name) {
          for (let t = stack.length - 1; t >= s; t--) stack.pop().end = gt + 1;
          break;
        }
      }
      i = gt + 1;
      continue;
    }

    const gt = findTagEnd(structural, i);
    if (gt === -1) break;
    const selfClosing = structural[gt - 1] === '/';
    const nameMatch = /^<([A-Za-z][\w.$]*)/.exec(structural.slice(i, gt + 1));
    const node = {
      name: nameMatch === null ? 'Unknown' : nameMatch[1],
      start: i,
      end: gt + 1,
    };
    nodes.push(node);
    if (!selfClosing) stack.push(node);
    i = gt + 1;
  }

  // 没闭合的（文件末尾截断等）用文件末尾收口，避免 range 悬空。
  while (stack.length > 0) stack.pop().end = n;

  return { nodes, code };
}

/** offset → 1-based 行号。 */
export function lineAt(text, offset) {
  let line = 1;
  for (let i = 0; i < offset && i < text.length; i++) {
    if (text[i] === '\n') line++;
  }
  return line;
}
