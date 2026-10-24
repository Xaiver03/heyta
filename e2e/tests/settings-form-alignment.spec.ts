/**
 * 设置里那两张"填表界面"的对齐验收（2026-10-24 起）
 * ==================================================
 *
 * 这两节是 `ux-principles.md` §1「两种解剖」的第 2 类（**设置 / 属性面板** = 标签在左）
 * 与第 1 类（**表单页** = 标签在上）混住的地方：
 *   · AI → 端点（名称 / 地址 / 模型）用的是 `inline`；
 *   · 同步 → 保险库口令用的是 `stacked`。
 * 所以它同时挡住"两种解剖被用反"这件事。
 *
 * 🔴 只拍图 + 一条几何判据（`assertFormRhythm`）。这一族**不**重复
 * `settings-*` 那些行为判据 —— 它存在的理由是"人得看得见"，不是"再验一遍逻辑"。
 */

import { expect, test, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';

import {
  assertFormRhythm,
  openApp,
  openSettingsSheet,
  selectSettingsSection,
  switchTheme,
} from './helpers';

const APP_ZH = '/?lang=zh-CN';

const SHOT = (name: string) =>
  fileURLToPath(new URL(`../../apps/web/evidence/settings-form-alignment/${name}.png`, import.meta.url));

test.use({ viewport: { width: 1280, height: 900 } });

async function openSection(page: Page, section: 'ai' | 'sync'): Promise<void> {
  await openSettingsSheet(page);
  await selectSettingsSection(page, section);
}

test('AI 端点：三行 inline 解剖，控件只有一档高度', async ({ page }) => {
  await openApp(page, APP_ZH);
  await openSection(page, 'ai');
  // 端点编辑区在「自带端点」那一块；没有配置过端点时它是空态 ⇒ 这条用例只拍空态。
  await page.screenshot({ path: SHOT('ai-light'), fullPage: false });
  await switchTheme(page, 'dark');
  await openSection(page, 'ai');
  await page.screenshot({ path: SHOT('ai-dark'), fullPage: false });
});

test('同步：自托管那一组（服务器/令牌）走 stacked 解剖且高度合规', async ({ page }) => {
  await openApp(page, APP_ZH);
  await openSection(page, 'sync');
  const section = page.getByTestId('sync-settings-panel');
  await expect(section).toBeVisible();
  // 🔴 这三格在 `<details>` 里（「高级：自托管与手动连接」）。不展开的话
  //    截图与几何判据都会**空过** —— 而"空过"看起来和"通过"一模一样。
  await page.getByTestId('sync-advanced').locator('summary').click();
  const serverUrl = page.getByTestId('sync-server-url');
  await expect(serverUrl).toBeVisible();
  // 量的是**这一组**（它的 fieldset），不是整个面板：面板里还有隐私承诺那些非字段内容。
  const group = serverUrl.locator('xpath=ancestor::fieldset[1]');
  await assertFormRhythm(group);
  await section.scrollIntoViewIfNeeded();
  await page.screenshot({ path: SHOT('sync-advanced-light'), fullPage: false });
});
