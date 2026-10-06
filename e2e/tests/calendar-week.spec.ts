/**
 * 日历**周视图**（R11 批三）
 * ==========================
 *
 * 产品负责人 2026-10-02 对标滴答时点名的第 3 档（§9.4 批三）。
 * 这一屏要证明的不是"能切档"，而是**切过去之后它比月档多说了什么**：
 *
 *   1. 一屏只有 7 格、周一开头，而**布局规则与月档同一条**：
 *      行不许随视口长高，剩余空间归"当天那一格"（见下面那条差分为何是"不许"）；
 *   2. 格子里画得下**更多条**（上限从共享常量推导，不在这里抄数字）；
 *   3. 标题说的是**周区间**，`‹ ›` 走的是**一整周**；
 *   4. 侧栏那个迷你月历仍然跟同一个游标走。
 *
 * 🔴 判据 1 用的是**差分**（视口 720 → 1200 前后各量一次），
 *    不是"行高 ≥ 某个数" —— 后者会把 #137 那个错再犯一遍。
 *    ⚠️ 它第一版写的是**反的**（"周档那一行必须长高"），而且那条判据**真的会红**
 *      —— 撤掉 `flexGrow` 就红。也就是说"能失败"不等于"测的是对的事"：
 *      那张图里是一根 772px 的纯蓝立柱。细节见 §7 #144。
 */

import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

import { openApp } from './helpers';

const APP_ZH = '/?lang=zh-CN';
const BOARD = '[data-testid="calendar-board"]';
const CONTENT = '.ht-content';
const MONTH_CARD = '[data-testid="calendar-board-month-card"]';
const CELL = '[data-testid^="calendar-cell-"][role="button"]';
const BAR = '[data-testid$="-bar"]';
const TITLE = '[data-testid="calendar-toolbar-month"]';
const MINI_TITLE = '[data-testid="calendar-mini-title"]';
const VIEW_SELECT = '[data-testid="calendar-view-select"]';
const STAMP = Date.now().toString().slice(-6);
/** 条数从**共享常量**推导：这里只写"比上限多两条"，不写死那个上限。 */
const SEEDED_ABOVE_CAP = 2;

function watchConsole(page: Page): string[] {
  const lines: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') lines.push(`[console.error] ${msg.text()}`);
  });
  page.on('pageerror', (err) => lines.push(`[pageerror] ${err.message}`));
  return lines;
}

async function gotoCalendar(page: Page): Promise<void> {
  await page.getByRole('tab', { name: '日历' }).click();
  await expect(page.locator(BOARD)).toBeVisible();
  await expect(page.locator(MONTH_CARD)).toBeVisible();
}

/** 今天播 N 条到期任务（走真实输入框 ⇒ 真 op 落库，不是往 store 里塞）。 */
async function seedToday(page: Page, count: number): Promise<void> {
  const composer = page.locator('input[placeholder^="添加任务"]');
  for (let i = 0; i < count; i += 1) {
    await composer.fill(`今天 周视图-${i}-${STAMP}`);
    await composer.press('Enter');
    await expect(
      page.getByRole('checkbox', { name: `完成：周视图-${i}-${STAMP}` }),
    ).toBeVisible();
  }
}

async function pickView(page: Page, kind: 'month' | 'week'): Promise<void> {
  await page.selectOption(VIEW_SELECT, kind);
  await expect(page.locator(CELL)).toHaveCount(kind === 'week' ? 7 : 42);
}

/** 当前档位（判据的前提：方向相反的两条不能跑在错的档上）。 */
async function viewIs(page: Page): Promise<string> {
  return (await page.locator(VIEW_SELECT).inputValue()) as string;
}

/**
 * 🔴 上限**不抄进这里**（抄件一定会漂），但 e2e **不在根 pnpm 工作区内**
 *   （见 `e2e/pnpm-workspace.yaml`），所以也 `import` 不到 `@heyta/ui`。
 *   取"源码里那一个数"是这里能做到的最小读取：**匹配不到就响亮地失败**，
 *   而不是退回一个写死的 6 —— 静默退回会让这条判据变成恒真。
 */
async function caps(): Promise<{ week: number; month: number }> {
  const src = await readFile(
    new URL('../../packages/ui/src/calendar/model.ts', import.meta.url),
    'utf8',
  );
  const one = (name: string): number => {
    const m = new RegExp(`export const ${name} = (\\d+);`, 'u').exec(src);
    if (m === null) throw new Error(`在 packages/ui/src/calendar/model.ts 里找不到 ${name}`);
    return Number(m[1]);
  };
  return { week: one('MAX_WEEK_CALENDAR_BARS'), month: one('MAX_CALENDAR_BARS') };
}

/** 量"那一行"的高度：取第一格所在行的 top，再取同一行 7 格的平均高度。 */
async function firstRowHeight(page: Page): Promise<number> {
  return page.locator(BOARD).evaluate((boardEl, cellSel) => {
    const cells = [...boardEl.querySelectorAll<HTMLElement>(cellSel)];
    if (cells.length === 0) return -1;
    const top = Math.round(cells[0]!.getBoundingClientRect().top);
    const row = cells.filter((c) => Math.round(c.getBoundingClientRect().top) === top);
    return Math.round(row.reduce((m, c) => m + c.getBoundingClientRect().height, 0) / row.length);
  }, CELL);
}

function cellDates(page: Page): Promise<string[]> {
  return page.locator(BOARD).evaluate((boardEl, cellSel) => {
    return [...boardEl.querySelectorAll<HTMLElement>(cellSel)].map((el) =>
      (el.getAttribute('data-testid') ?? '').replace('calendar-cell-', ''),
    );
  }, CELL);
}

test('🔴 切到周档：一屏 7 格、周一开头，而那一行**不许**随视口长高', async ({ page }) => {
  const errors = watchConsole(page);
  await openApp(page, APP_ZH);
  await gotoCalendar(page);
  await pickView(page, 'week');
  expect(await viewIs(page), '下拉显示的不是周档').toBe('week');

  const dates = await cellDates(page);
  expect(dates).toHaveLength(7);
  // 连续七天 + 周一开头（`getDay()`：周一=1）。
  const start = new Date(`${dates[0]}T00:00:00`);
  expect(start.getDay(), `周档第一格必须是周一，实测 ${dates[0]}`).toBe(1);

  /*
   * 🔴 差分：视口从 720 拉到 1200，那一行**必须一字不变**。
   *
   * 这条与月档那条（`calendar-cells.spec.ts` 的"星期行不许跟着长高"）**同向**，
   * 而且是刻意复测一遍：批三第一版给周档那一行加了 `flexGrow`，
   * 理由是"周档的主体就是这一行" —— 数字上成立（行高 292 → 772），
   * 而**判据全绿时界面是错的**：空日历下它变成一根 772px 的纯蓝立柱
   * （选中格实心主蓝 + 格子拉满整行）。见 §7 #144。
   * 剩余空间归"当天那一格"这条规则**不分档位**。
   */
  await page.setViewportSize({ width: 1280, height: 720 });
  const short = await firstRowHeight(page);
  await page.setViewportSize({ width: 1280, height: 1200 });
  const tall = await firstRowHeight(page);
  console.info(`[calendar-week] 行高 720=${String(short)} 1200=${String(tall)}`);
  expect(short, '量不到行高（探针坏了，不是判据红了）').toBeGreaterThan(0);
  expect(
    Math.abs(tall - short),
    `视口从 720 拉到 1200 之后周档那一行变高了（${String(short)} → ${String(tall)}）—— ` +
      `剩余空间被网格吃了，应该归当天那一格`,
  ).toBeLessThanOrEqual(1);

  // 而"全高"这条对周档同样成立：整块板子仍然铺满内容区（不留一片空白）。
  const filled = await page.locator(CONTENT).evaluate((el, sel) => {
    const cs = getComputedStyle(el);
    const inner = el.getBoundingClientRect().height - Number.parseFloat(cs.paddingTop) - Number.parseFloat(cs.paddingBottom);
    const board = document.querySelector(sel)?.getBoundingClientRect();
    return { inner, board: board?.height ?? -1 };
  }, BOARD);
  expect(
    filled.board,
    `周档板高 ${String(filled.board)} 没铺满内容盒 ${String(filled.inner)}`,
  ).toBeGreaterThanOrEqual(filled.inner - 1);

  await page.screenshot({ path: 'test-results/calendar-week-tall.png', fullPage: false });
  expect(errors, `控制台报错：${errors.join(' | ')}`).toEqual([]);
});

test('🔴 周档格子里画得下更多条：超出上限的折成 +N，且没有一条被裁一半', async ({ page }) => {
  const errors = watchConsole(page);
  const cap = await caps();
  const seeded = cap.week + SEEDED_ABOVE_CAP;

  await page.setViewportSize({ width: 1280, height: 1200 });
  await openApp(page, APP_ZH);
  // 🔴 顺序不能反：输入框住在**任务页**，进了日历就没有它了
  //    （`calendar-cells.spec.ts` 也是先播再切视图）。
  await seedToday(page, seeded);
  await gotoCalendar(page);
  await pickView(page, 'week');

  const today = await page.evaluate(() => {
    const d = new Date();
    return `${String(d.getFullYear())}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
      d.getDate(),
    ).padStart(2, '0')}`;
  });
  const cell = page.locator(`[data-testid="calendar-cell-${today}"]`);
  await expect(cell).toBeVisible();

  const drawn = await cell.locator(BAR).count();
  // 🔴 断的是"画满了上限"，不是"画了 ≥1 条"：只断 ≥1 的话，
  //    上限写死回 3 也照样绿（那正是这条判据要抓的错）。
  expect(
    drawn,
    `周档格子里只画了 ${String(drawn)} 条，上限是 ${String(cap.week)} —— 没画满就是没接上`,
  ).toBe(cap.week);
  // 🔴 光有上面那条**是恒真的**：`drawn` 与上限都从同一份源码读，
  //    把 `MAX_WEEK_CALENDAR_BARS` 改回 3，上面两边一起变成 3、照样绿
  //    （变异臂 H 实测存活过）。真正有牙齿的是这句：**周档必须比月档画得多**。
  expect(
    drawn,
    `周档只画 ${String(drawn)} 条，与月档的 ${String(cap.month)} 条没有区别 —— 这一档白做`,
  ).toBeGreaterThan(cap.month);

  const more = cell.locator('[data-testid$="-more"]');
  await expect(more).toHaveText(`+${String(seeded - drawn)}`);

  // 几何：每一条都完整落在格子内。
  const overflow = await cell.evaluate((el, barSel) => {
    const box = el.getBoundingClientRect();
    return [...el.querySelectorAll<HTMLElement>(barSel)]
      .filter((b) => {
        const r = b.getBoundingClientRect();
        return r.bottom > box.bottom + 1 || r.top < box.top - 1;
      })
      .map((b) => b.getAttribute('data-testid') ?? '?');
  }, BAR);
  expect(overflow, `这些条溢出格子（被裁一半）：${overflow.join(', ')}`).toEqual([]);

  await page.screenshot({ path: 'test-results/calendar-week-bars.png', fullPage: false });
  expect(errors, `控制台报错：${errors.join(' | ')}`).toEqual([]);
});

test('🔴 标题说的是周区间，`›` 走的是一整周，侧栏迷你月历跟着同一个游标', async ({ page }) => {
  const errors = watchConsole(page);
  await openApp(page, APP_ZH);
  await gotoCalendar(page);
  await pickView(page, 'week');

  const title = (await page.locator(TITLE).textContent()) ?? '';
  // 「2026年9月28日 – 10月4日」——**不是**「2026年10月」。
  // 这条钉的是"漏接 `weekTitle` 会静默退回月份"那个形状（类型上合法，界面上像坏了）。
  expect(title, `周档标题没换成周区间（实测「${title}」）`).toMatch(/^\d{4}年\d{1,2}月\d{1,2}日 – /);

  const before = await cellDates(page);
  const miniBefore = (await page.locator(MINI_TITLE).textContent()) ?? '';
  await page.locator('[data-testid="calendar-toolbar-next"]').click();
  await expect.poll(async () => (await cellDates(page))[0]).not.toBe(before[0]);
  const after = await cellDates(page);

  // 走 7 天：第一格从周一跳到下一个周一。
  const days =
    (new Date(`${after[0]}T00:00:00`).getTime() - new Date(`${before[0]}T00:00:00`).getTime()) /
    86_400_000;
  expect(days, `周档点「下一段」走了 ${String(days)} 天，应该走 7 天`).toBe(7);

  // 侧栏迷你月历**没有**跟着跳一周（它按月翻），但它显示的月份必须与
  // 周档第一格所在月**同源** —— 否则就是两份游标。
  const miniAfter = (await page.locator(MINI_TITLE).textContent()) ?? '';
  // 🔴 「2026年10月」与「2026-10-05」**不是同一种串**，前缀相比恒假
  //    （第一版就是这么写的，红得很像产品 bug）。按**年月两个数**比。
  const monthOf = (t: string): string => {
    const m = /(\d{4})\D+(\d{1,2})/u.exec(t);
    return m ? `${m[1]}-${m[2].padStart(2, '0')}` : `(?解析不了「${t}」)`;
  };
  expect(
    monthOf(miniAfter),
    `翻周之后侧栏是「${miniAfter}」，而主区第一格 ${after[0]} 所在月应当同源`,
  ).toBe(after[0].slice(0, 7));

  await page.screenshot({ path: 'test-results/calendar-week-nav.png', fullPage: false });
  expect(errors, `控制台报错：${errors.join(' | ')}`).toEqual([]);
});

test('🔴 下拉里只有**真的能用**的档位（月 / 周 / 日 / 时间线），没有点了没反应的档', async ({ page }) => {
  await openApp(page, APP_ZH);
  await gotoCalendar(page);
  const options = await page.locator(`${VIEW_SELECT} option`).evaluateAll((els) =>
    els.map((e) => e.textContent?.trim() ?? ''),
  );
  // 中文界面 ⇒ 断的是**看得见的字**，不是 value（用户点的就是这个）。
  // ⚠️ 第三档「时间线」于 R11 批五下半进来（§9.3 差异化第 3 条）。它**不是**
  //   `CalendarViewKind`，走的是外壳那条路 —— 真点了能不能走通由
  //   `apps/web/tests/calendar-view-family.spec.tsx` 钉，这里钉的是"没有摆设"。
  // ⚠️ 「日」于批四进来（§9.12）、「年」于 R13 进来：顺序就是下拉里的顺序，多一个少一个都红。
  expect(options, `档位下拉里出现了 ${String(options.length)} 项`).toEqual([
    '月',
    '周',
    '日',
    '年',
    '时间线',
  ]);
});
