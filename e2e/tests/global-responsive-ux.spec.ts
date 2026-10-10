import { mkdir, writeFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import {
  addTask,
  closeSettingsSheet,
  openApp,
  openSettingsSheet,
  switchTheme,
} from './helpers';

const OUT = '../apps/web/evidence/global-responsive-ux';
const VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 1024, height: 768 },
  { width: 768, height: 844 },
  { width: 390, height: 844 },
  { width: 375, height: 667 },
] as const;

const VIEWS = [
  ['tasks', '任务', 'Tasks'],
  ['calendar', '日历', 'Calendar'],
  ['quadrant', '四象限', 'Quadrant'],
  ['habits', '习惯', 'Habits'],
  ['focus', '番茄钟', 'Focus'],
  ['timeline', '时间线', 'Timeline'],
  ['growth', '成长', 'Growth'],
  ['notes', '便签', 'Notes'],
  ['countdown', '倒数纪念日', 'Countdown'],
  ['search', '搜索', 'Search'],
  ['trash', '回收站', 'Trash'],
] as const;

const SETTINGS_SECTIONS = ['profile', 'appearance', 'sync', 'ai', 'data', 'account', 'help'] as const;

type Surface =
  | { kind: 'view'; id: string; label: string }
  | { kind: 'profile'; id: 'profile-center'; label: string }
  | { kind: 'settings'; id: `settings-${(typeof SETTINGS_SECTIONS)[number]}`; label: string };

function visible(element: HTMLElement): boolean {
  const style = getComputedStyle(element);
  return style.display !== 'none' && style.visibility !== 'hidden' && element.getClientRects().length > 0;
}

async function navigateView(page: Page, id: string, label: string): Promise<void> {
  const searchOverlay = page.getByTestId('search-overlay-surface');
  if (await searchOverlay.isVisible().catch(() => false)) {
    await page.keyboard.press('Escape');
    await expect(searchOverlay).toHaveCount(0);
  }
  const direct = page.getByTestId(`rail-view-${id}`);
  if (await direct.count() > 0 && await direct.first().isVisible().catch(() => false)) {
    await direct.first().click();
    return;
  }
  const tool = page.getByRole('tab', { name: label, exact: true });
  if (await tool.count() > 0 && await tool.first().isVisible().catch(() => false)) {
    await tool.first().click();
    return;
  }
  const more = page.locator('.ht-rail__more > button');
  await expect(more, `视图 ${label} 应有直接入口或更多菜单`).toBeVisible();
  await more.click();
  await page.getByRole('menuitem', { name: label, exact: true }).click();
}

async function setLanguage(page: Page, target: 'zh-CN' | 'en'): Promise<void> {
  await openSettingsSheet(page);
  await selectSettingsSectionStable(page, 'appearance');
  await page.getByTestId(target === 'en' ? 'language-option-en' : 'language-option-zh-CN').click();
  await expect(page.locator('html')).toHaveAttribute('lang', target);
  await closeSettingsSheet(page);
}

/**
 * 设置内容会在某些窄视口触发异步面板重绘；逐次重新取 button，避免把一次重绘
 * 误判成产品卡死。事件仍然走真实 DOM button.click()，随后仍断言可见分组。
 */
async function selectSettingsSectionStable(
  page: Page,
  section: (typeof SETTINGS_SECTIONS)[number],
): Promise<void> {
  const button = page.locator(`button[aria-controls="settings-group-${section}"]`);
  await expect(button, `设置分类 ${section} 必须存在`).toHaveCount(1);
  await button.evaluate((element) => (element as HTMLButtonElement).click());
  await expect(page.locator(`button[aria-controls="settings-group-${section}"]`)).toHaveAttribute('aria-current', 'page');
  await expect(page.locator(`#settings-group-${section}`)).toBeVisible();
}

async function inspect(page: Page, surface: Surface, viewport: (typeof VIEWPORTS)[number], theme: string, locale: string) {
  return page.evaluate(({ surface, viewport, theme, locale }) => {
    const isVisible = (element: Element): element is HTMLElement => {
      const el = element as HTMLElement;
      const style = getComputedStyle(el);
      return !el.hidden
        && el.getAttribute('aria-hidden') !== 'true'
        && style.display !== 'none'
        && style.visibility !== 'hidden'
        && style.opacity !== '0'
        && el.getClientRects().length > 0;
    };
    const round = (value: number) => Math.round(value * 10) / 10;
    const rect = (element: HTMLElement) => {
      const box = element.getBoundingClientRect();
      return { left: round(box.left), top: round(box.top), right: round(box.right), bottom: round(box.bottom), width: round(box.width), height: round(box.height) };
    };
    const selector = (element: HTMLElement): string => {
      const testId = element.getAttribute('data-testid');
      if (testId !== null) return `[data-testid="${testId}"]`;
      const id = element.id;
      if (id !== '') return `#${id}`;
      return `${element.tagName.toLowerCase()}.${String(element.className).split(/\s+/u).filter(Boolean).slice(0, 2).join('.')}`;
    };
    const visibleElements = [...document.querySelectorAll<HTMLElement>('*')].filter(isVisible);
    const horizontalOverflow = visibleElements
      .filter((element) => element.scrollWidth > element.clientWidth + 1)
      .map((element) => {
        const style = getComputedStyle(element);
        return {
          selector: selector(element),
          clientWidth: element.clientWidth,
          scrollWidth: element.scrollWidth,
          overflowX: style.overflowX,
          expectedScrollable: style.overflowX === 'auto' || style.overflowX === 'scroll',
        };
      })
      .slice(0, 20);
    // Keep the raw list above for diagnosis, but expose a smaller review list
    // that removes known intentional/implementation geometry: scroll containers,
    // sync status text, RN-Web layout nodes, zero-width popover descendants and
    // the horizontally scrollable rail itself. This is still a lead list, not a
    // defect count; each item requires visual confirmation in the screenshot.
    const layoutOverflow = horizontalOverflow.filter((item) => {
      if (item.expectedScrollable || item.clientWidth <= 0) return false;
      if (item.selector.includes('.ht-rail__sync__') || item.selector.includes('.css-view-')) return false;
      if (item.selector.includes('.ht-material') || item.selector.includes('[data-testid="date-picker"]')) return false;
      if (item.selector.includes('.ht-rail__item')) return false;
      return item.scrollWidth - item.clientWidth >= 4;
    });
    const wraps = [...document.querySelectorAll<HTMLElement>('button, [role="tab"], [role="menuitem"], input, select')]
      .filter(isVisible)
      .map((element) => {
        const box = element.getBoundingClientRect();
        const text = (element.textContent ?? '').trim();
        const range = document.createRange();
        range.selectNodeContents(element);
        const lineRects = [...range.getClientRects()];
        return { selector: selector(element), text: text.slice(0, 80), rect: rect(element), textHeight: round(lineRects.reduce((max, item) => Math.max(max, item.height), 0)), clientHeight: round(element.clientHeight), boxHeight: round(box.height) };
      })
      .filter((item) => item.textHeight > item.boxHeight + 1 || item.clientHeight > item.boxHeight + 1)
      .slice(0, 20);
    const offscreen = visibleElements
      .filter((element) => {
        const style = getComputedStyle(element);
        // Rail labels/status nodes are fixed tooltip geometry kept in the DOM for
        // hover/focus. Their negative top offset is intentional while hidden and
        // must not be reported as an off-screen user-facing overlay.
        if (element.matches('.ht-rail__label, .ht-rail__sync__status')) return false;
        if (style.position !== 'fixed' && !element.matches('[role="dialog"], [role="menu"]')) return false;
        const box = element.getBoundingClientRect();
        return box.width > 0 && (box.left < -1 || box.right > innerWidth + 1 || box.top < -1 || box.bottom > innerHeight + 1);
      })
      .map((element) => ({ selector: selector(element), position: getComputedStyle(element).position, rect: rect(element) }))
      .slice(0, 20);
    const railButtons = [...document.querySelectorAll<HTMLElement>('.ht-rail__tab, .ht-rail__sync__action')].filter(isVisible).map((element) => {
      const box = element.getBoundingClientRect();
      return { selector: selector(element), centerX: round(box.left + box.width / 2), width: round(box.width), height: round(box.height), text: (element.textContent ?? '').trim().slice(0, 40) };
    });
    const railCenters = railButtons.map((item) => item.centerX);
    const centerSpread = railCenters.length === 0 ? 0 : round(Math.max(...railCenters) - Math.min(...railCenters));
    return {
      surface,
      viewport,
      theme,
      locale,
      documentWidth: document.documentElement.scrollWidth,
      bodyWidth: document.body.scrollWidth,
      viewportWidth: innerWidth,
      globalOverflow: document.documentElement.scrollWidth > innerWidth + 1,
      horizontalOverflow,
      layoutOverflow,
      wraps,
      offscreen,
      rail: { buttons: railButtons, centerSpread },
      visibleDialogs: [...document.querySelectorAll<HTMLElement>('[role="dialog"], [role="menu"]')].filter(isVisible).map((element) => ({ selector: selector(element), rect: rect(element) })),
    };
  }, { surface, viewport, theme, locale });
}

async function capture(page: Page, surface: Surface, viewport: (typeof VIEWPORTS)[number], theme: 'light' | 'dark', locale: string, rows: unknown[]): Promise<void> {
  await page.waitForTimeout(80);
  const name = `${locale}-${theme}-${surface.id}-${viewport.width}x${viewport.height}`;
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: false });
  rows.push(await inspect(page, surface, viewport, theme, locale));
}

test('全页面响应式 UX 审计：视图、个人中心与设置', async ({ page }) => {
  test.setTimeout(1_200_000);
  await mkdir(OUT, { recursive: true });
  const rows: unknown[] = [];
  await openApp(page, '/?lang=zh-CN');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await addTask(page, '响应式审计任务');
  await addTask(page, '响应式审计第二项');

  for (const theme of ['light', 'dark'] as const) {
    if (theme === 'dark') await switchTheme(page, 'dark');
    for (const viewport of VIEWPORTS) {
      await page.setViewportSize(viewport);
      for (const [id, label] of VIEWS) {
        await navigateView(page, id, label);
        // Some view buttons are anchor-backed and can finish their SPA
        // transition one tick after the click. Wait for the new document
        // context before touching the scroll container.
        await page.waitForTimeout(50);
        await page.locator('.ht-main').waitFor({ state: 'visible' });
        await page.locator('.ht-main').evaluate((element) => { element.scrollTop = 0; });
        await capture(page, { kind: 'view', id, label }, viewport, theme, 'zh-CN', rows);
      }
      await page.getByTestId('account-menu-avatar').click();
      await page.getByTestId('account-menu-profile-center').click();
      await capture(page, { kind: 'profile', id: 'profile-center', label: '个人中心' }, viewport, theme, 'zh-CN', rows);
      await page.getByTestId('settings-sheet-close').click();
      await openSettingsSheet(page);
      for (const section of SETTINGS_SECTIONS) {
        await selectSettingsSectionStable(page, section);
        await capture(page, { kind: 'settings', id: `settings-${section}`, label: `设置/${section}` }, viewport, theme, 'zh-CN', rows);
      }
      await closeSettingsSheet(page);
    }
    if (theme === 'dark') await switchTheme(page, 'light');
  }

  await setLanguage(page, 'en');
  for (const theme of ['light', 'dark'] as const) {
    if (theme === 'dark') await switchTheme(page, 'dark');
    for (const viewport of VIEWPORTS) {
      await page.setViewportSize(viewport);
      for (const [id, zh, en] of VIEWS.filter(([id]) => ['tasks', 'search'].includes(id))) {
        await navigateView(page, id, en);
        await capture(page, { kind: 'view', id, label: en }, viewport, theme, 'en', rows);
      }
      const englishSearchOverlay = page.getByTestId('search-overlay-surface');
      if (await englishSearchOverlay.isVisible().catch(() => false)) {
        await page.keyboard.press('Escape');
        await expect(englishSearchOverlay).toHaveCount(0);
      }
      await openSettingsSheet(page);
      await selectSettingsSectionStable(page, 'appearance');
      await capture(page, { kind: 'settings', id: 'settings-appearance', label: 'Settings/Appearance' }, viewport, theme, 'en', rows);
      await closeSettingsSheet(page);
      await page.getByTestId('account-menu-avatar').click();
      await page.getByTestId('account-menu-profile-center').click();
      await capture(page, { kind: 'profile', id: 'profile-center', label: 'Profile' }, viewport, theme, 'en', rows);
      await page.getByTestId('settings-sheet-close').click();
    }
    if (theme === 'dark') await switchTheme(page, 'light');
  }
  await setLanguage(page, 'zh-CN');
  await writeFile(`${OUT}/readout.json`, `${JSON.stringify(rows, null, 2)}\n`, 'utf8');
  const findings = rows.filter((row) => {
    const item = row as { globalOverflow: boolean; offscreen: unknown[]; wraps: unknown[]; layoutOverflow: unknown[]; viewport: { width: number }; rail: { centerSpread: number } };
    // On widths below 1024 the rail is intentionally a horizontal scroller;
    // comparing every tab center there would report the distance between tabs,
    // not a shared vertical rail axis. Desktop still exposes the actual 1.5px
    // group-center drift for review.
    const desktopRailDrift = item.viewport.width >= 1024 && item.rail.centerSpread > 1;
    return item.globalOverflow || item.offscreen.length > 0 || item.wraps.length > 0 || item.layoutOverflow.length > 0 || desktopRailDrift;
  });
  console.log(`GLOBAL_RESPONSIVE_ROWS=${String(rows.length)}`);
  console.log(`GLOBAL_RESPONSIVE_FINDINGS=${String(findings.length)}`);
});
