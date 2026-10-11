/**
 * 任务动作失败要有地方说话（布局审计 §8.2 第 12 条）
 * ====================================================
 *
 * 这条缺陷的形状不是"界面写了错的东西"，是**该写的时候什么都不写**：
 * `App.tsx` 那批调用点是 `void store.toggleComplete(id)` /
 * `void store.deleteTask(task.id)`，拒绝被丢掉，而 `TaskState.error`
 * 这个字段当时**只有声明、没有一处写它、也没有一处读它**。
 *
 * 所以本文件两头都要钉：
 *
 * · **store 侧**（A 组）证明确实有人*写*它 —— 用的失败是真的：
 *   引擎没起来时 `dispatch` 抛的是生产代码那句 `op-log 引擎尚未初始化`，
 *   不是测试造的假错误。第二条更关键：**下一次真的落库要把它清掉**，
 *   否则一次偶发失败会在界面上常驻，那比不说还糟。
 * · **界面侧**（B 组）证明确实有人*读*它，并且钉住三条容易漏的：
 *   没失败时不许在场（阴性对照）、不许把内部错误原文渲染出来、
 *   「知道了」只清这一格显示而不动数据。
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { I18nProvider } from '@heyta/i18n';
import { emptyState } from '@heyta/op-log';

import {
  __resetOpLogForTests,
  initOpLog,
  useTaskStore,
} from '../src/features/tasks/store.js';
import { TaskActionError } from '../src/features/tasks/TaskActionError.js';

/** 有没有汉字。用于「英文界面里不许露中文」。 */
const CJK = /[\u3400-\u4DBF\u4E00-\u9FFF]/;

let root: Root | undefined;
let container: HTMLDivElement | undefined;

function render(locale?: 'en'): HTMLDivElement {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    const tree = <TaskActionError />;
    root?.render(locale === undefined ? tree : <I18nProvider locale={locale}>{tree}</I18nProvider>);
  });
  return container;
}

function click(el: Element | null | undefined): void {
  act(() => {
    (el as HTMLElement | null)?.click();
  });
}

beforeEach(() => {
  // 引擎回到"没有"：A 组要的就是这条真实的生产失败路径。
  __resetOpLogForTests();
  useTaskStore.setState({ entities: emptyState(), filter: { kind: 'all' }, error: undefined });
});

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  container?.remove();
  root = undefined;
  container = undefined;
});

describe('A：失败真的会写进 store（不是只有界面在演）', () => {
  it('🔴 写没落库时，error 记下的是**码**，而且原始错误照样抛给调用方', async () => {
    // 引擎没初始化 ⇒ `dispatchIntent` 里 `requireEngine()` 抛。
    // 断言"抛出"是为了钉住这件事的另一半：记一笔**不等于**把错误吞掉
    //（AI 提案、小组件 drain、导入都要拿原始错误做自己的判断）。
    await expect(useTaskStore.getState().addTask('这一条不会落库')).rejects.toThrow();
    expect(useTaskStore.getState().error).toBe('write-failed');
  });

  it('🔴 失败之后真的落库成功了，这一行要自己消失（不许常驻）', async () => {
    await expect(useTaskStore.getState().addTask('第一次失败')).rejects.toThrow();
    expect(useTaskStore.getState().error, '前置：此刻确实挂着一次失败').toBe('write-failed');

    await initOpLog(`task-action-error-${Math.random().toString(36).slice(2)}`);
    await useTaskStore.getState().addTask('第二次成功');

    expect(useTaskStore.getState().error, '成功必须清掉上一条失败').toBeUndefined();
    // 而且它不是"清了 error 但也没写进去"：物化状态里真的有这一条。
    expect(Object.keys(useTaskStore.getState().entities.tasks ?? {}).length).toBe(1);
  });
});

describe('B：这一行在界面上的形状', () => {
  it('没有失败时它不在 DOM 里（阴性对照：不许常驻一条空提示）', () => {
    const el = render();
    expect(el.querySelector('[data-testid="task-action-error"]')).toBeNull();
  });

  it('🔴 失败时说得出「没有保存成功」，且**不**把内部错误原文贴给用户', () => {
    useTaskStore.setState({ error: 'write-failed' });
    const el = render();

    const alert = el.querySelector('[data-testid="task-action-error"]');
    expect(alert).not.toBeNull();
    expect(alert?.getAttribute('role')).toBe('alert');
    expect(alert?.getAttribute('aria-live')).toBe('assertive');
    const text = alert?.textContent ?? '';
    expect(text).toContain('没有保存成功');
    expect(text).toContain('重试');
    // 内部原文一旦漏进来，症状是"中文界面里冒出一句 stack 味的英文"。
    expect(text).not.toContain('op-log');
    expect(text).not.toContain('引擎');
    expect(text).not.toContain('undefined');
  });

  it('英文界面里这一行不许露汉字', () => {
    useTaskStore.setState({ error: 'write-failed' });
    const el = render('en');
    const text = el.querySelector('[data-testid="task-action-error"]')?.textContent ?? '';
    expect(text.length, '英文档也要有内容，不是空字符串蒙过正则').toBeGreaterThan(0);
    expect(CJK.test(text), `英文界面露出了中文：${text}`).toBe(false);
  });

  it('🔴「知道了」只清这一格的显示，数据状态一个字都不动', () => {
    useTaskStore.setState({ error: 'write-failed' });
    const el = render();
    const before = useTaskStore.getState().entities;

    click(el.querySelector('[data-testid="task-action-error-dismiss"]'));

    expect(el.querySelector('[data-testid="task-action-error"]'), '点完要把这行收掉').toBeNull();
    expect(useTaskStore.getState().error).toBeUndefined();
    expect(useTaskStore.getState().entities, '清显示不许动数据').toBe(before);
  });
});
