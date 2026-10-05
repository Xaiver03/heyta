/**
 * 任务面单的那一格画什么、以及"备注"这一字段此刻归谁（工单 §8.138）
 * ==================================================================
 *
 * 这一单做的是 §8.125 第 3 节那道 DoD 的**任务那一格**：选中某条任务 ⇒
 * `.ht-app__detail` 里换成该实体的面单。它同时钉住裁决的不变量 ——
 *
 *   🔴 **每个字段任何时刻只有一个编辑器所有者**。
 *
 * 备注这一栏有两个落点（栏里 / 行尾那颗 chip），选哪个**只许一个在场**。症状说具体一点：
 * 两处都在 = 用户改 A 处、看 B 处，而两处的写入语义迟早漂（一份失焦提交、一份点保存提交）；
 * 两处都不在 = 窄档下写不了备注，而那是这一单动因要修的那个洞（`NoteEditor.tsx` 文件头：
 * "我自己能不能在任务上写点东西"曾经的答案是"不能"）。
 *
 * ⚠️ 两层各管各的：这一层管"面单本身对不对 + 宿主有没有把开关接上"（读源码形状，
 * 沿 §8.130 第 3 节 P3 那三条的口径 —— 直接挂组件的测试看不见 `App.tsx` 漏接线）；
 * **真浏览器读数在 `e2e/tests/detail-pane-task.spec.ts`**（含 containment 与 Enter 焦点）。
 */
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { I18nProvider } from '@heyta/i18n';

import { __resetOpLogForTests, initOpLog, useTaskStore } from '../src/features/tasks/store.js';
import { selection } from '../src/lib/selection.js';

const { TaskDetailCard } = await import('../src/features/tasks/TaskDetailCard.js');
const { NoteBadge } = await import('../src/features/tasks/NoteEditor.js');

const APP_SRC = readFileSync(join(process.cwd(), 'src', 'App.tsx'), 'utf8');

let root: Root | undefined;
let container: HTMLDivElement | undefined;

/** 剥掉注释：一条会被散文改变的判据量的不是代码（§8.130 第 3 节那条实测）。 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

function mount(): void {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root?.render(
      <I18nProvider locale="zh-CN">
        <TaskDetailCard />
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

async function addTask(title: string, note?: string): Promise<string> {
  await act(async () => {
    await useTaskStore.getState().addTask(title);
  });
  const id = Object.keys(useTaskStore.getState().entities.tasks).find(
    (k) => useTaskStore.getState().entities.tasks[k]?.title === title,
  );
  if (id === undefined) throw new Error(`建不出任务 ${title} ⇒ 这一族的判据在空转`);
  if (note !== undefined) {
    await act(async () => {
      await useTaskStore.getState().setNote(id, note);
    });
  }
  await flush();
  return id;
}

beforeEach(async () => {
  (globalThis as unknown as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
  (globalThis as unknown as { IDBKeyRange: typeof IDBKeyRange }).IDBKeyRange = IDBKeyRange;
  localStorage.clear();
  selection.clear();
  __resetOpLogForTests();
  await initOpLog(`task-pane-${Math.random().toString(36).slice(2)}`);
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

describe('选中某条任务 ⇒ 那一格是它的面单', () => {
  it('🔴 画的是**选中的那一条**：标题原样、备注是全文（不是行那颗截到 24 字的预览）', async () => {
    const id = await addTask('写周报', '第一段\n第二段\n第三段');
    selection.select('task', id);
    mount();
    expect(container?.querySelector('[data-testid="task-pane"]')).not.toBeNull();
    expect(container?.querySelector('h2')?.textContent).toBe('写周报');
    const field = container?.querySelector<HTMLTextAreaElement>('[data-testid="task-note-input"]');
    expect(field, '栏里没有备注正文框').toBeDefined();
    expect(field?.value).toBe('第一段\n第二段\n第三段');
  });

  it('🔴 没选中 ⇒ 这一格什么都不画（不许画一份"当作第一条"的数据）', async () => {
    await addTask('甲', 'A');
    await addTask('乙', 'B');
    selection.select('task', null);
    mount();
    expect(container?.innerHTML, '未选中却画了面单').toBe('');
  });

  it('🔴 那条任务在别处被删掉 ⇒ 面单消失，而不是留一只指向不存在 id 的框', async () => {
    const id = await addTask('要删的', '内容');
    selection.select('task', id);
    mount();
    expect(container?.querySelector('[data-testid="task-note-input"]'), '前置没成立：栏里根本没有框').not.toBeNull();
    // 这里**不再挂一次**：删掉一条是 store 更新，面单订阅的是同一枚 root。
    // 再 `mount()` 会往同一个 container 里塞第二个 root，那读的是上一帧的 DOM。
    await act(async () => {
      await useTaskStore.getState().deleteTask(id);
    });
    await flush();
    expect(container?.querySelector('[data-testid="task-pane"]'), '任务已经不在，栏里却还画着它').toBeNull();
  });

  it('全栏只有一只备注输入框（两处可编辑 = 两套写入语义迟早漂）', async () => {
    const id = await addTask('计数', '只许一只');
    selection.select('task', id);
    mount();
    expect(container?.querySelectorAll('[data-testid="task-note-input"]').length).toBe(1);
  });
});

describe('面单跟着选中换人', () => {
  /**
   * 🔴 这一条钉的是 `key={task.id}`。
   *
   * 正文框是**非受控**的（`defaultValue`），React 不会因为 props 变了就重写用户已经打进去的
   * 内容。两条备注恰好同字的任务之间切换时"看起来是对的"，所以判据不能比内容 ——
   * 这里先把框里的字改成只有这一条才有的内容（**不 blur，所以没落库**），再切选中：
   * 不换 key 的话框里留着上一条那份没落盘的草稿，而标题已经换了 —— 界面在说"这是乙"，
   * 框里编辑的却是甲。
   */
  it('🔴 上一条的未落盘草稿不许跟着人走（标题换了，框里也得换）', async () => {
    const a = await addTask('甲', '同字');
    const b = await addTask('乙', '同字');
    selection.select('task', a);
    mount();
    const field = container?.querySelector<HTMLTextAreaElement>('[data-testid="task-note-input"]');
    expect(field).toBeDefined();
    act(() => {
      field!.value = '只有甲才有的草稿';
    });
    /* 🔴 换选中**不再挂一次**：`mount()` 会新建一枚 root，那只框无论如何都是新的 DOM 节点，
       于是"换 key 没有"这一份坏被探针自己抹掉了 —— 臂 A2 就是这么活下来的（jsdom 全绿、
       e2e 红）。面单订阅的是同一枚 root，改选中只需 `act` 里换 selection。 */
    act(() => {
      selection.select('task', b);
    });
    const after = container?.querySelector<HTMLTextAreaElement>('[data-testid="task-note-input"]');
    expect(container?.querySelector('h2')?.textContent).toBe('乙');
    expect(after?.value, '换选中之后框里还是上一条没落盘的草稿').toBe('同字');
    expect(after).not.toBe(field);
  });
});

describe('行尾那枚只读徽标（备注搬进栏里之后，列表还要看得出"这一行写过东西"）', () => {
  /** 直接挂徽标：它没有 store 依赖，读的是传进去的那条任务。 */
  function badge(task: { id: string; title: string; note?: string }): string {
    const host = document.createElement('div');
    document.body.append(host);
    const r = createRoot(host);
    act(() => {
      r.render(
        <I18nProvider locale="zh-CN">
          <NoteBadge task={task as never} />
        </I18nProvider>,
      );
    });
    const html = host.innerHTML;
    act(() => {
      r.unmount();
    });
    host.remove();
    return html;
  }

  it('🔴 有备注 ⇒ 徽标带预览，而它**里面没有输入框**（只读，不是第二份编辑器）', () => {
    const html = badge({ id: 'b1', title: '有备注的', note: '第一段\n第二段' });
    expect(html).toContain('task-note-badge-b1');
    expect(html).toContain('第一段');
    expect(html, '徽标里出现了 textarea ⇒ 备注又长出第二个编辑器').not.toContain('textarea');
    expect(html, '徽标里出现了 details ⇒ 那是展开机关，不是只读痕迹').not.toContain('details');
  });

  it('🔴 没备注 ⇒ 不占位（拍板 #8 的 `record` 那一档：有记录才出现）', () => {
    expect(badge({ id: 'b2', title: '空的' })).toBe('');
    expect(badge({ id: 'b3', title: '空串', note: '   ' })).toBe('');
  });
});

describe('宿主的落点接线（读 App.tsx 的源码形状）', () => {
  const src = stripComments(APP_SRC);

  it('🔴 栏里那一支与行尾那两支用的是**同一枚布尔**（编辑器只有一份，另一支是只读徽标）', () => {
    expect(src).toMatch(/<TaskDetailCard\s*\/>/);
    expect(
      src,
      '栏里画着的时候行尾还在挂 `<NoteEditor/>` ⇒ 备注两处可编辑（两套写入语义迟早漂）',
    ).toMatch(/\{\s*taskPaneInColumn\s*\?\s*\(\s*<NoteBadge\s+task=\{task\}\s*\/>\s*\)\s*:\s*\(\s*<NoteEditor/);
    expect(src, '栏里那一支不看这枚布尔 ⇒ 窄档会在 display:none 里藏一只编辑器').toMatch(
      /\)\s*:\s*taskPaneInColumn\s*\?\s*\(\s*<TaskDetailCard/,
    );
  });

  it('🔴 这枚布尔只有一个定义处，且同时看**几何**与**任务那一族的三个视图**', () => {
    const definitions = src.match(/const taskPaneInColumn =/g) ?? [];
    expect(definitions.length, `taskPaneInColumn 被定义${definitions.length}次（第二份就是漂移的起点）`).toBe(1);
    const block = /const taskPaneInColumn =([\s\S]*?);/.exec(src)?.[1] ?? '';
    expect(block).toContain('detailColumnShown');
    for (const view of ['tasks', 'quadrant', 'timeline']) {
      expect(block, `任务那一族少了 ${view}：那一面按了 Enter 会落空`).toContain(`'${view}'`);
    }
  });
});
