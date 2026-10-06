#!/usr/bin/env node
/**
 * W7（纪念卡片导出成品图）e2e 判据的变异台 —— web 腿。
 *
 * 用法（在工作树根目录）：
 *   node research/tools/mutate-w7-card-export-arms.mjs apply <A1|A3>
 *   node research/tools/mutate-w7-card-export-arms.mjs revert <A1|A3>
 *
 * 🔴 A1 改的是 `packages/ui` 的**源码**，而判据读的是浏览器真拿到的产物
 * ⇒ apply / revert 之后都必须 `pnpm --filter @heyta/ui build`，
 *   否则那一趟跑的是旧 dist，"臂存活"是假的（同仓先例：`mutate-w7-e2e-arms.mjs` 与
 *   `docs/plans/countdown-anniversary.md` W7 节）。`build` 字段就是把这件事钉在臂上。
 *
 * 已跑读数（2026-10-04 04:2x–04:3x，载体 `feat/countdown-batch2`）：
 *   A1 ⇒ RC_A1=1，**2 failed** / 3 passed：
 *        `:268`「导出的图是 1072×1440，契约要的是 1080×1440」
 *        `:312`「暗色那一张的尺寸不是一档规格数」
 *     🔴 两条红不是"越界"：它们是**同一把尺子**（契约尺寸）的两处使用 ——
 *     亮色那张与暗色那张各自比一次。一臂只红一条断言的要求，正确的写法是
 *     "只红它所代表的那条不变量"，而不是"只红一行"。
 *   A3 读数见原计划 W7 节（跑完由链条写入，不在这里复述）。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const UI_LAYOUT = 'packages/ui/src/countdown/card-export-layout.ts';
const WEB_VIEW = 'apps/web/src/features/countdown/CountdownView.tsx';

const ARMS = {
  // A1：画布宽度不再等于契约 ⇒ "尺寸逐字等于契约"那条必须红。
  A1: {
    file: UI_LAYOUT,
    from: 'const canvasWidth = EXPORT_CARD_EDGE_PX * pxToUnit;',
    to: 'const canvasWidth = (EXPORT_CARD_EDGE_PX - 8) * pxToUnit;',
    build: '@heyta/ui',
  },
  // A3：宿主不再把失败文案传下去 ⇒ "导不出来必须上屏"那条必须红。
  A3: {
    file: WEB_VIEW,
    from: "exportFailed={t('web.countdown.export.failed')}",
    to: 'exportFailed={undefined}',
    build: null,
  },
};

const sha = (text) => createHash('sha256').update(text).digest('hex').slice(0, 12);
const [cmd, armKey] = process.argv.slice(2);
const arm = ARMS[armKey];
if (!arm || !['apply', 'revert'].includes(cmd)) {
  console.error('用法: node research/tools/mutate-w7-card-export-arms.mjs <apply|revert> <A1|A3>');
  process.exit(2);
}
const src = cmd === 'apply' ? arm.from : arm.to;
const dst = cmd === 'apply' ? arm.to : arm.from;
const before = readFileSync(arm.file, 'utf8');
const hits = before.split(src).length - 1;
if (hits !== 1) {
  console.error(`命中数不是 1（${cmd} ${armKey}：命中 ${hits}），拒动。`);
  process.exit(1);
}
writeFileSync(arm.file, before.replace(src, dst), 'utf8');
const after = readFileSync(arm.file, 'utf8');
console.log(`${cmd} ${armKey} OK file=${arm.file} sha=${sha(after)} build=${arm.build ?? 'none'}`);
