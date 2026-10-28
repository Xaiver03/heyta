/**
 * `control/menu.ts` 的契约 —— 全局 UX 线 P5
 *
 * 这份穷举不是"函数返回对不对"的自证，它钉的是**三处菜单原本各答一样的那几格**：
 * 每条判据旁边都写了它拦的是哪一处的哪个读数。判据按键分开设（不是循环里一句
 * `expect(...).toBeDefined()`），因为这条线的立项教训就是"宽判据等于没有判据"
 * （AGENTS §6 第 2 条）。
 */

import { describe, expect, it } from 'vitest';

import {
  MENU_FOCUS_INDEX_ON_OPEN,
  MENU_NO_ACTIVE_INDEX,
  menuActionOf,
  type MenuKeyInput,
} from '../src/control/menu.js';

const LABELS = ['设置', '帮助与反馈', '导出数据', '退出登录'] as const;

const at = (over: Partial<MenuKeyInput> = {}): MenuKeyInput => ({
  key: 'ArrowDown',
  itemCount: LABELS.length,
  activeIndex: 0,
  labels: LABELS,
  ...over,
});

describe('一、关掉与离开：Esc 与 Tab 是两格相反的答案', () => {
  it('Escape 关掉并把焦点还给触发者', () => {
    expect(menuActionOf(at({ key: 'Escape' }))).toEqual({ kind: 'close', refocusTrigger: true });
  });

  it('Tab 关掉但**不**还焦点 —— 与上一条形状相同、值相反（写成同一个就是红）', () => {
    // 还了就把用户刚走的那一步拽回来；不还而菜单继续开着，则留下"看不见还开着"。
    expect(menuActionOf(at({ key: 'Tab' }))).toEqual({ kind: 'close', refocusTrigger: false });
  });

  it('空菜单（0 项）里 Esc 照样关得掉', () => {
    // 这一格拦的是"菜单被过滤成空就关不掉"：项数为 0 时方向键没有落点，
    // 但关掉这件事与项数无关。
    expect(menuActionOf(at({ key: 'Escape', itemCount: 0, activeIndex: -1 }))).toEqual({
      kind: 'close',
      refocusTrigger: true,
    });
  });
});

describe('二、环游：环绕、边界与"刚打开还没有项有焦点"', () => {
  it('向下从最后一项环绕到第一项', () => {
    expect(menuActionOf(at({ key: 'ArrowDown', activeIndex: 3 }))).toEqual({ kind: 'focus', index: 0 });
  });

  it('向上从第一项环绕到最后一项', () => {
    expect(menuActionOf(at({ key: 'ArrowUp', activeIndex: 0 }))).toEqual({
      kind: 'focus',
      index: LABELS.length - 1,
    });
  });

  it('刚打开（activeIndex=-1）时两个方向**不对称**：向下到第一项、向上到最后一项', () => {
    // 🔴 写成 `(-1 + delta + n) % n` 会把向上那一下送到第一项 —— 图上读起来是"方向键反了"。
    expect(menuActionOf(at({ key: 'ArrowDown', activeIndex: -1 }))).toEqual({
      kind: 'focus',
      index: MENU_FOCUS_INDEX_ON_OPEN,
    });
    expect(menuActionOf(at({ key: 'ArrowUp', activeIndex: -1 }))).toEqual({
      kind: 'focus',
      index: LABELS.length - 1,
    });
  });

  it('Home/End 到两端，且在 0 项时不越界', () => {
    expect(menuActionOf(at({ key: 'Home', activeIndex: 2 }))).toEqual({ kind: 'focus', index: 0 });
    expect(menuActionOf(at({ key: 'End', activeIndex: 0 }))).toEqual({ kind: 'focus', index: 3 });
    expect(menuActionOf(at({ key: 'Home', itemCount: 0, activeIndex: -1 }))).toEqual({ kind: 'ignore' });
    expect(menuActionOf(at({ key: 'End', itemCount: 0, activeIndex: -1 }))).toEqual({ kind: 'ignore' });
  });

  it('横向方向键走同一把尺（子菜单将来复用这一份，不在那里再写一遍环绕）', () => {
    expect(menuActionOf(at({ key: 'ArrowRight', activeIndex: 3 }))).toEqual({ kind: 'focus', index: 0 });
    expect(menuActionOf(at({ key: 'ArrowLeft', activeIndex: 0 }))).toEqual({ kind: 'focus', index: 3 });
  });
});

describe('三、按下与类型查找', () => {
  it('Enter 与空格激活当前项', () => {
    expect(menuActionOf(at({ key: 'Enter', activeIndex: 2 }))).toEqual({ kind: 'activate', index: 2 });
    expect(menuActionOf(at({ key: ' ', activeIndex: 2 }))).toEqual({ kind: 'activate', index: 2 });
  });

  it('没有项有焦点时 Enter 不激活"第 0 项"（那是凭空按下）', () => {
    expect(menuActionOf(at({ key: 'Enter', activeIndex: MENU_NO_ACTIVE_INDEX }))).toEqual({
      kind: 'ignore',
    });
  });

  it('类型查找命中当前项之后的第一个匹配，并环绕', () => {
    // `退出登录` 与 `导出数据` 都以"退/导"开头 —— 按当前项之后找，找不到再绕回来。
    expect(menuActionOf(at({ key: '导', typed: '导', activeIndex: 2 }))).toEqual({
      kind: 'focus',
      index: 2,
    });
    expect(menuActionOf(at({ key: '设', typed: '设', activeIndex: 1 }))).toEqual({
      kind: 'focus',
      index: 0,
    });
  });

  it('多字符前缀继续缩小（`退` 之后接 `出`）', () => {
    expect(menuActionOf(at({ key: '出', typed: '退出', activeIndex: 0 }))).toEqual({
      kind: 'focus',
      index: 3,
    });
  });

  it('查不到就 ignore，不许把焦点甩到第一项', () => {
    // "甩到第一项"的后果：用户在菜单里打字（比如搜索型菜单项）时焦点乱跳。
    expect(menuActionOf(at({ key: 'Q', typed: 'Q', activeIndex: 0 }))).toEqual({ kind: 'ignore' });
  });

  it('调用方没给 typed 时，可打印键不参与查找', () => {
    expect(menuActionOf(at({ key: '设' }))).toEqual({ kind: 'ignore' });
  });
});

describe('四、让出去的那两格：嵌套层与组合键', () => {
  it('嵌套 dialog 开着 ⇒ 整把键盘让出去，**含 Escape**', () => {
    // 判据正文：计划 §P5「嵌套 dialog 不抢外层焦点组」。
    // 外层若也处理 Esc，一次按键会同时关掉对话框与菜单 ⇒ 用户看到"按了一下两层都没了"。
    for (const key of ['Escape', 'Tab', 'ArrowDown', 'ArrowUp', 'Home', 'End', 'Enter'] as const) {
      expect(menuActionOf(at({ key, nestedOpen: true })), `${key} 在嵌套层开着时不该被菜单吃掉`).toEqual({
        kind: 'ignore',
      });
    }
  });

  it('带 Ctrl/Alt/Meta 的组合键一律不吃', () => {
    for (const key of ['Escape', 'ArrowDown', 'w', 'f'] as const) {
      expect(menuActionOf(at({ key, withModifier: true })), `${key} 带修饰键时归宿主`).toEqual({
        kind: 'ignore',
      });
    }
  });
});

describe('五、穷举面：任何键都要给出一个合法答案', () => {
  const KEYS = [
    'Escape',
    'Tab',
    'Enter',
    ' ',
    'ArrowDown',
    'ArrowUp',
    'ArrowLeft',
    'ArrowRight',
    'Home',
    'End',
    'PageDown',
    'PageUp',
    'Delete',
    'F1',
    'a',
    '设',
    '',
    'Unidentified',
  ];
  const KINDS = new Set(['focus', 'close', 'activate', 'ignore']);

  for (const key of KEYS) {
    it(`${key === '' ? '(空串)' : key} ⇒ 四种动作之一，且不抛`, () => {
      for (const activeIndex of [-1, 0, 3]) {
        for (const itemCount of [0, 4]) {
          const action = menuActionOf(at({ key, activeIndex, itemCount }));
          expect(KINDS.has(action.kind), `${key}/${activeIndex}/${itemCount} 读出了 ${action.kind}`).toBe(
            true,
          );
          if (action.kind === 'focus' || action.kind === 'activate') {
            // 🔴 越界的下标会让调用方 `items[i]` 拿到 undefined —— 那正是"按了没反应"。
            expect(action.index).toBeGreaterThanOrEqual(0);
            if (itemCount > 0) expect(action.index).toBeLessThan(itemCount);
          }
        }
      }
    });
  }
});
