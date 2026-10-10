import { expect, test, type Page } from '@playwright/test';

import { openApp, switchTheme } from './helpers';

async function openScope(page: Page): Promise<void> {
  if (!await page.getByRole('button', { name: '新建清单', exact: true }).isVisible()) {
    await page.getByRole('button', { name: '当前视图的范围', exact: true }).click();
  }
}

test('清单写入等待、失败保留输入、重试只创建一次', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openApp(page, '/?lang=zh-CN');
  // Deliberate UI fault injection. Retry delegates to the real IndexedDB/op-log
  // action; this is not evidence of a real disk failure or a network request.
  await page.evaluate(async () => {
    const modulePath = '/src/features/projects/store.ts';
    const { useProjectStore } = await import(modulePath);
    const original = useProjectStore.getState().addProject;
    let attempts = 0;
    const fault = { attempts: 0, reject: () => {} };
    Object.assign(window, { categoryWriteFault: fault });
    useProjectStore.setState({ addProject: async (...args: unknown[]) => {
      fault.attempts = ++attempts;
      if (attempts === 1) {
        await new Promise((_, reject) => { fault.reject = () => reject(new Error('QA controlled write failure')); });
      }
      return original(...args);
    } });
  });
  await openScope(page);
  await page.getByRole('button', { name: '新建清单', exact: true }).click();
  const dialog = page.getByTestId('category-create-dialog');
  const name = page.locator('#ht-category-create-name');
  await name.fill('保留输入的清单');
  await dialog.getByRole('button', { name: '色槽 2', exact: true }).click();
  await page.getByRole('button', { name: '创建清单', exact: true }).click();
  await expect(dialog).toHaveAttribute('aria-busy', 'true');
  await expect(name).toBeDisabled();
  await expect(dialog.getByRole('button', { name: '取消', exact: true })).toBeDisabled();
  await dialog.locator('form').evaluate((form) => {
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
  await page.keyboard.press('Escape');
  await expect(dialog).toBeVisible();
  expect(await page.evaluate(() => (window as any).categoryWriteFault.attempts)).toBe(1);
  await page.screenshot({ path: '../apps/web/evidence/category-dialog-ux/create-pending-390.png' });
  await page.evaluate(() => (window as any).categoryWriteFault.reject());
  await expect(dialog.getByRole('alert')).toBeVisible();
  await expect(name).toHaveValue('保留输入的清单');
  await expect(dialog.getByRole('button', { name: '色槽 2', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.screenshot({ path: '../apps/web/evidence/category-dialog-ux/create-failed-390.png' });
  await dialog.getByRole('button', { name: '创建清单', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await openScope(page);
  const created = page.locator('aside[aria-label="清单与标签"]').getByText('保留输入的清单', { exact: true });
  await expect(created).toHaveCount(1);
  await expect(created).toBeVisible();
  expect(await page.evaluate(() => (window as any).categoryWriteFault.attempts)).toBe(2);
  await page.reload();
  await openScope(page);
  await expect(created).toBeVisible();
});

/**
 * 新建清单弹窗的跨视口视觉证据。
 *
 * 这里测的是最终 Web 产物里的真实点击、焦点与颜色，而不是 jsdom 组件快照：
 * 375px 是底部 sheet，768px 是窄桌面过渡，1440px 是居中 modal；每一档都要在
 * 明暗主题下保持可用并且不横溢。
 */
for (const width of [375, 768, 1440]) {
  for (const theme of ['light', 'dark'] as const) {
    test(`新建清单弹窗 ${width}px ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width, height: width === 375 ? 812 : 900 });
      await openApp(page, '/?lang=zh-CN');

      if (theme === 'dark') await switchTheme(page, 'dark');
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);

      await openScope(page);

      const trigger = page.getByRole('button', { name: '新建清单' });
      await trigger.click();
      const dialog = page.getByTestId('category-create-dialog');
      const input = page.locator('#ht-category-create-name');
      await expect(dialog).toBeVisible();
      // `toBeVisible()` can pass on the first animation frame. Capture only
      // the settled modal; otherwise the half-transparent backdrop makes the
      // underlying sidebar and bottom rail look like they overlap the form.
      await page.locator('.ht-category-create-dialog').evaluate(async (overlay) => {
        await Promise.all(overlay.getAnimations().map((animation) => animation.finished));
      });
      await expect(page.locator('.ht-app > .ht-rail')).toBeHidden();
      await expect(input).toBeFocused();
      await expect(page.getByRole('button', { name: '色槽 1' })).toBeVisible();
      await expect(dialog.getByText('整理你的工作', { exact: true })).toHaveCount(0);
      await expect(dialog.locator('.ht-category-create-dialog__swatch-color + span')).toHaveCount(0);
      const slotOne = page.getByRole('button', { name: '色槽 1' });
      await slotOne.click();
      await expect(slotOne).toHaveAttribute('aria-pressed', 'true');
      await expect(slotOne.locator('svg')).toHaveCount(1);
      await expect(page.getByRole('button', { name: '创建清单' })).toBeVisible();

      const geometry = await page.evaluate(() => ({
        documentWidth: document.documentElement.scrollWidth,
        viewportWidth: window.innerWidth,
        dialogWidth: document.querySelector<HTMLElement>('[data-testid="category-create-dialog"]')
          ?.getBoundingClientRect().width ?? 0,
      }));
      expect(geometry.documentWidth).toBeLessThanOrEqual(geometry.viewportWidth + 1);
      expect(geometry.dialogWidth).toBeLessThanOrEqual(geometry.viewportWidth + 1);

      await page.screenshot({
        path: `../apps/web/evidence/category-dialog-ux/create-${width}-${theme}.png`,
      });

      // The screenshot alone cannot prove the bottom sheet's action row is
      // clickable when the mobile rail occupies the same viewport band.
      await input.fill(`视口 ${width}`);
      await page.getByRole('button', { name: '创建清单' }).click();
      await expect(dialog).toHaveCount(0);
      await openScope(page);
      await expect(
        page.locator('aside[aria-label="清单与标签"]').getByText(`视口 ${width}`, { exact: true }),
      ).toBeVisible();

      await trigger.click();
      await expect(input).toBeFocused();

      await input.press('Escape');
      await expect(dialog).toHaveCount(0);
      await expect(trigger).toBeFocused();
    });
  }
}
