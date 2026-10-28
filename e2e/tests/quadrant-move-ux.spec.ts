import { expect, test } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { openApp, switchView } from './helpers';

/**
 * 🔴 2026-10-28（全局 UX 线 P3）：那一枚撤销按钮现在住在共享的 `UndoReceipt` 里，
 * 落点从 `quadrant-drop-undo`（裸 button）变成 `quadrant-drop-undo-action`
 * （`quadrant-drop-undo` 现在是那条回执的容器）。
 *
 * 这不是"把测试改成能过"：命题一个字没动 —— **拖放之后必须还能撤销，撤完回到原来那一格**。
 * 改的是它指的那枚控件的名字，而这个名字的契约由回执本身钉
 * （`apps/web/tests/undo-receipt.spec.tsx` 里那 7 条：时长、暂停、失败留不留）。
 * 容器与动作分两枚 testId 是原语的形状，不是本文件发明的。
 */
for (const width of [1280, 375]) {
  test(`四象限无需拖拽即可移动并撤销 ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await openApp(page, '/?lang=zh-CN');
    const input = page.locator('input[placeholder^="添加任务"]');
    await input.fill('用可见入口安排任务');
    await input.press('Enter');
    await switchView(page, '四象限');
    const move = page.getByRole('combobox', { name: '移动「用可见入口安排任务」到其他象限' });
    const original = page.getByTestId('quadrant-cell-4');
    await expect(original.getByRole('combobox')).toBeVisible();
    for (const destination of ['1', '2', '3']) {
      await move.selectOption(destination);
      await expect(page.getByTestId(`quadrant-cell-${destination}`).getByRole('combobox')).toBeVisible();
      await expect(page.getByTestId('quadrant-drop-status')).toBeVisible();

      /*
        🔴 2026-10-28（全局 UX 线 P3）：这一格顺带证**真浏览器里那条暂停通道接得住**。
        单测用 jsdom 派 `pointerover` 已经能钉住"计时暂停"，但那证的是组件逻辑；
        浏览器这一发证的是 React 真的把 `pointerover` 综合成了 `onPointerEnter`
        —— 两件事不同，所以两边都留着（少一边的话，另一边的红会指错方向）。
        窗口是 8000ms：把手放在回执上停 9 秒，它必须还在。
      */
      const receipt = page.getByTestId('quadrant-drop-undo');
      await receipt.hover();
      await page.waitForTimeout(9000);
      await expect(receipt, '手放在回执上、计时照样走完了（暂停通道在真浏览器里没接上）').toBeVisible();
      await page.mouse.move(4, 4);
      await expect(receipt, '挪开手之后剩余窗口不许被重置成整段，但也不许立刻消失').toBeVisible();
      if (width === 1280) {
        // 本线自己的一张取证图（回执**正开着**的那一帧）：上面那些断言量的是行为，
        // 这一帧给人看的是形状 —— 回执与那句成功文案同排、按钮在右、没有多出一条遮罩。
        await mkdir('../apps/web/evidence/undo-receipt', { recursive: true });
        await page.screenshot({ path: '../apps/web/evidence/undo-receipt/quadrant-receipt-1280.png' });
      }

      await page.getByTestId('quadrant-drop-undo-action').click();
      await expect(original.getByRole('combobox')).toBeVisible();
      // 🔴 撤销之后那句"已移动到 X"必须一起消失：它讲的是当前状态，而撤销之后已经不成立。
      //    这一条是被**看图**照出来的（收编回执时我把旧的 `.then(() => setDropNotice(''))`
      //    连着旧形状一起删了，末帧上那行假陈述留在屏幕上）—— 断言比截图先红，才是它该有的位置。
      await expect(page.getByTestId('quadrant-drop-status'), '撤销成功后仍留着一句已经不成立的"已移动到…"')
        .toHaveCount(0);
    }
    await page.screenshot({path:`../apps/web/evidence/settings-finish/quadrant-move-${width}.png`});
  });
}
