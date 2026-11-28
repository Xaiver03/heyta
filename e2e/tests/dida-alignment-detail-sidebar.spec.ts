import { expect, test } from '@playwright/test';
import { addTask, metaFor, openApp, parkCursor, rowFor, switchTheme, switchView } from './helpers';

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
  await expect(sidebar.getByText(name, { exact: true }).first()).toBeVisible();
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

  test('② 紧凑底栏：清单选择器 + 五枚动作图标，其中「更多」能把行菜单做成一件事', async ({ page }) => {
    await openApp(page);
    await createCategory(page, '新建清单', LIST, '创建清单');
    await addTask(page, '写周报');
    // 建完清单之后页头标题就是那条清单，行要按任务标题点。
    await page.locator('[data-testid^="task-row-"]').filter({ hasText: '写周报' }).first().click();

    const toolbar = page.getByTestId('task-detail-toolbar');
    await expect(toolbar, '详情面底部没有工具条').toBeVisible();

    // 左侧直接放清单选择器：当前选中项就是刚建的 `LIST`。⚠️ 不要改选成收集箱 ——
    // 那会让任务离开当前清单过滤视图，后面的行断言就找不到它。
    const projectSelect = toolbar.getByTestId('organize-project-select');
    await expect(projectSelect, '工具条左侧没有清单选择器').toBeVisible();
    await expect(
      projectSelect.locator('option:checked'),
      '清单选择器的当前项不是刚建的那条清单',
    ).toHaveText(LIST);

    // 右侧 5 枚紧凑动作图标：清单 / 标签 / 子任务 / 附件 / 更多。
    await expect(toolbar.locator('button')).toHaveCount(5);

    // 「清单」那一枚把核对清单的输入框叫出来（面单里的那一格）。
    await page.getByTestId('task-detail-checklist-trigger').click();
    await expect(
      page.getByTestId('task-checklist-add-input'),
      '点「清单」之后没有出现核对清单的输入框',
    ).toBeVisible();

    // 顶栏右侧直接改优先级 ⇒ 落到行元信息槽。
    await page.getByTestId('task-priority-select').selectOption('3');
    await expect(
      metaFor(page, '写周报').first(),
      '从面单顶栏选的优先级没落到行上',
    ).toContainText('高优先级');

    // 🔴 「更多」判的是**它能不能做成一件事**，不是它存不存在：
    // 点开行菜单执行置顶 op，再点开时同一枚显示「取消置顶」。
    await toolbar.scrollIntoViewIfNeeded();
    await page.getByTestId('task-detail-more').click();
    await expect(
      page.getByTestId('task-row-menu'),
      '点面单里的「更多」没有打开这条任务的行菜单',
    ).toBeVisible();
    await page.getByTestId('task-row-menu-pin').click();
    await expect(
      page.getByTestId('task-row-menu'),
      '选完置顶后菜单该收掉',
    ).toHaveCount(0);
    await page.getByTestId('task-detail-more').click();
    await expect(page.getByTestId('task-row-menu-pin')).toContainText('取消置顶');
    await page.keyboard.press('Escape');

    // 🔴 证据图必须拍到**工具条本身**：上面那两次点击把详情面滚到了字段处，
    // 底部这一行落在视口外面 —— 一张看不见被判据的图不算取证（§6.2 规定一）。
    await toolbar.scrollIntoViewIfNeeded();
    await page.screenshot({ path: 'test-results/dida-detail-toolbar.png' });
  });

  test('③ 分组头下不再有说明文字（AGENTS §0.2）', async ({ page }) => {
    await openApp(page);
    await createCategory(page, '新建清单', LIST, '创建清单');
    const sidebar = page.locator('nav.ht-sidebar');
    await expect(sidebar.getByTestId('projects-heading-hint')).toHaveCount(0);
    await expect(sidebar.getByTestId('tags-heading-hint')).toHaveCount(0);
    await expect(sidebar.getByText('还没有标签')).toBeVisible();
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

  // 🔴 行的「优先级 / 移动到 / 标签」已按 R1 收敛从行菜单移入面单（`App.tsx` 的
  // `TaskRowMenu` 接线注释）；行菜单仍保留「置顶」这一项 —— 这一条量的是"键盘能走到
  // 一枚仍在的项并真的把它做成"，与鼠标腿（⑥）互为对照。
  test('④ 键盘全程：Shift+F10 开菜单 → 方向键走到「置顶」→ Enter 置顶 / 取消置顶', async ({ page }) => {
    await openApp(page);
    await addTask(page, '写周报');
    await addTask(page, '交房租');
    const rows = page.locator('[data-testid^="task-row-"]');
    await expect(rows.first(), '未置顶时第一行应当是先进的那条').toContainText('写周报');

    // 焦点交给**行体**（可聚焦的那一枚是 `task-row-*`，外层 `task-item-*` 没有 tabindex ——
    // `closeRowMenu` 归还焦点时瞄的就是它），再按菜单键：与没有鼠标的人走同一条路。
    await page.locator('[data-testid^="task-row-"]').filter({ hasText: '交房租' }).first().evaluate((el) => {
      (el as HTMLElement).focus();
    });
    await page.keyboard.press('Shift+F10');
    await expect(page.getByTestId('task-row-menu'), 'Shift+F10 没打开行菜单').toBeVisible();

    await focusMenuItem(page, 'task-row-menu-pin');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('task-row-menu'), '置顶之后菜单该收掉').toHaveCount(0);
    await expect(rows.first(), '键盘置顶后第一条应当是「交房租」').toContainText('交房租');

    // 再开一次：同一枚应当自报「取消置顶」——键盘用户也读得到当前态。
    await page.locator('[data-testid^="task-row-"]').filter({ hasText: '交房租' }).first().evaluate((el) => {
      (el as HTMLElement).focus();
    });
    await page.keyboard.press('Shift+F10');
    await expect(
      page.getByTestId('task-row-menu-pin'),
      '已置顶的行，菜单里那一项该说「取消置顶」',
    ).toContainText('取消置顶');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('task-row-menu'), 'Esc 该收掉菜单').toHaveCount(0);
    await parkCursor(page);
    await page.screenshot({ path: 'test-results/dida-keyboard-pin.png' });
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
    await expect(sidebar.getByTestId('projects-heading-hint')).toHaveCount(0);
    await expect(sidebar.getByTestId('tags-heading-hint')).toHaveCount(0);
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
   * ⑥ 行菜单**鼠标腿**（④ 是键盘腿）。R1 收敛之后行菜单只剩
   * 打开详情 / 置顶 / 添加子任务 / 放弃 / 删除；「优先级 / 标签」改在**面单**（唯一编辑落点）。
   * 这一条同时量两件事：行菜单里还在的项点得动、字段层改在面单里能落到行上。
   */
  test('⑥ 鼠标右键：置顶 / 添加子任务点得动；优先级 / 标签改在面单（唯一编辑落点）', async ({ page }) => {
    await openApp(page);
    await createCategory(page, '新建标签', TAG, '创建标签');
    await backToInbox(page);
    await addTask(page, '写周报');
    await addTask(page, '交房租');

    // 置顶那条判据要有"之前"：不先钉住顺序，"置顶把它提到最前"就无从证明。
    const rows = page.locator('[data-testid^="task-row-"]');
    await expect(rows.first(), '未置顶时第一行应当是先进的那条').toContainText('写周报');

    // ── 置顶（行菜单里仍在的一项）─────────────────────────────────
    await rowFor(page, '交房租').click({ button: 'right' });
    await expect(page.getByTestId('task-row-menu'), '右键没打开行菜单').toBeVisible();
    await page.getByTestId('task-row-menu-pin').click();
    await expect(page.getByTestId('task-row-menu'), '选完置顶菜单该收掉').toHaveCount(0);
    await expect(rows.first(), '置顶后第一条应当是「交房租」').toContainText('交房租');

    // ── 添加子任务：目的地是面单（行内编辑器已收进面单）────────────
    await rowFor(page, '写周报').click({ button: 'right' });
    await page.getByTestId('task-row-menu-add-subtask').click();
    await expect(page.getByTestId('task-row-menu'), '点完之后菜单该收掉').toHaveCount(0);
    const pane = page.getByTestId('detail-column').getByTestId('task-pane');
    await expect(pane, '「添加子任务」应当打开这条任务的面单').toBeVisible();

    // ── 优先级：面单顶栏改 ⇒ 落到行元信息槽（行菜单已不收这个字段）──
    await pane.getByTestId('task-priority-select').selectOption('3');
    await expect(
      metaFor(page, '写周报').first(),
      '面单里选的优先级没落到行上',
    ).toContainText('高优先级');

    // ── 标签：面单里勾 ⇒ 面单标签条读得出（行菜单的标签子菜单已删）──
    await pane.getByTestId('task-detail-tag-trigger').click();
    const pop = pane.getByTestId('task-detail-popover');
    await expect(pop, '点标签按钮没长出标签浮层').toBeVisible();
    await pop.getByRole('checkbox', { name: new RegExp(TAG) }).first().click();
    await expect(
      pane.getByTestId('task-detail-tags-strip'),
      '面单里勾了标签，标签条里却没有它',
    ).toContainText(TAG);

    await parkCursor(page);
    await page.screenshot({ path: 'test-results/dida-row-menu-and-detail-fields.png' });
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
    await expect(drawer.getByTestId('projects-heading-hint')).toHaveCount(0);
    await expect(drawer.getByTestId('tags-heading-hint')).toHaveCount(0);

    const [drawerBox, trashBox] = [await drawer.boundingBox(), await (await trash.isVisible() ? trash.boundingBox() : null)];
    expect(drawerBox, '量不到抽屉那一列的包围盒').not.toBeNull();
    // D2 那一行在窄档仍然点得到（抽屉里）。
    expect(trashBox, '抽屉拉开后回收站那一行不在屏幕上').not.toBeNull();

    await parkCursor(page);
    await page.screenshot({ path: 'test-results/dida-narrow-dark.png' });
    await trash.click();
    await expect(page.getByTestId('trash-board'), '窄屏点那一行该进回收站').toBeVisible();
  });

  /*
   * ⑧「行菜单里就地新建标签」已随 R1 收敛整体移除 —— 标签的建立只剩侧栏 `+` 一个入口，
   * 那条用例断言的入口已不存在，没有可迁移的新落点，故随功能一并退休。
   *
   * ⑨ 滚页面 ⇒ 行菜单收走：锚点是 `position: fixed` 钉在视口上的，列表一滚，
   * 锚点与那一行的关系就断了 ⇒ 菜单必须收走。判据必须让列表**真的溢出可滚**，
   * 否则 scroll 事件根本不发、这条判据就空转（比没有判据更糟）。
   */
  test('⑨ 滚页面之后菜单收走（锚点失效就不该留在错的地方）', async ({ page }) => {
    await openApp(page);
    // 压矮视口 + 播足任务，保证任务列表真的溢出、能滚出 scroll 事件。
    await page.setViewportSize({ width: 1280, height: 480 });
    for (const title of ['甲', '乙', '丙', '丁', '戊', '己', '庚', '辛', '壬', '癸', '子', '丑', '寅', '卯']) {
      await addTask(page, `滚动判据${title}`);
    }
    const row = rowFor(page, '滚动判据甲');
    await expect(row).toBeVisible();

    await row.click({ button: 'right' });
    const panel = page.getByTestId('task-row-menu');
    await expect(panel, '右键没打开菜单').toBeVisible();

    // 真滚一下：先找**任务列表那个真正可滚的容器**（不是写死坐标靠运气），滚它；
    // 菜单的 window 捕获监听据此收走。找不到可滚容器 ⇒ 算前置没成立，如实红。
    const scrolled = await page.evaluate(() => {
      const els = Array.from(document.querySelectorAll<HTMLElement>('*')).filter((e) => {
        const s = getComputedStyle(e);
        return (s.overflowY === 'auto' || s.overflowY === 'scroll') && e.scrollHeight - e.clientHeight > 40;
      });
      const target = els.sort(
        (a, b) => (b.scrollHeight - b.clientHeight) - (a.scrollHeight - a.clientHeight),
      )[0];
      if (!target) return false;
      target.scrollTop = target.scrollTop + 400;
      return true;
    });
    expect(scrolled, '任务列表根本没溢出可滚，这条判据会空转').toBe(true);
    await expect(panel, '滚了页面菜单还留着 = 它会画在一个错的锚点上').toHaveCount(0);
  });
});
