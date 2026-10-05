/**
 * 真实用户旅程：AI 耗时估计（duration-estimate）
 * ================================================
 *
 * 估时比拆解多一条界面义务：**必须显示"我凭什么估这个数"**
 * （`duration-basis-none` / `duration-basis-history`）。一个错的分钟数
 * 看起来和正确的一模一样，所以这条断言不是装饰。
 *
 * 结果写进备注（`writeDurationIntoNote`），不新增持久化字段 ——
 * 所以"落库"的可见证据是刷新后披露字段里出现 `note`。
 *
 * 第二条用例走**失败 + 手动兜底**：端点连不上时界面要给具体原因，
 * 并提供一个不依赖 AI 的退路，且那条退路也要真的写进数据。
 */

import { expect, test } from '@playwright/test';

import {
  addTask,
  CAP_STRUCTURED_OUTPUT,
  configureEndpoint,
  expectNoStubCall,
  expectStubCount,
  openApp,
  resetStub,
  rowFor,
  STUB_ENDPOINT,
  switchView,
  waitForStubCalls,
} from './helpers.js';

/** 没有任何东西监听的端口 —— 用来制造一次真实的连接失败。 */
const DEAD_ENDPOINT = 'http://127.0.0.1:4317/v1';

test.describe('AI 耗时估计：真浏览器端到端旅程', () => {
  test('配置 → 建任务 → 披露（含依据）→ 真请求 → 应用 → 写入备注 → 刷新后仍在', async ({
    page,
    request,
  }) => {
    await resetStub(request);
    await openApp(page, '/', 'accepted');

    await configureEndpoint(page, {
      capabilities: [CAP_STRUCTURED_OUTPUT],
      features: ['duration-estimate'],
    });
    await switchView(page, '任务');

    await addTask(page, '重构同步引擎的冲突解决');

    // ══ 1. 披露：只算不发，且**发送前**就要说明依据 ════════════════════
    const openButton = page.locator('[data-testid^="duration-run-"]');
    await expect(openButton).toBeVisible();
    await openButton.click();

    await expect(page.locator('[data-testid="duration-disclosure"]')).toBeVisible();
    await expect(page.locator('[data-testid="duration-destination"]')).toContainText(
      STUB_ENDPOINT,
    );
    await expect(page.locator('[data-testid="duration-field-list"]')).toHaveText('today、title');
    // 🔴 没有历史/偏好时必须**如实说**，不许假装懂。
    await expect(page.locator('[data-testid="duration-basis-none"]')).toContainText(
      '没有可用的历史数据',
    );
    await expectNoStubCall(request);

    // ══ 2. 发送 → 真请求 ═══════════════════════════════════════════════
    await page.locator('[data-testid="duration-send"]').click();
    await expect(page.locator('[data-testid="duration-proposal"]')).toBeVisible();

    const log = await waitForStubCalls(request, 1);
    expect(log.calls[0]?.feature, '系统提示词首句应该路由到 duration-estimate').toBe(
      'duration-estimate',
    );

    // ══ 3. 看到结果（假端点固定回 "90"）════════════════════════════════
    await expect(page.locator('[data-testid="duration-proposal-minutes"]')).toHaveText('90');

    // ══ 4. 应用（经 store.setNote → op-log）════════════════════════════
    await page.locator('[data-testid="duration-apply"]').click();
    await expect(page.locator('[data-testid^="duration-applied-"]')).toHaveText('已写入耗时');

    // ══ 5. 刷新：断言备注真的落库 ══════════════════════════════════════
    await page.reload();
    await expect(rowFor(page, '重构同步引擎的冲突解决')).toBeVisible();
    await page.locator('[data-testid^="duration-run-"]').click();
    await expect(page.locator('[data-testid="duration-field-list"]')).toHaveText('today、title、note');
    // 重新打开面板不算发送。
    await expectStubCount(request, 1);
  });

  test('端点连不上：给出失败原因 + 手动兜底，兜底结果也落库', async ({ page, request }) => {
    await resetStub(request);
    await openApp(page, '/', 'accepted');

    await configureEndpoint(page, {
      capabilities: [CAP_STRUCTURED_OUTPUT],
      features: ['duration-estimate'],
      endpoint: DEAD_ENDPOINT,
    });
    await switchView(page, '任务');

    await addTask(page, '整理季度预算表');

    await page.locator('[data-testid^="duration-run-"]').click();
    await expect(page.locator('[data-testid="duration-disclosure"]')).toBeVisible();
    await page.locator('[data-testid="duration-send"]').click();

    // ══ 失败态：具体原因 + 手动退路 ════════════════════════════════════
    await expect(page.locator('[data-testid="duration-failed"]')).toBeVisible();
    await expect(page.locator('[data-testid="duration-failure-message"]')).not.toBeEmpty();
    await expect(page.locator('[data-testid="duration-manual-input"]')).toBeVisible();
    // 打的是 4317，不该碰到假端点（4319）。
    await expectNoStubCall(request);

    // ══ 手动兜底：用户自己填一个数（不是 AI 生成物）════════════════════
    await page.locator('[data-testid="duration-manual-input"]').fill('45');
    await page.locator('[data-testid="duration-manual-apply"]').click();
    await expect(page.locator('[data-testid^="duration-applied-"]')).toHaveText('已写入耗时');

    await page.reload();
    await expect(rowFor(page, '整理季度预算表')).toBeVisible();
    await page.locator('[data-testid^="duration-run-"]').click();
    await expect(page.locator('[data-testid="duration-field-list"]')).toHaveText('today、title、note');
    await expectNoStubCall(request);
  });
});
