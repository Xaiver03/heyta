/**
 * 生成 `apps/web` 的 PWA 资产（W3-1）。
 * ==========================================
 *
 * ```sh
 * pnpm --filter @heyta/web gen:pwa           # 生成
 * pnpm --filter @heyta/web check:pwa         # 只对账，不写盘（`pnpm check` 的一环）
 * ```
 *
 * 产出四类东西，**全部是生成物**：
 *
 * | 产物 | 为什么是生成的 |
 * |---|---|
 * | `public/manifest.webmanifest` | `widgets[].tag` 必须与 `sw-core.ts` 的 `widgetTag()` 一致；手写必然漂移，而漂移的表现是**组件永远不刷新**（`updateByTag` 对不存在的 tag 静默失败） |
 * | `public/icons/*` | 颜色取自 `@heyta/design-system` 的 token，不是这里写死的十六进制 |
 * | `public/widgets/*.data.json` | 组件的**初始**数据，必须是"打开 Heyta 以显示小组件"那种诚实状态，不能是空白 |
 * | `public/sw.js` | service worker 要 import `@heyta/widget-core`（共享契约），只能打包 |
 *
 * 🔴 **对账靠 `--check`，不靠"记得重新生成"。** `check:pwa` 用同一份代码算出
 *    文本产物再与磁盘**逐字节比**，不一致就非零退出 —— 手改产物在这条门禁上**必然红**。
 *    PNG 与 `sw.js` 不在对账范围内（前者要 `rsvg-convert`、后者是打包结果，
 *    都不该在"只检查"时被动过）。
 *    另一层判据在 `tests/pwa.spec.ts`：它钉的是**这些产物里的每一句中文都必须来自词条表**。
 *    一个管"是不是生成的"，一个管"生成时用的是不是唯一事实源"，两条都必要、都不充分。
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ADAPTIVE_CARD_KINDS, buildAdaptiveCardPlaceholder } from '@heyta/widget-core';
import { DEFAULT_LOCALE, translate } from '@heyta/i18n';
import { tokensForTheme } from '@heyta/design-system';
import { build as esbuild } from 'esbuild';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = join(HERE, '..');
const PUBLIC = join(APP, 'public');
const ICONS = join(PUBLIC, 'icons');
const WIDGETS = join(PUBLIC, 'widgets');

/**
 * `--check`：只算不写，把磁盘与生成结果**逐字节对账**。
 *
 * 🔴 判据必须能红：手改 `public/` 里的产物在别的门禁上**看不出来** ——
 * `check:ui-language` 只扫 `src/`，而 `pwa.spec.ts` 那两条管的是"文案来自词条表"。
 * 也就是说"有人直接编辑了生成物"这件事只有这里能发现。
 */
const CHECK = process.argv.includes('--check');
const drift = [];
const compared = [];

/** 写盘（或在对账模式下比对）。所有生成物只走这一个出口。 */
function emit(path, content, label) {
  if (!CHECK) {
    writeFileSync(path, content, 'utf8');
    return;
  }
  compared.push(label);
  let committed = null;
  try {
    committed = readFileSync(path, 'utf8');
  } catch {
    /* 文件还不存在 —— 也算不一致 */
  }
  if (committed === null) drift.push(`${label}：文件不存在（需要跑 gen:pwa）`);
  else if (committed !== content) drift.push(`${label}：磁盘内容与生成结果**逐字节不同**`);
}

const light = tokensForTheme('light');
const dark = tokensForTheme('dark');

const PRIMARY = light['color.primary'];
const ON_PRIMARY = light['color.on-primary'];
const BACKGROUND = light['color.background'];

if (!PRIMARY || !ON_PRIMARY || !BACKGROUND) {
  throw new Error('design-system token 缺 color.primary / color.on-primary / color.background');
}

if (!CHECK) {
  mkdirSync(ICONS, { recursive: true });
  mkdirSync(WIDGETS, { recursive: true });
}

/**
 * 构建期的翻译口。**只有默认语言** —— 理由见下面第 2、3 节各自那段红字。
 * 这里不写任何中文：文案的唯一事实源是 `packages/i18n`。
 */
const t = (key, vars) => translate(DEFAULT_LOCALE, key, vars);

// ─────────────────────────────────────────────────────────────────────
// 1. 图标
//
// 🔴 **不用文字画图标**：`rsvg-convert` 在没装对应字体的机器上会把文字
//    **静默丢掉**（产出没有字形的图，而不是报错）。所以字形是 path。
// ─────────────────────────────────────────────────────────────────────

/** 「h」—— 两条竖 + 一横。坐标基于 512×512 画布。 */
function hGlyph(scale, offset) {
  const rect = (x, y, w, h) =>
    `<rect x="${offset + x * scale}" y="${offset + y * scale}" width="${w * scale}" height="${h * scale}" rx="${22 * scale}" fill="${ON_PRIMARY}"/>`;
  return [
    rect(140, 120, 52, 272), // 左竖（带升部）
    rect(320, 228, 52, 164), // 右竖
    rect(140, 228, 232, 48), // 横
  ].join('\n    ');
}

function iconSvg({ size, radius, scale, offset }) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" rx="${radius}" fill="${PRIMARY}"/>
  <g>
    ${hGlyph(scale, offset)}
  </g>
</svg>
`;
}

// 普通图标：圆角方块铺满
const plain = iconSvg({ size: 512, radius: 112, scale: 1, offset: 0 });
// maskable：**内容必须落在中心 80% 的安全区**，否则被圆形/方形遮罩切掉字形
const maskable = iconSvg({ size: 512, radius: 0, scale: 0.72, offset: 72 });

emit(join(ICONS, 'icon.svg'), plain, 'icons/icon.svg');
emit(join(ICONS, 'icon-maskable.svg'), maskable, 'icons/icon-maskable.svg');

/** 用 rsvg-convert 渲染 PNG。SVG 是**真源**，PNG 是派生物。 */
function renderPng(svgPath, outPath, size) {
  execFileSync('rsvg-convert', ['-w', String(size), '-h', String(size), '-o', outPath, svgPath], {
    stdio: 'pipe',
  });
}

// 🔴 对账模式**不渲染 PNG**：PNG 是 SVG 的派生物，不在逐字节的判据范围里，
//    而且 `rsvg-convert` 是外部二进制 —— 一条只读门禁不该依赖它、更不该改动产物。
if (!CHECK) {
  renderPng(join(ICONS, 'icon.svg'), join(ICONS, 'icon-192.png'), 192);
  renderPng(join(ICONS, 'icon.svg'), join(ICONS, 'icon-512.png'), 512);
  renderPng(join(ICONS, 'icon-maskable.svg'), join(ICONS, 'icon-maskable-512.png'), 512);
  renderPng(join(ICONS, 'icon.svg'), join(ICONS, 'apple-touch-icon.png'), 180);
  console.log('  ✅ icons/icon.svg + 4 个 PNG（192 / 512 / maskable-512 / apple-touch-180）');
}

// ─────────────────────────────────────────────────────────────────────
// 2. 组件的初始数据
//
// ⚠️ 这四份是**用户还没打开过应用**时组件显示的东西。必须是**诚实的空状态**：
//    「今天没有任务」是**错的**（我们根本不知道今天有没有任务），
//    「打开 Heyta 以显示小组件」才是对的。
// ─────────────────────────────────────────────────────────────────────

// 🔴 **这一份只能是默认语言。** 它走的是 manifest 的 `data` URL，而宿主取它时
//    **没有任何语言信号**（既不带 `Accept-Language` 给组件宿主用，也没有 query 参数），
//    构建期更不可能知道将来这台设备的界面语言是什么。
//    跟随用户语言的那一份在**运行时**：页面每次推送数据时把同语言的占位态一起
//    交给 service worker（`publish.ts` 的 `placeholders`），SW 过期时先给它。
//    所以这份静态初值只在"这台设备**从没打开过**应用"时才会被看到。
for (const kind of ADAPTIVE_CARD_KINDS) {
  // 🔴 用 `buildAdaptiveCardPlaceholder`，**不是** `buildAdaptiveCardData(…, emptyPayload())`。
  //    后者产出"今天没有任务 / 还没有习惯" —— 而用户还没打开过应用时
  //    我们**根本不知道**今天有没有任务。显示"今天没有任务"是**撒谎**：
  //    用户看到它就不会去做那件事。（这条是被 `tests/pwa.spec.ts` 抓出来的。）
  const data = buildAdaptiveCardPlaceholder(kind, t);
  emit(join(WIDGETS, `${kind}.data.json`), `${JSON.stringify(data, null, 2)}\n`, `widgets/${kind}.data.json`);
}
if (!CHECK) console.log(`  ✅ widgets/*.data.json（${ADAPTIVE_CARD_KINDS.length} 份初始数据）`);

// ─────────────────────────────────────────────────────────────────────
// 3. manifest
// ─────────────────────────────────────────────────────────────────────

/**
 * 组件在系统面板/安装列表里露出的名字与说明 —— **取自词条表**，不在这里写死。
 *
 * ⚠️ 这里只能用**默认语言**，与上面 `*.data.json` 同一个理由：manifest 是构建期
 *    产物、只有一个 `lang`，而 `widgets[].name` / `description` 没有任何逐条本地化
 *    机制可用（`widgets` 成员本身是 Edge 专有，不在 W3C 规范里，多语言字段更无从依赖）。
 *    已登记为边界，见 `docs/plans/i18n-multilingual.md` §7。
 */
const WIDGET_UPDATE_SECONDS = 1800;

/**
 * 🔴 manifest 里所有 URL 一律用**相对地址**，不许写 `/…`。
 *
 * 起因是一次线上验收抓到的真缺陷（2026-09-30，`heyta.waytofuture.cn`）：
 * 应用挂在 `/app/` 下，而这里原先写的是 `start_url: '/'`、`scope: '/'`、
 * `icons[].src: '/icons/…'`。`public/` 里的文件是**原样拷贝**进 `dist/` 的
 * （Vite 不处理它们），所以线上的 manifest 就是这份 —— 于是
 * `GET /icons/icon-192.png` 落到**站点根**，那里是落地页，
 * 返回 `text/html`；**装出来的 PWA 入口是落地页，图标也是坏的**。
 *
 * 为什么相对地址能同时满足两种挂载形态：manifest 的 URL 就是它自己
 * （`/manifest.webmanifest` 或 `/app/manifest.webmanifest`），
 * 而规范规定 `start_url` / `scope` / `icons[].src` **都相对 manifest URL 解析**。
 * 所以 `.` ⇒ 该 manifest 所在目录，`icons/x.png` ⇒ 同目录下的 `icons/x.png`。
 * 根路径部署与子路径部署**同一份产物**都对 —— 不需要再引入构建参数。
 *
 * ⚠️ 别改成写死 `/app/`：`vite dev` 与 `vite preview` 都跑在根路径，
 * 那样会把它们弄坏，而 W3-1/W3-2 的验收正是在那两种形态上跑的。
 */
const manifest = {
  name: 'heyta',
  short_name: 'heyta',
  description: t('web.pwa.description'),
  // `.` = manifest 所在目录。见上面那段注释：这是子路径部署能对的唯一写法。
  id: '.',
  start_url: '.',
  scope: '.',
  display: 'standalone',
  background_color: BACKGROUND,
  theme_color: PRIMARY,
  // 🔴 必须与这份产物**实际使用的语言**同一个来源。写死 `'zh-CN'` 而文案来自别的
  //    语言时，读屏软件与浏览器会按错的语言处理它（`lang` 决定发音与断行）。
  lang: DEFAULT_LOCALE,
  dir: 'ltr',
  icons: [
    { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    {
      src: 'icons/icon-maskable-512.png',
      sizes: '512x512',
      type: 'image/png',
      purpose: 'maskable',
    },
  ],
  // 🔴 `widgets` **不在 W3C 规范、也不在 Chromium 源码里**（实测 grep 0 命中）。
  //    它是 Edge 专有成员：Chrome 会**忽略**它（不报错），
  //    所以 Chrome 用户拿不到组件 —— 这是能力边界，要写进产品预期。
  widgets: ADAPTIVE_CARD_KINDS.map((kind) => {
    return {
      // 🔴 键名拼错 = `translateIn` **抛错** = 构建失败。这里不需要额外的断言：
      //    词条表里查不到就是要命的错，静默产出一个空名字更糟。
      name: t(`widget.${kind}.title`),
      description: t(`widget.card.desc.${kind}`),
      // ⚠️ tag 必须与 `src/pwa/sw-core.ts` 的 `widgetTag()` 产出**逐字符相同**。
      //    对不上的表现是 `updateByTag` 静默什么都不做 → 组件永远停在那不动。
      tag: `heyta-${kind}`,
      // 同样相对 manifest URL 解析（见上面 `manifest` 前那段注释）。
      ms_ac_template: `widgets/${kind}.json`,
      data: `widgets/${kind}.data.json`,
      type: 'adaptivecard',
      // `update` 是**最短刷新间隔**（秒）。写 1800（30 分钟）是规范允许的最小值 ——
      // 即使如此它也不解决"当日任务"的实时性问题（PBS 下限 12 小时），
      // 真正的刷新走 Web Push + `widgets.updateByTag`。见 `sw.ts` 文件头。
      update: WIDGET_UPDATE_SECONDS,
      icons: [{ src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' }],
    };
  }),
};

emit(
  join(PUBLIC, 'manifest.webmanifest'),
  `${JSON.stringify(manifest, null, 2)}\n`,
  'manifest.webmanifest',
);
if (!CHECK) console.log(`  ✅ manifest.webmanifest（${manifest.widgets.length} 款组件）`);

// ─────────────────────────────────────────────────────────────────────
// 4. 打包 service worker
//
// 🔴 `public/sw.js` 是**生成物**。service worker 必须能被 URL 直接取到
//    （作用域由它的路径决定），而它又需要 `@heyta/widget-core` 的
//    `ADAPTIVE_CARD_KINDS` —— 打包是唯一不重复实现的办法。
// ─────────────────────────────────────────────────────────────────────

// 🔴 对账模式不打包：`sw.js` 是 esbuild 的产物，逐字节比它等于比打包器的输出格式，
//    而不是比"有没有人手改过"。它的真源是 `src/pwa/sw.ts`，由 `gen:pwa` 负责刷新。
if (!CHECK) {
  await esbuild({
    entryPoints: [join(APP, 'src', 'pwa', 'sw.ts')],
    outfile: join(PUBLIC, 'sw.js'),
    bundle: true,
    format: 'iife',
    // ⚠️ 不用 ESM：`type: 'module'` 的 service worker 在部分 Edge 版本上不被接受，
    //    而这个文件"加载失败"的症状是**所有组件事件静默消失**（连一条日志都没有）。
    //    IIFE 是所有版本都能装的形态。
    target: ['es2022'],
    platform: 'browser',
    legalComments: 'none',
  });

  const swBytes = execFileSync('wc', ['-c', join(PUBLIC, 'sw.js')], { encoding: 'utf8' }).trim();
  console.log(`  ✅ sw.js（打包自 src/pwa/sw.ts，${swBytes} 字节）`);

  // 清掉可能残留的旧构建产物（`rmSync` 在这里只是防御性的一次检查）
  rmSync(join(PUBLIC, 'widgets', '.DS_Store'), { force: true });

  console.log('\n✅ W3-1 的 PWA 资产已生成到 apps/web/public/');
} else {
  if (drift.length > 0) {
    console.error(`\n❌ PWA 产物与生成结果不一致（${drift.length} 处）：`);
    for (const line of drift) console.error(`   · ${line}`);
    console.error('\n   修复：pnpm --filter @heyta/web gen:pwa 然后提交产物。');
    process.exit(1);
  }
  console.log(`\n✅ PWA 产物对账通过（${compared.length} 份文本产物逐字节一致）`);
}
