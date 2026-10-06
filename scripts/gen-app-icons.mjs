#!/usr/bin/env node
/**
 * `scripts/gen-app-icons.mjs` —— 各端应用图标的**唯一生成入口**
 * =============================================================
 *
 * ## 为什么必须有它（普查实测，不是顺手加的）
 *
 * 产品负责人 2026-10-04 的原话是「三个应用的 logo 必须是快捷方式，包括各种应用
 * 的 logo 都应用上去。我发现完全没有」。逐端现量的结果比"完全没有"更具体：
 *
 * | 端 | 实测 | 用户看到什么 |
 * |---|---|---|
 * | Web / PWA | `apps/web/public/icons/*` 由 `gen-pwa.mjs` 从 token 生成 | ✅ 已是品牌 mark |
 * | macOS 壳 | `package-app.sh` 用 `icon-512.png` 经 `iconutil` 生成 `Heyta.icns`，`Info.plist` 有 `CFBundleIconFile` | ✅ 已是（2026-09-30 那一刀） |
 * | Windows 壳 | `package-msix.ps1` 在打包时用 System.Drawing 现场生成 4 张 MSIX 贴图 | 🟡 开始菜单/设置里是，**桌面快捷方式不是** |
 * | Android | 各密度 mipmap 目录里的 `ic_launcher.png` 是 **React Native 脚手架模板那张青色机器人**，且没有任何自适应图标 | ❌ 主屏/启动器是别人的图 |
 * | iOS | `AppIcon.appiconset/icon-1024.png` 是品牌 mark，但没有任何生成链保证它与 web 那份同源；`LaunchScreen.storyboard` 还写着 `Powered by React Native` | 🟡 图标对、首屏是模板字 |
 * | 落地页 | `public/favicon.svg` 是**另一枚** mark（圆底 + 描边 h） | 🟡 与产品内不是同一枚 |
 *
 * 🔴 **Windows 那一格是真缺陷，不是观感问题**：`install-and-capture.ps1:121` 拿
 * `Square44x44Logo.targetsize-48_altform-unplated.png` 当快捷方式的 `IconLocation`，
 * 而 `package-msix.ps1` 从来没有生成过这个文件名 —— `Test-Path` 不成立就**静默不设图标**，
 * 于是桌面上那颗方块是资源管理器的通用图形。「完全没有」说的就是这里。
 *
 * ## 三条设计决定
 *
 * 1. **几何不在这里**。真源是 `@heyta/design-system` 的 `brand-mark.ts`（一份「h」）；
 *    这里只决定"哪个平台要哪个形状/尺寸"。再画一遍就是第二份几何，会漂。
 * 2. **色值不在这里**。底板色与字形色取自 token（`tokensForTheme('light')`），
 *    所以这里出现的每个 hex 都是生成出来的，不是抄的。
 * 3. **位图提交进仓库**，构建机因此不需要 `rsvg-convert`；对账靠 `--check`：
 *    文本产物逐字节比，位图比**尺寸 + 采样像素**（PNG 字节会随栅格器版本变，
 *    而"这颗方块是不是我们的 mark"不该随版本变）。
 *
 * ## 用法
 *
 * ```sh
 * node scripts/gen-app-icons.mjs            # 生成（需要 rsvg-convert，与 gen-pwa 同一个依赖）
 * node scripts/gen-app-icons.mjs --check    # 只读对账：存在性 + 尺寸 + 采样像素 + 文本逐字节
 * ```
 *
 * ⚠️ `--check` 不调用 `rsvg-convert`：一条只读门禁不该依赖外部二进制，
 * 更不该改动产物（同 `gen-pwa.mjs` 的取舍）。
 */

import { execFileSync } from 'node:child_process';
import { deflateSync, inflateSync } from 'node:zlib';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * 🔴 这里**不能**写 `from '@heyta/design-system'`：`scripts/` 不属于任何工作区包，
 * 裸标识符解析不到（根 package.json 不是工作区包的消费者）。
 * 走**构建产物的相对路径**，于是"先 build 再生成"成了硬前提 —— 缺产物时
 * 下面会响亮地报错并给出闭合命令，而不是悄悄用一份旧的几何。
 */
const DS_DIST = new URL('../packages/design-system/dist/index.js', import.meta.url);
if (!existsSync(DS_DIST)) {
  console.error(`🔴 缺少设计系统构建产物：${DS_DIST.pathname}`);
  console.error('   闭合命令：pnpm --filter @heyta/design-system build（或 pnpm -r build）');
  process.exit(1);
}
const {
  BRAND_MARK_ANDROID_SAFE,
  BRAND_MARK_CANVAS,
  BRAND_MARK_PWA_SAFE,
  BRAND_MARK_RADIUS,
  BRAND_MARK_SAFE,
  brandMarkCircleSvg,
  brandMarkGlyphSvg,
  brandMarkRects,
  brandMarkSvg,
  tokensForTheme,
} = await import(DS_DIST.href);

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const CHECK = process.argv.includes('--check');

const light = tokensForTheme('light');
const PRIMARY = light['color.primary'];
const ON_PRIMARY = light['color.on-primary'];
const BACKGROUND = light['color.background'];
if (!PRIMARY || !ON_PRIMARY || !BACKGROUND) {
  throw new Error('design-system token 缺 color.primary / color.on-primary / color.background');
}

const counts = { png: 0, text: 0 };
const drift = [];
const readings = [];

/* ──────────────────────────────────────────────────────────────────────
 * 出口：文本产物走逐字节对账，位图走栅格化
 * ──────────────────────────────────────────────────────────────────── */

/** 写文本产物；`--check` 时只与磁盘逐字节比。 */
function emitText(path, content, label) {
  if (!CHECK) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content, 'utf8');
    counts.text += 1;
    return;
  }
  let onDisk = null;
  try {
    onDisk = readFileSync(path, 'utf8');
  } catch {
    /* 不存在也算漂移 */
  }
  if (onDisk === null) drift.push(`${label}：文件不存在（需要跑 gen-app-icons）`);
  else if (onDisk !== content) drift.push(`${label}：磁盘内容与生成结果逐字节不同`);
  else readings.push(`✅ ${label}`);
}

/** SVG → PNG。 */
function rasterize(svg, outPath, width, height = width) {
  mkdirSync(dirname(outPath), { recursive: true });
  const tmp = `${outPath}.gen.tmp.svg`;
  writeFileSync(tmp, svg, 'utf8');
  try {
    execFileSync('rsvg-convert', ['-w', String(width), '-h', String(height), '-o', outPath, tmp], {
      stdio: 'pipe',
    });
  } finally {
    // 失败也要清掉中间 SVG：否则 `git status` 里躺一堆 .svg 临时件，
    // 而它们会被"未跟踪非忽略"的打包集合当成源码送出去（§7 第 196 条同族）。
    rmSync(tmp, { force: true });
  }
}

/**
 * 位图产物：生成模式下栅格化，`--check` 模式下**验证已提交的那份**。
 *
 * 验证三件事，缺一不可：
 *   a. 存在；
 *   b. IHDR 声明的宽高 == 平台要求（尺寸错了 = 系统按比例拉伸 = 「h」被压扁）；
 *   c. 采样点颜色符合预期 —— 这一条是**挡住占位图**的那一条：
 *      Android 的模板图标也是 192×192、也有内容，只看尺寸它会永远绿。
 *
 * ⚠️ 为什么采样而不是比字节：PNG 字节会随 rsvg-convert 版本/压缩参数变，
 * 而"这颗方块是不是我们的 mark"不该随栅格器版本变。比字节会把"该重新生成"
 * 和"产物坏了"混成同一个红，那是两种处置。
 */
function emitPng(svg, outPath, width, height, label, samples) {
  if (!CHECK) {
    rasterize(svg, outPath, width, height ?? width);
    counts.png += 1;
    return;
  }
  let png;
  try {
    png = readPng(outPath);
  } catch (e) {
    drift.push(`${label}：读不到或不是 PNG（${e instanceof Error ? e.message : String(e)}）`);
    return;
  }
  const wantH = height ?? width;
  if (png.width !== width || png.height !== wantH) {
    drift.push(`${label}：尺寸 ${png.width}×${png.height}，平台要求 ${width}×${wantH}`);
    return;
  }
  for (const s of bindSamples(png, samples)) {
    const got = png.pixel(s.x, s.y);
    const ok = s.light ? isLight(got) : near(got, s.rgba);
    if (!ok) {
      drift.push(
        `${label}：(${s.x},${s.y}) 期望 ${s.light ? '亮字形（每通道 ≥ 200）' : `rgba(${s.rgba.join(',')})`}，实得 rgba(${got.join(',')})` +
          (s.why ? ` —— ${s.why}` : ''),
      );
      return;
    }
  }
  readings.push(`✅ ${label}（${width}×${wantH}，${samples.length} 个采样点）`);
}

/** 允许 8/255 的通道误差：栅格器的抗锯齿与 ICC 转换会抖最后一档。 */
function near(a, b) {
  return a.every((v, i) => Math.abs(v - b[i]) <= 8);
}

/**
 * "这一格是亮字形"的判据：三个通道都 ≥ 200。
 *
 * ⚠️ 为什么在**小尺寸**上只能这么判：横杠高 48/512 = 9.4%，在 24px 的图上只有
 * 2.25px —— 栅格器必然把它和底板混色（实测中心像素是 (240,255,254) 而不是纯白）。
 * 拿"逐通道等于字形色"当判据会在 24/48 这两档**永远红**，那等于没有判据。
 *
 * 而它并不是放松到无用：主蓝 (37,99,235) 的 r/g 通道差 160 以上，
 * 底板色过不了这一关；配合"底板那一格必须是主蓝"那条采样，
 * RN 模板图（顶边中点是**透明**、48px 处是青色）也过不了 —— 实测过。
 */
function isLight(a) {
  return a[0] >= 200 && a[1] >= 200 && a[2] >= 200;
}

/* ──────────────────────────────────────────────────────────────────────
 * 最小 PNG 读法（解 IDAT + 反 filter），零第三方依赖
 * ──────────────────────────────────────────────────────────────────── */

/**
 * 为什么自己写而不是加 `pngjs`：AGENTS §3.1/§3.2 要为新依赖过两道门并逐项登记，
 * 而这里只需要"读 8-bit truecolor/调色板 PNG 的若干像素"这一件事。
 * 支持灰度/RGB/RGBA/调色板四种 colorType —— 覆盖了 RN 模板图标（RGBA）与
 * 我们的产物（RGBA），也覆盖了有人误传进来的 JPEG 之外的大部分形状。
 */
function readPng(path) {
  const buf = readFileSync(path);
  if (buf.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw new Error('不是 PNG');
  let pos = 8;
  let ihdr = null;
  const idat = [];
  let palette = null;
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      ihdr = {
        width: data.readUInt32BE(0),
        height: data.readUInt32BE(4),
        bitDepth: data[8],
        colorType: data[9],
        interlace: data[12],
      };
    } else if (type === 'IDAT') idat.push(Buffer.from(data));
    else if (type === 'PLTE') palette = data;
    else if (type === 'IEND') break;
    pos += 12 + len;
  }
  if (!ihdr) throw new Error('缺 IHDR');
  if (ihdr.interlace !== 0) throw new Error('不支持隔行 PNG（Adam7）');
  if (ihdr.bitDepth !== 8) throw new Error(`不支持位深 ${ihdr.bitDepth}`);
  const channels =
    ihdr.colorType === 6 ? 4 : ihdr.colorType === 2 ? 3 : ihdr.colorType === 0 ? 1 : ihdr.colorType === 3 ? 1 : null;
  if (channels === null) throw new Error(`不支持 colorType ${ihdr.colorType}`);

  const raw = inflateSync(Buffer.concat(idat));
  const stride = ihdr.width * channels;
  const out = Buffer.alloc(ihdr.height * stride);
  let rp = 0;
  for (let y = 0; y < ihdr.height; y += 1) {
    const filter = raw[rp];
    rp += 1;
    const line = raw.subarray(rp, rp + stride);
    rp += stride;
    const cur = out.subarray(y * stride, y * stride + stride);
    const prev = y > 0 ? out.subarray((y - 1) * stride, (y - 1) * stride + stride) : null;
    for (let i = 0; i < stride; i += 1) {
      const a = i >= channels ? cur[i - channels] : 0;
      const b = prev ? prev[i] : 0;
      const c = prev && i >= channels ? prev[i - channels] : 0;
      let v = line[i];
      if (filter === 1) v = (v + a) & 0xff;
      else if (filter === 2) v = (v + b) & 0xff;
      else if (filter === 3) v = (v + ((a + b) >> 1)) & 0xff;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        v = (v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 0xff;
      }
      cur[i] = v;
    }
  }

  const rgb = (hex) => [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
  const primaryRgba = [...rgb(PRIMARY), 255];
  const glyphRgba = [...rgb(ON_PRIMARY), 255];

  function pixel(x, y) {
    if (ihdr.colorType === 3) {
      const idx = out[y * stride + x];
      if (!palette || idx * 3 + 2 >= palette.length) return [0, 0, 0, 0];
      return [palette[idx * 3], palette[idx * 3 + 1], palette[idx * 3 + 2], 255];
    }
    const o = y * stride + x * channels;
    if (channels === 1) return [out[o], out[o], out[o], 255];
    if (channels === 3) return [out[o], out[o + 1], out[o + 2], 255];
    return [out[o], out[o + 1], out[o + 2], out[o + 3]];
  }

  return { width: ihdr.width, height: ihdr.height, pixel, primaryRgba, glyphRgba };
}

/** 采样点速记：底板 / 字形 / 透明外圈。 */
const base = (x, y, why) => ({ x, y, rgba: null, why, kind: 'base' });
const glyph = (x, y, why) => ({ x, y, rgba: null, why, kind: 'glyph', light: true });
const clear = (x, y, why) => ({ x, y, rgba: [0, 0, 0, 0], why, kind: 'clear' });

/** 把"底板/字形"两个语义采样换成实际 rgba（依赖具体 PNG 的通道布局）。 */
function bindSamples(png, samples) {
  return samples.map((s) => {
    if (s.kind === 'base') return { ...s, rgba: png.primaryRgba };
    if (s.kind === 'glyph') return { ...s, rgba: png.glyphRgba };
    return s;
  });
}

/* ──────────────────────────────────────────────────────────────────────
 * 1. Android：legacy mipmap（5 档密度）+ 自适应图标（API 26+）
 *
 *    512 画布上的几何按各平台形状组合：
 *      · `ic_launcher.png`     圆角方块铺满（BRAND_MARK_SAFE）
 *      · `ic_launcher_round.png` 圆底 + 安全区字形
 *      · `ic_launcher_foreground.png` 只有字形、底透明，画布是 108dp 那一档
 *    🔴 自适应图标的字形必须走 BRAND_MARK_ANDROID_SAFE（0.60），不能复用
 *       PWA 的 0.72：Android 遮罩只保证中心 66dp，0.72 的横笔两端会被切掉。
 * ──────────────────────────────────────────────────────────────────── */

const ANDROID_RES = join(ROOT, 'apps/mobile/android/app/src/main/res');
/** launcher 图标边长（48dp 基准 × 密度）。 */
const ANDROID_LAUNCHER = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 };
/** 自适应图标画布边长（108dp 基准 × 密度）。 */
const ANDROID_ADAPTIVE = { mdpi: 108, hdpi: 162, xhdpi: 216, xxhdpi: 324, xxxhdpi: 432 };

/**
 * SVG 一律画在 **512 画布**上，尺寸交给 `rsvg-convert -w/-h` 去缩。
 *
 * ⚠️ 这不是偷懒而是必须的：`brand-mark.ts` 的矩形坐标是**画布坐标**，
 * 若把 `size` 换成 48 而 viewBox 仍是 48，字形就会越出画布（读起来像缺笔）。
 * 缩放交给栅格器 —— 它与 `gen-pwa.mjs` 栅格化 `icon-192/512/apple-touch-180`
 * 走的是同一条路，所以"同一份 SVG、不同像素档"在各端是同一个图形。
 */
const rounded = () =>
  brandMarkSvg({
    size: BRAND_MARK_CANVAS,
    radius: BRAND_MARK_RADIUS,
    ...BRAND_MARK_SAFE,
    background: PRIMARY,
    glyph: ON_PRIMARY,
  });
const circle = () =>
  brandMarkCircleSvg({
    size: BRAND_MARK_CANVAS,
    radius: 0,
    ...BRAND_MARK_PWA_SAFE,
    background: PRIMARY,
    glyph: ON_PRIMARY,
  });
const adaptiveForeground = () =>
  brandMarkGlyphSvg(BRAND_MARK_CANVAS, BRAND_MARK_ANDROID_SAFE, ON_PRIMARY);

/**
 * 采样点按形状给（坐标相对**目标尺寸**，所以用比例而不是像素常量）。
 *
 * ⚠️ 为什么必须采样：RN 模板图标同样是 192×192 的 RGBA PNG —— 只看尺寸或
 * 只看"非空白"，那条判据在模板图上**也是绿的**（AGENTS §7 元规则 2）。
 */
function launcherSamples(size) {
  return [
    base(Math.round(size * 0.5), Math.round(size * 0.08), '顶边中点应是主蓝底板'),
    glyph(Math.round(size * 0.5), Math.round(size * 0.5), '画布中心落在字形横杠上'),
    clear(0, 0, '圆角外圈必须透明，否则 launcher 会带一圈白边'),
  ];
}
function circleSamples(size) {
  return [
    base(Math.round(size * 0.5), Math.round(size * 0.03), '圆底顶边中点在圆内 = 主蓝'),
    glyph(Math.round(size * 0.5), Math.round(size * 0.5), '画布中心落在字形横杠上'),
    clear(0, 0, '圆外的角必须透明'),
  ];
}
function foregroundSamples(size) {
  return [
    glyph(Math.round(size * 0.5), Math.round(size * 0.5), '前景层中心是字形'),
    clear(Math.round(size * 0.02), Math.round(size * 0.02), '前景层必须是透明底'),
    clear(Math.round(size * 0.95), Math.round(size * 0.5), '外圈留空给遮罩'),
  ];
}

for (const [dpi, px] of Object.entries(ANDROID_LAUNCHER)) {
  const jobs = [
    ['ic_launcher.png', rounded(), px, launcherSamples(px)],
    ['ic_launcher_round.png', circle(), px, circleSamples(px)],
    [
      'ic_launcher_foreground.png',
      adaptiveForeground(),
      ANDROID_ADAPTIVE[dpi],
      foregroundSamples(ANDROID_ADAPTIVE[dpi]),
    ],
  ];
  for (const [name, svg, size, samples] of jobs) {
    emitPng(
      svg,
      join(ANDROID_RES, `mipmap-${dpi}`, name),
      size,
      undefined,
      `android mipmap-${dpi}/${name}`,
      samples,
    );
  }
}

const adaptiveXml = `<?xml version="1.0" encoding="utf-8"?>
<!--
  生成物（scripts/gen-app-icons.mjs）—— 不要手改。
  改图标去改 packages/design-system/src/brand-mark.ts（几何）或
  packages/design-system/src/tokens.css（颜色），然后重跑本脚本。

  三层各干什么：
    background：token 主蓝（值见 values/ic_launcher_background.xml）；
    foreground：只有「h」字形、底透明，字形落在中心 66dp 保留圆内；
    monochrome：同一层 —— Android 13 的"主题图标"会拿它去做单色剪影，
                没有这一层时主题模式下会退回整枚彩色图标（等于没适配）。
-->
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/ic_launcher_background" />
    <foreground android:drawable="@mipmap/ic_launcher_foreground" />
    <monochrome android:drawable="@mipmap/ic_launcher_foreground" />
</adaptive-icon>
`;
emitText(join(ANDROID_RES, 'mipmap-anydpi-v26', 'ic_launcher.xml'), adaptiveXml, 'android mipmap-anydpi-v26/ic_launcher.xml');
emitText(
  join(ANDROID_RES, 'mipmap-anydpi-v26', 'ic_launcher_round.xml'),
  adaptiveXml,
  'android mipmap-anydpi-v26/ic_launcher_round.xml',
);
emitText(
  join(ANDROID_RES, 'values', 'ic_launcher_background.xml'),
  `<?xml version="1.0" encoding="utf-8"?>
<!-- 生成物（scripts/gen-app-icons.mjs）：唯一取值是 design-system token color.primary。 -->
<resources>
    <color name="ic_launcher_background">${PRIMARY}</color>
</resources>
`,
  'android values/ic_launcher_background.xml',
);

/* ──────────────────────────────────────────────────────────────────────
 * 2. iOS：单尺寸 1024（Xcode 14+ 的 AppIcon 只要这一张）
 *
 *    必须是**不透明满幅方底**：Apple 要求 App 图标不带 alpha，圆角交给系统遮罩。
 *    这里用 radius 0 + PWA 的 0.72 安全区 —— 遮罩切掉的是底板四角，不是字形。
 * ──────────────────────────────────────────────────────────────────── */

const iosIconPath = join(
  ROOT,
  'apps/mobile/ios/Heyta/Images.xcassets/AppIcon.appiconset/icon-1024.png',
);
/** 满幅方底（无圆角，交给系统遮罩）—— iOS 与各端 MSIX 贴图共用这一档。 */
const fullBleed = () =>
  brandMarkSvg({
    size: BRAND_MARK_CANVAS,
    radius: 0,
    ...BRAND_MARK_PWA_SAFE,
    background: PRIMARY,
    glyph: ON_PRIMARY,
  });

emitPng(
  fullBleed(),
  iosIconPath,
  1024,
  undefined,
  'ios AppIcon.appiconset/icon-1024.png',
  [
    base(512, 64, '满幅方底：顶部中点应是主蓝'),
    glyph(512, 512, '画布中心落在字形横杠上'),
    base(16, 16, 'iOS 图标不允许透明角'),
  ],
);

/**
 * 首屏静态帧用的品牌 mark（LaunchScreen.storyboard 引用它）。
 *
 * iOS 的系统启动屏**只允许静态图**（storyboard 不参与动画时间线），
 * 所以动效那一半只能做在首屏之后的应用内一层（见
 * `docs/plans/brand-icon-and-splash.md` §3 的调研结论）。
 * 这张图就是那一帧静态：透明底 + 主蓝方底 + 字形。
 */
const IOS_LAUNCH_SIZES = { '1x': 96, '2x': 192, '3x': 288 };
for (const [scale, px] of Object.entries(IOS_LAUNCH_SIZES)) {
  emitPng(
    rounded(),
    join(
      ROOT,
      'apps/mobile/ios/Heyta/Images.xcassets/HeytaLaunchMark.imageset',
      `heyta-mark@${scale}.png`.replace('@1x', ''),
    ),
    px,
    undefined,
    `ios HeytaLaunchMark.imageset/heyta-mark@${scale}.png`,
    [
      base(Math.round(px / 2), Math.round(px * 0.08), '方底顶部中点'),
      glyph(Math.round(px / 2), Math.round(px / 2), '中心是字形'),
    ],
  );
}
emitText(
  join(ROOT, 'apps/mobile/ios/Heyta/Images.xcassets/HeytaLaunchMark.imageset/Contents.json'),
  `{
  "images" : [
    {
      "filename" : "heyta-mark.png",
      "idiom" : "universal",
      "scale" : "1x"
    },
    {
      "filename" : "heyta-mark@2x.png",
      "idiom" : "universal",
      "scale" : "2x"
    },
    {
      "filename" : "heyta-mark@3x.png",
      "idiom" : "universal",
      "scale" : "3x"
    }
  ],
  "info" : {
    "author" : "xcode",
    "version" : 1
  }
}
`,
  'ios HeytaLaunchMark.imageset/Contents.json',
);

/* ──────────────────────────────────────────────────────────────────────
 * 3. Windows：MSIX 贴图（提交进仓库，打包脚本只拷贝）+ 快捷方式 .ico
 *
 *    两条实测理由：
 *      · `Wide310x150Logo` 必须**居中构图**：原来打包脚本把 512 方图直接拉成
 *        310×150，「h」被压扁近 2:1。这里字形只占中间那块正方形。
 *      · `Square44x44Logo.targetsize-48_altform-unplated.png` 是
 *        `install-and-capture.ps1` 拿去做桌面快捷方式 `IconLocation` 的那枚 ——
 *        它以前**从不生成**，所以桌面上那颗方块是系统通用图标。这一格补上。
 *      · `.ico` 给未打包的 `dotnet publish` exe（`<ApplicationIcon>`）：
 *        资源管理器与任务栏读的是 PE 里的图标资源，不是 MSIX 贴图。
 * ──────────────────────────────────────────────────────────────────── */

const WIN_ASSETS = join(ROOT, 'apps/desktop-windows/assets');
const WIN_MSIX = join(WIN_ASSETS, 'msix');

/** 310×150：底板铺满，字形居中在中间 150×150 区域（**不拉伸**，见上方理由）。 */
function wideSvg() {
  const s = 150 / BRAND_MARK_CANVAS;
  const dx = (310 - 150) / 2;
  const rects = brandMarkRects(BRAND_MARK_PWA_SAFE)
    .map(
      (b) =>
        `<rect x="${dx + b.x * s}" y="${b.y * s}" width="${b.width * s}" height="${b.height * s}" rx="${b.rx * s}" fill="${ON_PRIMARY}"/>`,
    )
    .join('\n    ');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="310" height="150" viewBox="0 0 310 150">
  <rect width="310" height="150" fill="${PRIMARY}"/>
  <g>
    ${rects}
  </g>
</svg>
`;
}

emitPng(fullBleed(), join(WIN_MSIX, 'Square44x44Logo.png'), 44, undefined, 'windows msix Square44x44Logo.png', [
  base(22, 3, '方底顶部中点'),
  glyph(22, 22, '中心是字形'),
]);
emitPng(fullBleed(), join(WIN_MSIX, 'Square150x150Logo.png'), 150, undefined, 'windows msix Square150x150Logo.png', [
  base(75, 8, '方底顶部中点'),
  glyph(75, 75, '中心是字形'),
]);
emitPng(fullBleed(), join(WIN_MSIX, 'StoreLogo.png'), 50, undefined, 'windows msix StoreLogo.png', [
  base(25, 3, '方底顶部中点'),
  glyph(25, 25, '中心是字形'),
]);
emitPng(wideSvg(), join(WIN_MSIX, 'Wide310x150Logo.png'), 310, 150, 'windows msix Wide310x150Logo.png', [
  base(10, 75, '左端是底板（证明没有被拉扁）'),
  base(155, 12, '居中方块区域顶部是底板'),
  glyph(155, 75, '字形中心在画布正中'),
]);
/**
 * 🔴 快捷方式图标那两枚（targetsize + altform-unplated）。
 * `altform-unplated` = 不带背景板的图标本体；`targetsize-48` 是 .lnk 默认要的档位。
 * 缺了它们，`install-and-capture.ps1` 的 `Test-Path` 不成立就**静默不设图标**，
 * 桌面快捷方式退回资源管理器的通用图形 —— 这正是「我发现完全没有」的那一处。
 */
emitPng(rounded(), join(WIN_MSIX, 'Square44x44Logo.targetsize-24_altform-unplated.png'), 24, undefined, 'windows msix Square44x44Logo.targetsize-24_altform-unplated.png', [
  base(12, 3, '圆角方底顶部中点'),
  glyph(12, 12, '中心是字形'),
]);
emitPng(rounded(), join(WIN_MSIX, 'Square44x44Logo.targetsize-48_altform-unplated.png'), 48, undefined, 'windows msix Square44x44Logo.targetsize-48_altform-unplated.png', [
  base(24, 5, '圆角方底顶部中点'),
  glyph(24, 24, '中心是字形'),
  clear(0, 0, '圆角外圈透明'),
]);

/**
 * ICO 容器（Vista+ 的 PNG 压缩条目），手写头、零依赖。
 * 条目 16/24/32/48/64/128/256；按规范 256 在目录里记成 0。
 */
function writeIco(outPath, sizes) {
  const blobs = sizes.map((s) => {
    const tmp = `${outPath}.${s}.tmp.png`;
    rasterize(rounded(), tmp, s);
    const png = readFileSync(tmp);
    rmSync(tmp, { force: true });
    return [s, png];
  });
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2); // type = icon
  header.writeUInt16LE(blobs.length, 4);
  const dirSize = 16 * blobs.length;
  let offset = 6 + dirSize;
  const dir = Buffer.alloc(dirSize);
  for (const [i, [s, png]] of blobs.entries()) {
    const d = dir.subarray(i * 16, i * 16 + 16);
    d.writeUInt8(s >= 256 ? 0 : s, 0);
    d.writeUInt8(s >= 256 ? 0 : s, 1);
    d.writeUInt16LE(1, 4); // planes
    d.writeUInt16LE(32, 6); // bit count
    d.writeUInt32LE(png.length, 8);
    d.writeUInt32LE(offset, 12);
    offset += png.length;
  }
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, Buffer.concat([header, dir, ...blobs.map(([, png]) => png)]));
}

const icoPath = join(WIN_ASSETS, 'heyta.ico');
if (!CHECK) {
  writeIco(icoPath, [16, 24, 32, 48, 64, 128, 256]);
  counts.png += 1;
} else {
  // .ico 的判据：目录里必须有 16/32/48/256 这四档（缺一档 = 某个缩放级别下系统拿不到图标），
  // 且每个条目都必须是可解的 PNG —— 手写头的失败方式是"资源管理器显示空白"，不报错。
  try {
    const buf = readFileSync(icoPath);
    const n = buf.readUInt16LE(4);
    const found = [];
    for (let i = 0; i < n; i += 1) {
      const d = buf.subarray(6 + i * 16, 6 + (i + 1) * 16);
      const w = d.readUInt8(0) === 0 ? 256 : d.readUInt8(0);
      found.push(w);
      const size = d.readUInt32LE(8);
      const off = d.readUInt32LE(12);
      if (buf.toString('hex', off, off + 8) !== '89504e470d0a1a0a') {
        drift.push(`windows heyta.ico：条目 ${w}px 不是 PNG 数据`);
      } else {
        const png = readPngFromBuffer(buf.subarray(off, off + size));
        if (png.width !== w || png.height !== w) {
          drift.push(`windows heyta.ico：条目 ${w}px 的 IHDR 是 ${png.width}×${png.height}`);
        }
      }
    }
    for (const want of [16, 32, 48, 256]) {
      if (!found.includes(want)) drift.push(`windows heyta.ico：缺 ${want}px 条目`);
    }
    if (drift.every((d) => !d.includes('heyta.ico'))) {
      readings.push(`✅ windows heyta.ico（${n} 档：${found.join('/')}）`);
    }
  } catch (e) {
    drift.push(`windows heyta.ico：读不到（${e instanceof Error ? e.message : String(e)}）`);
  }
}

/** .ico 内部条目的 PNG 走同一段解码（不落盘）。 */
function readPngFromBuffer(buf) {
  const tmp = join(dirname(icoPath), `.ico-probe-${buf.length}.png`);
  writeFileSync(tmp, buf);
  try {
    return readPng(tmp);
  } finally {
    rmSync(tmp, { force: true });
  }
}

/* ──────────────────────────────────────────────────────────────────────
 * 4. 落地页：把第二枚 mark 收成同一枚
 *
 *    `apps/landing/public/favicon.svg` 原来是手写的圆底 + 描边 h ——
 *    与产品内那枚圆角方块**不是同一个形状**。站内有两枚 mark 的代价是
 *    "浏览器标签页里的 heyta"和"launcher 里的 heyta"看起来不像一家。
 *    这里改成从同一份几何栅格化（文件路径不变，所以入口 HTML 一个字都不用改）。
 *
 * ⚠️ 表现属性里不能写 `var()`（SVG 的表现属性不参与 CSS 变量替换），
 *    所以色值是生成进来的 token 字面值 —— 与 `server/src/design.generated.ts`
 *    同一个套路：真源一份，靠生成物搬过去，靠 `--check` 钉住。
 * ──────────────────────────────────────────────────────────────────── */

/**
 * 落地页 favicon：显示尺寸 64，但 **viewBox 仍是 512 画布** ——
 * 与栅格器同一套约定（几何只有一份坐标，缩放交给消费方），
 * 否则每加一个尺寸就要重算一次矩形、多一处会漂的地方。
 */
const faviconRects = brandMarkRects(BRAND_MARK_SAFE)
  .map(
    (b) =>
      `<rect x="${b.x}" y="${b.y}" width="${b.width}" height="${b.height}" rx="${b.rx}" fill="${ON_PRIMARY}"/>`,
  )
  .join('\n  ');
emitText(
  join(ROOT, 'apps/landing/public/favicon.svg'),
  `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 ${BRAND_MARK_CANVAS} ${BRAND_MARK_CANVAS}" role="img" aria-label="heyta">
  <!--
    生成物（scripts/gen-app-icons.mjs）—— 不要手改。
    几何来自 packages/design-system/src/brand-mark.ts（全站唯一一份「h」），
    色值来自 design-system token（SVG 的表现属性写不了 var()，所以是生成进来的字面值）。

    ⚠️ 这段注释里**不许出现两个连续的连字符** —— XML 注释不允许，
       写坏了整份 SVG 就是非法文档：浏览器不显示图标而渲染一个 XML 错误页，
       而 HTTP 层仍然是 200 + image/svg+xml，光看响应码发现不了。
  -->
  <rect width="${BRAND_MARK_CANVAS}" height="${BRAND_MARK_CANVAS}" rx="${BRAND_MARK_RADIUS}" fill="${PRIMARY}"/>
  ${faviconRects}
</svg>
`,
  'landing public/favicon.svg',
);

/* ──────────────────────────────────────────────────────────────────────
 * 5. 小组件的占位底色（Android 小组件用 ?android:attr 跟随启动器，不消费这里）
 *    —— 这一格刻意**不做**：小组件已经有自己的主题接线，
 *       在这里再写一份色值就是第二个事实源。
 * ──────────────────────────────────────────────────────────────────── */

/* ──────────────────────────────────────────────────────────────────────
 * 出口
 * ──────────────────────────────────────────────────────────────────── */

if (CHECK) {
  if (drift.length > 0) {
    console.error(`🔴 应用图标产物漂移（${drift.length} 条）：`);
    for (const d of drift) console.error(`   - ${d}`);
    console.error('   闭合命令：node scripts/gen-app-icons.mjs');
    process.exit(1);
  }
  console.log(`  ✅ 应用图标对账通过（${readings.length} 份产物：尺寸 + 采样像素 / 文本逐字节）`);
  process.exit(0);
}

console.log(
  `  ✅ gen-app-icons：${counts.png} 张位图 · ${counts.text} 份文本产物（主蓝 ${PRIMARY}，字形 ${ON_PRIMARY}）`,
);
