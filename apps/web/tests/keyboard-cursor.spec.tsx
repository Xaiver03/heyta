/**
 * 键盘光标（工单 W1b 的 Web 接线层）
 * ==================================
 *
 * 分工与 W7 同一套：
 * - **规则本身**（往哪走 / 端点怎么办 / 不在列表里怎么办）在
 *   `packages/app-host/tests/selection.spec.ts` 里判红，这里不重复；
 * - **本文件**判的是"宿主把规则接成了什么"：顺序从**渲染出来的 DOM** 取、
 *   哪些视图接哪些不接、什么时候不响应、要不要吞掉按键；
 * - **真界面 + 真按键**在 `e2e/tests/keyboard-cursor.spec.ts`。
 *
 * ⚠️ 这里刻意**不挂整个 App**：光标读的就是 DOM 里那一串行，所以夹具直接摆
 * 带 `data-testid` 的行，比"起引擎 → 灌数据 → 等渲染"更贴近它真正的依赖，
 * 也不会把"数据没灌进去"误读成"光标坏了"。
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { selection } from '../src/lib/selection.js';
import { useSelectionKeyboardCursor } from '../src/lib/keyboard-cursor.js';

/**
 * jsdom **不实现** `scrollIntoView`（真浏览器有）。不补这一层，每次按键都会往
 * vitest 的未处理错误通道里丢一条 —— 症状很误导人：`Tests 20 passed`，
 * 而进程以 **rc=1** 收尾（`Errors 25`）。
 *
 * 🔴 补在测试侧而不是在产品侧：给一个"真浏览器永远有"的 API 加
 * `typeof el.scrollIntoView === 'function'` 的守卫，是拿生产代码替测试环境兜底。
 */
Object.defineProperty(Element.prototype, 'scrollIntoView', {
  configurable: true,
  writable: true,
  value: () => {},
});

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ViewKey } from '../src/features/shell/view-tabs.js';

let container: HTMLDivElement | null = null;
let root: Root | null = null;

function Harness({ view }: { view: ViewKey }): null {
  useSelectionKeyboardCursor(view);
  return null;
}

async function mount(view: ViewKey): Promise<void> {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(<Harness view={view} />);
  });
}

/** 摆出"界面上渲染出来的那一串行"（文档序就是用户看到的顺序）。 */
function rows(prefix: string, ids: string[]): void {
  for (const el of Array.from(document.querySelectorAll(`[data-testid^="${prefix}-"]`))) {
    el.remove();
  }
  document.body.insertAdjacentHTML(
    'beforeend',
    ids.map((id) => `<div data-testid="${prefix}-${id}"></div>`).join(''),
  );
}

// `key` 不收窄成 `'ArrowUp' | 'ArrowDown'`：「别的键不抢」那一条就是要**故意**发一个
// 光标词表之外的键（← → / Enter / Home）。收窄会把那条用例挡住，而它挡的是"词表判定失效"。
async function press(key: string, target: EventTarget = window): Promise<void> {
  await act(async () => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  });
}

beforeEach(() => {
  selection.clear();
});

afterEach(() => {
  root?.unmount();
  root = null;
  container = null;
  /*
   * 🔴 清**整个 body**，不是只清 `[data-testid]`。第一版只清了行，于是
   * "浮层开着"那条用例插进 body 的 `.ht-sheet` 漏给了后面两条 ——
   * 症状是"端点吞按键"和"scrollIntoView"双双变红，看着像产品坏了，
   * 其实是上一例留下的浮层让 `isOverlayOpen()` 一直为真、处理器提前 return。
   */
  document.body.innerHTML = '';
  selection.clear();
});

describe('键盘光标按渲染顺序走', () => {
  it('🔴 没选中时 ↓ 选中的是**文档序第一行**，不是 id 序、不是 store 序', async () => {
    // 故意给一串"字典序倒过来"的 id：DOM 序 c→b→a。若宿主改成"从 store 取顺序"
    // 或"自己排一遍"，第一条就不是 c。
    rows('task-item', ['c', 'b', 'a']);
    await mount('tasks');
    await press('ArrowDown');
    expect(selection.get('task')).toBe('c');
  });

  it('连按 ↓ 逐项到底，再按**停在最后一行**', async () => {
    rows('task-item', ['t1', 't2', 't3']);
    await mount('tasks');
    const seen: (string | null)[] = [];
    for (let i = 0; i < 4; i += 1) {
      await press('ArrowDown');
      seen.push(selection.get('task'));
    }
    expect(seen).toEqual(['t1', 't2', 't3', 't3']);
  });

  it('↑ 从中间往回走', async () => {
    rows('task-item', ['t1', 't2', 't3']);
    selection.select('task', 't3');
    await mount('tasks');
    await press('ArrowUp');
    expect(selection.get('task')).toBe('t2');
  });

  it('同一批 id 被两处渲染时**不重复走**（按 id 去重）', async () => {
    rows('task-item', ['x', 'y']);
    document.body.insertAdjacentHTML('beforeend', '<div data-testid="task-item-x"></div>');
    await mount('tasks');
    const seen: (string | null)[] = [];
    for (let i = 0; i < 3; i += 1) {
      await press('ArrowDown');
      seen.push(selection.get('task'));
    }
    expect(seen).toEqual(['x', 'y', 'y']);
  });
});

describe('跨视图通用（工单 W1 的那条硬要求）', () => {
  /**
   * 五个入口用**同一个 hook、同一套规则**，只是行的前缀不同。
   * 这条循环就是"不许只在任务视图实现一份"的读数：少登记一个视图，
   * 那一轮 `selection.get(kind)` 会停在 null。
   */
  const cases = [
    { view: 'tasks' as const, prefix: 'task-item', kind: 'task' as const },
    { view: 'quadrant' as const, prefix: 'task-item', kind: 'task' as const },
    { view: 'timeline' as const, prefix: 'task-item', kind: 'task' as const },
    { view: 'habits' as const, prefix: 'habit-row', kind: 'habit' as const },
    { view: 'notes' as const, prefix: 'note-row', kind: 'note' as const },
  ];

  for (const c of cases) {
    it(`${c.view}：↓ 走一行、↑ 回一行，写进的是 ${c.kind} 那一格`, async () => {
      rows(c.prefix, ['r1', 'r2']);
      await mount(c.view);
      await press('ArrowDown');
      expect(selection.get(c.kind), `${c.view} 面上 ↓ 没有选中第一行`).toBe('r1');
      await press('ArrowDown');
      expect(selection.get(c.kind)).toBe('r2');
      await press('ArrowUp');
      expect(selection.get(c.kind)).toBe('r1');
    });
  }

  it('🔴 表里没有的视图（日历 / 回收站 / 搜索）不绑光标', async () => {
    // 回收站的 ↑↓ 是"恢复还是删除"（`TrashView`），搜索面板有它自己那条
    // （`App.tsx` 的 `moveCursor`）。这里要是"顺手都接上"，那两处就会一次跳两格。
    rows('task-item', ['t1', 't2']);
    for (const view of ['calendar', 'trash', 'search', 'growth', 'settings'] as ViewKey[]) {
      selection.clear();
      await mount(view);
      await press('ArrowDown');
      expect(selection.get('task'), `${view} 面上不该有列表光标`).toBeNull();
      root?.unmount();
      root = null;
      container?.remove();
      container = null;
    }
  });
});

describe('两种"不响应"，各挡一种坏', () => {
  it('焦点在输入框里（正在打字）⇒ 不动选中', async () => {
    rows('task-item', ['t1', 't2']);
    await mount('tasks');
    const input = document.createElement('input');
    document.body.appendChild(input);
    await press('ArrowDown', input);
    expect(selection.get('task')).toBeNull();
  });

  it('`role="textbox"` 也算正在打字（RNW 的输入格不是原生 input）', async () => {
    rows('task-item', ['t1', 't2']);
    await mount('tasks');
    const box = document.createElement('div');
    box.setAttribute('role', 'textbox');
    document.body.appendChild(box);
    await press('ArrowDown', box);
    expect(selection.get('task')).toBeNull();
  });

  it('🔴 浮层开着（设置是 sheet 不是路由，底下那一栏还挂着）⇒ 不动选中', async () => {
    rows('task-item', ['t1', 't2']);
    document.body.insertAdjacentHTML('afterbegin', '<div class="ht-sheet"></div>');
    await mount('tasks');
    await press('ArrowDown');
    expect(selection.get('task'), '浮层底下偷偷换了选中 = 界面在说谎').toBeNull();
  });

  /**
   * 🔴 这一条挡的是"闸门只认得一种浮层形状"。
   * 设置是 `.ht-sheet`，而**另外两个真浮层是 `role="dialog"`**：
   * 搜索面板（`App.tsx:2202-2205`，`aria-modal="false"` = 下层透出）与法务二次确认
   * （`LegalReconfirmSheet.tsx:104`，类名 `.ht-sheet__reconfirm-*` 但**不带**裸
   * `.ht-sheet`，所以只靠类名选择器抓不到它）。
   * 搜索自己有一条 ↑↓ 光标（走结果数组），光标两边都响应同一个键就是
   * **一次跳两格** —— 而只认 `.ht-sheet` 的选择器恰好会漏掉这一种。
   */
  it('🔴 `role="dialog"` 那种浮层（搜索面板）也算开着', async () => {
    rows('task-item', ['t1', 't2']);
    document.body.insertAdjacentHTML(
      'afterbegin',
      '<div role="dialog" aria-modal="false"></div>',
    );
    await mount('tasks');
    await press('ArrowDown');
    expect(selection.get('task'), '搜索浮层底下任务选中也在动 = 两个光标抢同一个键').toBeNull();
  });

  /**
   * 🔴 这两条钉的是**看图看出来的那个缺陷**：`k3-cursor-back-after-closing-sheet.png`
   * 里账号菜单是开着的 —— 关掉设置浮层时焦点按既有设计回到头像
   * （`App.tsx:473-479`），而头像那颗按钮自己把 ↓ 用作"打开菜单"
   * （`AccountMenu.tsx:299`），于是同一次按键**既弹菜单又挪选中**。
   * 裁决：**焦点归谁、键就归谁**（反过来让列表光标赢会弄坏 `AccountMenu`
   * 那条既有、且有用例的键盘入口）。
   */
  it('🔴 焦点在带子菜单的触发器上（头像那颗 ↓ = 打开菜单）⇒ 列表光标让开', async () => {
    rows('task-item', ['t1', 't2']);
    await mount('tasks');
    const trigger = document.createElement('button');
    trigger.setAttribute('aria-haspopup', 'menu');
    document.body.appendChild(trigger);
    await press('ArrowDown', trigger);
    expect(selection.get('task'), '一次 ↓ 既弹菜单又挪选中 = 两个控件抢同一个键').toBeNull();
    // 正向对照：同一趟里焦点落回页面时光标确实会走 —— 否则"让开"是恒真判据。
    await press('ArrowDown', document.body);
    expect(selection.get('task'), '正向对照失效：让开之后光标自己也死了').toBe('t1');
  });

  it('🔴 焦点在展开的菜单里（`role="menu"` 的后代，它既不是 sheet 也不是 dialog）⇒ 让开', async () => {
    rows('task-item', ['t1', 't2']);
    await mount('tasks');
    const menu = document.createElement('div');
    menu.setAttribute('role', 'menu');
    const item = document.createElement('button');
    menu.appendChild(item);
    document.body.appendChild(menu);
    // 打在**菜单项**上（不是菜单本体）：真实焦点位置是后代，所以要走 `closest`。
    await press('ArrowDown', item);
    expect(
      selection.get('task'),
      '账号菜单开着时 ↓ 也在换底下的选中 = 键盘用户没法用方向键选菜单项',
    ).toBeNull();
  });

  it('带修饰键（⌘/Ctrl/Alt/Shift + 方向）不抢', async () => {
    rows('task-item', ['t1', 't2']);
    await mount('tasks');
    for (const init of [
      { metaKey: true },
      { ctrlKey: true },
      { altKey: true },
      { shiftKey: true },
    ]) {
      await act(async () => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', ...init }));
      });
    }
    expect(selection.get('task')).toBeNull();
  });

  it('别的键不抢（也不 preventDefault）', async () => {
    rows('task-item', ['t1', 't2']);
    await mount('tasks');
    let prevented = false;
    const probe = (e: Event): void => {
      prevented = e.defaultPrevented;
    };
    window.addEventListener('keydown', probe);
    await press('ArrowRight');
    window.removeEventListener('keydown', probe);
    expect(prevented).toBe(false);
    expect(selection.get('task')).toBeNull();
  });
});

describe('接线的三个细节', () => {
  it('🔴 端点上再按仍然吞掉按键（否则页面跟着滚而选中不动 = "键坏了"）', async () => {
    rows('task-item', ['only']);
    await mount('tasks');
    let defaultPrevented: boolean | null = null;
    await act(async () => {
      const e = new KeyboardEvent('keydown', { key: 'ArrowDown', cancelable: true });
      window.dispatchEvent(e);
      defaultPrevented = e.defaultPrevented;
    });
    expect(defaultPrevented).toBe(true);
    expect(selection.get('task')).toBe('only');
  });

  it('走到的那一行被带进视野（scrollIntoView 的 block 是 nearest）', async () => {
    rows('task-item', ['t1', 't2']);
    const spy = vi.fn();
    const target = document.querySelector('[data-testid="task-item-t2"]') as HTMLElement;
    target.scrollIntoView = spy;
    selection.select('task', 't1');
    await mount('tasks');
    await press('ArrowDown');
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]?.[0]).toEqual({ block: 'nearest' });
  });

  it('列表是空的 ⇒ 什么都不做，也不吞键', async () => {
    await mount('tasks');
    let defaultPrevented: boolean | null = null;
    await act(async () => {
      const e = new KeyboardEvent('keydown', { key: 'ArrowDown', cancelable: true });
      window.dispatchEvent(e);
      defaultPrevented = e.defaultPrevented;
    });
    expect(defaultPrevented).toBe(false);
    expect(selection.get('task')).toBeNull();
  });

  it('卸载后不再响应（监听没有泄漏）', async () => {
    rows('task-item', ['t1', 't2']);
    await mount('tasks');
    await act(async () => {
      root?.unmount();
    });
    await press('ArrowDown');
    expect(selection.get('task')).toBeNull();
  });

  it('🔴 App 接的是 `contentView` 而不是 `view`（设置/搜索是浮层，底下那栏还挂着）', () => {
    // 绑错的那个症状很具体：打开设置面板，光标会从「任务」切到「settings」，
    // 于是用户在浮层里按 ↓ 什么都不动，而关掉浮层后光标又"莫名其妙好了"。
    const src = readFileSync(resolve(__dirname, '../src/App.tsx'), 'utf8');
    expect(src).toContain('useSelectionKeyboardCursor(contentView);');
    expect(src).not.toMatch(/useSelectionKeyboardCursor\(view\)/);
  });
});
