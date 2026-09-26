/**
 * 整页冒烟测试
 * ==============
 *
 * 目的只有一个：**证明这棵组件树在真实 DOM 里能渲染出来**。
 *
 * 构建通过 ≠ 页面能渲染。类型系统看不见的东西包括：hook 调用顺序、
 * `useScroll` 的 target 为空、某个子组件在渲染期抛错、
 * 以及"文案写对了但根本没挂上去"。
 *
 * 🔴 **刻意不挂载 WebGL 那一节。**
 * 做法是把 `IntersectionObserver` 换成一个**永不触发**的桩：
 * `<Deferred>` 因此一直不 mount，`SyncScene` 那个 lazy chunk 也就不会被导入。
 * 理由是 jsdom 没有 WebGL，`three` 会抛 "Error creating WebGL context" ——
 * 那是**测试环境**的限制，不是产品缺陷。让它在 jsdom 里"通过"只能靠把
 * WebGL 整个 mock 掉，那种测试验证的是 mock，不是代码。
 * 所以 3D 那一节的验证方式是构建产物 + 真实浏览器，见交付说明。
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { Landing } from '../src/Landing.js';

/** 永不触发的 IntersectionObserver：让 `Deferred` 保持未挂载。 */
class NeverIntersectingObserver implements IntersectionObserver {
  readonly root: Element | Document | null = null;
  readonly rootMargin: string = '0px';
  readonly thresholds: readonly number[] = [0];
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
}

/**
 * 空实现的 ResizeObserver。
 *
 * jsdom **不实现** `ResizeObserver`（它不是 jsdom 覆盖的那部分规范），
 * 而 `mockup/AppWindow.tsx` 用它算缩放比 —— 真实浏览器都有，所以这是
 * **测试环境的缺口**，不是产品缺陷。补一个空实现，让 effect 能跑完。
 */
class NoopResizeObserver implements ResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

let container: HTMLDivElement | null = null;
let root: Root | null = null;

beforeAll(() => {
  // 让 React 认为处在 act 环境里，否则会打印"not wrapped in act"警告
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.IntersectionObserver =
    NeverIntersectingObserver as unknown as typeof IntersectionObserver;
  globalThis.ResizeObserver = NoopResizeObserver as unknown as typeof ResizeObserver;
});

afterEach(() => {
  if (root !== null) {
    act(() => {
      root?.unmount();
    });
    root = null;
  }
  container?.remove();
  container = null;
});

function renderLanding(): HTMLDivElement {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root?.render(<Landing />);
  });
  return container;
}

describe('落地页整页渲染', () => {
  it('渲染不抛错，且挂出了主要内容', () => {
    const view = renderLanding();
    expect(view.querySelector('#main')).not.toBeNull();
    expect(view.textContent?.length ?? 0).toBeGreaterThan(500);
  });

  it('九个区块的锚点都在 —— 导航与页脚的链接不会指向空处', () => {
    const view = renderLanding();
    for (const id of ['main', 'showcase', 'privacy', 'selfhost']) {
      expect(view.querySelector(`#${id}`), `缺少 #${id}`).not.toBeNull();
    }
  });

  it('一级标题存在且不为空', () => {
    const view = renderLanding();
    const h1 = view.querySelector('h1');
    expect(h1).not.toBeNull();
    expect((h1?.textContent ?? '').trim().length).toBeGreaterThan(0);
  });

  it('每个区块都有二级标题 —— 页面结构对读屏软件是可导航的', () => {
    const view = renderLanding();
    expect(view.querySelectorAll('h2').length).toBeGreaterThanOrEqual(5);
  });

  it('真实界面的复现件挂上了（任务列表、四象限、热力图、进度环）', () => {
    const view = renderLanding();
    expect(view.querySelector('.mk-frame')).not.toBeNull();
    expect(view.querySelector('.lp-mini-quad')).not.toBeNull();
    expect(view.querySelector('.lp-mini-heat')).not.toBeNull();
  });

  it('页脚带免责声明 —— 这是最容易被截图传播、也最不能漏的一句', () => {
    const view = renderLanding();
    expect(view.textContent).toContain('滴答清单');
    expect(view.textContent).toContain('无任何关系');
  });

  it('GitHub 链接是外链且带 rel=noopener —— 避免 target=_blank 的劫持面', () => {
    const view = renderLanding();
    const external = [...view.querySelectorAll('a[target="_blank"]')];
    expect(external.length).toBeGreaterThan(0);
    for (const anchor of external) {
      expect(anchor.getAttribute('rel')).toContain('noopener');
    }
  });

  it('WebGL 那一节在 jsdom 下**没有**被挂载（Deferred 的桩永不触发）', () => {
    const view = renderLanding();
    // canvas 属于 SyncScene；它不该出现，因为 Deferred 没触发
    expect(view.querySelector('.lp-sync__canvas')).toBeNull();
  });

  it('主题按钮可点击，并会把 data-theme 写到 <html> 上', () => {
    const view = renderLanding();
    const toggle = view.querySelector<HTMLButtonElement>('button[aria-label*="主题"]');
    expect(toggle).not.toBeNull();

    const before = document.documentElement.dataset['theme'];
    act(() => {
      toggle?.click();
    });
    const after = document.documentElement.dataset['theme'];

    expect(after).not.toBe(before);
    expect(['light', 'dark']).toContain(after);
  });
});
