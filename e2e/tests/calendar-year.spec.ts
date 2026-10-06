/**
 * 日历**年视图**（R13）—— 真浏览器里的"12 个月真的摊开了"
 * ==========================================================
 *
 * 产品负责人要的形是滴答那张「12 个月缩略」（`ui-review-fill-zh-timeline.md` §9.4 批四另一半）。
 * 单测那一份（`apps/web/tests/calendar-year-board.spec.tsx`）已经数过卡数、月份名、
 * 点的有无、点击边界 —— 这里**只补 jsdom 量不到的那三件**：
 *
 * 1. 🔴 **分行**。列数由 `onLayout` 量出来的宽度决定，而 jsdom 里 `onLayout` **从不触发**
 *    ⇒ 单测里列数恒为 1（那条判据在那儿写会得到一条恒真或恒假的句子）。
 *    "12 张卡在宽屏上排成 4×3 而不是叠成一列"这件事**只有这里能证**。
 *    这条不是装饰：`flexWrap + minWidth:'50%' + gap` 那一类写法塌成一列时，
 *    界面上**有**12 张卡、**没有**报错，只有布局是错的。
 * 2. 🔴 **不溢出**：卡必须都在内容盒里（横向滚动的年视图在移动端之外是不该有的）。
 * 3. **翻一年 / 点月卡钻取**在真界面上走一遍（单测钉的是 store，这里钉的是看得见的月历）。
 *
 * ⚠️ 「今天有标记」这一条在这里量的是**读屏属性** `aria-current="date"`（平铺，
 *   与月格那条 `aria-selected` 同一写法）；它**视觉上**那一圈边框由下面那两张截图
 *   人眼看为证 —— 颜色与边框不在这里断言（那是 `check:design` 与对比度测试管的）。
 */

import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

import { openApp, switchView } from './helpers';

const APP_ZH = '/?lang=zh-CN';
const VIEW_SELECT = '[data-testid="calendar-view-select"]';
const YEAR_BOARD = '[data-testid="calendar-board-year"]';
const TITLE = '[data-testid="calendar-toolbar-month"]';
const NEXT = '[data-testid="calendar-toolbar-next"]';
const MONTH_CARD = '[data-testid="calendar-board-month-card"]';
const CONTENT = '.ht-content';
const STAMP = Date.now().toString().slice(-6);
/** 证据落在**受版本控制**的目录里（`e2e/test-results/` 每趟会被清掉）。 */
const SHOT = (name: string): string => `../apps/web/evidence/calendar-year/${name}.png`;

function watchConsole(page: Page): string[] {
  const lines: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') lines.push(`[console.error] ${msg.text()}`);
  });
  page.on('pageerror', (err) => lines.push(`[pageerror] ${err.message}`));
  return lines;
}

/**
 * 🔴 一年几个月**从领域源码读**，不在这里抄一个 12（抄件一定会漂）。
 *   e2e 刻意不在根 pnpm 工作区内 ⇒ import 不到 `@heyta/domain`，只能读文件；
 *   读不到就**响亮地失败**，不能退回字面量。
 */
async function monthsPerYear(): Promise<number> {
  const src = await readFile(
    new URL('../../packages/domain/src/date.ts', import.meta.url),
    'utf8',
  );
  const m = /export const MONTHS_PER_YEAR = (\d+);/u.exec(src);
  if (m === null) throw new Error('在 packages/domain/src/date.ts 里找不到 MONTHS_PER_YEAR');
  return Number(m[1]);
}

function iso(date: Date): string {
  return `${String(date.getFullYear())}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate(),
  ).padStart(2, '0')}`;
}

/** 年档里那 12 张卡（`-title` / `-weekdays` / `-body` 带同一个前缀，必须排掉）。 */
function yearCards(page: Page) {
  return page.locator('[data-testid^="calendar-board-year-month-"][role="button"]');
}

/**
 * 把一组坐标**按容差归堆**，返回堆数。
 *
 * 🔴 为什么不直接 `new Set(round(x)).size`：卡片宽度除以 7 不是整数，
 *   同一列在不同行里会落在 x=812.4 / 813.0 这种**亚像素**差上，
 *   逐值去重实测把 7 列数成 16 列 —— 那是探针的分辨率问题，不是界面的。
 *   容差取 6px：远小于列宽（≈28px），又大于亚像素抖动；
 *   而"31 天挤成一行"那种真坏法里同行相邻格会**互相压字**，容差挡不住它。
 */
function clusterCount(values: number[], tolerance = 6): number {
  const sorted = [...new Set(values)].sort((a, b) => a - b);
  if (sorted.length === 0) return 0;
  let groups = 1;
  for (let i = 1; i < sorted.length; i += 1) {
    if (sorted[i]! - sorted[i - 1]! > tolerance) groups += 1;
  }
  return groups;
}

/** 归堆之后取每堆的**首值**，用来把同一行的格子挑出来。 */
function clusterKeys(values: number[], tolerance = 6): number[] {
  const sorted = [...new Set(values)].sort((a, b) => a - b);
  const keys: number[] = [];
  for (const v of sorted) {
    if (keys.length === 0 || v - keys[keys.length - 1]! > tolerance) keys.push(v);
  }
  return keys;
}

async function gotoCalendarYear(page: Page): Promise<void> {
  await switchView(page, '日历');
  await expect(page.locator(MONTH_CARD)).toBeVisible();
  await page.selectOption(VIEW_SELECT, 'year');
  await expect(page.locator(YEAR_BOARD)).toBeVisible();
}

/** 在任务页播一条**排到今天**的事（标题里那个「今天」会被捕获吃掉并转成 `dueDate`）。 */
async function seedToday(page: Page, suffix: string): Promise<void> {
  const composer = page.locator('input[placeholder^="添加任务"]');
  await composer.fill(`今天 ${suffix}`);
  await composer.press('Enter');
  await expect(page.getByRole('checkbox', { name: `完成：${suffix}` })).toBeVisible();
}

test('🔴 12 张月卡真的**分了行**、全在内容盒里，而今天那一格读屏念得出是今天', async ({ page }) => {
  const errors = watchConsole(page);
  await page.setViewportSize({ width: 1280, height: 720 });
  await openApp(page, APP_ZH);
  await seedToday(page, `年视图-${STAMP}`);
  await gotoCalendarYear(page);

  // 先截图，再断言（§6.2 规定一 1：失败时也要有图）。
  await page.screenshot({ path: SHOT('year'), fullPage: false });

  const total = await monthsPerYear();
  const cards = yearCards(page);
  await expect(cards).toHaveCount(total);

  /*
   * ① 分行：把 12 张卡的位置读回来，按 y 归行、按 x 归列。
   * 🔴 判据从"卡数"推，不抄一个 4 或 3：`calendarYearColumns` 只保证
   *   **列数整除 12**，具体几列由宽度决定（换一台宽的屏就该换一档）。
   */
  const boxes = await cards.evaluateAll((els) =>
    els.map((el) => {
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.x), y: Math.round(r.y), right: Math.round(r.right) };
    }),
  );
  const rows = clusterCount(boxes.map((b) => b.y));
  const columns = clusterCount(boxes.map((b) => b.x));
  expect(columns, '列数为 1 ⇒ 宽屏上年视图塌成一列（那是"有 12 张卡但没摊开"）').toBeGreaterThan(
    1,
  );
  expect(rows * columns, `${String(rows)} 行 × ${String(columns)} 列摆不下 ${String(total)} 张卡`).toBe(
    total,
  );
  // 每一行的卡数**相同**（最后一行少半格是"按内容分行"写错的形状）。
  const rowKeys = clusterKeys(boxes.map((b) => b.y));
  const perRow = rowKeys.map((key) => boxes.filter((b) => Math.abs(b.y - key) <= 6).length);
  expect(new Set(perRow).size, `每行卡数不一致：${perRow.join(',')}`).toBe(1);
  expect(perRow[0]).toBe(columns);

  /*
   * ①b 🔴 **卡里面**也得摊开：这一条是上一张截图逼出来的 —— 31 个格子曾被塞进
   *   一个 `flexWrap` 容器而每格 `flexBasis: 0`，基宽 0 永远"塞得下"、
   *   `flexWrap` 从不生效 ⇒ 真浏览器里 31 天挤成一行互相压字，
   *   而 jsdom 那条"数得出 31 格"照样绿（它数的是节点数不是位置）。
   *   判据按**列/行的位置**来：7 个不同的 x、≥4 个不同的 y、同行相邻格不许互相压字。
   *
   * 🔴 选择器必须**排掉状态点**：`…-day-2026-10-03-dot` 也以 `…-day-2026-10-` 开头，
   *   把 8px 宽的那颗点当成"格子"来数就凭空多出一个横位 —— 实测第 8 列 x=728 正是
   *   今天那颗点（它在自己那格里居中，比格子的 717 偏右 11px）。
   *   前缀选择器的作用域是**后缀**决定的；不排掉就是探针自己造出一个缺陷。
   */
  const today = new Date();
  const thisMonth = iso(today).slice(0, 7);
  const monthCells = await page
    .locator(
      `[data-testid^="calendar-board-year-day-${thisMonth}-"]:not([data-testid$="-dot"])`,
    )
    .evaluateAll((els) =>
      els.map((el) => {
        const r = el.getBoundingClientRect();
        return { x: r.x, y: r.y, right: r.right };
      }),
    );
  expect(monthCells.length, '本月一格都没画出来').toBeGreaterThan(27);
  const dayColumns = clusterCount(monthCells.map((c) => c.x));
  const dayRowKeys = clusterKeys(monthCells.map((c) => c.y));
  /*
    下界是**推出来的**，不是抄这个月的形状：任何月都有 28~31 天，
    28 天正好是 4 个完整周 ⇒ "本月的每一天都覆盖 7 个星期几"，
    于是列数恒为 7、行数恒 ≥ 4。写死 5 或 6 会在别的月份假红。
  */
  expect(
    dayColumns,
    `本月格子只占 ${String(dayColumns)} 个横位 ⇒ 没按周分成 7 列。x：` +
      `${monthCells.map((c) => c.x.toFixed(1)).join(' ')}`,
  ).toBe(7);
  expect(
    dayRowKeys.length,
    `本月格子只占 ${String(dayRowKeys.length)} 行 ⇒ 全挤在同一行上压字`,
  ).toBeGreaterThanOrEqual(4);
  for (const key of dayRowKeys) {
    const inRow = monthCells
      .filter((c) => Math.abs(c.y - key) <= 6)
      .sort((a, b) => a.x - b.x);
    for (let i = 1; i < inRow.length; i += 1) {
      expect(
        inRow[i]!.x,
        `同一行里第 ${String(i)} 格的左边界压到了前一格（右 ${inRow[i - 1]!.right.toFixed(1)} / 左 ${inRow[i]!.x.toFixed(1)}）`,
      ).toBeGreaterThanOrEqual(inRow[i - 1]!.right - 1);
    }
  }

  /*
   * ①c 🔴 格子必须落在**星期表头那一列**上。上面那条只数得出"有几个横位"，它挡不住
   *   "每一行各自等分、但行与行不等"：实测月初那行的 1 号在 x=656.0 而表头第四列在 660.3
   *   —— 4px 的错位（成因写在 `CalendarYearBoard.tsx` 的 `day` 那里），而一格总共才 29px，
   *   这个量级是看得见的歪。
   *   容差 1.5px：亚像素分配的取整误差在 ±1px 以内，再大就不是舍入。
   */
  const headerX = await yearCards(page)
    .filter({ has: page.locator(`[data-testid="calendar-board-year-day-${iso(today)}"]`) })
    .locator('[data-testid$="-weekdays"] > *')
    .evaluateAll((els) => els.map((el) => el.getBoundingClientRect().x));
  expect(headerX.length, '本月那张卡的星期表头不是 7 个槽位').toBe(7);
  for (const cell of monthCells) {
    const drift = Math.min(...headerX.map((hx) => Math.abs(hx - cell.x)));
    expect(
      drift,
      `格子 x=${cell.x.toFixed(1)} 离最近那列表头差 ${drift.toFixed(1)}px ⇒ 行与行没对齐（表头：` +
        `${headerX.map((hx) => hx.toFixed(1)).join(' ')}）`,
    ).toBeLessThanOrEqual(1.5);
  }

  /*
   * ② 不溢出：最右那张卡的右边必须在内容盒内。
   * 参照是**内容盒**而不是视口 —— 页头与内边距会把两者拉开（日档那条同一条纪律）。
   */
  const content = await page.locator(CONTENT).evaluate((el) => {
    const cs = getComputedStyle(el);
    const box = el.getBoundingClientRect();
    return {
      left: box.left + Number.parseFloat(cs.paddingLeft),
      right: box.right - Number.parseFloat(cs.paddingRight),
    };
  });
  const maxRight = Math.max(...boxes.map((b) => b.right));
  expect(
    maxRight,
    `最右的卡伸到 ${String(maxRight)}，内容盒右边界 ${String(content.right)} ⇒ 出现了横向溢出`,
  ).toBeLessThanOrEqual(content.right + 1);
  expect(Math.min(...boxes.map((b) => b.x))).toBeGreaterThanOrEqual(content.left - 1);

  /*
   * ③ 今天：读屏属性在**整年**里恰好一条，且落在今天那一格。
   * 一屏三百多个数字里"哪天是今天"若只靠一圈边框，读屏用户就只剩猜。
   */
  const marked = page.locator('[data-testid^="calendar-board-year-day-"][aria-current]');
  await expect(marked).toHaveCount(1);
  await expect(marked).toHaveAttribute('aria-current', 'date');
  expect(await marked.getAttribute('data-testid')).toBe(
    `calendar-board-year-day-${iso(today)}`,
  );

  // ④ 有截止任务的那一天画点（数据决定，不是 CSS 决定）。
  await expect(
    page.locator(`[data-testid="calendar-board-year-day-${iso(today)}-dot"]`),
  ).toHaveCount(1);

  // ⑤ 年档**不画**月档那 42 格（换布局，不是叠一层）。
  await expect(page.locator('[data-testid^="calendar-cell-"]')).toHaveCount(0);

  /*
   * ⑥ 再拍一张**滚到底**的（12 月那张卡）。
   * ⚠️ 不能用 `fullPage: true` 代替：12 张卡住在 `ScrollView`（`-scroll` 那一层）里，
   *   整页截图拍不进滚动容器（这条线已经踩过一次），
   *   于是"9~12 月长什么样"在人眼里永远是空白 —— 而那正是这一屏的全部内容。
   */
  const lastMonthCard = page.locator(
    `[data-testid="calendar-board-year-month-${String(today.getFullYear())}-12"]`,
  );
  await lastMonthCard.scrollIntoViewIfNeeded();
  await expect(lastMonthCard).toBeVisible();
  await page.screenshot({ path: SHOT('year-bottom'), fullPage: false });

  expect(errors, `控制台报错：${errors.join(' | ')}`).toEqual([]);
});

test('🔴 点 `›` 是**翻一年**：标题换年、12 张卡整批换月，而"今天"那一条标记跟过去', async ({
  page,
}) => {
  const errors = watchConsole(page);
  await page.setViewportSize({ width: 1280, height: 720 });
  await openApp(page, APP_ZH);
  await gotoCalendarYear(page);

  const year = new Date().getFullYear();
  expect(await page.locator(TITLE).textContent()).toContain(String(year));
  const janThisYear = `calendar-board-year-month-${String(year)}-01`;
  await expect(page.locator(`[data-testid="${janThisYear}"]`)).toHaveCount(1);

  await page.locator(NEXT).click();
  const next = year + 1;
  expect(await page.locator(TITLE).textContent(), '翻页之后标题没换年 ⇒ 翻成翻月了').toContain(
    String(next),
  );
  // 🔴 整批换月：下一年的 1 月与 12 月都在，今年的 1 月**不在**。
  await expect(
    page.locator(`[data-testid="calendar-board-year-month-${String(next)}-01"]`),
  ).toHaveCount(1);
  await expect(
    page.locator(`[data-testid="calendar-board-year-month-${String(next)}-12"]`),
  ).toHaveCount(1);
  await expect(page.locator(`[data-testid="${janThisYear}"]`)).toHaveCount(0);
  // 翻到明年，"今天"这一格就不该再有标记（不是跟着卡数走的那种假绿）。
  await expect(
    page.locator('[data-testid^="calendar-board-year-day-"][aria-current]'),
  ).toHaveCount(0);
  await page.screenshot({ path: SHOT('year-next'), fullPage: false });
  expect(errors, `控制台报错：${errors.join(' | ')}`).toEqual([]);
});

test('🔴 点一张月卡 ⇒ 钻进取代总览，而**选中的那天不许被顺手改掉**', async ({ page }) => {
  const errors = watchConsole(page);
  await page.setViewportSize({ width: 1280, height: 720 });
  await openApp(page, APP_ZH);
  await seedToday(page, `钻取不被劫持-${STAMP}`);
  await gotoCalendarYear(page);

  const today = new Date();
  const yyyymm = iso(today).slice(0, 7);
  // 点**本月**那张卡：这样"选中的那天"就落在切过去的月历里，看得见它在哪一格。
  await page.locator(`[data-testid="calendar-board-year-month-${yyyymm}"]`).click();
  await page.screenshot({ path: SHOT('year-drilled'), fullPage: false });

  // ① 档位真的走了：年板没了、月历回来了，且看着这个月。
  await expect(page.locator(YEAR_BOARD)).toHaveCount(0);
  await expect(page.locator(MONTH_CARD)).toBeVisible();
  expect(await page.locator(TITLE).textContent()).toContain(`${String(today.getFullYear())}年`);
  // ② 🔴 选中仍是**今天**（整块月历里只有一格带 `aria-selected="true"`）。
  //    劫持的写法会把选中改成当月 1 号 —— 症状是"我在年档翻了个月份，
  //    结果清单里选中的日子换成了那月 1 号"，界面上不报错。
  //    ⚠️ 今天恰好像是 1 号时这一条分不出两者（同格）；那条区分由
  //      `apps/web/tests/calendar-view-family.spec.tsx` 里显式把 selected 钉在
  //      非 1 号的那天来负责。这里不假装它比实际更强。
  const selected = page.locator('[data-testid^="calendar-cell-"][aria-selected="true"]');
  await expect(selected).toHaveCount(1);
  expect(await selected.getAttribute('data-testid')).toBe(`calendar-cell-${iso(today)}`);
  // ③ 档位下拉说的是「月」，不是仍停在「年」。
  await expect(page.locator(VIEW_SELECT)).toHaveValue('month');
  expect(errors, `控制台报错：${errors.join(' | ')}`).toEqual([]);
});
