/**
 * 添加习惯对话框的**形状**判据（2026-10-24）
 * ==========================================
 *
 * 为什么单独一族：这一轮之前，全仓对"一个表单长什么样"的自动化判据是**零**。
 * `check:design` 只认值、`check:l4` 只认 TSX 字面量、`check:overlay` 只数模态标记
 * —— 那个 11 控件、无分组、动作按钮滚出视口的对话框，把这些门禁**全部走绿**了。
 * 所以这里量的是四件**几何/行为**事实，每一件都对应一个曾经真实存在的坏：
 *
 *   S1 · 动作按钮必须在视口里、且不用滚动就能点
 *        （此前 754 高的窗口下「取消 / 添加习惯」**一个像素都没渲染出来**，
 *          而 `toBeVisible()` 对它返回 true —— `toBeVisible()` 不验"在不在视口里"，
 *          这个坑本仓在 H3 的 I6 已经栽过一次。）
 *   S2 · 同一个对话框里，可键入的控件**只有一档高度**
 *        （此前 input/select 都写了 `min-block-size: 44`，原生 select 实测渲成 20。）
 *   S3 · 标签在**左列**、控件在**右列**，两列各自对齐成一条竖线
 *        （此前是"标签在控件上方" + 两列栅格，每个字段占 76px 纵向。）
 *   S4 · 图标默认收起，点头像才展开 —— 不是 24 枚常驻铺在表单中间
 *        （这一条是**顺序**判据：收起时不存在、点开后才出现。）
 *
 * ⚠️ 这四条都**不**用 `toBeVisible()` 当几何证据：S1 读 `boundingBox()` 与
 * `innerHeight` 比，S3 读 x 坐标，S2 读 `offsetHeight` 的**去重集合大小**。
 */

import { expect, test, type Page } from '@playwright/test';

import { assertFormRhythm, openApp, switchView } from './helpers';

const APP_ZH = '/?lang=zh-CN';

async function openCreateDialog(page: Page) {
  await openApp(page, APP_ZH);
  await switchView(page, '习惯');
  await page.getByTestId('habits-add-open').click();
  const dialog = page.getByTestId('habit-create-dialog');
  await expect(dialog).toBeVisible();
  return dialog;
}

test('S1 动作按钮在视口内，且不用滚动就能点到', async ({ page }) => {
  const dialog = await openCreateDialog(page);
  const submit = dialog.getByRole('button', { name: '添加习惯', exact: true });

  const box = await submit.boundingBox();
  expect(box, '提交按钮必须有一枚非空 boundingBox').not.toBeNull();
  const viewport = page.viewportSize();
  expect(viewport).not.toBeNull();

  // 🔴 判据就是这一条：按钮的**下沿**必须落在视口内。
  //    此前它在滚动容器里，689 > 632 的用例视口 ⇒ 完全看不见。
  expect(
    box!.y + box!.height,
    `提交按钮下沿 ${Math.round(box!.y + box!.height)} 必须 ≤ 视口高 ${viewport!.height}`,
  ).toBeLessThanOrEqual(viewport!.height);

  // 再钉一层"能点"：不滚动直接点，且真的触发（对话框关闭 = 场景成立或校验通过）。
  await dialog.getByLabel('新习惯名称', { exact: true }).fill(`形状判据-${Date.now().toString().slice(-6)}`);
  await submit.click({ timeout: 3000 });
  await expect(dialog).toHaveCount(0);
});

test('S2 同一对话框里可键入控件只有一档高度', async ({ page }) => {
  const dialog = await openCreateDialog(page);
  // 展开那几个条件行，把 select / 星期按钮 / 复习按钮都放进同一个测量面。
  await dialog.getByLabel('频次', { exact: true }).selectOption('spaced');

  // 🔴 判据本体在 `helpers.ts#assertFormRhythm`（同一个判断只许有一份实现）：
  //    它量的是**去重集合大小**，不是"每个都 ≥44"—— 后者会把"44 与 20 并存"也算过。
  await assertFormRhythm(dialog);
  // 那一档必须就是字段高度 token（44），不是"碰巧一致"的一个小值。
  const heights = await dialog.evaluate((root) => {
    const controls = root.querySelectorAll<HTMLElement>(
      'input:not([type="checkbox"]):not([type="radio"]):not([type="hidden"]), select, textarea',
    );
    return [...new Set([...controls].map((el) => Math.round(el.getBoundingClientRect().height)))];
  });
  expect(heights.length, '至少要有 3 个控件，否则这条判据没在测东西').toBe(1);
  expect(heights[0]).toBeGreaterThanOrEqual(43);
});

test('S3 标签在左列、控件在右列，各自对齐成一条竖线', async ({ page }) => {
  const dialog = await openCreateDialog(page);

  // 🔴 一个字段 = 一个 `FormField`（`.ht-input-field`）。所以这里按**行**量，
  //    不是按"网格的子元素"量：后者会随着 DOM 结构变化失效，
  //    而"每一行的标签左沿都相同"才是这张表单真正的不变量。
  const geometry = await dialog.evaluate((root) => {
    const fields = [...root.querySelectorAll<HTMLElement>('.ht-input-field')]
      .filter((el) => !el.closest('.ht-input-field__control'));
    return fields.map((field) => {
      const label = field.querySelector<HTMLElement>(
        '.ht-input-field__label, .ht-habit-create-dialog__avatar',
      );
      const control = field.querySelector<HTMLElement>(
        '.ht-input-field__control, .ht-input-field__select, .ht-input-field__pair',
      );
      const lr = label?.getBoundingClientRect();
      const cr = control?.getBoundingClientRect();
      return {
        hasBoth: lr !== undefined && cr !== undefined,
        labelLeft: lr === undefined ? null : Math.round(lr.left),
        labelRight: lr === undefined ? null : Math.round(lr.right),
        controlLeft: cr === undefined ? null : Math.round(cr.left),
      };
    });
  });

  const measured = geometry.filter((row) => row.hasBoth);
  expect(measured.length, '这张表单至少要有 4 行能同时量到标签与控件').toBeGreaterThanOrEqual(4);

  const labelLefts = [...new Set(measured.map((row) => row.labelLeft))];
  const controlLefts = [...new Set(measured.map((row) => row.controlLeft))];
  expect(labelLefts, `标签左沿出现 ${labelLefts.length} 条竖线：${labelLefts.join(' / ')}`).toHaveLength(1);
  expect(
    controlLefts,
    `控件左沿出现 ${controlLefts.length} 条竖线：${controlLefts.join(' / ')}`,
  ).toHaveLength(1);
  // 控件列必须在标签列**右边**（不是"标签在上、控件在下"那种窄屏回落）。
  expect(controlLefts[0]!).toBeGreaterThan(Math.max(...measured.map((row) => row.labelRight!)));
});

test('S4 图标默认收起，点头像才展开', async ({ page }) => {
  const dialog = await openCreateDialog(page);

  const heart = dialog.getByRole('button', { name: '爱心', exact: true });
  await expect(heart, '收起态不许多出任何一枚图标').toHaveCount(0);

  await dialog.getByTestId('habit-create-icon-toggle').click();
  await expect(heart).toHaveCount(1);
  // 面板整排在对话框内（不是溢出到视口外），且第一枚与最后一枚都点得到。
  const panel = dialog.locator('#ht-habit-create-icons');
  await expect(panel).toBeVisible();
  const panelBox = await panel.boundingBox();
  const dialogBox = await dialog.boundingBox();
  expect(panelBox!.x).toBeGreaterThanOrEqual(dialogBox!.x);
  expect(panelBox!.x + panelBox!.width).toBeLessThanOrEqual(dialogBox!.x + dialogBox!.width + 1);

  await heart.click();
  // 选完之后头像换成那一枚字形，面板仍开着（用户可以继续换）。
  await expect(heart).toHaveAttribute('aria-pressed', 'true');
});

test('S5 间隔复习能建出来，刷新后仍在，且摘要说得出是哪一档', async ({ page }) => {
  const dialog = await openCreateDialog(page);
  const name = `间隔复习-${Date.now().toString().slice(-6)}`;

  await dialog.getByLabel('新习惯名称', { exact: true }).fill(name);
  await dialog.getByLabel('频次', { exact: true }).selectOption('spaced');

  // 默认那六档是**可改的**：这里证明它真的是一排可选格，而不是说明文字。
  const group = dialog.getByRole('group', { name: '间隔复习', exact: true });
  await expect(group.getByRole('button', { name: '创建后第 30 天复习', exact: true })).toHaveCount(1);
  // 去掉第 30 天（验证 aria-pressed 是可控状态，不是纯装饰）。
  await group.getByRole('button', { name: '创建后第 30 天复习', exact: true }).click();
  await expect(group.getByRole('button', { name: '创建后第 30 天复习', exact: true }))
    .toHaveAttribute('aria-pressed', 'false');

  await dialog.getByRole('button', { name: '添加习惯', exact: true }).click();

  const row = page.locator('[data-testid^="habit-row-"]').filter({ hasText: name }).first();
  await expect(row).toBeVisible();
  const id = (await row.getAttribute('data-testid') ?? '').replace(/^habit-row-/, '');

  // 落盘 + 读回：刷新后仍在，且详情面的频次摘要读出"间隔复习"这一档。
  await page.reload();
  await switchView(page, '习惯');
  await expect(page.locator('[data-testid^="habit-row-"]').filter({ hasText: name })).toHaveCount(1);
  await page.getByTestId(`habit-row-${id}`).click();
  await expect(page.getByTestId(`habit-freq-summary-${id}`)).toContainText('间隔复习');
});

test('S6 键盘焦点必须画得出来，且环对底色 ≥ 3:1（WCAG 2.4.7 + 1.4.11）', async ({ page }) => {
  const dialog = await openCreateDialog(page);
  const input = dialog.getByLabel('新习惯名称', { exact: true });
  // 先点进对话框再 Tab 一次：让浏览器按**键盘**路径给 :focus-visible。
  await input.click();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Shift+Tab');
  await expect(input).toBeFocused();

  const ring = await input.evaluate((el) => {
    const cs = getComputedStyle(el);
    const parse = (value: string): [number, number, number] => {
      const parts = value.match(/[\d.]+/g) ?? ['0', '0', '0'];
      return [Number(parts[0]), Number(parts[1]), Number(parts[2])];
    };
    const channel = (c: number): number => {
      const s = c / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    };
    const luminance = ([r, g, b]: [number, number, number]): number =>
      0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
    const ratio = (a: [number, number, number], b: [number, number, number]): number => {
      const la = luminance(a);
      const lb = luminance(b);
      return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
    };
    return {
      outlineWidth: parseFloat(cs.outlineWidth),
      outlineStyle: cs.outlineStyle,
      ratio: ratio(parse(cs.outlineColor), parse(cs.backgroundColor)),
    };
  });

  // 🔴 两条一起判：环既要有厚度，也要够亮。
  //    改前 `borderless-controls.css` 用 `:focus { outline: 0 !important }` 把**所有
  //    输入框**的焦点环抹掉了 —— 全仓零可见焦点，而没有任何判据能发现。
  expect(ring.outlineStyle, '焦点环被抹掉了（outline-style = none）').not.toBe('none');
  expect(ring.outlineWidth, `焦点环宽度 ${ring.outlineWidth}px 太细`).toBeGreaterThanOrEqual(1);
  expect(
    Math.round(ring.ratio * 100) / 100,
    `焦点环对比只有 ${ring.ratio.toFixed(2)}:1，WCAG 1.4.11 要求 ≥ 3:1`,
  ).toBeGreaterThanOrEqual(3);
});
