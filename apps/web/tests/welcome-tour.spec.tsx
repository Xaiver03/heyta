/**
 * #69 · Web 首启导览：只出现一次 + 关闭即记住
 * ==========================================
 *
 * 两层：
 *   1. `first-run.ts` 纯函数：默认没看过、写后看过、认不出（隐私模式）当没看过；
 *   2. `WelcomeTour` 组件：没看时渲染导览，走到最后一页点「开始」后写本机键并收起；
 *      看过之后再挂载 ⇒ 什么都不渲染。
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { I18nProvider } from '@heyta/i18n';

import { hasSeenWelcome, markWelcomeSeen, WELCOME_SEEN_STORAGE_KEY } from '../src/features/onboarding/first-run.js';
import { WelcomeTour } from '../src/features/onboarding/WelcomeTour.js';

let root: Root | undefined;
let container: HTMLDivElement | undefined;

function mount(): HTMLDivElement {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root?.render(
      <I18nProvider locale="zh-CN">
        <WelcomeTour />
      </I18nProvider>,
    );
  });
  return container;
}

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  container?.remove();
  document.body.innerHTML = '';
  root = undefined;
  container = undefined;
});

describe('#69 首启导览 · first-run', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('默认没看过；写下之后看过', () => {
    expect(hasSeenWelcome()).toBe(false);
    markWelcomeSeen();
    expect(localStorage.getItem(WELCOME_SEEN_STORAGE_KEY)).toBe('1');
    expect(hasSeenWelcome()).toBe(true);
  });

  it('存储不可用时回落"没看过"（宁可多放一次也不白屏）', () => {
    const original = Storage.prototype.getItem;
    Storage.prototype.getItem = () => {
      throw new Error('denied');
    };
    try {
      expect(hasSeenWelcome()).toBe(false);
    } finally {
      Storage.prototype.getItem = original;
    }
  });
});

describe('#69 首启导览 · 组件', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('没看过 ⇒ 渲染导览；走到最后一页点「开始」⇒ 记住并收起', () => {
    const el = mount();
    expect(document.body.querySelector('[data-testid="welcome-tour"]')).not.toBeNull();

    for (let i = 0; i < 3; i += 1) {
      const next = el.querySelector('[data-testid="welcome-next"]') as HTMLElement | null;
      expect(next, `next button at slide ${i}`).not.toBeNull();
      act(() => {
        next!.click();
      });
    }
    const start = el.querySelector('[data-testid="welcome-start"]') as HTMLElement | null;
    expect(start).not.toBeNull();
    act(() => {
      start!.click();
    });

    expect(localStorage.getItem(WELCOME_SEEN_STORAGE_KEY)).toBe('1');
    expect(document.body.querySelector('[data-testid="welcome-tour"]')).toBeNull();
  });

  it('看过之后再挂载 ⇒ 什么都不渲染', () => {
    markWelcomeSeen();
    mount();
    expect(document.body.querySelector('[data-testid="welcome-tour"]')).toBeNull();
  });
});
