import { expect, test } from '@playwright/test';

/**
 * 塌缩态（≤768px）的**逐页**扫描（goal-layout-audit.md 页 4 / 收尾）
 * ================================================================
 *
 * 页4 修好塌缩形态时只验了任务视图的网格；页8 的宽窗扫描之后，
 * goal 文档把"其余视图的塌缩态未逐页截图"登记为已知余量 —— 这条就是来销账的。
 *
 * 判据（每页）：
 *   · 视图切得过去、内容区标题对上（渲染完成）；
 *   · **底部导航在**（`.ht-rail__tabs` 在视口内）—— 塌缩形态的锚；
 *   · 截图落固定路径，**人看**（AGENTS §6.2 规定一）。
 *
 * 专注 / 成长 / 便签默认关 —— 同宽窗扫描，用 localStorage 显式覆盖打开。
 */

const MODULES_ON = JSON.stringify({ focus: true, growth: true, notes: true });
const NARROW = { width: 660, height: 800 };

for (const [tab, file] of [
  ['日历', 'narrow-calendar'],
  ['四象限', 'narrow-quadrant'],
  ['习惯', 'narrow-habits'],
  ['时间线', 'narrow-timeline'],
  ['番茄钟', 'narrow-focus'],
  ['成长', 'narrow-growth'],
  ['便签', 'narrow-notes'],
  ['回收站', 'narrow-trash'],
] as const) {
  test(`塌缩态扫描：${tab}`, async ({ page }) => {
    await page.addInitScript((modules) => {
      localStorage.setItem('heyta.shell.modules', modules);
    }, MODULES_ON);
    await page.setViewportSize(NARROW);
    await page.goto('/');
    await page.getByRole('tab', { name: tab }).click();
    // ⚠️ 标题锚不通用：日历视图的标题沿用当前筛选名（「收集箱」——
    // `VIEW_TITLED_BY_TAB` 不含 calendar，既有行为），所以日历锚它自己的月份板。
    if (tab === '日历') {
      await expect(page.getByTestId('calendar-board')).toBeVisible();
    } else {
      await expect(page.locator('.ht-header__title')).toContainText(tab);
    }

    // 🔴 塌缩形态的锚：底部导航必须还在视口里（塌塌就没导航 = 半成品）。
    const nav = page.locator('.ht-rail__tabs');
    await expect(nav).toBeVisible();
    const navBox = await nav.boundingBox();
    expect(navBox, '底部导航有几何').not.toBeNull();
    const viewport = page.viewportSize()!;
    expect(
      navBox!.y + navBox!.height,
      '底部导航必须落在视口内（贴底）',
    ).toBeLessThanOrEqual(viewport.height + 2);

    await page.screenshot({ path: `test-results/${file}.png`, fullPage: false });
  });
}

test('塌缩态扫描：搜索浮层', async ({ page }) => {
  await page.setViewportSize(NARROW);
  await page.goto('/');
  const composer = page.locator('input[placeholder^="添加任务"]');
  await composer.fill('塌缩态的锚点任务');
  await composer.press('Enter');
  await page.getByRole('tab', { name: '搜索' }).click();

  const surface = page.getByTestId('search-overlay-surface');
  await expect(surface).toBeVisible();
  // 窄窗里卡片宽度 = 内容区 - padding（min(100%, modal-max) 取 100%），
  // 但仍必须给两侧留出 scrim 空隙 —— 铺死到内容区边缘就是假浮层。
  const card = page.locator('[data-testid="search-overlay-surface"] > *').first();
  const cardBox = await card.boundingBox();
  const contentBox = await page.locator('.ht-content').boundingBox();
  expect(cardBox, '卡片有几何').not.toBeNull();
  expect(contentBox, '内容区有几何').not.toBeNull();
  expect(
    cardBox!.width,
    '窄窗卡片必须比内容区窄（两侧留透出下层的空隙）',
  ).toBeLessThan(contentBox!.width);
  await expect(page.locator('[data-testid="task-list"]')).toBeAttached();

  // 🔴 等 `ht-sheet-in` 入场动画走完再截（同设置浮层的教训：
  // 动画中途整层半透明，截图会把中间态误读成"卡片透底"）。
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'test-results/narrow-search.png', fullPage: false });

  await page.keyboard.press('Escape');
  await expect(surface).toHaveCount(0);
});

test('塌缩态扫描：设置浮层', async ({ page }) => {
  await page.setViewportSize(NARROW);
  await page.goto('/');
  await page.getByTestId('account-menu-avatar').click();
  await page.getByTestId('account-menu-settings').click();
  await expect(page.getByTestId('settings-sheet')).toBeVisible();
  // 同宽窗教训：等入场动画走完再截，否则半透明中间态会被误读成排版缺陷。
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'test-results/narrow-settings.png', fullPage: false });
});
