import { mkdir, writeFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { addTask, openApp, switchView, switchTheme, parkCursor, waitForOverlaySettled } from './helpers';

test('逐页视觉审查取证：主操作、内容边界与空状态', async ({ page }) => {
  test.setTimeout(300_000);
  const out = '../apps/web/evidence/page-taste-review';
  await mkdir(out, { recursive: true });
  await openApp(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await addTask(page, '准备项目复盘');
  await addTask(page, '整理下一阶段的阅读计划');
  const pages = [['tasks', '任务'], ['habits', '习惯'], ['timeline', '时间线'], ['notes', '便签'], ['countdown', '倒数纪念日'], ['search', '搜索'], ['trash', '回收站'], ['quadrant', '四象限']] as const;
  const records = [];
  for (const theme of ['light', 'dark'] as const) {
  if (theme === 'dark') await switchTheme(page, theme);
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    for (const [id, title] of pages) {
      await switchView(page, title);
      await parkCursor(page);
      if (id === 'search') {
        await waitForOverlaySettled(page, 'search-overlay-surface');
        await waitForOverlaySettled(page, 'search-panel');
      }
      if (id === 'timeline') {
        const ticks = page.locator('[data-testid^="timeline-tick-"]');
        await expect.poll(() => ticks.count()).toBeGreaterThan(1);
        const boxes = await ticks.evaluateAll((nodes) => nodes.map((node) => {
          const { left, right } = node.getBoundingClientRect();
          return { left, right };
        }));
        for (let index = 1; index < boxes.length; index += 1) {
          expect(boxes[index]!.left).toBeGreaterThanOrEqual(boxes[index - 1]!.right - 1);
        }
      }
      const main = page.locator('.ht-main');
      await expect(main).toBeVisible();
      await page.screenshot({ path: `${out}/${id}-${width}-${theme}.png` });
      records.push({ id, width, theme, overflow: await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), headings: await main.getByRole('heading').allTextContents() });
    }
  }
  }
  await writeFile(`${out}/readout.json`, JSON.stringify(records, null, 2));
  expect(records.filter((row) => row.overflow)).toEqual([]);
});
