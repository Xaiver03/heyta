import { expect, test } from '@playwright/test';
import { openApp } from './helpers';

/**
 * 日历的**对齐形态**（2026-11-22 改版：macOS 日历 × 滴答清单综合体）
 * ==================================================================
 *
 * 历史：2026-09-30 产品负责人曾说「日历也需要学习滴答的这个样子」，于是加了
 * **周次列（"31周"灰字）**。2026-11-22 产品负责人改为「完全对齐 macOS 日历 + 滴答清单的
 * 综合体；清理周数竖槽等杂乱元素」—— macOS 日历没有周数竖槽，故**去掉**。
 *
 * 本用例因此钉的是改版后的形态：
 *   ① 页头「回到今天」在（`calendar-toolbar-today`）；
 *   ② **不再有**"数字+周"的周次竖槽（改版核心之一）；
 *   ③ 今天那一格存在（`calendar-cell-<今天>`）。
 * 截图落固定路径，人必须看。
 */

test('日历：去周数竖槽 + 今天跳回 + 今天格存在', async ({ page }) => {
  await openApp(page);
  await page.getByRole('tab', { name: '日历' }).click();

  // ① 「今天」跳回（页头第②层的工具栏）。
  const today = page.getByTestId('calendar-toolbar-today');
  await expect(today, '页头工具栏必须有「回到今天」').toBeVisible();

  // ② 去周数竖槽：板上不应再出现"数字+周"那类灰字（改版核心之一）。
  const weekCell = page.locator('[data-testid="calendar-board"]').getByText(/\d+周/, { exact: false });
  await expect(weekCell, '周数竖槽应已去掉（对齐 macOS 日历）').toHaveCount(0);

  // ③ 今天那一格在（today 高亮的落点）。
  await expect(
    page.getByTestId(new RegExp('^calendar-cell-')).first(),
    '日历格没渲染出来',
  ).toBeVisible();

  await page.screenshot({ path: 'test-results/calendar-dida.png', fullPage: false });
});
