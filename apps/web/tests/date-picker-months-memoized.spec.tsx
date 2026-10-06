/**
 * 月历只在**换月**时重建（P1-2）
 * ==============================
 *
 * ## 这一条钉的是用户手上的那件事
 *
 * `DatePicker` 住在任务详情浮层里。浮层的标题是宿主自己的 `useState` ⇒
 * **每敲一个字符，整个浮层重渲染一次**，`DatePicker` 跟着重渲染。
 * 而 `const weeks = monthGrid(month)` 是一行**无条件**的重建：
 * 2 个 DatePicker × 每次 42 个格子对象 + 每格 1–2 个内联 style。
 * 手机上"打字发涩"就是这里，不是渲染层玄学。
 *
 * ## 为什么判据是"数调用次数"，而且两条腿都得站着
 *
 * 只断"重渲染时没再调 `monthGrid`"是自证不了的：mock 没接上、组件根本没渲染、
 * 或者 `@heyta/ui` 解析到了没被替换的那一份 —— 读数同样是 0，而那**全是假绿**。
 * 所以三趟：
 *
 *   1. **首渲染 ≥ 1** —— 证明这枚计数桩真的在链路上（否则后面两趟全是空的）；
 *   2. **同参数重渲染 = 0** —— 正题：打字不许重建月历；
 *   3. **换月 ≥ 1** —— 正向对照：记忆化没有把用户钉在当月（那是另一种坏）。
 *
 * ⚠️ 计数桩**委托真实现**，不是返回假数据：它必须真的算出月历，
 * 否则组件拿到的 `weeks` 是空的，"没重建"就可能只是"根本没渲染格子"。
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { LocalDate } from '@heyta/domain';

/** `vi.mock` 会被提升到文件顶部，所以计数器必须一起提升。 */
const counter = vi.hoisted(() => ({ monthGridCalls: 0 }));

vi.mock('@heyta/domain', async (importOriginal) => {
  const real = await importOriginal<typeof import('@heyta/domain')>();
  return {
    ...real,
    monthGrid: (date: LocalDate) => {
      counter.monthGridCalls += 1;
      return real.monthGrid(date);
    },
  };
});

const { DatePicker, HeytaUiProvider } = await import('@heyta/ui');

const LABELS = {
  weekdays: ['一', '二', '三', '四', '五', '六', '日'],
  monthTitle: (month: LocalDate) => month.slice(0, 7),
  clear: '清除',
  prevMonth: '上个月',
  nextMonth: '下个月',
  dayLabel: (month: number, day: number) => `${String(month)}月${String(day)}日`,
};

const TODAY: LocalDate = '2026-10-15';

function renderTree(root: Root, value: LocalDate | undefined): void {
  act(() => {
    root.render(
      <HeytaUiProvider>
        <DatePicker
          value={value}
          today={TODAY}
          onChange={() => undefined}
          quickPicks={[{ key: 'today', label: '今天', date: TODAY }]}
          labels={LABELS}
          testID="date-picker-under-test"
        />
      </HeytaUiProvider>,
    );
  });
}

let root: Root | undefined;
let container: HTMLDivElement | undefined;

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  container?.remove();
  root = undefined;
  container = undefined;
  counter.monthGridCalls = 0;
});

describe('🔴 DatePicker 的月历按 `month` 记忆化', () => {
  it('首渲染算一次 → 同参数重渲染一次都不算 → 换月又算（三腿缺一不可）', () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    // ① 活体证据：计数桩真的在链路上
    renderTree(root, '2026-10-18');
    expect(
      counter.monthGridCalls,
      '首渲染一次都没调到 `monthGrid` ⇒ 桩没接上或组件没渲染，下面那个 0 是假的',
    ).toBeGreaterThanOrEqual(1);

    // ② 正题：浮层每敲一个字就重渲染一次，月历不该跟着重建
    counter.monthGridCalls = 0;
    renderTree(root, '2026-10-18');
    renderTree(root, '2026-10-18');
    renderTree(root, '2026-10-18');
    expect(
      counter.monthGridCalls,
      '同参数重渲染 3 次就重建 3 次月历 ⇒ 打字时每键 42 个格子对象（P1-2）',
    ).toBe(0);

    // ③ 正向对照：记忆化不是把用户钉死在当月
    counter.monthGridCalls = 0;
    renderTree(root, '2026-11-02');
    expect(
      counter.monthGridCalls,
      '换月后没重算月历 ⇒ 记忆化过头（依赖不是 `month`），界面会停在旧月份',
    ).toBeGreaterThanOrEqual(1);
  });

  it('格子真的画出来了（证明"没重建"不等于"没渲染"）', () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    renderTree(root, '2026-10-18');

    const text = container.textContent ?? '';
    // 10 月 18 日必须在这屏上 —— 它同时证明上面那一趟"0 次重建"给组件的
    // 是一份**真的**月历，不是空数组。
    expect(text).toContain('18');
    expect(text).toContain('2026-10');
  });
});
