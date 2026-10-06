/**
 * 详情列：不画空白 + 左边缘那条线可拖（工单 H10 第一刀）
 * =====================================================
 *
 * 出处：产品负责人 2026-10-06 第 5、6 条 ——
 * ⑤「数据侧边栏和那个侧边栏，哪有这么排版的？」
 * ⑥「右边那一栏空白的侧边栏，中间那条线应该是可以调整的。侧边栏的宽度都可以自己调整，
 *    通过拖拽来调整。」
 *
 * ## 这一支测什么（五条，各钉一个曾经为真的坏形状）
 *
 * * **D1 没东西可画 ⇒ 那一栏不许占位**。改前现量（出厂默认态：四道 AI 闸全关、
 *   没选中任何东西）：轨道 `64px 240px 624px 352px`，而那 352px 里
 *   `childElementCount === 0`、`textContent === ''`。一条永远画着空白的列
 *   不是留白，是界面在说"这里有个东西"而那里什么都没有。
 *   🔴 载体在第二刀之后是**日历视图**：任务视图那一格今天由 AI 面住着
 *   （2026-10-04 拍板），它不再是"没东西可画"的那一档 —— 判据没动，动的是哪一档真的空。
 * * **D2 有东西可画 ⇒ 它回来，而且宽走 token**。D1 的反向对照：只写 D1 的话，
 *   "把那一栏整个删掉"也能让 D1 恒绿。第二刀起它还多钉一层：**选中任务时那一格
 *   必须是任务面单，AI 面要让它**（同一格两个所有者时宽度判据照样绿，所以单独钉）。
 * * **D3 方向、持久化、夹取、键盘**。`edge='start'`（把手在列的**左**边缘）
 *   ⇒ **往左拖变宽**。符号搞反的症状是"往宽拖它变窄"，而两条列的把手长得一模一样。
 * * **D4 可拖性要看得见**。范围列那一枚 2026-09-30 实测过：hover 线用
 *   `--ht-color-border` 时与那一列自己的边框**同色同位**，两张截图逐像素相同 ——
 *   一个看不见也拖不动的把手等于这个功能不存在。
 * * **D5 用户收起 ⇒ 栏与把手都不画、零横向溢出**。钉住本单顺手挖出的一条旧缺陷：
 *   轨道归零时那一列仍以 33px 宽画在**视口外面**（`scrollWidth 1313 > innerWidth 1280`），
 *   而 `detailHasRoom` 那枚探针把 33 读成"有位置"。
 * * **D6 一份实现两条列**（源码判据）。负责人那句"都可以自己调整"要的是第二枚把手，
 *   不是第二份实现。
 *
 * ## 🔴 截图放固定路径、而且人要看
 *
 * `apps/web/evidence/detail-column-resize/`。D4 那两张（hover / idle）是**逐像素**
 * 要比的：它们相同就说明把手又画不出来了。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';

import type { Locator } from '@playwright/test';

import { addTask, openApp, parkCursor, switchView } from './helpers';

/** 🔴 按本文件位置解析，不用相对路径（`detail-column-slot.spec.ts` 文件头记着那次事故）。 */
const SHOT = (name: string) =>
  fileURLToPath(
    new URL(`../../apps/web/evidence/detail-column-resize/${name}.png`, import.meta.url),
  );

const COLUMN = '[data-testid="detail-column"]';
const HANDLE = '.ht-app__detail-resizer';
const APP_ZH = '/?lang=zh-CN';

/** 把某个 CSS 变量的**实际像素值**量出来（不假设 1rem=16px，也不抄字面量）。 */
async function tokenPx(page: Page, name: string): Promise<number> {
  return page.evaluate((n) => {
    const probe = document.createElement('div');
    probe.style.position = 'absolute';
    probe.style.visibility = 'hidden';
    probe.style.inlineSize = `var(${n})`;
    document.body.append(probe);
    const px = probe.getBoundingClientRect().width;
    probe.remove();
    return px;
  }, name);
}

/** 详情列此刻的宽度（px，四舍五入）。 */
async function columnWidth(page: Page): Promise<number> {
  return Math.round(await page.locator(COLUMN).evaluate((el) => el.getBoundingClientRect().width));
}

/** 整页横向溢出量：> 0 就是"右边有一块画在视口外面"。 */
async function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
}

/**
 * 行体那一棵（标题 + 元信息）。⚠️ 点行选中**只能**用它：外层 `task-item-*` 那棵
 * `View` 没有 `onPress`，点它不会选中（这条实测记在 `detail-pane-task.spec.ts` 的
 * `rowItemOf` 注释里，这里不重抄一遍理由）。
 */
const rowOf = (page: Page, title: string): Locator =>
  page.locator('[data-testid^="task-row-"]').filter({ hasText: title }).first();

/** 点开一条任务（不建）。 */
async function openTask(page: Page, title: string): Promise<void> {
  await rowOf(page, title).click();
  await expect(page.locator(COLUMN)).toBeVisible();
}

/** 建一条任务、点开它，并把焦点交回页面（输入框带焦点时方向键归它）。 */
async function addAndOpenTask(page: Page, title: string): Promise<void> {
  await addTask(page, title);
  await page.evaluate(() => {
    (document.activeElement as HTMLElement | null)?.blur();
  });
  await openTask(page, title);
}

/** 沿交界拖 `dx` 像素（往左是负数），返回松手后的列宽。 */
async function dragBy(page: Page, dx: number): Promise<number> {
  const box = await page.locator(HANDLE).boundingBox();
  expect(box, '把手必须有几何').not.toBeNull();
  const x = box!.x + box!.width / 2;
  const y = box!.y + box!.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(120);
  return columnWidth(page);
}

test('D1 没东西可画时那一栏不占位：主区吃满、零横向溢出、把手不画', async ({ page }) => {
  await openApp(page, APP_ZH);
  /* 🔴 载体是**日历视图**，不是"任务视图 + 没选中"（第二刀改的，判据本身一个字没动）。
     任务视图里那一格今天由 AI 面住着（2026-10-04 拍板「无状态的时候就可以默认显示
     AI Chatbot」，第二刀才兑现），它不再是"没东西可画"的那一档。
     日历视图既不在分支链那四面里、AI 面又只挂任务视图（`aiPanels` 两支都 gated 到
     `'tasks'`）⇒ 这一格零孩子，正是这条要钉的那个形状。 */
  await switchView(page, '日历');

  // 前提自检：这一档必须真的"没有东西可画"（不是探针读错了栏）。
  expect(
    await page.locator(COLUMN).evaluate((el) => el.childElementCount),
    '日历视图里那一栏已经有孩子了 ⇒ 这一条的载体不成立，读数无效',
  ).toBe(0);

  const vw = (page.viewportSize() as { width: number }).width;
  const main = await page.locator('.ht-main').boundingBox();
  expect(main, '量不到 .ht-main').not.toBeNull();
  expect(
    Math.abs(main!.x + main!.width - vw),
    `主区右边缘 ${String(main!.x + main!.width)} 没贴到视口右边 ${String(vw)} —— 右边仍被一格空白占着`,
  ).toBeLessThanOrEqual(1);
  expect(await horizontalOverflow(page), '整页出现横向溢出 ⇒ 那一栏画到视口外面去了').toBeLessThanOrEqual(
    0,
  );
  // 🔴 把手必须跟着消失：一枚"能聚焦、拖了什么都不动"的控件是界面在说谎
  //（同一条立场见 `narrow.css` 里 `.ht-sidebar__resizer { display: none }` 那段）。
  await expect(page.locator(HANDLE)).toBeHidden();
  await parkCursor(page);
  await page.screenshot({ path: SHOT('d1-empty-no-column') });
});

test('D2 选中一条任务之后那一栏回来，宽走 token，把手正压在交界上', async ({ page }) => {
  await openApp(page, APP_ZH);
  await addAndOpenTask(page, '详情栏回来甲');

  // 🔴 "回来"今天有两层意思（第二刀之后）：这一栏在任务视图里**默认由 AI 面住着**，
  // 选中一条任务之后住进去的必须是**任务面单** —— 同一格不能同时有两个所有者。
  // 少了这两句，"AI 面与面单叠着画"这一档在本条里完全看不出来（宽度判据照样绿）。
  await expect(
    page.locator(COLUMN).getByTestId('task-pane'),
    '那一栏里画的不是任务面单',
  ).toHaveCount(1);
  await expect(
    page.locator(COLUMN).getByTestId('ai-tool-run'),
    '选中任务后 AI 面没有让位（同一格两个所有者）',
  ).toHaveCount(0);

  const want = await tokenPx(page, '--ht-layout-detail-width');
  const got = await columnWidth(page);
  expect(got, `详情列宽 ${String(got)} 不等于 token 的 ${String(want)}`).toBeCloseTo(want, 0);
  expect(got, '列宽必须是"一栏"的量级，不是 0 被别的什么兜住').toBeGreaterThan(100);

  const vw = (page.viewportSize() as { width: number }).width;
  const col = await page.locator(COLUMN).boundingBox();
  expect(Math.abs(col!.x + col!.width - vw), '详情列右边缘没贴到视口右边').toBeLessThanOrEqual(1);
  expect(await horizontalOverflow(page), '有内容那一档也不许横向溢出').toBeLessThanOrEqual(0);

  // 把手几何：骑在"主区右边缘 = 列左边缘"那条交界上，中心点**反查命中的是它自己**。
  const handle = page.locator(HANDLE);
  await expect(handle, '左边缘必须有把手').toHaveCount(1);
  await expect(handle).toHaveAttribute('role', 'separator');
  await expect(handle).toHaveAttribute('aria-label', '调整详情栏宽度');
  const hb = await handle.boundingBox();
  expect(hb, '把手量不到几何').not.toBeNull();
  expect(
    Math.abs(hb!.x + hb!.width / 2 - col!.x),
    `把手中心点 ${String(hb!.x + hb!.width / 2)} 没压在那条交界 ${String(col!.x)} 上`,
  ).toBeLessThanOrEqual(1);
  expect(
    await page.evaluate(
      ([x, y]) => {
        const hit = document.elementFromPoint(x, y);
        return hit?.classList.contains('ht-app__detail-resizer') ?? false;
      },
      [hb!.x + hb!.width / 2, hb!.y + hb!.height / 2] as [number, number],
    ),
    '中心点反查没命中把手 —— 它被别的什么盖住了（或根本不在那一层）',
  ).toBe(true);
  expect(
    await handle.evaluate((el) => getComputedStyle(el).cursor),
    '指针形状要说明它能横向拖',
  ).toBe('col-resize');
  // 🔴 触屏前提：没写 `touch-action: none` 的话横向拖会被读成页面滚动（"鼠标能拖、手指拖不动"）。
  expect(await handle.evaluate((el) => getComputedStyle(el).touchAction)).toBe('none');
  await parkCursor(page);
  await page.screenshot({ path: SHOT('d2-column-back') });
});

test('D3 拖拽：往左变宽、刷新仍在、界内夹取、窄窗口 45vw 接管、双击与键盘等价', async ({ page }) => {
  await openApp(page, APP_ZH);
  await addAndOpenTask(page, '可拖宽乙');

  const def = await tokenPx(page, '--ht-layout-detail-width');
  const min = await tokenPx(page, '--ht-layout-detail-min-width');
  const max = await tokenPx(page, '--ht-layout-detail-max-width');
  expect(await columnWidth(page), '未拖过时必须就是 token 默认宽').toBe(def);

  // 🔴 方向判据：把手在列的**左**边缘 ⇒ 往左拖（dx 为负）是**变宽**。
  // 这一条是"两条列共用一份实现"里唯一不能靠读代码确认的部分（`edge` 参数搞反
  // 在代码里长得完全正确），只能真拖一下。
  expect(await dragBy(page, -120), '往左拖 120px 应该宽 120px').toBe(def + 120);

  await page.reload();
  await expect(page.locator('input[placeholder^="添加任务"]')).toBeVisible();
  await addAndOpenTask(page, '可拖宽乙');
  expect(await columnWidth(page), '刷新后宽度还在（设备本地持久化）').toBe(def + 120);

  expect(await dragBy(page, -3000), '拖过上限被夹在 token max').toBe(max);
  expect(await dragBy(page, 3000), '拖过下限被夹在 token min').toBe(min);

  // 窗口变窄时不需要任何 JS 监听：CSS 那层 `min(max, 45vw)` 自己把它收回去。
  // ⚠️ 取样窗口必须落在 `45vw < max` 那一档（< 480/0.45 ≈ 1067px），否则这条
  //    守卫**结构上不可能生效**，判据就成了恒真 —— 1100px 那一档我第一版写错在这里。
  const dragged = await dragBy(page, -3000);
  expect(dragged, '先拖到 max 才谈得上"窄窗口接管"').toBe(max);
  await page.setViewportSize({ width: 1040, height: 800 });
  await page.waitForTimeout(150);
  expect(
    await columnWidth(page),
    '窄窗口 ⇒ 45vw 接管（详情列不许吃掉一半以上的窗口）',
  ).toBe(Math.round(1040 * 0.45));
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.waitForTimeout(150);
  expect(await columnWidth(page), '放回宽窗口 ⇒ 不刷新就回到 max').toBe(max);

  await page.locator(HANDLE).dblclick();
  await page.waitForTimeout(120);
  expect(await columnWidth(page), '双击回到默认宽').toBe(def);

  // 键盘等价物：一步 = 当前宽的 5%，方向跟着把手所在的那一侧，Home 复位。
  const handle = page.locator(HANDLE);
  await handle.focus();
  await page.keyboard.press('ArrowLeft');
  await page.waitForTimeout(120);
  const widened = await columnWidth(page);
  expect(widened, 'ArrowLeft 放宽 5%（左边缘 ⇒ 左是"宽"）').toBe(def + Math.round(def * 0.05));
  // 🔴 下一步的期望值从**上一步的读数**推，不是从 `def` 推：步长是"当前宽的 5%"，
  // 所以来回各一步并不回到原点（352 → 370 → 351，我第一版按对称写成回到 352 就红了）。
  // 这条钉的是"每一步 = 当前宽的 5% 且方向相反"，那才是组件真正承诺的东西。
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(120);
  expect(await columnWidth(page), 'ArrowRight 收窄当前宽的 5%').toBe(
    widened - Math.round(widened * 0.05),
  );
  await page.keyboard.press('Home');
  await page.waitForTimeout(120);
  expect(await columnWidth(page), 'Home 回默认').toBe(def);

  // `aria-valuenow` 报的必须是**真的**数（报 900 而画 416 会让读屏撒谎）。
  expect(Number(await handle.getAttribute('aria-valuenow')), 'aria-valuenow 与实测列宽不符').toBe(
    await columnWidth(page),
  );
  await parkCursor(page);
  await page.screenshot({ path: SHOT('d3-dragged') });
});

test('D4 可拖性看得见：idle 不画线，hover 画主蓝且比静态边框粗', async ({ page }) => {
  await openApp(page, APP_ZH);
  await addAndOpenTask(page, '看得见丙');
  const handle = page.locator(HANDLE);

  expect(
    await handle.evaluate((el) => getComputedStyle(el, '::after').opacity),
    'idle 时不许画任何东西（否则那条缝永远顶着一条高亮线）',
  ).toBe('0');

  await handle.hover();
  await page.waitForTimeout(150);
  const hover = await handle.evaluate((el) => {
    const s = getComputedStyle(el, '::after');
    return { opacity: s.opacity, background: s.backgroundColor, width: s.width };
  });
  expect(hover.opacity, 'hover 必须真的画出来').toBe('1');
  const primary = await page.evaluate(() => {
    const probe = document.createElement('span');
    probe.style.color = 'var(--ht-color-primary)';
    document.body.append(probe);
    const value = getComputedStyle(probe).color;
    probe.remove();
    return value;
  });
  expect(
    hover.background,
    '必须换色：与详情列自己的 border-left 同色 ⇒ hover 画了等于没画（范围列那一枚 2026-09-30 实测）',
  ).toBe(primary);
  expect(
    Number.parseFloat(hover.width),
    '还要比静态边框粗，否则 1px 的主蓝压在 1px 的灰线上仍然看不清',
  ).toBeGreaterThan(await tokenPx(page, '--ht-border-width-thin'));

  const col = await page.locator(COLUMN).boundingBox();
  await page.screenshot({
    path: SHOT('d4-edge-hover'),
    clip: { x: col!.x - 24, y: 120, width: 48, height: 260 },
  });
  await parkCursor(page);
  await page.waitForTimeout(150);
  await page.screenshot({
    path: SHOT('d4-edge-idle'),
    clip: { x: col!.x - 24, y: 120, width: 48, height: 260 },
  });
});

test('D5 用户收起：栏与把手都不画，而且不留 33px 的视口外残余', async ({ page }) => {
  await openApp(page, APP_ZH);
  await addAndOpenTask(page, '收起丁');
  expect(await columnWidth(page), '起点就该有宽度（否则"收起后贴边"量的不是这次动作）').toBeGreaterThan(
    100,
  );

  await page.getByTestId('detail-pane-toggle').click();
  await expect(page.locator(COLUMN)).toBeHidden();
  await expect(page.locator(HANDLE)).toBeHidden();
  expect(
    await horizontalOverflow(page),
    '轨道归零后仍有东西画在视口外（grid 子项的 min-content 是 padding+border=33px）',
  ).toBeLessThanOrEqual(0);
  const vw = (page.viewportSize() as { width: number }).width;
  const main = await page.locator('.ht-main').boundingBox();
  expect(Math.abs(main!.x + main!.width - vw), '收起后主区没吃满').toBeLessThanOrEqual(1);
  // 🔴 图名对得上图里画的东西：这一张拍的是**收起那一刻**。第一版把它写在下面
  // "再点开"之后，于是 `d5-collapsed.png` 里其实是一栏展开的面单 —— 人看图才发现。
  await parkCursor(page);
  await page.screenshot({ path: SHOT('d5-collapsed') });

  // 回来：再点一次开关 ⇒ 栏按**用户拖过的那个宽**回来（不是被收起弄丢）。
  await page.getByTestId('detail-pane-toggle').click();
  await expect(page.locator(COLUMN)).toBeVisible();
  expect(await columnWidth(page), '展开后宽度不该被收起动作弄丢').toBeGreaterThan(100);
  await parkCursor(page);
  await page.screenshot({ path: SHOT('d5-reexpanded') });

  /* 🔴 第二腿：**有内容却被收起**的那一档。上面那一腿里，收起会让任务面单自己卸载
     ⇒ 这一栏同时也就"没东西可画"了，`[data-detail-empty]` 那条规则**顺带**把它藏了 ——
     只跑上面那一腿，`[data-detail='collapsed']` 那条 display:none 摘掉也不会红
     （臂台第一版就是被这件事否证的：臂 D 期望红在 D5，实际红集为空）。
     番茄钟面单是分支链里**不受收起开关管**的那一枚（`App.tsx` 第一个分支，不看
     `detailColumnShown`），所以它是那条规则真正的证人。 */
  await switchView(page, '番茄钟');
  await expect(page.locator(COLUMN), '番茄钟面单没让这一栏回来 ⇒ 这一腿没有证人').toBeVisible();
  expect(
    await page.locator(COLUMN).evaluate((el) => el.childElementCount),
    '证人在这一档没画东西（面单自己渲染成空，那条规则就没人盯着了）',
  ).toBeGreaterThan(0);
  await page.getByTestId('detail-pane-toggle').click();
  await expect(page.locator(COLUMN)).toBeHidden();
  expect(
    await columnWidth(page),
    '收起之后这一栏仍有孩子却不该有宽度（display:none 被摘掉的形状是 33px = padding+border）',
  ).toBe(0);
  expect(
    await horizontalOverflow(page),
    '有内容 + 用户收起 ⇒ 栏画在视口外',
  ).toBeLessThanOrEqual(0);
});

test('D6 两条列共用一份实现：把手都从 ColumnResizer 拿，旧模块名不许再有人引用', async ({ page }) => {
  await openApp(page, APP_ZH);
  const app = readFileSync(
    fileURLToPath(new URL('../../apps/web/src/App.tsx', import.meta.url)),
    'utf8',
  );
  const calendar = readFileSync(
    fileURLToPath(new URL('../../apps/web/src/features/calendar/CalendarSidebar.tsx', import.meta.url)),
    'utf8',
  );
  const impl = readFileSync(
    fileURLToPath(new URL('../../apps/web/src/features/shell/ColumnResizer.tsx', import.meta.url)),
    'utf8',
  );

  // 从**哪个模块**拿：两条列的把手必须来自同一枚文件。
  expect(app).toContain("from './features/shell/ColumnResizer.js'");
  expect(calendar).toContain("from '../shell/ColumnResizer.js'");
  // 不许再抄一份：旧模块名整个仓库不该还有人引用（它已经改名了）。
  expect(app, 'App.tsx 还在从旧模块名拿把手').not.toContain("from './features/shell/SidebarResizer.js'");
  expect(impl).toContain('export function SidebarResizer');
  expect(impl).toContain('export function DetailColumnResizer');
  // 参数一律必填 ⇒ 不许出现可选 prop（`?:` 会把"宿主忘了接"伪装成"做完了"，traps #195）。
  const propsBlock = impl.slice(
    impl.indexOf('export interface ColumnResizerProps'),
    impl.indexOf('/** 只在 `:root`'),
  );
  expect(propsBlock.length, '解析不到 ColumnResizerProps 那一段（改了名/挪了位置）').toBeGreaterThan(
    200,
  );
  expect(propsBlock, '把手参数里出现了可选 prop（?:）').not.toMatch(/readonly \w+\?/);
  // 两条列各自的方向登记在**参数**里（而不是散在两份实现里各写一遍符号）。
  expect(impl).toContain('edge="start"');
  expect(impl).toContain('edge="end"');
});
