/**
 * 已迁移填表界面的**视觉清点**（2026-10-24 起，随迁移逐步加成员）
 * ===============================================================
 *
 * 这一族只做两件事：**把已迁移的界面拍下来**，以及用共享判据
 * `assertFormRhythm(scope)` 量它们的行节奏。它**不**重复行为判据
 * （那些在各自的 spec 里），存在的理由是"人得看得见"——
 * `docs/agents/ui-acceptance.md` 规定一。
 *
 * 🔴 为什么单开一份而不是塞进各自的 spec：这些界面分属专注 / 习惯 / 设置
 * 三条互不相干的旅程，塞进去会让那三份 spec 各自多等一次与它无关的导航。
 */

import { expect, test, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';

import {
  assertFormRhythm,
  openApp,
  selectHabit,
  switchView,
} from './helpers';

const APP_ZH = '/?lang=zh-CN';

const SHOT = (name: string) =>
  fileURLToPath(new URL(`../../apps/web/evidence/form-alignment-sweep/${name}.png`, import.meta.url));

test.use({ viewport: { width: 1280, height: 900 } });

async function openFocusSettings(page: Page) {
  await switchView(page, '番茄钟');
  const toggle = page.getByTestId('focus-config-toggle');
  await expect(toggle).toBeVisible();
  await toggle.click();
  const block = page.getByTestId('focus-config');
  await expect(block).toBeVisible();
  return block;
}

test('番茄钟时长配置：四行 inline，控件一档高度', async ({ page }) => {
  await openApp(page, APP_ZH);
  const block = await openFocusSettings(page);
  await assertFormRhythm(block);
  await page.screenshot({ path: SHOT('focus-config-light'), fullPage: false });
});

test('习惯目标编辑器：数值 / 单位各占一行（窄面板里不并排），一档高度', async ({ page }) => {
  await openApp(page, APP_ZH);
  await switchView(page, '习惯');
  // 先建一条习惯（新建对话框本身也是已迁移界面之一）。
  await page.getByTestId('habits-add-open').click();
  const dialog = page.getByTestId('habit-create-dialog');
  await dialog.getByLabel('新习惯名称', { exact: true }).fill('对齐清点');
  await dialog.getByRole('button', { name: '添加习惯', exact: true }).click();
  await selectHabit(page, '对齐清点');

  const toggle = page.locator('[data-testid^="habit-goal-toggle-"]').first();
  await expect(toggle).toBeVisible();
  await toggle.click();
  const panel = page.locator('[data-testid^="habit-goal-target-"]').first().locator('xpath=..');
  await expect(panel).toBeVisible();
  await assertFormRhythm(panel.locator('xpath=..'));
  await page.screenshot({ path: SHOT('habit-goal-light'), fullPage: false });
});
