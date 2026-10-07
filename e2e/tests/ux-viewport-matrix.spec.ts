import { mkdir, writeFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { addTask, openApp, showDetailColumnContent } from './helpers';

/**
 * 跨视口 UX 取证：验证缩小窗口后应用自己重排，用户不需要先把窗口拖大。
 * 这条不是视觉快照测试，而是读取真实滚动宿主、横向溢出和关键操作几何。
 */
const VIEWPORTS = [
  { width: 1440, height: 1000 },
  ...[768, 900, 1024, 1280].flatMap(width => [400, 479, 480, 600, 720].map(height => ({ width, height }))),
  { width: 1280, height: 800 },
  { width: 1024, height: 768 },
  { width: 1024, height: 480 },
  { width: 900, height: 700 },
  { width: 768, height: 844 },
  { width: 600, height: 800 },
  { width: 390, height: 844 },
  { width: 375, height: 667 },
] as const;

test('视口矩阵：不产生横向溢出，详情栏按空间自动退场，核心操作留在视口内', async ({ page }) => {
  await page.setViewportSize(VIEWPORTS[0]);
  await openApp(page, '/?lang=zh-CN');
  await showDetailColumnContent(page, '视口审计任务');
  for (let i = 0; i < 12; i += 1) await addTask(page, `视口审计-${String(i)}`);

  const rows: Array<Record<string, unknown>> = [];
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport);
    // Narrow layouts deliberately scroll their header with main; return to the
    // top after task creation, without changing the window size.
    await page.locator('.ht-main').evaluate(el => { el.scrollTop = 0; });
    await page.waitForTimeout(80);
    const metrics = await page.evaluate(() => {
      const app = document.querySelector<HTMLElement>('.ht-app');
      const content = document.querySelector<HTMLElement>('.ht-content');
      const detail = document.querySelector<HTMLElement>('.ht-app__detail');
      const primary = document.querySelector<HTMLElement>('.ht-header__actions button');
      const rect = primary?.getBoundingClientRect();
      return {
        docWidth: document.documentElement.scrollWidth,
        viewportWidth: window.innerWidth,
        appWidth: Math.round(app?.getBoundingClientRect().width ?? 0),
        contentWidth: Math.round(content?.getBoundingClientRect().width ?? 0),
        contentScrollHeight: Math.round(content?.scrollHeight ?? 0),
        contentHeight: Math.round(content?.getBoundingClientRect().height ?? 0),
        detailVisible: detail !== null && !detail.hidden && getComputedStyle(detail).display !== 'none',
        primaryInViewport:
          rect !== undefined && rect.left >= 0 && rect.right <= window.innerWidth && rect.top >= 0 && rect.bottom <= window.innerHeight,
        offenders: [...document.querySelectorAll<HTMLElement>('*')]
          .map((el) => ({ el, rect: el.getBoundingClientRect() }))
          .filter(({ rect }) => rect.right > window.innerWidth + 1 && rect.width > 0)
          .sort((a, b) => b.rect.right - a.rect.right)
          .slice(0, 8)
          .map(({ el, rect }) => ({
            tag: el.tagName,
            className: typeof el.className === 'string' ? el.className : '',
            testId: el.getAttribute('data-testid'),
            left: Math.round(rect.left),
            right: Math.round(rect.right),
            width: Math.round(rect.width),
          })),
      };
    });
    rows.push({ viewport, ...metrics });
    if ((viewport.width === 768 && viewport.height === 400) || (viewport.width === 1280 && viewport.height === 479) || viewport.width === 375) {
      await page.screenshot({path: `../apps/web/evidence/settings-finish/viewport-${viewport.width}-${viewport.height}.png`});
    }
    if (metrics.docWidth > viewport.width + 1) console.log('viewport-overflow', JSON.stringify({ viewport, metrics }));
    expect(metrics.docWidth, `${viewport.width}×${viewport.height} 不应横向溢出`).toBeLessThanOrEqual(viewport.width + 1);
    expect(metrics.appWidth, `${viewport.width}×${viewport.height} 应填满视口`).toBeLessThanOrEqual(viewport.width + 1);
    expect(metrics.primaryInViewport, `${viewport.width}×${viewport.height} 顶部核心操作不可见`).toBe(true);
    if (viewport.width <= 1023 || viewport.height < 480) {
      expect(metrics.detailVisible, `${viewport.width}×${viewport.height} 详情栏应自动退场`).toBe(false);
    }
  }
  await mkdir('../apps/web/evidence/settings-finish', {recursive: true});
  await writeFile('../apps/web/evidence/settings-finish/viewport-metrics.json', JSON.stringify(rows, null, 2));
  test.info().annotations.push({ type: 'viewport-metrics', description: JSON.stringify(rows) });
});
