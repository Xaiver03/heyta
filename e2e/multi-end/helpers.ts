/**
 * 三端验收的公共步骤（真浏览器，真服务端）。
 * ==========================================
 *
 * 这些用例**故意不在** `e2e/tests/` 里 —— 那个目录由离线的
 * `playwright.config.ts` 驱动并挂在 `pnpm check` 上。放在这里，
 * 就只会由 `pnpm verify:multi-end`（及其 shell 脚本）拉起。
 *
 * 🔴 **凭据一律走环境变量，且必须显式检查非空。**
 * 少了这一步，一个忘了导出变量的运行会**安静地**变成"配了空地址、同步没发生、
 * 断言却都在看本地数据"，然后部分通过 —— 那比直接报错危险得多。
 */

import { expect, type Page } from '@playwright/test';

export const SERVER = process.env['HEYTA_SYNC_SERVER'] ?? '';
export const TOKEN = process.env['HEYTA_SYNC_TOKEN'] ?? '';
export const PASSWORD = process.env['HEYTA_SYNC_PASSWORD'] ?? '';

/** 缺口令时同步会被服务端拒绝（服务端只接受端到端加密的载荷）。 */
export function requireCredentials(): void {
  const missing = [
    ['HEYTA_SYNC_SERVER', SERVER],
    ['HEYTA_SYNC_TOKEN', TOKEN],
    ['HEYTA_SYNC_PASSWORD', PASSWORD],
  ]
    .filter(([, value]) => value === '')
    .map(([name]) => String(name));

  if (missing.length > 0) {
    throw new Error(
      `缺环境变量：${missing.join('、')} —— ` +
        '这个套件必须由 `scripts/verify-multi-end-sync.sh` 启动（它会建一个新账号并把凭据传进来）。',
    );
  }
}

/** 打开真应用，等输入框真的可见（白屏不算通过）。 */
export async function openApp(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.locator('input[placeholder^="添加任务"]')).toBeVisible();
}

/**
 * 同步状态条。
 *
 * 🔴 **用结构定位，不用 `getByRole('status')` 裸取** —— 应用里还有别的
 * live region（`SubscriptionNotice` 也是 `role="status"`），裸取会撞上
 * strict mode。这里的判据是"**那个拥有「立即同步」按钮的**状态区" ——
 * 它在结构上唯一。
 */
export function statusBar(page: Page) {
  return page.locator('div[role="status"]').filter({ has: page.getByLabel('立即同步') });
}

/** 在同步设置对话框里填好三个字段并保存（保存会顺带触发一次同步）。 */
export async function configureSync(page: Page): Promise<void> {
  await page.getByRole('button', { name: '同步设置' }).click();
  const dialog = page.getByRole('dialog', { name: '同步设置' });
  await expect(dialog).toBeVisible();

  await dialog.getByLabel('服务端地址').fill(SERVER);
  await dialog.getByLabel('访问令牌').fill(TOKEN);
  await dialog.getByLabel('端到端加密口令').fill(PASSWORD);

  // 「保存并同步」= configure() + closeSettings() + syncNow()
  await dialog.getByRole('button', { name: '保存并同步' }).click();
  await expect(dialog).toBeHidden();
}

/**
 * 按「立即同步」并等到状态变成「已同步」。
 *
 * ⚠️ 「未同步」不包含「已同步」，所以 `toContainText('已同步')` 是可靠的 ——
 * 但**不包含"真的拉到了东西"**。那一条只能由服务端/另一台设备来证，
 * 所以本文件里的每个用例都由 shell 脚本在外部再交叉验证一次。
 */
export async function syncNow(page: Page): Promise<void> {
  await statusBar(page).getByLabel('立即同步').click();
  await expect(statusBar(page)).toContainText('已同步');
}

/**
 * 按标题定位任务行（与离线套件同一套选择器）。
 *
 * 🔴 `task-item-*` 是共享 `TaskList` 打在外层行上的 testID（整行，含行尾
 * 插槽）—— web 手写的 `.ht-task` 已随 M3 第一刀删除。
 */
export function rowFor(page: Page, title: string) {
  return page.locator('[data-testid^="task-item-"]').filter({ hasText: title });
}

/** 侧栏「清单与标签」面板。 */
export function sidebar(page: Page) {
  return page.locator('aside[aria-label="清单与标签"]');
}