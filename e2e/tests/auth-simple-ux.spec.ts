/**
 * 认证与 Chatbot 的精简真实行为验收。
 *
 * 这份用例只验证用户能直接感知的产品契约：认证默认信息层级、渐进披露、
 * 响应式排版、动效无障碍，以及 AI 执行/只读/批量确认的真实 op-log 结果。
 * 不修改产品源码；模型响应使用现有 stub-provider，批量确认只在浏览器请求层
 * 对这一条回复做确定性替换，最终提交仍走真实 app-host → op-log。
 */

import path from 'node:path';
import { mkdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { expect, test, type Page } from '@playwright/test';

import { openApp, openAuthPanel } from '../auth-journey/helpers.js';
import {
  addTask,
  configureEndpoint,
  expectNoStubCall,
  openSettingsSheet,
  resetStub,
  rowFor,
  selectSettingsSection,
  switchView,
} from './helpers.js';

const STUB_ORIGIN = 'http://127.0.0.1:4342';
const STUB_ENDPOINT = `${STUB_ORIGIN}/v1`;
const EVIDENCE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../apps/web/evidence/auth-simple',
);

async function screenshot(page: Page, name: string): Promise<void> {
  const target = path.join(EVIDENCE, `${name}.png`);
  await rm(target, { force: true });
  // Authentication captures wait for the sheet entrance. Chatbot captures
  // share this helper but have no authentication sheet.
  const authSheet = page.locator('.ht-sheet__auth');
  if (await authSheet.count() > 0) {
    await authSheet.evaluate(async (element) => {
      await Promise.all(element.getAnimations().map((animation) => animation.finished.catch(() => undefined)));
    });
  }
  await page.screenshot({ path: target, fullPage: true });
}

async function closeAuth(page: Page): Promise<void> {
  const dialog = page.getByRole('dialog', { name: '登录 / 注册', exact: true });
  if (await dialog.isVisible().catch(() => false)) {
    const centralClose = dialog.getByTestId('central-auth-close');
    if (await centralClose.count() > 0) {
      await centralClose.click();
    } else {
      await dialog.getByTestId('auth-form-close').click();
    }
    await expect(dialog).toHaveCount(0);
  }
}

async function taskId(page: Page, title: string): Promise<string> {
  const row = rowFor(page, title);
  await expect(row).toBeVisible();
  const testId = await row.getAttribute('data-testid');
  expect(testId, `任务「${title}」缺少 task-item testid`).toMatch(/^task-item-.+/);
  return testId!.slice('task-item-'.length);
}

test.describe('认证页：默认信息层级与响应式审美', () => {
  const browserErrors = new WeakMap<Page, string[]>();
  test.beforeEach(async ({ page }) => {
    const errors: string[] = [];
    browserErrors.set(page, errors);
    page.on('console', (message) => { if (message.type() === 'error') errors.push(`${message.text()} @ ${message.location().url}`); });
    page.on('pageerror', (error) => errors.push(error.message));
  });
  test.afterEach(async ({ page }, testInfo) => {
    const errors = browserErrors.get(page) ?? [];
    if (testInfo.status !== testInfo.expectedStatus && errors.length > 0) {
      console.error('浏览器错误：', errors.join('\n'));
    }
    if (testInfo.status === testInfo.expectedStatus) {
      // This offline Vite suite has no identity server. Only the startup
      // session probe may return 404; the config probe is intercepted below.
      const expected404s = new Set(['http://127.0.0.1:4341/api/auth/central/session']);
      const actionable = errors.filter((error) => ![...expected404s].some((url) => error === `Failed to load resource: the server responded with a status of 404 (Not Found) @ ${url}`));
      expect(actionable, '认证界面不应产生意外浏览器错误').toEqual([]);
    }
  });

  test('1440/768 与 375/812 的亮暗主题都保持同屏认证、渐进披露和可读布局', async ({ page }) => {
    await mkdir(EVIDENCE, { recursive: true });
    await page.route('**/api/auth/central/config', (route) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ mode: 'oidc', loginPath: '/api/auth/oidc/start', documentVersion: 'v1' }),
    }));
    await openApp(page, '/', 'accepted');
    await page.setViewportSize({ width: 1440, height: 768 });
    const dialog = await openAuthPanel(page);
    await screenshot(page, 'auth-desktop-light');

    await expect(dialog.getByTestId('central-auth-panel')).toBeVisible();
    await expect(dialog.getByTestId('central-auth-submit')).toBeDisabled();
    await expect(dialog.getByTestId('central-auth-consent')).toBeVisible();
    await expect(dialog.getByTestId('central-auth-close')).toBeVisible();
    await expect(dialog.getByTestId('central-auth-self-hosted')).toHaveCount(0);
    await expect(dialog.getByTestId('auth-form-email')).toHaveCount(0);
    await expect(dialog.getByTestId('auth-form-server-url')).toHaveCount(0);
    await expect(dialog.getByTestId('auth-form-paste')).toHaveCount(0);

    const previewRows = page.locator('.ht-sheet__auth-preview-row');
    await expect(previewRows).toHaveCount(3);
    await expect
      .poll(async () => previewRows.first().evaluate((el) => getComputedStyle(el).animationName))
      .not.toBe('none');

    await dialog.getByTestId('central-auth-consent').check();
    await expect(dialog.getByTestId('central-auth-submit')).toBeEnabled();

    await page.emulateMedia({ reducedMotion: 'reduce' });
    await expect
      .poll(async () => previewRows.first().evaluate((el) => getComputedStyle(el).animationName))
      .toBe('none');
    await screenshot(page, 'auth-desktop-reduced-motion');
    await page.emulateMedia({ reducedMotion: 'no-preference' });

    await closeAuth(page);
    await page.setViewportSize({ width: 375, height: 812 });
    const mobileDialog = await openAuthPanel(page);
    await screenshot(page, 'auth-mobile-light');
    await expect(mobileDialog.getByTestId('central-auth-panel')).toBeVisible();
    await expect(page.getByTestId('rail-view-tasks')).toBeHidden();
    await expect
      .poll(async () => page.locator('.ht-sheet__auth-dialog').evaluate((el) => el.getBoundingClientRect().width))
      .toBeGreaterThan(360);
    await expect
      .poll(async () => page.locator('.ht-sheet__auth-dialog').evaluate((el) => el.getBoundingClientRect().width))
      .toBeLessThanOrEqual(375);
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await closeAuth(page);
    await openSettingsSheet(page);
    await selectSettingsSection(page, 'appearance');
    await page.getByTestId('theme-toggle').click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.getByTestId('settings-sheet-close').click();
    const darkDialog = await openAuthPanel(page);
    await screenshot(page, 'auth-mobile-dark');
    await expect(darkDialog.getByTestId('central-auth-panel')).toBeVisible();
  });

  test('中央配置不可用时仍能关闭登录面板', async ({ page }) => {
    await page.route('**/api/auth/central/config', (route) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: '{}',
    }));
    await openApp(page, '/', 'accepted');
    const dialog = await openAuthPanel(page);
    await expect(dialog.getByTestId('central-auth-unavailable')).toBeVisible();
    await expect(dialog.getByTestId('central-auth-close')).toBeVisible();
    await closeAuth(page);
  });

  test('自托管口令入口只在设置的高级路径出现', async ({ page }) => {
    await page.route('**/api/auth/central/config', (route) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ mode: 'oidc', loginPath: '/api/auth/oidc/start', documentVersion: 'v1' }),
    }));
    await openApp(page, '/', 'accepted');
    await openSettingsSheet(page);
    await selectSettingsSection(page, 'sync');
    await page.getByTestId('sync-advanced').locator('summary').click();
    await page.locator('#settings-sync .sync-settings__fit-button').click();
    const dialog = page.getByRole('dialog', { name: '登录 / 注册', exact: true });
    await expect(dialog.getByTestId('central-auth-self-hosted')).toBeVisible();
    await dialog.getByTestId('central-auth-self-hosted').click();
    await expect(dialog.getByTestId('auth-form-email')).toBeVisible();
    await expect(dialog.getByTestId('auth-form-password')).toBeVisible();
    await dialog.getByTestId('auth-form-advanced-toggle').click();
    await expect(dialog.getByTestId('auth-form-server-url')).toBeVisible();
    await expect(dialog.getByTestId('central-auth-return')).toBeVisible();
    await dialog.getByTestId('central-auth-return').click();
    await expect(dialog.getByTestId('central-auth-panel')).toBeVisible();
    await expect(dialog.getByTestId('auth-form-email')).toHaveCount(0);
    await expect(dialog.getByTestId('auth-form-password')).toHaveCount(0);
    await closeAuth(page);
  });
});

test.describe('Chatbot：执行、只读与批量确认是真实写入语义', () => {
  test('普通单条写入自动执行，切换只读后绝不写入', async ({ page, request }) => {
    await mkdir(EVIDENCE, { recursive: true });
    await resetStubAt(request);
    await openApp(page, '/');
    await configureEndpoint(page, {
      endpoint: STUB_ENDPOINT,
      model: 'stub-model',
      capabilities: ['tool_calling'],
      features: ['tool-calling'],
    });
    await switchView(page, '任务');

    const title = `执行档真实任务-${Date.now()}`;
    await page.getByTestId('ai-assistant-input').fill(`新建任务：${title}`);
    await page.getByTestId('ai-assistant-send-button').click();
    await expect(page.getByTestId('ai-assistant-disclosure')).toBeVisible();
    await expectNoStubCallAt(request);
    await page.getByTestId('ai-assistant-send').click();
    await expect(rowFor(page, title)).toHaveCount(1);
    await expect(page.getByTestId('ai-chat-proposal')).toHaveCount(0);
    await screenshot(page, 'ai-execute-created');

    await openSettingsSheet(page);
    await selectSettingsSection(page, 'ai');
    await page.locator('[data-testid="assistant-tier-read-only"] input').check();
    await page.getByTestId('settings-sheet-close').click();

    const readOnlyTitle = `只读不应创建-${Date.now()}`;
    await resetStubAt(request);
    await page.getByTestId('ai-assistant-input').fill(`新建任务：${readOnlyTitle}`);
    await page.getByTestId('ai-assistant-send-button').click();
    // 首次发送已经完成过出境披露；只读档随后直接执行只读请求，但绝不产生写入。
    await expect(page.getByTestId('ai-chat-assistant')).toBeVisible();
    await expect(rowFor(page, readOnlyTitle)).toHaveCount(0);
    await expect(page.getByTestId('ai-chat-proposal')).toHaveCount(0);
    await screenshot(page, 'ai-read-only-no-write');
  });

  test('批量完成在确认前不写，确认后通过真实 op-log 完成两条任务', async ({ page, request }) => {
    await mkdir(EVIDENCE, { recursive: true });
    await resetStubAt(request);
    await openApp(page, '/');
    await configureEndpoint(page, {
      endpoint: STUB_ENDPOINT,
      model: 'stub-model',
      capabilities: ['tool_calling'],
      features: ['tool-calling'],
    });
    await switchView(page, '任务');

    const first = `批量任务甲-${Date.now()}`;
    const second = `批量任务乙-${Date.now()}`;
    await addTask(page, first);
    await addTask(page, second);
    const ids = [await taskId(page, first), await taskId(page, second)];

    // 仍使用已启动的 stub-provider 端点；只为这一条响应补上批量工具调用，
    // 最终是否落库由真实 app-host / op-log 决定。
    await page.route(`${STUB_ENDPOINT}/chat/completions`, async (route) => {
      const body = JSON.parse(route.request().postData() ?? '{}') as {
        messages?: readonly { role?: string; content?: unknown }[];
      };
      const user = (body.messages ?? [])
        .filter((message) => message.role === 'user')
        .map((message) => String(message.content ?? ''))
        .join('\n');
      if (!user.includes('批量完成任务：')) {
        await route.continue();
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: 'auth-simple-batch',
          object: 'chat.completion',
          model: 'stub-model',
          choices: [{
            index: 0,
            message: {
              role: 'assistant',
              content: null,
              tool_calls: [{
                id: 'batch-call',
                type: 'function',
                function: {
                  name: 'complete_task',
                  arguments: JSON.stringify({ taskIds: ids }),
                },
              }],
            },
            finish_reason: 'tool_calls',
          }],
        }),
      });
    });

    await page.getByTestId('ai-assistant-input').fill(`批量完成任务：${ids.join(',')}`);
    await page.getByTestId('ai-assistant-send-button').click();
    await expect(page.getByTestId('ai-assistant-disclosure')).toBeVisible();
    await page.getByTestId('ai-assistant-send').click();
    await expect(page.getByTestId('ai-chat-proposal').last()).toBeVisible();
    await expect(rowFor(page, first).getByRole('checkbox')).toHaveAttribute('aria-checked', 'false');
    await expect(rowFor(page, second).getByRole('checkbox')).toHaveAttribute('aria-checked', 'false');
    await screenshot(page, 'ai-batch-before-confirm');

    await page.getByTestId('ai-chat-confirm').click();
    // 已完成任务会从收集箱移到侧栏的“已完成”智能清单，再验证真实物化状态。
    await page.getByRole('button', { name: /已完成/ }).click();
    await expect(rowFor(page, first).getByRole('checkbox')).toHaveAttribute('aria-checked', 'true');
    await expect(rowFor(page, second).getByRole('checkbox')).toHaveAttribute('aria-checked', 'true');
    await screenshot(page, 'ai-batch-confirmed');
  });
});

async function resetStubAt(request: import('@playwright/test').APIRequestContext): Promise<void> {
  const response = await request.get(`${STUB_ORIGIN}/__reset`);
  expect(response.ok(), 'stub-provider reset 必须可用').toBe(true);
}

async function expectNoStubCallAt(request: import('@playwright/test').APIRequestContext): Promise<void> {
  const response = await request.get(`${STUB_ORIGIN}/__requests`);
  expect(response.ok()).toBe(true);
  const body = (await response.json()) as { count?: number };
  expect(body.count ?? -1, '披露确认前不应请求 stub-provider').toBe(0);
}
