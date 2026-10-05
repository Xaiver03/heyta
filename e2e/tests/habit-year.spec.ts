/**
 * 习惯**年**视图（12 张月卡）的**真浏览器**判据（工单 H7）
 * =====================================================
 *
 * 载体：`vite preview` + `apps/web/dist`（见 `playwright.detail-pane.config.ts` 文件头）。
 * ⚠️ 改了 `apps/web` 或 `packages/*` **必须先重打**，否则测的是旧产物（§7 第 27 条）：
 *     pnpm --filter @heyta/ui build && pnpm --filter @heyta/web build
 * 跑法：
 *     cd e2e && npx playwright test tests/habit-year.spec.ts \
 *       --config playwright.detail-pane.config.ts
 *
 * 🔴 这一族只回答**只有真浏览器能回答**的四件事（`Z` 组在 jsdom 里已经钉过档位与游标）：
 *
 *   S1 **几何**：12 张卡全在、每张都在容器里、而且**真的换了行**。
 *      `CalendarYearBoard` 文件头记着同一形状的事故：`flexBasis:0 + flexGrow:1` 配
 *      `flexWrap` **永远换不了行**，31 天挤在同一行互相压字，而"数节点"的单测数得出 31 个。
 *      年这一档有 12 枚，是同一个坑最容易再犯一次的地方 ⇒ 行数由图量出来，不由节点数出来。
 *   S2 **游标交得出去**：点一张年卡之后，月那一档的**标题**是那一月（不是只有档位换了）。
 *   S3 **不可点那侧真的有牙**：年这一档不写任何东西（写是月历那一档的事，牙在 R4），
 *      所以这里判的是"点了不许换游标、也不许换档"。
 *   S4 🔴 **两个视图读同一把尺**：月历上打了 N 格，年卡上那一月就读"达成 N 天"。
 *      这条是 H7 唯一能在**浏览器 + 真落盘**这一层证明"年没有第二套算式"的判据 ——
 *      jsdom 的 Z7 用的是桩 logs，磁盘上什么都没写。
 *   S5 🔴 暗色**真的**切过去（点产品那颗开关；`emulateMedia` 切不动 `html[data-theme]`）。
 *   S6 翻年不许越过当前年，而翻到上一年**十二张卡全是那一年**（存在性判据，不是"我以为的那几张"）。
 */
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';

import { addHabit, boxOf, openApp, selectHabit, switchView } from './helpers';

const APP_ZH = '/?lang=zh-CN';

const SHOT = (name: string) =>
  fileURLToPath(new URL(`../../apps/web/evidence/habit-year/${name}.png`, import.meta.url));

/** 本地日期的 `YYYY-MM-DD`（**不**用 UTC：应用读的是本地日）。 */
function localDate(offsetDays: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${String(d.getFullYear())}-${m}-${day}`;
}

const TODAY = localDate(0);
const YESTERDAY = localDate(-1);
/** 当前那一月（年卡与月历标题都由它寻址，不写死月份）。 */
const THIS_MONTH = TODAY.slice(0, 7);
const NOW_YEAR = Number(TODAY.slice(0, 4));

const tabs = (page: Page, kind: 'month' | 'year') => page.getByTestId(`habit-trend-tabs-${kind}`);
const yearBoard = (page: Page) => page.getByTestId('habit-trend-year');
const cards = (page: Page) => page.locator('[data-testid^="habit-trend-year-month-"]');
const cardAt = (page: Page, monthKey: string) =>
  page.getByTestId(`habit-trend-year-month-${monthKey}`);
const monthCell = (page: Page, date: string) => page.getByTestId(`habit-trend-month-cell-${date}`);
/** 本月视图里"已打卡"的格数（S4 的两边之一，也是 S3 的分母）。 */
const loggedCells = (page: Page) =>
  page.locator('[data-testid^="habit-trend-month-cell-"][aria-label*="已打卡"]');

async function goYear(page: Page): Promise<void> {
  await tabs(page, 'year').click();
  await expect(yearBoard(page)).toBeVisible();
}

/** 月历那一档的标题（共享 `formatMonthTitleText` 的产出，形如"2026年10月"）。 */
async function monthTitle(page: Page): Promise<string> {
  const text = await page.getByTestId('habit-trend-month').evaluate((el) => el.textContent ?? '');
  const found = text.match(/\d{4}年\d{1,2}月/);
  return found === null ? '' : found[0];
}

/** `'YYYY-MM'` → 那一月标题的**字面**（同一个构造器：`{year}年{month}月`，月份不补零）。 */
const titleOfMonth = (monthKey: string): string =>
  `${monthKey.slice(0, 4)}年${String(Number(monthKey.slice(5, 7)))}月`;

/**
 * 找到**当前屏上真的存在**的一张过去的年卡并返回它的 `YYYY-MM`。
 *
 * 🔴 不能直接写"上一月"：今天是 1 号时上一月属于**上一年**，而年视图只画当前那一年
 *   —— 用例就会红在"找不到那张卡"上，长得像产品坏了。1 月跑的时候先翻到上一年再取 12 月。
 *   这不是给判据打补丁：判的对象是"点一张过去的卡"，那"过去的卡"就得按同一枚游标算出来。
 */
async function pickPastMonth(page: Page): Promise<string> {
  const monthNumber = Number(TODAY.slice(5, 7));
  if (monthNumber > 1) return `${String(NOW_YEAR)}-01`;
  await page.getByTestId('habit-trend-year-prev').click();
  await expect(yearBoard(page)).toContainText(`${String(NOW_YEAR - 1)}年`);
  return `${String(NOW_YEAR - 1)}-12`;
}

/**
 * 拍**整块年视图**，并且把"这张图真的拍全了 12 枚"钉成断言。
 *
 * 🔴 为什么不能在默认视口里直接拍：年视图只是详情栏里的**一节**，它上面还有标题行、
 *   三个数字、频次、图标那一排、档位切换器（现量：那一格 `scrollHeight=1382`、
 *   `clientHeight=720`），所以"12 枚全在折叠线以上"这个前提在 720 高的窗口里
 *   **根本不可能成立** —— 第一版把它写成判据，红在 12/12，那条红的是判据自己
 *   （§7 元规则 1：先怀疑探针）。
 *   而 Playwright 的**元素截图只拍到视口为止**，滚出去的那截不会拼回来：
 *   于是 `year-12cards` / `year-consistency` / `year-future` 三张**不同状态**的图
 *   md5 逐字相同（都只拍到第 7 枚），而 S4 断言的"当前那一月"压根不在图上。
 *   ⇒ 截图前把视口给足（`setViewportSize` 之后 `100dvh` 跟着变），把这块板滚到顶，
 *     再**量** 12 枚的盒子确实都在视口里 —— 图证的完整性由断言保证，
 *     不等下一次看图的人发现"这张图缺后半截"。
 */
async function shootYearBoard(page: Page, name: string): Promise<void> {
  const size = page.viewportSize() ?? { width: 1280, height: 720 };
  await page.setViewportSize({ width: size.width, height: 1600 });
  await yearBoard(page).evaluate((el) => el.scrollIntoView({ block: 'start' }));
  const boxes = await cards(page).evaluateAll((nodes) =>
    nodes.map((n) => {
      const r = (n as HTMLElement).getBoundingClientRect();
      return { top: Math.round(r.top), bottom: Math.round(r.bottom) };
    }),
  );
  const vh = await page.evaluate(() => window.innerHeight);
  const off = boxes.filter((b) => b.top < 0 || b.bottom > vh);
  expect(
    off.length,
    `${String(off.length)} 枚年卡被视口裁掉 ⇒ 这张图拍不全它声称的状态（vh=${String(vh)}，` +
      `第一枚 ${JSON.stringify(boxes[0])}，最后一枚 ${JSON.stringify(boxes[boxes.length - 1])}）`,
  ).toBe(0);
  await yearBoard(page).screenshot({ path: SHOT(name) });
}

test.describe('习惯年视图（H7，web 端）', () => {
  test.beforeEach(async ({ page }) => {
    await openApp(page, APP_ZH);
    await switchView(page, '习惯');
  });

  test('S1 十二张卡全在、每张都在框里、而且真的换了行', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    page.on('pageerror', (e) => errors.push(String(e)));

    await addHabit(page, '年卡几何');
    await selectHabit(page, '年卡几何');
    await goYear(page);

    await expect(cards(page), '年卡不是 12 张').toHaveCount(12);

    const pane = await boxOf(page, yearBoard(page), '年视图本体');
    const rects = await cards(page).evaluateAll((nodes) =>
      nodes.map((n) => {
        const r = (n as HTMLElement).getBoundingClientRect();
        return { x: r.x, y: r.y, right: r.right, width: r.width, height: r.height };
      }),
    );
    expect(rects.length, '量不到那 12 张卡的盒子').toBe(12);
    // a) 每张卡的右边界都在容器内（存在性判据：不是"我以为可见的那几张"）。
    const outside = rects.filter((r) => r.right > pane.x + pane.width + 1);
    expect(
      outside.length,
      `${String(outside.length)} 张卡被面板横向裁掉 ⇒ 右边那几张看不见也点不着`,
    ).toBe(0);
    // b) 每张卡都得有尺寸（0 宽是"flexBasis:0 却没换行"那一族的另一半症状）。
    const zero = rects.filter((r) => r.width < 60 || r.height < 40);
    expect(
      zero.length,
      `${String(zero.length)} 张卡小得读不出字（两列百分比没生效）`,
    ).toBe(0);
    // c) 🔴 **真的分行**：`flexWrap` 配 `flexBasis:0` 永远不换行，而十二枚挤一行
    //    在截图里长得像"卡很窄"，只有行数能区分。
    const rows = new Set(rects.map((r) => Math.round(r.y)));
    expect(rows.size, '12 张卡挤在同一行 ⇒ 换行没生效').toBeGreaterThan(1);
    // d) 每一行内部不许互相压字。
    const overlap = rects.filter((a) =>
      rects.some(
        (b) =>
          b !== a &&
          Math.round(a.y) === Math.round(b.y) &&
          Math.round(a.right) > Math.round(b.x) + 1 &&
          Math.round(b.right) > Math.round(a.x) + 1,
      ),
    );
    expect(overlap.length, `${String(overlap.length)} 张卡在同一行里重叠`).toBe(0);
    /* e) 图证的完整性交给 `shootYearBoard`：它先给足视口、把这块板滚到顶，
       再量 12 枚是不是**真的都在画面里**。第一版这里写的是一条"12 枚全在折叠线以上"
       的判据，而那条红在 12/12 —— 红的是判据自己：年视图只是详情栏的一节，
       它上面还有标题行/三个数字/频次/图标/档位切换器（现量 `scrollHeight=1382`、
       `clientHeight=720`），720 高的窗口里那个前提**永远不成立**（§7 元规则 1）。
       真正坏的是**图**：元素截图只拍到视口为止，于是三张不同状态的图 md5 逐字相同、
       都停在第 7 枚，而 S4 断言的那一月不在图上。 */
    await shootYearBoard(page, 'year-12cards');
    expect(errors, `控制台有报错：${errors.join(' | ')}`).toEqual([]);
  });

  test('S2 🔴 点一张年卡 = 月那一档画的**就是那一月**（不是只换了档位）', async ({ page }) => {
    await addHabit(page, '年卡跳转');
    await selectHabit(page, '年卡跳转');
    await goYear(page);

    const past = await pickPastMonth(page);
    await cardAt(page, past).click();

    await expect
      .poll(() => monthTitle(page), { message: `点了 ${past} 那张卡而月历标题没跟过去` })
      .toBe(titleOfMonth(past));
    // 档位也一起回来了：切换器说"月"而格子是月历，两边不许各讲一个故事。
    await expect(tabs(page, 'month'), '月历在画而切换器还指着年').toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(tabs(page, 'year')).toHaveAttribute('aria-selected', 'false');
    await expect(cards(page), '切回月档而年卡还在 DOM 里').toHaveCount(0);
    // 那一月真的画了 42 格。
    await expect(page.locator('[data-testid^="habit-trend-month-cell-"]')).toHaveCount(42);
    await page.getByTestId('habit-trend-month').screenshot({ path: SHOT('year-after-pick') });
  });

  test('S3 🔴 未来那几个月点不动：不换游标、不换档位、什么都不发生', async ({ page }) => {
    await addHabit(page, '未来月');
    await selectHabit(page, '未来月');
    await goYear(page);

    /* 🔴 数量由日历本身推：当前月之后还有几个月，就该有几张"还没到"的卡。
       12 月跑这条 ⇒ 期望 0 —— 那**不是空跑**，它同时钉住"不许把已经过完的那个月
       标成未来"（多标一张就会 1 ≠ 0）。 */
    const expectedFuture = 12 - Number(TODAY.slice(5, 7));
    const disabled = page.locator('[data-testid^="habit-trend-year-month-"][aria-disabled="true"]');
    await expect(disabled, '「还没到」那几张卡的数量不对').toHaveCount(expectedFuture);

    const count = await disabled.count();
    for (let i = 0; i < count; i += 1) {
      const node = disabled.nth(i);
      const label = (await node.getAttribute('aria-label')) ?? '';
      // 每张不可点的卡都要**说得出为什么**（只画灰不说原因 = 用户以为应用坏了）。
      expect(label, '不可点的年卡没说"还没到"').toContain('还没到这个月');
      await node.click({ force: true });
    }
    /* ⚠️ 这一条判的是"点了不许换游标、不许换档"，**不是**"点了不许发消息"：
       年这一档没有写路径（唯一的写入口是月历那一格，牙在 `habit-month.spec.ts` 的 R4）。
       把它写成"不发消息"会是一条永远绿的判据 —— 而它挡不住真的坏（点了以后界面跳到别处）。 */
    await expect(tabs(page, 'year'), '点了一张未来的年卡竟然换了档').toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(cards(page)).toHaveCount(12);
    await expect(page.locator('[data-testid^="habit-trend-month-cell-"]')).toHaveCount(0);

    // 阳性对照：**过去**的那张卡点得动（没有这一条，上面会因为"整排都不响应"假绿）。
    const past = await pickPastMonth(page);
    await cardAt(page, past).click();
    await expect(tabs(page, 'month')).toHaveAttribute('aria-selected', 'true');

    await goYear(page);
    await shootYearBoard(page, 'year-future');
  });

  test('S4 🔴 月历打了 N 格，年卡上那一月就读「达成 N 天」（两个视图同一把尺，真落盘）', async ({
    page,
  }) => {
    await addHabit(page, '年月同尺');
    await selectHabit(page, '年月同尺');

    // 打两格：今天 + 昨天（昨天靠补打卡窗口，默认 1 天正好够）。
    await expect(monthCell(page, TODAY)).not.toHaveAttribute('aria-disabled', 'true');
    await monthCell(page, TODAY).click();
    await expect
      .poll(async () => await monthCell(page, TODAY).getAttribute('aria-label'))
      .toContain('已打卡');
    await expect(monthCell(page, YESTERDAY)).not.toHaveAttribute('aria-disabled', 'true');
    await monthCell(page, YESTERDAY).click();
    await expect
      .poll(async () => await monthCell(page, YESTERDAY).getAttribute('aria-label'))
      .toContain('已打卡');

    /* 分母从**界面**读，不做日期算术：数当前那一月里已打卡的格数。
       （月初 1 号跑的时候昨天落在上一月，这个数就是 1 —— 判据照样成立，
       因为钉的是"两边读数相等"，不是"我以为该是 2"。） */
    const monthSide = await page
      .locator(
        `[data-testid^="habit-trend-month-cell-${THIS_MONTH}"][aria-label*="已打卡"]`,
      )
      .count();
    expect(monthSide, '月历上本月一个已打卡的格子都没有 ⇒ 上面那两次点击没落').toBeGreaterThan(0);

    await goYear(page);
    const card = cardAt(page, THIS_MONTH);
    await expect(card, '年视图里没有当前那一月').toBeVisible();
    await expect(card).toHaveAttribute('aria-label', new RegExp(`达成 ${String(monthSide)} 天`));
    // 可见那行也读得到同一个数（不能只喂读屏）。
    await expect(
      page.getByTestId(`habit-trend-year-achieved-${THIS_MONTH}`),
    ).toHaveText(`达成 ${String(monthSide)} 天`);
    // 汇总那一行：全年达成同一个数（这两天都在同一年）。
    await expect(yearBoard(page)).toContainText(`全年达成 ${String(monthSide)} 天`);

    await shootYearBoard(page, 'year-consistency');
  });

  test('S5 🔴 暗色**真的**切过去再看（`emulateMedia` 切不动 `html[data-theme]`）', async ({ page }) => {
    await addHabit(page, '暗色年卡');
    await selectHabit(page, '暗色年卡');
    await goYear(page);
    await expect(cards(page)).toHaveCount(12);
    /* 同 R7 那一条记账：主题在启动时算一次并写进 `<html data-theme>`，
       导航之后再模拟媒体查询不会重算 —— 第一版这张 `year-dark.png` 与
       `year-12cards.png` **逐字节相同**（md5 `439b8b47…` 四枚同一枚）。
       所以这里点产品那颗开关，并且**取一张真正画出来的卡的底色**比对
       （`cardColors` 那两档 `color.surface` / `color.disabled-bg` 都在暗色覆盖里变了）。 */
    const bgBefore = await cards(page)
      .first()
      .evaluate((el) => getComputedStyle(el).backgroundColor);
    await page.getByRole('button', { name: '切换到暗色主题' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    const bgAfter = await cards(page)
      .first()
      .evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(bgAfter, `切了暗色而年卡底色没变（${bgBefore} → ${bgAfter}）⇒ 这张图还是亮色的`).not.toBe(
      bgBefore,
    );
    // 暗色下"还没到"那几张仍然读得出（`color.disabled-fg` 反相后会糊成一片的那种坏，只有看图能抓）。
    const futureCount = await page
      .locator('[data-testid^="habit-trend-year-month-"][aria-disabled="true"]')
      .count();
    expect(futureCount).toBe(12 - Number(TODAY.slice(5, 7)));
    await shootYearBoard(page, 'year-dark');
  });

  test('S6 翻年不许越过当前年，而翻到上一年十二张卡全是那一年', async ({ page }) => {
    await addHabit(page, '翻年');
    await selectHabit(page, '翻年');
    await goYear(page);

    const next = page.getByTestId('habit-trend-year-next');
    await expect(next, '当前年之后还能翻 ⇒ 一排空卡等人预支').toHaveAttribute(
      'aria-disabled',
      'true',
    );
    await expect(yearBoard(page)).toContainText(`${String(NOW_YEAR)}年`);

    await page.getByTestId('habit-trend-year-prev').click();
    await expect(yearBoard(page)).toContainText(`${String(NOW_YEAR - 1)}年`);
    // 🔴 存在性：12 张卡**每一张**的名字都是那一年（只查第一张挡不住"标题换了卡没换"）。
    const labels = await cards(page).evaluateAll((nodes) =>
      nodes.map((n) => (n as HTMLElement).getAttribute('aria-label') ?? ''),
    );
    expect(labels).toHaveLength(12);
    const wrongYear = labels.filter((l) => !l.includes(`${String(NOW_YEAR - 1)}年`));
    expect(
      wrongYear.length,
      `${String(wrongYear.length)} 张卡没跟着换年：${wrongYear.join(' | ').slice(0, 200)}`,
    ).toBe(0);
    // 上一年**没有**未来月：整排都可点（这一条与上面那条数量判据互为对照）。
    await expect(
      page.locator('[data-testid^="habit-trend-year-month-"][aria-disabled="true"]'),
    ).toHaveCount(0);
    await shootYearBoard(page, 'year-prev');

    await next.click();
    await expect(yearBoard(page)).toContainText(`${String(NOW_YEAR)}年`);
    await expect(next, '翻回当年后"下一年"没重新封顶').toHaveAttribute('aria-disabled', 'true');
  });
});
