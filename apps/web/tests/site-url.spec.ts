import { OFFICIAL_SITE_ORIGIN } from '@heyta/app-host';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { HELP_SYNC_ANCHOR, siteLink, siteRoot } from '../src/lib/site-url.js';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('siteRoot', () => {
  it('本地浏览器与桌面壳默认使用官方站点', () => {
    expect(siteRoot()).toBe(OFFICIAL_SITE_ORIGIN);
  });

  it('配了 VITE_SITE_URL 就用它，并去掉尾斜杠', () => {
    vi.stubEnv('VITE_SITE_URL', 'https://site.example.com/');
    expect(siteRoot()).toBe('https://site.example.com');
  });

  it('🔴 不合法的值当成没配 —— 否则它会在页面上变成一个相对路径的 404', () => {
    for (const bad of ['', '   ', 'not a url', 'undefined', 'ftp://x.example.com']) {
      vi.stubEnv('VITE_SITE_URL', bad);
      expect(siteRoot(), `"${bad}" 应该被当成没配`).toBe(OFFICIAL_SITE_ORIGIN);
    }
  });
});

describe('siteLink', () => {
  it('拼出绝对地址，且不产生双斜杠', () => {
    vi.stubEnv('VITE_SITE_URL', 'https://site.example.com/');
    expect(siteLink('/docs')).toBe('https://site.example.com/docs');
  });

  it('带上锚点 —— 报错提示要直接落到那一问上', () => {
    vi.stubEnv('VITE_SITE_URL', 'https://site.example.com');
    expect(siteLink(HELP_SYNC_ANCHOR)).toBe('https://site.example.com/docs#sync');
  });

  it('漏写开头的斜杠也能拼对（调用点不必记这条规矩）', () => {
    vi.stubEnv('VITE_SITE_URL', 'https://site.example.com');
    expect(siteLink('pricing')).toBe('https://site.example.com/pricing');
  });

  it('未配置时帮助入口落在官方站点', () => {
    expect(siteLink('/changelog')).toBe(`${OFFICIAL_SITE_ORIGIN}/changelog`);
  });
});
