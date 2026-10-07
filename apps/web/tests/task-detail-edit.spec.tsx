/**
 * 任务面单的"标题改名 + 手动优先级"（工单 W7）
 * ==========================================================
 *
 * 补的是产品级 IA/UX 审计（`docs/research/product-level-ia-ux-audit.md` §7）
 * 记下的那类"最后一米"空洞：
 *
 *   - `app-host` 的 `TaskActions.rename` 一直存在，Web 上却**零调用点** ——
 *     详情卡标题只读，用户改不了自己任务的名字。
 *   - 优先级在 Web 上是"只读徽标 + AI 批量写入"，`store.setPriority` 没有
 *     任何手动控件调用它 —— 用户点不了自己的优先级。
 *
 * 两层判据（缺一即假）：
 *
 *   1. **接线层**：spy 钉在 store 的 action 上（`renameTask` / `setPriority`），
 *      断言"界面的这次交互真的调了它、参数是 (id, 值)"。拿掉 `TaskDetailCard`
 *      里那行接线，这一层红 —— 断言写的就是接线本身。
 *   2. **落库层**：物化状态（`entities.tasks[id]`）真的变了。store 的 action
 *      被调 ≠ op 落了 op-log；这一层钉的是 store → app-host → 引擎 → 回流
 *      那整条链（与 `task-detail-card.spec.tsx` 的"真的写进物化状态"同一条口径）。
 *
 * 零 mock：走真 op-log（fake-indexeddb），与既有套件同一个形状。
 */
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Priority } from '@heyta/domain';
import { I18nProvider } from '@heyta/i18n';
import { HeytaUiProvider } from '@heyta/ui';

import { __resetOpLogForTests, initOpLog, useTaskStore } from '../src/features/tasks/store.js';
import { useReminderStore } from '../src/features/reminders/store.js';
import { selection } from '../src/lib/selection.js';

const { TaskDetailCard } = await import('../src/features/tasks/TaskDetailCard.js');

let root: Root | undefined;
let container: HTMLDivElement | undefined;

function mount(): void {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root?.render(
      <I18nProvider locale="zh-CN">
        <HeytaUiProvider>
          <TaskDetailCard />
        </HeytaUiProvider>
      </I18nProvider>,
    );
  });
}

/** 把写入冲干净（一条 op 落库要过好几个 await，不冲就读到"还没写进去"）。 */
async function flush(): Promise<void> {
  for (let i = 0; i < 50; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

async function addTask(title: string): Promise<string> {
  await act(async () => {
    await useTaskStore.getState().addTask(title);
  });
  const id = Object.keys(useTaskStore.getState().entities.tasks).find(
    (k) => useTaskStore.getState().entities.tasks[k]?.title === title,
  );
  if (id === undefined) throw new Error(`建不出任务 ${title} ⇒ 这一族的判据在空转`);
  await flush();
  return id;
}

/** 🔴 派发 `focusout`（冒泡）而不是 `blur`：React 17 起 onBlur 挂在 focusout 上。 */
function blur(el: HTMLElement): void {
  el.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
}

function keydown(el: HTMLElement, key: string): void {
  el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
}

const pane = () => document.querySelector('[data-testid="task-pane"]');

beforeEach(async () => {
  (globalThis as unknown as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
  (globalThis as unknown as { IDBKeyRange: typeof IDBKeyRange }).IDBKeyRange = IDBKeyRange;
  localStorage.clear();
  selection.clear();
  __resetOpLogForTests();
  // 提醒 store 是模块级单例，每条用例换新的 op-log 库 —— 不清会读到上一条用例
  // 已经不存在的提醒（与 task-detail-card.spec.tsx 同一条理由）。
  useReminderStore.setState({ byTask: {}, due: [], error: undefined });
  await initOpLog(`task-edit-${Math.random().toString(36).slice(2)}`);
  useTaskStore.setState({ filter: { kind: 'all' } });
});

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  container?.remove();
  root = undefined;
  container = undefined;
  selection.clear();
  vi.restoreAllMocks();
});

describe('标题改名（点 h2 进入，失焦/Enter 提交，Esc 还原）', () => {
  /** 点待机态那只 h2，拿编辑态那只输入框（拿不到 ⇒ 前置没成立，判据在空转）。 */
  function beginEdit(): HTMLInputElement {
    const h2 = pane()?.querySelector<HTMLHeadingElement>('[data-testid="task-detail-title"]');
    if (h2 === null || h2 === undefined) throw new Error('栏里没有标题 h2 ⇒ 判据在空转');
    act(() => {
      h2.click();
    });
    const input = pane()?.querySelector<HTMLInputElement>('[data-testid="task-detail-title-input"]');
    if (input == null) throw new Error('点了标题却没出现输入框 ⇒ 判据在空转');
    return input;
  }

  it('🔴 改字后失焦 ⇒ store.renameTask(id, 新标题) 被调（含 trim），且真的落到物化状态', async () => {
    const id = await addTask('旧标题');
    selection.select('task', id);
    mount();
    const renameSpy = vi.spyOn(useTaskStore.getState(), 'renameTask');

    const input = beginEdit();
    expect(input.value, '进入编辑时框里应是当前标题').toBe('旧标题');
    await act(async () => {
      input.value = '  新标题  ';
      blur(input);
    });
    await flush();

    // 接线层：组件真的调了 store 的 action，参数是 (id, trim 后的新标题)。
    expect(renameSpy, '失焦没走到 store.renameTask ⇒ 接线断了').toHaveBeenCalledTimes(1);
    expect(renameSpy).toHaveBeenCalledWith(id, '新标题');
    // 落库层：store → app-host rename → op-log → 回流，标题真的换了。
    expect(useTaskStore.getState().entities.tasks[id]?.title, '改名没落到物化状态').toBe('新标题');
    // 编辑会话结束 ⇒ 回到那只 h2，且说的是新标题（不是留着一只输入框）。
    expect(pane()?.querySelector('[data-testid="task-detail-title"]')?.textContent).toBe('新标题');
  });

  it('🔴 Enter 也走同一条提交路（不是只有失焦一条）', async () => {
    const id = await addTask('回车甲');
    selection.select('task', id);
    mount();
    const renameSpy = vi.spyOn(useTaskStore.getState(), 'renameTask');

    const input = beginEdit();
    await act(async () => {
      input.value = '回车乙';
      keydown(input, 'Enter');
    });
    await flush();

    expect(renameSpy).toHaveBeenCalledTimes(1);
    expect(renameSpy).toHaveBeenCalledWith(id, '回车乙');
    expect(useTaskStore.getState().entities.tasks[id]?.title).toBe('回车乙');
  });

  it('🔴 没变 / trim 后为空 ⇒ 不发 op（"点开又点走"不许白写一条标题 op）', async () => {
    const id = await addTask('原样');
    selection.select('task', id);
    mount();
    const renameSpy = vi.spyOn(useTaskStore.getState(), 'renameTask');

    // 臂一：值没变（失焦会把编辑会话收掉，回到 h2）。
    const same = beginEdit();
    await act(async () => {
      same.value = '原样';
      blur(same);
    });
    // 臂二：全空白（trim 后为空 —— 动作层对空标题是 throw，界面层必须先拦下）。
    // 失焦已回到待机态，得再点一次 h2 才有下一只输入框。
    const again = beginEdit();
    await act(async () => {
      again.value = '   ';
      blur(again);
    });
    await flush();

    expect(renameSpy, '没变/为空也调了 renameTask ⇒ 白写 op').not.toHaveBeenCalled();
    expect(useTaskStore.getState().entities.tasks[id]?.title).toBe('原样');
  });

  it('🔴 Esc ⇒ 还原：不发 op，回到 h2 且仍是原标题', async () => {
    const id = await addTask('撤销前');
    selection.select('task', id);
    mount();
    const renameSpy = vi.spyOn(useTaskStore.getState(), 'renameTask');

    const input = beginEdit();
    await act(async () => {
      input.value = '改了但会撤销';
      keydown(input, 'Escape');
    });
    await flush();

    expect(renameSpy).not.toHaveBeenCalled();
    expect(useTaskStore.getState().entities.tasks[id]?.title, 'Esc 后标题不该变').toBe('撤销前');
    const h2 = pane()?.querySelector('[data-testid="task-detail-title"]');
    expect(h2?.textContent, 'Esc 后没回到那只 h2').toBe('撤销前');
    expect(
      pane()?.querySelector('[data-testid="task-detail-title-input"]'),
      'Esc 后输入框还挂在栏里',
    ).toBeNull();
  });

  it('🔴 换选中 ⇒ 编辑会话作废：未提交的草稿不跟着人走，换回来也是待机态（且 DOM 里只有一只 h2）', async () => {
    const a = await addTask('草稿甲');
    const b = await addTask('草稿乙');
    selection.select('task', a);
    mount();
    const renameSpy = vi.spyOn(useTaskStore.getState(), 'renameTask');

    const input = beginEdit();
    await act(async () => {
      input.value = '甲没提交的草稿';
      // 不 blur —— 模拟"打到一半用 ↑↓/点击换了选中"。
    });
    act(() => {
      selection.select('task', b);
    });
    await flush();

    expect(renameSpy, '换选中把没提交的草稿当成了提交').not.toHaveBeenCalled();
    expect(useTaskStore.getState().entities.tasks[a]?.title).toBe('草稿甲');
    // 待机态回来的是**乙**的标题，且整栏只有一只 h2（React 19.3 对首位 keyed 重挂
    // 会留旧节点 —— 这条同时是那次复现的回归钉）。
    const h2s = pane()?.querySelectorAll('h2') ?? [];
    expect(h2s.length, `换选中后栏里应有且只有一只 h2，实到 ${String(h2s.length)}`).toBe(1);
    expect(h2s[0]?.textContent).toBe('草稿乙');
    expect(pane()?.querySelector('[data-testid="task-detail-title-input"]'), '换选中后输入框还在').toBeNull();

    // 换回甲：会话已作废 —— 是待机态的 h2，不是一只带草稿的输入框。
    act(() => {
      selection.select('task', a);
    });
    await flush();
    expect(pane()?.querySelectorAll('h2').length).toBe(1);
    expect(pane()?.querySelector('[data-testid="task-detail-title"]')?.textContent).toBe('草稿甲');
    expect(pane()?.querySelector('[data-testid="task-detail-title-input"]'), '换回来后编辑会话没作废').toBeNull();
  });
});

describe('手动优先级（原生 select，此前只有 AI 批量写入一个调用方）', () => {
  it('🔴 select 画在栏里：默认「无」，选项顺序对齐 Priority 枚举（无/低/中/高）', async () => {
    const id = await addTask('优先甲');
    selection.select('task', id);
    mount();

    const select = pane()?.querySelector<HTMLSelectElement>('[data-testid="task-priority-select"]');
    if (select == null) throw new Error('栏里没有优先级下拉 ⇒ 判据在空转');
    expect(select.value, '新建任务的优先级应回显 None（0）').toBe(String(Priority.None));
    const options = [...select.querySelectorAll('option')];
    // 值 = 枚举数值串（界面不发明第二套优先级词表），文案 = 既有四条词条。
    expect(options.map((o) => o.getAttribute('value'))).toEqual(['0', '1', '2', '3']);
    expect(options.map((o) => o.textContent)).toEqual(['无', '低', '中', '高']);
  });

  it('🔴 选「高」⇒ store.setPriority(id, Priority.High) 被调，且真的落到物化状态', async () => {
    const id = await addTask('优先乙');
    selection.select('task', id);
    mount();
    const prioritySpy = vi.spyOn(useTaskStore.getState(), 'setPriority');

    const select = pane()?.querySelector<HTMLSelectElement>('[data-testid="task-priority-select"]');
    if (select == null) throw new Error('栏里没有优先级下拉 ⇒ 判据在空转');
    await act(async () => {
      select.value = String(Priority.High);
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await flush();

    expect(prioritySpy, '选择没走到 store.setPriority ⇒ 接线断了').toHaveBeenCalledTimes(1);
    expect(prioritySpy).toHaveBeenCalledWith(id, Priority.High);
    expect(useTaskStore.getState().entities.tasks[id]?.priority, '优先级没落到物化状态').toBe(
      Priority.High,
    );
  });

  it('🔴 换选中 ⇒ 下拉的值跟着换人（受控于 store，不是本地草稿）', async () => {
    const a = await addTask('优先丙');
    const b = await addTask('优先丁');
    await act(async () => {
      await useTaskStore.getState().setPriority(a, Priority.Medium);
    });
    await flush();

    selection.select('task', a);
    mount();
    const select = pane()?.querySelector<HTMLSelectElement>('[data-testid="task-priority-select"]');
    if (select == null) throw new Error('栏里没有优先级下拉 ⇒ 判据在空转');
    expect(select.value, '起始态：甲应回显中').toBe(String(Priority.Medium));

    // 同一枚 root 里换选中（另起 root 会把"值没跟着换"这份坏自己抹掉）。
    act(() => {
      selection.select('task', b);
    });
    await flush();
    const after = pane()?.querySelector<HTMLSelectElement>('[data-testid="task-priority-select"]');
    expect(after?.value, '换选中后下拉还停在上一条的优先级上 ⇒ 那份 state 不是受控的').toBe(
      String(Priority.None),
    );
  });
});
