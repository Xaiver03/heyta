import { mkdir } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { openApp, openSettingsSheet, selectSettingsSection, closeSettingsSheet, switchTheme } from './helpers';

const evidence = '../apps/web/evidence/goal-settings-final';
test('Chatbot keeps an unclipped empty prompt, a bottom conversation composer and one persistent draft', async ({ page }) => {
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
      // 空会话将问候、输入和建议组合居中；已有消息后才固定输入区到底部。
      expect(composer!.y).toBeGreaterThan(pane!.y);
      expect(composer!.y + composer!.height).toBeLessThan(pane!.y + pane!.height);
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
  // 用真实本地规则生成会话，不配置或调用外部模型。
  await input.fill('今天有什么任务');
  await page.getByTestId('ai-assistant-send-button').click();
  await expect(page.getByTestId('ai-chat-assistant')).toBeVisible();
  await expect(page.getByTestId('ai-assistant-disclosure')).toHaveCount(0);
  for (let turn = 0; turn < 8; turn += 1) {
    await input.fill('今天有什么任务');
    await page.getByTestId('ai-assistant-send-button').click();
    await expect(page.getByTestId('ai-chat-assistant')).toHaveCount(turn + 2);
  }
  await input.fill('继续编辑这段草稿');
  for (const theme of ['light', 'dark'] as const) {
    await switchTheme(page, theme);
    for (const viewport of [{ width: 1280, height: 800 }, { width: 1078, height: 640 }, { width: 375, height: 720 }, { width: 900, height: 400 }]) {
      await page.setViewportSize(viewport);
      const compact = viewport.width < 1024 || viewport.height < 480;
      if (compact) await page.getByTestId('assistant-open').click();
      await expect(input).toBeVisible();
      await expect(input).toHaveValue('继续编辑这段草稿');
      const pane = await page.getByTestId('detail-column').boundingBox();
      const composer = await page.locator('.ht-ai__composer').boundingBox();
      expect(pane).not.toBeNull(); expect(composer).not.toBeNull();
      const body = page.locator('.ht-ai__chat-body');
      const bodyBox = await body.boundingBox();
      const bottomPadding = await body.evaluate(el => parseFloat(getComputedStyle(el).paddingBottom));
      expect(bodyBox).not.toBeNull();
      expect(Math.abs(bodyBox!.y + bodyBox!.height - composer!.y - composer!.height - bottomPadding)).toBeLessThanOrEqual(1);
      const footer = await page.locator('.ht-ai__footer').boundingBox();
      expect(footer!.y + footer!.height).toBeLessThanOrEqual(viewport.height);
      const transcript = page.getByTestId('ai-assistant-conversation');
      expect(await transcript.evaluate(el => el.scrollHeight > el.clientHeight)).toBe(true);
      await transcript.evaluate(el => { el.scrollTop = el.scrollHeight; });
      await expect(page.getByTestId('ai-chat-assistant').last()).toBeInViewport();
      expect(await page.locator('.ht-ai__composer').boundingBox()).toEqual(composer);
      expect(await page.locator('.ht-ai__footer').boundingBox()).toEqual(footer);
      expect(composer!.y + composer!.height).toBeLessThan(viewport.height);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
      await page.screenshot({ path: `${evidence}/conversation-${viewport.width}-${viewport.height}-${theme}.png` });
      if (compact) await page.keyboard.press('Escape');
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
  await expect(page.getByTestId('auth-form').locator('input[type="email"]')).toBeVisible();
  await expect(page.getByTestId('auth-form').locator('input[type="password"]')).toBeVisible();
  await expect(page.getByTestId('sync-server-url')).not.toBeVisible();
  await expect(page.getByText('还没配置同步服务', { exact: true })).toHaveCount(0);
});
