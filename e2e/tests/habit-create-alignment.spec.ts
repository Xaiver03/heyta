/**
 * 「添加习惯」对话框的对齐验收（2026-10-24）
 * ==========================================
 *
 * 这一族只做一件事：把**对齐滴答之后的形状**拍下来，并把三件容易退回旧形状的
 * 事实钉成断言（收起态 / 图标面板 / 间隔复习那一档）。测量数字的判据在
 * `habit-create-shape.spec.ts`，这里只负责"图拍得出来、且拍的是稳态"。
 *
 * 🔴 暗色走 `switchTheme()`（点产品自己那枚开关），不用 `emulateMedia`：
 *    应用一旦"用户显式选过"，就再也不看系统偏好 —— 那会让用例名字写着暗色、
 *    量的其实是亮色（本仓在 `calendar-cells` 与 `habit-month-stats` 各栽过一次）。
 */

import { expect, test, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';

import { openApp, switchTheme, switchView } from './helpers';

const APP_ZH = '/?lang=zh-CN';

const SHOT = (name: string) =>
  fileURLToPath(new URL(`../../apps/web/evidence/habit-create-alignment/${name}.png`, import.meta.url));

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console: ${m.text()}`);
  });
  page.on('pageerror', (e) => errors.push(`pageerror: ${String(e)}`));
  return errors;
}

async function openDialog(page: Page) {
  await switchView(page, '习惯');
  await page.getByTestId('habits-add-open').click();
  const dialog = page.getByTestId('habit-create-dialog');
  await expect(dialog).toBeVisible();
  // 名称先填一个真实的值：空占位符拍出来读不出"标签在哪"，也看不出行高。
  await dialog.getByLabel('新习惯名称', { exact: true }).fill('背 CPA 知识点');
  return dialog;
}

test.use({ viewport: { width: 1280, height: 1000 } });

test('收起态 / 图标面板 / 间隔复习三态：亮色', async ({ page }) => {
  const errors = watchErrors(page);
  await openApp(page, APP_ZH);
  const dialog = await openDialog(page);

  await page.screenshot({ path: SHOT('light-1280-collapsed'), fullPage: false });

  await dialog.getByTestId('habit-create-icon-toggle').click();
  await expect(dialog.locator('#ht-habit-create-icons')).toBeVisible();
  await page.screenshot({ path: SHOT('light-1280-icons'), fullPage: false });

  await dialog.getByTestId('habit-create-icon-toggle').click();
  await dialog.getByLabel('频次', { exact: true }).selectOption('spaced');
  await expect(dialog.getByRole('group', { name: '间隔复习', exact: true })).toBeVisible();
  await page.screenshot({ path: SHOT('light-1280-spaced'), fullPage: false });

  expect(errors, `界面控制台报错：\n${errors.join('\n')}`).toEqual([]);
});

test('窄屏：标签退回控件上方', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openApp(page, APP_ZH);
  await openDialog(page);
  await page.screenshot({ path: SHOT('light-390-collapsed'), fullPage: false });
});

test('暗色（走真开关）', async ({ page }) => {
  await openApp(page, APP_ZH);
  await switchTheme(page, 'dark');
  const dialog = await openDialog(page);
  await page.screenshot({ path: SHOT('dark-1280-collapsed'), fullPage: false });
  await dialog.getByTestId('habit-create-icon-toggle').click();
  await expect(dialog.locator('#ht-habit-create-icons')).toBeVisible();
  await page.screenshot({ path: SHOT('dark-1280-icons'), fullPage: false });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});
