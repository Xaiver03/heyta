#!/usr/bin/env node
/**
 * `scripts/gen-boot-splash.mjs` —— 首屏（启动）动画的**跨端配置生成器**
 * ====================================================================
 *
 * ## 它产出什么
 *
 * | 产物 | 作用 |
 * |---|---|
 * | `apps/web/index.html` 里两段带标记的区域 | JS bundle **还没到货**时就能画出来的品牌帧（样式 + 骨架） |
 * | `apps/mobile/android/.../values/heyta_splash.xml` | Android 系统启动屏的底色与时长（值来自 token） |
 * | `apps/mobile/android/.../values-v31/styles.xml` | Android 12+ 的 `windowSplashScreen*` 主题项 |
 *
 * ## 为什么样式必须**内联在 HTML 里**，而不是一个 `.css` 文件
 *
 * 这条不是审美，是被两件事夹出来的：
 *
 * 1. `tokens.css` 是**打进 JS bundle** 的（`main.tsx` 的第一条 import）。
 *    所以在 bundle 下载并执行之前，界面上一个 `var(--ht-*)` 都解析不了 ——
 *    那时候挂一份外链 CSS 用 `var()`，画出来的就是一片**什么都没有**，
 *    而"什么都没有"正是首屏动画要挡掉的那个观感。
 *    ⇒ 这一段样式**自带字面值**，由本脚本从 token 抄进来（同一个套路已经用在线上：
 *    `server/src/design.generated.ts` 也是把 token 搬到运行时读不到 i18n/design-system 的地方）。
 * 2. 外链要能**按挂载路径**解析。本仓库把应用挂在 `/app/` 下，而 PWA 那批
 *    根绝对路径的产物（`/icons/…`、`/sw.js`）**已经因此在线上拿到过落地页的 HTML**
 *    （AGENTS §9 已登记的未修项）。再开一个根绝对路径的外链就是往同一个坑里跳第二次。
 *    ⇒ 内联 = 零请求、零路径。
 *
 * ## 为什么"只有品牌、没有文案"
 *
 * 调研结论（来源与取舍见 `docs/plans/brand-icon-and-splash.md` §3）：
 * 启动屏分两类，**加载型**遮的是真实延迟，**营销型**卖的是内容 —— 后者在
 * Android 官方指南里被明确劝退（`windowSplashScreenBrandingImage` 存在但"不推荐"），
 * Apple 也把启动屏定位为"与首屏几乎一致"的静态帧。heyta 是本地优先应用，
 * 冷启动要开 IndexedDB/SQLite、解 op-log、可能还要解锁保险库，**那些是真延迟**，
 * 所以这里做加载型：只有 mark，没有口号，也就**没有需要翻译的文案**
 * （因此本文件不产任何 i18n 词条 —— 有一条就得中英成对，那条归界面自己管）。
 *
 * ## 时长不是拍的
 *
 * 四档时长全部来自 `tokens.css` 的 `duration.splash-*`，而那一组自己的注释写明了
 * 推导：`enter 420 + stagger 90×2 + hold 200 = 800ms` 落在 Android 建议的
 * "整段 ≤ 1000ms"之内；超过一个循环时不延长时长而是**循环**（下面 mark 的
 * 呼吸动画就是干这个的）。这里只是把同一批数搬到读不到 token 的两个运行时。
 *
 * ## 用法
 *
 * ```sh
 * node scripts/gen-boot-splash.mjs            # 生成/写盘
 * node scripts/gen-boot-splash.mjs --check    # 只读对账（逐字节）
 * ```
 *
 * ⚠️ 改动 `duration.splash-*` / `z.splash` / `layout.splash-mark` / 三个颜色 token 之后
 *    必须重跑本脚本，否则 `--check` 红 —— 这条判据存在的意义就是"两处真源不许漂"。
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const CHECK = process.argv.includes('--check');
const require = createRequire(join(ROOT, 'apps/web/package.json'));

/** 与 `gen-app-icons.mjs` 同一个入口：几何与 token 都只有一份真源。 */
const {
  BRAND_MARK_CANVAS,
  BRAND_MARK_RADIUS,
  brandMarkRects,
  BRAND_MARK_SAFE,
  extractVars,
  extractReducedMotion,
  resolveAllVars,
} = require('@heyta/design-system');

/**
 * 🔴 读的是 **tokens.css 的字面 CSS 值**，不是 `tokensForTheme()` 那张 RN 表。
 *
 * 理由：RN 表把数值型 token 归一成了 `number`（`420ms → 420`、`6rem → 96`），
 * 那是给 RN 用的正确形状，但把它写回 CSS 就变成 `--heyta-boot-size: 96;` ——
 * 一个没有单位的长度，浏览器整条丢弃，现象是**首屏那块 mark 尺寸随机**。
 * 这里要的是"CSS 里写的那个值原样搬过来"，所以用同一份 CSS 解析器
 * （就是生成 Swift/ArkTS 产物那份），而不是自己再写一遍正则。
 */
const tokensCss = readFileSync(join(ROOT, 'packages/design-system/src/tokens.css'), 'utf8');
const vars = extractVars(tokensCss);
const reduced = extractReducedMotion(tokensCss);

/** token 名 → CSS 自定义属性名：点号换成连字符（`color.primary` → `--ht-color-primary`）。 */
function cssVarOf(name) {
  return `--ht-${name.replaceAll('.', '-')}`;
}

/** 取一个 token 的 CSS 字面值（var() 引用会被递归展开成具体值）。 */
function tok(name) {
  const raw = vars.get(cssVarOf(name));
  if (raw === undefined) {
    throw new Error(`design-system token 缺 --ht-${name}（首屏动画的每个数都必须来自 token）`);
  }
  return resolveAllVars(raw, vars);
}

/** 同上，但优先用 `prefers-reduced-motion` 块里的覆盖值。 */
function tokReduced(name) {
  const raw = reduced.get(cssVarOf(name));
  return raw === undefined ? tok(name) : resolveAllVars(raw, vars);
}

const PRIMARY = tok('color.primary');
const ON_PRIMARY = tok('color.on-primary');
const BACKGROUND = tok('color.background');
const MARK_SIZE = tok('layout.splash-mark');
const ENTER = tok('duration.splash-enter');
const STAGGER = tok('duration.splash-stagger');
const HOLD = tok('duration.splash-hold');
const EXIT = tok('duration.splash-exit');
const ENTER_REDUCED = tokReduced('duration.splash-enter');
const STAGGER_REDUCED = tokReduced('duration.splash-stagger');
const HOLD_REDUCED = tokReduced('duration.splash-hold');
const EXIT_REDUCED = tokReduced('duration.splash-exit');
const Z = tok('z.splash');
const EASE_ENTER = tok('ease.enter');
const EASE_EXIT = tok('ease.exit');

/** `90ms` → `90`（Android 的主题项要的是毫秒整数，不是 CSS 时长）。 */
function ms(value) {
  const n = Number.parseInt(String(value), 10);
  if (!Number.isFinite(n)) throw new Error(`无法从 "${value}" 取出毫秒数`);
  return n;
}

const MARKUP_BEGIN = '<!-- HEYTA-BOOT-SPLASH:BEGIN 生成物（scripts/gen-boot-splash.mjs）—— 不要手改 -->';
const MARKUP_END = '<!-- HEYTA-BOOT-SPLASH:END -->';

/** 对账与写盘两套出口共用的状态（必须在使用之前声明）。 */
const drift = [];
const readings = [];
const written = [];
const unchanged = [];

/* ──────────────────────────────────────────────────────────────────────
 * 1. Web：内联样式 + 骨架
 * ──────────────────────────────────────────────────────────────────── */

/**
 * 三块字形。`data-boot-bar` 只是给人读的标记，动画挂在选择器上 ——
 * 几何来自 brandMarkRects，与图标**同一份**（这里不重画一遍坐标）。
 */
const bars = brandMarkRects(BRAND_MARK_SAFE);
const barMarkup = bars
  .map(
    (b, i) =>
      `      <rect class="heyta-boot__bar heyta-boot__bar--${i}" x="${b.x}" y="${b.y}" width="${b.width}" height="${b.height}" rx="${b.rx}"/>`,
  )
  .join('\n');

const styleBlock = `${MARKUP_BEGIN}
<style id="heyta-boot-style">
  /*
   * 这一段是**生成物**：每个字面值都是 packages/design-system/src/tokens.css 里
   * 那条 token 的当前值（真源只有一份，改动 token 后重跑本脚本，
   * 对账模式会逐字节抓到没重跑的那次）。
   *
   * 为什么不能直接写 var(--ht-*)：tokens.css 打进 JS bundle，而这一帧要在
   * bundle **到货之前**画出来 —— 那时所有 var() 都还没定义，画出来是空的，
   * 而"空"正是首屏动画要挡掉的那个观感。
   *
   * 命名前缀用 heyta-boot 而不是 ht-boot：这一段不与 tokens.css 的命名空间抢名字。
   */
  :root {
    /* token: color.primary / color.on-primary / color.background */
    --heyta-boot-plate: ${PRIMARY};
    --heyta-boot-glyph: ${ON_PRIMARY};
    --heyta-boot-bg: ${BACKGROUND};
    /* token: layout.splash-mark */
    --heyta-boot-size: ${MARK_SIZE};
    /* token: duration.splash-enter / -stagger / -hold / -exit */
    --heyta-boot-enter: ${ENTER};
    --heyta-boot-stagger: ${STAGGER};
    --heyta-boot-hold: ${HOLD};
    --heyta-boot-exit: ${EXIT};
    /* token: ease.enter / ease.exit */
    --heyta-boot-ease-enter: ${EASE_ENTER};
    --heyta-boot-ease-exit: ${EASE_EXIT};
    /* token: z.splash —— 必须压得住首启的隐私同意面板，所以是阶梯最上一档 */
    --heyta-boot-z: ${Z};
    /* 一个入场循环的总时长 = enter + 2×stagger + hold（由上面四档推导，不是第五个数字） */
    --heyta-boot-cycle: calc(var(--heyta-boot-enter) + var(--heyta-boot-stagger) * 2 + var(--heyta-boot-hold));
  }

  .heyta-boot {
    position: fixed;
    inset: 0;
    z-index: var(--heyta-boot-z);
    display: grid;
    place-items: center;
    background: var(--heyta-boot-bg);
    /* 退场之后由 JS 摘掉节点；这里只负责不被点击穿透误触 */
    pointer-events: none;
  }

  .heyta-boot__mark {
    width: var(--heyta-boot-size);
    height: var(--heyta-boot-size);
    display: block;
    overflow: visible;
  }

  .heyta-boot__plate {
    fill: var(--heyta-boot-plate);
  }

  .heyta-boot__bar {
    fill: var(--heyta-boot-glyph);
    /* 每块各自的包围盒做缩放原点，否则三道会从画布中心"飞"而不是各自升起 */
    transform-box: fill-box;
    transform-origin: 50% 100%;
    animation: heyta-boot-rise var(--heyta-boot-enter) var(--heyta-boot-ease-enter) both;
  }

  /* 三道依次入场：第二道晚一个 stagger，第三道晚两个。
     顺序就是字的书写顺序（左竖 → 右竖 → 横），读起来像"heyta 正在被写出来"。 */
  .heyta-boot__bar--1 { animation-delay: var(--heyta-boot-stagger); }
  .heyta-boot__bar--2 { animation-delay: calc(var(--heyta-boot-stagger) * 2); }

  /* 底板先落到位（它不是"被写的笔"），随后整个 mark 轻微呼吸 ——
     启动时间超过一个循环时，这一档循环是**给等待一个交代**，
     而不是把入场时长拍长（Android 那条"超过 1000ms 改用循环"的做法）。 */
  .heyta-boot__mark { animation: heyta-boot-breathe var(--heyta-boot-cycle) var(--heyta-boot-ease-enter) infinite alternate; }

  @keyframes heyta-boot-rise {
    /* 🔴 from 那一帧**必须已经读得出是 mark** —— 这是首屏动画存在的全部理由。
       第一版这里写的是 \`opacity: 0; transform: scaleY(0.2)\`，真浏览器 t=0 截图
       上三道字形**全透明**，画面只剩一块空蓝底板：产品负责人投诉的"完全没有 logo"
       在我们自己生成的第一帧上原样复现了（而 22 条 CSS 断言全绿，因为断的是
       "元素在不在、色对不对"，不是"这一帧看不看得见"）。
       现在不透明度全程 1，只用纵向压缩表达"正在被写出来"，
       最短那一档也留 62% 高度 —— 入场仍然有，第一帧不再空白。 */
    from { transform: scaleY(0.62); }
    to { transform: scaleY(1); }
  }

  @keyframes heyta-boot-breathe {
    from { transform: scale(1); }
    to { transform: scale(1.03); }
  }

  /* 退场：淡出 + 略微上收。走 ease.exit（比进入快），与界面里其他浮层同一条纪律。 */
  .heyta-boot--leaving {
    animation: heyta-boot-leave var(--heyta-boot-exit) var(--heyta-boot-ease-exit) forwards;
  }

  @keyframes heyta-boot-leave {
    from { opacity: 1; transform: scale(1); }
    to { opacity: 0; transform: scale(1.06); }
  }

  /*
   * 尊重系统"减少动效"：时长压到 1ms 是 tokens.css 里那条媒体查询在做的事，
   * 但这一段自带字面值、拿不到那次覆盖 ⇒ 必须**在这里**也处理一遍，
   * 否则"应用内遵守、启动那一帧不遵守"—— 而那恰恰是最容易让人头晕的一帧。
   *
   * 做法：入场与呼吸**全关**，直接停在画满的那一帧（静态品牌帧），
   * 只保留退场的淡出（透明度变化不属于"非必要位移"）。
   */
  @media (prefers-reduced-motion: reduce) {
    .heyta-boot__bar,
    .heyta-boot__mark {
      animation: none;
      opacity: 1;
      transform: none;
    }
    :root {
      --heyta-boot-enter: ${ENTER_REDUCED};
      --heyta-boot-stagger: ${STAGGER_REDUCED};
      --heyta-boot-hold: ${HOLD_REDUCED};
      --heyta-boot-exit: ${EXIT_REDUCED};
    }
  }
</style>
<div class="heyta-boot" id="heyta-boot" role="img" aria-label="heyta">
  <svg class="heyta-boot__mark" viewBox="0 0 ${BRAND_MARK_CANVAS} ${BRAND_MARK_CANVAS}" aria-hidden="true" focusable="false">
    <rect class="heyta-boot__plate" x="0" y="0" width="${BRAND_MARK_CANVAS}" height="${BRAND_MARK_CANVAS}" rx="${BRAND_MARK_RADIUS}"/>
${barMarkup}
  </svg>
</div>
${MARKUP_END}`;

const WEB_INDEX = join(ROOT, 'apps/web/index.html');
const ANDROID_RES = join(ROOT, 'apps/mobile/android/app/src/main/res');

/** 把生成好的区域塞进宿主文件（宿主里必须已有那对标记，否则响亮失败）。 */
function patch(host, beginNeedle, endNeedle, block, label) {
  const text = readFileSync(host, 'utf8');
  const b = text.indexOf(beginNeedle);
  const e = text.indexOf(endNeedle);
  if (b === -1 || e === -1 || e < b) {
    const msg = `${label}：宿主文件里找不到那对标记 —— 首屏动画不会出现在任何地方`;
    if (CHECK) {
      drift.push(msg);
      return;
    }
    console.error(`🔴 ${msg}`);
    console.error(`   需要 ${beginNeedle.slice(0, 40)}… 与 ${endNeedle}`);
    process.exit(1);
  }
  const current = text.slice(b, e + endNeedle.length);
  if (CHECK) {
    if (current !== block) drift.push(`${label}：磁盘内容与生成结果**逐字节不同**（改过 token 或改过宿主？）`);
    else readings.push(`✅ ${label}`);
    return;
  }
  if (current !== block) {
    writeFileSync(host, text.slice(0, b) + block + text.slice(e + endNeedle.length), 'utf8');
    written.push(label);
  } else {
    unchanged.push(label);
  }
}

patch(WEB_INDEX, MARKUP_BEGIN, MARKUP_END, styleBlock, 'apps/web/index.html 的首屏区域');

/* ──────────────────────────────────────────────────────────────────────
 * 2. Android：系统启动屏（冷启动时 OS 画的那一帧）
 *
 *    Android 12+ 的启动屏由**系统**画，应用插不进去，只能靠主题项配置：
 *      windowSplashScreenBackground      —— 底色（必须实色，不许透明）
 *      windowSplashScreenAnimatedIcon    —— 居中图标；这里直接复用自适应图标的
 *                                            前景层（它本来就是按 66dp 保留圆做的，
 *                                            与启动屏的遮罩规则同一条）
 *      windowSplashScreenAnimationDuration —— 系统愿意为这段动画等多久
 *
 *    🔴 `windowSplashScreenBrandingImage` 刻意**不设**：官方设计指南明确劝退
 *       在启动屏放品牌/营销图（调研记录见计划文档 §3）。
 *
 *    时长换算：token 那四档是 CSS 时长；这里要的是毫秒整数，且
 *    "整段 ≤ 1000ms" 那条建议直接由同一个数导出 —— 不另拍一个。
 * ──────────────────────────────────────────────────────────────────── */

const cycleMs = ms(ENTER) + ms(STAGGER) * 2 + ms(HOLD);

emitText(
  join(ANDROID_RES, 'values', 'heyta_splash.xml'),
  `<?xml version="1.0" encoding="utf-8"?>
<!--
  生成物（scripts/gen-boot-splash.mjs）—— 不要手改。
  两个色值都是 design-system token（color.background / color.primary），
  cycle_ms 由 duration.splash-enter + 2 x stagger + hold 推导，不是第五个数字。
-->
<resources>
    <color name="heyta_splash_background">${BACKGROUND}</color>
    <color name="heyta_splash_plate">${PRIMARY}</color>
    <item name="heyta_splash_cycle_ms" format="integer" type="integer">${cycleMs}</item>
</resources>
`,
  'android values/heyta_splash.xml',
);

emitText(
  join(ANDROID_RES, 'values-v31', 'styles.xml'),
  `<?xml version="1.0" encoding="utf-8"?>
<!--
  生成物（scripts/gen-boot-splash.mjs）—— 不要手改。

  Android 12+ 冷启动那一帧由**系统**画，应用代码插不进去，只能配置主题项。
  父样式是 values/styles.xml 里的 AppTheme.Base —— 主题只在那一份里定义，
  这里**只加**启动屏那三项，避免同一个 AppTheme 存在两份逐字拷贝（那种
  形状在本仓库已经吃过两次：抽出来之后旧的那份没删，于是两套裁决标准）。

  windowSplashScreenAnimatedIcon 复用自适应图标的前景层（mipmap/ic_launcher_foreground）：
  它本来就是按"中心 66dp 保留圆"做的，与启动屏的遮罩规则同一条，
  所以图标与启动动画在用户眼里是同一个东西在不同时刻的样子。
-->
<resources>
    <style name="AppTheme" parent="AppTheme.Base">
        <item name="android:windowSplashScreenBackground">@color/heyta_splash_background</item>
        <item name="android:windowSplashScreenAnimatedIcon">@mipmap/ic_launcher_foreground</item>
        <item name="android:windowSplashScreenAnimationDuration">${cycleMs}</item>
    </style>
</resources>
`,
  'android values-v31/styles.xml',
);

/**
 * ────────────────────────────────────────────────────────────────────
 * iOS：启动帧 = **静态图**，动效只能放在它之后那一层
 * ────────────────────────────────────────────────────────────────────
 *
 * 平台事实（调研记录见 `docs/plans/brand-icon-and-splash.md` §3）：
 * iOS 的 launch storyboard 由系统在进程起来**之前**渲染并截图缓存，
 * 应用代码那时还没有开始跑 ⇒ 这一段**做不出动画**。所以 iOS 端交付的是
 * 「与产品同一枚 mark、同一底色」的静态帧，入场/退场那一支动画住在
 * RN 侧的**首屏之后**那一层（与 Android 12+ 系统帧 + RN 内容层的分工同构）。
 *
 * 三件事在这一份产物里同时被钉住：
 *   1. 底色与 mark 的尺寸都来自 token（不许手抄 `#f8fafc` / `96`）；
 *   2. **零文案** —— 旧那一份写的是 RN 脚手架留下的 `Powered by React Native`
 *      加一个 `boldSystem` 36pt 的 "heyta"：英文、系统字体、系统色，
 *      而且 storyboard 在 bundle 之前渲染 ⇒ 它**永远不可能**被 i18n 翻译。
 *      所以这里的做法是"没有文字"，而不是"文字翻成两种"。
 *   3. 底色走 **color asset**（`HeytaSplashBackground.colorset`，亮/暗两档）
 *      而不是内联字面色 —— 系统在渲染启动帧时按当前外观挑档，
 *      于是暗色模式下不会先闪一张亮色板。两档的值都来自 tokens.css：
 *      亮档直接解析，暗档读 `generated/tokens.json`（它是 check:tokens
 *      盯着的产物，漂了会红，所以这里读它是安全的）。
 */
const IOS_DIR = join(ROOT, 'apps/mobile/ios/Heyta');
const COLOR_ASSET = 'HeytaSplashBackground';

/** `6rem` → `96`（iOS 的 point 与 CSS px 在启动帧这一层按 1:1 对待）。 */
function remToPt(value) {
  const rem = Number.parseFloat(String(value));
  if (!Number.isFinite(rem)) throw new Error(`无法从 "${value}" 取出 rem 数`);
  return Math.round(rem * 16);
}

/** tokens.json 里的暗色是**稀疏覆盖**：没写这一项时退回亮档值（同源，不另拍）。 */
function darkBackground() {
  try {
    const parsed = JSON.parse(
      readFileSync(join(ROOT, 'packages/design-system/generated/tokens.json'), 'utf8'),
    );
    const dark = parsed?.dark?.['color.background'];
    return typeof dark === 'string' ? dark : BACKGROUND;
  } catch {
    throw new Error(
      '读不到 packages/design-system/generated/tokens.json —— 先跑 pnpm --filter @heyta/design-system build',
    );
  }
}

const MARK_PT = remToPt(MARK_SIZE);
const DARK_BG = darkBackground();

emitText(
  join(IOS_DIR, 'Images.xcassets', `${COLOR_ASSET}.colorset`, 'Contents.json'),
  `{
  "colors" : [
    {
      "color" : {
        "color-space" : "srgb",
        "components" : { "alpha" : "1.000", "blue" : "${channel(BACKGROUND, 2, 255)}", "green" : "${channel(BACKGROUND, 1, 255)}", "red" : "${channel(BACKGROUND, 0, 255)}" }
      },
      "idiom" : "universal"
    },
    {
      "appearances" : [ { "appearance" : "luminosity", "value" : "dark" } ],
      "color" : {
        "color-space" : "srgb",
        "components" : { "alpha" : "1.000", "blue" : "${channel(DARK_BG, 2, 255)}", "green" : "${channel(DARK_BG, 1, 255)}", "red" : "${channel(DARK_BG, 0, 255)}" }
      },
      "idiom" : "universal"
    }
  ],
  "info" : { "author" : "gen-boot-splash", "version" : 1 }
}
`,
  'ios HeytaSplashBackground.colorset',
);

emitText(
  join(IOS_DIR, 'LaunchScreen.storyboard'),
  `<?xml version="1.0" encoding="UTF-8"?>
<!--
  生成物（scripts/gen-boot-splash.mjs）—— 不要手改。
  底色 = token color.background（亮/暗两档走 color asset ${COLOR_ASSET}）；
  mark 边长 = token layout.splash-mark（${MARK_SIZE} → ${MARK_PT}pt）。
  刻意**没有任何文字**：这一帧在 JS bundle 之前由系统渲染，i18n 够不着它，
  所以写任何语言的文案都等于硬编码。调研与判据见
  docs/plans/brand-icon-and-splash.md §3、§5。
-->
<document type="com.apple.InterfaceBuilder3.CocoaTouch.Storyboard.XIB" version="3.0" toolsVersion="15702" targetRuntime="iOS.CocoaTouch" propertyAccessControl="none" useAutolayout="YES" launchScreen="YES" useTraitCollections="YES" useSafeAreas="YES" colorMatched="YES" initialViewController="01J-lp-oVM">
    <device id="retina4_7" orientation="portrait" appearance="light"/>
    <dependencies>
        <deployment identifier="iOS"/>
        <plugIn identifier="com.apple.InterfaceBuilder.IBCocoaTouchPlugin" version="15704"/>
        <capability name="Safe area layout guides" minToolsVersion="9.0"/>
        <capability name="documents saved in the Xcode 8 format" minToolsVersion="8.0"/>
    </dependencies>
    <scenes>
        <!--View Controller-->
        <scene sceneID="EHf-IW-A2E">
            <objects>
                <viewController id="01J-lp-oVM" sceneMemberID="viewController">
                    <view key="view" contentMode="scaleToFill" id="Ze5-6b-2t3">
                        <rect key="frame" x="0.0" y="0.0" width="375" height="667"/>
                        <autoresizingMask key="autoresizingMask" widthSizable="YES" heightSizable="YES"/>
                        <subviews>
                            <imageView clipsSubviews="YES" userInteractionEnabled="NO" contentMode="scaleAspectFit" horizontalHuggingPriority="251" verticalHuggingPriority="251" image="HeytaLaunchMark" id="htB-ot-001">
                                <rect key="frame" x="139.5" y="285.5" width="${MARK_PT}" height="${MARK_PT}"/>
                                <accessibility key="accessibilityConfiguration">
                                    <accessibilityTraits key="traits" image="YES" notEnabled="YES"/>
                                    <bool key="isElement" value="NO"/>
                                </accessibility>
                                <constraints>
                                    <constraint firstAttribute="width" constant="${MARK_PT}" id="htB-w-001"/>
                                    <constraint firstAttribute="height" constant="${MARK_PT}" id="htB-h-001"/>
                                </constraints>
                            </imageView>
                        </subviews>
                        <!--
                          这一行的 color 元素不许带 id 属性（实测：带 id 时 ibtool 以
                          rc=255 退出且零输出，于是 xcodebuild 只报一句
                          "CompileStoryboard ... failed with a nonzero exit code"，
                          没有任何指向这一行的线索。同一份 XML 去掉 id 立刻编得过：
                          A/B 现量 带 id=255 / 去掉=0，加不加 catalog="Images" 都一样。
                          别的元素（imageView / constraint）带 id 是合法的 —— 崩的只有 color。
                        -->
                        <color key="backgroundColor" name="${COLOR_ASSET}"/>
                        <constraints>
                            <constraint firstItem="htB-ot-001" firstAttribute="centerX" secondItem="Bcu-3y-fUS" secondAttribute="centerX" id="htB-cx-01"/>
                            <constraint firstItem="htB-ot-001" firstAttribute="centerY" secondItem="Bcu-3y-fUS" secondAttribute="centerY" id="htB-cy-01"/>
                        </constraints>
                        <viewLayoutGuide key="safeArea" id="Bcu-3y-fUS"/>
                    </view>
                </viewController>
                <placeholder placeholderIdentifier="IBFirstResponder" id="iYj-Kq-Ea1" userLabel="First Responder" sceneMemberID="firstResponder"/>
            </objects>
            <point key="canvasLocation" x="52.173913043478265" y="375"/>
        </scene>
    </scenes>
    <resources>
        <image name="HeytaLaunchMark" width="341.5" height="341.5"/>
    </resources>
</document>
`,
  'ios LaunchScreen.storyboard',
);

/** `#rrggbb` → 0..1 之间的第 i 个分量，保留 Xcode 那套三位小数写法。 */
function channel(hex, index, scale) {
  const clean = String(hex).replace('#', '');
  if (!/^([0-9a-f]{6})$/i.test(clean)) {
    throw new Error(`token 色值 "${hex}" 不是 #rrggbb —— colorset 无法逐分量写入`);
  }
  const n = parseInt(clean.slice(index * 2, index * 2 + 2), 16) / scale;
  return n.toFixed(3);
}

/** 文本产物的出口（与 patch 同一套判据：存在 + 逐字节）。 */
function emitText(path, content, label) {
  if (CHECK) {
    let onDisk = null;
    try {
      onDisk = readFileSync(path, 'utf8');
    } catch {
      /* 不存在也算漂移 */
    }
    if (onDisk === null) drift.push(`${label}：文件不存在（需要跑 gen-boot-splash）`);
    else if (onDisk !== content) drift.push(`${label}：磁盘内容与生成结果**逐字节不同**`);
    else readings.push(`✅ ${label}`);
    return;
  }
  if (!existsSync(path) || readFileSync(path, 'utf8') !== content) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content, 'utf8');
    written.push(label);
  } else {
    unchanged.push(label);
  }
}

/* ──────────────────────────────────────────────────────────────────────
 * 出口
 * ──────────────────────────────────────────────────────────────────── */

if (CHECK) {
  if (drift.length > 0) {
    console.error(`🔴 首屏动画配置漂移（${drift.length} 条）：`);
    for (const d of drift) console.error(`   - ${d}`);
    console.error('   闭合命令：node scripts/gen-boot-splash.mjs');
    process.exit(1);
  }
  console.log(
    `  ✅ 首屏动画配置对账通过（${readings.length} 份：逐字节；循环时长 ${cycleMs}ms 来自 token 四档之和）`,
  );
  process.exit(0);
}

console.log(
  `  ✅ gen-boot-splash：写盘 ${written.length} 份（${written.join('、') || '无'}）· 未变 ${unchanged.length} 份 · 循环 ${cycleMs}ms`,
);
