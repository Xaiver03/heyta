/**
 * 确认卡上的那句话（W11 批量完成）
 * =================================
 *
 * `intentText()` 是整套确认机制**唯一**在用户点下去之前告诉他"将要发生什么"的地方，
 * 而它没有 `default` 分支是刻意的（漏改 = 编译不过，而不是卡片上一片空白）。
 *
 * 这里钉三件事：
 * 1. 批量那句说的是**条数**，不是 id —— 一屏 20 串 id 用户读不动；
 * 2. 批量那句里**不许出现 id**（这条比第 1 条更有牙齿：它拦的是"顺手把 id 列表拼进去"）；
 * 3. 单条那句逐字不变 —— 批量是一个新参数，不是把旧文案改掉。
 *
 * ⚠️ 中英两档各测一次，是因为漏登记英文词条的症状恰好是"打印出键名本身"，
 * 那种卡片是中文用户看得见、英文用户看不懂的混合体。
 */

import { translate, type I18nValue, type MessageKey, type MessageVars } from '@heyta/i18n';
import { describe, expect, it } from 'vitest';

import { intentText } from '../src/features/ai/AiToolRun.js';

const tZh: I18nValue['t'] = (key: MessageKey, vars?: MessageVars) => translate('zh-CN', key, vars);
const tEn: I18nValue['t'] = (key: MessageKey, vars?: MessageVars) => translate('en', key, vars);

describe('intentText：批量完成', () => {
  it('🔴 批量那句报的是条数（逐字）', () => {
    expect(
      intentText({ action: 'complete-tasks', taskIds: ['a', 'b', 'c'] }, tZh),
    ).toBe('把这 3 个任务标记完成');
    expect(
      intentText({ action: 'complete-tasks', taskIds: ['a', 'b'] }, tEn),
    ).toBe('Mark 2 tasks as done');
  });

  it('🔴 批量那句里不许出现任何一个 id', () => {
    const text = intentText(
      { action: 'complete-tasks', taskIds: ['task-001', 'task-002', 'task-003'] },
      tZh,
    );
    expect(text).not.toContain('task-001');
    expect(text).not.toContain('task-002');
    expect(text).toContain('3');
  });

  it('单条那句逐字不变（批量没有把它改掉）', () => {
    expect(intentText({ action: 'complete-task', taskId: 't1' }, tZh)).toBe('把任务 t1 标记完成');
    expect(intentText({ action: 'complete-task', taskId: 't1' }, tEn)).toBe('Mark task t1 as done');
  });

  it('词条不是键名回显（漏登记英文词条的症状就是这个）', () => {
    const zh = tZh('web.ai.tools.intentCompleteBatch', { count: '7' });
    const en = tEn('web.ai.tools.intentCompleteBatch', { count: '7' });
    expect(zh).not.toBe('web.ai.tools.intentCompleteBatch');
    expect(en).not.toBe('web.ai.tools.intentCompleteBatch');
    expect(en).toContain('7');
  });
});

describe('intentText：追加任务清单', () => {
  it('预览同时显示任务 id 与所有追加条目', () => {
    expect(
      intentText(
        { action: 'append-task-checklist', taskId: 'task-1', items: ['准备说明', '通知团队'] },
        tZh,
      ),
    ).toBe('给任务 task-1 追加清单：准备说明、通知团队');
    expect(
      intentText(
        { action: 'append-task-checklist', taskId: 'task-1', items: ['准备说明', '通知团队'] },
        tEn,
      ),
    ).toBe('Append checklist items to task task-1: 准备说明、通知团队');
  });
});

describe('intentText：批量改优先级', () => {
  it('预览逐条列出任务 id 与优先级', () => {
    const intent = {
      action: 'set-task-priorities' as const,
      entries: [
        { taskId: 'task-1', priority: 'high' },
        { taskId: 'task-2', priority: 'low' },
        { taskId: 'task-3', priority: 'mystery' },
      ],
    };
    expect(intentText(intent, tZh)).toBe('把这些任务的优先级改为：task-1 → 高、task-2 → 低、task-3 → mystery');
    expect(intentText(intent, tEn)).toBe('Set these task priorities: task-1 → High、task-2 → Low、task-3 → mystery');
  });
});
