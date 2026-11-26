/**
 * #56 · 应用图标切换（Web 等价物 = favicon）
 * ==========================================
 *
 * 四件必须能红的事：
 *   1. 清单含 `default` 且无重复；
 *   2. `default` 落在**真实图标路径**上（不是内联 SVG）；
 *   3. 变体把**解析到的 token 颜色**写进 data URI（不写死 hex），不同变体不同；
 *   4. 存储往返 + 脏值回落 `default`，且 `applyAppIcon` 真的改 `<link rel="icon">`。
 *
 * ⚠️ 这里注入 `readColor` 而不是读真实样式表：jsdom 不加载 tokens.css。
 *    取不到颜色时 `appIconHref` 必须回落真实图标 —— 这条也单独钉。
 */
import { beforeEach, describe, expect, it } from 'vitest';

import {
  APP_ICONS,
  APP_ICON_STORAGE_KEY,
  appIconHref,
  applyAppIcon,
  DEFAULT_APP_ICON_HREF,
  loadAppIcon,
  saveAppIcon,
  type AppIcon,
} from '../src/lib/app-icon.js';

/** 测试夹具色（不是产品代码里的色值）。 */
const FIXTURE_COLOR = '#336699';
const readColor = (): string => FIXTURE_COLOR;
const tokenDot = (token: string): string =>
  token.includes('emerald') ? '#00ff00' : token.includes('sky') ? '#0000ff' : '#ff00ff';

function iconLink(): HTMLLinkElement | null {
  return document.head.querySelector<HTMLLinkElement>('link[rel="icon"]');
}

describe('#56 应用图标（favicon）', () => {
  beforeEach(() => {
    localStorage.clear();
    for (const node of Array.from(document.head.querySelectorAll('link[rel="icon"]'))) node.remove();
  });

  it('清单含 default 且无重复', () => {
    expect(APP_ICONS).toContain('default');
    expect(new Set(APP_ICONS).size).toBe(APP_ICONS.length);
  });

  it('default 落在真实图标路径，不是 data URI', () => {
    const href = appIconHref('default', readColor);
    expect(href).toBe(DEFAULT_APP_ICON_HREF);
    expect(href.startsWith('data:')).toBe(false);
  });

  it('变体是 data: SVG，内嵌解析到的颜色（不写死 hex）', () => {
    const href = appIconHref('emerald', readColor);
    expect(href.startsWith('data:image/svg+xml,')).toBe(true);
    expect(decodeURIComponent(href)).toContain(FIXTURE_COLOR);
  });

  it('不同变体产生不同 URI；取不到颜色时回落真实图标', () => {
    expect(appIconHref('emerald', tokenDot)).not.toBe(appIconHref('sky', tokenDot));
    expect(appIconHref('emerald', () => '')).toBe(DEFAULT_APP_ICON_HREF);
  });

  it('applyAppIcon 写出 / 更新 <link rel="icon">，default 还原真实路径', () => {
    expect(iconLink()).toBeNull();
    applyAppIcon('emerald', readColor);
    const link = iconLink();
    expect(link).not.toBeNull();
    expect(link?.getAttribute('href')?.startsWith('data:image/svg+xml,')).toBe(true);

    applyAppIcon('default', readColor);
    expect(iconLink()?.getAttribute('href')).toBe(DEFAULT_APP_ICON_HREF);
  });

  it('存储：往返 + 脏值回落 default', () => {
    expect(loadAppIcon()).toBe('default');
    saveAppIcon('sky');
    expect(localStorage.getItem(APP_ICON_STORAGE_KEY)).toBe('sky');
    expect(loadAppIcon()).toBe('sky');
    localStorage.setItem(APP_ICON_STORAGE_KEY, 'neon-nonsense');
    expect(loadAppIcon()).toBe('default');
  });

  it('每个非默认变体的 href 都能解析出 SVG（无坏 fill）', () => {
    for (const icon of APP_ICONS) {
      const href = appIconHref(icon as AppIcon, readColor);
      if (icon === 'default') continue;
      const svg = decodeURIComponent(href);
      expect(svg).toContain('<svg');
      expect(svg).toContain(FIXTURE_COLOR);
    }
  });
});
