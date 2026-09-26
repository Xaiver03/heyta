/**
 * 语言切换器：**真实用户到底能不能把界面切成英文**
 * ====================================================
 *
 * 🔴 这个文件存在的理由，是本轮最要紧的一件事：
 *
 * 在它之前，`lib/locale.ts`（读偏好 / 落盘 / `<html lang>`）、
 * `lib/locale-preference.tsx`、`lib/locale-host.tsx` 全都在，**测试也全绿** ——
 * 但**没有任何控件调用 `setLocale`**。也就是说 web 的多语言"测得出、用不到"：
 * 真实用户翻遍界面也找不到切英文的入口，`web.*` 的 en 词条只有测试里
 * 手写 `locale="en"` 才会出现。
 *
 * 所以这里钉的不是"函数对不对"，而是**可达性**：
 *   1. 挂**真的 `<App />`**（包上与线上同一个 `LocaleHost`），
 *      从外壳顶栏里找到那个按钮；
 *   2. 点它之后，断言**渲染出来的字**变了（不是断言 state）——
 *      侧栏、视图 tab、空状态，三处都要变；
 *   3. 刷新后还得是英文（`localStorage` 落盘），`<html lang>` 也要跟上。
 *
 * ⚠️ 为什么不整棵树断言"一个汉字都没有"：`apps/web` 是**逐文件迁移**的，
 * AI 面板与捕获框这一批还没迁（另一条工作流在改）。整棵树的汉字断言会把
 * "别人还没迁"当成"我迁坏了"。所以 CJK 断言**只覆盖外壳自己渲染的那几块**
 * （侧栏 + 视图 tab 条 + 空状态），那正是本轮负责的范围。
 */

import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { LocaleHost } from '../src/lib/locale-host.js';
import { __resetOpLogForTests, initOpLog } from '../src/lib/oplog.js';

(globalThis as unknown as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
(globalThis as unknown as { IDBKeyRange: typeof IDBKeyRange }).IDBKeyRange = IDBKeyRange;

const { App } = await import('../src/App.js');

const CJK = /[\u3400-\u4DBF\u4E00-\u9FFF]/;

let root: Root | undefined;
let container: HTMLDivElement | undefined;

/** 挂上和线上 `main.tsx` **同一个**语言宿主 + 真的 App。 */
function mount(): HTMLDivElement {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root?.render(
      <LocaleHost>
        <App />
      </LocaleHost>,
    );
  });
  return container;
}

function unmount(): void {
  act(() => {
    root?.unmount();
  });
  container?.remove();
  root = undefined;
  container = undefined;
}

/**
 * 语言切换器 —— 真实用户点的那个控件。
 *
 * 找不到就**抛错**而不是 `expect(...).not.toBeNull()`：这条消息本身就是
 * "用户没有入口"的诊断，比一句 "expected null not to be null" 有用得多。
 */
function switcher(el: HTMLElement): HTMLButtonElement {
  const button = el.querySelector<HTMLButtonElement>('[data-testid="language-switcher"]');
  if (button === null) throw new Error('外壳里找不到语言切换器 —— 用户无从切换语言');
  return button;
}

/** 外壳自己渲染的那几块：侧栏 + 视图 tab 条 + 空状态。 */
function shellText(el: HTMLElement): string {
  const parts = [el.querySelector('.ht-sidebar'), el.querySelector('[role="tablist"]')];
  return parts.map((node) => node?.textContent ?? '').join(' ');
}

beforeEach(async () => {
  localStorage.clear();
  document.documentElement.lang = '';
  __resetOpLogForTests();
  await initOpLog();
});

afterEach(() => {
  unmount();
});

describe('🔴 可达性：真实外壳里有没有那个控件', () => {
  it('外壳顶栏的全局控件区里有切换器，且显示**目标语言的自称**', () => {
    const el = mount();
    const button = switcher(el);

    // 它在顶栏的全局控件区（与主题切换并列），任何视图下都看得见。
    expect(button.closest('.ht-header__actions')).not.toBeNull();
    // 中文界面 → 按钮上写的是 "English"（目标语言自己的文字）。
    expect(button.textContent).toBe('English');
    // 发音规则跟着目标语言走，而不是当前界面语言。
    expect(button.getAttribute('lang')).toBe('en');
  });

  it('切换器不需要 Provider 之外的任何前置条件（它就是 setLocale 的唯一入口）', () => {
    const el = mount();
    // 点之前是中文：侧栏与视图 tab 都是中文。
    expect(shellText(el)).toMatch(CJK);
    expect(el.textContent).toContain('收集箱');
  });
});

describe('🔴 点一下：界面上的可见文案真的变（不是只改 state）', () => {
  it('侧栏 / 视图 tab / 空状态三处都换成英文，且外壳里不再有汉字', () => {
    const el = mount();
    expect(el.textContent).toContain('收集箱');
    expect(el.textContent).toContain('设置');
    expect(el.textContent).toContain('收集箱是空的');

    act(() => {
      switcher(el).click();
    });

    // 三块**各自**都被断言到，避免"某一块没换语言"从缝里漏过去。
    expect(el.querySelector('.ht-sidebar')?.textContent).toContain('Inbox');
    expect(el.querySelector('[role="tablist"]')?.textContent).toContain('Settings');
    expect(el.textContent).toContain('Your inbox is empty');

    expect(el.textContent).not.toContain('收集箱');
    expect(el.textContent).not.toContain('设置');
    // 外壳自己渲染的那几块里一个汉字都不该剩。
    expect(shellText(el)).not.toMatch(CJK);

    // 按钮自己也要翻：现在是英文界面 → 它写 "中文"。
    const button = switcher(el);
    expect(button.textContent).toBe('中文');
    expect(button.getAttribute('lang')).toBe('zh-CN');
  });

  it('中文界面点的 × 英文界面点的，落在相反的方向（不是单程票）', () => {
    const el = mount();
    act(() => {
      switcher(el).click();
    });
    // 先钉住"第一下真的切过去了"，否则这条测试在"按钮完全没接线"时也会绿。
    expect(switcher(el).textContent).toBe('中文');
    expect(el.textContent).toContain('Inbox');
    expect(el.textContent).not.toContain('收集箱');

    act(() => {
      switcher(el).click();
    });

    expect(switcher(el).textContent).toBe('English');
    expect(el.textContent).toContain('收集箱');
    expect(shellText(el)).toMatch(CJK);
  });
});

describe('🔴 刷新后保持：落盘 + <html lang>', () => {
  it('切到英文后写进 localStorage、同步 <html lang>，重新挂载仍然是英文', () => {
    const el = mount();
    act(() => {
      switcher(el).click();
    });

    expect(localStorage.getItem('heyta.locale')).toBe('en');
    expect(document.documentElement.lang).toBe('en');

    // 模拟刷新：整棵树卸载后重新挂载 —— 初值来自 localStorage，不是内存。
    unmount();
    const again = mount();

    expect(switcher(again).textContent).toBe('中文');
    expect(again.textContent).toContain('Settings');
    expect(document.documentElement.lang).toBe('en');
  });

  it('切回中文同样落盘（不是"只在第一次写"）', () => {
    const el = mount();
    act(() => {
      switcher(el).click();
    });
    // 先确认第一下真的写成 en —— 否则"切回中文"这条在按钮没接线时也会绿。
    expect(localStorage.getItem('heyta.locale')).toBe('en');

    act(() => {
      switcher(el).click();
    });

    expect(localStorage.getItem('heyta.locale')).toBe('zh-CN');
    expect(document.documentElement.lang).toBe('zh-CN');
    expect(el.textContent).toContain('收集箱');
  });
});
