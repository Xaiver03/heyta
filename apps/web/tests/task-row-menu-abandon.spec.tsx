/**
 * A1：**「放弃任务」在 Web 上真的有一个入口**（R14 入口契约，2026-11-06）
 * =====================================================================
 *
 * ## 这条用例为什么存在
 *
 * 补这一格之前，`grep -rn abandon apps/web/src` 是 **0** —— 而共享词汇表
 * （`packages/ui/src/task-list/row-actions.ts` 的 `ROW_ACTION_IDS`）与移动端的行菜单
 * （`apps/mobile/src/screens/TasksScreen.tsx` 的 `actions.setAbandoned`）从 ADR-0083 起
 * 就有这个词。**零入口不会有任何测试变红**：共享层自洽、移动端自洽，Web 只是没有。
 *
 * 所以判据必须是"从界面上点到它，并且发出去的是同一个 action"，
 * 而不是"源码里出现了 abandon 这个词"（后者只要有人在注释里写一次就绿）。
 *
 * ## 它能红在哪
 *
 * · 把 `TaskRowMenu` 里的 `case 'abandon'` 删掉 ⇒ 菜单里找不到那一枚（第 1 条红）；
 * · 把 `onSetAbandoned?.(taskId, !abandoned)` 改成别的参数（例如恒 `true`）⇒ 第 2 条红；
 * · 把 `ROW_ACTION_IDS` 里的 `abandon` 删掉 ⇒ 第 3 条红（共享层与本端一起红）。
 *
 * ⚠️ 不测几何（jsdom 里量出来是 0），只测"有没有这一枚、点了发什么"。
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { I18nProvider } from '@heyta/i18n';
import { ROW_ACTION_IDS } from '@heyta/ui';

import { TaskRowMenu } from '../src/features/tasks/TaskRowMenu.js';

let root: Root | undefined;
let container: HTMLDivElement | undefined;

function mount(props: {
  onSetAbandoned?: (taskId: string, abandoned: boolean) => void;
  abandoned?: boolean;
}): void {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root?.render(
      <I18nProvider locale="zh-CN">
        <TaskRowMenu
          taskId="t-1"
          taskTitle="买牛奶"
          childCount={0}
          anchor={{ x: 10, y: 10 }}
          onClose={vi.fn()}
          onOpenDetail={vi.fn()}
          onDelete={vi.fn()}
          onSetAbandoned={props.onSetAbandoned}
          abandoned={props.abandoned}
        />
      </I18nProvider>,
    );
  });
}

function menu(): HTMLElement {
  const node = document.body.querySelector<HTMLElement>('[data-testid="task-row-menu"]');
  if (node === null) throw new Error('菜单没有画出来');
  return node;
}

function abandonItem(): HTMLElement | null {
  return menu().querySelector<HTMLElement>('[data-testid="task-row-menu-abandon"]');
}

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  container?.remove();
  document.body.innerHTML = '';
  root = undefined;
  container = undefined;
});

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('A1 放弃任务：对象层的主入口在行菜单里', () => {
  it('共享词汇表里必须有 `abandon` 与 `unabandon` 这两个 id', () => {
    // 这一条钉的是"词汇表还是那一份"：本端不许自己发明一个叫 `abandon` 的字符串。
    expect([...ROW_ACTION_IDS]).toContain('abandon');
    expect([...ROW_ACTION_IDS]).toContain('unabandon');
  });

  it('宿主接了 `onSetAbandoned` ⇒ 菜单里**有**这一枚，且写的是「放弃」', () => {
    mount({ onSetAbandoned: vi.fn() });
    const item = abandonItem();
    expect(item, '「放弃」在 Web 上没有入口 —— 这正是 A1 那个缺陷').not.toBeNull();
    expect(item?.textContent).toBe('放弃');
  });

  it('点它发出去的是 `(taskId, true)` —— 与移动端**同一个 action**、同一个方向', () => {
    const onSetAbandoned = vi.fn();
    mount({ onSetAbandoned });
    act(() => {
      abandonItem()?.click();
    });
    expect(onSetAbandoned).toHaveBeenCalledWith('t-1', true);
  });

  it('已放弃的那条换面成「取消放弃」，发出去的是 `false`（一个槽位两副面孔）', () => {
    const onSetAbandoned = vi.fn();
    mount({ onSetAbandoned, abandoned: true });
    const item = abandonItem();
    expect(item?.textContent).toBe('取消放弃');
    act(() => {
      item?.click();
    });
    expect(onSetAbandoned).toHaveBeenCalledWith('t-1', false);
  });

  it('宿主没接的时候**不画**（不留按下去没反应的一行）', () => {
    mount({});
    expect(abandonItem()).toBeNull();
  });

  it('它不进危险组：分隔线在它**之后**（放弃可恢复，删除不可 —— J5 的代价档不同）', () => {
    mount({ onSetAbandoned: vi.fn() });
    const children = [...menu().children];
    const sepIndex = children.findIndex((el) => el.getAttribute('role') === 'separator');
    const abandonIndex = children.findIndex(
      (el) => el.getAttribute('data-testid') === 'task-row-menu-abandon',
    );
    expect(sepIndex).toBeGreaterThanOrEqual(0);
    expect(abandonIndex).toBeGreaterThanOrEqual(0);
    expect(abandonIndex).toBeLessThan(sepIndex);
  });
});
