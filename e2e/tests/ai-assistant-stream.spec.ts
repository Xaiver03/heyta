/**
 * 真实用户旅程：助手**流式**过程（SSE）
 * =========================================
 *
 * 为什么这条一定要在真浏览器里跑：单测里的 `Response` 是 Node 的 undici，
 * 而产品跑在 Chromium/WKWebView 上。**`response.body.getReader()`、
 * `TextDecoder` 的分片解码、以及"读流时 React 每一帧都重渲染"**这三件事
 * 只有真浏览器能证明 —— jsdom 里全绿而浏览器里一动不动，正是 AGENTS §6.2
 * 规定一点名的那类洞。
 *
 * 判据（按重要性）：
 *   1. 🔴 **工具行在第二轮回答之前就出现**（"正在/已读取 · list_tasks"）。
 *      这正是"过程可见"与"等结果"的区别，也是本次改动的全部意义。
 *   2. 🔴 **回答是逐字出现的**：两片文本到齐后，气泡里的字与最终历史一致
 *      （没有丢字、没有重复、没有把两片接错）。
 *   3. 收尾之后进行中那一份**消失**，步骤行并进最终那条回答里 ——
 *      否则同一行会在屏幕上出现两次。
 *   4. 截图落在 `apps/web/evidence/assistant/`（**固定文件名，人必须打开看**），
 *      含暗色主题那一张（AGENTS §5：「不测暗色主题就交付」是列出来的错）。
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test, type Page } from '@playwright/test';

import {
  configureEndpoint,
  openApp,
  resetStub,
  setStubBarrier,
  switchTheme,
  switchView,
} from './helpers.js';

const EVIDENCE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../apps/web/evidence/assistant',
);

function captureConsole(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(`console: ${msg.text()}`);
  });
  page.on('pageerror', (error) => {
    errors.push(`pageerror: ${String(error)}`);
  });
  return errors;
}

test.describe('对话助手：流式过程（SSE）', () => {
  test('工具行先出现 → 文本逐字出现 → 收尾后并进历史', async ({ page, request }) => {
    const errors = captureConsole(page);
    // `hold`：流到第一片正文就停住，等本用例放开 —— 否则"半句已在屏幕上"
    // 这句话没法被确定性地断言（两片之间只隔 20ms）。
    await resetStub(request, { stream: true, hold: true });
    /**
     * 拦掉"中央登录配置"这一发外部请求。
     *
     * ⚠️ 它不是本用例的被测对象，而是**环境噪音**：这台机器上
     * `heyta.waytofuture.cn` 的 CORS 头不回 `Access-Control-Allow-Origin`，
     * 于是控制台会多两条 `ERR_FAILED / CORS` —— 与流式无关，但会让下面
     * "控制台必须干净"那条判据红（实测过一次）。拦成 `{}` 与
     * `auth-simple-ux.spec.ts` 同一处置。
     */
    await page.route('**/api/auth/central/config', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }),
    );
    await openApp(page, '/', 'accepted');

    await configureEndpoint(page, {
      capabilities: ['tool_calling'],
      features: ['tool-calling'],
    });
    await switchView(page, '任务');

    // 这一句刻意是**规则答不出**的（规则命中的话一个请求都不发，就测不到流）。
    await page.locator('[data-testid="ai-assistant-input"]').fill('随便说点什么吧');
    await page.locator('[data-testid="ai-assistant-send-button"]').click();
    await expect(page.locator('[data-testid="ai-assistant-disclosure"]')).toBeVisible();
    await page.locator('[data-testid="ai-assistant-send"]').click();

    // ══ 1. 🔴 过程行在第一轮工具跑完、第二轮还没回话时就该在 ══════════
    const live = page.locator('[data-testid="ai-chat-live"]');
    await expect(live).toBeVisible();
    await expect(live.locator('[data-testid="ai-chat-live-steps"]')).toContainText('list_tasks');
    // 截图放在"过程行已在、回答还没写完"这一刻 —— 这是唯一能证明
    // "它是在跑的时候就说，而不是跑完才补一行"的时机。
    await page.screenshot({ path: `${EVIDENCE}/4-stream-progress.png`, fullPage: true });

    // ══ 2. 文本逐字进来（同一个气泡）═══════════════════════════════════
    // 桩会在第一片正文之后停住，所以此刻屏幕上是**真的半句**：
    // 前半片已经画出来，后半片还没到。这条断言失败就说明"逐字"其实是"整段"。
    const liveText = page.locator('[data-testid="ai-chat-live-text"]');
    await expect(liveText).toContainText('假端点收到');
    await expect(liveText).not.toContainText('工具结果。');
    await page.screenshot({ path: `${EVIDENCE}/4b-stream-partial.png`, fullPage: true });
    await setStubBarrier(request, 'release');
    await expect(liveText).toContainText('工具结果。');

    // ══ 3. 收尾：进行中那一份消失，最终回答带步骤行 ════════════════════
    const answer = page.locator('[data-testid="ai-chat-assistant"]').last();
    await expect(answer).toContainText('假端点收到 1 条工具结果');
    await expect(live).toHaveCount(0);
    await expect(answer.locator('[data-testid="ai-chat-steps"]')).toContainText('list_tasks');
    // 摘要那行还在（既有 e2e 按它断言步数，形状没被这次改动拆掉）
    await expect(page.locator('[data-testid="ai-chat-trace"]').last()).toContainText('1');

    await page.screenshot({ path: `${EVIDENCE}/5-stream-done.png`, fullPage: true });

    // ══ 4. 暗色主题下的过程行（只有图能证明还分得出来）═════════════════
    await switchTheme(page, 'dark');
    await page.screenshot({ path: `${EVIDENCE}/5b-stream-done-dark.png`, fullPage: true });
    await switchTheme(page, 'light');

    expect(errors, `控制台错误：${errors.join(' | ')}`).toEqual([]);
  });
});
