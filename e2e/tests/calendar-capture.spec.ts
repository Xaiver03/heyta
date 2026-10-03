/**
 * 日历捕获的真浏览器验收（R11 批五）
 * ===================================
 *
 * DOM 那一层（`apps/web/tests/calendar-capture.spec.tsx`）钉的是数据形状；
 * 这一层钉的是**用户真的看得见**：点页头那个 `+`、敲字、回车，
 * 任务条出现在**他刚指着的那一格**里。
 *
 * 🔴 为什么这条必须走真浏览器而不是 jsdom：
 *   "落进那一格"要同时穿过 输入 → `parseCapture` → op-log → IndexedDB →
 *   reducer → 重渲染 → `groupTasksByDueDate` → 格子。
 *   jsdom 里断"store 里有这条"只证明前半段（§7 元规则：探针够不着的那一段
 *   在输出上长得和"它坏了"一模一样）。
 */

import { expect, test, type Page } from '@playwright/test';

import { openApp } from './helpers';

const APP_ZH = '/?lang=zh-CN';
const BOARD = '[data-testid="calendar-board"]';
const MONTH_CARD = '[data-testid="calendar-board-month-card"]';

async function gotoCalendar(page: Page): Promise<void> {
  await page.getByRole('tab', { name: '日历' }).click();
  await expect(page.locator(BOARD)).toBeVisible();
  await expect(page.locator(MONTH_CARD)).toBeVisible();
}

test('🔴 点 `+` → 输入一句话 → 任务条出现在**刚指着的那一格**里', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(e.message));

  await page.setViewportSize({ width: 1280, height: 900 });
  await openApp(page, APP_ZH);
  await gotoCalendar(page);

  // ── 选**明天**那一格（不是今天，否则"落在选中那格"与"落在今天"分不出来）──
  const target = await page.evaluate(() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return `${String(d.getFullYear())}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
      d.getDate(),
    ).padStart(2, '0')}`;
  });
  await page.locator(`[data-testid="calendar-cell-${target}"]`).click();
  await expect(page.getByText('10月', { exact: false }).first()).toBeVisible();

  // ── 页头那个 `+`，然后输入框必须**说出落点** ──────────────────────
  await page.getByRole('button', { name: '往选中那天加一条' }).click();
  const input = page.locator('[data-testid="capture-input"]');
  await expect(input).toBeVisible();
  const placeholder = (await input.getAttribute('placeholder')) ?? '';
  const [ty, tm, td] = target.split('-').map(Number);
  expect(
    placeholder,
    `输入框没说清这条会落在哪一天（实测 placeholder=「${placeholder}」）`,
  ).toContain(`${String(tm)}月${String(td)}日`);
  void ty;

  const STAMP = `捕获-${Date.now().toString().slice(-6)}`;
  await input.fill(STAMP);
  await page.keyboard.press('Enter');

  // ── 真落库、真渲染：那一格里画出了这条任务条 ─────────────────────
  const cell = page.locator(`[data-testid="calendar-cell-${target}"]`);
  await expect(cell.locator('[data-testid$="-bar-title"]')).toHaveText([STAMP]);
  // 🔴 这里**不写**"别的格子里没有它"那种断言：选中的就是目标格，
  //    任何"未选中格子数为 0"的写法都恒真（§7 元规则 2）。
  //    "没跑偏到今天"由第二条用例从反面钉：锚点是明天、输入是后天 ⇒ 落在后天。

  await page.screenshot({ path: 'test-results/calendar-capture.png', fullPage: false });
  expect(errors, `控制台报错：${errors.join(' | ')}`).toEqual([]);
});

test('🔴 输入里写了「明天」时以**输入**为准：在 3 号那一格里写「后天」，落在 5 号', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await openApp(page, APP_ZH);
  await gotoCalendar(page);

  const [dayAfter, dayAfter2] = await page.evaluate(() => {
    const fmt = (offset: number): string => {
      const d = new Date();
      d.setDate(d.getDate() + offset);
      return `${String(d.getFullYear())}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
        d.getDate(),
      ).padStart(2, '0')}`;
    };
    return [fmt(1), fmt(2)];
  });

  // 选中"明天"那一格 —— 锚点就是它。
  await page.locator(`[data-testid="calendar-cell-${dayAfter}"]`).click();
  await page.getByRole('button', { name: '往选中那天加一条' }).click();

  const STAMP = `覆盖-${Date.now().toString().slice(-6)}`;
  await page.locator('[data-testid="capture-input"]').fill(`后天 ${STAMP}`);
  await page.keyboard.press('Enter');

  // 落在**后天**那一格，而不是锚点那一格。
  await expect(
    page.locator(`[data-testid="calendar-cell-${dayAfter2}"] [data-testid$="-bar-title"]`),
  ).toHaveText([STAMP]);
  await expect(
    page.locator(`[data-testid="calendar-cell-${dayAfter}"] [data-testid$="-bar-title"]`),
  ).toHaveCount(0);
});
