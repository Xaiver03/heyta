/**
 * 公共事实（调休 / 补班）在**真界面**上的三档（W4b 判据①）
 * =======================================================
 *
 * 交接文档 §4 第 4 件明确要求："①自托管拿不到数据时**不报错、不留空块**，
 * 且要在**真界面**跑一次（截图 + 人看）"。这条只有截图能作证 ——
 * 单元判据证明的是"返回值是 `unavailable`"，它证明不了**日历还是完整的一张**。
 *
 * ## 三档各钉一件事
 *
 * | 档 | 现场 | 界面上必须看到的 |
 * |---|---|---|
 * | A 未配置 / 未同意 | 不填服务端地址 | 42 格齐全 + 随包表的「休/班」在（**没请求也能画**） |
 * | B 自托管旧版本 | 填了地址，但那条通道 404 | 与 A **一模一样**：不报错、不少格子 |
 * | C 部署方下发 | 那条通道 200，且只给 10-17 一天 | 10-17 出现「班」，而随包表的 10-01「休」**消失** |
 *
 * 🔴 C 那一档判的是 **ADR-0052 §2.2 的"整年替换"**：下发那一年 = 那一年的全部真相。
 * 如果实现做成"合并"，10-01 的「休」会留着 —— 那在界面上完全看不出来是哪种语义，
 * 而两种语义对用户的含义相反（"部署方说这天不上班" vs "国务院原话还在"）。
 *
 * ⚠️ 断言一律写成**存在性**（那一格有没有标记节点），不写"某几行长什么样" ——
 * AGENTS §9 记过那条教训：**断言只会验界面写了什么，不会验界面少了什么**。
 * 这里"少了一整月的标记"恰恰是判据①的失败形态。
 */
import { expect, test, type Page } from '@playwright/test';

import { openApp, STUB_ORIGIN, stubLegalRecheck } from './helpers';

const APP_ZH = '/?lang=zh-CN';
const BOARD = '[data-testid="calendar-board"]';
const CELLS = '[data-testid^="calendar-cell-2026-"]';
const MARKERS = '[data-testid^="calendar-day-marker-"]';
const CELLS_PER_MONTH_GRID = 42;

const markerOf = (date: string): string => `[data-testid="calendar-day-marker-${date}"]`;
/** 左侧那份**迷你月历**的标记（W6 之前它不跟着画 —— 同一屏两份说法）。 */
const miniMarkerOf = (date: string): string =>
  `[data-testid="calendar-mini-marker-${date}"]`;

/** 往凭据里塞服务端地址 = "这台设备连的是那个部署方"。 */
async function pointAtDeployer(page: Page): Promise<void> {
  await page.addInitScript((origin) => {
    window.localStorage.setItem(
      'heyta.sync.credentials',
      JSON.stringify({ baseUrl: origin, token: 'e2e-token', email: 'e2e@example.test' }),
    );
  }, STUB_ORIGIN);
}

test('A：没配服务端 ⇒ 日历完整，标记来自随包表（判据①：拿不到也是正常状态）', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(`[pageerror] ${error.message}`));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(`[console.error] ${msg.text()}`);
  });

  await openApp(page, APP_ZH, 'local-only');
  await page.getByRole('tab', { name: '日历' }).click();
  await expect(page.locator(BOARD)).toBeVisible();

  await page.screenshot({ path: 'test-results/public-facts-local-only.png', fullPage: false });

  await expect(page.locator(CELLS)).toHaveCount(CELLS_PER_MONTH_GRID);
  // 随包表覆盖 2026-10，所以一颗点都不该有 —— 这条判的是"退回随包表"真退回了。
  await expect(page.locator(markerOf('2026-10-01'))).toHaveText('休');
  await expect(page.locator(markerOf('2026-10-10'))).toHaveText('班');
  // 🔴 W6 补齐的那半：左侧迷你月历原先**不跟着画**，于是同一屏两份说法
  //   （主区说"10-01 休"、侧栏只给一颗点）。读的是同一个 `adjustmentOn`，
  //   画不画是宿主的事 —— 这条就是钉"宿主画了"。
  await expect(page.locator(miniMarkerOf('2026-10-01'))).toHaveText('休');
  await expect(page.locator(miniMarkerOf('2026-10-10'))).toHaveText('班');
  expect(errors, `界面上不该出现任何东西，但控制台有：\n${errors.join('\n')}`).toEqual([]);
});

test('B：那条通道 404（自托管旧版本）⇒ 与 A 逐字一样：不报错、不少一格', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(`[pageerror] ${error.message}`));

  await pointAtDeployer(page);
  stubLegalRecheck(page);
  // 🔴 404 而不是网络错：自托管最常见的形态是"这个版本根本没有这个端点"。
  await page.route(`${STUB_ORIGIN}/api/holiday-adjustments**`, async (route) => {
    await route.fulfill({ status: 404, body: '{"error":"not found"}', headers: { 'content-type': 'application/json' } });
  });

  await openApp(page, APP_ZH, 'accepted');
  await page.getByRole('tab', { name: '日历' }).click();
  await expect(page.locator(BOARD)).toBeVisible();

  await page.screenshot({ path: 'test-results/public-facts-self-hosted-404.png', fullPage: false });

  await expect(page.locator(CELLS)).toHaveCount(CELLS_PER_MONTH_GRID);
  await expect(page.locator(markerOf('2026-10-01'))).toHaveText('休');
  expect(errors, `拿不到公共事实不该在界面上变成错误：\n${errors.join('\n')}`).toEqual([]);
});

test('C：部署方只下发 10-17 一天 ⇒ 10-17 出现「班」，随包表 10-01 的「休」整年替换掉（§2.2）', async ({ page }) => {
  const seen: { url: string; headers: Record<string, string> }[] = [];

  await pointAtDeployer(page);
  stubLegalRecheck(page);
  await page.route(`${STUB_ORIGIN}/api/holiday-adjustments**`, async (route) => {
    const request = route.request();
    seen.push({ url: request.url(), headers: await request.allHeaders() });
    await route.fulfill({
      status: 200,
      headers: { 'content-type': 'application/json', etag: 'e2e-2026-only' },
      body: JSON.stringify({
        version: 'e2e-2026-only',
        years: [
          {
            year: 2026,
            papers: ['https://www.gov.cn/zhengce/content/e2e'],
            days: [{ day: '2026-10-17', isOffDay: false }],
          },
        ],
      }),
    });
  });

  await openApp(page, APP_ZH, 'accepted');
  await page.getByRole('tab', { name: '日历' }).click();
  await expect(page.locator(BOARD)).toBeVisible();

  // 存在性：先等那一格真的画出标记（画不出来就是这条链没通）。
  await expect(page.locator(markerOf('2026-10-17'))).toHaveText('班', { timeout: 15_000 });
  // 🔴 再等"随包表那一天不在了"—— 整年替换的另一半，缺了它这条判据等于只验了新值。
  await expect(page.locator(markerOf('2026-10-01'))).toHaveCount(0);
  await expect(page.locator(markerOf('2026-10-10'))).toHaveCount(0);
  // 侧栏那份跟着换（覆盖表是模块级状态，React 看不见 —— 这一条钉的是那次重算真的敲到了侧栏）。
  await expect(page.locator(miniMarkerOf('2026-10-17'))).toHaveText('班');
  await expect(page.locator(miniMarkerOf('2026-10-01'))).toHaveCount(0);

  await page.screenshot({ path: 'test-results/public-facts-deployer-supplied.png', fullPage: false });

  await expect(page.locator(CELLS)).toHaveCount(CELLS_PER_MONTH_GRID);
  await expect(page.locator(MARKERS)).toHaveCount(1);

  // 🔴 这条请求必须**匿名**（ADR-0052 §2.1 那条边界的客户端侧）：
  // 真界面上发过一次、且请求头里一个凭据都没有。
  expect(seen.length, '一条请求都没发 —— 这条链在真界面上根本没跑').toBeGreaterThan(0);
  const offending = seen[0]!.headers;
  for (const key of ['authorization', 'cookie']) {
    expect(offending[key], `公共事实的请求带了 ${key} —— 它就不再是公共事实了`).toBeUndefined();
  }
});
