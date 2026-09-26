#!/usr/bin/env node
/**
 * 界面语言门禁：文案必须走词条表，两种语言都必须真的翻了。
 * ======================================================
 *
 * ## 契约变更（2026-09）
 *
 * 本门禁**原来**的契约是一句话：**用户看得见的文案必须是中文。**
 * 它在单语时代是够用的，而且文件里逐条记着它踩过的坑（比较运算符造成的假红、
 * 三元里的假绿、模板字面量的已知边界）。
 *
 * 现在产品要中英双语，于是契约换成四条**更严**的：
 *
 *   1. **不许硬编码文案。** 已迁移的应用里，用户可见的字符串字面量一律违规，
 *      必须写成 `t('key')`。key 由 `@heyta/i18n` 的类型系统校验，
 *      拼错是编译错误，不是运行时的兜底降级。
 *   2. **zh 词条必须含中文** —— 防止用英文占位中文。
 *   3. **en 词条不许含中文** —— 防止把中文复制过去当英文交差。
 *      这条只能靠机器：人眼扫过两栏相同的文字，很容易以为"还没翻"而不是"翻错了"。
 *   4. **两份词条的 key 集合必须一致** —— 漏翻译必须在门禁上红。
 *
 * 这不是"放宽"，是"换了个更值钱的契约"：原来只保证"是中文"，
 * 现在保证"没有硬编码"且"两种语言都真翻了"。
 *
 * ## 为什么是分阶段迁移而不是一次性翻转
 *
 * 三个应用共 205 处文案（门禁口径）。一次性把规则翻过来，仓库会立刻全红，
 * 而**长期全红的门禁等于没有门禁**（AGENTS.md #25：一条会误报的门禁会教人忽略红色）。
 * 所以用 `MIGRATED_ROOTS` 逐个应用迁移：迁完一个加一个，
 * 未迁移的应用继续按旧规则（必须是中文）把关。全程 `pnpm check` 保持绿。
 *
 * ### 再进一步：逐**文件**迁移（`migratedFiles`）
 *
 * `apps/web` 是最后一个、也是最大的一壳（29 个源文件），而且**它同时被另一条
 * 工作流在改**。整个应用一次翻转意味着门禁要红很长一段时间，而这段时间里
 * 另一条工作流的每一次 `pnpm check` 都会看到与自己无关的红 —— 那正是
 * 上面说的"长期全红的门禁等于没有门禁"。
 *
 * 所以 `migrated` 从"整个根"细化到"根 + 一份已迁移文件清单"：
 * 列进 `migratedFiles` 的文件按规则 1（不许硬编码）管，其余仍按旧契约。
 * **规则一条都没松**，只是把开关的粒度调小了 —— 每个文件仍然只可能处在
 * 两种契约中的一种，不存在"两边都不管"的文件。
 *
 * 迁完之后把该根的 `migratedFiles` 清空、`migrated` 置 true（把清单收回一个布尔）。
 * 🔴 清单里的路径会**逐条校验存在性**：写错一个路径不会静默退回旧契约，
 * 而是直接让门禁非零退出 —— 否则"以为管住了，其实没管"是最坏的结果。
 *
 * ## 顺带修掉的一个盲区
 *
 * 旧门禁只从 **JSX 属性**（`title=` / `label=` / `placeholder=` …）和
 * **JSX 裸文本节点**（`>文案<`）里取候选。于是
 * `const SCREENS = [{ label: '四象限' }]` 这种**数据数组里的文案它完全看不到** ——
 * 而落地页的展厅、能力矩阵、自建步骤全是用这种形状写的，是真实用户可见的大头。
 *
 * 迁移模式下这不再有影响：凡是渲染出的字面量都要走 `t()`，
 * 数据数组里也一样（`label: t('landing.showcase.quadrant')`）。
 * 未迁移的应用仍按旧口径检查 —— 与改动前的行为**逐字相同**，不引入新的红。
 *
 * 用法：node scripts/check-ui-language.mjs
 *   非零退出 = 有违规。
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * 扫哪些目录，以及它是否**已经迁移**到词条表。
 *
 * - `migrated: true`  → 规则 1（不许硬编码文案）；
 * - `migrated: false` → 旧规则（用户可见文案必须是中文）。
 *
 * 迁移一个应用就把它的 `migrated` 改成 true。**两边都不能松**：
 * 未迁移不等于"没人管"，只是还在用旧契约。
 *
 * `migratedFiles` 是**逐文件**迁移的清单（仓库相对路径），用途见文件头：
 * 大应用在被另一条工作流同时修改时，一个文件一个文件地翻，门禁全程不红。
 * 单个文件仍然只属于一种契约：在清单里就走规则 1，不在就走旧契约。
 */
const ROOTS = [
  { dir: 'apps/landing/src', migrated: true },
  {
    // 🔴 第 16 轮：**整个 web 壳**都迁移完了，逐文件清单退休。
    //
    // 清单（`migratedFiles`）是给"某个大应用正被另一条工作流同时改"用的
    // 过渡装置 —— 让门禁不必长期全红。迁完就该收回一个布尔，
    // 否则它会变成一份**只会越长越长的白名单**：每加一个文件都要人来登记，
    // 而漏登记的后果是"这个文件其实没人管"。
    //
    // 收尾前逐文件核实过：`apps/web/src` 里已没有任何用户可见的字面量。
    // 剩下的非 ASCII 只有三类，都**不是文案**：
    //   1. 开发者诊断（`throw new Error('…')`）—— 候选只来自 JSX 属性 /
    //      JSX 文本节点，这些不在视野里，本来也不该翻；
    //   2. 解析中文标记的正则（`buildTimeline.ts` 的 `（依赖：X）`）——
    //      它匹配的是**用户笔记里的既有格式**，翻了反而解析不出来；
    //   3. 注释。
    dir: 'apps/web/src',
    migrated: true,
  },
  { dir: 'apps/mobile/src', migrated: true },
];

/**
 * 清单里的路径必须真实存在 —— 写错一个字母不能让那个文件**静默退回旧契约**。
 *
 * 这是"门禁自己也不能有盲区"的具体做法：路径写错的症状不是报错，
 * 而是"我明明迁了它却没人管"，那比红更难发现。所以在这里硬失败。
 */
{
  const bad = [];
  for (const root of ROOTS) {
    for (const rel of root.migratedFiles ?? []) {
      if (!rel.startsWith(`${root.dir}/`)) {
        bad.push(`${rel}（不在 ${root.dir} 下，写错了根）`);
        continue;
      }
      try {
        if (!statSync(join(ROOT, rel)).isFile()) bad.push(`${rel}（不是文件）`);
      } catch {
        bad.push(`${rel}（不存在）`);
      }
    }
  }
  if (bad.length > 0) {
    console.error('🔴 ROOTS.migratedFiles 里有无效路径，门禁拒绝运行：\n');
    for (const item of bad) console.error(`   ${item}`);
    console.error('\n   改法：修正路径，或删掉那一项。\n');
    process.exit(1);
  }
}

/** 词条表。规则 2/3/4 直接读这两份源文件 —— 不依赖构建产物。 */
const CATALOG_DIR = 'packages/i18n/src/locales';
const CATALOG_ZH = join(ROOT, CATALOG_DIR, 'zh-CN.ts');
const CATALOG_EN = join(ROOT, CATALOG_DIR, 'en.ts');

/**
 * zh 表里允许不含汉字的 key。
 *
 * 品牌名与语言自称这类纯拉丁词是**真实例外**，显式列出，而不是给整条规则开口子 ——
 * 开口子之后，"用英文占位中文"也能溜过去。
 */
const ZH_LATIN_OK = new Set(['common.brand', 'common.lang.en']);

/**
 * en 表里允许出现汉字的 key —— 只有**语言自称**（endonym）。
 *
 * 英文页面上的语言切换器必须显示「中文」：那正是给"看不懂英文"的用户准备的入口，
 * 写成 "Chinese" 对他就没有用了。所以 `common.lang.zh` 在中英两表里**刻意相同**。
 *
 * 🔴 这是"把中文复制过去当英文交差"的**唯一**正当例外，因此按 key 放行，
 * 而不是放宽规则 3 —— 放宽会让真正的偷懒也一起溜过去。
 */
const EN_ENDONYM_OK = new Set(['common.lang.zh']);

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
/** 有任何字母（含汉字）才算"文案"。纯符号/纯数字（`·`、`→`、`3`）不是文案。 */
const ANY_LETTER = /[A-Za-z\u3400-\u9FFF]/;

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

/**
 * 词条表的解析。
 *
 * ⚠️ 这是**按行**解析，不是 TS 解析器。它依赖词条表保持一个简单形状：
 * 一行一条、key 与 value 都用单引号、内部引号要转义。
 * 这个约束写在 `packages/i18n/src/locales/*.ts` 的文件头里。
 *
 * 🔴 关键设计：**解析到的条数必须等于"看起来像词条的行数"**，
 * 不等就报错退出。一个静默漏掉几行的解析器会给出**假绿** ——
 * 那正是这个文件开头警告过的那种门禁。
 */
const ENTRY = /^\s*'([^']+)':\s*'((?:[^'\\]|\\.)*)',?\s*$/;
const ENTRY_LIKE = /^\s*'[^']+':/;

function parseCatalog(file) {
  const src = readFileSync(file, 'utf8');
  const entries = new Map();
  let entryLikeLines = 0;
  for (const line of src.split('\n')) {
    if (ENTRY_LIKE.test(line)) {
      entryLikeLines += 1;
      const m = ENTRY.exec(line);
      if (m !== null) entries.set(m[1], m[2]);
    }
  }
  if (entries.size !== entryLikeLines) {
    console.error(
      `🔴 无法解析词条表：${relative(ROOT, file)}\n` +
        `   看起来像词条的行有 ${String(entryLikeLines)} 行，只解析出 ${String(entries.size)} 条。\n` +
        `   词条表必须保持"一行一条、key 与 value 都用单引号、内部引号转义"的形状。\n` +
        `   一个静默漏行的解析器会给出假绿，所以这里直接失败而不是继续。`,
    );
    process.exit(1);
  }
  return entries;
}

/** 规则 2/3/4：两份词条表互相约束。 */
function checkCatalogs() {
  const violations = [];
  const zh = parseCatalog(CATALOG_ZH);
  const en = parseCatalog(CATALOG_EN);
  const relZh = relative(ROOT, CATALOG_ZH);
  const relEn = relative(ROOT, CATALOG_EN);

  // 规则 4：key 集合必须一致（双向报，才能看出是漏了还是多了）。
  for (const key of zh.keys()) {
    if (!en.has(key)) {
      violations.push({
        where: `${relEn}`,
        text: key,
        why: '中文词条表里有这条，英文表里没有 —— 漏翻译',
        fix: `在 en.ts 补上 '${key}'。`,
      });
    }
  }
  for (const key of en.keys()) {
    if (!zh.has(key)) {
      violations.push({
        where: `${relZh}`,
        text: key,
        why: '英文词条表里有这条，中文表里没有 —— 多出来的 key',
        fix: `删掉它，或先在 zh-CN.ts 里加上 '${key}' 作为事实源。`,
      });
    }
  }

  // 规则 2：zh 必须含中文。
  for (const [key, value] of zh) {
    if (ZH_LATIN_OK.has(key)) continue;
    if (!CJK.test(value)) {
      violations.push({
        where: `${relZh}`,
        text: `${key} = ${value}`,
        why: '中文词条里一个汉字都没有',
        fix: '写成中文。确实是纯拉丁词的（如品牌名），加进 ZH_LATIN_OK 并说明理由。',
      });
    }
  }

  // 规则 3：en 不许含中文（语言自称除外，见 EN_ENDONYM_OK）。
  for (const [key, value] of en) {
    if (EN_ENDONYM_OK.has(key)) continue;
    if (CJK.test(value)) {
      violations.push({
        where: `${relEn}`,
        text: `${key} = ${value}`,
        why: '英文词条里出现了汉字 —— 很可能是把中文复制过来当英文',
        fix: '翻译成英文。',
      });
    }
  }

  return { violations, zhCount: zh.size, enCount: en.size };
}

const violations = [];
let scanned = 0;
let strings = 0;
let migratedStrings = 0;

// ── 先查词条表本身（规则 2/3/4）────────────────────────────────
const catalogResult = checkCatalogs();
violations.push(...catalogResult.violations);

// ── 再查组件源码（规则 1 或旧的中文规则）─────────────────────
for (const { dir: relRoot, migrated, migratedFiles } of ROOTS) {
  const staged = new Set((migratedFiles ?? []).map((p) => resolve(ROOT, p)));
  for (const file of walk(join(ROOT, relRoot))) {
    scanned += 1;
    const rel = relative(ROOT, file);
    const src = readFileSync(file, 'utf8');
    const lines = src.split('\n');
    /** 这个文件按哪种契约检查：整根已迁移，或它自己在逐文件清单里。 */
    const fileMigrated = migrated || staged.has(file);

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

      // 纯符号/纯数字不是文案：`>·<`、`>→<`、`>3<` 都不需要翻译。
      // 不加这条会让迁移后的应用被一堆装饰性字符刷红。
      if (!ANY_LETTER.test(text)) continue;

      strings += 1;
      const line = src.slice(0, index).split('\n').length;
      const where = `${rel}:${String(line)}`;

      // 规则（两种模式都适用）：内部标识符泄漏。
      const term = FORBIDDEN_TERMS.find((t) => text.includes(t));
      if (term !== undefined) {
        violations.push({
          where,
          text,
          why: `文案里出现了内部标识符「${term}」`,
          fix: '用用户能理解的说法替换。原始技术信息要保留的话，放进「技术细节：」这类明确标注的字段。',
        });
        continue;
      }

      if (fileMigrated) {
        // 🔴 迁移模式：一切用户可见的字面量都必须走 t()。
        // 判据是"这个字面量是不是 t() 的第一个实参" —— 看它前面是不是 `t(`。
        const before = src.slice(0, index);
        if (/\bt\(\s*$/.test(before)) continue; // 是 t('key')，合规
        migratedStrings += 1;
        violations.push({
          where,
          text,
          why: '硬编码文案 —— 已迁移的应用里，用户可见的字面量必须走 t()',
          fix: "改成 {t('some.key')}，并在 packages/i18n/src/locales/zh-CN.ts 与 en.ts 各加一条词条。",
        });
        continue;
      }

      // ── 旧模式：用户可见文案必须是中文 ──────────────────────
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
        fix: '改成中文；或把它迁移到 packages/i18n 的词条表（整个应用迁完就把该根加进 MIGRATED；大应用在被别的分支同时改时，可以先把这一个文件加进该根的 migratedFiles）。',
      });
    }
  }
}

const migratedApps = ROOTS.filter((r) => r.migrated).map((r) => r.dir);
const stagedFiles = ROOTS.flatMap((r) => (r.migrated ? [] : (r.migratedFiles ?? [])));

if (violations.length === 0) {
  const parts = [];
  if (migratedApps.length > 0) parts.push(`已迁移：${migratedApps.join('、')}`);
  if (stagedFiles.length > 0) parts.push(`逐文件迁移 ${String(stagedFiles.length)} 个（apps/web/src）`);
  const mode = parts.length === 0 ? '全部按旧契约（中文）检查' : `${parts.join('；')}；其余按旧契约（中文）`;
  console.log(
    `✅ 文案合规（扫描 ${String(scanned)} 个文件、${String(strings)} 处文案；` +
      `词条表 zh ${String(catalogResult.zhCount)} 条 / en ${String(catalogResult.enCount)} 条；${mode}）。`,
  );
  process.exit(0);
}

console.error(`🔴 有 ${String(violations.length)} 处不合规：\n`);
for (const v of violations) {
  console.error(`   ${v.where}`);
  console.error(`      文案：${v.text}`);
  console.error(`      问题：${v.why}`);
  console.error(`      改法：${v.fix}\n`);
}
if (migratedStrings > 0) {
  console.error(`   其中 ${String(migratedStrings)} 处属于"已迁移应用里的硬编码文案"。\n`);
}
process.exit(1);
