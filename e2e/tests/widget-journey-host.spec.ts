import { expect, test, type Page } from '@playwright/test';

import { openApp } from './helpers';

/** 图落在证据目录而不是 `test-results/`：后者每次运行会被清空，而这两张图要能入库、能被下一个人对着看。 */
const EVIDENCE = '../apps/web/evidence/ux-final-20261009/widget-journey-host';

/**
 * 「桌面小组件」那段说明，在原生壳里不能再教用户"先把 heyta 装成应用"。
 * ================================================================
 *
 * 计划 §8.2 记的这条残留有个不显眼的前提：面板原先用
 * `resolveStorageBackend() === 'shell'` 认"我在壳里"，而那个判据只看
 * `__heytaHostStoragePort` —— 该端口带着一条排查用的逃生门
 * （`HEYTA_SHELL_STORAGE=0`）。门一关，同一个原生窗口就被当成浏览器标签页，
 * Windows 分支的 `showInstallGuide` 重新变 true：**已经装在 MSIX 里的人**
 * 看到的是"在地址栏右侧点「…」"这种他根本不需要做的步骤。
 *
 * 🔴 为什么必须真浏览器：这条判据住在**页侧对宿主信号的观察**里。
 * `apps/web/tests/widget-install.spec.ts` 钉的是纯函数的输入输出；而"逃生门关掉之后
 * 面板还认不认得壳"要真的把 `window.chrome.webview` 放进页面才看得出来 ——
 * 单测里那个 `window` 是我自己捏的，真浏览器里的 `window.chrome` 是 Chromium 给的。
 *
 * ⚠️ **这里注入的 `chrome.webview` 是合成信号**：它证明页侧分类与渲染的文案，
 * 不等于 Windows WebView2 壳内的真实读数（那条装置是
 * `scripts/qa/windows-installed-widget-help.mjs`，要远端 CDP 隧道）。
 */

async function openWidgetJourney(page: Page) {
  await openApp(page, '/?lang=zh-CN');
  await page.getByTestId('account-menu-avatar').click();
  await page.getByTestId('account-menu-settings').click();
  const sheet = page.getByTestId('settings-sheet');
  await sheet.locator('[aria-controls="settings-group-appearance"]').click();
  const panel = sheet.getByTestId('widget-journey-panel');
  await expect(panel).toBeVisible();
  return panel;
}

/** 把平台名钉成 Windows：`currentPlatformName()` 先读 `userAgentData.platform`，再回落 `navigator.platform`。 */
async function pretendWindows(page: Page) {
  await page.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, 'platform', { get: () => 'Win32', configurable: true });
    const uaData = (navigator as { userAgentData?: object }).userAgentData;
    if (uaData) {
      Object.defineProperty(uaData, 'platform', { get: () => 'Win32', configurable: true });
    }
  });
}

for (const theme of ['light', 'dark']) {
  test(`Windows 浏览器标签页（${theme}）：按真实路径教「如何装成应用」`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await pretendWindows(page);

    const panel = await openWidgetJourney(page);
    await page.evaluate((value) => { document.documentElement.dataset.theme = value; }, theme);
    await expect(panel.getByTestId('widget-journey-status')).toContainText('正在浏览器标签页里运行');
    // 存在性判据，不是内容判据：这一段少了任何一条都算回归。
    await expect(panel.getByTestId('web.widgetJourney.windows.step1')).toBeVisible();

    // 🔴 元素截图，不是整屏截图：这条主张说的是"这一段面板画了什么"，
    //    而整屏只拍到分组顶部（显示 / 功能模块），小组件那段在折叠线以下 ——
    //    那种图既不能证也不能伪（§7 第 170 条同一族）。
    await panel.screenshot({ path: `${EVIDENCE}/browser-windows-tab-${theme}.png` });
  });

  test(`🔴 存储宿主逃生门关掉的 WebView2（${theme}）：认得自己是壳，不再教怎么装`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await pretendWindows(page);
    await page.addInitScript(() => {
      // WebView2 独有的名字；Chrome/Edge 浏览器里没有 `chrome.webview`。
      (window as { chrome?: Record<string, unknown> }).chrome = {
        ...(window as { chrome?: Record<string, unknown> }).chrome,
        webview: { postMessage: () => undefined, addEventListener: () => undefined },
      };
    });

    const panel = await openWidgetJourney(page);
    await page.evaluate((value) => { document.documentElement.dataset.theme = value; }, theme);
    await expect(panel.getByTestId('widget-journey-status')).toContainText('正在原生桌面应用中运行');
    await expect(panel.getByTestId('web.widgetJourney.windows.step1')).toHaveCount(0);
    // 暗色不是亮色的反相：这一段在暗态下也必须给出"暂不支持系统小组件"的实话，
    // 而不是退化成空白或把安装三步露回来。
    await expect(panel.getByTestId('widget-journey-capability')).toContainText('暂不支持系统小组件');

    await panel.screenshot({ path: `${EVIDENCE}/native-shell-storage-host-off-${theme}.png` });
  });
}
