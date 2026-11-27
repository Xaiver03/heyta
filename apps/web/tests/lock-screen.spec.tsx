/**
 * #61 · 锁屏遮罩的行为（接线）
 * ============================
 *
 * `app-lock.spec.ts` 钉的是 PIN 的校验 / 解锁 / 错误**逻辑**；这里钉的是**接线**：
 *   - 输**错** PIN ⇒ 不解锁、屏幕上出现错误（`role="alert"`）、输入被清空；
 *   - 输**对** PIN ⇒ 调 `onUnlocked`。
 *
 * 壳走的是共享 `WebModalShell`（`modal-forced-read`），焦点隔离由它负责；本用例只管
 * "用户按下去之后发生了什么"。⚠️ jsdom 无 SubtleCrypto，用 Node 的 WebCrypto 顶上。
 */
import { webcrypto } from 'node:crypto';

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { I18nProvider } from '@heyta/i18n';

import { LockScreen } from '../src/features/app-lock/LockScreen.js';
import { setPin } from '../src/lib/app-lock.js';

beforeAll(() => {
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
});

let root: Root | undefined;
let container: HTMLDivElement | undefined;

afterEach(() => {
  if (root !== undefined) {
    act(() => {
      root?.unmount();
    });
    root = undefined;
  }
  container?.remove();
  container = undefined;
});

function byTestId(id: string): HTMLElement | null {
  return container?.querySelector<HTMLElement>(`[data-testid="${id}"]`) ?? null;
}

/** 给 React 受控 input 赋值：走原型上的原生 setter 再派发 input 事件。 */
function setInputValue(el: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
  setter?.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

async function renderLock(onUnlocked: () => void): Promise<void> {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(
      <I18nProvider locale="zh-CN">
        <LockScreen onUnlocked={onUnlocked} />
      </I18nProvider>,
    );
  });
}

/** 等一件异步判定"落定"（PBKDF2 是异步的，`void submit()` 不返回 promise 给 act）。 */
async function waitFor(predicate: () => boolean): Promise<void> {
  for (let i = 0; i < 100; i += 1) {
    if (predicate()) return;
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
  }
}

describe('#61 锁屏遮罩', () => {
  beforeEach(async () => {
    localStorage.clear();
    await setPin('2468');
  });

  it('错误 PIN：不解锁、显示错误、清空输入', async () => {
    let unlocked = false;
    await renderLock(() => {
      unlocked = true;
    });

    const input = byTestId('app-lock-pin') as HTMLInputElement;
    expect(input).not.toBeNull();
    await act(async () => {
      setInputValue(input, '0000');
    });
    await act(async () => {
      byTestId('app-lock-submit')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await waitFor(() => byTestId('app-lock-pin-field')?.textContent?.includes('PIN 不正确') === true);

    expect(unlocked).toBe(false);
    expect(byTestId('app-lock-pin-field')?.textContent).toContain('PIN 不正确');
    expect((byTestId('app-lock-pin') as HTMLInputElement).value).toBe('');
  });

  it('正确 PIN：调用 onUnlocked', async () => {
    let unlocked = false;
    await renderLock(() => {
      unlocked = true;
    });

    const input = byTestId('app-lock-pin') as HTMLInputElement;
    await act(async () => {
      setInputValue(input, '2468');
    });
    await act(async () => {
      byTestId('app-lock-submit')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await waitFor(() => unlocked);

    expect(unlocked).toBe(true);
  });
});
