/**
 * 选中（工单 W1）的**真浏览器**取证
 * ==================================
 *
 * jsdom 那套已经把结构钉死了（`task-selection.spec.tsx` 16 条 + 三种投影各自的行为判据）。
 * 这一份只验 jsdom 够不着的三件事，而且它们合起来才是 §6.2 规定一要求的证据：
 *
 * 1. **底色真的画出来了**。RNW 在 jsdom 里把样式编译成 class，`getComputedStyle` 给的是
 *   一个**没被布局验证过**的串（§7 #178）。真浏览器才知道 `--ht-color-primary-subtle`
 *   实际落在哪一层、被不被父容器的背景盖掉。
 * 2. **同一条选中在三种投影里是同一条**。四象限那层断过一次（包装层声明了 prop 没转发，
 *   typecheck 与四条门禁全绿 → §7 #179），这条是从**宿主**挂下去的，量得到那一层。
 * 3. **截图**。左右各一张，人要打开看 —— 断言只会验"界面写了什么"，不会验"少了什么"。
 *
 * ## 数据全部从界面上真点出来
 *
 * 不调内部 store、不注入 IndexedDB（与 `habits-pane.spec.ts` 同一条纪律）：
 * 一份靠探针写进去的数据渲染出的界面，证明不了用户点出来的数据能渲染。
 *
 * ## 🔴 三个只有真浏览器才暴露出来的取数坑（每条都实测过，不是推测）
 *
 * 1. **按标题找行不能用 `task-item-*`**。整行里常驻着一个"父任务"下拉
 *    （`subtask-select-*`），它的 `<option>` 把**别的任务标题**也写进了
 *    `textContent` —— 实测两行任务的 textContent 互相包含对方标题。所以本文件
 *    一律用 `task-title-*`（共享层注释早就点过这个名字：`[data-testid^="task-row-"]`
 *    会被别处当行数数，标题必须单独可寻址）。
 * 2. **`switchView` 只点 tab，不等重渲染**。切完立刻读样式会读到**上一帧**：
 *    实测四象限那一次读到的还是未选中的值，而等 1 秒后是选中色 ——
 *    症状与"选中没接到这一层"一模一样。所以每次换视图先等**该视图自己的锚点**
 *    （`quadrant-board` / `timeline-view`）出现，再用 `expect.poll` 取值。
 * 3. **时间线里那一行的锚点是 `timeline-lane-item-*`**，不是列表那套 `task-item-*`
 *    （实测清单：时间线视图里 `task-item-*` 一个都没有）。
 *
 * 🔴 证据**不落 `e2e/test-results/`** —— 那是 Playwright 每次运行开头会清空的目录，
 * 而这台机器上有并发会话在跑自己的套件（实测过一次：唯一的几张图被它们删掉）。
 */
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { openApp, parkCursor, switchView } from './helpers';

/**
 * 🔴 证据路径**按本文件的位置**解析，不用相对路径。
 *
 * 实测代价：上一版写的 `../apps/web/evidence/...` 是相对 **进程 cwd** 的，
 * 我从 `e2e/` 跑，它就把五张图写进了**主检出**（`heyta/apps/web/evidence/…`），
 * 而不是这个 worktree —— 症状是"截图跑了、这个目录里却只有旧的一张"。
 * 先例 `task-row-touch-target.spec.ts` 用的就是相对写法，它在单一检出里看不出问题。
 */
const SHOT = (name: string) =>
  fileURLToPath(
    new URL(`../../apps/web/evidence/selection-projections/${name}.png`, import.meta.url),
  );

/**
 * 🔴 判据的形状：**这里不比"是不是透明"**。
 * 真浏览器里未选中的行有它自己的基线底色，"不等于透明"在生产载体上是**恒真**的，
 * 那条判据会绿在一个根本没有高亮的实现上（§7 元规则 2）。
 * 这里的比较全部是**相对的**：同一屏里两条互比、跨视图比的是"同一条选中的值"，
 * 换选中之后旧那行必须回到它自己的基线。载体给的什么颜色都不影响判据成立。
 */

/** 收集 console 的 error 与页面异常 —— 白屏的根因几乎只在这里现形。 */
function watchErrors(page: Page): string[] {
  const seen: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') seen.push(`console: ${msg.text()}`);
  });
  page.on('pageerror', (err) => seen.push(`pageerror: ${String(err)}`));
  return seen;
}

/**
 * 按标题找到那条任务，返回它的实体 id。
 *
 * 🔴 走 `task-title-*` 而不是整行：整行的 `textContent` 里有父任务下拉的
 * `<option>`，别的任务的标题也在里面（文件头坑 1）。
 */
async function taskIdByTitle(page: Page, title: string): Promise<string> {
  const titleEl = page.locator('[data-testid^="task-title-"]').filter({ hasText: title }).first();
  await expect(titleEl, `列表里没有那条任务的标题「${title}」`).toBeVisible();
  const attr = await titleEl.getAttribute('data-testid');
  expect(attr, '那一行的标题没有 task-title-* 锚点').toBeTruthy();
  return String(attr).replace('task-title-', '');
}

/**
 * 读某一个锚点的解析后底色（要求它**唯一**，否则读到的可能是别人）。
 *
 * 🔴 必须等到**算得出来**为止。Chromium 对**已从文档分离**的节点，
 * `getComputedStyle` 返回空串 —— 而四象限的板子在 dnd-kit 初始化时会把行节点换掉，
 * 实测两次连跑全绿、第三趟就撞上过一次（读数 `""`，症状是"基线不一致"这种**假红**）。
 * 更该防的是反方向：`settledSelectionBg` 的判据是"选中那条 ≠ 基线"，
 * 空串永远 ≠ 任何真实底色 ⇒ **"根本没读到值"会被判成"画上选中色了"**（假绿）。
 *
 * ⚠️ 这条 `not.toBe('')` 与文件头那句"不比是不是透明"**不矛盾**：
 * `''` 是"探针没读到"，`rgba(0, 0, 0, 0)` 是"读到了，值是透明"。
 * 拿**透明**当产品判据是恒真（被否决的那种写法）；拿**空串**当探针故障是前提自检。
 */
async function bgOfTestId(page: Page, testId: string): Promise<string> {
  const el = page.locator(`[data-testid="${testId}"]`);
  await expect(el, `${testId} 在界面上不止一个，读出来的底色分不出是哪一条`).toHaveCount(1);
  const read = () =>
    el
      .first()
      .evaluate((node) => (node.isConnected ? getComputedStyle(node).backgroundColor : ''));
  /**
   * 🔴 这里原来写的是「`poll(read)` 等它非空，然后 `return read()`」—— **两次独立的读**。
   *   症状（11:5x 现量，同一个构建连跑三次红一次，不是负载也不是产品）：
   *   `Expected: "rgba(0, 0, 0, 0)" / Received: ""`。轮询确认非空之后、函数返回之前，
   *   React 把那一行换成了新节点 ⇒ 第二次读落到分离节点上，拿到空串。
   *   ⇒ 探针自己会造红。改法：**记下轮询真正接受的那一次读数**，不再另读一遍。
   */
  let seen = '';
  await expect
    .poll(async () => {
      const value = await read();
      if (value !== '') seen = value;
      return seen;
    }, { message: `${testId} 的底色一直算不出来 —— 读到的一直是分离节点，不能拿空串去比` })
    .not.toBe('');
  return seen;
}

/**
 * 等这个视图**自己**把选中色画上，然后返回落定后的读数。
 *
 * 为什么这不是"等到绿为止"的放水判据：条件写的是"这一行的底色 ≠ 同一屏里没选中的
 * 那条的底色"，也就是**选中确实画到了这一层**。如果某一层的接线断了，这个条件永远
 * 不成立，`expect.poll` 会超时判红 —— 变异臂（把宿主的 `activeTaskId` 摘掉）走的就是这条。
 */
async function settledSelectionBg(page: Page, selectedId: string, unselectedId: string) {
  const base = await bgOfTestId(page, unselectedId);
  await expect
    .poll(() => bgOfTestId(page, selectedId), { message: `${selectedId} 一直没画上选中色` })
    .not.toBe(base);
  return { selected: await bgOfTestId(page, selectedId), base };
}

async function createTask(page: Page, title: string): Promise<void> {
  const input = page.locator('input[placeholder^="添加任务"]');
  await input.fill(title);
  await input.press('Enter');
}

test.describe('选中：一条任务在三种投影里都是同一条被高亮', () => {
  test('点列表里的一行 → 四象限与时间线认得它；没选中的那条不带底色', async ({ page }) => {
    const errors = watchErrors(page);
    await openApp(page, '/?lang=zh-CN');

    await createTask(page, '选中的那条甲');
    await createTask(page, '没选中的那条乙');
    const picked = await taskIdByTitle(page, '选中的那条甲');
    const other = await taskIdByTitle(page, '没选中的那条乙');
    expect(picked, '两条任务拿到了同一个 id —— 选中根本分不开').not.toBe(other);

    // ── 列表：真点行体。先取**两条的基线底色**（还没点过任何东西）──────────
    const basePicked = await bgOfTestId(page, `task-item-${picked}`);
    const baseOther = await bgOfTestId(page, `task-item-${other}`);
    expect(basePicked, '两条任务在基线上就不长一样 —— 后面比不出"高亮"').toBe(baseOther);

    await page.locator(`[data-testid="task-row-${picked}"]`).click();
    const list = await settledSelectionBg(page, `task-item-${picked}`, `task-item-${other}`);
    expect(
      await bgOfTestId(page, `task-item-${other}`),
      '没选中的那行底色也跟着变了 —— 高亮没有信息',
    ).toBe(list.base);
    await parkCursor(page);
    await page.screenshot({ path: SHOT('01-list') });

    // ── 四象限：本轮现场断过的那一层 ──────────────────────────────────
    await switchView(page, '四象限');
    await expect(
      page.locator('[data-testid="quadrant-board"]'),
      '四象限没渲染出来（后面的底色读数都不成立）',
    ).toBeVisible();
    const quadrant = await settledSelectionBg(
      page,
      `task-item-${picked}`,
      `task-item-${other}`,
    );
    expect(
      quadrant.selected,
      '🔴 四象限里那条的底色与列表里不是同一个值 —— 宿主到共享板子之间断了，或两边不是同一条选中',
    ).toBe(list.selected);
    expect(quadrant.base, '四象限里没选中的那条用的是另一种基线').toBe(list.base);
    expect(
      await bgOfTestId(page, `task-item-${other}`),
      '四象限里没选中的那条也被画了选中色',
    ).toBe(list.base);
    await parkCursor(page);
    await page.screenshot({ path: SHOT('02-quadrant') });

    // ── 时间线：两条都没有截止时间 ⇒ 落在未排期泳道 ────────────────────
    await switchView(page, '时间线');
    await expect(
      page.locator('[data-testid="timeline-view"]'),
      '时间线没渲染出来',
    ).toBeVisible();
    const timeline = await settledSelectionBg(
      page,
      `timeline-lane-item-${picked}`,
      `timeline-lane-item-${other}`,
    );
    expect(
      timeline.selected,
      '🔴 时间线里那条的底色不是同一个选中色',
    ).toBe(list.selected);
    expect(
      await bgOfTestId(page, `timeline-lane-item-${other}`),
      '时间线里没选中的那条也被画了选中色',
    ).toBe(timeline.base);
    /**
     * 🔴 底色是给眼睛的，下面这一条是给读屏的。时间线这一块此前**只有底色**：
     * 共享 `TimelineBoard` 自己按 id 等值算、自己上 `rowActive`，却登记在"递送层"里，
     * 而递送层不要求发无障碍通道（工单 §8.42 记的就是这个类别漏洞）。
     * 摘掉 `aria-pressed` 只有这两条会红，上面三条底色读数**不跟着红** —— 它们各自量的是别的东西。
     */
    await expect(
      page.locator(`[data-testid="timeline-lane-item-${picked}"]`),
      '选中的那条时间线行没有把"我被选中"说出来',
    ).toHaveAttribute('aria-pressed', 'true');
    await expect(
      page.locator(`[data-testid="timeline-lane-item-${other}"]`),
      '没选中的那条也声称自己被选中',
    ).not.toHaveAttribute('aria-pressed', 'true');
    await parkCursor(page);
    await page.screenshot({ path: SHOT('03-timeline') });

    expect(errors, `界面里有控制台错误：\n${errors.join('\n')}`).toEqual([]);
  });

  test('换一条选中：旧那行收回底色，不是钉在第一行', async ({ page }) => {
    const errors = watchErrors(page);
    await openApp(page, '/?lang=zh-CN');
    await createTask(page, '第一条要换掉的');
    await createTask(page, '第二条接手的');
    const a = await taskIdByTitle(page, '第一条要换掉的');
    const b = await taskIdByTitle(page, '第二条接手的');

    await page.locator(`[data-testid="task-row-${a}"]`).click();
    const first = await settledSelectionBg(page, `task-item-${a}`, `task-item-${b}`);

    await page.locator(`[data-testid="task-row-${b}"]`).click();
    const second = await settledSelectionBg(page, `task-item-${b}`, `task-item-${a}`);
    expect(second.selected, '新选中的那条画的不是同一个选中色').toBe(first.selected);
    expect(
      await bgOfTestId(page, `task-item-${a}`),
      '🔴 旧那行还留着选中色 —— 光标写死在第一次点的那一行上',
    ).toBe(second.base);
    await parkCursor(page);
    await page.screenshot({ path: SHOT('04-switch') });

    expect(errors, `界面里有控制台错误：\n${errors.join('\n')}`).toEqual([]);
  });
});

test.describe('搜索的出口写的是选中，不只是换个视图', () => {
  test('搜到一条任务并点它 → 回到任务视图，且**那条**是带底色的', async ({ page }) => {
    const errors = watchErrors(page);
    await openApp(page, '/?lang=zh-CN');
    await createTask(page, '要点亮的搜索结果');
    await createTask(page, '不该被点亮的那条');
    const picked = await taskIdByTitle(page, '要点亮的搜索结果');
    const notPicked = await taskIdByTitle(page, '不该被点亮的那条');

    await switchView(page, '搜索');
    await page.locator('[data-testid="search-panel-input"]').fill('要点亮的搜索结果');
    const hit = page
      .locator('[data-testid="search-panel-tasks"] [data-testid^="task-title-"]')
      .filter({ hasText: '要点亮的搜索结果' })
      .first();
    await expect(hit, '搜索结果里没有那条任务').toBeVisible();
    await hit.click();

    // 回到任务视图（这是那条出口的既有行为），判据是**选中跟着过去了**：
    await expect(
      page.locator(`[data-testid="task-item-${picked}"]`),
      '点完搜索结果没回到能看到那条任务的地方',
    ).toHaveCount(1);
    const back = await settledSelectionBg(
      page,
      `task-item-${picked}`,
      `task-item-${notPicked}`,
    );
    expect(
      await bgOfTestId(page, `task-item-${notPicked}`),
      '🔴 从搜索进来把整屏都点亮了（没选中的那条也带选中色）',
    ).toBe(back.base);
    await parkCursor(page);
    await page.screenshot({ path: SHOT('05-search') });

    expect(errors, `界面里有控制台错误：\n${errors.join('\n')}`).toEqual([]);
  });
});
