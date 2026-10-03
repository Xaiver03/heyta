/**
 * 日历：**全高** 与 **月格任务条不被裁**（R11 批一）
 * ====================================================
 *
 * 产品负责人 2026-10-02 对标滴答的原话是两句：
 *   ①「它那个日历是全高的，而不是只占一半」；
 *   ②「永远不会截断」。
 *
 * 🔴 这两句**只能在真浏览器里量**：全高与"不被裁"都是 rect 上的关系，
 * jsdom 里所有 rect 都是 0 —— 在 jsdom 写这条会得到一条永远通过的判据
 * （§7 元规则 2："一条永远通过的判据比没有判据更糟"）。
 * "格子里画的是标题而不是圆点"、"`+N` 的数从数据算"那两条在
 * `apps/web/tests/calendar-view.spec.tsx` 与 `packages/ui/tests/calendar-cell-bars.spec.ts`。
 *
 * ## 两条用例，各钉一件事
 *
 * 1. **全高**：在**一条任务都没有**的日历上量。
 *    🔴 这不是省事，是**判据的牙齿**：有数据时板的自然高度本来就超过内容区，
 *    `flexGrow` 撤掉也照样"够高"，那条 ≥ 会变成恒真。
 *    空日历才是"只占一半"原症状能被看出来的唯一状态。
 *    阈值全部从实测推导（`.ht-content` 的 rect 减 computed padding），不写死数字。
 * 2. **不被裁 + 折叠对得上**：播 5 条到期于今天的任务，量 42 个格子里每条任务条
 *    （和 `+N`）是否**完整落在所属格子内**，并核对
 *    **`+N` = 总数 − 界面上真的画出来的条数**。
 *    🔴 上限的数字**不在这里抄一遍**（抄件一定会漂）—— 那个值由
 *    `packages/ui/tests/calendar-cell-bars.spec.ts` 从共享层的 `MAX_CALENDAR_BARS` 推导。
 *
 * ## 截图
 *
 * 先截图再断言（失败时也要有图）。固定名：`calendar-cells-empty.png` / `calendar-cells.png`。
 */

import { expect, test, type Page } from '@playwright/test';

import { openApp } from './helpers';

/**
 * 🔴 必须带 `?lang=zh-CN`：这一屏的定位符与 aria-label 全是中文，而 2026-10-01 起
 * 首启语言第 3 层问 `navigator.language`（Playwright = en-US）⇒ 不钉就是英文界面。
 */
const APP_ZH = '/?lang=zh-CN';
const BOARD = '[data-testid="calendar-board"]';
const MONTH_CARD = '[data-testid="calendar-board-month-card"]';
const CONTENT = '.ht-content';
const STAMP = Date.now().toString().slice(-6);
/** 播 5 条：超过上限，于是必然出现折叠标记。 */
const SEEDED = 5;

function watchConsole(page: Page): string[] {
  const lines: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') lines.push(`[console.error] ${msg.text()}`);
  });
  page.on('pageerror', (err) => {
    lines.push(`[pageerror] ${err.message}`);
  });
  return lines;
}

/** 进日历视图（先确保这一屏真的在，否则后面的量都是对空气量的）。 */
async function gotoCalendar(page: Page): Promise<void> {
  await page.getByRole('tab', { name: '日历' }).click();
  await expect(page.locator(BOARD)).toBeVisible();
  await expect(page.locator(MONTH_CARD)).toBeVisible();
}

async function seedToday(page: Page): Promise<void> {
  const composer = page.locator('input[placeholder^="添加任务"]');
  for (let i = 0; i < SEEDED; i += 1) {
    await composer.fill(`今天 日历格-${i}-${STAMP}`);
    await composer.press('Enter');
    await expect(page.getByRole('checkbox', { name: `完成：日历格-${i}-${STAMP}` })).toBeVisible();
  }
}

test('🔴 工具栏住在页头里，而且整屏只有**一份**（不是页头一份、板子里又一份）', async ({ page }) => {
  await openApp(page, APP_ZH);
  await gotoCalendar(page);

  // ① 锚点：和任务页那个排序下拉**同一个容器**（`task-sort.spec.tsx` 钉的就是这里）。
  //    判"在页头里"不能靠"看得见"—— 看得见说明不了它住在哪个容器。
  await expect(
    page.locator('header.ht-header [data-testid="calendar-toolbar-month"]'),
    '月份标题没住在 header.ht-header 里（工具栏没提到页头）',
  ).toHaveCount(1);

  // ② 板子里那份必须**撤掉**了：同一控件两处渲染 = 两处状态 = 迟早漂。
  await expect(
    page.locator(`${BOARD} [data-testid="calendar-toolbar-month"]`),
    '月历板里还留着一份工具栏（页头一份 + 板内一份）',
  ).toHaveCount(0);
  // 🔴 整份文档里这个控件**恰好一个**—— 上面两条各自成立时这条也成立，
  //    但只有这条能抓住"搬家搬漏了"和"搬到两个地方"之外的第三种：一处都没搬。
  await expect(page.getByTestId('calendar-toolbar-month'), '工具栏份数不对').toHaveCount(1);

  // ③ 它是**活的**：点一下 › 月份真的走。
  const before = (await page.getByTestId('calendar-toolbar-month').textContent())?.trim() ?? '';
  await page.getByTestId('calendar-toolbar-next').click();
  const after = (await page.getByTestId('calendar-toolbar-month').textContent())?.trim() ?? '';
  expect(after, `点「下个月」之后月份没变（还是「${before}」）`).not.toBe(before);

  // ④ 侧栏迷你月历**跟着一起走**（两列共用同一个 cursor，不是各存一份）。
  await expect(page.locator('[data-testid="calendar-mini-title"]')).toContainText(
    after.slice(0, 5),
  );

  // ④ 🔴 页头这一排**不许溢出**：`.ht-header__actions` 是 `flex: 0 0 auto`（不许压窄），
  //    往里加一格就可能把最右边顶出视口 —— 那正是"零件在、最后一米没接"的反面：
  //    控件在，但点不到。量 `scrollWidth` 与最右元素的右边缘，两个都要。
  const header = await page.locator('header.ht-header').evaluate((el) => {
    const last = el.getBoundingClientRect();
    const month = document.querySelector('[data-testid="calendar-toolbar-month"]');
    return {
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
      right: last.right,
      monthRight: month ? Math.round(month.getBoundingClientRect().right) : -1,
      viewport: window.innerWidth,
    };
  });
  expect(
    header.scrollWidth,
    `页头横向溢出：scrollWidth ${String(header.scrollWidth)} > clientWidth ${String(
      header.clientWidth,
    )}`,
  ).toBeLessThanOrEqual(header.clientWidth + 1);
  expect(
    header.monthRight,
    `月份标题的右边缘 ${String(header.monthRight)} 贴到/越过视口右边界 ${String(header.viewport)}`,
  ).toBeLessThan(header.viewport);

  await page.screenshot({ path: 'test-results/calendar-toolbar.png', fullPage: false });
});

/** 量一次"没有任何任务条的那一行"的高度（同一行 7 格取平均，避开子像素）。 */
async function emptyRowHeights(page: Page): Promise<number[]> {
  return page.locator(BOARD).evaluate((boardEl, cellSel) => {
    const cells = [...boardEl.querySelectorAll<HTMLElement>(cellSel)];
    const byRow = new Map<number, HTMLElement[]>();
    for (const c of cells) {
      const y = Math.round(c.getBoundingClientRect().top);
      const list = byRow.get(y) ?? [];
      list.push(c);
      byRow.set(y, list);
    }
    const out: number[] = [];
    for (const row of byRow.values()) {
      const bars = row.reduce((n, c) => n + c.querySelectorAll('[data-testid$="-bar"]').length, 0);
      if (bars > 0) continue;
      out.push(row.reduce((m, c) => m + c.getBoundingClientRect().height, 0) / row.length);
    }
    return out.map((h) => Math.round(h));
  }, '[data-testid^="calendar-cell-"][role="button"]');
}

test('🔴 屏幕变高时，长高的是**当天那一格**，不是星期行（剩余空间归清单）', async ({ page }) => {
  // 批二看图抓到的形状：把"全高"实现成"卡片涨 + 六行等分"之后，
  // 720 上今天有 5 条任务时每行长到 ~190px，整月要滚着看。
  //
  // 🔴 判据是**差分**，不写死任何数：把视口从 720 拉到 1200，
  //    空行的高度**必须一字不变** —— 多出来的 480px 应当全部归当天那一格。
  //    为什么不用"空行不许比塞满的行还高"：那种写法在弹性盒下**永远成立**
  //    （六行等分同一份自由空间，最忙那行还额外带着自己的内容），
  //    实测它对着"把 flexGrow 加回网格"这个变异都不红 —— 恒真的判据比没有更糟（§7 元规则 2）。
  await openApp(page, APP_ZH);
  await seedToday(page);
  await gotoCalendar(page);

  await page.setViewportSize({ width: 1280, height: 720 });
  await expect.poll(async () => (await emptyRowHeights(page)).length).toBeGreaterThan(0);
  const short = await emptyRowHeights(page);

  await page.setViewportSize({ width: 1280, height: 1200 });
  await expect.poll(async () => (await emptyRowHeights(page)).length).toBe(
    short.length,
    '两档视口下数出来的空行数不一样，差分没有意义',
  );
  const tall = await emptyRowHeights(page);

  const grew = tall.map((h, i) => ({ h, before: short[i] ?? -1 })).filter((r) => r.h > r.before + 1);
  expect(
    grew,
    `视口从 720 拉到 1200 之后这些星期行变高了（${JSON.stringify(
      short,
    )} → ${JSON.stringify(tall)}）—— 剩余空间被网格吃了，应该归当天那一格`,
  ).toEqual([]);

  await page.screenshot({ path: 'test-results/calendar-tall-viewport.png', fullPage: false });
});

test('🔴 空日历也是全高的（不是只占半屏），而且整月都在可视范围内', async ({ page }) => {
  const errors = watchConsole(page);
  // 🔴 **视口必须比这一屏的自然高度高**，否则这条判据是恒真的。
  //    实测（2026-10-03）：默认 1280×720 下空日历的**自然**高度就是 740px，
  //    而内容盒只有 664 ⇒ 把宿主层的 `flex: 1` 撤掉，数字**一个都不变**
  //    （板高还是 740、内容盒还是被它撑到 804）。
  //    也就是说"板高 ≥ 内容盒"在 720 上永远成立 —— 一条测不出假的判据不如没有。
  //    1200 才是她说的那个状态："屏幕比内容高，可日历只占一半"。
  await page.setViewportSize({ width: 1280, height: 1200 });
  await openApp(page, APP_ZH);
  await gotoCalendar(page);

  await page.screenshot({ path: 'test-results/calendar-cells-empty.png', fullPage: false });

  // ⚠️ 这条用例**刻意不播任务**：有数据时板的自然高度本来就超过内容区，
  //    撤掉 flexGrow 也"够高" ⇒ 判据恒真。空日历才是原症状能被看出来的状态。
  const m = await page.locator(CONTENT).evaluate((el, selectors) => {
    const cs = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    const board = document.querySelector(selectors.board);
    const card = document.querySelector(selectors.card);
    const boardBox = board?.getBoundingClientRect();
    const cardBox = card?.getBoundingClientRect();
    return {
      contentHeight: rect.height,
      contentBottom: rect.bottom,
      padTop: Number.parseFloat(cs.paddingTop),
      padBottom: Number.parseFloat(cs.paddingBottom),
      boardHeight: boardBox?.height ?? -1,
      cardBottom: cardBox?.bottom ?? -1,
      viewportHeight: window.innerHeight,
    };
  }, { board: BOARD, card: MONTH_CARD });

  const inner = m.contentHeight - m.padTop - m.padBottom;
  // 🔴 把量到的数**打出来**：布局判据一旦漂了（视口、token、内容高度），
  //    只有原始数字能区分"布局真坏了"和"阈值不该这么定"。
  console.info(
    `[calendar-cells] 视口=${String(m.viewportHeight)} 内容盒=${String(inner)} 板高=${String(
      m.boardHeight,
    )} 卡片底=${String(m.cardBottom)} 内容底=${String(m.contentBottom)}`,
  );
  // 前提：内容盒自己得真有高度。没有的话，下面那条 ≥ 会恒真。
  expect(
    inner,
    `前提不成立：.ht-content 的内容盒只有 ${String(inner)}px` +
      `（rect ${String(m.contentHeight)} − padding ${String(m.padTop)}/${String(m.padBottom)}）`,
  ).toBeGreaterThan(300);

  expect(
    m.boardHeight,
    `板高 ${String(m.boardHeight)} 没铺满内容盒 ${String(inner)}（内容区 rect ${String(
      m.contentHeight,
    )}、视口 ${String(m.viewportHeight)}）。控制台：${errors.join(' | ')}`,
  ).toBeGreaterThanOrEqual(inner - 1);

  // 🔴 「整月不滚就看全」的参照是**视口**，不是 `.ht-content` 的底边 ——
  //    内容盒是被内容撑开的（它没有 `overflow`），拿它比自己比**永远成立**：
  //    实测把每行定高 200px，卡片底与内容底**一起**掉出屏幕，判据照样绿。
  //    只有对着视口量，这条才拦得住"行被顶开、整月要滚着看"。
  expect(
    m.cardBottom,
    `月历卡片底边 ${String(m.cardBottom)} 越出视口 ${String(m.viewportHeight)} —— 整月要滚动才看得全`,
  ).toBeLessThanOrEqual(m.viewportHeight + 1);
});

test('🔴 月格里的任务条一条都没被裁一半，且「+N」对得上画出来的条数', async ({ page }) => {
  const errors = watchConsole(page);
  await openApp(page, APP_ZH);
  await seedToday(page);
  await gotoCalendar(page);

  await page.screenshot({ path: 'test-results/calendar-cells.png', fullPage: false });

  // ── 不被裁：每条任务条（和 +N）完整落在自己的格子里 ──
  const measured = await page.locator(BOARD).evaluate((boardEl) => {
    const cells = [
      ...boardEl.querySelectorAll<HTMLElement>('[data-testid^="calendar-cell-"][role="button"]'),
    ];
    const bad: string[] = [];
    let barsSeen = 0;
    for (const cell of cells) {
      const cellBox = cell.getBoundingClientRect();
      const kids = [
        ...cell.querySelectorAll<HTMLElement>('[data-testid$="-bar"], [data-testid$="-more"]'),
      ];
      barsSeen += kids.filter((k) => k.getAttribute('data-testid')?.endsWith('-bar')).length;
      for (const kid of kids) {
        const box = kid.getBoundingClientRect();
        if (box.height <= 0 || box.width <= 0) {
          bad.push(`${kid.getAttribute('data-testid')} 尺寸为 0（画了但看不见）`);
          continue;
        }
        // 1px 容差：子像素布局会把底边算到 0.5px 以外，那不是"截断"。
        if (box.bottom > cellBox.bottom + 1 || box.top < cellBox.top - 1) {
          bad.push(
            `${kid.getAttribute('data-testid')} 超出格子（条 ${String(box.top)}–${String(
              box.bottom,
            )} / 格 ${String(cellBox.top)}–${String(cellBox.bottom)}）`,
          );
        }
      }
    }
    return { cells: cells.length, barsSeen, bad };
  });

  // 前提：真的数到了 42 个格子，而且**格子里真的有东西**
  //（否则"没有条被裁"是对空集合说的，永远成立）。
  expect(measured.cells, '月历格子数应当是 6×7=42').toBe(42);
  expect(measured.barsSeen, '整块月历里一条任务条都没画').toBeGreaterThan(0);
  expect(
    measured.bad.slice(0, 3),
    `有 ${String(measured.bad.length)} 处被裁在格子外面：${measured.bad.join(' ; ')}。控制台：${errors.join(
      ' | ',
    )}`,
  ).toEqual([]);

  // ── 折叠对得上 ──
  const today = await page.evaluate(() => {
    const d = new Date();
    const pad = (n: number): string => String(n).padStart(2, '0');
    return `${String(d.getFullYear())}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  });
  const cell = page.locator(`[data-testid="calendar-cell-${today}"]`);
  await expect(cell, `找不到今天的格子 calendar-cell-${today}`).toHaveCount(1);

  const bars = cell.locator('[data-testid$="-bar"]');
  const drawn = await bars.count();
  expect(drawn, '格子里一条任务条都没画（又回到只有圆点）').toBeGreaterThan(0);
  expect(drawn, `${String(SEEDED)} 条全画出来了 —— 折叠没有发生`).toBeLessThan(SEEDED);

  for (let i = 0; i < drawn; i += 1) {
    const text = await bars.nth(i).textContent();
    expect((text ?? '').trim(), `第 ${String(i + 1)} 条是空的（等于又画回圆点）`).not.toBe('');
  }

  const more = cell.locator('[data-testid$="-more"]');
  await expect(
    more,
    `只画了 ${String(drawn)} 条、一共 ${String(SEEDED)} 条，却没有折叠标记`,
  ).toHaveCount(1);
  await expect(more).toHaveText(`+${String(SEEDED - drawn)}`);

  /**
   * 亮/暗两套色板各量一次：**选中格**整块换成主蓝底，
   * 条上的字如果跟着底色走（或某一套色板下没换过来），这一格就读不出来。
   * 这条判据抓的是"颜色成对"这件事，不是具体色值（色值归 `check:design` / 对比度测试）。
   */
  const ink = () =>
    page.locator(BOARD).evaluate((boardEl, sels) => {
      const selected = boardEl.querySelector<HTMLElement>(sels.selectedCell);
      const bar = selected?.querySelector<HTMLElement>(sels.bar);
      // 条上的字**自己带 testID**（`…-bar-title`）—— RN-web 里 `Text` 与 `View` 都是 `<div>`，
      // 按标签名找会抓到那根没有字的色条，量到的颜色与"读不读得出"无关。
      const label = bar?.querySelector<HTMLElement>(sels.barTitle);
      const card = document.querySelector(sels.card);
      if (!selected || !bar || !label) {
        return {
          missing: `${String(!!selected)}/${String(!!bar)}/${String(!!label)}`,
          cellBg: '',
          barColor: '',
          cardBg: '',
          overflow: false,
        };
      }
      return {
        missing: '',
        cellBg: getComputedStyle(selected).backgroundColor,
        barColor: getComputedStyle(label).color,
        cardBg: card ? getComputedStyle(card).backgroundColor : '',
        overflow: [...selected.querySelectorAll<HTMLElement>(sels.bar)].some(
          (b) => b.getBoundingClientRect().bottom > selected.getBoundingClientRect().bottom + 1,
        ),
      };
    }, {
      selectedCell: '[data-testid^="calendar-cell-"][role="button"][aria-selected="true"]',
      bar: '[data-testid$="-bar"]',
      barTitle: '[data-testid$="-bar-title"]',
      card: MONTH_CARD,
    });

  const light = await ink();
  expect(light!.missing, '亮色：格子里没找到可读的任务条').toBe('');
  expect(light!.overflow, '亮色：任务条溢出格子（被裁一半）').toBe(false);
  expect(
    light!.barColor,
    `亮色：任务条的文字色与格子底色相同（${light!.cellBg}）—— 这一格的标题读不出来`,
  ).not.toBe(light!.cellBg);

  // ── 暗色：AGENTS §5「暗色不是亮色的反相，必须实际切换查看」──────────
  //
  // 🔴 **点产品自己的那个切换按钮**，不改 DOM 属性、不用 `emulateMedia`。
  //    两条都试过，两条都会拍出**骗人的"暗色"图**：
  //    · `setAttribute('data-theme','dark')` 只翻转 CSS 变量那一侧（rail / 页头 / 页面底色
  //      真的黑了），而共享层组件的色板是 `<HeytaUiProvider>` 按 React 状态解析的 ——
  //      于是**月历卡片还是纯白**（实测截图就是这样，2026-10-03 靠看图才发现）；
  //    · `emulateMedia({colorScheme:'dark'})` 只改 `prefers-color-scheme`，
  //      应用显式选了主题时它压根不参与。
  //    只有走按钮，`applyTheme` 与 `setTheme` 才同时改，量到的才是用户真看到的暗色。
  await page.getByRole('button', { name: '切换到暗色主题' }).click();
  const dark = await ink();
  expect(dark!.missing, '暗色：格子里没找到可读的任务条').toBe('');
  // 🔴 这条是上面那次"假暗色"的**判据化**：卡片底色必须真的换了。
  //    只断言 `<html data-theme>` 是不够的 —— 那个属性可以被人直接改掉（我就是这么错的）。
  expect(
    dark!.cardBg,
    `暗色下月历卡片底色没变（还是 ${light!.cardBg}）—— RN 侧的色板没跟着主题走，界面上是"黑底白卡"`,
  ).not.toBe(light!.cardBg);
  expect(dark!.overflow, '暗色：任务条溢出格子（被裁一半）').toBe(false);
  expect(
    dark!.barColor,
    `暗色：任务条的文字色与格子底色相同（${dark!.cellBg}）—— 这一格的标题读不出来`,
  ).not.toBe(dark!.cellBg);

  await page.screenshot({ path: 'test-results/calendar-cells-dark.png', fullPage: false });
});
