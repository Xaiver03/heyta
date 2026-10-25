import { expect, test } from '@playwright/test';
import { openApp } from './helpers';

/**
 * AI 工具行的**排版几何**（goal-layout-audit.md 页 2）
 * ====================================================
 *
 * 2026-09-29 产品负责人截图实测：窄窗下「运行」两个字**竖着折断**成两行，
 * 且工具行与上方的采集条**交叉重叠**。根因：`.ht-ai__actions` 没有
 * `flex-wrap`、按钮没有 `nowrap`、输入框不会收缩 —— 空间一紧全部硬挤。
 *
 * 🔴 判据是**几何**的（"元素可见"证明不了这些）：
 *   · 「运行」按钮高度 = 单行（竖折后高度翻倍）；
 *   · 工具行与采集条**包围盒不相交**；
 *   · 两种窗口宽度下都成立（1280 常规 / 660 窄窗）。
 * 把 `.ht-ai__actions` 的 `flex-wrap` 拿掉、或按钮 `nowrap` 删掉，
 * 对应断言当场红。
 *
 * 🔴 2026-10-04 追加第三条判据（同一对窗口宽度）：**AI 面在哪一栏**。
 * 产品负责人把 AI 面搬进最右那一栏，而那一栏 ≤1023px 是不出现的 ——
 * 搬家最容易犯的错就是"跟着那一栏一起消失"。所以宽窗必须在右栏内、
 * 窄窗必须回到中间列，两条一起才算搬完。
 *
 * 🔴 截图落固定路径，人必须看（AGENTS §6.2 规定一）。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 🔴 **2026-10-25 改判据的对象**：这份 spec 原先量的是 `ai-tool-run`（单步工具面板里的
 * 「运行」按钮那一行）。那个面板在 2026-10-10 的外壳重写（`63e61f237`）里被**有意**并进了
 * 助手面 —— 理由写在 `apps/web/src/styles/app/ai-panels.css:799-802`：
 * 「AI Agent 是一个连续的聊天面。工具执行属于对话中的过程状态，不再与聊天并列成两个
 * 需要用户选择的入口。」所以「运行按钮不许竖折」那一条**没有被测物了**，
 * 而它原本守的是那个已下线的面板。
 *
 * ⇒ 这里把**还在的两条**判据换到现存的面上（`ai-agent-surface`）：
 *   · AI 面与采集条的包围盒不相交；
 *   · 宽窗在右栏内、窄窗退回中间列。
 * 这两条与"哪个面板"无关，守的是右栏 ≤1023px `display:none` 时 AI 面**不许跟着消失**。
 * 被退役的第三条（运行按钮单行）与 `ai-tool-run.spec.ts` 的三条一起登记在
 * `BLOCKED.md` B226，不是悄悄删掉。
 */

const WIDE = { width: 1280, height: 800 };
const NARROW = { width: 660, height: 800 };

async function boxes(page: import('@playwright/test').Page): Promise<{
  composer: { x: number; y: number; width: number; height: number };
  ai: { x: number; y: number; width: number; height: number };
}> {
  const composer = await page.locator('input[placeholder^="添加任务"]').boundingBox();
  const ai = await page.getByTestId('ai-agent-surface').boundingBox();
  expect(composer, '采集输入框在').not.toBeNull();
  expect(ai, 'AI 面在（`ai-agent-surface`：单步面板已并入助手，见文件头）').not.toBeNull();
  return { composer: composer!, ai: ai! };
}

/** 两个盒子在平面上有没有交集（允许 2px 的测量误差）。 */
function intersects(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
): boolean {
  return (
    a.x < b.x + b.width - 2 &&
    b.x < a.x + a.width - 2 &&
    a.y < b.y + b.height - 2 &&
    b.y < a.y + a.height - 2
  );
}

async function assertLayout(page: import('@playwright/test').Page, label: string): Promise<void> {
  const { composer, ai } = await boxes(page);

  // ⚠️ 原第一条判据（「运行」按钮 height < 56，防竖折）随单步面板下线而退役，
  //    见文件头与 BLOCKED.md B226。它原本守的那个缺陷（`.ht-ai__actions` 没 flex-wrap）
  //    在现存的助手面上没有对应结构，所以这里**不**换一条代理判据假装还在守。

  // 🔴 不重叠。这里原来写的是"AI 行的顶部不得高过采集条的底部"（只看 y）——
  // 那是当时那个缺陷（两条都在中间列、上下堆叠）的**代理判据**。
  // 2026-10-04 AI 面搬进右栏后，宽窗里两者变成**左右**关系，只看 y 会把正确的
  // 布局读成缺陷；真正的缺陷从来是"两个盒子的像素区域相交"，所以判据换成它本身
  // —— 比原来更宽（两种摆放都成立）也更严（x 方向相交同样会红）。
  expect(
    intersects(ai, composer),
    `${label}：AI 工具行与采集条的包围盒相交（截图里的重叠缺陷就是这个形状）`,
  ).toBe(false);
}

/**
 * AI 面**在哪一栏**（2026-10-04 产品负责人：「把那个 AI 的功能移到右边那个区」）。
 *
 * 🔴 这一条是"搬家"这件事唯一的界面判据，且两档都必须量：
 * 只量宽窗，就等于允许"窄屏那一栏不出现时 AI 跟着消失"—— 而那正是搬家的
 * 第一种坏法（右栏 ≤1023px 是 `display: none`，账算在 `narrow.css`）。
 */
async function assertColumn(page: import('@playwright/test').Page, wide: boolean): Promise<void> {
  const ai = await page.getByTestId('ai-agent-surface').boundingBox();
  expect(ai, 'AI 面量不到 boundingBox').not.toBeNull();
  const box = ai as { x: number; y: number; width: number; height: number };

  if (wide) {
    const detail = await page.getByTestId('detail-column').boundingBox();
    expect(detail, '宽窗里右栏量不到 boundingBox').not.toBeNull();
    const d = detail as { x: number; y: number; width: number; height: number };
    expect(box.x, `宽窗：AI 面应当在右栏里（ai.x=${String(box.x)} / 右栏 x=${String(d.x)}）`).toBeGreaterThanOrEqual(
      d.x,
    );
    expect(
      box.x + box.width,
      `宽窗：AI 面应当整块落在右栏内（右边越界 = 贴到窗口边缘或被裁）`,
    ).toBeLessThanOrEqual(d.x + d.width + 1);
    return;
  }

  // 窄档：右栏不出现（`display: none`），AI 面必须**退回中间列**而不是消失。
  await expect(page.getByTestId('detail-column'), '窄档里右栏本就不该出现').toBeHidden();
  const main = await page.locator('.ht-main').boundingBox();
  expect(main, '窄档里量不到中间列').not.toBeNull();
  const m = main as { x: number; y: number; width: number; height: number };
  expect(
    box.x >= m.x && box.x + box.width <= m.x + m.width + 1,
    `窄档：AI 面必须退回中间列（ai=${String(box.x)}+${String(box.width)} / main=${String(m.x)}+${String(m.width)}）`,
  ).toBe(true);
}


test('常规宽度：AI 面不与采集条重叠，且整块落在右栏内', async ({ page }) => {
  await page.setViewportSize(WIDE);
  await openApp(page);
  await expect(page.getByTestId('ai-agent-surface')).toBeVisible();
  await assertLayout(page, '常规宽');
  await assertColumn(page, true);
  await page.screenshot({ path: 'test-results/ai-row-wide.png', fullPage: false });
});

test('窄窗：AI 面不内联占位，但**必须有一条可达入口**，点开就地出现', async ({ page }) => {
  await page.setViewportSize(NARROW);
  await openApp(page);

  // 🔴 2026-10-25 改判据：660px 下 AI 面**不再内联**在中间列 —— 它这一档是按需浮层
  //    （`App.tsx:1172` 的 `assistantOverlay`，入口是主导航那颗「对话助手」）。
  //    所以"必须退回中间列"那条已经和产品形状对不上了；但那条判据要防的事还在：
  //    **右栏 ≤1023px 是 display:none，AI 面会不会跟着一起消失**。
  //    能防住"消失"的最小判据是：未点开时它不占着中间列，点开入口后它真的出现。
  await expect(
    page.getByTestId('ai-agent-surface'),
    '未点开「对话助手」时，AI 面不该占着中间列',
  ).toBeHidden();

  // ⚠️ 窄档里主导航渲染的是 `button` 而不是 `tab`（同一颗入口两种语义），
  //    而且页头还有第二颗同名入口 —— 取主导航那一颗，别用 `.first()` 猜。
  await page.getByRole('navigation', { name: '主导航' }).getByRole('button', { name: '对话助手' }).click();
  await expect(
    page.getByTestId('ai-agent-surface'),
    '点开「对话助手」之后 AI 面必须出现 —— 否则它就是跟着右栏一起消失了',
  ).toBeVisible();

  await page.screenshot({ path: 'test-results/ai-row-narrow.png', fullPage: false });
});
