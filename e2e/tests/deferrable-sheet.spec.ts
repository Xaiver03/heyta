import { expect, test, type Page } from '@playwright/test';

import { enableAllModules, pinChineseUi, waitForBootSplashGone } from './helpers';

/**
 * 意思表示层在真浏览器里的样子（全局 UX 线 P6 第三批）
 * ==================================================
 *
 * `PrivacyConsentSheet` 与 `LegalReconfirmSheet` 这一批换成了共享壳 `WebModalShell`，
 * 关闭口径改吃 `CLOSED_OVERLAYS['modal-deferrable']`（背景 deny／Esc dismiss／给 ×）。
 * 计划 §P6 的规矩是**每迁一枚就要有真浏览器读数 + 人看过图**，所以这一格量三样：
 *
 *   · **几何**：遮罩铺满视口、面板水平居中、宽度等于页面自己算出来的
 *     `--ht-layout-modal-max`（窄屏时是"撑满减 padding"）—— 换壳最容易悄悄动的就是这两格；
 *   · **两条通道的后果**：点遮罩不关、Esc 关，而**两种都不落盘**
 *     （"关掉不等于同意"是链 5 写进 `docs/plans/legal-compliance-before-filing.md` §4 的对外口径）；
 *   · **亮暗宽窄四张图**，人逐张看过。
 *
 * 🔴 拍照前必须等首屏动画退场：`#heyta-boot` 的 z 是 900，而模态是 `--ht-z-modal`（400）
 * —— 不等的话拍到的是"整屏被首屏白 plate 压淡"的过渡帧。链 5 与 G-27 那两套取证图就是这样
 * 拍成半透明的（本会话实测：与 10-02 入库图差 83%，差的全是这一层 + 27 天的外壳漂移）。
 * 所以这里把"退场"写成一条会红的断言，而不是一个 `waitForTimeout`。
 */

const EVIDENCE = '../apps/web/evidence/deferrable-sheets';
const DIALOG = '[data-testid="privacy-consent-dialog"]';
const SCRIM = '[data-testid="privacy-consent-dialog-scrim"]';

/** 首启面板：不替用户作任何决定地把它开出来。 */
async function openWithConsentPanel(page: Page, theme: 'light' | 'dark'): Promise<void> {
  await enableAllModules(page);
  await pinChineseUi(page);
  await page.addInitScript((value) => {
    window.localStorage.setItem('heyta.theme', value);
  }, theme);
  await page.goto('/');
  await expect(page.locator(DIALOG), '首启没有弹隐私面板').toBeVisible();
  await waitForBootSplashGone(page);
  await expect(page.locator('#heyta-boot'), '首屏 plate 还在场 ⇒ 拍到的是过渡帧').toHaveCount(0);
}

async function tokenPx(page: Page, varName: string): Promise<number> {
  return page.evaluate((name) => {
    const probe = document.createElement('span');
    probe.style.setProperty('inline-size', `var(${name})`);
    document.body.append(probe);
    const px = Number.parseFloat(getComputedStyle(probe).width);
    probe.remove();
    return px;
  }, varName);
}

const consentRecord = (page: Page): Promise<string | null> =>
  page.evaluate(() => window.localStorage.getItem('privacy.consent'));

for (const theme of ['light', 'dark'] as const) {
  for (const width of [1440, 390] as const) {
    test(`面板几何 ${theme}·${width}：遮罩铺满、面板居中且不超出模态宽度档`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await openWithConsentPanel(page, theme);

      const scrimBox = await page.locator(SCRIM).boundingBox();
      expect(scrimBox, '遮罩量不到盒子 ⇒ 下面两句判的是空气').not.toBeNull();
      expect(scrimBox!.width, '遮罩没铺满视口宽度').toBeGreaterThanOrEqual(width);
      expect(scrimBox!.height, '遮罩没铺满视口高度').toBeGreaterThanOrEqual(900);

      const dialog = page.locator(DIALOG);
      const box = await dialog.boundingBox();
      expect(box, '面板量不到盒子').not.toBeNull();
      expect(box!.x, '面板左边贴到遮罩外面了').toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width, '面板右边溢出').toBeLessThanOrEqual(width + 0.5);
      // 居中：左右留白相等（容差 1px 给亚像素）。
      expect(Math.abs(box!.x - (width - box!.x - box!.width)), '面板没水平居中').toBeLessThanOrEqual(1);

      const modalMax = await tokenPx(page, '--ht-layout-modal-max');
      expect(modalMax, '模态宽度档算不出来 ⇒ 这条会空转').toBeGreaterThan(0);
      const expectWidth = Math.min(modalMax, width - 2 * (await tokenPx(page, '--ht-space-4')));
      expect(box!.width, `面板宽度不等于"档值与视口里能放下的宽度"取小的那一格`).toBeLessThanOrEqual(
        expectWidth + 1,
      );
      // 反作弊那一臂：宽屏下必须真的**跑到档值**，否则"上面那句 <= "永远成立。
      if (width === 1440) {
        expect(box!.width, '宽屏下面板没长到模态宽度档 ⇒ 宽度档被谁吃掉了').toBeGreaterThanOrEqual(
          modalMax - 1,
        );
      }

      await page.screenshot({ path: `${EVIDENCE}/consent-${theme}-${String(width)}.png` });
    });
  }
}

test('两条通道各按表里那一格，且都不落盘：点遮罩不关、Esc 关', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openWithConsentPanel(page, 'light');

  // ① 误点遮罩：这一层不许被推掉（表里 scrim = deny）。
  await page.mouse.click(60, 60);
  await expect(page.locator(DIALOG), '点空白处就把同意面板推掉了').toBeVisible();
  expect(await consentRecord(page), '点遮罩被记成了一次决定').toBeNull();

  // ② Esc：有意动作 ⇒ 收起，但决定仍然是"没问过"（表里 escape = dismiss）。
  await page.keyboard.press('Escape');
  await expect(page.locator(DIALOG), 'Esc 没收起面板（表里那一格是 dismiss）').toHaveCount(0);
  expect(await consentRecord(page), '关掉面板被写进了磁盘 ⇒ 关掉不等于同意这条破了').toBeNull();

  // ③ 关掉之后仍然拦着：下一次要出门的动作得再问一次。
  await page.reload();
  await expect(page.locator(DIALOG), '没决定过的人刷新后不该被当成已经决定').toBeVisible();
});
