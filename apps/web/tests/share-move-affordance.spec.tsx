/**
 * ADR-0067 补二的**界面那一半**：跨共享边界的「换清单」不提供（M2 期间）
 * =====================================================================
 *
 * 补二原本有两件事：宿主侧给**具名错误**（`share-routing.spec.ts` 那批钉着），
 * 以及「UI 在 M2 期间对共享清单里的任务不提供该动作」。后半句这一份钉。
 *
 * 🔴 为什么值得单独一枚：只有前半句的话，用户在三个地方（行尾整理、详情栏整理、
 * 批量工具栏）都能点到一个**注定失败**的动作，而单条那一支的报错文案是
 * 「这一步没有保存成功。你的改动还在本地，可以重试。」—— 那句在这里是假的：
 * 重试多少次都不会成功，也没有任何东西"还在本地等着保存"。
 * 判据因此不写"有没有报错"，写"这个动作摆没摆出来"。
 *
 * 反向臂同样在（`个人任务那枚下拉照旧能用`）：只钉"共享的那条灰掉"，
 * 那么"整枚下拉永远灰掉"这种一眼看上去能过的实现就混得过去。
 *
 * mock 的只有一枚边：`lib/oplog` 的当前状态（真引擎在组件测试里没有）。
 * 判断本体（`isCrossListMoveBlocked` → `crossesShareBoundary`）走**真**代码 ——
 * 与派发器同一句，这正是这一格要保住的同源。
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { emptyState, type MaterializedState } from '@heyta/op-log';
import type { Project, Task } from '@heyta/domain';

const SHARED = 'share-1';

/** 一份「一条共享清单 + 两条个人清单 + 各自一条任务」的合并视图。 */
function viewState(): MaterializedState {
  const now = 1_700_000_000_000;
  const state = emptyState();
  Object.assign(state.projects as object, {
    pShared: { id: 'pShared', name: '家庭装修', shareId: SHARED, createdAt: now, updatedAt: now },
    pPersonal: { id: 'pPersonal', name: '私人', createdAt: now, updatedAt: now },
    pPersonal2: { id: 'pPersonal2', name: '读书', createdAt: now, updatedAt: now },
  });
  Object.assign(state.tasks as object, {
    tShared: { id: 'tShared', title: '买漆', projectId: 'pShared', createdAt: now, updatedAt: now },
    tPersonal: { id: 'tPersonal', title: '看牙', projectId: 'pPersonal', createdAt: now, updatedAt: now },
  });
  return state;
}

const holder = vi.hoisted(() => ({ state: null as unknown }));

vi.mock('../src/lib/oplog.js', () => ({
  hasEngine: () => true,
  currentState: () => holder.state,
  // 这一格里没有一次真的写：判据读的是状态。这两枚只是 `features/projects/store.ts`
  // 在模块装配时要引用的**边**（它把动作层接给 app-host）。
  dispatchIntent: vi.fn(async () => undefined),
  dispatchChecked: vi.fn(async () => undefined),
  onEngineChange: () => () => undefined,
}));

import { OrganizerField } from '../src/features/tasks/TaskOrganizer.js';
import { useProjectStore } from '../src/features/projects/store.js';
import { moveBlockedForTask } from '../src/features/share/share-move-guards.js';

function taskOf(id: 'tShared' | 'tPersonal'): Task {
  const task = (viewState().tasks as Record<string, Task>)[id];
  if (task === undefined) throw new Error(`夹具里没有 ${id} 这条任务`);
  return task;
}

/** 把清单表灌进真 store（选项列表由真选择器算，不复制那份筛选）。 */
function seedProjectStore(): void {
  const state = viewState();
  act(() => {
    useProjectStore.setState({
      projects: Object.values(state.projects as unknown as Record<string, Project>),
      tags: [],
    });
  });
}

let root: Root | undefined;
let container: HTMLDivElement | undefined;

function renderField(task: Task): HTMLDivElement {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(<OrganizerField task={task} onMoveToProject={() => undefined} onSetTags={() => undefined} />);
  });
  return container;
}

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  container?.remove();
  root = undefined;
  container = undefined;
});

describe('「换清单」这个动作在共享边界上摆不摆出来', () => {
  it('🔴 判据与派发器同源：同一条任务、同一个目的地，界面上判的与宿主会抛的是同一件事', () => {
    holder.state = viewState();
    expect(moveBlockedForTask('tShared', 'pPersonal')).toBe(true);
    expect(moveBlockedForTask('tShared', undefined)).toBe(true);
    expect(moveBlockedForTask('tPersonal', 'pShared')).toBe(true);
    expect(moveBlockedForTask('tPersonal', 'pPersonal2')).toBe(false);
  });

  it('共享清单里的任务 ⇒ 整枚下拉灰掉，并说一句为什么（不是只把按钮变灰）', () => {
    holder.state = viewState();
    seedProjectStore();
    const el = renderField(taskOf('tShared'));
    const select = el.querySelector<HTMLSelectElement>('[data-testid="organize-project-select"]');
    expect(select, '整理那一格里仍有这枚下拉（灰掉，不是删掉）').not.toBeNull();
    expect(select!.disabled, '没有任何可去的目的地 ⇒ 整枚禁用').toBe(true);
    const note = el.querySelector('[data-testid="organize-move-blocked"]');
    expect(note, '灰掉必须配一句人读得懂的话').not.toBeNull();
    expect(note!.textContent).toContain('共享清单里的任务暂时不能换清单');
  });

  it('反向臂：个人任务那枚下拉照旧能用，只有共享那条目的地是灰的', () => {
    holder.state = viewState();
    seedProjectStore();
    const el = renderField(taskOf('tPersonal'));
    const select = el.querySelector<HTMLSelectElement>('[data-testid="organize-project-select"]');
    expect(select!.disabled, '个人任务仍有可去的目的地 ⇒ 不许整枚灰掉').toBe(false);
    expect(el.querySelector('[data-testid="organize-move-blocked"]'), '没撞门就不许出现那句话').toBeNull();
    const byValue = (value: string): HTMLOptionElement | undefined =>
      [...select!.querySelectorAll<HTMLOptionElement>('option')].find((o) => o.value === value);
    expect(byValue('pShared')!.disabled, '共享清单作为目的地是灰的').toBe(true);
    expect(byValue('pPersonal2')!.disabled, '另一条个人清单照常可选').toBe(false);
    expect(byValue('')!.disabled, '收集箱照常可选（个人 → 收集箱不跨边界）').toBe(false);
  });
});
