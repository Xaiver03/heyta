/**
 * 选中态的键盘光标（工单 W1b 的 Web 侧接线）
 * ==========================================
 *
 * 🔴 **这里不许有规则。** "↑↓ 往哪走、到端点怎么办、选中的那条不在列表里怎么办"
 * 全在 `@heyta/app-host#moveSelectionInList`（AGENTS §3.5：那些是产品语义，
 * 而 web 今天有四个任务投影 + 习惯 + 便签共六个入口，各写一遍必然漂）。
 * 本文件只回答宿主才知道的四件事：**当前是哪个视图、那一串 id 现在在 DOM 里的
 * 顺序、什么时候不该响应、要不要把走到的那一行带进视野**。
 *
 * 两条键、一套闸门：↑↓ 移动选中（第 1 条腿），Enter 把焦点交给**这一格**（第 3 条腿，
 * 工单 W1b）。第 2 条腿（"换选中 ⇒ 那一格跟着换人"）住在两张面单里，不在这里。
 *
 * ## 为什么顺序从 DOM 取，而不是再算一遍
 *
 * 列表顺序的所有者分散在四处（任务侧是 `groupTasksByDate` + 每组一个 `TaskList` +
 * `collapsedGroups`；四象限是 `QuadrantBoard` 的格子序；时间线是 `TimelinePanel`；
 * 习惯/便签各自一份）。宿主想"自己算一遍扁平顺序"，就是**第五个所有者** ——
 * 症状很具体：界面上 ↓ 走到第 3 行，选中却跳到第 5 行，两边都不报错。
 * 而"用户眼睛看到的顺序"只有一个权威来源：**渲染出来的那一串行的文档序**。
 *
 * ⚠️ 取文档序必须**限定作用域**并按 id 去重。`App.tsx` 里搜索面板那条光标
 * 已经记过一次这个事故（全局 `querySelector` 会命中下层列表的同名 testid，
 * 症状是"这边按方向键、后面那个列表在滚"）。这里的"作用域"是**视图自锁**：
 * 每个视图都只渲染它自己那一种行（`contentView === 'tasks' && …` 那种条件渲染），
 * 所以同一时刻 DOM 里只可能有一种前缀的行；去重挡的是"同一批 id 被两处渲染"。
 *
 * ## 三条"不响应"，各挡一种坏
 *
 * 1. **正在打字**（输入框 / `contenteditable` / `role="textbox"`）：光标不该抢
 *    捕获框里的 ↑↓（IME 候选、多行备注都靠它们）。
 * 2. **有浮层开着**：界面当前指的不是底下那一栏。今天**三个真浮层**分两种形状，
 *    选择器必须同时认得（只认一种就会漏掉另外两种）：
 *    - 设置 = `.ht-sheet`（`sheets.css:14`，`aria-modal` 无 —— 它是"浮层不是路由"）
 *    - 搜索 = `role="dialog"` + `aria-modal="false"`（`App.tsx:2202-2205`；它自己
 *      有一条走结果数组的 ↑↓ 光标，两条光标抢同一个键 = 一次跳两格）
 *    - 法务二次确认 = `role="dialog"` + `aria-modal="true"`（`LegalReconfirmSheet.tsx:104`，
 *      类名是 `.ht-sheet__reconfirm-*`，**不带**裸 `.ht-sheet`）
 *    没有这一条，用户在设置面板里按 ↓，看到的是"什么也没发生"而选中已经在底下
 *    换了一条 —— 界面在说谎。
 * 3. 🔴 **焦点落在"自己就用方向键导航"的控件上**（`[role="menu"]` 本体、
 *    `[aria-haspopup="menu"]` 触发器）。这一条是**看图看出来的**，不是设计出来的：
 *    关掉设置浮层时焦点按既有设计回到头像（`App.tsx:473-479`），而头像那颗按钮
 *    自己写着"键盘用户打开菜单最自然的一下是 ↓"（`AccountMenu.tsx:299`）——
 *    于是同一次 ↓ **既弹出账号菜单、又把底下那栏的选中挪走**。
 *    账号菜单展开时同理：它的面板是 `.ht-accountmenu__panel` + `role="menu"`
 *    （`AccountMenu.tsx:313-320`），**不是** `.ht-sheet` 也不是 `role="dialog"`，
 *    上面第 2 条挡不住它。
 *    裁决是**焦点归谁、键就归谁**：方向键落在那类控件上时列表光标让开。
 *    （反过来"让列表光标赢"会弄坏 `AccountMenu` 那条既有且有用例的键盘入口。）
 *
 * 🔴 事件挂**捕获阶段**，与 `App.tsx` 里搜索面板那条光标同一个理由
 * （AGENTS §7 第 80 条：react-native-web 的 `TextInput` 在 keydown 里无条件
 * `stopPropagation()`，挂冒泡时"焦点曾在输入框里"会让整条光标静默失效）。
 * 代价说清楚：捕获意味着"正在打字"这件事**必须自己判断**（上面第 1 条），
 * 不能拿"事件会被输入框吞掉"当保护 —— 那正是 §7 第 80 条修法要防的那种假安全。
 */

import { moveSelectionInList, type CursorDelta, type SelectableKind } from '@heyta/app-host';
import { useEffect } from 'react';

import type { ViewKey } from '../features/shell/view-tabs.js';

import { selection } from './selection.js';

/**
 * 哪些视图有可走的列表，以及那一串行的 testid 前缀。
 *
 * 🔴 `search` **不在表里** —— 它自己有一条 ↑/↓ 光标（`App.tsx` 的
 * `moveCursor` + `searchCursor`），那条走的是搜索结果数组而不是 DOM。
 * 两边都响应同一个键会一次跳两格，所以这里刻意不登记，而不是"忘了加"。
 * `trash` 也不在：它的 ↑↓ 是"选恢复还是删除"，语义完全不同（`TrashView`）。
 *
 * 🔴 表外一共 **六** 个 `ViewKey`，上面只写了两条理由，剩下四条今天补上 ——
 * 否则下一个读这张表的人会以为"日历/专注是漏加的"，而这张表的正确性
 * 取决于"缺席都有理由"，不取决于"在场都对"。逐条现量（2026-10-04）：
 *
 * · `calendar`：共享板 `packages/ui/src/calendar/*` 里 `onKeyDown` / `ArrowUp` / `ArrowDown` /
 *   `tabIndex` / `role="grid"` **零命中** —— 这一面今天没有可走的行，也没有任何键盘语义。
 *   它的"当前"是**某一天**（web `features/calendar/store.ts:42` 的 `selected: LocalDate`，
 *   mobile `CalendarScreen.tsx:67` 同名 `useState`），那是日期锚点，不是"选中一行"，
 *   与 `SelectableKind` 的三类不同性质。**把日历做成可走的是另一件事**，前置是拍板
 *   "详情面对某一天显示什么"（工单 C1 #1 的延伸），不是在这张表里加一行。
 * · `focus`：没有"哪一项" —— `features/focus/store.ts:66` 是计时状态机，关联任务只由
 *   `start(taskId?)`（`:101`）带进来。工单 §6 明文"不许把番茄页塞进列表模型"。
 * · `growth` / `settings`：面本身不是列表（成长是图与卡，设置是浮层/面板），没有行可走。
 */
/**
 * 一个"可走 + 可打开"的视图登记的是什么。
 *
 * ⚠️ 字面量的**缩进是判据的一部分**：`keyboard-cursor.spec.tsx` 用 `^\\s{4}key:\\s*\\{\\s*kind:`
 * 从源码里读这张表（它要的是"表里有哪些视图"这份真源，而不是再手抄一份名单）。
 * 把条目缩进改掉，那两条判据会读成空表。
 */
interface CursorView {
  readonly kind: SelectableKind;
  readonly prefix: string;
  /**
   * Enter 的落点（工单 W1b 第 3 条腿）：**这一格里第一个该被聚焦的东西**的选择器。
   *
   * 🔴 缺席 = 这一面的 Enter **不接管**，而不是"忘了配"。今天缺席的三个是任务那一族
   * （`tasks` / `quadrant` / `timeline`）：Enter 在任务行上的既有语义是"就地展开编辑"，
   * 而"任务那一格是行内展开还是栏里编辑"是 §8.130 记下的那道**二选一**，没裁决之前
   * 在这里加一行就是把答案猜了。习惯与便签两面已经各有一个明确落点。
   *
   * ⚠️ 两个落点**不是一种东西**，这是刻意的：习惯那一格是"读 + 打卡"的一块区域，
   * 所以焦点给**区域本体**（`tabIndex={-1}` 的 `.ht-habit__pane`，屏幕阅读器会念出
   * 它那句 `aria-label`）；便签那一格是编辑器，焦点给**正文输入框**（"打开便签"的
   * 自然落点就是光标进正文）。共同点只有一条：都在那一格里，都不是列表。
   */
  readonly enterTarget?: string;
}

const CURSOR_VIEWS: Partial<Record<ViewKey, CursorView>> =
  {
    tasks: { kind: 'task', prefix: 'task-item' },
    quadrant: { kind: 'task', prefix: 'task-item' },
    timeline: { kind: 'task', prefix: 'task-item' },
    habits: { kind: 'habit', prefix: 'habit-row', enterTarget: '[data-testid="habit-pane"]' },
    notes: { kind: 'note', prefix: 'note-row', enterTarget: '[data-testid="notes-editor-input"]' },
  };

/** 当前渲染出来的那一串 id，**文档序**，按 id 去重（同一批 id 被两处渲染时不重复走）。 */
function renderedIds(prefix: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const el of Array.from(
    document.querySelectorAll<HTMLElement>(`[data-testid^="${prefix}-"]`),
  )) {
    const id = (el.getAttribute('data-testid') ?? '').slice(prefix.length + 1);
    if (id === '' || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return true;
  return target.isContentEditable || target.getAttribute('role') === 'textbox';
}

function isOverlayOpen(): boolean {
  return document.querySelector('[role="dialog"], .ht-sheet') !== null;
}

/**
 * 焦点是不是落在一个**自己就用方向键导航**的控件上（菜单本体 / 带子菜单的触发器）。
 *
 * 用 `closest` 而不是 `target === trigger`：菜单展开时焦点在**菜单项**上，
 * 那是 `[role="menu"]` 的后代（`AccountMenu.tsx:313`）。
 * ⚠️ 这条与第 2 条闸门**不重叠**：账号菜单的面板既不是 `.ht-sheet` 也不是
 * `role="dialog"`（它是 `.ht-accountmenu__panel`），只靠 `isOverlayOpen` 挡不住。
 */
function targetOwnsArrowKeys(target: EventTarget | null): boolean {
  return (
    target instanceof Element && target.closest('[role="menu"], [aria-haspopup="menu"]') !== null
  );
}

/** 把走到的那一行带进视野：光标走到折叠线以下却看不见，等于没走到。 */
function revealRow(prefix: string, id: string): void {
  document
    .querySelector<HTMLElement>(`[data-testid="${prefix}-${id}"]`)
    ?.scrollIntoView({ block: 'nearest' });
}

/**
 * Enter（W1b 第 3 条腿）：把焦点交给**这一格**，不代为触发任何写入。
 *
 * 三条"不接管"各挡一种坏，前两条与 ↑↓ 共用同一套闸门（正在打字 / 有浮层 / 焦点在
 * 自导航控件上），第三条是 Enter 独有的：
 *
 * 🔴 **焦点必须落在"当前带着选中痕迹的那一行"上**。行本身是按钮，Enter 在按钮上的
 * 既有行为是"按下它"（= 选中这一行）。用户在 Tab 序列里走到一条**没选中**的行上按 Enter，
 * 要的是"选它"，不是"打开底下那一格现在画的那条"—— 抢过来会变成按 Enter 什么也没选中、
 * 焦点却跳走了。所以这里只在"焦点行 == 选中的那条"时接管，其余一律让按钮自己处理。
 *
 * ⚠️ 面单不在 DOM 里（那一面还没选中 / 那一格今天没有可打开的东西）⇒ **不吞键也不报错**，
 * 什么都不做。这一条不是偷懒：Enter 落空时把事件吞掉，用户读到的是"回车坏了"。
 */
function openPane(target: CursorView): boolean {
  if (target.enterTarget === undefined) return false;
  const pane = document.querySelector<HTMLElement>(target.enterTarget);
  if (pane === null) return false;
  pane.focus();
  return true;
}

/**
 * 绑定当前视图的键盘光标。`view` 变了就重挂 —— 表里没有的视图**不绑**，
 * 所以"在日历页按 ↓"不会去动底下那栏的选中。
 */
export function useSelectionKeyboardCursor(view: ViewKey): void {
  useEffect(() => {
    const target = CURSOR_VIEWS[view];
    if (target === undefined) return;

    const onKeyDown = (event: KeyboardEvent): void => {
      const arrows = event.key === 'ArrowUp' || event.key === 'ArrowDown';
      if (!arrows && event.key !== 'Enter') return;
      if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
      if (isTypingTarget(event.target) || isOverlayOpen() || targetOwnsArrowKeys(event.target)) {
        return;
      }

      if (!arrows) {
        /* 焦点行 = 事件目标所属的那一行（不在本视图的任何一行上 ⇒ 不接管）。 */
        const row =
          event.target instanceof Element
            ? event.target.closest<HTMLElement>(`[data-testid^="${target.prefix}-"]`)
            : null;
        if (row === null) return;
        const id = (row.getAttribute('data-testid') ?? '').slice(target.prefix.length + 1);
        if (id === '' || id !== selection.get(target.kind)) return;
        if (openPane(target)) event.preventDefault();
        return;
      }

      const ids = renderedIds(target.prefix);
      if (ids.length === 0) return;

      const delta: CursorDelta = event.key === 'ArrowDown' ? 1 : -1;
      const current = selection.get(target.kind);
      const next = moveSelectionInList({ orderedIds: ids, current, delta });
      if (next === null) return;

      // 端点上再按：`next === current`，**仍然吞掉这次按键**。否则页面跟着滚而
      // 选中不动，用户读到的是"方向键坏了"。`select()` 对重复选同一条不通知，
      // 所以这里不会白重渲染一次。
      event.preventDefault();
      selection.select(target.kind, next);
      revealRow(target.prefix, next);
    };

    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
    };
  }, [view]);
}
