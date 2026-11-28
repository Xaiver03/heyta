/**
 * 任务面单的三段式紧凑面单 + 按需浮层
 * ==========================================================
 *
 * 面单从「四分组纵向平铺」收紧成**三段式紧凑面单**：
 *
 *   · 头部：标题 + 备注（`task-detail-header`，标题 → 备注）；
 *   · 正文：默认**不常驻**任何编辑器 —— 截止 / 提醒 / 重复 / 子任务各由
 *     一枚触发器（`task-detail-*-trigger`）按需弹出浮层（`task-detail-popover`），
 *     同一时刻只允许一只浮层；`Escape` 即关；
 *   · 底栏工具条（`task-detail-toolbar`）。
 *
 * 这一层钉的是**默认形态与浮层的开关**（默认不铺编辑器、浮层互斥、Escape 即关），
 * 不重复钉各格的提交语义（那是 `task-detail-card.spec.tsx` 与
 * `task-detail-edit.spec.tsx` 的地盘 —— 本刀是纯排布：不新增字段、不改接线）。
 *
 * 原始 RRULE 仍收在重复浮层里的「高级」折叠中：默认收起、预设单选在外，
 * 展开后校验行为不变。
 *
 * 零 mock：走真 op-log（fake-indexeddb），与既有面单套件同一形状。
 */
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { I18nProvider, zhCN } from '@heyta/i18n';
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

const pane = () => document.querySelector('[data-testid="task-pane"]');

/** b 在 a 之后（同一棵子树里用文档位置比，不猜 DOM 结构）。 */
const follows = (a: Element, b: Element): boolean =>
  (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;

/** 全文档里的浮层（可能被 Portal 到 body，所以从 document 取）。 */
const popovers = (): HTMLElement[] => [
  ...document.querySelectorAll<HTMLElement>('[data-testid="task-detail-popover"]'),
];

function triggerEl(testId: string): HTMLElement {
  const el = document.querySelector<HTMLElement>(`[data-testid="${testId}"]`);
  if (el === null) throw new Error(`没找到触发器 ${testId} ⇒ 判据在空转`);
  return el;
}

async function click(el: HTMLElement): Promise<void> {
  await act(async () => {
    el.click();
  });
}

beforeEach(async () => {
  (globalThis as unknown as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
  (globalThis as unknown as { IDBKeyRange: typeof IDBKeyRange }).IDBKeyRange = IDBKeyRange;
  localStorage.clear();
  selection.clear();
  __resetOpLogForTests();
  // 提醒 store 是模块级单例，每条用例换新的 op-log 库（与 task-detail-card.spec.tsx 同一条理由）。
  useReminderStore.setState({ byTask: {}, due: [], error: undefined });
  await initOpLog(`task-groups-${Math.random().toString(36).slice(2)}`);
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
});

describe('三段式紧凑面单：默认不铺编辑器', () => {
  it('🔴 普通任务默认态：分组/截止/提醒/重复/协作/空附件态一律不渲染，头部四处按序', async () => {
    const id = await addTask('紧凑甲');
    selection.select('task', id);
    mount();
    const box = pane();
    if (box === null) throw new Error('栏里没画面单 ⇒ 这一族判据在空转');

    // 默认态是紧凑的：这些常驻块/编辑器一个都不该挂出来。
    expect(document.querySelectorAll('h3[data-testid="task-detail-group"]'), '不该再有四分组头').toHaveLength(0);
    expect(document.querySelectorAll('[data-testid="date-picker"]'), '截止编辑器不该常驻').toHaveLength(0);
    expect(document.querySelectorAll('[data-testid^="reminder-list-"]'), '提醒列表不该常驻').toHaveLength(0);
    expect(document.querySelectorAll('input[type="radio"]'), '重复预设不该常驻').toHaveLength(0);
    expect(document.querySelectorAll('[data-testid="task-detail-collaboration"]'), '协作区不该常驻').toHaveLength(0);
    expect(document.querySelectorAll('[data-testid="task-attachments-empty"]'), '空附件态不该常驻').toHaveLength(0);

    // 头部四处按文档顺序：header → title → note-input → toolbar。
    const header = box.querySelector('[data-testid="task-detail-header"]');
    const title = box.querySelector('[data-testid="task-detail-title"]');
    const note = box.querySelector('[data-testid="task-note-input"]');
    const toolbar = box.querySelector('[data-testid="task-detail-toolbar"]');
    if (header === null || title === null || note === null || toolbar === null) {
      throw new Error('头部四处没画全 ⇒ 这一族判据在空转');
    }
    expect(follows(header, title), '标题不在头部之后').toBe(true);
    expect(follows(title, note), '备注不在标题之后').toBe(true);
    expect(follows(note, toolbar), '工具条不在备注之后').toBe(true);
  });
});

describe('按需浮层：四个触发器，任意时刻只有一只浮层', () => {
  it('🔴 依次展开截止/提醒/重复/子任务 ⇒ 浮层互斥；Escape 关闭', async () => {
    const id = await addTask('浮层甲');
    selection.select('task', id);
    mount();
    if (pane() === null) throw new Error('栏里没画面单 ⇒ 这一族判据在空转');

    const cases = [
      { trigger: 'task-detail-due-trigger', editor: '[data-testid="date-picker"]', name: '截止' },
      { trigger: 'task-detail-reminder-trigger', editor: '[data-testid^="reminder-list-"]', name: '提醒' },
      { trigger: 'task-detail-repeat-trigger', editor: '[data-testid="task-repeat-advanced"]', name: '重复' },
      { trigger: 'task-detail-subtask-trigger', editor: '[data-testid^="subtask-select-"]', name: '子任务' },
    ] as const;

    for (const item of cases) {
      await click(triggerEl(item.trigger));
      const open = popovers();
      expect(open, `点了「${item.name}」后浮层数不对（应恰好一只）`).toHaveLength(1);
      expect(open[0]!.querySelector(item.editor), `「${item.name}」浮层里没有对应编辑器`).not.toBeNull();
    }

    // 最后一只（子任务）用 Escape 关掉 —— 键盘关闭与真浏览器同一条路。
    const last = popovers()[0];
    if (last === undefined) throw new Error('最后一只浮层不见了 ⇒ 判据在空转');
    await act(async () => {
      last.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(popovers(), 'Escape 之后浮层还在').toHaveLength(0);
  });
});

describe('RRULE 收进「高级」（默认折叠，展开后校验照旧）', () => {
  /** 点重复触发器打开浮层，再把「高级」折叠交给调用方。 */
  async function openRepeatPopover(): Promise<{ popover: HTMLElement; advanced: HTMLDetailsElement }> {
    await click(triggerEl('task-detail-repeat-trigger'));
    const popover = document.querySelector<HTMLElement>('[data-testid="task-detail-popover"]');
    if (popover === null) throw new Error('重复浮层没打开 ⇒ 判据在空转');
    const advanced = popover.querySelector<HTMLDetailsElement>('[data-testid="task-repeat-advanced"]');
    if (advanced === null) throw new Error('浮层里没有「高级」折叠 ⇒ 判据在空转');
    return { popover, advanced };
  }

  it('🔴 默认折叠：`<details>` 在浮层里但 open=false；预设单选不被藏（radio 不在折叠里）', async () => {
    const id = await addTask('高级甲');
    selection.select('task', id);
    mount();

    const { popover, advanced } = await openRepeatPopover();
    expect(advanced.open, '「高级」默认就该收起').toBe(false);
    expect(advanced.querySelector('summary')?.textContent).toBe(zhCN['web.tasks.detail.advanced']);
    // 预设常驻可见：预设单选在折叠**外面**（藏在折叠里 = 主编辑器默认看不见）。
    const radios = [...popover.querySelectorAll<HTMLInputElement>('input[type="radio"]')];
    expect(radios.length, '预设单选没画出来').toBeGreaterThan(2);
    expect(radios.every((r) => !advanced.contains(r)), '预设单选被藏进了「高级」').toBe(true);
  });

  it('🔴 点 summary 展开 ⇒ 输入框可见，校验照常（非法串就地报错、一条 op 不写、规则不落）', async () => {
    const id = await addTask('高级乙');
    selection.select('task', id);
    mount();

    const { advanced } = await openRepeatPopover();

    // jsdom 实现 summary 的激活行为：点 summary 翻转 open —— 与真浏览器同一条路。
    await act(async () => {
      advanced.querySelector('summary')?.click();
    });
    expect(advanced.open, '点了 summary 没展开').toBe(true);

    // 校验照旧：输入一串非法规则并应用 —— 就地报错、repeatRule 不落。
    // （与 `task-repeat.spec.tsx` 的 applyCustom 同一形状：native setter + input 事件。）
    const input = advanced.querySelector<HTMLInputElement>('[data-testid="task-repeat-custom-input"]');
    if (input === null) throw new Error('展开后没有自定义 RRULE 输入框 ⇒ 判据在空转');
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      setter?.call(input, '随便写的');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => {
      advanced.querySelector<HTMLButtonElement>('[data-testid="task-repeat-custom-apply"]')?.click();
    });
    await flush();

    const error = advanced.querySelector('[data-testid="task-repeat-error"]');
    expect(error, '展开后的非法规则没有就地报错').not.toBeNull();
    expect(error?.textContent).toBe(zhCN['web.repeat.error.invalid']);
    expect(useTaskStore.getState().entities.tasks[id]?.repeatRule, '非法规则不该落库').toBeUndefined();

    // 再点一次收起（开合是对称的，不是只能展开的单行道）。
    await act(async () => {
      advanced.querySelector('summary')?.click();
    });
    expect(advanced.open, '再点一次没收起').toBe(false);
  });
});
