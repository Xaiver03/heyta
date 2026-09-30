/**
 * 生成 `apps/web` 的 PWA 资产（W3-1）。
 * ==========================================
 *
 * ```sh
 * pnpm --filter @heyta/web gen:pwa
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
 * 有一条测试（`tests/pwa.spec.ts`）钉着"磁盘上的产物 === 重新生成的结果" ——
 * 与黄金夹具、Adaptive Card 模板用的是同一套纪律。
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ADAPTIVE_CARD_KINDS, buildAdaptiveCardPlaceholder } from '@heyta/widget-core';
import { tokensForTheme } from '@heyta/design-system';
import { build as esbuild } from 'esbuild';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = join(HERE, '..');
const PUBLIC = join(APP, 'public');
const ICONS = join(PUBLIC, 'icons');
const WIDGETS = join(PUBLIC, 'widgets');

const light = tokensForTheme('light');
const dark = tokensForTheme('dark');

const PRIMARY = light['color.primary'];
const ON_PRIMARY = light['color.on-primary'];
const BACKGROUND = light['color.background'];

if (!PRIMARY || !ON_PRIMARY || !BACKGROUND) {
  throw new Error('design-system token 缺 color.primary / color.on-primary / color.background');
}

mkdirSync(ICONS, { recursive: true });
mkdirSync(WIDGETS, { recursive: true });

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

writeFileSync(join(ICONS, 'icon.svg'), plain, 'utf8');
writeFileSync(join(ICONS, 'icon-maskable.svg'), maskable, 'utf8');

/** 用 rsvg-convert 渲染 PNG。SVG 是**真源**，PNG 是派生物。 */
function renderPng(svgPath, outPath, size) {
  execFileSync('rsvg-convert', ['-w', String(size), '-h', String(size), '-o', outPath, svgPath], {
    stdio: 'pipe',
  });
}

renderPng(join(ICONS, 'icon.svg'), join(ICONS, 'icon-192.png'), 192);
renderPng(join(ICONS, 'icon.svg'), join(ICONS, 'icon-512.png'), 512);
renderPng(join(ICONS, 'icon-maskable.svg'), join(ICONS, 'icon-maskable-512.png'), 512);
renderPng(join(ICONS, 'icon.svg'), join(ICONS, 'apple-touch-icon.png'), 180);
console.log('  ✅ icons/icon.svg + 4 个 PNG（192 / 512 / maskable-512 / apple-touch-180）');

// ─────────────────────────────────────────────────────────────────────
// 2. 组件的初始数据
//
// ⚠️ 这四份是**用户还没打开过应用**时组件显示的东西。必须是**诚实的空状态**：
//    「今天没有任务」是**错的**（我们根本不知道今天有没有任务），
//    「打开 Heyta 以显示小组件」才是对的。
// ─────────────────────────────────────────────────────────────────────

for (const kind of ADAPTIVE_CARD_KINDS) {
  // 🔴 用 `buildAdaptiveCardPlaceholder`，**不是** `buildAdaptiveCardData(…, emptyPayload())`。
  //    后者产出的是"今天没有任务 / 还没有习惯" —— 而用户还没打开过应用时
  //    我们**根本不知道**今天有没有任务。显示"今天没有任务"是**撒谎**：
  //    用户看到它就不会去做那件事。占位态说的是实话：「打开 Heyta 以显示小组件」。
  //    （这条是被 `tests/pwa.spec.ts` 抓出来的，不是读代码看出来的。）
  const data = buildAdaptiveCardPlaceholder(kind);
  writeFileSync(join(WIDGETS, `${kind}.data.json`), `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}
console.log('  ✅ widgets/*.data.json（4 份初始数据）');

// ─────────────────────────────────────────────────────────────────────
// 3. manifest
// ─────────────────────────────────────────────────────────────────────

const WIDGET_COPY = {
  today: { name: '今日任务', description: '今天要做的事，点一下就能完成', update: 1800 },
  quadrant: { name: '四象限', description: '按重要与紧急分组的任务', update: 1800 },
  habits: { name: '习惯', description: '今天的习惯与连续天数', update: 1800 },
  focus: { name: '专注', description: '正在进行的专注会话', update: 1800 },
};

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
  description: '本地优先、端到端加密的待办与习惯应用',
  // `.` = manifest 所在目录。见上面那段注释：这是子路径部署能对的唯一写法。
  id: '.',
  start_url: '.',
  scope: '.',
  display: 'standalone',
  background_color: BACKGROUND,
  theme_color: PRIMARY,
  lang: 'zh-CN',
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
    const copy = WIDGET_COPY[kind];
    return {
      name: copy.name,
      description: copy.description,
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
      update: copy.update,
      icons: [{ src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' }],
    };
  }),
};

writeFileSync(
  join(PUBLIC, 'manifest.webmanifest'),
  `${JSON.stringify(manifest, null, 2)}\n`,
  'utf8',
);
console.log(`  ✅ manifest.webmanifest（${manifest.widgets.length} 款组件）`);

// ─────────────────────────────────────────────────────────────────────
// 4. 打包 service worker
//
// 🔴 `public/sw.js` 是**生成物**。service worker 必须能被 URL 直接取到
//    （作用域由它的路径决定），而它又需要 `@heyta/widget-core` 的
//    `ADAPTIVE_CARD_KINDS` —— 打包是唯一不重复实现的办法。
// ─────────────────────────────────────────────────────────────────────

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
