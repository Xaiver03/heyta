/**
 * 撤销回执的行为钉子（`UndoReceipt`）
 * ===================================
 *
 * 每条都钉 P3 判据里的一格，而且**每条都指定了"读反了会长成什么样"**：
 *
 * · 窗口来自共享表，不是这里写死的数 —— 第 7 条用 `kind="notice"` 做对照臂：
 *   它的窗口必须等于表里那一档（4000ms）。**把 8000 抄进组件的话，这一条先红**，
 *   因为改表不会带着它一起动。
 * · 暂停不重置（第 3、4 条）—— 立项那两处 `setTimeout(…, 5000)` 根本没有这一格。
 * · 失败留在屏幕上（第 5 条）：容器不许消失，且必须**新**出现一枚 `role="alert"`。
 * · 成功就整条消失（第 6 条）。
 *
 * ⚠️ 计时用 `vi.useFakeTimers()`，`Date.now` 一并假化 —— 组件里的"剩下多少毫秒"
 *    是按 `Date.now()` 扣的，只假 `setTimeout` 不假时钟的话，暂停那条会读成
 *    "剩余窗口 = 0"，红得毫无线索（这条写在这里是因为它就是第一版的红法）。
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '@heyta/i18n';
import { receiptTimingOf } from '@heyta/ui';
import { UndoReceipt } from '../src/lib/feedback/UndoReceipt.js';

let container: HTMLDivElement | undefined;
let root: Root | undefined;

function render(node: React.ReactNode): void {
  const host = document.createElement('div');
  document.body.append(host);
  container = host;
  act(() => {
    root = createRoot(host);
    root.render(<I18nProvider locale="zh-CN">{node}</I18nProvider>);
  });
}

function query<T extends Element = Element>(selector: string): T | null {
  return container?.querySelector<T>(selector) ?? null;
}

/** React 的 `onPointerEnter` / `onPointerLeave` 由 `pointerover` / `pointerout` 综合出来。 */
function hover(el: Element, over: boolean): void {
  act(() => {
    el.dispatchEvent(new Event(over ? 'pointerover' : 'pointerout', { bubbles: true }));
  });
}

function focusInside(el: Element): void {
  act(() => { el.dispatchEvent(new FocusEvent('focusin', { bubbles: true })); });
}

function blurInside(el: Element): void {
  act(() => { el.dispatchEvent(new FocusEvent('focusout', { bubbles: true })); });
}

const UNDO_MS = receiptTimingOf('undo')!.durationMs;
const NOTICE_MS = receiptTimingOf('notice')!.durationMs;

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  act(() => { root?.unmount(); });
  container?.remove();
  container = undefined;
  root = undefined;
  vi.useRealTimers();
});

describe('撤销回执', () => {
  it('出现时是一条可宣布的回执：`role="status"` + `aria-live="polite"` + 正文在按钮上', () => {
    render(<UndoReceipt label="撤销删除 3 个任务" onUndo={async () => {}} data-testid="undo" />);
    const row = query('[data-testid="undo"]');
    expect(row).not.toBeNull();
    expect(row?.getAttribute('role')).toBe('status');
    expect(row?.getAttribute('aria-live')).toBe('polite');
    // 🔴 立项那枚批量回执连 `aria-live` 都没有：读屏用户不知道屏幕上出现过一条可撤销的东西。
    expect(query('[data-testid="undo-action"]')?.textContent).toBe('撤销删除 3 个任务');
  });

  it('窗口走完就自然消失，并请宿主清掉那一格（判据：过期自然消失）', () => {
    let dismissed = 0;
    render(<UndoReceipt label="撤销删除「买菜」" onUndo={async () => {}} data-testid="undo" onDismiss={() => { dismissed += 1; }} />);
    act(() => { vi.advanceTimersByTime(UNDO_MS - 1); });
    expect(query('[data-testid="undo"]'), '还没到窗口下限就被摘掉 = 承诺被悄悄缩短').not.toBeNull();
    act(() => { vi.advanceTimersByTime(1); });
    expect(query('[data-testid="undo"]')).toBeNull();
    expect(dismissed).toBe(1);
  });

  it('鼠标停在上面时暂停，挪开后**只走剩下的那段**（不重置成又一个整窗口）', () => {
    render(<UndoReceipt label="撤销删除 3 个任务" onUndo={async () => {}} data-testid="undo" />);
    const row = query('[data-testid="undo"]')!;
    act(() => { vi.advanceTimersByTime(2000); });
    hover(row, true);
    act(() => { vi.advanceTimersByTime(UNDO_MS + 4000); });
    expect(row.isConnected, '手放在回执上，计时照走完了 —— 这正是立项那两处的形状').toBe(true);
    hover(row, false);
    // 剩下的窗口是 8000 − 2000 = 6000：差一毫秒都算读错。
    act(() => { vi.advanceTimersByTime(UNDO_MS - 2000 - 1); });
    expect(query('[data-testid="undo"]')).not.toBeNull();
    act(() => { vi.advanceTimersByTime(1); });
    expect(query('[data-testid="undo"]')).toBeNull();
  });

  it('键盘焦点落在回执里同样暂停（触屏之外的那一半用户）', () => {
    render(<UndoReceipt label="撤销删除 3 个任务" onUndo={async () => {}} data-testid="undo" />);
    const row = query('[data-testid="undo"]')!;
    act(() => { vi.advanceTimersByTime(1000); });
    focusInside(row);
    act(() => { vi.advanceTimersByTime(UNDO_MS + 4000); });
    expect(row.isConnected, 'Tab 到撤销按钮上准备按回车，回执却自己走了').toBe(true);
    blurInside(row);
    act(() => { vi.advanceTimersByTime(UNDO_MS - 1000); });
    expect(query('[data-testid="undo"]')).toBeNull();
  });

  it('撤销失败：回执不许消失，且必须新出现一枚 `role="alert"` 说清原因（判据 d）', async () => {
    const failure = new Error('便签「买菜」已被彻底删除，无法恢复');
    render(<UndoReceipt label="撤销删除「买菜」" onUndo={async () => { throw failure; }} data-testid="undo" />);
    await act(async () => {
      query<HTMLButtonElement>('[data-testid="undo-action"]')!.click();
    });
    const alert = query('[data-testid="undo-failure"]');
    expect(alert, '失败没有落进任何一枚 alert').not.toBeNull();
    expect(alert?.getAttribute('role')).toBe('alert');
    expect(alert?.textContent).toContain('已被彻底删除，无法恢复');
    // 🔴 这条才是"持续可见"：推进到远超窗口，两枚都还在。
    act(() => { vi.advanceTimersByTime(UNDO_MS * 10); });
    expect(query('[data-testid="undo"]'), '失败后整条回执自己飘走了').not.toBeNull();
    expect(query('[data-testid="undo-failure"]')).not.toBeNull();
  });

  it('撤销成功：整条消失并交回宿主（不留第二句"已撤销"）', async () => {
    let undone = 0;
    let dismissed = 0;
    render((
      <UndoReceipt
        label="撤销删除 3 个任务"
        onUndo={async () => { undone += 1; }}
        data-testid="undo"
        onDismiss={() => { dismissed += 1; }}
      />
    ));
    await act(async () => {
      query<HTMLButtonElement>('[data-testid="undo-action"]')!.click();
    });
    expect(undone).toBe(1);
    expect(query('[data-testid="undo"]')).toBeNull();
    expect(dismissed).toBe(1);
  });

  it('🔴 对照臂：时长来自那张表 —— 换成 `notice` 那一档，窗口必须是表里的 4000', () => {
    expect(NOTICE_MS, '两档必须真的是两个数，否则这条对照臂没有分辨力').not.toBe(UNDO_MS);
    render(<UndoReceipt kind="notice" label="已复制到剪贴板" onUndo={async () => {}} data-testid="undo" />);
    act(() => { vi.advanceTimersByTime(NOTICE_MS - 1); });
    expect(query('[data-testid="undo"]')).not.toBeNull();
    act(() => { vi.advanceTimersByTime(1); });
    expect(query('[data-testid="undo"]')).toBeNull();
  });
});
