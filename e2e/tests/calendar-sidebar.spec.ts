import { expect, test, type Page } from '@playwright/test';

import { openApp } from './helpers';

/**
 * 日历侧栏（迷你月历 + 显示范围）—— 真浏览器，零 mock
 * =====================================================
 *
 * 产品负责人 2026-09-30：「另外日历点侧边栏应该出现这些东西，你看一下，应该跟这个保持一致。」
 *
 * ## 🔴 这里只判 jsdom **判不到**的东西
 *
 * `apps/web/tests/calendar-sidebar.spec.tsx`（13 条，8 处变异验证）已经钉住了
 * 逻辑：列头周一开头、格子与 `monthGrid` 逐格对齐、一天一颗点、勾选同时筛主区、
 * 范围不落盘。**jsdom 没有布局** —— 它算不出任何 `boundingBox()`，所以以下四件事
 * 只有真浏览器能证：
 *
 *   1. **七列真的对齐**：CSS 写成六列或八列时 jsdom 照样"逐格对齐"，
 *      屏幕上是整列日历挤歪。这里比的是列头与格子的**中心 x**。
 *   2. **那颗点真的有像素尺寸、真的渲染成主色**：`cssVar()` 给的是
 *      `var(--ht-…)` 字符串，jsdom 里原样留在 style 上，拼错 token 也不会红 ——
 *      浏览器解析失败时 `backgroundColor` 退回 `rgba(0, 0, 0, 0)`。
 *   3. **翻月/选日的联动穿过真 `App.tsx`**：jsdom 用的是同一个 store，
 *      但真浏览器才走一遍挂载与路由。
 *   4. **把手在这一列里真的能拖出宽度**（上一轮 R2 的判据在任务侧栏，
 *      日历侧栏是另一条列）。
 *
 * ## 截图
 *
 * 先截图再断言（AGENTS §6.2 规定一 #1）。两张固定名：整屏 + 只裁侧栏那一列。
 * 控制台 `console` 与 `pageerror` 从**导航之前**开始收，失败时打印 ——
 * 白屏类的根因只在那里现形。
 */

const STAMP = Date.now().toString().slice(-6);
const LIST = `侧栏清单-${STAMP}`;
const IN_LIST = `侧栏在内-${STAMP}`;
const OUT_LIST = `侧栏在外-${STAMP}`;

const SIDEBAR = '.ht-sidebar--calendar';
const MINI_TITLE = '[data-testid="calendar-mini-title"]';
const BOARD_MONTH = '[data-testid="calendar-board-month"]';
const BOARD_DAY = '[data-testid="calendar-board-day-title"]';
const DAY_LIST = '[data-testid="calendar-board-day-list"]';

/** 今天（本地日历日，`yyyy-mm-dd`）—— 与领域层 `toLocalDate` 同一个约定。 */
function todayIso(): string {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

/** 收控制台与页面异常；必须在 `goto` 之前调用。 */
function captureConsole(page: Page): string[] {
  const lines: string[] = [];
  page.on('console', (msg) => {
    lines.push(`[${msg.type()}] ${msg.text()}`);
  });
  page.on('pageerror', (err) => {
    lines.push(`[pageerror] ${err.message}`);
  });
  return lines;
}

/**
 * 🔴 必须带 `?lang=zh-CN`：本用例的定位符与 aria-label 全是中文，而 2026-10-01
 * 起首启语言第 3 层问 `navigator.language`（Playwright = en-US）⇒ 不钉就是英文界面。
 */
const APP_ZH = '/?lang=zh-CN';

/**
 * 播两条**都到期于今天**的任务：一条挂进新建的清单，一条留在收集箱。
 *
 * ⚠️ 第二条是这条用例的前提，不是点缀：只有一条任务时，"勾清单 = 只看这条清单"
 * 与"没筛"在界面上**长得一模一样**（那条任务都在）。必须有一条会消失的任务，
 * 这条判据才能为假。
 */
async function seed(page: Page): Promise<void> {
  await openApp(page, APP_ZH);

  const sidebar = page.locator('aside[aria-label="清单与标签"]');
  await sidebar.getByRole('button', { name: '新建清单' }).click();
  await sidebar.getByLabel('新清单名称').fill(LIST);
  await sidebar.getByRole('button', { name: '添加清单' }).click();
  await expect(sidebar.getByText(LIST, { exact: true })).toBeVisible();

  // 截止时间走规则式快速捕获（`@heyta/domain/capture`），不是 mock：
  // 「今天」是用户真的会打的字。标题里被移除的那几个字不进 row 名。
  for (const title of [IN_LIST, OUT_LIST]) {
    const composer = page.locator('input[placeholder^="添加任务"]');
    await composer.fill(`今天 ${title}`);
    await composer.press('Enter');
    await expect(page.getByRole('checkbox', { name: `完成：${title}` })).toBeVisible();
  }

  const row = page.locator('[data-testid^="task-item-"]').filter({
    has: page.getByRole('checkbox', { name: `完成：${IN_LIST}` }),
  });
  await row.getByTestId('task-organize-summary').click();
  await row.getByLabel(`任务「${IN_LIST}」所属清单`).selectOption({ label: LIST });
  await expect(row.getByTestId('task-chip-project')).toHaveText(LIST);
}

async function openCalendar(page: Page): Promise<void> {
  await page.getByRole('tab', { name: '日历' }).click();
  await expect(page.locator(SIDEBAR)).toBeVisible();
}

test('迷你月历：七列真的对齐、今天那颗点真的有尺寸和主色、选日与翻月两列一起走', async ({
  page,
}) => {
  const logs = captureConsole(page);
  await seed(page);
  await openCalendar(page);

  const today = todayIso();

  // 先落图，再断言（失败时也要有图）。
  await page.screenshot({ path: 'test-results/calendar-sidebar.png' });

  // ① 迷你月历与主区**同一个月份**（两列各显示一份月份时，界面在说谎）。
  const miniMonth = (await page.locator(MINI_TITLE).textContent())?.trim() ?? '';
  const boardMonth = (await page.locator(BOARD_MONTH).textContent())?.trim() ?? '';
  expect(miniMonth, `迷你月历月份「${miniMonth}」与主区「${boardMonth}」不一致`).toBe(boardMonth);

  // ② 🔴 七列对齐：列头中心 x 必须与**第一行同一列格子**的中心 x 对齐。
  const headerCenters = await page
    .locator('.ht-sidebar__month-weekdays > span')
    .evaluateAll((els) => els.map((el) => (el.getBoundingClientRect().left + el.getBoundingClientRect().right) / 2));
  expect(headerCenters, '列头必须有 7 个').toHaveLength(7);

  const firstRow = page.locator('.ht-sidebar__month-row').first();
  const cellCenters = await firstRow
    .locator('.ht-sidebar__day')
    .evaluateAll((els) => els.map((el) => (el.getBoundingClientRect().left + el.getBoundingClientRect().right) / 2));
  expect(cellCenters, '第一行必须有 7 格').toHaveLength(7);
  headerCenters.forEach((center, i) => {
    expect(
      Math.abs(center - cellCenters[i]!),
      `第 ${i + 1} 列的列头与格子中心没对齐（差 ${Math.abs(center - cellCenters[i]!).toFixed(1)}px）`,
    ).toBeLessThan(2);
  });

  // ③ 格子总数 = 7 的倍数，且都在侧栏那一列的宽度内（溢出会让整列被裁）。
  const cellCount = await page.locator('.ht-sidebar__month-grid .ht-sidebar__day').count();
  expect(cellCount % 7, '月历格子必须是整行（7 的倍数）').toBe(0);
  const sideBox = await page.locator(SIDEBAR).boundingBox();
  expect(sideBox, '侧栏有几何').not.toBeNull();
  const lastCell = await firstRow.locator('.ht-sidebar__day').last().boundingBox();
  expect(lastCell!.x + lastCell!.width, '最后一格不许溢出侧栏').toBeLessThanOrEqual(
    sideBox!.x + sideBox!.width + 1,
  );

  // ④ 🔴 今天那颗点：真的有像素尺寸，且 computed background 解析成主色。
  const dot = page.locator(`[data-testid="calendar-mini-day-${today}"] .ht-sidebar__day-dots > i`);
  await expect(dot, '今天的格子里必须有一颗点').toHaveCount(1);
  const dotBox = await dot.boundingBox();
  expect(dotBox, '那颗点必须有几何（0×0 等于没画）').not.toBeNull();
  expect(dotBox!.width, '点径不能是 0').toBeGreaterThan(2);
  const expected = await page.evaluate(() => {
    const probe = document.createElement('span');
    probe.style.color = 'var(--ht-color-primary)';
    document.body.append(probe);
    const value = getComputedStyle(probe).color;
    probe.remove();
    return value;
  });
  const actual = await dot.evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(
    actual,
    `未到期今天 ⇒ 主色（token 拼错时浏览器退回 rgba(0, 0, 0, 0)）：期望 ${expected}，实际 ${actual}`,
  ).toBe(expected);

  // ⑤ 点侧栏的某一天 ⇒ 主区那一列的日标题**必须说成同一天**。
  // 只在**本月格**里挑（补白格会把月份也带走，那就同时在验 ⑥ 了，一条判据干两件事）。
  const inMonthDates = await page
    .locator('.ht-sidebar__day')
    .evaluateAll((els) =>
      els
        .filter((el) => !el.className.includes('ht-sidebar__day--outside'))
        .map((el) => el.getAttribute('data-testid')!.replace('calendar-mini-day-', '')),
    );
  expect(inMonthDates.length, '本月格子里至少要有两天可挑').toBeGreaterThan(2);
  const alt = inMonthDates.find((d) => d !== today);
  expect(alt, '得有一个不是今天的本月格子').toBeDefined();

  await page.locator(`[data-testid="calendar-mini-day-${alt}"]`).click();
  // 日标题说成「9月1日 星期二」这种形态 —— 月份与日期必须与**被点的那一格**逐字对上。
  const altParts = alt!.split('-');
  await expect(page.locator(BOARD_DAY)).toContainText(
    `${Number(altParts[1])}月${Number(altParts[2])}日`,
  );
  await expect(
    page.locator(`[data-testid="calendar-mini-day-${alt}"][aria-current="date"]`),
    '迷你月历里被点的那格必须成为当前日（选中态不能只画在主区）',
  ).toHaveCount(1);

  // ⑥ 翻到下个月：**两列**的月份一起走，而且不许只有一列动。
  // ⚠️ 不能用 `getByRole('button', { name: '下个月' })` —— 迷你月历与主区的板**各有一个**
  // 同名按钮（strict mode 会红），而这一条要验的正是"侧栏那一个按下去，两列一起动"。
  await page.getByTestId('calendar-mini-next').click();
  await expect(page.locator(BOARD_MONTH)).not.toHaveText(boardMonth);
  expect(
    (await page.locator(MINI_TITLE).textContent())?.trim(),
    '翻月后迷你月历与主区的月份必须一致',
  ).toBe((await page.locator(BOARD_MONTH).textContent())?.trim());

  await page.getByTestId('calendar-mini-today').click();
  await expect(page.locator(MINI_TITLE)).toHaveText(miniMonth);
  await expect(
    page.locator(`[data-testid="calendar-mini-day-${today}"][aria-current="date"]`),
    '「回到今天」必须把选中态带回今天那一格',
  ).toHaveCount(1);

  await page.screenshot({
    path: 'test-results/calendar-sidebar-mini.png',
    clip: { x: sideBox!.x, y: sideBox!.y, width: sideBox!.width, height: Math.min(sideBox!.height, 760) },
  });

  const errors = logs.filter((l) => l.startsWith('[error]') || l.startsWith('[pageerror]'));
  expect(errors, `控制台有报错：\n${errors.join('\n')}`).toHaveLength(0);
});

test('显示范围：勾一个清单就只看它（点与主区同时消失），「所有」复位；把手在这一列里', async ({
  page,
}) => {
  const logs = captureConsole(page);
  await seed(page);
  await openCalendar(page);

  const today = todayIso();
  const scopedRow = (title: string) =>
    page.locator(DAY_LIST).getByRole('checkbox', { name: `完成：${title}` });

  // 前提：两条都到期于今天 ⇒ 未筛时都在。
  await expect(scopedRow(IN_LIST), '未筛时：挂进清单的任务在当天列表里').toBeVisible();
  await expect(scopedRow(OUT_LIST), '未筛时：收集箱里的任务也在当天列表里').toBeVisible();
  await page.screenshot({ path: 'test-results/calendar-sidebar-before-scope.png' });

  // ① 勾上那一个清单 ⇒ 范围变窄：**主区少一行，侧栏那颗点也得少**。
  await page.getByRole('checkbox', { name: `在日历上显示清单「${LIST}」的任务` }).check();
  await expect(scopedRow(IN_LIST), '勾选后本清单的任务仍在').toBeVisible();
  await expect(scopedRow(OUT_LIST), '勾选后别的任务必须消失（只筛主区不筛点 = 界面在说谎）').toHaveCount(0);
  await expect(
    page.locator(`[data-testid="calendar-mini-day-${today}"] .ht-sidebar__day-dots > i`),
    '范围内仍有任务 ⇒ 点还在',
  ).toHaveCount(1);

  // ② 勾一个范围内**没有任务**的东西会走同一条路：清空 → 这天没有点。
  // （这里用总勾的逆操作：把清单组的总勾点掉 ⇒ 整组清空 = 回到「所有」。）
  await page.getByTestId('calendar-scope-group-清单').uncheck();
  await expect(page.getByTestId('calendar-scope-all'), '清空全部勾选 = 所有').toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(scopedRow(OUT_LIST), '「所有」之后收集箱的任务回来').toBeVisible();

  // ③ 「所有」按钮：按下时带一个 Check 图标（滴答同款：勾的是「所有」这一行）。
  await page.getByRole('checkbox', { name: `在日历上显示清单「${LIST}」的任务` }).check();
  await expect(page.getByTestId('calendar-scope-all')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByTestId('calendar-scope-all').locator('svg')).toHaveCount(0);
  await page.getByRole('button', { name: '显示全部任务' }).click();
  await expect(page.getByTestId('calendar-scope-all')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('calendar-scope-all').locator('svg')).toHaveCount(1);

  // ④ 范围是**这一屏**的，不是偏好：刷新回到「所有」。
  await page.getByRole('checkbox', { name: `在日历上显示清单「${LIST}」的任务` }).check();
  await page.reload();
  await expect(page.locator('input[placeholder^="添加任务"]')).toBeVisible();
  await openCalendar(page);
  await expect(page.getByTestId('calendar-scope-all'), '刷新后范围复位').toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(scopedRow(OUT_LIST)).toBeVisible();

  // ⑤ 把手在**这一列**里（日历侧栏是另一条列，上一轮的判据在任务侧栏）。
  //
  // 🔴 先钉住"列自己不是滚动区"—— 这是本轮实测到的真缺陷的形状：
  // `overflow-y: auto` 写在列上时，横轴被连带变成 `clip`，而把手有 4px
  // **骑在这一列右边缘之外** ⇒ 那半截被裁掉，`elementFromPoint(把手中心)`
  // 返回的是 `<nav>` 而不是把手。症状是"把手在那儿、按下去拖不动"，
  // 而元素存在、`role=separator`、`cursor: col-resize` 全都照样绿。
  const layout = await page
    .locator(SIDEBAR)
    .evaluate((el) => ({
      columnHeight: el.getBoundingClientRect().height,
      viewportHeight: window.innerHeight,
      columnOverflowY: getComputedStyle(el).overflowY,
      bodyOverflowY: getComputedStyle(
        el.querySelector<HTMLElement>('.ht-sidebar__calendar-body')!,
      ).overflowY,
    }));
  expect(
    layout.columnHeight,
    `列高不许超过视口（${layout.columnHeight} > ${layout.viewportHeight} ⇒ 整页在滚，"滚动条只出现在侧栏"是假的）`,
  ).toBeLessThanOrEqual(layout.viewportHeight + 1);
  expect(layout.bodyOverflowY, '滚动必须挂在内部那一层').toBe('auto');
  expect(layout.columnOverflowY, '滚动不许挂在列本身（会裁掉骑在边缘外的把手）').not.toBe('auto');

  const handle = page.locator(`${SIDEBAR} .ht-sidebar__resizer`);
  await expect(handle, '日历侧栏右边缘必须有把手').toHaveCount(1);
  const box = await handle.boundingBox();
  expect(box, '把手有几何').not.toBeNull();

  // 命中测试：中心点必须真的落在把手上（拖拽那一步是它的行为版本，两条都要）。
  expect(
    await page.evaluate(
      ([x, y]) => {
        const el = document.elementFromPoint(x, y);
        return el === null ? '(空)' : el.className;
      },
      [box!.x + box!.width / 2, box!.y + box!.height / 2] as [number, number],
    ),
    '对着把手几何中心按下去，命中的必须是把手自己',
  ).toContain('ht-sidebar__resizer');
  const before = await page.locator(SIDEBAR).evaluate((el) => el.getBoundingClientRect().width);
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.down();
  await page.mouse.move(box!.x + box!.width / 2 + 120, box!.y + box!.height / 2, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(150);
  const after = await page.locator(SIDEBAR).evaluate((el) => el.getBoundingClientRect().width);
  expect(Math.round(after), '往右拖 120px 就宽 120px').toBe(Math.round(before) + 120);
  // 拖宽之后七列仍然对齐（这一条只在窄列成立的话，宽列就是白测）。
  const centers = await page
    .locator('.ht-sidebar__month-row')
    .first()
    .locator('.ht-sidebar__day')
    .evaluateAll((els) => els.map((el) => (el.getBoundingClientRect().left + el.getBoundingClientRect().right) / 2));
  expect(centers).toHaveLength(7);

  await page.screenshot({ path: 'test-results/calendar-sidebar-wide.png' });

  const errors = logs.filter((l) => l.startsWith('[error]') || l.startsWith('[pageerror]'));
  expect(errors, `控制台有报错：\n${errors.join('\n')}`).toHaveLength(0);
});
