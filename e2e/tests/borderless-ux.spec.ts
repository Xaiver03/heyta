import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { openApp, switchTheme, switchView } from './helpers';

const out = fileURLToPath(new URL('../../apps/web/evidence/borderless-ux', import.meta.url));

test('无描边搜索、键盘结果导航与连续月历在深浅和窄屏可用', async ({ page }) => {
  test.setTimeout(180_000);
  await mkdir(out, { recursive: true });
  await openApp(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.getByTestId('capture-input').fill('今天 复盘项目');
  await page.getByTestId('capture-input').press('Enter');
  await expect(page.getByRole('checkbox', { name: '完成：复盘项目', exact: true })).toBeVisible();
  const readout = [];
  for (const theme of ['light', 'dark'] as const) {
    if (await page.locator('html').getAttribute('data-theme') !== theme) await switchTheme(page, theme);
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
      await switchView(page, '搜索');
      const input = page.getByTestId('search-panel-input');
      await expect(input).toBeFocused();
      await input.fill('复盘');
      await expect(page.getByTestId('search-panel-results')).toContainText('复盘项目');
      const appearance = await input.evaluate(el => {
        const s = getComputedStyle(el);
        return { outline: s.outlineWidth, border: s.borderTopWidth, borderColor: s.borderTopColor, shadow: s.boxShadow, caret: s.caretColor };
      });
      expect(appearance.outline).toBe('0px');
      expect(appearance.shadow).toBe('none');
      expect(appearance.border === '0px' || appearance.borderColor === 'rgba(0, 0, 0, 0)').toBe(true);
      await input.press('ArrowDown');
      await page.screenshot({ path: `${out}/search-${width}-${theme}.png` });
      await input.press('Escape');
      await expect(input).toHaveCount(0);
      await switchView(page, '日历');
      await expect(page.getByTestId('detail-pane-toggle')).toHaveCount(0);
      const toggle = page.getByTestId('calendar-sidebar-toggle');
      if (await toggle.isVisible()) {
        const box = await toggle.boundingBox();
        expect(box!.width).toBeLessThanOrEqual(48);
      }
      const cells = page.locator('[data-testid^="calendar-cell-"][role="button"]');
      const rects = await cells.evaluateAll(nodes => nodes.map(n => {
        const r = n.getBoundingClientRect();
        return { x:r.x, y:r.y, right:r.right, bottom:r.bottom };
      }));
      expect(rects.length).toBeGreaterThanOrEqual(28);
      for(let i=1;i<rects.length;i++) {
        const a=rects[i-1]!, b=rects[i]!;
        if(Math.abs(a.y-b.y)<1) expect(Math.abs(b.x-a.right)).toBeLessThan(1);
        else expect(Math.abs(b.y-a.bottom)).toBeLessThan(1);
      }
      await page.screenshot({ path: `${out}/calendar-${width}-${theme}.png` });
      const overflow = await page.evaluate(()=>document.documentElement.scrollWidth > innerWidth+1);
      expect(overflow).toBe(false);
      readout.push({theme,width,appearance,calendarCells:rects.length,overflow});
    }
  }
  await writeFile(`${out}/readout.json`, JSON.stringify(readout,null,2));
});
