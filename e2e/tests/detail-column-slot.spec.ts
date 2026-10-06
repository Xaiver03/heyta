/**
 * 详情列槽位（工单 W2）的承重判据
 * =================================
 *
 * W2 只交付**外壳层的一根列**，不交付它的内容（内容阻塞在拍板 #1/#8）。
 * 所以这一份验的不是"里面有什么"，而是**它在哪、多宽、什么时候不出现**。
 *
 * 🔴 承重的那一条是**右边缘 == 视口右边缘**。为什么这条不能省成"列存在"：
 * `.ht-content` 带 `max-inline-size: var(--ht-layout-content-max)` + `margin-inline: auto`，
 * 详情列一旦挂进它里面，就永远贴不到窗口右边 —— 观感上不是"三栏 + 右详情"，
 * 而是"中间一坨里再分两栏"（习惯页现在就是这个观感）。"列存在"两种做法都绿，
 * 只有右边缘能分开它们。变异臂就是把那一列搬回 `.ht-content` 里面。
 *
 * ⚠️ 宽度阈值**从页面自己读**（下面 `pxOfCssVar`），不在测试里抄 rem→px：
 * 抄一遍常数就等于把 token 的当前值写死进判据，改 token 的人不会被告知这里有一条。
 * 造一个临时元素去量 `var(--ht-layout-detail-min-width)` 的实际像素，
 * 才是"阈值由被约束的常量推导"（§7 元规则 2）。
 */
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { openApp, parkCursor, showDetailColumnContent, switchView } from './helpers';

/** 控制台错误收集：监听必须**在导航之前**挂上，否则加载期错误收不到
 *  （§6.2 规定一第 3 条：`控制台无内容` 是最误导人的结果）。 */
function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console: ${m.text()}`);
  });
  page.on('pageerror', (e) => errors.push(`pageerror: ${String(e)}`));
  return errors;
}

/** 🔴 按**本文件位置**解析，不用相对路径：相对路径按进程 cwd 解析，
 *  实测会把证据写进主检出（`selection-projections.spec.ts` 文件头记着这次事故）。 */
const SHOT = (name: string) =>
  fileURLToPath(new URL(`../../apps/web/evidence/detail-column-slot/${name}.png`, import.meta.url));

/** 把某个 CSS 变量的**实际像素值**量出来（不假设 1rem=16px，也不抄字面量）。 */
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

async function box(page: Page, testId: string) {
  const el = page.getByTestId(testId);
  await expect(el, `界面上没有 ${testId}`).toBeVisible();
  const b = await el.boundingBox();
  expect(b, `${testId} 量不到 boundingBox`).not.toBeNull();
  return b as { x: number; y: number; width: number; height: number };
}

test.describe('详情列槽位', () => {
  test('它贴窗口右边缘，且宽度落在 token 区间内', async ({ page }) => {
    const errors = watchErrors(page);
    await openApp(page, '/?lang=zh-CN');

    // 🔴 前置（2026-10-06 工单 H10 第一刀之后新增）：详情列现在"没东西可画就不占位"，
    // 所以这一栏"在不在 / 多宽 / 贴不贴边"的判据必须跑在有内容的那一档。
    // 下面每一条断言逐字未动 —— 动的只有前置这一步，判据口径不变。
    await showDetailColumnContent(page);
    await expect(page.getByTestId('detail-column')).toBeVisible();

    const viewport = page.viewportSize();
    expect(viewport, '量不到视口尺寸，右边缘判据不成立').not.toBeNull();
    const vw = (viewport as { width: number }).width;
    // 前提自检：这条判据只在"视口比三档加起来还宽"时才有意义，否则列本来就该隐藏。
    expect(vw, '测试视口太窄，落进了详情列不出现的档位').toBeGreaterThanOrEqual(1024);

    const detail = await box(page, 'detail-column');
    // 中间列没有 test 锚点，也不为测试新加一个：`.ht-main` 是它的布局身份本身
    // （同 `helpers.ts` 里 `.ht-header__title` 的先例）。
    const mainBox = await page.locator('.ht-main').boundingBox();
    expect(mainBox, '量不到 .ht-main 的 boundingBox').not.toBeNull();
    const main = mainBox as { x: number; y: number; width: number; height: number };

    // ──  承重：右边缘 == 视口右边缘 ────────────────────────────────
    expect(
      Math.abs(detail.x + detail.width - vw),
      `详情列右边缘 ${String(detail.x + detail.width)} 没贴到视口右边 ${String(vw)}`,
    ).toBeLessThanOrEqual(1);
    // 正向对照的另一半：中间列**不该**贴到右边 —— 它右边还有详情列。
    // 只断言详情列贴边是不够的：把详情列搬进 `.ht-content` 之后，
    // 若同时忘了改 `max-inline-size`，两条边可能一起缩进去，这一条会替我抓住。
    expect(
      main.x + main.width,
      '中间列已经贴到视口右边 —— 那说明详情列没有占住它右边的位置',
    ).toBeLessThanOrEqual(detail.x + 1);

    // ── 结构：它是 `.ht-app` 的直接子项（上面那条几何判据成立的机制）──
    const parentClass = await page
      .getByTestId('detail-column')
      .evaluate((el) => el.parentElement?.className ?? '');
    expect(parentClass, '详情列不是 .ht-app 的直接子项').toContain('ht-app');

    // ── 宽度**等于 token 给的那个值**，并且区间本身非退化 ──────────────
    //
    // 🔴 这里原本写的是"落在 [min, max] 区间内"，那是**一条永远不会红的判据**：
    // 轨道是 `clamp(min, width, max)` 算出来的，任何越界的 width 都会被夹回区间里，
    // 所以包含关系恒真（§7 元规则 2："一条永远通过的判据比没有判据更糟"）。
    // 换成等值判据之后它才有牙：把轨道写成字面量（绕过 token）就红。
    const min = await pxOfCssVar(page, '--ht-layout-detail-min-width');
    const max = await pxOfCssVar(page, '--ht-layout-detail-max-width');
    const want = await pxOfCssVar(page, '--ht-layout-detail-width');
    expect(min, 'token 区间退化（min>=max），等值判据会被夹取掩盖').toBeLessThan(max);
    expect(
      want,
      'token 默认值本身不在区间内 —— 那 clamp 会静默改掉设计意图，等值判据量的就不是它了',
    ).toBeGreaterThan(min);
    expect(want).toBeLessThan(max);
    expect(
      detail.width,
      `详情列宽 ${String(detail.width)} 不等于 token 的 ${String(want)} —— 轨道没走 token？`,
    ).toBeCloseTo(want, 0);
    // 分母自检：列宽必须真的是"一栏"的量级，而不是 0 宽度被别的什么兜住。
    expect(detail.width).toBeGreaterThan(100);

    await page.screenshot({ path: SHOT('desktop-with-detail') });
    expect(errors, `界面里有控制台错误：\n${errors.join('\n')}`).toEqual([]);
  });

  test('没有范围列的那一档（两轨声明）里它同样贴边、同样走 token', async ({ page }) => {
    const errors = watchErrors(page);
    await openApp(page, '/?lang=zh-CN');

    /* 🔴 这条用例是**变异臂 M2 存活之后**补的，不是装饰。
       上一版两条用例都停在任务视图，而任务视图带侧栏 ⇒ 生效的是
       `.ht-app--with-sidebar` 那条**四轨**声明；`.ht-app` 自己那条两轨声明
       （四象限/习惯/番茄钟/时间线… 走的路径）**一个字节都没被量过**。
       把轨道改成字面量 `24rem` 只动两轨那一行 ⇒ 两条用例全绿（实测 2 passed）。
       "两条判据都绿"当时被读成"宽度判据有牙"，其实量的是同一行声明两遍。 */
    const shell = page.locator('.ht-app').first();
    // 2026-10-06：从「四象限」改成「习惯」。改的**不是**这条判据要量的那一行声明
    // （两轨、无范围列 —— 下面那条 `not.toMatch(/ht-app--with-sidebar/)` 仍在原地盯着），
    // 而是"这一栏得先有东西可画"：详情列现在没内容就不占位（工单 H10 第一刀），
    // 而习惯面单是**始终挂载**的那一枚（`App.tsx` 里那句"没选中时它仍然挂载"）。
    await switchView(page, '习惯');
    // 切换与前提**同一件事**：这一面必须丢掉 `--with-sidebar`，
    // 否则量的又是四轨那行，这条用例等于把上一条复制一遍。
    await expect
      .poll(() => shell.getAttribute('class'), { message: '切到四象限后壳仍带着范围列' })
      .not.toMatch(/ht-app--with-sidebar/);

    const viewport = page.viewportSize();
    expect(viewport, '量不到视口尺寸，右边缘判据不成立').not.toBeNull();
    const vw = (viewport as { width: number }).width;
    expect(vw, '测试视口太窄，落进了详情列不出现的档位').toBeGreaterThanOrEqual(1024);

    const detail = await box(page, 'detail-column');
    expect(
      Math.abs(detail.x + detail.width - vw),
      `两轨视图里详情列右边缘 ${String(detail.x + detail.width)} 没贴到视口右边 ${String(vw)}`,
    ).toBeLessThanOrEqual(1);

    const want = await pxOfCssVar(page, '--ht-layout-detail-width');
    expect(
      detail.width,
      `两轨视图里详情列宽 ${String(detail.width)} 不等于 token 的 ${String(want)} —— 两轨那条声明没走 token？`,
    ).toBeCloseTo(want, 0);

    await parkCursor(page);
    await page.screenshot({ path: SHOT('no-sidebar-view') });
    expect(errors, `界面里有控制台错误：\n${errors.join('\n')}`).toEqual([]);
  });

  test('窄的两档（平板横屏 / 塌缩态）里它不出现', async ({ page }) => {
    await openApp(page, '/?lang=zh-CN');

    // 🔴 前置（2026-10-06 工单 H10 第一刀之后新增）：详情列现在"没东西可画就不占位"，
    // 所以这一栏"在不在 / 多宽 / 贴不贴边"的判据必须跑在有内容的那一档。
    // 下面每一条断言逐字未动 —— 动的只有前置这一步，判据口径不变。
    await showDetailColumnContent(page);

    // 769–1023：rail + 侧栏 + 详情已经吃掉 ~41rem，中间列会被挤没 ⇒ 这一档不出现。
    await page.setViewportSize({ width: 900, height: 800 });
    await expect(
      page.getByTestId('detail-column'),
      '900px 档里详情列仍占位置 —— 中间那一列（任务列表）会被挤掉',
    ).toBeHidden();

    // ≤768：单列 + 底部导航，竖列没有语义。
    await page.setViewportSize({ width: 700, height: 800 });
    await expect(page.getByTestId('detail-column'), '塌缩态里详情列仍在').toBeHidden();

    // 回到桌面档必须又出现：否则上一条只是"它从来没渲染过"。
    await page.setViewportSize({ width: 1280, height: 800 });
    await expect(
      page.getByTestId('detail-column'),
      '回到桌面档后详情列没回来 —— 那"窄屏隐藏"两条只是恒真',
    ).toBeVisible();
    await page.screenshot({ path: SHOT('back-to-desktop') });
  });
});
