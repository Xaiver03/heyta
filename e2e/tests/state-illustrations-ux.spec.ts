import { mkdir, writeFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { openApp, switchView, switchTheme, parkCursor, waitForOverlaySettled } from './helpers';

test('空态场景在亮暗窄屏与减少动态效果下保留文案和操作', async ({ page }) => {
  test.setTimeout(180_000);
  const out = '../apps/web/evidence/state-illustrations';
  await mkdir(out, { recursive: true });
  const pageErrors: string[] = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await openApp(page);
  const records = [];
  for (const theme of ['light', 'dark'] as const) {
    if (theme === 'dark') await switchTheme(page, theme);
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
      await page.emulateMedia({ reducedMotion: width === 390 ? 'reduce' : 'no-preference' });
      for (const [view, id] of [['任务', 'tasks'], ['习惯', 'habits'], ['便签', 'notes'], ['倒数纪念日', 'calendar'], ['搜索', 'search']] as const) {
        await switchView(page, view);
        if (id === 'search') {
          await waitForOverlaySettled(page, 'search-overlay-surface');
          await waitForOverlaySettled(page, 'search-panel');
          await page.getByTestId('search-panel-input').fill('没有匹配的任务');
        }
        const scene = page.locator('[data-testid^="state-illustration-"], [data-testid$="-illustration"]').first();
        await expect(scene).toBeVisible();
        await expect(scene).toHaveAttribute('aria-hidden', 'true');
        const artwork = page.getByTestId(`state-artwork-${id}`);
        await expect(artwork).toBeVisible();
        await expect.poll(() => artwork.evaluate(el => {
          const img = el instanceof HTMLImageElement ? el : el.querySelector('img');
          return img !== null && img.complete && img.naturalWidth > 0;
        })).toBe(true);

        await expect.poll(() => scene.evaluate(el => Number(getComputedStyle(el).opacity))).toBe(1);
        const box = await scene.boundingBox();
        expect(box?.width).toBeLessThanOrEqual(100);
        expect(box?.height).toBeLessThanOrEqual(100);
        await parkCursor(page);
        await page.screenshot({ path: `${out}/${id}-${width}-${theme}.png` });
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
        expect(overflow).toBe(false);
        records.push({ id, theme, width, reducedMotion: width === 390, box, overflow });
        if (id === 'search') {
          await page.keyboard.press('Escape');
          await expect(page.getByTestId('search-panel')).toBeHidden();
        }
      }
    }
  }
  await writeFile(`${out}/readout.json`, JSON.stringify(records, null, 2));
  expect(pageErrors).toEqual([]);
});
