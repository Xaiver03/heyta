import { mkdir } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { openApp, openSettingsSheet, selectSettingsSection, closeSettingsSheet, switchTheme } from './helpers';

const evidence = '../apps/web/evidence/ux-final';
test('Chatbot keeps a bottom composer and one persistent draft across compact layouts', async ({ page }) => {
  await mkdir(evidence, { recursive: true });
  await page.setViewportSize({ width: 1280, height: 800 });
  await openApp(page, '/?lang=zh-CN');
  const assistant = page.getByTestId('ai-assistant');
  const input = page.getByTestId('ai-assistant-input');
  const tier = page.getByTestId('ai-assistant-tier-select');
  await expect(assistant).toHaveCount(1);
  await expect(tier).toHaveValue('read-and-propose');
  await input.fill('整理明天的待办');
  for (const theme of ['light', 'dark'] as const) {
    if (theme === 'dark') await switchTheme(page, theme);
    for (const viewport of [{ width: 1280, height: 800 }, { width: 1078, height: 640 }, { width: 375, height: 720 }, { width: 900, height: 400 }]) {
      await page.setViewportSize(viewport);
      const compact = viewport.width < 1024 || viewport.height < 480;
      if (compact) await page.getByTestId('assistant-open').click();
      await expect(input).toBeVisible();
      await expect(input).toHaveValue('整理明天的待办');
      const pane = await page.getByTestId('detail-column').boundingBox();
      const composer = await page.locator('.ht-ai__composer').boundingBox();
      expect(pane).not.toBeNull(); expect(composer).not.toBeNull();
      expect(pane!.y + pane!.height - composer!.y - composer!.height).toBeLessThan(70);
      expect(composer!.y + composer!.height).toBeLessThan(viewport.height);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
      const suggestion = await page.locator('.ht-ai__suggestion').first().boundingBox();
      expect(suggestion!.height).toBeLessThanOrEqual(48);
      await page.screenshot({ path: `${evidence}/assistant-${viewport.width}-${viewport.height}-${theme}.png` });
      if (compact) {
        await page.keyboard.press('Escape');
        await expect(page.getByTestId('assistant-open')).toBeFocused();
        await expect(assistant).not.toBeVisible();
      }
    }
    await page.setViewportSize({width:1280,height:800});
  }
  await tier.selectOption('read-only');
  await page.reload();
  await expect(tier).toHaveValue('read-only');
});

test('Signed-out sync and Profile have a login path, advanced connection stays collapsed', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await openApp(page, '/?lang=zh-CN');
  await openSettingsSheet(page);
  await selectSettingsSection(page, 'sync');
  await expect(page.getByTestId('sync-signin-required-action')).toBeVisible();
  await expect(page.getByTestId('sync-server-url')).not.toBeVisible();
  await page.screenshot({ path: `${evidence}/sync-default.png` });
  await page.getByTestId('sync-advanced').locator('summary').click();
  await expect(page.getByTestId('sync-server-url')).toBeVisible();
  await selectSettingsSection(page, 'profile');
  await expect(page.getByTestId('profile-signin-required-action')).toBeVisible();
  await expect(page.getByTestId('profile-nickname-input')).toHaveCount(0);
  await page.screenshot({ path: `${evidence}/profile-signed-out.png` });
  await closeSettingsSheet(page);
  await page.getByTestId('sync-rail-action').click();
  await expect(page.getByTestId('auth-form')).toBeVisible();
  await expect(page.getByText(/https:\/\/heyta\.waytofuture\.cn/)).toBeVisible();
  await expect(page.getByText('还没配置同步服务', { exact: true })).toHaveCount(0);
});
