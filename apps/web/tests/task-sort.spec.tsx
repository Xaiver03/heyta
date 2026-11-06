/**
 * 任务列表的排序控件（goal 页 10 · 缺口 d）
 * =========================================
 *
 * 🔴 排序**判据**在领域层（`packages/domain/tests/task-order.spec.ts` 钉的是
 * "每一档怎么比"）。这一组钉的是**宿主这四件事**，它们每一件都能单独坏掉而领域测试全绿：
 *
 *   1. 控件**带可见的文字标签** —— 页头上两个裸 chip 的教训（2026-09-30 产品负责人：
 *      "用户根本不知道它们是什么"）：说不清作用范围的控件，加了等于没加；
 *   2. 选下去**真的换了行序**（`sort` 这个 prop 一路透传到共享层，中间没被吞掉）；
 *   3. 刷新后**还是那一档**（设备本地存储；不进 op-log —— 它是阅读偏好不是用户意图）；
 *   4. 🔴 三档排出**三个不同**的顺序。只断言"这些任务都在屏上"的话，
 *      `sort` 被完全忽略也能过 —— 那是最典型的一条假绿判据（§7 第 46 条）。
 *
 * ⚠️ 种的数据**全部没有截止时间**：这样三条任务落在同一个日期分组里
 * （分组会把列表切成多个 `TaskList`，而档位只在**组内**生效，见 `model.ts` 的
 * `flattenSections` 刻意不重排）。跨组比较顺序会验的不是排序，是分组。
 *
 * ⚠️ **变异 `packages/ui`/`packages/domain` 来验证本文件时必须先 rebuild。**
 * web 的测试吃的是工作区包的 **dist**，不是 src —— 实测：改了 src 不打包，
 * 六条用例全绿，看起来像"判据不承重"，其实是探针根本没跑到改过的那份代码
 * （§7 第 27/79 条同一族）。rebuild 之后同一次变异**恰好红两条**（顺序 + 重挂）。
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Priority } from '@heyta/domain';
import { emptyState } from '@heyta/op-log';

(globalThis as unknown as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
(globalThis as unknown as { IDBKeyRange: typeof IDBKeyRange }).IDBKeyRange = IDBKeyRange;

const { App } = await import('../src/App.js');
import { LocaleHost } from '../src/lib/locale-host.js';
import { initOpLog, __resetOpLogForTests } from '../src/lib/oplog.js';
import { useTaskStore } from '../src/features/tasks/store.js';
import { usePrivacyStore } from '../src/features/privacy/store.js';

let root: Root | undefined;
let container: HTMLDivElement | undefined;

/**
 * 🔴 自己推进的时钟：`createdAt` 来自 `Date.now`，而同一台设备连续建两条
 * **经常落在同一毫秒**里。真时钟下"按添加时间"会退化成插入顺序，
 * 于是下面那条"三档三个不同顺序"的判据会**随机变红**（app-host 的
 * `byCanonicalOrder` 注释里写的就是同一件事）。
 */
let tick = 1_700_000_000_000;

beforeEach(async () => {
  localStorage.clear();
  localStorage.setItem('privacy.consent', JSON.stringify({ decision: 'local-only', decidedAt: new Date().toISOString() }));
  usePrivacyStore.setState({ open: false, reason: 'first-launch', notPersisted: false });
  vi.spyOn(Date, 'now').mockImplementation(() => (tick += 1_000));
  __resetOpLogForTests();
  await initOpLog(`task-sort-${Math.random().toString(36).slice(2)}`);
  useTaskStore.setState({ entities: emptyState(), filter: { kind: 'all' } });
});

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  container?.remove();
  root = undefined;
  container = undefined;
  vi.restoreAllMocks();
});

async function mountApp(): Promise<HTMLDivElement> {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(
      <LocaleHost>
        <App />
      </LocaleHost>,
    );
  });
  await act(async () => {
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
  });
  return container;
}

/**
 * 屏上行的**DOM 顺序**（不是字母序 —— 这里要断言的就是顺序本身）。
 *
 * ⚠️ 探针只认 `[role="checkbox"]` 的 `aria-label`：每行尾部那些下拉会把别的
 * 标题也渲染进 `textContent`，用文本包含判定会恒真（同 `task-groups.spec.tsx`）。
 */
function rowOrder(el: HTMLElement): string[] {
  return [...el.querySelectorAll('[data-testid^="task-group-"] [role="checkbox"]')].map(
    (box) => box.getAttribute('aria-label') ?? '',
  );
}

async function seedThree(): Promise<void> {
  await act(async () => {
    // 建完即设优先级：`addTask` 的入参里没有 createdAt，而优先级有独立的一条 op。
    await useTaskStore.getState().addTask('甲');
    await useTaskStore.getState().addTask('乙');
    await useTaskStore.getState().addTask('丙');
  });
  const tasks = Object.values(useTaskStore.getState().entities.tasks);
  const byTitle = new Map(tasks.map((t) => [t.title, t.id]));
  await act(async () => {
    await useTaskStore.getState().setPriority(byTitle.get('甲')!, Priority.None);
    await useTaskStore.getState().setPriority(byTitle.get('乙')!, Priority.High);
    await useTaskStore.getState().setPriority(byTitle.get('丙')!, Priority.Medium);
  });
}

/**
 * 点开页头那枚 `⋯`，返回挂出来的菜单。
 *
 * 🔴 `document` 而不是 `el`：`AnchoredMenu` 门户到 `body`（页头是 `overflow` 容器，
 * 挂在里面会被裁掉半截）。所以菜单项**不在**组件容器子树里 —— 拿 `el.querySelector`
 * 找菜单项会恒为 null，而那条断言会看起来像"功能坏了"。
 */
async function openMenu(el: HTMLElement): Promise<HTMLElement> {
  const trigger = el.querySelector<HTMLElement>('[data-testid="task-menu-open"]');
  expect(trigger, '任务视图页头必须有一枚 ⋯（排序、选择任务、共享都收在里面）').not.toBeNull();
  await act(async () => {
    trigger!.click();
    await Promise.resolve();
  });
  const menu = document.querySelector<HTMLElement>('[data-testid="task-menu"]');
  expect(menu, '点开 ⋯ 之后菜单必须真的挂出来').not.toBeNull();
  return menu!;
}

/** 选档位：走 `⋯` 里的单选组（2026-11-02 起，原来是一枚原生 `<select>`）。 */
async function pickSort(el: HTMLElement, value: string): Promise<void> {
  const menu = await openMenu(el);
  const item = menu.querySelector<HTMLElement>(`[data-testid="task-sort-${value}"]`);
  expect(item, `菜单里没有档位 ${value}`).not.toBeNull();
  await act(async () => {
    item!.click();
    await Promise.resolve();
  });
}

describe('任务列表的排序控件', () => {
  /**
   * 🔴 判据在 2026-11-02 换了形状，**不是放宽**。
   *
   * 旧形状钉的是"页头里有一枚带可见文字标签的原生 `<select>`"。那枚控件是
   * `12px 文字标签 + 44px 带框下拉`，与旁边的图标按钮、ghost 按钮三种控制语法并列；
   * 而且它 gate 在 `visible.length > 0` 上 —— 空列表时整个消失。
   *
   * 新形状钉的是同一件**用户能做的事**：从页头找到排序、看懂每一档、看见当前是哪一档。
   * 换掉的是形状（收进 `⋯` 的单选组），减掉的是"页头上多一枚常驻下拉"。
   */
  it('🔴 排序从页头 `⋯` 可达：四档都在、都是可见文字、当前档位有 aria-checked', async () => {
    await seedThree();
    const el = await mountApp();

    // 页头里不再有第二枚带文字标签的控件 —— 这是这一轮的目的，也钉住"别搬回来"。
    expect(
      el.querySelector('[data-testid="task-sort"]'),
      '排序不该再是页头上一枚常驻控件（它已收进 ⋯）',
    ).toBeNull();

    const menu = await openMenu(el);
    expect(menu.textContent, '分组标题必须渲染在屏上（只挂 aria-label 不算）').toContain('排序');

    const items = [...menu.querySelectorAll<HTMLElement>('[data-testid^="task-sort-"]')];
    /**
     * 🔴 **四档，不是三档。**
     *
     * 2026-11-06：领域层把「手动拖拽」（`manual`，走已存在的 `Task.order`）
     * 加进 `TASK_SORT_KEYS`，而这条断言还钉在 3 档上 —— 于是它红了 5 条 web 用例里的 2 条。
     * 要说清的是：**这不叫"用例过时"**。它当时确实在钉"排序只有三档"，
     * 而加一档排序本来就应该有痕迹 —— 菜单多一枚、`aria-checked` 多一格、
     * 用户多一个可选档位。改这里不是为了让门禁绿，是把"四档"这件事记下来。
     */
    expect(items.map((item) => item.textContent)).toEqual([
      '默认（按截止时间）',
      '按添加时间',
      '按优先级',
      '手动拖拽',
    ]);
    // 单选语义：当前档位必须报出来，否则"我现在按什么排"无处可读。
    expect(items.map((item) => item.getAttribute('role'))).toEqual([
      'menuitemradio',
      'menuitemradio',
      'menuitemradio',
      'menuitemradio',
    ]);
    expect(items.map((item) => item.getAttribute('aria-checked'))).toEqual([
      'true',
      'false',
      'false',
      'false',
    ]);
  });

  it('默认档就是领域的 display：插入顺序（无截止 ⇒ 组内稳定原序）', async () => {
    await seedThree();
    const el = await mountApp();
    expect(rowOrder(el)).toEqual(['完成：甲', '完成：乙', '完成：丙']);
  });

  it('🔴 三档排出**三个不同**的顺序（`sort` 被忽略时这条必红）', async () => {
    await seedThree();
    const el = await mountApp();
    const seen = new Set<string>();
    seen.add(rowOrder(el).join('|'));

    await pickSort(el, 'priority');
    const byPriority = rowOrder(el);
    expect(byPriority, '高的在前；None 与 undefined 同义 ⇒ 落最后').toEqual([
      '完成：乙',
      '完成：丙',
      '完成：甲',
    ]);

    await pickSort(el, 'addedAt');
    const byAdded = rowOrder(el);
    expect(byAdded, '新的在前：刚记下来那条就是用户要找的').toEqual([
      '完成：丙',
      '完成：乙',
      '完成：甲',
    ]);

    seen.add(byPriority.join('|'));
    seen.add(byAdded.join('|'));
    expect(seen.size, '三档必须是三个不同的顺序 —— 相同就说明某个 key 根本没生效').toBe(3);

    /**
     * 🔴 「手动拖拽」**故意不进上面那张表**，这不是漏了。
     *
     * 这一档比的是 `Task.order`，而这批种子任务一个 `order` 都没写 ⇒
     * 比较器对每一对都返回 0（`task-order.ts` 的 `case 'manual'`）⇒ 外层按**原序**兜底。
     * 所以"四档排出四个不同顺序"是个**不存在**的判据：真写成 `toBe(4)` 它恒红。
     *
     * 能钉的是相反的那件事：**没写过 order 时手动档退回原序，而不是乱序/按 id 序**。
     * 用户第一次看到「手动拖拽」时库里一条都没拖过，此时列表必须还是原来那个样子 ——
     * 换个档位就把列表打乱，会让人以为拖拽数据丢了。
     */
    await pickSort(el, 'manual');
    expect(rowOrder(el), '没写过 order ⇒ 手动档退回原序（与 display 同），不是乱序').toEqual([
      '完成：甲',
      '完成：乙',
      '完成：丙',
    ]);
  });

  it('🔴 重挂之后还是选的那一档（设备本地持久化，不是内存态）', async () => {
    await seedThree();
    const first = await mountApp();
    await pickSort(first, 'priority');
    expect(localStorage.getItem('heyta.taskSort'), '存的必须是档位本身').toBe('"priority"');

    act(() => {
      root?.unmount();
    });
    container?.remove();
    root = undefined;
    container = undefined;

    const again = await mountApp();
    // 选中项从存储读 —— 读的是菜单里那一项的 `aria-checked`（页头上已没有 select）。
    const menu = await openMenu(again);
    const checked = menu.querySelector<HTMLElement>('[aria-checked="true"]');
    expect(checked?.getAttribute('data-testid'), '重挂后选中项要来自存储').toBe('task-sort-priority');
    expect(rowOrder(again), '重挂后顺序也得是那一档的').toEqual([
      '完成：乙',
      '完成：丙',
      '完成：甲',
    ]);
  });

  it('存储被改成非法值时回到默认档（而不是把列表排空）', async () => {
    await seedThree();
    localStorage.setItem('heyta.taskSort', '"按心情"');
    const el = await mountApp();
    const menu = await openMenu(el);
    const checked = menu.querySelector<HTMLElement>('[aria-checked="true"]');
    expect(checked?.getAttribute('data-testid')).toBe('task-sort-display');
    expect(rowOrder(el), '非法值不能让列表变空').toHaveLength(3);
  });

  /**
   * 🔴 **这一条在 2026-11-02 被反着钉了。**
   *
   * 旧判据："一行都没有时不出现排序条（没有可排的东西，就不该有个能点的控件）"。
   * 那条判据的前提是"排序是一枚动作按钮"，而它其实是**视图属性**：
   * 空列表里用户仍然需要知道"这个清单按什么排"（而且加了任务之后立刻生效的那一档
   * 就是它）。旧形状下这条判据真正钉住的东西是"别的地方漏了 gate"，
   * 而不是"用户不需要排序"。
   *
   * 新判据钉两件事：`⋯` 在空列表里**仍然在**（入口不随数据条数变形），
   * 而「选择任务」在空列表里**被禁用而不是消失**（禁用态仍然说明"有这个能力"，
   * 消失则让用户以为产品没有这个功能）。
   */
  it('空列表：`⋯` 仍然在、排序四档仍可选，而「选择任务」是禁用而不是消失', async () => {
    const el = await mountApp();
    const menu = await openMenu(el);
    expect(
      [...menu.querySelectorAll('[data-testid^="task-sort-"]')],
      '排序是视图属性，不该随数据条数消失',
    ).toHaveLength(4);
    const selectItem = menu.querySelector<HTMLButtonElement>('[data-testid="task-select-open"]');
    expect(selectItem, '没有任务时入口应当还在（说明能力存在）').not.toBeNull();
    expect(selectItem!.disabled, '没有任务时选不出东西 ⇒ 禁用').toBe(true);
  });

  it('批量选择入口只在任务列表里出现，完成后退出选择态', async () => {
    await seedThree();
    const el = await mountApp();
    // 🔴 入口在 `⋯` 里（2026-11-02 起）。它以前是页头上一枚常驻的「选择任务」按钮 ——
    // 任何时候都在，而绝大多数时候用户并不在选任务。
    const menu = await openMenu(el);
    const selectItem = menu.querySelector<HTMLButtonElement>('[data-testid="task-select-open"]');
    expect(selectItem, '有任务时「选择任务」必须可用').not.toBeNull();
    expect(selectItem!.disabled).toBe(false);
    await act(async () => {
      selectItem!.click();
      await Promise.resolve();
    });
    const task = Object.values(useTaskStore.getState().entities.tasks)[0]!;
    const checkbox = el.querySelector<HTMLInputElement>(`[data-testid="bulk-select-${task.id}"]`);
    expect(checkbox).not.toBeNull();
    await act(async () => {
      checkbox?.click();
    });
    expect(el.textContent).toContain('已选 1 项');
    const row = el.querySelector<HTMLElement>(`[data-testid="task-item-${task.id}"]`);
    expect(row, '选择态任务行必须保留稳定锚点').not.toBeNull();
    expect(
      row?.querySelector(`button[aria-label="删除：${task.title}"]`),
      '批量选择时不应继续暴露单条删除动作',
    ).toBeNull();
    expect(
      getComputedStyle(row as HTMLElement).backgroundColor,
      '选中的任务行必须有共享层的高亮',
    ).not.toBe('rgba(0, 0, 0, 0)');
    const complete = [...el.querySelectorAll('button')].find((button) => button.textContent?.includes('批量完成'));
    expect(complete).toBeDefined();
    await act(async () => {
      complete?.click();
    });
    /**
     * 🔴 这里原来是一个**固定 50ms 的 sleep**，然后在下面断言 `completedAt`。
     * 一条 BATCH op 要过 op-log 与动作层，50ms 在空闲机器上够、在整包并发时不够 ——
     * 实测同一棵树、同一条用例，全量跑红、单独跑绿。固定 sleep 量的是"机器有多快"，
     * 不是"批量完成会不会写回"。改成**有界等待**：断言一个字没变，
     * 只是把"等到它发生"从猜一个数换成等到它真发生（上限 5s）。
     */
    await vi.waitFor(
      () => {
        expect(useTaskStore.getState().entities.tasks[task.id]?.completedAt).toBeDefined();
      },
      { timeout: 5000 },
    );
    // 写回与"退出选择态"是**两拍**（后者在 op 落盘之后）：同一份有界等待，不猜时间。
    await vi.waitFor(
      () => {
        expect(el.textContent).not.toContain('已选 1 项');
      },
      { timeout: 5000 },
    );
  });

  it('Esc 退出批量选择态并清除已选任务', async () => {
    await seedThree();
    const el = await mountApp();
    const menu = await openMenu(el);
    const selectItem = menu.querySelector<HTMLButtonElement>('[data-testid="task-select-open"]')!;
    await act(async () => {
      selectItem.click();
      await Promise.resolve();
    });
    const task = Object.values(useTaskStore.getState().entities.tasks)[0]!;
    const checkbox = el.querySelector<HTMLInputElement>(`[data-testid="bulk-select-${task.id}"]`)!;
    await act(async () => {
      checkbox.click();
    });
    expect(el.textContent).toContain('已选 1 项');
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(el.textContent).not.toContain('已选 1 项');
    expect(el.querySelector(`[data-testid="bulk-select-${task.id}"]`)).toBeNull();
  });
});
