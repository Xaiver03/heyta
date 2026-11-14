#!/usr/bin/env node
/**
 * check:spacing-scale —— 一个屏里的**垂直间距**最多两档
 * =====================================================
 *
 * ## 它守的是什么
 *
 * 2026-11-14 真机量「我的」页，组间距是这些值：
 *
 * ```
 * 29 / 40 / 52 / 54 / 60 / 64 / 69 / 72 / 80 / 88 dp
 * ```
 *
 * **十种值，没有一档是刻意定的** —— 它们由三处 padding 相加而来
 * （`SectionHeader.paddingTop` + `SettingsSection` 的 note 间距 + 各屏 `<Stack gap>`）。
 * 三处各自有理由，加起来没有意义。
 *
 * ## 为什么判据是「种数」而不是「具体值」
 *
 * 锁具体值会立刻变成一张豁免表（卡片要 16、区块要 32、底部要 48……），
 * 最后没人看。而**种数**是关系判据：一屏只需要两档 ——
 * 「块与块之间」和「组与组之间」。第三档出现，就说明有人在按地方调数字。
 *
 * ## 口径
 *
 * 只数**垂直结构间距**：`gap` / `rowGap` / `paddingTop` / `paddingBottom` /
 * `marginTop` / `marginBottom` 里出现的 `space.N`。
 * 不数 `paddingHorizontal`（水平留白由 `screen.gutter` 统一给，不是本判据的事）。
 *
 * 阈值 3（含）以上报红：两档是设计，第三档通常是失误。
 *
 * ## 自测
 *
 * `--self-test` 造一个"三档垂直间距"的样本，断言能红。
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const SCREENS_DIR = 'apps/mobile/src/screens';
const MAX_TIERS = 2;

/** 只看垂直间距属性。 */
/**
 * 🔴 只数**明确垂直**的四个属性，**不数 `gap`**。
 * `gap` 的方向取决于容器的 `flexDirection` —— 在 `flexDirection: 'row'` 里它是水平的，
 * 静态扫不出来。第一版把 `gap` 算进来，于是 AuthScreen 那两处**水平** gap(16)
 * 被当成了第四档垂直间距（误报）。一条会误报的尺会被下一个人关掉。
 */
const VERTICAL = /\b(paddingTop|paddingBottom|marginTop|marginBottom|rowGap)\s*:\s*tokens\['(space\.\d+)'\]/g;

function tiersOf(source) {
  const found = new Set();
  for (const m of source.matchAll(VERTICAL)) found.add(m[2]);
  return [...found].sort();
}

function scan(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.tsx') && !name.endsWith('.ts')) continue;
    const path = join(dir, name);
    const text = readFileSync(path, 'utf8');
    const tiers = tiersOf(text);
    // space.0 是"无间距"，不算一档
    const real = tiers.filter((t) => t !== 'space.0');
    if (real.length > MAX_TIERS) out.push({ path, tiers: real });
  }
  return out;
}

function report() {
  const bad = scan(SCREENS_DIR);
  if (bad.length === 0) {
    console.log(`✅ 垂直间距：${SCREENS_DIR} 里每屏 ≤ ${MAX_TIERS} 档。`);
    return true;
  }
  console.error(`🔴 垂直间距：${bad.length} 个屏用了超过 ${MAX_TIERS} 档`);
  for (const b of bad) {
    console.error(`  · ${b.path}`);
    console.error(`      ${b.tiers.join(' / ')}`);
  }
  console.error('');
  console.error('  一屏只需要两档：块与块之间、组与组之间。第三档通常是"这一处看着差一点"+1 出来的。');
  console.error('  取值走 SPACING_ROLE（packages/design-system/src/spacing-roles.ts）。');
  return false;
}

if (process.argv.includes('--self-test')) {
  const sample = `
    const s = { paddingTop: tokens['space.2'], paddingBottom: tokens['space.3'], marginBottom: tokens['space.6'] };
  `;
  const tiers = tiersOf(sample).filter((t) => t !== 'space.0');
  if (tiers.length <= MAX_TIERS) {
    console.error(`🔴 self-test 失败：三档样本只数出 ${tiers.length} 档`);
    process.exit(1);
  }
  const two = `const s = { paddingTop: tokens['space.3'], marginBottom: tokens['space.6'] };`;
  if (tiersOf(two).filter((t) => t !== 'space.0').length > MAX_TIERS) {
    console.error('🔴 self-test 失败：两档样本被误判');
    process.exit(1);
  }
  console.log('✅ self-test：三档判红、两档放行（2 臂）');
  process.exit(0);
}

process.exit(report() ? 0 : 1);
