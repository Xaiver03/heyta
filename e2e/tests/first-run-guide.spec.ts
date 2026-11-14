/**
 * 首启引导（桌面 / web）—— 真浏览器判据
 * =======================================
 *
 * ## 它补的是 jsdom 证不了的那一段
 *
 * `apps/web/tests/first-run-guide.spec.tsx` 只证"组件在给定 props 下画出什么"。
 * 真正要证的是**跨三个文件的接线**：空态点示例 → App 的 state → 共享
 * `CaptureComposer` 的 `fillRequest` → 输入框真的被填上 → 识别芯片出现 →
 * 回车建出任务 → 引导不再出现。这条链 jsdom 跑不动（要拖起 op-log + IndexedDB），
 * 而它恰好是最容易断的地方（漏传一个 prop 就静默失效）。
 *
 * ## 为什么"芯片必须出现"是承重断言
 *
 * `@heyta/domain#parseCapture` 的文件头第 2 条要求：**调用方必须把 `matches`
 * 展示给用户确认**，否则误报会变成静默的数据改写。如果引导走的是"直接建任务"，
 * 这条断言会红 —— 而那是这个功能最坏的一种实现方式（看起来更好用，实际在改用户的字）。
 *
 * ## 反向臂（这份 spec 会不会红）
 *
 * · 把 `App.tsx` 里 `fillRequest={firstRunFill}` 删掉 ⇒ T1 在"输入框被灌进原文"那一步红
 * · 把 `onFillDraft` 里的 `markFirstRunSeen()` 删掉 ⇒ T1 末尾"刷新后不再出现"红
 * · 把 `EmptyState` 的 `firstRun === undefined ? null :` 去掉 ⇒ T2 的 `toHaveCount(0)` 红
 */
import { expect, test } from '@playwright/test';

import { openApp } from './helpers';

test.describe('首启引导', () => {
  test('首启出现 → 点示例灌进输入框 → 芯片确认 → 回车建出任务 → 刷新后不再出现', async ({ page }) => {
    await openApp(page);

    const guide = page.getByTestId('first-run');
    await expect(guide).toBeVisible();

    await page.getByTestId('first-run-example-1').click();

    // ① 字真的进了输入框（`fillRequest` 那一环）。
    const input = page.getByTestId('capture-input');
    await expect(input).toHaveValue('明天下午3点 给客户回邮件');

    // ② 解析结果必须被界面说出来 —— 引导不许绕过"把 matches 给用户确认"这条契约。
    //    常驻在输入框右侧的是**日期胶囊**（`capture-due-capsule-value`），
    //    不是 `capture-chip-value`（那一枚只在截止面板展开时才存在）。
    const capsule = page.getByTestId('capture-due-capsule-value').first();
    await expect(capsule).toBeVisible();
    await expect(capsule).not.toHaveText('');

    // ③ 点过示例就算"看过"，引导收起。
    await expect(guide).toHaveCount(0);

    // ④ 回车真的建出任务，且标题是解析后的那一段（日期被吃掉）。
    await input.press('Enter');
    await expect(page.getByTestId('task-list').getByText('给客户回邮件')).toBeVisible();

    // ⑤ 刷新后不再出现。
    //    ⚠️ 这一步**只证"不重复打扰"**，不证"标记落盘" —— 因为此刻收集箱里
    //    已经有任务，空态压根不渲染。真正的落盘判据在 T2（那里刷新后仍是空收集箱）。
    await page.reload();
    await expect(page.locator('input[placeholder^="添加任务"]')).toBeVisible();
    await expect(page.getByTestId('first-run')).toHaveCount(0);
  });

  test('点「先自己写」也标记看过，且输入框不被填充', async ({ page }) => {
    await openApp(page);
    await expect(page.getByTestId('first-run')).toBeVisible();

    await page.getByTestId('first-run-dismiss').click();
    await expect(page.getByTestId('first-run')).toHaveCount(0);
    // 出口只关引导，不替用户写字。
    await expect(page.getByTestId('capture-input')).toHaveValue('');

    // 🔴 这一条才是"标记落盘"的判据：刷新后收集箱**仍然是空的**，
    //    所以"引导不出现"只可能来自 `firstRunSeen`，不可能来自"空态没渲染"。
    await page.reload();
    await expect(page.locator('input[placeholder^="添加任务"]')).toBeVisible();
    await expect(page.getByTestId('first-run')).toHaveCount(0);
  });
});
