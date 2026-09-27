import { expect, test } from '@playwright/test';
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
    await expect(page.getByRole('tab')).toHaveCount(8);
  });

  test('假端点活着，且计数接口可用', async ({ request }) => {
    await request.get('http://127.0.0.1:4319/__reset');
    const res = await request.get('http://127.0.0.1:4319/__requests');
    expect(res.ok()).toBe(true);

    const body = (await res.json()) as { count: number };
    expect(body.count).toBe(0);
  });
});
