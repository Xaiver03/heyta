import { expect, test, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { openApp, switchView } from './helpers';

/**
 * 四象限的**移动 UX**。
 *
 * 🔴 2026-11-24：**没有「移动」下拉框、也没有拖拽握把按钮** —— 移动完全靠
 * 拖整行（产品负责人：「不要搞什么按钮，直接做拖拽 UX」）。所以本条从
 * "选下拉框"改成了"真的用鼠标拖行"：PointerSensor 距离阈值 6px，
 * 点一下仍是点击、拖动才起拖。
 *
 * 命题不变：**拖到另一格之后必须还能撤销，撤完回到原来那一格**；
 * 撤销按钮仍住在共享 `UndoReceipt` 里（动作是 `quadrant-drop-undo-action`，
 * 容器是 `quadrant-drop-undo`）。
 */

/** 把某一行拖到某一格的中心（走真实鼠标轨迹，喂给 PointerSensor）。 */
async function dragRowToCell(page: Page, sourceCell: string, targetCell: string): Promise<void> {
  const row = page.getByTestId(sourceCell).locator('[data-testid^="quadrant-row-"]').first();
  await row.scrollIntoViewIfNeeded();
  const from = await row.boundingBox();
  const to = await page.getByTestId(targetCell).boundingBox();
  expect(from, `${sourceCell} 里没有可拖的行`).not.toBeNull();
  expect(to, `${targetCell} 量不到框`).not.toBeNull();
  const sx = from!.x + from!.width / 2;
  const sy = from!.y + from!.height / 2;
  const tx = to!.x + to!.width / 2;
  const ty = to!.y + to!.height / 2;
  await page.mouse.move(sx, sy);
  await page.mouse.down();
  // 先越过 6px 激活阈值，再移到目标（多步让 dnd-kit 收到连续的 pointermove）。
  await page.mouse.move(sx, sy + 12, { steps: 4 });
  await page.mouse.move(tx, ty, { steps: 20 });
  await page.mouse.up();
}

test('四象限：整行拖拽到别的格，并能撤销回来（1280 / 双列）', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await openApp(page, '/?lang=zh-CN');
  const input = page.locator('input[placeholder^="添加任务"]');
  await input.fill('用整行拖拽安排任务');
  await input.press('Enter');
  await switchView(page, '四象限');
  const original = page.getByTestId('quadrant-cell-4');
  await expect(original.locator('[data-testid^="quadrant-row-"]').first()).toBeVisible();

  for (const destination of ['1', '2', '3']) {
    await dragRowToCell(page, 'quadrant-cell-4', `quadrant-cell-${destination}`);
    await expect(
      page.getByTestId(`quadrant-cell-${destination}`).locator('[data-testid^="quadrant-row-"]').first(),
      `拖到第 ${destination} 格后，那里没有这条任务`,
    ).toBeVisible();
    await expect(page.getByTestId('quadrant-drop-status')).toBeVisible();

    const receipt = page.getByTestId('quadrant-drop-undo');
    /*
     * 回执**住在板子那一段里**，不在页底：回执要排在板子之后、折叠帮助之前。
     * 这两条量的是"出口离动作不远"，不是像素距离。
     */
    const boardBox = await page.getByTestId('quadrant-board').boundingBox();
    const receiptBox = await receipt.boundingBox();
    const helpBox = await page.getByTestId('quadrant-help').boundingBox();
    expect(boardBox, '板子量不到框（这一条就空转了）').not.toBeNull();
    expect(receiptBox, '回执量不到框').not.toBeNull();
    expect(helpBox, '折叠帮助量不到框').not.toBeNull();
    expect(receiptBox!.y, '回执排在折叠帮助之后 ⇒ 刚做完动作时出口在页底').toBeLessThan(helpBox!.y);
    expect(
      await page.evaluate(() => {
        const board = document.querySelector('[data-testid="quadrant-board"]');
        const help = document.querySelector('[data-testid="quadrant-help"]');
        const node = document.querySelector('[data-testid="quadrant-drop-undo"]');
        if (board === null || help === null || node === null) return '缺节点';
        const after = (a: Element, b: Element): boolean =>
          (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
        return after(board, node) && after(node, help) ? '板子→回执→帮助' : `顺序不对:${node.compareDocumentPosition(help)}`;
      }),
      '回执没排在板子之后、帮助之前 ⇒ 它说的是板上那次变更，出口却跑到页底了',
    ).toBe('板子→回执→帮助');

    // 手放在回执上停 9 秒（窗口 8000ms）—— 暂停通道必须在真浏览器里接得住。
    await receipt.hover();
    await page.waitForTimeout(9000);
    await expect(receipt, '手放在回执上、计时照样走完了（暂停通道在真浏览器里没接上）').toBeVisible();
    await page.mouse.move(4, 4);
    await expect(receipt, '挪开手之后剩余窗口不许被重置成整段，但也不许立刻消失').toBeVisible();
    await mkdir('../apps/web/evidence/undo-receipt', { recursive: true });
    await page.screenshot({ path: '../apps/web/evidence/undo-receipt/quadrant-receipt-1280.png' });

    await page.getByTestId('quadrant-drop-undo-action').click();
    await expect(original.locator('[data-testid^="quadrant-row-"]').first(), '撤销后没有回到原来那一格').toBeVisible();
    // 撤销之后那句"已移动到 X"必须一起消失（它讲的是当前状态）。
    await expect(page.getByTestId('quadrant-drop-status'), '撤销成功后仍留着一句已经不成立的"已移动到…"').toHaveCount(0);
  }
  await mkdir('../apps/web/evidence/settings-finish', { recursive: true });
  await page.screenshot({ path: '../apps/web/evidence/settings-finish/quadrant-move-1280.png' });
});

test('四象限：行上不再有任何移动/拖拽按钮（375 / 单列）', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await openApp(page, '/?lang=zh-CN');
  const input = page.locator('input[placeholder^="添加任务"]');
  await input.fill('单列也不能有移动按钮');
  await input.press('Enter');
  await switchView(page, '四象限');
  const cell = page.getByTestId('quadrant-cell-4');
  await expect(cell.locator('[data-testid^="quadrant-row-"]').first()).toBeVisible();
  await expect(cell.getByRole('combobox'), '不该再有「移动」下拉框').toHaveCount(0);
  await expect(page.locator('[data-testid^="quadrant-drag-"]'), '不该再有拖拽握把按钮').toHaveCount(0);
  await page.screenshot({ path: '../apps/web/evidence/settings-finish/quadrant-move-375.png' });
});
