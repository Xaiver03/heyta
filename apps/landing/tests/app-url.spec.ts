/**
 * 「应用在哪」的判据
 * ====================
 *
 * 这个文件钉的是一件**只有两种情况、而两种情况都必须在测试里出现过**的事：
 * 应用配了地址 / 没配地址。漏测任何一边都会留下一种谎话 ——
 * 要么"按钮说能用、点了是 404"，要么应用明明上线了而页面上没有入口。
 *
 * 🔴 这里**不顺带测渲染**。渲染层面的证明（CTA 真的换成了外链、真的带了
 * `rel="noopener noreferrer"`）在 `render.spec.tsx` 里，因为那需要真 DOM。
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { appPathHref, appUrl, startCta } from '../src/lib/app-url.js';

afterEach(() => {
  // 每个用例都从"没配置"这个默认状态开始。漏了这行，前一个用例设的
  // `VITE_APP_URL` 会漏到后面 —— 那正是"测试之间互相污染"的经典写法。
  vi.unstubAllEnvs();
});

describe('appUrl()：读构建期的 VITE_APP_URL', () => {
  it('没配置时是 null', () => {
    vi.stubEnv('VITE_APP_URL', '');
    expect(appUrl()).toBeNull();
  });

  it('只有空格也算没配置', () => {
    vi.stubEnv('VITE_APP_URL', '   ');
    expect(appUrl()).toBeNull();
  });

  it('正常地址可用，并去掉末尾斜杠', () => {
    vi.stubEnv('VITE_APP_URL', 'https://example.com/app/');
    expect(appUrl()).toBe('https://example.com/app');
  });

  it('前后的空白会被修掉，不会变成一个点不通的 href', () => {
    vi.stubEnv('VITE_APP_URL', '  https://example.com/app  ');
    expect(appUrl()).toBe('https://example.com/app');
  });

  /**
   * 🔴 这一组是本文件存在的核心理由。
   *
   * 一个不像地址的值如果被原样放进 `href`，浏览器会把它当**相对路径** ——
   * 用户点下去得到的是当前域名下的 404。那比"没有按钮"更坏，
   * 因为它看起来是能用的。所以格式不对就当作**没配置**。
   */
  it.each([
    ['少了协议', 'example.com/app'],
    ['写成相对路径', '/app/'],
    ['非 http(s) 协议', 'ftp://example.com/app'],
    ['被写成字符串 undefined', 'undefined'],
    ['根本不是地址', 'not a url'],
    ['git 远程写法', 'git@github.com:Xaiver03/heyta.git'],
  ])('格式不合法就当作没配置：%s', (_why, value) => {
    vi.stubEnv('VITE_APP_URL', value);
    expect(appUrl()).toBeNull();
  });

  it('http 也算合法 —— 内网/自建实例常常没有证书', () => {
    vi.stubEnv('VITE_APP_URL', 'http://192.168.1.10:5173');
    expect(appUrl()).toBe('http://192.168.1.10:5173');
  });
});

describe('startCta()：全页唯一的「开始使用」意图', () => {
  it('没配置应用时，逐字退回今天的行为：站内锚点 + 自建说法', () => {
    vi.stubEnv('VITE_APP_URL', '');
    const cta = startCta('zh-CN');
    expect(cta.href).toBe('#selfhost');
    expect(cta.labelKey).toBe('landing.cta.selfHost');
    expect(cta.external).toBe(false);
  });

  it('配置了应用时，指向应用并换成「立即使用」', () => {
    vi.stubEnv('VITE_APP_URL', 'https://example.com/app/');
    const cta = startCta('zh-CN');
    expect(cta.href).toBe('https://example.com/app');
    expect(cta.labelKey).toBe('landing.cta.useApp');
    // `external` 是渲染处加 `rel="noopener noreferrer"` 的开关，
    // 也是导航是否多一条的开关 —— 它必须为真，否则外链没有 rel。
    expect(cta.external).toBe(true);
  });

  it('地址不合法时退回站内锚点，而不是给一个坏外链', () => {
    vi.stubEnv('VITE_APP_URL', 'example.com/app');
    const cta = startCta('zh-CN');
    expect(cta.href).toBe('#selfhost');
    expect(cta.labelKey).toBe('landing.cta.selfHost');
    expect(cta.external).toBe(false);
  });
});

describe('startCta()：把落地页的语言带进应用', () => {
  /**
   * 🔴 这一段钉的是 roadmap §5.1 留下的保留之一：
   * 英文落地页点「Use it now」进应用，看到的却是**中文**界面。
   * 落地页靠 URL 定语言、应用靠自己的偏好存储定语言，两边原本不通。
   */
  it('英文页：外链带上 ?lang=en', () => {
    vi.stubEnv('VITE_APP_URL', 'https://example.com/app');
    expect(startCta('en').href).toBe('https://example.com/app?lang=en');
  });

  it('默认语言（中文）**不带**参数 —— 不让每条链接都多一段噪音', () => {
    vi.stubEnv('VITE_APP_URL', 'https://example.com/app');
    expect(startCta('zh-CN').href).toBe('https://example.com/app');
  });

  it('应用地址自己带查询串时，参数是追加而不是覆盖', () => {
    // 手拼 `?`/`&` 会在这里生成坏地址（`...?flag=1?lang=en`）。
    vi.stubEnv('VITE_APP_URL', 'https://example.com/app?flag=1');
    expect(startCta('en').href).toBe('https://example.com/app?flag=1&lang=en');
  });

  it('没配置应用时，语言参数也无处可去 —— 仍然是站内锚点', () => {
    vi.stubEnv('VITE_APP_URL', '');
    const cta = startCta('en');
    expect(cta.href).toBe('#selfhost');
    expect(cta.external).toBe(false);
  });
});

/**
 * `appPathHref`：应用**自己**提供的服务端渲染页面（`/recover-passkey` 等）。
 *
 * 🔴 判据只有两条，但两条都对应真实会出错的形状：
 *   1. **住在域名的根上，不在 `/app/` 下** —— 那三张凭据页是 `server/src/pages.ts`
 *      渲染的（`docs/runbooks/deployment.md` §3.3.1 的 nginx 段），
 *      拼到 `/app/recover-passkey` 会 404；
 *   2. **未配置应用地址时不猜** —— 返回 `null`，让调用点**不渲染**那个链接。
 */
describe('appPathHref', () => {
  it('落在应用地址的**来源**上，避开 `/app/` 前缀', () => {
    vi.stubEnv('VITE_APP_URL', 'https://heyta.finlaw.cloud/app/');
    expect(appPathHref('/recover-passkey')).toBe('https://heyta.finlaw.cloud/recover-passkey');
  });

  it('应用挂在子路径下也一样只取来源', () => {
    vi.stubEnv('VITE_APP_URL', 'https://example.com/deep/app/');
    expect(appPathHref('/verify-email')).toBe('https://example.com/verify-email');
  });

  it('🔴 未配置应用时返回 null —— 调用点据此不渲染，而不是猜一个地址', () => {
    vi.stubEnv('VITE_APP_URL', '');
    expect(appPathHref('/recover-passkey')).toBeNull();
  });

  it('漏写开头的斜杠也能拼对', () => {
    vi.stubEnv('VITE_APP_URL', 'https://example.com/app');
    expect(appPathHref('recover-passkey')).toBe('https://example.com/recover-passkey');
  });
});
