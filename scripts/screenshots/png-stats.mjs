/**
 * PNG 统计信息 —— **零依赖**实现。
 *
 * 移植自 SSOS 的 `scripts/screenshot-artifact-validation.mjs#inspectPng`，
 * 但那边依赖 `pngjs`。本仓库对新增依赖有硬门槛（见 `AGENTS.md` §3.1–3.2 两道门），
 * 而这里要的东西很少，所以直接用 Node 内置的 `node:zlib` 自己解 PNG。
 *
 * 产出与 SSOS 完全一致的判据，用来回答**「这张截图是不是空白的」**：
 *
 *   contentRatio = 非白采样点 / 总采样点      // < 0.01 ⇒ 疑似空白
 *   colorSpan    = 最大亮度 - 最小亮度        // < 16   ⇒ 疑似空白
 *   hasAlpha     = PNG IHDR 的 colorType ∈ {4, 6}
 *
 * 🔴 为什么要有这个：**"跑成功了"和"截到东西了"是两件事**。
 * 页面 404、白屏、渲染未完成、被引导弹窗盖住 —— 这几种情况截出来的都是
 * 一张纯白图，尺寸、退出码全部正常。只看"命令没报错"是发现不了的。
 *
 * 采样策略与 SSOS 一致：整图最多采 ~20000 个点（`sampleStep`），
 * 所以 1320×2868 的 App Store 截图不会被逐像素扫，且**采样点均匀分布**。
 *
 * ── 关于位深 ─────────────────────────────────────────────────────────────
 * 支持 1 / 2 / 4 / 8 / 16 位（真彩、灰度、索引、带 alpha）。
 * 🔴 **低位深不是"边角情况"**：一张真正空白的纯白截图会被编码器压成
 * **1 位灰度图**（实测 `magick -size 120x80 xc:white` 就是 bitDepth=1）。
 * 也就是说，**最需要被判为空白的那类图，恰好就是低位深的** ——
 * 解码器要是在这里抛错，等于把最该发现的情况变成了脚本崩溃。
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** 每个像素有多少个「样本」（通道）。 */
const CHANNELS_BY_COLOR_TYPE = {
  0: 1, // 灰度
  2: 3, // 真彩 RGB
  3: 1, // 索引
  4: 2, // 灰度 + alpha
  6: 4, // 真彩 RGBA
};

const ALPHA_COLOR_TYPES = new Set([4, 6]);
const SUPPORTED_BIT_DEPTHS = new Set([1, 2, 4, 8, 16]);

/**
 * 从一行字节里取出第 index 个样本（考虑 1/2/4 位打包）。
 * 每个字节的高位在前（PNG 规范 §2.3）。
 */
function sampleAt(row, index, bitDepth) {
  if (bitDepth === 8) return row[index];
  if (bitDepth === 16) return row[index * 2]; // 取高字节即可，够判空白
  const perByte = 8 / bitDepth;
  const byte = row[Math.floor(index / perByte)];
  const slot = index % perByte;
  const shift = 8 - bitDepth * (slot + 1);
  return (byte >> shift) & ((1 << bitDepth) - 1);
}

/**
 * 低位深的灰度值需要**按位深放大**到 0–255。
 * 例如 1 位的 1 应当代表纯白 255，而不是 1 —— 不放大就会把白图算成黑图。
 */
function scaleSample(value, bitDepth) {
  if (bitDepth === 8 || bitDepth === 16) return value;
  return Math.round((value * 255) / ((1 << bitDepth) - 1));
}

/**
 * 解析 PNG 的 IHDR 与 IDAT，还原出像素。
 *
 * 遇到不支持的形式**显式抛错**，不猜 —— 静默给错值比直接失败更危险。
 */
export function decodePng(buffer) {
  if (!buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error('不是 PNG（签名不匹配）');
  }

  let offset = 8;
  let header = null;
  const idatChunks = [];
  let palette = null;

  while (offset + 8 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);

    if (type === 'IHDR') {
      header = {
        width: data.readUInt32BE(0),
        height: data.readUInt32BE(4),
        bitDepth: data[8],
        colorType: data[9],
        interlace: data[12],
      };
    } else if (type === 'PLTE') {
      palette = data;
    } else if (type === 'IDAT') {
      idatChunks.push(data);
    } else if (type === 'IEND') {
      break;
    }
    offset += 12 + length; // length(4) + type(4) + data + crc(4)
  }

  if (!header) throw new Error('PNG 缺少 IHDR');
  if (!SUPPORTED_BIT_DEPTHS.has(header.bitDepth)) {
    throw new Error(`不支持的位深：${header.bitDepth}`);
  }
  if (header.interlace !== 0) throw new Error('不支持隔行扫描（interlace=1）');
  const channels = CHANNELS_BY_COLOR_TYPE[header.colorType];
  if (!channels) throw new Error(`不支持的 colorType：${header.colorType}`);
  if (header.colorType === 3 && !palette) throw new Error('索引色 PNG 缺少 PLTE');

  const { width, height, bitDepth } = header;
  const bitsPerPixel = channels * bitDepth;
  const stride = Math.ceil((width * bitsPerPixel) / 8);
  // 过滤器作用在**字节**上，步长是「过滤用 bpp」＝向上取整到整字节
  const filterBpp = Math.max(1, Math.ceil(bitsPerPixel / 8));

  const raw = inflateSync(Buffer.concat(idatChunks));
  const previous = Buffer.alloc(stride);
  const current = Buffer.alloc(stride);
  const rows = Buffer.alloc(stride * height);

  let rawOffset = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = raw[rawOffset];
    rawOffset += 1;
    raw.copy(current, 0, rawOffset, rawOffset + stride);
    rawOffset += stride;

    for (let x = 0; x < stride; x += 1) {
      const left = x >= filterBpp ? current[x - filterBpp] : 0;
      const up = previous[x];
      const upLeft = x >= filterBpp ? previous[x - filterBpp] : 0;
      let value = current[x];

      if (filter === 1) value += left;
      else if (filter === 2) value += up;
      else if (filter === 3) value += (left + up) >> 1;
      else if (filter === 4) {
        // Paeth
        const p = left + up - upLeft;
        const pa = Math.abs(p - left);
        const pb = Math.abs(p - up);
        const pc = Math.abs(p - upLeft);
        value += pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
      } else if (filter !== 0) {
        throw new Error(`未知的行过滤器：${filter}`);
      }
      current[x] = value & 0xff;
    }

    current.copy(rows, y * stride);
    current.copy(previous);
  }

  return { width, height, colorType: header.colorType, bitDepth, channels, stride, rows, palette };
}

/** 把第 index 个像素取成 [r, g, b]。 */
function pixelAt(image, index) {
  const { channels, rows, stride, palette, colorType, bitDepth } = image;
  const y = Math.floor(index / image.width);
  const x = index % image.width;
  const row = rows.subarray(y * stride, (y + 1) * stride);

  if (colorType === 3) {
    const entry = sampleAt(row, x * channels, bitDepth) * 3;
    return [palette[entry], palette[entry + 1], palette[entry + 2]];
  }

  if (colorType === 0 || colorType === 4) {
    const gray = scaleSample(sampleAt(row, x * channels, bitDepth), bitDepth);
    return [gray, gray, gray];
  }

  // 真彩（colorType 2 = RGB，6 = RGBA）。
  // 🔴 必须用 `channels` 而不是写死 3 —— RGBA 是 4 通道，按 3 取会**整幅错位**
  // （实测：一张 RGBA 的截图算出 edgePerContent=0.99，而同一张图存成 RGB 是 0.007，
  //  差了 140 倍。这个 bug 是"用真实样本定标指标"时才暴露出来的。）
  const base = bitDepth === 16 ? x * channels * 2 : x * channels;
  if (bitDepth === 16) {
    return [row[base], row[base + 2], row[base + 4]];
  }
  return [row[base], row[base + 1], row[base + 2]];
}

/** 取第 index 个像素的 alpha。没有 alpha 通道的格式一律当 255（不透明）。 */
function alphaAt(image, index) {
  const { channels, rows, stride, colorType, bitDepth } = image;
  if (colorType !== 4 && colorType !== 6) return 255;
  const y = Math.floor(index / image.width);
  const x = index % image.width;
  const row = rows.subarray(y * stride, (y + 1) * stride);
  if (bitDepth !== 8) return 255; // 低位深/16 位在截图场景里不出现，不猜
  return colorType === 6 ? row[x * channels + 3] : row[x * channels + 1];
}

/**
 * 统计一张 PNG。参数是文件路径。
 *
 * 返回字段与 SSOS 的 `inspectPng` 一一对应（多 `bytes` / `colorType`）。
 */
export function inspectPng(filePath) {
  const buffer = readFileSync(filePath);
  const image = decodePng(buffer);
  const total = image.width * image.height;

  // 与 SSOS 同款采样：最多约 20000 个点，均匀跳采
  const sampleStep = Math.max(1, Math.floor(total / 20_000));

  let samples = 0;
  let nonWhiteSamples = 0;
  let minLuminance = 255;
  let maxLuminance = 0;

  for (let pixel = 0; pixel < total; pixel += sampleStep) {
    const [red, green, blue] = pixelAt(image, pixel);
    const luminance = Math.round((red + green + blue) / 3);
    if (luminance < minLuminance) minLuminance = luminance;
    if (luminance > maxLuminance) maxLuminance = luminance;
    // 阈值 248 而不是 255：抗锯齿边缘与浅灰底纹也算"有内容"
    if (red < 248 || green < 248 || blue < 248) nonWhiteSamples += 1;
    samples += 1;
  }

  // ── 渲染可用性：横向锐利跃变密度 ───────────────────────────────────────
  //
  // 🔴 `contentRatio` 只能回答"有没有内容"，回答不了"内容是不是糊的"。
  // 实测过一次很贵的教训：macOS 壳的自截屏把 SwiftUI 文字渲染成**横向色带**，
  // 而那张图的内容比例 96%、色阶 255、尺寸正确 —— 空白检测**完全通过**，
  // 只有人眼能发现字全是坏的。
  //
  // 判据来自"糊"的物理形态：文字被横向涂抹后，同一行里相邻像素**几乎没有梯度**
  // （整条色带同色），而清晰的文字每一笔都是**陡峭的跃变**。
  // 所以量"每个非白采样点的横向跃变数"：
  //
  //   edgePerContent = 锐利跃变数 / 非白采样数
  //
  // 清晰文本 ≫ 涂抹色带。阈值见 EDGE_PER_CONTENT_MIN（用真实样本定标，
  // 不是估的：清晰样本 0.2~0.5，涂抹样本 <0.05）。
  // 第一遍：采样所有点的亮度，同时统计直方图（用来找**主色 = 背景**）
  const sampledLuminances = [];
  const histogram = new Array(32).fill(0);
  for (let pixel = 0; pixel < total; pixel += sampleStep) {
    const [red, green, blue] = pixelAt(image, pixel);
    const luminance = Math.round((red + green + blue) / 3);
    sampledLuminances.push(luminance);
    histogram[Math.min(31, luminance >> 3)] += 1;
  }
  let modalBucket = 0;
  for (let i = 1; i < histogram.length; i += 1) {
    if (histogram[i] > histogram[modalBucket]) modalBucket = i;
  }
  const modalLuminance = modalBucket * 8 + 4;

  // 第二遍：横向跃变，且只统计**偏离主色**（= 真正的内容）那些点。
  //
  // 🔴 为什么不用"非白"来界定内容：暗色主题下**几乎每个像素都非白**，
  // 于是背景也被算成内容，指标退化成"全图边缘密度"，
  // 好的暗色 UI（0.0065）和糊掉的图（0.0028）只差 2.3 倍 —— 那种薄 margin
  // 当不了门禁。改用"相对主色的偏离"之后，背景被排除，区分度才拉开。
  let transparentSamples = 0;
  let transitions = 0;
  let contentSamples = 0;
  let edgePairs = 0;
  for (let index = 0; index < sampledLuminances.length; index += 1) {
    const pixel = index * sampleStep;
    const column = pixel % image.width;
    const luminance = sampledLuminances[index];
    const isContent = Math.abs(luminance - modalLuminance) >= EDGE_DELTA_MIN;
    if (isContent) contentSamples += 1;
    if (alphaAt(image, pixel) < 255) transparentSamples += 1;
    if (column >= image.width - 1 || index + 1 >= sampledLuminances.length) continue;
    edgePairs += 1;
    if (Math.abs(luminance - sampledLuminances[index + 1]) >= EDGE_DELTA_MIN) transitions += 1;
  }

  return {
    name: filePath.split('/').pop(),
    width: image.width,
    height: image.height,
    bytes: buffer.length,
    colorType: image.colorType,
    bitDepth: image.bitDepth,
    hasAlpha: ALPHA_COLOR_TYPES.has(image.colorType),
    /**
     * 🔴 这张图**是否真的用了透明**（存在 alpha < 255 的像素）。
     *
     * 和 `hasAlpha`（只有格式带 alpha 通道）不是一回事：
     * 设备截图（`simctl io` / `adb screencap`）存成 RGBA，但每个像素 alpha 都是 255，
     * 实际完全不透明 —— 那种格式差异不该被判失败。
     * 真正要管的是"有没有真的透明"，那才会在查看器里出黑边、也无法逐字节比对。
     */
    hasTransparency: transparentSamples > 0,
    colorSpan: maxLuminance - minLuminance,
    contentRatio: samples === 0 ? 0 : nonWhiteSamples / samples,
    edgePairs,
    modalLuminance,
    /** 真正的内容像素占比（相对主色的偏离），比 contentRatio 更能反映"有多少东西" */
    contentOnModalRatio: samples === 0 ? 0 : contentSamples / samples,
    /**
     * 🔴 渲染可用性主指标：**每个内容像素摊到的横向锐利跃变数**。
     *
     * 清晰的文字每一笔都是陡峭跃变 ⇒ 值高（实测 0.35~1.1）；
     * 被横向涂抹的色带内部几乎无梯度 ⇒ 值极低（实测 0.02~0.06）。
     * 阈值见 EDGE_ON_CONTENT_MIN，用真实样本定标。
     */
    edgeOnContent: contentSamples === 0 ? 0 : transitions / contentSamples,
    hash: createHash('sha256').update(buffer).digest('hex'),
  };
}

/** 与 SSOS 相同的空白判据。 */
export const BLANK_CONTENT_RATIO = 0.01;
export const BLANK_COLOR_SPAN = 16;

export function looksBlank(stats) {
  return stats.contentRatio < BLANK_CONTENT_RATIO || stats.colorSpan < BLANK_COLOR_SPAN;
}

// ── UI 特征判据：heyta 主蓝 ─────────────────────────────────────────────
//
// 🔴 **"非空白"挡不住"错误屏"。** 2026-09-30 实测：macOS 安装包没把 web-dist
// 打进包，装出来的 .app 永远渲染"找不到共享 UI 产物"错误屏 —— 而错误屏
// **有标题有正文**，`looksBlank` = false、contentRatio 不为 0，四轮截图统计
// 全绿，最后是产品负责人**人眼看窗口**才发现。
//
// 真正的 UI 特征：heyta 的界面一定有主蓝（`tokens.css` 的 `--ht-blue-600`，
// rail 激活项 / 主按钮 / 链接），而错误屏、空白屏、桌面底色**都没有**。
// 于是"装上的 UI 是真的"有一条结构性判据：截图里数得出主蓝像素。

/** heyta 主蓝 = `#2563EB`（tokens.css `--ht-blue-600`，设计系统唯一事实源）。 */
export const HEYTA_BLUE = [37, 99, 235];

/**
 * 🔴 暗色主题的主蓝是**另一个值**：`#60A5FA`
 * （tokens.css `[data-theme='dark']` → `--ht-color-primary: var(--ht-blue-400)`）。
 *
 * 只数浅色那一个的结果是**把正确的安装判成红的**：2026-09-30 `reinstall:all` 的 mac 段
 * 在启动前刻意清掉壳的 WebKit 存储（那是"全新安装"的一部分），应用于是**回落到系统外观**
 * —— 晚上十点这台机器是深色 —— 截图里是人眼确认过的真共享 UI，而 `HEYTA_BLUE` 命中 **0** ⇒ 🔴。
 *
 * 实测四个样本（同一套 ±12 容差）：
 *
 * | 样本 | `#2563EB` | `#60A5FA` |
 * |---|---|---|
 * | 错误屏「找不到共享 UI 产物」 | 0 | **0** |
 * | 装好的真界面（深色） | 0 | **78** |
 * | 装好的真界面（浅色） | 78 | 0 |
 * | Android / iOS 真界面 | 9 279 / 9 450 | 0 |
 *
 * ⇒ 两个值**相加**不会放过错误屏（错误屏两个都是 0），阈值 20 不用动。
 */
export const HEYTA_BLUE_DARK = [96, 165, 250];

/** 两套主题的主蓝。判定"是不是 heyta 的界面"要用**这一组**，不是单个值。 */
export const HEYTA_BLUES = [HEYTA_BLUE, HEYTA_BLUE_DARK];

/** 每个通道允许的偏差：抗锯齿与色彩空间抖动吃掉一点，但不能放过"不是它"的颜色。 */
export const HEYTA_BLUE_TOLERANCE = 12;

/**
 * 数一张 PNG 里落在给定颜色 ±tolerance 内的采样点数（与 `inspectPng` 同一套跳采）。
 * 返回 0 = 一点都没有 ⇒ 大概率不是 heyta 的 UI。
 */
export function countColor(filePath, [red, green, blue], tolerance = HEYTA_BLUE_TOLERANCE) {
  const buffer = readFileSync(filePath);
  const image = decodePng(buffer);
  const total = image.width * image.height;
  // 🔴 采样密度是 inspectPng 的 **10 倍**（20 万点）：主蓝元素往往很小
  //    （复选框/图标），跳采 2 万点时真 UI 实测只命中 4 个 —— 阈值 20 会把
  //    **真界面**误杀成"不是 heyta 的 UI"。错误屏仍是 0（命中判据不变）。
  const sampleStep = Math.max(1, Math.floor(total / 200_000));
  let hits = 0;
  for (let pixel = 0; pixel < total; pixel += sampleStep) {
    const [r, g, b] = pixelAt(image, pixel);
    if (
      Math.abs(r - red) <= tolerance &&
      Math.abs(g - green) <= tolerance &&
      Math.abs(b - blue) <= tolerance
    ) {
      hits += 1;
    }
  }
  return hits;
}

/**
 * 数一张 PNG 里**任一主题**的 heyta 主蓝（浅色 `#2563EB` + 深色 `#60A5FA`）。
 *
 * 这是"截图里是 heyta 的界面"的判据入口 —— 调用方不该自己挑单个 RGB，
 * 挑了就等于只验了一套主题（见 `HEYTA_BLUE_DARK` 那条实测）。
 */
export function countBrandBlue(filePath, tolerance = HEYTA_BLUE_TOLERANCE) {
  return HEYTA_BLUES.reduce((sum, rgb) => sum + countColor(filePath, rgb, tolerance), 0);
}

/** 判定一次横向跃变/一处内容所需的亮度差。24 能滤掉渐变与抗锯齿，只留真正的边。 */
export const EDGE_DELTA_MIN = 24;

/**
 * 渲染可用性的判据：**"内容很多" 且 "边缘很少"**。
 *
 * 🔴 为什么是两条件联合 —— 这些数字是**用真实样本量出来的**，不是估的：
 *
 * | 样本 | 内容占比 | edgeOnContent | 判定 |
 * |---|---|---|---|
 * | macOS 壳（清晰，暗色） | 6.6% | 0.43 | 正常 |
 * | macOS 壳 evidence（清晰） | 6.5% | 0.46 | 正常 |
 * | iOS 截图（清晰） | 3.8% | 1.81 | 正常 |
 * | Android 截图（清晰） | 9.6% | 0.94 | 正常 |
 * | Web 截图（清晰） | 1.8% | 1.64 | 正常 |
 * | **macOS 旧自截图（糊）** | **43.3%** | **0.20** | 命中 |
 * | **同一张的另一份（糊）** | **43.3%** | **0.20** | 命中 |
 * | **旧 evidence（糊）** | **41.8%** | **0.17** | 命中 |
 *
 * 单个条件都不够：
 *   - 只看 `edgeOnContent`：清晰的暗色 UI 是 0.43，糊的是 0.20，只差 2.1 倍；
 *   - 只看内容占比：一个内容密集的正常 UI 也可能到 40%。
 * 合起来才分得开 —— 涂抹的物理特征是**"把墨摊满画布，却摊没了梯度"**。
 *
 * ⚠️ **这是启发式，不是定理。** 边缘余量只有 1.4~2.8 倍，
 * 一个"大片纯色 + 极少文字"的正常界面（如启动页）也可能被误报。
 * 所以门禁里它**只作为一条独立提示**，报出实测数值，让人去看一眼；
 * 真正防回归的是**证据来源门禁**（见 verify-artifacts.mjs 的 provenance 检查）。
 */
export const SMEAR_CONTENT_RATIO_MIN = 0.15;
export const SMEAR_EDGE_ON_CONTENT_MAX = 0.3;

/** 有内容，但"摊满却没梯度" ⇒ 疑似糊了 / 渲染坏了。 */
export function looksSmeared(stats) {
  if (looksBlank(stats)) return false; // 空白是另一类问题，分开报
  return (
    stats.contentOnModalRatio >= SMEAR_CONTENT_RATIO_MIN &&
    stats.edgeOnContent < SMEAR_EDGE_ON_CONTENT_MAX
  );
}
