#!/usr/bin/env node
// 两枚 PNG 的**像素差**量数（changed_px / 占比 / 差异包围盒）。
//
// 为什么需要它：界面类工单每搬一格都会重写一批 `apps/web/evidence/**.png`，而"哪些是真被这一单改的、
// 哪些只是同一张图重打一遍"必须有个数 —— 光看 `git status` 的 ` M` 只能证明字节不同，
// 证明不了"人眼看得见的地方变了"。上一单的 `changed_px` 读数住在临时脚本里，脚本一没就复现不了，
// 所以这里入仓成常驻装置。
//
// 解码走 `png-stats.mjs` 的 `decodePng`（**同一份实现**）：设计系统的品牌色计数、空白判定、
// 这里的像素差必须解出同一批像素，否则"两张图一样"和"这张图不是空白"会各自解出两套像素来比。
//
// 用法：`node scripts/screenshots/png-diff.mjs <before.png> <after.png> [--sample=N]`
// 输出（都是可直接抄进文档的读数）：
//   DIMENSIONS=WxH vs WxH  SHAPE=match|<原因>  changed_px=N (P.PP%)  bbox=x0,y0-x1,y1  DIFF=FOUND|NONE
// `--sample=N`（默认 0）再打 N 行差异像素的**前后色值** —— 有的差异肉眼看不出来（抗锯齿、亚像素位移），
// 光靠 bbox 判"这块是不是本单改的"会判错；色值能区分"元素换了"与"边缘抖了一格"。
// 退出码：0 = 量到了（ DIFF=FOUND 也算量到，这是**量具**不是门禁）；
//         1 = 量不了（读不到文件 / 位深或 colorType 不同 / 尺寸不同 ⇒ 响亮失败，不返回 0%）。

import { readFileSync } from 'node:fs';
import { decodePng } from './png-stats.mjs';

const positional = [];
let sampleLimit = 0;
for (const arg of process.argv.slice(2)) {
  const sample = /^--sample=(\d+)$/.exec(arg);
  if (sample) sampleLimit = Number(sample[1]);
  else positional.push(arg);
}
const [beforePath, afterPath] = positional;
if (beforePath === undefined || afterPath === undefined) {
  console.error('用法：node scripts/screenshots/png-diff.mjs <before.png> <after.png>');
  process.exit(1);
}

/** 解不出一律响亮失败：一个"0 处差异"的读数与"根本没比"逐字相同（AGENTS §7 元规则 1）。 */
function load(path) {
  try {
    return decodePng(readFileSync(path));
  } catch (error) {
    console.error(`量不了：${path} —— ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

const a = load(beforePath);
const b = load(afterPath);

const dims = `${a.width}x${a.height} vs ${b.width}x${b.height}`;
if (a.width !== b.width || a.height !== b.height) {
  console.log(`DIMENSIONS=${dims} SHAPE=size_differs ⇒ 不许比，先问是谁改了视口`);
  process.exit(1);
}
if (a.colorType !== b.colorType || a.bitDepth !== b.bitDepth || a.channels !== b.channels) {
  console.log(
    `DIMENSIONS=${dims} SHAPE=encoding_differs (colorType ${a.colorType}/${b.colorType}, ` +
      `bitDepth ${a.bitDepth}/${b.bitDepth}, channels ${a.channels}/${b.channels}) ⇒ 不比`,
  );
  process.exit(1);
}

// `rows` 是解过滤后的**逐行字节**（步长 `stride`）。同宽同色型时同一字节位置就是同一像素分量，
// 所以按字节比再折算像素数，与逐像素取值等价且少一层解引用。
const { width, height, stride, rows: rowsA } = a;
const rowsB = b.rows;
const bytesPerPixel = a.channels * (a.bitDepth / 8);

let changedPixels = 0;
let minX = width;
let minY = height;
let maxX = -1;
let maxY = -1;
const samples = [];

for (let y = 0; y < height; y += 1) {
  const rowOffsetA = y * stride;
  const rowOffsetB = y * stride;
  for (let x = 0; x < width; x += 1) {
    const from = x * bytesPerPixel;
    let differs = false;
    for (let k = 0; k < bytesPerPixel; k += 1) {
      if (rowsA[rowOffsetA + from + k] !== rowsB[rowOffsetB + from + k]) {
        differs = true;
        break;
      }
    }
    if (!differs) continue;
    changedPixels += 1;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    if (samples.length < sampleLimit) {
      const cut = (o) => [rowsA[o + 0], rowsA[o + 1], rowsA[o + 2]].join(',') + '→' +
        [rowsB[o + 0], rowsB[o + 1], rowsB[o + 2]].join(',');
      samples.push(`  (${x},${y}) before→after rgb ${cut(rowOffsetA + from)}`);
    }
  }
}

const total = width * height;
const pct = ((changedPixels / total) * 100).toFixed(2);
const bbox = changedPixels === 0 ? 'bbox=-' : `bbox=${minX},${minY}-${maxX},${maxY}`;
console.log(
  `DIMENSIONS=${dims} SHAPE=match changed_px=${changedPixels} (${pct}%) ${bbox} ` +
    `DIFF=${changedPixels === 0 ? 'NONE' : 'FOUND'}`,
);
for (const line of samples) console.log(line);
