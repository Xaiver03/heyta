/**
 * 专注详情面（工单 W7）：只有真浏览器能证的那一半
 * ==============================================
 *
 * 分工要说清楚，不然两层的绿都会被读成"这单做完了"：
 * - **数对不对** → `packages/app-host/tests/focus-overview.spec.ts`（真引擎 + 真 SQLite）
 * - **界面读的是那个出口** → `apps/web/tests/focus-detail-pane.spec.tsx`（jsdom）
 * - **本文件**：这一栏**画出来是什么样**、**真落盘的一条记录会不会出现在界面上**、
 *   以及 jsdom 根本看不见的 CSS 事实（`tabular-nums`、它在详情列**那一格里**）。
 *
 * 🔴 F5 是这里最值钱的一条：它用**真点击**产出一条真 `FOCUS_SESSION` op，
 * 然后要求"界面上多了一行记录，而『今日番茄』仍然是 0"。
 * 那两句同时成立才是 W7 判据 ① 的口径（中止的段落盘、算时长、**不**算一个番茄）。
 * 只断"有一行"挡不住"把中止也算成一个番茄"；只断"今日番茄 0"挡不住"记录根本没落盘"。
 *
 * ⚠️ 截图路径按**本文件位置**解析（`import.meta.url`）：相对路径按进程 cwd 解析，
 *    在 linked worktree 里会把证据写进主检出（`selection-projections.spec.ts` 文件头记着那次事故）。
 */
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { openApp, parkCursor, switchView } from './helpers';

const SHOT = (name: string) =>
  fileURLToPath(new URL(`../../apps/web/evidence/focus-detail-pane/${name}.png`, import.meta.url));

/** 控制台错误进断言（§6.2 规定一第 3 条），监听要在导航之前挂上。 */
function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console: ${m.text()}`);
  });
  page.on('pageerror', (e) => errors.push(`pageerror: ${String(e)}`));
  return errors;
}

const COLUMN = '[data-testid="detail-column"]';

/**
 * 把光标停到空白处，并**等 rail 的过渡落位**。
 *
 * 🔴 这一条是被一张拍坏的截图逼出来的：`.ht-rail__tab` 的 `background` 带
 * `transition: … var(--ht-duration-fast)`（150ms，`inbox.css:432`），所以
 * 「点完视图立刻截图」拍到的是**过渡中间帧** —— 上一格还白着、这一格还没白。
 * F3 的第一版图就是这样：画面读起来是「rail 高亮着『任务』而内容是番茄钟」，
 * 长得像一条"界面在说谎"的产品缺陷。而同一时刻 DOM 里 `--active` 是对的
 * （现量：`任务 bg=rgb(255,255,255)` / `番茄钟 bg=rgba(0,0,0,0)`，两格都还在
 * 各自的**旧值**上）。也就是说假的是那张图，不是那个状态。
 *
 * ⚠️ 等的是**这些元素自己的动画**（`getAnimations()`），不是"睡 150ms"：
 * 落位后集合为空、立刻返回；`prefers-reduced-motion` 下 `--ht-duration-fast: 1ms`
 * 也一样返回。和 `helpers.ts` 的 `waitForOverlaySettled` 同一个理由。
 */
async function parkAndSettle(page: Page): Promise<void> {
  await parkCursor(page);
  await page.evaluate(async () => {
    const tabs = Array.from(document.querySelectorAll<HTMLElement>('.ht-rail__tab'));
    await Promise.all(
      tabs.flatMap((t) => t.getAnimations().map((a) => a.finished.catch(() => undefined))),
    );
  });
}

test.describe('专注详情面', () => {
  test('F1 四张概览卡都在，且都在详情列**那一格里**', async ({ page }) => {
    const errors = watchErrors(page);
    await openApp(page, '/?lang=zh-CN');
    await switchView(page, '番茄钟');

    const pane = page.getByTestId('focus-detail-pane');
    await expect(pane, '切到专注面之后，详情列里没有专注概览 —— 接线没接上').toBeVisible();

    const cards = page.locator(`${COLUMN} .ht-app__detail-card`);
    // 🔴 存在性先于取值：四张卡是本单的判据对象，少一张就是少做一件事。
    await expect(cards).toHaveCount(4);
    for (const card of await cards.all()) {
      await expect(card).toBeInViewport();
      // 标签与数字各就各位（空标签的卡会在截图里看起来"正常"，而它什么都没说）。
      await expect(card.locator('.ht-app__detail-card-label')).not.toHaveText('');
      await expect(card.locator('.ht-app__detail-card-value')).not.toHaveText('');
    }
    // 每一张都在那一列的矩形里面 —— 挂在别处（比如内容区）会看不到这个差别。
    const columnBox = await page.locator(COLUMN).boundingBox();
    expect(columnBox, '量不到详情列').not.toBeNull();
    for (const card of await cards.all()) {
      const b = await card.boundingBox();
      expect(b, '量不到卡片').not.toBeNull();
      const col = columnBox as { x: number; width: number };
      expect(
        (b as { x: number }).x >= col.x - 1 &&
          (b as { x: number; width: number }).x + (b as { width: number }).width <= col.x + col.width + 1,
        `卡片横向越出了详情列：${JSON.stringify(b)} vs ${JSON.stringify(col)}`,
      ).toBe(true);
    }

    await parkAndSettle(page);
    // 🔴 落位之后才轮到这一条：**视觉上高亮的那一格**必须就是当前视图。
    // 它和上面那些判据不重复 —— 上面量的是详情列，这一条量的是"外壳说的当前视图"
    // 与"眼睛看见的高亮"是否同一件事（F3 那张过渡帧的图正是这两者不一致的样子）。
    const highlighted = await page.evaluate(() =>
      Array.from(document.querySelectorAll<HTMLElement>('.ht-rail__tab'))
        .filter((el) => getComputedStyle(el).backgroundColor !== 'rgba(0, 0, 0, 0)')
        .map((el) => (el.textContent ?? '').trim().slice(0, 4)),
    );
    expect(
      highlighted,
      `rail 上高亮的格子不是当前视图（读到 ${JSON.stringify(highlighted)}，应为「番茄钟」；` +
        '读出两格以上=过渡没落位，这条判据的等待没生效）',
    ).toEqual(['番茄钟']);
    await page.screenshot({ path: SHOT('f1-four-cards') });
    expect(errors, `界面里有控制台错误：\n${errors.join('\n')}`).toEqual([]);
  });

  test('F2 🔴 数字那两格带 tabular-nums（AGENTS §5：不加它，25→24 会让整列宽度跳）', async ({
    page,
  }) => {
    await openApp(page, '/?lang=zh-CN');
    await switchView(page, '番茄钟');

    const got = await page
      .locator(`${COLUMN} .ht-app__detail-card-value`)
      .first()
      .evaluate((el) => getComputedStyle(el).fontVariantNumeric);
    // 这条判据只在真浏览器里存在：jsdom 不加载应用的 CSS bundle。
    expect(got, `卡上的数字没带 tabular-nums（读到 "${got}"）`).toContain('tabular-nums');
  });

  test('F3 一条记录都没有时说的是那句话，而不是留一块空白', async ({ page }) => {
    await openApp(page, '/?lang=zh-CN');
    await switchView(page, '番茄钟');
    await expect(page.getByTestId('focus-records-empty')).toBeVisible();
    await expect(page.getByTestId('focus-record')).toHaveCount(0);
    // 🔴 必须落位后再拍：这一张图的**存在理由**就是"空态说的是那句话而不是留白"，
    //    而一张 rail 还指着「任务」的过渡帧会让看图的人先去追一条不存在的缺陷。
    await parkAndSettle(page);
    await page.screenshot({ path: SHOT('f3-empty-records') });
  });

  test('F4 详情列收起时概览跟着不见，再展开又回来（与 W4 那颗开关的接缝）', async ({ page }) => {
    await openApp(page, '/?lang=zh-CN');
    await switchView(page, '番茄钟');
    await expect(page.getByTestId('focus-detail-pane')).toBeVisible();

    await page.getByTestId('detail-pane-toggle').click();
    await expect(page.getByTestId('detail-column')).toBeHidden();
    // 🔴 这一句不是重复：列被 `display:none` 藏掉时里面的东西当然也不可见，
    //    但如果只断列，"概览被渲染到列外面"那种接法照样绿。
    await expect(page.getByTestId('focus-detail-pane')).toBeHidden();

    await page.getByTestId('detail-pane-toggle').click();
    await expect(page.getByTestId('focus-detail-pane')).toBeVisible();
  });

  test('F5 🔴 真点一次「开始」再「中止」：界面上多一行记录，而今日番茄仍是 0', async ({ page }) => {
    const errors = watchErrors(page);
    await openApp(page, '/?lang=zh-CN');
    await switchView(page, '番茄钟');

    const today = page.getByTestId('focus-card-today-count');
    await expect(today).toHaveText('0');
    await expect(page.getByTestId('focus-record')).toHaveCount(0);

    await page.getByRole('button', { name: /^开始/ }).click();
    await page.getByRole('button', { name: /^中止/ }).click();

    // 落盘是异步的（op → 引擎 → 派生 → 重绘），所以这里等**结果**而不是等时间。
    await expect(page.getByTestId('focus-record')).toHaveCount(1);
    // 中止的那一行带着"中途放弃"，而"今日番茄"仍然是 0 —— 两个口径同时成立。
    await expect(
      page.locator('.ht-app__detail-record-aborted').first(),
    ).toContainText('中途放弃');
    await expect(today, '中止的一段被算成了一个番茄（口径与领域层不一致）').toHaveText('0');
    // 累计时长含这一段（哪怕它只有几秒），所以"总番茄 0 / 总时长 > 0 分钟"是**对的**。
    await expect(page.getByTestId('focus-card-total-count')).toHaveText('0');

    await parkAndSettle(page);
    await page.screenshot({ path: SHOT('f5-aborted-record') });
    expect(errors, `界面里有控制台错误：\n${errors.join('\n')}`).toEqual([]);
  });

  test('F6 其他视图不许借这一格放专注概览', async ({ page }) => {
    await openApp(page, '/?lang=zh-CN');
    for (const view of ['日历', '习惯', '时间线'] as const) {
      await switchView(page, view);
      await expect(
        page.getByTestId('focus-detail-pane'),
        `${view} 面上出现了专注概览`,
      ).toHaveCount(0);
    }
  });
});
