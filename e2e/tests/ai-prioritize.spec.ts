/**
 * 真实用户旅程：AI 优先级建议（prioritize）
 * ===========================================
 *
 * 与拆解同一条纪律：披露只算不发、结果要人确认、写回走 op-log。
 * 额外验证的是**逐条取舍真的影响落库结果** —— 去掉的那条不该有优先级徽标。
 *
 * ⚠️ 断言"哪条任务拿到哪个优先级"时**不依赖列表顺序**：
 * 从结果面板里把「标题 → 中文优先级」读回来，再对着任务行验；
 * 这样即便列表将来改成按优先级排序，断言也不会假绿/假红。
 */

import { expect, test } from '@playwright/test';

import {
  addTask,
  CAP_STRUCTURED_OUTPUT,
  configureEndpoint,
  expectNoStubCall,
  expectStubCount,
  metaBadgeTexts,
  metaFor,
  openApp,
  resetStub,
  rowFor,
  STUB_ENDPOINT,
  switchView,
  waitForStubCalls,
} from './helpers.js';

/**
 * 结果面板里的中文标签 → 任务行上的优先级徽章文案。
 *
 * 🔴 这一列以前是 `P1/P2/P3`。那正是 web 上被修掉的那个缺陷本身：行内直接渲染
 * `P{数字}` —— 一个从不解释的数字、且中英都是数字（数字没有语言），而移动端
 * 显示的是「高优先级」。行元信息收进共享 `TaskBadges` 之后 web 与移动端同一份
 * 字形，文案来自 `packages/i18n` 的 `mobile.priority.badge`（zh 是 `{level}优先级`）。
 * ⚠️ 改词条要同时改这里（e2e 是**独立 workspace**，拿不到 `@heyta/i18n`）。
 */
const BADGE: Readonly<Record<string, string>> = {
  高: '高优先级',
  中: '中优先级',
  低: '低优先级',
};

/** 全部优先级徽章文案 —— 用来判"这一行**没有**优先级徽章"。 */
const PRIORITY_BADGES = new Set<string>(Object.values(BADGE));

test.describe('AI 优先级建议：真浏览器端到端旅程', () => {
  test('配置 → 建 3 条任务 → 披露 → 真请求 → 取舍 → 写回优先级 → 刷新后仍在', async ({
    page,
    request,
  }) => {
    await resetStub(request);
    await openApp(page);

    await configureEndpoint(page, {
      capabilities: [CAP_STRUCTURED_OUTPUT],
      features: ['prioritize'],
    });
    await switchView(page, '任务');

    // 「哪件事更重要」只有在互相比较时才成立 —— 至少两条才有意义。
    for (const title of ['写周报', '修登录页错位', '买牛奶']) {
      await addTask(page, title);
    }

    // ══ 1. 披露：只算不发 ══════════════════════════════════════════════
    await page.locator('[data-testid="prioritize-open"]').click();
    await expect(page.locator('[data-testid="prioritize-disclosure"]')).toBeVisible();
    await expect(page.locator('[data-testid="prioritize-destination"]')).toContainText(
      STUB_ENDPOINT,
    );
    await expect(page.locator('[data-testid="prioritize-count"]')).toContainText('3');
    await expectNoStubCall(request);

    // ══ 2. 发送 → 真请求 ═══════════════════════════════════════════════
    await page.locator('[data-testid="prioritize-send"]').click();
    await expect(page.locator('[data-testid="prioritize-proposal"]')).toBeVisible();

    const log = await waitForStubCalls(request, 1);
    expect(log.calls[0]?.feature, '系统提示词首句应该路由到 prioritize').toBe('prioritize');

    // ══ 3. 结果：假端点按输入顺序轮转 high/medium/low ══════════════════
    const items = page.locator('[data-testid="prioritize-items"] li');
    await expect(items).toHaveCount(3);

    const pairs: { title: string; label: string; badge: string }[] = [];
    for (let i = 0; i < 3; i += 1) {
      const title =
        (await page.locator(`[data-testid="prioritize-title-${String(i)}"]`).textContent())?.trim() ??
        '';
      const label =
        (await page
          .locator(`[data-testid="prioritize-priority-${String(i)}"]`)
          .textContent())?.trim() ?? '';
      const badge = BADGE[label];
      expect(badge, `第 ${String(i)} 条的中文优先级「${label}」应该在 高/中/低 里`).toBeDefined();
      pairs.push({ title, label, badge: badge as string });
    }
    // 三条互不相同 —— 这正是否定"假端点其实没按输入给优先级"的证据。
    expect(new Set(pairs.map((p) => p.label)).size).toBe(3);

    // ══ 4. 逐条取舍：去掉第二条，只写两条 ═══════════════════════════════
    await page.locator('[data-testid="prioritize-item-1"]').uncheck();
    await expect(page.locator('[data-testid="prioritize-kept-count"]')).toHaveText('2');

    const dropped = pairs[1] as { title: string; label: string; badge: string };
    const kept = pairs.filter((_, i) => i !== 1);

    // ══ 5. 应用 → 写进 `Task.priority`（走 store.setPriority → op-log）══
    await page.locator('[data-testid="prioritize-apply"]').click();
    await expect(page.locator('[data-testid="prioritize-applied"]')).toHaveText('已应用');

    // ══ 6. 断言结果真的落到**界面上看得见**的地方 ══════════════════════
    //
    // 🔴 正向判据仍走 locator（有自动重试，子串命中）；否定判据必须**逐徽章**比
    //（见 `helpers.ts` 的 `metaBadgeTexts`）：旧的 `not.toContainText('P')` 在
    //「高优先级」这种新文案下根本不含 `P`，会被"永远通过"的判据顶掉。
    for (const pair of kept) {
      await expect(
        metaFor(page, pair.title),
        `「${pair.title}」应该显示 ${pair.badge}`,
      ).toContainText(pair.badge);
    }
    await expect
      .poll(
        async () =>
          (await metaBadgeTexts(page, dropped.title)).filter((badge) =>
            PRIORITY_BADGES.has(badge),
          ).length,
        { message: `被取消的「${dropped.title}」不该被写优先级` },
      )
      .toBe(0);

    // ══ 7. 刷新：优先级仍在（不是内存里的一次性状态）═══════════════════
    await page.reload();
    await expect(rowFor(page, '写周报')).toBeVisible();
    for (const pair of kept) {
      await expect(metaFor(page, pair.title)).toContainText(pair.badge);
    }
    await expect
      .poll(
        async () =>
          (await metaBadgeTexts(page, dropped.title)).filter((badge) =>
            PRIORITY_BADGES.has(badge),
          ).length,
        { message: `刷新后被取消的「${dropped.title}」仍然不该有优先级徽章` },
      )
      .toBe(0);
    await expectStubCount(request, 1);
  });
});
