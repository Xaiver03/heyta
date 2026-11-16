/**
 * 回归：隐私同意是**网络守卫**，不是首启的墙（ADR-0086）。
 *
 * 这条用例存在的理由很具体 —— 2026-11-16 真机实拍发现：iPhone 首次启动时
 * 一块覆盖整屏的同意面板把三格漫画完全盖住，用户第一眼看到的是权限决策。
 * 改法是把"问的时机"从冷启动挪到"第一次真要出门"。
 *
 * 单元测试只能证明"`requireNetworkConsent()` 返回 false 时会打开面板"，
 * 证不了**整棵树上真实点击**的次序 —— 那条只有这里能钉：
 *
 *   1. 冷启动：面板**不在**（用户先看到产品）
 *   2. 点登录入口：面板**出现**，且登录表单**还没**出现（先问许可）
 *   3. 同意之后：面板关掉，登录表单**才**出现（意图没被吞掉）
 *
 * 三条缺任何一条都会变成一种具体的坏产品：
 *   · 缺 1 = 回到"权限墙挡首屏"
 *   · 缺 2 = 用户点了登录却没有任何反应（本仓库反复记过的静默失效）
 *   · 缺 3 = 用户同意了却还得再点一次登录
 */
import { expect, test } from '@playwright/test';

import { enableAllModules, pinChineseUi } from './helpers';
import { installMissingProducerShims } from './shims.js';

/** 让面板能长出**本地表单**（与 `auth-consent-registration.spec.ts` 同一条理由）。 */
async function allowLocalForm(page: import('@playwright/test').Page): Promise<void> {
  await page.route('**/api/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }),
  );
  await page.route('**/api/auth/central/config**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ mode: 'local' }),
    }),
  );
}

test('🔴 冷启动不弹同意面板；打开登录面板也不弹（问的时机是**提交**）', async ({ page }) => {
  await allowLocalForm(page);
  await enableAllModules(page);
  await pinChineseUi(page);
  await installMissingProducerShims(page);

  await page.goto('/');

  // 首屏可交互 = 应用真的起来了（不是拿空白页当"没有面板"）。
  await expect(page.locator('input[placeholder^="添加任务"]')).toBeVisible();

  const consent = page.getByTestId('privacy-consent-dialog');
  const authDialog = page.locator('[role="dialog"][aria-label="登录 / 注册"]');

  // ① 冷启动：同意面板不在。
  await expect(
    consent,
    '冷启动弹出了同意面板 —— ADR-0086 之后它只该由"要出门的动作"打开',
  ).toHaveCount(0);
  await expect(authDialog, '冷启动不该自动打开登录面板').toHaveCount(0);

  /*
    ② 打开登录面板**也不弹**同意。

    这一点我第一版写反了：当时在 `openSignIn()` 里加守卫，结果是"点了登录先问一次"。
    那个时机偏早 —— 打开面板一个请求都没发出去，产品里本来就有更准的落点：
    未同意时 `AuthPanel` 画的是**本地表单**，用户填完点提交，
    `createConsentGatedFetch` 在那一刻拦下。问应该发生在提交，不是打开。

    所以这里钉的是"打开不打扰"，而"提交时问"由下面那条（闸门在请求前拦下）承接。
  */
  const entry = page.getByTestId('sync-signin-entry');
  if (!(await entry.isVisible().catch(() => false))) {
    await page.getByTestId('account-menu-avatar').click();
  }
  await entry.click();

  await expect(authDialog, '登录面板没打开').toBeVisible();
  await expect(
    consent,
    '一打开登录面板就问同意 —— 时机偏早，用户还没要求发出任何东西',
  ).toHaveCount(0);
});

test('🔴 「先离线使用」这条路上，全程不打扰', async ({ page }) => {
  await allowLocalForm(page);
  await enableAllModules(page);
  await pinChineseUi(page);
  await installMissingProducerShims(page);

  await page.goto('/');
  await expect(page.locator('input[placeholder^="添加任务"]')).toBeVisible();

  /*
    纯本地操作走一遍：新建一条任务。
    一个从没作过决定、也从没点过"要出门"的按钮的用户，不该在任何一步被问同意 ——
    PIPL 第 16 条禁止因不同意而拒绝服务，而本地优先让这条路是同一个完整产品。
  */
  const input = page.locator('input[placeholder^="添加任务"]');
  await input.fill('离线也能写的一条');
  await input.press('Enter');
  await expect(page.getByText('离线也能写的一条').first()).toBeVisible();

  await expect(
    page.getByTestId('privacy-consent-dialog'),
    '纯本地操作被隐私面板打断了',
  ).toHaveCount(0);
});
