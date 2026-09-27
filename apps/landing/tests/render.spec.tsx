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

  it('页内锚点全部有落点 —— 导航与页脚的链接不会指向空处', () => {
    const view = renderLanding();
    // 把锚点**从 DOM 里读出来**再逐个查落点，而不是硬编码一份 id 清单：
    // 硬编码的清单会在加了一个区块之后仍然全绿（"以为管住了，其实没管"），
    // 而写错/删掉一个区块 id 的后果就是"点了没反应"。
    const hrefs = [...view.querySelectorAll<HTMLAnchorElement>('a[href^="#"]')].map(
      (a) => a.getAttribute('href') ?? '',
    );
    expect(hrefs.length).toBeGreaterThan(0);
    // `#sync` 那一节由 `<Deferred>` 包着、在 jsdom 里**不会挂载**（见本文件最后
    // 一条测试），所以它是唯一允许缺席的落点。允许清单写死在这里，
    // 别的锚点一个都不许缺 —— 也不许"多一个缺席的"。
    const NOT_MOUNTED_IN_JSDOM = new Set(['#sync']);
    const missing = hrefs.filter(
      (href) => !NOT_MOUNTED_IN_JSDOM.has(href) && view.querySelector(href) === null,
    );
    expect(missing).toEqual([]);
    for (const href of NOT_MOUNTED_IN_JSDOM) {
      expect(view.querySelector(href), `${href} 本该在 jsdom 里缺席`).toBeNull();
    }
    // 价格那一节必须有锚点：导航、页脚、以及它自己都指向它。
    expect(view.querySelector('#pricing')).not.toBeNull();
  });

  it('一级标题存在且不为空', () => {
    const view = renderLanding();
    const h1 = view.querySelector('h1');
    expect(h1).not.toBeNull();
    expect((h1?.textContent ?? '').trim().length).toBeGreaterThan(0);
  });

  it('每个区块都有二级标题 —— 页面结构对读屏软件是可导航的', () => {
    const view = renderLanding();
    expect(view.querySelectorAll('h2').length).toBeGreaterThanOrEqual(6);
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

  /**
   * 🔴 仓库当前是**私有的**，所以任何 `github.com/Xaiver03/heyta` 链接
   * 对访客都是 404 —— 一个"看起来能点、点了是 404"的链接比没有链接更坏。
   *
   * 这条测试钉的就是"整条链路已经摘干净"。它比原来那条
   * 「GitHub 链接是外链且带 rel=noopener」更强：
   * 原来那条只要求"如果有外链，就得带 noopener"，一个外链都没有时它**恒假**
   * （而它当时确实红了，正好证明它测的是"存在性"而不是"安全性"）。
   *
   * 仓库公开之后要做的不是删这条测试，而是把它换回"外链必须带 noopener" ——
   * 清单见 `Nav.tsx` 顶部。
   */
  it('整页不出现私有仓库地址，也没有 target=_blank', () => {
    const view = renderLanding();
    const hrefs = [...view.querySelectorAll<HTMLAnchorElement>('a[href]')].map(
      (a) => a.getAttribute('href') ?? '',
    );
    expect(hrefs.filter((href) => href.includes('github.com'))).toEqual([]);

    // 🔴 只看 `<a href>` 是不够的：自建那一节的**终端里有可以复制粘贴的命令**，
    // 一条印着真地址的 `git clone` 和一条链接一样会把访客送到 404。
    // 所以这里查的是整页文本（含 <code>），而不是链接集合。
    expect(view.textContent ?? '').not.toContain('github.com');

    // 唯一的非锚点链接是语言切换（它指向另一语言的地址，且带 hrefLang）。
    for (const anchor of view.querySelectorAll<HTMLAnchorElement>('a[href]')) {
      const href = anchor.getAttribute('href') ?? '';
      if (href.startsWith('#')) continue;
      expect(anchor.getAttribute('hrefLang'), `非锚点链接却不是语言切换：${href}`).not.toBeNull();
    }

    expect([...view.querySelectorAll('a[target="_blank"]')]).toEqual([]);
  });

  /**
   * 🔴 价格区的**前端侧**契约。
   *
   * 价格本身在三处必须一致（`scripts/check-pricing-consistency.mjs` 管），
   * 这里管的是另外两件只有渲染出来才看得见的事：
   *   1. 页面上真的出现了那两个数字（门禁读的是词条表，读不到"有没有渲染"）；
   *   2. **没有一个点了没反应的购买按钮** —— 托管档现在买不到
   *      （大陆通道没接线、海外 KYC 没过），放一个"立即购买"比不放更坏。
   */
  it('价格区：两个付费档的价格都在，且没有假的购买按钮', () => {
    const view = renderLanding();
    const pricing = view.querySelector('#pricing');
    expect(pricing).not.toBeNull();
    const text = pricing?.textContent ?? '';

    // ADR-0020：月付两个档（¥5 托管 / ¥12 含云端 AI），两种币都必须在页面上。
    expect(text).toContain('¥5');
    expect(text).toContain('¥12');
    expect(text).toContain('$5');
    expect(text).toContain('$12');
    // 两档功能一致这条论断必须真的在页面上（否则"付费解锁功能"会被读成真的）
    expect(text).toContain('功能完全一样');

    // 唯一的可点元素是免费档的 CTA，指向自建那一节；托管档没有任何按钮/链接。
    expect(pricing?.querySelectorAll('button').length).toBe(0);
    const anchors = [...(pricing?.querySelectorAll('a[href]') ?? [])];
    expect(anchors.map((a) => a.getAttribute('href'))).toEqual(['#selfhost']);
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
