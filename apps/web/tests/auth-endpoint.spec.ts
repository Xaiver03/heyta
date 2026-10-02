/**
 * 「这次认证发给哪台服务端」的判据
 * =================================
 *
 * 这个文件钉住的是产品负责人那句话落地后的形状：
 *
 * > 「绝对不允许什么用自己正在用的域名才能够注册，不可能是这样子的。」
 *
 * 四条判据，每一条都对应一种真实的错法：
 *
 *   1. **没配过时取当前来源。** 官方托管的部署形态是"站点 `/` + 应用 `/app/` +
 *      API `/api/` 同一个域名"（`deployment.md` §3.3.1），所以来源就是答案。
 *      反例（就是被拆掉的那道墙）：地址为空时让**用户去填** —— 那是把
 *      "你知道自己的同步服务端域名吗"当成注册的前置条件。
 *   2. **已配置的优先。** 自建用户在同步设置里填过另一台，默认值绝不能盖掉它 ——
 *      那会把凭据发到错的服务器上，而界面只会说"登录没完成"。
 *   3. **`VITE_SYNC_URL` 也要校验。** 少协议 / 空串 / `"undefined"` 这类值一旦
 *      被当成地址，症状是请求发去相对路径或 `https://undefined`，
 *      归因会跑到认证逻辑上去。
 *   4. 🔴 **默认值不等于"已配置"**（最后那组）。这个默认只服务"发起一次认证动作"，
 *      不许被拿去写 `useSyncStore.baseUrl` —— 空的 baseUrl 是**纯本地模式**
 *      （`host.ts`），把它预填成"已配置"等于替用户选择了云端，
 *      而且会让同步栏对一个从未碰过同步的人开始报错。
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { OFFICIAL_SITE_ORIGIN } from '@heyta/app-host';

import { authBaseUrl, isUnconfigured } from '../src/lib/auth-endpoint.js';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('authBaseUrl', () => {
  it('没配过服务端时取当前来源 —— 注册不需要任何人敲域名', () => {
    expect(authBaseUrl('')).toBe(window.location.origin);
    expect(authBaseUrl()).toBe(window.location.origin);
  });

  it('🔴 算出来的地址永远非空 —— 「空地址」不再是界面要用户填的东西', () => {
    for (const configured of ['', '   ', 'https://self.example.com']) {
      expect(authBaseUrl(configured)).not.toBe('');
    }
  });

  it('已配置的服务端优先，默认值不许盖掉它', () => {
    expect(authBaseUrl('https://self.example.com')).toBe('https://self.example.com');
  });

  it('配了 VITE_SYNC_URL 就用它（应用与同步服务端分域的自建形态）', () => {
    vi.stubEnv('VITE_SYNC_URL', 'https://sync.example.com/');
    expect(authBaseUrl('')).toBe('https://sync.example.com');
  });

  it('已配置的同步地址仍然高于 VITE_SYNC_URL', () => {
    vi.stubEnv('VITE_SYNC_URL', 'https://sync.example.com');
    expect(authBaseUrl('https://other.example.com')).toBe('https://other.example.com');
  });

  it('🔴 不合法的 VITE_SYNC_URL 当成没配 —— 而不是拿它去发请求', () => {
    for (const bad of ['', '   ', 'not a url', 'undefined', 'ftp://x.example.com']) {
      vi.stubEnv('VITE_SYNC_URL', bad);
      expect(authBaseUrl(''), `"${bad}" 应该被当成没配`).toBe(window.location.origin);
    }
  });

  it('尾斜杠归一（两处在拼 `${baseUrl}/api/…`，双斜杠会变成第二个地址）', () => {
    vi.stubEnv('VITE_SYNC_URL', 'https://sync.example.com///');
    expect(authBaseUrl('')).toBe('https://sync.example.com');
    expect(authBaseUrl('https://self.example.com/')).toBe('https://self.example.com');
  });
});

describe('isUnconfigured', () => {
  it('空串与纯空格都是"没配过"', () => {
    expect(isUnconfigured('')).toBe(true);
    expect(isUnconfigured('   ')).toBe(true);
    expect(isUnconfigured('https://self.example.com')).toBe(false);
  });

  it('🔴 有了同源默认值之后，"没配过"这个状态**仍然存在** —— 它不能被默认值冒充', () => {
    expect(isUnconfigured('')).toBe(true);
    expect(isUnconfigured(authBaseUrl(''))).toBe(false);
  });
});

/**
 * 🔴 原生壳里"来源"根本不是服务端。
 *
 * 2026-10-02 产品负责人对着 macOS 壳的截图问：「为什么还是默认就是要什么粘贴
 * 服务器地址和令牌之类的东西？……一定是默认是我们提供公共服务的。」
 * 那张图里预填的是 `heyta-local://app` —— 壳的 WebView 从自定义 scheme 加载共享 UI，
 * 于是 `window.location.origin` 就是那个 scheme，而它**一个请求都发不出去**。
 * 上面第 1 条判据（"来源就是答案"）在 web 上成立，在壳里恰好是反的。
 *
 * 三条各挡一种错法：
 *   · 回落必须是**公共服务**，不是空串、不是那个 scheme；
 *   · `null` / 非 URL 的来源（隐私窗口、about:blank）走同一条，不能抛；
 *   · 🔴 自建 **web** 的来源必须**原样保留** —— 把这一档做成"永远优先公共服务"
 *     就是把上一轮拆掉的那道墙换个方向砌回来（自建用户会被默默发到我们服务器上）。
 */
describe('authBaseUrl：来源不是 http(s) 时（macOS / Windows 壳）', () => {
  const withOrigin = (origin: string, run: () => void): void => {
    const original = window.location;
    Object.defineProperty(window, 'location', {
      value: { origin },
      configurable: true,
      writable: true,
    });
    try {
      run();
    } finally {
      Object.defineProperty(window, 'location', {
        value: original,
        configurable: true,
        writable: true,
      });
    }
  };

  it('自定义 scheme 的来源 ⇒ 官方公共服务，而不是那个发不出请求的地址', () => {
    withOrigin('heyta-local://app', () => {
      const url = authBaseUrl('');
      expect(url).not.toContain('heyta-local');
      expect(new URL(url).protocol).toBe('https:');
      expect(url).toBe(OFFICIAL_SITE_ORIGIN);
    });
  });

  it('来源是 `null`（不是绝对 URL）⇒ 同一条回落，且不抛', () => {
    withOrigin('null', () => {
      expect(authBaseUrl('')).toBe(OFFICIAL_SITE_ORIGIN);
    });
  });

  it('🔴 自建 web 的 http(s) 来源**原样保留** —— 不许被公共服务顶掉', () => {
    withOrigin('https://sync.mycompany.example', () => {
      expect(authBaseUrl('')).toBe('https://sync.mycompany.example');
    });
  });
});
