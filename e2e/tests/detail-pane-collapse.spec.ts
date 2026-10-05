/**
 * 详情列的出现条件与收起（工单 W4）
 * =================================
 *
 * W2 交付了那根列，W4 交付它的**两件事**：什么时候自己不出现（①），
 * 以及用户能不能自己收起来、收起来之后怎么回来（②③）。
 * 这三条都只能在真浏览器里量：jsdom 不跑布局、也不加载应用的 CSS bundle，
 * 所以 `apps/web/tests/detail-pane-collapse.spec.tsx` 只能证"宿主接了一段真实状态"，
 * **证不了这一栏画不画得出来**。两份各管各的层，别把任何一份的绿读成整单做完。
 *
 * 🔴 承重的是 T2 里那句"收起之后 `.ht-main` 的右边缘 == 视口右边缘"。
 * 如果只断"详情列不见了"，那么"给子项加 `display:none` 但忘了把 grid 轨道归零"
 * 这一份实现**完全成立** —— 而用户在界面上看到的是右边一道 22rem 的死空白。
 * 断"元素消失"抓不住"轨道还在"，这是本文件存在的主要理由。
 *
 * 🔴 T1 把边界**两侧都量**（高 480 必须有、479 必须没有）。
 * 阈值来自仓库里已取证的那一行（调研 A1 引 Android 窗口尺寸类：高度轴 <480 / 480–900 / ≥900 dp，
 * "宽度 Medium 且高度 Compact"时两栏不可行）。只量一侧的判据挡不住"把 479 写成 599"，
 * 也挡不住反过来把整块断点删掉之后另一侧仍然绿的那种空读数。
 *
 * ⚠️ 截图路径按**本文件位置**解析（`import.meta.url`）：相对路径按进程 cwd 解析，
 *    在 linked worktree 里会把证据写进主检出（`selection-projections.spec.ts` 文件头记着那次事故）。
 */
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { openApp, openSettingsView, parkCursor, switchView } from './helpers';

const STORAGE_KEY = 'heyta.detailPane';

const SHOT = (name: string) =>
  fileURLToPath(new URL(`../../apps/web/evidence/detail-pane-collapse/${name}.png`, import.meta.url));

/** 控制台错误进断言（§6.2 规定一第 3 条），监听必须在导航之前挂上。 */
function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console: ${m.text()}`);
  });
  page.on('pageerror', (e) => errors.push(`pageerror: ${String(e)}`));
  return errors;
}

/** 把设备本地偏好播种成"已收起"。用 `addInitScript` 而不是导航后写存储：
 *  写完之后还要刷新一次才生效，而那一次刷新正是 T2 自己要证的东西，不能借来做前提。 */
async function seedCollapsed(page: Page): Promise<void> {
  await page.addInitScript((key) => {
    window.localStorage.setItem(key, '"collapsed"');
  }, STORAGE_KEY);
}

/** `.ht-main` 的右边缘（"死轨道"那条判据的量）。 */
async function mainRightEdge(page: Page): Promise<number> {
  const box = await page.locator('.ht-main').boundingBox();
  expect(box, '量不到 .ht-main 的 boundingBox').not.toBeNull();
  return (box as { x: number; width: number }).x + (box as { width: number }).width;
}

async function viewportWidth(page: Page): Promise<number> {
  const size = page.viewportSize();
  expect(size, '量不到视口尺寸').not.toBeNull();
  return (size as { width: number }).width;
}

test.describe('详情列的出现条件与收起', () => {
  test('T1 🔴 高度边界两侧都量：480 有、479 没有、回到 720 又回来', async ({ page }) => {
    const errors = watchErrors(page);
    await openApp(page, '/?lang=zh-CN');
    const vw = await viewportWidth(page);

    // ── 可行档的下沿：高**正好** 480 必须画出来 ─────────────────────
    // `(max-height: 479px)` 写成 480 就会在这一句红 —— 那正是"把能用的窗口判成不能用"的方向，
    // 而那个错误只会表现为"这一栏今天怎么没出来"，没人会截图一个没出现的界面去举证它。
    await page.setViewportSize({ width: vw, height: 480 });
    await expect(
      page.getByTestId('detail-column'),
      '高 480 是高度 Medium 的下沿（可行档），详情列却被收掉了 —— 断点把边界值算进"矮"这一档',
    ).toBeVisible();
    await expect(page.getByTestId('detail-pane-toggle')).toBeVisible();

    // ── 不可行档：高 479 ⇒ 列不出现，**开关也不出现** ────────────────
    await page.setViewportSize({ width: vw, height: 479 });
    await expect(
      page.getByTestId('detail-column'),
      '高 479（Android 高度 Compact）里详情列仍然占位 —— 两栏在这个组合下是不可行的',
    ).toBeHidden();
    // 🔴 开关必须跟着藏：那一栏根本没地方画，还留一个"展开详情面"的按钮
    //    就是界面在说谎（能点、能聚焦、点了什么都不出）。先例是 `.ht-sidebar__resizer`。
    await expect(
      page.getByTestId('detail-pane-toggle'),
      '详情列画不出来的视口里，页头那个开关还在 —— 点了不会有任何变化',
    ).toBeHidden();

    // 正对照：这一档里应用**本身是好的**。少了这三句，"列不见了"可能只是整片没渲染，
    // 而那种红会被当成断点生效。
    await expect(page.locator('.ht-main')).toBeVisible();
    await expect(page.locator('.ht-header__title').first()).toBeVisible();
    await expect(page.locator('input[placeholder^="添加任务"]')).toBeVisible();

    // ── 回到 720 必须又出现：否则上面两条只是"它从来没渲染过"的恒真读数 ──
    await page.setViewportSize({ width: vw, height: 720 });
    await expect(
      page.getByTestId('detail-column'),
      '拉回 720 高之后详情列没回来 —— 那"479 里隐藏"那条量的就不是断点',
    ).toBeVisible();

    await parkCursor(page);
    await page.screenshot({ path: SHOT('t1-height-boundary-back') });
    expect(errors, `界面里有控制台错误：\n${errors.join('\n')}`).toEqual([]);
  });

  test('T2 🔴 收起后不留死轨道，且刷新之后仍是收起', async ({ page }) => {
    const errors = watchErrors(page);
    await openApp(page, '/?lang=zh-CN');
    const vw = await viewportWidth(page);

    // 前提：先证这一栏**本来在**、中间列本来不贴边 —— 后面那句"贴边了"才有对照。
    await expect(page.getByTestId('detail-column')).toBeVisible();
    const before = await mainRightEdge(page);
    expect(
      before,
      '起点就不贴边：说明详情列没占到位置，后面"收起后贴边"量的不是这次动作',
    ).toBeLessThanOrEqual(vw - 100);

    await page.getByTestId('detail-pane-toggle').click();
    await expect(page.getByTestId('detail-column')).toBeHidden();
    await expect(page.locator('.ht-app')).toHaveAttribute('data-detail', 'collapsed');

    // ── 承重：轨道必须一起归零 ──────────────────────────────────────
    const after = await mainRightEdge(page);
    expect(
      Math.abs(after - vw),
      `收起后 .ht-main 右边缘 ${String(after)} 没到视口右边 ${String(vw)} —— 那一列的 grid 轨道还占着位置（右边会留一道死空白）`,
    ).toBeLessThanOrEqual(1);

    await parkCursor(page);
    await page.screenshot({ path: SHOT('t2-collapsed-no-gutter') });

    // ── 持久化（工单 ③）：刷新之后仍然是收起 ────────────────────────
    await page.reload();
    await expect(page.getByTestId('detail-column')).toBeHidden();
    const reloaded = await mainRightEdge(page);
    expect(
      Math.abs(reloaded - vw),
      `刷新后右边缘回到 ${String(reloaded)} —— 状态读回来了但轨道没归零`,
    ).toBeLessThanOrEqual(1);
    await page.screenshot({ path: SHOT('t2-still-collapsed-after-reload') });

    // 反向对照：这一栏并没有被"永久藏起来"——再点开关就回来，而且是同一个机制。
    await page.getByTestId('detail-pane-toggle').click();
    await expect(page.getByTestId('detail-column')).toBeVisible();
    expect(errors, `界面里有控制台错误：\n${errors.join('\n')}`).toEqual([]);
  });

  test('T3a 恢复路径①：页头的开关', async ({ page }) => {
    await seedCollapsed(page);
    await openApp(page, '/?lang=zh-CN');
    await expect(page.getByTestId('detail-column')).toBeHidden();

    await page.getByTestId('detail-pane-toggle').click();
    await expect(page.getByTestId('detail-column')).toBeVisible();
    await expect(page.locator('.ht-app')).toHaveAttribute('data-detail', 'open');
    await expect
      .poll(() => page.evaluate((key) => window.localStorage.getItem(key), STORAGE_KEY))
      .toBe('"open"');
  });

  test('T3b 恢复路径②：设置里那一项', async ({ page }) => {
    await seedCollapsed(page);
    await openApp(page, '/?lang=zh-CN');
    await expect(page.getByTestId('detail-column')).toBeHidden();

    await openSettingsView(page);
    const group = page.getByTestId('detail-pane-pref');
    await expect(group).toBeVisible();
    // 正对照：当前选中的必须是「收起」那一只，否则"点常驻"可能点的就是它自己。
    const checkedLabel = group.locator('label', { has: page.locator('input:checked') });
    await expect(checkedLabel).toContainText('收起');

    await group.getByRole('radio', { name: '常驻' }).click();
    await expect(page.getByTestId('detail-column')).toBeVisible();
    await expect(page.locator('.ht-app')).toHaveAttribute('data-detail', 'open');

    await parkCursor(page);
    await page.screenshot({ path: SHOT('t3b-settings-option') });
  });

  test('T3c 恢复路径③：快捷键 ⌘/Ctrl + Shift + \\', async ({ page }) => {
    await seedCollapsed(page);
    await openApp(page, '/?lang=zh-CN');
    await expect(page.getByTestId('detail-column')).toBeHidden();

    // 🔴 从**真键盘**发出去，不走任何一条 JS 出口：这一条路径的全部风险就是
    //    "监听挂错阶段/组合键被浏览器吃掉"（§7 #80 那条同源：RNW 吞 keydown 冒泡）。
    //    三条路径各发各的键，才有"摘掉快捷键 ⇒ 这一条红"的可能。
    await page.keyboard.press('Control+Shift+\\');
    await expect(
      page.getByTestId('detail-column'),
      '按了组合键详情列没回来 —— 快捷键那条路径没接上（或被浏览器吃掉了键）',
    ).toBeVisible();
    await expect(page.locator('.ht-app')).toHaveAttribute('data-detail', 'open');

    // 再按一次收回去：这条路径是**双向**开关，不是一条只能展开的路。
    await page.keyboard.press('Control+Shift+\\');
    await expect(page.getByTestId('detail-column')).toBeHidden();
  });

  test('T4 三种"画不出来"的视口里，开关与列一起消失（界面不许说谎）', async ({ page }) => {
    const errors = watchErrors(page);
    await openApp(page, '/?lang=zh-CN');

    // 正对照先走一次：这一档里两者**都在**，否则下面三句"都不在"可以是恒真。
    await page.setViewportSize({ width: 1280, height: 720 });
    await expect(page.getByTestId('detail-column')).toBeVisible();
    await expect(page.getByTestId('detail-pane-toggle')).toBeVisible();

    // 三种不可行：≤768 塌缩 / 769–1023 放不下 / ≥1024 但高 < 480。
    // 前两种是 W2 已有的档，**开关跟着藏是 W4 新加的** —— 那两档以前没有开关，
    // 所以变异臂 M6/M7 各打一档，而不是一句"整个文件里都没了"。
    for (const [w, h] of [
      [700, 800],
      [900, 800],
      [1280, 470],
    ] as const) {
      await page.setViewportSize({ width: w, height: h });
      await expect(
        page.getByTestId('detail-column'),
        `${String(w)}×${String(h)} 里详情列仍占位置`,
      ).toBeHidden();
      await expect(
        page.getByTestId('detail-pane-toggle'),
        `${String(w)}×${String(h)} 里页头那个开关还在 —— 那一栏画不出来，点了不会有任何变化`,
      ).toBeHidden();
      // 正对照：应用本身在这一档是好的（"什么都没渲染"会让上面两句假绿）。
      await expect(
        page.locator('input[placeholder^="添加任务"]'),
        `${String(w)}×${String(h)} 这一档里界面根本没渲染，那"列与开关都不在"量的就不是断点`,
      ).toBeVisible();
    }

    await parkCursor(page);
    await page.screenshot({ path: SHOT('t4-toggle-gone-when-infeasible') });
    expect(errors, `界面里有控制台错误：\n${errors.join('\n')}`).toEqual([]);
  });

  test('T5 🔴 页头新加这颗按钮不许把那一排顶出视口（控件在 ≠ 点得到）', async ({ page }) => {
    const errors = watchErrors(page);
    await openApp(page, '/?lang=zh-CN');

    /*
     * 这一条不是装饰，是本单**自己引入的风险**：`.ht-header__actions` 是
     * `flex: 0 0 auto`（不许压窄），往里加一格就可能把最右边顶出视口 ——
     * 而 `e2e/tests/calendar-cells.spec.ts:107` 钉的正是这件事。
     * 更阴的一面是它只在**某些视图**上成立：日历那一面页头还有月历工具栏、
     * 任务那一面还有排序下拉，习惯/番茄钟两面是空的。
     * 🔴 所以这一条挑**最挤的两面**，并且连最窄的可行档（1024 宽）一起量 ——
     *    只量 1280 会正好错过"窗口再窄一点就点不到"的那个区间。
     */
    const probe = async (label: string) => {
      const m = await page.locator('header.ht-header').evaluate((el) => {
        const toggle = document.querySelector<HTMLElement>('[data-testid="detail-pane-toggle"]');
        return {
          scrollWidth: el.scrollWidth,
          clientWidth: el.clientWidth,
          toggleRight: toggle ? Math.round(toggle.getBoundingClientRect().right) : -1,
          viewport: window.innerWidth,
        };
      });
      expect(
        m.scrollWidth,
        `${label}：页头横向溢出（scrollWidth ${String(m.scrollWidth)} > clientWidth ${String(
          m.clientWidth,
        )}）—— 那颗按钮把这一排顶出去了`,
      ).toBeLessThanOrEqual(m.clientWidth + 1);
      expect(
        m.toggleRight,
        `${label}：量不到开关的右边缘 —— 它没渲染出来，下面那句"贴边"就成了空判据`,
      ).toBeGreaterThan(0);
      expect(
        m.toggleRight,
        `${label}：开关右边缘 ${String(m.toggleRight)} 越过视口右边 ${String(
          m.viewport,
        )} —— 它在 DOM 里但点不到`,
      ).toBeLessThanOrEqual(m.viewport);
      // 🔴 最后一句要的是**用户级**的结论："这颗按钮在视口里"。
      //    上面两句量的是数字，数字对了而元素被 `overflow:hidden` 裁掉时它们仍然绿；
      //    `toBeInViewport` 才是"点得到"那句话本身。
      await expect(
        page.getByTestId('detail-pane-toggle'),
        `${label}：开关不在视口里（页头挤不下时它被推出去了）`,
      ).toBeInViewport();

      /*
       * 🔴 第三档：这一排的**每一只控件都得保住自己的自然宽度**。
       *
       * 上面三句挡的是"顶出视口"，挡不住"原地挤扁"。实测（同一次加载里用 CSSOM
       * 把 `flex-wrap` 切成 nowrap）：页头既不溢出（`scrollWidth == clientWidth`）、
       * 开关也照样在视口里 ⇒ 三句**全绿**，而图标按钮从 52px 被压成 32px、
       * 语言 chip 从 40 压成 29。变异臂 W4-M11 就是这样**存活**的 ——
       * 那意味着"宁可换行、不许压扁"这条选择当时一行判据都没有。
       *
       * 自然宽度不抄常量（抄 44 之类的数会既挡不住 32、又误杀 40 那只 chip）：
       * 把该子项临时改成 `width: max-content` **现量**，读完立刻还原 cssText。
       * 这条判据的"能不能失败"由 M11 回答，不由它自己回答。
       */
      const squashed = await page
        .locator('header.ht-header .ht-header__actions')
        .evaluate((box) => {
          const bad: { text: string; rendered: number; natural: number }[] = [];
          for (const child of Array.from(box.children) as HTMLElement[]) {
            const prev = child.style.cssText;
            const rendered = Math.round(child.getBoundingClientRect().width);
            child.style.cssText += ';flex:0 0 auto;min-inline-size:0;width:max-content;';
            const natural = Math.round(child.getBoundingClientRect().width);
            child.style.cssText = prev;
            if (rendered < natural - 1) {
              bad.push({ text: (child.textContent ?? '').trim().slice(0, 12), rendered, natural });
            }
          }
          return bad;
        });
      expect(
        squashed,
        `${label}：这些页头控件被压扁了（宁可换行，也不许把点击区压窄）`,
      ).toEqual([]);
    };

    // 最挤的两面 × 两个宽度档。
    for (const width of [1280, 1024] as const) {
      await page.setViewportSize({ width, height: 720 });
      await switchToTasks(page);
      await expect(page.getByTestId('detail-pane-toggle')).toBeVisible();
      await probe(`任务面 ${String(width)}×720`);

      await switchToCalendar(page);
      await expect(page.getByTestId('detail-pane-toggle')).toBeVisible();
      await probe(`日历面 ${String(width)}×720`);
    }

    await parkCursor(page);
    await page.screenshot({ path: SHOT('t5-header-with-toggle') });
    expect(errors, `界面里有控制台错误：\n${errors.join('\n')}`).toEqual([]);
  });
});

/**
 * 切到任务面 / 日历面，并用**那一面独有的锚点**证真切过去了。
 *
 * ⚠️ 不要用 `.ht-header__title` 当"到了任务面"的证据：R9 之后标题跟视图走，
 *    **唯独任务视图读 `store.filter`** ⇒ 默认那一面标题是「收集箱」而不是「任务」。
 *    第一版就是照这句话写的，红了才知道（`Received: "收集箱"`）。
 *    日历那一面还必须量到月历工具栏 —— 它正是页头最挤的那一面（多一整套 `‹ 月份 ›`）。
 */
async function switchToTasks(page: Page): Promise<void> {
  await switchView(page, '任务');
  await expect(page.locator('input[placeholder^="添加任务"]')).toBeVisible();
}

async function switchToCalendar(page: Page): Promise<void> {
  await switchView(page, '日历');
  await expect(page.getByTestId('calendar-toolbar-month')).toBeVisible();
}
