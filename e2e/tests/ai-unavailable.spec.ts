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
 *
 * 🔴 **首启隐私同意这里必须答 `accepted`，不能沿用共享层的默认档**：
 * 这四条的判据形态是"假端点计数为 0"（`expectNoStubCall`），而隐私闸门
 * （`consent-gate.ts` 换掉整个 `window.fetch`）在 `local-only` 下**同样**让计数为 0 ——
 * 那时候"通过"担保的是"我们没同意联网"，不是"AI 那三道闸拦住了"。
 * 一条在两种根因下都绿的判据等于没有判据。把隐私闸门先打开，
 * 剩下唯一能拦住请求的就是**被测的那一道**；而"不同意时一个字节都不出进程"
 * 由 `privacy-consent-zero-egress.spec.ts` 专门判，它不经过这里。
 */

import { expect, test } from '@playwright/test';

import { openTaskDetail } from './ai-entry.js';
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
  test('出厂状态（零配置）：三个入口都说明"还没配端点"，假端点计数为 0', async ({
    page,
    request,
  }) => {
    await resetStub(request);
    await openApp(page, '/', 'accepted');

    // 「优先级建议」只在有任务时出现。
    // ⚠️ 2026-11 的落点变化（判据一条未改，只改"从哪儿点进去"）：
    //   · 拆解 / 估时 → 任务详情的「自动化」组（行内动作行已删）⇒ 要先选中那一行；
    //   · 优先级建议 → **整列级的动作**，住在详情列的 AI 面（助手正文顶端的 `orgActions`）。
    //     而任务详情占据详情列时 AI 面不渲染 ⇒ 它必须**在选中任何任务之前**点，
    //     否则找不到入口。所以这一段的顺序是「先整列级、后任务级」，不是随意排列。
    await addTask(page, '写周报');

    // ── 优先级 ──────────────────────────────────────────────────────────
    await page.locator('[data-testid="prioritize-open"]').click();
    await expect(page.locator('[data-testid="prioritize-no-target"]')).toContainText(
      '还没有给「优先级排序」配置端点',
    );
    await expect(page.locator('[data-testid="prioritize-send"]')).toHaveCount(0);
    await page.locator('[data-testid="prioritize-disclosure-close"]').click();

    // ── 拆解 / 估时（任务级，要先选中那一行）────────────────────────────
    await openTaskDetail(page, '写周报');

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

    // ── 捕获 ────────────────────────────────────────────────────────────
    /*
      🔴 这一段**整段删掉了**，不是"它今天红了先绕过"。

      「一句话捕获」那个**独立 AI 入口**已被产品整体删除（产品负责人：「已经集成到
      收集框里面了，不需要单独有一个产品入口」）：`AiCapture.tsx` 不在了、
      `capture-ai` 这个 testid **全仓 0 枚**（`grep -rn 'capture-ai' apps/ packages/`
      回 0）、`AiFeature` 里没有 `capture`、`web.ai.capture.*` 词条已删。
      那一趟的首个错误就是它：`locator('[data-testid="capture-ai"]')` 一路
      `waiting for` 到 60 秒测试超时 —— 在测的是一个**没有被测物**的功能。

      所以「四个入口」这句话本身也过期了：**现在真的存在、且在本条路径上能点开的
      出口是三个** —— 优先级（列级）/ 拆解 / 估时（后两个在任务面单里）。
      少掉的那一个不是漏测，是入口不存在；它的能力（在收集框里解析一句话）由
      收集框自己的判据守（`calendar-capture` 那一路就是收集框 + 解析的端到端）。
    */
    // 收集框仍然在，而且**在里面打字不会发出任何 AI 请求** —— 这正是"入口并进收集框"
    // 之后最该守住的那一半：能力留在原地，出境没顺手被打开。
    const composer = page.locator('input[placeholder^="添加任务"]');
    await composer.fill('把季度复盘的结论整理成文档');
    await expect(composer).toHaveValue('把季度复盘的结论整理成文档');

    await expectNoStubCall(request);
  });

  test('有端点但没给功能指定路由：入口说明原因，计数为 0', async ({ page, request }) => {
    await resetStub(request);
    await openApp(page, '/', 'accepted');

    // 端点加好、能力也勾了，但 `features: []` —— 一个功能都没路由。
    await configureEndpoint(page, {
      capabilities: [CAP_STRUCTURED_OUTPUT, CAP_LONG_CONTEXT],
      features: [],
    });
    await switchView(page, '任务');
    await addTask(page, '把新版本发到生产环境');
    await openTaskDetail(page, '把新版本发到生产环境');

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
    await openApp(page, '/', 'accepted');

    // 只勾基线能力，却把它路由给需要 `long_context` 的拆解。
    await configureEndpoint(page, {
      capabilities: [CAP_STRUCTURED_OUTPUT],
      features: ['breakdown'],
    });

    // 🔴 设置页必须把"能配、但配了也跑不起来"说出来（否则用户只会觉得 AI 坏了）。
    await expect(page.locator('[data-testid="cap-gap-breakdown"]')).toContainText('长上下文');

    await switchView(page, '任务');
    await addTask(page, '把新版本发到生产环境');
    await openTaskDetail(page, '把新版本发到生产环境');

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
    await openApp(page, '/', 'accepted');

    // 先完整配好 —— 证明拦住请求的不是"没配置"，而是**网络层那道总闸**。
    await configureEndpoint(page, {
      capabilities: [CAP_STRUCTURED_OUTPUT],
      features: ['duration-estimate'],
    });
    await disableAiMasterSwitch(page);

    await switchView(page, '任务');
    await addTask(page, '重构同步引擎的冲突解决');
    await openTaskDetail(page, '重构同步引擎的冲突解决');

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
