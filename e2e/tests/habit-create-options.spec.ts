/** 习惯页新增入口：页头「+」打开一次性配置面板，取消不写入。 */
import { expect, test } from '@playwright/test';

import { openApp, selectHabit, switchView } from './helpers';

const APP_ZH = '/?lang=zh-CN';

test('页头加号打开新增面板，配置创建后刷新仍可读回', async ({ page }) => {
  await openApp(page, APP_ZH);
  await switchView(page, '习惯');
  const name = `新建配置-${Date.now().toString().slice(-6)}`;

  await page.getByTestId('habits-add-open').click();
  const dialog = page.getByTestId('habit-create-dialog');
  await expect(dialog).toBeVisible();
  // 🔴 图标是**收起**的（滴答的形状）：先点头像才出现那一排。
  //    这一行此前写的是「爱心」立即 `toHaveCount(1)` —— 那等于把
  //    "24 枚图标常驻在表单中间"这个毛病钉成了不变量，谁折叠谁红。
  //    现在断言的是**顺序**：收起 → 点开 → 出现。
  await expect(dialog.getByRole('button', { name: '爱心', exact: true })).toHaveCount(0);
  await dialog.getByTestId('habit-create-icon-toggle').click();
  await expect(dialog.getByRole('button', { name: '爱心', exact: true })).toHaveCount(1);
  await dialog.getByRole('button', { name: '爱心', exact: true }).click();
  await dialog.getByLabel('数值', { exact: true }).fill('8');
  await dialog.getByLabel('单位', { exact: true }).fill('杯');
  // 按**可访问名**选，不按 `select` 的下标：下标那种写法把"第几个"当成了契约，
  // 而这排字段的先后正是本次要动的东西。
  await dialog.getByLabel('达成方式', { exact: true }).selectOption('exactly');
  await dialog.getByLabel('频次', { exact: true }).selectOption('weekly');
  const weekdays = dialog.getByRole('group', { name: '每周挑几天', exact: true });
  for (const day of ['一', '二', '三', '四', '五', '六', '日']) {
    const button = weekdays.getByRole('button', { name: day, exact: true });
    const shouldBeOn = day === '一' || day === '五';
    if ((await button.getAttribute('aria-pressed')) !== String(shouldBeOn)) await button.click();
  }
  await dialog.getByLabel('新习惯名称', { exact: true }).fill(name);
  await dialog.getByRole('button', { name: '添加习惯', exact: true }).click();

  const row = page.locator('[data-testid^="habit-row-"]').filter({ hasText: name }).first();
  await expect(row).toBeVisible();
  const id = (await row.getAttribute('data-testid') ?? '').replace(/^habit-row-/, '');
  await selectHabit(page, name);
  await expect(page.getByTestId(`habit-goal-summary-${id}`)).toContainText('恰好 8杯');
  await expect(page.getByTestId(`habit-freq-summary-${id}`)).toContainText('每周 一、五');

  await page.reload();
  await switchView(page, '习惯');
  await selectHabit(page, name);
  await expect(page.getByTestId(`habit-goal-summary-${id}`)).toContainText('恰好 8杯');
});

test('取消新增不产生习惯，草稿也不进入页面', async ({ page }) => {
  await openApp(page, APP_ZH);
  await switchView(page, '习惯');
  const name = `取消新增-${Date.now().toString().slice(-6)}`;
  await page.getByTestId('habits-add-open').click();
  const dialog = page.getByTestId('habit-create-dialog');
  await dialog.getByLabel('新习惯名称', { exact: true }).fill(name);
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('[data-testid^="habit-row-"]').filter({ hasText: name })).toHaveCount(0);
});

test('atMost 目标为 0 仍可通过新增面板创建', async ({ page }) => {
  await openApp(page, APP_ZH);
  await switchView(page, '习惯');
  const name = `零目标-${Date.now().toString().slice(-6)}`;
  await page.getByTestId('habits-add-open').click();
  const dialog = page.getByTestId('habit-create-dialog');
  await dialog.getByLabel('新习惯名称', { exact: true }).fill(name);
  await dialog.getByLabel('数值', { exact: true }).fill('0');
  await dialog.getByLabel('达成方式', { exact: true }).selectOption('atMost');
  await dialog.getByRole('button', { name: '添加习惯', exact: true }).click();
  await expect(page.locator('[data-testid^="habit-row-"]').filter({ hasText: name })).toBeVisible();
});

test('空白名称保持禁用，不新增习惯', async ({ page }) => {
  await openApp(page, APP_ZH);
  await switchView(page, '习惯');
  await page.getByTestId('habits-add-open').click();
  const dialog = page.getByTestId('habit-create-dialog');
  await dialog.getByLabel('新习惯名称', { exact: true }).fill('   ');
  await expect(dialog.getByRole('button', { name: '添加习惯', exact: true })).toBeDisabled();
  await expect(page.locator('[data-testid^="habit-row-"]')).toHaveCount(0);
});

test('习惯更多操作可导出真实打卡记录', async ({ page }) => {
  await openApp(page, APP_ZH);
  await switchView(page, '习惯');
  // 「更多设置」不再作为常驻新建区出现；新建只从页头加号进入。
  await expect(page.getByText('更多设置', { exact: true })).toHaveCount(0);
  const name = `导出验证-${Date.now().toString().slice(-6)}`;
  await page.getByTestId('habits-add-open').click();
  const dialog = page.getByTestId('habit-create-dialog');
  await dialog.getByLabel('新习惯名称', { exact: true }).fill(name);
  await dialog.getByRole('button', { name: '添加习惯', exact: true }).click();
  const row = page.locator('[data-testid^="habit-row-"]').filter({ hasText: name }).first();
  await expect(row).toBeVisible();
  const id = (await row.getAttribute('data-testid') ?? '').replace('habit-row-', '');
  await row.click();
  await expect(page.getByTestId(`habit-card-${id}`)).toBeVisible();
  await page.getByTestId(`habit-checkin-${id}`).click();
  await page.getByTestId('habits-more').click();
  await expect(page.getByTestId('habits-menu')).toBeVisible();
  const download = page.waitForEvent('download');
  await page.getByRole('menuitem', { name: '导出打卡记录', exact: true }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/^heyta-habits-\d{4}-\d{2}-\d{2}\.csv$/);
  const stream = await file.createReadStream();
  expect(stream).toBeTruthy();
  let csv = '';
  if (stream !== null) {
    for await (const chunk of stream) csv += chunk.toString();
  }
  expect(csv).toContain(name);
});
