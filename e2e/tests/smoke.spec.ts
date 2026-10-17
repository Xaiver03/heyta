import { expect, test } from '@playwright/test';
import { STUB_ORIGIN } from '../ports';
import { openApp } from './helpers';

/**
 * 冒烟：先证明"真浏览器 + 真应用 + 真假端点"这条链路本身是通的。
 *
 * 🔴 这条用例存在的意义不是覆盖率，而是**失败归因**。
 * 一旦门禁红了，第一件事是分清"功能坏了"还是"环境坏了" ——
 * 如果这条也红，问题在环境（端口、构建、浏览器），不必去读功能代码。
 *
 * ⚠️ 因此它**必须走与其它用例完全相同的启动路径**（`openApp`，其中包含
 * 缺失生产者的垫片）。第一版这里写的是裸 `page.goto('/')`，于是它因为
 * "模块图里有名字不存在"而红 —— 那既不是环境问题也不是功能问题，
 * **恰好毁掉了这条用例唯一的作用**：把归因指向错误的方向。
 */
test.describe('冒烟：验收链路本身', () => {
  test('真浏览器能打开真应用', async ({ page }) => {
    await openApp(page);

    // 用真实可见元素断言，而不是断言 `document` 存在 ——
    // 后者在白屏时也会通过。`openApp` 内部已经断言了输入框可见，
    // 这里再断言一次外壳标题，证明**应用骨架**也起来了（不只是那个输入框）。
    await expect(page.locator('input[placeholder^="添加任务"]')).toBeVisible();
    // 冒烟走 `openApp`（默认打开全部模块）。
    // W1（2026-10-06，审计 §3.2-1）：rail 从"平铺 11 tab"收敛为「主段 4 + 更多」，
    // tablist 里 = 主段 4 + 工具段（回收站）= **5**；其余 6 个目的地在「更多」菜单
    // （role=menuitem，不是 tab）。「默认只开几个模块」由 `motivation.spec.ts` 专门钉。
    // ⚠️ rail 形状的逐字契约（含菜单序）在 `motivation.spec.ts`，这里只钉"骨架在"。
    //
    // 🔴 2026-10-17 改口：原来这条数的是 `.ht-rail__tabs button[role="tab"]:not(.ht-rail__tab--tool)`，
    // 期望 4、现量 **5** —— 多出来的那枚是**助手入口**（`RailNavigation.tsx:452`，
    // `data-testid="rail-assistant"`），它的 class 只有 `ht-rail__tab`：既没有 `--tool`、
    // 也没有别的修饰类 ⇒ 被那条 `:not(--tool)` 当成"主段的一枚"数了进去。
    // 判据的本义是"**主段 4 个 section**"，所以改成按主段**自己的 testid 命名空间**数
    // （主段每枚都是 `rail-view-<key>`，见 `RailNavigation.tsx:111`；工具段那几枚带 `--tool`），
    // 并把这枚助手入口**显式**钉住 —— 它正是被误数进来的那一枚，写出来才不会下次又滑进去。
    await expect(
      page.locator('.ht-rail__tabs [data-testid^="rail-view-"]:not(.ht-rail__tab--tool)'),
      '主段 section tab 应当恰好 4 枚',
    ).toHaveCount(4);
    await expect(
      page.locator('.ht-rail__tabs [data-testid="rail-assistant"]'),
      '助手入口是独立的一枚（它不是 section tab，别被算进主段）',
    ).toHaveCount(1);
    await expect(page.locator('.ht-rail__more button')).toBeVisible();
    await expect(page.getByRole('tab', { name: '回收站' })).toHaveCount(1);
  });

  test('假端点活着，且计数接口可用', async ({ request }) => {
    await request.get(`${STUB_ORIGIN}/__reset`);
    const res = await request.get(`${STUB_ORIGIN}/__requests`);
    expect(res.ok()).toBe(true);

    const body = (await res.json()) as { count: number };
    expect(body.count).toBe(0);
  });
});
