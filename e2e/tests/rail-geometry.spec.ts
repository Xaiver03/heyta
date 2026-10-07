import { expect, test } from '@playwright/test';

import { openApp, switchTheme } from './helpers';

const SHOTS = '../apps/web/evidence/rail-geometry';

type RailProbe = {
  railCenter: number;
  centers: number[];
  activeBackground: string;
  activeBorder: string;
  activeColor: string;
  activeIconColor: string;
};

async function probeRail(page: import('@playwright/test').Page): Promise<RailProbe> {
  return page.evaluate(() => {
    const rail = document.querySelector<HTMLElement>('nav.ht-rail');
    if (rail === null) throw new Error('rail not rendered');
    const railRect = rail.getBoundingClientRect();
    const buttons = [
      document.querySelector<HTMLElement>('[data-testid="account-menu-avatar"]'),
      ...rail.querySelectorAll<HTMLElement>('.ht-rail__tabs > .ht-rail__item > .ht-rail__tab'),
      ...rail.querySelectorAll<HTMLElement>('.ht-rail__tabs > .ht-rail__more > .ht-rail__tab'),
      ...rail.querySelectorAll<HTMLElement>(':scope > .ht-rail__tab'),
      rail.querySelector<HTMLElement>('[data-testid="sync-rail-action"]'),
    ].filter((button): button is HTMLElement => button !== null);
    const active = rail.querySelector<HTMLElement>('.ht-rail__tab[aria-selected="true"]');
    const activeIcon = active?.querySelector<HTMLElement>('svg');
    if (active === null || activeIcon === null) throw new Error('active rail icon not rendered');
    const activeStyle = getComputedStyle(active);
    return {
      railCenter: railRect.left + railRect.width / 2,
      centers: buttons.map((button) => {
        const rect = button.getBoundingClientRect();
        return rect.left + rect.width / 2;
      }),
      activeBackground: activeStyle.backgroundColor,
      activeBorder: activeStyle.borderTopColor,
      activeColor: activeStyle.color,
      activeIconColor: getComputedStyle(activeIcon).color,
    };
  });
}

test.describe('rail 视觉几何', () => {
  test('hover/focus 标签锚在对应图标旁，并始终留在视口内', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openApp(page);

    const tabs = page.locator('nav.ht-rail .ht-rail__tab');
    const viewport = page.viewportSize();
    expect(viewport).not.toBeNull();
    const count = await tabs.count();
    expect(count, 'rail must expose at least one tooltip tab').toBeGreaterThan(0);

    for (let index = 0; index < count; index += 1) {
      const tab = tabs.nth(index);
      const label = tab.locator('.ht-rail__label');
      await tab.hover();
      await expect(label).toBeVisible();
      const tabBox = await tab.boundingBox();
      const labelBox = await label.boundingBox();
      expect(tabBox, `tab ${String(index)} has no layout box`).not.toBeNull();
      expect(labelBox, `tab ${String(index)} tooltip has no layout box`).not.toBeNull();
      expect(labelBox!.x, `tab ${String(index)} tooltip escaped left edge`).toBeGreaterThanOrEqual(0);
      expect(labelBox!.x + labelBox!.width, `tab ${String(index)} tooltip escaped right edge`).toBeLessThanOrEqual(viewport!.width);
      expect(labelBox!.y, `tab ${String(index)} tooltip escaped top edge`).toBeGreaterThanOrEqual(0);
      expect(labelBox!.y + labelBox!.height, `tab ${String(index)} tooltip escaped bottom edge`).toBeLessThanOrEqual(viewport!.height);
      expect(
        Math.abs(labelBox!.y + labelBox!.height / 2 - (tabBox!.y + tabBox!.height / 2)),
        `tab ${String(index)} tooltip is not vertically anchored to its tab`,
      ).toBeLessThanOrEqual(1);

      await tab.focus();
      await expect(label).toBeVisible();
    }

    const first = tabs.first();
    await first.hover();
    const beforeResize = await first.locator('.ht-rail__label').boundingBox();
    await page.setViewportSize({ width: 1280, height: 720 });
    const afterResize = await first.locator('.ht-rail__label').boundingBox();
    expect(afterResize, 'tooltip disappeared after viewport resize').not.toBeNull();
    expect(afterResize!.x).toBeGreaterThanOrEqual(0);
    expect(afterResize!.x + afterResize!.width).toBeLessThanOrEqual(1280);
    expect(beforeResize, 'tooltip was not measurable before viewport resize').not.toBeNull();
  });

  test('头像、主导航、更多、底部工具共用中轴；亮暗态选中只高亮图标', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openApp(page);

    for (const theme of ['light', 'dark'] as const) {
      if (await page.locator('html').getAttribute('data-theme') !== theme) {
        await switchTheme(page, theme);
      }
      await page.screenshot({ path: `${SHOTS}/rail-${theme}.png` });
      const probe = await probeRail(page);
      for (const center of probe.centers) {
        expect(Math.abs(center - probe.railCenter), `${theme}: rail control is off-axis`).toBeLessThanOrEqual(1);
      }
      expect(probe.activeBackground, `${theme}: active tab must not have a fill`).toBe('rgba(0, 0, 0, 0)');
      expect(probe.activeBorder, `${theme}: active tab must not have a border`).toBe('rgba(0, 0, 0, 0)');
      expect(probe.activeIconColor, `${theme}: active icon must differ from muted button text`).not.toBe(probe.activeColor);
    }
  });

  test('更多菜单紧凑、图标列与文字列对齐，键盘焦点仍可见', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openApp(page);
    const more = page.locator('.ht-rail__more > button');
    await more.focus();
    await page.keyboard.press('Enter');
    const menu = page.locator('[role="menu"]');
    await expect(menu).toBeVisible();
    await expect(menu.locator('.ht-rail__more-header')).toBeVisible();
    await expect(menu.locator('.ht-rail__more-header > .ht-type-caption')).toHaveCount(0);
    const menuBox = await menu.boundingBox();
    expect(menuBox?.width ?? Infinity, 'more menu should stay compact').toBeLessThan(280);
    const first = menu.locator('[role="menuitem"]').first();
    await expect(first).toBeFocused();
    await expect.poll(() => first.evaluate((element) => getComputedStyle(element).outlineWidth)).toBe('0px');
    await expect.poll(() => first.evaluate((element) => getComputedStyle(element).backgroundColor)).not.toBe('rgba(0, 0, 0, 0)');
  });
});


test('更多浮层避开rail，直接拖入并刷新保留；取消拖动不修改偏好', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await openApp(page);
  await page.locator('.ht-rail__more > button').click();
  const menu = page.locator('.ht-rail__more-menu');
  const rail = page.locator('nav.ht-rail');
  const railBox = await rail.boundingBox();
  const menuBox = await menu.boundingBox();
  expect(menuBox!.x).toBeGreaterThan(railBox!.x + railBox!.width);
  const source = menu.getByRole('menuitem', { name: '四象限', exact: true });
  const target = page.getByTestId('rail-view-calendar');
  const from = (await source.boundingBox())!;
  const to = (await target.boundingBox())!;
  const before = await page.locator('.ht-rail__item').count();
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x - 12, from.y + from.height / 2, { steps: 3 });
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 14 });
  await expect(page.locator('.ht-rail__drag-preview')).toBeVisible();
  await expect(target.locator('..')).toHaveClass(/insert-before/);
  await page.screenshot({ path: '../apps/web/evidence/rail-more-drag/drag-insertion.png' });
  await page.mouse.up();
  await expect(page.getByTestId('rail-view-quadrant')).toBeVisible();
  await expect(page.locator('.ht-rail__item')).toHaveCount(before + 1);
  const saved = await page.evaluate(() => localStorage.getItem('heyta.shell.rail'));
  expect(JSON.parse(saved!).primary).toContain('quadrant');
  await page.reload();
  await expect(page.getByTestId('rail-view-quadrant')).toBeVisible();
  const order = await page.locator('.ht-rail__item button[role=tab]').evaluateAll(es => es.map(e => e.getAttribute('data-testid')));
  expect(order.indexOf('rail-view-quadrant')).toBeLessThan(order.indexOf('rail-view-calendar'));
  await page.locator('.ht-rail__more > button').click();
  const next = (await menu.getByRole('menuitem').first().boundingBox())!;
  await page.mouse.move(next.x + 20, next.y + 20);
  await page.mouse.down();
  await page.mouse.move(next.x - 16, next.y + 20, { steps: 4 });
  await page.keyboard.press('Escape');
  await page.mouse.up();
  expect(await page.evaluate(() => localStorage.getItem('heyta.shell.rail'))).toBe(saved);
});
