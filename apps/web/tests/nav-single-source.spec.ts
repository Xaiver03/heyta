/**
 * 导航单一来源 / 不新增顶部 tab 条（覆盖图谱 #3）
 * ==============================================
 *
 * 覆盖图谱 #3「顶部 tab 条」在 web 上的处置结论是**复用 rail、不新增一条顶 tab**：
 * `entry-layers.md` 的第一原则是「能改就不要新增」，而 web 的左侧 rail
 * （`RailNavigation` 宽档 / `CompactRailNavigation` 窄档）已经把"切换到哪个视图"
 * 这件事表达完整了 —— 再加一条顶 tab 就是在同一个屏幕上把同一份信息架构画两遍，
 * 且必然与 rail 漂移（两个落点，两套选中态）。
 *
 * 这条判据落地成**两条机器能读的约束**：
 *   1. 视图登记只有一份来源（`view-tabs.ts`），两条 rail 都从它派生；
 *   2. 仓里不存在"顶部 tab 条"的痕迹（`ht-top-tab` / `topTab`）——
 *      将来有人"顺手加一条顶 tab"时，这条会红，逼他回到本结论。
 *
 * ⚠️ 这是**源码形状**判据（与 `renew-entry.spec` 同族）：它钉的是"结构不复刻"，
 * 不是渲染位置。渲染层的选中态另有 rail 自己的用例。
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

/** vitest 的 cwd 是 `apps/web`（见 `vite.config.ts` 的 `test.root`），源码相对它定位。 */
function readSrc(rel: string): string {
  return readFileSync(resolve(process.cwd(), rel), 'utf8');
}

describe('视图导航只有一份来源（覆盖图谱 #3：复用 rail，不新增顶 tab）', () => {
  it('view-tabs.ts 是视图 / 导航登记的唯一来源', () => {
    const source = readSrc('src/features/shell/view-tabs.ts');
    expect(source).toContain('export const PRIMARY_NAV');
    expect(source).toContain('export const ALWAYS_ON_VIEW_TABS');
    expect(source).toContain('export const VIEW_TABS');
  });

  it('宽档 / 窄档两条 rail 都从同一份 view-tabs 派生（不各自维护一份视图表）', () => {
    expect(readSrc('src/features/shell/RailNavigation.tsx')).toContain("'./view-tabs.js'");
    expect(readSrc('src/features/shell/CompactRailNavigation.tsx')).toContain("'./view-tabs.js'");
  });

  it('🔴 仓里不存在"顶部 tab 条"的痕迹（加了就会红，逼回「复用 rail」的结论）', () => {
    const files = [
      'src/App.tsx',
      'src/features/shell/RailNavigation.tsx',
      'src/features/shell/CompactRailNavigation.tsx',
    ];
    for (const rel of files) {
      const source = readSrc(rel);
      expect(source, `${rel} 出现了顶部 tab 条的痕迹`).not.toMatch(/ht-top-tab|topTab|data-testid=["']top-tab/i);
    }
  });
});
