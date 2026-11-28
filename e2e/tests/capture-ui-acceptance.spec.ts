/**
 * 捕获 UI 截图验收（2026-11-22）—— S7 时间段 / S6 重复 / S6 提醒 / ③ 标签
 * ==========================================================================
 *
 * 🔴 证据**只写本单私有目录** `apps/web/evidence/capture-ui-acceptance-20261122/`，
 *    绝不碰别线已入库的 `capture-due-capsule-20261104/`（那是另一条线的账）。
 *
 * 目的：这几块 UI（range/repeat/reminder/tags 都是面板内的 chip/子视图）只有
 * 非视觉门禁（check:capture-shape / jsdom）覆盖，缺一张真浏览器截图。这里补上：
 * 打一句带日期的话 → 点开日期面板 → 逐块点开/截屏。
 *
 * 只在应用真实宿主（apps/web 的 CaptureComposer，rangeEnabled/repeatEnabled/reminderEnabled 常开）上跑。
 */
import { expect, test, type Page } from '@playwright/test';

const SHOT = (name: string): string =>
  `../apps/web/evidence/capture-ui-acceptance-20261122/capture-ui-${name}.png`;

async function openApp(page: Page): Promise<void> {
  await page.goto('/?lang=zh-CN', { waitUntil: 'networkidle' });
  const later = page.getByRole('button', { name: /以后再说|Decide later/ });
  if (await later.count()) {
    await later.click();
    await page.waitForTimeout(400);
  }
  await page.waitForSelector('[data-testid="task-list"]', { timeout: 30_000 });
}

test('捕获面板四块 UI 真截图', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(String(e)));

  await openApp(page);

  // 收起首启示例（否则空的收集箱里会露出一枚「今天 整理桌面」示例 chip，被浮层盖半截，误导验收图）
  const dismiss = page.getByTestId('first-run-dismiss');
  if (await dismiss.count()) {
    await dismiss.click();
    await page.waitForTimeout(300);
  }

  const input = page.getByTestId('capture-input');
  await expect(input).toBeVisible();
  await input.fill('明天下午三点开会');
  await page.waitForTimeout(200);

  await page.getByTestId('capture-due-capsule').click();
  const panel = page.getByTestId('capture-due-popover');
  await expect(panel).toBeVisible();
  await page.waitForTimeout(250);

  // 「连续卡」几何断言：日期面板与输入卡等宽、左边对齐、顶边紧贴输入卡底边（≤2px）。
  const composeBox = await page.getByTestId('capture-compose').boundingBox();
  const panelBox = await panel.boundingBox();
  expect(composeBox, '输入卡应有几何').not.toBeNull();
  expect(panelBox, '日期面板应有几何').not.toBeNull();
  expect(Math.abs(panelBox!.x - composeBox!.x), '左边缘对齐（连续卡）').toBeLessThanOrEqual(1);
  expect(Math.abs(panelBox!.width - composeBox!.width), '与输入卡等宽（连续卡）').toBeLessThanOrEqual(1);
  expect(Math.abs(panelBox!.y - (composeBox!.y + composeBox!.height)), '顶边紧贴输入卡底边').toBeLessThanOrEqual(2);

  await page.screenshot({ path: SHOT('1-panel-date') });

  // 时间段：进子视图 → 选时长 → 截图 → 返回
  const rangeRow = panel.getByTestId('capture-range-row');
  if (await rangeRow.count()) {
    await page.screenshot({ path: SHOT('2-range-entry') });
    await rangeRow.click();
    await page.waitForTimeout(250);
    await page.screenshot({ path: SHOT('3-range-view') });
    const d60 = panel.getByTestId('capture-range-duration-60');
    if (await d60.count()) {
      await d60.click();
      await page.waitForTimeout(150);
      await page.screenshot({ path: SHOT('4-range-picked') });
    }
    const back = panel.getByTestId('capture-range-back');
    if (await back.count()) {
      await back.click();
      await page.waitForTimeout(150);
    }
  }

  // 重复：点「每周」
  const weekly = panel.getByTestId('capture-repeat-weekly');
  if (await weekly.count()) {
    await weekly.click();
    await page.waitForTimeout(150);
    await page.screenshot({ path: SHOT('5-repeat-picked') });
  }

  // 提醒：点「提前30分钟」
  const rem = panel.getByTestId('capture-reminder-1800000');
  if (await rem.count()) {
    await rem.click();
    await page.waitForTimeout(150);
    await page.screenshot({ path: SHOT('6-reminder-picked') });
  }

  // 标签：宿主需已有标签才出现该行（空库不出现，如实记录）
  const tagRow = panel.getByTestId('capture-tags-row');
  if (await tagRow.count()) {
    await page.screenshot({ path: SHOT('7-tags') });
  }

  await page.screenshot({ path: SHOT('8-panel-final') });
  expect(errors, '控制台/页面不应报错').toEqual([]);
});
