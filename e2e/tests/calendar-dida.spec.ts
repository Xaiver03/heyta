import { expect, test } from '@playwright/test';
import { openApp } from './helpers';

/**
 * 日历的**滴答式形态**（goal-layout-audit.md 页 5）
 * =================================================
 *
 * 2026-09-30 产品负责人：「日历也需要学习滴答的这个样子」——
 * 滴答截图的三个特征：周次列（"31周"灰字）、今天所在列的列头高亮、
 * 头部 `< 今天 >` 跳回。
 *
 * 🔴 判据是**存在性 + 几何**（周次列必须在 7 个日期格的**左边**，
 * "有这个元素"证明不了"排对了位置"）。截图落固定路径，人必须看。
 */

test('日历：周次列 + 今天跳回 + 今天列头高亮', async ({ page }) => {
  await openApp(page);
  await page.getByRole('tab', { name: '日历' }).click();

  // ① 「今天」跳回。🔴 它现在住在**页头**的工具栏里（批二），不在月历卡片内 ——
  //    旧的 `calendar-board-today-header` 这个 ID 随那次搬家没了。
  //    页脚那颗只在宿主**没接** `onToday` 时才画（移动端就是那种情况），
  //    Web 接了 ⇒ 这一屏只有一个「回到今天」。
  const today = page.getByTestId('calendar-toolbar-today');
  await expect(today, '页头工具栏必须有「回到今天」').toBeVisible();

  // ② 周次列：至少一行出现"数字+周"的灰字
  const weekCell = page.locator('[data-testid="calendar-board"]').getByText(/\d+周/, { exact: false });
  await expect(weekCell.first(), '周次列应有"31周"式灰字').toBeVisible();

  // ③ 几何：周次列在第一个日期格的左边
  const weekBox = await weekCell.first().boundingBox();
  const firstDay = await page
    .locator('[data-testid="calendar-board"] [role="button"]')
    .filter({ hasText: /\d/ })
    .first()
    .boundingBox();
  expect(weekBox, '周次格有几何').not.toBeNull();
  expect(firstDay, '日期格有几何').not.toBeNull();
  expect(
    weekBox!.x,
    '周次列必须在日期格的左边（坐标系的第一列）',
  ).toBeLessThan(firstDay!.x);

  await page.screenshot({ path: 'test-results/calendar-dida.png', fullPage: false });
});
