/**
 * 习惯月历 + 可点补打卡（工单 H4）的**真浏览器**判据
 * =================================================
 *
 * 🔴 这一族存在的理由不是"再测一遍 jsdom"。`apps/web/tests/habit-trend-month-board.spec.tsx`
 * 已经钉过"点了哪一格发什么"。这里只回答**只有真浏览器能回答**的四件事：
 *
 *   1. **落盘**：补的打卡在刷新后还在（jsdom 里那棵根一拆就没磁盘了）；
 *   2. 🔴 **几何**：42 格每格都得**够大、够得着、不被面板裁掉**。
 *      这是 H3 看图照出来那一族的**前置**（`toBeVisible()` 只验"有非空 bounding box"，
 *      不验在不在视口里），也钉住"格子从 16px 的装饰 `View` 变成可点"这件事真的发生了；
 *   3. 🔴 **不可点那一侧真的有牙**：把所有 `aria-disabled` 的格点一遍，
 *      打卡总数**一条都不许多**。正向对照是 R2（点一格可补的，总数 +1）——
 *      没有那条对照，这条会因为"两边都不发消息"而假绿；
 *   4. **频次联动**：把习惯改成「每周挑几天」之后，月历上非档期那几格必须说
 *      "这天本来不用打卡"。这一条是 **H5 与 H4 之间那条接缝**唯一有人守的证据。
 *
 * 载体：`vite preview` + `apps/web/dist`（见 `playwright.detail-pane.config.ts` 文件头）。
 * ⚠️ 改了 `apps/web` 或 `packages/*` **必须先重打**，否则测的是旧产物（§7 第 27 条）：
 *     pnpm --filter @heyta/ui build && pnpm --filter @heyta/app-host build \
 *       && pnpm --filter @heyta/web build
 * 跑法：
 *     cd e2e && npx playwright test tests/habit-month.spec.ts \
 *       --config playwright.detail-pane.config.ts
 */
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';

import { addHabit, boxOf, openApp, selectHabit, switchView } from './helpers';

const APP_ZH = '/?lang=zh-CN';

const SHOT = (name: string) =>
  fileURLToPath(new URL(`../../apps/web/evidence/habit-month/${name}.png`, import.meta.url));

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

const month = (page: Page) => page.getByTestId('habit-trend-month');
const cells = (page: Page) => page.locator('[data-testid^="habit-trend-month-cell-"]');
const cellAt = (page: Page, date: string) => page.getByTestId(`habit-trend-month-cell-${date}`);

/** 当前视图里"已打卡"的格数（负向那一条的分母）。 */
async function loggedCount(page: Page): Promise<number> {
  return page.locator('[data-testid^="habit-trend-month-cell-"][aria-label*="已打卡"]').count();
}

async function labelOf(page: Page, date: string): Promise<string> {
  return (await cellAt(page, date).getAttribute('aria-label')) ?? '';
}

/** 按 `‹` 翻到上一月。 */
async function prevMonth(page: Page): Promise<void> {
  await page.getByTestId('habit-trend-month-prev').click();
}

test.describe('习惯月历与补打卡（H4，web 端）', () => {
  test.beforeEach(async ({ page }) => {
    await openApp(page, APP_ZH);
    await switchView(page, '习惯');
  });

  test('R1 整块月历可见、42 格、每格够触屏、不被面板裁掉', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    page.on('pageerror', (e) => errors.push(String(e)));

    await addHabit(page, '月历读屏');
    await selectHabit(page, '月历读屏');

    await expect(month(page), '详情面里没有那块月历').toBeVisible();
    await expect(cells(page), '月历不是 6×7=42 格').toHaveCount(42);

    const pane = await boxOf(page, month(page), '月历本体');
    const box = await boxOf(page, cellAt(page, TODAY), '今天那一格');
    /* 🔴 三条各自独立的几何判据，一条都不合并 —— 第一版这里写的是"每格 ≥43×43"，
       它把两件事混在一个数字里：格子够不够大、格子有没有被裁掉（§7 第 86 条那一族）。
       分开之后它当场照出真缺陷：`touch-target.min`(44) × 7 列 = 332 > 288 的中栏，
       右边那一列整列在面板外，而"格子的 boundingBox 非空"对此一无所知。 */
    // a) **高度**守 44px 这条硬下限（`tokens.css`："44px 是可访问性硬下限，不许调小"）；
    //    热力图那 16px 的装饰格如果直接搬过来当按钮，红的就是这一条。
    expect(box.height, `格子只有 ${String(box.height)}px 高`).toBeGreaterThanOrEqual(43);
    // b) 全部 42 格**都在面板右边界内**（存在性判据：不是"我以为可见的那几格"）。
    const rects = await cells(page).evaluateAll((nodes) =>
      nodes.map((n) => {
        const r = (n as HTMLElement).getBoundingClientRect();
        return { x: r.x, right: r.right, width: r.width, height: r.height };
      }),
    );
    expect(rects.length, '月历不是 6×7=42 格').toBe(42);
    const outside = rects.filter((r) => r.right > pane.x + pane.width + 1);
    expect(
      outside.length,
      `${String(outside.length)} 格被面板横向裁掉 ⇒ 右边那一列看不见也点不着`,
    ).toBe(0);
    // c) 宽度不判 44（窄栏里 7×44 装不下，见 `HabitMonthBoard` 的 `cell` 那条取舍），
    //    但**下限是 WCAG 2.5.8 的 24×24**，不是拍出来的数。
    const minW = Math.min(...rects.map((r) => r.width));
    expect(minW, `最窄那一格只有 ${String(minW)}px`).toBeGreaterThanOrEqual(24);
    /* 列头与格子必须同序、对齐成 7 列。
       ⚠️ 不写"7 个不同的 x"：格宽是 `(面板宽 − 6×空隙)/7`，量出来是带小数的，
       同一列在六行里能差 0.3px —— 取整也会把某一列劈成两个。改成**以第一行的七个
       落点为锚**（列数由它自己给出），再要求其余 35 格各自落在某个锚的 2px 内。 */
    const anchors = rects.slice(0, 7).map((r) => Math.round(r.x));
    expect(new Set(anchors).size, '第一行就不是一行七列').toBe(7);
    const misaligned = rects.filter((r) => !anchors.some((a) => Math.abs(Math.round(r.x) - a) <= 2));
    expect(
      misaligned.length,
      `${String(misaligned.length)} 格没有落在第一行那七列上 ⇒ 列头与格子会错位`,
    ).toBe(0);
    // 溢出（换一种机制的同一件事：`scrollWidth` 量的是内容，不是视口）。
    const scrollWidth = await month(page).evaluate((el) => el.scrollWidth);
    expect(scrollWidth, '月历横向溢出容器 ⇒ 右边那列格子看不见').toBeLessThanOrEqual(
      pane.width + 1,
    );

    await page.screenshot({ path: SHOT('month-default'), fullPage: false });
    /* 🔴 再来一张**整块月历的元素截图**：视口截图里这块板在折叠线以下，
       六行只能看见两行 —— 而 §6.2 规定一要的是"人看得懂这张图在验什么"。
       元素截图会把那一块滚进视野再按它自己的盒子截，六行 42 格全在里面。 */
    await month(page).screenshot({ path: SHOT('month-board') });
    expect(errors, `控制台有报错：${errors.join(' | ')}`).toEqual([]);
  });

  test('R2 🔴 点昨天 = 补到**那一天**，刷新之后还在', async ({ page }) => {
    await addHabit(page, '补打卡落盘');
    await selectHabit(page, '补打卡落盘');

    const before = await loggedCount(page);
    /* 🔴 可点那一格判"不是 true"，不判"等于 false"。实测：真浏览器里 RNW 给可点的
       `Pressable` 落的是 `aria-disabled=""`（空串），jsdom 里则是**没有这个属性**
       （`apps/web/tests/habit-trend-month-board.spec.tsx` V5 早按后者写过）——
       两种都过"不是 true"，而"等于 false"在两边都红。 */
    await expect(cellAt(page, YESTERDAY)).not.toHaveAttribute('aria-disabled', 'true');
    await cellAt(page, YESTERDAY).click();
    await expect
      .poll(() => labelOf(page, YESTERDAY), { message: '点了昨天而那一格没变成已打卡' })
      .toContain('已打卡');
    expect(await loggedCount(page), '打卡总数没 +1 ⇒ 记到的不是这一格').toBe(before + 1);

    // 刷新：磁盘上真的有这一天（jsdom 测不到这一层）。
    await page.reload();
    await switchView(page, '习惯');
    await selectHabit(page, '补打卡落盘');
    await expect
      .poll(() => labelOf(page, YESTERDAY), {
        message: '刷新后那一天不再是"已打卡" ⇒ 落盘的不是这一天',
      })
      .toContain('已打卡');

    await month(page).screenshot({ path: SHOT('month-backfilled') });
  });

  test('R3 再点一次是撤销，回到"可以补打卡"', async ({ page }) => {
    await addHabit(page, '撤销补卡');
    await selectHabit(page, '撤销补卡');
    await cellAt(page, YESTERDAY).click();
    await expect
      .poll(() => labelOf(page, YESTERDAY))
      .toContain('已打卡');
    await cellAt(page, YESTERDAY).click();
    await expect
      .poll(() => labelOf(page, YESTERDAY), { message: '撤销后没说回"可以补打卡"' })
      .toContain('可以补打卡');
  });

  test('R4 🔴 不可点的那些格一条 op 都不发（点遍它们，打卡总数不变）', async ({ page }) => {
    await addHabit(page, '不可点');
    await selectHabit(page, '不可点');

    // 翻到上一月：那里**一定**有超窗的格子（上个月 1 号距今 ≥ 28 天，
    // 而默认窗口是从韧性层推导的 1 天 —— 用上月而不是本月月初，月初那几天没有"超窗"可点）。
    await prevMonth(page);
    const disabled = page.locator('[data-testid^="habit-trend-month-cell-"][aria-disabled="true"]');
    const count = await disabled.count();
    expect(count, '上一月视图里一个不可点的格子都没有 ⇒ 这条判据会空跑').toBeGreaterThan(0);

    const before = await loggedCount(page);
    for (let i = 0; i < count; i += 1) {
      const node = disabled.nth(i);
      const label = (await node.getAttribute('aria-label')) ?? '';
      // 三档不可点各有句子，补白格另有第七种读数（"邻月的日子"）：
      // 上一月视图里的"今天"就是那种补白格，按状态念会说"今天还没打卡"而点不动。
      expect(
        /已超过补打卡窗口|还没到这天|这天本来不用打|邻月的日子/.test(label),
        `不可点的格子说不出为什么：${label}`,
      ).toBe(true);
      await node.click({ force: true });
    }
    expect(await loggedCount(page), '点了不可点的格子而打卡数变了').toBe(before);
    // 正向对照（R2）：可点的那一格按下去**会** +1 —— 没有它，这条会因为"两边都不发"假绿。
    await page.getByTestId('habit-trend-month-next').click();
    await expect
      .poll(() => labelOf(page, YESTERDAY))
      .toContain('可以补打卡');
    await cellAt(page, YESTERDAY).click();
    await expect
      .poll(() => labelOf(page, YESTERDAY))
      .toContain('已打卡');
    expect(await loggedCount(page)).toBe(before + 1);

    await month(page).screenshot({ path: SHOT('month-disabled') });
  });

  test('R5 🔴 翻月不许越过当前月，而往前翻换的是一整月', async ({ page }) => {
    await addHabit(page, '翻月');
    await selectHabit(page, '翻月');

    const next = page.getByTestId('habit-trend-month-next');
    await expect(next, '当月那颗"下个月"应该是禁用的').toHaveAttribute('aria-disabled', 'true');

    const titleBefore = (await month(page).evaluate((el) => el.textContent)) ?? '';
    await prevMonth(page);
    const titleAfter = (await month(page).evaluate((el) => el.textContent)) ?? '';
    expect(titleAfter, '翻月只换了标题没换格子').not.toBe(titleBefore);
    // 上一月的 key 从**日期本身**推（不写死 '2026-09'：那在 1 月会指到 2025-12，
    // 而写死的分支本身就是第二个判断）。
    const anchor = new Date();
    anchor.setDate(1);
    anchor.setMonth(anchor.getMonth() - 1);
    const prevKey = `${String(anchor.getFullYear())}-${String(anchor.getMonth() + 1).padStart(2, '0')}`;
    await expect(
      page.locator(`[data-testid^="habit-trend-month-cell-${prevKey}"]`).first(),
      '上一月视图里没有属于上一月的格子',
    ).toBeVisible();
    /* 🔴 证据要拍**在它说的那个状态上**：第一版这张图拍在"又点回当月"之后，
       于是 `month-prev.png` 里印的标题是"2026年10月" —— 一张写着 10 月的图给"上一月"当证据，
       看图的人会先怀疑判据。现在它在上一月视图里就地截整块板。 */
    await month(page).screenshot({ path: SHOT('month-prev') });
    // 到了上一月，"下个月"就又能按了（封顶只封当前月之后）。
    // 同 R2：可点侧落的是 `aria-disabled=""` / 属性缺席，不是字面 "false"。
    await expect(next).not.toHaveAttribute('aria-disabled', 'true');
    await next.click();
    await expect
      .poll(() => labelOf(page, TODAY))
      .toMatch(/今天还没打卡|已打卡/);
  });

  test('R6 🔴 频次改档后，月历上非档期那几格说"这天本来不用打"（H5↔H4 的接缝）', async ({ page }) => {
    await addHabit(page, '每周一做');
    await selectHabit(page, '每周一做');

    // 用 H5 那个编辑器把频次切成"每周（今天那一档）"。
    const toggle = page.getByRole('button', { name: '「每周一做」的频次' }).first();
    if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
    /* 🔴 那颗 chip 的**全名**是「每周挑几天」。第一版这里写的是 `name: '每周'`，
       而 `getByRole` 的字符串名默认是**子串、不区分大小写** —— 于是 `.first()`
       命中的是外面那颗开关（它的 `aria-label` 是「「每周一做」的频次」，习惯名里
       恰好带着"每周"两个字），点下去把面板**收起来了**，频次一个字都没改。
       症状是"上一月里没有非档期格"，看起来像产品缺陷。教训与 §7 第 46 条同族：
       **前提没成立时，判据红在别处**。修法不是加 sleep，是把前提本身钉成断言（下一行）。 */
    const weeklyChip = page.getByRole('button', { name: '每周挑几天', exact: true });
    await weeklyChip.click();
    /* 前提钉成断言：那颗 chip 自己按 `frequency` prop 算出 `aria-pressed`，
       所以"它变成按下态"证明的是**这条 op 穿过 op-log、回到界面用的那份习惯上**。
       没有这一行，下面那句"上一月里没有非档期格"会因为"频次根本没改"而红，
       读起来像月历的缺陷（第一版就红在这里，见上面的注释）。 */
    await expect(weeklyChip, '切了"每周挑几天"而 chip 没变成按下态 ⇒ 频次没落').toHaveAttribute(
      'aria-pressed',
      'true',
    );

    // 让判定穿过：翻到上一月去看**同一种习惯**的那些日子。
    await prevMonth(page);
    const notScheduled = page.locator(
      '[data-testid^="habit-trend-month-cell-"][aria-label*="这天本来不用打"]',
    );
    const n = await notScheduled.count();
    // 阳性对照：这一档必须**真的存在**（一周只挑一天 ⇒ 上一月里至少 20 天不在档上）。
    expect(n, '改成每周一档之后，月历上没有"本来不用打"那档').toBeGreaterThan(15);
    const before = await loggedCount(page);
    await notScheduled.first().click({ force: true });
    expect(await loggedCount(page), '点了非档期那一天，等于凭空造了一个要求').toBe(before);

    await month(page).screenshot({ path: SHOT('month-weekly') });
  });

  test('R7 🔴 暗色**真的**切过去再看（`emulateMedia` 不算，它切不动 `html[data-theme]`）', async ({ page }) => {
    await addHabit(page, '暗色月历');
    await selectHabit(page, '暗色月历');
    /* 🔴 这一条第一版是**安静的假绿**：它写 `emulateMedia({colorScheme:'dark'})`，
       而主题在应用**启动时**由 `heyta.theme` / `prefers-color-scheme` 算一次，写进
       `<html data-theme>`（`apps/web/src/lib/theme.ts:41` 那段"刻意不写盘"的理由就在这）——
       **导航之后**再模拟媒体查询不会重算，于是 `month-dark.png` 与 `month-board.png`
       **逐字节相同**（本轮 md5 对过：`2a44c312…` 两枚同一枚），而当时那两条断言
       （可见 + 42 格）在亮色下照样过。名字比断言强，就是假绿。
       ⇒ 做法照 `e2e/tests/habit-month-stats.spec.ts` M4 与 `calendar-cells.spec.ts:382`：
         **点产品自己那颗开关**，然后钉两件事 —— 属性真的翻了（必要条件），
         **格子上那个真正画出来的底色真的变了**（充分条件：属性是可以被人直接改的，
         只断属性等于"我以为切了"）。底色取格子而不是取容器：容器那一格没有背景，
         读回来两趟都是 `rgba(0, 0, 0, 0)`，那条断言就会恒真。 */
    const bgBefore = await cellAt(page, TODAY).evaluate((el) => getComputedStyle(el).backgroundColor);
    await page.getByRole('button', { name: '切换到暗色主题' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    const bgAfter = await cellAt(page, TODAY).evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(
      bgAfter,
      `切了暗色而格子底色没变（${bgBefore} → ${bgAfter}）⇒ 下面这张图还是亮色的`,
    ).not.toBe(bgBefore);
    await expect(month(page)).toBeVisible();
    await expect(cells(page)).toHaveCount(42);
    await month(page).screenshot({ path: SHOT('month-dark') });
  });
});
