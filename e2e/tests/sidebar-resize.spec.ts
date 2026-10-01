import { expect, test, type Page } from '@playwright/test';
import { openApp } from './helpers';

/**
 * 侧栏的两条改动（goal-layout-audit 追加：产品负责人 2026-09-30）
 * =================================================================
 *
 * 1. **「+清单」不许是一个常驻大输入框** —— 「侧边栏那个应该是可以自由的去
 *    拖拽的」，以及「+清单的UX设计应该用icon或者说是小组件的方式」。
 * 2. **侧栏宽度可拖拽 + 自适应** —— 结果记在**本设备**（`localStorage`），
 *    不进 op-log：这是"这台设备上界面长什么样"，不是用户数据。
 *
 * ## 🔴 为什么这里既有断言又有截图
 *
 * 断言能钉住几何与状态，钉不住"看得见吗"。本轮实测到的那条真缺陷就是例子：
 * 拖拽把手的 hover 提示线**原来用 `--ht-color-border`**，而这一列自己的
 * `border-right` 恰好是同一个值、同一列像素 —— 画了等于没画，
 * **hover 与 idle 两张截图逐像素相同**。任何"元素存在"式断言都是绿的。
 * 所以：颜色判据从 token 现读现比（不写死 rgb），截图落固定路径、人要看。
 */

const SIDEBAR = '.ht-sidebar';
const HANDLE = '.ht-resizer';

/** 侧栏列宽（像素，四舍五入）。 */
async function width(page: Page): Promise<number> {
  return Math.round(
    await page.locator(SIDEBAR).evaluate((el) => el.getBoundingClientRect().width),
  );
}

/** 从 token 现读一个 CSS 量的像素值（判据不许自带一份数字）。 */
async function tokenPx(page: Page, name: string): Promise<number> {
  return page.evaluate((n) => {
    const raw = getComputedStyle(document.documentElement).getPropertyValue(n).trim();
    const value = Number.parseFloat(raw);
    if (!Number.isFinite(value)) throw new Error(`${n} 不是像素量：${raw}`);
    return raw.endsWith('rem')
      ? value * Number.parseFloat(getComputedStyle(document.documentElement).fontSize)
      : value;
  }, name);
}

/** 把 `var(--ht-color-primary)` 解析成 computed style 会返回的那种 rgb() 串。 */
async function primaryColor(page: Page): Promise<string> {
  return page.evaluate(() => {
    const probe = document.createElement('span');
    probe.style.color = 'var(--ht-color-primary)';
    document.body.append(probe);
    const value = getComputedStyle(probe).color;
    probe.remove();
    return value;
  });
}

/** 沿右边缘拖 `dx` 像素，返回松手后的列宽。 */
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
  return width(page);
}

test('侧栏宽度：默认 = token、拖拽生效、刷新仍在、界内夹取、双击复位', async ({ page }) => {
  await openApp(page);

  const def = await tokenPx(page, '--ht-layout-sidebar-width');
  const min = await tokenPx(page, '--ht-layout-sidebar-min-width');
  const max = await tokenPx(page, '--ht-layout-sidebar-max-width');
  expect(await width(page), '未拖过时必须就是 token 默认宽').toBe(def);

  const handle = page.locator(HANDLE);
  await expect(handle, '右边缘必须有把手').toHaveCount(1);
  await expect(handle).toHaveAttribute('role', 'separator');
  await expect(handle).toHaveAttribute('aria-orientation', 'vertical');
  expect(
    await handle.evaluate((el) => getComputedStyle(el).cursor),
    '把手的指针形状要说明它能横向拖',
  ).toBe('col-resize');
  // 🔴 触屏前提：`touch-action: none` 没写的话，横向拖会被浏览器读成页面滚动，
  // 症状是"鼠标能拖、手指拖不动"。
  expect(
    await handle.evaluate((el) => getComputedStyle(el).touchAction),
  ).toBe('none');

  expect(await dragBy(page, 120), '往右拖 120px 就宽 120px').toBe(def + 120);

  await page.reload();
  await expect(page.locator('input[placeholder^="添加任务"]')).toBeVisible();
  expect(await width(page), '刷新后宽度还在（设备本地持久化）').toBe(def + 120);

  expect(await dragBy(page, 3000), '拖过上限被夹在 token max').toBe(max);
  expect(await dragBy(page, -3000), '拖过下限被夹在 token min').toBe(min);

  // 窗口变窄时不需要任何 JS 监听：CSS `clamp()` 自己把它收回去。
  // ⚠️ 只能在桌面断点**之上**验 —— ≤768px 整个外壳塌成底部导航，侧栏不再是列。
  await dragBy(page, 3000);
  await page.setViewportSize({ width: 900, height: 900 });
  await page.waitForTimeout(150);
  expect(await width(page), '窄窗口 ⇒ 40vw 接管').toBe(360);
  await page.screenshot({ path: 'test-results/sidebar-narrow.png' });
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.waitForTimeout(150);
  expect(await width(page), '放回宽窗口 ⇒ 不刷新就回到 max').toBe(max);

  await handle.dblclick();
  await page.waitForTimeout(120);
  expect(await width(page), '双击回到默认宽').toBe(def);

  // 键盘等价物：一步 = 当前宽的 5%，Home 复位。
  await handle.focus();
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(120);
  expect(await width(page), 'ArrowRight 放宽 5%').toBe(def + Math.round(def * 0.05));
  await page.keyboard.press('Home');
  await page.waitForTimeout(120);
  expect(await width(page), 'Home 回默认').toBe(def);
});

test('把手的可拖性要看得见：idle 不画线，hover 画主蓝且比静态边框粗', async ({ page }) => {
  await openApp(page);
  const handle = page.locator(HANDLE);

  const idle = await handle.evaluate((el) => getComputedStyle(el, '::after').opacity);
  expect(idle, 'idle 时不许画任何东西（否则整列永远顶着一条高亮线）').toBe('0');

  await handle.hover();
  await page.waitForTimeout(150);
  const hover = await handle.evaluate((el) => {
    const s = getComputedStyle(el, '::after');
    return { opacity: s.opacity, background: s.backgroundColor, width: s.width };
  });
  expect(hover.opacity, 'hover 必须真的画出来').toBe('1');
  expect(
    hover.background,
    '必须换色：与这一列自己的 border-right 同色 ⇒ hover 画了等于没画',
  ).toBe(await primaryColor(page));
  expect(
    Number.parseFloat(hover.width),
    '还要比静态边框粗，否则 1px 的主蓝压在 1px 的灰线上仍然看不清',
  ).toBeGreaterThan(await tokenPx(page, '--ht-border-width-thin'));

  // 边带截图：48px 宽的一小条，放大后能一眼看出画没画。
  const side = await page.locator(SIDEBAR).boundingBox();
  expect(side, '侧栏有几何').not.toBeNull();
  await page.screenshot({
    path: 'test-results/sidebar-edge-hover.png',
    clip: { x: side!.x + side!.width - 24, y: 120, width: 48, height: 260 },
  });
  await page.mouse.move(900, 600); // 🔴 移开指针才退出 :hover（按 Esc 不会）
  await page.waitForTimeout(150);
  await page.screenshot({
    path: 'test-results/sidebar-edge-idle.png',
    clip: { x: side!.x + side!.width - 24, y: 120, width: 48, height: 260 },
  });
});

test('新建入口是标题右侧的 +：默认无输入框，点开才出现，收起分两种', async ({ page }) => {
  await openApp(page);
  const sidebar = page.locator('aside[aria-label="清单与标签"]');
  const addList = page.getByRole('button', { name: '新建清单' });
  const listInput = page.getByLabel('新清单名称');

  // ① 旧形态不许回来：常驻输入框 + 旁边一个「+」。
  await expect(page.locator('input[placeholder="新清单"]'), '常驻输入框必须消失').toHaveCount(0);
  await expect(listInput).toHaveCount(0);
  await expect(addList, '标题右侧只有一个 +').toHaveCount(1);
  await expect(addList).toHaveAttribute('aria-expanded', 'false');
  await page.screenshot({ path: 'test-results/organizer-collapsed.png' });

  // ② 点开：输入框出现且**自动聚焦**（不聚焦的话"点 + 然后打字"这条直觉断掉）。
  await addList.click();
  await expect(listInput).toBeVisible();
  await expect(addList).toHaveAttribute('aria-expanded', 'true');
  expect(
    await listInput.evaluate((el) => el === document.activeElement),
    '展开那一刻必须拿到焦点',
  ).toBe(true);
  await page.screenshot({ path: 'test-results/organizer-expanded.png' });

  // ③ 连建是常态：提交后**不收起**、草稿清空。
  await listInput.fill('深度工作');
  await page.getByRole('button', { name: '添加清单' }).click();
  await expect(sidebar.getByText('深度工作', { exact: true })).toBeVisible();
  await expect(listInput, '建完不许收起（否则每建一条都要重新点 +）').toHaveValue('');

  // ④ 展开按钮与提交按钮**不能共用一个可及名** —— 共用会让 strict mode 直接红，
  //    而屏幕阅读器里两个不同的动作听起来是同一件事。
  await expect(page.getByRole('button', { name: '新建清单' })).toHaveCount(1);
  await expect(page.getByRole('button', { name: '添加清单' })).toHaveCount(1);

  // ⑤ Esc = 明确丢弃：连草稿一起清掉并收起。
  await listInput.fill('不该存在');
  await listInput.press('Escape');
  await expect(listInput).toHaveCount(0);
  await expect(sidebar.getByText('不该存在')).toHaveCount(0);
  await addList.click();
  await expect(listInput, 'Esc 之后重新点开必须是空的').toHaveValue('');

  // ⑥ 点到区块外 = 只是收起，草稿留着（与 Esc 相反；挂 blur 会跟标题的 + 打架）。
  await listInput.fill('草稿留着');
  await page.mouse.click(900, 600);
  await expect(listInput).toHaveCount(0);
  await expect(sidebar.getByText('草稿留着')).toHaveCount(0);
  await addList.click();
  await expect(listInput, '点走再回来，字还在').toHaveValue('草稿留着');

  // ⑦ 标签同一形态；且一次只开一个 composer。
  await page.getByRole('button', { name: '新建标签' }).click();
  await expect(page.getByLabel('新标签名称')).toBeVisible();
  await expect(listInput, '一次只开一个输入框').toHaveCount(0);
  await page.screenshot({ path: 'test-results/organizer-tag-composer.png' });
  await page.getByLabel('新标签名称').fill('重要');
  await page.getByRole('button', { name: '添加标签' }).click();
  await expect(sidebar.getByText('重要', { exact: true })).toBeVisible();
});
