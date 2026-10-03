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
 *   2. **每种语言的词条必须含它自己的文字**（zh 含汉字、ja 含假名、ko 含谚文）
 *      —— 防止用别的语言占位。
 *   3. **不许把中文复制过去当英文**（en 表不许出现汉字/全角标点）。
 *      这条只能靠机器：人眼扫过两栏相同的文字，很容易以为"还没翻"而不是"翻错了"。
 *   4. **各语言词条的 key 集合必须与中文表一致** —— 漏翻译必须在门禁上红。
 *   6. **语言清单只有一个事实源**（`LOCALES`）：`locales/*.ts` 的文件、`LOCALES`、
 *      文字系统规则表三者必须一一对应，两个方向都对不上就红。
 *      🔴 加一门语言而不在规则表里登记"它怎么证明自己被翻过" ⇒ 红，
 *      而不是"新表什么都不查、门禁照样绿"。
 *   5. **诊断字段不许装句子。** 已迁移应用里 `reason:` / `detail:` / `cause:`
 *      的字符串字面量**不能含中文**。它不是给用户看的文案，而是**塞进已翻译句子里的参数**
 *      （`t('…saveFailed', { reason })` → 「Could not save the focus record: 未知的专注类型」）。
 *      上面那三条 pass 看不见它：候选只来自 JSX 属性与 JSX 裸文本节点，
 *      而 `.ts` 里 `return { reason: '不是安全上下文' }` 这种**对象字面量的值**根本不在视野里。
 *      这正是 P1-4 修掉的那一类泄漏（推送的 17 处 + 专注的校验异常），
 *      所以规则要钉在**形状**上而不是钉在那两个文件上：下一个壳再写一句中文原因，一样会红。
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

import { execFileSync } from 'node:child_process';
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

/**
 * 词条表。规则 2/3/4 直接读源文件 —— 不依赖构建产物。
 *
 * 🔴 **语言清单不在这里写死。** 它只有一个事实源：`packages/i18n/src/types.ts`
 * 的 `export const LOCALES`。原来这里钉着 `CATALOG_ZH` / `CATALOG_EN` 两个常量，
 * 于是加一门语言要同时改四处（`LOCALES`、`locales/` 下的新表、本门禁、
 * `gen-server-copy`），而**改了三处的门禁比没有门禁更糟** —— 新语言那份表
 * 一个字都没被检查，`pnpm check` 却照样绿。这一层现在从 `LOCALES` 派生要查哪些表，
 * 并把**文件 ↔ LOCALES** 两个方向都钉住（见 `checkCatalogs`）。
 */
const CATALOG_DIR = 'packages/i18n/src/locales';
const LOCALES_SOURCE = join(ROOT, 'packages/i18n/src/types.ts');

/**
 * key 集合的锚点：中文表是事实源（`MessageKey` 由它派生，其余表
 * `satisfies Record<MessageKey, string>`）。
 * ⚠️ 类型层已经会拦"漏一条"，本门禁查的是**不依赖 tsc** 的那一半 ——
 * 单独跑 `node scripts/check-ui-language.mjs` 时它是唯一在查的东西。
 */
const REFERENCE_LOCALE = 'zh-CN';

/**
 * 从 `types.ts` 读语言清单。
 *
 * 🔴 解析不出来必须**响亮失败**：空清单在这里等于"没有表要查"，
 * 而"没有违规"和"够不着"在退出码上长得一模一样。
 */
function readLocales() {
  const src = readFileSync(LOCALES_SOURCE, 'utf8');
  const decl = /export const LOCALES\s*=\s*\[([^\]]*)\]/.exec(src);
  const locales =
    decl === null ? [] : [...decl[1].matchAll(/'([^']+)'/g)].map((match) => match[1]);
  if (locales.length === 0) {
    console.error(
      `🔴 无法从 ${relative(ROOT, LOCALES_SOURCE)} 解析 \`export const LOCALES\`。\n` +
        '   词条表检查要查哪些语言来自它。解析不出来**不是"没有语言要查"**，\n' +
        '   而是本门禁够不着 —— 所以直接失败，而不是继续给一个绿。\n' +
        '   改法：把 LOCALES 保持成 `export const LOCALES = [...] as const` 的形状。',
    );
    process.exit(1);
  }
  return locales;
}

/**
 * 文字系统的判据（按 locale，逐条真判断，不继承）。
 *
 * 🔴 为什么**不能**用一条 `CJK` 通吃：`CJK` 含 CJK 标点与全角字符
 * （`\u3000-\u303F` / `\uFF00-\uFFEF`），所以它不是"是不是中文"的判据。
 * 日语合法地使用汉字 —— "ja 不许含汉字"会把**正确翻译**判红；
 * 反过来"ja 必须含 CJK"会把纯拉丁的偷懒（把英文原样复制过去）放过。
 * **假名**才是"这门语言真的翻过"的信号，韩语同理（谚文）。
 *
 * 🔴 加一门语言而不在这里登记 ⇒ 判红（同 `check-ai-coverage` 的 `E2EE_COPY_RULES`）：
 * 成本是刻意的，它逼人为"这门语言怎么证明自己被翻过"做一次真判断，
 * 而不是悄悄落到"什么都不检查"那一档。
 *
 * `ja` / `ko` 两行**已登记但还没启用**（`LOCALES` 里没有它们，`locales/` 下也没有表）——
 * 这是"准备好但先不做"里"准备好"的那一半：规则先来，翻译后到。
 * 它们不会被静默忽略，会打印成一条待办（见 `checkCatalogs` 末尾的 notes）。
 */
const HAN = /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/;
const KANA = /[\u3041-\u309F\u30A1-\u30FF]/;
const HANGUL = /[\uAC00-\uD7A3]/;

/**
 * 汉字 + CJK 标点 + 全角字符。**规则 3 与规则 5 共用**（原来定义在下面扫描器那一段，
 * 挪到这里是因为词条表的规则表要在初始化时引用它）。
 */
const CJK = /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\u3000-\u303F\uFF00-\uFFEF]/;

const LOCALE_SCRIPT_RULES = {
  'zh-CN': { mustContain: HAN, scriptName: '汉字', forbidden: null },
  // en 的 forbidden 用 CJK 而不是 HAN：全角标点（`，。`）同样是"把中文复制过来"的证据。
  en: { mustContain: null, forbidden: CJK, forbiddenName: '汉字或全角标点' },
  // ja 不设 forbidden：汉字是日语的正字法之一，"不许含汉字"是错的判据。
  ja: { mustContain: KANA, scriptName: '假名', forbidden: null },
  ko: { mustContain: HANGUL, scriptName: '谚文', forbidden: null },
};

/**
 * 任何语言里都**不许翻译**的 key（值逐字相同才是对的）。
 *
 * 原来这张表叫 `ZH_LATIN_OK`（"zh 允许不含汉字"）—— 那是同一条判据的单语言写法。
 * 判据本身与目标语言无关：**把它写成本地语言会让它失去作用**。
 *
 * ── 站点「平台状态」页的两类例外（2026-09-28 加）
 *
 *   1. **平台名**（`Web` / `Android` / `iOS` / `HarmonyOS`）——
 *      它们在各版里**必须逐字相同**。把 Android 写成「安卓」，
 *      用户拿这个词去搜不到任何东西：官方文档、报错信息、应用商店里
 *      写的都是 Android。这是**产品名，不是普通名词**。
 *   2. **可复现的命令与文件路径**（`pnpm verify:*`、`node scripts/*.mjs`、
 *      `server/docker-compose.yml`）—— 它们是**给用户照着敲的**。
 *      翻译它等于把命令改坏：用户复制过去会 `command not found`，
 *      而这恰好是这一页承诺"每条都能自己验"的那部分。
 *
 * 🔴 不满足上面那条判据的，一律不许进这张表。
 * （`common.lang.*` 原来也逐条登记在这里，现在由自称策略推导，见 `isForeignEndonym`。）
 */
const UNTRANSLATABLE_KEYS = new Set([
  'common.brand',
  // 平台名（产品名，不是普通名词）
  'site.platforms.web.name',
  'site.platforms.android.name',
  'site.platforms.ios.name',
  'site.platforms.harmony.name',
  // 技术缩写：中文语境里本来就这么写（写成「人工智能」反而让缩写对不上）
  'site.pricing.compare.row.ai',
]);

/**
 * 🔴 `*.evidence` 走**按后缀**的例外，而不是逐条登记 —— 因为它的值是**契约**。
 *
 * 那个契约的执法者是 `scripts/check-claims.mjs`：
 * **`*.evidence` 的值只能是命令 / 仓库内路径 / 绝对地址，不许出现汉字**
 * （出现了就判红，理由写在那个脚本的文件头）。也就是说：
 * 这里要是坚持"zh 必须含汉字"，两条门禁就会互相矛盾 ——
 * 而人遇到矛盾的第一反应是把其中一条关掉。
 *
 * 所以后缀例外是**同一份契约的另一面**，而不是给规则开口子：
 * 名字必须明说它装的是证据，而"用英文占位中文"不会恰好取这种名字。
 * 平台名（`site.platforms.*.name`）仍然逐条登记 —— 它们是产品名，
 * 与这份契约无关。
 */
const EVIDENCE_KEY_SUFFIX = /\.evidence$/;

/**
 * 语言**自称**（endonym）：`common.lang.<locale>`。
 *
 * 策略（两份表的注释里都写着）：切换器用**目标语言自己的文字**显示那个语言名 ——
 * 中文界面显示 `English`，英文界面显示 `中文`。理由是看不懂当前语言的人
 * 恰恰最需要找到这个入口，把"英文"翻译成当前语言会把他挡在门外。
 *
 * 🔴 由此得到一条**可推导**的豁免：`common.lang.X` 在**非 X** 的表里必然不是
 * 本表文字（它就是为了让 X 的用户认出来），所以：
 *   - 豁免 `mustContain`（ja 表里 `common.lang.en` = `'English'` 没有假名，是对的）；
 *   - 豁免 `forbidden`（en 表里 `common.lang.ja` = `'日本語'` 含汉字，也是对的）。
 * 而 **X 自己的表不豁免** —— 那条正好是"自称写对了文字"的判据
 * （ko 表里 `common.lang.ko` 必须含谚文）。
 *
 * 为什么推导而不是逐条列表：逐条列表加一门语言要改 N 张表，忘了就得到**假红**；
 * 推导只依赖一条 —— "X 必须在 `LOCALES` 里"。
 * 🔴 所以它**不是**"整族放行"：`common.lang.fr` 不在 LOCALES 里 ⇒ 不豁免，
 * 一个拼错/还没启用的语言名会红，而不是被放过。
 *
 * ⚠️ key 的后缀是**语言**而不是 locale id（`common.lang.zh`，不是 `zh-CN`），
 * 所以这张表把两种写法都登记上：`zh` 与 `zh-CN` 都指向 `zh-CN`。
 * 后缀登记不进来的（打错的、或还没进 LOCALES 的）一律不豁免。
 */
const ENDONYM_KEY = /^common\.lang\.([a-zA-Z-]+)$/;

/** locale → 它自称用的后缀：`['zh-CN','en']` ⇒ `{zh:'zh-CN', 'zh-CN':'zh-CN', en:'en'}`。 */
function endonymSuffixMap(locales) {
  const map = new Map();
  for (const locale of locales) {
    map.set(locale, locale);
    const [primary] = locale.split('-');
    if (!map.has(primary)) map.set(primary, locale);
  }
  return map;
}

function isForeignEndonym(key, locale, suffixMap) {
  const match = ENDONYM_KEY.exec(key);
  if (match === null) return false;
  const target = suffixMap.get(match[1]);
  return target !== undefined && target !== locale;
}

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
 * 规则 5 的候选：**诊断字段**的字面量值。
 *
 * `reason` / `detail` / `cause` 这三个名字的约定是全仓库统一的：
 * **码进界面，句子进日志**。反过来说，只要这里出现一句中文，它就一定是**要渗进界面的参数**
 * —— 壳层那句已经翻译好的「Could not save the record: {reason}」会把它原样插进去。
 *
 * 引号用**反向引用**配对（`(["'\`])…\1`），否则 `'它说"不行"'` 会在第一个非引号处提前收尾。
 * 模板字面量里的 `${...}` 原样收下，交给 `stripTemplateExpressions` 处理（与其余 pass 同一条边界）。
 */
const DIAG_PROPS = /\b(?:reason|detail|cause)\s*:\s*(["'`])((?:[^"'`\\]|\\.)*)\1/g;

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

// `CJK` 在文件上面随词条表规则一起定义（规则 3 与规则 5 共用同一份定义）。
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
  /** 🔴 同一个键写两次 = 后一条静默赢。这与"解析漏行"是两种病，必须分开报。 */
  const firstLine = new Map();
  const duplicates = new Map();
  let entryLikeLines = 0;
  let lineNumber = 0;
  for (const line of src.split('\n')) {
    lineNumber += 1;
    if (!ENTRY_LIKE.test(line)) continue;
    entryLikeLines += 1;
    const m = ENTRY.exec(line);
    if (m === null) continue;
    if (firstLine.has(m[1])) {
      const lines = duplicates.get(m[1]) ?? [firstLine.get(m[1])];
      duplicates.set(m[1], [...lines, lineNumber]);
    } else {
      firstLine.set(m[1], lineNumber);
    }
    // 🔴 返回值保持"键 → 句子"的原契约：后面的规则 2/3/4 直接比 value，
    //    把它换成对象会让别的规则比对不上 —— 那是另一种假绿。
    entries.set(m[1], m[2]);
  }
  if (duplicates.size > 0) {
    const detail = [...duplicates.entries()]
      .map(([key, lines]) => `   · '${key}' 第 ${lines.join(' 行、第 ')} 行（后一条覆盖前一条）`)
      .join('\n');
    console.error(
      `🔴 词条表里有重复键：${relative(ROOT, file)}\n${detail}\n` +
        `   两条都在表里、TS 不报错、构建不报错 —— 只有运行时知道用了哪一句，` +
        `而那是"最后写进去的那个人"的决定，不是产品决定。`,
    );
    process.exit(1);
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

/**
 * 规则 2/3/4：**所有**词条表互相约束。
 *
 * 三条子规则，顺序是有意义的 —— 前一条红了就不再假装后一条有意义：
 *
 * · **清单对账**（新增）：`locales/*.ts` 的文件集合与 `LOCALES` 必须一一对应，
 *   且每个启用的 locale 都得在 `LOCALE_SCRIPT_RULES` 里登记文字系统判据。
 * · 规则 4：key 集合与锚点表一致（双向报，才能看出是漏了还是多了）。
 * · 规则 2/3：按该 locale 登记的 `mustContain` / `forbidden` 逐条查值。
 */
function checkCatalogs() {
  const violations = [];
  /** 打印成"待办/说明"用，不参与判定。 */
  const notes = [];
  const locales = readLocales();
  const suffixMap = endonymSuffixMap(locales);

  // ── 清单对账：文件 ↔ LOCALES ↔ 规则表 ────────────────────────
  const catalogFiles = new Map();
  for (const name of readdirSync(join(ROOT, CATALOG_DIR))) {
    if (!name.endsWith('.ts')) continue;
    catalogFiles.set(name.slice(0, -'.ts'.length), join(ROOT, CATALOG_DIR, name));
  }

  // 有表但没进 LOCALES：这份表**没有任何一层会读到**（运行时读不到、
  // `gen-server-copy` 也不会搬进服务端），是最安静的一种假绿。
  for (const locale of catalogFiles.keys()) {
    if (locales.includes(locale)) continue;
    violations.push({
      where: `${CATALOG_DIR}/${locale}.ts`,
      text: '文件存在，但 LOCALES 里没有它',
      why: '这份表不会被任何一层读到 —— 写它的人以为自己在加一门语言，其实加了一个没人看的文件',
      fix: `在 packages/i18n/src/types.ts 的 LOCALES 里加上 '${locale}'（同时要把 Locale 联合类型加上，否则编译不过）。`,
    });
  }
  for (const locale of locales) {
    const file = catalogFiles.get(locale);
    if (file === undefined) {
      violations.push({
        where: `${CATALOG_DIR}/${locale}.ts`,
        text: 'LOCALES 里有它，但没有词条表',
        why: '切到这门语言时界面上一个字都出不来',
        fix: `补 ${CATALOG_DIR}/${locale}.ts，或把 '${locale}' 从 LOCALES 里拿掉。`,
      });
    }
    if (LOCALE_SCRIPT_RULES[locale] === undefined) {
      violations.push({
        where: 'scripts/check-ui-language.mjs（LOCALE_SCRIPT_RULES）',
        text: locale,
        why: '启用了这门语言，却没登记它"怎么证明自己被翻过"',
        fix: `在 LOCALE_SCRIPT_RULES 里登记 ${locale} 的 mustContain / forbidden（要写清判据的理由，不能照抄别种语言）。`,
      });
    }
  }

  // 登记了但还没启用 = "准备好但先不做"的那一半。**打印出来**而不是静默存在：
  // 一张写错 key 的规则表（`jab`）如果什么都不说，就永远没人发现它没生效。
  const prepared = Object.keys(LOCALE_SCRIPT_RULES).filter((l) => !locales.includes(l));
  if (prepared.length > 0) {
    notes.push(`已登记文字系统规则、尚未启用（准备好但先不做）：${prepared.join('、')}`);
  }

  // ── 解析每一份启用且有表的词条 ───────────────────────────────
  const catalogs = new Map();
  for (const locale of locales) {
    const file = catalogFiles.get(locale);
    if (file !== undefined) catalogs.set(locale, parseCatalog(file));
  }

  // ── 规则 4：与锚点表的 key 集合互查 ──────────────────────────
  const reference = catalogs.get(REFERENCE_LOCALE);
  for (const [locale, catalog] of catalogs) {
    if (locale === REFERENCE_LOCALE || reference === undefined) continue;
    const rel = relative(ROOT, catalogFiles.get(locale));
    for (const key of reference.keys()) {
      if (!catalog.has(key)) {
        violations.push({
          where: rel,
          text: key,
          why: `${REFERENCE_LOCALE} 词条表里有这条，${locale} 表里没有 —— 漏翻译`,
          fix: `在 ${locale}.ts 补上 '${key}'。`,
        });
      }
    }
    for (const key of catalog.keys()) {
      if (!reference.has(key)) {
        violations.push({
          where: rel,
          text: key,
          why: `${locale} 词条表里有这条，${REFERENCE_LOCALE} 表里没有 —— 多出来的 key（它不会渲染到界面上，但会一直红着）`,
          fix: `删掉它，或先在 ${REFERENCE_LOCALE}.ts 里加上 '${key}' 作为事实源。`,
        });
      }
    }
  }

  // ── 规则 2/3：逐条查文字系统 ─────────────────────────────────
  for (const [locale, catalog] of catalogs) {
    const rules = LOCALE_SCRIPT_RULES[locale];
    if (rules === undefined) continue; // 已经判红，不重复报
    const rel = relative(ROOT, catalogFiles.get(locale));
    for (const [key, value] of catalog) {
      const endonym = isForeignEndonym(key, locale, suffixMap);
      if (rules.mustContain !== undefined && rules.mustContain !== null) {
        // 见下面那段：`*.evidence` 的值是命令/路径，汉字由 `check:claims.mjs` 反过来禁止。
        if (!endonym && !UNTRANSLATABLE_KEYS.has(key) && !EVIDENCE_KEY_SUFFIX.test(key)) {
          if (!rules.mustContain.test(value)) {
            violations.push({
              where: rel,
              text: `${key} = ${value}`,
              why: `${locale} 词条里没有${rules.scriptName} —— 很可能是拿别的语言占位`,
              fix: `写成 ${locale}。确实是逐字不许翻译的（品牌名/平台名/命令），加进 UNTRANSLATABLE_KEYS 并说明理由。`,
            });
          }
        }
      }
      if (rules.forbidden !== undefined && rules.forbidden !== null) {
        if (!endonym && rules.forbidden.test(value)) {
          violations.push({
            where: rel,
            text: `${key} = ${value}`,
            why: `${locale} 词条里出现了${rules.forbiddenName} —— 很可能是把中文复制过来当${locale}`,
            fix: '翻译成本语言。语言自称（`common.lang.X`）是唯一正当的例外，它按 key 豁免而不是放宽规则。',
          });
        }
      }
    }
  }

  return { violations, notes, counts: catalogs };
}

const violations = [];
let scanned = 0;
let strings = 0;
let migratedStrings = 0;
/** 规则 5 看到的诊断字段字面量数（`reason` / `detail` / `cause`）。 */
let diagStrings = 0;

// ── 先查词条表本身（规则 2/3/4）────────────────────────────────
const catalogResult = checkCatalogs();
violations.push(...catalogResult.violations);

/**
 * ── 价格一致性：词条里的价格必须与**代码价目表**和**法务文本**一致 ──────
 *
 * 为什么挂在这里：它属于同一个契约（「文案说的是真话」），而价格是**唯一一个
 * 除了词条表之外还有可执行事实源**的文案 —— `server/src/billing/wechat.adapter.ts`
 * 的价目表才是真正收的钱，词条表里的价格只是「对外怎么说」。两者不一致
 * 就是虚假宣传；反过来价目表改了而页面没改，用户看到的价格也不是他要付的价格。
 *
 * 🔴 判据与理由见 [ADR-0017](../docs/adr/0017-single-paid-tier-and-payment-channel.md) §3.2。
 * 单独成一个脚本（`scripts/check-pricing-consistency.mjs`）而不是内联在这里，
 * 是因为它自己也有一套**能失败的注入用例**（`scripts/verify-i18n-failures.mjs` 的 `pricing` 组）。
 *
 * ⚠️ 必须**调用**而不是**复制**那条规则进来 —— 复制出来的两份规则会各自漂移，
 * 而中间那一份才是对的。
 */
try {
  const pricingOut = execFileSync(
    process.execPath,
    [join(ROOT, 'scripts/check-pricing-consistency.mjs')],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  );
  if (pricingOut.trim() !== '') console.log(pricingOut.trimEnd());
} catch (e) {
  // 把子脚本自己的诊断原样透出来 —— 它已经写清了是哪两处对不上。
  const detail = `${String(e.stdout ?? '')}${String(e.stderr ?? '')}`.trimEnd();
  if (detail !== '') console.error(detail);
  violations.push({
    where: '价格（server 价目表 ↔ 中英词条表 ↔ 法务文本）',
    text: '三个地方说的不是同一个数',
    why: '价格是唯一一个有可执行事实源的文案；不一致意味着用户看到的价格不是他要付的价格',
    fix: '按 docs/reference/pricing-and-entitlements.md 的 pricing-ssot 代码块统一三处（改价必须同一次改完）。',
  });
}

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

    // ── 规则 5：诊断字段不许装句子（只在已迁移的文件上跑）────────
    //
    // 三种旧 pass 都看不到 `.ts` 里对象字面量的值，而那一整类泄漏的落点就是这里
    // （`{ reason: '不是安全上下文' }` → 壳层 `t('…', { reason })` → 英文界面露中文）。
    // 判据与旧契约**方向相反**：旧契约拦"没有汉字"，这条拦"有汉字"。
    // 未迁移的应用不跑这条 —— 那边整句中文本来就是现状，跑了指向的是同一个
    // 已经存在的红灯，只会把真正该看的那两条淹掉。
    if (fileMigrated) {
      DIAG_PROPS.lastIndex = 0;
      let diag;
      while ((diag = DIAG_PROPS.exec(src)) !== null) {
        diagStrings += 1;
        const text = stripTemplateExpressions(diag[2]).trim();
        if (!CJK.test(text)) continue;
        const line = src.slice(0, diag.index).split('\n').length;
        violations.push({
          where: `${rel}:${String(line)}`,
          text,
          why: '诊断字段里写了一整句中文 —— 它是 `{reason}` / `{detail}` 的参数，会原样渗进已翻译的句子，英文界面就露出半句中文',
          fix: '换成封闭集合的原因码（如 `insecure-context`），句子写进 packages/i18n 的中英两份表；确需带出的原始值（HTTP 状态、收到的字符串）当 vars 传，别拼成中文句子。',
        });
      }
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
  const catalogCount = [...catalogResult.counts]
    .map(([locale, catalog]) => `${locale} ${String(catalog.size)} 条`)
    .join(' / ');
  for (const note of catalogResult.notes) console.log(`ℹ️  ${note}`);
  console.log(
    `✅ 文案合规（扫描 ${String(scanned)} 个文件、${String(strings)} 处文案、` +
      `${String(diagStrings)} 处诊断字段；` +
      `词条表 ${catalogCount}；${mode}）。`,
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
