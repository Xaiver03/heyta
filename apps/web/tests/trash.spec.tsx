/**
 * 回收站（Web 壳）
 * ==================
 *
 * 两层断言：
 *   1. **store**：恢复/彻底删除都必须**产生 op**（D4：op-log 是唯一写入口），
 *      而不是只改 `entities`。只改本地状态的实现在这里就会红。
 *   2. **组件**：`TrashView` 的"彻底删除"必须**二次确认** ——
 *      点一下删除图标不能已经删掉了。
 */

import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { emptyState } from '@heyta/op-log';

import { currentState } from '../src/lib/oplog.js';
import { useHabitStore } from '../src/features/habits/store.js';
import { useNoteStore } from '../src/features/notes/store.js';
import { useProjectStore } from '../src/features/projects/store.js';
import {
  __resetOpLogForTests,
  initOpLog,
  selectTrashedTasks,
  selectVisibleTasks,
  useTaskStore,
} from '../src/features/tasks/store.js';

const { TrashView } = await import('../src/features/trash/TrashView.js');

let dbName: string;

async function seedTrashed(title: string): Promise<string> {
  await useTaskStore.getState().addTask(title);
  const id = Object.values(useTaskStore.getState().entities.tasks).find(
    (t) => t.title === title,
  )!.id;
  await useTaskStore.getState().deleteTask(id);
  return id;
}

/** 建一条便签再删掉 —— 返回它的 id（id 来自动作层，不在这里造）。 */
async function seedTrashedNote(content: string): Promise<string> {
  await useNoteStore.getState().addNote(content);
  const id = useNoteStore.getState().notes.find((n) => n.content === content)!.id;
  await useNoteStore.getState().removeNote(id);
  return id;
}

let root: Root | undefined;
let container: HTMLDivElement | undefined;

function renderTrash(): HTMLDivElement {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root?.render(<TrashView />);
  });
  return container;
}

function click(el: Element | null | undefined): void {
  act(() => {
    (el as HTMLElement | null)?.click();
  });
}

/**
 * 等一个异步写入落地。
 *
 * 组件里的按钮是 `void restoreTask(id)`（fire-and-forget），而真正的写入要
 * 穿过 IndexedDB 的事务。只 `await Promise.resolve()` 一次不足以排空它 ——
 * 于是断言会在写入完成前读到旧状态，测试随机变红（比没有测试更糟）。
 * 这里显式轮询到条件成立，并给一个上限而不是无限等。
 */
async function waitFor(predicate: () => boolean): Promise<void> {
  for (let i = 0; i < 50; i += 1) {
    if (predicate()) return;
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  container?.remove();
  root = undefined;
  container = undefined;
});

beforeEach(async () => {
  const g = globalThis as unknown as {
    indexedDB: IDBFactory;
    IDBKeyRange: typeof IDBKeyRange;
  };
  g.indexedDB = new IDBFactory();
  g.IDBKeyRange = IDBKeyRange;

  dbName = `web-trash-test-${Math.random().toString(36).slice(2)}`;
  __resetOpLogForTests();
  useTaskStore.setState({
    entities: emptyState(),
    filter: { kind: 'all' },
    now: Date.now(),
    ready: false,
  });
  // 便签 store 与任务 store 分属两个 zustand store：引擎换了它不会自己清空，
  // 显式复位，否则上一条用例留下的行会让 toEqual 变成猜顺序。
  useNoteStore.setState({ notes: [], trashed: [], error: undefined, editError: undefined });
  await initOpLog(dbName);
});

describe('回收站 store', () => {
  it('删除后进入回收站，恢复后回到可见列表', async () => {
    const id = await seedTrashed('写文档');
    expect(selectTrashedTasks(useTaskStore.getState()).map((t) => t.id)).toEqual([id]);
    expect(selectVisibleTasks(useTaskStore.getState())).toHaveLength(0);

    await useTaskStore.getState().restoreTask(id);

    expect(selectTrashedTasks(useTaskStore.getState())).toHaveLength(0);
    expect(selectVisibleTasks(useTaskStore.getState()).map((t) => t.id)).toEqual([id]);
    // 墓碑真的被清掉了（不是只从列表里过滤掉）
    expect(useTaskStore.getState().entities.tasks[id]!.deletedAt).toBeUndefined();
  });

  it('彻底删除：回收站里消失、墓碑仍在、恢复被拒绝', async () => {
    const id = await seedTrashed('写文档');

    await useTaskStore.getState().purgeTask(id);

    expect(selectTrashedTasks(useTaskStore.getState())).toHaveLength(0);
    const task = useTaskStore.getState().entities.tasks[id]!;
    expect(task.purgedAt).toBeTypeOf('number');
    // 墓碑不能被清掉 —— 清掉离线端会把它当"从未删除"又同步回来
    expect(task.deletedAt).toBeTypeOf('number');

    await expect(useTaskStore.getState().restoreTask(id)).rejects.toThrow('已被彻底删除');
  });

  it('对活着的任务调 purge 会抛错', async () => {
    await useTaskStore.getState().addTask('活着');
    const id = Object.values(useTaskStore.getState().entities.tasks)[0]!.id;
    await expect(useTaskStore.getState().purgeTask(id)).rejects.toThrow('不在回收站里');
  });
});

describe('回收站界面', () => {
  it('空回收站显示空状态，不显示列表', () => {
    const el = renderTrash();
    expect(el.querySelector('[data-testid="trash-board-empty"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="trash-board-list"]')).toBeNull();
  });

  it('显示已删除条目与恢复按钮', async () => {
    const id = await seedTrashed('写文档');
    const el = renderTrash();

    expect(el.querySelector(`[data-testid="trash-board-restore-${id}"]`)).not.toBeNull();
    expect(el.textContent).toContain('写文档');
    expect(el.querySelector(`[data-testid="trash-board-restore-${id}"]`)).not.toBeNull();
  });

  it('点恢复按钮：条目离开回收站（真的恢复了）', async () => {
    const id = await seedTrashed('写文档');
    const el = renderTrash();

    click(el.querySelector(`[data-testid="trash-board-restore-${id}"]`));
    await waitFor(() => selectTrashedTasks(useTaskStore.getState()).length === 0);

    expect(selectTrashedTasks(useTaskStore.getState())).toHaveLength(0);
    expect(selectVisibleTasks(useTaskStore.getState()).map((t) => t.id)).toEqual([id]);
  });

  it('🔴 彻底删除必须二次确认：第一次点击只打开确认框，不删除', async () => {
    const id = await seedTrashed('写文档');
    const el = renderTrash();

    click(el.querySelector(`[data-testid="trash-board-purge-${id}"]`));

    expect(el.querySelector('[data-testid="trash-confirm"]')).not.toBeNull();
    // 还没删 —— 这才是"二次确认"的重点
    expect(selectTrashedTasks(useTaskStore.getState()).map((t) => t.id)).toEqual([id]);

    // 取消后条目仍在，确认框关闭
    click(el.querySelector('[data-testid="trash-confirm-cancel"]'));
    expect(el.querySelector('[data-testid="trash-confirm"]')).toBeNull();
    expect(selectTrashedTasks(useTaskStore.getState()).map((t) => t.id)).toEqual([id]);
  });

  it('确认后才真正彻底删除', async () => {
    const id = await seedTrashed('写文档');
    const el = renderTrash();

    click(el.querySelector(`[data-testid="trash-board-purge-${id}"]`));
    click(el.querySelector('[data-testid="trash-confirm-submit"]'));
    await waitFor(
      () => useTaskStore.getState().entities.tasks[id]?.purgedAt !== undefined,
    );

    expect(selectTrashedTasks(useTaskStore.getState())).toHaveLength(0);
    expect(useTaskStore.getState().entities.tasks[id]!.purgedAt).toBeTypeOf('number');
  });
});

/**
 * 🔴 W1：便签进回收站。
 *
 * 这一组存在的理由不是"便签也能删"（那在 app-host 已证），而是**两端各写一份
 * 回收站行**这件事：徽标、标题、合并顺序、失败可见 —— 它们只在界面上成立，
 * 而界面上的错法没有任何一层会报错。
 */
describe('回收站里的便签', () => {
  it('删除后出现在回收站：徽标写「便签」、标题是正文首行', async () => {
    const id = await seedTrashedNote('买菜\n西红柿\n鸡蛋');
    const el = renderTrash();

    expect(el.querySelector(`[data-testid="trash-board-restore-${id}"]`)).not.toBeNull();
    expect(el.textContent).toContain('买菜');
    // 多行正文取**首段非空行**，不是整段（整段会把这一行撑成一片）。
    expect(el.textContent).not.toContain('西红柿');
    // 种类徽标：回收站现在装两种东西，恢复后果不一样，不能靠"标题像不像便签"来猜。
    // 🔴 断言的是**那一格**，不是整屏文本 —— 顶部那句介绍里也含"便签"两字，
    // 拿 textContent 断言会让"徽标整个不渲染"照样绿。
    expect(
      el.querySelector(`[data-testid="trash-board-kind-${id}"]`)?.textContent ?? '',
    ).toBe('便签');
    // 顶部那句话点名了**全部四类**（W1 时它是"任务和便签"，W4 起加清单与习惯）。
    // 这一屏此刻只有一行，徽标只能贡献"便签"一个字 ⇒ 清单/习惯只可能来自那句介绍，
    // 所以这条确实是"措辞跟上了功能"的判据，而不是"页面上随便找得到这几个字"。
    for (const kind of ['任务', '便签', '清单', '习惯']) {
      expect(el.textContent).toContain(kind);
    }
  });

  it('🔴 还原之后离开回收站、回到便签列表，content 与墓碑逐字段仍在原位', async () => {
    const id = await seedTrashedNote('周会纪要');
    const el = renderTrash();

    click(el.querySelector(`[data-testid="trash-board-restore-${id}"]`));
    await waitFor(() => useNoteStore.getState().trashed.length === 0);

    expect(useNoteStore.getState().trashed).toHaveLength(0);
    expect(useNoteStore.getState().notes.map((n) => n.id)).toEqual([id]);
    expect(useNoteStore.getState().notes[0]?.content).toBe('周会纪要');
    // 墓碑是真清掉的（不是只在列表里被滤掉）—— 否则离线端会把它当"仍然已删"。
    expect(currentState().notes[id]?.deletedAt).toBeUndefined();
  });

  it('🔴 便签的彻底删除同样必须二次确认：第一下只打开确认框', async () => {
    const id = await seedTrashedNote('买菜');
    const el = renderTrash();

    click(el.querySelector(`[data-testid="trash-board-purge-${id}"]`));

    expect(el.querySelector('[data-testid="trash-confirm"]')).not.toBeNull();
    expect(useNoteStore.getState().trashed.map((n) => n.id)).toEqual([id]);
    expect(currentState().notes[id]?.purgedAt).toBeUndefined();
    // 确认框里那句"这不是物理擦除"必须出现（两端措辞这次一起对齐）。
    expect(el.textContent).toContain('不是物理擦除');

    click(el.querySelector('[data-testid="trash-confirm-cancel"]'));
    expect(useNoteStore.getState().trashed.map((n) => n.id)).toEqual([id]);
  });

  it('确认之后才写 purgedAt：条目离开回收站、墓碑留着', async () => {
    const id = await seedTrashedNote('买菜');
    const el = renderTrash();

    click(el.querySelector(`[data-testid="trash-board-purge-${id}"]`));
    click(el.querySelector('[data-testid="trash-confirm-submit"]'));
    await waitFor(() => currentState().notes[id]?.purgedAt !== undefined);

    expect(useNoteStore.getState().trashed).toHaveLength(0);
    expect(currentState().notes[id]?.purgedAt).toBeTypeOf('number');
    expect(currentState().notes[id]?.deletedAt).toBeTypeOf('number');
  });

  it('🔴 两路混在一起按删除时刻倒序（不是"谁先传谁在前"）', async () => {
    const taskId = await seedTrashed('先删的任务');
    // 留一点时间差：两条都落在同一毫秒时，顺序由 id 决胜，这条断言就答不上"顺序"。
    await new Promise((resolve) => setTimeout(resolve, 5));
    const noteId = await seedTrashedNote('后删的便签');

    const rows = renderTrash().querySelectorAll('[data-testid^="trash-board-row-"]');
    expect(Array.from(rows).map((r) => r.getAttribute('data-testid'))).toEqual([
      `trash-board-row-${noteId}`,
      `trash-board-row-${taskId}`,
    ]);
  });

  it('🔴 动作失败必须说出来：store 抛错时界面出现错误行，而不是"点了没反应"', async () => {
    /**
     * 故障注入发生在**宿主边界（store）**，不是产品逻辑里：真实场景是
     * "另一台设备刚把这条彻底删除，本机的列表还留在屏幕上"，此时
     * `restoreNote` 会抛"已被彻底删除，无法恢复"。
     * 这里要证的只有半件事：抛出来之后界面上看得见。
     *
     * ⚠️ 注入必须**在渲染之前**：组件把 `restoreNote` 存在自己的闭包里，
     * 渲染之后再换 store 上的函数，界面上那个按钮点的仍然是原来那一个。
     */
    const id = await seedTrashedNote('买菜');
    const real = useNoteStore.getState().restoreNote;
    useNoteStore.setState({
      restoreNote: async (): Promise<boolean> => {
        throw new Error('便签「买菜」已被彻底删除，无法恢复');
      },
    });
    try {
      const el = renderTrash();
      click(el.querySelector(`[data-testid="trash-board-restore-${id}"]`));
      await waitFor(() => el.querySelector('[data-testid="trash-error"]') !== null);
      expect(el.querySelector('[data-testid="trash-error"]')?.textContent ?? '').toContain(
        '已被彻底删除，无法恢复',
      );
      // 失败没有被咽掉，也没有顺手把条目改状态。
      expect(useNoteStore.getState().trashed.map((n) => n.id)).toEqual([id]);
    } finally {
      useNoteStore.setState({ restoreNote: real });
    }
  });
});

// ── W4：清单与习惯进回收站（Web 壳）─────────────────────────────────────
async function seedTrashedProject(name: string): Promise<string> {
  await useProjectStore.getState().addProject(name);
  const id = useProjectStore.getState().projects.find((p) => p.name === name)!.id;
  await useProjectStore.getState().deleteProject(id);
  await waitFor(() => useProjectStore.getState().trashed.some((p) => p.id === id));
  return id;
}

async function seedTrashedHabit(name: string): Promise<string> {
  await useHabitStore.getState().addHabit(name);
  const id = useHabitStore.getState().habits.find((h) => h.name === name)!.id;
  await useHabitStore.getState().deleteHabit(id);
  await waitFor(() => useHabitStore.getState().trashed.some((h) => h.id === id));
  return id;
}

describe('W4 清单进回收站', () => {
  it('🔴 清单行出现、徽标是「清单」，点还原后它回到侧栏那一路且回收站空了', async () => {
    const id = await seedTrashedProject('要还原的清单');
    const el = renderTrash();

    expect(el.querySelector(`[data-testid="trash-board-kind-${id}"]`)?.textContent ?? '').toBe('清单');

    click(el.querySelector(`[data-testid="trash-board-restore-${id}"]`));
    await waitFor(() => useProjectStore.getState().trashed.length === 0);

    expect(useProjectStore.getState().projects.map((p) => p.id)).toContain(id);
  });

  it('🔴 彻底删除一条清单：确认框必须说清「里面还有 N 条任务」，而 N 是真的', async () => {
    await useProjectStore.getState().addProject('搬家');
    const projectId = useProjectStore.getState().projects.find((p) => p.name === '搬家')!.id;
    await useTaskStore.getState().addTask('买纸箱', { projectId });
    await useTaskStore.getState().addTask('退押金', { projectId });
    // 第三条任务：**删掉之后又彻底删除**。它不该被算进"不会被删除的那 N 条"。
    // ⚠️ 刻意选"已彻底删除"而不是"只在回收站里"那一站：这两种坏法在界面上
    //   不一样，而只有前者能把 \`isLive\` 与 \`!inTrash\` 分开 ——
    //   第一次跑这一臂时我用的是"只删掉"的那条，变异（把 \`isLive\` 换成
    //   \`!inTrash\`）在本用例上**存活**，是 ui 那条判据红的。留着这行是为了
    //   让宿主这一路也有牙，而不只是共享层有牙。
    await useTaskStore.getState().addTask('删了又彻底删除的旧任务', { projectId });
    const gone = Object.values(useTaskStore.getState().entities.tasks).find(
      (t) => t.title === '删了又彻底删除的旧任务',
    )!;
    await useTaskStore.getState().deleteTask(gone.id);
    await useTaskStore.getState().purgeTask(gone.id);
    await waitFor(() => useTaskStore.getState().entities.tasks[gone.id]?.purgedAt !== undefined);
    // 另一条不属于它的任务：挡"数错了对象"（把全仓任务数报成这条清单的）。
    await useTaskStore.getState().addTask('不相干');
    await useProjectStore.getState().deleteProject(projectId);
    await waitFor(() => useProjectStore.getState().trashed.some((p) => p.id === projectId));

    const el = renderTrash();
    click(el.querySelector(`[data-testid="trash-board-purge-${projectId}"]`));

    const impact = el.querySelector('[data-testid="trash-confirm-impact"]')?.textContent ?? '';
    expect(impact).toContain('里面还有 2 条任务');
    // 🔴 正向对照腿：那句必须在，而且**只**在这一类上在（见下一条）。
    // "整句不存在"的坏法与"数错"的坏法在这里都会红，但只有先证它在场，
    // 才能说后面的取值断言量到了东西。
    expect(impact).not.toBe('');

    click(el.querySelector('[data-testid="trash-confirm-submit"]'));
    await waitFor(() => useProjectStore.getState().trashed.length === 0);
    // 删容器不删内容：那两条任务**一条都没被顺手删掉**（既没进回收站也没消失），
    // 而且它们仍然指向这条已经彻底删除的清单 —— 归属没有被"清理"掉。
    const live = Object.values(useTaskStore.getState().entities.tasks).filter(
      (t) => t.deletedAt === undefined,
    );
    // 按码位排：不 U+4E0D < 买 U+4E70 < 退 U+9000
    expect(live.map((t) => t.title).sort()).toEqual(['不相干', '买纸箱', '退押金']);
    expect(live.filter((t) => t.projectId === projectId)).toHaveLength(2);
  });

  it('🔴 彻底删除一条任务时**不许**出现那句"里面还有 N 条任务"', async () => {
    // 同一条判据的另一半：如果那一行无条件渲染，"任务也有影响面"就是一句假话。
    const id = await seedTrashed('一条普通任务');
    const el = renderTrash();
    click(el.querySelector(`[data-testid="trash-board-purge-${id}"]`));
    expect(el.querySelector('[data-testid="trash-confirm-impact"]')).toBeNull();
    // 正向对照：确认框本身在（不然上一条只是因为没打开而"没有那一行"）。
    expect(el.querySelector('[data-testid="trash-confirm"]')).not.toBeNull();
  });
});

describe('W4 习惯进回收站', () => {
  it('徽标是「习惯」，确认框说的是打卡记录不会被删', async () => {
    const id = await seedTrashedHabit('早睡');
    const el = renderTrash();

    expect(el.querySelector(`[data-testid="trash-board-kind-${id}"]`)?.textContent ?? '').toBe('习惯');

    click(el.querySelector(`[data-testid="trash-board-purge-${id}"]`));
    expect(el.querySelector('[data-testid="trash-confirm-impact"]')?.textContent ?? '').toContain(
      '打卡记录不会被删除',
    );
  });

  it('🔴 四路都在时列表按删除时间排（新删的在前），而不是按传参顺序', async () => {
    const projectId = await seedTrashedProject('先删的清单');
    const habitId = await seedTrashedHabit('后删的习惯');

    const rows = Array.from(renderTrash().querySelectorAll('[data-testid^="trash-board-row-"]')).map(
      (el) => el.getAttribute('data-testid'),
    );
    // 便签/任务本轮不重复造：这一条钉的是"新增的两路也进了同一次排序"。
    expect(rows[0]).toBe(`trash-board-row-${habitId}`);
    expect(rows).toContain(`trash-board-row-${projectId}`);
  });
});
