#!/usr/bin/env node
/**
 * 真机验收脚本的**界面文案对账**（常驻门禁，不占设备、不占端口，纯读盘）。
 *
 * 存在的理由：`verify-mobile-edit` 曾经自 i18n 迁移起**一直是红的**，而红的原因不是产品坏了，
 * 是脚本里找的那句界面文案（「任务标题」）早就被词条表改成了「标题」（AGENTS §7 第 66 条那一族）。
 * 这类缺陷的特征是：**它只在真机那一趟现形**，于是每次现形都要烧掉一次稀缺的设备窗口。
 * 这条门禁把它挪到不占窗口的地方。
 *
 * 三条判据，缺一不可：
 *  ① 只判"这串会被喂进界面查找"的那些位置（自家 helper 的实参 / `--text` / `-e text` / `--desc`），
 *     散文式中文（日志说明）一律不判 —— 全量匹配会把几十条日志误报成断点；
 *  ② 每条命中都带 `文件:行号`，人可以逐条复核；
 *  ③ **阳性对照**：匹配器必须命中若干"词表里确实存在"的串，否则 `缺失=0` 是探针坏了而不是脚本干净
 *     （⇒ 退 2，不退 0）；
 *  ④ 🔴 **负向对照**：`--grep "开发构建"` 这类 Playwright **用例名过滤器**长得和 shell `grep` 一样，
 *     第一版把 `开发构建` / `打包产物` 报成了缺失（needle=166 缺失=2，全是我这一侧的误判）。
 *     现在显式断言这两串**一个都不进 needle 集合** —— 少这条，下一次往脚本里加 `--grep`
 *     就会又制造一批假缺陷，而假缺陷的代价是被人整个忽略掉这条门禁。
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const I18N_DIR = join(ROOT, 'packages/i18n/dist');

/**
 * 🔴 不能只读 `index.js`：tsup 把两张词表切进了 **chunk**（现量 `index.js` 只有 1 970 B，
 * 而最大的那个 chunk 是 511 KB）。只读入口会得到"中文值 0 条"，而那条 0 长得像
 * "脚本里所有文案都对不上"，实际是探针读错了文件。
 */
if (!existsSync(I18N_DIR)) {
  console.error(
    `🔴 词条产物目录不存在：packages/i18n/dist —— 先 pnpm --filter @heyta/i18n build。` +
      `这个 0 是探针坏了，不是脚本干净。`,
  );
  process.exit(2);
}
const i18nText = readdirSync(I18N_DIR)
  .filter((f) => f.endsWith('.js'))
  .map((f) => readFileSync(join(I18N_DIR, f), 'utf8'))
  .join('\n');

const values = new Set();
for (const m of i18nText.matchAll(/"([^"\\]*(?:\\.[^"\\]*)*)"/g)) {
  const raw = m[1].replace(/\\u([\da-fA-F]{4})/g, (_, h) =>
    String.fromCharCode(Number.parseInt(h, 16)),
  );
  if (/[㐀-鿿]/.test(raw)) values.add(raw);
}
const inTable = (s) => values.has(s);
/**
 * 词表里带 `{placeholder}` 的值，**代入之后**就是界面上真正渲染出来的那串
 * （`'mobile.detail.repeat.current': '当前：{rule}'` ⇒ 渲染成「当前：每年」）。
 * 把每个模板值转成一条"占位符 ⇒ 任意非空串"的正则，让 needle 去整串匹配。
 * 没有这一档，脚本里那些**照着渲染结果写**的 needle（「当前：每年」「1 小时」）会全被判成缺失，
 * 而它们在设备上明明是存在的 —— 那是探针坏了。
 */
const TEMPLATE_RES = [...values]
  .filter((v) => /\{[^}]+\}/.test(v))
  .map((v) => new RegExp(`^${v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\{[^}]+\\\}/g, '.+?')}$`));
const matchesTemplate = (s) => TEMPLATE_RES.some((re) => re.test(s));
/** 词表里有没有**包含** `s` 的值（substring 语义：对整份 dump 做 `grep`）。 */
const insideATableValue = (s) => [...values].some((v) => v.includes(s));

/**
 * helper 的匹配语义**逐条读实现取证**（不猜，也不按"应该是精确匹配"想当然）：
 *
 *  · EXACT  整节点相等 —— `has_text`（`scripts/lib/mobile-e2e.sh:385`，`text="…"` 后必须紧跟引号）、
 *            `has_desc`（`:395`）、`xy_desc` / `xy_text` / `scroll_to_desc`
 *            （`/tmp/_xy.py:35/45/47`：`desc == want` / `text == want`）、
 *            🔴 **`scroll_to_text`**（lib `:637` 内部是 `text-sane`，`_xy.py:55` `text == want`）、
 *            **`scroll_to_edit`**（lib `:650` 内部是 `edit-sane`，`_xy.py:39` `desc == want`）
 *            —— 后两枚**原先不在匹配器里**：2026-10-04 17:5x 现量，全仓 47 个脚本里
 *            `scroll_to_text` 30 处、`scroll_to_edit` 5 处、`settle_for` 18 处的字面量 needle
 *            根本没进对账（占应检查面的 40 枚）。补进来之后 `needle 247 → 287` 而 `缺失=0`，
 *            ⇒ 扩面是**零红变化**，不是替别人吸收债。
 *  · SUBSTR 任意位置包含 —— `has_sub`（`:394`，实现是 `text="[^"]*$1`：引号后允许任意字符，
 *            所以它是**包含**而不是前缀 —— 第一版把它当前缀写，于是「处冲突待你选择」这种
 *            从句子里截出来的中段被判成缺失，那是探针坏了不是脚本坏了）、
 *            **`settle_for`**（lib `:343` 的实现是 `grep -qF -- "$needle" "$UI_XML"`：
 *            对**整份 dump** 做 substring，不限定在 `text="…"` 上 ⇒ 只能按 SUBSTR 档判）
 *  · SUBSTR 对整份 dump 做 substring —— `grep` / `rg`（以及把节点喂给 `grep` 的坐标查找）
 *  · SUBSTR 对整份 dump 做 substring —— `grep` / `rg`（以及把节点喂给 `grep` 的坐标查找）
 *  · 🔴 注释行**整行跳过**（`^\s*#`）：lib 里的注释写着大量调用示例（`xy_text "不允许"` 这种），
 *    它们是文档不是断言。
 *
 * 🔴 为什么必须分档而不是"包含就行"：第一版用的是**双向** `includes`
 * （`v.includes(n) || n.includes(v)`），于是这条门禁立身的那个原案 —— 脚本找「任务标题」
 * 而真词条早已改成「标题」 —— **会被判成命中**（`"任务标题".includes("标题")` 为真）。
 * 变异实测把它照出来了：把 `xy_desc "回收站"` 改成 `xy_desc "回收站歪掉的"`，
 * 第一版仍退 0（`needle=16 命中=16 缺失=0`）。**不能失败的判据比没有判据更糟**，
 * 所以去掉的那个方向正是 `n.includes(v)`（needle 包住词表值）：
 * EXACT 只认同串，SUBSTR 只认"词表里某个值**包含**它"。
 *
 * iOS 那族 helper 的分档同样是**读实现**定的，不是照 Android 那一族类推的：
 * `scripts/tools/idb-find.py` 的 `label`(:112) / `field`(:94) / `value`(:104) / `enabled`(:127) 四档都是
 * `label_of(e) == want`（AXLabel 整串相等）⇒ `idb_label_center` / `idb_field_center` / `idb_field_value` 走 EXACT；
 * `idb_tap_label`（lib `:1180`）最后一步是 `idb_label_center "$1"`（`:1183`）⇒ 也 EXACT（取不到坐标就不点）。
 * `has`(:135-140) 是 `label_of(e)==want` **或** `want in AXValue` ⇒ `idb_has` 走 SUBSTR；
 * `idb_wait_label`（lib `:1165-1174`）内部只调 `idb_has "$want"` ⇒ 跟着 SUBSTR。
 * 🔴 **`idb_type_into` 刻意不进名单**：它的第二个实参是**要输入的文本**（测试数据）不是界面文案，
 * 收进来会把合法输入串判成"缺失词条"；第一个实参才是 field label，而它今天零处带引号调用，等有用到再加。
 * 扩面前后同一次跑的读数（`node tmp/cvr-ios-trial.mjs`）：`needle 287→295`、`靠substring 56→59`、**`缺失=0`**
 * ⇒ 这是一次零红变化，不是把别人在飞的文案判红。
 */
const EXACT_FORMS = [
  /\b(xy_desc|xy_text|scroll_to_desc|scroll_to_text|scroll_to_edit|has_text|has_desc|tap_desc|find_text|idb_label_center|idb_field_center|idb_field_value|idb_tap_label)\s+"([^"$]+)"/g,
  /\b(xy_desc|xy_text|scroll_to_desc|scroll_to_text|scroll_to_edit|has_text|has_desc|tap_desc|find_text|idb_label_center|idb_field_center|idb_field_value|idb_tap_label)\s+'([^'$]+)'/g,
  /--text\s+(['"])([^'"]+)\1/g,
  /(?:-e\s+text|--desc)\s+(['"])([^'"]+)\1/g,
];
const SUBSTR_FORMS = [
  /(?<![-\w])(?:grep|rg)\s+(['"])([^'"]+)\1/g,
  /\b(has_sub|has_desc_sub|settle_for|idb_has|idb_wait_label)\s+"([^"$]+)"/g,
  /\b(has_sub|has_desc_sub|settle_for|idb_has|idb_wait_label)\s+'([^'$]+)'/g,
];

/**
 * 界面**不是 heyta 画的**、因此不该拿去对词条表的那些串，逐项登记理由。
 * 加一条的成本是刻意的（和许可证台账 `REVIEWED_OTHER` 同一个道理）：它逼人为这条 needle
 * 做一次真正的判断 —— "这句到底是我们界面的文案，还是系统 UI 的文案"。
 */
const PLATFORM_LABELS = [
  {
    label: '显示根目录',
    reason: 'Android 系统文件选择器（SAF/Documents UI）自己的 content-desc，不是我们的词条',
    evidence: 'scripts/verify-mobile-restore.sh:384 是双通道回退：先 xy_desc "Show roots"，为空才 xy_desc "显示根目录"',
  },
  {
    label: '下载',
    reason: '同上：系统选择器里的 Downloads 一栏',
    evidence: 'scripts/verify-mobile-restore.sh:387 紧跟在 Downloads / 下载 两条通道之后',
  },
  {
    label: '不允许',
    reason: '系统权限弹窗的按钮，脚本自己都把它记成"那不是本应用的界面"',
    evidence: 'scripts/lib/mobile-e2e.sh:1512-1514（先试 Don\u2019t allow，再试 不允许，然后 printf 那句）',
  },
  {
    label: '贪睡',
    reason: '系统通知的 Snooze 动作，不是我们的提醒词条',
    evidence: 'scripts/verify-mobile-reminder-ring.sh:474-475 先 text-sane "稍后提醒"，为空才 xy_text "贪睡"',
  },
];
const platformSet = new Set(PLATFORM_LABELS.map((p) => p.label));

/** 带 `${…}` 插值的 needle：模板拼出来的串，词表里未必以整串存在 ⇒ 单列出来交给人读，不判红。 */
const DYNAMIC_FORM =
  /\b(xy_desc|scroll_to_desc|has_text|has_desc|tap_desc|find_text|has_sub|has_desc_sub)\s+"([^"]*\$\{[^"]*)"/g;

/** 判据 ④ 的负向对照样本：这些串**只许**以 `--grep` 出现，不许被算进 needle。 */
const NEGATIVE_NEEDLES = ['开发构建', '打包产物'];

/**
 * 输入集合自己枚举（`scripts/verify-*.sh` + `scripts/lib/*.sh`），不写死清单 ——
 * 点名清单注定会漂，而这里漂了的代价是"新加的验收脚本没人对账"。
 * 也可以显式传路径覆盖（调试用）。
 */
const scriptsDir = join(ROOT, 'scripts');
const auto = [
  ...readdirSync(scriptsDir)
    .filter((f) => f.endsWith('.sh') && /^verify-/.test(f))
    .map((f) => `scripts/${f}`),
  ...(existsSync(join(scriptsDir, 'lib'))
    ? readdirSync(join(scriptsDir, 'lib'))
        .filter((f) => f.endsWith('.sh'))
        .map((f) => `scripts/lib/${f}`)
    : []),
].sort();

const targets = process.argv.slice(2).length > 0 ? process.argv.slice(2) : auto;
if (targets.length === 0) {
  console.error('🔴 一个脚本都没枚举到 —— 这是探针坏了（不是"没有脚本要对账"）');
  process.exit(2);
}

let checks = 0;
let misses = 0;
const positives = [];
const dynamic = [];
const seenNeedles = new Set();
let platformHits = 0;
const looseTier = { substr: 0 };

/** 收集一行之内的所有 needle  occurrence，并允许"同一行同串既走精确档又走宽松档"时按宽松档判。
 *  理由：`[ "$(has_text "当前：")" = "1" ] || [ "$(has_sub "当前：")" = "1" ]` 这类守卫在运行时
 *  **就是**前缀语义（精确那一路查不到还有 OR 兜着），把它判成缺失是假红。 */
function occurrencesOf(line) {
  if (/^\s*#/.test(line)) return [];
  const out = [];
  for (const [forms, cls] of [
    [EXACT_FORMS, 'exact'],
    [SUBSTR_FORMS, 'substr'],
  ]) {
    for (const re of forms) {
      re.lastIndex = 0;
      for (const m of line.matchAll(re)) {
        const needle = (m[2] ?? '').trim();
        if (!/[㐀-鿿]/.test(needle)) continue;
        out.push({ needle, cls });
      }
    }
  }
  return out;
}

for (const file of targets) {
  const lines = readFileSync(join(ROOT, file), 'utf8').split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const occ = occurrencesOf(line);
    for (const { needle, cls } of occ) {
      checks += 1;
      seenNeedles.add(needle);
      // 同一行里同串的其他档位（放宽方向按最宽的那档判）
      const sibling = occ
        .filter((o) => o.needle === needle && o.cls !== cls)
        .map((o) => o.cls);
      const classes = [cls, ...sibling];

      let hit = false;
      if (platformSet.has(needle)) {
        hit = true;
        platformHits += 1;
      } else {
        for (const c of classes) {
          if (c === 'exact' && (inTable(needle) || matchesTemplate(needle))) hit = true;
          if (c === 'substr' && (insideATableValue(needle) || matchesTemplate(needle))) {
            hit = true;
            looseTier.substr += 1;
          }
        }
      }
      if (hit) positives.push(needle);
      else {
        misses += 1;
        console.log(`缺失\t${file}:${String(i + 1)}\t[${cls}]\t"${needle}"`);
      }
    }
    DYNAMIC_FORM.lastIndex = 0;
    for (const m of line.matchAll(DYNAMIC_FORM)) {
      dynamic.push(`${file}:${String(i + 1)}\t"${m[2]}"`);
    }
  }
}

console.log(
  `\nSUMMARY 输入脚本=${String(targets.length)} needle=${String(checks)} 命中词条表=${String(positives.length)} ` +
    `靠substring=${String(looseTier.substr)} 平台标签=${String(platformHits)} ` +
    `缺失=${String(misses)} 插值needle=${String(dynamic.length)} 词条中文值条数=${String(values.size)}`,
);
if (dynamic.length > 0) {
  console.log('需人读（模板拼出来的界面串，词表未必以整串存在，不自动判）：');
  for (const d of dynamic) console.log(`  ${d}`);
}

/** 判据 ③：阳性对照为 0 ⇒ 匹配器或词条产物坏了，本次"缺失数"不可信。 */
if (positives.length === 0) {
  console.log('🔴 阳性对照为 0 —— 匹配器或词条产物有问题，本次"缺失数"不可信（报探针坏了，不报脚本没问题）');
  process.exit(2);
}

/** 判据 ④：负向对照被污染 ⇒ 形状收紧失效。 */
const polluted = NEGATIVE_NEEDLES.filter((n) => seenNeedles.has(n));
if (polluted.length > 0) {
  console.log(
    `🔴 负向对照失败：这些 Playwright 用例名过滤器被当成界面文案收进来了 —— ${polluted.join(' / ')}` +
      `（ needle 形状里的 (?<![-\\w]) 没起作用，本次"缺失数"里混着假缺陷）`,
  );
  process.exit(2);
}

console.log(`对照样本（确实在词条表里的前 6 条）：${positives.slice(0, 6).join(' / ')}`);
console.log(
  `负向对照成立：${NEGATIVE_NEEDLES.join(' / ')} 都没被算成界面 needle（输入里它们只出现在 --grep 位置）`,
);

/**
 * 🔴 有缺失必须是非零码。第一版这里**退的是 0**（只打印不判失败），
 * 于是"报了 2 条缺失"和"一条都没报"在退出码上完全同形 —— 那条读数当不了门禁。
 */
if (misses > 0) process.exit(1);
