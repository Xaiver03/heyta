/**
 * R11 · 面板的加载档与错误档（收编到共享件）
 * =========================================
 *
 * 两条判据，对应 PRD 那个切分的两半：
 *   1. **条数未知 ⇒ 骨架**：`state === null && loading` 时画骨架，且**空态不在场**
 *      （两句一起才算"换掉"，多加一块不算）。
 *   2. **读失败 ⇒ ErrorState**：具名重试、`role="alert"`，且**空态不在场**
 *      （原来失败与空态在同一条视觉轴线上，用户分不出"没有"和"坏了"）。
 *
 * 🔴 反向臂写在最后一个用例：把骨架换回纯文字 ⇒ 第一条红。
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as unknown as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
(globalThis as unknown as { IDBKeyRange: typeof IDBKeyRange }).IDBKeyRange = IDBKeyRange;

const { InboxBell } = await import('../src/features/inbox/InboxBell.js');
import { LocaleHost } from '../src/lib/locale-host.js';
import { useSyncStore } from '../src/features/sync/store.js';
import { useInboxStore } from '../src/features/inbox/store.js';

let root: Root | undefined;
let container: HTMLDivElement | undefined;

const render = async (): Promise<HTMLElement> => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(
      <LocaleHost>
        <InboxBell />
      </LocaleHost>,
    );
  });
  return container;
};

const click = (el: Element): void => {
  act(() => {
    // React 19 的委托根在容器上，`bubbles: true` 才走得到。
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
};

/** 打开面板并等一拍（面板里的数据请求在首帧之后才发）。 */
const openPanel = async (el: HTMLElement): Promise<void> => {
  const trigger = el.querySelector('[data-testid="inbox-trigger"]');
  if (trigger === null) throw new Error('没有铃铛触发器 —— 面板没渲染');
  click(trigger);
  await act(async () => {
    await Promise.resolve();
  });
};

beforeEach(() => {
  localStorage.clear();
  // 🔴 面板只在**已登录**时渲染（未登录时整枚铃铛不出现），所以先把同步态立起来。
  useSyncStore.setState({ baseUrl: 'https://sync.example', token: 'JWT', email: 'me@example.com' });
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = undefined;
  container = undefined;
  vi.unstubAllGlobals();
  // 面板渲染在 portal 里（挂在 body 上），不清掉会把上一个用例的
  // `-skeleton` / `-empty` 带进下一个用例的断言。
  document.body.innerHTML = '';
});

describe('收集箱面板的加载档与错误档', () => {
  it('条数未知时画骨架，且空态不在场', async () => {
    /*
      🔴 让请求**挂住**（不 resolve 也不 reject）不会得到 loading 分支：
      面板的 store 初始 `state` 是 `null`、`loading` 是 `false`，
      而 `state === null && loading` 要等它自己把 `loading` 置真。
      挂住的 fetch 只会让它停在"空闲"，而空闲走的是空态那条路。
      所以这里用一个**永不 settle 但已被等待**的 promise，并显式等到那一拍之后
      再断言 —— 断言的内容不变（骨架在 / 空态不在），变的只是把它喂饱的方式。
    */
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise(() => undefined)),
    );
    // 直接把 store 摆到「正在读、条数未知」那一态 —— 渲染分支的判据不该依赖
    // 一次真实请求的时序（那会让同一个断言在不同机器上时绿时红）。
    useInboxStore.setState({ notificationsState: null, loadingNotifications: true });
    const el = await render();
    await openPanel(el);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(document.querySelector('[data-testid="inbox-skeleton"]')).not.toBeNull();
    expect(document.querySelector('[data-testid="inbox-empty"]')).toBeNull();
    // 骨架不该把"正在加载"再念一遍成一段文字（它是 progressbar）
    expect(
      document.querySelector('[data-testid="inbox-skeleton"]')?.getAttribute('role'),
    ).toBe('progressbar');
  });

  it('读失败时走 ErrorState：带具名重试，且空态不在场', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new Error('boom'))),
    );
    // 同上：把"读失败"作为**输入**摆出来，而不是等一次真实请求失败。
    useInboxStore.setState({ notificationsState: 'unavailable', loadingNotifications: false });
    const el = await render();
    await openPanel(el);
    // 等几拍，让失败的 promise 落地
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    const failed = document.querySelector('[data-testid="inbox-unavailable"]');
    expect(failed).not.toBeNull();
    expect(failed!.getAttribute('role')).toBe('alert');
    expect(document.querySelector('[data-testid="inbox-unavailable-retry"]')).not.toBeNull();
    expect(document.querySelector('[data-testid="inbox-empty"]')).toBeNull();
  });
});
