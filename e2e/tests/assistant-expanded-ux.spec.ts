import { mkdir } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { closeSettingsSheet, openApp, openSettingsSheet, selectSettingsSection, switchTheme, waitForBootSplashGone } from './helpers';

const evidence = '../apps/web/evidence/ux-final';

test('Agent workspace expands from the rail and returns without losing the draft', async ({ page }) => {
  await mkdir(evidence, { recursive: true });
  await page.setViewportSize({ width: 1440, height: 900 });
  await openApp(page, '/?lang=zh-CN');

  for (const theme of ['light', 'dark'] as const) {
    if (theme === 'dark') await switchTheme(page, theme);

    for (const viewport of [
      { width: 1440, height: 900 },
      { width: 1280, height: 640 },
      { width: 390, height: 844 },
    ]) {
      await page.setViewportSize(viewport);
      await page.reload();
      await waitForBootSplashGone(page);
      await expect(page.getByTestId('rail-assistant')).toBeVisible();
      const input = page.getByTestId('ai-assistant-input');
      const compact = viewport.width < 1024;
      if (compact) {
        await page.getByTestId('assistant-open').click();
        await expect(input).toBeVisible();
      } else {
        await expect(input).toBeVisible();
      }
      await input.fill('保留这段草稿，展开后继续编辑');
      await page.mouse.move(viewport.width / 2, viewport.height / 2);
      await input.focus();
      await page.screenshot({
        path: `${evidence}/assistant-default-${viewport.width}-${viewport.height}-${theme}.png`,
        fullPage: false,
      });

      if (compact) {
        await page.getByTestId('ai-assistant-expand').click();
      } else {
        await page.getByTestId('rail-assistant').click();
      }
      await expect(page.locator('.ht-app[data-assistant-workspace]')).toHaveCount(1);
      await expect(page.locator('.ht-sidebar')).toBeHidden();
      await expect(page.locator('.ht-main')).toBeHidden();
      if (!compact) await expect(input).toHaveValue('保留这段草稿，展开后继续编辑');
      await expect(page.getByTestId('ai-assistant-expand')).toHaveAttribute('aria-label', '收起对话');
      await page.mouse.move(viewport.width / 2, viewport.height / 2);
      await input.focus();
      await page.screenshot({
        path: `${evidence}/assistant-expanded-${viewport.width}-${viewport.height}-${theme}.png`,
        fullPage: false,
      });

      await page.getByTestId('ai-assistant-expand').click();
      await expect(page.locator('.ht-app[data-assistant-workspace]')).toHaveCount(0);
      if (!compact) {
        await expect(input).toBeVisible();
        await expect(input).toHaveValue('保留这段草稿，展开后继续编辑');
      }
      await page.mouse.move(viewport.width / 2, viewport.height / 2);
      await page.screenshot({
        path: `${evidence}/assistant-collapsed-${viewport.width}-${viewport.height}-${theme}.png`,
        fullPage: false,
      });
    }

    await openSettingsSheet(page);
    await selectSettingsSection(page, 'appearance');
    await expect(page.getByTestId('settings-sheet')).toBeVisible();
    await closeSettingsSheet(page);
  }
});
