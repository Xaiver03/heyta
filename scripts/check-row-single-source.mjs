#!/usr/bin/env node
/**
 * 「任务行只有一个实现」+「`ht-*` 前缀族只减不增」—— 两道结构性门禁
 * =================================================================
 *
 * 判据出处：`docs/research/dida-view-unification.md` §5（门禁表）与 §8.4（怎么验收）。
 *
 *   §8.4 判据 2：「复选框 + 标题 + 截止」的 JSX **全仓只出现在 `packages/ui`**
 *   §8.4 判据 3：`app.css` 顶层 `ht-*` 前缀族数量**只许下降**（不给新增）
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 为什么需要这一道（不是风格检查）
 * ─────────────────────────────────────────────────────────────────────────
 *
 * `dida-view-unification.md` §3 的第 1 条写的正是这件事：M3 现在只按
 * **净行数下降**验收，而"净行数下降"完全可能以"12 份各自更短的实现"达成 ——
 * 那是**反方向**。所以必须有一条判据钉住"一行"这件事本身只有一份实现。
 *
 * 这道门禁替换掉人的注意力。人读过一次 `App.tsx` 的任务行之后就不会再读第二遍，
 * 而任务行**一定会被再写一遍**：它是每个视图都要重复的东西。
 * 证据是本仓库已经真实发生过的两处（见下面 ⚠️ 那一段）。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 断言 A：任务行的实现只有一份
 * ─────────────────────────────────────────────────────────────────────────
 *
 * 🔴 **判据刻意窄**：不是"看到 `checkbox` 或 `title` 就报错"。
 * 设置页里也有 `<input type="checkbox">`，`AiSettings` 里有十几个 ——
 * 把那些算进来，门禁会被噪音淹没，然后被人用注释绕过。
 *
 * 本脚本认的"任务行标记"是**三种信号同时出现在同一棵 JSX 子树里**：
 *
 *   ① 勾选框    `accessibilityRole="checkbox"` / `role="checkbox"` /
 *                `type="checkbox"` / `<Checkbox` / class 里的 `__check`
 *   ② 标题槽    class 里的 `__title` / `styles.title` / `titleText` /
 *                直接渲染 `task.title`、`row.title`、`item.title`
 *   ③ 截止槽    `ht-due` / `mk-due` / `DueBadge` / `renderMeta` /
 *                `dueAt` / `dueText` / `countdown` / `overdue`
 *
 * 三条**必须同时**命中才算"任务行"。这就是它为什么窄：
 * 一个设置开关有 ① 没有 ②③；一句话的 `<h3 className="__title">` 有 ② 没有 ①③；
 * 一个截止徽标组件有 ③ 没有 ①②。
 *
 * "同一棵 JSX 子树"是本脚本自己搭的一棵**轻量 JSX 元素树**（见 `scanJsxTree`）：
 * 按配对的开/闭标签算出每个元素的 range，再取**最内层**同时含三种信号的那个
 * 元素当"任务行"。所以报告能精确到 `文件:行`，而不是"这个文件里有重复"。
 *
 * 🔴 **匹配不到时不许跳过**（本仓库反复吃过的亏，见
 * `check-pricing-consistency.mjs` 文件头）：`packages/ui` 是那唯一的实现，
 * 所以 `packages/ui` 里**必须**扫出至少一棵任务行。扫不出 → 直接报错，
 * 而不是"没有违规，✅"。这一条防的正是"把判据锚点改名之后门禁永远变绿"。
 *
 * ### 结果（2026-09-28）
 *
 * · `apps/web/src/App.tsx` 那处**已收编** —— M3 第一刀把它换成了共享 `TaskList`
 *   （`ht-*` 前缀族随之 31 → 29）；
 * · `apps/landing/src/mockup/TaskList.tsx` 那处**被显式豁免**，理由见下。
 *
 * ### 🔴 为什么 landing 的复刻件被豁免（这是**判决**，不是遗漏）
 *
 * 两条**都对**的结论在这里相撞：
 *
 *   1. 这道门禁要求「任务行 JSX 全仓只出现在 `packages/ui`」（§8.4 判据 2）；
 *   2. 实测（2026-09-28）：landing **静态引入** `@heyta/ui` 会让首屏
 *      `main-*.js` 从 199.0 kB gzip 涨到 **260.9 kB（+61.9 kB / +31%）**；
 *      **懒加载孤岛也救不了** —— `Hero.tsx` 也渲染展厅，1280×800 下展厅
 *      `top=529px` **就在首屏**，IntersectionObserver 立刻触发、chunk 在 load 后
 *      ~90 ms 被取回；而 gzip 按文件做，拆开后**总字节更多**（199+84 > 262）。
 *
 * 一个营销页的首屏体积是**产品取舍**，不能为了统一而付 +31%。所以：
 *
 * **landing 的 `mockup/**` 豁免本例，但换一条替代约束** ——
 *   `packages/design-system/src/task-row-shape.ts` 是「一行用哪些 token」的
 *   **唯一登记处**，`packages/ui` 的行与 landing 的复刻件**都从它取值**；
 *   `apps/landing/tests/mockup-task-row.spec.tsx` 逐项比对 mockup.css 里的 token
 *   与契约，且有一条断言**禁止** `@heyta/ui` 被静态引进 landing（防 62 kB 静默回潮）。
 *
 * ⇒ **豁免 ≠ 没人管**。它换来的是"漂移会红"（实测三种变异都会红），
 * 而代价是这条断言不再管 landing —— 两件事都写在上面，别只看到前半句。
 *
 * ⚠️ 若将来 landing 变成 SPA / 首屏体积不再敏感，**应当撤销这个豁免**，
 * 让复刻件换成真组件。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 断言 B：`ht-*` 前缀族只减不增
 * ─────────────────────────────────────────────────────────────────────────
 *
 * §8.4 判据 3 的命令是
 *   `grep -oE '^\.ht-[a-z]+' apps/web/src/styles/app.css | sort -u | wc -l`
 * 当前实测 **31**（§5/§8.4 正文写的 30 是更早的数字，M3 期间涨了一个）。
 * 本脚本把它写成具名常量 `HT_FAMILY_BASELINE`，实现成"基线 + 不许超过"。
 *
 * 降下来时**主动提示下调基线**（否则基线会变成永久豁免，方向就丢了）。
 * 文件不存在、或一个族都扫不出 → 报错，而不是"0 ≤ 31 ✅"。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 已知边界（实测过，写下来免得起重蹈）
 * ─────────────────────────────────────────────────────────────────────────
 *
 * 1. **把内层勾选框标记改个名躲不掉**：`ht-task__check` 改成 `ht-task__toggle`
 *    之后，行容器块 `ht-task` 本身仍是勾选框信号，整行照样被抓（实测）。
 *    要躲就得**连容器块一起改名**（`ht-task` → 别的），那已经不是"判据锚点失效"
 *    而是蓄意绕过 —— 本门禁选择"窄 + 锚点自检"，不追这种。
 * 2. **`aria-pressed` 刻意不算勾选框信号**：试过，会把 `apps/web/src/App.tsx`
 *    的整棵 `<header>`（视图 tab 有 `aria-pressed`）误报成任务行。
 *    要覆盖"只有 `aria-pressed` 的勾选控件"，得先把视图 tab 的选择器形态改掉 ——
 *    那是产品改动，不是门禁该顺手做的。
 *
 * 用法：node scripts/check-row-single-source.mjs
 *   非零退出 = 有违规。
 *
 * `HEYTA_CHECK_ROOT`：与 `check-pricing-consistency.mjs` 同一个约定 ——
 * 只给**故障注入探针**用（把门禁跑在 `/tmp` 的副本上，不动共享工作区）。
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

// 🔴 "轻量 JSX 元素树"（`maskSource` / `scanJsxTree` / `lineAt`）现在是
//    `scripts/lib/jsx-tree.mjs` 里的**公共件** —— `check-ui-provider.mjs`
//    也要用同一份"配对标签算 range"的实现（判"消费者在不在 Provider 子树内"）。
//    同一件事写两遍必然漂移，而这个仓库已经为此付过代价。
import { lineAt, scanJsxTree } from './lib/jsx-tree.mjs';

const ROOT =
  process.env.HEYTA_CHECK_ROOT === undefined
    ? resolve(dirname(fileURLToPath(import.meta.url)), '..')
    : resolve(process.env.HEYTA_CHECK_ROOT);

/* ========================================================================
 * 断言 A 的标记表
 * ====================================================================== */

/**
 * ① 勾选框。**只认明确控件**，不认 `checked` / `checkbox` 这种还能当变量名的词。
 *
 * `__check` 前面**不加 `\b`** —— BEM 的 `__` 与前面的字母之间没有词边界
 * （`mk-task__check` 里 `k` 与 `_` 都是词字符），加 `\b` 会让 landing 那份漏网。
 *
 * 最后一条 `ht-task` / `mk-task`（行**容器块**本身）也是勾选框信号，理由：
 * 只认内层 `__check` 的话，把 `ht-task__check` 改名成 `ht-task__toggle`
 * 就能让整行躲过判据 —— 而容器块是"这是一行任务"最直接的标记。
 * ⚠️ `(?![-\w])` 保证 `ht-tasklist`（列表容器）与 `ht-task__check`
 * （有 `_`）都不被这一条匹配，只有 `ht-task` 这个块本身算。
 */
const CHECKBOX_SIGNAL =
  /accessibilityRole\s*=\s*['"]checkbox['"]|role\s*=\s*['"]checkbox['"]|type\s*=\s*['"]checkbox['"]|<Checkbox\b|__check\b|(?:^|[\s"'`])(?:ht|mk)-task(?![-\w])/;

/**
 * ② 标题槽。三种都认：
 *   - `task.title` / `row.title` / `item.title`（共享层与外壳都用的形态）
 *   - `__title` 这类 BEM 槽位（web / landing 手写行用的形态）
 *   - `{title}` —— `packages/ui` 的 `TaskList` 先把标题算进局部变量 `title`，
 *     再在行里渲染它。**这是实测才发现的形态**：只认 `row.title` 会让
 *     唯一的正解扫不出来，于是门禁在第一版就是"永远通过"的。
 */
const TITLE_SIGNAL =
  /__title\b|<\w*Title\b|styles\.title\b|\btitleText\b|[{>]\s*(?:task|row|item)\??\.\s*title\b|\{title\b/;

/**
 * ③ 截止槽。`renderMeta` 是 `packages/ui` 给宿主注入截止/优先级的插槽；
 * `DueBadge` 是 web 与 landing 各自的截止徽标组件名。
 */
const DUE_SIGNAL =
  /(?:\bht-due\b|\bmk-due\b|\bDueBadge\b|\brenderMeta\b|\bdueAt\b|\bdueText\b|\bcountdown\b|\boverdue\b)/i;

/** 三种信号一起，用于遍历时一次判定。 */
const ROW_SIGNALS = [
  { key: '勾选框', re: CHECKBOX_SIGNAL },
  { key: '标题槽', re: TITLE_SIGNAL },
  { key: '截止槽', re: DUE_SIGNAL },
];

/** 唯一允许持有任务行实现的目录（相对仓库根）。 */
const SINGLE_SOURCE_DIR = join('packages', 'ui');

/** 扫描根。契约说"全仓"，所以 apps 与 packages 都要扫（`packages/ui` 除外）。 */
const SCAN_ROOTS = ['apps', 'packages'];

/** 不扫的目录：产物、第三方、原生工程。 */
const SKIP_DIRS = new Set([
  'node_modules',
  'dist',
  'dist-types',
  'build',
  'coverage',
  '.expo',
  'ios',
  'android',
  'Pods',
  '.gradle',
  '.cxx',
  '.turbo',
]);

const SOURCE_EXTENSIONS = ['.tsx', '.jsx', '.ts', '.mts', '.cts'];

/**
 * 在一份源码里找"任务行"：三种信号齐备的**最内层** JSX 元素。
 * 返回 `[{ line, element }]`。
 */
function findTaskRows(text) {
  const { nodes, code } = scanJsxTree(text);
  const qualifying = [];
  for (const node of nodes) {
    const body = code.slice(node.start, node.end);
    if (ROW_SIGNALS.every((s) => s.re.test(body))) qualifying.push(node);
  }
  // 只留最内层：把"还包着另一棵合格子树"的容器剔掉。
  // 否则 `.ht-tasklist` / 组件根 div 会和真正的行一起被报出来，噪音翻倍。
  const innermost = qualifying.filter(
    (node) =>
      !qualifying.some(
        (other) =>
          other !== node &&
          other.start >= node.start &&
          other.end <= node.end &&
          !(other.start === node.start && other.end === node.end),
      ),
  );
  return innermost.map((node) => ({ line: lineAt(text, node.start), element: node.name }));
}

/* ========================================================================
 * 遍历
 * ====================================================================== */

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
    if (st.isDirectory()) {
      yield* walk(full);
    } else if (SOURCE_EXTENSIONS.some((e) => name.endsWith(e))) {
      // 测试文件不算"实现"：它们查 `.ht-task__title` 是**断言选择器**，
      // 不是在重新渲染一行。
      if (/\.(spec|test)\.[cm]?tsx?$/.test(name)) continue;
      yield full;
    }
  }
}

/**
 * 豁免目录：**唯一实现**（`packages/ui`）+ **landing 的复刻件**。
 *
 * `apps/landing/src/mockup/**` 是**营销页的界面复现件**，不是产品界面。
 * 它被豁免的理由与**替代约束**写在文件头「为什么 landing 的复刻件被豁免」一节 ——
 * 一句话：静态引入 `@heyta/ui` 会让 landing 首屏 +31% gzip，而那是产品取舍。
 *
 * 🔴 **豁免是有代价的**：`mockup/**` 从此不受这条断言保护，所以配套的
 * `apps/landing/tests/mockup-task-row.spec.tsx` 必须存在且会红。
 * 删掉那个测试**不会让任何门禁变红** —— 这正是豁免的危险之处，
 * 所以这句话写在这里。
 */
const EXEMPT_DIRS = [SINGLE_SOURCE_DIR, 'apps/landing/src/mockup'];

function inSingleSource(relPath) {
  return relPath === SINGLE_SOURCE_DIR || relPath.startsWith(SINGLE_SOURCE_DIR + sep);
}

/** 该相对路径是否被豁免（唯一实现本身，或 landing 复刻件）。 */
function isExempt(relPath) {
  return EXEMPT_DIRS.some((dir) => relPath === dir || relPath.startsWith(dir + sep));
}

const duplicates = [];
let sharedRowCount = 0;
const sharedSignalCounts = Object.fromEntries(ROW_SIGNALS.map((s) => [s.key, 0]));
let scannedFiles = 0;

for (const root of SCAN_ROOTS) {
  const absRoot = join(ROOT, root);
  if (!existsSync(absRoot)) continue;
  for (const file of walk(absRoot)) {
    const rel = relative(ROOT, file);
    const text = readFileSync(file, 'utf8');
    scannedFiles += 1;

    // 唯一实现目录先统计"三种信号各命中多少"——**不管有没有扫出行都统计**，
    // 这样锚点失效时能指出死掉的是哪一张标记表（否则只会说"扫不到"）。
    if (inSingleSource(rel)) {
      for (const s of ROW_SIGNALS) {
        if (s.re.test(text)) sharedSignalCounts[s.key] += 1;
      }
    }

    const rows = findTaskRows(text);
    if (rows.length === 0) continue;

    if (inSingleSource(rel)) {
      sharedRowCount += rows.length;
      continue;
    }
    // 🔴 豁免（`apps/landing/src/mockup/**`）—— 理由见文件头，
    //    替代约束是 `task-row-shape.ts` + `apps/landing/tests/mockup-task-row.spec.tsx`。
    if (isExempt(rel)) continue;
    duplicates.push({ rel, rows });
  }
}

/* ========================================================================
 * 断言 B：`ht-*` 前缀族
 * ====================================================================== */

/**
 * M3 开始时的**实测值**（命令见文件头），也是这条规则的**上限**。
 *
 * 🔴 **31 是怎么来的（可追溯）**：
 *   - `docs/research/dida-view-unification.md` §5 / §8.4 写的是"基线 30"；
 *   - 2026-09-28 有人在 web 加搜索框时引入了 `.ht-search` / `.ht-search__input` /
 *     `.ht-search__clear` —— 一个新族，于是 app.css 实测变成 **31**；
 *   - 当时**没有任何门禁**能发现它（这道门禁正是为此而建）。
 *
 * 所以 31 不是"一直都这样"，而是**"只减不增"这条规则刚立起来就被真实违反过一次**
 * 之后的数字。写 31 是为了从**今天**起钉住，不是承认那 +1 合法；
 * 把 `.ht-search` 收编回共享层之后，这个常量应当跟着下调。
 *
 * ⬇️ 31 → **29**（M3 第一刀：web 任务列表迁到共享 `TaskList`）。
 * 一次性降了两个族：`.ht-tasklist` 与 `.ht-task`（含 `__check` / `__title` /
 * `__meta` 全部下游选择器）—— 那一整族现在由 `packages/ui` 的 `TaskList`
 * 渲染，web 侧不再有第二份。按本脚本自己的提醒下调基线，
 * 否则"只减不增"会退化成"可以永久多 2 个"。
 */
/** 🔴 P1 棘轮：29 → **28**（M3 第八刀 capture 落地后，删掉 `.ht-compose-wrap` 与
 * `.ht-capture*` 共 15 条死规则 —— 它们零 TSX 引用，由执行 agent 发现、父 agent 执行
 * （`app.css` 不在执行者白名单）。⚠️ `.ht-compose` **不是**死的（`features/tasks/NoteEditor.tsx` 在用），
 * 已保留。 */
const HT_FAMILY_BASELINE = 28;

const APP_CSS = join('apps', 'web', 'src', 'styles', 'app.css');

function collectHtFamilies() {
  const abs = join(ROOT, APP_CSS);
  if (!existsSync(abs)) {
    return {
      error:
        `找不到 ${APP_CSS}。\n` +
        `      ⇒ 判据 3 锚在"app.css 的顶层 ht-* 族"上；文件改名/搬家之后本检查\n` +
        `        必须**报错**，而不是"0 ≤ 基线，✅"（那正是一个永远通过的门禁）。`,
    };
  }
  const lines = readFileSync(abs, 'utf8').split('\n');
  const families = new Set();
  for (const line of lines) {
    const m = /^\.ht-[a-z]+/.exec(line);
    if (m !== null) families.add(m[0]);
  }
  if (families.size === 0) {
    return {
      error:
        `${APP_CSS} 里一个顶层 \`.ht-*\` 族都扫不到。\n` +
        `      ⇒ 要么命名约定被改了、要么类名不再行首。无论哪种，判据 3 都已失效，\n` +
        `        必须在这里报错（见 check-pricing-consistency.mjs 文件头的同一条纪律）。`,
    };
  }
  return { families: [...families].sort() };
}

/* ========================================================================
 * 报告
 * ====================================================================== */

let failed = false;

console.log('─'.repeat(72));
console.log('断言 A：任务行（复选框 + 标题 + 截止）的实现只有一份');
console.log('─'.repeat(72));

// 🔴 锚点自检：唯一实现必须真的被扫到。扫不到 = 判据已失效，不是"通过"。
if (sharedRowCount === 0) {
  failed = true;
  console.error(
    `🔴 ${SINGLE_SOURCE_DIR} 里扫不出任何一棵"复选框 + 标题 + 截止"的 JSX 子树。\n` +
      `   本门禁锚定 \`${SINGLE_SOURCE_DIR}\` 是那唯一的一份；它扫不到，就说明判据已经失效\n` +
      `   （通常是标记被改名，例如 accessibilityRole="checkbox" 或 {row.title} 被换掉）。\n` +
      `   ⇒ 这不是"没有违规"，是**这道检查已经不能做事了**。\n` +
      `   修法：确认 \`${SINGLE_SOURCE_DIR}/src/task-list/\` 的任务行仍在，\n` +
      `        并同步更新本脚本文件头的三张标记表（勾选框 / 标题槽 / 截止槽）。\n` +
      `   当前各信号在 ${SINGLE_SOURCE_DIR} 的命中：` +
      Object.entries(sharedSignalCounts)
        .map(([k, v]) => `${k}=${String(v)}`)
        .join('、') +
      '\n',
  );
} else if (duplicates.length > 0) {
  failed = true;
  console.error(
    `🔴 任务行有 ${String(duplicates.length)} 处手写副本（应当只有 ${SINGLE_SOURCE_DIR} 一份）：\n`,
  );
  for (const d of duplicates) {
    for (const row of d.rows) {
      console.error(`   ${d.rel}:${String(row.line)}`);
      console.error(`      这里渲染了一棵 <${row.element}>，同时含勾选框 + 标题槽 + 截止槽。`);
    }
  }
  console.error(
    `\n      修法：接 ${SINGLE_SOURCE_DIR} 的 \`TaskList\`（\`import { TaskList } from '@heyta/ui'\`）。\n` +
      `      宿主只该注入文案与尾部动作（\`renderMeta\` / \`renderTrailing\` / \`labels\`），\n` +
      `      行的骨架本身不重写。判据出处：docs/research/dida-view-unification.md §5 / §8.4 判据 2。\n` +
      `      ⚠️ 这道红是**正确**的：M3 的主体工作就是把这些副本收编。不要为了变绿放宽判据。\n`,
  );
} else {
  console.log(
    `✅ 任务行只在 ${SINGLE_SOURCE_DIR} 里实现（扫到 ${String(sharedRowCount)} 棵；` +
      `扫描 ${String(scannedFiles)} 个文件）。`,
  );
}

console.log('');
console.log('─'.repeat(72));
console.log('断言 B：apps/web/src/styles/app.css 的顶层 ht-* 前缀族只减不增');
console.log('─'.repeat(72));

const ht = collectHtFamilies();
if (ht.error !== undefined) {
  failed = true;
  console.error(`🔴 ${ht.error}\n`);
} else {
  const count = ht.families.length;
  if (count > HT_FAMILY_BASELINE) {
    failed = true;
    console.error(
      `🔴 ht-* 前缀族 ${String(count)} 个，超过基线 ${String(HT_FAMILY_BASELINE)}（多了 ${String(count - HT_FAMILY_BASELINE)} 个）：\n`,
    );
    console.error(`   当前族：${ht.families.join(' ')}\n`);
    console.error(
      `   ⇒ 新视图**不该**长出新前缀族（§3 判据 7 / §8.4 判据 5）；\n` +
        `      该复用的是 packages/ui 的模式层（TaskRow / ListSurface / …），不是再写一套 CSS。\n` +
        `      若确实是收编旧族同时又长了一个新族，基线也一样要挡住：先消掉净增，再改这个常量。\n`,
    );
  } else if (count < HT_FAMILY_BASELINE) {
    console.log(
      `✅ ht-* 前缀族 ${String(count)} 个 ≤ 基线 ${String(HT_FAMILY_BASELINE)}（M3 中已降 ${String(HT_FAMILY_BASELINE - count)} 个）。`,
    );
    console.log(
      `   ⬇️ 建议把本脚本的 HT_FAMILY_BASELINE 下调到 ${String(count)} —— 基线不跟着降\n` +
        `      就会变成永久豁免，M3 的"只减不增"就只剩前半句。`,
    );
    console.log(`   当前族：${ht.families.join(' ')}`);
  } else {
    console.log(
      `✅ ht-* 前缀族 ${String(count)} 个，恰在基线 ${String(HT_FAMILY_BASELINE)}（未新增）。`,
    );
  }
}

console.log('');
if (failed) {
  console.error('🔴 任务行单一来源门禁未通过。\n');
  process.exit(1);
}
console.log('✅ 任务行单一来源 + ht-* 族基线：两道断言都通过。\n');
