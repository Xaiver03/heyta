import { expect, test } from '@playwright/test';
import { openApp } from './helpers';

/**
 * 回收站住在**侧栏底部**（2026-11-04 滴答对齐 D2）。
 *
 * 它原来住 rail 下段（贴左下角），那是 2026-10-04 看图拍的形；滴答把它排在**侧栏底部**，
 * 产品负责人拍板照滴答搬。这一搬换来一个**真实代价**，判据因此必须连代价一起钉住，
 * 否则下一个会话只会看见"少了一枚按钮"：
 *
 *   侧栏只在**任务视图**渲染（`App.tsx` 的 `view === 'tasks'` 那一支），所以这一行
 *   在习惯 / 便签 / 番茄 等视图里**不存在**。剩下两条路是先回任务视图点这一行，
 *   或在搜索的「快速跳转」里打「回收站」。窄档还多一层：那一列住在抽屉里。
 *
 * 🔴 这里同时钉住**反向**那一半：rail 上不许留着第二枚回收站。
 * 「一个目的地只允许一个控件」不是新加的偏好，是 2026-10-04 删侧栏「收集箱」那一行时
 * 写进 `view-tabs.ts` 的判据（见 `PRIMARY_NAV` 文件头）—— 两处都画，两处的高亮状态
 * 迟早各说各话。
 *
 * ⚠️ 几何判据必须在真浏览器里量：jsdom 的 `getBoundingClientRect` 恒为 0。
 */
test.use({ viewport: { width: 1280, height: 900 } });

test.describe('侧栏底部：回收站', () => {
  test('宽屏：这一行在侧栏最下方、点它进回收站，而 rail 上没有第二枚', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('pageerror', (error) => consoleErrors.push(`pageerror: ${error.message}`));

    await openApp(page);

    const sidebar = page.locator('nav.ht-sidebar');
    const trash = page.getByTestId('sidebar-tool-trash');
    const tagsHeading = sidebar.locator('.ht-nav__section').last();

    // 存在性先于取值：拿不到就说明外壳或那一列没起来，后面的几何读数全是废的。
    await expect(sidebar).toBeVisible();
    await expect(trash).toBeVisible();
    await expect(trash).toHaveText('回收站');

    // 🔴 rail 上不许再有它（搬走 ≠ 复制）。
    await expect(page.locator('nav.ht-rail [role="tab"]').filter({ hasText: '回收站' })).toHaveCount(0);
    await expect(page.locator('.ht-rail__tools')).toHaveCount(0);

    await page.screenshot({ path: 'test-results/sidebar-trash-anchor.png' });

    const [sidebarBox, trashBox, tagsBox] = [
      await sidebar.boundingBox(),
      await trash.boundingBox(),
      await tagsHeading.boundingBox(),
    ];
    expect(sidebarBox, '量不到侧栏的包围盒').not.toBeNull();
    expect(trashBox, '量不到回收站那一行的包围盒').not.toBeNull();
    expect(tagsBox, '量不到「标签」分组头的包围盒').not.toBeNull();

    // ① 它在侧栏的**下半段**：比侧栏中点低。
    expect(
      trashBox!.y,
      `回收站那一行在 y=${String(Math.round(trashBox!.y))}，侧栏中点在 ${String(Math.round(sidebarBox!.y + sidebarBox!.height / 2))} —— 它没贴底`,
    ).toBeGreaterThan(sidebarBox!.y + sidebarBox!.height / 2);

    // ② 它排在清单/标签那两块的**下面**（这一列的读序：智能清单 → 四象限 → 清单 → 标签 → 工具）。
    expect(
      trashBox!.y,
      '回收站那一行没有排在「标签」分组头之下',
    ).toBeGreaterThan(tagsBox!.y);

    // ③ 它横向落在侧栏里，不在主区或 rail。
    expect(trashBox!.x).toBeGreaterThanOrEqual(sidebarBox!.x);
    expect(trashBox!.x + trashBox!.width).toBeLessThanOrEqual(sidebarBox!.x + sidebarBox!.width + 1);

    // ④ 点它真的到得了回收站（不是画在那里好看的一行）。
    await trash.click();
    await expect(page.getByTestId('trash-board')).toBeVisible();

    expect(consoleErrors, `控制台报错：${consoleErrors.join(' | ')}`).toEqual([]);
  });

  test('窄屏：先拉开范围抽屉，那一行点得到且真的切视图', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openApp(page);

    const trash = page.getByTestId('sidebar-tool-trash');
    // 窄档那一列住在抽屉里，收起时不该在屏幕上。
    await expect(trash).toBeHidden();
    await page.getByTestId('task-scope-toggle').click();
    await expect(trash).toBeVisible();
    await page.screenshot({ path: 'test-results/sidebar-trash-anchor-narrow.png' });
    await trash.click();
    await expect(page.getByTestId('trash-board')).toBeVisible();
  });
});
