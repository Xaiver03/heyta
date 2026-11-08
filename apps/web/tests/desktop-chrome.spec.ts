/**
 * 桌面壳标题栏融合的纯逻辑测试。
 *
 * 🔴 测的都是「开发机上看不出错、到用户机器上会出错」的分支：
 * 平台名的大小写 / 空白容错、linux 这一真实分支、各 `…Enabled` 判定、
 * 以及 `<html>` 标记的新增 / 清除 / 幂等 / 活跃态切换。
 *
 * DOM 包裹层（apply / clear / setActive）在 jsdom 下验证，浏览器 / PWA 路径
 * 由 `isNativeShellHost` 把关，这里不覆盖（那一侧靠门禁 + 实机验收）。
 */

// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';

import {
  applyDesktopChrome,
  clearDesktopChrome,
  doubleClickMaximizeEnabled,
  dragRegionEnabled,
  inactiveDimEnabled,
  keepsNativeCaptionButtons,
  resolveDesktopPlatform,
  requiresCaptionInset,
  setDesktopChromeActive,
} from '../src/features/shell/desktop-chrome.js';

describe('resolveDesktopPlatform', () => {
  it('Win32 / Windows NT → windows（大小写、空白容错）', () => {
    expect(resolveDesktopPlatform('Win32')).toBe('windows');
    expect(resolveDesktopPlatform('Windows NT')).toBe('windows');
    expect(resolveDesktopPlatform('  WIN32 ')).toBe('windows');
    expect(resolveDesktopPlatform('MacIntel')).toBe('macos');
    expect(resolveDesktopPlatform('MACINTOSH')).toBe('macos');
  });

  it('Linux / X11 / GTK → linux（真实分支，不是兜底）', () => {
    expect(resolveDesktopPlatform('Linux x86_64')).toBe('linux');
    expect(resolveDesktopPlatform('X11')).toBe('linux');
    expect(resolveDesktopPlatform('GTK')).toBe('linux');
  });

  it('空 / null / 移动端 UA → other（浏览器 / PWA / 移动端）', () => {
    expect(resolveDesktopPlatform('')).toBe('other');
    expect(resolveDesktopPlatform(null)).toBe('other');
    expect(resolveDesktopPlatform(undefined)).toBe('other');
    expect(resolveDesktopPlatform('iPhone')).toBe('other');
  });
});

describe('标题栏融合的判定不变量', () => {
  it('macos / windows 需让位 + 保留原生按钮 + 可拖拽 + 双击最大化 + 失焦变暗', () => {
    for (const p of ['macos', 'windows'] as const) {
      expect(requiresCaptionInset(p)).toBe(true);
      expect(keepsNativeCaptionButtons(p)).toBe(true);
      expect(dragRegionEnabled(p)).toBe(true);
      expect(doubleClickMaximizeEnabled(p)).toBe(true);
      expect(inactiveDimEnabled(p)).toBe(true);
    }
  });

  it('linux / other 不当作「内容延伸进标题栏」的目标（保守，不在本轮范围）', () => {
    for (const p of ['linux', 'other'] as const) {
      expect(requiresCaptionInset(p)).toBe(false);
      expect(keepsNativeCaptionButtons(p)).toBe(false);
    }
  });
});

describe('<html> 平台标记', () => {
  afterEach(() => {
    document.documentElement.className = '';
  });

  it('macos → 基类 + 平台子类，且幂等（重复打不重复加）', () => {
    applyDesktopChrome(document, 'macos');
    expect(document.documentElement.classList.contains('heyta-shell')).toBe(true);
    expect(document.documentElement.classList.contains('heyta-shell--macos')).toBe(true);
    applyDesktopChrome(document, 'macos');
    expect(document.documentElement.classList.length).toBe(2);
  });

  it('windows / linux → 各自平台子类', () => {
    applyDesktopChrome(document, 'windows');
    expect(document.documentElement.classList.contains('heyta-shell--windows')).toBe(true);
    document.documentElement.className = '';
    applyDesktopChrome(document, 'linux');
    expect(document.documentElement.classList.contains('heyta-shell--linux')).toBe(true);
  });

  it('other → 只打基类，不加平台子类', () => {
    applyDesktopChrome(document, 'other');
    expect(document.documentElement.classList.contains('heyta-shell')).toBe(true);
    expect(document.documentElement.classList.contains('heyta-shell--other')).toBe(false);
  });

  it('clearDesktopChrome 移除全部 heyta-shell*，保留无关类', () => {
    document.documentElement.className = 'heyta-shell heyta-shell--macos some-app-class';
    clearDesktopChrome(document);
    expect(document.documentElement.classList.contains('heyta-shell')).toBe(false);
    expect(document.documentElement.classList.contains('heyta-shell--macos')).toBe(false);
    expect(document.documentElement.classList.contains('some-app-class')).toBe(true);
  });

  it('setDesktopChromeActive 切换 --active 子类', () => {
    setDesktopChromeActive(document, false);
    expect(document.documentElement.classList.contains('heyta-shell--active')).toBe(false);
    setDesktopChromeActive(document, true);
    expect(document.documentElement.classList.contains('heyta-shell--active')).toBe(true);
  });
});
