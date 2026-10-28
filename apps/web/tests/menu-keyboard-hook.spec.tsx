import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useMenuKeyboard } from '../src/lib/menu/useMenuKeyboard.js';

/**
 * 菜单键盘钩子的契约（全局 UX 线 P5）
 * ===================================
 *
 * 这一份钉的是**真浏览器量不出来的那一格**：
 *
 * `e2e/tests/menu-keyboard.spec.ts` 能证"按 Tab 之后菜单关了、焦点离开了菜单项"，
 * 但它**分不开**"焦点回到触发者"这两种成因 —— 账号菜单的面板 `createPortal` 到
 * `body` 末尾，Tab 走到面板最后一项时浏览器的顺序导航本来就会环绕回文档开头，
 * 而那枚触发者正好在那儿。于是"我们主动 `focus()` 了"与"浏览器自己绕回来的"
 * 在 e2e 里长得一模一样。
 *
 * ⇒ 这里直接数 `trigger.focus` 被调用几次：Esc 恰好一次、Tab **零次**。
 *    两格相反是共享判断给出的答案（`refocusTrigger`），这一份证的是
 *    **钩子有没有照那个答案做**（含"Tab 不许拦默认行为"那一格）。
 */

interface HarnessCalls {
  close: (reason: { refocusTrigger: boolean }) => void;
}

let host: HTMLDivElement | null = null;
let root: Root | null = null;

interface HarnessProps {
  readonly calls: HarnessCalls;
  readonly triggerFocus: () => void;
  readonly nestedOpen?: boolean;
  readonly refs: { trigger: { current: HTMLButtonElement | null }; menu: { current: HTMLDivElement | null } };
}

function Harness({ calls, triggerFocus, nestedOpen = false, refs }: HarnessProps) {
  const onKeyDown = useMenuKeyboard({
    open: true,
    containerRef: refs.menu as never,
    triggerRef: refs.trigger as never,
    onClose: calls.close,
    focusTrigger: () => triggerFocus(),
    nestedOpen,
  });
  return (
    <div>
      <button
        ref={(node) => {
          refs.trigger.current = node;
        }}
        type="button"
        data-testid="trigger"
      >
        触发
      </button>
      <div
        ref={(node) => {
          refs.menu.current = node;
        }}
        role="menu"
        data-testid="menu"
        onKeyDown={onKeyDown}
      >
        <button type="button" role="menuitem" tabIndex={-1} data-testid="item-0">
          甲项
        </button>
        <button type="button" role="menuitem" tabIndex={-1} data-testid="item-1">
          乙项
        </button>
      </div>
    </div>
  );
}

/** jsdom 里 `offsetParent` 恒为 null、`getClientRects()` 恒为空 ⇒ 钩子会认为"一项都没画"。 */
function makeItemsVisible(): void {
  for (const item of Array.from(document.querySelectorAll('[role="menuitem"]'))) {
    Object.defineProperty(item, 'getClientRects', { value: () => [{}], configurable: true });
    Object.defineProperty(item, 'offsetParent', { value: host, configurable: true });
  }
}

async function mount(props: Omit<HarnessProps, 'calls' | 'triggerFocus'> & { calls: HarnessCalls; triggerFocus: () => void }): Promise<void> {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root?.render(<Harness {...props} />);
  });
  makeItemsVisible();
}

function press(target: Element, key: string): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  target.dispatchEvent(event);
  return event;
}

afterEach(async () => {
  await act(async () => root?.unmount());
  host?.remove();
  host = null;
  root = null;
});

describe('P5 菜单钩子：两种关闭的焦点答案是相反的', () => {
  it('Escape ⇒ 关掉、拦默认行为、并把焦点还给触发者（恰好一次）', async () => {
    const close = vi.fn();
    const triggerFocus = vi.fn();
    const refs = { trigger: { current: null }, menu: { current: null } };
    await mount({ calls: { close }, triggerFocus, refs });

    const item = document.querySelector<HTMLElement>('[data-testid="item-0"]');
    expect(item).toBeTruthy();
    const event = press(item!, 'Escape');

    expect(close).toHaveBeenCalledWith({ refocusTrigger: true });
    expect(triggerFocus).toHaveBeenCalledTimes(1);
    // Esc 必须拦默认：否则浏览器会把焦点丢给下一枚控件，"还给触发者"就永远做不到。
    expect(event.defaultPrevented).toBe(true);
  });

  it('Tab ⇒ 关掉，但**一次都不许**调用 trigger.focus（那是"用户要往前走的"那一格）', async () => {
    const close = vi.fn();
    const triggerFocus = vi.fn();
    const refs = { trigger: { current: null }, menu: { current: null } };
    await mount({ calls: { close }, triggerFocus, refs });

    const item = document.querySelector<HTMLElement>('[data-testid="item-1"]');
    expect(item).toBeTruthy();
    const event = press(item!, 'Tab');

    expect(close).toHaveBeenCalledWith({ refocusTrigger: false });
    expect(triggerFocus).not.toHaveBeenCalled();
    // 🔴 这一格是本期真浏览器腿抓出来的：第一版两种关闭都 `preventDefault`，
    // 于是 Tab 既不挪焦点、又不让浏览器挪 ⇒ 焦点停在正在被卸载的菜单项上，
    // 用户按 Tab 读起来像"什么都没发生"。
    expect(event.defaultPrevented).toBe(false);
  });

  it('焦点还没进菜单（还在触发者上）时按 Tab ⇒ 照样收起（文档层那一条臂）', async () => {
    // 打开与"焦点进入"之间隔着一帧 rAF。那一帧里按 Tab，面板的 onKeyDown 收不到 ——
    // 习惯的 More 第一次跑就红在这里（菜单留着开着，焦点已走）。
    const close = vi.fn();
    const triggerFocus = vi.fn();
    const refs = { trigger: { current: null }, menu: { current: null } };
    await mount({ calls: { close }, triggerFocus, refs });

    const trigger = document.querySelector<HTMLElement>('[data-testid="trigger"]');
    expect(trigger).toBeTruthy();
    press(trigger!, 'Tab');
    expect(close).toHaveBeenCalledWith({ refocusTrigger: false });
  });

  it('嵌套层开着 ⇒ 一次按键什么都不做（含 Escape）', async () => {
    const close = vi.fn();
    const triggerFocus = vi.fn();
    const refs = { trigger: { current: null }, menu: { current: null } };
    await mount({ calls: { close }, triggerFocus, refs, nestedOpen: true });

    const item = document.querySelector<HTMLElement>('[data-testid="item-0"]');
    expect(item).toBeTruthy();
    for (const key of ['Escape', 'Tab', 'ArrowDown', 'Enter']) press(item!, key);
    expect(close).not.toHaveBeenCalled();
    expect(triggerFocus).not.toHaveBeenCalled();
  });

  it('方向键挪焦点、Enter 激活当前项（DOM 那一半真的动手了）', async () => {
    const close = vi.fn();
    const triggerFocus = vi.fn();
    const refs = { trigger: { current: null }, menu: { current: null } };
    await mount({ calls: { close }, triggerFocus, refs });

    const first = document.querySelector<HTMLElement>('[data-testid="item-0"]');
    const second = document.querySelector<HTMLElement>('[data-testid="item-1"]');
    expect(first).toBeTruthy();
    expect(second).toBeTruthy();

    first!.focus();
    press(first!, 'ArrowDown');
    expect(document.activeElement).toBe(second);

    const clickSpy = vi.spyOn(second!, 'click');
    press(second!, 'Enter');
    expect(clickSpy).toHaveBeenCalledTimes(1);
  });
});
