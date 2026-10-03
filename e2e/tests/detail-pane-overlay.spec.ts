/**
 * 详情列与两个整屏浮层的关系（工单 W3）
 * ======================================
 *
 * W3 要拍的是"设置 / 搜索浮层**盖不盖**详情列"。工单取的默认值是"仍可见"，
 * 理由是它和既有裁决同源（`.ht-sheet` 只盖内容区，rail 与侧栏仍可见）。
 * 但"仍可见"这句话在两个浮层上**不是同一种形状**，实测出来的差别就是本文件的结构：
 *
 * | 浮层 | 定位 | 与详情列的几何关系 | "仍可见"靠什么 |
 * |---|---|---|---|
 * | 设置 `.ht-sheet` | `absolute` 挂在 `.ht-content` 里 | **不相交**（第四列是 `.ht-app` 的直接子项，在它外面） | 几何上根本没盖到 |
 * | 搜索 `.ht-search-overlay` | `fixed; inset: 0`（2026-10-01 为"跳回顶部"那个缺陷改的） | **相交**（它盖满视口） | scrim 半透明 `rgb(15 23 42 / .32)` 透出下层 |
 *
 * 🔴 判据一律写成**盒子相交**，不写 `toBeVisible()`：被浮层整个盖住的元素照样
 * `visible`（Playwright 的 visible = 有盒子且非 `visibility:hidden`），
 * 那条会绿在"详情列已经被盖死"的界面上。
 *
 * 🔴 每条"不相交 / 相交"都必须配一条**正向对照**（浮层确实盖住了中间那一列）。
 * 少了它，"不盖详情列"在浮层压根没渲染出来的时候也成立 —— 那是恒真判据
 * （§7 元规则 2）。
 *
 * ⚠️ 截图路径按本文件位置解析，理由与事故记录在 `selection-projections.spec.ts` 文件头。
 */
import { fileURLToPath } from 'node:url';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { openApp, openSettingsView, parkCursor } from './helpers';

const SHOT = (name: string) =>
  fileURLToPath(new URL(`../../apps/web/evidence/detail-pane-overlay/${name}.png`, import.meta.url));

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 两个盒子是否有**面积**重叠（贴边不算：那正是我们要的"各占一边"）。 */
function overlaps(a: Box, b: Box): boolean {
  return a.x < b.x + b.width - 1 && b.x < a.x + a.width - 1 && a.y < b.y + b.height - 1 && b.y < a.y + a.height - 1;
}

/**
 * 等盒子停止位移再返回。
 *
 * 两个浮层都挂着入场动画（`.ht-sheet-in` 跑 opacity，搜索卡片还额外有**反向**的
 * translateY —— 见 `search-overlay.spec.ts` 里那个 `settledGeometry` 的文件头），
 * 动画中间帧量到的 y 不是布局给的 y。
 */
async function settledBox(loc: Locator): Promise<Box> {
  let prev = await loc.boundingBox();
  for (let i = 0; i < 25; i++) {
    await loc.page().waitForTimeout(60);
    const now = await loc.boundingBox();
    if (prev && now && Math.abs(now.y - prev.y) < 0.5 && Math.abs(now.height - prev.height) < 0.5) {
      return now;
    }
    prev = now;
  }
  throw new Error('浮层盒子一直没落位 —— 这条判据的读数不成立');
}

/**
 * 读一个元素背景色的 alpha（1 = 完全不透明）。
 *
 * 🔴 空串要**响亮地失败**而不是当成 0：Chromium 对分离节点 `getComputedStyle`
 * 返回 `""`，把它读成"全透明"会让"透出下层"这条判据假绿（本轮在
 * `selection-projections.spec.ts` 里刚为同一件事修过一次）。
 */
async function alphaOfBackground(el: Locator): Promise<number> {
  const value = await el.evaluate((node) => {
    if (!node.isConnected) return '';
    return getComputedStyle(node).backgroundColor;
  });
  expect(value, '背景色读不出来（分离节点？）—— 不能拿空串当透明').not.toBe('');
  const nums = value.match(/[\d.]+/g) ?? [];
  expect(nums.length, `背景色形状不认识：${value}`).toBeGreaterThanOrEqual(3);
  // `rgb(r g b)` 没有第四段 ⇒ 不透明；`rgba(...)` / `rgb(... / a)` 取最后一段。
  return nums.length >= 4 ? Number(nums[3]) : 1;
}

async function detailBox(page: Page): Promise<Box> {
  const el = page.getByTestId('detail-column');
  await expect(el, '界面上没有详情列').toBeVisible();
  const b = await el.boundingBox();
  expect(b, '详情列量不到 boundingBox').not.toBeNull();
  return b as Box;
}

async function mainBox(page: Page): Promise<Box> {
  const b = await page.locator('.ht-main').boundingBox();
  expect(b, '量不到 .ht-main 的 boundingBox').not.toBeNull();
  return b as Box;
}

async function pxOfCssVar(page: Page, name: string): Promise<number> {
  return page.evaluate((varName) => {
    const probe = document.createElement('div');
    probe.style.position = 'absolute';
    probe.style.visibility = 'hidden';
    probe.style.inlineSize = `var(${varName})`;
    document.body.appendChild(probe);
    const px = probe.getBoundingClientRect().width;
    probe.remove();
    return px;
  }, name);
}

test.describe('浮层与详情列', () => {
  test('设置浮层只盖中间那一列，详情列在它外面且没被挤掉', async ({ page }) => {
    await openApp(page, '/?lang=zh-CN');
    await openSettingsView(page);

    const sheet = page.getByTestId('settings-sheet');
    await expect(sheet, '设置浮层没出现').toBeVisible();
    const sheetBox = await settledBox(sheet);
    const detail = await detailBox(page);

    // 正向对照：它必须**真的盖住**中间那一列，否则下面那条"不相交"是恒真。
    expect(
      overlaps(sheetBox, await mainBox(page)),
      `设置浮层连中间列都没盖住（sheet ${String(sheetBox.x)}+${String(sheetBox.width)}）—— "不盖详情列"这条就成了空判据`,
    ).toBe(true);

    // 决定本体：第四列不在浮层的覆盖范围内。
    expect(
      overlaps(sheetBox, detail),
      `设置浮层盖到了详情列上（sheet 右边缘 ${String(sheetBox.x + sheetBox.width)} vs 详情列左边缘 ${String(detail.x)}）`,
    ).toBe(false);

    // 浮层打开**不是**重排的理由：列宽仍等于 token。
    const want = await pxOfCssVar(page, '--ht-layout-detail-width');
    expect(detail.width, `浮层打开后详情列宽 ${String(detail.width)} 不再是 token 的 ${String(want)}`).toBeCloseTo(
      want,
      0,
    );

    await parkCursor(page);
    await page.screenshot({ path: SHOT('settings-sheet') });
  });

  test('搜索浮层盖满视口，但靠半透明 scrim 让详情列读得出来', async ({ page }) => {
    await openApp(page, '/?lang=zh-CN');
    await page.getByRole('tab', { name: '搜索' }).click();

    const surface = page.locator('.ht-search-overlay');
    await expect(surface, '搜索浮层没出现').toBeVisible();
    const surfaceBox = await settledBox(surface);
    const detail = await detailBox(page);

    // 它**会**盖到详情列 —— 这条钉的是"盖满视口 + 透出下层"这个决定本身。
    // 哪天有人把搜索层缩回内容区，那是决定变更：本条转红，改判据要写明理由。
    expect(
      overlaps(surfaceBox, detail),
      '搜索浮层不再盖到详情列了 —— 决定变了（缩回内容区 / 改定位），要回来改本条并说明理由',
    ).toBe(true);

    // 而"仍可见"靠的是 scrim 半透明：alpha 必须 **在 0 与 1 之间**。
    // 下界不是凑数：alpha=0 等于没有 scrim，"透出下层"就变成一句空话。
    const alpha = await alphaOfBackground(surface);
    expect(alpha, `scrim 的 alpha=${String(alpha)} 不小于 1 —— 下层（含详情列）被盖死了`).toBeLessThan(1);
    expect(alpha, `scrim 的 alpha=${String(alpha)} 不大于 0 —— 根本没有 scrim，"透出"是假的`).toBeGreaterThan(0);

    // 分母自检：详情列本身还在原位（浮层没把它挤走或收起）。
    const vw = page.viewportSize()?.width ?? 0;
    expect(vw, '量不到视口尺寸').toBeGreaterThanOrEqual(1024);
    expect(
      Math.abs(detail.x + detail.width - vw),
      '浮层打开时详情列不再贴窗口右边缘',
    ).toBeLessThanOrEqual(1);

    await parkCursor(page);
    await page.screenshot({ path: SHOT('search-overlay') });
  });
});
