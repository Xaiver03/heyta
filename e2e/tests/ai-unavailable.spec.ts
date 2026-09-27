/**
 * 反向旅程：AI **不可用**时不该发任何请求，而且界面要说清为什么
 * ==================================================================
 *
 * 这是这套验收里最容易漏、也最重要的方向：
 *
 *   出厂状态是**四道闸全关 + 零端点 + 零路由**
 *   （`defaultAiSettings()`）。"点了没反应"与"点了说明原因"
 *   是两件完全不同的事，而"悄悄发出去了"是这一块最不可接受的失败。
 *
 * 🔴 判定方式始终是**读假端点的 `/__requests`**：`count === 0`
 * 才算"真的没发"。只断言界面文案是不够的 —— 界面可以正确地说"不可用"，
 * 而代码仍然在后台发了一枪。
 *
 * ⚠️ **远端授权链路（`consent-*`）在本套件里验不到**：假端点必须在回环
 * 地址上（`127.0.0.1`），而回环被 `classifyDestination` 判为"数据不出设备"，
 * 根本不需要授权；而远端明文 http 会被 `validateEndpointUrl` 以
 * `plaintext-remote` 拒绝、https 又接不到这个 stub。这一段如实记为未覆盖。
 */

import { expect, test } from '@playwright/test';

import {
  addTask,
  CAP_LONG_CONTEXT,
  CAP_STRUCTURED_OUTPUT,
  configureEndpoint,
  disableAiMasterSwitch,
  expectNoStubCall,
  openApp,
  resetStub,
  switchView,
} from './helpers.js';

test.describe('AI 不可用：一次请求都不许发出去', () => {
  test('出厂状态（零配置）：四个入口都说明"还没配端点"，假端点计数为 0', async ({
    page,
    request,
  }) => {
    await resetStub(request);
    await openApp(page);

    // 「优先级建议」只在有任务时出现。
    await addTask(page, '写周报');

    // ── 拆解 ────────────────────────────────────────────────────────────
    await page.locator('[data-testid^="ai-breakdown-"]').click();
    await expect(page.locator('[data-testid="ai-no-target"]')).toContainText(
      '还没有给「拆解任务」配置端点',
    );
    // 这一个 case 才是真正的"没配"：结构与文案必须一起说同一件事。
    await expect(page.locator('[data-testid="ai-no-target"]')).toHaveAttribute(
      'data-route-reason',
      'unconfigured',
    );
    // 没有目标 → 连"发送"按钮都不渲染，物理上不可能发出去。
    await expect(page.locator('[data-testid="ai-send"]')).toHaveCount(0);
    // ⚠️ 没有目标时整个 actions 区都不渲染，所以只剩**头部那个图标按钮**
    // 可以关（它靠 aria-label 取名、没有文字）：用 `:has-text("取消")` 找不到它。
    await page.locator('[data-testid="ai-disclosure"] button[aria-label="取消"]').click();

    // ── 估时 ────────────────────────────────────────────────────────────
    await page.locator('[data-testid^="duration-run-"]').click();
    await expect(page.locator('[data-testid="duration-no-target"]')).toContainText(
      '还没有给「耗时估计」配置端点',
    );
    await expect(page.locator('[data-testid="duration-send"]')).toHaveCount(0);
    await page.locator('[data-testid="duration-disclosure"] button[aria-label="取消"]').click();

    // ── 优先级 ──────────────────────────────────────────────────────────
    await page.locator('[data-testid="prioritize-open"]').click();
    await expect(page.locator('[data-testid="prioritize-no-target"]')).toContainText(
      '还没有给「优先级排序」配置端点',
    );
    await expect(page.locator('[data-testid="prioritize-send"]')).toHaveCount(0);
    await page.locator('[data-testid="prioritize-disclosure-close"]').click();

    // ── 捕获 ────────────────────────────────────────────────────────────
    // ⚠️ 捕获入口只在**输入框有内容**时出现（空输入框不渲染一个注定失败的按钮）。
    await expect(page.locator('[data-testid="capture-ai"]')).toHaveCount(0);
    await page.locator('input[placeholder^="添加任务"]').fill('明天交周报');
    await page.locator('[data-testid="capture-ai"]').click();
    await expect(page.locator('[data-testid="capture-no-target"]')).toContainText(
      '还没有给「一句话捕获」配置端点',
    );
    await expect(page.locator('[data-testid="capture-send"]')).toHaveCount(0);

    await expectNoStubCall(request);
  });

  test('有端点但没给功能指定路由：入口说明原因，计数为 0', async ({ page, request }) => {
    await resetStub(request);
    await openApp(page);

    // 端点加好、能力也勾了，但 `features: []` —— 一个功能都没路由。
    await configureEndpoint(page, {
      capabilities: [CAP_STRUCTURED_OUTPUT, CAP_LONG_CONTEXT],
      features: [],
    });
    await switchView(page, '任务');
    await addTask(page, '把新版本发到生产环境');

    await page.locator('[data-testid^="ai-breakdown-"]').click();
    await expect(page.locator('[data-testid="ai-no-target"]')).toContainText(
      '还没有给「拆解任务」配置端点',
    );
    await expect(page.locator('[data-testid="ai-send"]')).toHaveCount(0);

    await expectNoStubCall(request);
  });

  test('端点缺 long_context：拆解入口说的是「能力没声明」，而不是「没配端点」', async ({
    page,
    request,
  }) => {
    await resetStub(request);
    await openApp(page);

    // 只勾基线能力，却把它路由给需要 `long_context` 的拆解。
    await configureEndpoint(page, {
      capabilities: [CAP_STRUCTURED_OUTPUT],
      features: ['breakdown'],
    });

    // 🔴 设置页必须把"能配、但配了也跑不起来"说出来（否则用户只会觉得 AI 坏了）。
    await expect(page.locator('[data-testid="cap-gap-breakdown"]')).toContainText('长上下文');

    await switchView(page, '任务');
    await addTask(page, '把新版本发到生产环境');

    await page.locator('[data-testid^="ai-breakdown-"]').click();
    const note = page.locator('[data-testid="ai-no-target"]');
    await expect(note).toBeVisible();

    // 🔴🔴 这里配了端点、也配了路由，唯一的问题是**能力没声明**。
    // 说"还没有配置端点"会把用户送去加第二个端点 —— 加了还是不能用。
    await expect(note).toHaveAttribute('data-route-reason', 'capability-missing');
    await expect(note).toContainText('端点没有声明这个功能需要的能力');
    await expect(note).not.toContainText('还没有给「拆解任务」配置端点');

    await expect(page.locator('[data-testid="ai-send"]')).toHaveCount(0);

    await expectNoStubCall(request);

    // ── 「去设置」的最后一米：落在设置页，且能力区块被高亮 ────────────────
    await page.locator('[data-testid="ai-no-target-settings"]').click();
    await expect(page.locator('[data-testid="ai-settings"]')).toBeVisible();
    await expect(page.locator('[data-testid="ai-features-section"]')).toBeVisible();
    await expect(page.locator('[data-testid="ai-features-section"]')).toHaveAttribute(
      'data-focused',
      'true',
    );
  });

  test('总开关关掉后：披露仍在，但点"发送"一次请求都不发，界面给出「AI 未启用」', async ({
    page,
    request,
  }) => {
    await resetStub(request);
    await openApp(page);

    // 先完整配好 —— 证明拦住请求的不是"没配置"，而是**网络层那道总闸**。
    await configureEndpoint(page, {
      capabilities: [CAP_STRUCTURED_OUTPUT],
      features: ['duration-estimate'],
    });
    await disableAiMasterSwitch(page);

    await switchView(page, '任务');
    await addTask(page, '重构同步引擎的冲突解决');

    await page.locator('[data-testid^="duration-run-"]').click();
    await expect(page.locator('[data-testid="duration-disclosure"]')).toBeVisible();
    await page.locator('[data-testid="duration-send"]').click();

    // 失败原因来自 `invokeRouted` 的第 1 道闸（在解析候选之后、网络之前）。
    await expect(page.locator('[data-testid="duration-failed"]')).toBeVisible();
    await expect(page.locator('[data-testid="duration-failure-message"]')).toContainText(
      'AI 未启用',
    );

    await expectNoStubCall(request);
  });
});
