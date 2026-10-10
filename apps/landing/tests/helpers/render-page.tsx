/**
 * 整站渲染脚手架 —— **所有"要看真实 DOM"的落地页用例共用这一份**
 * ==============================================================
 *
 * 为什么抽出来：`render.spec.tsx` 里这套脚手架的每一处细节都是踩出来的
 * （重复 `#main`、`ResizeObserver` 缺失、env 桩没清），而第二份需要"渲染每一页"
 * 的用例（公页语域门禁 `public-copy-register.spec.tsx`）只要**抄**一遍，
 * 这两份就会在第一次改布局时漂移 —— 而漂移的那一份通常是新加的那份，
 * 它的表现是"门禁看起来在跑，跑的却是一套过期的脚手架"。
 *
 * 三条不显然的前提，都在下面各自的注释里：
 *   1. 同一时刻只能有一个容器（否则 jsdom 的 id 选择器会挑错 `#main`）；
 *   2. `IntersectionObserver` 要换成永不触发的桩（否则 WebGL 在 jsdom 里必炸）；
 *   3. `ResizeObserver` 在 jsdom 里**根本不存在**，要补空的。
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, vi } from 'vitest';

import { I18nProvider } from '@heyta/i18n';
import type { Locale } from '@heyta/i18n/provider';

import { PAGE_COMPONENTS } from '../../src/pages/index.js';
import { pageById, type SitePageId } from '../../src/site/pages.js';
import { SiteLayout } from '../../src/site/SiteLayout.js';

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

/**
 * 装 jsdom 缺的那几样东西。**幂等，且只在真的缺的时候才补。**
 *
 * 🔴 它由 `renderPage()` 自己调用，不住在 `installPageRenderer()` 里 ——
 * 因为"要渲染一整页"和"要这几个观察者"是同一件事的前提，而前提一旦住在
 * **另一个函数**里，就会出现"新用例导入了 `renderPage`、忘了调用装桩函数"：
 * 那种失败不是"脚手架坏了"的报错，而是**页面少渲染了一节**，
 * 于是门禁把它当成文案违规报出来 —— 排查的人会去改文案，而坏的是测试环境。
 *
 * ⚠️ 只补 `undefined` 的那两样，不无条件覆盖：个别用例自带观察者探针，
 * 覆盖会把它清掉，而那个探针的存在本身就是某次排查的理由。
 */
function ensureScaffold(): void {
  // 让 React 认为处在 act 环境里，否则会打印"not wrapped in act"警告
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  if (globalThis.IntersectionObserver === undefined) {
    globalThis.IntersectionObserver =
      NeverIntersectingObserver as unknown as typeof IntersectionObserver;
  }
  if (globalThis.ResizeObserver === undefined) {
    globalThis.ResizeObserver = NoopResizeObserver as unknown as typeof ResizeObserver;
  }
}

/**
 * 注册用例级别的前后置钩子：开跑前补齐 jsdom 缺口，每个用例结束时清掉
 * 容器与环境桩（`renderPage` 自己会补观察者，这里只是提前一轮）。
 */
export function installPageRenderer(): void {
  beforeAll(ensureScaffold);

  afterEach(() => {
    // 有用例会把 `VITE_APP_URL` 设成"应用已部署"的状态。不清掉的话，
    // 后面所有用例都会在一个"应用存在"的页面上跑 —— 而那正是默认状态不该有的样子。
    vi.unstubAllEnvs();
    cleanupPage();
  });
}

/** 卸载并移除当前容器。**幂等** —— 已经是干净状态时什么都不做。 */
export function cleanupPage(): void {
  if (root !== null) {
    act(() => {
      root?.unmount();
    });
    root = null;
  }
  container?.remove();
  container = null;
}

/**
 * 渲染**一整页**（外壳 + 正文），与 `main.tsx` 的分派走同一条路。
 *
 * 走 `PAGE_COMPONENTS` 而不是直接渲染页面组件是刻意的：这样"注册表里有、
 * 映射表里没有"会在测试里表现成渲染失败，而不是另一个只在线上出现的空白页。
 *
 * 🔴 先清掉上一棵（同一个用例里可能连渲染多页）。
 *
 * 不这么做就会**在一个 document 里留下多个 `id="main"`**，而 jsdom 的
 * id 选择器（nwsapi）在文档里有重复 id 时会返回"第一个匹配、但不是本作用域
 * 内的"那个元素 —— 于是 `view.querySelector('#main')` 返回 `null`，
 * 而 `view.querySelectorAll('[id]')` 明明列得出它。
 * 那种失败看起来像**产品少了那一节**，实际是测试脚手架自己造成的。
 * 所以"同一时刻只有一个容器"是这套用例的硬前提，由这一步保证，
 * 而不是靠每个用例自觉。
 */
/**
 * `pageProps` 只服务一件事：**把某一页的数据源换成交给它的夹具**，而脚手架一个字不改。
 *
 * 为什么开这个口子而不是让用例自己 `createRoot`：那份脚手架的三个前提
 * （单容器 / IntersectionObserver / ResizeObserver）就是这个文件存在的理由，
 * 用例各自复制一份就会漂移，而漂移的那一份通常是新加的那份（见文件头）。
 * 现在唯一的用法是 `renderPage('download', 'zh-CN', { manifest: 夹具 })`。
 */
export function renderPage(
  pageId: SitePageId,
  locale: Locale = 'zh-CN',
  pageProps: Record<string, unknown> = {},
): HTMLDivElement {
  ensureScaffold();
  cleanupPage();

  const page = pageById(pageId);
  const Page = PAGE_COMPONENTS[page.id];
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root?.render(
      <I18nProvider locale={locale}>
        <SiteLayout page={page}>
          <Page page={page} {...pageProps} />
        </SiteLayout>
      </I18nProvider>,
    );
  });
  return container;
}

/** 站内链接（以 `/` 开头的相对地址）。锚点与外链都不算。 */
export function internalHrefs(view: HTMLElement): string[] {
  return [...view.querySelectorAll<HTMLAnchorElement>('a[href]')]
    .map((anchor) => anchor.getAttribute('href') ?? '')
    .filter((href) => href.startsWith('/'));
}
