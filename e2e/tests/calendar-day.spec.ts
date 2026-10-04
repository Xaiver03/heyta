/**
 * 日历**日视图**（R11 批四）—— 真浏览器里的"铺满整面 + 横向拖拽换天"
 * ===================================================================
 *
 * 产品负责人 2026-10-03 给了一张滴答桌面端「日」的截图，两句话是这一批的验收：
 *
 *   1. **"日的定义就是这样子的，就是铺满整面的。"**
 *   2. **"点今天，那个今天就自动跳转到今天来了。然后你的鼠标在这里左右滑动，
 *      就是左右拖拽滑动。那就是上一天和下一天的切换。"**
 *
 * ## 🔴 为什么这两条**只能**在真浏览器里量
 *
 * · "铺满"是 rect 上的事：jsdom 里所有 rect 都是 0，在单测里写"高度足够"
 *   会得到一条**永远通过**的判据（§7 元规则 2，比没有判据更糟）；
 * · 拖拽是 `PointerEvent` 的事：jsdom 既不合成"抬手后补发的那一次 click"，
 *   也没有选中带区。单测里绿的那条"吃 click"只证明了监听挂对了，
 *   **证明不了真鼠标拖过去不会顺手勾掉一条任务**。
 *
 * ⚠️ 更正（2026-10-03，R14 之后）：下面这段原话**已被现量否证**，留在这里是为了
 *   让人看清它错在哪 ——
 *   原文：「这里播不了"带时刻"的任务：`parseCapture` 不解析 `16:00`（实测
 *   `明天16:00 X` 的标题是「16:00 X」），而 `DueEditor` 只写本地零点 ——
 *   全应用唯一的手工时刻输入在 AI 提案面板里。所以小时轴在真数据下本来就是空的。」
 *   现在两件事都反了：`parseCapture` 认 `16:00`（有日期才成立，见
 *   `packages/domain/tests/capture.spec.ts` 的「时刻」那组），`DueEditor` 的时刻栏
 *   写的是**本地那一分钟**（`apps/web/tests/due-date-edit.spec.tsx` 的 R14 那组）。
 *   ⇒ 这一屏从此可以、而且必须验"轴上画了东西"：带时刻的任务挂在它自己那一小时，
 *   这条判据就在下面（`带时刻的任务挂在它自己那一小时`）。
 *   分桶那部分仍在 `packages/ui/tests/calendar-day-buckets.spec.ts` 与
 *   `apps/web/tests/calendar-day-view.spec.tsx`。
 */

import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

import { openApp, rowFor, switchView } from './helpers';

const APP_ZH = '/?lang=zh-CN';
const BOARD = '[data-testid="calendar-board"]';
const DAY_BOARD = '[data-testid="calendar-board-day"]';
const AXIS = '[data-testid="calendar-board-day-axis"]';
const ALL_DAY = '[data-testid="calendar-board-day-all-day"]';
const MONTH_CARD = '[data-testid="calendar-board-month-card"]';
const TITLE = '[data-testid="calendar-toolbar-month"]';
const NEXT = '[data-testid="calendar-toolbar-next"]';
const TODAY_BUTTON = '[data-testid="calendar-toolbar-today"]';
const VIEW_SELECT = '[data-testid="calendar-view-select"]';
const CONTENT = '.ht-content';
const STAMP = Date.now().toString().slice(-6);
/** 证据落在**受版本控制**的目录里（`e2e/test-results/` 每趟会被清掉，与 `calendar-year.spec.ts` 同一条约定）。 */
const SHOT = (name: string): string => `../apps/web/evidence/calendar-day-time/${name}.png`;

function watchConsole(page: Page): string[] {
  const lines: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') lines.push(`[console.error] ${msg.text()}`);
  });
  page.on('pageerror', (err) => lines.push(`[pageerror] ${err.message}`));
  return lines;
}

/**
 * 🔴 行数**不抄进这里**（抄件一定会漂），而 e2e 不在根 pnpm 工作区内、
 *   `import` 不到 `@heyta/ui` ⇒ 从源码读那一个数，**读不到就响亮地失败**。
 */
async function hoursInDay(): Promise<number> {
  const src = await readFile(
    new URL('../../packages/ui/src/calendar/model.ts', import.meta.url),
    'utf8',
  );
  const m = /export const HOURS_IN_DAY = (\d+);/u.exec(src);
  if (m === null) throw new Error('在 packages/ui/src/calendar/model.ts 里找不到 HOURS_IN_DAY');
  return Number(m[1]);
}

async function gotoCalendarDay(page: Page): Promise<void> {
  await switchView(page, '日历');
  await expect(page.locator(MONTH_CARD)).toBeVisible();
  await page.selectOption(VIEW_SELECT, 'day');
  await expect(page.locator(DAY_BOARD)).toBeVisible();
}

/** 日档正看着哪一天 —— 读页头标题里的「N月N日」，它由共享 `dayTitle` 给。 */
async function titleText(page: Page): Promise<string> {
  return (await page.locator(TITLE).textContent()) ?? '';
}

/** 本地日期的「N月N日」说法（不带补零，与共享 `formatDayTitleText` 一致）。 */
function dayPhrase(date: Date): string {
  return `${String(date.getMonth() + 1)}月${String(date.getDate())}日`;
}

/** `LocalDate` 形态（`2026-10-04`）—— testID 用的是它，不是上面那种给人看的说法。 */
function iso(date: Date): string {
  return `${String(date.getFullYear())}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate(),
  ).padStart(2, '0')}`;
}

/**
 * 真鼠标横拖。
 *
 * 🔴 必须用 `page.mouse`（不是 `dispatchEvent`）：这一条要验的就是
 *   "浏览器在抬手之后补发的那一次 click 有没有被吃掉"，
 *   自己派发事件等于把要验的东西替换成自己造的。
 */
async function dragHorizontally(page: Page, fromX: number, toX: number, y: number): Promise<void> {
  await page.mouse.move(fromX, y);
  await page.mouse.down();
  // 分三步走：一次到位的 move 在真实浏览器里也会被当成"瞬移"，
  // 而这条判据依赖的是**中间过程**里的 pointermove。
  for (let i = 1; i <= 3; i += 1) {
    await page.mouse.move(fromX + ((toX - fromX) * i) / 3, y);
  }
  await page.mouse.up();
}

/**
 * 在**任务页**播一条排到今天的事项，返回它落库后的标题。
 *
 * ⚠️ 顺序不能反：输入框住在任务页，进了日档就没有它了（`calendar-week.spec.ts` 同一条）。
 * ⚠️ 「今天」这个词会被确定性捕获**从标题里吃掉**并转成 `dueDate`（本地零点），
 *    所以落库后的标题是去掉前缀的那一段 —— 勾选框的可访问名按它写。
 */
async function seedToday(page: Page, suffix: string): Promise<string> {
  const composer = page.locator('input[placeholder^="添加任务"]');
  await composer.fill(`今天 ${suffix}`);
  await composer.press('Enter');
  await expect(page.getByRole('checkbox', { name: `完成：${suffix}` })).toBeVisible();
  return suffix;
}

test('🔴 日档把这一天摊开：全天带 + 24 行轴，而整块板子**铺满内容区**', async ({ page }) => {
  const errors = watchConsole(page);
  await page.setViewportSize({ width: 1280, height: 720 });
  await openApp(page, APP_ZH);
  const seeded = await seedToday(page, `日视图-${STAMP}`);
  await gotoCalendarDay(page);

  // 先截图，再断言（§6.2 规定一 1：失败时也要有图）。
  await page.screenshot({ path: 'test-results/calendar-day-full.png', fullPage: false });

  // ① 月历网格不在这一档（这一档是**换布局**，不是叠一层）。
  await expect(page.locator(MONTH_CARD)).toHaveCount(0);
  // ② 全天带 + 轴都在，而轴的行数 = `HOURS_IN_DAY`。
  await expect(page.locator(ALL_DAY)).toBeVisible();
  await expect(page.locator(AXIS)).toBeVisible();
  const hours = await hoursInDay();
  /*
   * 🔴 这个前缀**只属于那一行**。时刻列（`-clock-NN`）与那一小时的任务列表
   *   （`-timed-NN`）都不许以 `-hour-` 开头 —— 实测：把它们写成 `-hour-label-NN`
   *   之后这里从 24 变 48（Expected 24 / Received 48），而那正是这条判据该抓的事：
   *   "轴上有几行"是产品结论，前缀共用会让它数到别的东西。
   */
  await expect(page.locator('[data-testid^="calendar-board-day-hour-"]')).toHaveCount(hours);
  // ③ 播的那条（本地零点 = 没有时刻）必须落在**全天带**里，读得到标题。
  await expect(page.locator(ALL_DAY)).toContainText(seeded);
  // ④ 🔴 轴整列空着 ⇒ 那句说明必须在（不说就等于"这档没接上数据"）。
  await expect(page.locator('[data-testid="calendar-board-day-no-timed"]')).toBeVisible();

  /*
   * ⑤ 🔴 "铺满整面"：板子的底边必须落到内容盒的底（内边距之内）。
   *
   * 判据的参照是**内容盒**（`.ht-content` 去掉上下内边距），不是视口 ——
   * 页头、外边距都会把两者拉开，拿视口高度当参照会让这条在正确的界面上红。
   */
  const fit = await page.locator(CONTENT).evaluate((el) => {
    const cs = getComputedStyle(el);
    const box = el.getBoundingClientRect();
    const inner = box.height - Number.parseFloat(cs.paddingTop) - Number.parseFloat(cs.paddingBottom);
    const board = document
      .querySelector('[data-testid="calendar-board"]')!
      .getBoundingClientRect();
    return { inner, board: board.height, top: board.top - box.top - Number.parseFloat(cs.paddingTop) };
  });
  expect(
    fit.board,
    `日档板高 ${String(fit.board)} 没铺满内容盒 ${String(fit.inner)}（差 ${String(fit.inner - fit.board)}）`,
  ).toBeGreaterThanOrEqual(fit.inner - fit.top - 1);

  // ⑥ 现在线：看的是今天 ⇒ 轴上必须有一条"现在"，且**只有看今天时**有。
  await expect(page.locator('[data-testid="calendar-board-day-now-line"]')).toHaveCount(1);
  expect(errors, `控制台报错：${errors.join(' | ')}`).toEqual([]);
});

test('🔴 真鼠标左右拖 = 下一天 / 上一天，而且**不会顺手勾掉拖过的那条任务**', async ({ page }) => {
  const errors = watchConsole(page);
  await page.setViewportSize({ width: 1280, height: 720 });
  await openApp(page, APP_ZH);
  // 🔴 必须走 `seedToday`（标题里带「今天」让捕获解析出 `dueDate`）：
  //    直接建任务得到的是**没有截止时间**的那一种，它根本不上日历 ——
  //    那样这条判据会变成"在一块空面板上拖"，什么也证明不了。
  const title = await seedToday(page, `别拖我就被勾了-${STAMP}`);
  await gotoCalendarDay(page);

  const today = new Date();
  const tomorrow = new Date(today.getTime() + 86_400_000);
  expect(await titleText(page), '日档一开始应该看着今天').toContain(dayPhrase(today));

  // 从**那条任务那一行上**起手横拖 —— 这是最坏的情形：路径穿过一行可点的行。
  const row = page
    .locator('[data-testid="calendar-board-day-all-day"] [data-testid^="task-item-"]')
    .first();
  await expect(row).toBeVisible();
  const box = await row.boundingBox();
  expect(box, '量不到那条任务行的位置（探针坏了，不是判据红了）').not.toBeNull();
  const y = box!.y + box!.height / 2;

  /*
   * ① 往左拖 ⇒ 下一天。
   * 🔴 终点刻意落在 **x=200（内容区之外，压在侧栏上）**：
   *   第一版判据就是红在这一下 —— 移动/抬手挂在宿主上时，指针一旦拖出内容区，
   *   那些事件落在侧栏子树里冒不上来，症状是"轻轻拖有用、大幅度拖没反应"。
   *   那是**产品的缺陷**，不是判据写坏了（修法见 `useDragDayNav.ts` 文件头）。
   */
  // 详情列出现后 x=1000 已落在详情列，不能把“没在任务上按下”当成手势失败。
  // 起点由目标行实测，另用命中测试证明指针确实从这条任务开始。
  const startX = box!.x + box!.width * 0.75;
  const startsOnRow = await row.evaluate((element, point) =>
    element.contains(document.elementFromPoint(point.x, point.y)), { x: startX, y });
  expect(startsOnRow, '拖拽起点没有命中目标任务行，不能验证手势').toBe(true);
  await dragHorizontally(page, startX, 200, y);
  await page.screenshot({ path: 'test-results/calendar-day-drag-next.png', fullPage: false });
  const afterNext = await titleText(page);
  expect(afterNext, `往左拖之后标题不是下一天（实测「${afterNext}」）`).toContain(dayPhrase(tomorrow));
  // 🔴 翻到明天之后，侧栏圈住的那天必须一起走（两份状态各指一天时没有任何一层会报错）。
  await expect(
    page.locator(`[data-testid="calendar-mini-day-${iso(tomorrow)}"][aria-current="date"]`),
    '拖到明天了，侧栏迷你月历还圈着今天',
  ).toHaveCount(1);

  // ② 往右拖回来（起手必须落在内容区**里面** —— 手势的定义就是"在这一档的面板上拖"）。
  await dragHorizontally(page, 420, 1100, y);
  await page.screenshot({ path: 'test-results/calendar-day-drag-prev.png', fullPage: false });
  const afterPrev = await titleText(page);
  expect(afterPrev, `往右拖之后没回到今天（实测「${afterPrev}」）`).toContain(dayPhrase(today));

  // ③  那条任务**没被顺手勾掉**：它还在全天带里，且勾选框的可访问名仍是「完成：…」。
  //    ⚠️ 这一句**必须排在回到今天之后**：在明天那一屏上它本来就不在 DOM 里，
  //      那时"找不到勾选框"会被读成"被勾掉了"（第一版就踩了这个：判据问错了问题）。
  await expect(page.locator(ALL_DAY)).toContainText(title);
  const checkbox = page.getByRole('checkbox', { name: `完成：${title}` });
  await expect(
    checkbox,
    '横拖之后任务被勾成完成了 ⇒ 拖完补发的那次 click 没被吃掉',
  ).toBeVisible();
  await expect(checkbox).not.toBeChecked();
  await expect(rowFor(page, title).getByRole('checkbox', { name: `完成：${title}` })).toBeVisible();
  expect(errors, `控制台报错：${errors.join(' | ')}`).toEqual([]);
});

test('🔴 翻到别的日子再点「今天」⇒ 自动跳回今天（现在线也回来了）', async ({ page }) => {
  const errors = watchConsole(page);
  await page.setViewportSize({ width: 1280, height: 720 });
  await openApp(page, APP_ZH);
  await gotoCalendarDay(page);

  const today = new Date();
  // 先翻走两天（用页头的 `›`，它和拖拽共用同一个 `stepCalendarCursor`）。
  for (let i = 0; i < 2; i += 1) await page.locator(NEXT).click();
  const away = await titleText(page);
  expect(away, '点「›」没离开今天').not.toContain(dayPhrase(today));
  // 🔴 离开今天之后**不许**再有现在线：它是"现在"，不是"那一天"。
  await expect(page.locator('[data-testid="calendar-board-day-now-line"]')).toHaveCount(0);
  await page.screenshot({ path: 'test-results/calendar-day-away.png', fullPage: false });

  await page.locator(TODAY_BUTTON).click();
  await page.screenshot({ path: 'test-results/calendar-day-back-today.png', fullPage: false });
  expect(await titleText(page), '点了「今天」而标题没回到今天').toContain(dayPhrase(today));
  await expect(page.locator('[data-testid="calendar-board-day-now-line"]')).toHaveCount(1);

  // 🔴 侧栏那个迷你月历圈住的一天，必须与轴看着的是**同一天**。
  //    两份状态各指一天时没有任何一层会报错，而用户看到的是"翻了天，日历还圈着昨天"。
  const miniSelected = page.locator('[data-testid^="calendar-mini-day-"][aria-current="date"]');
  await expect(miniSelected).toHaveCount(1);
  const miniTestId = await miniSelected.getAttribute('data-testid');
  const pad = (d: Date): string =>
    `${String(d.getFullYear())}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
      d.getDate(),
    ).padStart(2, '0')}`;
  expect(
    miniTestId,
    `侧栏圈着的是 ${String(miniTestId)}，而轴看的是今天 ${pad(today)}`,
  ).toBe(`calendar-mini-day-${pad(today)}`);

  expect(errors, `控制台报错：${errors.join(' | ')}`).toEqual([]);
});

/*
 * ── R14：时刻的**输出侧**（输入侧的判据在 `apps/web/tests/due-date-edit.spec.tsx`）──
 *
 * 这一条要钉的是那条链真的通到底：
 *   用户在**任务页**说一句「今天 16:00 X」 → 真 op 落库（非本地零点） →
 *   日档把 X 挂在 16 那一格里，而不是塞进全天带。
 *
 * 🔴 为什么这条**只能**在真浏览器里量：jsdom 那一份
 *   （`apps/web/tests/calendar-day-view.spec.tsx`）是**直接写 `dueDate`** 播种的，
 *   它测的是"分桶画得对"，测不到"从输入框敲进去的字真的变成了那个 dueDate"。
 *   两端各管一段，中间那条缝（捕获 → op）只在真浏览器里走一遍才算被量过。
 */
test('🔴 说一句「今天 16:00 X」⇒ X 挂在轴上 16 那一格，不在全天带里', async ({ page }) => {
  const errors = watchConsole(page);
  await page.setViewportSize({ width: 1280, height: 720 });
  await openApp(page, APP_ZH);

  const suffix = `挂在十六点-${STAMP}`;
  const composer = page.locator('input[placeholder^="添加任务"]');
  await composer.fill(`今天 16:00 ${suffix}`);
  await composer.press('Enter');
  // 等待条件用的是**这一条唯一产出的串**（完整标题）：
  // 「16:00」被吃掉之后剩下的标题只有在这条解析成立时才是这个样子 ——
  // 如果解析没吃时刻，标题会是「16:00 挂在十六点-…」，这里就找不到。
  await expect(page.getByRole('checkbox', { name: `完成：${suffix}` })).toBeVisible();

  await gotoCalendarDay(page);
  await page.screenshot({ path: SHOT('day-timed'), fullPage: false });

  const today = new Date();
  expect(await titleText(page), '日档应当看着今天').toContain(dayPhrase(today));

  // ① 它在全天带里**不该出现**（"有时刻"与"只排了日期"是两种任务，同屏不能都算）。
  await expect(
    page.locator(ALL_DAY),
    '带时刻的任务被画进了全天带 ⇒ 时刻在链上某处丢了',
  ).not.toContainText(suffix);
  // ② 它在该在的那一小时里（testID 的小时是补零的 `HH`）。
  const hour = page.locator('[data-testid="calendar-board-day-hour-16"]');
  await expect(hour).toBeVisible();
  await expect(hour, '轴上 16 那一格没有它').toContainText(suffix);
  /*
   * 第二张图：把 16 那一格**滚进视口**再拍。
   * 🔴 第一张 `day-timed` 只拍到 0:00–5:00（轴是可滚的），也就是说它
   *   **没有拍到这条判据在量什么** —— 而测试是绿的。截图当证据的前提是
   *   图里看得见那件事（§6.2 规定一第 4 条），否则"看过图"只是走过场。
   */
  await hour.scrollIntoViewIfNeeded();
  await page.screenshot({ path: SHOT('day-timed-hour16'), fullPage: false });
  // ③ 🔴 「轴上什么都没画」那句说明**不许再出现**：它现在是谎话。
  await expect(
    page.locator('[data-testid="calendar-board-day-no-timed"]'),
    '轴上已经挂了东西，那句"带时刻的任务都在这里/轴是空的"说明还在',
  ).toHaveCount(0);

  expect(errors, `控制台报错：${errors.join(' | ')}`).toEqual([]);
});

/*
 * ── 轴上那一列**时刻本身**必须读得出来 ─────────────────────────
 *
 * 这条是**看图**看出来的，不是断言报出来的：`day-timed-hour16.png` 里 10 点往后
 * 每一格都印成「16:0」换行「0」，而 0–9 点那些单行小时正常 —— 列宽 `space.8`（32px）
 * 装不下 14px 的 `23:00`。
 *
 * 🔴 为什么这条**只能**在真浏览器里量：jsdom 里 rect 与 lineHeight 全是 0
 *   （§7 元规则 2：写一条"永远通过"的判据比没有判据更糟）。
 * 🔴 断言的是"读不出这是几点"（折行/溢出）而不是某个像素宽：列宽会随 token 漂，
 *   而折行是用户直接看出来的产品结论。
 */
test('🔴 轴上的时刻列不许把「16:00」折成两行（每个小时标签都量）', async ({ page }) => {
  const errors = watchConsole(page);
  await page.setViewportSize({ width: 1280, height: 720 });
  await openApp(page, APP_ZH);
  await gotoCalendarDay(page);

  const hours = await hoursInDay();
  const measured = await page.evaluate(() => {
    const nodes = Array.from(
      document.querySelectorAll('[data-testid^="calendar-board-day-clock-"]'),
    ) as HTMLElement[];
    return nodes.map((el) => {
      const cs = getComputedStyle(el);
      const parsed = Number.parseFloat(cs.lineHeight);
      const lineHeight = Number.isNaN(parsed) ? 0 : parsed;
      const box = el.getBoundingClientRect();
      return {
        testID: String(el.getAttribute('data-testid')),
        text: el.textContent ?? '',
        height: Number(box.height.toFixed(1)),
        lineHeight,
        wrapped: lineHeight > 0 && box.height > lineHeight * 1.5,
        overflow: el.scrollWidth > el.clientWidth + 1,
      };
    });
  });

  // 探针自检：量不到东西 = 探针坏了，不许报"全部正常"（§7 元规则 1）。
  expect(measured.length, `轴上找到 ${String(measured.length)} 个时刻标签，应为 ${String(hours)}`).toBe(
    hours,
  );
  expect(
    measured.filter((m) => m.height > 0).length,
    '所有标签的高度都量到 0 ⇒ 探针坏了（jsdom 才会这样），不是判据绿了',
  ).toBeGreaterThan(0);

  const offenders = measured.filter((m) => m.wrapped || m.overflow);
  expect(
    offenders,
    `这些时刻标签折行或溢出：${offenders
      .map((o) => `「${o.text}」${String(o.height)}/${String(o.lineHeight)} overflow=${String(o.overflow)}`)
      .join(' | ')}`,
  ).toEqual([]);

  await page.screenshot({ path: SHOT('day-hour-labels'), fullPage: false });
  expect(errors, `控制台报错：${errors.join(' | ')}`).toEqual([]);
});
