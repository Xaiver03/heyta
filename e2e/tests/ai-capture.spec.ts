/**
 * 真实用户旅程：AI 一句话捕获（capture）
 * =========================================
 *
 * ## 这条用例曾经是一个"缺口哨兵"
 *
 * `AiCapture` 组件早就写好了（披露 / 可编辑候选 / 逐字段确认都在），
 * 但**一直没有被挂载** —— 所以真浏览器里点不到，端到端旅程做不出来。
 * 当时这条用例断言的是"`capture-ai` 不在 DOM 里"。
 *
 * 🔴 **现在缺口已经补上**，挂载位置不是 `App.tsx` 而是
 * `CaptureComposer`（草稿就是那句话，所以它持有输入框）：
 * `App.tsx` 把 AI 配置透传进去，`CaptureComposer` 在
 * `routing !== undefined && draft.trim() !== ''` 时渲染 `AiCapture`。
 * 于是这条哨兵"兑现"了：它翻面成一条**正面旅程**。
 *
 * ## 它验的是什么
 *
 *   1. 有草稿时才出现入口（空输入框不渲染一个注定失败的按钮）
 *   2. 披露（只算不发）—— 打开面板时假端点计数必须还是 0
 *   3. 发送 → 真请求，且 `feature === 'capture'`
 *   4. 结果字段**可编辑**，且假端点**故意不给 dueDate** 时日期留空（不许替它猜）
 *   5. 应用 → 任务真的建出来（走的是和回车**完全相同**的 `addTask` → op-log）
 *   6. 输入框被清空、刷新后任务仍在
 */

import { expect, test } from '@playwright/test';

import {
  CAP_STRUCTURED_OUTPUT,
  configureEndpoint,
  expectNoStubCall,
  expectStubCount,
  metaFor,
  openApp,
  resetStub,
  rowFor,
  STUB_ENDPOINT,
  switchView,
  waitForStubCalls,
} from './helpers.js';

/** 假端点固定回的标题（`stub-provider.mjs` 的 `respond('capture')`）。 */
const STUB_CAPTURE_TITLE = '修复登录页在 Safari 上的错位';

/** 输入框里那句"用户想捕获的话"。刻意用规则解析接不住的表达。 */
const DRAFT = '把登录页在 Safari 上的错位修掉';

test.describe('AI 一句话捕获：真浏览器端到端旅程', () => {
  test('配置端点 → 输入一句话 → 披露 → 真请求 → 看到可编辑结果 → 应用 → 任务落库', async ({
    page,
    request,
  }) => {
    await resetStub(request);
    await openApp(page);

    await configureEndpoint(page, {
      capabilities: [CAP_STRUCTURED_OUTPUT],
      features: ['capture'],
    });
    await switchView(page, '任务');

    const composer = page.locator('input[placeholder^="添加任务"]');

    // ══ 1. 空输入框不渲染入口（避免"注定失败"的按钮）═══════════════════
    await expect(page.locator('[data-testid="capture-ai"]')).toHaveCount(0);

    // ══ 2. 打上字，入口才出现 ═══════════════════════════════════════════
    await composer.fill(DRAFT);
    const captureButton = page.locator('[data-testid="capture-ai"]');
    await expect(captureButton).toBeVisible();
    await expectNoStubCall(request); // 只是打字，不可能有请求

    // ══ 3. 打开披露：只算不发 ═══════════════════════════════════════════
    await captureButton.click();
    await expect(page.locator('[data-testid="capture-disclosure"]')).toBeVisible();
    await expect(page.locator('[data-testid="capture-text-preview"]')).toContainText(DRAFT);
    await expect(page.locator('[data-testid="capture-destination"]')).toContainText(
      STUB_ENDPOINT,
    );
    // "今天"要送出去 —— 模型才能**推算**而不是**回忆**日期。
    await expect(page.locator('[data-testid="capture-field-list"]')).toHaveText('today、text');
    await expectNoStubCall(request);

    // ══ 4. 发送 → 真请求 ═══════════════════════════════════════════════
    await page.locator('[data-testid="capture-send"]').click();
    await expect(page.locator('[data-testid="capture-proposal"]')).toBeVisible();

    const log = await waitForStubCalls(request, 1);
    expect(log.calls[0]?.feature, '系统提示词首句应该路由到 capture').toBe('capture');

    // ══ 5. 结果：标题/优先级是模型给的，且**可以改** ════════════════════
    await expect(page.locator('[data-testid="capture-title"]')).toHaveValue(STUB_CAPTURE_TITLE);
    await expect(page.locator('[data-testid="capture-priority"]')).toHaveValue('high');
    // 🔴 假端点**故意不给 dueDate**。界面必须留空，而不是替它补一个今天/零点。
    await expect(page.locator('[data-testid="capture-due-date"]')).toHaveValue('');
    await expect(page.locator('[data-testid="capture-due-time"]')).toHaveValue('');
    await expect(page.locator('[data-testid="capture-dropped"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="capture-proposal-source"]')).toHaveText('来自本机');

    // ══ 6. 应用 → 真的建出一条任务 ═════════════════════════════════════
    await page.locator('[data-testid="capture-apply"]').click();

    await expect(rowFor(page, STUB_CAPTURE_TITLE)).toBeVisible();
    // high = Priority.High = 3 → 列表上的 P3 徽标。
    // 🔴 用 `toHaveText('P3')` 而不是 `toContainText`：没有 dueDate 时
    // 元信息区里应当**只有**这个徽标（"不确定就省略"）。
    await expect(metaFor(page, STUB_CAPTURE_TITLE)).toHaveText('P3');

    // 应用后输入框被清空 —— 与按回车是同一种结果（否则容易建出重复任务）。
    await expect(composer).toHaveValue('');
    await expect(page.locator('[data-testid="capture-ai"]')).toHaveCount(0);

    // ══ 7. 刷新：任务仍在（落的是 op-log，不是内存状态）═════════════════
    await page.reload();
    await expect(rowFor(page, STUB_CAPTURE_TITLE)).toBeVisible();
    await expect(metaFor(page, STUB_CAPTURE_TITLE)).toHaveText('P3');
    await expectStubCount(request, 1);
  });
});
