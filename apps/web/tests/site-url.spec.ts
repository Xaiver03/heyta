/**
 * 「站点在哪」的判据
 * ====================
 *
 * 🔴 这个文件钉住的是**产品孤岛的另一半**能不能成立：
 * 应用里指向帮助 / 价格 / 更新动态的链接，地址是从哪算出来的。
 *
 * 三条判据，每一条都对应一种真实的错法：
 *
 *   1. **默认落在当前来源的根上。**
 *      `docs/runbooks/deployment.md` §3.3.1 定的是唯一域名：站点住 `/`，
 *      应用住 `/app/`。所以"站点在应用所在来源的根上"是一个**已知事实**，
 *      不是猜一个域名。写死 `https://heyta.finlaw.cloud` 会在分域名部署时
 *      把用户送到别人的站点上。
 *   2. **`VITE_SITE_URL` 配了就用它**（分域名部署的口子），
 *      而且与 `VITE_APP_URL` 一样**校验**：少了协议、多了空格、被写成
 *      `"undefined"` 的值如果在页面上变成 `href`，浏览器会当成**相对路径** ——
 *      用户点下去得到当前域名下的一个 404，正是要避免的那类谎。
 *   3. **拼接不产生双斜杠。** `https://x//help` 与 `https://x/help`
 *      在爬虫与缓存那里是两个地址。
 *
 * ⚠️ 与 `apps/landing` 的 `lib/app-url.ts` 是**同一条纪律的两个方向**：
 * 那边管"站点 → 应用"，这里管"应用 → 站点"。两份都要在，单向可达仍然
 * 是两个孤岛。
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { HELP_SYNC_ANCHOR, siteLink, siteRoot } from '../src/lib/site-url.js';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('siteRoot', () => {
  it('默认取当前来源 —— 站点就在这个来源的根上（部署定下的形状）', () => {
    expect(siteRoot()).toBe(window.location.origin);
  });

  it('配了 VITE_SITE_URL 就用它，并去掉尾斜杠', () => {
    vi.stubEnv('VITE_SITE_URL', 'https://site.example.com/');
    expect(siteRoot()).toBe('https://site.example.com');
  });

  it('🔴 不合法的值当成没配 —— 否则它会在页面上变成一个相对路径的 404', () => {
    for (const bad of ['', '   ', 'not a url', 'undefined', 'ftp://x.example.com']) {
      vi.stubEnv('VITE_SITE_URL', bad);
      expect(siteRoot(), `"${bad}" 应该被当成没配`).toBe(window.location.origin);
    }
  });
});

describe('siteLink', () => {
  it('拼出绝对地址，且不产生双斜杠', () => {
    vi.stubEnv('VITE_SITE_URL', 'https://site.example.com/');
    expect(siteLink('/help')).toBe('https://site.example.com/help');
  });

  it('带上锚点 —— 报错提示要直接落到那一问上', () => {
    vi.stubEnv('VITE_SITE_URL', 'https://site.example.com');
    expect(siteLink(HELP_SYNC_ANCHOR)).toBe('https://site.example.com/help#sync');
  });

  it('漏写开头的斜杠也能拼对（调用点不必记这条规矩）', () => {
    vi.stubEnv('VITE_SITE_URL', 'https://site.example.com');
    expect(siteLink('pricing')).toBe('https://site.example.com/pricing');
  });

  it('未配置时落在当前来源上（不是写死的域名）', () => {
    expect(siteLink('/changelog')).toBe(`${window.location.origin}/changelog`);
  });
});
