/**
 * WebGL 不可用时**不能白页**
 * ============================
 *
 * 这个文件是针对一个**实测到的生产缺陷**写的回归测试，不是预防性设想：
 *
 *   在无头 Chrome 里把 GPU 关掉再打开线上页面，`new THREE.WebGLRenderer(...)`
 *   抛 `Error creating WebGL context`，React 卸载**整棵组件树**——
 *   `#root.innerHTML` 从 90,891 字符变成 0，`scrollHeight` 从 7133 掉到 757。
 *   导航、英雄区、定价、页脚全部消失，用户看到的是一张白纸。
 *
 * 这个文件刻意与 `render.spec.tsx` 走**相反**的路子，理由要说清楚，
 * 否则下一个人会觉得两份测试自相矛盾：
 *
 *   - `render.spec.tsx` 用"永不触发的 IntersectionObserver"**绕开** 3D 那一节，
 *     理由是"在 jsdom 里让 WebGL 场景跑起来只能靠 mock，那验的是 mock"。
 *     那条判断是对的，这里不推翻它。
 *   - 而这里要验的**不是**"3D 场景能跑"（那确实只能靠 mock），
 *     而是"**WebGL 起不来时，页面降级而不是死掉**"。
 *     降级这件事是纯逻辑：抛错 → 换一棵子树。验它**不需要**真实 WebGL，
 *     需要的恰恰是"让渲染器抛错"这个环境条件 —— 所以 mock 掉
 *     `WebGLRenderer` 一个导出是**制造环境**，不是伪造被测行为。
 *
 * 断言的形状也刻意如此：**先断言页面还在，再断言降级件在**。
 * 只断言"降级件出现"的话，一个把整页清空的实现也能通过（因为
 * `querySelector` 找不到东西时返回 null，而 null 不等于"页面正常"）。
 */

import { act, lazy, Suspense } from 'react';
import { I18nProvider } from '@heyta/i18n';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

/**
 * 🔴 只把 `WebGLRenderer` 换成"构造即抛"，**其余 three 全部保留真实实现**。
 *
 * 用 `importOriginal` 而不是写一个假的 three：手写假模块会在 three 的
 * 导出面变化时静默失效（我们只关心"它抛不抛"，不关心它有哪些几何体）。
 */
vi.mock('three', async (importOriginal) => {
  const actual = await importOriginal<typeof import('three')>();
  return {
    ...actual,
    WebGLRenderer: class {
      constructor() {
        throw new Error('THREE.WebGLRenderer: Error creating WebGL context.');
      }
    },
  };
});

import { SceneBoundary } from '../src/components/SceneBoundary.js';
import { SyncFallback } from '../src/components/SyncFallback.js';
import { SyncScene } from '../src/components/SyncScene.js';

/** three 抛错和 React 接住它都会打 console；这里静音，避免污染测试输出。 */
let consoleError: ReturnType<typeof vi.spyOn> | null = null;

let container: HTMLDivElement | null = null;
let root: Root | null = null;

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
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
  consoleError?.mockRestore();
  consoleError = null;
});

function mount(node: React.ReactNode): HTMLDivElement {
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    /*
      包 `I18nProvider` 是**贴着线上形状**（`main.tsx` 也包），不是强制要求：
      根入口的 `useI18n` 在没有 Provider 时会回落到默认全表（宽松版，见
      `packages/i18n/src/react.tsx`）。所以这两条测的仍然是 WebGL 降级，
      不掺 i18n 的语义。
    */
    root?.render(<I18nProvider locale="zh-CN">{node}</I18nProvider>);
  });
  return container;
}

/** 渲染期就抛的组件：用来验边界本身，不掺任何 three 的东西。 */
function Boom(): React.JSX.Element {
  throw new Error('boom');
}

describe('SceneBoundary：把失败范围钉在 WebGL 那一节', () => {
  it('子树渲染期抛错时，只换掉子树，边界外的内容全部保留', () => {
    const view = mount(
      <div>
        <p>边界外面的内容</p>
        <SceneBoundary fallback={<SyncFallback />}>
          <Boom />
        </SceneBoundary>
      </div>,
    );

    // ① 先证明"页面还在" —— 这条比下面那条更重要
    expect(view.textContent).toContain('边界外面的内容');
    // ② 再证明降级件确实挂上了
    expect(view.querySelector('.lp-sync__fallback')).not.toBeNull();
  });

  it('一切正常时不渲染降级件 —— 否则这个边界会吃掉真实场景', () => {
    const view = mount(
      <SceneBoundary fallback={<SyncFallback />}>
        <p>正常内容</p>
      </SceneBoundary>,
    );

    expect(view.textContent).toContain('正常内容');
    expect(view.querySelector('.lp-sync__fallback')).toBeNull();
  });

  /**
   * 🔴 这一条专门证明**边界不是冗余**。
   *
   * 上面那条"撤掉边界仍然绿"的探针结果说明：`SyncScene` 内部那个 try/catch
   * 已经能独力扛住"渲染器构造失败"。那么边界到底还有没有用？
   * 有 —— 它唯一能盖住而组件内 catch **盖不住**的是**分段加载失败**：
   * `three` 那 131 kB 的 chunk 在弱网/断网下 reject 时，抛错发生在
   * lazy 的加载阶段，`SyncScene` 的代码根本还没被执行到，
   * 里面的 try/catch 自然也没机会运行。没有边界，这种情况照样整页白掉。
   *
   * 这里用一个"加载即失败"的 lazy 组件复现那条路径 —— 它不是假想：
   * 线上任何一个分片 404 都会走到这里。
   */
  it('lazy 分片加载失败时也降级（组件内的 catch 盖不住这条路径）', async () => {
    const Broken = lazy(async () => {
      throw new Error('Failed to fetch dynamically imported module');
    });

    const view = mount(
      <div>
        <p>边界外面的内容</p>
        <SceneBoundary fallback={<SyncFallback />}>
          <Suspense fallback={null}>
            <Broken />
          </Suspense>
        </SceneBoundary>
      </div>,
    );

    // lazy 的 rejection 是异步的，要等它落定
    await act(async () => {
      await Promise.resolve();
    });

    expect(view.textContent).toContain('边界外面的内容');
    expect(view.querySelector('.lp-sync__fallback')).not.toBeNull();
  });
});

describe('SyncScene：拿不到 WebGL 上下文时降级为静态图', () => {
  it('渲染器构造抛错时，不抛给上层、换成静态图、且不再输出 canvas', () => {
    const view = mount(<SyncScene />);

    // 🔴 顺序即主张：先"这一节还在"，再"换成了降级件"。
    // 如果 effect 里的 try/catch 被删掉，错误会冒泡出 act，
    // 这棵树会被 React 整个卸载 —— 下面第一条断言就会失败。
    expect(view.querySelector('.lp-sync')).not.toBeNull();
    expect(view.querySelector('.lp-sync__fallback')).not.toBeNull();
    expect(view.querySelector('canvas')).toBeNull();
  });

  it('降级后标题与图例仍然在 —— 降级丢的是画，不是那一段的意思', () => {
    const view = mount(<SyncScene />);

    const section = view.querySelector('.lp-sync');
    expect(section, '整节都没了，说明降级把内容也一起丢了').not.toBeNull();
    expect(view.querySelector('.lp-sync__legend')).not.toBeNull();
    expect((view.querySelector('.lp-sync__head')?.textContent ?? '').trim().length).toBeGreaterThan(0);
  });
});