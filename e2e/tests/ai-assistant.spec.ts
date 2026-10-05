/**
 * 真实用户旅程：对话式助手（W12 / ADR-0045）
 * =============================================
 *
 * 这条用例补的是"jsdom 全绿但浏览器里点不动"的那一类洞（AGENTS §6.2 规定一）：
 * 面板的单测挂的是假 `fetch` 与假宿主，而这里从**空白浏览器状态**开始，
 * 全部点真界面 —— 真 DOM、真 IndexedDB、真 op-log、真 `fetch` 打到假端点。
 *
 * 判据（按重要性）：
 *   1. 🔴 **第一次点「发送」时假端点计数还是 0** —— 一次性披露真的在出境之前，
 *      不是写在注释里的一句话。
 *   2. 🔴 第二轮请求里带着 `role:'tool'` 的结果（`toolStep === 1`）——
 *      "多步"是真的把观察回送给了模型，不是界面上画了个数字。
 *   3. 同一段会话不重复拦；「新会话」重新拦。
 *   4. 设置里的档位是**真持久化**（刷新后仍在），且它不改 `localApi` 那张表。
 *   5. 四张截图落在 `apps/web/evidence/assistant/`（固定文件名，人必须打开看）。
 *      ⚠️ 其中 `2b-chat-dark.png` 是**暗色主题**那张 —— AGENTS §5 明确把
 *      "不测暗色主题就交付"列为常犯错，而气泡的角色区分正是靠底色，只有图能证明
 *      暗色下还分得出来。第一轮的 `3-settings-tier.png` 还拍成了**入场动画中途**
 *      （下层视图以接近同等的浓度叠上来，读起来像排版事故），所以浮层截图前
 *      必须等动画落位（`helpers.ts` 的 `waitForOverlaySettled`）。
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test, type Page } from '@playwright/test';

import {
  addTask,
  configureEndpoint,
  expectNoStubCall,
  openApp,
  resetStub,
  STUB_ENDPOINT,
  switchView,
  waitForStubCalls,
} from './helpers.js';

/**
 * 证据目录用**绝对路径**，不用相对串。
 *
 * ⚠️ 第一版写的是 `'../../apps/web/evidence/assistant'`，跑完**测试是绿的、图却不在仓库里** ——
 * Playwright 的 `screenshot.path` 按它自己的根解析，那个 `../..` 落到了仓库外。
 * "用例通过但证据不存在"是最坏的一种绿：判据说拍了照，磁盘上什么都没有。
 */
const EVIDENCE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../apps/web/evidence/assistant',
);

/** 抓控制台错误：白屏的根因几乎只在这里现形（§6.2 规定一第 3 条）。 */
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

test.describe('对话助手：真浏览器端到端旅程', () => {
  test('披露前零出境 → 多步读循环 → 第二句不再拦 → 档位刷新后仍在', async ({ page, request }) => {
    const errors = captureConsole(page);
    await resetStub(request);
    await openApp(page, '/', 'accepted');

    await configureEndpoint(page, {
      capabilities: ['tool_calling'],
      features: ['tool-calling'],
    });
    await switchView(page, '任务');
    await addTask(page, '写周报');

    // ══ 1. 面板在任务视图里，档位默认"只读" ═══════════════════════════
    const panel = page.locator('[data-testid="ai-assistant"]');
    await expect(panel).toBeVisible();
    await expect(page.locator('[data-testid="ai-assistant-tier"]')).toContainText('只读');
    await expect(page.locator('[data-testid="ai-assistant-disclaimer"]')).toBeVisible();

    // ══ 1b. 🔴 规则本机就答得出的那一句：**不弹披露**，而且一个请求都不发 ══
    //    这是"规则先跑"那条短路在真浏览器里的对应物。单测能证明接线通了，但
    //    "披露承诺了一次不会发生的出境"这种谎，只有在真浏览器里连点带看图才抓得住：
    //    界面要求用户批准"这句话要离开本机"、用户批准了、然后什么都没出去。
    await page.locator('[data-testid="ai-assistant-input"]').fill('今天有什么任务');
    await page.locator('[data-testid="ai-assistant-send-button"]').click();
    await expect(page.locator('[data-testid="ai-assistant-disclosure"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="ai-chat-assistant"]').last()).toContainText(
      '没有发出任何请求',
    );
    await expectNoStubCall(request);

    // ══ 2. 🔴 第一次发送：只披露，不出境 ═══════════════════════════════
    // ⚠️ 这句刻意是**规则答不出**的（上面 1b 用的那句会被本机短路）：这一节测的是
    //    "披露 → 出境 → 多步循环"，问句要是被规则接走，下面那一发 click 就永远等不到披露。
    await page.locator('[data-testid="ai-assistant-input"]').fill('随便说点什么吧');
    await page.locator('[data-testid="ai-assistant-send-button"]').click();

    const disclosure = page.locator('[data-testid="ai-assistant-disclosure"]');
    await expect(disclosure).toBeVisible();
    await expect(page.locator('[data-testid="ai-assistant-destination"]')).toContainText(
      STUB_ENDPOINT,
    );
    // 披露必须把**并集**说出来（含正文与信封字段），不是只说"这句话 + 工具名"。
    const fields = await page.locator('[data-testid="ai-assistant-field-list"]').textContent();
    expect(fields, `披露里的字段集合：${String(fields)}`).toContain('task.body');
    expect(fields).toContain('tool.error');
    await expect(page.locator('[data-testid="ai-assistant-disclosure-tools"]')).toContainText(
      'list_tasks',
    );
    await expect(page.locator('[data-testid="ai-assistant-disclosure-limits"]')).toContainText('7');
    // 🔴 这一步是可失败检查：披露只算不发。
    await expectNoStubCall(request);

    await page.screenshot({ path: `${EVIDENCE}/1-disclosure.png`, fullPage: true });

    // 🔴 这张 `fullPage` 截图会改视口高度 ⇒ 右栏那一列量到 0 ⇒ AI 面**换挂载点**。
    //    2026-10-04 之前换挂载点=重挂载：披露对话框连同草稿一起消失，下面那一发
    //    click 永远等不到 `[data-testid="ai-assistant-send"]`（60s 超时），
    //    而症状读起来像"机器太忙"—— 实际是用户把窗口拖过 1023px 就会被
    //    悄悄取消一次同意请求。修法不是把截图挪走，而是让**换挂载点不再等于丢状态**
    //    （`features/ai/assistant-ephemeral.tsx`：未决那三样住在 Provider 里），
    //    所以这条断言判的是产品行为"跨断点不掉状态"，不是给截图让路。
    await expect(disclosure).toBeVisible();

    // ══ 3. 按「发送」才真的出境，循环跑了第二步 ════════════════════════
    await page.locator('[data-testid="ai-assistant-send"]').click();
    const two = await waitForStubCalls(request, 2);
    expect(two.calls[0]?.feature, '助手走的是 tool-calling 那条路由').toBe('assistant');
    expect(two.calls[0]?.hasToolResult, '第一步之前不该有工具结果').toBe(false);
    expect(two.calls[1]?.hasToolResult, '🔴 第二步必须带着工具结果回去').toBe(true);
    expect(two.calls[1]?.toolStep).toBe(1);

    const answer = page.locator('[data-testid="ai-chat-assistant"]').last();
    await expect(answer).toContainText('假端点收到 1 条工具结果');
    await expect(page.locator('[data-testid="ai-chat-trace"]').last()).toContainText('1');
    await page.screenshot({ path: `${EVIDENCE}/2-chat.png`, fullPage: true });

    // ══ 3b. 暗色主题（AGENTS §5「不测暗色主题就交付」是列出来的错）══════
    // 气泡的底色与描边全走 token，暗色下 `--ht-color-primary-subtle` 是半透明蓝、
    // `--ht-color-surface` 是近黑 —— 只看代码判断不了"角色还分得出来"，必须看图。
    await page.getByRole('button', { name: '切换到暗色主题' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.screenshot({ path: `${EVIDENCE}/2b-chat-dark.png`, fullPage: true });
    await page.getByRole('button', { name: '切换到亮色主题' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');

    // ══ 4. 同一段会话不再重复拦 ════════════════════════════════════════
    await page.locator('[data-testid="ai-assistant-input"]').fill('再说一遍');
    await page.locator('[data-testid="ai-assistant-send-button"]').click();
    await expect(page.locator('[data-testid="ai-assistant-disclosure"]')).toHaveCount(0);
    const four = await waitForStubCalls(request, 4);
    expect(four.count).toBe(4);

    // ══ 5. 「新会话」重新要求披露（一次会话一次的承诺随之重来）══════════
    await page.locator('[data-testid="ai-assistant-new-session"]').click();
    await expect(page.locator('[data-testid="ai-assistant-transcript"]')).toHaveCount(0);
    await page.locator('[data-testid="ai-assistant-input"]').fill('第三句');
    await page.locator('[data-testid="ai-assistant-send-button"]').click();
    await expect(page.locator('[data-testid="ai-assistant-disclosure"]')).toBeVisible();

    // ══ 6. 档位是第二个授权前端：切换 + 刷新后仍在 ══════════════════════
    await switchView(page, '设置');
    const section = page.locator('[data-testid="ai-assistant-section"]');
    await expect(section).toBeVisible();
    // 🔴 默认必须是只读那一格被选中。
    await expect(section.locator('[data-testid="assistant-tier-read-only"] input')).toBeChecked();
    await section.locator('[data-testid="assistant-tier-read-and-propose"] input').check();
    await page.reload();
    await switchView(page, '设置');
    const again = page.locator('[data-testid="ai-assistant-section"]');
    await expect(again.locator('[data-testid="assistant-tier-read-and-propose"] input')).toBeChecked();
    await expect(again.locator('[data-testid="assistant-tier-read-only"] input')).not.toBeChecked();
    /* 🔴 证据必须**拍到被断言的那一块**。`.ht-sheet` 自带 `overflow-y: auto`，
       而 `fullPage` 拍不进滚动容器（它扩的是文档高度，不是滚动容器的视口）——
       所以不先滚到位，这张"档位证据"里根本没有档位选择器，只有浮层第一屏。
       断言过 ≠ 证据里有：证据是给人看的那一张。 */
    await again.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${EVIDENCE}/3-settings-tier.png`, fullPage: true });

    // ══ 7. 🔴 两个前端互不越界（双向都验）══════════════════════════════
    // 入站那张表在 `localApi.enabled` 之前**根本不渲染** —— 所以先把它打开。
    await page.locator('#local-api-enabled').check();
    const createTaskGrant = page.locator('input[aria-label="create_task"]');
    await expect(createTaskGrant).toBeVisible();
    // 方向一：助手开了"可提议改动"，外部程序的逐工具授权**没跟着变**。
    await expect(createTaskGrant).not.toBeChecked();
    // 方向二：给外部程序开一个工具，助手的档位**也不跟着变**。
    await createTaskGrant.check();
    await expect(
      page.locator('[data-testid="assistant-tier-read-and-propose"] input'),
    ).toBeChecked();
    await page.locator('[data-testid="assistant-tier-read-only"] input').check();
    await expect(page.locator('input[aria-label="create_task"]')).toBeChecked();

    expect(errors, `控制台不该有错误：\n${errors.join('\n')}`).toEqual([]);
  });
});
