/**
 * 真实浏览器用户旅程的公共步骤。
 * ==================================
 *
 * 这个文件里**没有一处 mock**：所有动作都是真的点击、真的输入、真的渲染，
 * 判定"真的发出了模型请求"靠读假端点的 `GET /__requests`
 * （见 `../stub-provider.mjs` 的文件头）。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ## 🔴 配置端点为什么走这一串点击
 *
 * 出厂配置是**四道闸全关 + 零端点 + 零路由**（见 `aiStore.ts` 的
 * `defaultAiSettings()`）。所以任何一个功能要能用，用户必须自己在
 * 设置界面里走完这串动作。这些步骤与 jsdom 版旅程
 * （`apps/web/tests/journey-ai-memory.integration.spec.tsx` 的
 * `configureAiThroughUi`）**逐字对应**，只是换成真浏览器 API。
 *
 * ## 🔴 selector 全部来自源码，不是猜的
 *
 * - 开关 / 能力 / 密钥：`apps/web/src/features/settings/AiSettings.tsx`
 * - 功能路由 chip：同上，`data-testid="feature-<feature>"` 那一行里的按钮
 * - 各功能的入口与面板：`apps/web/src/features/ai/Ai*.tsx`
 *
 * ## ⚠️ 回环端点不需要"授权数据出境"
 *
 * 假端点在 `127.0.0.1`，而 `classifyDestination()` 把回环地址判为 `none`
 * （`packages/ai/src/supply.ts`）—— 也就是"数据不出设备"，于是
 * `consent-<feature>` 那一块**根本不会渲染**。helper 里做了兼容：
 * 出现了才点。这也意味着**远端授权链路在本套件里验不到**，见测试报告。
 */

import { expect, type APIRequestContext, type Page } from '@playwright/test';
import { installMissingProducerShims } from './shims';

/** 假端点的来源（与 `playwright.config.ts` 的 webServer 端口一致）。 */
export const STUB_ORIGIN = 'http://127.0.0.1:4319';

/** 填进"地址"输入框的值。OpenAI 兼容 base，provider 会拼 `/chat/completions`。 */
export const STUB_ENDPOINT = `${STUB_ORIGIN}/v1`;

/** 填进"模型"输入框的值。假端点不校验模型名，只要求非空。 */
export const STUB_MODEL = 'stub-model';

/** 能力词表（与 `AiCapability` 一致）。 */
export const CAP_STRUCTURED_OUTPUT = 'structured_output';
export const CAP_LONG_CONTEXT = 'long_context';

export interface StubCall {
  readonly feature: string;
  readonly systemHead: string;
}

export interface StubLog {
  readonly count: number;
  readonly calls: readonly StubCall[];
}

/**
 * 清零假端点的调用计数。
 *
 * 🔴 **每条用例开头都必须调** —— 计数存在假端点进程里，而那个进程
 * 整个测试运行只启动一次，所以它是**跨用例共享**的。
 */
export async function resetStub(request: APIRequestContext): Promise<void> {
  const res = await request.get(`${STUB_ORIGIN}/__reset`);
  expect(res.ok(), '假端点的 /__reset 应该可用').toBe(true);
}

export async function stubLog(request: APIRequestContext): Promise<StubLog> {
  const res = await request.get(`${STUB_ORIGIN}/__requests`);
  expect(res.ok(), '假端点的 /__requests 应该可用').toBe(true);
  return (await res.json()) as StubLog;
}

/** 轮询等到假端点累计收到 n 次调用，并返回那一刻的调用列表。 */
export async function waitForStubCalls(
  request: APIRequestContext,
  n: number,
): Promise<StubLog> {
  await expect
    .poll(async () => (await stubLog(request)).count, {
      message: `假端点应该累计收到 ${String(n)} 次调用`,
    })
    .toBe(n);
  return stubLog(request);
}

/** 断言假端点**一次调用都没收到**。用于"不该发请求"的反向旅程。 */
export async function expectNoStubCall(request: APIRequestContext): Promise<void> {
  const log = await stubLog(request);
  expect(
    log.count,
    `不应该发出任何模型请求，实际收到：${JSON.stringify(log.calls)}`,
  ).toBe(0);
}

/** 断言假端点累计收到 n 次调用（不多不少）。 */
export async function expectStubCount(
  request: APIRequestContext,
  n: number,
): Promise<void> {
  const log = await stubLog(request);
  expect(
    log.count,
    `假端点应该累计收到 ${String(n)} 次调用，实际：${JSON.stringify(log.calls)}`,
  ).toBe(n);
}

/**
 * 打开真应用，并等到输入框真的可见（白屏不算通过）。
 *
 * 🔴 先装**缺失生产者的垫片**（见 `shims.ts`）：这一支上有三个静态导入
 * 指向尚未落地的导出，一个名字不存在就整张模块图不求值 —— 症状是
 * `<body>` 全空、所有用例在"等添加任务的输入框"那一刻超时。
 * 垫片只满足"名字存在"，**一调用就抛**；生产者落地后它自动失效。
 */
export async function openApp(page: Page): Promise<void> {
  await installMissingProducerShims(page);
  await page.goto('/');
  await expect(page.locator('input[placeholder^="添加任务"]')).toBeVisible();
}

/** 切换顶部视图 tab。 */
export async function switchView(
  page: Page,
  label: '任务' | '四象限' | '习惯' | '番茄钟' | '时间线' | '成长' | '设置',
): Promise<void> {
  await page.getByRole('tab', { name: label }).click();
}

/** 通过输入框回车建一条任务（走 `CaptureComposer`，真 op-log）。 */
export async function addTask(page: Page, title: string): Promise<void> {
  const composer = page.locator('input[placeholder^="添加任务"]');
  await composer.fill(title);
  await composer.press('Enter');
  await expect(rowFor(page, title)).toBeVisible();
}

/**
 * 按标题找到任务行。
 *
 * ⚠️ 用**标题**而不是 taskId 定位：真浏览器里拿不到 id（也不该去拿内部状态），
 * 而"用户看得见的那一行"本来就是断言该挂的地方。
 */
export function rowFor(page: Page, title: string) {
  return page
    .locator('.ht-task')
    .filter({ has: page.locator('.ht-task__title', { hasText: title }) });
}

/** 任务行右侧的元信息区（截止时间 / 优先级徽标）。 */
export function metaFor(page: Page, title: string) {
  return rowFor(page, title).locator('.ht-task__meta');
}

export interface EndpointSetup {
  /** 要在该端点上勾选的能力（不勾 `long_context` 会让拆解永远没有候选）。 */
  readonly capabilities: readonly string[];
  /** 要把该端点路由给哪些功能（`capture` / `breakdown` / `prioritize` / `duration-estimate`）。 */
  readonly features: readonly string[];
  readonly endpoint?: string;
  readonly model?: string;
  readonly allowRemote?: boolean;
}

/**
 * 在**设置界面**里把 AI 端点配起来：开闸 → 加自定义端点 → 填地址/模型/密钥
 * → 声明能力 → 指定功能路由 →（远端才需要）授权。
 *
 * 🔴 顺序有讲究：先开 `#ai-enabled`，端点那一整段才会渲染出来。
 */
export async function configureEndpoint(page: Page, setup: EndpointSetup): Promise<void> {
  await switchView(page, '设置');
  await expect(page.locator('[data-testid="ai-settings"]')).toBeVisible();

  // ── 闸 1、闸 2 ──────────────────────────────────────────────────────
  await page.locator('#ai-enabled').check();
  await expect(page.locator('#ai-allow-remote')).toBeVisible();
  if (setup.allowRemote ?? true) {
    await page.locator('#ai-allow-remote').check();
  }

  // ── 加一个空白自定义端点 ────────────────────────────────────────────
  // ⚠️ 刻意**不校验地址**（见 AiSettings 的 addCustomEndpoint 注释）：
  // 先给用户一个空输入框，而不是"点了没反应"。
  await page.locator('[data-testid="add-custom-endpoint"]').click();
  const row = page.locator('[data-testid="endpoint-custom-1"]');
  await expect(row).toBeVisible();

  await row.locator('[aria-label$="的地址"]').fill(setup.endpoint ?? STUB_ENDPOINT);
  await row.locator('[aria-label$="的模型"]').fill(setup.model ?? STUB_MODEL);

  // 密钥只进内存（本会话），必须显式点"记住"。
  // 假端点不校验密钥，但"输入框存在 + 能记住"本身就是一条要验的接线。
  await row.locator('[aria-label$="的密钥"]').fill('stub-key');
  await row.getByRole('button', { name: '记住（本次会话）' }).click();
  await expect(row.locator('[aria-label$="的密钥"]')).toHaveAttribute(
    'placeholder',
    '已在本次会话中',
  );

  // ── 能力声明（不勾就没有，见 AiSettings 文件头）──────────────────────
  for (const capability of setup.capabilities) {
    await row.locator(`[aria-label$="的能力 ${capability}"]`).check();
  }

  // ── 逐功能路由 ──────────────────────────────────────────────────────
  for (const feature of setup.features) {
    const featureRow = page.locator(`[data-testid="feature-${feature}"]`);
    await featureRow.locator('button', { hasText: '自定义端点' }).click();

    // 回环端点目的地是 `none` → 不要求授权，这一块不会渲染。
    const consent = page.locator(`[data-testid="consent-${feature}"]`);
    if ((await consent.count()) > 0) {
      await consent.getByRole('button', { name: '授权' }).click();
    }
  }
}

/** 配好之后再把总开关关掉 —— 用来验"网络层闸门真的拦住了"。 */
export async function disableAiMasterSwitch(page: Page): Promise<void> {
  await switchView(page, '设置');
  await page.locator('#ai-enabled').uncheck();
  // 关掉之后端点那段应当整体消失（界面上不残留"可用"的错觉）。
  await expect(page.locator('#ai-allow-remote')).toHaveCount(0);
}
