/**
 * 热力图月份标签的**几何**判据（工单 H8）
 * ======================================
 *
 * 起因是看图：`apps/web/evidence/habit-month/month-default.png` 那一片区域里，
 * 「7月」「10月」这种 2–3 枚字形**每一枚都被折成两行** —— 因为标签格的宽度写的是
 * 一格热力图的宽（`icon.xs` = 14px 现量）。修法不是把那一格加宽了事（组件文件头那句
 * "月份标签与格子同一套列宽，否则标签会与它标注的那一列错开"是承重的），
 * 而是让标签**跨过它标注的那几周**，列数由 `heatMonthSpans(weeks)` 从同一份列数据数出来。
 *
 * 🔴 为什么这三条必须在真浏览器里跑（`packages/ui/tests/habits-model.spec.ts` 的 L1–L3 不够）：
 *   L1–L3 钉的是**恒等式**（列分得完、起点是月份变的那些列、两排算出来等宽），
 *   而"字有没有折行"是**排版**的结果 —— jsdom 不做布局，`getBoundingClientRect()` 恒 0，
 *   它结构上看不见这件事（与 H1/H3/H5 那三族同一个理由）。
 *   所以这里量三件只有浏览器知道的东西：
 *     HL1 每一枚标签**只有一行高**（拿它自己那行的 `line-height` 当尺，不写字面像素）；
 *     HL2 每一枚标签的**左边缘**贴着它标注的那一周的左边缘，且标签之间不互相压字；
 *     HL3 没有任何一枚标签溢出**窗格右边界**（跨列 + 两列下界会让最后一枚探出网格，
 *         探出窗格才是真会被裁的那种坏）。
 *   🔴 为什么 HL2 不写成"右边缘也得落在它跨的那几周之内"：窗口末尾那一列常常只有
 *   零星几天（现量：今天 10-06 时「10月」那枚的 `span == 1`），而"至少两列宽"的下界
 *   正是为了让它装得下三枚字形 —— 于是它**必然**探出自己的那一列。探出那一列不是错，
 *   探出窗格才是错。把判据写成"落在自己那几周之内"会把修法本身判红。
 *
 * ⚠️ 载体：`vite preview` + `apps/web/dist`（见 `playwright.detail-pane.config.ts` 文件头）。
 *    改了 `packages/ui` **必须先重打**，否则测的是旧产物（§7 第 27 条）。
 * 跑法：
 *    cd e2e && npx playwright test tests/habit-heatmap-labels.spec.ts \
 *      --config playwright.detail-pane.config.ts
 */
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';

import { addHabit, openApp, selectHabit, switchView } from './helpers';

const APP_ZH = '/?lang=zh-CN';

const SHOT = (name: string) =>
  fileURLToPath(
    new URL(`../../apps/web/evidence/habit-heatmap-labels/${name}.png`, import.meta.url),
  );

const heat = (page: Page) => page.getByTestId('habit-board-heat');
const monthRow = (page: Page) => page.getByTestId('habit-board-heat-months');
const gridRow = (page: Page) => page.getByTestId('habit-board-heat-grid');
/** 只命中"某枚标签"，不会把那一排的容器 `…-months` 一起捞进来（它 `month` 后面没有连字符）。 */
const labelCells = (page: Page) => page.locator('[data-testid^="habit-board-heat-month-"]');

/** `…-heat-month-<列号>` → 那一枚标签起始于第几列。 */
const columnOf = (testId: string): number => Number(testId.replace(/^.*-heat-month-/, ''));

/**
 * 一枚标签的盒子 + 它**内部那行字**的行高。
 * 行高从计算样式读（`text.caption` 整条消费了排版 token），拿它当尺子才不写死像素；
 * 万一浏览器报 `normal`，退到 `font-size × 1.5` —— 那也是它自己那一条样式的推导，不是拍的值。
 */
async function labelBox(page: Page, index: number) {
  return labelCells(page)
    .nth(index)
    .evaluate((el) => {
      const box = el.getBoundingClientRect();
      const text = el.querySelector('div,span') ?? el;
      const cs = getComputedStyle(text);
      const lh = cs.lineHeight === 'normal' ? Number.parseFloat(cs.fontSize) * 1.5 : Number.parseFloat(cs.lineHeight);
      return {
        testid: el.getAttribute('data-testid') ?? '',
        left: Math.round(box.left),
        right: Math.round(box.right),
        width: Math.round(box.width),
        height: Math.round(box.height),
        lineHeight: Math.round(lh),
        content: (el.textContent ?? '').trim(),
      };
    });
}

async function weekBox(page: Page, column: number) {
  return page.getByTestId(`habit-board-heat-week-${String(column)}`).evaluate((el) => {
    const b = el.getBoundingClientRect();
    return { left: Math.round(b.left), right: Math.round(b.right) };
  });
}

test.describe('热力图月份标签（H8，web 端）', () => {
  test.beforeEach(async ({ page }) => {
    await openApp(page, APP_ZH);
    await switchView(page, '习惯');
  });

  test('HL1 🔴 每一枚月份标签**只有一行高**（不折行）', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    page.on('pageerror', (e) => errors.push(String(e)));

    await addHabit(page, '标签折行');
    await selectHabit(page, '标签折行');
    await expect(heat(page)).toBeVisible();

    const count = await labelCells(page).count();
    // 阳性对照：90 天窗口**必然**跨过 ≥3 个月。少了这条，"没有一枚折行"会因为
    // "根本没有标签"而假绿（§7 元规则 2：先断前提确实成立）。
    expect(count, '热力图上没有月份标签 ⇒ 时间轴整条没了，下面所有读数都是空的').toBeGreaterThanOrEqual(
      3,
    );

    const folded: string[] = [];
    for (let i = 0; i < count; i += 1) {
      const box = await labelBox(page, i);
      // 一行 = 那一行的行高（留 25% 余量给基线取整；两行会是 ~200%）。
      if (box.height > box.lineHeight * 1.25) {
        folded.push(`${box.content}：高 ${String(box.height)}px / 行高 ${String(box.lineHeight)}px`);
      }
      expect(box.width, `「${box.content}」那一格宽 0 ⇒ 跨列没生效`).toBeGreaterThan(box.lineHeight);
    }
    expect(
      folded,
      `${String(folded.length)} 枚月份标签折成了两行（${folded.join(' ; ')}）`,
    ).toEqual([]);

    await heat(page).screenshot({ path: SHOT('labels-one-line') });
    expect(errors, `控制台有报错：${errors.join(' | ')}`).toEqual([]);
  });

  test('HL2 🔴 每一枚标签的左边缘贴着它标注的那一周，且标签之间不互相压字', async ({ page }) => {
    await addHabit(page, '标签对位');
    await selectHabit(page, '标签对位');

    const ids = await labelCells(page).evaluateAll((nodes) =>
      nodes.map((n) => n.getAttribute('data-testid') ?? ''),
    );
    expect(ids.length, '没有月份标签可对位').toBeGreaterThanOrEqual(3);
    const columns = ids.map(columnOf);
    expect(
      [...columns].sort((a, b) => a - b),
      '标签的列号与 DOM 顺序不一致 ⇒ 下面按列算落点会算错',
    ).toEqual(columns);

    const boxes: { content: string; left: number; right: number }[] = [];
    for (let i = 0; i < columns.length; i += 1) {
      const box = await labelBox(page, i);
      boxes.push(box);
      const first = await weekBox(page, columns[i] ?? 0);
      expect(
        Math.abs(box.left - first.left),
        `「${box.content}」左边缘 ${String(box.left)} 不在它那一周 ${String(first.left)} 上 ⇒ 标签与格子错列`,
      ).toBeLessThanOrEqual(1);
    }
    const overlap = boxes.filter((a, idx) =>
      boxes.some((b, jdx) => jdx === idx + 1 && a.right > b.left + 1),
    );
    expect(
      overlap.length,
      `${String(overlap.length)} 枚标签压到了下一枚上 ⇒ 时间轴读不出哪句属于哪一段`,
    ).toBe(0);

    /* 这一张只拍**标签那一排**：HL2 说的是"哪句属于哪一段"，格子本身不参与判断，
       拍进图里只会让下一位以为格子也在判据内（§6.2 规定一：图要说的是那条断言的话）。 */
    await monthRow(page).screenshot({ path: SHOT('labels-aligned') });
  });

  test('HL3 🔴 没有一枚标签溢出窗格右边界（探出网格可以，探出窗格不行）', async ({ page }) => {
    await addHabit(page, '标签溢出');
    await selectHabit(page, '标签溢出');

    const pane = await page.getByTestId('habit-pane').evaluate((el) => {
      const b = el.getBoundingClientRect();
      return { left: Math.round(b.left), right: Math.round(b.right) };
    });
    const ids = await labelCells(page).evaluateAll((nodes) =>
      nodes.map((n) => n.getAttribute('data-testid') ?? ''),
    );
    const outside: string[] = [];
    for (let i = 0; i < ids.length; i += 1) {
      const box = await labelBox(page, i);
      if (box.right > pane.right) outside.push(`${box.content}：右 ${String(box.right)} > 窗格 ${String(pane.right)}`);
    }
    expect(outside, `${String(outside.length)} 枚月份标签被窗格裁掉（${outside.join(' ; ')}）`).toEqual([]);

    /* 🔴 这张图要拍的是**热力区那一横条 + 窗格的右边界**，不是热力区自己：
       HL3 判的是"探出窗格才算被裁"，而一张只有热力区的元素图里根本没有窗格那条边，
       看图的人会以为图在替 HL1 说话。元素截图到视口边就断、不拼接（§7 第 170 条那一族），
       所以先把视口拉高，再证明"要拍的那一块整块在视口内"——否则这张图说的不是判据说的话。
       三张图的取景各不相同，也是在挡 §7 第 337 条那种"一批不同状态的图 md5 逐字相同"。 */
    const size = page.viewportSize() ?? { width: 1280, height: 720 };
    await page.setViewportSize({ width: size.width, height: 1600 });
    const shot = await heat(page).evaluate((el) => {
      el.scrollIntoView({ block: 'center' });
      const heat = el.getBoundingClientRect();
      const pane = document.querySelector('[data-testid="habit-pane"]')?.getBoundingClientRect();
      return {
        heatTop: heat.top,
        heatBottom: heat.bottom,
        paneLeft: pane?.left ?? heat.left,
        paneRight: pane?.right ?? heat.right,
        vh: window.innerHeight,
      };
    });
    expect(shot.heatTop, '热力区上边掉出视口 ⇒ clip 会裁在标签那一排中间').toBeGreaterThanOrEqual(0);
    expect(shot.heatBottom, '热力区下边掉出视口 ⇒ clip 会裁在半截格子上').toBeLessThanOrEqual(shot.vh);
    await page.screenshot({
      path: SHOT('labels-in-pane'),
      clip: {
        x: Math.max(0, shot.paneLeft),
        y: Math.max(0, shot.heatTop - 8),
        width: shot.paneRight - shot.paneLeft,
        height: shot.heatBottom - shot.heatTop + 16,
      },
    });
  });
});
