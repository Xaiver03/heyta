/**
 * 英文全站视觉 + 文本取证（临时审计用，非产品门禁）。
 * 顺序：rail 视图 → 回收站 → 任务填充/详情 → 头像菜单 → 设置 7 分类 → AI 面板 → 暗色。
 * 每步隔离 + 短超时：一步失败不影响其余，也不会因为浮层遮住输入框而卡死。
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

import { decidePrivacyConsent, enableAllModules } from './helpers';
import { installMissingProducerShims } from './shims';

const OUT = 'en-audit';
const LOG: string[] = [];
const logline = (s: string) => {
  LOG.push(s);
  writeFileSync(`${OUT}/debug.log`, LOG.join('\n'));
};
const slug = (s: string) =>
  (s || 'unknown').trim().toLowerCase().replace(/[^\w\u4e00-\u9fff]+/g, '-').replace(/^-+|-+$/g, '') || 'unknown';

async function shot(page: Page, tag: string): Promise<void> {
  mkdirSync(`${OUT}/text`, { recursive: true });
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${OUT}/${tag}.png` }).catch(() => {});
  const txt = await page.evaluate(() => {
    const main = document.querySelector('main');
    return (main ? main.innerText : document.body.innerText) || '';
  });
  writeFileSync(`${OUT}/text/${tag}.txt`, txt);
}
const esc = (page: Page) => page.keyboard.press('Escape').catch(() => {});

async function goView(page: Page, name: string): Promise<string> {
  await esc(page);
  const rail = page.getByRole('tablist').first();
  try {
    await rail.getByRole('tab', { name, exact: true }).first().click({ timeout: 4_000 });
    return 'rail';
  } catch {}
  const more = page.getByRole('button', { name: /^(More|更多)$/ }).first();
  if (await more.isVisible().catch(() => false)) {
    await more.click({ force: true }).catch(() => {});
    try {
      await page.getByRole('menuitem', { name, exact: true }).first().click({ force: true, timeout: 5_000 });
      return 'more';
    } catch {
      await esc(page);
    }
  }
  return 'FAIL';
}

test('english full-surface visual audit', async ({ page }) => {
  test.setTimeout(600_000);
  mkdirSync(`${OUT}/text`, { recursive: true });

  await enableAllModules(page);
  await page.addInitScript(() => {
    window.localStorage.setItem('heyta.locale', 'en');
    window.localStorage.setItem('heyta.theme', 'light');
  });
  await installMissingProducerShims(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/?lang=en', { waitUntil: 'domcontentloaded' });
  await decidePrivacyConsent(page, 'local-only');
  await expect(page.getByTestId('rail-help')).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(400);

  // 1) 所有视图
  for (const name of ['Tasks','Calendar','Quadrants','Habits','Timeline','Focus timer','Growth','Sticky notes','Countdowns','Board','Search']) {
    const how = await goView(page, name);
    logline(`view ${name}: ${how}`);
    await shot(page, `view-${slug(name)}`);
  }

  // 2) 回收站
  try {
    await esc(page);
    for (const c of [
      page.locator('.ht-sidebar').getByText(/Trash/),
      page.getByRole('button', { name: /^Trash$/ }),
      page.getByText(/^Trash$/),
    ]) {
      if ((await c.count().catch(() => 0)) > 0) {
        await c.first().click({ force: true, timeout: 4_000 }).catch(() => {});
        await shot(page, 'view-trash');
        logline('trash: clicked');
        break;
      }
    }
  } catch (e) { logline(`trash error: ${String(e).slice(0,120)}`); }

  // 3) 任务填充 + 详情（回到全新 Tasks，避免浮层遮挡）
  try {
    await page.goto('/?lang=en', { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('rail-help')).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(300);
    const input = page.getByPlaceholder(/^Add a task/).first();
    await input.click({ timeout: 8_000 });
    for (const t of ['Email the client tomorrow at 3pm','Submit the weekly report next Wednesday','Buy milk @grocery #errand']) {
      await input.fill(t); await input.press('Enter'); await page.waitForTimeout(120);
    }
    await shot(page, 'tasks-populated');
    await page.getByText('Email the client', { exact: false }).first().click({ timeout: 6_000 }).catch(() => {});
    await shot(page, 'task-detail');
    await esc(page);
  } catch (e) { logline(`tasks error: ${String(e).slice(0,160)}`); writeFileSync(`${OUT}/text/tasks-populated.ERROR.txt`, String(e)); }

  // 4) 头像菜单
  try {
    await esc(page);
    await page.getByTestId('account-menu-avatar').click({ force: true, timeout: 6_000 });
    await shot(page, 'account-menu');
    await esc(page);
  } catch (e) { logline(`account error: ${String(e).slice(0,120)}`); }

  // 5) 设置 7 分类
  try {
    await page.getByTestId('account-menu-avatar').click({ force: true, timeout: 6_000 });
    await page.getByTestId('account-menu-settings').click({ timeout: 6_000 });
    await page.getByTestId('settings-sheet').waitFor({ state: 'visible', timeout: 10_000 });
    for (const s of ['profile','subscription','data','notifications','appearance','ai','help']) {
      const btn = page.locator(`button[aria-controls="settings-group-${s}"]`);
      if ((await btn.count()) === 0) continue;
      await btn.click({ force: true, timeout: 5_000 });
      await shot(page, `settings-${s}`);
    }
  } catch (e) { logline(`settings error: ${String(e).slice(0,160)}`); writeFileSync(`${OUT}/text/settings.ERROR.txt`, String(e)); }

  // 6) AI 助手面板（放最后；开完不再依赖任务输入框）
  try {
    await page.goto('/?lang=en', { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('rail-help')).toBeVisible({ timeout: 15_000 });
    await page.getByTestId('rail-assistant').click({ force: true, timeout: 6_000 });
    await shot(page, 'ai-assistant');
    logline('ai-assistant: clicked');
  } catch (e) { logline(`ai error: ${String(e).slice(0,120)}`); }

  // 7) 暗色
  try {
    await page.evaluate(() => window.localStorage.setItem('heyta.theme', 'dark'));
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('rail-help')).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(400);
    await shot(page, 'dark-home');
  } catch (e) { logline(`dark error: ${String(e).slice(0,120)}`); }
  logline('DONE');
});
