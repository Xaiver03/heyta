/**
 * 英文取证补拍：任务填充 / 头像菜单 / 设置 7 分类 / 暗色。
 * 全新起页，不在中途 goto（避开上一支脚本里 goto 后 rail 未就绪的时序问题）。
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

import { decidePrivacyConsent, enableAllModules } from './helpers';
import { installMissingProducerShims } from './shims';

const OUT = 'en-audit';
async function shot(page: Page, tag: string) {
  mkdirSync(`${OUT}/text`, { recursive: true });
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${OUT}/${tag}.png` }).catch(() => {});
  const txt = await page.evaluate(() => (document.querySelector('main')?.innerText ?? document.body.innerText) || '');
  writeFileSync(`${OUT}/text/${tag}.txt`, txt);
}

test('english panels audit', async ({ page }) => {
  test.setTimeout(300_000);
  await enableAllModules(page);
  await page.addInitScript(() => {
    window.localStorage.setItem('heyta.locale', 'en');
    window.localStorage.setItem('heyta.theme', 'light');
  });
  await installMissingProducerShims(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/?lang=en', { waitUntil: 'domcontentloaded' });
  await decidePrivacyConsent(page, 'local-only');
  await expect(page.getByTestId('rail-help')).toBeVisible({ timeout: 25_000 });
  await page.waitForTimeout(400);

  // 任务填充 + 详情（默认即 Tasks）
  try {
    const input = page.getByPlaceholder(/^Add a task/).first();
    await input.click({ timeout: 10_000 });
    for (const t of ['Email the client tomorrow at 3pm', 'Submit the weekly report next Wednesday', 'Buy milk @grocery #errand']) {
      await input.fill(t);
      await input.press('Enter');
      await page.waitForTimeout(150);
    }
    await shot(page, 'tasks-populated');
    await page.getByText('Email the client', { exact: false }).first().click({ timeout: 6_000 }).catch(() => {});
    await shot(page, 'task-detail');
    await page.keyboard.press('Escape').catch(() => {});
  } catch (e) {
    writeFileSync(`${OUT}/text/tasks-populated.ERROR.txt`, String(e));
  }

  // 头像菜单
  try {
    await page.keyboard.press('Escape').catch(() => {});
    await page.getByTestId('account-menu-avatar').click({ force: true, timeout: 8_000 });
    await shot(page, 'account-menu');
    await page.keyboard.press('Escape').catch(() => {});
  } catch (e) {
    writeFileSync(`${OUT}/text/account-menu.ERROR.txt`, String(e));
  }

  // 设置 7 分类
  try {
    await page.getByTestId('account-menu-avatar').click({ force: true, timeout: 8_000 });
    await page.getByTestId('account-menu-settings').click({ timeout: 8_000 });
    await page.getByTestId('settings-sheet').waitFor({ state: 'visible', timeout: 10_000 });
    for (const s of ['profile', 'subscription', 'data', 'notifications', 'appearance', 'ai', 'help']) {
      const btn = page.locator(`button[aria-controls="settings-group-${s}"]`);
      if ((await btn.count()) === 0) continue;
      await btn.click({ force: true, timeout: 5_000 });
      await shot(page, `settings-${s}`);
    }
  } catch (e) {
    writeFileSync(`${OUT}/text/settings.ERROR.txt`, String(e));
  }
});
