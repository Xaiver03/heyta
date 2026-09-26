/**
 * 语言偏好读写测试
 * ==================
 *
 * 🔴 这个文件存在的理由：**语言偏好读错/写错，用户会看到自己读不懂的界面，
 * 而且没有任何一处会报错。**
 *
 * web 的语言来源是 `localStorage` 里的用户偏好（与 `heyta.theme` 并列的
 * `heyta.locale`），**不是设备语言** —— 后者是移动端的做法，见
 * `apps/mobile/src/i18n/locale.ts`。这两条契约都必须钉住：
 *
 *   - 读：没存过 / 存了不支持的值 → `DEFAULT_LOCALE`；
 *   - 写：`applyLocale` 必须落到正确的键、并同步 `<html lang>`；
 *   - **不读 `navigator.language`**（web 刻意不做自动判断）。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_LOCALE } from '@heyta/i18n';

import { applyLocale, isLocale, resolveInitialLocale } from '../src/lib/locale.js';

beforeEach(() => {
  localStorage.clear();
  document.documentElement.lang = '';
});

describe('isLocale', () => {
  it('只认支持的两种语言', () => {
    expect(isLocale('zh-CN')).toBe(true);
    expect(isLocale('en')).toBe(true);
    expect(isLocale('fr')).toBe(false);
    expect(isLocale('zh')).toBe(false);
    expect(isLocale(null)).toBe(false);
  });
});

describe('resolveInitialLocale', () => {
  it('没有存过偏好时回落到默认语言', () => {
    expect(resolveInitialLocale()).toBe(DEFAULT_LOCALE);
  });

  it('读取已存的有效偏好', () => {
    localStorage.setItem('heyta.locale', 'en');
    expect(resolveInitialLocale()).toBe('en');
    localStorage.setItem('heyta.locale', 'zh-CN');
    expect(resolveInitialLocale()).toBe('zh-CN');
  });

  it('🔴 存了不支持的语言时回落到默认语言，而不是被它带走', () => {
    localStorage.setItem('heyta.locale', 'fr-FR');
    expect(resolveInitialLocale()).toBe(DEFAULT_LOCALE);
  });

  it('🔴 不读 navigator.language —— web 刻意不做设备语言自动判断', () => {
    // 设备语言是英文，但用户没选过：必须仍然是默认语言。
    // 这条断的是"顺手加一层 navigator 兜底"那种改动 ——
    // 它会让用户明确选过中文之后、换个浏览器又被翻回英文。
    const spy = vi.spyOn(navigator, 'language', 'get').mockReturnValue('en-US');
    expect(resolveInitialLocale()).toBe(DEFAULT_LOCALE);
    spy.mockRestore();
  });
});

describe('applyLocale', () => {
  it('写入 heyta.locale 键并同步 <html lang>', () => {
    applyLocale('en');
    expect(localStorage.getItem('heyta.locale')).toBe('en');
    expect(document.documentElement.lang).toBe('en');

    applyLocale('zh-CN');
    expect(localStorage.getItem('heyta.locale')).toBe('zh-CN');
    expect(document.documentElement.lang).toBe('zh-CN');
  });
});
