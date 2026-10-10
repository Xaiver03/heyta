/**
 * 对话助手：写工具原子性浏览器旅程
 * =================================
 *
 * 这条用例把三个高风险任务写工具串成一条真浏览器路径：
 *   1. 真 UI 建任务并读出行上的真实 id；
 *   2. 助手分别提出追加清单、批量优先级、估时三个提案；
 *   3. 每次确认前都证明没有新 op，确认后恰好只落一条 op。
 *
 * 模型响应由 stub-provider 的 QA_TOOL 哨兵固定，浏览器、IndexedDB、op-log
 * 与 app-host 的参数校验/确认/提交链都是真实的。
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

import {
  addTask,
  configureEndpoint,
  openApp,
  resetStub,
  rowFor,
  switchView,
  waitForStubCalls,
} from './helpers.js';

const EVIDENCE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../apps/web/evidence/ux-round6/tool-journey',
);

type StoreSnapshot = {
  opCount: number;
  ops: readonly Record<string, unknown>[];
  task: Record<string, unknown> | undefined;
};

/** 只读地从应用页侧加载 op-log 模块；不通过 UI 私有状态读数。 */
async function readStore(page: Page, taskId: string): Promise<StoreSnapshot> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      return await page.evaluate(async (id) => {
        const { currentState, readRecentOps } = await import('/src/lib/oplog.ts');
        const state = currentState();
        const ops = await readRecentOps();
        return {
          opCount: ops.length,
          ops: ops.slice(-8) as unknown as Record<string, unknown>[],
          task: state.tasks[id] as unknown as Record<string, unknown> | undefined,
        };
      }, taskId);
    } catch (error) {
      // The app intentionally renders only after initOpLog(), but the first
      // UI row can briefly race the module's recovered engine in dev mode.
      // Retry only that known cold-start condition; other page errors remain
      // loud.
      if (!String(error).includes('op-log 引擎尚未初始化')) throw error;
      await page.waitForTimeout(50);
    }
  }
  throw new Error('op-log 引擎在有界等待后仍未初始化');
}

function qaTool(name: string, args: Record<string, unknown>): string {
  return `QA_TOOL:${JSON.stringify({ name, arguments: args })}`;
}

async function submitProposal(
  page: Page,
  request: APIRequestContext,
  taskId: string,
  name: string,
  args: Record<string, unknown>,
  expectedProposal: string,
  before: StoreSnapshot,
  expectedStubCalls: number,
  forbiddenProposal?: string,
): Promise<StoreSnapshot> {
  const input = page.getByTestId('ai-assistant-input');
  await input.fill(qaTool(name, args));
  await page.getByTestId('ai-assistant-send-button').click();
  const disclosure = page.getByTestId('ai-assistant-disclosure');
  if (await disclosure.isVisible().catch(() => false)) {
    await page.getByTestId('ai-assistant-send').click();
  }

  const proposal = page.getByTestId('ai-chat-proposal').last();
  await expect(proposal).toBeVisible();
  await expect(proposal).toContainText(expectedProposal);
  if (forbiddenProposal !== undefined) {
    await expect(proposal).not.toContainText(forbiddenProposal);
  }
  await waitForStubCalls(request, expectedStubCalls);

  // A model proposal is not an op. This is deliberately checked before the
  // only confirmation button is clicked.
  await expect
    .poll(async () => (await readStore(page, taskId)).opCount)
    .toBe(before.opCount);

  await page.getByTestId('ai-chat-confirm').click();
  await expect(page.getByTestId('ai-chat-confirmed').last()).toBeVisible();
  await expect
    .poll(async () => (await readStore(page, taskId)).opCount)
    .toBe(before.opCount + 1);
  return readStore(page, taskId);
}

test.describe('助手高风险写工具：提案与 op 原子性', () => {
  test('清单追加 → 批量优先级 → 夹取且幂等估时', async ({ page, request }) => {
    await fs.mkdir(EVIDENCE, { recursive: true });
    await resetStub(request);
    await openApp(page, '/', 'accepted');
    await configureEndpoint(page, {
      capabilities: ['tool_calling'],
      features: ['tool-calling'],
    });
    await switchView(page, '任务');

    const title = '原子工具旅程任务';
    await addTask(page, title);
    const row = rowFor(page, title);
    const rowTestId = await row.getAttribute('data-testid');
    expect(rowTestId, '任务行必须暴露真实 task id').toMatch(/^task-item-.+/u);
    const taskId = rowTestId!.slice('task-item-'.length);
    const peerTitle = '原子工具批量任务';
    await addTask(page, peerTitle);
    const peerRowTestId = await rowFor(page, peerTitle).getAttribute('data-testid');
    expect(peerRowTestId, '批量任务行必须暴露真实 task id').toMatch(/^task-item-.+/u);
    const peerTaskId = peerRowTestId!.slice('task-item-'.length);

    // 先用真 UI 写一段已有备注，后面的两个 note 写工具必须保留它。
    await row.locator('[data-testid^="task-row-"]').click();
    const note = page.getByTestId('task-note-input');
    await expect(note).toBeVisible();
    await note.fill('已有备注');
    await note.evaluate((element) => (element as HTMLElement).blur());
    await expect.poll(async () => (await readStore(page, taskId)).task?.note).toBe('已有备注');
    // Selecting a task opens the detail column, which intentionally replaces the
    // assistant surface. Collapse that real UI pane before continuing the
    // assistant journey.
    await page.getByTestId('detail-pane-toggle').click();
    await page.getByTestId('rail-assistant').click();
    await expect(page.getByTestId('ai-agent-surface')).toBeVisible();

    const evidence: Record<string, unknown> = {
      taskId,
      peerTaskId,
      rowTestId,
      peerRowTestId,
      stages: [],
    };
    let before = await readStore(page, taskId);
    expect(before.task?.note).toBe('已有备注');

    const checklist = await submitProposal(
      page,
      request,
      taskId,
      'append_task_checklist',
      { taskId, items: ['检查登录流程'] },
      '检查登录流程',
      before,
      1,
    );
    expect(checklist.task?.note).toContain('已有备注');
    expect(checklist.task?.note).toContain('检查登录流程');
    (evidence.stages as unknown[]).push({
      name: 'append_task_checklist',
      before,
      after: checklist,
      opDelta: checklist.opCount - before.opCount,
    });
    await page.screenshot({ path: path.join(EVIDENCE, '01-checklist-confirmed.png'), fullPage: true });

    before = checklist;
    const priority = await submitProposal(
      page,
      request,
      taskId,
      'set_task_priorities',
      { entries: [{ taskId, priority: 'high' }, { taskId: peerTaskId, priority: 'low' }] },
      '高',
      before,
      2,
    );
    expect(priority.task?.priority).toBe(3);
    expect(priority.task?.note).toBe(checklist.task?.note);
    const peerPriority = await readStore(page, peerTaskId);
    expect(peerPriority.task?.priority).toBe(1);
    const priorityOp = priority.ops.at(-1);
    expect(priorityOp?.opType).toBe('BATCH');
    const priorityPayload = priorityOp?.payload as Record<string, unknown> | undefined;
    expect(priorityPayload?.heytaTaskPriorityBatch).toBe(1);
    expect(priorityPayload?.items).toHaveLength(2);
    (evidence.stages as unknown[]).push({
      name: 'set_task_priorities',
      before,
      after: priority,
      opDelta: priority.opCount - before.opCount,
    });
    await page.screenshot({ path: path.join(EVIDENCE, '02-priority-confirmed.png'), fullPage: true });

    before = priority;
    const estimate = await submitProposal(
      page,
      request,
      taskId,
      'set_task_estimate',
      { taskId, minutes: 999 },
      '480',
      before,
      3,
      '999',
    );
    expect(estimate.task?.note).toContain('已有备注');
    expect(estimate.task?.note).toContain('检查登录流程');
    expect(estimate.task?.note).toContain('预计耗时：480 分钟');
    (evidence.stages as unknown[]).push({
      name: 'set_task_estimate-clamped',
      before,
      after: estimate,
      opDelta: estimate.opCount - before.opCount,
    });
    await page.screenshot({ path: path.join(EVIDENCE, '03-estimate-confirmed.png'), fullPage: true });

    // Repeating the same out-of-range request resolves to the same canonical
    // 480-minute note and therefore must not manufacture another op.
    const idempotentBefore = estimate;
    const input = page.getByTestId('ai-assistant-input');
    await input.fill(qaTool('set_task_estimate', { taskId, minutes: 999 }));
    await page.getByTestId('ai-assistant-send-button').click();
    await expect(page.getByTestId('ai-chat-proposal').last()).toBeVisible();
    await waitForStubCalls(request, 4);
    await expect.poll(async () => (await readStore(page, taskId)).opCount).toBe(idempotentBefore.opCount);
    await page.getByTestId('ai-chat-confirm').click();
    await expect(page.getByTestId('ai-chat-confirmed').last()).toBeVisible();
    const idempotentAfter = await readStore(page, taskId);
    expect(idempotentAfter.opCount).toBe(idempotentBefore.opCount);
    expect(idempotentAfter.task?.note).toBe(idempotentBefore.task?.note);
    (evidence.stages as unknown[]).push({
      name: 'set_task_estimate-idempotent-repeat',
      before: idempotentBefore,
      after: idempotentAfter,
      opDelta: idempotentAfter.opCount - idempotentBefore.opCount,
    });
    await page.screenshot({ path: path.join(EVIDENCE, '04-estimate-idempotent.png'), fullPage: true });

    await fs.writeFile(
      path.join(EVIDENCE, 'journey.json'),
      `${JSON.stringify(evidence, null, 2)}\n`,
      'utf8',
    );
  });
});
