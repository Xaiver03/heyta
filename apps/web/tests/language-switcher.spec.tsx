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
 *      从外壳顶栏里找到那些按钮；
 *   2. 点它之后，断言**渲染出来的字**变了（不是断言 state）——
 *      侧栏、视图 tab、空状态，三处都要变；
 *   3. 刷新后还得是英文（`localStorage` 落盘），`<html lang>` 也要跟上。
 *
 * 🔴 第二条用例（每一项都在界面上）是**改造动机**，不是附带检查。
 * 这个控件以前是二态取反（`locale === 'zh-CN' ? 'en' : 'zh-CN'`），它对
 * "只有一种语言能点到"这件事**完全无感**：加第三门语言时不报错、不红、
 * 这个文件里的 6 条也全绿 —— 因为断言里写的是那个按钮的**行为**，不是
 * `LOCALES` 的**数量**。现在项数由 `LOCALES` 推导，缺一项就红。
 *
 * ⚠️ 为什么不整棵树断言"一个汉字都没有"：`apps/web` 是**逐文件迁移**的，
 * AI 面板与捕获框这一批还没迁（另一条工作流在改）。整棵树的汉字断言会把
 * "别人还没迁"当成"我迁坏了"。所以 CJK 断言**只覆盖外壳自己渲染的那几块**
 * （侧栏 + 视图 tab 条 + 空状态），那正是本轮负责的范围。
 */

import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { act, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { enableModules } from './enable-all-modules.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LOCALES } from '@heyta/i18n';

import { LocaleHost } from '../src/lib/locale-host.js';
import { hasStoredLocalePreference } from '../src/lib/locale.js';
import { __resetOpLogForTests, initOpLog } from '../src/lib/oplog.js';

(globalThis as unknown as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
(globalThis as unknown as { IDBKeyRange: typeof IDBKeyRange }).IDBKeyRange = IDBKeyRange;

const { App } = await import('../src/App.js');

const CJK = /[\u3400-\u4DBF\u4E00-\u9FFF]/;

let root: Root | undefined;
let container: HTMLDivElement | undefined;

/** 挂上和线上 `main.tsx` **同一个**语言宿主 + 真的 App。 */
function mount(strict = false): HTMLDivElement {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  const tree = (
    <LocaleHost>
      <App />
    </LocaleHost>
  );
  act(() => {
    // `strict` 走的是线上那份壳：`main.tsx` 四处都套着 `<StrictMode>`，
    // 而它在 dev 下会把 effect（和 updater）**重放一遍** —— 见最后那个 describe。
    root?.render(strict ? <StrictMode>{tree}</StrictMode> : tree);
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
 * 切到某门语言 —— 真实用户点的那个按钮。
 *
 * 找不到就**抛错**而不是 `expect(...).not.toBeNull()`：这条消息本身就是
 * "用户没有入口"的诊断，比一句 "expected null not to be null" 有用得多。
 */
function option(el: HTMLElement, target: string): HTMLButtonElement {
  const button = el.querySelector<HTMLButtonElement>(`[data-testid="language-option-${target}"]`);
  if (button === null) throw new Error(`外壳里没有切到 ${target} 的按钮 —— 这门语言用户点不到`);
  return button;
}

/** 界面上**实际出现**的语言按钮（项数应当等于 LOCALES 的长度）。 */
function options(el: HTMLElement): HTMLButtonElement[] {
  return [...el.querySelectorAll<HTMLButtonElement>('[data-testid^="language-option-"]')];
}

/** 外壳自己渲染的那几块：侧栏 + 视图 tab 条 + 空状态。 */
function shellText(el: HTMLElement): string {
  const parts = [el.querySelector('.ht-sidebar'), el.querySelector('[role="tablist"]')];
  return parts.map((node) => node?.textContent ?? '').join(' ');
}

beforeEach(async () => {
  // 这些用例要走「成长/番茄钟/便签」——它们默认是关的（见 enable-all-modules.ts）。
  enableModules(['focus', 'growth', 'notes']);
  localStorage.clear();
  document.documentElement.lang = '';
  __resetOpLogForTests();
  await initOpLog();
});

afterEach(() => {
  unmount();
});

describe('🔴 可达性：真实外壳里有没有那个控件', () => {
  it('顶栏的全局控件区里，每一种已启用语言都有一个按钮', () => {
    const el = mount();
    const found = options(el);

    // 🔴 项数从 LOCALES 推导，不写死 2 —— 这条断言的真正作用是：
    // 将来在 LOCALES 里打开 ja 而界面忘了跟上时，这里会红。
    expect(found.map((node) => node.getAttribute('data-testid'))).toEqual(
      LOCALES.map((locale) => `language-option-${locale}`),
    );

    for (const node of found) {
      // 每一项都在顶栏的全局控件区（与主题切换并列），任何视图下都看得见。
      expect(node.closest('.ht-header__actions')).not.toBeNull();
      // 每一项的 lang 就是它自己 —— 屏幕阅读器用正确的发音规则读那个词。
      expect(node.getAttribute('lang')).toBe(node.getAttribute('data-testid')?.replace('language-option-', ''));
    }
  });

  it('当前语言那一项是标出来的，其余写着各自语言的自称', () => {
    const el = mount();
    // 中文界面 → zh 项带 aria-current，en 项写着 "English"（目标语言自己的文字）。
    expect(option(el, 'zh-CN').getAttribute('aria-current')).toBe('true');
    expect(option(el, 'en').getAttribute('aria-current')).toBeNull();
    expect(option(el, 'en').textContent).toBe('English');
    expect(option(el, 'zh-CN').textContent).toBe('中文');
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
    // ⚠️ 2026-09-29：这里原本断言的是「设置」——那时它是 rail 上的一个 tab。
    // 现在设置收进了**头像菜单**（点开才出现），所以改用两个**一直在屏幕上**的：
    // 「回收站」（rail 工具段的 tab）与「帮助」（rail 底部的**动作**，不在 tablist 里）。
    // 意图没变：外壳里至少要有几块**不同的**文案一起被翻过去。
    expect(el.textContent).toContain('回收站');
    expect(el.textContent).toContain('帮助');
    expect(el.textContent).toContain('收集箱是空的');

    act(() => {
      option(el, 'en').click();
    });

    // 三块**各自**都被断言到，避免"某一块没换语言"从缝里漏过去。
    expect(el.querySelector('.ht-sidebar')?.textContent).toContain('Inbox');
    expect(el.querySelector('[role="tablist"]')?.textContent).toContain('Trash');
    // 「帮助」在 tablist **外面**（它是动作）—— 单独断言，正好钉住这一点。
    expect(el.querySelector('[data-testid="rail-help"]')?.textContent).toContain('Help');
    expect(el.textContent).toContain('Your inbox is empty');

    expect(el.textContent).not.toContain('收集箱');
    expect(el.textContent).not.toContain('回收站');
    expect(el.textContent).not.toContain('帮助');
    // 外壳自己渲染的那几块里一个汉字都不该剩。
    expect(shellText(el)).not.toMatch(CJK);

    // 标记换到 en 项上，中文项回到"可点的目标"。
    expect(option(el, 'en').getAttribute('aria-current')).toBe('true');
    expect(option(el, 'zh-CN').getAttribute('aria-current')).toBeNull();
    expect(option(el, 'zh-CN').textContent).toBe('中文');
  });

  it('点已经是当前语言的那一项：什么都不发生（不写盘、不发账号请求）', () => {
    const el = mount();
    act(() => {
      option(el, 'zh-CN').click();
    });
    // 中文界面点中文项 —— 界面不该动，localStorage 也不该被写出一条"偏好"。
    expect(el.textContent).toContain('收集箱');
    expect(localStorage.getItem('heyta.locale')).toBeNull();
    expect(option(el, 'zh-CN').getAttribute('aria-current')).toBe('true');
  });

  it('英文界面点回中文（不是单程票）', () => {
    const el = mount();
    act(() => {
      option(el, 'en').click();
    });
    // 先钉住"第一下真的切过去了"，否则这条测试在"按钮完全没接线"时也会绿。
    expect(el.textContent).toContain('Inbox');
    expect(el.textContent).not.toContain('收集箱');

    act(() => {
      option(el, 'zh-CN').click();
    });

    expect(el.textContent).toContain('收集箱');
    expect(shellText(el)).toMatch(CJK);
  });
});

describe('🔴 刷新后保持：落盘 + <html lang>', () => {
  it('切到英文后写进 localStorage、同步 <html lang>，重新挂载仍然是英文', () => {
    const el = mount();
    act(() => {
      option(el, 'en').click();
    });

    expect(localStorage.getItem('heyta.locale')).toBe('en');
    expect(document.documentElement.lang).toBe('en');

    // 模拟刷新：整棵树卸载后重新挂载 —— 初值来自 localStorage，不是内存。
    unmount();
    const again = mount();

    expect(option(again, 'en').getAttribute('aria-current')).toBe('true');
    // 设置已收进头像菜单；用一直在屏幕上的「回收站」代替（意图不变：语言落盘了）。
    expect(again.textContent).toContain('Trash');
    expect(document.documentElement.lang).toBe('en');
  });

  it('切回中文同样落盘（不是"只在第一次写"）', () => {
    const el = mount();
    act(() => {
      option(el, 'en').click();
    });
    // 先确认第一下真的写成 en —— 否则"切回中文"这条在按钮没接线时也会绿。
    expect(localStorage.getItem('heyta.locale')).toBe('en');

    act(() => {
      option(el, 'zh-CN').click();
    });

    expect(localStorage.getItem('heyta.locale')).toBe('zh-CN');
    expect(document.documentElement.lang).toBe('zh-CN');
    expect(el.textContent).toContain('收集箱');
  });
});

/**
 * 🔴 `<StrictMode>` 下的首启：**推断值不许落盘**
 * ==============================================
 *
 * 这批用例是 2026-10-01 真浏览器门禁（`e2e/tests/language-first-launch.spec.ts`）
 * 抓出的那个缺陷的**单元测试层镜像**。缺陷本身：
 *
 * `LocaleHost` 原先把落盘挂在"locale 变了"的 `useEffect` 上，并用一个
 * `firstRun` ref 跳过第一次。`apps/web/src/main.tsx` 四处都套着 `<StrictMode>`，
 * 而它在开发构建下会把 effect **重放一遍** —— 第二次跑时 `firstRun` 已经是
 * `false`，于是"首启只激活、不落盘"这条纪律被 React 自己拆掉了。
 * 探针打印（真浏览器，同一份代码）：
 *
 * ```
 * effect pass 1 firstRun= true  locale= en
 * effect pass 2 firstRun= false locale= en
 * STORED: en            ← localStorage['heyta.locale'] 已经被写成推断值
 * ```
 *
 * 后果不在界面上（界面本来就该是英文），在**解析链第 2 层**：`localStorage` 一有值，
 * `hasStoredLocalePreference()` 就把"浏览器是英文"误判成"用户选过英文"，
 * 登录后的**账号语言采纳**从此永远不触发 —— 换设备/换浏览器的用户拿不到
 * 他在账号里选的语言。
 *
 * ⚠️ **为什么上面那批用例没抓到它**：它们挂的是不带 `<StrictMode>` 的树，
 * 而 jsdom 里也没有 StrictMode 的重放。**不套线上那个壳的"外壳测试"
 * 测不到壳的启动纪律** —— 所以下面这批唯一的区别就是 `mount(true)`。
 *
 * ⚠️ 修法是"落盘挂在**显式动作**上"（`selectLocale` 里 `applyLocale`），
 * 而不是"effect 里判断值变没变"。所以第二条用例同样重要：它钉住的是
 * **另一种错法** —— 若改成"只有和初值不同才落盘"，第一条能过，
 * 但"推断成英文 → 用户明确切中文 → 又明确切回英文"会**不落盘**，
 * 用户最后那次明确选择照样会被账号语言覆盖。
 */
describe('🔴 <StrictMode>：首启推断不落盘，明确选择落盘', () => {
  /** 把 `navigator.language` 临时改成一门语言（`setup.ts` 把它钉成 zh-CN）。 */
  function withNavigatorLocale(value: string): void {
    vi.spyOn(navigator, 'language', 'get').mockImplementation(() => value);
  }

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('英文浏览器首启：界面是英文，但 localStorage 里没有任何偏好（账号语言那道门还开着）', () => {
    withNavigatorLocale('en-US');

    const el = mount(true);

    // 界面确实按系统语言翻过去了 —— 否则这条在"根本没读系统语言"时也会绿。
    expect(el.textContent).toContain('Inbox');
    expect(el.textContent).not.toContain('收集箱');
    expect(document.documentElement.lang).toBe('en');

    // 🔴 这一行就是那个缺陷的判据。
    expect(localStorage.getItem('heyta.locale')).toBeNull();
    expect(hasStoredLocalePreference()).toBe(false);
  });

  it('带 ?lang= 进来同样不落盘（参数是一次性带来，不是本机选择）', () => {
    // setup.ts 钉的 navigator 是 zh-CN，这里让参数赢过它，才能区分"参数"和"系统"。
    const url = new URL(window.location.href);
    url.searchParams.set('lang', 'en');
    window.history.replaceState({}, '', url.toString());
    try {
      const el = mount(true);
      expect(el.textContent).toContain('Inbox');
      expect(localStorage.getItem('heyta.locale')).toBeNull();
    } finally {
      window.history.replaceState({}, '', `${url.pathname}${url.hash}`);
    }
  });

  it('推断成英文 → 明确切中文 → 再明确切回英文：最后这次必须落盘', () => {
    withNavigatorLocale('en-US');

    const el = mount(true);
    // 前提：首启是推断来的英文，且没落盘。
    expect(el.textContent).toContain('Inbox');
    expect(localStorage.getItem('heyta.locale')).toBeNull();

    act(() => {
      option(el, 'zh-CN').click();
    });
    expect(localStorage.getItem('heyta.locale')).toBe('zh-CN');

    act(() => {
      option(el, 'en').click();
    });
    // 🔴 en 此刻**等于初值**。"只在与初值不同时落盘"这种修法会在这里静默不写，
    // 于是用户明确的最后选择仍然记不下来。
    expect(localStorage.getItem('heyta.locale')).toBe('en');
    expect(hasStoredLocalePreference()).toBe(true);
  });

  it('未受支持的系统语言（ja-JP）落回中文兜底，同样不落盘', () => {
    withNavigatorLocale('ja-JP');

    const el = mount(true);
    expect(el.textContent).toContain('收集箱');
    expect(document.documentElement.lang).toBe('zh-CN');
    expect(localStorage.getItem('heyta.locale')).toBeNull();
  });
});
