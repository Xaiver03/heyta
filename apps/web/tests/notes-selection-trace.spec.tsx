/**
 * 判据：**便签面的选中要在界面上看得见，而且和任务面说的是同一种话**
 * ================================================================
 *
 * 对应工单 `docs/plans/detail-pane-alignment.md` 的 **W1c**（W1「跨视图通用」的收尾）。
 * 它照出来的事实（2026-10-04，K7 看图时）：**↑↓ 光标在便签面上走，界面上没有任何痕迹** ——
 * 任务面有底色（`TaskRow.rowActive`），习惯面有 `aria-current` + 浅底
 * （`apps/web/src/features/habits/HabitsList.tsx` + `habits.css`），便签面两样都没有。
 * 一个"各处同一套"的状态，在三张面上有三种可见性，其中一张完全没有。
 *
 * 为什么这不是拍板 #1 的题面（工单 §8.21 原来把它挂在 #1 上，本轮把它拆出来）：
 * #1 问的是**右栏放什么**，这一条问的是**左列表里那一行要不要让人看出来**。
 * 后者不需要任何人做决定 —— 状态已经存在（`useSelected('note')`）、已经画在别的面上。
 * 和 W8a（"值与词同源"）同一个判据：它是缺陷不是选择，所以从待拍项里拆出来先做。
 *
 * 🔴 载体：本文件用 `@heyta/ui` 的 `dist/` —— 改完 `packages/ui` 要先构建它，
 * 否则判据读的是旧产物（§7 第 27 条那一族）。
 */

import { act } from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';

import type { Note } from '@heyta/domain';
import { I18nProvider, useI18n } from '@heyta/i18n';
import { HeytaUiProvider, NotesBoard, TaskList, resolveHeytaUiTheme } from '@heyta/ui';

import { notesBoardLabels } from '../src/features/notes/NotesView.js';

const THEME = resolveHeytaUiTheme({ scheme: 'light', reducedTransparency: false });

/**
 * 选中那行的底色应当**正是**设计系统的主色浅档。
 * 🔴 期望值从 token 推导，不抄字符串（和 `task-selection.spec.tsx` 同一个理由）：
 * 写死 `#eff6ff` 等于造第二份事实源，token 一改这条会红在**正确**的改动上。
 */
const EXPECTED_ACTIVE_BG = (() => {
  const hex = THEME.tokens['color.primary-subtle'].replace('#', '');
  const byte = (at: number): number => Number.parseInt(hex.slice(at, at + 2), 16);
  return `rgb(${byte(0)}, ${byte(2)}, ${byte(4)})`;
})();

/** 探针实测（2026-10-04）：RNW 在 jsdom 里给"没有底色"的容器回的是这个串，不是空串。 */
const TRANSPARENT = 'rgba(0, 0, 0, 0)';

const NOW = new Date(2026, 8, 25, 12, 0, 0).getTime();

function note(id: string, over: Partial<Note> = {}): Note {
  return {
    id,
    content: `便签 ${id} 的正文`,
    isPinnedToToday: false,
    createdAt: 0,
    updatedAt: NOW,
    ...over,
  };
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;

/** 真走一次 i18n：labels 由 `notesBoardLabels(t)` 构造，测试里不抄任何中文串。 */
function mountBoard(props: {
  readonly notes: readonly Note[];
  readonly activeNoteId?: string;
}): void {
  // 同一例里连挂两趟（"换一条"那组）时必须先把上一趟拆掉：留着会同时存在两串
  // `note-row-*`，`rows()` 读到的是**两趟的并集**，那种读数既不红也不对。
  act(() => {
    root?.unmount();
  });
  container?.remove();
  const host = document.createElement('div');
  document.body.appendChild(host);
  container = host;
  root = createRoot(host);
  act(() => {
    root?.render(
      <I18nProvider locale="zh-CN">
        <HeytaUiProvider value={THEME}>
          <Board />
        </HeytaUiProvider>
      </I18nProvider>,
    );
  });
  function Board(): React.JSX.Element {
    const { t } = useI18n();
    return (
      <NotesBoard
        notes={props.notes}
        onAdd={() => {}}
        onRemove={() => {}}
        onTogglePinned={() => {}}
        activeNoteId={props.activeNoteId}
        labels={notesBoardLabels(t)}
        testID="notes-board"
      />
    );
  }
}

function rows(): { id: string; current: boolean; paint: string }[] {
  const host = container;
  expect(host, '容器没建起来（mount 顺序变了？）').not.toBeNull();
  const found: { id: string; current: boolean; paint: string }[] = [];
  for (const el of Array.from(host!.querySelectorAll<HTMLElement>('[data-testid^="note-row-"]'))) {
    found.push({
      id: (el.getAttribute('data-testid') ?? '').replace(/^note-row-/, ''),
      current: el.getAttribute('aria-current') === 'true',
      // 🔴 必须走 `getComputedStyle`：RNW 把 StyleSheet 编译成 class，
      // `el.style.backgroundColor` 在 jsdom 里恒为空串（`task-selection.spec.tsx` 记过同一次）。
      paint: getComputedStyle(el as Element).backgroundColor.trim(),
    });
  }
  return found;
}

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  container?.remove();
  root = null;
  container = null;
});

describe('A. 便签面的选中看得见（两条线索说同一件事）', () => {
  it('传了 `activeNoteId` ⇒ 恰好一行带 `aria-current="true"`，而且就是那一条', () => {
    mountBoard({ notes: [note('n1'), note('n2'), note('n3')], activeNoteId: 'n2' });
    const read = rows();
    expect(read.map((r) => r.id).sort(), '三行都得渲染出来').toEqual(['n1', 'n2', 'n3']);
    const current = read.filter((r) => r.current);
    expect(current.map((r) => r.id), `aria-current 只许落在被选那一行：${JSON.stringify(read)}`).toEqual(
      ['n2'],
    );
  });

  it('那一行的底色是主色浅档，其余行透明（选中不是"每行都亮"）', () => {
    mountBoard({ notes: [note('n1'), note('n2'), note('n3')], activeNoteId: 'n2' });
    const read = rows();
    const byId = new Map(read.map((r) => [r.id, r]));
    expect(byId.get('n2')?.paint, `选中行没有底色：${JSON.stringify(read)}`).toBe(EXPECTED_ACTIVE_BG);
    expect(byId.get('n1')?.paint, '没选中的行也有底色 ⇒ 高亮等于没有信息').toBe(TRANSPARENT);
    expect(byId.get('n3')?.paint).toBe(TRANSPARENT);
    // 🔴 两条线索必须落在同一行：底色亮 n2、aria 标 n3 这种"各说各话"要红。
    expect(
      read.filter((r) => r.paint === EXPECTED_ACTIVE_BG).map((r) => r.id),
      '底色那行与 aria-current 那行不是同一行',
    ).toEqual(['n2']);
  });

  it('换一条 ⇒ 痕迹跟着走，旧的清掉（钉住"光标写死在某一行"那种实现）', () => {
    mountBoard({ notes: [note('n1'), note('n2')], activeNoteId: 'n1' });
    expect(rows().find((r) => r.id === 'n1')?.paint).toBe(EXPECTED_ACTIVE_BG);
    mountBoard({ notes: [note('n1'), note('n2')], activeNoteId: 'n2' });
    const after = rows();
    expect(after.find((r) => r.id === 'n2')?.paint).toBe(EXPECTED_ACTIVE_BG);
    expect(after.find((r) => r.id === 'n1')?.paint, '换选中后旧那行还留着底色').toBe(TRANSPARENT);
    expect(after.filter((r) => r.current).map((r) => r.id)).toEqual(['n2']);
  });
});

describe('B. 默认值必须等于本 prop 出现之前的行为', () => {
  it('不传 `activeNoteId` ⇒ 零行带 aria-current，且全部透明（移动端没接它，行为不许变）', () => {
    mountBoard({ notes: [note('n1'), note('n2')] });
    const read = rows();
    expect(read.filter((r) => r.current), `默认值不该高亮任何行：${JSON.stringify(read)}`).toEqual([]);
    for (const r of read) {
      expect(r.paint, `行 ${r.id} 在没选中时也有底色`).toBe(TRANSPARENT);
    }
  });

  it('id 指向不在列表里的那条 ⇒ 一行都不亮，而不是亮第一行', () => {
    // 宿主侧 `activeNoteId = editing?.id` 的对应面：选中可以指向一条已被别的设备删掉的便签。
    // 共享板不许"找不到就退回第一行"—— 那会让列表亮着一条、右栏什么都没有。
    mountBoard({ notes: [note('n1'), note('n2')], activeNoteId: 'gone' });
    const read = rows();
    expect(read.filter((r) => r.current)).toEqual([]);
    expect(read.every((r) => r.paint === TRANSPARENT), JSON.stringify(read)).toBe(true);
  });
});

describe('C. 🔴 三张面用同一个属性说话（"各处同一套"必须可核对，不是口号）', () => {
  it('任务面（`TaskRow`）的选中同样带 `aria-current="true"`', () => {
    // 这一条原来只有底色：色觉障碍用户与高对比模式下读不到"光标在哪"，
    // 而习惯面早就有 aria。两边补齐成同一种说法。
    const host = document.createElement('div');
    document.body.appendChild(host);
    const r = createRoot(host);
    act(() => {
      r.render(
        <HeytaUiProvider value={THEME}>
          <TaskList
            tasks={[
              { id: 't1', title: '任务一', createdAt: 0, updatedAt: NOW },
              { id: 't2', title: '任务二', createdAt: 0, updatedAt: NOW },
            ]}
            onToggleTask={() => {}}
            activeTaskId="t2"
          />
        </HeytaUiProvider>,
      );
    });
    const current = Array.from(host.querySelectorAll<HTMLElement>('[aria-current="true"]'));
    expect(
      current.map((el) => el.getAttribute('data-testid')),
      '任务行的选中没有 aria-current（只有底色不算说出来）',
    ).toEqual(['task-item-t2']);
    act(() => {
      r.unmount();
    });
    host.remove();
  });
});

/**
 * D. 🔴 **宿主接线**（这一组是因为变异台把它照出来了才存在的）
 * ----------------------------------------------------------------
 *
 * 臂 H1（把 `activeNoteId={activeNoteId}` 从 `NotesView` 摘掉）在 A/B/C 三组**全绿** ——
 * 那三组直接把 `NotesBoard` 挂起来跑，根本不经过宿主。这正是
 * "共享组件加一个**默认值等于原行为**的可选 prop"这个形状的固有后果：
 * **宿主没接，界面上什么都不会坏，因为默认值就是旧行为** —— 于是"做完了"和"没接"
 * 在组件级判据里长得一模一样（本仓库记过这条：样式三道门禁那条线 mobile 侧同一个坑）。
 *
 * 所以这里读**宿主源文件**，和 `task-selection.spec.tsx` 的 A 组同一个办法
 * （不挂整个 App：那一棵树要真 IndexedDB、真 store、真同步）。
 * ⚠️ vitest 的 cwd 是 `apps/web`，`import.meta.url` 是 http 协议，所以按 cwd 解析。
 */
const NOTES_VIEW_SOURCE = readFileSync(
  resolve(process.cwd(), 'src/features/notes/NotesView.tsx'),
  'utf8',
);

describe('D. 宿主把选中接到了共享板上（组件级判据看不见这一层）', () => {
  const count = (needle: string): number => NOTES_VIEW_SOURCE.split(needle).length - 1;

  it('阳性对照：读到的是不是那个文件，先证一次', () => {
    // 路径写错会得到空串，那时下面每一条都会红在"找不到接线"上而不是"读不到文件"——
    // 这句把两种红区分开（同 `task-selection.spec.tsx` 的 A 组）。
    expect(NOTES_VIEW_SOURCE).toContain('export function NotesView(');
  });

  it('`activeNoteId` 恰好递一次，且它来自共享选中态而不是又一个本地状态', () => {
    const wired = count('activeNoteId={activeNoteId}');
    expect(wired, `宿主接线应当恰好一处，实际 ${String(wired)}（0=没接，>1=接了两处会互相盖）`).toBe(1);
    // 值的来源必须是 `editing`（它由 `useSelected('note')` 推出来）。
    expect(NOTES_VIEW_SOURCE).toContain("const editingId = useSelected('note');");
    expect(NOTES_VIEW_SOURCE).toContain(
      'const editing = editingId === null ? undefined : notes.find((note) => note.id === editingId);',
    );
    expect(NOTES_VIEW_SOURCE).toContain('const activeNoteId = editing?.id;');
  });

  it('这个宿主里一个 `useState(` 都没有（出现第二个选中 id 源就是回到旧形状）', () => {
    // 🔴 判据是**计数为 0**，不是"不含某个我猜的变量名"：后者是我第一次写这条时犯的错——
    // 那条正则长得像能红，实际匹配不到任何东西，等于一条永远成立的空判据。
    // 现量（2026-10-04）：`useState` 在这个文件里只出现在注释里，`useState(` 命中 0 次。
    expect(count('useState('), 'NotesView 不该自己存便签 id（选中只有一个源）').toBe(0);
  });
});
