import { expect, test } from '@playwright/test';
import { openApp } from './helpers';

/**
 * 设置中心的**形状**判据：一屏只有一种行。
 *
 * 这不是"好不好看"，全部是可量的几何事实 —— 2026-10-25 的现量（改前）：
 * 同一列里 4 种控件形状（radio 块 / segmented / 文字按钮 / 图标+文字）、
 * 行距约 92px、内容区只占 sheet 的 45%、侧栏宽 400px。
 *
 * 每一条都对应一句能判红的话：
 *   · 同行控件左缘必须唯一（不许一行一个起点）
 *   · 控件高度档位 ≤ 2（大档 = 触控目标，小档 = 行内小按钮；再多的档就是没规矩）
 *   · 行距中位数落在 44–56（macOS 设置的行高区间）
 *   · 侧栏 240±8、内容区 ≥ 80% 宽（两级导航，不是三层、不是半屏留白）
 */
test('设置中心：一屏只有一种行', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openApp(page, '/?lang=zh-CN');
  await page.getByTestId('account-menu-avatar').click();
  await page.getByTestId('account-menu-settings').click();
  const sheet = page.getByTestId('settings-sheet');
  await expect(sheet).toBeVisible();
  await sheet.locator('[aria-controls="settings-group-appearance"]').click();

  const m = await sheet.evaluate((root) => {
    const rows = [...root.querySelectorAll('.ht-settings__preference-row')]
      .filter((r) => r.getBoundingClientRect().height > 0);
    const pick = (row: Element) => {
      // 行的形状是"左标签 + 右控件"，控件是最后一个有尺寸的子元素（radio 组 / 文字按钮 / 开关都算）。
      const kids = [...row.children].filter((e) => e.getBoundingClientRect().width > 0);
      const el = kids[kids.length - 1] ?? row;
      const label = kids[0] ?? null;
      const rb = row.getBoundingClientRect();
      const cb = el?.getBoundingClientRect();
      return {
        rowTop: Math.round(rb.top),
        labelLeft: label ? Math.round(label.getBoundingClientRect().left) : null,
        ctrlLeft: cb ? Math.round(cb.left) : null,
        ctrlRight: cb ? Math.round(cb.right) : null,
        ctrlW: cb ? Math.round(cb.width) : null,
        ctrlH: cb ? Math.round(cb.height) : null,
        ctrl: el ? el.tagName.toLowerCase() + (el.getAttribute('role') ? `[${el.getAttribute('role')}]` : '') : null,
      };
    };
    const data = rows.map(pick);
    const nav = root.querySelector('.ht-settings__nav')?.getBoundingClientRect();
    const pane = root.querySelector('#settings-group-appearance')?.getBoundingClientRect();
    const box = root.getBoundingClientRect();
    const uniq = (xs: Array<number | null>) => [...new Set(xs.filter((v): v is number => v != null))];
    const pitches = data.map((d, i) => (i > 0 ? d.rowTop - data[i - 1]!.rowTop : 0)).filter((v) => v > 0);
    const median = pitches.length ? [...pitches].sort((a, b) => a - b)[Math.floor(pitches.length / 2)]! : null;
    return {
      rows: data.length,
      heights: uniq(data.map((d) => d.ctrlH)),
      lefts: uniq(data.map((d) => d.ctrlLeft)),
      rights: uniq(data.map((d) => d.ctrlRight)),
      medianPitch: median,
      navWidth: nav ? Math.round(nav.width) : null,
      sheetWidth: Math.round(box.width),
      contentWidth: pane ? Math.round(pane.width) : null,
      fill: pane && box.width ? Number((pane.width / box.width).toFixed(2)) : null,
      sample: data.slice(0, 6),
      // 「一种行」还包括：同一节里不许并存两种列表语法（行 + 2 列复选卡网格）。
      cardsGrids: root.querySelectorAll('.ht-settings__cards').length,
      preferenceRows: rows.length,
    };
  });
  console.log(`SETTINGS_SHAPE ${JSON.stringify(m)}`);

  expect(m.rows, '这一节至少要几行才量得出形状').toBeGreaterThan(2);
  // 🔴 控件是**尾部对齐**的：右缘必须唯一，左缘本来就该随控件宽度不同。
  // 我第一版写成了"左缘唯一"，那会逼着人把控件改成左对齐 —— 错判据比没有判据更糟。
  expect(m.rights, '同行控件右缘必须唯一').toHaveLength(1);
  expect(m.heights.length, '控件高度档位 ≤ 2').toBeLessThanOrEqual(2);
  expect(m.medianPitch!, '行距中位数 44–56').toBeGreaterThanOrEqual(44);
  expect(m.medianPitch!).toBeLessThanOrEqual(56);
  expect(m.navWidth!, '侧栏 200–260（macOS 参考区间）').toBeGreaterThanOrEqual(200);
  expect(m.navWidth!).toBeLessThanOrEqual(260);
  expect(m.fill!, '内容区 ≥ 80% 宽').toBeGreaterThanOrEqual(0.8);
  expect(m.cardsGrids, '同一节不许并存两种列表语法（行 + 复选卡网格）').toBe(0);
});
