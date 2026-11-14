/**
 * 首启引导（桌面 / web）—— 判据。
 * ==================================
 *
 * ## 它守的是什么
 *
 * 2026-11-14 给收集箱空态加了「三条示例 + 一个出口」。这份 spec 钉四件事：
 *
 *   1. **给了 `firstRun` 才渲染**；不给时 DOM 一条都不多（老用户 / 其它 filter）。
 *   2. **标题换成引导自己的**，不是"收集箱是空的" + 引导标题两层。
 *   3. 点一条示例，交出去的是**词条原文**（不是序号、不是截断）。
 *   4. 出口点得到，且**只**调 `onDismiss`（不顺手填充）。
 *
 * ## 为什么不去渲染整个 App
 *
 * "点示例 ⇒ 输入框真的被填上"那一段跨了三个文件（App 的 state、共享
 * `CaptureComposer` 的 `fillRequest`、web 壳的透传），用 jsdom 渲染整个 App
 * 要拖起 op-log + IndexedDB + 路由，红起来分不清是引导坏了还是环境没起来。
 * 那一段交给真浏览器（`e2e/tests/first-run-guide.spec.ts`）—— 本文件只管
 * "组件在给定 props 下画出什么"。
 *
 * ## 反向臂（这份 spec 会不会红）
 *
 * 把 `EmptyState` 里 `firstRun === undefined ? null :` 改成无条件渲染 ⇒ 第 2 条红；
 * 把 `onFillDraft(t(key))` 改成 `onFillDraft(key)` ⇒ 第 3 条红；
 * 把 `onDismiss` 写成 `() => {}` ⇒ 第 4 条红。
 */
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EmptyState } from '../src/features/shell/EmptyState.js';
import { loadFirstRunSeen, markFirstRunSeen } from '../src/features/shell/first-run-pref.js';

let container: HTMLDivElement | undefined;
let root: ReturnType<typeof createRoot> | undefined;

afterEach(async () => {
  if (root !== undefined) await act(async () => root?.unmount());
  container?.remove();
  container = undefined;
  root = undefined;
});

async function render(node: React.ReactElement): Promise<HTMLElement> {
  const host = document.createElement('div');
  document.body.append(host);
  container = host;
  root = createRoot(host);
  await act(async () => {
    root?.render(node);
  });
  return host;
}

const click = async (el: Element): Promise<void> => {
  await act(async () => {
    (el as HTMLElement).click();
  });
};

describe('首启引导：收集箱空态里的三条示例', () => {
  it('给了 firstRun 才出现，且标题换成引导标题（不叠两层）', async () => {
    const host = await render(
      <EmptyState filter={{ kind: 'all' } as never} firstRun={{ onFillDraft: () => {}, onDismiss: () => {} }} />,
    );
    const box = host.querySelector('[data-testid="first-run"]');
    expect(box).not.toBeNull();
    // 引导标题在，默认空态标题不在 —— 两层标题是同一件事说两遍。
    expect(host.textContent).toContain('把脑子里的事先倒出来');
    expect(host.textContent).not.toContain('收集箱是空的');
    // 三条示例 + 一个出口。
    expect(host.querySelectorAll('[data-testid^="first-run-example-"]').length).toBe(3);
    expect(host.querySelector('[data-testid="first-run-dismiss"]')).not.toBeNull();
  });

  it('不给 firstRun 时一条都不渲染（老用户 / 非收集箱路径）', async () => {
    const host = await render(<EmptyState filter={{ kind: 'all' } as never} />);
    expect(host.querySelector('[data-testid="first-run"]')).toBeNull();
    expect(host.querySelectorAll('[data-testid^="first-run-example-"]').length).toBe(0);
    // 默认文案仍然在 —— 不能因为加了引导就把原来的空态弄丢。
    expect(host.textContent).toContain('收集箱是空的');
  });

  it('点示例交出去的是**词条原文**，不是序号', async () => {
    const onFillDraft = vi.fn();
    const host = await render(
      <EmptyState filter={{ kind: 'all' } as never} firstRun={{ onFillDraft, onDismiss: () => {} }} />,
    );
    const first = host.querySelector('[data-testid="first-run-example-1"]');
    expect(first).not.toBeNull();
    await click(first as Element);
    expect(onFillDraft).toHaveBeenCalledTimes(1);
    // 与词条表逐字一致：改词条要同时改这里（否则这条会红，提醒你两条路都改）。
    expect(onFillDraft.mock.calls[0]?.[0]).toBe('明天下午3点 给客户回邮件');
  });

  it('出口只调 onDismiss，不顺手填充', async () => {
    const onFillDraft = vi.fn();
    const onDismiss = vi.fn();
    const host = await render(
      <EmptyState filter={{ kind: 'all' } as never} firstRun={{ onFillDraft, onDismiss }} />,
    );
    await click(host.querySelector('[data-testid="first-run-dismiss"]') as Element);
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(onFillDraft).not.toHaveBeenCalled();
  });
});

describe('first-run-pref：两态 + 失败时的取向', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('没写过 ⇒ 没看过（新用户该看到引导）', () => {
    expect(loadFirstRunSeen()).toBe(false);
  });

  it('写过 ⇒ 看过', () => {
    markFirstRunSeen();
    expect(loadFirstRunSeen()).toBe(true);
  });

  it('存储抛错时读成「看过」—— 宁可少引导一次，也不每次启动都弹', () => {
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError: localStorage 被禁');
    });
    try {
      expect(loadFirstRunSeen()).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });

  it('写失败不抛（隐私模式下次启动会再出现一次，但这次不崩）', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    try {
      expect(() => { markFirstRunSeen(); }).not.toThrow();
    } finally {
      spy.mockRestore();
    }
  });
});
