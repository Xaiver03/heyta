#!/usr/bin/env node
/**
 * 界面语言门禁：用户看得见的文案必须是中文。
 * ==========================================
 *
 * 需求是明确的：**整个应用都是中文的**。
 *
 * 但"检查文案语言"这件事看起来没法自动化 —— 直到把它拆成两条**具体形状**，
 * 而这两条都来自真实出现过的问题：
 *
 *   1. **整句英文的文案。** 只要一段用户可见文本里一个汉字都没有、
 *      却有两个以上连续的拉丁字母，那它就不是中文文案。
 *      （纯 URL、版本号这类例外由白名单放行。）
 *
 *   2. **技术标识符漏进界面。** 我实际写出过 `numeric-display 样式`
 *      和 `重放本地 op 日志` —— 它们**夹在中文里**，第一条规则抓不到，
 *      但用户看到的是我们内部的变量名和缩写。这属于把实现细节泄漏给用户。
 *
 * 为什么必须做成门禁而不是"注意一下"：文案是**最容易在后续提交里回退**的东西。
 * 加一个新屏幕时顺手写一句英文，没有任何测试会红；等到发现时，
 * 已经散落在几十个文件里，而且没人知道哪些是有意为之。
 *
 * 用法：node scripts/check-ui-language.mjs
 *   非零退出 = 有违规。
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** 扫哪些目录。`apps/*` 是外壳，也就是所有界面文案所在的地方。 */
const ROOTS = ['apps/web/src', 'apps/mobile/src'];

const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', 'Pods', '.gradle', '.cxx']);

/**
 * 用户可见文案的**来源**。只有这些位置的字符串才会被渲染给用户。
 *
 * ⚠️ 这个正则要求 `=` 后面**紧跟**引号/反引号 —— 它只看得到字面量。
 * `prop={a ? \`A\` : \`B\`}` 这种形状由下面的 `TEXT_PROP_BRACES` 负责，
 * 两者**刻意不重叠**（这里不再带 `(?:\{\s*)?`），否则同一条文案会被数两遍。
 */
const TEXT_PROPS =
  /\b(?:title|label|hint|detail|placeholder|accessibilityLabel|message)\s*=\s*["'`]([^"'`]*)["'`]/g;

/**
 * `prop={ ... }` 形式里的文案。
 *
 * 🔴 加这个 pass 是因为**实测发现了一整类盲区**（2026-09，写重复任务时）：
 * 把一句纯英文放在 `label="Open task now please"` 上，门禁会红；
 * 把**同一句**放进 `label={x ? \`…\` : \`Open task now please\`}` 里，
 * 门禁**一个字都看不到**，报告照旧是"✅ 界面文案全为中文"。
 *
 * 触发它很不起眼：我只把一处无障碍名从单条字面量改成了两种状态的三元表达式
 * （因为重复任务要念出"重复：每周"），统计数从 106 掉到 105 ——
 * **加了一句文案，被扫描的文案反而少了一句**。那个反向的差值是唯一的信号。
 *
 * 一门"看着在管文案、实则有一整类写法从它下面穿过去"的门禁，
 * 比没有门禁更危险：它给出的是**假绿**。所以这里补上，
 * 并按 §8.3 用"三元里塞纯英文"验证过它**真的会红**。
 *
 * 实现是**花括号配平**扫描，不是 JS 解析器：从 `prop={` 的 `{` 走到配对的那个，
 * 把这跨度内每一个字符串/模板字面量都当候选。`${...}` 交给
 * `stripTemplateExpressions` 处理（那是另一条已知且已记录的边界）。
 */
const TEXT_PROP_BRACES =
  /\b(?:title|label|hint|detail|placeholder|accessibilityLabel|message)\s*=\s*\{/g;

/**
 * 收集 `{` 之后所有**会被渲染**的字符串/模板字面量，直到花括号配平。
 *
 * 🔴 **第一个版本把跨度里每一个字面量都当成文案，立刻产生了假红**：
 * `aria-label={theme === 'light' ? '切换到暗色主题' : '切换到亮色主题'}`
 * 里的 `'light'` 是**比较操作数**，用户永远看不到它，门禁却报
 * "文案「light」里一个汉字都没有"。
 *
 * 规则改成：**字面量前面那个非空白字符是 `=` 就跳过**。
 * 这一条同时覆盖赋值（`const x = 'a'`）与全部比较运算符
 * （`=` / `==` / `===` / `!=` / `!==` 都以 `=` 结尾）——
 * 这些位置的字面量一定是代码里的判别值，不是给用户看的字。
 *
 * 保留的位置正是三元的分支：`` cond ? `A` : `B` `` 里 `A` 前面是 `?`、
 * `B` 前面是 `:`，都不受影响。
 *
 * ⚠️ 已知边界：模板字面量是**整体**跳过的，所以 `` `${x ? '完成' : '取消'}` ``
 * 里的英文看不到 —— 与 `stripTemplateExpressions` 文件里记的那条局限同源
 * （把英文藏进表达式需要写真的解析器，而那是在刻意绕过门禁，不是在漏看规范）。
 */
function literalsInBraces(src, openBraceIndex) {
  const found = [];
  let i = openBraceIndex + 1;
  let depth = 1;
  while (i < src.length && depth > 0) {
    const ch = src[i];
    if (ch === '{') {
      depth += 1;
      i += 1;
      continue;
    }
    if (ch === '}') {
      depth -= 1;
      i += 1;
      continue;
    }
    if (ch === '`' || ch === "'" || ch === '"') {
      const quote = ch;
      const start = i;
      let value = '';
      let j = i + 1;
      while (j < src.length && src[j] !== quote) {
        if (src[j] === '\\') {
          // 转义字符整体跳过：`\'` 里的引号不是收尾
          value += src[j] + (src[j + 1] ?? '');
          j += 2;
          continue;
        }
        value += src[j];
        j += 1;
      }
      // 比较/赋值右侧的字面量不是文案（见本函数上半段的假红记录）。
      const before = src.slice(openBraceIndex + 1, start);
      if (!/=\s*$/.test(before)) found.push({ value, index: start });
      i = j + 1;
      continue;
    }
    i += 1;
  }
  return found;
}

/**
 * JSX 里的裸文本节点：`>文案<`。
 *
 * 🔴 这个字符类是**刻意收紧的**，第一版写成 `[^<>{}]` 时误报一片：
 * `useState([]);\n const [error, setError] = useState<...>` 里的
 * `>...<` 也被当成了文案。泛型的 `>` 与下一个泛型的 `<` 之间夹着代码，
 * 而"看起来像文案"的判据是**没有代码标点**：
 * `( ) [ ] { } ; = ? ! | & " ' \`` 以及换行，任何一个出现就不是文案。
 *
 * 🔴 还需要 `(?<!=)`：箭头函数的返回类型 `=> Promise<void>` 形状**完全就是**
 * `>文案<` —— `>`、空格、`Promise`、`<`。实测它一次性制造了 22 条误报。
 * 泛型里 `>` 后面跟的永远不是文案，而是类型名，所以按"前面是不是 `=`"来排除。
 *
 * 代价是同一行里带这些符号的真文案会被漏掉 —— 但漏报好过误报，
 * 因为**一条会误报的门禁会教人忽略红色**（见 AGENTS.md #25）。
 */
const JSX_TEXT = /(?<!=)>[ \t]*([^<>{}()[\];=?!|&"'\`\n][^<>{}()[\];=?!|&"'\`\n]*?)[ \t]*</g;

/**
 * 允许出现在用户文案里的拉丁串。
 *
 * 刻意很短 —— 每加一条都要问"用户真的需要看到这个英文吗"。
 */
const ALLOWED = [
  /^heyta$/i, // 品牌名
  /^https?:\/\//, // URL
  /^\d+(\.\d+)*$/, // 版本号 / 数字
  /^[A-Z]{2,4}$/, // 缩写，如 IP / URL —— 中文技术语境里通用
];

/**
 * 🔴 不得出现在**用户可见文案**里的内部标识符。
 *
 * 它们是给开发者看的：变量名、包名、协议名、运行时 API。
 * 用户既看不懂，也没法据此做任何事。
 */
const FORBIDDEN_TERMS = [
  'numeric-display',
  'op-log',
  'op log',
  'op 日志',
  'SQLite',
  'IndexedDB',
  'E2EE',
  'JWT',
  'OAuth',
  'Passkey',
  'Hermes',
  'JSON',
  'Promise',
  'undefined',
  'null',
];

const CJK = /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\u3000-\u303F\uFF00-\uFFEF]/;
const LATIN_RUN = /[A-Za-z]{2,}/;

/**
 * 去掉模板字面量里的 `${...}` 表达式，只留下**写死在源码里的那段字**。
 *
 * 🔴 不这么做会产生**假红**，而假红和假绿一样有害 —— 它教人忽略这个门禁。
 * 实测（移动端日历，2026-09）：
 *
 *   accessibilityLabel={`${formatDayTitle(date)}${n > 0 ? `，${n} 个任务` : '，没有任务'}`}
 *
 * 渲染出来是「9月26日 星期六，3 个任务」，**全是中文**；
 * 但旧提取器在第一个反引号处截断，拿到一段没有汉字的片段，报"一个汉字都没有"。
 *
 * 本规则真正要表达的是"**源码里写死的**那段字有没有中文"：
 *   - `label="Add task"`            → 写死的英文，必须拦；
 *   - ``label={`Add task ${x}`}``   → 去掉表达式后还剩 `Add task`，必须拦；
 *   - ``label={`${x}`}``            → 去掉后为空，用户看到什么完全由 `x` 决定，
 *                                     而 `x` 自己在它被定义的地方受检。
 *
 * ⚠️ 已知局限（故意的，不修）：`` `${'Add task'}` `` 这种把英文藏在表达式内部的
 * 写法会漏过本规则。为它写一个 JS 解析器不划算；而且那么写的人是在
 * 刻意绕过门禁，不是漏看了一条规范。
 */
function stripTemplateExpressions(text) {
  let out = '';
  let depth = 0;
  let quote = null;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (depth > 0) {
      // 在 `${...}` 内部：必须跳过字符串与嵌套模板，
      // 否则 `'}'` 里的那个花括号会被当成表达式的收尾。
      if (quote !== null) {
        if (ch === '\\') i += 1;
        else if (ch === quote) quote = null;
        continue;
      }
      if (ch === "'" || ch === '"' || ch === '`') quote = ch;
      else if (ch === '{') depth += 1;
      else if (ch === '}') depth -= 1;
      continue;
    }
    if (ch === '$' && text[i + 1] === '{') {
      depth = 1;
      i += 1;
      continue;
    }
    out += ch;
  }
  return out;
}

function* walk(dir) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) yield* walk(full);
    else if (/\.(tsx?|jsx?)$/.test(name) && !/\.(spec|test)\./.test(name)) yield full;
  }
}

const violations = [];
let scanned = 0;
let strings = 0;

for (const relRoot of ROOTS) {
  for (const file of walk(join(ROOT, relRoot))) {
    scanned += 1;
    const rel = relative(ROOT, file);
    const src = readFileSync(file, 'utf8');
    const lines = src.split('\n');

    /** 每个候选文案带上它在原文里的偏移，好算出行号。 */
    const candidates = [];
    for (const re of [TEXT_PROPS, JSX_TEXT]) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(src)) !== null) {
        candidates.push({ value: m[1], index: m.index });
      }
    }

    // `prop={ ... }`：`TEXT_PROPS` 看不到这种形状（见它的注释）。
    TEXT_PROP_BRACES.lastIndex = 0;
    let braceMatch;
    while ((braceMatch = TEXT_PROP_BRACES.exec(src)) !== null) {
      const openBrace = braceMatch.index + braceMatch[0].length - 1;
      for (const lit of literalsInBraces(src, openBrace)) candidates.push(lit);
    }

    for (const { value, index } of candidates) {
      // ⚠️ 判据用**去掉 `${...}` 之后**的那段字，不是原始片段 ——
      // 否则完全由表达式拼出来的中文文案会被误报成"没有汉字"（见
      // `stripTemplateExpressions` 的注释里那个真实例子）。
      const text = stripTemplateExpressions(value).trim();
      if (text === '') continue;
      strings += 1;

      const line = src.slice(0, index).split('\n').length;
      const where = `${rel}:${String(line)}`;

      // 规则 2：内部标识符泄漏（夹在中文里也算）。
      const term = FORBIDDEN_TERMS.find((t) => text.includes(t));
      if (term !== undefined) {
        violations.push({
          where,
          text,
          why: `文案里出现了内部标识符「${term}」`,
          fix: '用用户能理解的中文说法替换。原始技术信息要保留的话，放进「技术细节：」这类明确标注的字段。',
        });
        continue;
      }

      // 规则 1：整句拉丁文，没有任何汉字。
      if (CJK.test(text)) continue;
      if (!LATIN_RUN.test(text)) continue;
      if (ALLOWED.some((re) => re.test(text))) continue;

      const excerpt = lines[line - 1]?.trim() ?? '';
      // 只跳过明显是代码的行（类型标注、import 等被正则误抓的情况）。
      if (/^\s*(?:\/\/|\*|\/\*)/.test(excerpt)) continue;

      violations.push({
        where,
        text,
        why: '用户可见文案里一个汉字都没有',
        fix: '改成中文。确实需要保留原文的（如原始错误信息），加中文前缀说明它是什么。',
      });
    }
  }
}

if (violations.length === 0) {
  console.log(
    `✅ 界面文案全为中文（扫描 ${String(scanned)} 个文件、${String(strings)} 处文案）。`,
  );
  process.exit(0);
}

console.error(`🔴 有 ${String(violations.length)} 处文案不符合中文要求：\n`);
for (const v of violations) {
  console.error(`   ${v.where}`);
  console.error(`      文案：${v.text}`);
  console.error(`      问题：${v.why}`);
  console.error(`      改法：${v.fix}\n`);
}
process.exit(1);