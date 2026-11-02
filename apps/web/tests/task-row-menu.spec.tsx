/**
 * 任务行的右键菜单（行操作 UX 重设计，2026-11）
 * ============================================
 *
 * 这一单把行尾那枚「⋯ 更多」的**九项编辑面板**换掉：一级菜单只剩两枚
 * （打开详情 / 删除），其余全部搬进详情面。判据因此分两层：
 *
 *   · **D 族**（危险档）：`resolveDangerTier` 判成 `undo` 时直删 + 撤销回执、
 *     判成 `popconfirm` 时就地二次确认 —— 两档都由**共享判定**给出，
 *     本文件钉的是"组件真的按那个档位做了"（不是"组件自己又判了一遍"）。
 *   · **P 族**（结构）：一级只有两枚、危险项在分隔线之后、行尾不再挂编辑器、
 *     而面单在两个落点都能画 —— 这四条合起来回答"能力没有减少一条"。
 *
 * ⚠️ 这里**不**测坐标、阴影、毛玻璃那一类：它们归真浏览器（`e2e/`）与设计系统，
 * 而 jsdom 里量出来的几何是 0，写一条在 0 上成立的断言等于给自己发免死金牌。
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { I18nProvider } from '@heyta/i18n';

const { TaskRowMenu } = await import('../src/features/tasks/TaskRowMenu.js');

const APP_SRC = readFileSync(join(process.cwd(), 'src', 'App.tsx'), 'utf8');
const CARD_SRC = readFileSync(
  join(process.cwd(), 'src', 'features', 'tasks', 'TaskDetailCard.tsx'),
  'utf8',
);

let root: Root | undefined;
let container: HTMLDivElement | undefined;

function mount(props: {
  childCount?: number;
  onClose?: () => void;
  onOpenDetail?: (taskId: string) => void;
  onDelete?: (taskId: string) => void;
}): { onClose: ReturnType<typeof vi.fn>; onOpenDetail: ReturnType<typeof vi.fn>; onDelete: ReturnType<typeof vi.fn> } {
  const onClose = vi.fn(props.onClose);
  const onOpenDetail = vi.fn(props.onOpenDetail);
  const onDelete = vi.fn(props.onDelete);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root?.render(
      <I18nProvider locale="zh-CN">
        <TaskRowMenu
          taskId="t-1"
          taskTitle="买牛奶"
          childCount={props.childCount ?? 0}
          anchor={{ x: 10, y: 10 }}
          onClose={onClose}
          onOpenDetail={onOpenDetail}
          onDelete={onDelete}
        />
      </I18nProvider>,
    );
  });
  return { onClose, onOpenDetail, onDelete };
}

/** 菜单挂在 `document.body`（portal），所以要按 body 查，不是按挂载容器。 */
function menu(): HTMLElement {
  const node = document.body.querySelector<HTMLElement>('[data-testid="task-row-menu"]');
  if (node === null) throw new Error('菜单没有画出来');
  return node;
}

function items(): HTMLElement[] {
  return [...menu().querySelectorAll<HTMLElement>('[role="menuitem"]')];
}

function click(node: HTMLElement): void {
  act(() => {
    node.click();
  });
}

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  container?.remove();
  // portal 落在 body 上，卸载之后仍可能剩下一个节点 —— 清干净，免得下一条用例读到上一条的。
  document.body.innerHTML = '';
  root = undefined;
  container = undefined;
});

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('一级菜单只有两枚（P 族）', () => {
  it('P1 打开详情 + 删除，没有第三枚 —— "点开之后项数很少"是判据不是口号', () => {
    mount({});
    expect(items()).toHaveLength(2);
    expect(items()[0]?.textContent).toBe('打开详情');
    expect(items()[1]?.textContent).toBe('删除');
  });

  it('P2 危险项在分隔线**之后**，且带危险色修饰符', () => {
    mount({});
    const panel = menu();
    const children = [...panel.children];
    const sepIndex = children.findIndex((el) => el.getAttribute('role') === 'separator');
    const deleteIndex = children.findIndex((el) => el.getAttribute('data-testid') === 'task-row-menu-delete');
    expect(sepIndex).toBeGreaterThanOrEqual(0);
    // 分隔线必须在危险项之前：线以上都安全，线以下那一条不与它们并列成同一档。
    expect(sepIndex).toBeLessThan(deleteIndex);
    expect(children[deleteIndex]?.className).toContain('ht-row-menu__item--danger');
  });

  it('P3 打开详情调 onOpenDetail 并收走菜单', () => {
    const { onOpenDetail, onClose } = mount({});
    click(items()[0] as HTMLElement);
    expect(onOpenDetail).toHaveBeenCalledWith('t-1');
    expect(onClose).toHaveBeenCalled();
  });
});

describe('危险项按共享档位走（D 族）', () => {
  it('D1 没有子任务 ⇒ `undo` 档：点一下就删，不弹二次确认', () => {
    const { onDelete } = mount({ childCount: 0 });
    click(menu().querySelector<HTMLElement>('[data-testid="task-row-menu-delete"]') as HTMLElement);
    expect(onDelete).toHaveBeenCalledWith('t-1');
    // 后果句是 `popconfirm` 那一档的东西，这一档不许出现。
    expect(document.body.querySelector('[data-testid="task-row-menu-consequence"]')).toBeNull();
  });

  it('D2 带子任务 ⇒ `popconfirm` 档：第一下只把后果说出来，第二下才真的删', () => {
    const { onDelete } = mount({ childCount: 3 });
    const remove = (): HTMLElement =>
      menu().querySelector<HTMLElement>('[data-testid="task-row-menu-delete"]') as HTMLElement;

    click(remove());
    expect(onDelete).not.toHaveBeenCalled();
    const note = document.body.querySelector('[data-testid="task-row-menu-consequence"]');
    expect(note?.textContent).toContain('3');
    expect(remove().textContent).toBe('仍要删除');

    click(remove());
    expect(onDelete).toHaveBeenCalledWith('t-1');
  });

  it('D3 `popconfirm` 能取消 —— 取消之后回到第一态，删除没有被调用', () => {
    const { onDelete } = mount({ childCount: 1 });
    click(menu().querySelector<HTMLElement>('[data-testid="task-row-menu-delete"]') as HTMLElement);
    click(menu().querySelector<HTMLElement>('[data-testid="task-row-menu-cancel"]') as HTMLElement);
    expect(onDelete).not.toHaveBeenCalled();
    expect(document.body.querySelector('[data-testid="task-row-menu-consequence"]')).toBeNull();
    expect(
      menu().querySelector<HTMLElement>('[data-testid="task-row-menu-delete"]')?.textContent,
    ).toBe('删除');
  });
});

describe('键盘通路（K 族）—— 右键不可达的人不能掉队', () => {
  it('K1 打开即把焦点给第一枚（键盘用户按完 Shift+F10 就能直接回车）', () => {
    mount({});
    expect(document.activeElement).toBe(items()[0]);
  });

  it('K2 ↓ / ↑ 在两枚之间循环，Home / End 直达两端', () => {
    mount({});
    const panel = menu();
    const press = (key: string): void => {
      act(() => {
        panel.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
      });
    };
    press('ArrowDown');
    expect(document.activeElement).toBe(items()[1]);
    press('ArrowDown');
    expect(document.activeElement).toBe(items()[0]);
    press('ArrowUp');
    expect(document.activeElement).toBe(items()[1]);
    press('Home');
    expect(document.activeElement).toBe(items()[0]);
    press('End');
    expect(document.activeElement).toBe(items()[1]);
  });

  it('K3 Esc 收走菜单（策略查表：`menu` 那一行的 escape 是 dismiss）', () => {
    const { onClose } = mount({});
    act(() => {
      menu().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(onClose).toHaveBeenCalled();
  });
});

describe('结构：行上不再挂编辑器（P4/P5，读源码形状）', () => {
  /** 剥掉注释：一条会被散文改变的判据量的不是代码。 */
  const stripComments = (src: string): string =>
    src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  it('P4 `App.tsx` 的行尾插槽里没有编辑器、没有「⋯ 更多」那一层', () => {
    const src = stripComments(APP_SRC);
    // 旧形状的两个锚点：`<details className="ht-compose-actions">` 与那枚触发器。
    expect(src).not.toContain('ht-compose-actions');
    expect(src).not.toContain('task-actions-summary');
    // 编辑器本体也不许回到行尾（它们在 `TaskDetailCard` 里）。
    // ⚠️ 用"后面不是字母"的边界：`<NoteEditorCard`（便签那一格）是**另一个**组件，
    //    裸 substring 会把它算成回潮 —— 一条会误报的判据会被人放宽，然后就废了。
    for (const editor of ['NoteEditor', 'SubtaskPicker', 'TaskOrganizer', 'TaskRepeat', 'DueEditor', 'ReminderPanel']) {
      expect(src).not.toMatch(new RegExp(`<${editor}(?![A-Za-z])`));
    }
  });

  it('P5 撤掉那九项之后，两个落点仍然都能画同一张面单（能力没有减少一条）', () => {
    const src = stripComments(APP_SRC);
    const card = stripComments(CARD_SRC);
    // 面单本身接一个"宿主注入的自动化格"（AI 拆解 / AI 估时搬进去了）。
    expect(card).toContain('automationSlot');
    expect(card).toContain('task-detail-automation-slot');
    // 两个落点：详情列那一支 + 窄档对话框那一支，都必须把 AI 那两格递进去。
    const slots = src.match(/automationSlot=\{automationSlotNode\}/g) ?? [];
    expect(slots).toHaveLength(2);
    // 对话框那一支必须存在：它是窄档唯一的可达面单。
    expect(src).toContain('task-detail-dialog');
    // 两条输入通路（右键 + 键盘）都接在同一个处理函数上。
    expect(src).toContain('onContextMenu={handleTaskContextMenu}');
    expect(src).toContain('onKeyDown={handleTaskRowKeyDown}');
    expect(src).toContain("event.key === 'ContextMenu'");
  });
});
