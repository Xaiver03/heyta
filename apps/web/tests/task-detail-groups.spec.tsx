/**
 * 任务面单的四分组 + 「高级」折叠（工单 W6，审计 §4.6）
 * ==========================================================
 *
 * 审计 §4.6 的原话是「详情列功能太全、层级不够」：七格字段一条纵向平铺，
 * 备注/子任务/清单/重复/RRULE/截止/提醒之间没有任何层级。整改两刀：
 *
 *   1. **固定四组**：基本信息（标题/备注）→ 时间（截止/提醒）→
 *      组织（清单/标签/子任务/优先级）→ 自动化（重复），每组装一枚分组头；
 *   2. **原始 RRULE 收进「高级」**：预设与当前规则常驻可见，自定义 RRULE
 *      的文本框放进默认折叠的 `<details>`，展开后校验行为不变。
 *
 * 这一层钉的是**排布本身**（分组头存在、有序、字段住进语义正确的组），
 * 不重复钉各格的提交语义（那是 `task-detail-card.spec.tsx` 与
 * `task-detail-edit.spec.tsx` 的地盘 —— 本刀是纯排布：不新增字段、不改接线）。
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

describe('四分组（W6，审计 §4.6）', () => {
  /** b 在 a 之后（同一棵子树里用文档位置比，不猜 DOM 结构）。 */
  const follows = (a: Element, b: Element): boolean =>
    (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;

  it('🔴 四个分组头按序渲染（基本信息 → 时间 → 组织 → 自动化），且各恰好一枚', async () => {
    const id = await addTask('分组甲');
    selection.select('task', id);
    mount();
    const box = pane();
    if (box === null) throw new Error('栏里没画面单 ⇒ 这一族判据在空转');
    const groups = [...box.querySelectorAll<HTMLElement>('h3[data-testid="task-detail-group"]')].map(
      (h) => h.textContent,
    );
    expect(groups, '四个分组头没按序画出来').toEqual([
      zhCN['web.tasks.detail.section.basic'],
      zhCN['web.tasks.detail.section.time'],
      zhCN['web.tasks.detail.section.organize'],
      zhCN['web.tasks.detail.section.automation'],
    ]);
  });

  it('🔴 每个字段住进语义正确的组：组头在组员之前、下一组头之前住完（优先级在「组织」）', async () => {
    const id = await addTask('分组乙');
    selection.select('task', id);
    mount();
    const box = pane();
    if (box === null) throw new Error('栏里没画面单 ⇒ 这一族判据在空转');

    const g = (key: 'basic' | 'time' | 'organize' | 'automation'): Element => {
      const el = [...box.querySelectorAll('h3[data-testid="task-detail-group"]')].find(
        (h) => h.textContent === zhCN[`web.tasks.detail.section.${key}`],
      );
      if (el === undefined) throw new Error(`没找到「${key}」分组头 ⇒ 判据在空转`);
      return el;
    };
    const field = (selector: string): Element => {
      const el = box.querySelector(selector);
      if (el === null) throw new Error(`没找到 ${selector} ⇒ 判据在空转`);
      return el;
    };

    const basic = g('basic');
    const time = g('time');
    const organize = g('organize');
    const automation = g('automation');

    // 基本信息：备注（标题 h2 在四枚组头之前，是统领元素不是组员）。
    expect(follows(basic, field('[data-testid="task-note-input"]')), '备注不在基本信息组').toBe(true);
    // 时间：截止月历 + 提醒列表。
    expect(follows(time, field('[data-testid="date-picker"]')), '截止不在时间组').toBe(true);
    expect(follows(time, field(`[data-testid="reminder-list-${id}"]`)), '提醒不在时间组').toBe(true);
    // 组织：清单下拉 + 子任务 select + 优先级 select（🔴 优先级归组织不归时间，
    // 裁决理由在 TaskDetailCard 文件头 —— 判据钉的就是这条裁决本身）。
    expect(follows(organize, field('[data-testid="organize-project-select"]')), '清单不在组织组').toBe(true);
    expect(follows(organize, field(`[data-testid="subtask-select-${id}"]`)), '子任务不在组织组').toBe(true);
    expect(
      follows(organize, field('[data-testid="task-priority-select"]')),
      '优先级不在组织组（它不是时间量，W6 把它从截止/提醒之间挪了过来）',
    ).toBe(true);
    // 自动化：重复的预设单选。
    expect(follows(automation, field('[data-testid="task-repeat-custom-input"]')), '重复不在自动化组').toBe(true);

    // 组员必须**住在本组里**：出现在下一枚组头之前（不许跨组串门）。
    // `follows(member, next)` = 组员在下一枚组头**之前**（本文件 follows 的唯一语义，
    // 与上面全部正向断言一致）——住对了组它就是 true；写反成 false 会让循环在
    // 第一个组员就红（2026-10-06 实测：断言 authoring bug，非实现 bug）。
    for (const [group, member] of [
      [basic, field('[data-testid="task-note-input"]')],
      [time, field('[data-testid="date-picker"]')],
      [time, field(`[data-testid="reminder-list-${id}"]`)],
      [organize, field('[data-testid="organize-project-select"]')],
      [organize, field(`[data-testid="subtask-select-${id}"]`)],
      [organize, field('[data-testid="task-priority-select"]')],
    ] as const) {
      const next =
        group === basic ? time : group === time ? organize : automation;
      expect(
        follows(member, next),
        '字段没能在下一枚组头之前住完（跨组串门 / 组序错位）',
      ).toBe(true);
    }
  });
});

describe('RRULE 收进「高级」（W6，审计 §4.6）', () => {
  it('🔴 默认折叠：`<details>` 在栏里但 open=false；预设单选不被藏（radio 不在折叠里）', async () => {
    const id = await addTask('高级甲');
    selection.select('task', id);
    mount();
    const box = pane();
    if (box === null) throw new Error('栏里没画面单 ⇒ 这一族判据在空转');
    const advanced = box.querySelector<HTMLDetailsElement>('[data-testid="task-repeat-advanced"]');
    if (advanced === null) throw new Error('栏里没有「高级」折叠 ⇒ 判据在空转');
    expect(advanced.open, '「高级」默认就该收起').toBe(false);
    expect(advanced.querySelector('summary')?.textContent).toBe(zhCN['web.tasks.detail.advanced']);
    // 预设常驻可见：预设单选在折叠**外面**（藏在折叠里 = 主编辑器默认看不见）。
    const radios = [...box.querySelectorAll<HTMLInputElement>('input[type="radio"]')];
    expect(radios.length, '预设单选没画出来').toBeGreaterThan(2);
    expect(radios.every((r) => !advanced.contains(r)), '预设单选被藏进了「高级」').toBe(true);
  });

  it('🔴 点 summary 展开 ⇒ 输入框可见，校验照常（非法串就地报错、一条 op 不写、规则不落）', async () => {
    const id = await addTask('高级乙');
    selection.select('task', id);
    mount();
    const box = pane();
    if (box === null) throw new Error('栏里没画面单 ⇒ 这一族判据在空转');
    const advanced = box.querySelector<HTMLDetailsElement>('[data-testid="task-repeat-advanced"]');
    if (advanced === null) throw new Error('栏里没有「高级」折叠 ⇒ 判据在空转');

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
