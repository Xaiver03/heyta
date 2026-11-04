import { expect, test } from '@playwright/test';
import { addTask, metaFor, openApp, parkCursor, rowFor, switchTheme, switchView, waitForOverlaySettled } from './helpers';

/**
 * 滴答对齐阶段 3-4 的**浏览器腿**（单元层量不到的那三格）。
 *
 * 这三格都不是"类名在不在"，而是**屏幕上真的读得出什么**：
 *
 *   ① C4 逾期红色 —— 单测只能证 `ht-due--overdue` 挂上了；"看起来是红的"必须
 *      拿计算色与 `--ht-color-danger` 比。**比色值而不是比十六进制字面量**：
 *      token 在亮暗两套下不一样，写死任何一个数都会在另一套里假红或假绿。
 *   ② C2 底部工具条 —— 前两枚判**点完之后焦点在哪个控件上**（与单测同一条口径，
 *      但这里连"滚动 + 聚焦"那一步的真实布局一起量，jsdom 没有布局）；第三枚「更多」
 *      判的是**它能不能把行菜单里的一件事做成** —— 面单里的动作区此前只有隐形把手。
 *   ③ D3 分组说明 —— 那两句只在**有清单/有标签**时出现，空态下该让位给空态文案；
 *      这一格在截图里要看得见，不然"显示正确"只是源码级说法。
 *
 * ⚠️ 建清单/建标签都走界面上的真入口（`+` → 对话框），不用 `page.evaluate` 塞 store：
 * 这条腿要证的是"用户点得出来"，直接写状态等于把要证的那一步跳过去。
 */
test.use({ viewport: { width: 1280, height: 900 } });

const LIST = '深度工作';
const TAG = '报销';

/**
 * 走侧栏那两个 `+` 建一条清单 / 一条标签。
 *
 * ⚠️ 建完的确认**收在侧栏这一列里**：清单名同时会出现在页头标题上（选中它之后
 * 页头就写那个名字），整页 `getByText` 会同时命中两枚 —— 那是探针的口径错了，
 * 不是产品画重了。
 */
async function createCategory(page: import('@playwright/test').Page, buttonName: string, name: string, submitName: string) {
  const sidebar = page.locator('nav.ht-sidebar');
  await sidebar.getByRole('button', { name: buttonName }).click();
  await page.locator('#ht-category-create-name').fill(name);
  await page.getByRole('button', { name: submitName }).click();
  await expect(sidebar.getByText(name, { exact: true })).toBeVisible();
}

/**
 * 回**收集箱**那一档范围。
 *
 * 🔴 这一句在下面两条用例里都是**前提**，不是多余的导航：建完清单 / 标签之后
 * `ProjectsPanel.onCreate` 会把侧栏范围切到刚建的那一格（`onFilterWith`），
 * 而"归属换成收集箱"或"新任务还没打标签"的行都不在那个范围里 ——
 * 就地找那一行只会红成 `element(s) not found`（上一版两条都红在这里，产品是对的，
 * 是探针跟着筛选跑）。回收集箱的手势是**再点一次 rail 的「任务」**
 * （侧栏没有「收集箱」那一行，2026-10-04 删掉了：与页头标题重复 = 一个目的地两个控件）。
 */
async function backToInbox(page: import('@playwright/test').Page): Promise<void> {
  await switchView(page, '任务');
  await expect(page.locator('.ht-header__title').first()).toHaveText('收集箱');
}

test.describe('滴答对齐：逾期色 / 工具条 / 分组说明', () => {
  test('① 逾期那一行的徽标计算色 = danger token，且带日历或计时图标', async ({ page }) => {
    await openApp(page);
    // 🔴 捕获把「昨天」当**日期**吃掉了，标题只剩「交房租」—— 所以这一行按
    // 剩下的那个标题找，不能按"输入的原话"找（`addTask` 那条 helper 断的是原话）。
    await page.locator('input[placeholder^="添加任务"]').fill('交房租 昨天');
    await page.locator('input[placeholder^="添加任务"]').press('Enter');
    const row = page.locator('[data-testid^="task-item-"]').filter({ hasText: '交房租' }).first();
    await expect(row, '打了「交房租 昨天」却没有那一行').toBeVisible();

    // 🔴 探针挂在**真正渲染出来的那一个**上：任务行的徽标来自共享 `TaskBadges`
    // （`packages/ui/src/task-list/TaskBadges.tsx`：逾期用 `color.danger` + 警告字形）。
    // `apps/web` 里那一支 `DueBadge` / `.ht-due--overdue` 现在没有渲染点，
    // 拿它当探针只会量到空气 —— 这一格实测错过一次，所以把出处写在断言旁边。
    // 🔴 探针挂在**真正渲染出来的那一个**上：任务行的徽标来自共享 `TaskBadges`
    // （`packages/ui/src/task-list/TaskBadges.tsx`：逾期那一格用 `color.danger` + 警告字形）。
    // `apps/web` 里那一支 `DueBadge` / `.ht-due--overdue` 现在**没有渲染点**，
    // 拿它当探针只会量到空气 —— 这一格实测错过一次，所以把出处写在断言旁边。
    //
    // ⚠️ 文案按当下的显示档是**日期**（`11-03`），不是"已逾期 1 天"：
    // 默认档是 `date`，倒计时那一档要用户在设置里开（`due-display-pref.ts`）。
    // 所以这条判据量的是**色与形状**，不量措辞 —— 措辞另有单测逐日对账
    // （`apps/web/tests/due-display.spec.ts`）。
    const badges = row.locator('[data-testid="task-meta"]').first();
    await expect(badges, '这一行没有徽标区').toBeVisible();

    const read = await badges.evaluate((el) => {
      const probe = document.createElement('span');
      probe.style.color = 'var(--ht-color-danger)';
      document.body.append(probe);
      const token = getComputedStyle(probe).color;
      probe.remove();
      // 每个**叶子文字节点**配上它自己的计算色一起交回去：外层容器不写字色，
      // 拿容器的 computed color 会读到继承来的正文色，那条判据就恒不成立。
      const leaves: { text: string; color: string }[] = [];
      const walk = (node: Element): void => {
        const kids = [...node.children];
        if (kids.length === 0) {
          leaves.push({ text: (node.textContent ?? '').trim(), color: getComputedStyle(node as HTMLElement).color });
          return;
        }
        kids.forEach(walk);
      };
      walk(el);
      return { token, leaves, icons: el.querySelectorAll('svg').length };
    });

    const due = read.leaves.find((leaf) => /^\d{1,2}-\d{1,2}$/.test(leaf.text));
    expect(due, `徽标里没有日期那一格（读到 ${JSON.stringify(read.leaves.map((l) => l.text))}）`).toBeDefined();
    expect(due!.color, `逾期日期那一格的色是 ${due!.color}，danger token 是 ${read.token}`).toBe(read.token);
    // 颜色之外还得有**形状**这条冗余通道（色盲与暗色都得读得出）。
    expect(read.icons, '徽标区一个图标都没有 = 只剩颜色这一条通道').toBeGreaterThan(0);

    await page.screenshot({ path: 'test-results/dida-overdue-badge.png' });
  });

  test('② 底部工具条三枚：两枚把焦点送到字段，第三枚把行菜单做成一件事', async ({ page }) => {
    await openApp(page);
    await createCategory(page, '新建清单', LIST, '创建清单');
    await addTask(page, '写周报');
    // 建完清单之后页头标题就是那条清单，行要按任务标题点。
    await page.locator('[data-testid^="task-row-"]').filter({ hasText: '写周报' }).first().click();

    const toolbar = page.getByTestId('task-detail-toolbar');
    await expect(toolbar, '详情面底部没有工具条').toBeVisible();
    await expect(toolbar.locator('button')).toHaveCount(3);

    await page.getByTestId('task-detail-goto-note').click();
    await expect
      .poll(() => page.evaluate(() => document.activeElement?.getAttribute('data-testid') ?? ''), {
        message: '点「备注」之后焦点不在备注正文框上',
      })
      .toBe('task-note-input');

    await page.getByTestId('task-detail-goto-list').click();
    await expect
      .poll(() => page.evaluate(() => document.activeElement?.getAttribute('data-testid') ?? ''), {
        message: '点「移动到」之后焦点不在清单下拉上',
      })
      .toBe('organize-project-select');

    // 🔴 第三枚「更多」判的是**它能不能做成一件事**，不是它存不存在：
    // 面单里此前只有右键 / Shift+F10 两个隐形把手，界面上没有可见入口 ——
    // 所以这一枚的意义是"动作区可达"，断言必须打到菜单里那一项真的写进数据。
    await toolbar.scrollIntoViewIfNeeded();
    await page.getByTestId('task-detail-more').click();
    await expect(
      page.getByTestId('task-row-menu'),
      '点面单里的「更多」没有打开这条任务的行菜单',
    ).toBeVisible();
    await page.getByTestId('task-row-menu-priority').click();
    await page.getByTestId('task-row-menu-priority-3').click();
    await expect(
      page.getByTestId('task-row-menu'),
      '选完档位菜单该收掉',
    ).toHaveCount(0);
    await expect(
      metaFor(page, '写周报').first(),
      '从面单「更多」里选的优先级没落到行上',
    ).toContainText('高优先级');

    // 🔴 证据图必须拍到**工具条本身**：上面那两次点击把详情面滚到了字段处，
    // 底部这一行落在视口外面 —— 一张看不见被判据的图不算取证（§6.2 规定一）。
    await toolbar.scrollIntoViewIfNeeded();
    await page.screenshot({ path: 'test-results/dida-detail-toolbar.png' });
  });

  test('③ 有清单有标签时，两个分组头下各有一句说明；空的那一格不出现', async ({ page }) => {
    await openApp(page);
    // 只有清单、还没有标签：清单那一格该有说明，标签那一格该让位给空态文案。
    await createCategory(page, '新建清单', LIST, '创建清单');
    const sidebar = page.locator('nav.ht-sidebar');
    await expect(sidebar.getByTestId('projects-heading-hint')).toBeVisible();
    await expect(sidebar.getByTestId('tags-heading-hint')).toHaveCount(0);
    await expect(sidebar.getByText('还没有标签')).toBeVisible();

    await createCategory(page, '新建标签', TAG, '创建标签');
    await expect(sidebar.getByTestId('tags-heading-hint')).toBeVisible();
    await expect(sidebar.getByTestId('projects-heading-hint')).toContainText('用清单收纳任务与便签');
    await expect(sidebar.getByTestId('tags-heading-hint')).toContainText('标签跨清单给任务打记号');

    await page.screenshot({ path: 'test-results/dida-sidebar-hints.png' });
  });

  /** 走到菜单里某一枚为止：方向键按到 `data-testid` 命中，最多八次。 */
  async function focusMenuItem(page: import('@playwright/test').Page, testId: string): Promise<void> {
    for (let i = 0; i < 8; i += 1) {
      const at = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        return el?.getAttribute('data-testid') ?? '';
      });
      if (at === testId) return;
      await page.keyboard.press('ArrowDown');
    }
    throw new Error(`方向键走八步也没到 ${testId}`);
  }

  // 🔴 这一条是本轮修掉的那个缺陷的**浏览器版**判据：子菜单在 jsdom 里能证"Enter 之后
  // DOM 里长出选项"，但"焦点真的能一路走到选项并按下去"只有真浏览器量得到。
  test('④ 键盘全程：Shift+F10 开菜单 → 走到「移动到」→ Enter 展开 → Enter 换归属', async ({ page }) => {
    await openApp(page);
    await createCategory(page, '新建清单', LIST, '创建清单');
    await addTask(page, '写周报');
    const row = page.locator('[data-testid^="task-item-"]').filter({ hasText: '写周报' }).first();
    await expect(row.locator('[data-testid="task-meta"]')).toContainText(LIST);

    // 焦点交给**行体**（可聚焦的那一枚是 `task-row-*`，外层 `task-item-*` 没有 tabindex ——
    // `closeRowMenu` 归还焦点时瞄的就是它），再按菜单键：与没有鼠标的人走同一条路。
    await page.locator('[data-testid^="task-row-"]').filter({ hasText: '写周报' }).first().evaluate((el) => {
      (el as HTMLElement).focus();
    });
    await page.keyboard.press('Shift+F10');
    await expect(page.getByTestId('task-row-menu'), 'Shift+F10 没打开行菜单').toBeVisible();

    await focusMenuItem(page, 'task-row-menu-move');
    await page.keyboard.press('Enter');
    const option = page.getByTestId('task-row-menu-project-inbox');
    await expect(option, 'Enter 没有展开「移动到」子菜单').toBeVisible();

    // 下一枚可停靠项就是「收集箱」；按下去 = 这条任务离开那个清单。
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('task-row-menu'), '选完归属之后菜单该收掉').toHaveCount(0);

    /*
     * 🔴 归属一换，这一行就**离开当前范围**：侧栏还停在「深度工作」，列表里没有它是**对的**。
     * 上一版在这里就地读那一行，红成 `element(s) not found` —— 那是探针跟着筛选跑，
     * 不是产品没换归属。所以这一格要两条一起才完整：① 原清单里确实没了它；
     * ② 回收集箱之后它在，且徽标说的是「收集箱」。
     */
    await expect(
      page.locator('[data-testid^="task-item-"]').filter({ hasText: '写周报' }),
      '移进收集箱之后，「深度工作」这一档范围里不该再有这一行',
    ).toHaveCount(0);
    await backToInbox(page);
    await expect(
      metaFor(page, '写周报').first(),
      '键盘选完归属没变成收集箱',
    ).toContainText('收集箱');
    await parkCursor(page);
    await page.screenshot({ path: 'test-results/dida-keyboard-move.png' });
  });

  test('⑤ 暗色下：那两句说明、回收站那一行、逾期那一格的色都还在原位', async ({ page }) => {
    await openApp(page);
    await createCategory(page, '新建清单', LIST, '创建清单');
    await createCategory(page, '新建标签', TAG, '创建标签');
    // 🔴 建完标签那一步会把侧栏范围切到那条标签上（`ProjectsPanel.onCreate` → `onFilterWith`），
    // 而新播的任务身上没有标签 ⇒ 在这一档范围里根本画不出来（上一版红在 `element(s) not found`，
    // 与 ④ 同一个成因：探针跟着筛选跑）。先回收集箱，再播数据。
    await backToInbox(page);
    await page.locator('input[placeholder^="添加任务"]').fill('交房租 昨天');
    await page.locator('input[placeholder^="添加任务"]').press('Enter');
    await expect(rowFor(page, '交房租'), '打了「交房租 昨天」却没有那一行').toBeVisible();
    await switchTheme(page, 'dark');

    const sidebar = page.locator('nav.ht-sidebar');
    await expect(sidebar.getByTestId('projects-heading-hint')).toBeVisible();
    await expect(sidebar.getByTestId('tags-heading-hint')).toBeVisible();
    await expect(sidebar.getByTestId('sidebar-tool-trash')).toBeVisible();

    // 暗色下 danger 是**另一个值**：判据必须重新读 token，不许拿亮色那一串比。
    const read = await metaFor(page, '交房租').first().evaluate((el) => {
      const probe = document.createElement('span');
      probe.style.color = 'var(--ht-color-danger)';
      document.body.append(probe);
      const token = getComputedStyle(probe).color;
      probe.remove();
      const leaves: { text: string; color: string }[] = [];
      const walk = (node: Element): void => {
        const kids = [...node.children];
        if (kids.length === 0) {
          leaves.push({ text: (node.textContent ?? '').trim(), color: getComputedStyle(node as HTMLElement).color });
          return;
        }
        kids.forEach(walk);
      };
      walk(el);
      return { token, leaves };
    });
    const due = read.leaves.find((leaf) => /^\d{1,2}-\d{1,2}$/.test(leaf.text));
    expect(due, `暗色下徽标里没有日期那一格（读到 ${JSON.stringify(read.leaves.map((l) => l.text))}）`).toBeDefined();
    expect(due!.color, `暗色下逾期格是 ${due!.color}，danger token 是 ${read.token}`).toBe(read.token);

    await parkCursor(page);
    await page.screenshot({ path: 'test-results/dida-dark.png' });
  });

  /**
   * ⑥ 阶段 2 那五项的**鼠标腿**（④ 是键盘腿，量的是同一批控件的另一条通路）。
   *
   * 单测（`apps/web/tests/task-row-menu.spec.tsx`）证的是"点这一项 ⇒ 该发的那个回调带着
   * 那个参数被发了"；这一条证的是"真浏览器里这一项点得到、点完之后行上真的变了"。
   * 两半合起来才回答验收里那句「右键菜单所有新项功能正常」。
   *
   * ⚠️ 标签那一枚**按 testID 前缀现读**，不写死 id：id 是运行时生成的，
   * 抄进测试里就是抄一份必然漂的件。
   */
  test('⑥ 鼠标右键：优先级 / 标签 / 子任务 / 置顶四项点得动，且行上读得出来', async ({ page }) => {
    await openApp(page);
    await createCategory(page, '新建标签', TAG, '创建标签');
    await backToInbox(page);
    await addTask(page, '写周报');
    await addTask(page, '交房租');

    // 置顶那条判据要有"之前"：不先钉住顺序，"置顶把它提到最前"就无从证明。
    const rows = page.locator('[data-testid^="task-row-"]');
    await expect(rows.first(), '未置顶时第一行应当是先进的那条').toContainText('写周报');

    // ── B1 优先级：右键 → 优先级 → 高 ────────────────────────────────
    const row = rowFor(page, '写周报');
    await row.click({ button: 'right' });
    await expect(page.getByTestId('task-row-menu'), '右键没打开行菜单').toBeVisible();
    await page.getByTestId('task-row-menu-priority').click();
    // `Priority.High = 3`（`packages/domain/src/entities.ts`）—— 档位数字来自枚举，不是猜的。
    await page.getByTestId('task-row-menu-priority-3').click();
    await expect(
      metaFor(page, '写周报').first(),
      '选完「高」，行上没有「高优先级」那一格',
    ).toContainText('高优先级');

    // ── B3 标签：勾上 → 行上长出标签 chip；再点开 → aria-pressed 说的是"已带" ──
    await row.click({ button: 'right' });
    await page.getByTestId('task-row-menu-tags').click();
    const tagOption = page.locator('[data-testid^="task-row-menu-tag-"]').first();
    const tagTestId = await tagOption.getAttribute('data-testid');
    expect(tagTestId, '标签子菜单里没有可勾的那一枚').not.toBeNull();
    await page.getByTestId(tagTestId as string).click();
    await expect(row, '勾了标签，行上却没有它').toContainText(TAG);

    await row.click({ button: 'right' });
    await page.getByTestId('task-row-menu-tags').click();
    await expect(
      page.getByTestId(tagTestId as string),
      '这一行已经带着这条标签，但菜单里那一枚没说"已选"',
    ).toHaveAttribute('aria-pressed', 'true');

    // ── B2 子任务：这一项的目的地是那条任务的面单（行内编辑器已收进面单）──
    await page.getByTestId('task-row-menu-add-subtask').click();
    await expect(page.getByTestId('task-row-menu'), '点完之后菜单该收掉').toHaveCount(0);
    await expect(
      page.getByTestId('task-pane'),
      '「添加子任务」应当打开这条任务的面单（子任务那一格住在里面）',
    ).toBeVisible();

    // ── B5 置顶：把第二条提到最前，且再开菜单时那一项自己说"取消置顶" ──
    await rowFor(page, '交房租').click({ button: 'right' });
    await page.getByTestId('task-row-menu-pin').click();
    await expect(rows.first(), '置顶后第一条应当是「交房租」').toContainText('交房租');

    await rowFor(page, '交房租').click({ button: 'right' });
    await expect(
      page.getByTestId('task-row-menu-pin'),
      '已置顶的行，菜单里那一项该说「取消置顶」',
    ).toContainText('取消置顶');
    // 🔴 等菜单自己的入场动画落位再拍：刚点开就拍，图里那一片是**半透明的过渡帧**，
    // 人看不出这一排项的对比度到底是多少（§6.2 要的是"人能看懂的那张图"）。
    await waitForOverlaySettled(page, 'task-row-menu');
    await parkCursor(page);
    await page.screenshot({ path: 'test-results/dida-row-menu-browser.png' });
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('task-row-menu'), 'Esc 该收掉菜单').toHaveCount(0);
  });

  /**
   * ⑦ 窄屏 390 + 暗色：D3 那两句与 D2 那一行在**抽屉里**还站得住吗。
   *
   * 这一格补的是「还没被验证的」里那条：前面几条都跑在 1280 宽，而那两句说明是**整句**
   * 中文（`用清单收纳任务与便签，可建子清单和文件夹。`），窄栏里会不会**被裁 / 撑出滚动 /
   * 顶掉分组头**只有真浏览器量得到（jsdom 没有布局）。
   * 实测形状：390 档这两句各自**一行就放得下**，所以判据是"不裁、不超过两行、整句在这一列里"。
   * ⚠️ 刻意**不判"必须换行"** —— 把正确外观写成缺陷判据，下一轮就会有人去"修"它。
   */
  test('⑦ 窄屏 390 + 暗色：两句说明在抽屉里不溢出，回收站那一行点得到', async ({ page }) => {
    await openApp(page);
    await createCategory(page, '新建清单', LIST, '创建清单');
    await createCategory(page, '新建标签', TAG, '创建标签');
    await backToInbox(page);
    await switchTheme(page, 'dark');

    // 换窄：那一列从常驻变成抽屉里的内容（`ScopeDrawer`），先拉开才谈得上"看得见"。
    await page.setViewportSize({ width: 390, height: 844 });
    const trash = page.getByTestId('sidebar-tool-trash');
    await expect(trash, '窄屏收起时那一行不该在屏幕上').toBeHidden();
    await page.getByTestId('task-scope-toggle').click();

    const drawer = page.locator('nav.ht-sidebar');
    await expect(drawer).toBeVisible();
    const projectsHint = drawer.getByTestId('projects-heading-hint');
    const tagsHint = drawer.getByTestId('tags-heading-hint');
    await expect(projectsHint).toBeVisible();
    await expect(tagsHint).toBeVisible();

    const [drawerBox, trashBox] = [await drawer.boundingBox(), await (await trash.isVisible() ? trash.boundingBox() : null)];
    expect(drawerBox, '量不到抽屉那一列的包围盒').not.toBeNull();
    /*
     * 两句说明的窄档判据：**不被裁、不撑出滚动、不占超过两行**。
     * ⚠️ 刻意不判"必须换行"：390 档实测这两句各自**一行就放下**（看图确认过），
     * 拿"高度 > 一行"当判据会把一个正确的外观读成缺陷。
     * `scrollWidth > clientWidth` 才是真形状：文字被 `overflow` 裁掉时元素照样"可见"。
     */
    for (const [name, hint] of [['清单那句', projectsHint], ['标签那句', tagsHint]] as const) {
      const box = await hint.boundingBox();
      expect(box, `${name}可见却量不到`).not.toBeNull();
      expect(
        box!.x + box!.width,
        `${name}伸出这一列右边缘：到 ${String(Math.round(box!.x + box!.width))}，列宽到 ${String(Math.round(drawerBox!.x + drawerBox!.width))}`,
      ).toBeLessThanOrEqual(drawerBox!.x + drawerBox!.width + 1);
      const shape = await hint.evaluate((el) => ({
        clipped: el.scrollWidth > el.clientWidth + 1,
        lines: Math.round(el.getBoundingClientRect().height / parseFloat(getComputedStyle(el).lineHeight)),
      }));
      expect(shape.clipped, `${name}在窄栏里被裁掉了（scrollWidth 比可视宽度大）`).toBe(false);
      expect(shape.lines, `${name}在 390 档占了 ${String(shape.lines)} 行，超过两行就是挤爆了分组头`).toBeLessThanOrEqual(2);
    }
    // D2 那一行在窄档仍然点得到（抽屉里）。
    expect(trashBox, '抽屉拉开后回收站那一行不在屏幕上').not.toBeNull();

    await parkCursor(page);
    await page.screenshot({ path: 'test-results/dida-narrow-dark.png' });
    await trash.click();
    await expect(page.getByTestId('trash-board'), '窄屏点那一行该进回收站').toBeVisible();
  });

  /**
   * ⑧ 右键菜单里**就地新建标签**（B3 的另一半）—— 这一条走的是键盘与浮层交接那一格。
   *
   * 单测能证"点了新建会长出输入框、提交会发那两个意图"，但**只有真浏览器**量得到这三件事：
   * ① 点开草稿后焦点**已经在框里**（不然用户还得再按一次 Tab）；
   * ② 在框里敲字母时，菜单的类型查找不许把焦点抢走（共享层 `nestedOpen` 让位那一格）；
   * ③ 按 Esc **只退一层**：草稿收掉、菜单留着 —— 治的是这一轮刚发现的那枚**死键**
   *    （草稿不接键盘 + 共享层让位 = 按 Esc 屏幕上什么都不发生）。
   */
  test('⑧ 就地新建标签：焦点进框、打字不被抢、Esc 只退一层、建完行上有 chip', async ({ page }) => {
    await openApp(page);
    await addTask(page, '写周报');
    const row = rowFor(page, '写周报');

    await row.click({ button: 'right' });
    await page.getByTestId('task-row-menu-tags').click();
    await expect(
      page.getByTestId('task-row-menu-new-tag'),
      '一条标签都没有时，子菜单里也该有「新建」那一枚',
    ).toBeVisible();

    await page.getByTestId('task-row-menu-new-tag').click();
    const input = page.getByTestId('task-row-menu-new-tag-input');
    await expect(input, '点了新建却没长出输入框').toBeVisible();
    const focusTestId = () =>
      page.evaluate(() => (document.activeElement as HTMLElement | null)?.getAttribute('data-testid') ?? '');
    await expect
      .poll(focusTestId, { message: '草稿没拿到焦点 = 用户还得再按一次 Tab 才能打字' })
      .toBe('task-row-menu-new-tag-input');

    // ② 敲一个字母：焦点必须还在框里（类型查找抢走的话，名字根本打不进去）。
    await page.keyboard.press('a');
    await expect(focusTestId(), '按字母之后焦点被菜单的类型查找抢走了').resolves.toBe('task-row-menu-new-tag-input');

    // ③ Esc 只退一层。
    await input.fill('报销');
    await expect(input).toHaveValue('报销');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('task-row-menu-new-tag-input'), 'Esc 之后草稿还在').toHaveCount(0);
    await expect(page.getByTestId('task-row-menu'), '一次 Esc 不该把整层菜单一起抹掉').toBeVisible();
    await expect(
      page.getByTestId('task-row-menu-new-tag'),
      '退掉草稿之后该回到那一枚入口',
    ).toBeVisible();

    // 真的建一条：菜单收走、行上有 chip、侧栏那一格里也长出它（同一条 op 的两个消费者）。
    await page.getByTestId('task-row-menu-new-tag').click();
    await page.getByTestId('task-row-menu-new-tag-input').fill('报销');
    await page.getByTestId('task-row-menu-new-tag-submit').click();
    await expect(page.getByTestId('task-row-menu'), '建完勾完该收走菜单').toHaveCount(0);
    await expect(row, '新建的标签没挂到这条任务上').toContainText('报销');
    await expect(page.locator('nav.ht-sidebar').getByText('报销', { exact: true })).toBeVisible();

    await parkCursor(page);
    await page.screenshot({ path: 'test-results/dida-new-tag-inline.png' });
  });

  /**
   * ⑨ 滚页面 ⇒ 菜单收走（这一条是给 ⑧ 那次修复兜底的）。
   *
   * 锚点是 `position: fixed` 钉在视口上的，列表一滚，锚点与那一行的关系就断了 ⇒
   * 菜单必须收走（留在错的地方比关掉更坏）。⑧ 修的是**反方向**那一格（面板内部的滚动
   * 不该关）—— 那一格由 ⑧ 的"打字不关菜单"来证：这里刻意**不**写"给面板 scrollTop 赋值"
   * 那种判据，面板今天没有溢出滚动，那样一条**永远不会红**（比没有判据更糟）。
   */
  test('⑨ 滚页面之后菜单收走（锚点失效就不该留在错的地方）', async ({ page }) => {
    await openApp(page);
    // 播够一屏任务，页面才真的能滚（否则 scroll 事件根本不发，这条判据就是空转）。
    for (const title of ['甲', '乙', '丙', '丁', '戊', '己', '庚', '辛', '壬', '癸']) {
      await addTask(page, `滚动判据${title}`);
    }
    const row = rowFor(page, '滚动判据甲');
    await expect(row).toBeVisible();

    await row.click({ button: 'right' });
    const panel = page.getByTestId('task-row-menu');
    await expect(panel, '右键没打开菜单').toBeVisible();

    // 真滚一下：鼠标停在列表区，滚轮走的是那一片的滚动容器。
    await page.mouse.move(600, 500);
    await page.mouse.wheel(0, 240);
    await expect(panel, '滚了页面菜单还留着 = 它会画在一个错的锚点上').toHaveCount(0);
  });
});
