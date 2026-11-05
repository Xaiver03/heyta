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

import { Priority } from '@heyta/domain';
import { I18nProvider } from '@heyta/i18n';

const { TaskRowMenu } = await import('../src/features/tasks/TaskRowMenu.js');
import type { TaskRowMenuProps } from '../src/features/tasks/TaskRowMenu.js';

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
  onSetPinned?: (taskId: string, pinned: boolean) => void;
  pinned?: boolean;
  /**
   * B1-B4（优先级 / 移动到 / 添加子任务 / 标签）这几项**宿主接线**用的口子：
   * 传什么就往 `TaskRowMenu` 上挂什么。用例靠它来问"点这一项到底有没有把意图发出去"。
   */
  wire?: Partial<TaskRowMenuProps>;
}): { onClose: ReturnType<typeof vi.fn>; onOpenDetail: ReturnType<typeof vi.fn>; onDelete: ReturnType<typeof vi.fn>; onSetPinned: ReturnType<typeof vi.fn> } {
  const onClose = vi.fn(props.onClose);
  const onOpenDetail = vi.fn(props.onOpenDetail);
  const onDelete = vi.fn(props.onDelete);
  const onSetPinned = vi.fn(props.onSetPinned);
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
          onSetPinned={props.onSetPinned === undefined ? undefined : onSetPinned}
          pinned={props.pinned}
          {...props.wire}
        />
      </I18nProvider>,
    );
  });
  return { onClose, onOpenDetail, onDelete, onSetPinned };
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

describe('置顶这一项（B5，2026-11-04 滴答对齐）', () => {
  it('未置顶的那条给「置顶」，点它发的是 `pinned=true`，且菜单收走', () => {
    const { onSetPinned, onClose } = mount({ onSetPinned: () => {} });
    const pin = menu().querySelector<HTMLElement>('[data-testid="task-row-menu-pin"]');
    expect(pin, '菜单里没有置顶这一格').not.toBeNull();
    expect(pin!.textContent?.trim()).toBe('置顶');
    click(pin!);
    expect(onSetPinned).toHaveBeenCalledWith('t-1', true);
    expect(onClose, '点完菜单该收走（与其余各项同一条）').toHaveBeenCalled();
  });

  it('🔴 已置顶的那条给「取消置顶」，点它发的是 `false` —— 这一项是开关，不是单向按钮', () => {
    const { onSetPinned } = mount({ onSetPinned: () => {}, pinned: true });
    const pin = menu().querySelector<HTMLElement>('[data-testid="task-row-menu-pin"]')!;
    expect(pin.textContent?.trim()).toBe('取消置顶');
    click(pin);
    expect(onSetPinned).toHaveBeenCalledWith('t-1', false);
  });

  it('宿主没接的时候**不画这一格**（不许出现按下去什么都不做的菜单项）', () => {
    mount({});
    expect(menu().querySelector('[data-testid="task-row-menu-pin"]')).toBeNull();
  });
});

/*
 * B1-B4（滴答对齐 · 右键菜单扩充）。
 *
 * 🔴 这四条问的是同一件事：**点这一项，那个意图真的发出去了吗** ——
 * 而不是"这一项画出来了吗"。原文件里这一族**一条都没有**（菜单收了五个新入口，
 * 判据却只覆盖旧的两枚），所以"接了个空函数"这种坏法没人挡得住。
 * 探针是组件自己给的 `data-testid`（子菜单的触发钮此前没有稳定探针）。
 */
describe('B1-B4 菜单项把意图发出去（不是只画出来）', () => {
  it('B1 优先级：展开四档，点「高」发的是 onSetPriority(taskId, High) 并收走菜单', () => {
    const onSetPriority = vi.fn();
    mount({ wire: { onSetPriority, currentPriority: Priority.None } });
    click(menu().querySelector<HTMLElement>('[data-testid="task-row-menu-priority"]')!);
    for (const value of [Priority.None, Priority.High, Priority.Medium, Priority.Low]) {
      expect(
        menu().querySelector(`[data-testid="task-row-menu-priority-${String(value)}"]`),
        `四档里少了第 ${String(value)} 档`,
      ).not.toBeNull();
    }
    click(menu().querySelector<HTMLElement>(`[data-testid="task-row-menu-priority-${String(Priority.High)}"]`)!);
    expect(onSetPriority).toHaveBeenCalledWith('t-1', Priority.High);
  });

  /**
   * 🔴 旗标颜色必须是**修饰类**，不是 JSX 里的 `style={{…}}`。
   *
   * 为什么这条判据存在：`check:l4-no-style` 的断言 C 按"含 `style={{` 的行数"只减不增，
   * 而 2026-11-04 那笔（`df8abb7f5`）就是在这一处写了内联样式，把 web 侧抬到 75 > 基线 74，
   * 并随那次推送上了 `origin/main`。门只数总数，抓不到"是哪一行"；这一条把它钉到具体的档与类名上，
   * 下次有人图省事写回内联，红的是这里，而不是那道要人自己找文件的棘轮。
   *
   * 两半都要：类名对（颜色真走 token）+ 元素上没有 `style` 属性（不许回潮）。
   */
  it('旗标颜色走 ht-row-menu__icon--{档} 修饰类，元素上不残留内联 style', () => {
    mount({ wire: { onSetPriority: vi.fn(), currentPriority: Priority.None } });
    click(menu().querySelector<HTMLElement>('[data-testid="task-row-menu-priority"]')!);
    const expectByPriority = new Map<Priority, string>([
      [Priority.None, 'ht-row-menu__icon--none'],
      [Priority.Low, 'ht-row-menu__icon--low'],
      [Priority.Medium, 'ht-row-menu__icon--medium'],
      [Priority.High, 'ht-row-menu__icon--high'],
    ]);
    for (const [value, modifier] of expectByPriority) {
      const icon = menu().querySelector<HTMLElement>(
        `[data-testid="task-row-menu-priority-${String(value)}"] .ht-row-menu__icon`,
      );
      expect(icon, `第 ${String(value)} 档里没有那枚旗标`).not.toBeNull();
      // ⚠️ 旗标是 SVG：它的 `className` 是 `SVGAnimatedString`（`{baseVal, animVal}`），
      //    不是字符串 —— 直接 `expect(el.className).toContain(...)` 会拿对象去比，永远不成立。
      //    取属性本身。
      const cls = icon!.getAttribute('class') ?? '';
      expect(cls, `第 ${String(value)} 档的旗标没挂上 ${modifier}`).toContain(modifier);
      expect(
        icon!.getAttribute('style'),
        `第 ${String(value)} 档的旗标又回到内联 style 了 —— 那是 l4 棘轮数的那一行`,
      ).toBeNull();
    }
  });

  it('B4 移动到：给的是「收集箱」+ 每条清单，点清单发的是那个 id', () => {
    const onMoveToProject = vi.fn();
    mount({
      wire: {
        onMoveToProject,
        projects: [{ id: 'p-1', name: '家里' }],
        currentProjectId: undefined,
      },
    });
    click(menu().querySelector<HTMLElement>('[data-testid="task-row-menu-move"]')!);
    // 「收集箱」那一档必须在（无清单 = 一个真的目的地，不是空白）。
    expect(menu().querySelector('[data-testid="task-row-menu-project-inbox"]')).not.toBeNull();
    click(menu().querySelector<HTMLElement>('[data-testid="task-row-menu-project-p-1"]')!);
    expect(onMoveToProject).toHaveBeenCalledWith('t-1', 'p-1');
  });

  it('B2 添加子任务：点它把父任务的 id 交给宿主，并收走菜单', () => {
    const onAddSubtask = vi.fn();
    const { onClose } = mount({ wire: { onAddSubtask } });
    click(menu().querySelector<HTMLElement>('[data-testid="task-row-menu-add-subtask"]')!);
    expect(onAddSubtask).toHaveBeenCalledWith('t-1');
    expect(onClose).toHaveBeenCalled();
  });

  // ⚠️ 拆成两条而不是在同一条里 `mount()` 两次：第二条挂载不会卸载第一条那棵树，
  // 于是前一个实例留在 `document` 上的键盘监听会活到下一条用例里去（实测把 K3 带红）。
  it('B3 标签：点一条发的是**整组**（`setTags` 的契约是覆盖式，不是"加一个"）', () => {
    const onSetTags = vi.fn();
    mount({ wire: { onSetTags, tags: [{ id: 'g-1', name: 'urgent' }], currentTagIds: [] } });
    click(menu().querySelector<HTMLElement>('[data-testid="task-row-menu-tags"]')!);
    click(menu().querySelector<HTMLElement>('[data-testid="task-row-menu-tag-g-1"]')!);
    expect(onSetTags).toHaveBeenCalledWith('t-1', ['g-1']);
  });

  it('🔴 B3 取消：已经在组里的那一条再点一次，发出去的是**去掉它之后**的那一组', () => {
    const onSetTags = vi.fn();
    mount({ wire: { onSetTags, tags: [{ id: 'g-1', name: 'urgent' }], currentTagIds: ['g-1'] } });
    click(menu().querySelector<HTMLElement>('[data-testid="task-row-menu-tags"]')!);
    const option = menu().querySelector<HTMLElement>('[data-testid="task-row-menu-tag-g-1"]')!;
    expect(option.getAttribute('aria-pressed'), '已勾的那条要把状态说出来').toBe('true');
    click(option);
    expect(onSetTags).toHaveBeenCalledWith('t-1', []);
  });
});

/*
 * B3 的另外一半：菜单里**新建**标签。
 *
 * 🔴 这四条各钉一格，缺一格都可能留下"看着能用其实不能用"：
 * 入口在不在、点开的草稿焦点进不进得去、提交之后名字真的变成一条标签**并且**勾上、
 * 空名不发出任何意图。宿主没接那一档时不画入口 —— 菜单里没有按下去没反应的行。
 */
describe('B3 新建标签（就地草稿，不弹第二层）', () => {
  const wire = (over: Partial<TaskRowMenuProps> = {}) => ({
    wire: {
      onSetTags: vi.fn(),
      tags: [{ id: 'g-1', name: 'urgent' }],
      currentTagIds: [] as string[],
      onCreateTag: async () => 'g-9',
      ...over,
    },
  });

  // ⚠️ 两条而不是"一条里挂两次"：第二次 mount 不会卸载第一棵树，
  // 第一棵树留在 `document` 上的捕获监听会活到隔壁用例（K3 就是这么被带红的）。
  // 🔴 这一格治的是一个**只在键盘上才犯**的缺陷：子菜单的触发器原本把
  // `role="menuitem"` 挂在包裹用的 `div` 上，而共享层 Enter 做的是
  // `items[i].click()` —— 点一个 div 什么都不会发生。鼠标能用、键盘打不开，
  // 而"键盘导航可用"这条验收只看鼠标那一支是发现不了的。
  it('🔴 键盘 Enter 能展开子菜单（触发器必须是真菜单项，不是包一层的 div）', async () => {
    mount({ wire: { onMoveToProject: vi.fn(), projects: [{ id: 'p-1', name: '家里' }], currentProjectId: undefined } });
    const trigger = menu().querySelector<HTMLElement>('[data-testid="task-row-menu-move"]')!;
    expect(trigger.getAttribute('role'), 'role 挂在包裹的 div 上 = Enter 点的是空气').toBe('menuitem');
    // 先让焦点落在这一枚上：共享判断问的是"当前停在哪一项"，没焦点时 Enter 是 ignore。
    act(() => {
      trigger.focus();
      trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    expect(
      menu().querySelector('[data-testid="task-row-menu-project-p-1"]'),
      '按 Enter 之后「移动到」的子菜单没展开',
    ).not.toBeNull();
  });

  it('入口那一行在标签子菜单末尾', async () => {
    mount(wire());
    click(menu().querySelector<HTMLElement>('[data-testid="task-row-menu-tags"]')!);
    expect(menu().querySelector('[data-testid="task-row-menu-new-tag"]'), '子菜单里没有新建那一行').not.toBeNull();
  });

  /**
   * 🔴 浏览器腿 ⑧ 量到的第二格：原文承诺"显示已有标签 **+ 新建**"，而这一行当时按
   * `tags.length > 0` 整行收掉 —— 于是**一条标签都还没有的人**从行菜单里永远建不出第一条。
   * 判据按"有得挑，或有得建"来写，两者都没有才不画。
   */
  it('🔴 一条标签都没有、但宿主接了 `onCreateTag` ⇒ 「标签」这一行仍在，点开只有新建', async () => {
    mount({
      wire: { onSetTags: vi.fn(), onCreateTag: async () => 'g-9', tags: [] as { id: string; name: string }[], currentTagIds: [] },
    });
    const trigger = menu().querySelector<HTMLElement>('[data-testid="task-row-menu-tags"]');
    expect(trigger, '没有标签不等于不能建标签 —— 这一行该在').not.toBeNull();
    click(trigger!);
    expect(menu().querySelector('[data-testid="task-row-menu-new-tag"]')).not.toBeNull();
    expect(menu().querySelectorAll('[data-testid^="task-row-menu-tag-"]'), '空列表里凭空长出可勾的项').toHaveLength(0);
  });

  it('既没有可勾的标签、宿主也没接 `onCreateTag` ⇒ 这一行不画（按下去没反应的行不留）', async () => {
    mount({ wire: { onSetTags: vi.fn(), tags: [] as { id: string; name: string }[], currentTagIds: [] } });
    expect(menu().querySelector('[data-testid="task-row-menu-tags"]'), '两样都没有时不该留这一行').toBeNull();
  });

  it('宿主没接 `onCreateTag` 时整行**不画**（菜单里不许有按下去没反应的行）', async () => {
    mount({ wire: { onSetTags: vi.fn(), tags: [{ id: 'g-1', name: 'urgent' }], currentTagIds: [] } });
    click(menu().querySelector<HTMLElement>('[data-testid="task-row-menu-tags"]')!);
    expect(menu().querySelector('[data-testid="task-row-menu-new-tag"]')).toBeNull();
  });

  it('🔴 点开草稿：输入框出现，且**焦点已经在里面**（不该再让用户多按一次 Tab）', async () => {
    mount(wire());
    click(menu().querySelector<HTMLElement>('[data-testid="task-row-menu-tags"]')!);
    click(menu().querySelector<HTMLElement>('[data-testid="task-row-menu-new-tag"]')!);
    const input = menu().querySelector<HTMLInputElement>('[data-testid="task-row-menu-new-tag-input"]');
    expect(input, '点了新建却没长出输入框').not.toBeNull();
    expect(document.activeElement, '草稿没拿到焦点').toBe(input);
  });

  it('🔴 起名字提交：新 id 并进**整组**发出去（不是"只建不打"），随后菜单收走', async () => {
    const onSetTags = vi.fn();
    const onCreateTag = vi.fn(async () => 'g-9');
    const { onClose } = mount(wire({ onSetTags, onCreateTag, currentTagIds: ['g-1'] }));
    click(menu().querySelector<HTMLElement>('[data-testid="task-row-menu-tags"]')!);
    click(menu().querySelector<HTMLElement>('[data-testid="task-row-menu-new-tag"]')!);
    const input = menu().querySelector<HTMLInputElement>('[data-testid="task-row-menu-new-tag-input"]')!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      setter.call(input, '  报销  ');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => {
      menu()
        .querySelector<HTMLFormElement>('.ht-row-menu__create')!
        .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    expect(onCreateTag).toHaveBeenCalledWith('报销');
    expect(onSetTags).toHaveBeenCalledWith('t-1', ['g-1', 'g-9']);
    expect(onClose, '建完勾完该收走菜单').toHaveBeenCalled();
  });

  it('空名不发出任何意图：按钮是禁的，Enter 绕过去也没有第二件事', async () => {
    const onCreateTag = vi.fn(async () => 'g-9');
    mount(wire({ onCreateTag }));
    click(menu().querySelector<HTMLElement>('[data-testid="task-row-menu-tags"]')!);
    click(menu().querySelector<HTMLElement>('[data-testid="task-row-menu-new-tag"]')!);
    const submit = menu().querySelector<HTMLButtonElement>('[data-testid="task-row-menu-new-tag-submit"]')!;
    expect(submit.disabled, '空名时提交按钮不该亮着').toBe(true);
    await act(async () => {
      menu()
        .querySelector<HTMLFormElement>('.ht-row-menu__create')!
        .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    expect(onCreateTag, '空回车凭空建出一条标签').not.toHaveBeenCalled();
  });

  /**
   * 🔴 草稿态的 Esc：上一版是个**死键**。共享层因为 `nestedOpen` 为真把整把键盘让给草稿，
   * 而草稿自己一个键都不接 —— 于是用户改主意按 Esc，菜单和输入框都原地不动，
   * 屏幕上"什么都没发生"（这一族的形状和子菜单 Enter 那次一样：只在键盘上成立）。
   * 现在退一层：草稿收掉、回到「新建标签」那一枚，**菜单留着**（一次 Esc 只退一层）。
   */
  it('🔴 草稿里按 Esc：退回「新建标签」那一枚，菜单**不被一起关掉**', async () => {
    const { onClose } = mount(wire());
    click(menu().querySelector<HTMLElement>('[data-testid="task-row-menu-tags"]')!);
    click(menu().querySelector<HTMLElement>('[data-testid="task-row-menu-new-tag"]')!);
    const input = menu().querySelector<HTMLInputElement>('[data-testid="task-row-menu-new-tag-input"]')!;
    act(() => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    });
    expect(
      menu().querySelector('[data-testid="task-row-menu-new-tag-input"]'),
      '按了 Esc，草稿还在',
    ).toBeNull();
    expect(
      menu().querySelector('[data-testid="task-row-menu-new-tag"]'),
      '退掉草稿后应当回到「新建标签」那一枚',
    ).not.toBeNull();
    expect(onClose, '一次 Esc 不该把整层菜单也抹掉（那是两层一起没）').not.toHaveBeenCalled();
  });

  it('草稿里打字不会被菜单的类型查找抢走焦点（嵌套层让位给输入框）', async () => {
    mount(wire());
    click(menu().querySelector<HTMLElement>('[data-testid="task-row-menu-tags"]')!);
    click(menu().querySelector<HTMLElement>('[data-testid="task-row-menu-new-tag"]')!);
    const input = menu().querySelector<HTMLInputElement>('[data-testid="task-row-menu-new-tag-input"]')!;
    act(() => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'u', bubbles: true, cancelable: true }));
    });
    expect(document.activeElement, '按了一个字母，焦点就不在输入框里了 = 名字打不进去').toBe(input);
  });
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
