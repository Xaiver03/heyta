/**
 * 真实用户旅程：单步工具调用面板（W5）
 * =======================================
 *
 * 这条套件补的是台账里登记为 **W5** 的那块空白：`AiToolRun` 此前在 `e2e/` 里
 * 只出现在 `ai-row-layout.spec.ts`（布局判据），**从来没有**"一句话 → 真调工具 →
 * 结果卡片"那条旅程。假端点里甚至没有它的 ROUTES 行 —— 也就是说它**结构上不可能**
 * 被浏览器级证据测到，不是"测了没测到"。
 *
 * 判据（按重要性）：
 *   1. 🔴 **规则命中那一趟，假端点计数为 0**，而界面已经出结果卡片 ——
 *      "零出境"是这条面板存在的理由，只在注释里写过一次不算数。
 *   2. 🔴 走模型那一趟，**披露出现时**计数仍然为 0，点「发送到该端点」之后才变 1。
 *   3. 🔴 写工具只产出**提案**：确认之前任务列表里不许出现那条任务；
 *      确认之后出现，而假端点**仍然只有那一次调用**（确认是本地 `host.submit`，不再出境）。
 *   4. 🔴 撤销逐工具授权之后，同一个句子必须在**执行前**被拦住（`ai-tool-denied`），
 *      而不是把已经发出去的请求当没发生。
 *   5. 五张截图落在 `apps/web/evidence/tool-run/`，含**暗色**那张（§5：暗色不是反相）。
 *
 * ⚠️ 桩不许编造业务事实：写提案那条的标题**逐字取自请求里我打进去的那串字**，
 * 于是"那几个字最后出现在任务列表里"证的是一整条通路，而不是巧合。
 *
 * ⚠️ 两处**踩过一次才知道**的约束：
 *   - **逐工具授权必须在规则那条之前就给**：`resolveToolSelection` 用同一张
 *     `localApi.grants`（`App.tsx:1887`），未授权就判 `no-tool-granted` → 走披露，
 *     于是"规则命中"那条会在还没配端点时先变成"要出境吗？"，判据 1 测的就不再是规则路径。
 *   - 走模型那句**必须一条规则都不命中**。`ai-tool-selection.ts:120` 那条
 *     `(已完成|做完|完成了)…` 会把"这周还剩几件事没做完"吃掉 —— 第一版就红在这里：
 *     界面显示「本机规则命中」，而用例断言「由模型选择」。
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test, type Page } from '@playwright/test';

import {
  addTask,
  configureEndpoint,
  expectNoStubCall,
  expectStubCount,
  openApp,
  resetStub,
  rowFor,
  STUB_ENDPOINT,
  stubLog,
  switchTheme,
  switchView,
  waitForStubCalls,
} from './helpers.js';

/**
 * 🔴 绝对路径（同 `ai-assistant.spec.ts` 的教训）：相对串会落到仓库外，
 * 于是"用例通过但证据不存在"。
 */
const EVIDENCE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../apps/web/evidence/tool-run',
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

/** 打开设置 → 本机 API 那张逐工具表 → 勾工具（授权与 MCP 共用同一张表）。 */
async function grantTools(page: Page, names: readonly string[]): Promise<void> {
  await switchView(page, '设置');
  await page.locator('#local-api-enabled').check();
  for (const name of names) {
    const box = page.locator(`input[aria-label="${name}"]`);
    await expect(box, `逐工具授权里必须渲染出「${name}」`).toBeVisible();
    await box.check();
  }
  await switchView(page, '任务');
}

/** 撤销单个工具的授权（回到同一张表里取消勾选）。 */
async function revokeTool(page: Page, name: string): Promise<void> {
  await switchView(page, '设置');
  const box = page.locator(`input[aria-label="${name}"]`);
  await expect(box, `「${name}」此前必须处于已授权状态`).toBeChecked();
  await box.uncheck();
  await switchView(page, '任务');
}

async function runText(page: Page, text: string): Promise<void> {
  await page.getByTestId('ai-tool-input').fill(text);
  await page.getByTestId('ai-tool-run-button').click();
}

test.describe('单步工具面板：真浏览器端到端旅程', () => {
  test('规则命中零出境 → 模型那条先披露后出境 → 结果卡片', async ({ page, request }) => {
    const errors = captureConsole(page);
    await resetStub(request);
    await openApp(page, '/', 'accepted');
    await addTask(page, '买牛奶');
    await grantTools(page, ['list_tasks']);

    // ══ 1. 🔴 规则命中：一个字节都不许出去 ════════════════════════════
    // 此刻**还没有任何端点**（出厂四道闸全关、零路由）。
    // 这也是"它真的没走网络"最干净的证明方式：压根没有可用端点可走。
    await expect(page.getByTestId('ai-tool-run')).toBeVisible();
    await runText(page, '列出所有任务');

    const via = page.getByTestId('ai-tool-via');
    await expect(via, '规则命中的那条必须自己说明没联网').toContainText('没有联网');
    await expect(page.getByTestId('ai-tool-observation')).toContainText('买牛奶');
    await expectNoStubCall(request);
    await page.screenshot({ path: `${EVIDENCE}/1-rule-hit-no-egress.png`, fullPage: true });

    // ══ 2. 配端点（能力要声明 tool_calling，否则模型看不见工具）════════
    await configureEndpoint(page, {
      capabilities: ['tool_calling'],
      features: ['tool-calling'],
      endpoint: STUB_ENDPOINT,
    });
    // 🔴 「设置」是**浮层**不是路由（`helpers.ts` 的 IA 说明），配完端点它还开着，
    // 于是任务视图里的面板被 `div[role="dialog"] … intercepts pointer events` 挡住。
    // 真人是"关掉设置再回任务列表"，这里按同一个顺序收掉浮层。
    await switchView(page, '任务');

    // ══ 3. 🔴 规则认不出的句子：先披露，**披露时仍未出境**，点发送才出境 ══
    await runText(page, '把事情按紧急程度排一排');

    const disclosure = page.getByTestId('ai-tool-disclosure');
    await expect(disclosure, '规则没命中时必须先出披露，而不是直接发').toBeVisible();
    await expect(disclosure.getByTestId('ai-tool-fields')).toBeVisible();
    await expectNoStubCall(request);
    await page.screenshot({ path: `${EVIDENCE}/2-disclosure-before-send.png`, fullPage: true });

    await disclosure.getByTestId('ai-tool-send').click();
    const log = await waitForStubCalls(request, 1);
    expect(
      log.calls.some((call) => call.feature === 'tool-calling'),
      `假端点必须把这趟认成 tool-calling（判据是系统提示词首句），实际：${JSON.stringify(log.calls)}`,
    ).toBe(true);

    await expect(via).toContainText('由模型选择');
    await expect(page.getByTestId('ai-tool-observation')).toBeVisible();

    expect(errors, `控制台不该有错误：\n${errors.join('\n')}`).toEqual([]);
  });

  test('写工具只出提案：确认前不落库、确认后一次都不再多出境', async ({ page, request }) => {
    const errors = captureConsole(page);
    await resetStub(request);
    await openApp(page, '/', 'accepted');
    await configureEndpoint(page, {
      capabilities: ['tool_calling'],
      features: ['tool-calling'],
      endpoint: STUB_ENDPOINT,
    });
    await grantTools(page, ['list_tasks', 'create_task']);

    // 哨兵"新建任务：<标题>"让桩回 create_task，标题逐字取自我打的这串。
    const title = '写周报给运营';
    await runText(page, `新建任务：${title}`);
    await page
      .getByTestId('ai-tool-disclosure')
      .getByTestId('ai-tool-send')
      .click();
    await waitForStubCalls(request, 1);

    // ══ 4. 🔴 提案出现，但**库里还没有这条任务** ═══════════════════════
    await expect(page.getByTestId('ai-tool-proposal')).toContainText(title);
    await expect(rowFor(page, title), '确认之前不许落库').toHaveCount(0);
    await page.screenshot({ path: `${EVIDENCE}/3-proposal-light.png`, fullPage: true });

    // 暗色那张：提案卡在中性面/描边下的可读性只有图能证明（§5 常犯错）。
    await switchTheme(page, 'dark');
    await expect(page.getByTestId('ai-tool-proposal')).toContainText(title);
    await page.screenshot({ path: `${EVIDENCE}/3b-proposal-dark.png`, fullPage: true });
    await switchTheme(page, 'light');

    // ══ 5. 确认 ⇒ 一次本地 submit ⇒ 行出现；假端点计数不变 ═══════════════
    await page.getByTestId('ai-tool-confirm').click();
    await expect(page.getByTestId('ai-tool-confirmed')).toBeVisible();
    await expect(rowFor(page, title)).toBeVisible();
    // 🔴 确认这一步**不该再出境**：计数必须仍是 1（不多不少）。
    await expectStubCount(request, 1);
    await page.screenshot({ path: `${EVIDENCE}/4-confirmed.png`, fullPage: true });

    // ══ 6. 🔴 撤销逐工具授权：同一个句子必须在**执行前**被拦住 ═══════════
    // 判据不是"没写进去"（那在"根本没跑"时也成立），而是面板明确说出被拒。
    await revokeTool(page, 'create_task');

    await runText(page, '新建任务：不该被创建的任务');
    await page
      .getByTestId('ai-tool-disclosure')
      .getByTestId('ai-tool-send')
      .click();
    // 模型那一次仍然会发出去（授权拦的是**执行**，不是请求），所以要等它落地。
    await waitForStubCalls(request, 2);
    await expect(page.getByTestId('ai-tool-denied')).toBeVisible();
    await expect(rowFor(page, '不该被创建的任务')).toHaveCount(0);

    const final = await stubLog(request);
    expect(final.count, '撤销授权之后不该有第三次出境').toBe(2);

    expect(errors, `控制台不该有错误：\n${errors.join('\n')}`).toEqual([]);
  });
});
