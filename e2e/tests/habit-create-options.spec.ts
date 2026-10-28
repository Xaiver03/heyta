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

/**
 * 「取消新增不产生习惯，草稿也不进入页面」—— 这一条的**目的没变**，变的是达成它的那一步。
 *
 * 2026-10-27 全局 UX 整改 P1 之前，这一条写的是"填了名称 → 点取消 → 面板直接没了"，
 * 也就是**它把静默丢弃当成了正确行为来钉**。P1 判定的正是这一格：草稿住本地 state，
 * 关掉就恢复不了 ⇒ 必须先问一句（`docs/plans/global-ux-system-remediation.md` §P1、
 * 关闭策略表 `packages/ui/src/overlay/dismissal.ts` 的 `modal-dirty-form`）。
 *
 * ⚠️ 这不是"为了让测试变绿而改测试"（AGENTS §6 第 3 条）：改之前它绿着钉的是旧契约，
 * 新契约由 `e2e/tests/dirty-form-guard.spec.ts` 那 6 条独立取证；这里补的是**同一件事在本用例里的后半段**
 * ——取消之后那条习惯仍然不许产生。所以"问一句"这一步是**走**过去，不是**跳过**。
 */
test('取消新增不产生习惯，草稿也不进入页面（脏草稿先问一句才丢）', async ({ page }) => {
  await openApp(page, APP_ZH);
  await switchView(page, '习惯');
  const name = `取消新增-${Date.now().toString().slice(-6)}`;
  await page.getByTestId('habits-add-open').click();
  const dialog = page.getByTestId('habit-create-dialog');
  await dialog.getByLabel('新习惯名称', { exact: true }).fill(name);
  await dialog.getByRole('button', { name: '取消', exact: true }).click();

  // 脏草稿的取消只触发确认，原表单与已填的值必须都还在。
  await expect(page.getByTestId('discard-confirm')).toBeVisible();
  await expect(dialog, '确认框出现时原面板不许先没掉').toBeVisible();
  await expect(dialog.getByLabel('新习惯名称', { exact: true })).toHaveValue(name);

  // 明确选"放弃修改"才真的关。
  await page.getByTestId('discard-confirm-confirm').click();
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
