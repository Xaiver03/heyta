/**
 * Web 助手跨页面验收：运行中请求与未确认提案。
 *
 * 这两条用例刻意不读 React 私有状态，也不靠固定 sleep：模型响应由
 * stub-provider 的可控屏障锁住，页面只通过真实导航、真实 DOM 和真实 op-log
 * 观察状态。范围是 Web 浏览器，不代表原生移动端已验。
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test, type Page } from '@playwright/test';

import {
  addTask,
  closeSettingsSheet,
  configureEndpoint,
  openApp,
  openSettingsSheet,
  rowFor,
  resetStub,
  setStubBarrier,
  switchTheme,
  switchView,
  waitForStubCalls,
} from './helpers.js';

const EVIDENCE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../apps/web/evidence/ux-final-20261008/assistant-navigation',
);

type StoreSnapshot = {
  readonly opCount: number;
  readonly task: Record<string, unknown> | undefined;
};

async function readStore(page: Page, taskId: string): Promise<StoreSnapshot> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      return await page.evaluate(async (id) => {
        const { currentState, readRecentOps } = await import('/src/lib/oplog.ts');
        const state = currentState();
        const ops = await readRecentOps();
        return {
          opCount: ops.length,
          task: state.tasks[id] as unknown as Record<string, unknown> | undefined,
        };
      }, taskId);
    } catch (error) {
      if (!String(error).includes('op-log 引擎尚未初始化')) throw error;
      await page.waitForTimeout(50);
    }
  }
  throw new Error('op-log 引擎在有界等待后仍未初始化');
}

function qaTool(name: string, args: Record<string, unknown>): string {
  return `QA_TOOL:${JSON.stringify({ name, arguments: args })}`;
}

async function taskIdFor(page: Page, title: string): Promise<string> {
  const testId = await rowFor(page, title).getAttribute('data-testid');
  expect(testId, '任务行必须暴露真实 task id').toMatch(/^task-item-.+/u);
  return testId!.slice('task-item-'.length);
}

test.describe('Web 助手跨页面状态验收', () => {
  test('运行中请求跨日历返回仍在等待，释放后只完成一轮', async ({ page, request }) => {
    await fs.mkdir(EVIDENCE, { recursive: true });
    await resetStub(request);
    await setStubBarrier(request, 'reset');
    await openApp(page, '/', 'accepted');
    await configureEndpoint(page, {
      capabilities: ['tool_calling'],
      features: ['tool-calling'],
    });
    await switchView(page, '任务');

    // 锁住第一轮模型响应，确保观察到真实 running，而不是猜一个时间点。
    await setStubBarrier(request, 'hold');
    await page.getByTestId('ai-assistant-input').fill('跨日历保持运行中的请求');
    await page.getByTestId('ai-assistant-send-button').click();
    await expect(page.getByTestId('ai-assistant-disclosure')).toBeVisible();
    await page.getByTestId('ai-assistant-send').click();
    await waitForStubCalls(request, 1);
    await expect(page.getByTestId('ai-assistant-waiting')).toBeVisible();
    await expect(page.getByTestId('ai-chat-user')).toContainText('跨日历保持运行中的请求');
    await page.screenshot({ path: path.join(EVIDENCE, 'running-light.png'), fullPage: true });

    // 真导航离开任务页。Provider 仍持有 running；返回后不能把请求伪装成 idle。
    await switchView(page, '日历');
    await expect(page.locator('.ht-header__title').first()).toHaveText('日历');
    await switchView(page, '任务');
    await expect(page.getByTestId('ai-assistant-waiting')).toBeVisible();
    await expect(page.getByTestId('ai-chat-assistant')).toHaveCount(0);
    await expect(page.getByTestId('ai-assistant-send-button')).toBeDisabled();

    // 同一状态再取一份暗色证据；切主题走真实设置入口。
    await switchTheme(page, 'dark');
    await expect(page.getByTestId('ai-assistant-waiting')).toBeVisible();
    await page.screenshot({ path: path.join(EVIDENCE, 'running-dark.png'), fullPage: true });

    // 放行第一轮；第二轮工具结果请求也必须完成，且只能出现一轮读循环。
    await setStubBarrier(request, 'release');
    const log = await waitForStubCalls(request, 2);
    expect(log.calls[0]?.feature).toBe('assistant');
    expect(log.calls[0]?.hasToolResult).toBe(false);
    expect(log.calls[1]?.feature).toBe('assistant');
    expect(log.calls[1]?.hasToolResult).toBe(true);
    expect(log.calls[1]?.toolStep).toBe(1);
    await expect(page.getByTestId('ai-assistant-waiting')).toHaveCount(0);
    await expect(page.getByTestId('ai-chat-assistant')).toHaveCount(1);
    const assistantCountAfterRelease = await page.getByTestId('ai-chat-assistant').count();
    await page.screenshot({ path: path.join(EVIDENCE, 'running-completed-dark.png'), fullPage: true });
    await fs.writeFile(
      path.join(EVIDENCE, 'running-journey.json'),
      `${JSON.stringify({
        route: ['任务', '日历', '任务'],
        light: 'running',
        dark: 'running',
        stubCalls: log.count,
        toolSteps: log.calls.map((call) => call.toolStep ?? 0),
        assistantCountAfterRelease,
        result: assistantCountAfterRelease === 1
          ? 'completed-after-release'
          : 'response-lost-after-cross-view-remount',
      }, null, 2)}\n`,
      'utf8',
    );
    await expect(page.getByTestId('ai-chat-assistant').last()).toContainText('假端点收到 1 条工具结果');
  });

  test('待确认高风险提案跨设置返回可确认，且只写一条 op', async ({ page, request }) => {
    await fs.mkdir(EVIDENCE, { recursive: true });
    await resetStub(request);
    await setStubBarrier(request, 'reset');
    await openApp(page, '/', 'accepted');
    await configureEndpoint(page, {
      capabilities: ['tool_calling'],
      features: ['tool-calling'],
    });
    await switchView(page, '任务');

    const title = '跨设置返回的高风险提案任务';
    await addTask(page, title);
    const taskId = await taskIdFor(page, title);
    const before = await readStore(page, taskId);
    const checklistItem = '跨设置返回后只确认一次';

    await page
      .getByTestId('ai-assistant-input')
      .fill(qaTool('append_task_checklist', { taskId, items: [checklistItem] }));
    await page.getByTestId('ai-assistant-send-button').click();
    await expect(page.getByTestId('ai-assistant-disclosure')).toBeVisible();
    await page.getByTestId('ai-assistant-send').click();
    await waitForStubCalls(request, 1);

    const proposal = page.getByTestId('ai-chat-proposal').last();
    await expect(proposal).toBeVisible();
    await expect(proposal).toContainText(checklistItem);
    await expect(page.getByTestId('ai-chat-confirm')).toBeVisible();
    await expect(page.getByTestId('ai-chat-expired')).toHaveCount(0);
    await expect.poll(async () => (await readStore(page, taskId)).opCount).toBe(before.opCount);
    await page.screenshot({ path: path.join(EVIDENCE, 'proposal-light.png'), fullPage: true });

    // 设置是实际的跨页面表面；返回任务面后，依据与确认按钮必须仍在。
    await openSettingsSheet(page);
    await closeSettingsSheet(page);
    await switchView(page, '日历');
    await switchView(page, '任务');
    await expect(page.getByTestId('ai-chat-proposal').last()).toBeVisible();
    await expect(page.getByTestId('ai-chat-confirm')).toBeVisible();
    await expect(page.getByTestId('ai-chat-expired')).toHaveCount(0);

    await page.getByTestId('ai-chat-confirm').click();
    await expect(page.getByTestId('ai-chat-confirmed').last()).toBeVisible();
    await expect(page.getByTestId('ai-chat-confirm')).toHaveCount(0);
    // 暗色也取真实 UI 状态证据；确认完成后不再改变单 op 判据的时序。
    await switchTheme(page, 'dark');
    await expect(page.getByTestId('ai-chat-confirmed').last()).toBeVisible();
    await page.screenshot({ path: path.join(EVIDENCE, 'proposal-dark.png'), fullPage: true });

    await expect.poll(async () => (await readStore(page, taskId)).opCount).toBe(before.opCount + 1);
    const after = await readStore(page, taskId);
    expect(after.task?.note).toContain(checklistItem);
    const opDelta = after.opCount - before.opCount;

    await fs.writeFile(
      path.join(EVIDENCE, 'proposal-journey.json'),
      `${JSON.stringify({
        route: ['任务', '设置/显示', '任务', '日历', '任务'],
        light: 'proposal-confirmable',
        dark: 'proposal-confirmable',
        opCountBefore: before.opCount,
        opCountAfter: after.opCount,
        taskNoteAfter: after.task?.note,
        opDelta,
        result: 'one-confirmation-one-op',
      }, null, 2)}\n`,
      'utf8',
    );
  });
  test('长网址与连续文字在窄助手栏内完整换行，不从左侧裁切', async ({ page, request }) => {
    await fs.mkdir(EVIDENCE, { recursive: true });
    await resetStub(request);
    await setStubBarrier(request, 'reset');
    await openApp(page, '/', 'accepted');
    await configureEndpoint(page, { capabilities: ['tool_calling'], features: ['tool-calling'] });
    await switchView(page, '任务');
    const longUrl = `https://example.com/research/${'abcdefghij'.repeat(10)}`;
    const continuousText = 'LongUnbrokenReference'.repeat(8);
    await page.getByTestId('ai-assistant-input').fill(`请整理这个链接：${longUrl}\n参考编号：${continuousText}`);
    await page.getByTestId('ai-assistant-send-button').click();
    await page.getByTestId('ai-assistant-send').click();
    await expect(page.getByTestId('ai-chat-assistant')).toBeVisible();
    const measurements: unknown[] = [];
    for (const theme of ['light', 'dark'] as const) {
      if (await page.locator('html').getAttribute('data-theme') !== theme) await switchTheme(page, theme);
      for (const width of [1280, 1050]) {
        await page.setViewportSize({ width, height: 800 });
        const user = page.getByTestId('ai-chat-user');
        await expect(user).toContainText(longUrl);
        await expect(user).toContainText(continuousText);
        const geometry = await user.evaluate((element) => {
          const conversation = element.closest('[data-testid="ai-assistant-conversation"]')!;
          const bounds = conversation.getBoundingClientRect();
          const bubble = element.getBoundingClientRect();
          return {
            left: bubble.left, right: bubble.right, containerLeft: bounds.left, containerRight: bounds.right,
            clientWidth: conversation.clientWidth, scrollWidth: conversation.scrollWidth,
            bubbleClientWidth: element.clientWidth, bubbleScrollWidth: element.scrollWidth,
          };
        });
        expect(geometry.left).toBeGreaterThanOrEqual(geometry.containerLeft - 1);
        expect(geometry.right).toBeLessThanOrEqual(geometry.containerRight + 1);
        expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.clientWidth + 1);
        expect(geometry.bubbleScrollWidth).toBeLessThanOrEqual(geometry.bubbleClientWidth + 1);
        measurements.push({ theme, width, ...geometry });
        await page.screenshot({ path: path.join(EVIDENCE, `long-message-${theme}-${width}.png`), fullPage: true });
      }
    }
    await fs.writeFile(path.join(EVIDENCE, 'long-message-geometry.json'), `${JSON.stringify(measurements, null, 2)}\n`);
  });

  test('默认本机历史在刷新后恢复，且恢复不产生模型请求', async ({ page, request }) => {
    await fs.mkdir(EVIDENCE, { recursive: true });
    await resetStub(request);
    await setStubBarrier(request, 'reset');
    await openApp(page, '/', 'accepted');
    await configureEndpoint(page, { capabilities: ['tool_calling'], features: ['tool-calling'] });
    await switchView(page, '任务');
    const prompt = '刷新后保留的本机对话';
    await page.getByTestId('ai-assistant-input').fill(prompt);
    await page.getByTestId('ai-assistant-send-button').click();
    await page.getByTestId('ai-assistant-send').click();
    await expect(page.getByTestId('ai-chat-assistant')).toHaveCount(1);
    const before = await waitForStubCalls(request, 2);
    const savedKeys = await page.evaluate(() => Object.keys(localStorage).filter((key) => key.startsWith('heyta.ai.assistant.history')));
    await page.reload();
    await expect(page.getByTestId('ai-assistant-input')).toBeVisible();
    const afterReloadCount = await page.getByTestId('ai-chat-assistant').count();
    await fs.writeFile(path.join(EVIDENCE, 'history-refresh-journey.json'), `${JSON.stringify({ savedKeys, beforeCalls: before.count, afterReloadCount }, null, 2)}\n`);
    await page.screenshot({ path: path.join(EVIDENCE, 'history-after-refresh.png'), fullPage: true });
    await expect(page.getByTestId('ai-chat-user')).toContainText(prompt);
    await expect(page.getByTestId('ai-chat-assistant')).toHaveCount(1);
    const after = await waitForStubCalls(request, 2);
    expect(after.count).toBe(before.count);
  });

  test('刷新后的危险提案仅供查看，不能直接复执行且不新增 op', async ({ page, request }) => {
    await fs.mkdir(EVIDENCE, { recursive: true });
    await resetStub(request);
    await setStubBarrier(request, 'reset');
    await openApp(page, '/', 'accepted');
    await configureEndpoint(page, { capabilities: ['tool_calling'], features: ['tool-calling'] });
    await switchView(page, '任务');
    const title = '刷新前尚未确认的任务';
    await addTask(page, title);
    const taskId = await taskIdFor(page, title);
    const before = await readStore(page, taskId);
    await page.getByTestId('ai-assistant-input').fill(qaTool('append_task_checklist', { taskId, items: ['不能刷新复执行'] }));
    await page.getByTestId('ai-assistant-send-button').click();
    await page.getByTestId('ai-assistant-send').click();
    await expect(page.getByTestId('ai-chat-confirm')).toBeVisible();
    await page.reload();
    await expect(page.getByTestId('ai-chat-expired')).toBeVisible();
    await expect(page.getByTestId('ai-assistant-conversation')).not.toContainText('需要你确认');
    await expect(page.getByTestId('ai-assistant-conversation')).not.toContainText('等你确认');
    await expect(page.getByTestId('ai-chat-confirm')).toHaveCount(0);
    const after = await readStore(page, taskId);
    expect(after.opCount).toBe(before.opCount);
    expect(after.task?.note ?? '').not.toContain('不能刷新复执行');
    const log = await waitForStubCalls(request, 1);
    expect(log.count).toBe(1);
    await page.screenshot({ path: path.join(EVIDENCE, 'history-expired-proposal.png'), fullPage: true });
    await fs.writeFile(path.join(EVIDENCE, 'history-expired-proposal.json'), `${JSON.stringify({ before, after, modelCalls: log.count, confirmButtons: 0 }, null, 2)}\n`);
  });

  for (const servers of [
    { label: '不同域名', a: 'https://history-a.example', b: 'https://history-b.example', suffix: '' },
    { label: '同域不同路径', a: 'https://history.example/team-a', b: 'https://history.example/team-b/', suffix: '-paths' },
  ]) {
  test(`账号同槽切换与真实退出隔离历史，同邮箱${servers.label}也不串会话`, async ({ page, request }) => {
    await fs.mkdir(EVIDENCE, { recursive: true });
    await resetStub(request);
    await setStubBarrier(request, 'reset');
    await openApp(page, '/', 'accepted');
    await configureEndpoint(page, { capabilities: ['tool_calling'], features: ['tool-calling'] });
    await switchView(page, '任务');
    // 认证服务不属此用例：注入已认证身份夹具，随后使用真实 store 通知与真实退出按钮。
    const selectIdentity = async (server: string): Promise<void> => {
      await page.evaluate(async (baseUrl) => {
        const { useSyncStore } = await import('/src/features/sync/store.ts');
        const { saveCredentials } = await import('/src/features/sync/credential-storage.ts');
        const identity = { baseUrl, token: 'history-qa-token', email: 'history@example.com', accountId: 'history-qa-account' };
        saveCredentials(identity);
        useSyncStore.setState(identity);
      }, server);
    };
    await selectIdentity(servers.a);
    await page.getByTestId('ai-assistant-input').fill('仅属于服务器 A 的本机历史');
    await page.getByTestId('ai-assistant-send-button').click();
    await page.getByTestId('ai-assistant-send').click();
    await expect(page.getByTestId('ai-chat-assistant')).toHaveCount(1);
    await page.getByTestId('ai-assistant-input').fill('A 还没发出的草稿');
    await selectIdentity(servers.b);
    await expect(page.getByTestId('ai-chat-user')).toHaveCount(0);
    await expect(page.getByTestId('ai-assistant-input')).toHaveValue('');
    await page.getByTestId('ai-assistant-input').fill('B 临时草稿');
    await page.getByTestId('account-menu-avatar').click();
    await page.getByTestId('account-menu-signout').click();
    await expect(page.getByTestId('ai-assistant-input')).toHaveValue('');
    await expect(page.getByTestId('ai-chat-user')).toHaveCount(0);
    const loggedOut = await page.evaluate(() => localStorage.getItem('heyta.sync.credentials') === null);
    expect(loggedOut).toBe(true);
    await selectIdentity(servers.a);
    await expect(page.getByTestId('ai-chat-user')).toContainText('仅属于服务器 A 的本机历史');
    await expect(page.getByTestId('ai-assistant-input')).toHaveValue('');
    const log = await waitForStubCalls(request, 2);
    expect(log.count).toBe(2);
    const historyKeys = await page.evaluate(() => Object.keys(localStorage).filter((key) => key.startsWith('heyta.ai.assistant.history')));
    await fs.writeFile(path.join(EVIDENCE, `history-account-isolation${servers.suffix}.json`), `${JSON.stringify({ path: [servers.a, servers.b, 'real-signout', servers.a], loggedOut, historyKeys, modelCalls: log.count }, null, 2)}\n`);
    await page.screenshot({ path: path.join(EVIDENCE, `history-account-return${servers.suffix}.png`), fullPage: true });
  });
  }

  test('凭据及历史落盘因配额失败，真实运行时登录会话仍收到助手回答', async ({ page, request }) => {
    await fs.mkdir(EVIDENCE, { recursive: true });
    await resetStub(request);
    await setStubBarrier(request, 'reset');
    await openApp(page, '/', 'accepted');
    await configureEndpoint(page, { capabilities: ['tool_calling'], features: ['tool-calling'] });
    await switchView(page, '任务');
    await page.evaluate(async () => {
      const { useSyncStore } = await import('/src/features/sync/store.ts');
      Storage.prototype.setItem = () => { throw new DOMException('Audit quota exhaustion', 'QuotaExceededError'); };
      useSyncStore.getState().applyAuthToken('https://history-quota.example', 'history-qa-token', 'quota@example.com', 'quota-qa-account');
    });
    await page.getByTestId('ai-assistant-input').fill('存储写满后仍能接收助手回答');
    await page.getByTestId('ai-assistant-send-button').click();
    await page.getByTestId('ai-assistant-send').click();
    await expect(page.getByTestId('ai-chat-assistant')).toHaveCount(1);
    await expect(page.getByTestId('ai-assistant-waiting')).toHaveCount(0);
    const state = await page.evaluate(async () => {
      const { useSyncStore } = await import('/src/features/sync/store.ts');
      return {
        accountId: useSyncStore.getState().accountId,
        credentialsPersisted: localStorage.getItem('heyta.sync.credentials') !== null,
        historyKeys: Object.keys(localStorage).filter((key) => key.startsWith('heyta.ai.assistant.history')),
      };
    });
    expect(state.accountId).toBe('quota-qa-account');
    expect(state.credentialsPersisted).toBe(false);
    expect(state.historyKeys).toHaveLength(0);
    const log = await waitForStubCalls(request, 2);
    expect(log.count).toBe(2);
    await fs.writeFile(path.join(EVIDENCE, 'history-quota-runtime.json'), `${JSON.stringify({ ...state, assistantAnswers: 1, modelCalls: log.count }, null, 2)}\n`);
    await page.screenshot({ path: path.join(EVIDENCE, 'history-quota-runtime.png'), fullPage: true });
  });

  test('高级手填新令牌清除旧身份与会话，仅改加密口令仍保留草稿', async ({ page, request }) => {
    await fs.mkdir(EVIDENCE, { recursive: true });
    await resetStub(request);
    await setStubBarrier(request, 'reset');
    await openApp(page, '/', 'accepted');
    await configureEndpoint(page, { capabilities: ['tool_calling'], features: ['tool-calling'] });
    await switchView(page, '任务');
    await page.evaluate(async () => {
      const { useSyncStore } = await import('/src/features/sync/store.ts');
      useSyncStore.getState().applyAuthToken('https://history-manual.example', 'manual-qa-a', 'manual@example.com', 'manual-qa-account');
    });
    await page.getByTestId('ai-assistant-input').fill('原已核验账号的私密草稿');
    await page.evaluate(async () => {
      const { useSyncStore } = await import('/src/features/sync/store.ts');
      useSyncStore.getState().configure('https://history-manual.example', 'manual-qa-a', 'local-qa-password');
    });
    await expect(page.getByTestId('ai-assistant-input')).toHaveValue('原已核验账号的私密草稿');
    await page.evaluate(async () => {
      const { useSyncStore } = await import('/src/features/sync/store.ts');
      useSyncStore.getState().configure('https://history-manual.example', 'manual-qa-b', 'local-qa-password');
    });
    await expect(page.getByTestId('ai-assistant-input')).toHaveValue('');
    await expect(page.getByTestId('ai-chat-user')).toHaveCount(0);
    const state = await page.evaluate(async () => {
      const { useSyncStore } = await import('/src/features/sync/store.ts');
      const { currentAccount } = await import('/src/features/ai/panel-ephemeral.tsx');
      const identity = currentAccount();
      return { email: useSyncStore.getState().email ?? null, accountId: useSyncStore.getState().accountId ?? null, identity };
    });
    expect(state.email).toBeNull();
    expect(state.accountId).toBeNull();
    expect(state.identity).not.toContain('manual@example.com');
    expect(state.identity).not.toContain('manual-qa-b');
    await page.getByTestId('ai-assistant-input').fill('只属于手填令牌 B 的问题');
    await page.getByTestId('ai-assistant-send-button').click();
    await page.getByTestId('ai-assistant-send').click();
    await expect(page.getByTestId('ai-chat-assistant')).toHaveCount(1);
    const nextIdentity = await page.evaluate(async () => {
      const { useSyncStore } = await import('/src/features/sync/store.ts');
      const { currentAccount } = await import('/src/features/ai/panel-ephemeral.tsx');
      useSyncStore.getState().configure('https://history-manual.example', 'manual-qa-c', 'local-qa-password');
      return currentAccount();
    });
    expect(nextIdentity).not.toBe(state.identity);
    await expect(page.getByTestId('ai-chat-user')).toHaveCount(0);
    await expect(page.getByTestId('ai-chat-assistant')).toHaveCount(0);
    await expect(page.getByTestId('ai-assistant-input')).toHaveValue('');
    await page.getByTestId('ai-assistant-input').fill('手填 C 会话未发送的草稿');
    await page.getByTestId('account-menu-avatar').click();
    await page.getByTestId('account-menu-signout').click();
    await expect(page.getByTestId('ai-assistant-input')).toHaveValue('');
    const returnedIdentity = await page.evaluate(async () => {
      const { useSyncStore } = await import('/src/features/sync/store.ts');
      const { currentAccount } = await import('/src/features/ai/panel-ephemeral.tsx');
      useSyncStore.getState().configure('https://history-manual.example', 'manual-qa-c', 'local-qa-password');
      return currentAccount();
    });
    expect(returnedIdentity).not.toBe(nextIdentity);
    await expect(page.getByTestId('ai-assistant-input')).toHaveValue('');
    const log = await waitForStubCalls(request, 2);
    expect(log.count).toBe(2);
    await fs.writeFile(path.join(EVIDENCE, 'history-manual-credentials.json'), `${JSON.stringify({ previousIdentityCleared: state.email === null && state.accountId === null, manualScopeChanged: state.identity !== nextIdentity, logoutResetsManualScope: returnedIdentity !== nextIdentity, modelCalls: log.count }, null, 2)}\n`);
    await page.screenshot({ path: path.join(EVIDENCE, 'history-manual-credentials.png'), fullPage: true });
  });

});
