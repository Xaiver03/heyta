/**
 * 桌面壳反向授权：意图解析 + 回跳地址 + 兜底入口（ADR-0039 §2.3）。
 *
 * 🔴 这些断言里**有能因注入转红的**：
 *   · 去掉 `readDesktopHandoff` 里的空 state 检查 ⇒ "缺 state 不认"当场红；
 *   · 把令牌从 fragment 挪到 query ⇒ "令牌不进 query"当场红。
 * 安全属性必须落在**可被判据抓住**的地方，而不是注释里。
 */
import { describe, expect, it, vi } from 'vitest';

import {
  DESKTOP_HANDOFF_TESTID,
  buildDesktopCallback,
  handOffToShell,
  maybeHandOffToShell,
  readDesktopHandoff,
} from '../src/features/auth/desktop-handoff.js';

const url = (q: string): URL => new URL(`https://heyta.example/app/${q}`);

describe('读"这次是桌面壳发起的授权"', () => {
  it('auth=desktop 且带 state ⇒ 认，并带回 state', () => {
    expect(readDesktopHandoff(url('?auth=desktop&state=abc123'))).toEqual({ state: 'abc123' });
  });

  it('🔴 缺 state ⇒ **不认**（壳靠它判断回调是不是自己发起的那一次）', () => {
    expect(readDesktopHandoff(url('?auth=desktop'))).toBeNull();
    expect(readDesktopHandoff(url('?auth=desktop&state='))).toBeNull();
  });

  it('没有 auth=desktop ⇒ 不认（普通 web 登录，不该回跳）', () => {
    expect(readDesktopHandoff(url(''))).toBeNull();
    expect(readDesktopHandoff(url('?auth=web&state=abc'))).toBeNull();
  });
});

describe('回跳地址', () => {
  it('🔴 令牌放在 **fragment** 里，不进 query', () => {
    const href = buildDesktopCallback('jwt-token', 'st');
    expect(href.startsWith('heyta://auth#')).toBe(true);
    const parsed = new URL(href);
    expect(parsed.search).toBe('');
    expect(parsed.searchParams.get('token')).toBeNull();
  });

  it('token 与 state 都被编码（它们可能带 URL 里的保留字符）', () => {
    const href = buildDesktopCallback('a b&c', 'x y&z');
    expect(href).toContain('token=a%20b%26c');
    expect(href).toContain('state=x%20y%26z');
  });
});

describe('把令牌交回壳', () => {
  it('挂出**可点的**兜底入口，并尝试自动跳转', () => {
    const assign = vi.fn();
    const doc = document.implementation.createHTMLDocument('t');
    // jsdom 的 location.assign 不可直接改 —— 用一个最小替身，只验"我们调了它"。
    Object.defineProperty(doc, 'defaultView', { value: { location: { assign } } });

    const href = handOffToShell('jwt', 'st', doc);

    const link = doc.querySelector(`[data-testid="${DESKTOP_HANDOFF_TESTID}"]`);
    expect(link).not.toBeNull();
    expect(link?.getAttribute('href')).toBe(href);
    expect(assign).toHaveBeenCalledWith(href);
  });

  it('🔴 不是桌面流程 ⇒ 什么都不做（不挂任何元素）', () => {
    const doc = document.implementation.createHTMLDocument('t');
    expect(maybeHandOffToShell('jwt', url(''), doc)).toBeNull();
    expect(doc.querySelector('[data-testid="desktop-handoff"]')).toBeNull();
  });

  it('是桌面流程 ⇒ 返回回跳地址（这一次真的回跳了）', () => {
    const doc = document.implementation.createHTMLDocument('t');
    Object.defineProperty(doc, 'defaultView', { value: { location: { assign: vi.fn() } } });
    const href = maybeHandOffToShell('jwt', url('?auth=desktop&state=st'), doc, 'a@b.c');
    expect(href).toBe(`heyta://auth#token=jwt&state=st&email=a%40b.c`);
  });
});
