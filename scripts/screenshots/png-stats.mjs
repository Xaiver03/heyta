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
function decodePng(buffer) {
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

  // 真彩：按 8/16 位取三个样本
  const base = bitDepth === 16 ? x * 3 * 2 : x * 3;
  if (bitDepth === 16) {
    return [row[base], row[base + 2], row[base + 4]];
  }
  return [row[base], row[base + 1], row[base + 2]];
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

  return {
    name: filePath.split('/').pop(),
    width: image.width,
    height: image.height,
    bytes: buffer.length,
    colorType: image.colorType,
    bitDepth: image.bitDepth,
    hasAlpha: ALPHA_COLOR_TYPES.has(image.colorType),
    colorSpan: maxLuminance - minLuminance,
    contentRatio: samples === 0 ? 0 : nonWhiteSamples / samples,
    hash: createHash('sha256').update(buffer).digest('hex'),
  };
}

/** 与 SSOS 相同的空白判据。 */
export const BLANK_CONTENT_RATIO = 0.01;
export const BLANK_COLOR_SPAN = 16;

export function looksBlank(stats) {
  return stats.contentRatio < BLANK_CONTENT_RATIO || stats.colorSpan < BLANK_COLOR_SPAN;
}
