#!/usr/bin/env node
/**
 * 交叉验证的尺寸比对（capture-window.sh 调用）。
 *
 * 🔴 为什么从 heredoc `node -` 改成独立脚本文件（2026-10-01 实测）：
 *   `node - <<'JS'`（stdin 模块）在交叉验证走**成功路径**时会把事件循环
 *   转死在 ESM 求值的微任务里 —— 打印完「尺寸一致」之后进程不退出
 *   （`sample` 抓到它在 ModuleWrap::Evaluate 的微任务里 100% CPU 空转），
 *   bash 的 `wait` 跟着挂住，门禁 10 分钟超时才收场；同一份代码写成
 *   磁盘上的脚本文件（`node crosscheck-dimensions.mjs a.png b.png`）
 *   0.1 秒退出。失败路径（尺寸不一致 → exit 1）反而从来没挂过 ——
 *   所以这道闸在"红了能跑、绿了挂死"的形状下活了很久没人发现。
 *   判据本身（1x/2x 归一后判等）一个字没动。
 */

import { inspectPng } from '../../../scripts/screenshots/png-stats.mjs';

const [, , selfCapture, independentCapture] = process.argv;
if (selfCapture === undefined || independentCapture === undefined) {
  console.error('用法：node crosscheck-dimensions.mjs <自截图.png> <独立截屏.png>');
  process.exit(2);
}

const a = inspectPng(selfCapture);
const b = inspectPng(independentCapture);
// 🔴 判等必须对 **1x/2x 缩放不敏感**（2026-09-29 实测 2240×1440 vs 1120×720）：
//    自截图按**自己窗口所在屏**的 scale 出像素（Retina 2x），screencapture -l
//    按**目标窗口实际落屏**的 scale 出 —— 两个实例可能落在不同屏
//    （本机有一块 1x 外接屏）。它们证明的是"同一个窗口"，不是"同一块屏"。
const sameLogical =
  (a.width === b.width && a.height === b.height) ||
  (a.width === b.width * 2 && a.height === b.height * 2) ||
  (b.width === a.width * 2 && b.height === a.height * 2);
console.log(`  自截图      ${a.width}x${a.height}`);
console.log(`  screencapture ${b.width}x${b.height}`);
console.log(
  sameLogical
    ? '  ✅ 尺寸一致（1x/2x 归一后；同一数据源的交叉验证）'
    : '  🔴 尺寸不一致 —— 自截图不可信',
);
process.exit(sameLogical ? 0 : 1);
