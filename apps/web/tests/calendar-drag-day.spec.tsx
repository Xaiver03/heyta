/**
 * 横向拖拽换天（R11 批四）—— 判据与绑定的两半
 * =============================================
 *
 * 产品负责人的原话：**"你的鼠标在这里左右滑动，就是左右拖拽滑动。那就是上一天和下一天的切换。"**
 *
 * ## 这个文件钉的两类东西
 *
 * 1. **`readDragSegments` 的四个判断**（够不够远 / 是不是横的 / 往哪边 / 只走一段）；
 * 2. 🔴 **绑定层的落点**：`pointerdown` 挂在宿主上（手势必须在**这一块面板**里起手），
 *    而移动与抬手挂在 **window** —— 因为"往左拖"的自然做法就是把指针拖出内容区。
 *    这条是 e2e 大幅度那一下抓出来的产品缺陷（见 `useDragDayNav.ts` 文件头），
 *    所以它在这里也钉一份：那条 e2e 要真浏览器，改坏了至少这里会先红。
 *
 * ⚠️ jsdom 里派发的是 `MouseEvent`（形状够 `clientX/clientY/button` 用）。
 *   **真**指针行为（浏览器补发的 click、选中带区、跨元素抬手）只在真浏览器里成立，
 *   那部分在 `e2e/tests/calendar-day.spec.ts`。
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useRef } from 'react';

import { DRAG_MIN_PX, readDragSegments } from '../src/features/calendar/drag-day.js';
import { useDragDayNav } from '../src/features/calendar/useDragDayNav.js';

// ── 纯判据 ────────────────────────────────────────────────────────────────
describe('readDragSegments', () => {
  it('🔴 往左拖 = **未来**（+1），往右拖 = 过去（−1）', () => {
    // 写反不会有任何报错：界面照样换天，只是每次拖反（与滚轮那条同一种雷）。
    expect(readDragSegments(-120, 0)).toBe(1);
    expect(readDragSegments(120, 0)).toBe(-1);
  });

  it('阈值卡在"一颗可点目标的宽度"：差 1px 不算拖拽', () => {
    expect(readDragSegments(DRAG_MIN_PX - 1, 0)).toBe(0);
    expect(readDragSegments(-DRAG_MIN_PX + 1, 0)).toBe(0);
    expect(readDragSegments(DRAG_MIN_PX, 0)).toBe(-1);
    expect(readDragSegments(-DRAG_MIN_PX, 0)).toBe(1);
  });

  it('以竖向为主 ⇒ 那是**滚这一屏**（日档那根轴比视口高），不算换天', () => {
    expect(readDragSegments(100, 300)).toBe(0);
    expect(readDragSegments(100, 100)).toBe(0); // 正好 45°：让给滚动，不猜
    expect(readDragSegments(300, 100)).toBe(-1); // 横着占优了才算：往右 = 往过去
  });

  it('一次拖拽只走**一段**（走多远由 `stepCalendarCursor` 决定，这里给不出"三天"）', () => {
    // 拖 1200px 与拖 44px 都只回 ±1 —— 这条钉的是"这里不按距离换算"这件事本身。
    expect(readDragSegments(-1200, 0)).toBe(1);
  });
});

// ── 绑定层 ────────────────────────────────────────────────────────────────
let root: Root | undefined;
let container: HTMLDivElement | undefined;

async function mountHost(options: {
  onStep: (step: -1 | 1) => void;
  within?: string;
  enabled?: boolean;
}): Promise<void> {
  function Host(): React.JSX.Element {
    const ref = useRef<HTMLDivElement | null>(null);
    useDragDayNav(ref, options.onStep, { within: options.within, enabled: options.enabled });
    return (
      <div ref={ref} data-testid="host">
        <div data-testid="day-board">
          <button type="button" data-testid="task-row">
            一条任务
          </button>
        </div>
        <div data-testid="outside">
          <button type="button" data-testid="other-row">
            别处的一行
          </button>
        </div>
      </div>
    );
  }
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(<Host />);
  });
}

function fire(target: EventTarget, type: string, x: number, y = 0, button = 0): void {
  target.dispatchEvent(
    new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button }),
  );
}

/** 在 `start` 元素上按下，把移动与抬手派发到 `endOn`（默认同一个元素）。 */
function drag(start: Element, dx: number, endOn?: Element): void {
  fire(start, 'pointerdown', 300, 0);
  fire(endOn ?? start, 'pointermove', 300 + dx / 2);
  fire(endOn ?? start, 'pointermove', 300 + dx);
  fire(endOn ?? start, 'pointerup', 300 + dx);
}

const el = (testId: string): Element => container!.querySelector(`[data-testid="${testId}"]`)!;

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  container?.remove();
  root = undefined;
  container = undefined;
});

describe('useDragDayNav 的绑定', () => {
  it('在这块板上横拖 ⇒ `onStep` 收到**一次**，方向对', async () => {
    const onStep = vi.fn();
    await mountHost({ onStep, within: '[data-testid="day-board"]' });
    drag(el('task-row'), -180);
    expect(onStep, '横拖没换天').toHaveBeenCalledTimes(1);
    expect(onStep).toHaveBeenLastCalledWith(1);
    drag(el('task-row'), 180);
    expect(onStep).toHaveBeenLastCalledWith(-1);
  });

  it('🔴 起手在板上、**抬手已经拖出宿主**（越过侧栏）⇒ 仍然要换天', async () => {
    // 这就是第一版在产品里失灵的那一下：移动/抬手挂在宿主上时收不到。
    const onStep = vi.fn();
    await mountHost({ onStep, within: '[data-testid="day-board"]' });
    drag(el('task-row'), -260, document.body);
    expect(onStep, '大幅度拖（抬手落在宿主之外）没换天').toHaveBeenCalledTimes(1);
  });

  it('从**别人那块**起手的横拖不算这块的（`within` 圈住的是这一档的面板）', async () => {
    const onStep = vi.fn();
    await mountHost({ onStep, within: '[data-testid="day-board"]' });
    drag(el('other-row'), -240);
    expect(onStep, '侧栏/页头上的横拖被这块吃了').not.toHaveBeenCalled();
  });

  it('没拖够的普通点击**不**换天（一次误碰不该翻一天）', async () => {
    const onStep = vi.fn();
    await mountHost({ onStep, within: '[data-testid="day-board"]' });
    drag(el('task-row'), 5);
    expect(onStep).not.toHaveBeenCalled();
  });

  it('`enabled=false` 时**一个监听都不挂**（月档里"横拖一下"不该换任何东西）', async () => {
    const onStep = vi.fn();
    await mountHost({ onStep, within: '[data-testid="day-board"]', enabled: false });
    drag(el('task-row'), -300);
    expect(onStep).not.toHaveBeenCalled();
  });

  it('右键按下不算起手（上下文菜单与"在新标签打开"不能被抢）', async () => {
    const onStep = vi.fn();
    await mountHost({ onStep, within: '[data-testid="day-board"]' });
    const row = el('task-row');
    fire(row, 'pointerdown', 300, 0, 2);
    fire(row, 'pointermove', 60);
    fire(row, 'pointerup', 60);
    expect(onStep).not.toHaveBeenCalled();
  });

  it('一次**没走完**的拖拽（被 pointercancel 打断）不会把下一次点击也算成拖拽', async () => {
    const onStep = vi.fn();
    await mountHost({ onStep, within: '[data-testid="day-board"]' });
    const row = el('task-row');
    fire(row, 'pointerdown', 300);
    fire(row, 'pointermove', 100);
    // `pointercancel` 没有坐标签（它说的是"系统接管了这一根指针"）。
    fire(row, 'pointercancel', 100, 0, -1);
    // 下一次：只动 4px 的普通点击
    drag(row, 4);
    expect(onStep, '上一次被打断的状态漏到了这一次').not.toHaveBeenCalled();
  });
});
