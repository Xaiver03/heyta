/**
 * 设置导航的**当前项要被带进可视窗口** —— 而且不管这一档是谁选的
 * ===============================================================
 *
 * ## 它补的是哪一条
 *
 * 窄屏（实测 375）那条设置分组导航是一根**横向可滚的条**：七项的总宽远超可视窗口，
 * 「关于与帮助」落在文档 x `631..737` 而窗口只到 `x=315`。从 rail 的「帮助」进设置时，
 * 内容面已经换成一屏的帮助，导航那一行却还停在最左边 —— **选中态（`aria-current="page"`
 * 那条主蓝底纹）整个画在可视窗口外**，用户看见的是"我点了帮助，界面却没有任何一项被选中"。
 *
 * 机制不在眼睛那儿，在代码里一眼看得到：`scrollIntoView` **只挂在导航按钮自己的
 * `onClick` 上**。而选这一档一共有四条路 —— 点导航按钮是其中一条，另外三条
 * （rail「帮助」/ rail「个人信息」/ `openAiSettings` 那些锚点）走的都是
 * `setSettingsAnchor(...)`，**根本不经过那个 `onClick`**。
 *
 * 🔴 本文件先钉"程序化那条路也必须是滚的是导航项"，再钉"点按钮那条路别被我改丢"。
 * 第二条不是凑数：修法是**把那条规则从 `onClick` 挪成 `active` 的 effect**（一份拷贝，
 * 四条路共用），挪错了就会只剩效果 A 没有效果 B —— 而那正好是本仓 H9 第 3 刀
 * （`App.tsx` 里"三份拷贝会开始漂移"那段）说的同一个形状。
 *
 * ## 为什么记下的是"滚的是谁"而不是"滚没滚"
 *
 * jsdom 不实现 `Element.prototype.scrollIntoView`（浏览器专有）。补法沿用
 * `settings-anchor-focus.spec.tsx` / `search-panel.spec.tsx`：**补在测试这边**，
 * 不把宿主代码改成 `?.scrollIntoView?.()`（那是为了迁就夹具而弱化产品代码）。
 * 顺手把它变成真判据：记下滚的**是谁**与**参数**，于是"滚了内容区那一节"和
 * "滚了导航里当前项"这两种读法不再同形 —— 本文件第一次跑就是靠这一点红的。
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { __resetAuthForTests } from '../src/features/auth/store.js';
import { __resetOpLogForTests, initOpLog } from '../src/lib/oplog.js';
import { emptyState } from '@heyta/op-log';
import { privacyConsentActions } from '../src/features/privacy/consent-gate.js';
import { useSyncStore } from '../src/features/sync/store.js';
import { useTaskStore } from '../src/features/tasks/store.js';
import { LocaleHost } from '../src/lib/locale-host.js';

(globalThis as unknown as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
(globalThis as unknown as { IDBKeyRange: typeof IDBKeyRange }).IDBKeyRange = IDBKeyRange;

const { App } = await import('../src/App.js');

type Scroll = { target: string; options: unknown };
const scrolls: Scroll[] = [];
const originalScrollIntoView = Element.prototype.scrollIntoView;
const originalScrollTo = Element.prototype.scrollTo;

/**
 * 导航按钮与内容区那一节的 `id` **会同名**（按钮 `aria-controls="settings-group-help"`，
 * 区块 `id="settings-group-help"`）—— 不加前缀两者都读成同一个字符串，"滚了区块"就会被
 * 误读成"滚了导航项"。所以这里把来源写进标签里。
 */
function scrollTarget(el: Element): string {
  const controls = el.getAttribute('aria-controls');
  if (controls !== null) return `nav:${controls}`;
  if (el.id !== '') return `section:${el.id}`;
  const testId = el.getAttribute('data-testid');
  if (testId !== null) return `testid:${testId}`;
  return el.tagName.toLowerCase();
}

let root: Root | undefined;
let container: HTMLDivElement | undefined;

const click = (el: Element): void => {
  act(() => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
};

beforeEach(async () => {
  scrolls.length = 0;
  Element.prototype.scrollIntoView = function (this: Element, options?: unknown): void {
    scrolls.push({ target: scrollTarget(this), options });
  };
  /**
   * 换档时 `onSelect` 还会把浮层滚回顶部（`document.querySelector('.ht-sheet')?.scrollTo(...)`），
   * 而 jsdom 同样**不实现** `scrollTo`。不补这一层，点按钮那条路会崩在宿主代码里，
   * 报错指不到产品行为 —— 补法与上面 `scrollIntoView` 同理：补在测试这边。
   */
  Object.defineProperty(Element.prototype, 'scrollTo', {
    value: (): void => undefined,
    configurable: true,
    writable: true,
  });
  __resetAuthForTests();
  (globalThis as unknown as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
  __resetOpLogForTests();
  useTaskStore.setState({ entities: emptyState(), filter: { kind: 'all' } });
  await initOpLog(`nav-reveal-${Math.random().toString(36).slice(2)}`);
  useSyncStore.setState({ baseUrl: '', token: undefined, password: undefined });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const path = new URL(String(input)).pathname;
      if (path === '/api/account/profile') {
        return Response.json({ displayName: null, avatarHash: null });
      }
      return Response.json({ error: 'not part of this journey' }, { status: 404 });
    }),
  );
  // 冷启动会弹首启隐私面板；本文件的前提是"这台设备已经做过隐私决定"。
  privacyConsentActions.accept();

  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(
      <LocaleHost>
        <App />
      </LocaleHost>,
    );
  });
});

afterEach(() => {
  Element.prototype.scrollIntoView = originalScrollIntoView;
  Object.defineProperty(Element.prototype, 'scrollTo', {
    value: originalScrollTo,
    configurable: true,
    writable: true,
  });
  act(() => {
    root?.unmount();
  });
  container?.remove();
  root = undefined;
  container = undefined;
  vi.unstubAllGlobals();
});

describe('设置分组导航的当前项要被滚进可视窗口', () => {
  it('从 rail 的「帮助」进设置：滚的是导航里 `aria-current="page"` 那一项，不是只有内容区那一节', async () => {
    const el = container!;
    const railHelp = el.querySelector('[data-testid="rail-help"]');
    expect(railHelp, 'rail 上必须有「帮助」').not.toBeNull();

    click(railHelp!);

    const current = el.querySelector('.ht-settings__nav [aria-current="page"]');
    expect(current, '设置浮层的导航里必须有一项被标成当前档').not.toBeNull();
    expect(current!.getAttribute('aria-controls'), '程序化选的那一档就是帮助').toBe(
      'settings-group-help',
    );

    // 🔴 这一句是本文件的主判据。旧代码里 `scrollIntoView` 只挂在导航按钮自己的
    //    `onClick` 上，而这条路径不经过它 ⇒ 被滚的只有 `section:settings-group-help`。
    expect(
      scrolls.some((s) => s.target === 'nav:settings-group-help'),
      `导航里的当前项一次都没被滚过（本趟滚到的：${JSON.stringify(scrolls.map((s) => s.target))}）`,
    ).toBe(true);
  });

  it('那条滚动的参数还是 `block:"nearest"` + `inline:"center"`（横向居中，别把整页顶下去）', async () => {
    const el = container!;
    click(el.querySelector('[data-testid="rail-help"]')!);

    const revealed = scrolls.find((s) => s.target === 'nav:settings-group-help');
    expect(revealed, '当前项没有被滚').not.toBeUndefined();
    expect(revealed!.options).toEqual({ block: 'nearest', inline: 'center' });
  });

  it('点导航按钮那条路没有因为"收成一份规则"而丢：换档后新当前项被滚', async () => {
    const el = container!;
    click(el.querySelector('[data-testid="rail-help"]')!);
    scrolls.length = 0;

    const syncNav = el.querySelector<HTMLButtonElement>('[aria-controls="settings-group-sync"]');
    expect(syncNav, '导航里必须有「同步与隐私」').not.toBeNull();
    click(syncNav!);

    expect(
      scrolls.some((s) => s.target === 'nav:settings-group-sync'),
      `点按钮换档后新当前项没被滚（本趟滚到的：${JSON.stringify(scrolls.map((s) => s.target))}）`,
    ).toBe(true);
    expect(el.querySelector('.ht-settings__nav [aria-current="page"]')?.getAttribute('aria-controls'))
      .toBe('settings-group-sync');
  });
});
