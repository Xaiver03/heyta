/**
 * 已存视图面板（FilterPanel）—— 组合筛选（滴答式高级筛选）的界面契约
 * ==================================================================
 *
 * 钉四件**宿主**必须做到的事（数据模型 / 语义在 `packages/domain/tests/task-filter.spec.ts`）：
 *
 *   1. **区块头 + 一枚 + 图标**：创建表单默认不占位，点 + 才展开。
 *   2. **多条件 + 且/或**：能加条件、切维度、切取值，保存成
 *      `{ kind: 'compound', op, conditions }`，点一条把它交给宿主。
 *   3. **参数带全**：清单 / 标签 / 四象限这些维度要把选中的值收进条件，不能是残缺形状。
 *   4. **删除**：删掉的是这条已存视图，不是数据。
 *
 * ⚠️ 组件读 `useTaskStore`（当前筛选，用于高亮）与 `useProjectStore`（清单 / 标签候选），
 * 所以下面直接对这两个 store `setState`，不挂整个 App。
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { I18nProvider } from '@heyta/i18n';
import type { TaskFilter } from '@heyta/domain';

import { FilterPanel } from '../src/features/tasks/FilterPanel.js';
import { useTaskStore } from '../src/features/tasks/store.js';
import { useProjectStore } from '../src/features/projects/store.js';

let root: Root | undefined;
let container: HTMLDivElement | undefined;

beforeEach(() => {
  localStorage.clear();
  useTaskStore.setState({ filter: { kind: 'all' } } as never);
  useProjectStore.setState({ projects: [], tags: [] } as never);
});

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  container?.remove();
  root = undefined;
  container = undefined;
});

async function mount(onApply: (filter: TaskFilter) => void): Promise<HTMLDivElement> {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(
      <I18nProvider locale="zh-CN">
        <FilterPanel onApplyFilter={onApply} />
      </I18nProvider>,
    );
  });
  return container;
}

async function clickAsync(el: Element | null | undefined): Promise<void> {
  await act(async () => {
    (el as HTMLElement | null)?.click();
    await Promise.resolve();
  });
}

function typeInto(el: Element | null | undefined, value: string): void {
  const input = el as HTMLInputElement | null;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  act(() => {
    setter?.call(input, value);
    input?.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function chooseOption(el: Element | null | undefined, value: string): void {
  const select = el as HTMLSelectElement | null;
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
  act(() => {
    setter?.call(select, value);
    select?.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

/** 某个条件块里某一维的下拉（`which` = dim / value）。 */
function condSelect(el: HTMLElement, index: number, which: 'dim' | 'value'): Element | null {
  return el.querySelector(`[data-testid="filter-cond-${index}-${which}"] select`);
}

/** 条件**块**的数量（排除 `-dim` / `-value` 这两层里的同名前缀）。 */
function conditionBlocks(el: HTMLElement): Element[] {
  return [...el.querySelectorAll('[data-testid^="filter-cond-"]')].filter((node) =>
    /^filter-cond-\d+$/.test(node.getAttribute('data-testid') ?? ''),
  );
}

describe('已存视图面板（组合筛选）', () => {
  it('创建表单默认不占位；点「新建视图」展开后有一条默认条件（状态=未完成）', async () => {
    const el = await mount(vi.fn());
    expect(el.textContent).toContain('已存视图');
    expect(el.querySelector('[data-testid="filter-create-form"]'), '默认不该有常驻表单').toBeNull();

    await clickAsync(el.querySelector('[data-testid="filter-add"]'));
    expect(el.querySelector('[data-testid="filter-create-form"]')).not.toBeNull();
    expect(conditionBlocks(el).length).toBe(1);
    // 只有一条条件时不显示「且/或」。
    expect(el.querySelector('[data-testid="filter-op"]')).toBeNull();
  });

  it('多条件 + 且：状态=未完成 且 日期=今天 ⇒ 存成 compound 并交给宿主', async () => {
    const onApply = vi.fn();
    const el = await mount(onApply);

    await clickAsync(el.querySelector('[data-testid="filter-add"]'));
    typeInto(el.querySelector('[data-testid="filter-create-form"] input'), '我的今天');

    await clickAsync(el.querySelector('[data-testid="filter-add-condition"]'));
    expect(conditionBlocks(el).length).toBe(2);

    // 第二条从默认「状态」切成「日期」（切维度后取值默认 today）。
    chooseOption(condSelect(el, 1, 'dim'), 'date');
    chooseOption(condSelect(el, 1, 'value'), 'today');

    // 两条条件出现「且/或」，默认且。
    expect(el.querySelector('[data-testid="filter-op"]')).not.toBeNull();

    await clickAsync(el.querySelector('[data-testid="filter-save"]'));
    const apply = el.querySelector<HTMLElement>('[data-testid^="filter-apply-"]');
    expect(apply, '保存后列表里要出现这一条').not.toBeNull();
    expect(apply!.textContent).toContain('我的今天');

    await clickAsync(apply);
    expect(onApply).toHaveBeenCalledWith({
      kind: 'compound',
      op: 'and',
      conditions: [
        { kind: 'status', status: 'open' },
        { kind: 'date', range: 'today' },
      ],
    });
  });

  it('清单维度把选中的清单 id 收进条件（不是残缺形状）', async () => {
    useProjectStore.setState({
      projects: [{ id: 'proj-1', name: '工作' }],
      tags: [],
    } as never);
    const onApply = vi.fn();
    const el = await mount(onApply);

    await clickAsync(el.querySelector('[data-testid="filter-add"]'));
    typeInto(el.querySelector('[data-testid="filter-create-form"] input'), '工作清单');
    chooseOption(condSelect(el, 0, 'dim'), 'project');
    chooseOption(condSelect(el, 0, 'value'), 'proj-1');
    await clickAsync(el.querySelector('[data-testid="filter-save"]'));

    const apply = el.querySelector<HTMLElement>('[data-testid^="filter-apply-"]');
    expect(apply).not.toBeNull();
    await clickAsync(apply);
    expect(onApply).toHaveBeenCalledWith({
      kind: 'compound',
      op: 'and',
      conditions: [{ kind: 'project', projectId: 'proj-1' }],
    });
  });

  it('删除按钮只删这一条已存视图', async () => {
    const el = await mount(vi.fn());
    await clickAsync(el.querySelector('[data-testid="filter-add"]'));
    typeInto(el.querySelector('[data-testid="filter-create-form"] input'), '要删的');
    await clickAsync(el.querySelector('[data-testid="filter-save"]'));
    expect(el.querySelector('[data-testid^="filter-apply-"]')).not.toBeNull();

    const remove = el.querySelector<HTMLElement>('[aria-label="删除视图"]');
    expect(remove).not.toBeNull();
    await clickAsync(remove);
    expect(el.querySelector('[data-testid^="filter-apply-"]')).toBeNull();
  });
});
