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

import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

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

/**
 * 拆掉这一趟挂上的钩子与插出来的行。
 * 写成函数而不是把四行抄进循环：`root` / `container` 是闭包外的 `let`，
 * TS 在**函数调用后不会重设**它们的收窄，循环里第二次 `root = null` 之后
 * `root?.unmount()` 就被判成 `never`（编译期红，而跑得是好的）。
 */
function unmountHarness(): void {
  root?.unmount();
  root = null;
  container?.remove();
  container = null;
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
// 光标词表之外的键（← → / Home）。收窄会把那条用例挡住，而它挡的是"词表判定失效"。
// ⚠️ 这里原来还列着 **Enter** —— 它从 §8.137 起**已经在词表里了**（第 3 条腿），
//    所以"Enter 不抢"这句话是错的，用例发的键也换成了 ← →。
async function press(key: string, target: EventTarget = window): Promise<void> {
  await act(async () => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  });
}

// 光标接谁不接，两处真源说了算：视图全集在 `view-tabs.ts`，接了谁在 `keyboard-cursor.ts`。
// 解析器一旦读空就抛 —— 读空的 0 命中会让下面两条判据无条件成立（§7 元规则二）。
const VIEW_TABS_SRC = readFileSync(resolve(__dirname, '../src/features/shell/view-tabs.ts'), 'utf8');
const CURSOR_SRC = readFileSync(resolve(__dirname, '../src/lib/keyboard-cursor.ts'), 'utf8');

function viewKeys(): string[] {
  const block = /export type ViewKey =([\s\S]*?);/.exec(VIEW_TABS_SRC);
  const body = block?.[1];
  if (body === undefined) throw new Error('view-tabs.ts 里没找到 `export type ViewKey` 那块 ⇒ 判据在空转');
  return [...body.matchAll(/'([a-z][a-z-]*)'/g)].map((m) => m[1] as string);
}

function cursorTableKeys(): string[] {
  const start = CURSOR_SRC.indexOf('const CURSOR_VIEWS');
  if (start < 0) throw new Error('keyboard-cursor.ts 里没有 `const CURSOR_VIEWS` ⇒ 判据在空转');
  const open = CURSOR_SRC.indexOf('{', start);
  const close = CURSOR_SRC.indexOf('\n  };', open);
  if (open < 0 || close < 0) throw new Error('CURSOR_VIEWS 的字面量没框住 ⇒ 判据在空转');
  return [...CURSOR_SRC.slice(open, close).matchAll(/^\s{4}([a-z][a-z-]*):\s*\{\s*kind:/gm)].map(
    (m) => m[1] as string,
  );
}

/**
 * 表外的视图 = ViewKey 全集 ∖ 表里的键。
 * `ACCOUNTED_OUT` 是"这些缺席都被交代过"的名单 —— 理由本体留在 `keyboard-cursor.ts:71`
 * 那段注释里（那里逐条现量了六条），这里**不重抄**，只登记谁被交代过。
 */
const ACCOUNTED_OUT = ['calendar', 'focus', 'growth', 'search', 'settings', 'trash'];

function outOfTableViews(): string[] {
  const table = cursorTableKeys();
  return viewKeys()
    .filter((v) => !table.includes(v))
    .sort();
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

/**
 * 递归列出 `root` 下的 `.ts` / `.tsx`（跳过 `node_modules`、点开头目录、软链）。
 * ⚠️ 用 `withFileTypes` 而不是 `statSync`：linked worktree 里到处是软链，
 * `statSync` 对软链给的是链本身而不是目标（同一族坑记在环境陷阱里）。
 */
function walkSource(root: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    if (entry.isSymbolicLink()) continue;
    const full = join(root, entry.name);
    if (entry.isDirectory()) out.push(...walkSource(full));
    else if (/\.(tsx|ts)$/.test(entry.name)) out.push(full);
  }
  return out;
}

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

  /**
   * 🔴 上面那圈循环**插的是自己造的 DOM**，所以它证的是"给定这些行，光标走对"，
   * 证不了"真实界面里那些行的 testid 前缀就是表里写的那一个"。
   * 前缀写错（或共享组件哪天改了 `testID`）的症状是**那条腿静默变成死线**：
   * `renderedIds()` 返回空数组 ⇒ 处理器直接 return ⇒ 界面上按 ↓ 什么都不发生，
   * 而上面那圈循环**一条都不会红**。这正是 §7 第 179 条那一族
   * （"有那个功能"和"界面真的接上了"是两件事）。
   *
   * 所以这一条**从表本身读前缀**（不在测试里再抄一份清单 —— 抄件会漂），
   * 并要求每个前缀在真实渲染代码里有一个 testid 生产者。
   * ⚠️ 它证到"生产者存在且形状对"，**不证**"那个生产者就挂在 `c.view` 那一面上"。
   * 后者要真浏览器 + 真数据，而**这一度被我写成"做不到"**（理由"web 上没有建习惯、
   * 建便签的入口"）—— 那句是错的，现量在工单 §8 的 W1b 行：`HabitsView.tsx:275` 的
   * 新建表单与共享 `NotesBoard` 的 `notes-input` / `notes-submit` 都是真入口。
   * 真浏览器那两条腿因此已经补上（`e2e/tests/keyboard-cursor.spec.ts` 的 K6 / K7）。
   */
  it('🔴 表里每个前缀在真实渲染代码里有 testid 生产者（不是只在插出来的 DOM 里存在）', () => {
    const tableSrc = readFileSync(resolve(__dirname, '../src/lib/keyboard-cursor.ts'), 'utf8');
    const prefixes = [...tableSrc.matchAll(/prefix:\s*'([^']+)'/g)].map((m) => m[1] as string);
    // 解析出 0 项也算红（先例：`check:selection-single-source` 的词表读法）。
    expect(prefixes.length, '没从 CURSOR_VIEWS 里解析出任何前缀 ⇒ 这条判据在空转').toBeGreaterThan(0);
    expect(new Set(prefixes).size, `前缀集合异常：${JSON.stringify(prefixes)}`).toBeGreaterThanOrEqual(3);

    const producers = new Map<string, string[]>();
    for (const root of [resolve(__dirname, '../src'), resolve(__dirname, '../../../packages/ui/src')]) {
      for (const file of walkSource(root)) {
        if (file.endsWith('lib/keyboard-cursor.ts')) continue; // 表自己不算生产者
        const text = readFileSync(file, 'utf8');
        for (const prefix of new Set(prefixes)) {
          // 只认"模板串形状"的 testid 生产者：`data-testid={`prefix-${...}`}` 或 RN 的 `testID={`prefix-${...}`}`
          const shape = new RegExp(`(?:data-testid|testID)=\\{\\\`${prefix}-\\$\\{`);
          if (shape.test(text)) {
            producers.set(prefix, [...(producers.get(prefix) ?? []), relative(root, file)]);
          }
        }
      }
    }
    for (const prefix of new Set(prefixes)) {
      expect(
        producers.get(prefix) ?? [],
        `前缀 "${prefix}" 在 apps/web/src 与 packages/ui/src 里找不到 testid 生产者 ⇒ 那个面上的光标是死线`,
      ).not.toHaveLength(0);
    }
  });

  it('🔴 表里没有的视图不绑光标 —— 清单**从两处真源推出来**，不是手抄', async () => {
    rows('task-item', ['t1', 't2']);
    // 正向对照：同一趟必须有一次"接上的视图真的动了"，否则下面那个"选中没动"
    // 可能量的只是夹具坏了（§7 元规则一：先怀疑探针）。
    await mount('tasks');
    await press('ArrowDown');
    expect(selection.get('task'), '夹具自己就不工作 ⇒ 这一条没有资格判绿').not.toBeNull();
    unmountHarness();
    selection.clear();

    for (const view of outOfTableViews() as ViewKey[]) {
      rows('task-item', ['t1', 't2']);
      await mount(view);
      await press('ArrowDown');
      expect(selection.get('task'), `${view} 面上不该有列表光标`).toBeNull();
      unmountHarness();
    }
  });

  /**
   * 🔴 把 `keyboard-cursor.ts:71` 那句原话变成判据 —— 它写的是"这张表的正确性
   * **取决于'缺席都有理由'**，不取决于'在场都对'"，而注释不能失败。
   *
   * 这一条不重抄理由（理由的所有者在源码注释里，抄过来必漂 —— 本篇 §8.33 那一族），
   * 它只登记**哪一个视图被交代过**：
   * ① `view-tabs.ts` 的 `ViewKey` 全集 = 表里的 ∪ 已登记的表外视图，两边有重叠或有缺口都红；
   * ② 新加一个 `ViewKey` 而没进表、也没登记 ⇒ `ACCOUNTED_OUT` 与推出集不等 ⇒ 红；
   * ③ 表里加了一个视图而名单没动 ⇒ 同样红（方向两侧都有牙，见装置 V2 / V3）。
   */
  it('🔴 视图全集必须"每个都选了边站"：新视图不许静默落到表外', () => {
    const all = viewKeys();
    const table = cursorTableKeys();
    const derivedOut = outOfTableViews();

    expect(new Set(all).size, `ViewKey 里有重复：${JSON.stringify(all)}`).toBe(all.length);
    expect(all.length, 'ViewKey 全集少得不像真的（解析器坏了）').toBeGreaterThanOrEqual(9);
    expect(table.length, 'CURSOR_VIEWS 解析出 0 项 ⇒ 这条判据在空转').toBeGreaterThan(0);
    for (const v of table) expect(all, `表里有 ${v}，但 ViewKey 里没有它`).toContain(v);
    expect(
      table.length + derivedOut.length,
      '两边有重叠 ⇒ 名单解释不了全集（表里的键又被登记成了"表外"）',
    ).toBe(all.length);
    expect(
      derivedOut,
      '表外视图与登记名单不符：新增视图要先在 CURSOR_VIEWS 里接上、或在名单里交代（理由写进 keyboard-cursor.ts 那段注释）',
    ).toEqual([...ACCOUNTED_OUT].sort());
  });
});

describe('三种"不响应"，各挡一种坏', () => {
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

  /**
   * 摆出**镜像真实生产者**的一串行：行本体是裸 `<div>`（不可聚焦），行里有一颗可聚焦的控件。
   *
   * 🔴 为什么夹具必须长成这样：`packages/ui/src/task-list/TaskRow.tsx:300` 的外层行是
   * 裸 `<View>` 且**不带 `tabIndex`**，可聚焦的是行里那颗 `accessibilityRole="checkbox"`。
   * 而 `rows()` 那种空 `<div>` 夹具会让"聚焦行"静默变成空操作 —— 那条判据就只在骗自己
   * （§8.137 B13 那一族：插出来的 DOM 抓不住生产者的形状）。
   *
   * ⚠️ 行内那颗的名字**刻意不以行前缀开头**（`row-box-*` 而不是 `task-item-*-box`）：
   * `renderedIds` 按 `[data-testid^="task-item-"]` 扫行，取 `task-item-f1-box` 这种名字
   * 会让行内的控件被当成**第二行**（本单第一版就这么撞的：↓ 走到的是"f1-box"这一"行"，
   * 焦点看着没动）。真实生产者没有这种名字（行内是 `task-title-*` / `task-chip-*`），
   * 所以这是夹具的形状错、不是产品的洞 —— 但它是一条**潜在雷**，登记在 §8.143 边界。
   */
  function rowsWithControl(prefix: string, ids: string[]): void {
    for (const el of Array.from(document.querySelectorAll(`[data-testid^="${prefix}-"]`))) {
      el.remove();
    }
    document.body.insertAdjacentHTML(
      'beforeend',
      ids
        .map(
          (id) =>
            `<div data-testid="${prefix}-${id}"><button data-testid="row-box-${id}" type="button"></button></div>`,
        )
        .join(''),
    );
  }

  it('🔴 ↓ 走一行 ⇒ DOM 焦点跟着落到**那一行里那颗可聚焦控件**（§8.143）', async () => {
    rowsWithControl('task-item', ['f1', 'f2']);
    const box = document.querySelector('[data-testid="row-box-f1"]') as HTMLElement;
    if (box === null) throw new Error('夹具里没有可聚焦控件 ⇒ 这一条在空转');
    box.focus();
    selection.select('task', 'f1');
    await mount('tasks');
    await press('ArrowDown');
    expect(
      document.activeElement?.getAttribute('data-testid'),
      '焦点没跟着痕迹走 ⇒ Enter 的接管条件永远不成立',
    ).toBe('row-box-f2');
  });

  it('🔴 端点上再按（选中不动）也要把焦点**带进那一行**（从 body 起步）', async () => {
    rowsWithControl('task-item', ['only']);
    selection.select('task', 'only');
    await mount('tasks');
    // 焦点此刻在 body（用户还没 Tab 到行上）—— 端点那一下 `next === current`，
    // 但按键是被吞掉的（既有裁决），所以焦点必须照样落到这一行的控件上。
    await press('ArrowDown');
    expect(document.activeElement?.getAttribute('data-testid')).toBe('row-box-only');
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

/*
 * Enter = 工单 W1b 的**第 3 条腿**（§8.137）：焦点交给这一格，不代为触发任何写入。
 * 这一族量的是"接管 / 不接管"这条线，因为它是宿主唯一能自己决定的一部分；
 * "落点选择器在真 DOM 里有没有生产者"这一档 jsdom 看不见（这里没有 App 树），
 * 由 `e2e/tests/keyboard-cursor.spec.ts` 的 K9/K10 在真浏览器里钉。
 */
describe('Enter 把焦点交给这一格（W1b 第 3 条腿）', () => {
  /** 摆一枚"这一格"（面单根）。`tabIndex=-1` 是它可被程序聚焦的前提，缺了 `focus()` 无效。 */
  function pane(testid: string): HTMLElement {
    const el = document.createElement('div');
    el.setAttribute('data-testid', testid);
    el.tabIndex = -1;
    document.body.appendChild(el);
    return el;
  }

  /** 焦点落在某一行上按 Enter，返回事件有没有被吞。 */
  async function enterOn(rowId: string, prefix = 'habit-row'): Promise<boolean> {
    const row = document.querySelector<HTMLElement>(`[data-testid="${prefix}-${rowId}"]`);
    if (row === null) throw new Error(`找不到行 ${prefix}-${rowId} ⇒ 这一族判据在空转`);
    let prevented = false;
    const probe = (e: Event): void => {
      prevented = e.defaultPrevented;
    };
    window.addEventListener('keydown', probe);
    await press('Enter', row);
    window.removeEventListener('keydown', probe);
    return prevented;
  }

  it('🔴 焦点在**带痕迹那一行**上 ⇒ 焦点交给这一格、吞掉按键，且选中一个字都没动', async () => {
    rows('habit-row', ['h1', 'h2']);
    const p = pane('habit-pane');
    selection.select('habit', 'h2');
    await mount('habits');
    expect(await enterOn('h2')).toBe(true);
    expect(document.activeElement, '按了 Enter，焦点却没进这一格（静默跳焦点 = 界面没说、模型已变）').toBe(p);
    // Enter **不许**顺手写任何东西：选中还是那一条，也没发出 op（这里能验的就是前者）。
    expect(selection.get('habit')).toBe('h2');
  });

  it('🔴 焦点在**没选中**的那一行上 ⇒ 不接管（那是"选它"那一下，不是"打开"）', async () => {
    rows('habit-row', ['h1', 'h2']);
    const p = pane('habit-pane');
    selection.select('habit', 'h2');
    await mount('habits');
    p.focus();
    expect(document.activeElement).toBe(p);
    // 抢走的症状很具体：Tab 到第 1 行按 Enter，用户要的是"选这一行"（行是按钮，Enter = 按下它），
    // 结果选中没变、焦点却跳进右边那一格 —— 一次按键做了两件谁都没要的事。
    expect(await enterOn('h1')).toBe(false);
    expect(document.activeElement, '焦点被抢进这一格了，而痕迹还在另一条').toBe(p);
    expect(selection.get('habit')).toBe('h2');
  });

  it('这一格不在 DOM 里（没渲染面单）⇒ 什么都不做，也**不吞键**', async () => {
    rows('habit-row', ['h1']);
    selection.select('habit', 'h1');
    await mount('habits');
    // 没有 `[data-testid="habit-pane"]`：落点找不到。吞掉一次落空的 Enter，
    // 用户读到的是"回车坏了"，而界面上没有任何东西说明为什么。
    expect(await enterOn('h1')).toBe(false);
    expect(selection.get('habit')).toBe('h1');
  });

  it('🔴 任务那一族的落点是**栏里那只正文框**（§8.138 拍完"行内展开 vs 栏里编辑"之后才存在）', async () => {
    rows('task-item', ['t1', 't2']);
    const input = document.createElement('textarea');
    input.setAttribute('data-testid', 'task-note-input');
    document.body.appendChild(input);
    selection.select('task', 't1');
    await mount('tasks');
    expect(await enterOn('t1', 'task-item')).toBe(true);
    expect(document.activeElement, '按了 Enter，焦点没进栏里的正文框').toBe(input);
    expect(selection.get('task'), 'Enter 顺手改了选中').toBe('t1');
    input.remove();
  });

  it('🔴 窄档（栏没在画 ⇒ 正文框住在行尾那颗 chip 里，DOM 里没有登记的落点）⇒ 不接管、**不吞键**', async () => {
    rows('task-item', ['t1', 't2']);
    selection.select('task', 't1');
    await mount('tasks');
    // 这一条与上面那条是**同一个落点的两侧**：表里登记了 `enterTarget` 不代表画得出来。
    // 吞掉一次落空的 Enter，用户读到的是"回车坏了"，而界面没有任何东西说明为什么。
    expect(await enterOn('t1', 'task-item')).toBe(false);
    expect(selection.get('task')).toBe('t1');
  });

  it('🔴 表里五面**每一面都登记了落点**，且任务那一族三面同串（一处改、三面跟着换）', () => {
    const start = CURSOR_SRC.indexOf('const CURSOR_VIEWS');
    const open = CURSOR_SRC.indexOf('{', start);
    const close = CURSOR_SRC.indexOf('\n  };', open);
    if (open < 0 || close < 0) throw new Error('CURSOR_VIEWS 的字面量没框住 ⇒ 判据在空转');
    const lines = [...CURSOR_SRC.slice(open, close).matchAll(/^\s{4}([a-z][a-z-]*):.*$/gm)];
    const parsed = lines.map((m) => ({
      view: m[1] as string,
      enterTarget: /enterTarget:\s*'([^']+)'/.exec(m[0])?.[1],
    }));
    expect(parsed.map((p) => p.view).sort()).toEqual(['habits', 'notes', 'quadrant', 'tasks', 'timeline']);
    const missing = parsed.filter((p) => p.enterTarget === undefined).map((p) => p.view);
    expect(missing, `这些面没有 Enter 的落点：${missing.join(' / ')}`).toEqual([]);
    const taskViews = parsed.filter((p) => ['tasks', 'quadrant', 'timeline'].includes(p.view));
    expect(
      new Set(taskViews.map((p) => p.enterTarget)).size,
      '三面走的是同一批任务行、同一个 `task` 选中态，落点却登记成了不同的串',
    ).toBe(1);
    expect(taskViews[0]?.enterTarget).toBe('[data-testid="task-note-input"]');
  });

  it('Enter 走的是**同一套闸门**：正在打字 / 浮层开着 / 焦点在菜单里，都不接管', async () => {
    rows('habit-row', ['h1']);
    selection.select('habit', 'h1');
    await mount('habits');

    // ① 正在打字：输入框里的 Enter 是换行/提交，不是"打开右边"。
    const input = document.createElement('input');
    input.setAttribute('data-testid', 'habit-row-h1');
    document.body.appendChild(input);
    const p1 = pane('habit-pane');
    await press('Enter', input);
    expect(document.activeElement, '输入框里的 Enter 被抢走了').not.toBe(p1);
    input.remove();
    p1.remove();

    // ② 浮层开着：界面指的不是底下那一栏。
    document.body.insertAdjacentHTML('beforeend', '<div class="ht-sheet"></div>');
    const p2 = pane('habit-pane');
    await press('Enter', document.querySelector('[data-testid="habit-row-h1"]')!);
    expect(document.activeElement, '浮层开着时焦点跳进了底下那一栏').not.toBe(p2);
    document.querySelector('.ht-sheet')?.remove();
    p2.remove();

    // ③ 焦点在带子菜单的触发器上：Enter 归那颗按钮（打开菜单）。
    const trigger = document.createElement('button');
    trigger.setAttribute('data-testid', 'habit-row-h1');
    trigger.setAttribute('aria-haspopup', 'menu');
    document.body.appendChild(trigger);
    const p3 = pane('habit-pane');
    await press('Enter', trigger);
    expect(document.activeElement, '菜单触发器上的 Enter 被列表光标抢了').not.toBe(p3);
  });
});
