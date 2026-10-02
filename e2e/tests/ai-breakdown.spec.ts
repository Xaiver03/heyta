/**
 * 真实用户旅程：AI 拆解（breakdown）
 * =====================================
 *
 * 这条用例补的是"每一段都绿、接起来断"的洞：组件的单测挂的是假 `fetch`，
 * 而这里从**空白浏览器状态**开始，全部点真界面 —— 真 DOM、真 IndexedDB、
 * 真 op-log、真 `fetch` 打到假端点，并用 `/__requests` 自证请求真的发出去了。
 *
 * 覆盖的判据：
 *   1. 披露（只算不发）—— 打开面板时假端点计数必须还是 0
 *   2. 发送 → 真请求，且 `feature === 'breakdown'`
 *   3. 结果渲染 → 逐条取舍 → 写入备注
 *   4. 刷新页面后备注仍在（落的是 op-log，不是内存状态）
 */

import { expect, test } from '@playwright/test';

import {
  addTask,
  CAP_LONG_CONTEXT,
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

test.describe('AI 拆解：真浏览器端到端旅程', () => {
  test('配置端点 → 建任务 → 披露 → 真请求 → 取舍 → 写入备注 → 刷新后仍在', async ({
    page,
    request,
  }) => {
    await resetStub(request);
    await openApp(page, '/', 'accepted');

    // ══ 1. 通过设置界面配置端点 ════════════════════════════════════════
    // 🔴 拆解需要 `structured_output` **和** `long_context`
    // （`DEFAULT_FEATURE_CAPABILITIES`）。少勾一个，候选会被能力过滤掉 ——
    // 界面会显示"没有配置端点"，而那其实不是没配，是缺能力。
    await configureEndpoint(page, {
      capabilities: [CAP_STRUCTURED_OUTPUT, CAP_LONG_CONTEXT],
      features: ['breakdown'],
    });
    await switchView(page, '任务');

    // ══ 2. 建一条任务（走真 CaptureComposer → op-log）══════════════════
    await addTask(page, '把新版本发到生产环境');

    const openButton = page.locator('[data-testid^="ai-breakdown-"]');
    await expect(openButton).toBeVisible();

    // ══ 3. 打开披露：这一下**只算不发** ════════════════════════════════
    await openButton.click();
    await expect(page.locator('[data-testid="ai-disclosure"]')).toBeVisible();
    await expect(page.locator('[data-testid="ai-destination"]')).toContainText(STUB_ENDPOINT);
    // 回环端点 = 数据不出设备（`classifyDestination` 判为 none）。
    await expect(page.locator('[data-testid="ai-destination-kind"]')).toHaveText(
      '数据不出设备',
    );
    // 还没写备注 → 只送标题这一个字段。
    await expect(page.locator('[data-testid="ai-field-list"]')).toHaveText('title');
    // 🔴 这一步是"披露 = 只算不发"的可失败检查。
    await expectNoStubCall(request);

    // ══ 4. 发送 → 真网络请求 ═══════════════════════════════════════════
    await page.locator('[data-testid="ai-send"]').click();
    await expect(page.locator('[data-testid="ai-proposal"]')).toBeVisible();

    const log = await waitForStubCalls(request, 1);
    expect(log.calls[0]?.feature, '系统提示词首句应该路由到 breakdown').toBe('breakdown');

    // ══ 5. 看到结果（假端点固定回 4 行 `- ` 清单）══════════════════════
    await expect(page.locator('[data-testid="ai-items"] li')).toHaveCount(4);
    await expect(page.locator('[data-testid="ai-kept-count"]')).toHaveText('4');
    await expect(page.locator('[data-testid="ai-proposal-source"]')).toHaveText('来自本机');

    // ══ 6. 逐条取舍：去掉第一条 ═════════════════════════════════════════
    await page.locator('[data-testid="ai-item-0"]').uncheck();
    await expect(page.locator('[data-testid="ai-kept-count"]')).toHaveText('3');

    // ══ 7. 应用到数据（经 store.setNote → op-log）═══════════════════════
    await page.locator('[data-testid="ai-apply"]').click();
    await expect(page.locator('[data-testid^="ai-applied-"]')).toHaveText('已写入备注');

    // ══ 8. 刷新：断言备注真的落库 ══════════════════════════════════════
    // 备注本身在列表里不渲染，所以用**用户看得见的披露字段**来反证它非空：
    // 有备注 → 字段列表变成 `title、note`；没落库则仍是 `title`。
    await page.reload();
    await expect(rowFor(page, '把新版本发到生产环境')).toBeVisible();
    await page.locator('[data-testid^="ai-breakdown-"]').click();
    await expect(page.locator('[data-testid="ai-field-list"]')).toHaveText('title、note');

    // 刷新+重新打开面板**仍然没有发送**（只有按"发送"才发）。
    await expectStubCount(request, 1);
  });
});
