/**
 * 习惯目标编辑器
 * ================
 *
 * 🔴 这个文件钉的是一处**真实空洞**：`Habit` 有 `target` / `unit` / `goalType`，
 * `packages/domain` 的 `isAchieved` 三种口径全实现了，`checkIn` 也收 `value` ——
 * 但界面上**没有任何地方能改它们**。默认 `target: 1` + `atLeast` 长得**完全正常**，
 * 所以看不出缺了什么，而"每天 8 杯水""每天 30 分钟""一天最多 2 杯咖啡"
 * 这三类计数型 / 时长型习惯到不了用户手里。
 *
 * 补上之后要保证的四件事，缺一件这个功能就是假的：
 *
 *   1. **摘要常驻可见** —— 扫一眼列表要能看出每个习惯的目标是什么；
 *   2. **三个字段一次提交**（一条 op）—— 分三次写会在别的设备上出现
 *      "数值已是 8 但口径还是旧的"这种中间态；
 *   3. 🔴 **`0` 是合法值** —— `atMost` + `0` = "一次都不碰"。
 *      把它当成非法值拦掉，等于把一整类习惯（戒掉某件事）判了死刑；
 *   4. **非法数值（空 / 非数字 / 负数）在本地拦下并明说**，且**不发请求**。
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { I18nProvider } from '@heyta/i18n';
import type { Habit } from '@heyta/domain';

import { HabitGoalEditor } from '../src/features/habits/HabitGoalEditor.js';

let root: Root | undefined;
let container: HTMLDivElement | undefined;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  container?.remove();
  root = undefined;
  container = undefined;
});

function habit(over: Partial<Habit> = {}): Habit {
  return { id: 'h1', name: '喝水', createdAt: 1, updatedAt: 1, ...over } as Habit;
}

async function mount(h: Habit, onSetGoal: (g: unknown) => Promise<void>): Promise<HTMLDivElement> {
  await act(async () => {
    root?.render(
      <I18nProvider locale="zh-CN">
        <HabitGoalEditor habit={h} onSetGoal={onSetGoal as never} />
      </I18nProvider>,
    );
  });
  return container!;
}

const byTestId = (el: HTMLElement, id: string): HTMLElement | null =>
  el.querySelector(`[data-testid="${id}"]`);

/**
 * 🔴 **必须走原生 setter**：直接 `input.value = '8'` 再派发 `input` 事件
 * **不会**触发 React 的 `onChange` —— React 在 input 元素上装了自己的 value
 * 追踪器，赋值会让它认为"值没变"。症状是"测试里输入了但组件没收到"，
 * 而看起来像组件坏了。
 */
function setInputValue(input: HTMLInputElement, next: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  setter?.call(input, next);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

describe('HabitGoalEditor', () => {
  it('🔴 摘要**常驻可见**（折叠着也看得到当前目标）', async () => {
    const el = await mount(habit({ target: 8, unit: '杯', goalType: 'atLeast' }), async () => {});
    const summary = byTestId(el, 'habit-goal-summary-h1');
    expect(summary, '摘要不在').not.toBeNull();
    expect(summary!.textContent ?? '').toContain('8');
    expect(summary!.textContent ?? '').toContain('杯');
  });

  it('没设单位时摘要补一个通用单位（不然会渲染成「至少 8」）', async () => {
    const el = await mount(habit({ target: 3 }), async () => {});
    expect(byTestId(el, 'habit-goal-summary-h1')!.textContent ?? '').toContain('次');
  });

  it('🔴 三个字段**一次提交**（一条 UPD，不是一个字段一条）', async () => {
    const onSetGoal = vi.fn<(goal: unknown) => Promise<void>>(async () => {});
    const el = await mount(habit({ target: 1 }), onSetGoal);

    // 展开 → 改数值与单位 → 选口径
    act(() => {
      byTestId(el, 'habit-goal-toggle-h1')!.click();
    });
    act(() => {
      setInputValue(byTestId(el, 'habit-goal-target-h1') as HTMLInputElement, '8');
    });
    act(() => {
      setInputValue(byTestId(el, 'habit-goal-unit-h1') as HTMLInputElement, '杯');
    });
    await act(async () => {
      byTestId(el, 'habit-goal-type-exactly-h1')!.click();
    });

    expect(onSetGoal).toHaveBeenCalledTimes(1);
    expect(onSetGoal.mock.calls[0]![0]).toEqual({ target: 8, unit: '杯', goalType: 'exactly' });
  });

  it('🔴 `0` 是**合法**的（`atMost` + 0 = 「一次都不碰」）', async () => {
    const onSetGoal = vi.fn<(goal: unknown) => Promise<void>>(async () => {});
    const el = await mount(habit({ target: 1 }), onSetGoal);

    act(() => {
      byTestId(el, 'habit-goal-toggle-h1')!.click();
    });
    act(() => {
      setInputValue(byTestId(el, 'habit-goal-target-h1') as HTMLInputElement, '0');
    });
    await act(async () => {
      byTestId(el, 'habit-goal-type-atMost-h1')!.click();
    });

    expect(onSetGoal).toHaveBeenCalledTimes(1);
    expect(onSetGoal.mock.calls[0]![0]).toMatchObject({ target: 0, goalType: 'atMost' });
    expect(byTestId(el, 'habit-goal-error-h1'), '0 被当成了非法值').toBeNull();
  });

  it('🔴 负数**不发请求**，并显示那行错误', async () => {
    const onSetGoal = vi.fn<(goal: unknown) => Promise<void>>(async () => {});
    const el = await mount(habit({ target: 1 }), onSetGoal);

    act(() => {
      byTestId(el, 'habit-goal-toggle-h1')!.click();
    });
    act(() => {
      setInputValue(byTestId(el, 'habit-goal-target-h1') as HTMLInputElement, '-5');
    });
    await act(async () => {
      byTestId(el, 'habit-goal-type-atLeast-h1')!.click();
    });

    expect(onSetGoal, '非法值还是发了请求').not.toHaveBeenCalled();
    expect(byTestId(el, 'habit-goal-error-h1'), '没有说明为什么不行').not.toBeNull();
  });

  it('清空数值也拦下（空串不是 0）', async () => {
    const onSetGoal = vi.fn<(goal: unknown) => Promise<void>>(async () => {});
    const el = await mount(habit({ target: 1 }), onSetGoal);

    act(() => {
      byTestId(el, 'habit-goal-toggle-h1')!.click();
    });
    act(() => {
      setInputValue(byTestId(el, 'habit-goal-target-h1') as HTMLInputElement, '');
    });
    await act(async () => {
      byTestId(el, 'habit-goal-type-atLeast-h1')!.click();
    });

    expect(onSetGoal).not.toHaveBeenCalled();
    expect(byTestId(el, 'habit-goal-error-h1')).not.toBeNull();
  });
});