#!/usr/bin/env node
/**
 * `pnpm check:breakpoints` —— 响应式断点的**一把尺**（2026-10-26 加）
 * ==================================================================
 *
 * ## 这一枚治的是什么
 *
 * 产品负责人的原话：「电脑端的话，Web 端也需要根据手机端实际来自适应。比如我用手机浏览器
 * 打开对应的界面，并且登录了，也要按照移动端来显示。**整个项目必须完整做好响应式布局**。」
 *
 * 立项当时的实测（`apps/web/src`：**33 处**宽度条件，其中 32 个 `@media` 块、
 * 1 个块里写了两个互补边界；另有 5 处 JS `matchMedia` 字符串）：
 *
 *     30rem 6 · 36rem 3 · 40rem 7 · 48rem 4 · 64rem 2
 *     768px 6 · 769px 2 · 1023px 2 · 1024px 1
 *
 * ⇒ **9 种宽度值**。"整个项目做好响应式"的真障碍不是缺规则，是**没有一把统一的尺**：
 * 同一个阈值被写成 `48rem` 与 `768px` 两种拼法（10 处），互补的两半被写成
 * `max-width: 768px` / `min-width: 769px`（差一像素的两枚字面量），而 480 / 576 / 640
 * 三个值在解**同一类题**（"两栏放不下了，改一栏"）—— 换一屏就换一个数。
 *
 * 这种账**只能靠判据**：9 个数字里任何一个单看都"有道理"，评审时没人能因为它红。
 *
 * ## 这把尺（真源：[`docs/agents/design-system.md`](../docs/agents/design-system.md) §断点）
 *
 * `@media` 里**用不了 CSS 变量**（规范如此，不是懒），所以尺不可能住进 `tokens.css`。
 * 它只能由两件事同时钉住：**文档约定 + 这一枚门禁**。
 *
 * | 档 | 宽度表达式 | px @16 | 判什么 |
 * |---|---|---|---|
 * | 紧凑 | `(max-width: 48rem)` | ≤768 | 导航变底栏、设置双栏→单栏、三栏→单栏 |
 * | 中等 | `(min-width: 48.0625rem) and (max-width: 63.9375rem)` | 769–1023 | 详情列仍不出（rail+sidebar+detail ≈41rem，账在 `narrow.css` 文件头） |
 * | 宽屏 | `(min-width: 64rem)` | ≥1024 | 三栏 |
 *
 * 高度是**另一根轴**（不跟宽度档混）：`30rem`(480px) 是"这一屏还画得下两栏吗"的下沿
 * （出处：Android 窗口尺寸类的**高度** Compact = 高 <480dp，`narrow.css` 里逐字引过），
 * `36rem` 是"AI 欢迎内容比面板高"的内部塌缩点。两根轴各自的登记值在下面 `TIERS`。
 *
 * ## 两条「一像素」派生
 *
 * CSS 媒体查询**没有**"严格大于"。所以互补的两半只能差一像素，两个数**必须由 48/64 算出来**，
 * 不许手写（手写过一次：`769px` 与 `1023px` 各写一处，谁都不知道它们是从哪来的）：
 *
 *     ABOVE_COMPACT = 48rem + 1px = 48.0625rem       BELOW_WIDE = 64rem − 1px = 63.9375rem
 *
 * B3 就是这两条式子的算术自检 —— 改坏一个小数点它先红，而不是等到 768 宽时布局错一像素。
 *
 * ## 判决（B1–B8）与臂（`--self-test`，17 枚，每条都真的跑判决本体）
 *
 *   B1 未登记的值 ⇒ 红（含"换单位躲尺"：`640px` / `48em` 同红）
 *   B2 **登记值的 px 拼写** ⇒ 红（`768px` 这一型，立项时 6 处，就是"两种拼法"本身）
 *   B3 一像素派生的**算术** ⇒ 改坏小数必红（`48.0625` / `63.9375` 不许手写成别的数）
 *   B4 **分母下限**：落点数少于基线 ⇒ 红（"什么都没看见"不许算绿）
 *   B5 JS 侧的宽/高字面量只许住在 `apps/web/src/lib/breakpoints.ts`
 *      （立项时 3 个文件各抄一份；收口后真树落点 **0**，它防的是下一次抄）
 *   B6 容器查询（`@container`）是**另一根轴**：必须带容器名，且 (容器名, 阈值) 要登记
 *   B7 动态查询 `(min-width: ${x})` 只许出现在"从 `--ht-*` 读出来"的文件里
 *      （今天：倒计时 / 四象限那两处读 `--ht-layout-two-column-min`；`breakpoints.ts` 本身是尺，豁免）
 *   B8 `--ht-layout-two-column-min` 必须与紧凑档是同一个数（尺已经住进 token 的那一处）
 *
 * 臂清单：①未登记rem ②登记值不红 ③768px ④640px ⑤48em ⑥串轴 ⑦派生算错 ⑧零落点
 * ⑨注释里的旧值不误伤 ⑩(pointer: coarse) 不误伤 ⑪JS 抄字面量 ⑫动态查询两向
 * ⑬迁移前那 9 种值必红 ⑭无名 @container ⑮容器阈值两向 ⑯视口用容器阈值 ⑱拼错旗标
 *
 * ## 已知边界（在册，不装作没有）
 *
 * · **只管 `apps/web/src`**。`apps/mobile` 是 RN（没有媒体查询），`apps/landing` 是另一张脸。
 * · **管不到非尺寸条件**（`pointer` / `prefers-*` / `display-mode`）。这一枚尺的题目是"阈值",
 *   把条件词也收进来会让它更容易假红，而假红会让下一个人加白名单 —— 那一格归评审。
 *   反向有臂（B12）保证 `(pointer: coarse)` 这类不会被误伤。
 * · **管不到"值对了但选错档"**：`sheets.css` 用 48rem 做了一张卡片的塌缩，值合法、语义可疑。
 *   那一格只能靠看图和 `docs/agents/ux-principles.md`。
 *
 * 跑法：`node scripts/check-breakpoints.mjs`（0 = 干净，1 = 有违规）
 *       `node scripts/check-breakpoints.mjs --self-test`（17 臂）
 *       `node scripts/check-breakpoints.mjs --verbose`（打印每处落点）
 */

import { execFile } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const SELF = fileURLToPath(import.meta.url);

/** 扫描面。宽度/高度的落点只认这三个扩展名。 */
const SCAN_ROOT = join(ROOT, 'apps/web/src');
const SKIP_DIRS = new Set(['node_modules', 'dist', 'evidence', '.vite', 'coverage']);

/**
 * 🔴 JS 侧宽/高字面量的**唯一**合法住所。
 * 理由：`useNarrowLayout.ts` 与 `ScopeDrawer.tsx` 各抄了一份 `(max-width: 768px)`，
 * `detail-pane-visible.ts` 又抄了一份 `(min-width: 1024px) and (min-height: 480px)` ——
 * 三份抄件与 CSS 的四条规则没有任何机制保证一致（`note-editor-placement.spec.tsx`
 * 之前就是靠"把字面量再抄一遍"来对账的）。收进一个模块之后，对账才可能变成 import。
 */
const JS_OWNER = 'apps/web/src/lib/breakpoints.ts';

const PX_PER_REM = 16;
/** CSS 媒体查询没有"严格大于"：互补的一像素只能自己算。1px = 1/16 rem。 */
const ONE_PX_REM = 1 / PX_PER_REM;

/**
 * 尺本身。**改这里 = 改全仓的响应式语义**，所以每条都带一句"它在判什么"。
 * `rem` 是唯一合法拼写；`px` 那一列只用来对账（B2 判"px 拼写"、B8 判 token 漂移）。
 */
const WIDTH_TIERS = [
  { name: 'compact-max', rem: 48, why: '紧凑档的上沿：底栏导航 / 设置单栏 / 详情列不出' },
  { name: 'above-compact', rem: 48 + ONE_PX_REM, why: '紧凑档的互补下限（strictly greater 的写法）' },
  { name: 'below-wide', rem: 64 - ONE_PX_REM, why: '宽屏档的互补上限' },
  { name: 'wide-min', rem: 64, why: '宽屏档的下沿：三栏成立' },
];

const HEIGHT_TIERS = [
  { name: 'short-max', rem: 30 - ONE_PX_REM, why: '矮屏上沿（479px）：Android 高度 Compact 的反面' },
  { name: 'tall-min', rem: 30, why: '矮屏的互补下限（480px）：两栏可行' },
  { name: 'panel-tight', rem: 36, why: 'AI 欢迎内容高于面板时的内部塌缩点' },
];

const ALL_TIERS = [...WIDTH_TIERS, ...HEIGHT_TIERS];

/**
 * **容器查询**的阈值是另一根轴，**不许**并进视口那把尺。
 *
 * `@media` 量的是**视口**，`@container` 量的是**容器**。同一个 `26rem` 在两处是完全不同的
 * 两件事：视口 416px 是"一台很窄的窗口"，而 `habit-detail` 容器 416px 是"这一栏刚好够画"。
 * `habits.css:44` 那段注释已经把这条账算过一遍（"用视口媒体查询会得到'视口够宽而这一列
 * 其实很窄'的错判"）—— 所以这里登记的是 **(容器名, 阈值) 对**，不是又一个数字清单。
 *
 * 立项当时全仓 **5 处** `@container`：`habit` 33rem ×2、`habit-detail` 26rem、`ai-panel`
 * 42rem + 26rem。其中 `habit` 那两处写的是**无名**容器（`@container (min-width: 33rem)`）——
 * 无名容器解析到"最近的容器祖先"，今天恰好是 `.ht-habit` 自己，改一层 DOM 就换了一把尺，
 * 而且它**不会红**。B6 就是钉这一条：`@container` 必须带容器名。
 */
const CONTAINER_TIERS = [
  { container: 'habit', rem: 33, why: '习惯卡片列：这一列自己的宽度够不够排两列' },
  { container: 'habit-detail', rem: 26, why: '习惯详情栏：栏够不够排"名字 + 三枚动作"' },
  { container: 'ai-panel', rem: 26, why: 'AI 面板：页头退化成换行' },
  { container: 'ai-panel', rem: 42, why: 'AI 面板：历史栏从并排退成浮层' },
];

const round = (n) => Math.round(n * 1e4) / 1e4;
const px = (rem) => round(rem * PX_PER_REM);

/** 登记值的查表键：把 rem 数对到档名。 */
const byRem = new Map(ALL_TIERS.map((t) => [round(t.rem), t]));
const widthSet = new Set(WIDTH_TIERS.map((t) => round(t.rem)));

/**
 * 落点数的基线。低于它说明**扫描面或谓词坏了**（不是"仓库突然干净了"）。
 *
 * 现量取自迁移完成那一轮（2026-10-26）：宽度 38 处（CSS `@media` 35 + JS 0 +
 * `breakpoints.ts` 之外 0 —— 那 3 处是 `@container` 被算进宽度轴之外的独立计数）。
 * 高度 3 处。
 *
 * ⚠️ **合并断点本身是合法的**：真要把两处合成一处，就在同一个改动里把这两个数改小，
 * 并在提交信息里说明"降是因为合并，不是因为扫描坏了"。这一臂防的是后者 ——
 * 一个坏了的选择器会让它"什么都没看见"地绿过去，而那种绿是靠人发现不了的。
 */
const WIDTH_FLOOR = 38;
const HEIGHT_FLOOR = 3;

/* ── 掩码：注释必须剥掉，否则把"记录自己"读成违规 ────────────────── */

/**
 * CSS 去注释，**等长**（换行保留）⇒ offset 与行号一一对应。
 * TS/JS 用下面的 `maskJsComments`（同样等长、保留换行、保留字符串 ——
 * 媒体查询正是写在字符串里，抹掉就永远匹配不到）。两者都**只剥注释**：注释里提到旧值
 * 是记录，不是声明（`sheets.css` 与 `detail-pane-visible.ts` 都记着历史）。
 */
function maskCssComments(source) {
  const out = source.split('');
  let i = 0;
  while (i < source.length) {
    if (source[i] === '/' && source[i + 1] === '*') {
      const end = source.indexOf('*/', i + 2);
      const stop = end === -1 ? source.length : end + 2;
      for (let k = i; k < stop; k += 1) if (source[k] !== '\n') out[k] = ' ';
      i = stop;
      continue;
    }
    i += 1;
  }
  return out.join('');
}

/**
 * TS/JS 去注释，**等长且保留换行**。
 *
 * 🔴 为什么不直接用 `scripts/lib/jsx-tree.mjs` 的 `maskSource().code`：它把注释区间**整体**
 * 抹成空格（含换行），于是同一文件里注释之后的落点全部对不上行号 —— 实测把
 * `breakpoints.ts` 的 6 处报成了注释表格的第 21/23/25/27/29/31 行。判据可以严，但
 * "报错报在注释里"会让人怀疑尺坏了，而怀疑之后就是加白名单。
 *
 * 行为与 maskCssComments 一致（剥注释、保留字符串），额外的只有 `//` 行注释；
 * 字符串/模板串按状态机跳过，所以 `'http://x'` 里的 `//` 不会被当成注释（那正是
 * `strip-ts-comments.mjs` 头部写明的取舍：它不跟踪字符串，代价是假红 —— 这里给得起
 * 更好的那一版）。
 */
function maskJsComments(source) {
  const out = source.split('');
  const blank = (from, to) => {
    for (let k = from; k < to && k < source.length; k += 1) if (source[k] !== '\n') out[k] = ' ';
  };
  let i = 0;
  while (i < source.length) {
    const c = source[i];
    if (c === '/' && source[i + 1] === '/') {
      let j = i;
      while (j < source.length && source[j] !== '\n') j += 1;
      blank(i, j);
      i = j;
      continue;
    }
    if (c === '/' && source[i + 1] === '*') {
      const end = source.indexOf('*/', i + 2);
      const stop = end === -1 ? source.length : end + 2;
      blank(i, stop);
      i = stop;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      let j = i + 1;
      while (j < source.length) {
        if (source[j] === '\\') {
          j += 2;
          continue;
        }
        if (source[j] === c) {
          j += 1;
          break;
        }
        j += 1;
      }
      i = j;
      continue;
    }
    i += 1;
  }
  return out.join('');
}

const maskFor = (file, text) =>
  file.endsWith('.css') ? maskCssComments(text) : maskJsComments(text);

/** 媒体条件里的**尺寸**项：`(max-width: 48rem)` / `(min-height: 480px)`。 */
const SIZE_RE = /\((max|min)-(width|height):\s*([0-9.]+)\s*(rem|px|em)\)/g;
/** 动态形态：`(min-width: ${min})` —— 值在运行时才定，只能判"它从哪来"。 */
const DYNAMIC_RE = /\((max|min)-(width|height):\s*\$\{/g;
/** at-rule 头：媒体查询 / 容器查询。第二个捕获组是条件正文（不含花括号）。 */
const AT_RE = /@(media|container)\b([^{;]*)\{/g;

/** `@container <name> (...)` 里的 `<name>`；无名容器返回空串。 */
function containerNameOf(prelude) {
  const head = prelude.split('(')[0].trim();
  return /^-?[A-Za-z_][\w-]*$/.test(head) ? head : '';
}


function lineAt(text, offset) {
  let line = 1;
  for (let i = 0; i < offset && i < text.length; i += 1) if (text[i] === '\n') line += 1;
  return line;
}

/* ── 判决本体（纯函数，self-test 直接喂夹具） ─────────────────────── */

/**
 * @param {{files: Array<{file: string, text: string}>}} input
 * @returns {{problems: string[], widthSites: number, heightSites: number, dynamicSites: number}}
 */
function judge({ files, floors = null }) {
  const problems = [];
  let widthSites = 0;
  let heightSites = 0;
  /** 记下每一处"被判红的值"，self-test 数种数用（不靠字符串反解）。 */
  const offending = new Set();
  /** 动态查询落点：`{ file, line }`（文件身份要留着，B7 要回去读它是不是从 token 来的）。 */
  const dynamic = [];
  const seenDynamicFiles = new Map(files.map((f) => [f.file, f.text]));

  for (const { file, text } of files) {
    const masked = maskFor(file, text);
    const isJs = file.endsWith('.ts') || file.endsWith('.tsx');
    const handled = new Set();

    /**
     * 一处尺寸条件的判决。抽成函数是因为它有两个入口：
     *   · CSS：条件住在 `@media` / `@container` 头里（要分开两根轴）；
     *   · JS：条件住在 `matchMedia('…')` 的字符串里（没有 at-rule，也就没有容器名）。
     * 两个入口共用同一份判决，否则"同一个尺"会立刻变成两份实现。
     */
    const judgeCondition = (offset, kind, axis, raw, unit, rule, containerName) => {
      const axisName = axis === 'width' ? '宽度' : '高度';
      const isWidth = axis === 'width';
      const where = `${file}:${String(lineAt(masked, offset))}`;
      if (isWidth) widthSites += 1;
      else heightSites += 1;

      const value = Number(raw);
      if (!Number.isFinite(value)) {
        problems.push(`B1 ${where} 尺寸读不出来（${kind}-${axis}: ${raw}${unit}）`);
        return;
      }

      if (rule === 'container') {
        // B6：容器查询是另一根轴 —— 只判"带不带名"与"(名, 值) 登记过没有"
        if (containerName === '') {
          problems.push(
            `B6 ${where} 无名 @container（${raw}${unit}）：无名容器解析到"最近的容器祖先"，` +
              '改一层 DOM 就换了一把尺，而且它不会红。写上容器名（`@container <name> (...)`）',
          );
          return;
        }
        const okContainer = CONTAINER_TIERS.some(
          (t) => t.container === containerName && round(t.rem) === round(value) && unit === 'rem',
        );
        if (!okContainer) {
          offending.add(`@${containerName} ${raw}${unit}`);
          problems.push(
            `B6 ${where} 容器 \`${containerName}\` 未登记的阈值 ${raw}${unit}。` +
              `已登记：${CONTAINER_TIERS.map((t) => `${t.container}=${String(t.rem)}rem`).join(' / ')} —— ` +
              '容器查询量的是容器不是视口，所以它不进宽度尺；但它同样只许登记过的值',
          );
        }
        return;
      }

      // em 与 rem 在媒体查询里等价（都按初始字号），两种拼法只会让 grep 漏一头。
      if (unit === 'em') {
        offending.add(`${raw}em`);
        problems.push(`B1 ${where} 用 em 写断点（${raw}em）：媒体查询里 em 与 rem 等价，只留 rem 一种拼法`);
        return;
      }
      if (unit === 'px') {
        const asRem = round(value / PX_PER_REM);
        const hit = byRem.get(asRem);
        offending.add(`${raw}px`);
        problems.push(
          hit
            ? `B2 ${where} px 拼写：${raw}px 就是登记的 ${String(hit.rem)}rem（${hit.name}）—— 同一个阈值只许一种拼法`
            : `B2 ${where} px 拼写且不在尺上：${raw}px（≈${String(asRem)}rem）。宽度/高度落点一律用登记的 rem 值`,
        );
        return;
      }

      const key = round(value);
      const hit = byRem.get(key);
      if (hit === undefined) {
        offending.add(`${raw}rem`);
        problems.push(
          `B1 ${where} 未登记的${axisName}断点 ${raw}rem（${String(px(key))}px）。` +
            `登记值是 ${ALL_TIERS.map((t) => String(round(t.rem))).join(' / ')}rem —— ` +
            '要么改用其中一档，要么先把它写进 docs/agents/design-system.md 与本脚本 TIERS 并说明它在判什么',
        );
        return;
      }
      if (isWidth && !widthSet.has(key)) {
        offending.add(`${raw}rem`);
        problems.push(
          `B1 ${where} ${raw}rem 只登记在**高度**轴上，不能当宽度上沿用（宽度只有 ${[...widthSet].join(' / ')}rem 四档）`,
        );
        return;
      }
      if (!isWidth && widthSet.has(key)) {
        offending.add(`${raw}rem`);
        problems.push(
          `B1 ${where} ${raw}rem 只登记在**宽度**轴上，不能当高度条件用（高度只有 ${HEIGHT_TIERS.map((t) => String(round(t.rem))).join(' / ')}rem）`,
        );
        return;
      }

      // B5：JS 侧的宽/高字面量只许住在 JS_OWNER
      if (isJs && file !== JS_OWNER) {
        problems.push(
          `B5 ${where} JS 里写死了${axisName}断点 ${raw}rem。它必须从 ` +
            `${JS_OWNER} import —— 今天全仓有 3 处各抄一份，CSS 改了它们不会跟着改`,
        );
      }
    };

    // 入口一：at-rule 头。分开 `@media`（量视口）与 `@container`（量容器）——
    // 全文扫 `(max-width: N)` 会把两者混成一把尺，而它们的题目不同。
    AT_RE.lastIndex = 0;
    let at;
    while ((at = AT_RE.exec(masked)) !== null) {
      const [, rule, prelude] = at;
      const preludeStart = at.index + 1 + rule.length;
      const containerName = rule === 'container' ? containerNameOf(prelude) : '';
      SIZE_RE.lastIndex = 0;
      let m;
      while ((m = SIZE_RE.exec(prelude)) !== null) {
        handled.add(preludeStart + m.index);
        judgeCondition(preludeStart + m.index, m[1], m[2], m[3], m[4], rule, containerName);
      }
    }

    // 入口二：JS 里的 `matchMedia('(max-width: …)')`。它不是 at-rule，没有容器名，
    // 所以整段按"视口条件"判；已经被 at-rule 入口收过的偏移跳过（模板串里写 CSS 的情形）。
    if (isJs) {
      SIZE_RE.lastIndex = 0;
      let m;
      while ((m = SIZE_RE.exec(masked)) !== null) {
        if (handled.has(m.index)) continue;
        judgeCondition(m.index, m[1], m[2], m[3], m[4], 'media', '');
      }
    }

    DYNAMIC_RE.lastIndex = 0;
    let d;
    while ((d = DYNAMIC_RE.exec(masked)) !== null) {
      dynamic.push({ file, line: lineAt(masked, d.index) });
    }
  }

  // B7：动态查询必须"从 token 读出来"，否则它就是一个换了写法的裸值
  for (const ref of dynamic) {
    const text = seenDynamicFiles.get(ref.file) ?? '';
    // 🔴 JS_OWNER 本身就是那把尺：它用 `rem(...)` 拼出登记值，插值正是它的职责。
    if (ref.file === JS_OWNER) continue;
    if (!/getPropertyValue\(\s*['"]--ht-/.test(text)) {
      problems.push(
        `B7 ${ref.file}:${String(ref.line)} 动态媒体查询不是从 \`--ht-*\` 读出来的：那样它就是一个躲过字面量扫描的裸断点`,
      );
    }
  }

  // B3：一像素派生必须真的是"一像素"
  const above = WIDTH_TIERS.find((t) => t.name === 'above-compact');
  const below = WIDTH_TIERS.find((t) => t.name === 'below-wide');
  const compact = WIDTH_TIERS.find((t) => t.name === 'compact-max');
  const wide = WIDTH_TIERS.find((t) => t.name === 'wide-min');
  if (!above || !below || !compact || !wide) {
    problems.push('B3 宽度尺少了档（compact-max / above-compact / below-wide / wide-min 四档缺一不可）');
  } else {
    if (round(above.rem - compact.rem) !== round(ONE_PX_REM)) {
      problems.push(
        `B3 above-compact 必须恰好是 compact-max + 1px：现量 ${String(above.rem)} − ${String(compact.rem)} = ${String(round(above.rem - compact.rem))}rem`,
      );
    }
    if (round(wide.rem - below.rem) !== round(ONE_PX_REM)) {
      problems.push(
        `B3 below-wide 必须恰好是 wide-min − 1px：现量 ${String(wide.rem)} − ${String(below.rem)} = ${String(round(wide.rem - below.rem))}rem`,
      );
    }
    if (round(compact.rem * PX_PER_REM) !== Math.round(compact.rem * PX_PER_REM)) {
      problems.push('B3 compact-max 落在非整像素上，那它不是一个能被设备宽度命中的边界');
    }
  }

  // B4：分母下限。**只对真树生效** —— 夹具本来就只有几处落点，
  // 对夹具判下限会把"这条臂测的东西"换成"夹具够不够大"。
  if (floors !== null && widthSites < floors.width) {
    problems.push(
      `B4 宽度断点只扫到 ${String(widthSites)} 处（基线 ${String(floors.width)}）：` +
        '扫描面或谓词坏了 —— "什么都没看见"不许算绿',
    );
  }
  if (floors !== null && heightSites < floors.height) {
    problems.push(
      `B4 高度断点只扫到 ${String(heightSites)} 处（基线 ${String(floors.height)}）：同上`,
    );
  }

  return { problems, widthSites, heightSites, dynamicSites: dynamic.length, offending };
}

/* ── 工作树读数 ─────────────────────────────────────────────────── */

function walk(dir, acc) {
  let names;
  try {
    names = readdirSync(dir);
  } catch {
    return acc;
  }
  for (const name of names) {
    if (SKIP_DIRS.has(name)) continue;
    const abs = join(dir, name);
    let st;
    try {
      st = statSync(abs);
    } catch {
      continue;
    }
    if (st.isDirectory()) walk(abs, acc);
    else if (/\.(css|ts|tsx)$/.test(name)) acc.push(abs);
  }
  return acc;
}

function treeFiles() {
  return walk(SCAN_ROOT, []).map((abs) => ({
    file: relative(ROOT, abs).replaceAll('\\', '/'),
    text: readFileSync(abs, 'utf8'),
  }));
}

/** B8：token 与尺必须同一个数。它是唯一一枚"尺已经住进 tokens.css"的地方。 */
function tokenDrift() {
  const css = readFileSync(join(ROOT, 'packages/design-system/src/tokens.css'), 'utf8');
  const m = /--ht-layout-two-column-min:\s*([0-9.]+)(rem|px)\s*;/.exec(css);
  if (m === null) return 'B8 tokens.css 里找不到 --ht-layout-two-column-min（那枚 token 是 768 这一档的唯一登记）';
  const value = Number(m[1]);
  const asRem = m[2] === 'px' ? round(value / PX_PER_REM) : round(value);
  const compact = WIDTH_TIERS.find((t) => t.name === 'compact-max');
  if (round(asRem) !== round(compact.rem)) {
    return (
      `B8 --ht-layout-two-column-min = ${m[1]}${m[2]}（≈${String(asRem)}rem），` +
      `而紧凑档上沿是 ${String(compact.rem)}rem（${String(px(compact.rem))}px）—— 两处已经漂了`
    );
  }
  return null;
}

/* ── self-test ──────────────────────────────────────────────────── */

const GOOD_WIDTH = '48rem';
const GOOD_HEIGHT = '30rem';

function fixture(...conditions) {
  return [{ file: 'apps/web/src/styles/app/probe.css', text: conditions.join('\n') }];
}

async function selfTest() {
  const arms = [];
  const push = (name, ok, detail) => arms.push({ name, ok, detail });
  const red = (r, code) => r.problems.some((p) => p.startsWith(code));

  // ① 未登记的值 ⇒ B1 红（今天的 40rem 就是这一型：单看有道理，凑起来 9 种）
  const r1 = judge({ files: fixture(`@media (max-width: 50rem) { .a { color: red; } }`) });
  push('① 未登记值 50rem ⇒ B1 红', red(r1, 'B1'), r1.problems.join(' | '));

  // ② 登记过的不红（"登记过的不红"那一半）
  const r2 = judge({
    files: fixture(
      `@media (max-width: ${GOOD_WIDTH}) { .a { color: red; } }`,
      `@media (min-width: 64rem) { .b { color: red; } }`,
      `@media (min-width: 48.0625rem) and (max-width: 63.9375rem) { .c { color: red; } }`,
      `@media (max-height: ${GOOD_HEIGHT}) { .d { color: red; } }`,
    ),
  });
  push('② 登记值（含两条一像素派生）⇒ 不红', r2.problems.length === 0, r2.problems.join(' | '));

  // ③ 登记值的 px 拼写 ⇒ B2 红。这一型就是立项时的 6 处 `768px`
  const r3 = judge({ files: fixture(`@media (max-width: 768px) { .a { color: red; } }`) });
  push('③ 768px（48rem 的 px 拼写）⇒ B2 红', red(r3, 'B2'), r3.problems.join(' | '));

  // ④ 未登记的 px ⇒ 也红（换单位躲不过尺）
  const r4 = judge({ files: fixture(`@media (max-width: 640px) { .a { color: red; } }`) });
  push('④ 640px（未登记，只是换了单位）⇒ B2 红', red(r4, 'B2'), r4.problems.join(' | '));

  // ⑤ em 拼写 ⇒ B1 红（媒体查询里 em 与 rem 等价，两种拼法只会让 grep 漏一头）
  const r5 = judge({ files: fixture(`@media (max-width: 48em) { .a { color: red; } }`) });
  push('⑤ 48em ⇒ B1 红（只留 rem）', red(r5, 'B1'), r5.problems.join(' | '));

  // ⑥ 两根轴不许串用
  const r6 = judge({ files: fixture(`@media (max-height: 48rem) { .a { color: red; } }`) });
  push('⑥ 用宽度档做高度条件 ⇒ B1 红', red(r6, 'B1'), r6.problems.join(' | '));

  // ⑦ 一像素派生的算术：把 above-compact 调成 48.08 ⇒ B3 红
  const savedAbove = WIDTH_TIERS.find((t) => t.name === 'above-compact').rem;
  WIDTH_TIERS.find((t) => t.name === 'above-compact').rem = 48.08;
  const r7 = judge({ files: [] });
  WIDTH_TIERS.find((t) => t.name === 'above-compact').rem = savedAbove;
  push('⑦ above-compact 写成 48.08（不是 +1px）⇒ B3 红', red(r7, 'B3'), r7.problems.join(' | '));

  // ⑧ 分母下限：真树口径下扫描面塌了必须红
  const r8 = judge({ files: [], floors: { width: WIDTH_FLOOR, height: HEIGHT_FLOOR } });
  push('⑧ 真树口径零落点 ⇒ B4 下限红', red(r8, 'B4'), r8.problems.join(' | '));

  // ⑨ 注释里提到旧值 ⇒ 不误伤（`sheets.css:1052`、`detail-pane-visible.ts:10` 都记着历史）
  const r9 = judge({
    files: [
      {
        file: 'apps/web/src/styles/app/probe.css',
        text: `/* 这里原来是 @media (max-width: 30rem)，见 2026-10-26 */\n@media (max-width: 48rem) { .a { color: red; } }`,
      },
    ],
  });
  push('⑨ 注释里的旧值 ⇒ 不误伤（剥注释臂）', r9.problems.length === 0, r9.problems.join(' | '));

  // ⑩ 非尺寸条件不许被误伤（`(pointer: coarse)` 是已确定方向，不是尺的一部分）
  const r10 = judge({
    files: fixture(`@media (max-width: 48rem), (pointer: coarse) { .a { color: red; } }`),
  });
  push('⑩ (pointer: coarse) 并集 ⇒ 不误伤', r10.problems.length === 0, r10.problems.join(' | '));

  // ⑪ JS 里写死宽字面量（不在 breakpoints.ts）⇒ B5 红
  const r11 = judge({
    files: [
      { file: 'apps/web/src/features/shell/probe.ts', text: `const q = matchMedia('(max-width: 48rem)');` },
      { file: JS_OWNER, text: `export const COMPACT = '(max-width: 48rem)';` },
    ],
  });
  const b5 = r11.problems.filter((p) => p.startsWith('B5'));
  push(
    '⑪ JS 抄一份宽字面量 ⇒ B5 红（breakpoints.ts 里那份不红）',
    b5.length === 1 && b5[0].startsWith(`B5 apps/web/src/features/shell/probe.ts:`),
    r11.problems.join(' | '),
  );

  // ⑫ 动态查询：从 token 读 ⇒ 不红；凭空拼 ⇒ B7 红
  const ok12 = judge({
    files: [
      {
        file: 'apps/web/src/features/quadrant/probe.tsx',
        text: `const min = getComputedStyle(document.documentElement).getPropertyValue('--ht-layout-two-column-min').trim();\nconst q = matchMedia(\`(min-width: \${min})\`);`,
      },
    ],
  });
  const bad12 = judge({
    files: [
      {
        file: 'apps/web/src/features/quadrant/probe2.tsx',
        text: `const q = matchMedia(\`(min-width: \${String(w + 1)}px)\`);`,
      },
    ],
  });
  push(
    '⑫ 动态查询：读 token ⇒ 不红；凭空拼 ⇒ B7 红',
    !red(ok12, 'B7') && red(bad12, 'B7'),
    `${ok12.problems.join(' | ')} ⟂ ${bad12.problems.join(' | ')}`,
  );

  // ⑬ 基线夹具：**迁移前那 9 种值**喂进判决本体 ⇒ 必须红，且至少数到 9 种未登记
  const legacy = fixture(
    `@media (max-width: 30rem) { .a { color: red; } }`,
    `@media (max-width: 36rem) { .b { color: red; } }`,
    `@media (max-width: 40rem) { .c { color: red; } }`,
    `@media (max-width: 48rem) { .d { color: red; } }`,
    `@media (max-width: 64rem) { .e { color: red; } }`,
    `@media (max-width: 768px) { .f { color: red; } }`,
    `@media (min-width: 769px) { .g { color: red; } }`,
    `@media (max-width: 1023px) { .h { color: red; } }`,
    `@media (min-width: 1024px) { .i { color: red; } }`,
  );
  // ⚠️ 9 种里只有 7 种是**值不合法**：`48rem` 与 `64rem` 本来就在尺上（它们只是之前
  // 与 `768px`/`1024px` 两种拼法并存）。所以这一臂的读数是 7，不是 9 —— 别把夹具的
  // 长度当判据，判据是"那 7 种没登记的当场红，而且 768px 这型按拼法红"。
  const r13 = judge({ files: legacy });
  push(
    '⑬ 迁移前那 9 种值 ⇒ 7 种当场红 + 768px 按 px 拼法红',
    red(r13, 'B1') && red(r13, 'B2') && r13.offending.size >= 7 && r13.offending.has('768px'),
    `未登记的种数=${String(r13.offending.size)}（要 ≥7）：${[...r13.offending].join(' ')}`,
  );

  // ⑭ 容器查询：无名 ⇒ B6 红（立项时 habits.css 有 2 处）
  const r14 = judge({
    files: fixture(`@container (min-width: 33rem) { .a { display: grid; } }`),
  });
  push('⑭ 无名 @container ⇒ B6 红', red(r14, 'B6'), r14.problems.join(' | '));

  // ⑮ 容器查询：有名且登记 ⇒ 不红；有名但值没登记 ⇒ B6 红
  const ok15 = judge({
    files: fixture(`@container habit (min-width: 33rem) { .a { display: grid; } }`),
  });
  const bad15 = judge({
    files: fixture(`@container habit (min-width: 50rem) { .a { display: grid; } }`),
  });
  push(
    '⑮ 容器 (habit, 33rem) ⇒ 不红；容器 (habit, 50rem) ⇒ B6 红',
    !red(ok15, 'B6') && red(bad15, 'B6'),
    `${ok15.problems.join(' | ')} ⟂ ${bad15.problems.join(' | ')}`,
  );

  // ⑯ 🔴 两根轴不许互相冒充：视口 33rem 不是"登记值"（它只登记在容器那根轴上）
  const r16 = judge({ files: fixture(`@media (max-width: 33rem) { .a { color: red; } }`) });
  push(
    '⑯ 视口用容器阈值 33rem ⇒ B1 红（两根轴不共享登记）',
    red(r16, 'B1'),
    r16.problems.join(' | '),
  );

  // ⑱ 拼错的旗标必须非 0 退（`--self-tset` 不许被当成空跑）
  let flagErr = '';
  try {
    await run(process.execPath, [SELF, '--self-tset'], { encoding: 'utf8' });
  } catch (err) {
    flagErr = String(err?.stderr ?? err?.message ?? '');
  }
  push('⑱ 拼错的旗标 ⇒ 非 0 退', flagErr !== '', flagErr === '' ? '退出码 0（这把尺可能根本没跑）' : '非 0');

  let bad = 0;
  for (const arm of arms) {
    if (!arm.ok) bad += 1;
    console.log(`${arm.ok ? '  ✓' : '  ✘'} ${arm.name}${arm.ok ? '' : `  实际：${arm.detail}`}`);
  }
  if (bad > 0) {
    console.error(`self-test：${String(bad)} 枚臂不过。`);
    return true;
  }
  console.log(`self-test：${String(arms.length)} 枚臂全过。`);
  return false;
}

/* ── 入口 ───────────────────────────────────────────────────────── */

const argv = process.argv.slice(2);
const known = new Set(['--self-test', '--verbose']);
const unknown = argv.filter((a) => !known.has(a));

if (unknown.length > 0) {
  // 🔴 未知旗标必须收进来并拒绝：本仓每把尺都认 `--self-test`，
  // 吞掉拼错的旗标等于把"没人验过它"伪装成"验过了"（§7 元规则 2）。
  console.error(`未知旗标：${unknown.join(' ')}。用法：--self-test | --verbose`);
  process.exitCode = 1;
} else if (argv.includes('--self-test')) {
  // async 必须 await：不 await 的话臂一条都没跑、一个字没打印、退出码 0。
  process.exitCode = (await selfTest()) ? 1 : 0;
} else {
  const files = treeFiles();
  const { problems, widthSites, heightSites, dynamicSites } = judge({ files });
  const drift = tokenDrift();
  if (drift !== null) problems.push(drift);

  if (argv.includes('--verbose')) {
    for (const t of WIDTH_TIERS) {
      console.log(`   宽度 ${t.name.padEnd(13)} ${String(t.rem).padStart(9)}rem = ${String(px(t.rem))}px  ${t.why}`);
    }
    for (const t of HEIGHT_TIERS) {
      console.log(`   高度 ${t.name.padEnd(13)} ${String(t.rem).padStart(9)}rem = ${String(px(t.rem))}px  ${t.why}`);
    }
    console.log(`   现量：${String(files.length)} 个文件 · 宽度 ${String(widthSites)} 处 · 高度 ${String(heightSites)} 处 · 动态 ${String(dynamicSites)} 处`);
  }

  if (problems.length > 0) {
    for (const p of problems) console.log(`✘ ${p}`);
    console.error(`断点门禁：${String(problems.length)} 条不过。`);
    process.exitCode = 1;
  } else {
    console.log(
      `✅ 断点：宽度只用了 ${String(WIDTH_TIERS.length)} 个登记值（${String(px(48))}/${String(px(48 + ONE_PX_REM))}/${String(px(64 - ONE_PX_REM))}/${String(px(64))}px），` +
        `高度 ${String(HEIGHT_TIERS.length)} 个；共 ${String(widthSites)} 处宽度落点、${String(heightSites)} 处高度落点、${String(dynamicSites)} 处动态查询。`,
    );
  }
}
